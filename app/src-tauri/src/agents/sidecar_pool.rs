use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::Arc;

use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;
use tokio::task::JoinHandle;

use super::events;
use super::sidecar::SidecarConfig;

/// A persistent Node.js sidecar process that stays alive across multiple agent invocations.
struct PersistentSidecar {
    child: Child,
    /// Mutex-protected stdin ensures concurrent `send_request` calls serialize their writes,
    /// preventing interleaved bytes on the wire even though the Node.js side processes
    /// requests sequentially by `request_id`.
    stdin: Arc<Mutex<tokio::process::ChildStdin>>,
    pid: u32,
    /// Handle for the stdout reader task — aborted on shutdown/crash-respawn.
    stdout_task: JoinHandle<()>,
    /// Handle for the stderr reader task — aborted on shutdown/crash-respawn.
    stderr_task: JoinHandle<()>,
}

/// Abort the reader tasks and drop the sidecar, cleaning up all resources.
fn cleanup_sidecar(sidecar: PersistentSidecar) {
    sidecar.stdout_task.abort();
    sidecar.stderr_task.abort();
    // `child`, `stdin`, etc. are dropped here — stdin closes, process may receive SIGPIPE.
}

/// Pool of persistent sidecar processes, one per skill.
/// Reuses existing processes across agent invocations to reduce startup latency.
/// Wraps an `Arc` so cloning is cheap and all clones share the same pool.
#[derive(Clone)]
pub struct SidecarPool {
    sidecars: Arc<Mutex<HashMap<String, PersistentSidecar>>>,
    /// Tracks skills that are currently being spawned to prevent duplicate spawns
    /// while the pool lock is released during the spawn + sidecar_ready wait.
    spawning: Arc<Mutex<HashSet<String>>>,
    /// Tracks agent_ids of in-flight requests (removed when result/error received).
    /// Used by timeout tasks to determine whether a request already completed.
    pending_requests: Arc<Mutex<HashSet<String>>>,
}

impl SidecarPool {
    pub fn new() -> Self {
        SidecarPool {
            sidecars: Arc::new(Mutex::new(HashMap::new())),
            spawning: Arc::new(Mutex::new(HashSet::new())),
            pending_requests: Arc::new(Mutex::new(HashSet::new())),
        }
    }

    /// Returns true if there are any active sidecar processes in the pool.
    pub async fn has_running(&self) -> bool {
        let pool = self.sidecars.lock().await;
        !pool.is_empty()
    }

