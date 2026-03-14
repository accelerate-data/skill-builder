use crate::types::{SkillMasterRow, WorkflowRunRow, WorkflowStepRow};
use rusqlite::{Connection, OptionalExtension};
use std::collections::HashMap;

// --- Skills Master ---

/// Upsert a row in the `skills` master table. Used by `save_workflow_run` (skill-builder)
/// and marketplace import. Returns the skill id.
pub fn upsert_skill(
    conn: &Connection,
    name: &str,
    skill_source: &str,
    purpose: &str,
) -> Result<i64, String> {
    log::debug!("upsert_skill: name={} skill_source={}", name, skill_source);
    conn.execute(
        "INSERT INTO skills (name, skill_source, purpose, updated_at)
         VALUES (?1, ?2, ?3, datetime('now'))
         ON CONFLICT(name) DO UPDATE SET
             purpose = ?3, updated_at = datetime('now'), deleted_at = NULL",
        rusqlite::params![name, skill_source, purpose],
    )
    .map_err(|e| {
        log::error!("upsert_skill: failed to upsert '{}': {}", name, e);
        e.to_string()
    })?;
    let id: i64 = conn
        .query_row(
            "SELECT id FROM skills WHERE name = ?1",
            rusqlite::params![name],
            |row| row.get(0),
        )
        .map_err(|e| {
            log::error!("upsert_skill: failed to retrieve id for '{}': {}", name, e);
            e.to_string()
        })?;
    Ok(id)
}

/// Like `upsert_skill`, but ALWAYS updates `skill_source` on conflict.
/// Use this when the caller explicitly wants to set the source (e.g. `resolve_discovery`).
/// `upsert_skill` intentionally skips `skill_source` on conflict to prevent
/// `save_workflow_run` from overwriting a marketplace skill's source.
pub fn upsert_skill_with_source(
    conn: &Connection,
    name: &str,
    skill_source: &str,
    purpose: &str,
) -> Result<i64, String> {
    log::debug!(
        "upsert_skill_with_source: name={} skill_source={}",
        name,
        skill_source
    );
    conn.execute(
        "INSERT INTO skills (name, skill_source, purpose, updated_at)
         VALUES (?1, ?2, ?3, datetime('now'))
         ON CONFLICT(name) DO UPDATE SET
             skill_source = ?2, purpose = ?3, updated_at = datetime('now'), deleted_at = NULL",
        rusqlite::params![name, skill_source, purpose],
    )
    .map_err(|e| {
        log::error!(
            "upsert_skill_with_source: failed to upsert '{}': {}",
            name,
            e
        );
        e.to_string()
    })?;
    let id: i64 = conn
        .query_row(
            "SELECT id FROM skills WHERE name = ?1",
            rusqlite::params![name],
            |row| row.get(0),
        )
        .map_err(|e| {
            log::error!(
                "upsert_skill_with_source: failed to retrieve id for '{}': {}",
                name,
                e
            );
            e.to_string()
        })?;
    Ok(id)
}

/// List all skills from the master table, ordered by name.
pub fn list_all_skills(conn: &Connection) -> Result<Vec<SkillMasterRow>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, name, skill_source, purpose, created_at, updated_at,
                    description, version, model, argument_hint, user_invocable, disable_model_invocation
             FROM skills
             WHERE COALESCE(deleted_at, '') = ''
             ORDER BY name",
        )
        .map_err(|e| {
            log::error!("list_all_skills: failed to prepare query: {}", e);
            e.to_string()
        })?;

    let rows = stmt
        .query_map([], |row| {
            Ok(SkillMasterRow {
                id: row.get(0)?,
                name: row.get(1)?,
                skill_source: row.get(2)?,
                purpose: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
                description: row.get(6)?,
                version: row.get(7)?,
                model: row.get(8)?,
                argument_hint: row.get(9)?,
                user_invocable: row.get::<_, Option<i32>>(10)?.map(|v| v != 0),
                disable_model_invocation: row.get::<_, Option<i32>>(11)?.map(|v| v != 0),
            })
        })
        .map_err(|e| {
            log::error!("list_all_skills: query failed: {}", e);
            e.to_string()
        })?;

    let result: Vec<SkillMasterRow> = rows.collect::<Result<Vec<_>, _>>().map_err(|e| {
        log::error!("list_all_skills: failed to collect rows: {}", e);
        e.to_string()
    })?;
    log::debug!("list_all_skills: returning {} skills", result.len());
    Ok(result)
}

