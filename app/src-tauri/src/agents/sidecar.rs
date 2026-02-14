use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
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
    #[serde(rename = "sessionId", skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub betas: Option<Vec<String>>,
    #[serde(rename = "maxThinkingTokens", skip_serializing_if = "Option::is_none")]
    pub max_thinking_tokens: Option<u32>,
    #[serde(
        rename = "pathToClaudeCodeExecutable",
        skip_serializing_if = "Option::is_none"
    )]
    pub path_to_claude_code_executable: Option<String>,
    #[serde(rename = "agentName", skip_serializing_if = "Option::is_none")]
    pub agent_name: Option<String>,
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
) -> Result<(), String> {
    // Resolve the SDK cli.js path so the bundled SDK can find it
    if config.path_to_claude_code_executable.is_none() {
        if let Ok(cli_path) = resolve_sdk_cli_path(&app_handle) {
            config.path_to_claude_code_executable = Some(cli_path);
        }
    }

    pool.send_request(&skill_name, &agent_id, config, &app_handle)
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
        let cli = resource_dir.join("sidecar").join("dist").join("sdk").join("cli.js");
        if cli.exists() {
            return cli
                .to_str()
                .map(|s| s.to_string())
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
                    .map(|s| s.to_string())
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
                .map(|s| s.to_string())
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
            session_id: None,
            betas: None,
            max_thinking_tokens: None,
            path_to_claude_code_executable: None,
            agent_name: Some("domain-research-concepts".to_string()),

        };

        let json = serde_json::to_string(&config).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

        // Verify camelCase field names from serde rename
        assert_eq!(parsed["apiKey"], "sk-ant-test");
        assert_eq!(parsed["allowedTools"][0], "Read");
        assert_eq!(parsed["maxTurns"], 25);
        assert_eq!(parsed["permissionMode"], "bypassPermissions");
        assert_eq!(parsed["model"], "sonnet");
        assert_eq!(parsed["agentName"], "domain-research-concepts");
        // session_id is None + skip_serializing_if — should be absent
        assert!(parsed.get("sessionId").is_none());
        // betas is None + skip_serializing_if — should be absent
        assert!(parsed.get("betas").is_none());
        // max_thinking_tokens is None + skip_serializing_if — should be absent
        assert!(parsed.get("maxThinkingTokens").is_none());
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
            session_id: None,
            betas: None,
            max_thinking_tokens: Some(32000),
            path_to_claude_code_executable: None,
            agent_name: None,

        };

        let json = serde_json::to_string(&config).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed["maxThinkingTokens"], 32000);
    }

}