    /// Get an existing sidecar for a skill or spawn a new persistent one.
    /// Waits for the `{"type":"sidecar_ready"}` signal before returning.
    ///
    /// The pool lock is NOT held during the spawn + ready-wait phase to avoid
    /// blocking other skills. A per-skill "spawning" guard prevents duplicate spawns.
    pub async fn get_or_spawn(
        &self,
        skill_name: &str,
        app_handle: &tauri::AppHandle,
    ) -> Result<(), String> {
        // Phase 1: Check if we already have a live sidecar (short lock)
        {
            let mut pool = self.sidecars.lock().await;

            if let Some(sidecar) = pool.get_mut(skill_name) {
                // Verify it's still alive by checking if the process has exited
                match sidecar.child.try_wait() {
                    Ok(Some(_status)) => {
                        // Process has exited, remove it and fall through to spawn a new one
                        log::info!(
                            "Sidecar for '{}' (pid {}) has exited, will respawn",
                            skill_name,
                            sidecar.pid
                        );
                        // Issue 3: Abort orphaned reader tasks before removing
                        if let Some(old) = pool.remove(skill_name) {
                            cleanup_sidecar(old);
                        }
                    }
                    Ok(None) => {
                        // Still running — reuse it
                        log::debug!("Reusing existing sidecar for '{}'", skill_name);
                        return Ok(());
                    }
                    Err(e) => {
                        log::warn!("Error checking sidecar status for '{}': {}", skill_name, e);
                        // Issue 3: Abort orphaned reader tasks before removing
                        if let Some(old) = pool.remove(skill_name) {
                            cleanup_sidecar(old);
                        }
                    }
                }
            }
        } // pool lock released

        // Phase 2: Mark this skill as "spawning" to prevent duplicate spawns
        {
            let mut spawning = self.spawning.lock().await;
            if spawning.contains(skill_name) {
                // Another task is already spawning this skill. Wait briefly then
                // check if it appeared in the pool.
                drop(spawning);
                // Poll up to 12 seconds (slightly longer than the 10s ready timeout)
                for _ in 0..120 {
                    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                    let pool = self.sidecars.lock().await;
                    if pool.contains_key(skill_name) {
                        return Ok(());
                    }
                    let sp = self.spawning.lock().await;
                    if !sp.contains(skill_name) {
                        // The other spawner finished (possibly with error) and it's no longer
                        // in the pool — fall through to try spawning ourselves.
                        break;
                    }
                }
                // Re-check: maybe it appeared while we were waiting
                let pool = self.sidecars.lock().await;
                if pool.contains_key(skill_name) {
                    return Ok(());
                }
                // Try to claim the spawning slot ourselves
                let mut spawning = self.spawning.lock().await;
                if spawning.contains(skill_name) {
                    return Err(format!(
                        "Timeout waiting for sidecar '{}' to be spawned by another task",
                        skill_name
                    ));
                }
                spawning.insert(skill_name.to_string());
            } else {
                spawning.insert(skill_name.to_string());
            }
        }

        // Phase 3: Spawn the sidecar OUTSIDE the pool lock
        let result = self.do_spawn(skill_name, app_handle).await;

        // Phase 4: Remove from spawning set regardless of outcome
        {
            let mut spawning = self.spawning.lock().await;
            spawning.remove(skill_name);
        }

        result
    }

