use rusqlite::{Connection, OptionalExtension};

use crate::types::{WorkflowRunRow, WorkflowStepRow};

use super::locks::check_pid_alive;
use super::skills::{
    delete_skill_in_plugin, get_skill_master_id_any_plugin, get_skill_master_id_in_plugin,
    upsert_skill,
};

// --- Workflow Run ---

/// Get the `workflow_runs.id` integer for a given `skill_name`. Returns None if not found.
pub fn get_workflow_run_id(conn: &Connection, skill_name: &str) -> Result<Option<i64>, String> {
    conn.query_row(
        "SELECT id FROM workflow_runs WHERE skill_name = ?1",
        rusqlite::params![skill_name],
        |row| row.get(0),
    )
    .optional()
    .map_err(|e| e.to_string())
}

pub fn save_workflow_run(
    conn: &Connection,
    skill_name: &str,
    current_step: i32,
    status: &str,
    purpose: &str,
) -> Result<(), String> {
    // Ensure the skills master row exists (skill-builder source) in the default plugin.
    // Redo resets a skill to the default plugin, so stale rows in non-default plugins
    // are cleaned up below to prevent sidebar duplicates.
    let skill_id = upsert_skill(conn, skill_name, "skill-builder", purpose)?;

    // Delete any rows for this skill in non-default plugins. This covers the redo case
    // where the skill was previously in a non-default plugin: upsert_skill above inserted
    // a new default-plugin row (ON CONFLICT key is (plugin_id, name)), so the old row
    // remains until explicitly removed here.
    conn.execute(
        "DELETE FROM skills
         WHERE name = ?1
           AND id != ?2
           AND plugin_id != (SELECT id FROM plugins WHERE is_default = 1 LIMIT 1)",
        rusqlite::params![skill_name, skill_id],
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT INTO workflow_runs (skill_name, current_step, status, purpose, skill_id, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, datetime('now') || 'Z')
         ON CONFLICT(skill_name) DO UPDATE SET
             current_step = ?2, status = ?3, purpose = ?4, skill_id = ?5, updated_at = datetime('now') || 'Z'",
        rusqlite::params![skill_name, current_step, status, purpose, skill_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn set_skill_author(
    conn: &Connection,
    skill_name: &str,
    author_login: &str,
    author_avatar: Option<&str>,
) -> Result<(), String> {
    conn.execute(
        "UPDATE workflow_runs SET author_login = ?2, author_avatar = ?3 WHERE skill_name = ?1",
        rusqlite::params![skill_name, author_login, author_avatar],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
pub fn set_skill_display_name(
    conn: &Connection,
    skill_name: &str,
    display_name: Option<&str>,
) -> Result<(), String> {
    conn.execute(
        "UPDATE workflow_runs SET display_name = ?2, updated_at = datetime('now') || 'Z' WHERE skill_name = ?1",
        rusqlite::params![skill_name, display_name],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn set_skill_intake(
    conn: &Connection,
    skill_name: &str,
    intake_json: Option<&str>,
) -> Result<(), String> {
    conn.execute(
        "UPDATE workflow_runs SET intake_json = ?2, updated_at = datetime('now') || 'Z' WHERE skill_name = ?1",
        rusqlite::params![skill_name, intake_json],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn get_workflow_run(
    conn: &Connection,
    skill_name: &str,
) -> Result<Option<WorkflowRunRow>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT skill_name, current_step, status, purpose, created_at, updated_at, author_login, author_avatar, display_name, intake_json, COALESCE(source, 'created')
             FROM workflow_runs WHERE skill_name = ?1",
        )
        .map_err(|e| e.to_string())?;

    let result = stmt.query_row(rusqlite::params![skill_name], |row| {
        Ok(WorkflowRunRow {
            skill_name: row.get(0)?,
            current_step: row.get(1)?,
            status: row.get(2)?,
            purpose: row.get(3)?,
            created_at: row.get(4)?,
            updated_at: row.get(5)?,
            author_login: row.get(6)?,
            author_avatar: row.get(7)?,
            display_name: row.get(8)?,
            intake_json: row.get(9)?,
            source: row.get(10)?,
        })
    });

    match result {
        Ok(run) => Ok(Some(run)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

pub fn get_purpose(conn: &Connection, skill_name: &str) -> Result<String, String> {
    get_workflow_run(conn, skill_name).map(|opt| {
        opt.map(|run| run.purpose)
            .unwrap_or_else(|| "domain".to_string())
    })
}

pub fn list_all_workflow_runs(conn: &Connection) -> Result<Vec<WorkflowRunRow>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT skill_name, current_step, status, purpose, created_at, updated_at, author_login, author_avatar, display_name, intake_json, COALESCE(source, 'created')
             FROM workflow_runs ORDER BY skill_name",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(WorkflowRunRow {
                skill_name: row.get(0)?,
                current_step: row.get(1)?,
                status: row.get(2)?,
                purpose: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
                author_login: row.get(6)?,
                author_avatar: row.get(7)?,
                display_name: row.get(8)?,
                intake_json: row.get(9)?,
                source: row.get(10)?,
            })
        })
        .map_err(|e| e.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

pub fn delete_workflow_run(
    conn: &Connection,
    skill_name: &str,
    plugin_slug: &str,
) -> Result<(), String> {
    // Look up FK ids before deleting the parent rows
    let wr_id = get_workflow_run_id(conn, skill_name)?
        .ok_or_else(|| format!("Workflow run not found for skill '{}'", skill_name))?;
    let s_id = get_skill_master_id_in_plugin(conn, skill_name, plugin_slug)?.ok_or_else(|| {
        format!(
            "Skill '{}' not found in plugin '{}'",
            skill_name, plugin_slug
        )
    })?;

    // Delete workflow-state child rows by FK columns only.
    // Usage history tables (agent_runs/workflow_sessions) are intentionally retained.
    conn.execute(
        "DELETE FROM workflow_artifacts WHERE workflow_run_id = ?1",
        rusqlite::params![wr_id],
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "DELETE FROM workflow_steps WHERE workflow_run_id = ?1",
        rusqlite::params![wr_id],
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "DELETE FROM skill_locks WHERE skill_id = ?1",
        rusqlite::params![s_id],
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "DELETE FROM skill_tags WHERE skill_id = ?1",
        rusqlite::params![s_id],
    )
    .map_err(|e| e.to_string())?;

    // Delete from imported_skills to prevent stale rows blocking re-import
    conn.execute(
        "DELETE FROM imported_skills WHERE skill_master_id = ?1",
        rusqlite::params![s_id],
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "DELETE FROM workflow_runs WHERE skill_name = ?1",
        [skill_name],
    )
    .map_err(|e| e.to_string())?;

    // Also delete from skills master table
    delete_skill_in_plugin(conn, skill_name, plugin_slug)?;
    Ok(())
}

// --- Workflow Steps ---

pub fn save_workflow_step(
    conn: &Connection,
    skill_name: &str,
    step_id: i32,
    status: &str,
) -> Result<(), String> {
    let now = chrono::Utc::now().to_rfc3339();
    let (started, completed) = match status {
        "in_progress" => (Some(now.clone()), None),
        "completed" => (None, Some(now)),
        _ => (None, None),
    };

    let workflow_run_id = get_workflow_run_id(conn, skill_name)?;

    conn.execute(
        "INSERT INTO workflow_steps (skill_name, step_id, status, started_at, completed_at, workflow_run_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(skill_name, step_id) DO UPDATE SET
             status = ?3,
             started_at = COALESCE(?4, started_at),
             completed_at = ?5,
             workflow_run_id = COALESCE(?6, workflow_run_id)",
        rusqlite::params![skill_name, step_id, status, started, completed, workflow_run_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn get_workflow_steps(
    conn: &Connection,
    skill_name: &str,
) -> Result<Vec<WorkflowStepRow>, String> {
    let wr_id = match get_workflow_run_id(conn, skill_name)? {
        Some(id) => id,
        None => return Ok(vec![]),
    };

    let mut stmt = conn
        .prepare(
            "SELECT skill_name, step_id, status, started_at, completed_at
             FROM workflow_steps WHERE workflow_run_id = ?1 ORDER BY step_id",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params![wr_id], |row| {
            Ok(WorkflowStepRow {
                skill_name: row.get(0)?,
                step_id: row.get(1)?,
                status: row.get(2)?,
                started_at: row.get(3)?,
                completed_at: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

pub fn reset_workflow_steps_from(
    conn: &Connection,
    skill_name: &str,
    from_step: i32,
) -> Result<(), String> {
    let wr_id = match get_workflow_run_id(conn, skill_name)? {
        Some(id) => id,
        None => return Ok(()),
    };
    conn.execute(
        "UPDATE workflow_steps SET status = 'pending', started_at = NULL, completed_at = NULL
         WHERE workflow_run_id = ?1 AND step_id >= ?2",
        rusqlite::params![wr_id, from_step],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

// --- Workflow Sessions ---

pub fn create_workflow_session(
    conn: &Connection,
    session_id: &str,
    skill_name: &str,
    pid: u32,
) -> Result<(), String> {
    let skill_master_id = get_skill_master_id_any_plugin(conn, skill_name)?;
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
    let s_id = match get_skill_master_id_any_plugin(conn, skill_name) {
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