/// Get a single skill from the master table by name.
pub fn get_skill_master(
    conn: &Connection,
    skill_name: &str,
) -> Result<Option<SkillMasterRow>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, name, skill_source, purpose, created_at, updated_at,
                    description, version, model, argument_hint, user_invocable, disable_model_invocation
             FROM skills
             WHERE name = ?1 AND COALESCE(deleted_at, '') = ''",
        )
        .map_err(|e| e.to_string())?;

    let result = stmt.query_row(rusqlite::params![skill_name], |row| {
        Ok(SkillMasterRow {
            id: row.get(0)?,
            name: row.get(1)?,
            skill_source: row.get(2)?,
            purpose: row.get(3)?,
            created_at: row.get(4)?,
            updated_at: row.get(5)?,
            description: row.get(6)?,
            version: row.get(7)?,
            model: row.get(8)?,
            argument_hint: row.get(9)?,
            user_invocable: row.get::<_, Option<i32>>(10)?.map(|v| v != 0),
            disable_model_invocation: row.get::<_, Option<i32>>(11)?.map(|v| v != 0),
        })
    });

    match result {
        Ok(row) => Ok(Some(row)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Delete a skill from the master table by name.
pub fn delete_skill(conn: &Connection, name: &str) -> Result<(), String> {
    log::info!("delete_skill: name={}", name);
    conn.execute(
        "UPDATE skills
         SET deleted_at = CASE
               WHEN deleted_at IS NULL OR deleted_at = '' THEN datetime('now') || 'Z'
               ELSE deleted_at
             END,
             updated_at = datetime('now')
         WHERE name = ?1",
        rusqlite::params![name],
    )
    .map_err(|e| {
        log::error!("delete_skill: failed to delete '{}': {}", name, e);
        e.to_string()
    })?;
    Ok(())
}

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

/// Get the `skills.id` integer for a given skill name. Returns None if not found.
pub fn get_skill_master_id(conn: &Connection, skill_name: &str) -> Result<Option<i64>, String> {
    conn.query_row(
        "SELECT id FROM skills WHERE name = ?1",
        rusqlite::params![skill_name],
        |row| row.get(0),
    )
    .optional()
    .map_err(|e| e.to_string())
}

// --- Workflow Run ---

pub fn save_workflow_run(
    conn: &Connection,
    skill_name: &str,
    current_step: i32,
    status: &str,
    purpose: &str,
) -> Result<(), String> {
    // Ensure the skills master row exists (skill-builder source)
    let skill_id = upsert_skill(conn, skill_name, "skill-builder", purpose)?;
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

/// Insert a marketplace skill into the skills master table only. No workflow_runs row.
/// Replaces `save_marketplace_skill_run` — marketplace skills no longer get workflow_runs rows.
pub fn save_marketplace_skill(
    conn: &Connection,
    skill_name: &str,
    purpose: &str,
) -> Result<(), String> {
    log::info!("save_marketplace_skill: name={}", skill_name);
    upsert_skill(conn, skill_name, "marketplace", purpose).map_err(|e| {
        log::error!("save_marketplace_skill: failed for '{}': {}", skill_name, e);
        e
    })?;
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

#[allow(clippy::too_many_arguments)]
pub fn set_skill_behaviour(
    conn: &Connection,
    skill_name: &str,
    description: Option<&str>,
    version: Option<&str>,
    model: Option<&str>,
    argument_hint: Option<&str>,
    user_invocable: Option<bool>,
    disable_model_invocation: Option<bool>,
) -> Result<(), String> {
    let user_invocable_i: Option<i32> = user_invocable.map(|v| if v { 1 } else { 0 });
    let disable_model_invocation_i: Option<i32> =
        disable_model_invocation.map(|v| if v { 1 } else { 0 });

    // Write to skills master — canonical store for all skill sources
    conn.execute(
        "UPDATE skills SET
            description = COALESCE(?2, description),
            version = COALESCE(?3, version),
            model = COALESCE(?4, model),
            argument_hint = COALESCE(?5, argument_hint),
            user_invocable = COALESCE(?6, user_invocable),
            disable_model_invocation = COALESCE(?7, disable_model_invocation),
            updated_at = datetime('now')
         WHERE name = ?1",
        rusqlite::params![
            skill_name,
            description,
            version,
            model,
            argument_hint,
            user_invocable_i,
            disable_model_invocation_i,
        ],
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

pub fn delete_workflow_run(conn: &Connection, skill_name: &str) -> Result<(), String> {
    // Look up FK ids before deleting the parent rows
    let wr_id = get_workflow_run_id(conn, skill_name)?
        .ok_or_else(|| format!("Workflow run not found for skill '{}'", skill_name))?;
    let s_id = get_skill_master_id(conn, skill_name)?
        .ok_or_else(|| format!("Skill '{}' not found in skills master", skill_name))?;

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
    delete_skill(conn, skill_name)?;
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

// --- Skill Tags ---

pub fn get_tags_for_skills(
    conn: &Connection,
    skill_names: &[String],
) -> Result<HashMap<String, Vec<String>>, String> {
    if skill_names.is_empty() {
        return Ok(HashMap::new());
    }

    // SQLite default SQLITE_MAX_VARIABLE_NUMBER is 999; chunk if needed
    if skill_names.len() > 900 {
        let mut map: HashMap<String, Vec<String>> = HashMap::new();
        for chunk in skill_names.chunks(900) {
            let chunk_result = get_tags_for_skills(conn, chunk)?;
            map.extend(chunk_result);
        }
        return Ok(map);
    }

    // Safety: The format! below only injects positional bind-parameter placeholders
    // (?1, ?2, ...) — never user-supplied values. All skill_name values are bound via
    // rusqlite's parameterized query API, so there is no SQL injection risk.
    let placeholders: Vec<String> = (1..=skill_names.len()).map(|i| format!("?{}", i)).collect();
    let sql = format!(
        "SELECT skill_name, tag FROM skill_tags WHERE skill_id IN (SELECT id FROM skills WHERE name IN ({})) ORDER BY skill_name, tag",
        placeholders.join(", ")
    );

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;

    let params: Vec<&dyn rusqlite::types::ToSql> = skill_names
        .iter()
        .map(|s| s as &dyn rusqlite::types::ToSql)
        .collect();

    let rows = stmt
        .query_map(params.as_slice(), |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?;

    let mut map: HashMap<String, Vec<String>> = HashMap::new();
    for row in rows {
        let (name, tag) = row.map_err(|e| e.to_string())?;
        map.entry(name).or_default().push(tag);
    }

    Ok(map)
}

pub fn set_skill_tags(conn: &Connection, skill_name: &str, tags: &[String]) -> Result<(), String> {
    let s_id = get_skill_master_id(conn, skill_name)?
        .ok_or_else(|| format!("Skill '{}' not found in skills master", skill_name))?;

    conn.execute(
        "DELETE FROM skill_tags WHERE skill_id = ?1",
        rusqlite::params![s_id],
    )
    .map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare("INSERT OR IGNORE INTO skill_tags (skill_name, skill_id, tag) VALUES (?1, ?2, ?3)")
        .map_err(|e| e.to_string())?;

    for tag in tags {
        let normalized = tag.trim().to_lowercase();
        if !normalized.is_empty() {
            stmt.execute(rusqlite::params![skill_name, s_id, normalized])
                .map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}

pub fn get_all_tags(conn: &Connection) -> Result<Vec<String>, String> {
    let mut stmt = conn
        .prepare("SELECT DISTINCT tag FROM skill_tags ORDER BY tag")
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| row.get(0))
        .map_err(|e| e.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