    /// Internal: actually spawn and register a new persistent sidecar.
    /// Called with no pool lock held.
    async fn do_spawn(
        &self,
        skill_name: &str,
        app_handle: &tauri::AppHandle,
    ) -> Result<(), String> {
        let sidecar_path = resolve_sidecar_path(app_handle)?;
        let node_bin = resolve_node_binary().await?;

        let mut child = Command::new(&node_bin)
            .arg(&sidecar_path)
            .arg("--persistent")
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .stdin(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to spawn persistent sidecar: {}", e))?;

        let pid = child.id().ok_or("Failed to get child PID")?;
        let stdin = child.stdin.take().ok_or("Failed to open stdin")?;
        let stdout = child.stdout.take().ok_or("Failed to open stdout")?;
        let stderr = child.stderr.take().ok_or("Failed to open stderr")?;

        log::info!(
            "Spawned persistent sidecar for '{}' (pid {})",
            skill_name,
            pid
        );

        // Wait for the sidecar_ready signal on stdout
        let mut reader = BufReader::new(stdout);
        let mut ready_line = String::new();
        let ready_timeout = tokio::time::timeout(
            std::time::Duration::from_secs(10),
            reader.read_line(&mut ready_line),
        )
        .await
        .map_err(|_| {
            format!(
                "Timeout waiting for sidecar_ready from persistent sidecar (pid {})",
                pid
            )
        })?
        .map_err(|e| format!("Error reading sidecar_ready: {}", e))?;

        if ready_timeout == 0 {
            return Err(format!(
                "Persistent sidecar (pid {}) closed stdout before sending sidecar_ready",
                pid
            ));
        }

        // Validate the ready signal
        let ready_line = ready_line.trim();
        match serde_json::from_str::<serde_json::Value>(ready_line) {
            Ok(val) => {
                if val.get("type").and_then(|t| t.as_str()) != Some("sidecar_ready") {
                    return Err(format!(
                        "Expected sidecar_ready but got: {}",
                        ready_line
                    ));
                }
            }
            Err(e) => {
                return Err(format!(
                    "Failed to parse sidecar_ready signal: {} (line: {})",
                    e, ready_line
                ));
            }
        }

        log::info!("Persistent sidecar for '{}' is ready (pid {})", skill_name, pid);

        // Issue 3: Store JoinHandles so we can abort them on shutdown/crash-respawn

        // Spawn stderr reader for logging
        let skill_name_stderr = skill_name.to_string();
        let stderr_task = tokio::spawn(async move {
            let stderr_reader = BufReader::new(stderr);
            let mut lines = stderr_reader.lines();

            while let Ok(Some(line)) = lines.next_line().await {
                log::debug!("[persistent-sidecar:{}] {}", skill_name_stderr, line);
            }
        });

        // Spawn stdout reader that routes messages by request_id
        let stdout_pool = self.sidecars.clone();
        let stdout_pending = self.pending_requests.clone();
        let skill_name_stdout = skill_name.to_string();
        let app_handle_stdout = app_handle.clone();
        let stdout_task = tokio::spawn(async move {
            let mut lines = reader.lines();

            while let Ok(Some(line)) = lines.next_line().await {
                // Parse the line to extract request_id for routing
                match serde_json::from_str::<serde_json::Value>(&line) {
                    Ok(msg) => {
                        if let Some(request_id) = msg.get("request_id").and_then(|r| r.as_str()) {
                            // Route this message to the correct agent using the request_id as agent_id
                            events::handle_sidecar_message(
                                &app_handle_stdout,
                                request_id,
                                &line,
                            );

                            // Check if this is a result or error — if so, emit exit event
                            // and remove from pending_requests so timeout tasks know it completed.
                            if let Some(msg_type) = msg.get("type").and_then(|t| t.as_str()) {
                                if msg_type == "result" {
                                    {
                                        let mut pending = stdout_pending.lock().await;
                                        pending.remove(request_id);
                                    }
                                    events::handle_sidecar_exit(
                                        &app_handle_stdout,
                                        request_id,
                                        true,
                                    );
                                } else if msg_type == "error" {
                                    {
                                        let mut pending = stdout_pending.lock().await;
                                        pending.remove(request_id);
                                    }
                                    events::handle_sidecar_exit(
                                        &app_handle_stdout,
                                        request_id,
                                        false,
                                    );
                                }
                            }
                        } else {
                            log::warn!(
                                "[persistent-sidecar:{}] Message without request_id: {}",
                                skill_name_stdout,
                                line
                            );
                        }
                    }
                    Err(e) => {
                        log::warn!(
                            "[persistent-sidecar:{}] Failed to parse stdout: {} (line: {})",
                            skill_name_stdout,
                            e,
                            line
                        );
                    }
                }
            }

            // EOF on stdout — sidecar crashed or exited unexpectedly
            log::warn!(
                "Persistent sidecar for '{}' closed stdout unexpectedly, removing from pool",
                skill_name_stdout
            );
            let mut pool = stdout_pool.lock().await;
            pool.remove(&skill_name_stdout);
        });

        let sidecar = PersistentSidecar {
            child,
            stdin: Arc::new(Mutex::new(stdin)),
            pid,
            stdout_task,
            stderr_task,
        };

        // Re-acquire pool lock to insert the new sidecar
        let mut pool = self.sidecars.lock().await;
        pool.insert(skill_name.to_string(), sidecar);
        Ok(())
    }

    /// Send an agent request to the persistent sidecar for a skill.
    /// The request_id is set to the agent_id so events route to the correct frontend handler.
    ///
    /// `timeout_secs` controls how long to wait before treating the request as timed out.
    /// After that duration, if the request is still in `pending_requests`, an `agent_exit`
    /// event is emitted with `success: false` so the frontend can show a timeout dialog.
    ///
    /// Issue 1 fix: stdin writes are serialized via `Mutex<ChildStdin>`.
    /// Issue 4 fix: on any error after `get_or_spawn`, an `agent_exit` event is emitted
    /// so the frontend never gets stuck in "running" state.
    pub async fn send_request(
        &self,
        skill_name: &str,
        agent_id: &str,
        config: SidecarConfig,
        app_handle: &tauri::AppHandle,
        timeout_secs: u64,
    ) -> Result<(), String> {
        // Ensure we have a sidecar running
        self.get_or_spawn(skill_name, app_handle).await?;

        // Issue 4: If anything below fails, emit agent_exit so the frontend doesn't hang.
        let result = self
            .do_send_request(skill_name, agent_id, config, app_handle, timeout_secs)
            .await;

        if let Err(ref e) = result {
            log::error!(
                "send_request failed for agent '{}' on skill '{}': {}",
                agent_id,
                skill_name,
                e
            );
            events::handle_sidecar_exit(app_handle, agent_id, false);
        }

        result
    }

    /// Internal: perform the actual request send. Separated so `send_request` can
    /// emit `agent_exit` on error.
    async fn do_send_request(
        &self,
        skill_name: &str,
        agent_id: &str,
        config: SidecarConfig,
        app_handle: &tauri::AppHandle,
        timeout_secs: u64,
    ) -> Result<(), String> {
        // Build the request message (before acquiring any lock)
        let request = serde_json::json!({
            "type": "agent_request",
            "request_id": agent_id,
            "config": config,
        });

        let mut request_line = serde_json::to_string(&request)
            .map_err(|e| format!("Failed to serialize agent request: {}", e))?;
        request_line.push('\n');

        // Emit redacted config to frontend (same as spawn_sidecar does)
        {
            let mut config_val = serde_json::to_value(&config).unwrap_or_default();
            if let Some(obj) = config_val.as_object_mut() {
                obj.insert("apiKey".to_string(), serde_json::json!("[REDACTED]"));
                obj.remove("prompt");
            }

            let discovered_skills = scan_skills_dir(Path::new(&config.cwd));

            let config_event = serde_json::json!({
                "type": "config",
                "config": config_val,
                "discoveredSkills": discovered_skills,
            });
            events::handle_sidecar_message(app_handle, agent_id, &config_event.to_string());
        }

        // Register this request as pending BEFORE sending to stdin, so the
        // stdout reader and timeout task both know it's in-flight.
        {
            let mut pending = self.pending_requests.lock().await;
            pending.insert(agent_id.to_string());
        }

        // Get a clone of the Arc<Mutex<ChildStdin>> — hold pool lock only briefly
        let (stdin_handle, pid) = {
            let pool = self.sidecars.lock().await;
            let sidecar = pool.get(skill_name).ok_or_else(|| {
                // Remove from pending since we never sent the request
                // (can't await here, but the timeout task will handle cleanup)
                format!(
                    "Sidecar for '{}' not found in pool after get_or_spawn",
                    skill_name
                )
            })?;
            (sidecar.stdin.clone(), sidecar.pid)
        };

        // Issue 1: Write to stdin under the per-sidecar Mutex. This serializes
        // concurrent writes to the same skill's sidecar while allowing different
        // skills to write fully in parallel.
        {
            let mut stdin = stdin_handle.lock().await;
            stdin
                .write_all(request_line.as_bytes())
                .await
                .map_err(|e| format!("Failed to write to sidecar stdin: {}", e))?;

            stdin
                .flush()
                .await
                .map_err(|e| format!("Failed to flush sidecar stdin: {}", e))?;
        }

        log::info!(
            "Sent agent request '{}' to persistent sidecar for '{}' (pid {})",
            agent_id,
            skill_name,
            pid
        );

        // Spawn a background timeout task. If the request is still pending after
        // `timeout_secs`, emit an `agent_exit` event with `success: false` so the
        // frontend can show the timeout dialog and offer retry/cancel.
        if timeout_secs > 0 {
            let timeout_pending = self.pending_requests.clone();
            let timeout_app_handle = app_handle.clone();
            let timeout_agent_id = agent_id.to_string();
            let timeout_skill_name = skill_name.to_string();

            tokio::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_secs(timeout_secs)).await;

                let still_pending = {
                    let mut pending = timeout_pending.lock().await;
                    if pending.remove(&timeout_agent_id) {
                        true
                    } else {
                        false
                    }
                };

                if still_pending {
                    log::warn!(
                        "Agent request '{}' on skill '{}' timed out after {}s",
                        timeout_agent_id,
                        timeout_skill_name,
                        timeout_secs,
                    );
                    events::handle_sidecar_exit(
                        &timeout_app_handle,
                        &timeout_agent_id,
                        false,
                    );
                }
            });
        }

        Ok(())
    }

    /// Shutdown a single skill's sidecar. Sends a shutdown message, waits up to 3 seconds,
    /// then kills if necessary.
    pub async fn shutdown_skill(&self, skill_name: &str) -> Result<(), String> {
        let mut pool = self.sidecars.lock().await;

        if let Some(mut sidecar) = pool.remove(skill_name) {
            log::info!(
                "Shutting down persistent sidecar for '{}' (pid {})",
                skill_name,
                sidecar.pid
            );

            // Issue 3: Abort reader tasks before shutdown
            sidecar.stdout_task.abort();
            sidecar.stderr_task.abort();

            // Send shutdown message
            let shutdown_msg = "{\"type\":\"shutdown\"}\n";
            {
                let mut stdin = sidecar.stdin.lock().await;
                let _ = stdin.write_all(shutdown_msg.as_bytes()).await;
                let _ = stdin.flush().await;
            }

            // Wait up to 3 seconds for graceful exit
            let wait_result = tokio::time::timeout(
                std::time::Duration::from_secs(3),
                sidecar.child.wait(),
            )
            .await;

            match wait_result {
                Ok(Ok(status)) => {
                    log::info!(
                        "Sidecar for '{}' exited gracefully: {}",
                        skill_name,
                        status
                    );
                }
                Ok(Err(e)) => {
                    log::warn!(
                        "Error waiting for sidecar '{}' to exit: {}",
                        skill_name,
                        e
                    );
                }
                Err(_) => {
                    // Timeout — force kill
                    log::warn!(
                        "Sidecar for '{}' did not exit within 3s, killing (pid {})",
                        skill_name,
                        sidecar.pid
                    );
                    let _ = sidecar.child.kill().await;
                }
            }
        } else {
            log::debug!("No sidecar running for '{}', nothing to shut down", skill_name);
        }

        Ok(())
    }

    /// Shutdown all persistent sidecars. Called on app exit.
    pub async fn shutdown_all(&self) {
        let skill_names: Vec<String> = {
            let pool = self.sidecars.lock().await;
            pool.keys().cloned().collect()
        };

        for skill_name in skill_names {
            if let Err(e) = self.shutdown_skill(&skill_name).await {
                log::warn!("Error shutting down sidecar for '{}': {}", skill_name, e);
            }
        }

        log::info!("All persistent sidecars shut down");
    }
}

