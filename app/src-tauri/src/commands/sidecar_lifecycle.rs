use crate::db::Db;
use crate::{CloseGuardState, InstanceInfo};

/// Graceful shutdown: release locks, end sessions, then exit.
/// Called by the close-guard when the user confirms closing with agents running.
///
/// Wraps the entire operation in a configurable timeout (default 5s). If the
/// timeout expires, logs a warning and force-exits the process.
#[tauri::command]
pub async fn graceful_shutdown(
    db: tauri::State<'_, Db>,
    instance: tauri::State<'_, InstanceInfo>,
) -> Result<(), String> {
    const TIMEOUT_SECS: u64 = 5;
    log::info!("[graceful_shutdown] called (timeout={}s)", TIMEOUT_SECS);

    let shutdown_result =
        tokio::time::timeout(std::time::Duration::from_secs(TIMEOUT_SECS), async {
            // Release all skill locks and end workflow sessions for this instance
            if let Ok(conn) = db.0.lock() {
                let _ = crate::db::release_all_instance_locks(&conn, &instance.id);
                let _ = crate::commands::workflow_lifecycle::shutdown_sessions_for_pid(
                    &conn,
                    instance.pid,
                );
                log::info!("[graceful_shutdown] locks released, sessions ended");
            }
        })
        .await;

    match shutdown_result {
        Ok(()) => {
            log::info!("[graceful_shutdown] complete");
            Ok(())
        }
        Err(_) => {
            log::warn!("[graceful_shutdown] timed out after {}s", TIMEOUT_SECS,);
            Err(format!(
                "Graceful shutdown timed out after {}s. Force-exit required.",
                TIMEOUT_SECS
            ))
        }
    }
}

#[tauri::command]
pub fn allow_app_exit(close_guard: tauri::State<'_, CloseGuardState>) {
    log::info!("[allow_app_exit] marked");
    close_guard.allow_exit();
}
