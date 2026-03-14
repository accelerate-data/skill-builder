mod github;
mod refine;
mod settings;
mod skill;
mod startup;
mod usage;
mod workflow;

// Re-export all types at the crate::types level so callers don't need to change.
pub use github::*;
pub use refine::*;
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
        assert!(settings.anthropic_api_key.is_none());
        assert!(settings.workspace_path.is_none());
        assert!(settings.skills_path.is_none());
        assert!(settings.preferred_model.is_none());
        assert_eq!(settings.log_level, "info");
        assert!(!settings.extended_context);
        assert!(!settings.extended_thinking);
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
            anthropic_api_key: Some("sk-ant-test-key".to_string()),
            workspace_path: Some("/home/user/skills".to_string()),
            skills_path: Some("/home/user/output".to_string()),
            preferred_model: Some("sonnet".to_string()),
            debug_mode: false,
            log_level: "info".to_string(),
            extended_context: false,
            extended_thinking: true,
            interleaved_thinking_beta: true,
            sdk_effort: None,
            fallback_model: None,
            refine_prompt_suggestions: true,
            splash_shown: false,
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
            marketplace_initialized: false,
            max_dimensions: 5,
            industry: Some("Financial Services".to_string()),
            function_role: Some("Analytics Engineer".to_string()),
            dashboard_view_mode: Some("grid".to_string()),
            auto_update: false,
        };
        let json = serde_json::to_string(&settings).unwrap();
        let deserialized: AppSettings = serde_json::from_str(&json).unwrap();
        assert_eq!(
            deserialized.anthropic_api_key.as_deref(),
            Some("sk-ant-test-key")
        );
        assert_eq!(
            deserialized.workspace_path.as_deref(),
            Some("/home/user/skills")
        );
        assert_eq!(
            deserialized.skills_path.as_deref(),
            Some("/home/user/output")
        );
        assert_eq!(deserialized.preferred_model.as_deref(), Some("sonnet"));
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
        // Simulates loading settings saved before new OAuth fields existed
        let json = r#"{"anthropic_api_key":"sk-test","workspace_path":"/w","preferred_model":"sonnet","extended_context":false,"splash_shown":false}"#;
        let settings: AppSettings = serde_json::from_str(json).unwrap();
        assert!(settings.skills_path.is_none());
        assert_eq!(settings.log_level, "info");
        assert!(!settings.extended_thinking);
        assert!(settings.github_oauth_token.is_none());
        assert!(settings.github_user_login.is_none());
        assert!(settings.github_user_avatar.is_none());
        assert!(settings.github_user_email.is_none());
        assert!(settings.marketplace_url.is_none());
        assert!(settings.marketplace_registries.is_empty());
        assert!(!settings.marketplace_initialized);

        // Simulates loading settings that still have the old verbose_logging boolean field
        let json_old = r#"{"anthropic_api_key":"sk-test","workspace_path":"/w","preferred_model":"sonnet","verbose_logging":true,"extended_context":false,"splash_shown":false}"#;
        let settings_old: AppSettings = serde_json::from_str(json_old).unwrap();
        // Old verbose_logging is ignored; log_level defaults to "info"
        assert_eq!(settings_old.log_level, "info");
    }

    #[test]
    fn test_sidecar_config_serde() {
        let config = crate::agents::sidecar::SidecarConfig {
            prompt: "test prompt".to_string(),
            model: Some("sonnet".to_string()),
            api_key: "sk-test".to_string(),
            cwd: "/tmp".to_string(),
            allowed_tools: Some(vec!["Read".to_string(), "Write".to_string()]),
            max_turns: Some(10),
            permission_mode: Some("bypassPermissions".to_string()),
            betas: None,
            thinking: None,
            fallback_model: None,
            effort: None,
            output_format: None,
            prompt_suggestions: None,
            path_to_claude_code_executable: None,
            agent_name: Some("research-entities".to_string()),
            required_plugins: None,
            conversation_history: None,
            skill_name: None,
            step_id: None,
            workflow_session_id: None,
            usage_session_id: None,
            run_source: None,
        };
        let json = serde_json::to_string(&config).unwrap();
        assert!(json.contains("\"apiKey\""));
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
}
