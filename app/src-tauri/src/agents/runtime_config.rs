use serde::{Deserialize, Serialize};

use crate::types::SecretString;

const SKILL_CREATOR_AGENT_MARKDOWN: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../agent-sources/workspace/agents/skill-creator.md"
));

pub(crate) fn skill_creator_system_message_suffix() -> String {
    strip_optional_yaml_frontmatter(SKILL_CREATOR_AGENT_MARKDOWN)
        .trim()
        .to_string()
}

fn strip_optional_yaml_frontmatter(raw: &str) -> String {
    let normalized = raw.replace("\r\n", "\n");
    let Some(rest) = normalized.strip_prefix("---\n") else {
        return normalized;
    };
    let Some(idx) = rest.find("\n---\n") else {
        return normalized;
    };
    rest[idx + "\n---\n".len()..].to_string()
}

#[derive(Clone, Serialize, Deserialize)]
pub struct OpenHandsRuntimeConfig {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mode: Option<String>,
    pub prompt: String,
    #[serde(rename = "systemPrompt", skip_serializing_if = "Option::is_none")]
    pub system_prompt: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub llm: Option<crate::types::WorkflowLlmConfig>,
    #[serde(rename = "modelBaseUrl", skip_serializing_if = "Option::is_none")]
    pub model_base_url: Option<String>,
    #[serde(rename = "openhandsApiKey")]
    pub openhands_api_key: SecretString,
    /// App-local data directory (`~/Library/Application Support/com.vibedata.skill-builder/`).
    /// Owns `openhands/` (conversations, bash_events, logs, secret.key), the SQLite DB, and documents.
    #[serde(rename = "appDataRoot")]
    pub app_data_root: String,
    /// Skills tree root directory — owns all plugin/skill files.
    #[serde(rename = "skillsRoot")]
    pub skills_root: String,
    /// Canonical skill directory where OpenHands operates (`workspace.working_dir`).
    /// Shape: `{skills_root}/{plugin_slug}/skills/{skill_name}`.
    #[serde(rename = "skillDir")]
    pub skill_dir: String,
    #[serde(rename = "allowedTools", skip_serializing_if = "Option::is_none")]
    pub allowed_tools: Option<Vec<String>>,
    #[serde(rename = "maxTurns", skip_serializing_if = "Option::is_none")]
    pub max_turns: Option<u32>,
    #[serde(rename = "permissionMode", skip_serializing_if = "Option::is_none")]
    pub permission_mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub betas: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thinking: Option<serde_json::Value>,
    #[serde(rename = "outputFormat", skip_serializing_if = "Option::is_none")]
    pub output_format: Option<serde_json::Value>,
    #[serde(rename = "promptSuggestions", skip_serializing_if = "Option::is_none")]
    pub prompt_suggestions: Option<bool>,
    #[serde(rename = "agentName", skip_serializing_if = "Option::is_none")]
    pub agent_name: Option<String>,
    #[serde(rename = "requiredPlugins", skip_serializing_if = "Option::is_none")]
    pub required_plugins: Option<Vec<String>>,
    #[serde(rename = "settingSources", skip_serializing_if = "Option::is_none")]
    pub setting_sources: Option<Vec<String>>,
    #[serde(
        rename = "conversationHistory",
        skip_serializing_if = "Option::is_none"
    )]
    pub conversation_history: Option<Vec<serde_json::Value>>,
    /// The skill name this agent run is associated with. Used by the mock agent
    /// to discriminate template selection (e.g. with-skill vs. baseline runs).
    #[serde(rename = "skillName", skip_serializing_if = "Option::is_none")]
    pub skill_name: Option<String>,
    /// Step ID for persistence (-1=unknown, -10=refine, -11=test, 0-3=workflow steps).
    #[serde(rename = "stepId", skip_serializing_if = "Option::is_none")]
    pub step_id: Option<i32>,
    /// Synthetic usage session ID for non-workflow runs.
    #[serde(rename = "usageSessionId", skip_serializing_if = "Option::is_none")]
    pub usage_session_id: Option<String>,
    /// Run source: "workflow", "refine", or "test".
    #[serde(rename = "runSource", skip_serializing_if = "Option::is_none")]
    pub run_source: Option<String>,
    /// OpenHands-native persistence directory for the SDK conversation event log.
    #[serde(rename = "persistenceDir", skip_serializing_if = "Option::is_none")]
    pub persistence_dir: Option<String>,
    /// Plugin slug for the skill (from plugin-paths.json layout: `{root}/{plugin_slug}/{skill_name}`).
    /// Threaded through terminal lifecycle events so persistence handlers can resolve the correct skill dir.
    #[serde(rename = "pluginSlug")]
    pub plugin_slug: String,
    /// Task discriminator for a shared runtime agent.
    #[serde(rename = "taskKind", skip_serializing_if = "Option::is_none")]
    pub task_kind: Option<String>,
    /// Optional suffix appended by the runtime to every user message.
    #[serde(rename = "userMessageSuffix", skip_serializing_if = "Option::is_none")]
    pub user_message_suffix: Option<String>,
    /// Optional suffix appended to the default OpenHands system prompt.
    #[serde(
        rename = "systemMessageSuffix",
        skip_serializing_if = "Option::is_none"
    )]
    pub system_message_suffix: Option<String>,
}