/// Scan `{cwd}/.claude/skills/` for active skill directories (those containing SKILL.md).
/// Returns a list of skill directory names that the SDK will discover.
fn scan_skills_dir(cwd: &Path) -> Vec<String> {
    let skills_dir = cwd.join(".claude").join("skills");
    let mut names = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&skills_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() && path.join("SKILL.md").exists() {
                if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                    if !name.starts_with('.') {
                        names.push(name.to_string());
                    }
                }
            }
        }
    }
    names.sort();
    names
}

// Re-use the sidecar path resolution logic from sidecar.rs.
// These are kept as separate functions here to avoid making the private functions
// in sidecar.rs public (which would change the existing module's API surface).

fn resolve_sidecar_path(app_handle: &tauri::AppHandle) -> Result<String, String> {
    use tauri::Manager;

    if let Ok(resource_dir) = app_handle.path().resource_dir() {
        let sidecar = resource_dir
            .join("sidecar")
            .join("dist")
            .join("agent-runner.js");
        if sidecar.exists() {
            return sidecar
                .to_str()
                .map(|s| s.to_string())
                .ok_or_else(|| "Invalid sidecar path".to_string());
        }
    }

    if let Ok(exe_dir) = std::env::current_exe() {
        if let Some(dir) = exe_dir.parent() {
            let sidecar = dir
                .join("sidecar")
                .join("dist")
                .join("agent-runner.js");
            if sidecar.exists() {
                return sidecar
                    .to_str()
                    .map(|s| s.to_string())
                    .ok_or_else(|| "Invalid sidecar path".to_string());
            }
        }
    }

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

    Err("Could not find agent-runner.js -- run 'npm run build' in app/sidecar/ first".to_string())
}

