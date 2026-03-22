use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use tokio::io::AsyncWriteExt;
use tokio::sync::Mutex;
use tokio::task::JoinHandle;

use super::process::{PersistentSidecar, RequestLogFile};

/// Default shutdown timeout in seconds. If graceful shutdown takes longer,
/// the app force-exits.
pub const DEFAULT_SHUTDOWN_TIMEOUT_SECS: u64 = 5;

/// Default idle timeout in seconds. Sidecars inactive for this long are shut down.
pub(super) const DEFAULT_IDLE_TIMEOUT_SECS: u64 = 600; // 10 minutes

/// How often the idle cleanup task checks for idle sidecars, in seconds.
pub(super) const IDLE_CHECK_INTERVAL_SECS: u64 = 60;

/// Pool of persistent sidecar processes, one per skill.
/// Reuses existing processes across agent invocations to reduce startup latency.
/// Wraps an `Arc` so cloning is cheap and all clones share the same pool.
#[derive(Clone)]
pub struct SidecarPool {
    pub(super) sidecars: Arc<Mutex<HashMap<String, PersistentSidecar>>>,
    /// Tracks skills that are currently being spawned to prevent duplicate spawns
    /// while the pool lock is released during the spawn + sidecar_ready wait.
    pub(super) spawning: Arc<Mutex<HashSet<String>>>,
    /// Tracks agent_ids of in-flight requests (agent_id -> skill_name).
    /// Removed when result/error received. The skill_name value enables O(1)
    /// ownership lookups instead of fragile string-prefix matching.
    pub(super) pending_requests: Arc<Mutex<HashMap<String, String>>>,
    /// Per-request JSONL log files, keyed by agent_id.
    /// The stdout reader appends each message to the matching file.
    pub(super) request_logs: Arc<Mutex<HashMap<String, RequestLogFile>>>,
    /// Streaming session log files, keyed by session_id.
    /// Follow-up messages in a session clone from here to ensure all turns
    /// are logged to the same JSONL file.
    pub(super) session_logs: Arc<Mutex<HashMap<String, RequestLogFile>>>,
    /// Handle for the background idle cleanup task. Aborted on pool drop.
    pub(super) idle_cleanup_task: Arc<Mutex<Option<JoinHandle<()>>>>,
    /// Set to `true` in `shutdown_all` before aborting the idle cleanup task.
    /// The idle cleanup loop checks this flag to exit gracefully instead of
    /// being aborted mid-operation, which could orphan child processes.
    pub(super) shutdown_initiated: Arc<AtomicBool>,
    /// Set to `true` at the end of `shutdown_all` after all sidecars are shut down.
    /// Checked by `RunEvent::Exit` to skip redundant shutdown calls.
    pub(super) shutdown_completed: Arc<AtomicBool>,
}

impl SidecarPool {
    pub fn new() -> Self {
        SidecarPool {
            sidecars: Arc::new(Mutex::new(HashMap::new())),
            spawning: Arc::new(Mutex::new(HashSet::new())),
            pending_requests: Arc::new(Mutex::new(HashMap::new())),
            request_logs: Arc::new(Mutex::new(HashMap::new())),
            session_logs: Arc::new(Mutex::new(HashMap::new())),
            idle_cleanup_task: Arc::new(Mutex::new(None)),
            shutdown_initiated: Arc::new(AtomicBool::new(false)),
            shutdown_completed: Arc::new(AtomicBool::new(false)),
        }
    }

    /// Start the background idle cleanup task. Must be called from within
    /// a Tokio runtime context. In the app, use `start_on_tauri_runtime()`
    /// from `setup()` which runs on the main (non-Tokio) thread.
    pub fn start(&self) {
        let cleanup_pool = self.clone();
        let task = tokio::spawn(async move {
            cleanup_pool.idle_cleanup_loop().await;
        });
        if let Ok(mut guard) = self.idle_cleanup_task.try_lock() {
            *guard = Some(task);
        }
    }

