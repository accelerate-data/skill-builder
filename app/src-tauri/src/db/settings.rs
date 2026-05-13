use crate::types::{AppSettings, WorkflowLlmConfig};
use rusqlite::Connection;

pub(crate) fn normalize_model_settings(mut settings: AppSettings) -> AppSettings {
    settings.model_settings = settings.model_settings.normalized();
    settings
}

fn runtime_provider_prefix(conn: &Connection, provider_id: &str) -> String {
    let npm: Option<String> = conn
        .prepare("SELECT npm FROM provider_catalog WHERE provider_id = ?1")
        .ok()
        .and_then(|mut stmt| stmt.query_row([provider_id], |row| row.get(0)).ok());

    match npm.as_deref() {
        Some("@ai-sdk/openai-compatible" | "@ai-sdk/openai") => "openai".to_string(),
        Some("@ai-sdk/anthropic") => "anthropic".to_string(),
        _ => provider_id.to_string(),
    }
}

fn normalize_runtime_model_id(conn: &Connection, settings: &AppSettings) -> Option<String> {
    let provider_id = settings.model_settings.provider_id.as_deref()?.trim();
    let model_id = settings.model_settings.model_id.as_deref()?.trim();
    if provider_id.is_empty() || model_id.is_empty() || model_id.contains('/') {
        return Some(model_id.to_string());
    }

    let stripped = model_id
        .strip_prefix(&format!("{provider_id}:"))
        .unwrap_or(model_id);
    let runtime_prefix = runtime_provider_prefix(conn, provider_id);
    Some(format!("{runtime_prefix}/{stripped}"))
}

pub(crate) fn selected_workflow_llm(
    conn: &Connection,
    settings: &AppSettings,
) -> Result<WorkflowLlmConfig, String> {
    let mut llm = settings.model_settings.selected_workflow_llm()?;
    if let Some(model) = normalize_runtime_model_id(conn, settings) {
        llm.model = model;
    }
    Ok(llm)
}

