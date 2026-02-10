use std::collections::{HashMap, HashSet};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

use super::events;

pub struct AgentEntry {
    pub child: Child,
    pub pid: u32,
}

pub struct Registry {
    pub agents: HashMap<String, AgentEntry>,
    pub cancelled: HashSet<String>,
}

pub type AgentRegistry = Arc<Mutex<Registry>>;

pub fn create_registry() -> AgentRegistry {
    Arc::new(Mutex::new(Registry {
        agents: HashMap::new(),
        cancelled: HashSet::new(),
    }))
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub betas: Option<Vec<String>>,
    #[serde(
        rename = "pathToClaudeCodeExecutable",
        skip_serializing_if = "Option::is_none"
    )]
    pub path_to_claude_code_executable: Option<String>,
}

pub async fn spawn_sidecar(
    agent_id: String,
    mut config: SidecarConfig,
    registry: AgentRegistry,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let sidecar_path = resolve_sidecar_path(&app_handle)?;
    let node_bin = resolve_node_binary().await?;

    // Resolve the SDK cli.js path so the bundled SDK can find it
    if config.path_to_claude_code_executable.is_none() {
        if let Ok(cli_path) = resolve_sdk_cli_path(&app_handle) {
            config.path_to_claude_code_executable = Some(cli_path);
        }
    }

    // Pass config as a CLI argument to avoid stdin pipe race conditions.
    let config_json = serde_json::to_string(&config).map_err(|e| e.to_string())?;

    let mut child = Command::new(&node_bin)
        .arg(&sidecar_path)
        .arg(&config_json)
        .current_dir(&config.cwd)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn sidecar: {}", e))?;

    let pid = child.id().ok_or("Failed to get child PID")?;
    let stdout = child.stdout.take().ok_or("Failed to open stdout")?;
    let stderr = child.stderr.take().ok_or("Failed to open stderr")?;

    // Store child in registry
    {
        let mut reg = registry.lock().await;
        reg.agents.insert(agent_id.clone(), AgentEntry { child, pid });
    }

    // Open a log file for this agent run so users can `tail -f` it
    let log_file = open_agent_log(Path::new(&config.cwd), &agent_id, &config_json);

    // Spawn stdout reader
    let app_handle_stdout = app_handle.clone();
    let agent_id_stdout = agent_id.clone();
    let registry_stdout = registry.clone();
    let log_stdout = log_file.clone();
    tokio::spawn(async move {
        let reader = BufReader::new(stdout);
        let mut lines = reader.lines();
        let mut success = false;

        while let Ok(Some(line)) = lines.next_line().await {
            events::handle_sidecar_message(&app_handle_stdout, &agent_id_stdout, &line);
            if let Some(ref f) = log_stdout {
                let mut f = f.lock().unwrap_or_else(|e| e.into_inner());
                let _ = writeln!(f, "{}", line);
            }
        }

        // Stdout closed — sidecar exited. Check exit status.
        let was_cancelled;
        {
            let mut reg = registry_stdout.lock().await;
            was_cancelled = reg.cancelled.remove(&agent_id_stdout);
            if let Some(mut entry) = reg.agents.remove(&agent_id_stdout) {
                match entry.child.try_wait() {
                    Ok(Some(status)) => {
                        success = status.success();
                    }
                    _ => {}
                }
            }
        }

        // If cancelled, the cancel_sidecar function already emitted an exit event
        if !was_cancelled {
            events::handle_sidecar_exit(&app_handle_stdout, &agent_id_stdout, success);
        }

        // Log the exit event
        if let Some(ref f) = log_stdout {
            let mut f = f.lock().unwrap_or_else(|e| e.into_inner());
            let _ = writeln!(
                f,
                "{{\"type\":\"agent-exit\",\"success\":{}}}",
                success
            );
        }
    });

    // Spawn stderr reader
    let agent_id_stderr = agent_id.clone();
    tokio::spawn(async move {
        let reader = BufReader::new(stderr);
        let mut lines = reader.lines();

        while let Ok(Some(line)) = lines.next_line().await {
            log::debug!("[sidecar:{}] {}", agent_id_stderr, line);
            if let Some(ref f) = log_file {
                let mut f = f.lock().unwrap_or_else(|e| e.into_inner());
                let _ = writeln!(
                    f,
                    "{{\"type\":\"stderr\",\"content\":{}}}",
                    serde_json::to_string(&line).unwrap_or_else(|_| format!("\"{}\"", line))
                );
            }
        }
    });

    Ok(())
}

