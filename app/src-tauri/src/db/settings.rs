use crate::types::{AppSettings, WorkflowLlmConfig};
use rusqlite::Connection;

fn trimmed_opt(value: Option<String>) -> Option<String> {
    value.and_then(|v| {
        let trimmed = v.trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    })
}

fn provider_prefix(provider: &str) -> &str {
    match provider {
        "google" => "gemini",
        other => other,
    }
}

#[allow(dead_code)]
fn provider_label(provider: &str) -> &str {
    match provider {
        "anthropic" => "Anthropic",
        "openai" => "OpenAI",
        "google" => "Google",
        "ollama" => "Ollama",
        _ => "OpenHands provider",
    }
}

pub(crate) fn provider_model(provider: &str, model: &str) -> String {
    let model = model.trim();
    if model.contains('/') {
        model.to_string()
    } else {
        format!("{}/{}", provider_prefix(provider), model)
    }
}

pub(crate) fn normalize_openhands_settings(mut settings: AppSettings) -> AppSettings {
    settings = normalize_model_settings(settings);
    settings.openhands_provider =
        trimmed_opt(settings.openhands_provider).or_else(|| Some("anthropic".to_string()));
    settings.openhands_api_key = trimmed_opt(settings.openhands_api_key);
    settings.openhands_model = trimmed_opt(settings.openhands_model).or_else(|| {
        settings
            .preferred_model
            .as_deref()
            .map(str::trim)
            .filter(|model| !model.is_empty())
            .map(|model| provider_model("anthropic", model))
    });
    settings.openhands_base_url = trimmed_opt(settings.openhands_base_url);
    settings
}

pub(crate) fn normalize_model_settings(mut settings: AppSettings) -> AppSettings {
    settings.model_settings = settings.model_settings.normalized();
    settings
}

pub(crate) fn selected_workflow_llm(settings: &AppSettings) -> Result<WorkflowLlmConfig, String> {
    settings.model_settings.selected_workflow_llm()
}

#[allow(dead_code)]
pub(crate) fn selected_openhands_runtime(
    settings: &AppSettings,
) -> Result<(String, crate::types::SecretString, Option<String>), String> {
    let provider = settings
        .openhands_provider
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("anthropic");
    let model = settings
        .openhands_model
        .as_deref()
        .or(settings.preferred_model.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            "Model not configured. Select an OpenHands/LiteLLM model in Settings before running workflow steps."
                .to_string()
        })?;
    let api_key = settings
        .openhands_api_key
        .as_deref()
        .or_else(|| {
            if provider == "anthropic" {
                settings.anthropic_api_key.as_deref()
            } else {
                None
            }
        })
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if provider != "ollama" && api_key.is_none() {
        return Err(format!(
            "{} API key not configured. Set the OpenHands {} API key in Settings.",
            provider_label(provider),
            provider_label(provider)
        ));
    }
    // SidecarConfig still carries a non-empty apiKey transport field; Ollama
    // ignores the placeholder and the user does not need to configure a key.
    let runtime_api_key = api_key.unwrap_or(if provider == "ollama" { "ollama" } else { "" });
    Ok((
        provider_model(provider, model),
        crate::types::SecretString::new(runtime_api_key.to_string()),
        settings.openhands_base_url.clone(),
    ))
}

pub fn read_settings(conn: &Connection) -> Result<AppSettings, String> {
    let mut stmt = conn
        .prepare("SELECT value FROM settings WHERE key = ?1")
        .map_err(|e| e.to_string())?;

    let result: Result<String, _> = stmt.query_row(["app_settings"], |row| row.get(0));

    match result {
        Ok(json) => serde_json::from_str(&json)
            .map(normalize_openhands_settings)
            .map_err(|e| e.to_string()),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(AppSettings::default()),
        Err(e) => Err(e.to_string()),
    }
}

pub fn write_settings(conn: &Connection, settings: &AppSettings) -> Result<(), String> {
    let normalized = normalize_openhands_settings(settings.clone());
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
        assert_eq!(settings.openhands_provider.as_deref(), Some("anthropic"));
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
        assert_eq!(read_back.openhands_provider.as_deref(), Some("anthropic"));
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
        assert!(
            read_back.anthropic_api_key.is_none(),
            "cleared field should be None after update"
        );

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
    fn test_legacy_preferred_model_normalizes_to_openhands_model_for_non_workflow_paths() {
        let conn = create_test_db_for_tests();
        let mut legacy = make_settings(Some("/ws"), Some("/skills"));
        legacy.anthropic_api_key = Some("sk-legacy".to_string());
        legacy.preferred_model = Some("claude-sonnet-4-6".to_string());
        legacy.openhands_provider = None;
        legacy.openhands_model = None;
        write_settings(&conn, &legacy).unwrap();

        let read_back = read_settings(&conn).unwrap();
        assert_eq!(read_back.openhands_provider.as_deref(), Some("anthropic"));
        assert_eq!(
            read_back.openhands_model.as_deref(),
            Some("anthropic/claude-sonnet-4-6")
        );
    }

    #[test]
    fn selected_workflow_llm_ignores_legacy_fields() {
        let settings = AppSettings {
            anthropic_api_key: Some("sk-legacy".to_string()),
            preferred_model: Some("claude-sonnet-4-6".to_string()),
            openhands_provider: Some("anthropic".to_string()),
            openhands_api_key: Some("sk-openhands".to_string()),
            openhands_model: Some("anthropic/claude-sonnet-4-6".to_string()),
            openhands_base_url: Some("https://legacy.example.com".to_string()),
            extended_thinking: true,
            interleaved_thinking_beta: true,
            sdk_effort: Some("high".to_string()),
            fallback_model: Some("claude-fallback".to_string()),
            skills_path: Some("/tmp/skills".to_string()),
            ..AppSettings::default()
        };

        let err = selected_workflow_llm(&settings).unwrap_err();
        assert!(err.contains("Select a model in Settings"), "{err}");
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
    }
}
