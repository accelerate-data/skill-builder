use crate::agents::sidecar_pool::SidecarPool;
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
#[tauri::command]
pub async fn graceful_shutdown(
    pool: tauri::State<'_, SidecarPool>,
    db: tauri::State<'_, Db>,
    instance: tauri::State<'_, InstanceInfo>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    log::info!("[graceful_shutdown] called");

    // 1. Shutdown all persistent sidecars
    log::info!("[graceful_shutdown] shutting down all sidecars");
    pool.shutdown_all(&app_handle).await;
    log::info!("[graceful_shutdown] all sidecars shut down");

    // 2. Release all skill locks and end workflow sessions for this instance
    if let Ok(conn) = db.0.lock() {
        let _ = crate::db::release_all_instance_locks(&conn, &instance.id);
        let _ = crate::db::end_all_sessions_for_pid(&conn, instance.pid);
        log::info!("[graceful_shutdown] locks released, sessions ended");
    }

    log::info!("[graceful_shutdown] complete");
    Ok(())
}