/// Resolve the effective base URL for runtime config.
///
/// Priority: user override > provider catalog default > None.
pub(crate) fn resolve_effective_base_url(
    conn: &Connection,
    llm: &WorkflowLlmConfig,
    settings: &AppSettings,
) -> Option<String> {
    if llm.base_url.is_some() {
        return llm.base_url.clone();
    }

    let provider_id = settings.model_settings.provider_id.as_ref()?;
    let mut stmt = conn
        .prepare("SELECT api_base_url FROM provider_catalog WHERE provider_id = ?1")
        .ok()?;
    let url: Option<String> = stmt
        .query_row([provider_id], |row| row.get(0))
        .ok();
    url
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
    use crate::types::{ModelSettings, ProviderOverride, SecretString};

    fn insert_provider_catalog(
        conn: &Connection,
        provider_id: &str,
        npm: &str,
        api_base_url: Option<&str>,
    ) {
        conn.execute(
            "INSERT INTO provider_catalog (provider_id, name, npm, api_base_url, doc_url)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![
                provider_id,
                provider_id,
                npm,
                api_base_url,
                format!("https://docs.example.com/{provider_id}")
            ],
        )
        .unwrap();
    }

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
        assert!(settings.model_settings.model_id.is_none());
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
    fn selected_workflow_llm_derives_provider_qualified_runtime_model() {
        let conn = create_test_db_for_tests();
        insert_provider_catalog(
            &conn,
            "anthropic",
            "@ai-sdk/anthropic",
            Some("https://models.example.com/v1"),
        );
        let mut overrides = std::collections::BTreeMap::new();
        overrides.insert(
            "anthropic".to_string(),
            ProviderOverride {
                api_key: Some(SecretString::new("sk-test".to_string())),
                base_url_override: Some("https://models.example.com/v1".to_string()),
                timeout_seconds: Some(300),
                num_retries: Some(5),
                reasoning_effort: Some("high".to_string()),
                ..ProviderOverride::default()
            },
        );
        let settings = AppSettings {
            skills_path: Some("/tmp/skills".to_string()),
            model_settings: ModelSettings {
                provider_id: Some("anthropic".to_string()),
                model_id: Some("claude-sonnet-4-5".to_string()),
                provider_overrides: overrides,
            },
            ..AppSettings::default()
        };

        let llm = selected_workflow_llm(&conn, &settings).unwrap();
        assert_eq!(llm.model, "anthropic/claude-sonnet-4-5");
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
        let conn = create_test_db_for_tests();
        let mut overrides = std::collections::BTreeMap::new();
        overrides.insert(
            "ollama".to_string(),
            ProviderOverride {
                base_url_override: Some("http://localhost:11434".to_string()),
                usage_id: Some("user-entered".to_string()),
                ..ProviderOverride::default()
            },
        );
        let settings = AppSettings {
            model_settings: ModelSettings {
                provider_id: Some("ollama".to_string()),
                model_id: Some("ollama/llama3.1".to_string()),
                provider_overrides: overrides,
            },
            ..AppSettings::default()
        };

        let llm = selected_workflow_llm(&conn, &settings).unwrap();
        assert_eq!(llm.usage_id.as_deref(), Some("workflow"));
    }

    #[test]
    fn selected_workflow_llm_strips_legacy_catalog_full_id_prefix() {
        let conn = create_test_db_for_tests();
        insert_provider_catalog(
            &conn,
            "opencode-go",
            "@ai-sdk/openai-compatible",
            Some("https://opencode.ai/zen/go/v1"),
        );
        let mut overrides = std::collections::BTreeMap::new();
        overrides.insert(
            "opencode-go".to_string(),
            ProviderOverride {
                api_key: Some(SecretString::new("sk-test".to_string())),
                base_url_override: Some("https://opencode.ai/zen/go/v1".to_string()),
                ..ProviderOverride::default()
            },
        );
        let settings = AppSettings {
            model_settings: ModelSettings {
                provider_id: Some("opencode-go".to_string()),
                model_id: Some("opencode-go:deepseek-v4-flash".to_string()),
                provider_overrides: overrides,
            },
            ..AppSettings::default()
        };

        let llm = selected_workflow_llm(&conn, &settings).unwrap();
        assert_eq!(llm.model, "openai/deepseek-v4-flash");
    }

    #[test]
    fn selected_workflow_llm_maps_openai_compatible_provider_to_openai_prefix() {
        let conn = create_test_db_for_tests();
        insert_provider_catalog(
            &conn,
            "opencode-go",
            "@ai-sdk/openai-compatible",
            Some("https://opencode.ai/zen/go/v1"),
        );
        let mut overrides = std::collections::BTreeMap::new();
        overrides.insert(
            "opencode-go".to_string(),
            ProviderOverride {
                api_key: Some(SecretString::new("sk-test".to_string())),
                base_url_override: Some("https://opencode.ai/zen/go/v1".to_string()),
                ..ProviderOverride::default()
            },
        );
        let settings = AppSettings {
            model_settings: ModelSettings {
                provider_id: Some("opencode-go".to_string()),
                model_id: Some("deepseek-v4-pro".to_string()),
                provider_overrides: overrides,
            },
            ..AppSettings::default()
        };

        let llm = selected_workflow_llm(&conn, &settings).unwrap();
        assert_eq!(llm.model, "openai/deepseek-v4-pro");
    }

    #[test]
    fn selected_workflow_llm_rejects_cloud_model_without_api_key() {
        let conn = create_test_db_for_tests();
        let settings = AppSettings {
            model_settings: ModelSettings {
                provider_id: Some("anthropic".to_string()),
                model_id: Some("claude-sonnet-4-5".to_string()),
                provider_overrides: std::collections::BTreeMap::new(),
            },
            ..AppSettings::default()
        };

        let err = selected_workflow_llm(&conn, &settings).unwrap_err();
        assert!(err.contains("Add an API key"), "{err}");
    }

    #[test]
    fn selected_workflow_llm_allows_local_base_url_without_api_key() {
        let conn = create_test_db_for_tests();
        let mut overrides = std::collections::BTreeMap::new();
        overrides.insert(
            "openai".to_string(),
            ProviderOverride {
                base_url_override: Some("http://localhost:11434/v1".to_string()),
                reasoning_effort: Some("auto".to_string()),
                ..ProviderOverride::default()
            },
        );
        let settings = AppSettings {
            model_settings: ModelSettings {
                provider_id: Some("openai".to_string()),
                model_id: Some("local/model".to_string()),
                provider_overrides: overrides,
            },
            ..AppSettings::default()
        };

        let llm = selected_workflow_llm(&conn, &settings).unwrap();
        assert_eq!(llm.model, "local/model");
        assert!(llm.api_key.is_none());
        assert!(llm.reasoning_effort.is_none());
    }

    #[test]
    fn selected_workflow_llm_rejects_invalid_model_settings() {
        let conn = create_test_db_for_tests();
        let mut overrides = std::collections::BTreeMap::new();
        overrides.insert(
            "anthropic".to_string(),
            ProviderOverride {
                api_key: Some(SecretString::new("sk-test".to_string())),
                base_url_override: Some("ftp://models.example.com".to_string()),
                temperature: Some(4.0),
                reasoning_effort: Some("maximum".to_string()),
                ..ProviderOverride::default()
            },
        );
        let settings = AppSettings {
            model_settings: ModelSettings {
                provider_id: Some("anthropic".to_string()),
                model_id: Some("claude-sonnet-4-5".to_string()),
                provider_overrides: overrides,
            },
            ..AppSettings::default()
        };

        let err = selected_workflow_llm(&conn, &settings).unwrap_err();
        assert!(err.contains("Base URL"), "{err}");
    }

    #[test]
    fn provider_specific_overrides_persist_independently() {
        let conn = create_test_db_for_tests();

        let mut overrides = std::collections::BTreeMap::new();
        overrides.insert(
            "anthropic".to_string(),
            ProviderOverride {
                api_key: Some(SecretString::new("sk-ant".to_string())),
                base_url_override: Some("https://anthropic.example.com".to_string()),
                ..ProviderOverride::default()
            },
        );
        overrides.insert(
            "openai".to_string(),
            ProviderOverride {
                api_key: Some(SecretString::new("sk-openai".to_string())),
                base_url_override: Some("https://openai.example.com".to_string()),
                ..ProviderOverride::default()
            },
        );
        let initial = AppSettings {
            model_settings: ModelSettings {
                provider_id: Some("anthropic".to_string()),
                model_id: Some("claude-sonnet-4-5".to_string()),
                provider_overrides: overrides,
            },
            ..AppSettings::default()
        };
        write_settings(&conn, &initial).unwrap();

        let read_back = read_settings(&conn).unwrap();
        assert_eq!(read_back.model_settings.provider_id.as_deref(), Some("anthropic"));
        assert!(read_back.model_settings.provider_overrides.contains_key("anthropic"));
        assert!(read_back.model_settings.provider_overrides.contains_key("openai"));

        let ant_override = &read_back.model_settings.provider_overrides["anthropic"];
        assert_eq!(ant_override.api_key.as_ref().unwrap().expose(), "sk-ant");
        assert_eq!(ant_override.base_url_override.as_deref(), Some("https://anthropic.example.com"));

        let openai_override = &read_back.model_settings.provider_overrides["openai"];
        assert_eq!(openai_override.api_key.as_ref().unwrap().expose(), "sk-openai");
    }

    #[test]
    fn switching_provider_does_not_erase_other_overrides() {
        let conn = create_test_db_for_tests();

        let mut overrides = std::collections::BTreeMap::new();
        overrides.insert(
            "anthropic".to_string(),
            ProviderOverride {
                api_key: Some(SecretString::new("sk-ant".to_string())),
                ..ProviderOverride::default()
            },
        );
        overrides.insert(
            "openai".to_string(),
            ProviderOverride {
                api_key: Some(SecretString::new("sk-openai".to_string())),
                ..ProviderOverride::default()
            },
        );
        let initial = AppSettings {
            model_settings: ModelSettings {
                provider_id: Some("anthropic".to_string()),
                model_id: Some("claude-sonnet-4-5".to_string()),
                provider_overrides: overrides,
            },
            ..AppSettings::default()
        };
        write_settings(&conn, &initial).unwrap();

        // Switch to openai, keep both overrides
        let mut overrides2 = std::collections::BTreeMap::new();
        overrides2.insert(
            "anthropic".to_string(),
            ProviderOverride {
                api_key: Some(SecretString::new("sk-ant".to_string())),
                ..ProviderOverride::default()
            },
        );
        overrides2.insert(
            "openai".to_string(),
            ProviderOverride {
                api_key: Some(SecretString::new("sk-openai".to_string())),
                ..ProviderOverride::default()
            },
        );
        let switched = AppSettings {
            model_settings: ModelSettings {
                provider_id: Some("openai".to_string()),
                model_id: Some("gpt-4o".to_string()),
                provider_overrides: overrides2,
            },
            ..AppSettings::default()
        };
        write_settings(&conn, &switched).unwrap();

        let read_back = read_settings(&conn).unwrap();
        assert_eq!(read_back.model_settings.provider_id.as_deref(), Some("openai"));
        assert_eq!(read_back.model_settings.model_id.as_deref(), Some("gpt-4o"));
        assert!(read_back.model_settings.provider_overrides.contains_key("anthropic"));
        assert!(read_back.model_settings.provider_overrides.contains_key("openai"));
    }

    #[test]
    fn resolve_effective_base_url_override_wins_over_catalog() {
        let conn = create_test_db_for_tests();
        conn.execute(
            "INSERT INTO provider_catalog (provider_id, name, npm, api_base_url, doc_url)
             VALUES ('anthropic', 'Anthropic', '@anthropic/sdk', 'https://api.anthropic.com', 'https://docs.anthropic.com')",
            [],
        ).unwrap();

        let mut overrides = std::collections::BTreeMap::new();
        overrides.insert(
            "anthropic".to_string(),
            ProviderOverride {
                api_key: Some(SecretString::new("sk-test".to_string())),
                base_url_override: Some("https://custom.example.com/v1".to_string()),
                ..ProviderOverride::default()
            },
        );
        let settings = AppSettings {
            model_settings: ModelSettings {
                provider_id: Some("anthropic".to_string()),
                model_id: Some("claude-sonnet-4-5".to_string()),
                provider_overrides: overrides,
            },
            ..AppSettings::default()
        };
        let llm = selected_workflow_llm(&conn, &settings).unwrap();

        let resolved = super::resolve_effective_base_url(&conn, &llm, &settings);
        assert_eq!(resolved.as_deref(), Some("https://custom.example.com/v1"));
    }

    #[test]
    fn resolve_effective_base_url_falls_back_to_catalog_default() {
        let conn = create_test_db_for_tests();
        conn.execute(
            "INSERT INTO provider_catalog (provider_id, name, npm, api_base_url, doc_url)
             VALUES ('anthropic', 'Anthropic', '@anthropic/sdk', 'https://api.anthropic.com', 'https://docs.anthropic.com')",
            [],
        ).unwrap();

        let mut overrides = std::collections::BTreeMap::new();
        overrides.insert(
            "anthropic".to_string(),
            ProviderOverride {
                api_key: Some(SecretString::new("sk-test".to_string())),
                ..ProviderOverride::default()
            },
        );
        let settings = AppSettings {
            model_settings: ModelSettings {
                provider_id: Some("anthropic".to_string()),
                model_id: Some("claude-sonnet-4-5".to_string()),
                provider_overrides: overrides,
            },
            ..AppSettings::default()
        };
        let llm = selected_workflow_llm(&conn, &settings).unwrap();

        let resolved = super::resolve_effective_base_url(&conn, &llm, &settings);
        assert_eq!(resolved.as_deref(), Some("https://api.anthropic.com"));
    }

    #[test]
    fn resolve_effective_base_url_returns_none_when_no_catalog_entry() {
        let conn = create_test_db_for_tests();

        let mut overrides = std::collections::BTreeMap::new();
        overrides.insert(
            "unknown".to_string(),
            ProviderOverride {
                api_key: Some(SecretString::new("sk-test".to_string())),
                ..ProviderOverride::default()
            },
        );
        let settings = AppSettings {
            model_settings: ModelSettings {
                provider_id: Some("unknown".to_string()),
                model_id: Some("some-model".to_string()),
                provider_overrides: overrides,
            },
            ..AppSettings::default()
        };
        let llm = selected_workflow_llm(&conn, &settings).unwrap();

        let resolved = super::resolve_effective_base_url(&conn, &llm, &settings);
        assert!(resolved.is_none());
    }
}
