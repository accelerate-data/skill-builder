use crate::types::{
    AppSettings, MarketplaceRegistry, ModelSettings, ProviderOverride, WorkflowLlmConfig,
};
use rusqlite::{Connection, OptionalExtension};

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
    let url: Option<String> = stmt.query_row([provider_id], |row| row.get(0)).ok();
    url
}

fn read_provider_overrides(
    conn: &Connection,
) -> Result<std::collections::BTreeMap<String, ProviderOverride>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT provider_id,
                    api_key,
                    base_url_override,
                    api_version,
                    temperature,
                    max_output_tokens,
                    timeout_seconds,
                    num_retries,
                    reasoning_effort,
                    extra_headers_json,
                    input_cost_per_token,
                    output_cost_per_token,
                    usage_id
             FROM model_provider_overrides
             ORDER BY provider_id",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            let provider_id: String = row.get(0)?;
            let api_key: Option<String> = row.get(1)?;
            let extra_headers_json: Option<String> = row.get(9)?;
            let extra_headers = extra_headers_json
                .map(|json| serde_json::from_str(&json))
                .transpose()
                .map_err(|err| {
                    rusqlite::Error::FromSqlConversionFailure(
                        9,
                        rusqlite::types::Type::Text,
                        Box::new(err),
                    )
                })?;

            Ok((
                provider_id,
                ProviderOverride {
                    api_key: api_key.map(crate::types::SecretString::new),
                    base_url_override: row.get(2)?,
                    api_version: row.get(3)?,
                    temperature: row.get(4)?,
                    max_output_tokens: row.get(5)?,
                    timeout_seconds: row.get(6)?,
                    num_retries: row.get(7)?,
                    reasoning_effort: row.get(8)?,
                    extra_headers,
                    input_cost_per_token: row.get(10)?,
                    output_cost_per_token: row.get(11)?,
                    usage_id: row.get(12)?,
                },
            ))
        })
        .map_err(|e| e.to_string())?;

    rows.collect::<Result<std::collections::BTreeMap<_, _>, _>>()
        .map_err(|e| e.to_string())
}

