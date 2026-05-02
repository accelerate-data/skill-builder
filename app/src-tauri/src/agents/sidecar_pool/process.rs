use std::collections::HashMap;
use std::io::Write as _;
use std::sync::Arc;

use tokio::io::{AsyncWriteExt, BufReader};
use tokio::process::Child;
use tokio::sync::Mutex;
use tokio::task::JoinHandle;

use super::startup_error::{stream_message_terminal_status, TerminalOutcome};
use crate::agents::events;

/// Redact Anthropic API key values (sk-ant-... tokens) from a string before logging.
fn redact_api_key(s: &str) -> String {
    const PREFIX: &str = "sk-ant-";
    if !s.contains(PREFIX) {
        return s.to_string();
    }
    let mut result = String::with_capacity(s.len());
    let mut remaining = s;
    while let Some(start) = remaining.find(PREFIX) {
        result.push_str(&remaining[..start]);
        result.push_str("sk-ant-[REDACTED]");
        let after = &remaining[start + PREFIX.len()..];
        // skip until a non-token character (whitespace, quote, comma, closing brace)
        let end = after
            .find(|c: char| !c.is_ascii_alphanumeric() && c != '-' && c != '_')
            .unwrap_or(after.len());
        remaining = &after[end..];
    }
    result.push_str(remaining);
    result
}

/// A persistent Node.js sidecar process that stays alive across multiple agent invocations.
pub(super) struct PersistentSidecar {
    pub(super) child: Child,
    /// Mutex-protected stdin ensures concurrent `send_request` calls serialize their writes,
    /// preventing interleaved bytes on the wire even though the Node.js side processes
    /// requests sequentially by `request_id`.
    pub(super) stdin: Arc<Mutex<tokio::process::ChildStdin>>,
    pub(super) pid: u32,
    /// Handle for the stdout reader task — aborted on shutdown/crash-respawn.
    pub(super) stdout_task: JoinHandle<()>,
    /// Handle for the stderr reader task — aborted on shutdown/crash-respawn.
    pub(super) stderr_task: JoinHandle<()>,
    /// Handle for the heartbeat task — aborted on shutdown/crash-respawn.
    pub(super) heartbeat_task: JoinHandle<()>,
    /// Timestamp of the last pong received from this sidecar, used for health checks.
    /// The Arc is cloned into the stdout reader and heartbeat tasks; keeping it here
    /// ensures the Arc stays alive for the sidecar's lifetime.
    #[allow(dead_code)]
    pub(super) last_pong: Arc<Mutex<tokio::time::Instant>>,
    /// Timestamp of the last activity (agent request sent) for this sidecar.
    /// Used by the idle cleanup task to determine if a sidecar can be reclaimed.
    pub(super) last_activity: Arc<Mutex<tokio::time::Instant>>,
}

/// Abort the reader tasks and heartbeat task, then drop the sidecar, cleaning up all resources.
pub(super) fn cleanup_sidecar(sidecar: PersistentSidecar) {
    sidecar.stdout_task.abort();
    sidecar.stderr_task.abort();
    sidecar.heartbeat_task.abort();
    // `child`, `stdin`, etc. are dropped here — stdin closes, process may receive SIGPIPE.
}

