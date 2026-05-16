use rusqlite::{Connection, OptionalExtension};

use crate::types::{WorkflowRunRow, WorkflowStepRow};

use super::locks::check_pid_alive;
use super::skills::{
    delete_skill_in_plugin, get_skill_master_by_id, get_skill_master_id_in_plugin,
};

// --- Workflow Run ---

/// Get the `workflow_runs.id` integer for a given `skill_id`. Returns None if not found.
pub fn get_workflow_run_id_by_skill_id(
    conn: &Connection,
    skill_id: i64,
) -> Result<Option<i64>, String> {
    conn.query_row(
        "SELECT id FROM workflow_runs WHERE skill_id = ?1",
        rusqlite::params![skill_id],
        |row| row.get(0),
    )
    .optional()
    .map_err(|e| e.to_string())
}

pub fn save_workflow_run_by_skill_id(
    conn: &Connection,
    skill_id: i64,
    current_step: i32,
    status: &str,
    purpose: &str,
) -> Result<(), String> {
    let skill = get_skill_master_by_id(conn, skill_id)?
        .ok_or_else(|| format!("Skill id {} not found", skill_id))?;

    conn.execute(
        "INSERT INTO workflow_runs (skill_name, current_step, status, purpose, skill_id, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, datetime('now') || 'Z')
         ON CONFLICT(skill_id) DO UPDATE SET
             skill_name = excluded.skill_name,
             current_step = excluded.current_step,
             status = excluded.status,
             purpose = excluded.purpose,
             updated_at = datetime('now') || 'Z'",
        rusqlite::params![skill.name, current_step, status, purpose, skill_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn save_workflow_run(
    conn: &Connection,
    skill_name: &str,
    current_step: i32,
    status: &str,
    purpose: &str,
) -> Result<(), String> {
    // Ensure the skill exists in the default plugin (handles redo workflow case
    // where a skill may have been in a non-default plugin).
    let skill_id = super::skills::upsert_skill(conn, skill_name, "skill-builder", purpose)?;
    // Remove any duplicate rows from non-default plugins.
    conn.execute(
        "DELETE FROM skills WHERE name = ?1 AND plugin_id != (SELECT id FROM plugins WHERE slug = 'default')",
        rusqlite::params![skill_name],
    )
    .map_err(|e| e.to_string())?;
    save_workflow_run_by_skill_id(conn, skill_id, current_step, status, purpose)
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

pub fn get_workflow_run_by_skill_id(
    conn: &Connection,
    skill_id: i64,
) -> Result<Option<WorkflowRunRow>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT wr.skill_id, wr.skill_name, p.slug, wr.current_step, wr.status, wr.purpose,
                    wr.created_at, wr.updated_at, wr.author_login, wr.author_avatar,
                    wr.display_name, wr.intake_json, COALESCE(wr.source, 'created')
             FROM workflow_runs wr
             JOIN skills s ON s.id = wr.skill_id
             JOIN plugins p ON p.id = s.plugin_id
             WHERE wr.skill_id = ?1",
        )
        .map_err(|e| e.to_string())?;

    let result = stmt.query_row(rusqlite::params![skill_id], |row| {
        Ok(WorkflowRunRow {
            skill_id: row.get(0)?,
            skill_name: row.get(1)?,
            plugin_slug: row.get(2)?,
            current_step: row.get(3)?,
            status: row.get(4)?,
            purpose: row.get(5)?,
            created_at: row.get(6)?,
            updated_at: row.get(7)?,
            author_login: row.get(8)?,
            author_avatar: row.get(9)?,
            display_name: row.get(10)?,
            intake_json: row.get(11)?,
            source: row.get(12)?,
        })
    });

    match result {
        Ok(run) => Ok(Some(run)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

pub fn get_purpose_by_skill_id(conn: &Connection, skill_id: i64) -> Result<String, String> {
    get_workflow_run_by_skill_id(conn, skill_id).map(|opt| {
        opt.map(|run| run.purpose)
            .unwrap_or_else(|| "domain".to_string())
    })
}

pub fn list_all_workflow_runs(conn: &Connection) -> Result<Vec<WorkflowRunRow>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT wr.skill_id, wr.skill_name, p.slug, wr.current_step, wr.status, wr.purpose,
                    wr.created_at, wr.updated_at, wr.author_login, wr.author_avatar,
                    wr.display_name, wr.intake_json, COALESCE(wr.source, 'created')
             FROM workflow_runs wr
             JOIN skills s ON s.id = wr.skill_id
             JOIN plugins p ON p.id = s.plugin_id
             ORDER BY p.slug, wr.skill_name",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(WorkflowRunRow {
                skill_id: row.get(0)?,
                skill_name: row.get(1)?,
                plugin_slug: row.get(2)?,
                current_step: row.get(3)?,
                status: row.get(4)?,
                purpose: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
                author_login: row.get(8)?,
                author_avatar: row.get(9)?,
                display_name: row.get(10)?,
                intake_json: row.get(11)?,
                source: row.get(12)?,
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
    let s_id = get_skill_master_id_in_plugin(conn, skill_name, plugin_slug)?.ok_or_else(|| {
        format!(
            "Skill '{}' not found in plugin '{}'",
            skill_name, plugin_slug
        )
    })?;
    let wr_id = get_workflow_run_id_by_skill_id(conn, s_id)?
        .ok_or_else(|| format!("Workflow run not found for skill '{}'", skill_name))?;

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

    // Preserve historical usage/session records when the canonical skills row is removed.
    conn.execute(
        "UPDATE workflow_sessions SET skill_id = NULL WHERE skill_id = ?1",
        rusqlite::params![s_id],
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "DELETE FROM workflow_runs WHERE skill_id = ?1",
        rusqlite::params![s_id],
    )
    .map_err(|e| e.to_string())?;

    super::clear_skill_conversation_id(conn, plugin_slug, skill_name)?;

    // Also delete from skills master table
    delete_skill_in_plugin(conn, skill_name, plugin_slug)?;
    Ok(())
}

// --- Workflow Steps ---

pub fn save_workflow_step_by_skill_id(
    conn: &Connection,
    skill_id: i64,
    step_id: i32,
    status: &str,
) -> Result<(), String> {
    let now = chrono::Utc::now().to_rfc3339();
    let (started, completed) = match status {
        "in_progress" => (Some(now.clone()), None),
        "completed" => (None, Some(now)),
        _ => (None, None),
    };

    let workflow_run_id = get_workflow_run_id_by_skill_id(conn, skill_id)?
        .ok_or_else(|| format!("Workflow run not found for skill id {}", skill_id))?;
    let skill_name = get_skill_master_by_id(conn, skill_id)?
        .ok_or_else(|| format!("Skill id {} not found", skill_id))?
        .name;

    conn.execute(
        "INSERT INTO workflow_steps (skill_name, step_id, status, started_at, completed_at, workflow_run_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(workflow_run_id, step_id) DO UPDATE SET
             skill_name = excluded.skill_name,
             status = ?3,
             started_at = COALESCE(?4, started_at),
             completed_at = ?5,
             workflow_run_id = excluded.workflow_run_id",
        rusqlite::params![skill_name, step_id, status, started, completed, workflow_run_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn get_workflow_steps_by_skill_id(
    conn: &Connection,
    skill_id: i64,
) -> Result<Vec<WorkflowStepRow>, String> {
    let wr_id = match get_workflow_run_id_by_skill_id(conn, skill_id)? {
        Some(id) => id,
        None => return Ok(vec![]),
    };

    let mut stmt = conn
        .prepare(
            "SELECT wr.skill_id, ws.skill_name, p.slug, ws.step_id, ws.status, ws.started_at, ws.completed_at
             FROM workflow_steps ws
             JOIN workflow_runs wr ON wr.id = ws.workflow_run_id
             JOIN skills s ON s.id = wr.skill_id
             JOIN plugins p ON p.id = s.plugin_id
             WHERE ws.workflow_run_id = ?1
             ORDER BY ws.step_id",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params![wr_id], |row| {
            Ok(WorkflowStepRow {
                skill_id: row.get(0)?,
                skill_name: row.get(1)?,
                plugin_slug: row.get(2)?,
                step_id: row.get(3)?,
                status: row.get(4)?,
                started_at: row.get(5)?,
                completed_at: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

pub fn reset_workflow_steps_from_by_skill_id(
    conn: &Connection,
    skill_id: i64,
    from_step: i32,
) -> Result<(), String> {
    let wr_id = match get_workflow_run_id_by_skill_id(conn, skill_id)? {
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

pub fn create_workflow_session_by_skill_id(
    conn: &Connection,
    session_id: &str,
    skill_id: i64,
    pid: u32,
) -> Result<(), String> {
    let skill = get_skill_master_by_id(conn, skill_id)?
        .ok_or_else(|| format!("Skill id {} not found", skill_id))?;
    conn.execute(
        "INSERT OR IGNORE INTO workflow_sessions (session_id, skill_name, skill_id, pid) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![session_id, skill.name, skill_id, pid as i64],
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

pub fn end_active_workflow_sessions_for_skill_id(
    conn: &Connection,
    skill_id: i64,
) -> Result<u32, String> {
    let count = conn
        .execute(
            "UPDATE workflow_sessions
             SET ended_at = datetime('now') || 'Z'
             WHERE skill_id = ?1 AND ended_at IS NULL",
            rusqlite::params![skill_id],
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
    let s_id = match crate::db::get_skill_master_id_in_plugin(
        conn,
        skill_name,
        crate::skill_paths::DEFAULT_PLUGIN_SLUG,
    ) {
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
