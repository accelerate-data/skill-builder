mod github;
mod model_catalog;
mod refine;
mod secret;
mod session;
mod settings;
mod skill;
mod startup;
mod usage;
mod workflow;

// Re-export all types at the crate::types level so callers don't need to change.
pub use github::*;
pub use model_catalog::*;
pub use refine::*;
pub use secret::*;
pub use session::*;
pub use settings::*;
pub use skill::*;
pub use startup::*;
pub use usage::*;
pub use workflow::*;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_app_settings_default() {
        let settings = AppSettings::default();
        assert!(settings.workspace_path.is_none());
        assert!(settings.skills_path.is_none());
        assert_eq!(settings.log_level, "info");
        assert!(!settings.extended_context);
        assert!(!settings.splash_shown);
        assert!(settings.github_oauth_token.is_none());
        assert!(settings.github_user_login.is_none());
        assert!(settings.github_user_avatar.is_none());
        assert!(settings.github_user_email.is_none());
        assert!(settings.marketplace_url.is_none());
        assert!(settings.marketplace_registries.is_empty());
        assert!(!settings.marketplace_initialized);
        assert!(settings.industry.is_none());
        assert!(settings.function_role.is_none());
        assert!(settings.dashboard_view_mode.is_none());
    }

    #[test]
    fn test_app_settings_serde_roundtrip() {
        let settings = AppSettings {
            workspace_path: Some("/home/user/skills".to_string()),
            skills_path: Some("/home/user/output".to_string()),
            github_oauth_token: Some("test-github-token".to_string()),
            github_user_login: Some("testuser".to_string()),
            github_user_avatar: Some("https://avatars.githubusercontent.com/u/12345".to_string()),
            github_user_email: Some("test@example.com".to_string()),
            marketplace_url: Some("https://github.com/my-org/skills".to_string()),
            marketplace_registries: vec![MarketplaceRegistry {
                name: "Test".to_string(),
                source_url: "https://github.com/owner/repo".to_string(),
                enabled: true,
            }],
            industry: Some("Financial Services".to_string()),
            function_role: Some("Analytics Engineer".to_string()),
            dashboard_view_mode: Some("grid".to_string()),
            ..AppSettings::default()
        };
        let json = serde_json::to_string(&settings).unwrap();
        let deserialized: AppSettings = serde_json::from_str(&json).unwrap();
        assert_eq!(
            deserialized.workspace_path.as_deref(),
            Some("/home/user/skills")
        );
        assert_eq!(
            deserialized.skills_path.as_deref(),
            Some("/home/user/output")
        );
        assert_eq!(
            deserialized.marketplace_url.as_deref(),
            Some("https://github.com/my-org/skills")
        );
        assert_eq!(deserialized.marketplace_registries.len(), 1);
        assert_eq!(deserialized.marketplace_registries[0].name, "Test");
        assert_eq!(
            deserialized.marketplace_registries[0].source_url,
            "https://github.com/owner/repo"
        );
        assert!(deserialized.marketplace_registries[0].enabled);
        assert!(!deserialized.marketplace_initialized);
        assert_eq!(deserialized.industry.as_deref(), Some("Financial Services"));
        assert_eq!(
            deserialized.function_role.as_deref(),
            Some("Analytics Engineer")
        );
    }

    #[test]
    fn test_app_settings_deserialize_without_optional_fields() {
        // Simulates loading settings saved before new fields existed.
        // Legacy fields (anthropic_api_key, preferred_model, extended_thinking, etc.)
        // in old JSON blobs are silently dropped by serde on read.
        let json = r#"{"anthropic_api_key":"sk-test","workspace_path":"/w","preferred_model":"sonnet","extended_context":false,"splash_shown":false}"#;
        let settings: AppSettings = serde_json::from_str(json).unwrap();
        assert!(settings.skills_path.is_none());
        assert_eq!(settings.log_level, "info");
        assert!(settings.github_oauth_token.is_none());
        assert!(settings.github_user_login.is_none());
        assert!(settings.github_user_avatar.is_none());
        assert!(settings.github_user_email.is_none());
        assert!(settings.marketplace_url.is_none());
        assert!(settings.marketplace_registries.is_empty());
        assert!(!settings.marketplace_initialized);

        // Simulates loading settings that still have the old verbose_logging boolean field
        let json_old = r#"{"workspace_path":"/w","verbose_logging":true,"extended_context":false,"splash_shown":false}"#;
        let settings_old: AppSettings = serde_json::from_str(json_old).unwrap();
        // Old verbose_logging is ignored; log_level defaults to "info"
        assert_eq!(settings_old.log_level, "info");
    }

    #[test]
    fn test_runtime_config_serde() {
        let config = crate::agents::runtime_config::OpenHandsRuntimeConfig {
            mode: None,
            prompt: "test prompt".to_string(),
            system_prompt: None,
            model: Some("sonnet".to_string()),
            llm: None,
            model_base_url: None,
            openhands_api_key: SecretString::new("sk-test".to_string()),
            app_data_root: "/tmp/app-data".to_string(),
            skills_root: "/tmp".to_string(),
            skill_dir: "/tmp".to_string(),
            allowed_tools: Some(vec!["Read".to_string(), "Write".to_string()]),
            max_turns: Some(10),
            permission_mode: Some("bypassPermissions".to_string()),
            betas: None,
            thinking: None,
            output_format: None,
            prompt_suggestions: None,
            agent_name: Some("research-entities".to_string()),
            required_plugins: None,
            setting_sources: None,
            conversation_history: None,
            skill_name: None,
            step_id: None,
            usage_session_id: None,
            run_source: None,
            plugin_slug: "skills".to_string(),
            persistence_dir: None,
            task_kind: None,
            user_message_suffix: None,
            system_message_suffix: None,
        };
        let json = serde_json::to_string(&config).unwrap();
        assert!(json.contains("\"openhandsApiKey\""));
        assert!(json.contains("\"allowedTools\""));
        assert!(json.contains("\"maxTurns\""));
        assert!(json.contains("\"permissionMode\""));
        assert!(json.contains("\"agentName\""));
        assert!(json.contains("\"model\""));
        // betas is None with skip_serializing_if, so should not appear
        assert!(!json.contains("\"betas\""));
        // thinking is None with skip_serializing_if, so should not appear
        assert!(!json.contains("\"thinking\""));
    }

    #[test]
    fn test_model_catalog_types_serde_fixture() {
        use super::model_catalog::CatalogProvider;
        use std::collections::BTreeMap;

        let fixture = include_str!("../fixtures/model-catalog.json");

        let providers: BTreeMap<String, CatalogProvider> = serde_json::from_str(fixture).unwrap();
        assert_eq!(providers.len(), 2);

        // Provider with api
        let anthropic = providers.get("anthropic").unwrap();
        assert_eq!(anthropic.id, "anthropic");
        assert_eq!(anthropic.api, Some("https://api.anthropic.com".to_string()));
        assert_eq!(anthropic.models.len(), 1);

        let sonnet = anthropic.models.get("claude-sonnet-4-6").unwrap();
        assert!(sonnet.attachment);
        assert!(!sonnet.reasoning);
        assert!(sonnet.tool_call);
        assert_eq!(sonnet.structured_output, Some(true));
        assert_eq!(sonnet.modalities.input, vec!["text", "image"]);
        assert_eq!(sonnet.modalities.output, vec!["text"]);
        assert!(sonnet.cost.is_some());
        assert_eq!(sonnet.cost.as_ref().unwrap().input, Some(0.000003));
        assert_eq!(sonnet.limit.context, Some(200000));

        // Provider without api
        let ollama = providers.get("ollama").unwrap();
        assert_eq!(ollama.id, "ollama");
        assert!(ollama.api.is_none());

        let llama = ollama.models.get("llama3").unwrap();
        assert!(llama.open_weights);
        assert!(llama.cost.is_none());
        assert_eq!(llama.structured_output, None);
        assert!(llama.interleaved.is_some());
        assert_eq!(llama.status, Some("active".to_string()));
        assert_eq!(llama.experimental, Some(serde_json::Value::Bool(false)));
    }
}
