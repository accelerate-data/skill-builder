use crate::types::{AppSettings, WorkflowLlmConfig};
use rusqlite::Connection;

pub(crate) fn normalize_model_settings(mut settings: AppSettings) -> AppSettings {
    settings.model_settings = settings.model_settings.normalized();
    settings
}

pub(crate) fn selected_workflow_llm(settings: &AppSettings) -> Result<WorkflowLlmConfig, String> {
    settings.model_settings.selected_workflow_llm()
}

pub fn read_settings(conn: &Connection) -> Result<AppSettings, String> {
    let mut stmt = conn
        .prepare("SELECT value FROM settings WHERE key = ?1")
        .map_err(|e| e.to_string())?;

    let result: Result<String, _> = stmt.query_row(["app_settings"], |row| row.get(0));

    match result {
        Ok(json) => serde_json::from_str(&json)
            .map(normalize_model_settings)
            .map_err(|e| e.to_string()),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(AppSettings::default()),
        Err(e) => Err(e.to_string()),
    }
}

pub fn write_settings(conn: &Connection, settings: &AppSettings) -> Result<(), String> {
    let normalized = normalize_model_settings(settings.clone());
    let json = serde_json::to_string(&normalized).map_err(|e| e.to_string())?;
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
    use crate::types::{ModelSettings, SecretString};

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
        assert!(
            result.is_ok(),
            "read_settings should return Ok for an empty DB"
        );
        let settings = result.unwrap();
        // Defaults: no workspace path set.
        assert!(settings.workspace_path.is_none());
        assert!(settings.model_settings.model.is_none());
    }

    #[test]
    fn test_write_then_read_settings_round_trip() {
        let conn = create_test_db_for_tests();

        let original = make_settings(Some("/home/user/workspace"), Some("/home/user/skills"));
        write_settings(&conn, &original).unwrap();

        let read_back = read_settings(&conn).unwrap();
        assert_eq!(
            read_back.workspace_path.as_deref(),
            Some("/home/user/workspace")
        );
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
        assert_eq!(
            read_back.workspace_path.as_deref(),
            Some("/second/workspace")
        );
        assert_eq!(read_back.skills_path.as_deref(), Some("/second/skills"));

        // The settings table must have exactly one row — INSERT OR REPLACE must not duplicate.
        let row_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM settings WHERE key = 'app_settings'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            row_count, 1,
            "INSERT OR REPLACE must not create duplicate rows"
        );
    }

    #[test]
    fn test_write_settings_partial_update_preserves_other_fields() {
        let conn = create_test_db_for_tests();

        // Write settings with a skills path set.
        let initial = make_settings(Some("/ws"), None);
        write_settings(&conn, &initial).unwrap();

        // Overwrite with settings that set a skills path.
        let update = make_settings(Some("/ws"), Some("/skills"));
        write_settings(&conn, &update).unwrap();

        let read_back = read_settings(&conn).unwrap();
        assert_eq!(read_back.skills_path.as_deref(), Some("/skills"));

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
    fn selected_workflow_llm_accepts_canonical_model_settings() {
        let settings = AppSettings {
            skills_path: Some("/tmp/skills".to_string()),
            model_settings: ModelSettings {
                provider: Some("anthropic".to_string()),
                model: Some("claude-sonnet-4-5".to_string()),
                api_key: Some(SecretString::new("sk-test".to_string())),
                base_url: Some("https://models.example.com/v1".to_string()),
                timeout_seconds: Some(300),
                num_retries: Some(5),
                reasoning_effort: Some("high".to_string()),
                ..ModelSettings::default()
            },
            ..AppSettings::default()
        };

        let llm = selected_workflow_llm(&settings).unwrap();
        assert_eq!(llm.model, "claude-sonnet-4-5");
        assert_eq!(llm.api_key.as_ref().unwrap().expose(), "sk-test");
        assert_eq!(
            llm.base_url.as_deref(),
            Some("https://models.example.com/v1")
        );
        assert_eq!(llm.timeout_seconds, Some(300));
        assert_eq!(llm.num_retries, Some(5));
        assert_eq!(llm.reasoning_effort.as_deref(), Some("high"));
        assert_eq!(llm.usage_id.as_deref(), Some("workflow"));
    }

    #[test]
    fn selected_workflow_llm_uses_backend_owned_usage_id() {
        let settings = AppSettings {
            model_settings: ModelSettings {
                provider: Some("ollama".to_string()),
                model: Some("ollama/llama3.1".to_string()),
                base_url: Some("http://localhost:11434".to_string()),
                usage_id: Some("user-entered".to_string()),
                ..ModelSettings::default()
            },
            ..AppSettings::default()
        };

        let llm = selected_workflow_llm(&settings).unwrap();
        assert_eq!(llm.usage_id.as_deref(), Some("workflow"));
    }

    #[test]
    fn selected_workflow_llm_rejects_cloud_model_without_api_key() {
        let settings = AppSettings {
            model_settings: ModelSettings {
                provider: Some("anthropic".to_string()),
                model: Some("claude-sonnet-4-5".to_string()),
                ..ModelSettings::default()
            },
            ..AppSettings::default()
        };

        let err = selected_workflow_llm(&settings).unwrap_err();
        assert!(err.contains("Add an API key"), "{err}");
    }

    #[test]
    fn selected_workflow_llm_allows_local_base_url_without_api_key() {
        let settings = AppSettings {
            model_settings: ModelSettings {
                provider: Some("openai".to_string()),
                model: Some("local/model".to_string()),
                base_url: Some("http://localhost:11434/v1".to_string()),
                reasoning_effort: Some("auto".to_string()),
                ..ModelSettings::default()
            },
            ..AppSettings::default()
        };

        let llm = selected_workflow_llm(&settings).unwrap();
        assert_eq!(llm.model, "local/model");
        assert!(llm.api_key.is_none());
        assert!(llm.reasoning_effort.is_none());
    }

    #[test]
    fn selected_workflow_llm_rejects_invalid_model_settings() {
        let settings = AppSettings {
            model_settings: ModelSettings {
                provider: Some("anthropic".to_string()),
                model: Some("claude-sonnet-4-5".to_string()),
                api_key: Some(SecretString::new("sk-test".to_string())),
                base_url: Some("ftp://models.example.com".to_string()),
                temperature: Some(4.0),
                reasoning_effort: Some("maximum".to_string()),
                ..ModelSettings::default()
            },
            ..AppSettings::default()
        };

        let err = selected_workflow_llm(&settings).unwrap_err();
        assert!(err.contains("Base URL"), "{err}");
    }
}
