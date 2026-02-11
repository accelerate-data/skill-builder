use std::collections::HashMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use chrono::Utc;
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
}

pub type AgentRegistry = Arc<Mutex<Registry>>;

pub fn create_registry() -> AgentRegistry {
    Arc::new(Mutex::new(Registry {
        agents: HashMap::new(),
    }))
}

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
    #[serde(
        rename = "pathToClaudeCodeExecutable",
        skip_serializing_if = "Option::is_none"
    )]
    pub path_to_claude_code_executable: Option<String>,
    #[serde(rename = "agentName", skip_serializing_if = "Option::is_none")]
    pub agent_name: Option<String>,
}

pub async fn spawn_sidecar(
    agent_id: String,
    mut config: SidecarConfig,
    registry: AgentRegistry,
    app_handle: tauri::AppHandle,
    skill_name: String,
    step_label: String,
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
    let log_file = open_agent_log(Path::new(&config.cwd), &skill_name, &step_label, &config_json);

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
        {
            let mut reg = registry_stdout.lock().await;
            if let Some(mut entry) = reg.agents.remove(&agent_id_stdout) {
                match entry.child.try_wait() {
                    Ok(Some(status)) => {
                        success = status.success();
                    }
                    _ => {}
                }
            }
        }

        events::handle_sidecar_exit(&app_handle_stdout, &agent_id_stdout, success);

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

type SharedFile = Arc<std::sync::Mutex<std::fs::File>>;

/// Convert a step name to a filename-safe slug: lowercase, spaces→hyphens.
fn slugify_step_label(label: &str) -> String {
    label
        .to_lowercase()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join("-")
}

/// Build the log directory path: `{cwd}/{skill_name}/logs/`
fn build_log_dir(cwd: &Path, skill_name: &str) -> PathBuf {
    cwd.join(skill_name).join("logs")
}

/// Build the log filename: `{step_label_slug}-{timestamp}.jsonl`
/// where timestamp is ISO 8601 with colons replaced by hyphens.
fn build_log_filename(step_label: &str) -> String {
    let slug = slugify_step_label(step_label);
    let ts = Utc::now().format("%Y-%m-%dT%H-%M-%S").to_string();
    format!("{}-{}.jsonl", slug, ts)
}

/// Create `{cwd}/{skill_name}/logs/{step_label}-{timestamp}.jsonl`.
/// Returns None (with a log warning) if the directory can't be created.
fn open_agent_log(
    cwd: &Path,
    skill_name: &str,
    step_label: &str,
    config_json: &str,
) -> Option<SharedFile> {
    let log_dir = build_log_dir(cwd, skill_name);
    if let Err(e) = std::fs::create_dir_all(&log_dir) {
        log::warn!("Could not create agent log dir {}: {}", log_dir.display(), e);
        return None;
    }

    let filename = build_log_filename(step_label);
    let log_path = log_dir.join(&filename);
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
            model: Some("sonnet".to_string()),
            api_key: "sk-ant-test".to_string(),
            cwd: "/home/user/project".to_string(),
            allowed_tools: Some(vec!["Read".to_string(), "Glob".to_string()]),
            max_turns: Some(25),
            permission_mode: Some("bypassPermissions".to_string()),
            session_id: None,
            betas: None,
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
    }

    #[test]
    fn test_create_registry() {
        // Ensure registry creation doesn't panic and returns usable type
        let _registry = create_registry();
    }

    #[tokio::test]
    async fn test_registry_agents_empty_after_init() {
        let registry = create_registry();
        let reg = registry.lock().await;
        assert!(reg.agents.is_empty());
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

    // --- Log path and filename tests ---

    #[test]
    fn test_slugify_step_label_basic() {
        assert_eq!(slugify_step_label("Research Concepts"), "research-concepts");
        assert_eq!(slugify_step_label("Build Skill"), "build-skill");
        assert_eq!(slugify_step_label("Validate"), "validate");
        assert_eq!(slugify_step_label("Perform Research"), "perform-research");
    }

    #[test]
    fn test_slugify_step_label_already_slugified() {
        assert_eq!(slugify_step_label("research-concepts"), "research-concepts");
        assert_eq!(slugify_step_label("step0-research"), "step0-research");
    }

    #[test]
    fn test_slugify_step_label_extra_whitespace() {
        assert_eq!(slugify_step_label("  Build   Skill  "), "build-skill");
    }

    #[test]
    fn test_slugify_step_label_empty() {
        assert_eq!(slugify_step_label(""), "");
    }

    #[test]
    fn test_build_log_dir() {
        let dir = build_log_dir(Path::new("/workspace"), "my-skill");
        assert_eq!(dir, PathBuf::from("/workspace/my-skill/logs"));
    }

    #[test]
    fn test_build_log_dir_nested_workspace() {
        let dir = build_log_dir(Path::new("/home/user/.vibedata"), "ecommerce-domain");
        assert_eq!(
            dir,
            PathBuf::from("/home/user/.vibedata/ecommerce-domain/logs")
        );
    }

    #[test]
    fn test_build_log_filename_format() {
        let filename = build_log_filename("Research Concepts");
        // Should start with the slugified label
        assert!(
            filename.starts_with("research-concepts-"),
            "Filename should start with slugified label: {}",
            filename
        );
        // Should end with .jsonl
        assert!(filename.ends_with(".jsonl"), "Filename should end with .jsonl: {}", filename);
        // Should NOT contain colons (invalid on Windows)
        assert!(
            !filename.contains(':'),
            "Filename should not contain colons: {}",
            filename
        );
        // Should match pattern: slug-YYYY-MM-DDTHH-MM-SS.jsonl
        let without_ext = filename.trim_end_matches(".jsonl");
        let parts: Vec<&str> = without_ext.rsplitn(2, "concepts-").collect();
        assert_eq!(parts.len(), 2, "Should split at label-timestamp boundary: {}", filename);
        let ts_part = parts[0]; // e.g., "2026-02-11T09-30-00"
        assert_eq!(ts_part.len(), 19, "Timestamp should be 19 chars (YYYY-MM-DDTHH-MM-SS): {}", ts_part);
    }

    #[test]
    fn test_build_log_filename_no_colons_in_timestamp() {
        // Verify timestamp uses hyphens instead of colons
        let filename = build_log_filename("step0");
        let ts_section = filename
            .trim_start_matches("step0-")
            .trim_end_matches(".jsonl");
        // Timestamp format: YYYY-MM-DDTHH-MM-SS — contains T but no colons
        assert!(ts_section.contains('T'), "Should contain T separator: {}", ts_section);
        assert!(!ts_section.contains(':'), "Should not contain colons: {}", ts_section);
    }

    #[test]
    fn test_open_agent_log_creates_directory_and_file() {
        let tmp = tempfile::tempdir().unwrap();
        let cwd = tmp.path();
        let config_json = r#"{"prompt":"test","apiKey":"sk-secret","cwd":"."}"#;

        let log_file = open_agent_log(cwd, "my-skill", "Research Concepts", config_json);
        assert!(log_file.is_some(), "open_agent_log should return Some");

        // Verify directory was created
        let log_dir = cwd.join("my-skill").join("logs");
        assert!(log_dir.is_dir(), "logs directory should exist");

        // Verify a .jsonl file was created in the directory
        let entries: Vec<_> = std::fs::read_dir(&log_dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .collect();
        assert_eq!(entries.len(), 1, "Should have exactly one log file");
        let filename = entries[0].file_name().to_string_lossy().to_string();
        assert!(filename.starts_with("research-concepts-"), "Filename should start with slug: {}", filename);
        assert!(filename.ends_with(".jsonl"), "Filename should end with .jsonl: {}", filename);
    }

    #[test]
    fn test_open_agent_log_redacts_api_key() {
        let tmp = tempfile::tempdir().unwrap();
        let cwd = tmp.path();
        let config_json = r#"{"prompt":"test","apiKey":"sk-ant-secret-key-123","cwd":"."}"#;

        let _log_file = open_agent_log(cwd, "my-skill", "Validate", config_json);

        // Read the log file and verify API key is redacted
        let log_dir = cwd.join("my-skill").join("logs");
        let entries: Vec<_> = std::fs::read_dir(&log_dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .collect();
        let content = std::fs::read_to_string(entries[0].path()).unwrap();
        assert!(content.contains("[REDACTED]"), "API key should be redacted");
        assert!(!content.contains("sk-ant-secret-key-123"), "Raw API key should not appear");
    }

    #[test]
    fn test_open_agent_log_multiple_calls_create_separate_files() {
        let tmp = tempfile::tempdir().unwrap();
        let cwd = tmp.path();
        let config_json = r#"{"prompt":"test","apiKey":"sk-test","cwd":"."}"#;

        let _f1 = open_agent_log(cwd, "my-skill", "step0", config_json);
        // Small delay to ensure different timestamp
        std::thread::sleep(std::time::Duration::from_millis(1100));
        let _f2 = open_agent_log(cwd, "my-skill", "step2", config_json);

        let log_dir = cwd.join("my-skill").join("logs");
        let entries: Vec<_> = std::fs::read_dir(&log_dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .collect();
        assert_eq!(entries.len(), 2, "Should have two separate log files");
    }
}
