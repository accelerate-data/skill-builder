use crate::db::Db;

/// Check if any agents are currently running for the given workflow session.
/// If no session ID is provided (app closed from outside a workflow), returns false.
#[tauri::command]
pub async fn has_running_agents(
    workflow_session_id: Option<String>,
    db: tauri::State<'_, Db>,
) -> Result<bool, String> {
    log::info!("[has_running_agents] session_id=[REDACTED]");
    let session_id = match workflow_session_id {
        Some(id) => id,
        None => {
            log::info!("[has_running_agents] no session, returning false");
            return Ok(false);
        }
    };

    let conn = db.0.lock().map_err(|e| {
        log::error!("[has_running_agents] Failed to acquire DB lock: {}", e);
        e.to_string()
    })?;
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM agent_runs
             WHERE status = 'running'
               AND workflow_session_id = ?1",
            rusqlite::params![session_id],
            |row| row.get(0),
        )
        .map_err(|e| {
            log::error!("[has_running_agents] DB query failed: {}", e);
            e.to_string()
        })?;
    let running = count > 0;
    log::info!("[has_running_agents] running={} count={} session=[REDACTED]", running, count);
    Ok(running)
}