fn read_marketplace_registries(conn: &Connection) -> Result<Vec<MarketplaceRegistry>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT name, source_url, enabled
             FROM marketplace_registries
             ORDER BY sort_order",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(MarketplaceRegistry {
                name: row.get(0)?,
                source_url: row.get(1)?,
                enabled: row.get::<_, i64>(2)? != 0,
            })
        })
        .map_err(|e| e.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

pub fn read_settings(conn: &Connection) -> Result<AppSettings, String> {
    let mut settings = conn
        .query_row(
            "SELECT selected_provider_id,
                    selected_model_id,
                    skills_path,
                    debug_mode,
                    log_level,
                    extended_context,
                    refine_prompt_suggestions,
                    splash_shown,
                    github_oauth_token,
                    github_user_login,
                    github_user_avatar,
                    github_user_email,
                    marketplace_url,
                    marketplace_initialized,
                    legacy_tags_migrated,
                    max_dimensions,
                    industry,
                    function_role,
                    dashboard_view_mode,
                    auto_update
             FROM app_settings
             WHERE id = 1",
            [],
            |row| {
                Ok(AppSettings {
                    model_settings: ModelSettings {
                        provider_id: row.get(0)?,
                        model_id: row.get(1)?,
                        provider_overrides: std::collections::BTreeMap::new(),
                    },
                    skills_path: row.get(2)?,
                    debug_mode: row.get::<_, i64>(3)? != 0,
                    log_level: row.get(4)?,
                    extended_context: row.get::<_, i64>(5)? != 0,
                    refine_prompt_suggestions: row.get::<_, i64>(6)? != 0,
                    splash_shown: row.get::<_, i64>(7)? != 0,
                    github_oauth_token: row.get(8)?,
                    github_user_login: row.get(9)?,
                    github_user_avatar: row.get(10)?,
                    github_user_email: row.get(11)?,
                    marketplace_url: row.get(12)?,
                    marketplace_registries: vec![],
                    marketplace_initialized: row.get::<_, i64>(13)? != 0,
                    legacy_tags_migrated: row.get::<_, i64>(14)? != 0,
                    max_dimensions: row.get(15)?,
                    industry: row.get(16)?,
                    function_role: row.get(17)?,
                    dashboard_view_mode: row.get(18)?,
                    auto_update: row.get::<_, i64>(19)? != 0,
                })
            },
        )
        .optional()
        .map_err(|e| e.to_string())?
        .unwrap_or_default();

    settings.model_settings.provider_overrides = read_provider_overrides(conn)?;
    settings.marketplace_registries = read_marketplace_registries(conn)?;
    Ok(normalize_model_settings(settings))
}

fn upsert_app_settings(conn: &Connection, settings: &AppSettings) -> Result<(), String> {
    conn.execute(
        "INSERT INTO app_settings (
            id,
            selected_provider_id,
            selected_model_id,
            skills_path,
            debug_mode,
            log_level,
            extended_context,
            refine_prompt_suggestions,
            splash_shown,
            github_oauth_token,
            github_user_login,
            github_user_avatar,
            github_user_email,
            marketplace_url,
            marketplace_initialized,
            legacy_tags_migrated,
            max_dimensions,
            industry,
            function_role,
            dashboard_view_mode,
            auto_update
        ) VALUES (
            1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20
        )
        ON CONFLICT(id) DO UPDATE SET
            selected_provider_id = excluded.selected_provider_id,
            selected_model_id = excluded.selected_model_id,
            skills_path = excluded.skills_path,
            debug_mode = excluded.debug_mode,
            log_level = excluded.log_level,
            extended_context = excluded.extended_context,
            refine_prompt_suggestions = excluded.refine_prompt_suggestions,
            splash_shown = excluded.splash_shown,
            github_oauth_token = excluded.github_oauth_token,
            github_user_login = excluded.github_user_login,
            github_user_avatar = excluded.github_user_avatar,
            github_user_email = excluded.github_user_email,
            marketplace_url = excluded.marketplace_url,
            marketplace_initialized = excluded.marketplace_initialized,
            legacy_tags_migrated = excluded.legacy_tags_migrated,
            max_dimensions = excluded.max_dimensions,
            industry = excluded.industry,
            function_role = excluded.function_role,
            dashboard_view_mode = excluded.dashboard_view_mode,
            auto_update = excluded.auto_update",
        rusqlite::params![
            settings.model_settings.provider_id,
            settings.model_settings.model_id,
            settings.skills_path,
            settings.debug_mode as i64,
            settings.log_level,
            settings.extended_context as i64,
            settings.refine_prompt_suggestions as i64,
            settings.splash_shown as i64,
            settings.github_oauth_token,
            settings.github_user_login,
            settings.github_user_avatar,
            settings.github_user_email,
            settings.marketplace_url,
            settings.marketplace_initialized as i64,
            settings.legacy_tags_migrated as i64,
            settings.max_dimensions,
            settings.industry,
            settings.function_role,
            settings.dashboard_view_mode,
            settings.auto_update as i64,
        ],
    )
    .map(|_| ())
    .map_err(|e| e.to_string())
}

