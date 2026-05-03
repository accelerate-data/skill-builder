use serde::{Deserialize, Serialize};

use crate::types::SecretString;

#[derive(Clone, Serialize, Deserialize)]
pub struct SidecarConfig {
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
    #[serde(rename = "apiKey")]
    pub api_key: SecretString,
    /// Workspace root directory (`{data_dir}/workspace`). Used for plugin
    /// discovery (`.claude/plugins/`) and SDK settings sources.
    #[serde(rename = "workspaceRootDir")]
    pub workspace_root_dir: String,
    /// OpenHands local workspace for this run. Existing-skill workflows use the
    /// skill-scoped directory (`{workspace}/{plugin_slug}/{skill_name}`), while
    /// pre-create tasks such as scope validation use the initialized workspace root.
    #[serde(rename = "workspaceSkillDir")]
    pub workspace_skill_dir: String,
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
    #[serde(rename = "fallbackModel", skip_serializing_if = "Option::is_none")]
    pub fallback_model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub effort: Option<String>,
    #[serde(rename = "outputFormat", skip_serializing_if = "Option::is_none")]
    pub output_format: Option<serde_json::Value>,
    #[serde(rename = "promptSuggestions", skip_serializing_if = "Option::is_none")]
    pub prompt_suggestions: Option<bool>,
    #[serde(
        rename = "pathToClaudeCodeExecutable",
        skip_serializing_if = "Option::is_none"
    )]
    pub path_to_claude_code_executable: Option<String>,
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
    /// Workflow session ID.
    #[serde(rename = "workflowSessionId", skip_serializing_if = "Option::is_none")]
    pub workflow_session_id: Option<String>,
    /// Synthetic usage session ID for non-workflow runs.
    #[serde(rename = "usageSessionId", skip_serializing_if = "Option::is_none")]
    pub usage_session_id: Option<String>,
    /// Run source: "workflow", "refine", or "test".
    #[serde(rename = "runSource", skip_serializing_if = "Option::is_none")]
    pub run_source: Option<String>,
    /// Base log directory for native runtime logs. OpenHands uses this as the
    /// parent for its SDK `persistenceDir`.
    #[serde(rename = "transcriptLogDir", skip_serializing_if = "Option::is_none")]
    pub transcript_log_dir: Option<String>,
    /// OpenHands-native persistence directory for the SDK conversation event log.
    #[serde(rename = "persistenceDir", skip_serializing_if = "Option::is_none")]
    pub persistence_dir: Option<String>,
    /// Plugin slug for the skill (from plugin-paths.json layout: `{root}/{plugin_slug}/{skill_name}`).
    /// Threaded through terminal lifecycle events so persistence handlers can resolve the correct skill dir.
    #[serde(rename = "pluginSlug")]
    pub plugin_slug: String,
    /// Selects the agent runtime backend. Defaults to "claude" when absent.
    #[serde(rename = "runtimeProvider", skip_serializing_if = "Option::is_none")]
    pub runtime_provider: Option<String>,
    /// Task discriminator for a shared runtime agent.
    #[serde(rename = "taskKind", skip_serializing_if = "Option::is_none")]
    pub task_kind: Option<String>,
    /// Optional suffix appended by the runtime to every user message.
    #[serde(rename = "userMessageSuffix", skip_serializing_if = "Option::is_none")]
    pub user_message_suffix: Option<String>,
}

impl std::fmt::Debug for SidecarConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SidecarConfig")
            .field("mode", &self.mode)
            .field("prompt", &self.prompt)
            .field("model", &self.model)
            .field("llm", &self.llm)
            .field("model_base_url", &self.model_base_url)
            .field("api_key", &"[redacted]")
            .field("workspace_root_dir", &self.workspace_root_dir)
            .field("workspace_skill_dir", &self.workspace_skill_dir)
            .field("allowed_tools", &self.allowed_tools)
            .field("max_turns", &self.max_turns)
            .field("permission_mode", &self.permission_mode)
            .field("betas", &self.betas)
            .field("thinking", &self.thinking)
            .field("fallback_model", &self.fallback_model)
            .field("effort", &self.effort)
            .field("output_format", &self.output_format)
            .field("prompt_suggestions", &self.prompt_suggestions)
            .field("agent_name", &self.agent_name)
            .field("required_plugins", &self.required_plugins)
            .field("setting_sources", &self.setting_sources)
            .field("runtime_provider", &self.runtime_provider)
            .field("task_kind", &self.task_kind)
            .field(
                "user_message_suffix",
                &self.user_message_suffix.as_ref().map(|_| "[configured]"),
            )
            .finish()
    }
}

