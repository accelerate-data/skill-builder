use crate::types::AppSettings;
use rusqlite::Connection;
use std::fs;
use std::sync::Mutex;

pub struct Db(pub Mutex<Connection>);

pub fn init_db(app: &tauri::App) -> Result<Db, Box<dyn std::error::Error>> {
    use tauri::Manager;
    let app_dir = app.path().app_data_dir()?;
    fs::create_dir_all(&app_dir)?;
    let conn = Connection::open(app_dir.join("skill-builder.db"))?;
    run_migrations(&conn)?;
    Ok(Db(Mutex::new(conn)))
}

fn run_migrations(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );",
    )
}

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

    fn create_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();
        conn
    }

    #[test]
    fn test_read_default_settings() {
        let conn = create_test_db();
        let settings = read_settings(&conn).unwrap();
        assert!(settings.anthropic_api_key.is_none());
        assert!(settings.workspace_path.is_none());
    }

    #[test]
    fn test_write_and_read_settings() {
        let conn = create_test_db();
        let settings = AppSettings {
            anthropic_api_key: Some("sk-test-key".to_string()),
            workspace_path: Some("/home/user/skills".to_string()),
        };
        write_settings(&conn, &settings).unwrap();

        let loaded = read_settings(&conn).unwrap();
        assert_eq!(loaded.anthropic_api_key.as_deref(), Some("sk-test-key"));
        assert_eq!(
            loaded.workspace_path.as_deref(),
            Some("/home/user/skills")
        );
    }

    #[test]
    fn test_overwrite_settings() {
        let conn = create_test_db();
        let v1 = AppSettings {
            anthropic_api_key: Some("key-1".to_string()),
            workspace_path: None,
        };
        write_settings(&conn, &v1).unwrap();

        let v2 = AppSettings {
            anthropic_api_key: Some("key-2".to_string()),
            workspace_path: Some("/new/path".to_string()),
        };
        write_settings(&conn, &v2).unwrap();

        let loaded = read_settings(&conn).unwrap();
        assert_eq!(loaded.anthropic_api_key.as_deref(), Some("key-2"));
        assert_eq!(loaded.workspace_path.as_deref(), Some("/new/path"));
    }

    #[test]
    fn test_migration_is_idempotent() {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();
        run_migrations(&conn).unwrap();

        let settings = read_settings(&conn).unwrap();
        assert!(settings.anthropic_api_key.is_none());
    }
}
