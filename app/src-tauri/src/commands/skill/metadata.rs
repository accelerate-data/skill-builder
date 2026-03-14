use crate::db::Db;
use std::fs;
use std::path::Path;

#[tauri::command]
pub fn update_skill_tags(
    skill_name: String,
    tags: Vec<String>,
    db: tauri::State<'_, Db>,
) -> Result<(), String> {
    log::info!("[update_skill_tags] skill={} tags={:?}", skill_name, tags);
    let conn = db.0.lock().map_err(|e| {
        log::error!("[update_skill_tags] Failed to acquire DB lock: {}", e);
        e.to_string()
    })?;
    crate::db::set_skill_tags(&conn, &skill_name, &tags)
}

#[tauri::command]
pub fn get_all_tags(db: tauri::State<'_, Db>) -> Result<Vec<String>, String> {
    log::info!("[get_all_tags]");
    let conn = db.0.lock().map_err(|e| {
        log::error!("[get_all_tags] Failed to acquire DB lock: {}", e);
        e.to_string()
    })?;
    crate::db::get_all_tags(&conn)
}

#[tauri::command]
pub fn get_installed_skill_names(db: tauri::State<'_, Db>) -> Result<Vec<String>, String> {
    log::info!("[get_installed_skill_names]");
    let conn = db.0.lock().map_err(|e| {
        log::error!(
            "[get_installed_skill_names] Failed to acquire DB lock: {}",
            e
        );
        e.to_string()
    })?;
    crate::db::get_all_installed_skill_names(&conn)
}

#[tauri::command]
pub fn acquire_lock(
    skill_name: String,
    instance: tauri::State<'_, crate::InstanceInfo>,
    db: tauri::State<'_, Db>,
) -> Result<(), String> {
    log::info!("[acquire_lock] skill={}", skill_name);
    let conn = db.0.lock().map_err(|e| {
        log::error!("[acquire_lock] Failed to acquire DB lock: {}", e);
        e.to_string()
    })?;
    crate::db::acquire_skill_lock(&conn, &skill_name, &instance.id, instance.pid)
}

#[tauri::command]
pub fn release_lock(
    skill_name: String,
    instance: tauri::State<'_, crate::InstanceInfo>,
    db: tauri::State<'_, Db>,
) -> Result<(), String> {
    log::info!("[release_lock] skill={}", skill_name);
    let conn = db.0.lock().map_err(|e| {
        log::error!("[release_lock] Failed to acquire DB lock: {}", e);
        e.to_string()
    })?;
    crate::db::release_skill_lock(&conn, &skill_name, &instance.id)
}

#[tauri::command]
pub fn get_locked_skills(db: tauri::State<'_, Db>) -> Result<Vec<crate::types::SkillLock>, String> {
    log::info!("[get_locked_skills]");
    let conn = db.0.lock().map_err(|e| {
        log::error!("[get_locked_skills] Failed to acquire DB lock: {}", e);
        e.to_string()
    })?;
    crate::db::reclaim_dead_locks(&conn)?;
    crate::db::get_all_skill_locks(&conn)
}

