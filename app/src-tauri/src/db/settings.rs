use crate::types::AppSettings;
use rusqlite::Connection;

pub fn read_settings(conn: &Connection) -> Result<AppSettings, String> {
    let mut stmt = conn
        .prepare("SELECT value FROM settings WHERE key = ?1")
        .map_err(|e| e.to_string())?;

    let result: Result<String, _> = stmt.query_row(["app_settings"], |row| row.get(0));

    match result {
        Ok(json) => serde_json::from_str(&json).map_err(|e| e.to_string()),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(AppSettings::default()),
        Err(e) => Err(e.to_string()),
    }
}

/// Read settings (including secrets stored directly in SQLite).
///
/// Alias for `read_settings()` — kept for call-site compatibility.
pub fn read_settings_hydrated(conn: &Connection) -> Result<AppSettings, String> {
    read_settings(conn)
}

pub fn write_settings(conn: &Connection, settings: &AppSettings) -> Result<(), String> {
    let json = serde_json::to_string(settings).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
        ["app_settings", &json],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::create_test_db_for_tests;

    fn make_settings(workspace_path: Option<&str>, skills_path: Option<&str>) -> AppSettings {
        AppSettings {
            workspace_path: workspace_path.map(String::from),
            skills_path: skills_path.map(String::from),
            ..AppSettings::default()
        }
    }

    #[test]
    fn test_read_settings_returns_default_when_no_row() {
        let conn = create_test_db_for_tests();
        // No settings row exists yet — should return the default without error.
        let result = read_settings(&conn);
        assert!(result.is_ok(), "read_settings should return Ok for an empty DB");
        let settings = result.unwrap();
        // Defaults: no workspace path set.
        assert!(settings.workspace_path.is_none());
    }

    #[test]
    fn test_write_then_read_settings_round_trip() {
        let conn = create_test_db_for_tests();

        let original = make_settings(Some("/home/user/workspace"), Some("/home/user/skills"));
        write_settings(&conn, &original).unwrap();

        let read_back = read_settings(&conn).unwrap();
        assert_eq!(read_back.workspace_path.as_deref(), Some("/home/user/workspace"));
        assert_eq!(read_back.skills_path.as_deref(), Some("/home/user/skills"));
    }

    #[test]
    fn test_write_settings_update_does_not_corrupt_data() {
        let conn = create_test_db_for_tests();

        // First write.
        let first = make_settings(Some("/first/workspace"), Some("/first/skills"));
        write_settings(&conn, &first).unwrap();

        // Second write with different values — simulates an update.
        let second = make_settings(Some("/second/workspace"), Some("/second/skills"));
        write_settings(&conn, &second).unwrap();

        // Only the latest values should be visible.
        let read_back = read_settings(&conn).unwrap();
        assert_eq!(read_back.workspace_path.as_deref(), Some("/second/workspace"));
        assert_eq!(read_back.skills_path.as_deref(), Some("/second/skills"));

        // The settings table must have exactly one row — INSERT OR REPLACE must not duplicate.
        let row_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM settings WHERE key = 'app_settings'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(row_count, 1, "INSERT OR REPLACE must not create duplicate rows");
    }

    #[test]
    fn test_write_settings_partial_update_preserves_other_fields() {
        let conn = create_test_db_for_tests();

        // Write settings with an API key set.
        let mut initial = make_settings(Some("/ws"), None);
        initial.anthropic_api_key = Some("sk-test-key".to_string());
        write_settings(&conn, &initial).unwrap();

        // Overwrite with settings that clear the API key but set a skills path.
        let mut update = make_settings(Some("/ws"), Some("/skills"));
        update.anthropic_api_key = None;
        write_settings(&conn, &update).unwrap();

        let read_back = read_settings(&conn).unwrap();
        assert_eq!(read_back.skills_path.as_deref(), Some("/skills"));
        assert!(read_back.anthropic_api_key.is_none(), "cleared field should be None after update");

        // No duplicate rows.
        let row_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM settings WHERE key = 'app_settings'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(row_count, 1);
    }

    #[test]
    fn test_read_settings_hydrated_is_alias_for_read_settings() {
        let conn = create_test_db_for_tests();

        let settings = make_settings(Some("/my/path"), None);
        write_settings(&conn, &settings).unwrap();

        let via_read = read_settings(&conn).unwrap();
        let via_hydrated = read_settings_hydrated(&conn).unwrap();

        assert_eq!(
            via_read.workspace_path, via_hydrated.workspace_path,
            "read_settings_hydrated must return the same data as read_settings"
        );
    }
}