impl std::fmt::Debug for OpenHandsRuntimeConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("OpenHandsRuntimeConfig")
            .field("mode", &self.mode)
            .field("prompt", &self.prompt)
            .field("model", &self.model)
            .field("llm", &self.llm)
            .field("model_base_url", &self.model_base_url)
            .field("openhands_api_key", &"[redacted]")
            .field("app_data_root", &self.app_data_root)
            .field("skills_root", &self.skills_root)
            .field("skill_dir", &self.skill_dir)
            .field("allowed_tools", &self.allowed_tools)
            .field("max_turns", &self.max_turns)
            .field("permission_mode", &self.permission_mode)
            .field("betas", &self.betas)
            .field("thinking", &self.thinking)
            .field("output_format", &self.output_format)
            .field("prompt_suggestions", &self.prompt_suggestions)
            .field("agent_name", &self.agent_name)
            .field("required_plugins", &self.required_plugins)
            .field("setting_sources", &self.setting_sources)
            .field("task_kind", &self.task_kind)
            .field(
                "user_message_suffix",
                &self.user_message_suffix.as_ref().map(|_| "[configured]"),
            )
            .field(
                "system_message_suffix",
                &self.system_message_suffix.as_ref().map(|_| "[configured]"),
            )
            .finish()
    }
}

pub struct BuildOpenHandsRuntimeConfigParams {
    pub prompt: String,
    pub llm: crate::types::WorkflowLlmConfig,
    pub app_data_root: String,
    pub skills_root: String,
    pub skill_dir: String,
    pub mode: Option<OpenHandsRuntimeMode>,
    pub agent_name: String,
    pub task_kind: Option<String>,
    pub user_message_suffix: Option<String>,
    pub allowed_tools: Vec<String>,
    pub max_turns: u32,
    pub output_format: Option<serde_json::Value>,
    pub skill_name: Option<String>,
    pub step_id: Option<i32>,
    pub run_source: Option<String>,
    pub plugin_slug: String,
}

#[derive(Clone, Copy)]
pub enum OpenHandsRuntimeMode {
    Throwaway,
}

impl OpenHandsRuntimeMode {
    fn as_str(self) -> &'static str {
        match self {
            Self::Throwaway => "throwaway",
        }
    }
}