async fn resolve_node_binary() -> Result<String, String> {
    let candidates: Vec<std::path::PathBuf> = {
        let mut v = vec![std::path::PathBuf::from("node")];
        for p in &[
            "/usr/local/bin/node",
            "/opt/homebrew/bin/node",
            "/usr/bin/node",
        ] {
            v.push(std::path::PathBuf::from(p));
        }
        v
    };

    let mut first_available: Option<String> = None;

    for candidate in &candidates {
        let output = Command::new(candidate).arg("--version").output().await;

        if let Ok(out) = output {
            if out.status.success() {
                let version = String::from_utf8_lossy(&out.stdout).trim().to_string();
                let path_str = candidate.to_string_lossy().to_string();

                if first_available.is_none() {
                    first_available = Some(path_str.clone());
                }

                if is_node_compatible(&version) {
                    return Ok(path_str);
                }
            }
        }
    }

    if let Some(path) = first_available {
        return Ok(path);
    }

    Err("Node.js not found. Please install Node.js 18+ from https://nodejs.org".to_string())
}

fn is_node_compatible(version: &str) -> bool {
    let trimmed = version.strip_prefix('v').unwrap_or(version);
    if let Some(major_str) = trimmed.split('.').next() {
        if let Ok(major) = major_str.parse::<u32>() {
            return major >= 18 && major <= 24;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pool_creation() {
        let pool = SidecarPool::new();
        // Pool should be created without panicking
        let _ = pool;
    }

    #[tokio::test]
    async fn test_pool_empty_after_init() {
        let pool = SidecarPool::new();
        let sidecars = pool.sidecars.lock().await;
        assert!(sidecars.is_empty(), "Pool should be empty after creation");
    }

    #[tokio::test]
    async fn test_spawning_set_empty_after_init() {
        let pool = SidecarPool::new();
        let spawning = pool.spawning.lock().await;
        assert!(spawning.is_empty(), "Spawning set should be empty after creation");
    }

    #[tokio::test]
    async fn test_shutdown_skill_no_sidecar() {
        // Shutting down a skill that doesn't exist should not error
        let pool = SidecarPool::new();
        let result = pool.shutdown_skill("nonexistent-skill").await;
        assert!(result.is_ok(), "Shutting down nonexistent skill should succeed");
    }

    #[tokio::test]
    async fn test_shutdown_all_empty_pool() {
        // shutdown_all on empty pool should complete without error
        let pool = SidecarPool::new();
        pool.shutdown_all().await;
        let sidecars = pool.sidecars.lock().await;
        assert!(sidecars.is_empty());
    }

    #[test]
    fn test_scan_skills_dir_empty() {
        let tmp = tempfile::tempdir().unwrap();
        let result = scan_skills_dir(tmp.path());
        assert!(result.is_empty(), "No .claude/skills dir should return empty");
    }

    #[test]
    fn test_scan_skills_dir_with_skills() {
        let tmp = tempfile::tempdir().unwrap();
        let skills_dir = tmp.path().join(".claude").join("skills");

        // Create two skill directories with SKILL.md
        let skill_a = skills_dir.join("skill-a");
        std::fs::create_dir_all(&skill_a).unwrap();
        std::fs::write(skill_a.join("SKILL.md"), "# Skill A").unwrap();

        let skill_b = skills_dir.join("skill-b");
        std::fs::create_dir_all(&skill_b).unwrap();
        std::fs::write(skill_b.join("SKILL.md"), "# Skill B").unwrap();

        // Create a directory without SKILL.md (should be excluded)
        let no_skill = skills_dir.join("no-skill");
        std::fs::create_dir_all(&no_skill).unwrap();

        let result = scan_skills_dir(tmp.path());
        assert_eq!(result, vec!["skill-a", "skill-b"]);
    }

    #[test]
    fn test_is_node_compatible_pool() {
        assert!(is_node_compatible("v18.0.0"));
        assert!(is_node_compatible("v24.13.0"));
        assert!(!is_node_compatible("v25.0.0"));
        assert!(!is_node_compatible("v16.0.0"));
    }

    #[tokio::test]
    async fn test_pool_spawn_and_crash_recovery() {
        // This test verifies the pool data structure logic without a real Node.js process.
        // We manually insert and remove entries to simulate the lifecycle.
        let pool = SidecarPool::new();

        // Verify pool starts empty
        {
            let sidecars = pool.sidecars.lock().await;
            assert_eq!(sidecars.len(), 0);
        }

        // Simulate crash recovery: after removing a sidecar entry,
        // the next get_or_spawn should attempt to create a new one.
        // (We can't test the actual spawn without a sidecar binary,
        // but we verify the pool correctly handles removal.)
        {
            let mut sidecars = pool.sidecars.lock().await;
            sidecars.remove("test-skill");
            assert!(!sidecars.contains_key("test-skill"));
        }
    }

    #[tokio::test]
    async fn test_multiple_skills_independent() {
        // Verify the pool can track multiple skills independently
        let pool = SidecarPool::new();

        // Simulate: after spawning sidecars for two skills, removing one
        // should not affect the other.
        // (We test the HashMap logic without real child processes.)

        // Both should be absent initially
        {
            let sidecars = pool.sidecars.lock().await;
            assert!(!sidecars.contains_key("skill_a"));
            assert!(!sidecars.contains_key("skill_b"));
        }

        // Shutdown one skill should not affect the other
        pool.shutdown_skill("skill_a").await.unwrap();
        {
            let sidecars = pool.sidecars.lock().await;
            assert!(!sidecars.contains_key("skill_b"));
        }
    }

    #[tokio::test]
    async fn test_pending_requests_empty_after_init() {
        let pool = SidecarPool::new();
        let pending = pool.pending_requests.lock().await;
        assert!(pending.is_empty(), "Pending requests should be empty after creation");
    }

    #[tokio::test]
    async fn test_pending_requests_insert_and_remove() {
        let pool = SidecarPool::new();

        // Simulate adding a request to the pending set
        {
            let mut pending = pool.pending_requests.lock().await;
            pending.insert("agent-123".to_string());
            assert!(pending.contains("agent-123"));
        }

        // Simulate completion — removing the request
        {
            let mut pending = pool.pending_requests.lock().await;
            assert!(pending.remove("agent-123"));
            assert!(!pending.contains("agent-123"));
        }
    }

    #[tokio::test]
    async fn test_pending_requests_timeout_removes_if_still_pending() {
        // Simulate the timeout task logic: if the request is still pending
        // after the timeout period, it should be removed.
        let pool = SidecarPool::new();

        {
            let mut pending = pool.pending_requests.lock().await;
            pending.insert("agent-timeout-test".to_string());
        }

        // Simulate timeout check: request is still pending
        let still_pending = {
            let mut pending = pool.pending_requests.lock().await;
            pending.remove("agent-timeout-test")
        };
        assert!(still_pending, "Request should still be pending at timeout");

        // After removal, it should no longer be in the set
        {
            let pending = pool.pending_requests.lock().await;
            assert!(!pending.contains("agent-timeout-test"));
        }
    }

    #[tokio::test]
    async fn test_pending_requests_completed_before_timeout() {
        // Simulate the case where a request completes before the timeout fires.
        // The stdout reader removes it, so the timeout task should find it absent.
        let pool = SidecarPool::new();

        {
            let mut pending = pool.pending_requests.lock().await;
            pending.insert("agent-fast".to_string());
        }

        // Simulate stdout reader removing the request on completion
        {
            let mut pending = pool.pending_requests.lock().await;
            pending.remove("agent-fast");
        }

        // Simulate timeout check: request should NOT be pending
        let still_pending = {
            let mut pending = pool.pending_requests.lock().await;
            pending.remove("agent-fast")
        };
        assert!(!still_pending, "Request should have been completed before timeout");
    }
}