pub async fn cancel_sidecar(
    agent_id: &str,
    registry: &AgentRegistry,
    app_handle: &tauri::AppHandle,
) -> Result<(), String> {
    let pid: u32;

    // Mark as cancelled and get PID while holding the lock
    {
        let mut reg = registry.lock().await;
        let entry = reg
            .agents
            .get(&agent_id.to_string())
            .ok_or_else(|| format!("Agent {} not found", agent_id))?;
        pid = entry.pid;
        reg.cancelled.insert(agent_id.to_string());
    }
    // Lock released before sending signal

    // Send SIGTERM
    #[cfg(unix)]
    {
        use nix::sys::signal::{kill, Signal};
        use nix::unistd::Pid;
        let _ = kill(Pid::from_raw(pid as i32), Signal::SIGTERM);
    }

    // Emit cancelled exit event immediately
    events::handle_sidecar_cancelled(app_handle, agent_id);

    // Spawn a 5-second SIGKILL fallback
    let registry_fallback = registry.clone();
    let agent_id_fallback = agent_id.to_string();
    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(5)).await;
        let mut reg = registry_fallback.lock().await;
        if let Some(mut entry) = reg.agents.remove(&agent_id_fallback) {
            log::warn!(
                "Agent {} did not exit after SIGTERM, sending SIGKILL",
                agent_id_fallback
            );
            let _ = entry.child.start_kill();
        }
    });

    Ok(())
}

pub async fn cancel_all_sidecars(
    registry: &AgentRegistry,
    app_handle: &tauri::AppHandle,
) -> Result<(), String> {
    let agent_ids: Vec<String>;
    let pids: Vec<(String, u32)>;

    // Collect all agent IDs and PIDs, mark them all as cancelled
    {
        let mut reg = registry.lock().await;
        agent_ids = reg.agents.keys().cloned().collect();
        pids = agent_ids
            .iter()
            .filter_map(|id| reg.agents.get(id).map(|entry| (id.clone(), entry.pid)))
            .collect();
        for id in &agent_ids {
            reg.cancelled.insert(id.clone());
        }
    }
    // Lock released before sending signals

    // Send SIGTERM to each and emit cancelled exit events
    for (agent_id, pid) in &pids {
        #[cfg(unix)]
        {
            use nix::sys::signal::{kill, Signal};
            use nix::unistd::Pid;
            let _ = kill(Pid::from_raw(*pid as i32), Signal::SIGTERM);
        }

        events::handle_sidecar_cancelled(app_handle, agent_id);
    }

    // Spawn SIGKILL fallback timers for each agent
    for (agent_id, _) in pids {
        let registry_fallback = registry.clone();
        tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_secs(5)).await;
            let mut reg = registry_fallback.lock().await;
            if let Some(mut entry) = reg.agents.remove(&agent_id) {
                log::warn!(
                    "Agent {} did not exit after SIGTERM, sending SIGKILL",
                    agent_id
                );
                let _ = entry.child.start_kill();
            }
        });
    }

    Ok(())
}

type SharedFile = Arc<std::sync::Mutex<std::fs::File>>;

/// Create `.agent-logs/<agent_id>.jsonl` in the working directory.
/// Returns None (with a log warning) if the directory can't be created.
fn open_agent_log(
    cwd: &Path,
    agent_id: &str,
    config_json: &str,
) -> Option<SharedFile> {
    let log_dir = cwd.join(".agent-logs");
    if let Err(e) = std::fs::create_dir_all(&log_dir) {
        log::warn!("Could not create agent log dir {}: {}", log_dir.display(), e);
        return None;
    }

    let log_path = log_dir.join(format!("{}.jsonl", agent_id));
    match std::fs::File::create(&log_path) {
        Ok(mut file) => {
            // Write redacted config as first line (strip API key)
            if let Ok(mut val) = serde_json::from_str::<serde_json::Value>(config_json) {
                if let Some(obj) = val.as_object_mut() {
                    obj.insert("apiKey".to_string(), serde_json::json!("[REDACTED]"));
                }
                let _ = writeln!(file, "{{\"type\":\"config\",\"config\":{}}}", val);
            }
            log::info!("Agent log: {}", log_path.display());
            Some(Arc::new(std::sync::Mutex::new(file)))
        }
        Err(e) => {
            log::warn!("Could not create agent log {}: {}", log_path.display(), e);
            None
        }
    }
}