/// Build the backend-owned OpenHands runtime request.
///
/// Feature commands supply only agent/task details. Initialized workspace and
/// selected LLM must already have been resolved by the backend runtime context
/// API before this helper is called.
pub fn build_openhands_runtime_config(
    params: BuildOpenHandsRuntimeConfigParams,
) -> OpenHandsRuntimeConfig {
    let system_message_suffix =
        (params.agent_name == "skill-creator").then(skill_creator_system_message_suffix);
    OpenHandsRuntimeConfig {
        mode: params.mode.map(|mode| mode.as_str().to_string()),
        prompt: params.prompt,
        system_prompt: None,
        model: Some(params.llm.model.clone()),
        llm: Some(params.llm.clone()),
        model_base_url: params.llm.base_url.clone(),
        openhands_api_key: params
            .llm
            .api_key
            .clone()
            .unwrap_or_else(|| SecretString::new(String::new())),
        app_data_root: params.app_data_root.replace('\\', "/"),
        skills_root: params.skills_root.replace('\\', "/"),
        skill_dir: params.skill_dir.replace('\\', "/"),
        allowed_tools: Some(params.allowed_tools),
        max_turns: Some(params.max_turns),
        permission_mode: None,
        betas: None,
        thinking: None,
        output_format: params.output_format,
        prompt_suggestions: None,
        agent_name: Some(params.agent_name),
        required_plugins: None,
        setting_sources: None,
        conversation_history: None,
        skill_name: params.skill_name,
        step_id: params.step_id,
        usage_session_id: None,
        run_source: params.run_source,
        plugin_slug: params.plugin_slug,
        persistence_dir: None,
        task_kind: params.task_kind,
        user_message_suffix: params.user_message_suffix,
        system_message_suffix,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_runtime_config_serialization() {
        let config = OpenHandsRuntimeConfig {
            mode: None,
            prompt: "Analyze this codebase".to_string(),
            system_prompt: None,
            model: Some("sonnet".to_string()),
            llm: None,
            model_base_url: Some("https://models.example.com/v1".to_string()),
            openhands_api_key: crate::types::SecretString::new("sk-ant-test".to_string()),
            app_data_root: "/home/user/app-data".to_string(),
            skills_root: "/home/user/project".to_string(),
            skill_dir: "/home/user/project".to_string(),
            allowed_tools: Some(vec!["Read".to_string(), "Glob".to_string()]),
            max_turns: Some(25),
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
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

        // Verify camelCase field names from serde rename
        assert_eq!(parsed["openhandsApiKey"], "sk-ant-test");
        assert_eq!(parsed["allowedTools"][0], "Read");
        assert_eq!(parsed["maxTurns"], 25);
        assert_eq!(parsed["permissionMode"], "bypassPermissions");
        assert_eq!(parsed["model"], "sonnet");
        assert_eq!(parsed["modelBaseUrl"], "https://models.example.com/v1");
        assert!(parsed.get("mode").is_none());
        assert_eq!(parsed["agentName"], "research-entities");
        // betas is None + skip_serializing_if — should be absent
        assert!(parsed.get("betas").is_none());
        // thinking is None + skip_serializing_if — should be absent
        assert!(parsed.get("thinking").is_none());
    }

    #[test]
    fn test_runtime_config_serialization_with_thinking() {
        let config = OpenHandsRuntimeConfig {
            mode: None,
            prompt: "Reason about this".to_string(),
            system_prompt: None,
            model: Some("opus".to_string()),
            llm: None,
            model_base_url: None,
            openhands_api_key: crate::types::SecretString::new("sk-ant-test".to_string()),
            app_data_root: "/home/user/app-data".to_string(),
            skills_root: "/home/user/project".to_string(),
            skill_dir: "/home/user/project".to_string(),
            allowed_tools: None,
            max_turns: None,
            permission_mode: None,
            betas: None,
            thinking: Some(serde_json::json!({
                "type": "enabled",
                "budgetTokens": 32000
            })),
            output_format: None,
            prompt_suggestions: None,
            agent_name: None,
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
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed["thinking"]["type"], "enabled");
        assert_eq!(parsed["thinking"]["budgetTokens"], 32000);
    }

    #[test]
    fn test_runtime_config_skill_name_serialized_as_camel_case() {
        // skill_name must serialize as "skillName" so the runtime's
        // mock discriminator (config.skillName) receives the value correctly.
        let config = OpenHandsRuntimeConfig {
            mode: None,
            prompt: "test".to_string(),
            system_prompt: None,
            model: None,
            llm: None,
            model_base_url: None,
            openhands_api_key: crate::types::SecretString::new("sk-ant-test".to_string()),
            app_data_root: "/tmp".to_string(),
            skills_root: "/tmp".to_string(),
            skill_dir: "/tmp".to_string(),
            allowed_tools: None,
            max_turns: None,
            permission_mode: None,
            betas: None,
            thinking: None,
            output_format: None,
            prompt_suggestions: None,
            agent_name: None,
            required_plugins: None,
            setting_sources: None,
            conversation_history: None,
            skill_name: Some("my-skill".to_string()),
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
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(
            parsed["skillName"], "my-skill",
            "skill_name must be camelCase 'skillName' in JSON"
        );
        assert!(
            parsed.get("skill_name").is_none(),
            "snake_case key must not appear in JSON"
        );
    }

    #[test]
    fn test_runtime_config_skill_name_absent_when_none() {
        // When skill_name is None, it must be omitted (skip_serializing_if = "Option::is_none").
        let config = OpenHandsRuntimeConfig {
            mode: None,
            prompt: "test".to_string(),
            system_prompt: None,
            model: None,
            llm: None,
            model_base_url: None,
            openhands_api_key: crate::types::SecretString::new("sk-ant-test".to_string()),
            app_data_root: "/tmp".to_string(),
            skills_root: "/tmp".to_string(),
            skill_dir: "/tmp".to_string(),
            allowed_tools: None,
            max_turns: None,
            permission_mode: None,
            betas: None,
            thinking: None,
            output_format: None,
            prompt_suggestions: None,
            agent_name: None,
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
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert!(
            parsed.get("skillName").is_none(),
            "skillName must be absent when None"
        );
    }

    #[test]
    fn test_scope_review_config_serializes_user_suffix_and_task_kind() {
        let config = OpenHandsRuntimeConfig {
            mode: Some("throwaway".to_string()),
            prompt: "review scope".to_string(),
            system_prompt: None,
            model: None,
            llm: Some(crate::types::WorkflowLlmConfig {
                model: "anthropic/claude-sonnet-4-5".to_string(),
                api_key: Some(crate::types::SecretString::new("sk-test".to_string())),
                base_url: None,
                api_version: None,
                temperature: None,
                max_output_tokens: None,
                timeout_seconds: None,
                num_retries: None,
                reasoning_effort: None,
                extra_headers: None,
                input_cost_per_token: None,
                output_cost_per_token: None,
                usage_id: Some("workflow".to_string()),
            }),
            model_base_url: None,
            openhands_api_key: crate::types::SecretString::new("openhands-llm-config".to_string()),
            app_data_root: "/tmp/app-data".to_string(),
            skills_root: "/tmp/workspace".to_string(),
            skill_dir: "/tmp/workspace/skills/new-skill".to_string(),
            allowed_tools: Some(vec!["file_editor".to_string()]),
            max_turns: Some(4),
            permission_mode: None,
            betas: None,
            thinking: None,
            output_format: None,
            prompt_suggestions: None,
            agent_name: Some("skill-creator".to_string()),
            required_plugins: None,
            setting_sources: None,
            conversation_history: None,
            skill_name: Some("new-skill".to_string()),
            step_id: Some(-30),
            usage_session_id: None,
            run_source: None,
            plugin_slug: "skills".to_string(),
            persistence_dir: None,
            task_kind: Some("scope_review".to_string()),
            user_message_suffix: Some(
                "Follow the current user message exactly. Do not infer a different task than the one stated in the message.".to_string(),
            ),
            system_message_suffix: Some("# Skill Creator Agent".to_string()),
        };

        let json = serde_json::to_value(&config).unwrap();
        assert_eq!(json["taskKind"], "scope_review");
        assert_eq!(
            json["userMessageSuffix"],
            "Follow the current user message exactly. Do not infer a different task than the one stated in the message."
        );
        assert_eq!(json["systemMessageSuffix"], "# Skill Creator Agent");
    }

    #[test]
    fn test_skill_creator_system_message_suffix_strips_frontmatter() {
        let suffix = skill_creator_system_message_suffix();
        assert!(suffix.starts_with("# Skill Creator Agent"));
        assert!(!suffix.contains("\n---\n"));
        assert!(
            !suffix.starts_with("---"),
            "frontmatter delimiter must not reach the system message suffix"
        );
    }

    #[test]
    fn test_non_skill_creator_openhands_config_does_not_inject_system_message_suffix() {
        let config = build_openhands_runtime_config(BuildOpenHandsRuntimeConfigParams {
            prompt: "Analyze".to_string(),
            llm: crate::types::WorkflowLlmConfig {
                model: "anthropic/claude-sonnet-4-5".to_string(),
                api_key: Some(crate::types::SecretString::new("sk-test".to_string())),
                base_url: None,
                api_version: None,
                temperature: None,
                max_output_tokens: None,
                timeout_seconds: None,
                num_retries: None,
                reasoning_effort: None,
                extra_headers: None,
                input_cost_per_token: None,
                output_cost_per_token: None,
                usage_id: Some("workflow".to_string()),
            },
            app_data_root: "/tmp/app-data".to_string(),
            skills_root: "/tmp/workspace".to_string(),
            skill_dir: "/tmp/workspace".to_string(),
            mode: None,
            agent_name: "answer-evaluator".to_string(),
            task_kind: Some("workflow.answer_evaluator".to_string()),
            user_message_suffix: None,
            allowed_tools: vec![],
            max_turns: 8,
            output_format: None,
            skill_name: None,
            step_id: None,
            run_source: None,
            plugin_slug: "default".to_string(),
        });

        assert!(config.system_message_suffix.is_none());
    }

    #[test]
    fn build_openhands_runtime_config_uses_model_from_llm_config() {
        let config = build_openhands_runtime_config(BuildOpenHandsRuntimeConfigParams {
            prompt: "test".to_string(),
            llm: crate::types::WorkflowLlmConfig {
                model: "claude-sonnet-4-5".to_string(),
                api_key: Some(crate::types::SecretString::new("sk-test".to_string())),
                base_url: Some("https://api.anthropic.com/v1".to_string()),
                api_version: None,
                temperature: None,
                max_output_tokens: None,
                timeout_seconds: None,
                num_retries: None,
                reasoning_effort: None,
                extra_headers: None,
                input_cost_per_token: None,
                output_cost_per_token: None,
                usage_id: Some("workflow".to_string()),
            },
            app_data_root: "/tmp".to_string(),
            skills_root: "/tmp".to_string(),
            skill_dir: "/tmp".to_string(),
            mode: None,
            agent_name: "test".to_string(),
            task_kind: None,
            user_message_suffix: None,
            allowed_tools: vec![],
            max_turns: 1,
            output_format: None,
            skill_name: None,
            step_id: None,
            run_source: None,
            plugin_slug: "default".to_string(),
        });

        assert_eq!(config.model.as_deref(), Some("claude-sonnet-4-5"));
        assert_eq!(
            config.model_base_url.as_deref(),
            Some("https://api.anthropic.com/v1")
        );
        assert_eq!(config.openhands_api_key.expose(), "sk-test");
    }

    #[test]
    fn build_openhands_runtime_config_preserves_catalog_model_id_unchanged() {
        let config = build_openhands_runtime_config(BuildOpenHandsRuntimeConfigParams {
            prompt: "test".to_string(),
            llm: crate::types::WorkflowLlmConfig {
                model: "claude-sonnet-4-5".to_string(),
                api_key: Some(crate::types::SecretString::new("sk-test".to_string())),
                base_url: Some("https://api.anthropic.com/v1".to_string()),
                api_version: None,
                temperature: None,
                max_output_tokens: None,
                timeout_seconds: None,
                num_retries: None,
                reasoning_effort: None,
                extra_headers: None,
                input_cost_per_token: None,
                output_cost_per_token: None,
                usage_id: Some("workflow".to_string()),
            },
            app_data_root: "/tmp".to_string(),
            skills_root: "/tmp".to_string(),
            skill_dir: "/tmp".to_string(),
            mode: None,
            agent_name: "test".to_string(),
            task_kind: None,
            user_message_suffix: None,
            allowed_tools: vec![],
            max_turns: 1,
            output_format: None,
            skill_name: None,
            step_id: None,
            run_source: None,
            plugin_slug: "default".to_string(),
        });

        assert_eq!(
            config.model.as_deref(),
            Some("claude-sonnet-4-5"),
            "catalog-backed model id must be sent unchanged"
        );
    }

    #[test]
    fn build_openhands_runtime_config_no_model_id_rewrite_with_catalog_base_url() {
        let config = build_openhands_runtime_config(BuildOpenHandsRuntimeConfigParams {
            prompt: "test".to_string(),
            llm: crate::types::WorkflowLlmConfig {
                model: "claude-sonnet-4-5".to_string(),
                api_key: Some(crate::types::SecretString::new("sk-test".to_string())),
                base_url: Some("https://api.anthropic.com/v1".to_string()),
                api_version: None,
                temperature: None,
                max_output_tokens: None,
                timeout_seconds: None,
                num_retries: None,
                reasoning_effort: None,
                extra_headers: None,
                input_cost_per_token: None,
                output_cost_per_token: None,
                usage_id: Some("workflow".to_string()),
            },
            app_data_root: "/tmp".to_string(),
            skills_root: "/tmp".to_string(),
            skill_dir: "/tmp".to_string(),
            mode: None,
            agent_name: "test".to_string(),
            task_kind: None,
            user_message_suffix: None,
            allowed_tools: vec![],
            max_turns: 1,
            output_format: None,
            skill_name: None,
            step_id: None,
            run_source: None,
            plugin_slug: "default".to_string(),
        });

        assert_eq!(
            config.model.as_deref(),
            Some("claude-sonnet-4-5"),
            "no opencode/... -> openai/... rewrite should occur in catalog-backed path"
        );
        assert_eq!(
            config.model_base_url.as_deref(),
            Some("https://api.anthropic.com/v1")
        );
    }

    #[test]
    fn build_openhands_runtime_config_empty_api_key_for_local_model() {
        let config = build_openhands_runtime_config(BuildOpenHandsRuntimeConfigParams {
            prompt: "test".to_string(),
            llm: crate::types::WorkflowLlmConfig {
                model: "ollama/llama3.1".to_string(),
                api_key: None,
                base_url: Some("http://localhost:11434/v1".to_string()),
                api_version: None,
                temperature: None,
                max_output_tokens: None,
                timeout_seconds: None,
                num_retries: None,
                reasoning_effort: None,
                extra_headers: None,
                input_cost_per_token: None,
                output_cost_per_token: None,
                usage_id: Some("workflow".to_string()),
            },
            app_data_root: "/tmp".to_string(),
            skills_root: "/tmp".to_string(),
            skill_dir: "/tmp".to_string(),
            mode: None,
            agent_name: "test".to_string(),
            task_kind: None,
            user_message_suffix: None,
            allowed_tools: vec![],
            max_turns: 1,
            output_format: None,
            skill_name: None,
            step_id: None,
            run_source: None,
            plugin_slug: "default".to_string(),
        });

        assert_eq!(config.openhands_api_key.expose(), "");
        assert_eq!(config.model.as_deref(), Some("ollama/llama3.1"));
        assert_eq!(
            config.model_base_url.as_deref(),
            Some("http://localhost:11434/v1")
        );
    }
}
