// Lifecycle commands — window close guard, shutdown orchestration, and runtime config.
// has_running_agents was removed in VU-470: the close guard now uses
// in-memory state (workflow isRunning/gateLoading, refine/test isRunning)
// instead of querying persisted usage history, so no Tauri command is needed.

#[tauri::command]
pub fn set_log_level(level: String) -> Result<(), String> {
    log::info!("[set_log_level] level={}", level);
    crate::logging::set_log_level(&level);
    Ok(())
}

#[tauri::command]
pub fn get_log_file_path(app: tauri::AppHandle) -> Result<String, String> {
    log::info!("[get_log_file_path]");
    crate::logging::get_log_file_path(&app)
}

/// Log a message from the frontend into the Rust app.log file.
#[tauri::command]
pub fn log_frontend(level: String, message: String) {
    match level.as_str() {
        "error" => log::error!("[frontend] {}", message),
        "warn" => log::warn!("[frontend] {}", message),
        "debug" => log::debug!("[frontend] {}", message),
        _ => log::info!("[frontend] {}", message),
    }
}