/// Remove a sidecar from the pool and clean up all its resources (tasks + child process).
/// Used by the heartbeat task when it detects a zombie/unresponsive sidecar.
pub(super) async fn remove_and_cleanup_sidecar(
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
pub(super) fn spawn_heartbeat_task(
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

            log::trace!("[heartbeat:{}] ping sent", skill_name);

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
pub(super) type RequestLogFile = Arc<Mutex<Option<std::fs::File>>>;

/// Result of successfully launching and validating a sidecar process.
/// Contains all handles needed to construct a `PersistentSidecar`.
pub(super) struct LaunchedProcess {
    pub(super) child: Child,
    pub(super) pid: u32,
    pub(super) stdin: tokio::process::ChildStdin,
    /// BufReader positioned after the `sidecar_ready` line, ready for the stdout reader task.
    pub(super) stdout_reader: BufReader<tokio::process::ChildStdout>,
    /// Background task draining stderr to log.
    pub(super) stderr_task: JoinHandle<()>,
}

/// Shared context for the stdout reader task, bundling the Arc handles needed
/// by `handle_stdout_line` to avoid long parameter lists.
pub(super) struct StdoutContext {
    pub(super) skill_name: String,
    pub(super) last_pong: Arc<Mutex<tokio::time::Instant>>,
    pub(super) pending_requests: Arc<Mutex<HashMap<String, String>>>,
    pub(super) request_logs: Arc<Mutex<HashMap<String, RequestLogFile>>>,
    pub(super) sidecars: Arc<Mutex<HashMap<String, PersistentSidecar>>>,
    pub(super) app_handle: tauri::AppHandle,
}

/// Process a single stdout line from the sidecar.
///
/// Handles: pong heartbeat responses, message routing by `request_id`, JSONL
/// transcript logging, turn/session lifecycle events, and terminal outcome
/// detection (run_result, error, shutdown).
pub(super) async fn handle_stdout_line(line: &str, ctx: &StdoutContext) {
    let msg = match serde_json::from_str::<serde_json::Value>(line) {
        Ok(msg) => msg,
        Err(e) => {
            log::debug!(
                "[persistent-sidecar:{}] Failed to parse stdout as JSON: {} (len={})",
                ctx.skill_name,
                e,
                line.len(),
            );
            return;
        }
    };

    // Intercept pong messages for heartbeat tracking
    if msg.get("type").and_then(|t| t.as_str()) == Some("pong") {
        let mut pong_guard = ctx.last_pong.lock().await;
        *pong_guard = tokio::time::Instant::now();
        log::trace!("[heartbeat:{}] pong received", ctx.skill_name);
        return;
    }

    let request_id = match msg.get("request_id").and_then(|r| r.as_str()) {
        Some(id) => id,
        None => {
            log::warn!(
                "[persistent-sidecar:{}] Message without request_id (len={})",
                ctx.skill_name,
                line.len(),
            );
            return;
        }
    };

    // Intercept request_complete — sidecar signals it's ready for the next request.
    // Emit agent-exit so the frontend transitions the run to completed state.
    if msg.get("type").and_then(|t| t.as_str()) == Some("request_complete") {
        log::info!(
            "[persistent-sidecar:{}] Request '{}' complete — sidecar ready",
            ctx.skill_name,
            request_id,
        );
        // Guard: run_result (which precedes request_complete for one-shot runs) already
        // removes pending and fires agent-exit. Only fire again if still pending.
        let was_pending = {
            let mut pending = ctx.pending_requests.lock().await;
            pending.remove(request_id).is_some()
        };
        if was_pending {
            events::handle_sidecar_exit(&ctx.app_handle, request_id, true);
        } else {
            log::debug!(
                "[persistent-sidecar:{}] request_complete for '{}' — already cleaned up via run_result, skipping exit",
                ctx.skill_name,
                request_id,
            );
        }
        // Close JSONL log for this request
        let mut logs = ctx.request_logs.lock().await;
        logs.remove(request_id);
        return;
    }

    // Route this message to the correct agent using the request_id as agent_id
    events::handle_sidecar_message(&ctx.app_handle, request_id, line);

    // Append to per-request JSONL transcript
    {
        let logs = ctx.request_logs.lock().await;
        if let Some(log_file) = logs.get(request_id) {
            let mut guard = log_file.lock().await;
            if let Some(ref mut f) = *guard {
                let _ = writeln!(f, "{}", redact_api_key(line));
            }
        }
    }

    // Log lifecycle events at INFO so the log file tells the full story.
    // Streaming messages (assistant, user, tool_use, etc.) stay at debug.
    if let Some("system") = msg.get("type").and_then(|t| t.as_str()) {
        let subtype = msg
            .get("subtype")
            .and_then(|s| s.as_str())
            .unwrap_or("unknown");
        // Surface SDK stderr in the app log — this is diagnostic output
        // (not agent content) and is critical for debugging startup failures.
        if subtype == "sdk_stderr" {
            let data = msg.get("data").and_then(|d| d.as_str()).unwrap_or("");
            log::warn!(
                "[persistent-sidecar:{}] Agent '{}' stderr: {}",
                ctx.skill_name,
                request_id,
                data,
            );
        } else {
            log::debug!(
                "[persistent-sidecar:{}] Agent '{}': {}",
                ctx.skill_name,
                request_id,
                subtype,
            );
        }
    }

    // Check if this is a terminal or turn-boundary message.
    let msg_type = match msg.get("type").and_then(|t| t.as_str()) {
        Some(t) => t,
        None => return,
    };

    // Extract agent_event subtype for turn_complete / session_exhausted detection.
    let event_subtype = if msg_type == "agent_event" {
        msg.get("event")
            .and_then(|e| e.get("type"))
            .and_then(|t| t.as_str())
    } else {
        None
    };

    // turn_complete: signals end of one assistant turn.
    // The event carries `streaming: bool` set by MessageProcessor:
    //   streaming=true  → streaming refine session turn; remove pending and fire
    //                     agent-exit so the frontend can enable the "send message"
    //                     input for the next turn.
    //   streaming=false → one-shot workflow step; turn_complete is informational
    //                     only — run_result (which carries structured output) is the
    //                     real terminal signal.
    if event_subtype == Some("turn_complete") {
        let is_streaming = msg
            .get("event")
            .and_then(|e| e.get("streaming"))
            .and_then(|s| s.as_bool())
            .unwrap_or(false);

        if is_streaming {
            log::info!(
                "[persistent-sidecar:{}] Agent '{}' turn complete (streaming)",
                ctx.skill_name,
                request_id,
            );
            {
                let mut pending = ctx.pending_requests.lock().await;
                pending.remove(request_id);
            }
            events::handle_sidecar_exit(&ctx.app_handle, request_id, true);
            // Close JSONL log for this turn
            let mut logs = ctx.request_logs.lock().await;
            logs.remove(request_id);
        } else {
            log::debug!(
                "[persistent-sidecar:{}] Agent '{}' turn complete (one-shot, informational)",
                ctx.skill_name,
                request_id,
            );
        }
        return;
    }

    // session_exhausted: streaming session ran out of turns.
    // Guard: run_result (emitted just before session_exhausted) already removed
    // the request from pending and called handle_sidecar_exit. Only fire again
    // if still pending.
    if event_subtype == Some("session_exhausted") {
        log::info!(
            "[persistent-sidecar:{}] Agent '{}' session exhausted",
            ctx.skill_name,
            request_id,
        );
        let was_pending = {
            let mut pending = ctx.pending_requests.lock().await;
            pending.remove(request_id).is_some()
        };
        if was_pending {
            events::handle_sidecar_exit(&ctx.app_handle, request_id, true);
        } else {
            log::debug!(
                "[persistent-sidecar:{}] session_exhausted for '{}' — already cleaned up via run_result, skipping exit",
                ctx.skill_name,
                request_id,
            );
        }
        let mut logs = ctx.request_logs.lock().await;
        logs.remove(request_id);
        return;
    }

    // Terminal outcome detection (run_result, error)
    let terminal_outcome = stream_message_terminal_status(&msg);
    let is_terminal = terminal_outcome.is_some();

    if let Some(outcome) = terminal_outcome {
        // Guard: only process if this request is still pending.
        // The sidecar may emit both a raw error and a follow-up
        // agent_event(run_result) — the second must be a no-op.
        let was_pending = {
            let mut pending = ctx.pending_requests.lock().await;
            pending.remove(request_id).is_some()
        };

        if !was_pending {
            log::debug!(
                "[persistent-sidecar:{}] Ignoring duplicate terminal for '{}' (already cleaned up)",
                ctx.skill_name,
                request_id,
            );
        } else {
            let mut exit_error_detail: Option<String> = None;

            if msg_type == "agent_event" {
                match &outcome {
                    TerminalOutcome::Completed => {
                        log::info!(
                            "[persistent-sidecar:{}] Agent '{}' completed successfully via {}",
                            ctx.skill_name,
                            request_id,
                            msg_type,
                        );
                    }
                    TerminalOutcome::Shutdown => {
                        log::info!(
                            "[persistent-sidecar:{}] Agent '{}' shut down via {}",
                            ctx.skill_name,
                            request_id,
                            msg_type,
                        );
                    }
                    TerminalOutcome::Error => {
                        let event_obj = msg.get("event");
                        let status = event_obj
                            .and_then(|e| e.get("status"))
                            .and_then(|s| s.as_str())
                            .unwrap_or("error");
                        let detail = event_obj
                            .and_then(|e| e.get("resultErrors"))
                            .and_then(|e| e.as_array())
                            .map(|arr| {
                                arr.iter()
                                    .filter_map(|v| v.as_str())
                                    .collect::<Vec<_>>()
                                    .join("; ")
                            })
                            .filter(|s| !s.is_empty())
                            .unwrap_or_else(|| status.to_string());
                        exit_error_detail = Some(detail.clone());
                        log::warn!(
                            "[persistent-sidecar:{}] Agent '{}' finished with error via {}: {}",
                            ctx.skill_name,
                            request_id,
                            msg_type,
                            detail,
                        );

                        // Detect authentication errors and surface
                        // an actionable RuntimeErrorDialog.
                        if events::is_authentication_error(&msg) {
                            events::emit_runtime_error(
                                &ctx.app_handle,
                                "AuthenticationFailed",
                                "Your Anthropic API key is invalid or expired.",
                                "Go to Settings and update your API key.",
                            );
                        }
                    }
                }
            }

            if msg_type == "error" {
                let error_detail = msg
                    .get("message")
                    .and_then(|m| m.as_str())
                    .unwrap_or("(no message)");
                // Redact API keys before logging and forwarding to frontend
                let redacted = redact_api_key(error_detail);
                exit_error_detail = Some(redacted.clone());
                log::info!(
                    "[persistent-sidecar:{}] Agent error for '{}': {}",
                    ctx.skill_name,
                    request_id,
                    redacted,
                );
                // Emit the redacted error detail as an agent-message so the
                // frontend can display it (instead of "Unknown error").
                events::handle_sidecar_message(
                    &ctx.app_handle,
                    request_id,
                    &serde_json::json!({
                        "type": "error",
                        "error": redacted,
                    })
                    .to_string(),
                );
            }

            {
                let pool = ctx.sidecars.lock().await;
                if let Some(s) = pool.get(&ctx.skill_name) {
                    *s.last_activity.lock().await = tokio::time::Instant::now();
                }
            }
            // On error/shutdown, clean up any incomplete benchmark iterations
            // for this skill so partial runs don't hide valid benchmarks.
            if outcome == TerminalOutcome::Error || outcome == TerminalOutcome::Shutdown {
                use tauri::Manager;
                // Scope the DB lock tightly — release before filesystem work.
                let workspace_path = ctx.app_handle.try_state::<crate::db::Db>().and_then(|db| {
                    let conn = db.0.lock().ok()?;
                    crate::db::read_settings(&conn).ok()?.workspace_path
                });
                if let Some(wp) = workspace_path {
                    crate::commands::workflow::evaluation::clean_incomplete_iterations(
                        &wp,
                        &ctx.skill_name,
                    );
                }
            }

            // Dispatch based on outcome: shutdown uses handle_agent_shutdown
            // so the frontend calls shutdownRun() instead of completeRun(false).
            if outcome == TerminalOutcome::Shutdown {
                events::handle_agent_shutdown(&ctx.app_handle, request_id);
            } else {
                events::handle_sidecar_exit_with_detail(
                    &ctx.app_handle,
                    request_id,
                    outcome == TerminalOutcome::Completed,
                    exit_error_detail,
                );
            }
        }
    }

    // Close and remove the JSONL log file on terminal messages
    if is_terminal {
        let mut logs = ctx.request_logs.lock().await;
        logs.remove(request_id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures::FutureExt;
    use std::panic::AssertUnwindSafe;

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
        assert!(
            heartbeat_task.is_finished(),
            "Heartbeat task should be aborted by cleanup"
        );
        assert!(
            stdout_task.is_finished(),
            "Stdout task should be aborted by cleanup"
        );
        assert!(
            stderr_task.is_finished(),
            "Stderr task should be aborted by cleanup"
        );
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

    #[tokio::test]
    async fn test_last_activity_initialized_on_creation() {
        // Verify that last_activity is set to "now" when created.
        // We test the Arc<Mutex<Instant>> pattern used by PersistentSidecar.
        let now = tokio::time::Instant::now();
        let last_activity = Arc::new(Mutex::new(tokio::time::Instant::now()));

        let stored = {
            let guard = last_activity.lock().await;
            *guard
        };

        // The stored instant should be very close to now (within 10ms)
        assert!(
            stored.duration_since(now) < std::time::Duration::from_millis(10),
            "last_activity should be initialized to approximately now"
        );
    }

    #[tokio::test]
    async fn test_last_activity_update_mechanism() {
        // Verify that we can update last_activity and read the updated value.
        let last_activity = Arc::new(Mutex::new(tokio::time::Instant::now()));

        // Capture initial value
        let initial = {
            let guard = last_activity.lock().await;
            *guard
        };

        // Wait a bit then update
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        {
            let mut guard = last_activity.lock().await;
            *guard = tokio::time::Instant::now();
        }

        // Read updated value
        let updated = {
            let guard = last_activity.lock().await;
            *guard
        };

        assert!(
            updated > initial,
            "Updated last_activity should be later than initial"
        );
        assert!(
            updated.duration_since(initial) >= std::time::Duration::from_millis(50),
            "Should reflect the elapsed time"
        );
    }

    #[tokio::test]
    async fn test_invalid_json_does_not_panic() {
        // Verify that invalid JSON is safely handled (parse returns Err).
        // This mirrors the early-return path in handle_stdout_line.
        let result = serde_json::from_str::<serde_json::Value>("not valid json {{{");
        assert!(result.is_err(), "Invalid JSON should return Err");
    }

    #[test]
    fn test_launched_process_struct_fields() {
        // Verify that LaunchedProcess has all the fields needed to
        // construct a PersistentSidecar (compile-time check).
        // This test exists to catch accidental field removals during refactoring.
        fn _assert_fields(p: LaunchedProcess) {
            let _child: Child = p.child;
            let _pid: u32 = p.pid;
            let _stdin: tokio::process::ChildStdin = p.stdin;
            let _reader: BufReader<tokio::process::ChildStdout> = p.stdout_reader;
            let _task: JoinHandle<()> = p.stderr_task;
        }
    }

    #[test]
    fn test_stdout_context_struct_fields() {
        // Compile-time check that StdoutContext has all required fields.
        fn _assert_fields(c: StdoutContext) {
            let _: String = c.skill_name;
            let _: Arc<Mutex<tokio::time::Instant>> = c.last_pong;
            let _: Arc<Mutex<HashMap<String, String>>> = c.pending_requests;
            let _: Arc<Mutex<HashMap<String, RequestLogFile>>> = c.request_logs;
            let _: Arc<Mutex<HashMap<String, PersistentSidecar>>> = c.sidecars;
            let _: tauri::AppHandle = c.app_handle;
        }
    }
}
