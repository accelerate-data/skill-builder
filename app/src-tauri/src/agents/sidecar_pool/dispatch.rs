use std::io::Write as _;
use std::panic::AssertUnwindSafe;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::Arc;

use futures::FutureExt;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::sync::Mutex;

use super::pool::SidecarPool;
use super::process::{
    cleanup_sidecar, handle_stdout_line, remove_and_cleanup_sidecar, spawn_heartbeat_task,
    LaunchedProcess, PersistentSidecar, RequestLogFile, StdoutContext,
};
use super::startup_error::SidecarStartupError;
use crate::agents::node_resolver::NodeBinaryError;
use crate::agents::sidecar::SidecarConfig;
use crate::agents::{events, node_resolver, sidecar_path};

fn build_config_event_payload(config: &SidecarConfig) -> serde_json::Value {
    let mut config_val = serde_json::to_value(config).unwrap_or_default();
    if let Some(obj) = config_val.as_object_mut() {
        obj.insert("apiKey".to_string(), serde_json::json!("[REDACTED]"));
        obj.remove("prompt");
    }

    serde_json::json!({
        "type": "config",
        "config": config_val,
    })
}

fn build_transcript_first_line(config: &SidecarConfig) -> serde_json::Value {
    let mut config_val = serde_json::to_value(config).unwrap_or_default();
    if let Some(obj) = config_val.as_object_mut() {
        obj.insert("apiKey".to_string(), serde_json::json!("[REDACTED]"));
    }

    serde_json::json!({
        "type": "config",
        "config": config_val,
    })
}

impl SidecarPool {
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

    /// Pre-flight validation: check sidecar path and Node.js BEFORE attempting to spawn.
    /// Returns immediately with a structured error if anything is wrong, avoiding the
    /// 10-second timeout that users would otherwise experience.
    async fn preflight_check(
        &self,
        app_handle: &tauri::AppHandle,
    ) -> Result<(String, String), SidecarStartupError> {
        // 1. Check sidecar bundle exists
        let sidecar_path = sidecar_path::resolve_sidecar_path(app_handle)
            .map_err(|_| SidecarStartupError::SidecarMissing)?;

        // 2. Check Node.js is available (system Node.js, 18+ required)
        let node_bin = node_resolver::resolve_node_binary_for_preflight(app_handle)
            .await
            .map_err(|e| match e {
                NodeBinaryError::NotFound => SidecarStartupError::NodeMissing,
                NodeBinaryError::Incompatible { version } => {
                    SidecarStartupError::NodeIncompatible {
                        found: version,
                        required: "18+".to_string(),
                    }
                }
            })?;

        Ok((sidecar_path, node_bin))
    }

    /// Launch and validate a new sidecar process.
    ///
    /// Runs pre-flight checks, spawns the Node.js process, captures stderr for
    /// diagnostics, and waits for the `sidecar_ready` signal. Returns the
    /// launched process handles on success.
    async fn launch_sidecar_process(
        &self,
        skill_name: &str,
        app_handle: &tauri::AppHandle,
    ) -> Result<LaunchedProcess, String> {
        // Run pre-flight checks for immediate, actionable errors
        let (sidecar_path, node_bin) = self.preflight_check(app_handle).await.map_err(|e| {
            events::emit_init_error(app_handle, &e);
            e.to_string()
        })?;

        let mut cmd = Command::new(&node_bin);
        cmd.arg(&sidecar_path)
            .arg("--persistent")
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .stdin(std::process::Stdio::piped());

        #[cfg(target_os = "windows")]
        {
            cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
        }

        // Prevent nested-session rejection: the SDK refuses to start if CLAUDECODE
        // is set in the environment (it assumes it's running inside Claude Code).
        cmd.env_remove("CLAUDECODE");

        // On Windows, the Claude Code SDK requires git-bash. Auto-detect it
        // so the user doesn't have to configure CLAUDE_CODE_GIT_BASH_PATH.
        #[cfg(target_os = "windows")]
        if std::env::var("CLAUDE_CODE_GIT_BASH_PATH").is_err() {
            if let Some(bash_path) = node_resolver::find_git_bash() {
                log::info!("Auto-detected git-bash at {}", bash_path);
                cmd.env("CLAUDE_CODE_GIT_BASH_PATH", &bash_path);
            }
        }

        let mut child = cmd.spawn().map_err(|e| {
            let err = SidecarStartupError::SpawnFailed {
                detail: e.to_string(),
            };
            events::emit_init_error(app_handle, &err);
            err.to_string()
        })?;

        let pid = child.id().ok_or("Failed to get child PID")?;
        let stdin = child.stdin.take().ok_or("Failed to open stdin")?;
        let stdout = child.stdout.take().ok_or("Failed to open stdout")?;
        let stderr = child.stderr.take().ok_or("Failed to open stderr")?;

        log::info!(
            "Spawned persistent sidecar for '{}' (pid {})",
            skill_name,
            pid
        );

        // Start early stderr capture for startup diagnostics.
        // Lines are collected in a shared buffer so that if startup fails (timeout,
        // stdout closes, parse error) we can surface the actual Node.js crash reason
        // in the error message shown to the user.
        let early_stderr = Arc::new(Mutex::new(Vec::<String>::new()));
        let early_stderr_clone = early_stderr.clone();
        let skill_name_stderr = skill_name.to_string();
        let stderr_task = tokio::spawn(async move {
            let stderr_reader = BufReader::new(stderr);
            let mut lines = stderr_reader.lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let result = AssertUnwindSafe(async {
                    if line.contains("[sidecar:hook]") {
                        log::debug!("[sidecar-stderr:{}] {}", skill_name_stderr, line);
                    } else {
                        log::trace!("[sidecar-stderr:{}] {}", skill_name_stderr, line);
                    }
                })
                .catch_unwind()
                .await;

                if let Err(panic_info) = result {
                    eprintln!(
                        "stderr reader panicked for skill '{}': {:?} (line: {})",
                        skill_name_stderr, panic_info, line
                    );
                }

                let mut buf = early_stderr_clone.lock().await;
                if buf.len() < 50 {
                    buf.push(line);
                }
            }
        });

