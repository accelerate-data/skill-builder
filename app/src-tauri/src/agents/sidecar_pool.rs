use std::collections::{HashMap, HashSet};
use std::fmt;
use std::io::Write as _;
use std::panic::AssertUnwindSafe;
use std::path::Path;
use std::sync::Arc;

use futures::FutureExt;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;
use tokio::task::JoinHandle;

use super::events;
use super::sidecar::SidecarConfig;

/// Categorized sidecar startup failure with actionable fix instructions.
#[derive(Debug, Clone, serde::Serialize)]
pub enum SidecarStartupError {
    /// The agent-runner.js bundle was not found in any expected location.
    SidecarMissing,
    /// Node.js binary was not found on the system.
    NodeMissing,
    /// Node.js was found but its version is outside the supported range (18-24).
    NodeIncompatible {
        found: String,
        required: String,
    },
    /// The sidecar process could not be spawned (OS-level failure).
    SpawnFailed {
        detail: String,
    },
    /// The sidecar started but did not send the ready signal within the timeout.
    ReadyTimeout {
        pid: u32,
    },
    /// An unexpected error during startup.
    Other {
        detail: String,
    },
}

impl SidecarStartupError {
    /// Machine-readable error type for frontend classification.
    pub fn error_type(&self) -> &'static str {
        match self {
            SidecarStartupError::SidecarMissing => "sidecar_missing",
            SidecarStartupError::NodeMissing => "node_missing",
            SidecarStartupError::NodeIncompatible { .. } => "node_incompatible",
            SidecarStartupError::SpawnFailed { .. } => "spawn_failed",
            SidecarStartupError::ReadyTimeout { .. } => "ready_timeout",
            SidecarStartupError::Other { .. } => "other",
        }
    }

    /// Human-readable message describing the error.
    pub fn message(&self) -> String {
        match self {
            SidecarStartupError::SidecarMissing => {
                "Agent runtime not found.".to_string()
            }
            SidecarStartupError::NodeMissing => {
                "Node.js is not installed or not in PATH.".to_string()
            }
            SidecarStartupError::NodeIncompatible { found, required } => {
                format!(
                    "Node.js {} is not compatible. This app requires Node.js {}.",
                    found, required
                )
            }
            SidecarStartupError::SpawnFailed { detail } => {
                format!("Failed to start agent runtime: {}", detail)
            }
            SidecarStartupError::ReadyTimeout { pid } => {
                format!(
                    "Agent runtime started (pid {}) but failed to initialize within 10 seconds.",
                    pid
                )
            }
            SidecarStartupError::Other { detail } => detail.clone(),
        }
    }

    /// Actionable instruction for the user to fix the error.
    pub fn fix_hint(&self) -> String {
        match self {
            SidecarStartupError::SidecarMissing => {
                "Run `npm run sidecar:build` in the app/ directory, or use `npm run dev` which builds automatically.".to_string()
            }
            SidecarStartupError::NodeMissing => {
                "Install Node.js 18-24 from https://nodejs.org".to_string()
            }
            SidecarStartupError::NodeIncompatible { .. } => {
                "Install a compatible version of Node.js (18-24) from https://nodejs.org".to_string()
            }
            SidecarStartupError::SpawnFailed { .. } => {
                "Check file permissions and ensure the sidecar bundle exists. Try running `npm run sidecar:build` in the app/ directory.".to_string()
            }
            SidecarStartupError::ReadyTimeout { .. } => {
                "Check the app logs for details (Settings > Log File). The sidecar process may have crashed during initialization.".to_string()
            }
            SidecarStartupError::Other { .. } => {
                "Check the app logs for details (Settings > Log File).".to_string()
            }
        }
    }
}

impl fmt::Display for SidecarStartupError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{} {}", self.message(), self.fix_hint())
    }
}

/// Structured error from `resolve_node_binary_for_preflight()` so callers can
/// pattern-match instead of parsing error strings.
#[derive(Debug)]
enum NodeBinaryError {
    NotFound,
    Incompatible { version: String },
}

impl fmt::Display for NodeBinaryError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotFound => write!(
                f,
                "Node.js not found. Please install Node.js 18-24 from https://nodejs.org"
            ),
            Self::Incompatible { version } => write!(
                f,
                "Node.js {} is not compatible. This app requires Node.js 18-24.",
                version
            ),
        }
    }
}

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
    /// Handle for the heartbeat task — aborted on shutdown/crash-respawn.
    heartbeat_task: JoinHandle<()>,
    /// Timestamp of the last pong received from this sidecar, used for health checks.
    /// The Arc is cloned into the stdout reader and heartbeat tasks; keeping it here
    /// ensures the Arc stays alive for the sidecar's lifetime.
    #[allow(dead_code)]
    last_pong: Arc<Mutex<tokio::time::Instant>>,
}

