use crate::agents::sidecar_pool::{SidecarPool, DEFAULT_SHUTDOWN_TIMEOUT_SECS};
use crate::db::Db;
use crate::InstanceInfo;

#[tauri::command]
pub async fn cleanup_skill_sidecar(
    skill_name: String,
    pool: tauri::State<'_, SidecarPool>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    log::info!("[cleanup_skill_sidecar] skill={}", skill_name);
    pool.shutdown_skill(&skill_name, &app_handle).await
}

/// Graceful shutdown: stop all sidecars, release locks, end sessions, then exit.
/// Called by the close-guard when the user confirms closing with agents running.
///
/// Wraps the entire operation in a configurable timeout (default 5s). If the
/// timeout expires, logs a warning and force-exits the process.
#[tauri::command]
pub async fn graceful_shutdown(
    pool: tauri::State<'_, SidecarPool>,
    db: tauri::State<'_, Db>,
    instance: tauri::State<'_, InstanceInfo>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    log::info!(
        "[graceful_shutdown] called (timeout={}s)",
        DEFAULT_SHUTDOWN_TIMEOUT_SECS
    );

    let shutdown_result = tokio::time::timeout(
        std::time::Duration::from_secs(DEFAULT_SHUTDOWN_TIMEOUT_SECS),
        async {
            // 1. Shutdown all persistent sidecars
            log::info!("[graceful_shutdown] shutting down all sidecars");
            pool.shutdown_all(&app_handle).await;
            log::info!("[graceful_shutdown] all sidecars shut down");

            // 2. Release all skill locks and end workflow sessions for this instance
            if let Ok(conn) = db.0.lock() {
                let _ = crate::db::release_all_instance_locks(&conn, &instance.id);
                let _ = crate::commands::workflow_lifecycle::shutdown_sessions_for_pid(
                    &conn,
                    instance.pid,
                );
                log::info!("[graceful_shutdown] locks released, sessions ended");
            }
        },
    )
    .await;

    match shutdown_result {
        Ok(()) => {
            log::info!("[graceful_shutdown] complete");
            Ok(())
        }
        Err(_) => {
            log::warn!(
                "[graceful_shutdown] timed out after {}s",
                DEFAULT_SHUTDOWN_TIMEOUT_SECS,
            );
            Err(format!(
                "Graceful shutdown timed out after {}s. Force-exit required.",
                DEFAULT_SHUTDOWN_TIMEOUT_SECS
            ))
        }
    }
}