        // Helper: wait for the stderr task to finish (process is dead, so stderr
        // will close quickly) then drain the collected lines. This avoids the race
        // where we drain the buffer before the tokio task has read any lines.
        let drain_stderr = |task: tokio::task::JoinHandle<()>, buf: Arc<Mutex<Vec<String>>>| async move {
            // Give the stderr reader up to 2s to finish reading remaining lines
            let _ = tokio::time::timeout(std::time::Duration::from_secs(2), task).await;
            let buf = buf.lock().await;
            buf.join("\n")
        };

        // Wait for the sidecar_ready signal on stdout.
        // Uses match instead of map_err so we can .await the stderr buffer drain.
        let mut reader = BufReader::new(stdout);
        let mut ready_line = String::new();
        let ready_result = tokio::time::timeout(
            std::time::Duration::from_secs(10),
            reader.read_line(&mut ready_line),
        )
        .await;

        let bytes_read = match ready_result {
            Err(_) => {
                // Timeout waiting for sidecar_ready
                let stderr_lines = drain_stderr(stderr_task, early_stderr).await;
                let err = if stderr_lines.is_empty() {
                    SidecarStartupError::ReadyTimeout { pid }
                } else {
                    SidecarStartupError::Other {
                        detail: format!(
                            "Agent runtime started (pid {}) but failed to initialize within 10 seconds. Stderr:\n{}",
                            pid, stderr_lines
                        ),
                    }
                };
                events::emit_init_error(app_handle, &err);
                return Err(err.to_string());
            }
            Ok(Err(e)) => {
                // IO error reading stdout
                let stderr_lines = drain_stderr(stderr_task, early_stderr).await;
                let detail = if stderr_lines.is_empty() {
                    format!("Error reading sidecar_ready: {}", e)
                } else {
                    format!(
                        "Error reading sidecar_ready: {}. Stderr:\n{}",
                        e, stderr_lines
                    )
                };
                let err = SidecarStartupError::Other { detail };
                events::emit_init_error(app_handle, &err);
                return Err(err.to_string());
            }
            Ok(Ok(n)) => n,
        };

        if bytes_read == 0 {
            let stderr_lines = drain_stderr(stderr_task, early_stderr).await;
            let detail = if stderr_lines.is_empty() {
                format!(
                    "Persistent sidecar (pid {}) closed stdout before sending sidecar_ready",
                    pid
                )
            } else {
                format!(
                    "Persistent sidecar (pid {}) closed stdout before sending sidecar_ready. Stderr:\n{}",
                    pid, stderr_lines
                )
            };
            let err = SidecarStartupError::Other { detail };
            events::emit_init_error(app_handle, &err);
            return Err(err.to_string());
        }

        // Validate the ready signal
        let ready_line = ready_line.trim();
        match serde_json::from_str::<serde_json::Value>(ready_line) {
            Ok(val) => {
                if val.get("type").and_then(|t| t.as_str()) != Some("sidecar_ready") {
                    let stderr_lines = drain_stderr(stderr_task, early_stderr).await;
                    let detail = if stderr_lines.is_empty() {
                        format!("Expected sidecar_ready but got: {}", ready_line)
                    } else {
                        format!(
                            "Expected sidecar_ready but got: {}. Stderr:\n{}",
                            ready_line, stderr_lines
                        )
                    };
                    let err = SidecarStartupError::Other { detail };
                    events::emit_init_error(app_handle, &err);
                    return Err(err.to_string());
                }
            }
            Err(e) => {
                let stderr_lines = drain_stderr(stderr_task, early_stderr).await;
                let detail = if stderr_lines.is_empty() {
                    format!(
                        "Failed to parse sidecar_ready signal: {} (line: {})",
                        e, ready_line
                    )
                } else {
                    format!(
                        "Failed to parse sidecar_ready signal: {} (line: {}). Stderr:\n{}",
                        e, ready_line, stderr_lines
                    )
                };
                let err = SidecarStartupError::Other { detail };
                events::emit_init_error(app_handle, &err);
                return Err(err.to_string());
            }
        }