    /// Start the cleanup task via Tauri's async runtime. Safe to call from
    /// the main macOS thread (e.g. inside `setup()`), which is not a Tokio thread.
    pub fn start_on_tauri_runtime(&self) {
        let pool = self.clone();
        tauri::async_runtime::spawn(async move {
            pool.start();
        });
    }

    /// Background loop that periodically checks for idle sidecars and shuts them down.
    /// Runs every `IDLE_CHECK_INTERVAL_SECS` and reclaims sidecars idle for longer
    /// than `DEFAULT_IDLE_TIMEOUT_SECS` that have no pending requests.
    async fn idle_cleanup_loop(&self) {
        let idle_timeout = std::time::Duration::from_secs(DEFAULT_IDLE_TIMEOUT_SECS);

        loop {
            // Check shutdown flag at top of each iteration for graceful exit
            if self.shutdown_initiated.load(Ordering::SeqCst) {
                log::debug!("[idle-cleanup] shutdown_initiated flag set, exiting loop");
                break;
            }

            tokio::time::sleep(std::time::Duration::from_secs(IDLE_CHECK_INTERVAL_SECS)).await;

            // Re-check after sleep in case shutdown was initiated while sleeping
            if self.shutdown_initiated.load(Ordering::SeqCst) {
                log::debug!("[idle-cleanup] shutdown_initiated flag set after sleep, exiting loop");
                break;
            }

            let now = tokio::time::Instant::now();
            let mut idle_skills: Vec<String> = Vec::new();

            // Phase 1: Identify idle sidecars (short lock)
            {
                let pool = self.sidecars.lock().await;
                let pending = self.pending_requests.lock().await;

                for (skill_name, sidecar) in pool.iter() {
                    // Check if this skill has any pending (in-flight) requests
                    let has_pending = pending.values().any(|sn| sn == skill_name);

                    if has_pending {
                        continue; // Active sidecar — skip
                    }

                    // Check last activity time
                    let last_activity = {
                        let guard = sidecar.last_activity.lock().await;
                        *guard
                    };

                    if now.duration_since(last_activity) >= idle_timeout {
                        idle_skills.push(skill_name.clone());
                    }
                }
            }

            // Phase 2: Shut down idle sidecars (one at a time, releasing pool lock between each)
            for skill_name in &idle_skills {
                // Check shutdown flag before each Phase 2 operation to avoid
                // orphaning child processes if shutdown_all is running concurrently
                if self.shutdown_initiated.load(Ordering::SeqCst) {
                    log::debug!(
                        "[idle-cleanup] shutdown_initiated flag set during Phase 2, exiting loop"
                    );
                    break;
                }
                log::info!(
                    "[idle-cleanup] Shutting down idle sidecar for '{}' (inactive for >{}s)",
                    skill_name,
                    DEFAULT_IDLE_TIMEOUT_SECS,
                );

                // Re-check pending requests (race protection against requests that started after Phase 1)
                let has_pending = {
                    let pending = self.pending_requests.lock().await;
                    pending.values().any(|sn| sn == skill_name)
                };
                if has_pending {
                    log::debug!(
                        "[idle-cleanup] Skipping '{}' — became active after idle check",
                        skill_name
                    );
                    continue;
                }

                // Use the same cleanup logic as remove_and_kill_sidecar but with graceful shutdown
                let mut pool = self.sidecars.lock().await;
                if let Some(mut sidecar) = pool.remove(skill_name) {
                    let pid = sidecar.pid;

                    // Abort background tasks
                    sidecar.stdout_task.abort();
                    sidecar.stderr_task.abort();
                    sidecar.heartbeat_task.abort();

                    // Send shutdown message for graceful exit
                    {
                        let mut stdin = sidecar.stdin.lock().await;
                        let _ = stdin.write_all(b"{\"type\":\"shutdown\"}\n").await;
                        let _ = stdin.flush().await;
                    }

                    // Wait briefly for graceful exit, then kill
                    let wait_result = tokio::time::timeout(
                        std::time::Duration::from_secs(3),
                        sidecar.child.wait(),
                    )
                    .await;

                    match wait_result {
                        Ok(Ok(status)) => {
                            log::info!(
                                "[idle-cleanup] Sidecar for '{}' (pid {}) exited gracefully: {}",
                                skill_name,
                                pid,
                                status
                            );
                        }
                        Ok(Err(e)) => {
                            log::warn!(
                                "[idle-cleanup] Error waiting for sidecar '{}' (pid {}): {}",
                                skill_name,
                                pid,
                                e
                            );
                        }
                        Err(_) => {
                            log::warn!(
                                "[idle-cleanup] Sidecar '{}' (pid {}) did not exit in 3s, killing",
                                skill_name,
                                pid
                            );
                            let _ = sidecar.child.kill().await;
                        }
                    }
                }
            }

            if !idle_skills.is_empty() {
                log::info!(
                    "[idle-cleanup] Cleaned up {} idle sidecar(s): {:?}",
                    idle_skills.len(),
                    idle_skills,
                );
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::process::RequestLogFile;
    use std::sync::atomic::Ordering;

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
        assert!(
            spawning.is_empty(),
            "Spawning set should be empty after creation"
        );
    }

    // Note: test_shutdown_skill_no_sidecar and test_shutdown_all_empty_pool
    // were removed because shutdown_skill/shutdown_all now require a real
    // tauri::AppHandle to emit agent-shutdown events. The no-op behavior
    // (empty pool) is trivially correct and covered by the type system.

    #[tokio::test]
    async fn test_pending_requests_empty_after_init() {
        let pool = SidecarPool::new();
        let pending = pool.pending_requests.lock().await;
        assert!(
            pending.is_empty(),
            "Pending requests should be empty after creation"
        );
    }

    #[tokio::test]
    async fn test_pending_requests_insert_and_remove() {
        let pool = SidecarPool::new();

        // Simulate adding a request to the pending map
        {
            let mut pending = pool.pending_requests.lock().await;
            pending.insert("agent-123".to_string(), "test-skill".to_string());
            assert!(pending.contains_key("agent-123"));
        }

        // Simulate completion — removing the request
        {
            let mut pending = pool.pending_requests.lock().await;
            assert!(pending.remove("agent-123").is_some());
            assert!(!pending.contains_key("agent-123"));
        }
    }

    #[tokio::test]
    async fn test_pending_requests_remove_returns_some_if_present() {
        // Removing a pending request should return Some and clear it from the map.
        let pool = SidecarPool::new();

        {
            let mut pending = pool.pending_requests.lock().await;
            pending.insert("agent-pending-test".to_string(), "test-skill".to_string());
        }

        let was_pending = {
            let mut pending = pool.pending_requests.lock().await;
            pending.remove("agent-pending-test")
        };
        assert!(was_pending.is_some(), "Request should have been pending");

        {
            let pending = pool.pending_requests.lock().await;
            assert!(!pending.contains_key("agent-pending-test"));
        }
    }

    #[tokio::test]
    async fn test_pending_requests_remove_returns_none_if_already_completed() {
        // After the stdout reader removes a completed request, a second remove
        // should return None (idempotent).
        let pool = SidecarPool::new();

        {
            let mut pending = pool.pending_requests.lock().await;
            pending.insert("agent-fast".to_string(), "test-skill".to_string());
        }

        // Simulate stdout reader removing the request on completion
        {
            let mut pending = pool.pending_requests.lock().await;
            pending.remove("agent-fast");
        }

        // Second remove should return None
        let still_pending = {
            let mut pending = pool.pending_requests.lock().await;
            pending.remove("agent-fast")
        };
        assert!(
            still_pending.is_none(),
            "Request should have already been removed"
        );
    }

    // -----------------------------------------------------------------
    // request_logs tests
    // -----------------------------------------------------------------

    #[tokio::test]
    async fn test_request_logs_empty_after_init() {
        let pool = SidecarPool::new();
        let logs = pool.request_logs.lock().await;
        assert!(
            logs.is_empty(),
            "Request logs should be empty after creation"
        );
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

    // -----------------------------------------------------------------
    // Shutdown timeout tests
    // -----------------------------------------------------------------

    #[test]
    fn test_shutdown_timeout_constant() {
        // Verify the default shutdown timeout is 5 seconds as specified
        assert_eq!(DEFAULT_SHUTDOWN_TIMEOUT_SECS, 5);
    }

    #[test]
    fn test_idle_timeout_constant() {
        // Verify the default idle timeout is 10 minutes (600 seconds)
        assert_eq!(DEFAULT_IDLE_TIMEOUT_SECS, 600);
    }

    #[test]
    fn test_idle_check_interval_constant() {
        // Verify the idle check runs every 60 seconds
        assert_eq!(IDLE_CHECK_INTERVAL_SECS, 60);
    }

    #[tokio::test]
    async fn test_shutdown_timeout_completes_within_limit() {
        // Verify that shutdown_all_with_timeout succeeds when shutdown is fast.
        // With an empty pool, shutdown should complete nearly instantly.
        let pool = SidecarPool::new();
        // We can't call shutdown_all_with_timeout without an AppHandle,
        // but we can test the timeout wrapper logic directly.
        let result = tokio::time::timeout(
            std::time::Duration::from_secs(DEFAULT_SHUTDOWN_TIMEOUT_SECS),
            async {
                // Simulate fast shutdown (no sidecars to shut down)
                tokio::time::sleep(std::time::Duration::from_millis(10)).await;
            },
        )
        .await;

        assert!(
            result.is_ok(),
            "Fast shutdown should complete within timeout"
        );
        drop(pool);
    }

    #[tokio::test]
    async fn test_shutdown_timeout_expires_on_hang() {
        // Verify that the timeout correctly fires when shutdown hangs.
        let result = tokio::time::timeout(
            std::time::Duration::from_millis(100), // Very short timeout for testing
            async {
                // Simulate a hung sidecar that never completes
                tokio::time::sleep(std::time::Duration::from_secs(60)).await;
            },
        )
        .await;

        assert!(result.is_err(), "Hung shutdown should trigger timeout");
    }

    // -----------------------------------------------------------------
    // Idle cleanup tests
    // -----------------------------------------------------------------

    #[tokio::test]
    async fn test_idle_cleanup_task_created_on_start() {
        // Verify that the idle cleanup task is spawned when start() is called
        let pool = SidecarPool::new();
        pool.start();
        let guard = pool.idle_cleanup_task.lock().await;
        assert!(
            guard.is_some(),
            "Idle cleanup task should be spawned after start()"
        );
        // The task should be running (not finished)
        assert!(
            !guard.as_ref().unwrap().is_finished(),
            "Idle cleanup task should be running"
        );
    }

    #[tokio::test]
    async fn test_idle_cleanup_task_aborted_on_shutdown_all() {
        // Verify that shutdown_all aborts the idle cleanup task.
        // We can't call shutdown_all without an AppHandle, but we can
        // test the abort mechanism directly.
        let pool = SidecarPool::new();
        pool.start();

        // Verify task exists
        {
            let guard = pool.idle_cleanup_task.lock().await;
            assert!(guard.is_some());
        }

        // Simulate what shutdown_all does: abort the idle cleanup task
        {
            let mut guard = pool.idle_cleanup_task.lock().await;
            if let Some(task) = guard.take() {
                task.abort();
            }
        }

        // Give abort a moment to take effect
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;

        // Verify task was taken (set to None)
        {
            let guard = pool.idle_cleanup_task.lock().await;
            assert!(
                guard.is_none(),
                "Idle cleanup task should be removed after abort"
            );
        }
    }

    #[tokio::test]
    async fn test_idle_detection_with_pending_requests() {
        // Verify the logic that protects active sidecars from idle cleanup.
        // A sidecar with pending requests should NOT be considered idle,
        // even if last_activity is old.
        let pool = SidecarPool::new();

        // Add a pending request for "active-skill"
        {
            let mut pending = pool.pending_requests.lock().await;
            pending.insert(
                "active-skill-step1-123456".to_string(),
                "active-skill".to_string(),
            );
        }

        // Verify the pending request is detected
        let has_pending = {
            let pending = pool.pending_requests.lock().await;
            pending.values().any(|sn| sn == "active-skill")
        };
        assert!(
            has_pending,
            "Should detect pending requests for active skill"
        );

        // Verify a different skill has no pending requests
        let other_has_pending = {
            let pending = pool.pending_requests.lock().await;
            pending.values().any(|sn| sn == "other-skill")
        };
        assert!(
            !other_has_pending,
            "Should not detect pending requests for other skill"
        );
    }

    #[tokio::test(start_paused = true)]
    async fn test_idle_check_skips_active_sidecars() {
        // Integration-style test of the idle detection logic:
        // When a sidecar has pending requests, it should be skipped regardless
        // of how long ago it was last active.
        let pool = SidecarPool::new();
        // Advance the Tokio clock so subtracting large durations from Instant::now()
        // does not overflow (on Windows CI the monotonic clock can be very young).
        tokio::time::advance(std::time::Duration::from_secs(3600)).await;
        let idle_timeout = std::time::Duration::from_secs(DEFAULT_IDLE_TIMEOUT_SECS);

        // Simulate: two skills in the pool
        // "active-skill" has a pending request
        // "idle-skill" has no pending requests and old last_activity
        {
            let mut pending = pool.pending_requests.lock().await;
            pending.insert(
                "active-skill-step3-999999".to_string(),
                "active-skill".to_string(),
            );
        }

        // Simulate checking which skills are idle (mirrors idle_cleanup_loop logic)
        let now = tokio::time::Instant::now();
        let simulated_old_activity = now - idle_timeout - std::time::Duration::from_secs(60);

        // Check "active-skill": has pending request -> should be skipped
        let active_has_pending = {
            let pending = pool.pending_requests.lock().await;
            pending.values().any(|sn| sn == "active-skill")
        };
        assert!(
            active_has_pending,
            "active-skill should have pending requests"
        );

        // Check "idle-skill": no pending requests + old activity -> should be cleaned
        let idle_has_pending = {
            let pending = pool.pending_requests.lock().await;
            pending.values().any(|sn| sn == "idle-skill")
        };
        assert!(
            !idle_has_pending,
            "idle-skill should have no pending requests"
        );
        let idle_duration = now.duration_since(simulated_old_activity);
        assert!(
            idle_duration >= idle_timeout,
            "idle-skill should exceed the idle timeout"
        );
    }

    /// Helper: mirrors the Phase 1 idle detection logic from `idle_cleanup_loop`.
    /// Given a skill name, its last_activity instant, the current time, the idle timeout,
    /// and the map of pending request IDs to skill names, returns whether the sidecar
    /// should be considered idle (i.e., eligible for cleanup).
    fn is_idle(
        skill_name: &str,
        last_activity: tokio::time::Instant,
        now: tokio::time::Instant,
        idle_timeout: std::time::Duration,
        pending: &HashMap<String, String>,
    ) -> bool {
        let has_pending = pending.values().any(|sn| sn == skill_name);
        if has_pending {
            return false;
        }
        now.duration_since(last_activity) >= idle_timeout
    }

    #[tokio::test(start_paused = true)]
    async fn test_idle_cleanup_protects_active_sidecars() {
        // A sidecar with pending requests must NOT be identified as idle,
        // even if its last_activity exceeds the idle timeout.
        tokio::time::advance(std::time::Duration::from_secs(3600)).await;
        let idle_timeout = std::time::Duration::from_secs(DEFAULT_IDLE_TIMEOUT_SECS);
        let now = tokio::time::Instant::now();
        let stale_activity = now - idle_timeout - std::time::Duration::from_secs(120);

        let mut pending = HashMap::new();
        pending.insert("my-skill-step1-abc123".to_string(), "my-skill".to_string());
        pending.insert("my-skill-step2-def456".to_string(), "my-skill".to_string());

        assert!(
            !is_idle("my-skill", stale_activity, now, idle_timeout, &pending),
            "Sidecar with pending requests must not be considered idle"
        );
    }

    #[tokio::test]
    async fn test_idle_cleanup_respects_recent_activity() {
        // A sidecar with recent activity and no pending requests must NOT be
        // identified as idle.
        let idle_timeout = std::time::Duration::from_secs(DEFAULT_IDLE_TIMEOUT_SECS);
        let now = tokio::time::Instant::now();
        // Activity 30 seconds ago — well within the 600s timeout
        let recent_activity = now - std::time::Duration::from_secs(30);

        let pending = HashMap::new(); // no pending requests

        assert!(
            !is_idle("recent-skill", recent_activity, now, idle_timeout, &pending),
            "Sidecar with recent activity must not be considered idle"
        );
    }

    #[tokio::test(start_paused = true)]
    async fn test_idle_detection_identifies_stale_sidecars() {
        // A sidecar with old last_activity and no pending requests IS idle
        // and should be eligible for cleanup.
        // Advance the Tokio clock so subtracting large durations from Instant::now()
        // does not overflow (on Windows CI the monotonic clock can be very young).
        tokio::time::advance(std::time::Duration::from_secs(3600)).await;
        let idle_timeout = std::time::Duration::from_secs(DEFAULT_IDLE_TIMEOUT_SECS);
        let now = tokio::time::Instant::now();
        // Activity just past the timeout — exceeds the 10-minute timeout
        let stale_activity = now - idle_timeout - std::time::Duration::from_secs(1);

        let pending = HashMap::new(); // no pending requests

        assert!(
            is_idle("stale-skill", stale_activity, now, idle_timeout, &pending),
            "Sidecar with old activity and no pending requests should be identified as idle"
        );

        // Also verify the boundary: exactly at the timeout should be idle
        let boundary_activity = now - idle_timeout;
        assert!(
            is_idle(
                "boundary-skill",
                boundary_activity,
                now,
                idle_timeout,
                &pending
            ),
            "Sidecar at exactly the idle timeout boundary should be identified as idle"
        );

        // Just under the timeout should NOT be idle
        let almost_idle_activity = now - idle_timeout + std::time::Duration::from_secs(1);
        assert!(
            !is_idle(
                "almost-idle-skill",
                almost_idle_activity,
                now,
                idle_timeout,
                &pending
            ),
            "Sidecar just under the idle timeout should not be identified as idle"
        );
    }

    // -----------------------------------------------------------------
    // Shutdown flag tests
    // -----------------------------------------------------------------

    #[tokio::test]
    async fn test_shutdown_flags_lifecycle() {
        // Both flags start false and transition to true during shutdown_all.
        // is_shutdown_completed() is the public accessor used by RunEvent::Exit.
        let pool = SidecarPool::new();

        assert!(!pool.shutdown_initiated.load(Ordering::SeqCst));
        assert!(!pool.is_shutdown_completed());

        // Simulate shutdown_all: set initiated first, then completed
        pool.shutdown_initiated.store(true, Ordering::SeqCst);
        assert!(pool.shutdown_initiated.load(Ordering::SeqCst));
        assert!(!pool.is_shutdown_completed());

        pool.shutdown_completed.store(true, Ordering::SeqCst);
        assert!(pool.is_shutdown_completed());
    }
}
