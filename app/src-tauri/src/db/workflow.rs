use rusqlite::Connection;

use super::locks::check_pid_alive;
use super::skills::get_skill_master_id;

// --- Workflow Sessions ---

pub fn create_workflow_session(
    conn: &Connection,
    session_id: &str,
    skill_name: &str,
    pid: u32,
) -> Result<(), String> {
    let skill_master_id = get_skill_master_id(conn, skill_name)?;
    conn.execute(
        "INSERT OR IGNORE INTO workflow_sessions (session_id, skill_name, skill_id, pid) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![session_id, skill_name, skill_master_id, pid as i64],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn end_workflow_session(conn: &Connection, session_id: &str) -> Result<(), String> {
    conn.execute(
        "UPDATE workflow_sessions SET ended_at = datetime('now') || 'Z' WHERE session_id = ?1 AND ended_at IS NULL",
        [session_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn end_all_sessions_for_pid(conn: &Connection, pid: u32) -> Result<u32, String> {
    let count = conn
        .execute(
            "UPDATE workflow_sessions SET ended_at = datetime('now') || 'Z' WHERE pid = ?1 AND ended_at IS NULL",
            rusqlite::params![pid as i64],
        )
        .map_err(|e| e.to_string())?;
    Ok(count as u32)
}

pub fn record_reconciliation_event(
    conn: &Connection,
    event_type: &str,
    details: &str,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO reconciliation_events (event_type, details) VALUES (?1, ?2)",
        rusqlite::params![event_type, details],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Returns true if the given skill has an active workflow session (ended_at IS NULL)
/// whose PID is still alive. Used by startup reconciliation to skip skills owned by
/// another running instance.
pub fn has_active_session_with_live_pid(conn: &Connection, skill_name: &str) -> bool {
    let s_id = match get_skill_master_id(conn, skill_name) {
        Ok(Some(id)) => id,
        _ => return false,
    };

    let mut stmt = match conn
        .prepare("SELECT pid FROM workflow_sessions WHERE skill_id = ?1 AND ended_at IS NULL")
    {
        Ok(s) => s,
        Err(_) => return false,
    };

    let pids: Vec<u32> = match stmt.query_map(rusqlite::params![s_id], |row| {
        Ok(row.get::<_, i64>(0)? as u32)
    }) {
        Ok(rows) => rows.filter_map(|r| r.ok()).collect(),
        Err(_) => return false,
    };

    pids.iter().any(|&pid| check_pid_alive(pid))
}

pub fn reconcile_orphaned_sessions(conn: &Connection) -> Result<u32, String> {
    // Find all sessions that were never ended
    let mut stmt = conn
        .prepare("SELECT session_id, skill_name, pid FROM workflow_sessions WHERE ended_at IS NULL")
        .map_err(|e| e.to_string())?;

    let orphans: Vec<(String, String, u32)> = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)? as u32,
            ))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let mut reconciled = 0u32;
    for (session_id, skill_name, pid) in orphans {
        if !check_pid_alive(pid) {
            // Process is dead — close the session with the best available timestamp.
            // Use the latest agent_runs completed_at for this session, or fall back to started_at.
            let fallback_time: Option<String> = conn
                .query_row(
                    "SELECT COALESCE(
                        (SELECT MAX(completed_at) FROM agent_runs WHERE session_id = ?1 AND completed_at IS NOT NULL),
                        (SELECT started_at FROM workflow_sessions WHERE session_id = ?1)
                    )",
                    [&session_id],
                    |row| row.get(0),
                )
                .ok();

            if let Some(ended_at) = fallback_time {
                conn.execute(
                    "UPDATE workflow_sessions SET ended_at = ?1 WHERE session_id = ?2",
                    rusqlite::params![ended_at, session_id],
                )
                .map_err(|e| e.to_string())?;
            } else {
                // No timestamp available — use current time
                conn.execute(
                    "UPDATE workflow_sessions SET ended_at = datetime('now') || 'Z' WHERE session_id = ?1",
                    [&session_id],
                )
                .map_err(|e| e.to_string())?;
            }

            log::info!(
                "Reconciled orphaned session [REDACTED] for skill '{}' (PID [REDACTED] is dead)",
                skill_name
            );
            reconciled += 1;
        }
    }

    Ok(reconciled)
}