        Ok(LaunchedProcess {
            child,
            pid,
            stdin,
            stdout_reader: reader,
            stderr_task,
        })
    }

    /// Internal: spawn and register a new persistent sidecar.
    /// Called with no pool lock held. Orchestrates process launch, stdout reader
    /// task, heartbeat task, and pool registration.
    async fn do_spawn(
        &self,
        skill_name: &str,
        app_handle: &tauri::AppHandle,
    ) -> Result<(), String> {
        let LaunchedProcess {
            child,
            pid,
            stdin,
            stdout_reader,
            stderr_task,
        } = self.launch_sidecar_process(skill_name, app_handle).await?;

        log::info!(
            "Persistent sidecar for '{}' is ready (pid [REDACTED])",
            skill_name
        );

        let last_pong = Arc::new(Mutex::new(tokio::time::Instant::now()));
        let stdin_arc = Arc::new(Mutex::new(stdin));

        // Build context for the stdout reader task
        let ctx = StdoutContext {
            skill_name: skill_name.to_string(),
            last_pong: last_pong.clone(),
            pending_requests: self.pending_requests.clone(),
            request_logs: self.request_logs.clone(),
            sidecars: self.sidecars.clone(),
            app_handle: app_handle.clone(),
        };

        let stdout_task = tokio::spawn(async move {
            let mut lines = stdout_reader.lines();

            while let Ok(Some(line)) = lines.next_line().await {
                // Wrap per-line processing in catch_unwind so a panic in JSON
                // parsing or message routing doesn't kill the reader silently.
                let process_result = AssertUnwindSafe(handle_stdout_line(&line, &ctx))
                    .catch_unwind()
                    .await;

                if let Err(panic_info) = process_result {
                    log::error!(
                        "stdout reader panicked for skill '{}': {:?} (len={}) — removing from pool",
                        ctx.skill_name,
                        panic_info,
                        line.len()
                    );
                    remove_and_cleanup_sidecar(&ctx.sidecars, &ctx.skill_name).await;
                    return;
                }
            }

            // EOF on stdout — sidecar crashed or exited unexpectedly
            log::warn!(
                "Persistent sidecar for '{}' closed stdout unexpectedly, removing from pool",
                ctx.skill_name
            );
            let mut pool = ctx.sidecars.lock().await;
            if let Some(old) = pool.remove(&ctx.skill_name) {
                // Abort heartbeat + stderr so they don't loop against a dead process.
                // stdout_task (this task) exits naturally after this block.
                old.stderr_task.abort();
                old.heartbeat_task.abort();
            }
        });

        // Spawn heartbeat task for periodic health checks
        let heartbeat_task = spawn_heartbeat_task(
            skill_name.to_string(),
            stdin_arc.clone(),
            self.sidecars.clone(),
            last_pong.clone(),
        );

        let sidecar = PersistentSidecar {
            child,
            stdin: stdin_arc,
            pid,
            stdout_task,
            stderr_task,
            heartbeat_task,
            last_pong,
            last_activity: Arc::new(Mutex::new(tokio::time::Instant::now())),
        };

        // Re-acquire pool lock to insert the new sidecar
        let mut pool = self.sidecars.lock().await;
        pool.insert(skill_name.to_string(), sidecar);
        Ok(())
    }

    /// Send an agent request to the persistent sidecar for a skill.
    /// The request_id is set to the agent_id so events route to the correct frontend handler.
    ///
    /// The request runs until the agent completes or the user cancels manually.
    ///
    /// Issue 1 fix: stdin writes are serialized via `Mutex<ChildStdin>`.
    /// Issue 4 fix: on any error after `get_or_spawn`, an `agent_exit` event is emitted
    /// so the frontend never gets stuck in "running" state.
    pub async fn send_request(
        &self,
        skill_name: &str,
        agent_id: &str,
        mut config: SidecarConfig,
        app_handle: &tauri::AppHandle,
        transcript_log_dir: Option<&str>,
    ) -> Result<(), String> {
        if config.runtime_provider.as_deref() == Some("openhands")
            && config.path_to_openhands_runner.is_none()
        {
            if let Ok(runner_path) =
                crate::agents::sidecar::resolve_openhands_runner_path_public(app_handle)
            {
                config.path_to_openhands_runner = Some(runner_path);
            }
        }

        // Ensure we have a sidecar running
        self.get_or_spawn(skill_name, app_handle).await?;

        // Issue 4: If anything below fails, emit agent_exit so the frontend doesn't hang.
        let result = self
            .do_send_request(skill_name, agent_id, config, app_handle, transcript_log_dir)
            .await;

        if let Err(ref e) = result {
            log::warn!(
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
        transcript_log_dir: Option<&str>,
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

        log::debug!(
            "[do_send_request] agent='{}' skill='{}' prompt:\n{}",
            agent_id,
            skill_name,
            config.prompt,
        );

        let config_event = build_config_event_payload(&config);
        events::handle_sidecar_message(app_handle, agent_id, &config_event.to_string());
        let transcript_first_line = build_transcript_first_line(&config);

        // Create per-request JSONL transcript file:
        //   {workspace_skill_dir}/logs/{step_label}-{iso_timestamp}.jsonl
        //
        // When transcript_log_dir is set, transcripts are written there instead.
        // This allows agents whose workspace differs (e.g. test baseline agents
        // running in a temp dir) to still log under the skill's standard log directory.
        //
        // The step_label is extracted from agent_id which has the format:
        //   {skill_name}-{label}-{timestamp_ms}
        // e.g. "dbt-step5-1707654321000" → label = "step5"
        {
            let step_label = extract_step_label(agent_id, skill_name);
            let now = chrono::Local::now();
            let ts = now.format("%Y-%m-%dT%H-%M-%S").to_string();
            let log_dir = match transcript_log_dir {
                Some(dir) => PathBuf::from(dir),
                None => Path::new(&config.workspace_skill_dir).join("logs"),
            };
            let log_path = log_dir.join(format!("{}-{}.jsonl", step_label, ts));

            match std::fs::create_dir_all(&log_dir).and_then(|_| std::fs::File::create(&log_path)) {
                Ok(mut f) => {
                    // Write config with prompt as the first line (apiKey redacted)
                    let _ = writeln!(f, "{}", transcript_first_line);
                    let log_handle: RequestLogFile = Arc::new(Mutex::new(Some(f)));
                    let mut logs = self.request_logs.lock().await;
                    logs.insert(agent_id.to_string(), log_handle);
                }
                Err(e) => {
                    log::warn!(
                        "Failed to create JSONL transcript at {}: {}",
                        log_path.display(),
                        e,
                    );
                    // Non-fatal — agent still runs, just no transcript
                }
            }
        }

        // Register this request as pending BEFORE sending to stdin, so the
        // stdout reader knows it's in-flight.
        let agent_id_string = agent_id.to_string();
        {
            let mut pending = self.pending_requests.lock().await;
            pending.insert(agent_id_string.clone(), skill_name.to_string());
        }

        // Get a clone of the Arc<Mutex<ChildStdin>> — hold pool lock only briefly
        let (stdin_handle, pid) = {
            let pool = self.sidecars.lock().await;
            match pool.get(skill_name) {
                Some(sidecar) => (sidecar.stdin.clone(), sidecar.pid),
                None => {
                    self.unregister_pending(&agent_id_string).await;
                    return Err(format!(
                        "Sidecar for '{}' not found in pool after get_or_spawn",
                        skill_name
                    ));
                }
            }
        };

        // Get the last_activity handle for this sidecar (before releasing the pool lock)
        let last_activity_handle = {
            let pool = self.sidecars.lock().await;
            pool.get(skill_name).map(|s| s.last_activity.clone())
        };

        // Issue 1: Write to stdin under the per-sidecar Mutex. This serializes
        // concurrent writes to the same skill's sidecar while allowing different
        // skills to write fully in parallel.
        {
            let mut stdin_guard = stdin_handle.lock().await;

            // Write with timeout (10s)
            match tokio::time::timeout(
                std::time::Duration::from_secs(10),
                stdin_guard.write_all(request_line.as_bytes()),
            )
            .await
            {
                Err(_) => {
                    log::warn!(
                        "Stdin write timed out for skill '{}' — killing sidecar",
                        skill_name
                    );
                    drop(stdin_guard); // release mutex before removing
                    self.unregister_pending(&agent_id_string).await;
                    self.remove_and_kill_sidecar(skill_name).await;
                    return Err(format!(
                        "Stdin write timed out after 10s for skill '{}'",
                        skill_name
                    ));
                }
                Ok(Err(e)) => {
                    self.unregister_pending(&agent_id_string).await;
                    return Err(format!("Failed to write to sidecar stdin: {}", e));
                }
                Ok(Ok(())) => {}
            }

            // Flush with timeout (5s)
            match tokio::time::timeout(std::time::Duration::from_secs(5), stdin_guard.flush()).await
            {
                Err(_) => {
                    log::warn!(
                        "Stdin flush timed out for skill '{}' — killing sidecar",
                        skill_name
                    );
                    drop(stdin_guard); // release mutex before removing
                    self.unregister_pending(&agent_id_string).await;
                    self.remove_and_kill_sidecar(skill_name).await;
                    return Err(format!(
                        "Stdin flush timed out after 5s for skill '{}'",
                        skill_name
                    ));
                }
                Ok(Err(e)) => {
                    self.unregister_pending(&agent_id_string).await;
                    return Err(format!("Failed to flush sidecar stdin: {}", e));
                }
                Ok(Ok(())) => {}
            }
        }

        // Update last_activity timestamp after successful request send
        if let Some(last_activity) = last_activity_handle {
            let mut guard = last_activity.lock().await;
            *guard = tokio::time::Instant::now();
        }

        log::info!(
            "Sent agent request '{}' to persistent sidecar for '{}' (pid {})",
            agent_id,
            skill_name,
            pid
        );

        // No response timeout — the heartbeat task (30s ping / 5s pong) already
        // detects dead sidecars. If the sidecar is alive, the SDK is legitimately
        // working; complex agents (reasoning, merging) can take 10+ minutes.

        Ok(())
    }

    /// Remove an agent_id from the pending_requests map.
    /// Called on error paths to prevent the idle-cleanup task from treating
    /// a failed request as still in-flight.
    async fn unregister_pending(&self, agent_id: &str) {
        let mut pending = self.pending_requests.lock().await;
        pending.remove(agent_id);
    }

    // ─── Streaming session methods (refine chat) ─────────────────────────────

    /// Write a JSON line to the sidecar's stdin with timeout and flush.
    /// Shared helper used by stream_start, stream_message, and stream_end.
    async fn write_to_sidecar_stdin(
        &self,
        skill_name: &str,
        message: &serde_json::Value,
    ) -> Result<(), String> {
        let mut line = serde_json::to_string(message)
            .map_err(|e| format!("Failed to serialize message: {}", e))?;
        line.push('\n');

        let stdin_handle = {
            let pool = self.sidecars.lock().await;
            let sidecar = pool
                .get(skill_name)
                .ok_or_else(|| format!("Sidecar for '{}' not found in pool", skill_name))?;
            sidecar.stdin.clone()
        };

        {
            let mut stdin_guard = stdin_handle.lock().await;
            match tokio::time::timeout(
                std::time::Duration::from_secs(10),
                stdin_guard.write_all(line.as_bytes()),
            )
            .await
            {
                Err(_) => {
                    drop(stdin_guard);
                    self.remove_and_kill_sidecar(skill_name).await;
                    return Err(format!("Stdin write timed out for skill '{}'", skill_name));
                }
                Ok(Err(e)) => return Err(format!("Failed to write to sidecar stdin: {}", e)),
                Ok(Ok(())) => {}
            }
            match tokio::time::timeout(std::time::Duration::from_secs(5), stdin_guard.flush()).await
            {
                Err(_) => {
                    drop(stdin_guard);
                    self.remove_and_kill_sidecar(skill_name).await;
                    return Err(format!("Stdin flush timed out for skill '{}'", skill_name));
                }
                Ok(Err(e)) => return Err(format!("Failed to flush sidecar stdin: {}", e)),
                Ok(Ok(())) => {}
            }
        }

        // Update last_activity timestamp
        let last_activity_handle = {
            let pool = self.sidecars.lock().await;
            pool.get(skill_name).map(|s| s.last_activity.clone())
        };
        if let Some(last_activity) = last_activity_handle {
            let mut guard = last_activity.lock().await;
            *guard = tokio::time::Instant::now();
        }

        Ok(())
    }

    /// Start a streaming session on the sidecar.
    /// The first user message is embedded in the config.prompt field.
    #[allow(dead_code)]
    pub async fn send_stream_start(
        &self,
        skill_name: &str,
        session_id: &str,
        agent_id: &str,
        config: SidecarConfig,
        app_handle: &tauri::AppHandle,
    ) -> Result<(), String> {
        self.get_or_spawn(skill_name, app_handle).await?;

        log::debug!(
            "[send_stream_start] session=[REDACTED] agent='{}' skill='{}' prompt:\n{}",
            agent_id,
            skill_name,
            config.prompt,
        );

        let config_event = build_config_event_payload(&config);
        events::handle_sidecar_message(app_handle, agent_id, &config_event.to_string());
        let transcript_first_line = build_transcript_first_line(&config);

        // Create JSONL transcript
        {
            let step_label = extract_step_label(agent_id, skill_name);
            let now = chrono::Local::now();
            let ts = now.format("%Y-%m-%dT%H-%M-%S").to_string();
            let log_dir = match &config.transcript_log_dir {
                Some(dir) => std::path::PathBuf::from(dir),
                None => Path::new(&config.workspace_skill_dir).join("logs"),
            };
            let log_path = log_dir.join(format!("{}-{}.jsonl", step_label, ts));

            if let Ok(mut f) =
                std::fs::create_dir_all(&log_dir).and_then(|_| std::fs::File::create(&log_path))
            {
                // Write config with prompt as the first line (apiKey redacted)
                let _ = writeln!(f, "{}", transcript_first_line);
                let log_handle: RequestLogFile = Arc::new(Mutex::new(Some(f)));
                let mut logs = self.request_logs.lock().await;
                logs.insert(agent_id.to_string(), log_handle.clone());
                // Also register under session_id so follow-up messages can find it.
                let mut session_logs = self.session_logs.lock().await;
                session_logs.insert(session_id.to_string(), log_handle);
            }
        }

        // Register as pending
        {
            let mut pending = self.pending_requests.lock().await;
            pending.insert(agent_id.to_string(), skill_name.to_string());
        }

        let message = serde_json::json!({
            "type": "stream_start",
            "request_id": agent_id,
            "session_id": session_id,
            "config": config,
        });

        let result = self.write_to_sidecar_stdin(skill_name, &message).await;
        if let Err(ref e) = result {
            log::error!("[send_stream_start] Failed for session '[REDACTED]': {}", e);
            self.unregister_pending(agent_id).await;
            events::handle_sidecar_exit(app_handle, agent_id, false);
        } else {
            log::info!(
                "[send_stream_start] session=[REDACTED] agent={} on skill '{}'",
                agent_id,
                skill_name,
            );
        }
        result
    }

    /// Push a follow-up message into an active streaming session.
    #[allow(dead_code)]
    pub async fn send_stream_message(
        &self,
        skill_name: &str,
        session_id: &str,
        agent_id: &str,
        user_message: &str,
        app_handle: &tauri::AppHandle,
    ) -> Result<(), String> {
        // Verify sidecar exists before sending; restart if cleaned up by idle timer
        {
            let pool = self.sidecars.lock().await;
            if !pool.contains_key(skill_name) {
                drop(pool);
                log::warn!(
                    "[send_stream_message] Sidecar for '{}' was cleaned up, restarting...",
                    skill_name
                );
                self.get_or_spawn(skill_name, app_handle).await?;
            }
        }

        // Register as pending
        {
            let mut pending = self.pending_requests.lock().await;
            pending.insert(agent_id.to_string(), skill_name.to_string());
        }

        // Share the session's log file with this follow-up request_id so all
        // turns in the streaming session are logged to the same JSONL file.
        {
            let session_logs = self.session_logs.lock().await;
            if let Some(log_handle) = session_logs.get(session_id) {
                let mut logs = self.request_logs.lock().await;
                logs.insert(agent_id.to_string(), log_handle.clone());
            }
        }

        log::debug!(
            "[send_stream_message] session=[REDACTED] agent='{}' skill='{}' user_message:\n{}",
            agent_id,
            skill_name,
            user_message,
        );

        let message = serde_json::json!({
            "type": "stream_message",
            "request_id": agent_id,
            "session_id": session_id,
            "user_message": user_message,
        });

        let result = self.write_to_sidecar_stdin(skill_name, &message).await;
        if let Err(ref e) = result {
            log::error!(
                "[send_stream_message] Failed for session '[REDACTED]': {}",
                e
            );
            self.unregister_pending(agent_id).await;
            events::handle_sidecar_exit(app_handle, agent_id, false);
        } else {
            log::info!(
                "[send_stream_message] session=[REDACTED] agent={} on skill '{}'",
                agent_id,
                skill_name,
            );
        }
        result
    }

    /// Resolve a pending AskUserQuestion callback inside an active streaming session.
    pub async fn send_stream_question_answer(
        &self,
        skill_name: &str,
        session_id: &str,
        agent_id: &str,
        tool_use_id: &str,
        questions: serde_json::Value,
        answers: serde_json::Value,
    ) -> Result<(), String> {
        let message = serde_json::json!({
            "type": "stream_question_answer",
            "request_id": agent_id,
            "session_id": session_id,
            "tool_use_id": tool_use_id,
            "questions": questions,
            "answers": answers,
        });

        let result = self.write_to_sidecar_stdin(skill_name, &message).await;
        if let Err(ref e) = result {
            log::error!(
                "[send_stream_question_answer] Failed for session '[REDACTED]': {}",
                e
            );
        } else {
            log::info!(
                "[send_stream_question_answer] session=[REDACTED] agent={} tool={} on skill '{}'",
                agent_id,
                tool_use_id,
                skill_name,
            );
        }
        result
    }

    /// Interrupt the current turn without closing the session.
    /// The sidecar aborts the AbortController; the next stream_message
    /// resumes the conversation via the SDK's `resume` option.
    pub async fn send_stream_cancel(
        &self,
        skill_name: &str,
        session_id: &str,
    ) -> Result<(), String> {
        let message = serde_json::json!({
            "type": "stream_cancel",
            "session_id": session_id,
        });

        let result = self.write_to_sidecar_stdin(skill_name, &message).await;
        if let Err(ref e) = result {
            log::warn!(
                "[send_stream_cancel] Failed for session '[REDACTED]': {}",
                e
            );
        } else {
            log::info!(
                "[send_stream_cancel] session=[REDACTED] on skill '{}'",
                skill_name
            );
        }
        result
    }

    /// Cancel a one-shot agent_request by request_id (= agent_id).
    /// The sidecar matches `currentRequestId` and calls `currentAbort.abort()`.
    pub async fn send_cancel(&self, skill_name: &str, request_id: &str) -> Result<(), String> {
        let message = serde_json::json!({
            "type": "cancel",
            "request_id": request_id,
        });
        let result = self.write_to_sidecar_stdin(skill_name, &message).await;
        if let Err(ref e) = result {
            log::warn!(
                "[send_cancel] Failed for request '[REDACTED]' on skill '{}': {}",
                skill_name,
                e
            );
        } else {
            log::info!("[send_cancel] request=[REDACTED] on skill '{}'", skill_name);
        }
        result
    }

    /// Close a streaming session.
    pub async fn send_stream_end(&self, skill_name: &str, session_id: &str) -> Result<(), String> {
        let message = serde_json::json!({
            "type": "stream_end",
            "session_id": session_id,
        });

        let result = self.write_to_sidecar_stdin(skill_name, &message).await;
        if let Err(ref e) = result {
            log::warn!("[send_stream_end] Failed for session '[REDACTED]': {}", e);
        } else {
            log::info!(
                "[send_stream_end] session=[REDACTED] on skill '{}'",
                skill_name
            );
        }
        result
    }

    /// Shutdown a single skill's sidecar. Sends a shutdown message, waits up to 3 seconds,
    /// then kills if necessary.
    ///
    /// The pool lock is released immediately after removing the sidecar entry so that
    /// concurrent `shutdown_skill` calls (via `join_all` in `shutdown_all`) can proceed
    /// in parallel rather than serializing on the 3-second child.wait().
    pub async fn shutdown_skill(
        &self,
        skill_name: &str,
        app_handle: &tauri::AppHandle,
    ) -> Result<(), String> {
        // Short lock: remove sidecar from the pool so other skills can proceed concurrently
        let maybe_sidecar = {
            let mut pool = self.sidecars.lock().await;
            pool.remove(skill_name)
        };

        if let Some(mut sidecar) = maybe_sidecar {
            log::info!(
                "Shutting down persistent sidecar for '{}' (pid {})",
                skill_name,
                sidecar.pid
            );

            // 1. Abort reader and heartbeat tasks first — prevents any new agent-exit events
            sidecar.stdout_task.abort();
            sidecar.stderr_task.abort();
            sidecar.heartbeat_task.abort();

            // 2. Now safely emit agent-shutdown for pending requests belonging to THIS skill only
            {
                let mut pending = self.pending_requests.lock().await;
                let to_shutdown: Vec<String> = pending
                    .iter()
                    .filter(|(_, sn)| sn.as_str() == skill_name)
                    .map(|(aid, _)| aid.clone())
                    .collect();

                for agent_id in &to_shutdown {
                    events::handle_agent_shutdown(app_handle, agent_id);
                    pending.remove(agent_id);
                }
            }

            // Close JSONL transcripts for this skill's requests.
            // Note: request_logs keys are agent_ids; we filter by prefix since
            // the log map doesn't store skill_name (unlike pending_requests).
            {
                let mut logs = self.request_logs.lock().await;
                let to_close: Vec<String> = logs
                    .keys()
                    .filter(|agent_id| agent_id.starts_with(&format!("{}-", skill_name)))
                    .cloned()
                    .collect();
                for agent_id in to_close {
                    logs.remove(&agent_id);
                }
            }

            // Send shutdown message
            let shutdown_msg = "{\"type\":\"shutdown\"}\n";
            {
                let mut stdin = sidecar.stdin.lock().await;
                let _ = stdin.write_all(shutdown_msg.as_bytes()).await;
                let _ = stdin.flush().await;
            }

            // Wait up to 3 seconds for graceful exit (pool lock NOT held — true parallelism)
            let wait_result =
                tokio::time::timeout(std::time::Duration::from_secs(3), sidecar.child.wait()).await;

            match wait_result {
                Ok(Ok(status)) => {
                    log::info!("Sidecar for '{}' exited gracefully: {}", skill_name, status);
                }
                Ok(Err(e)) => {
                    log::warn!("Error waiting for sidecar '{}' to exit: {}", skill_name, e);
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
            log::debug!(
                "No sidecar running for '{}', nothing to shut down",
                skill_name
            );
        }

        Ok(())
    }

    /// Remove a sidecar from the pool and kill it immediately.
    /// Used when stdin writes time out and the sidecar is presumed hung.
    async fn remove_and_kill_sidecar(&self, skill_name: &str) {
        let mut pool = self.sidecars.lock().await;
        if let Some(mut sidecar) = pool.remove(skill_name) {
            sidecar.stdout_task.abort();
            sidecar.stderr_task.abort();
            sidecar.heartbeat_task.abort();
            let _ = sidecar.child.kill().await;
            log::info!(
                "Killed hung sidecar for '{}' (pid {})",
                skill_name,
                sidecar.pid
            );
        }
    }

    /// Shutdown all persistent sidecars. Called on app exit.
    /// Shuts down all sidecars concurrently using `join_all` so N sidecars
    /// complete in ~3s (the per-sidecar timeout), well within the 5s budget.
    pub async fn shutdown_all(&self, app_handle: &tauri::AppHandle) {
        // Signal the idle cleanup loop to exit gracefully before aborting
        self.shutdown_initiated.store(true, Ordering::SeqCst);

        // Abort the idle cleanup task as a backstop — the loop will likely
        // exit on its own via the flag check, but abort ensures it doesn't linger.
        {
            let mut guard = self.idle_cleanup_task.lock().await;
            if let Some(task) = guard.take() {
                task.abort();
                log::debug!("Aborted idle cleanup task");
            }
        }

        let skill_names: Vec<String> = {
            let pool = self.sidecars.lock().await;
            pool.keys().cloned().collect()
        };

        // Shut down all sidecars concurrently
        let futures: Vec<_> = skill_names
            .iter()
            .map(|skill_name| {
                let skill_name = skill_name.clone();
                let app_handle = app_handle.clone();
                let pool = self.clone();
                async move {
                    if let Err(e) = pool.shutdown_skill(&skill_name, &app_handle).await {
                        log::warn!("Error shutting down sidecar for '{}': {}", skill_name, e);
                    }
                }
            })
            .collect();

        futures::future::join_all(futures).await;

        self.shutdown_completed.store(true, Ordering::SeqCst);
        log::info!("All persistent sidecars shut down");
    }

    /// Returns `true` if `shutdown_all` has already completed successfully.
    /// Used by `RunEvent::Exit` to skip redundant shutdown calls.
    pub fn is_shutdown_completed(&self) -> bool {
        self.shutdown_completed.load(Ordering::SeqCst)
    }

    /// Shutdown all sidecars with a timeout. If the graceful shutdown exceeds
    /// `timeout_secs`, log a warning and return an error so the caller can force-exit.
    pub async fn shutdown_all_with_timeout(
        &self,
        app_handle: &tauri::AppHandle,
        timeout_secs: u64,
    ) -> Result<(), String> {
        match tokio::time::timeout(
            std::time::Duration::from_secs(timeout_secs),
            self.shutdown_all(app_handle),
        )
        .await
        {
            Ok(()) => Ok(()),
            Err(_) => {
                log::warn!(
                    "Sidecar pool shutdown timed out after {}s — force-exiting",
                    timeout_secs,
                );
                Err(format!("Shutdown timed out after {}s", timeout_secs))
            }
        }
    }
}

/// Extract the step label (e.g. "step5", "review-step2") from an agent_id.
///
/// Agent IDs have the format `{skill_name}-{label}-{timestamp_ms}`.
/// We strip the `{skill_name}-` prefix and the `-{timestamp_ms}` suffix.
fn extract_step_label<'a>(agent_id: &'a str, skill_name: &str) -> &'a str {
    let without_prefix = agent_id
        .strip_prefix(skill_name)
        .and_then(|s| s.strip_prefix('-'))
        .unwrap_or(agent_id);

    // The timestamp is the last `-` separated numeric segment
    if let Some(last_dash) = without_prefix.rfind('-') {
        let suffix = &without_prefix[last_dash + 1..];
        if suffix.chars().all(|c| c.is_ascii_digit()) && !suffix.is_empty() {
            return &without_prefix[..last_dash];
        }
    }
    without_prefix
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_config() -> SidecarConfig {
        SidecarConfig {
            mode: Some("streaming".to_string()),
            prompt: "Top secret prompt".to_string(),
            system_prompt: None,
            model: Some("claude-sonnet-4".to_string()),
            llm: None,
            model_base_url: None,
            api_key: crate::types::SecretString::new("sk-ant-test".to_string()),
            workspace_root_dir: "/tmp/skill-builder".to_string(),
            workspace_skill_dir: "/tmp/skill-builder".to_string(),
            allowed_tools: Some(vec!["Read".to_string()]),
            max_turns: Some(3),
            permission_mode: None,
            betas: None,
            thinking: None,
            fallback_model: None,
            effort: None,
            output_format: None,
            prompt_suggestions: Some(true),
            path_to_claude_code_executable: None,
            path_to_openhands_runner: None,
            agent_name: Some("worker".to_string()),
            required_plugins: None,
            setting_sources: None,
            conversation_history: None,
            skill_name: Some("demo-skill".to_string()),
            step_id: Some(1),
            workflow_session_id: Some("session-123".to_string()),
            usage_session_id: None,
            run_source: Some("workflow".to_string()),
            plugin_slug: "skills".to_string(),
            transcript_log_dir: None,
            runtime_provider: None,
        }
    }

    #[test]
    fn test_build_config_event_payload_redacts_api_key_and_prompt() {
        let event = build_config_event_payload(&sample_config());

        assert_eq!(event["type"], "config");
        assert_eq!(event["config"]["apiKey"], "[REDACTED]");
        assert!(event["config"].get("prompt").is_none());
        assert_eq!(event["config"]["workspaceRootDir"], "/tmp/skill-builder");
        assert_eq!(event["config"]["workspaceSkillDir"], "/tmp/skill-builder");
    }

    #[test]
    fn test_build_transcript_first_line_redacts_api_key_but_keeps_prompt() {
        let event = build_transcript_first_line(&sample_config());

        assert_eq!(event["type"], "config");
        assert_eq!(event["config"]["apiKey"], "[REDACTED]");
        assert_eq!(event["config"]["prompt"], "Top secret prompt");
    }

    // -----------------------------------------------------------------
    // extract_step_label tests
    // -----------------------------------------------------------------

    #[test]
    fn test_extract_step_label_basic() {
        assert_eq!(
            extract_step_label("dbt-step5-1707654321000", "dbt"),
            "step5"
        );
    }

    #[test]
    fn test_extract_step_label_review() {
        assert_eq!(
            extract_step_label("dbt-review-step2-1707654321000", "dbt"),
            "review-step2"
        );
    }

    #[test]
    fn test_extract_step_label_no_timestamp() {
        // If there's no numeric suffix, return everything after skill name
        assert_eq!(extract_step_label("dbt-step5", "dbt"), "step5");
    }

    #[test]
    fn test_extract_step_label_skill_name_mismatch() {
        // If skill_name doesn't match the prefix, fall back to stripping timestamp from full id
        assert_eq!(
            extract_step_label("other-step5-1707654321000", "dbt"),
            "other-step5"
        );
    }

    #[test]
    fn test_extract_step_label_multi_word_skill() {
        assert_eq!(
            extract_step_label("my-skill-step0-1707654321000", "my-skill"),
            "step0"
        );
    }

    #[test]
    fn test_extract_step_label_named_workflow_step() {
        assert_eq!(
            extract_step_label("my-skill-confirm-decisions-1707654321000", "my-skill"),
            "confirm-decisions"
        );
    }
}