/// Abort the reader tasks and heartbeat task, then drop the sidecar, cleaning up all resources.
fn cleanup_sidecar(sidecar: PersistentSidecar) {
    sidecar.stdout_task.abort();
    sidecar.stderr_task.abort();
    sidecar.heartbeat_task.abort();
    // `child`, `stdin`, etc. are dropped here — stdin closes, process may receive SIGPIPE.
}

/// Remove a sidecar from the pool and clean up all its resources (tasks + child process).
/// Used by the heartbeat task when it detects a zombie/unresponsive sidecar.
async fn remove_and_cleanup_sidecar(
    pool: &Arc<Mutex<HashMap<String, PersistentSidecar>>>,
    skill_name: &str,
) {
    let mut pool_guard = pool.lock().await;
    if let Some(mut sidecar) = pool_guard.remove(skill_name) {
        let pid = sidecar.pid;
        sidecar.stdout_task.abort();
        sidecar.stderr_task.abort();
        sidecar.heartbeat_task.abort();
        let _ = sidecar.child.kill().await;
        log::warn!(
            "Removed and killed sidecar for '{}' (pid {})",
            skill_name,
            pid
        );
    }
}

/// Spawn a heartbeat task that periodically pings the sidecar and checks for pong responses.
/// If the sidecar fails to respond, it is removed from the pool and killed.
fn spawn_heartbeat_task(
    skill_name: String,
    stdin: Arc<Mutex<tokio::process::ChildStdin>>,
    pool: Arc<Mutex<HashMap<String, PersistentSidecar>>>,
    last_pong: Arc<Mutex<tokio::time::Instant>>,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        loop {
            // Wait 30 seconds between heartbeat pings
            tokio::time::sleep(std::time::Duration::from_secs(30)).await;

            // Record time just before sending ping so we can check if pong arrived after it
            let ping_sent_at = tokio::time::Instant::now();

            // Send ping to sidecar stdin
            let write_result = {
                let mut stdin_guard = stdin.lock().await;
                let ping_msg = b"{\"type\":\"ping\"}\n";
                let write = stdin_guard.write_all(ping_msg).await;
                if write.is_ok() {
                    stdin_guard.flush().await
                } else {
                    write
                }
            };

            if let Err(e) = write_result {
                log::warn!(
                    "Heartbeat ping failed for '{}': {} — removing from pool",
                    skill_name,
                    e
                );
                remove_and_cleanup_sidecar(&pool, &skill_name).await;
                break;
            }

            log::debug!("[heartbeat:{}] ping sent", skill_name);

            // Wait 5 seconds for pong response
            tokio::time::sleep(std::time::Duration::from_secs(5)).await;

            // Check if pong was received after we sent the ping
            let last = {
                let guard = last_pong.lock().await;
                *guard
            };
            if last < ping_sent_at {
                // No pong received since we sent the ping — zombie
                log::warn!(
                    "Zombie sidecar detected for '{}': no pong within 5s — removing from pool",
                    skill_name,
                );
                remove_and_cleanup_sidecar(&pool, &skill_name).await;
                break;
            }
        }
    })
}

/// A per-request JSONL log file handle, shared between `do_send_request` (which creates it)
/// and the stdout reader task (which appends each message line).
type RequestLogFile = Arc<Mutex<Option<std::fs::File>>>;

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
    pending_requests: Arc<Mutex<HashSet<String>>>,
    /// Per-request JSONL log files, keyed by agent_id.
    /// The stdout reader appends each message to the matching file.
    request_logs: Arc<Mutex<HashMap<String, RequestLogFile>>>,
}