pub struct OpenHandsOneShotConfigParams {
    pub prompt: String,
    pub llm: crate::types::WorkflowLlmConfig,
    pub workspace_root_dir: String,
    pub workspace_run_dir: String,
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

/// Build the backend-owned OpenHands one-shot runtime request.
///
/// Feature commands supply only agent/task details. Initialized workspace and
/// selected LLM must already have been resolved by the backend runtime context
/// API before this helper is called.
pub fn build_openhands_one_shot_config(params: OpenHandsOneShotConfigParams) -> SidecarConfig {
    SidecarConfig {
        mode: Some("one-shot".to_string()),
        prompt: params.prompt,
        system_prompt: None,
        model: None,
        llm: Some(params.llm),
        model_base_url: None,
        api_key: SecretString::new("openhands-llm-config".to_string()),
        workspace_root_dir: params.workspace_root_dir.replace('\\', "/"),
        workspace_skill_dir: params.workspace_run_dir.replace('\\', "/"),
        allowed_tools: Some(params.allowed_tools),
        max_turns: Some(params.max_turns),
        permission_mode: None,
        betas: None,
        thinking: None,
        fallback_model: None,
        effort: None,
        output_format: params.output_format,
        prompt_suggestions: None,
        path_to_claude_code_executable: None,
        agent_name: Some(params.agent_name),
        required_plugins: None,
        setting_sources: None,
        conversation_history: None,
        skill_name: params.skill_name,
        step_id: params.step_id,
        workflow_session_id: None,
        usage_session_id: None,
        run_source: params.run_source,
        plugin_slug: params.plugin_slug,
        transcript_log_dir: None,
        persistence_dir: None,
        runtime_provider: Some("openhands".to_string()),
        task_kind: params.task_kind,
        user_message_suffix: params.user_message_suffix,
    }
}

/// Spawn an agent request.
///
/// OpenHands requests use the Rust-managed local Agent Server boundary. Legacy
/// runtime requests still use the persistent sidecar pool, which reuses a
/// long-lived Node.js process per skill to reduce startup latency.
///
/// The request runs until the agent completes or the user cancels manually.
pub async fn spawn_sidecar(
    agent_id: String,
    mut config: SidecarConfig,
    pool: super::sidecar_pool::SidecarPool,
    app_handle: tauri::AppHandle,
    skill_name: String,
    transcript_log_dir: Option<String>,
) -> Result<(), String> {
    if config.runtime_provider.as_deref() == Some("openhands") {
        crate::agents::openhands_server::dispatch_openhands_one_shot(
            &app_handle,
            &agent_id,
            config,
            transcript_log_dir.as_deref(),
        )
        .await?;
        return Ok(());
    } else if config.path_to_claude_code_executable.is_none() {
        // Resolve the SDK native binary path so the bundled SDK can spawn it.
        if let Ok(cli_path) = resolve_sdk_cli_path(&app_handle) {
            config.path_to_claude_code_executable = Some(cli_path);
        }
    }

    pool.send_request(
        &skill_name,
        &agent_id,
        config,
        &app_handle,
        transcript_log_dir.as_deref(),
    )
    .await?;

    Ok(())
}

/// Public accessor for startup dependency checks.
pub fn resolve_sdk_cli_path_public(app_handle: &tauri::AppHandle) -> Result<String, String> {
    resolve_sdk_cli_path(app_handle)
}

fn normalize_executable_path(path: &str) -> String {
    path.strip_prefix("\\\\?\\")
        .unwrap_or(path)
        .replace('\\', "/")
}

/// Resolve the path to the SDK's native `claude` binary, which the bundled SDK
/// spawns as a child process. Looks in sidecar/dist/sdk/claude (or claude.exe
/// on Windows), where build.js copies it from the platform-specific
/// @anthropic-ai/claude-agent-sdk-{platform}-{arch} package.
fn resolve_sdk_cli_path(app_handle: &tauri::AppHandle) -> Result<String, String> {
    use tauri::Manager;

    let exe_name = if cfg!(windows) {
        "claude.exe"
    } else {
        "claude"
    };

    // Try resource directory first (production)
    if let Ok(resource_dir) = app_handle.path().resource_dir() {
        let cli = resource_dir
            .join("sidecar")
            .join("dist")
            .join("sdk")
            .join(exe_name);
        if cli.exists() {
            return cli
                .to_str()
                .map(normalize_executable_path)
                .ok_or_else(|| "Invalid SDK binary path".to_string());
        }
    }

    // Fallback: next to the binary
    if let Ok(exe_dir) = std::env::current_exe() {
        if let Some(dir) = exe_dir.parent() {
            let cli = dir.join("sidecar").join("dist").join("sdk").join(exe_name);
            if cli.exists() {
                return cli
                    .to_str()
                    .map(normalize_executable_path)
                    .ok_or_else(|| "Invalid SDK binary path".to_string());
            }
        }
    }

    // Dev mode fallback
    let dev_path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(|p| p.join("sidecar").join("dist").join("sdk").join(exe_name));
    if let Some(path) = dev_path {
        if path.exists() {
            return path
                .to_str()
                .map(normalize_executable_path)
                .ok_or_else(|| "Invalid SDK binary path".to_string());
        }
    }

    Err(format!(
        "Could not find SDK binary ({exe_name}) — run 'npm run build' in app/sidecar/ first"
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sidecar_config_serialization() {
        let config = SidecarConfig {
            mode: Some("one-shot".to_string()),
            prompt: "Analyze this codebase".to_string(),
            system_prompt: None,
            model: Some("sonnet".to_string()),
            llm: None,
            model_base_url: Some("https://models.example.com/v1".to_string()),
            api_key: crate::types::SecretString::new("sk-ant-test".to_string()),
            workspace_root_dir: "/home/user/project".to_string(),
            workspace_skill_dir: "/home/user/project".to_string(),
            allowed_tools: Some(vec!["Read".to_string(), "Glob".to_string()]),
            max_turns: Some(25),
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
            setting_sources: None,
            conversation_history: None,
            skill_name: None,
            step_id: None,
            workflow_session_id: None,
            usage_session_id: None,
            run_source: None,
            plugin_slug: "skills".to_string(),
            transcript_log_dir: None,
            persistence_dir: None,
            runtime_provider: None,
            task_kind: None,
            user_message_suffix: None,
        };

        let json = serde_json::to_string(&config).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

        // Verify camelCase field names from serde rename
        assert_eq!(parsed["apiKey"], "sk-ant-test");
        assert_eq!(parsed["allowedTools"][0], "Read");
        assert_eq!(parsed["maxTurns"], 25);
        assert_eq!(parsed["permissionMode"], "bypassPermissions");
        assert_eq!(parsed["model"], "sonnet");
        assert_eq!(parsed["modelBaseUrl"], "https://models.example.com/v1");
        assert_eq!(parsed["mode"], "one-shot");
        assert_eq!(parsed["agentName"], "research-entities");
        // betas is None + skip_serializing_if — should be absent
        assert!(parsed.get("betas").is_none());
        // thinking is None + skip_serializing_if — should be absent
        assert!(parsed.get("thinking").is_none());
    }

    #[test]
    fn test_sidecar_config_serialization_with_thinking() {
        let config = SidecarConfig {
            mode: None,
            prompt: "Reason about this".to_string(),
            system_prompt: None,
            model: Some("opus".to_string()),
            llm: None,
            model_base_url: None,
            api_key: crate::types::SecretString::new("sk-ant-test".to_string()),
            workspace_root_dir: "/home/user/project".to_string(),
            workspace_skill_dir: "/home/user/project".to_string(),
            allowed_tools: None,
            max_turns: None,
            permission_mode: None,
            betas: None,
            thinking: Some(serde_json::json!({
                "type": "enabled",
                "budgetTokens": 32000
            })),
            fallback_model: None,
            effort: None,
            output_format: None,
            prompt_suggestions: None,
            path_to_claude_code_executable: None,
            agent_name: None,
            required_plugins: None,
            setting_sources: None,
            conversation_history: None,
            skill_name: None,
            step_id: None,
            workflow_session_id: None,
            usage_session_id: None,
            run_source: None,
            plugin_slug: "skills".to_string(),
            transcript_log_dir: None,
            persistence_dir: None,
            runtime_provider: None,
            task_kind: None,
            user_message_suffix: None,
        };

        let json = serde_json::to_string(&config).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed["thinking"]["type"], "enabled");
        assert_eq!(parsed["thinking"]["budgetTokens"], 32000);
    }

    #[test]
    fn test_sidecar_config_skill_name_serialized_as_camel_case() {
        // skill_name must serialize as "skillName" so the sidecar's
        // mock discriminator (config.skillName) receives the value correctly.
        let config = SidecarConfig {
            mode: None,
            prompt: "test".to_string(),
            system_prompt: None,
            model: None,
            llm: None,
            model_base_url: None,
            api_key: crate::types::SecretString::new("sk-ant-test".to_string()),
            workspace_root_dir: "/tmp".to_string(),
            workspace_skill_dir: "/tmp".to_string(),
            allowed_tools: None,
            max_turns: None,
            permission_mode: None,
            betas: None,
            thinking: None,
            fallback_model: None,
            effort: None,
            output_format: None,
            prompt_suggestions: None,
            path_to_claude_code_executable: None,
            agent_name: None,
            required_plugins: None,
            setting_sources: None,
            conversation_history: None,
            skill_name: Some("my-skill".to_string()),
            step_id: None,
            workflow_session_id: None,
            usage_session_id: None,
            run_source: None,
            plugin_slug: "skills".to_string(),
            transcript_log_dir: None,
            persistence_dir: None,
            runtime_provider: None,
            task_kind: None,
            user_message_suffix: None,
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
    fn test_sidecar_config_skill_name_absent_when_none() {
        // When skill_name is None, it must be omitted (skip_serializing_if = "Option::is_none").
        let config = SidecarConfig {
            mode: None,
            prompt: "test".to_string(),
            system_prompt: None,
            model: None,
            llm: None,
            model_base_url: None,
            api_key: crate::types::SecretString::new("sk-ant-test".to_string()),
            workspace_root_dir: "/tmp".to_string(),
            workspace_skill_dir: "/tmp".to_string(),
            allowed_tools: None,
            max_turns: None,
            permission_mode: None,
            betas: None,
            thinking: None,
            fallback_model: None,
            effort: None,
            output_format: None,
            prompt_suggestions: None,
            path_to_claude_code_executable: None,
            agent_name: None,
            required_plugins: None,
            setting_sources: None,
            conversation_history: None,
            skill_name: None,
            step_id: None,
            workflow_session_id: None,
            usage_session_id: None,
            run_source: None,
            plugin_slug: "skills".to_string(),
            transcript_log_dir: None,
            persistence_dir: None,
            runtime_provider: None,
            task_kind: None,
            user_message_suffix: None,
        };
        let json = serde_json::to_string(&config).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert!(
            parsed.get("skillName").is_none(),
            "skillName must be absent when None"
        );
    }

    #[test]
    fn test_normalize_executable_path_strips_windows_verbatim_prefix_and_slashes() {
        assert_eq!(
            normalize_executable_path(r"\\?\C:\Skill Builder\claude.exe"),
            "C:/Skill Builder/claude.exe"
        );
    }

    #[test]
    fn test_scope_review_config_serializes_user_suffix_and_task_kind() {
        let config = SidecarConfig {
            mode: Some("one-shot".to_string()),
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
            api_key: crate::types::SecretString::new("openhands-llm-config".to_string()),
            workspace_root_dir: "/tmp/workspace".to_string(),
            workspace_skill_dir: "/tmp/workspace/skills/new-skill".to_string(),
            allowed_tools: Some(vec!["file_editor".to_string()]),
            max_turns: Some(4),
            permission_mode: None,
            betas: None,
            thinking: None,
            fallback_model: None,
            effort: None,
            output_format: None,
            prompt_suggestions: None,
            path_to_claude_code_executable: None,
            agent_name: Some("skill-creator".to_string()),
            required_plugins: None,
            setting_sources: None,
            conversation_history: None,
            skill_name: Some("new-skill".to_string()),
            step_id: Some(-30),
            workflow_session_id: None,
            usage_session_id: None,
            run_source: None,
            plugin_slug: "skills".to_string(),
            transcript_log_dir: None,
            persistence_dir: None,
            runtime_provider: Some("openhands".to_string()),
            task_kind: Some("scope_review".to_string()),
            user_message_suffix: Some(
                "Follow the current user message exactly. Do not infer a different task than the one stated in the message.".to_string(),
            ),
        };

        let json = serde_json::to_value(&config).unwrap();
        assert_eq!(json["taskKind"], "scope_review");
        assert_eq!(
            json["userMessageSuffix"],
            "Follow the current user message exactly. Do not infer a different task than the one stated in the message."
        );
    }
}
