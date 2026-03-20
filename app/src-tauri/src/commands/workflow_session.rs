use crate::db::Db;

#[tauri::command]
pub fn create_workflow_session(
    db: tauri::State<'_, Db>,
    instance: tauri::State<'_, crate::InstanceInfo>,
    session_id: String,
    skill_name: String,
) -> Result<(), String> {
    log::info!(
        "[create_workflow_session] session=[REDACTED] skill={}",
        skill_name
    );
    let conn = db.0.lock().map_err(|e| {
        log::error!("[create_workflow_session] Failed to acquire DB lock: {}", e);
        e.to_string()
    })?;
    crate::commands::workflow_lifecycle::start_session(
        &conn,
        &session_id,
        &skill_name,
        instance.pid,
    )
}

#[tauri::command]
pub fn end_workflow_session(db: tauri::State<'_, Db>, session_id: String) -> Result<(), String> {
    log::info!("[end_workflow_session] session=[REDACTED]");
    let conn = db.0.lock().map_err(|e| {
        log::error!("[end_workflow_session] Failed to acquire DB lock: {}", e);
        e.to_string()
    })?;
    crate::commands::workflow_lifecycle::cancel_session(&conn, &session_id)
}