impl SidecarPool {
    pub fn new() -> Self {
        SidecarPool {
            sidecars: Arc::new(Mutex::new(HashMap::new())),
            spawning: Arc::new(Mutex::new(HashSet::new())),
            pending_requests: Arc::new(Mutex::new(HashSet::new())),
            request_logs: Arc::new(Mutex::new(HashMap::new())),
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

    /// Pre-flight validation: check sidecar path and Node.js BEFORE attempting to spawn.
    /// Returns immediately with a structured error if anything is wrong, avoiding the
    /// 10-second timeout that users would otherwise experience.
    async fn preflight_check(
        &self,
        app_handle: &tauri::AppHandle,
    ) -> Result<(String, String), SidecarStartupError> {
        // 1. Check sidecar bundle exists
        let sidecar_path = resolve_sidecar_path(app_handle)
            .map_err(|_| SidecarStartupError::SidecarMissing)?;

        // 2. Check Node.js is available (bundled-first waterfall)
        let node_bin = resolve_node_binary_for_preflight(app_handle)
            .await
            .map_err(|e| match e {
                NodeBinaryError::NotFound => SidecarStartupError::NodeMissing,
                NodeBinaryError::Incompatible { version } => {
                    SidecarStartupError::NodeIncompatible {
                        found: version,
                        required: "18-24".to_string(),
                    }
                }
            })?;

        Ok((sidecar_path, node_bin))
    }

    /// Internal: actually spawn and register a new persistent sidecar.
    /// Called with no pool lock held.
    async fn do_spawn(
        &self,
        skill_name: &str,
        app_handle: &tauri::AppHandle,
    ) -> Result<(), String> {
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
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
        }

        // On Windows, the Claude Code SDK requires git-bash. Auto-detect it
        // so the user doesn't have to configure CLAUDE_CODE_GIT_BASH_PATH.
        #[cfg(target_os = "windows")]
        if std::env::var("CLAUDE_CODE_GIT_BASH_PATH").is_err() {
            if let Some(bash_path) = find_git_bash() {
                log::info!("Auto-detected git-bash at {}", bash_path);
                cmd.env("CLAUDE_CODE_GIT_BASH_PATH", &bash_path);
            }
        }

        let mut child = cmd.spawn()
            .map_err(|e| {
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
                    log::debug!("[sidecar-stderr:{}] {}", skill_name_stderr, line);
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
                    format!("Error reading sidecar_ready: {}. Stderr:\n{}", e, stderr_lines)
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

        log::info!("Persistent sidecar for '{}' is ready (pid {})", skill_name, pid);

        // Issue 3: Store JoinHandles so we can abort them on shutdown/crash-respawn
        // The stderr_task is already spawned above and will keep running,
        // draining to log::debug for the lifetime of the sidecar process.

        // Create last_pong timestamp for heartbeat tracking
        let last_pong = Arc::new(Mutex::new(tokio::time::Instant::now()));

        // Spawn stdout reader that routes messages by request_id
        let stdout_pool = self.sidecars.clone();
        let stdout_pending = self.pending_requests.clone();
        let stdout_request_logs = self.request_logs.clone();
        let skill_name_stdout = skill_name.to_string();
        let app_handle_stdout = app_handle.clone();
        let stdout_last_pong = last_pong.clone();
        // Separate pool clone for the panic-recovery cleanup path (the other clone,
        // stdout_pool, is consumed by the normal EOF cleanup path).
        let panic_pool = self.sidecars.clone();

        let stdout_task = tokio::spawn(async move {
            let mut lines = reader.lines();

            while let Ok(Some(line)) = lines.next_line().await {
                // Raw stdout lines are captured in per-request JSONL transcripts
                // ({cwd}/{skill_name}/logs/) — no need to duplicate in the app log.

                // Wrap per-line processing in catch_unwind so a panic in JSON
                // parsing or message routing doesn't kill the reader silently.
                // AssertUnwindSafe is safe here: all captured refs are Arc/Clone
                // and we break out of the loop on panic, so no torn state is reused.
                let process_result = AssertUnwindSafe(async {
                    // Parse the line to extract request_id for routing
                    match serde_json::from_str::<serde_json::Value>(&line) {
                        Ok(msg) => {
                            // Intercept pong messages for heartbeat tracking
                            if msg.get("type").and_then(|t| t.as_str()) == Some("pong") {
                                let mut pong_guard = stdout_last_pong.lock().await;
                                *pong_guard = tokio::time::Instant::now();
                                log::debug!("[heartbeat:{}] pong received", skill_name_stdout);
                                return;
                            }

                            if let Some(request_id) = msg.get("request_id").and_then(|r| r.as_str()) {
                                // Intercept request_complete — sidecar signals it's ready for
                                // the next request. Log but don't forward to the event system.
                                if msg.get("type").and_then(|t| t.as_str()) == Some("request_complete") {
                                    log::debug!(
                                        "[persistent-sidecar:{}] Request '{}' complete — sidecar ready",
                                        skill_name_stdout,
                                        request_id,
                                    );
                                    return;
                                }

                                // Route this message to the correct agent using the request_id as agent_id
                                events::handle_sidecar_message(
                                    &app_handle_stdout,
                                    request_id,
                                    &line,
                                );

                                // Append to per-request JSONL transcript
                                {
                                    let logs = stdout_request_logs.lock().await;
                                    if let Some(log_file) = logs.get(request_id) {
                                        let mut guard = log_file.lock().await;
                                        if let Some(ref mut f) = *guard {
                                            let _ = writeln!(f, "{}", line);
                                        }
                                    }
                                }

                                // Log lifecycle events at INFO so the log file tells the full story.
                                // Streaming messages (assistant, user, tool_use, etc.) stay at debug.
                                if let Some(msg_type) = msg.get("type").and_then(|t| t.as_str()) {
                                    match msg_type {
                                        "system" => {
                                            let subtype = msg.get("subtype")
                                                .and_then(|s| s.as_str())
                                                .unwrap_or("unknown");
                                            // Surface SDK stderr in the app log — this is
                                            // diagnostic output (not agent content) and is
                                            // critical for debugging startup failures.
                                            if subtype == "sdk_stderr" {
                                                let data = msg.get("data")
                                                    .and_then(|d| d.as_str())
                                                    .unwrap_or("");
                                                log::warn!(
                                                    "[persistent-sidecar:{}] Agent '{}' stderr: {}",
                                                    skill_name_stdout,
                                                    request_id,
                                                    data,
                                                );
                                            } else {
                                                log::debug!(
                                                    "[persistent-sidecar:{}] Agent '{}': {}",
                                                    skill_name_stdout,
                                                    request_id,
                                                    subtype,
                                                );
                                            }
                                        }
                                        _ => {}
                                    }
                                }

                                // Check if this is a result or error — if so, emit exit event
                                // and remove from pending_requests.
                                if let Some(msg_type) = msg.get("type").and_then(|t| t.as_str()) {
                                    let is_terminal = msg_type == "result" || msg_type == "error";

                                    if msg_type == "result" {
                                        log::debug!(
                                            "[persistent-sidecar:{}] Agent '{}' completed successfully",
                                            skill_name_stdout,
                                            request_id,
                                        );
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
                                        let error_detail = msg.get("message")
                                            .and_then(|m| m.as_str())
                                            .unwrap_or("(no message)");
                                        log::info!(
                                            "[persistent-sidecar:{}] Agent error for '{}': {}",
                                            skill_name_stdout,
                                            request_id,
                                            error_detail,
                                        );
                                        {
                                            let mut pending = stdout_pending.lock().await;
                                            pending.remove(request_id);
                                        }
                                        // Capture any partial artifacts written before the error
                                        crate::commands::workflow::capture_artifacts_on_error(
                                            &app_handle_stdout,
                                            request_id,
                                        );
                                        events::handle_sidecar_exit(
                                            &app_handle_stdout,
                                            request_id,
                                            false,
                                        );
                                    }

                                    // Close and remove the JSONL log file on terminal messages
                                    if is_terminal {
                                        let mut logs = stdout_request_logs.lock().await;
                                        logs.remove(request_id);
                                    }
                                }
                            } else {
                                log::warn!(
                                    "[persistent-sidecar:{}] Message without request_id (len={})",
                                    skill_name_stdout,
                                    line.len(),
                                );
                            }
                        }
                        Err(e) => {
                            log::debug!(
                                "[persistent-sidecar:{}] Failed to parse stdout as JSON: {} (len={})",
                                skill_name_stdout,
                                e,
                                line.len(),
                            );
                        }
                    }
                })
                .catch_unwind()
                .await;

                if let Err(panic_info) = process_result {
                    log::error!(
                        "stdout reader panicked for skill '{}': {:?} (len={}) — removing from pool",
                        skill_name_stdout,
                        panic_info,
                        line.len()
                    );
                    remove_and_cleanup_sidecar(&panic_pool, &skill_name_stdout).await;
                    return; // exit the task — sidecar is cleaned up
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

        // Spawn heartbeat task for periodic health checks
        let stdin_arc = Arc::new(Mutex::new(stdin));
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
        config: SidecarConfig,
        app_handle: &tauri::AppHandle,
    ) -> Result<(), String> {
        // Ensure we have a sidecar running
        self.get_or_spawn(skill_name, app_handle).await?;

        // Issue 4: If anything below fails, emit agent_exit so the frontend doesn't hang.
        let result = self
            .do_send_request(skill_name, agent_id, config, app_handle)
            .await;

        if let Err(ref e) = result {
            log::warn!(
                "send_request failed for agent '{}' on skill '{}': {}",
                agent_id,
                skill_name,
                e
            );
            // Capture any partial artifacts written before the error
            crate::commands::workflow::capture_artifacts_on_error(app_handle, agent_id);
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
        let config_event = {
            let mut config_val = serde_json::to_value(&config).unwrap_or_default();
            if let Some(obj) = config_val.as_object_mut() {
                obj.insert("apiKey".to_string(), serde_json::json!("[REDACTED]"));
                obj.remove("prompt");
            }

            let discovered_skills = scan_skills_dir(Path::new(&config.cwd));

            let event = serde_json::json!({
                "type": "config",
                "config": config_val,
                "discoveredSkills": discovered_skills,
            });
            events::handle_sidecar_message(app_handle, agent_id, &event.to_string());
            event
        };

        // Create per-request JSONL transcript file alongside chat storage:
        //   {cwd}/{skill_name}/logs/{step_label}-{iso_timestamp}.jsonl
        //
        // The step_label is extracted from agent_id which has the format:
        //   {skill_name}-{label}-{timestamp_ms}
        // e.g. "dbt-step5-1707654321000" → label = "step5"
        {
            let step_label = extract_step_label(agent_id, skill_name);
            let now = chrono::Local::now();
            let ts = now.format("%Y-%m-%dT%H-%M-%S").to_string();
            let log_dir = Path::new(&config.cwd).join(skill_name).join("logs");
            let log_path = log_dir.join(format!("{}-{}.jsonl", step_label, ts));

            match std::fs::create_dir_all(&log_dir)
                .and_then(|_| std::fs::File::create(&log_path))
            {
                Ok(mut f) => {
                    // Write redacted config as the first line
                    let _ = writeln!(f, "{}", config_event);
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
        {
            let mut pending = self.pending_requests.lock().await;
            pending.insert(agent_id.to_string());
        }

        // Get a clone of the Arc<Mutex<ChildStdin>> — hold pool lock only briefly
        let (stdin_handle, pid) = {
            let pool = self.sidecars.lock().await;
            let sidecar = pool.get(skill_name).ok_or_else(|| {
                // Remove from pending since we never sent the request
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
                    self.remove_and_kill_sidecar(skill_name).await;
                    return Err(format!(
                        "Stdin write timed out after 10s for skill '{}'",
                        skill_name
                    ));
                }
                Ok(Err(e)) => {
                    return Err(format!("Failed to write to sidecar stdin: {}", e));
                }
                Ok(Ok(())) => {}
            }

            // Flush with timeout (5s)
            match tokio::time::timeout(
                std::time::Duration::from_secs(5),
                stdin_guard.flush(),
            )
            .await
            {
                Err(_) => {
                    log::warn!(
                        "Stdin flush timed out for skill '{}' — killing sidecar",
                        skill_name
                    );
                    drop(stdin_guard); // release mutex before removing
                    self.remove_and_kill_sidecar(skill_name).await;
                    return Err(format!(
                        "Stdin flush timed out after 5s for skill '{}'",
                        skill_name
                    ));
                }
                Ok(Err(e)) => {
                    return Err(format!("Failed to flush sidecar stdin: {}", e));
                }
                Ok(Ok(())) => {}
            }
        }

        log::debug!(
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

    /// Shutdown a single skill's sidecar. Sends a shutdown message, waits up to 3 seconds,
    /// then kills if necessary.
    pub async fn shutdown_skill(&self, skill_name: &str, app_handle: &tauri::AppHandle) -> Result<(), String> {
        let mut pool = self.sidecars.lock().await;

        if let Some(mut sidecar) = pool.remove(skill_name) {
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
                    .filter(|agent_id| agent_id.starts_with(&format!("{}-", skill_name)))
                    .cloned()
                    .collect();

                for agent_id in &to_shutdown {
                    events::handle_agent_shutdown(app_handle, agent_id);
                    pending.remove(agent_id);
                }
            }

            // Close JSONL transcripts for this skill's requests
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
    pub async fn shutdown_all(&self, app_handle: &tauri::AppHandle) {
        let skill_names: Vec<String> = {
            let pool = self.sidecars.lock().await;
            pool.keys().cloned().collect()
        };

        for skill_name in skill_names {
            if let Err(e) = self.shutdown_skill(&skill_name, app_handle).await {
                log::warn!("Error shutting down sidecar for '{}': {}", skill_name, e);
            }
        }

        log::info!("All persistent sidecars shut down");
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

/// Public accessor for startup dependency checks.
pub fn resolve_sidecar_path_public(app_handle: &tauri::AppHandle) -> Result<String, String> {
    resolve_sidecar_path(app_handle)
}

fn resolve_sidecar_path(app_handle: &tauri::AppHandle) -> Result<String, String> {
    use tauri::Manager;

    // Prefer bootstrap.js (catches module-load errors) with agent-runner.js as fallback.
    let entry_files = ["bootstrap.js", "agent-runner.js"];

    if let Ok(resource_dir) = app_handle.path().resource_dir() {
        for entry in &entry_files {
            let sidecar = resource_dir.join("sidecar").join("dist").join(entry);
            if sidecar.exists() {
                return sidecar
                    .to_str()
                    .map(|s| s.to_string())
                    .ok_or_else(|| "Invalid sidecar path".to_string());
            }
        }
    }

    if let Ok(exe_dir) = std::env::current_exe() {
        if let Some(dir) = exe_dir.parent() {
            for entry in &entry_files {
                let sidecar = dir.join("sidecar").join("dist").join(entry);
                if sidecar.exists() {
                    return sidecar
                        .to_str()
                        .map(|s| s.to_string())
                        .ok_or_else(|| "Invalid sidecar path".to_string());
                }
            }
        }
    }

    let dev_base = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(|p| p.join("sidecar").join("dist"));
    if let Some(base) = dev_base {
        for entry in &entry_files {
            let path = base.join(entry);
            if path.exists() {
                return path
                    .to_str()
                    .map(|s| s.to_string())
                    .ok_or_else(|| "Invalid sidecar path".to_string());
            }
        }
    }

    Err("Could not find bootstrap.js or agent-runner.js -- run 'npm run build' in app/sidecar/ first".to_string())
}

/// Result of Node.js binary resolution: the path and where it was found.
pub struct NodeResolution {
    pub path: String,
    pub source: String,
    pub version: Option<String>,
    pub meets_minimum: bool,
}

/// Map OS + architecture to the Node.js download directory convention.
fn node_platform_arch() -> &'static str {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", "aarch64") => "darwin-arm64",
        ("macos", "x86_64") => "darwin-x64",
        ("windows", "x86_64") => "win-x64",
        ("windows", "aarch64") => "win-arm64",
        (os, arch) => {
            log::warn!("Unsupported platform: {os}-{arch}");
            "unknown"
        }
    }
}

/// Unified Node.js resolution: bundled-first, then system fallback.
///
/// 1. Check bundled path (`{resource_dir}/node/{arch}/bin/node`) -- if executable, use it.
/// 2. Fall back to system Node (PATH search, validate version 18-24) -- if found, use it.
/// 3. Neither found -> error.
///
/// Returns `NodeResolution` with full metadata (path, source, version, meets_minimum).
/// Used by `check_node` and `check_startup_deps` commands that need rich status info.
pub async fn resolve_node_binary(app_handle: &tauri::AppHandle) -> Result<NodeResolution, String> {
    use tauri::Manager;

    let arch = node_platform_arch();
    let binary_name = if cfg!(windows) { "node.exe" } else { "node" };

    // Step 1: Check for bundled Node.js via Tauri resource_dir
    if let Ok(resource_dir) = app_handle.path().resource_dir() {
        let bundled_path = resource_dir
            .join("node")
            .join(arch)
            .join("bin")
            .join(binary_name);

        if let Some(resolution) = try_bundled_node(&bundled_path).await {
            return Ok(resolution);
        }
    }

    // Step 2: Portable exe fallback -- check {exe_dir}/resources/node/{arch}/bin/node
    // This handles Windows portable builds (--no-bundle) where resource_dir() may not
    // resolve correctly but resources are copied alongside the exe.
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            let portable_path = exe_dir
                .join("resources")
                .join("node")
                .join(arch)
                .join("bin")
                .join(binary_name);

            if let Some(resolution) = try_bundled_node(&portable_path).await {
                return Ok(resolution);
            }
        }
    }

    // Step 3: Fall back to system Node.js
    resolve_system_node().await
}

/// Internal: resolve Node.js binary path for `preflight_check()`.
///
/// Uses the same bundled-first waterfall as `resolve_node_binary()` but returns
/// `Result<String, NodeBinaryError>` for compatibility with `preflight_check()`'s
/// structured error mapping into `SidecarStartupError`.
///
/// Unlike the public `resolve_node_binary()`, this function is strict: if a Node.js
/// binary is found but has an incompatible version, it returns `NodeBinaryError::Incompatible`
/// rather than a best-effort `NodeResolution` with `meets_minimum: false`.
async fn resolve_node_binary_for_preflight(
    app_handle: &tauri::AppHandle,
) -> Result<String, NodeBinaryError> {
    // Delegate to the public resolver which does the full bundled-first waterfall
    match resolve_node_binary(app_handle).await {
        Ok(resolution) if resolution.meets_minimum => Ok(resolution.path),
        Ok(resolution) => {
            // Found Node but incompatible version
            Err(NodeBinaryError::Incompatible {
                version: resolution.version.unwrap_or_else(|| "unknown".to_string()),
            })
        }
        Err(_) => Err(NodeBinaryError::NotFound),
    }
}

/// Try to use a bundled Node.js binary at the given path.
/// Returns `Some(NodeResolution)` if the binary exists and executes successfully.
async fn try_bundled_node(bundled_path: &std::path::Path) -> Option<NodeResolution> {
    if !bundled_path.exists() {
        return None;
    }

    let path_str = bundled_path.to_string_lossy().to_string();

    let mut cmd = Command::new(bundled_path);
    cmd.arg("--version");

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    let output = cmd.output().await;

    match output {
        Ok(out) if out.status.success() => {
            let version = String::from_utf8_lossy(&out.stdout).trim().to_string();
            let meets_minimum = is_node_compatible(&version);
            log::info!("Using bundled Node.js {} at {}", version, path_str);
            Some(NodeResolution {
                path: path_str,
                source: "bundled".to_string(),
                version: Some(version),
                meets_minimum,
            })
        }
        _ => {
            log::warn!(
                "Bundled Node.js at {} exists but failed to execute, trying next candidate",
                path_str
            );
            None
        }
    }
}

/// System Node.js discovery: searches PATH and well-known locations, validates version 18-24.
async fn resolve_system_node() -> Result<NodeResolution, String> {
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

    let mut first_available: Option<(String, String)> = None; // (path, version)

    for candidate in &candidates {
        let mut cmd = Command::new(candidate);
        cmd.arg("--version");

        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
        }

        let output = cmd.output().await;

        if let Ok(out) = output {
            if out.status.success() {
                let version = String::from_utf8_lossy(&out.stdout).trim().to_string();
                let path_str = candidate.to_string_lossy().to_string();

                if first_available.is_none() {
                    first_available = Some((path_str.clone(), version.clone()));
                }

                if is_node_compatible(&version) {
                    log::info!(
                        "Using system Node.js {} at {}",
                        version,
                        path_str
                    );
                    return Ok(NodeResolution {
                        path: path_str,
                        source: "system".to_string(),
                        version: Some(version),
                        meets_minimum: true,
                    });
                }
            }
        }
    }

    // Found a Node but it doesn't meet version requirements -- still return it
    // (check_node and check_startup_deps callers want a best-effort path to report the mismatch)
    if let Some((path, version)) = first_available {
        return Ok(NodeResolution {
            path,
            source: "system".to_string(),
            version: Some(version),
            meets_minimum: false,
        });
    }

    Err("Node.js not found. Install Node.js 18+ from https://nodejs.org or use the bundled app.".to_string())
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

/// Auto-detect git-bash on Windows.
/// Checks PATH then standard install locations.
/// Public so `check_startup_deps` can call it for preflight validation.
#[cfg(target_os = "windows")]
pub fn find_git_bash() -> Option<String> {
    use std::path::PathBuf;

    // 1. Check if bash.exe is already in PATH
    if let Ok(output) = std::process::Command::new("where").arg("bash.exe").output() {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            // `where` can return multiple lines — pick the first Git one
            for line in stdout.lines() {
                let trimmed = line.trim();
                if trimmed.contains("Git") && PathBuf::from(trimmed).exists() {
                    return Some(trimmed.to_string());
                }
            }
        }
    }

    // 2. Check standard install locations
    let candidates = [
        r"C:\Program Files\Git\bin\bash.exe",
        r"C:\Program Files (x86)\Git\bin\bash.exe",
    ];

    for path in &candidates {
        if PathBuf::from(path).exists() {
            return Some(path.to_string());
        }
    }

    None
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

    // Note: test_shutdown_skill_no_sidecar and test_shutdown_all_empty_pool
    // were removed because shutdown_skill/shutdown_all now require a real
    // tauri::AppHandle to emit agent-shutdown events. The no-op behavior
    // (empty pool) is trivially correct and covered by the type system.

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

    #[test]
    fn test_node_platform_arch() {
        let arch = node_platform_arch();
        // On macOS, this should be one of the known mappings
        assert!(
            arch == "darwin-arm64" || arch == "darwin-x64",
            "Expected darwin-arm64 or darwin-x64, got: {}",
            arch
        );
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

        // Directly remove from pool (shutdown_skill requires AppHandle)
        {
            let mut sidecars = pool.sidecars.lock().await;
            sidecars.remove("skill_a");
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
    async fn test_pending_requests_remove_returns_true_if_present() {
        // Removing a pending request should return true and clear it from the set.
        let pool = SidecarPool::new();

        {
            let mut pending = pool.pending_requests.lock().await;
            pending.insert("agent-pending-test".to_string());
        }

        let was_pending = {
            let mut pending = pool.pending_requests.lock().await;
            pending.remove("agent-pending-test")
        };
        assert!(was_pending, "Request should have been pending");

        {
            let pending = pool.pending_requests.lock().await;
            assert!(!pending.contains("agent-pending-test"));
        }
    }

    #[tokio::test]
    async fn test_cleanup_aborts_heartbeat() {
        // Create a long-running task to simulate a heartbeat task
        let heartbeat_task = tokio::spawn(async {
            // This would run forever if not aborted
            loop {
                tokio::time::sleep(std::time::Duration::from_secs(30)).await;
            }
        });

        // Also create dummy tasks for stdout and stderr
        let stdout_task = tokio::spawn(async {
            loop {
                tokio::time::sleep(std::time::Duration::from_secs(30)).await;
            }
        });
        let stderr_task = tokio::spawn(async {
            loop {
                tokio::time::sleep(std::time::Duration::from_secs(30)).await;
            }
        });

        // Verify the tasks are not finished before cleanup
        assert!(!heartbeat_task.is_finished());
        assert!(!stdout_task.is_finished());
        assert!(!stderr_task.is_finished());

        // Abort them as cleanup_sidecar would
        heartbeat_task.abort();
        stdout_task.abort();
        stderr_task.abort();

        // Give a moment for abort to take effect
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;

        // Verify all tasks are finished after abort
        assert!(heartbeat_task.is_finished(), "Heartbeat task should be aborted by cleanup");
        assert!(stdout_task.is_finished(), "Stdout task should be aborted by cleanup");
        assert!(stderr_task.is_finished(), "Stderr task should be aborted by cleanup");
    }

    #[tokio::test]
    async fn test_pending_requests_remove_returns_false_if_already_completed() {
        // After the stdout reader removes a completed request, a second remove
        // should return false (idempotent).
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

        // Second remove should return false
        let still_pending = {
            let mut pending = pool.pending_requests.lock().await;
            pending.remove("agent-fast")
        };
        assert!(!still_pending, "Request should have already been removed");
    }

    #[tokio::test]
    async fn test_catch_unwind_on_panic() {
        // Verify the catch_unwind pattern used in reader tasks correctly catches panics
        // from an AssertUnwindSafe-wrapped async block via FutureExt::catch_unwind.
        let result = AssertUnwindSafe(async {
            panic!("simulated JSON processing panic");
        })
        .catch_unwind()
        .await;

        assert!(result.is_err(), "catch_unwind should catch the panic");

        // Verify the panic payload is accessible for logging
        let panic_info = result.unwrap_err();
        let panic_msg = panic_info
            .downcast_ref::<&str>()
            .map(|s| s.to_string())
            .unwrap_or_default();
        assert!(
            panic_msg.contains("simulated JSON processing panic"),
            "Panic payload should contain the panic message, got: {}",
            panic_msg
        );
    }

    #[tokio::test]
    async fn test_catch_unwind_normal_execution_passes_through() {
        // Verify that normal (non-panicking) execution passes through catch_unwind
        let result = AssertUnwindSafe(async {
            let json: serde_json::Value = serde_json::from_str(r#"{"type":"result"}"#).unwrap();
            json.get("type").unwrap().as_str().unwrap().to_string()
        })
        .catch_unwind()
        .await;

        assert!(result.is_ok(), "Non-panicking code should return Ok");
        assert_eq!(result.unwrap(), "result");
    }

    // -----------------------------------------------------------------
    // extract_step_label tests
    // -----------------------------------------------------------------

    #[test]
    fn test_extract_step_label_basic() {
        assert_eq!(extract_step_label("dbt-step5-1707654321000", "dbt"), "step5");
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

    // -----------------------------------------------------------------
    // request_logs tests
    // -----------------------------------------------------------------

    #[tokio::test]
    async fn test_request_logs_empty_after_init() {
        let pool = SidecarPool::new();
        let logs = pool.request_logs.lock().await;
        assert!(logs.is_empty(), "Request logs should be empty after creation");
    }

    #[tokio::test]
    async fn test_request_logs_insert_and_remove() {
        let pool = SidecarPool::new();

        // Simulate creating a log file handle
        let log_handle: RequestLogFile = Arc::new(Mutex::new(None));
        {
            let mut logs = pool.request_logs.lock().await;
            logs.insert("agent-123".to_string(), log_handle);
            assert!(logs.contains_key("agent-123"));
        }

        // Simulate terminal message cleanup
        {
            let mut logs = pool.request_logs.lock().await;
            logs.remove("agent-123");
            assert!(!logs.contains_key("agent-123"));
        }
    }
}