#[tauri::command]
pub fn check_lock(
    skill_name: String,
    instance: tauri::State<'_, crate::InstanceInfo>,
    db: tauri::State<'_, Db>,
) -> Result<bool, String> {
    log::info!("[check_lock] skill={}", skill_name);
    let conn = db.0.lock().map_err(|e| {
        log::error!("[check_lock] Failed to acquire DB lock: {}", e);
        e.to_string()
    })?;
    match crate::db::get_skill_lock(&conn, &skill_name)? {
        Some(lock) => {
            if lock.instance_id == instance.id {
                Ok(false) // Locked by us, not locked from our perspective
            } else if !crate::db::check_pid_alive(lock.pid) {
                // Dead process — reclaim
                crate::db::release_skill_lock(&conn, &skill_name, &lock.instance_id)?;
                Ok(false)
            } else {
                Ok(true) // Locked by another live instance
            }
        }
        None => Ok(false),
    }
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn update_skill_metadata(
    skill_name: String,
    purpose: Option<String>,
    tags: Option<Vec<String>>,
    intake_json: Option<String>,
    description: Option<String>,
    version: Option<String>,
    model: Option<String>,
    argument_hint: Option<String>,
    user_invocable: Option<bool>,
    disable_model_invocation: Option<bool>,
    db: tauri::State<'_, Db>,
) -> Result<(), String> {
    log::info!(
        "[update_skill_metadata] skill={} purpose={:?} tags={:?} intake={} description={}",
        skill_name,
        purpose,
        tags,
        intake_json.is_some(),
        description.is_some()
    );
    let conn = db.0.lock().map_err(|e| {
        log::error!("[update_skill_metadata] Failed to acquire DB lock: {}", e);
        e.to_string()
    })?;

    if let Some(p) = &purpose {
        // Update skills master table — sole source of truth for metadata
        conn.execute(
            "UPDATE skills SET purpose = ?2, updated_at = datetime('now') WHERE name = ?1",
            rusqlite::params![skill_name, p],
        )
        .map_err(|e| {
            log::error!(
                "[update_skill_metadata] Failed to update skills.purpose: {}",
                e
            );
            e.to_string()
        })?;
    }
    if let Some(tags) = &tags {
        crate::db::set_skill_tags(&conn, &skill_name, tags).map_err(|e| {
            log::error!("[update_skill_metadata] Failed to set tags: {}", e);
            e
        })?;
    }
    crate::db::set_skill_intake(&conn, &skill_name, intake_json.as_deref()).map_err(|e| {
        log::error!("[update_skill_metadata] Failed to set intake_json: {}", e);
        e
    })?;
    if description.is_some()
        || version.is_some()
        || model.is_some()
        || argument_hint.is_some()
        || user_invocable.is_some()
        || disable_model_invocation.is_some()
    {
        // set_skill_behaviour writes to skills master only (canonical store for all skill sources).
        // Works for all skill sources — marketplace/imported updates skills master directly.
        crate::db::set_skill_behaviour(
            &conn,
            &skill_name,
            description.as_deref(),
            version.as_deref(),
            model.as_deref(),
            argument_hint.as_deref(),
            user_invocable,
            disable_model_invocation,
        )
        .map_err(|e| {
            log::error!(
                "[update_skill_metadata] Failed to set behaviour fields: {}",
                e
            );
            e
        })?;
    }
    Ok(())
}

/// Validate kebab-case: lowercase alphanumeric segments separated by single hyphens.
pub(crate) fn is_valid_kebab(name: &str) -> bool {
    !name.is_empty()
        && !name.starts_with('-')
        && !name.ends_with('-')
        && !name.contains("--")
        && name
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

#[tauri::command]
pub fn rename_skill(
    old_name: String,
    new_name: String,
    workspace_path: String,
    db: tauri::State<'_, Db>,
) -> Result<(), String> {
    log::info!("[rename_skill] old={} new={}", old_name, new_name);

    if !is_valid_kebab(&new_name) {
        log::error!("[rename_skill] Invalid kebab-case name: {}", new_name);
        return Err(
            "Skill name must be kebab-case (lowercase letters, numbers, hyphens)".to_string(),
        );
    }

    if old_name == new_name {
        return Ok(());
    }

    let mut conn = db.0.lock().map_err(|e| {
        log::error!("[rename_skill] Failed to acquire DB lock: {}", e);
        e.to_string()
    })?;

    // Read settings for skills_path
    let settings = crate::db::read_settings(&conn).ok();
    let skills_path = settings.as_ref().and_then(|s| s.skills_path.clone());

    rename_skill_inner(
        &old_name,
        &new_name,
        &workspace_path,
        &mut conn,
        skills_path.as_deref(),
    )?;

    // Auto-commit: skill renamed
    if let Some(ref sp) = skills_path {
        let msg = format!("{}: renamed from {}", new_name, old_name);
        if let Err(e) = crate::git::commit_all(Path::new(sp), &msg) {
            log::warn!("Git auto-commit failed ({}): {}", msg, e);
        }
    }

    Ok(())
}

pub(crate) fn rename_skill_inner(
    old_name: &str,
    new_name: &str,
    workspace_path: &str,
    conn: &mut rusqlite::Connection,
    skills_path: Option<&str>,
) -> Result<(), String> {
    // Check new name doesn't already exist in skills master (workflow_runs.skill_name
    // has a UNIQUE constraint that will also catch duplicates once we update it).
    let exists_master: bool = conn
        .query_row(
            "SELECT COUNT(*) > 0 FROM skills WHERE name = ?1",
            rusqlite::params![new_name],
            |row| row.get(0),
        )
        .unwrap_or(false);
    if exists_master {
        log::error!("[rename_skill] Skill '{}' already exists", new_name);
        return Err(format!("Skill '{}' already exists", new_name));
    }

    // DB first, then disk — DB failures abort cleanly without leaving orphaned directories.
    // RAII transaction: automatically rolls back on drop if not committed.
    {
        let tx_err = |e: rusqlite::Error| -> String {
            log::error!("[rename_skill] DB transaction failed: {}", e);
            format!("Failed to rename skill in database: {}", e)
        };

        let tx = conn.transaction().map_err(&tx_err)?;

        // Rename in skills master — all child tables join by integer FK, so no further UPDATEs needed.
        tx.execute(
            "UPDATE skills SET name = ?2, updated_at = datetime('now') WHERE name = ?1",
            rusqlite::params![old_name, new_name],
        )
        .map_err(&tx_err)?;

        // workflow_runs.skill_name is TEXT UNIQUE NOT NULL used for display/lookup — update it.
        tx.execute(
            "UPDATE workflow_runs SET skill_name = ?2, updated_at = datetime('now') || 'Z' WHERE skill_name = ?1",
            rusqlite::params![old_name, new_name],
        ).map_err(&tx_err)?;

        // workflow_sessions.skill_name is still TEXT (for display/logging) — update it.
        tx.execute(
            "UPDATE workflow_sessions SET skill_name = ?2 WHERE skill_name = ?1",
            rusqlite::params![old_name, new_name],
        )
        .map_err(&tx_err)?;

        // These child tables still carry skill_name TEXT for read queries — keep them in sync.
        tx.execute(
            "UPDATE workflow_steps SET skill_name = ?2 WHERE skill_name = ?1",
            rusqlite::params![old_name, new_name],
        )
        .map_err(&tx_err)?;
        tx.execute(
            "UPDATE workflow_artifacts SET skill_name = ?2 WHERE skill_name = ?1",
            rusqlite::params![old_name, new_name],
        )
        .map_err(&tx_err)?;
        tx.execute(
            "UPDATE agent_runs SET skill_name = ?2 WHERE skill_name = ?1",
            rusqlite::params![old_name, new_name],
        )
        .map_err(&tx_err)?;
        tx.execute(
            "UPDATE skill_tags SET skill_name = ?2 WHERE skill_name = ?1",
            rusqlite::params![old_name, new_name],
        )
        .map_err(&tx_err)?;
        tx.execute(
            "UPDATE imported_skills SET skill_name = ?2 WHERE skill_name = ?1",
            rusqlite::params![old_name, new_name],
        )
        .map_err(&tx_err)?;
        tx.execute(
            "UPDATE skill_locks SET skill_name = ?2 WHERE skill_name = ?1",
            rusqlite::params![old_name, new_name],
        )
        .map_err(&tx_err)?;

        tx.commit().map_err(&tx_err)?;
    }

    // Move directories on disk (DB already committed — if disk fails, reconciler can fix)
    let workspace_old = Path::new(workspace_path).join(old_name);
    let workspace_new = Path::new(workspace_path).join(new_name);
    if workspace_old.exists() {
        // Guard against directory traversal
        let canonical_workspace = fs::canonicalize(workspace_path).map_err(|e| e.to_string())?;
        let canonical_old = fs::canonicalize(&workspace_old).map_err(|e| e.to_string())?;
        if !canonical_old.starts_with(&canonical_workspace) {
            return Err("Invalid skill path".to_string());
        }
        fs::rename(&workspace_old, &workspace_new).map_err(|e| {
            log::error!("[rename_skill] Failed to rename workspace dir: {}", e);
            format!("Failed to rename workspace directory: {}", e)
        })?;
    }

    if let Some(sp) = skills_path {
        let skills_old = Path::new(sp).join(old_name);
        let skills_new = Path::new(sp).join(new_name);
        if skills_old.exists() {
            let canonical_skills = fs::canonicalize(sp).map_err(|e| e.to_string())?;
            let canonical_old = fs::canonicalize(&skills_old).map_err(|e| e.to_string())?;
            if !canonical_old.starts_with(&canonical_skills) {
                return Err("Invalid skill path".to_string());
            }
            fs::rename(&skills_old, &skills_new).map_err(|e| {
                log::error!("[rename_skill] Failed to rename skills dir: {}", e);
                // Rollback workspace rename to keep disk consistent
                if workspace_new.exists() {
                    let _ = fs::rename(&workspace_new, &workspace_old);
                }
                format!("Failed to rename skills directory: {}", e)
            })?;
        }
    }

    Ok(())
}