fn replace_provider_overrides(conn: &Connection, settings: &AppSettings) -> Result<(), String> {
    conn.execute("DELETE FROM model_provider_overrides", [])
        .map_err(|e| e.to_string())?;

    for (provider_id, override_cfg) in &settings.model_settings.provider_overrides {
        let extra_headers_json = override_cfg
            .extra_headers
            .as_ref()
            .map(serde_json::to_string)
            .transpose()
            .map_err(|e| e.to_string())?;

        conn.execute(
            "INSERT INTO model_provider_overrides (
                provider_id,
                api_key,
                base_url_override,
                api_version,
                temperature,
                max_output_tokens,
                timeout_seconds,
                num_retries,
                reasoning_effort,
                extra_headers_json,
                input_cost_per_token,
                output_cost_per_token,
                usage_id
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            rusqlite::params![
                provider_id,
                override_cfg
                    .api_key
                    .as_ref()
                    .map(|key| key.expose().to_string()),
                override_cfg.base_url_override,
                override_cfg.api_version,
                override_cfg.temperature,
                override_cfg.max_output_tokens,
                override_cfg.timeout_seconds,
                override_cfg.num_retries,
                override_cfg.reasoning_effort,
                extra_headers_json,
                override_cfg.input_cost_per_token,
                override_cfg.output_cost_per_token,
                override_cfg.usage_id,
            ],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(())
}

fn replace_marketplace_registries(conn: &Connection, settings: &AppSettings) -> Result<(), String> {
    conn.execute("DELETE FROM marketplace_registries", [])
        .map_err(|e| e.to_string())?;

    for (index, registry) in settings.marketplace_registries.iter().enumerate() {
        conn.execute(
            "INSERT INTO marketplace_registries (sort_order, name, source_url, enabled)
             VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![
                index as i64,
                registry.name,
                registry.source_url,
                registry.enabled as i64,
            ],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(())
}

pub fn write_settings(conn: &Connection, settings: &AppSettings) -> Result<(), String> {
    let normalized = normalize_model_settings(settings.clone());

    conn.execute_batch("BEGIN IMMEDIATE")
        .map_err(|e| e.to_string())?;

    let result = (|| {
        upsert_app_settings(conn, &normalized)?;
        replace_provider_overrides(conn, &normalized)?;
        replace_marketplace_registries(conn, &normalized)?;
        Ok(())
    })();

    match result {
        Ok(()) => conn.execute_batch("COMMIT").map_err(|e| e.to_string()),
        Err(err) => {
            let _ = conn.execute_batch("ROLLBACK");
            Err(err)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::create_test_db_for_tests;
    use crate::types::{ProviderOverride, SecretString};

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

    fn make_settings(skills_path: Option<&str>) -> AppSettings {
        AppSettings {
            skills_path: skills_path.map(String::from),
            ..AppSettings::default()
        }
    }

    fn app_settings_row_count(conn: &Connection) -> i64 {
        conn.query_row("SELECT COUNT(*) FROM app_settings", [], |row| row.get(0))
            .unwrap()
    }

    #[test]
    fn test_read_settings_returns_default_when_no_row() {
        let conn = create_test_db_for_tests();
        let result = read_settings(&conn);
        assert!(
            result.is_ok(),
            "read_settings should return Ok for an empty DB"
        );
        let settings = result.unwrap();
        assert!(settings.skills_path.is_none());
        assert!(settings.model_settings.model_id.is_none());
    }

    #[test]
    fn test_write_then_read_settings_round_trip() {
        let conn = create_test_db_for_tests();

        let original = make_settings(Some("/home/user/skills"));
        write_settings(&conn, &original).unwrap();

        let read_back = read_settings(&conn).unwrap();
        assert_eq!(read_back.skills_path.as_deref(), Some("/home/user/skills"));
    }

    #[test]
    fn test_write_settings_update_does_not_corrupt_data() {
        let conn = create_test_db_for_tests();

        let first = make_settings(Some("/first/skills"));
        write_settings(&conn, &first).unwrap();

        let second = make_settings(Some("/second/skills"));
        write_settings(&conn, &second).unwrap();

        let read_back = read_settings(&conn).unwrap();
        assert_eq!(read_back.skills_path.as_deref(), Some("/second/skills"));
        assert_eq!(app_settings_row_count(&conn), 1);
    }

    #[test]
    fn test_write_settings_partial_update_preserves_other_fields() {
        let conn = create_test_db_for_tests();

        let initial = make_settings(None);
        write_settings(&conn, &initial).unwrap();

        let update = make_settings(Some("/skills"));
        write_settings(&conn, &update).unwrap();

        let read_back = read_settings(&conn).unwrap();
        assert_eq!(read_back.skills_path.as_deref(), Some("/skills"));
        assert_eq!(app_settings_row_count(&conn), 1);
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
        assert_eq!(
            read_back.model_settings.provider_id.as_deref(),
            Some("anthropic")
        );
        assert!(read_back
            .model_settings
            .provider_overrides
            .contains_key("anthropic"));
        assert!(read_back
            .model_settings
            .provider_overrides
            .contains_key("openai"));

        let ant_override = &read_back.model_settings.provider_overrides["anthropic"];
        assert_eq!(ant_override.api_key.as_ref().unwrap().expose(), "sk-ant");
        assert_eq!(
            ant_override.base_url_override.as_deref(),
            Some("https://anthropic.example.com")
        );

        let openai_override = &read_back.model_settings.provider_overrides["openai"];
        assert_eq!(
            openai_override.api_key.as_ref().unwrap().expose(),
            "sk-openai"
        );
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
        assert_eq!(
            read_back.model_settings.provider_id.as_deref(),
            Some("openai")
        );
        assert_eq!(read_back.model_settings.model_id.as_deref(), Some("gpt-4o"));
        assert!(read_back
            .model_settings
            .provider_overrides
            .contains_key("anthropic"));
        assert!(read_back
            .model_settings
            .provider_overrides
            .contains_key("openai"));
    }

    #[test]
    fn resolve_effective_base_url_override_wins_over_catalog() {
        let conn = create_test_db_for_tests();
        conn.execute(
            "INSERT INTO provider_catalog (provider_id, name, npm, api_base_url, doc_url)
             VALUES ('anthropic', 'Anthropic', '@anthropic/sdk', 'https://api.anthropic.com', 'https://docs.anthropic.com')",
            [],
        )
        .unwrap();

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
        )
        .unwrap();

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