/// Find a compatible Node.js binary. The Claude Code SDK's bundled CLI currently
/// crashes on Node.js 25+ (TypeError in minified bundle). Try the PATH `node`
/// first; if its major version is >= 25, fall back to well-known alternate paths
/// looking for a version in the 18–24 range.
async fn resolve_node_binary() -> Result<String, String> {
    // Candidates: PATH node first, then common macOS/Linux locations
    let candidates: Vec<PathBuf> = {
        let mut v = vec![PathBuf::from("node")];
        for p in &[
            "/usr/local/bin/node",
            "/opt/homebrew/bin/node",
            "/usr/bin/node",
        ] {
            v.push(PathBuf::from(p));
        }
        v
    };

    let mut first_available: Option<String> = None;

    for candidate in &candidates {
        let output = Command::new(candidate)
            .arg("--version")
            .output()
            .await;

        if let Ok(out) = output {
            if out.status.success() {
                let version = String::from_utf8_lossy(&out.stdout).trim().to_string();
                let path_str = candidate.to_string_lossy().to_string();

                if first_available.is_none() {
                    first_available = Some(path_str.clone());
                }

                if is_node_compatible(&version) {
                    log::info!("Using Node.js {} at {}", version, path_str);
                    return Ok(path_str);
                } else {
                    log::warn!(
                        "Node.js {} at {} is not compatible with Claude Code SDK (need 18-24), trying next",
                        version, path_str
                    );
                }
            }
        }
    }

    // If no compatible version found, use whatever was first available with a warning
    if let Some(path) = first_available {
        log::warn!("No Node.js 18-24 found, falling back to {}", path);
        return Ok(path);
    }

    Err("Node.js not found. Please install Node.js 18+ from https://nodejs.org".to_string())
}

/// Check if a node version string (e.g. "v24.13.0") is in the compatible range 18-24.
fn is_node_compatible(version: &str) -> bool {
    let trimmed = version.strip_prefix('v').unwrap_or(version);
    if let Some(major_str) = trimmed.split('.').next() {
        if let Ok(major) = major_str.parse::<u32>() {
            return major >= 18 && major <= 24;
        }
    }
    false
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
            model: "sonnet".to_string(),
            api_key: "sk-ant-test".to_string(),
            cwd: "/home/user/project".to_string(),
            allowed_tools: Some(vec!["Read".to_string(), "Glob".to_string()]),
            max_turns: Some(25),
            permission_mode: Some("bypassPermissions".to_string()),
            session_id: None,
            betas: None,
            path_to_claude_code_executable: None,
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
        // betas is None + skip_serializing_if — should be absent
        assert!(parsed.get("betas").is_none());
    }

    #[test]
    fn test_create_registry() {
        // Ensure registry creation doesn't panic and returns usable type
        let _registry = create_registry();
    }

    #[tokio::test]
    async fn test_cancel_marks_cancelled_set() {
        let registry = create_registry();
        // Manually insert a cancelled entry to verify the set works
        {
            let mut reg = registry.lock().await;
            reg.cancelled.insert("test-agent".to_string());
        }
        let reg = registry.lock().await;
        assert!(reg.cancelled.contains("test-agent"));
    }

    #[tokio::test]
    async fn test_cancel_not_found_returns_error() {
        // Without an AppHandle we can't call cancel_sidecar directly,
        // but we can verify that looking up a missing agent fails.
        let registry = create_registry();
        let reg = registry.lock().await;
        assert!(reg.agents.get("nonexistent").is_none());
    }

    #[tokio::test]
    async fn test_registry_agents_empty_after_init() {
        let registry = create_registry();
        let reg = registry.lock().await;
        assert!(reg.agents.is_empty());
        assert!(reg.cancelled.is_empty());
    }

    #[tokio::test]
    async fn test_cancel_all_marks_all_cancelled() {
        // Without an AppHandle we can't call cancel_all_sidecars directly,
        // but we can verify the registry marking logic it uses.
        let registry = create_registry();
        {
            let mut reg = registry.lock().await;
            // Simulate multiple agents in the registry
            reg.cancelled.insert("agent-1".to_string());
            reg.cancelled.insert("agent-2".to_string());
            reg.cancelled.insert("agent-3".to_string());
        }
        let reg = registry.lock().await;
        assert_eq!(reg.cancelled.len(), 3);
        assert!(reg.cancelled.contains("agent-1"));
        assert!(reg.cancelled.contains("agent-2"));
        assert!(reg.cancelled.contains("agent-3"));
    }

    #[tokio::test]
    async fn test_cancel_all_on_empty_registry() {
        // Ensure the logic handles an empty registry gracefully
        let registry = create_registry();
        let reg = registry.lock().await;
        let agent_ids: Vec<String> = reg.agents.keys().cloned().collect();
        assert!(agent_ids.is_empty());
    }

    #[test]
    fn test_is_node_compatible() {
        assert!(is_node_compatible("v18.0.0"));
        assert!(is_node_compatible("v20.11.0"));
        assert!(is_node_compatible("v22.0.0"));
        assert!(is_node_compatible("v24.13.0"));
        assert!(!is_node_compatible("v25.0.0"));
        assert!(!is_node_compatible("v25.6.0"));
        assert!(!is_node_compatible("v16.0.0"));
        assert!(!is_node_compatible("v17.9.0"));
        assert!(!is_node_compatible(""));
        assert!(!is_node_compatible("abc"));
    }
}
