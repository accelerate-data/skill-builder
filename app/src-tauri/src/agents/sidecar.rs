use std::collections::HashMap;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

use super::events;

pub type AgentRegistry = Arc<Mutex<HashMap<String, Child>>>;

pub fn create_registry() -> AgentRegistry {
    Arc::new(Mutex::new(HashMap::new()))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SidecarConfig {
    pub prompt: String,
    pub model: String,
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
}

pub async fn spawn_sidecar(
    agent_id: String,
    config: SidecarConfig,
    registry: AgentRegistry,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let sidecar_path = resolve_sidecar_path(&app_handle)?;

    let mut child = Command::new("node")
        .arg(&sidecar_path)
        .current_dir(&config.cwd)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn sidecar: {}", e))?;

    // Write config as JSON line to stdin
    let mut stdin = child.stdin.take().ok_or("Failed to open stdin")?;
    let config_json = serde_json::to_string(&config).map_err(|e| e.to_string())?;
    stdin
        .write_all(config_json.as_bytes())
        .await
        .map_err(|e| format!("Failed to write config to stdin: {}", e))?;
    stdin
        .write_all(b"\n")
        .await
        .map_err(|e| format!("Failed to write newline to stdin: {}", e))?;
    // Keep stdin open — don't drop it yet. The sidecar will exit on its own when done.
    // We store it back so we can kill the process later if needed.
    // Actually, Child doesn't let us put stdin back, so we just let it stay open
    // by leaking the handle into a background task.
    tokio::spawn(async move {
        // Hold stdin open until the sidecar exits
        let _ = stdin;
        tokio::signal::ctrl_c().await.ok();
    });

    let stdout = child.stdout.take().ok_or("Failed to open stdout")?;
    let stderr = child.stderr.take().ok_or("Failed to open stderr")?;

    // Store child in registry
    {
        let mut reg = registry.lock().await;
        reg.insert(agent_id.clone(), child);
    }

    // Spawn stdout reader
    let app_handle_stdout = app_handle.clone();
    let agent_id_stdout = agent_id.clone();
    let registry_stdout = registry.clone();
    tokio::spawn(async move {
        let reader = BufReader::new(stdout);
        let mut lines = reader.lines();
        let mut success = true;

        while let Ok(Some(line)) = lines.next_line().await {
            events::handle_sidecar_message(&app_handle_stdout, &agent_id_stdout, &line);
        }

        // Stdout closed — sidecar exited
        // Check exit status
        {
            let mut reg = registry_stdout.lock().await;
            if let Some(mut child) = reg.remove(&agent_id_stdout) {
                match child.try_wait() {
                    Ok(Some(status)) => {
                        success = status.success();
                    }
                    _ => {}
                }
            }
        }

        events::handle_sidecar_exit(&app_handle_stdout, &agent_id_stdout, success);
    });

    // Spawn stderr reader
    let agent_id_stderr = agent_id.clone();
    tokio::spawn(async move {
        let reader = BufReader::new(stderr);
        let mut lines = reader.lines();

        while let Ok(Some(line)) = lines.next_line().await {
            log::debug!("[sidecar:{}] {}", agent_id_stderr, line);
        }
    });

    Ok(())
}

pub async fn cancel_sidecar(agent_id: String, registry: AgentRegistry) -> Result<(), String> {
    let mut reg = registry.lock().await;
    if let Some(mut child) = reg.remove(&agent_id) {
        child
            .kill()
            .await
            .map_err(|e| format!("Failed to kill sidecar: {}", e))?;
        Ok(())
    } else {
        Err(format!("Agent '{}' not found", agent_id))
    }
}

fn resolve_sidecar_path(app_handle: &tauri::AppHandle) -> Result<String, String> {
    use tauri::Manager;

    // Try resource directory first
    if let Ok(resource_dir) = app_handle.path().resource_dir() {
        let sidecar = resource_dir.join("sidecar").join("dist").join("agent-runner.js");
        if sidecar.exists() {
            return sidecar
                .to_str()
                .map(|s| s.to_string())
                .ok_or_else(|| "Invalid sidecar path".to_string());
        }
    }

    // Fallback: look next to the binary
    if let Ok(exe_dir) = std::env::current_exe() {
        if let Some(dir) = exe_dir.parent() {
            let sidecar = dir.join("sidecar").join("dist").join("agent-runner.js");
            if sidecar.exists() {
                return sidecar
                    .to_str()
                    .map(|s| s.to_string())
                    .ok_or_else(|| "Invalid sidecar path".to_string());
            }
        }
    }

    // Dev mode fallback: look relative to the Cargo manifest (src-tauri/../sidecar/dist/)
    let dev_path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(|p| p.join("sidecar").join("dist").join("agent-runner.js"));
    if let Some(path) = dev_path {
        if path.exists() {
            return path
                .to_str()
                .map(|s| s.to_string())
                .ok_or_else(|| "Invalid sidecar path".to_string());
        }
    }

    Err("Could not find agent-runner.js — run 'npm run build' in app/sidecar/ first".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_cancel_sidecar_not_found() {
        let registry = create_registry();
        let result = cancel_sidecar("nonexistent-agent".into(), registry).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not found"));
    }

    #[test]
    fn test_sidecar_config_serialization() {
        let config = SidecarConfig {
            prompt: "Analyze this codebase".to_string(),
            model: "sonnet".to_string(),
            api_key: "sk-ant-test".to_string(),
            cwd: "/home/user/project".to_string(),
            allowed_tools: Some(vec!["Read".to_string(), "Glob".to_string()]),
            max_turns: Some(25),
            permission_mode: Some("bypassPermissions".to_string()),
            session_id: None,
        };

        let json = serde_json::to_string(&config).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

        // Verify camelCase field names from serde rename
        assert_eq!(parsed["apiKey"], "sk-ant-test");
        assert_eq!(parsed["allowedTools"][0], "Read");
        assert_eq!(parsed["maxTurns"], 25);
        assert_eq!(parsed["permissionMode"], "bypassPermissions");
        // session_id is None + skip_serializing_if — should be absent
        assert!(parsed.get("sessionId").is_none());
    }

    #[test]
    fn test_create_registry() {
        // Ensure registry creation doesn't panic and returns usable type
        let _registry = create_registry();
    }
}
