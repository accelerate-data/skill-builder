use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize, Deserialize)]
pub struct SidecarConfig {
    pub prompt: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(rename = "apiKey")]
    pub api_key: String,
    pub cwd: String,
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
}

impl std::fmt::Debug for SidecarConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SidecarConfig")
            .field("prompt", &self.prompt)
            .field("model", &self.model)
            .field("api_key", &"[redacted]")
            .field("cwd", &self.cwd)
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
            .finish()
    }
}

/// Spawn an agent using the persistent sidecar pool, which reuses a long-lived
/// Node.js process per skill to reduce startup latency.
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
    // Resolve the SDK cli.js path so the bundled SDK can find it
    if config.path_to_claude_code_executable.is_none() {
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

/// Resolve the path to the SDK's cli.js, which the bundled SDK needs to spawn.
/// Looks in sidecar/dist/sdk/cli.js (where build.js copies it).
fn resolve_sdk_cli_path(app_handle: &tauri::AppHandle) -> Result<String, String> {
    use tauri::Manager;

    // Try resource directory first (production)
    if let Ok(resource_dir) = app_handle.path().resource_dir() {
        let cli = resource_dir
            .join("sidecar")
            .join("dist")
            .join("sdk")
            .join("cli.js");
        if cli.exists() {
            return cli
                .to_str()
                .map(|s| s.strip_prefix("\\\\?\\").unwrap_or(s).replace('\\', "/"))
                .ok_or_else(|| "Invalid SDK cli.js path".to_string());
        }
    }

    // Fallback: next to the binary
    if let Ok(exe_dir) = std::env::current_exe() {
        if let Some(dir) = exe_dir.parent() {
            let cli = dir.join("sidecar").join("dist").join("sdk").join("cli.js");
            if cli.exists() {
                return cli
                    .to_str()
                    .map(|s| s.strip_prefix("\\\\?\\").unwrap_or(s).replace('\\', "/"))
                    .ok_or_else(|| "Invalid SDK cli.js path".to_string());
            }
        }
    }

    // Dev mode fallback
    let dev_path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(|p| p.join("sidecar").join("dist").join("sdk").join("cli.js"));
    if let Some(path) = dev_path {
        if path.exists() {
            return path
                .to_str()
                .map(|s| s.strip_prefix("\\\\?\\").unwrap_or(s).replace('\\', "/"))
                .ok_or_else(|| "Invalid SDK cli.js path".to_string());
        }
    }

    Err("Could not find SDK cli.js — run 'npm run build' in app/sidecar/ first".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sidecar_config_serialization() {
        let config = SidecarConfig {
            prompt: "Analyze this codebase".to_string(),
            model: Some("sonnet".to_string()),
            api_key: "sk-ant-test".to_string(),
            cwd: "/home/user/project".to_string(),
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
            conversation_history: None,
            skill_name: None,
            step_id: None,
            workflow_session_id: None,
            usage_session_id: None,
            run_source: None,
        };

        let json = serde_json::to_string(&config).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

        // Verify camelCase field names from serde rename
        assert_eq!(parsed["apiKey"], "sk-ant-test");
        assert_eq!(parsed["allowedTools"][0], "Read");
        assert_eq!(parsed["maxTurns"], 25);
        assert_eq!(parsed["permissionMode"], "bypassPermissions");
        assert_eq!(parsed["model"], "sonnet");
        assert_eq!(parsed["agentName"], "research-entities");
        // betas is None + skip_serializing_if — should be absent
        assert!(parsed.get("betas").is_none());
        // thinking is None + skip_serializing_if — should be absent
        assert!(parsed.get("thinking").is_none());
    }

    #[test]
    fn test_sidecar_config_serialization_with_thinking() {
        let config = SidecarConfig {
            prompt: "Reason about this".to_string(),
            model: Some("opus".to_string()),
            api_key: "sk-ant-test".to_string(),
            cwd: "/home/user/project".to_string(),
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
            conversation_history: None,
            skill_name: None,
            step_id: None,
            workflow_session_id: None,
            usage_session_id: None,
            run_source: None,
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
            prompt: "test".to_string(),
            model: None,
            api_key: "sk-ant-test".to_string(),
            cwd: "/tmp".to_string(),
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
            conversation_history: None,
            skill_name: Some("my-skill".to_string()),
            step_id: None,
            workflow_session_id: None,
            usage_session_id: None,
            run_source: None,
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
            prompt: "test".to_string(),
            model: None,
            api_key: "sk-ant-test".to_string(),
            cwd: "/tmp".to_string(),
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
            conversation_history: None,
            skill_name: None,
            step_id: None,
            workflow_session_id: None,
            usage_session_id: None,
            run_source: None,
        };
        let json = serde_json::to_string(&config).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert!(
            parsed.get("skillName").is_none(),
            "skillName must be absent when None"
        );
    }
}
