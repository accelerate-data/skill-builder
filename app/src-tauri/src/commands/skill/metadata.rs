use crate::db::Db;
use std::fs;
use std::path::Path;

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
pub fn acquire_lock(
    skill_id: i64,
    instance: tauri::State<'_, crate::InstanceInfo>,
    db: tauri::State<'_, Db>,
) -> Result<(), String> {
    log::info!("[acquire_lock] skill_id={}", skill_id);
    let conn = db.0.lock().map_err(|e| {
        log::error!("[acquire_lock] Failed to acquire DB lock: {}", e);
        e.to_string()
    })?;
    crate::db::acquire_skill_lock_by_skill_id(&conn, skill_id, &instance.id, instance.pid)
}

#[tauri::command]
pub fn release_lock(
    skill_id: i64,
    instance: tauri::State<'_, crate::InstanceInfo>,
    db: tauri::State<'_, Db>,
) -> Result<(), String> {
    log::info!("[release_lock] skill_id={}", skill_id);
    let conn = db.0.lock().map_err(|e| {
        log::error!("[release_lock] Failed to acquire DB lock: {}", e);
        e.to_string()
    })?;
    crate::db::release_skill_lock_by_skill_id(&conn, skill_id, &instance.id)
}

/// Returns skill IDs locked by a different live instance (excludes our own locks).
#[tauri::command]
pub fn get_externally_locked_skills(
    instance: tauri::State<'_, crate::InstanceInfo>,
    db: tauri::State<'_, Db>,
) -> Result<Vec<i64>, String> {
    let conn = db.0.lock().map_err(|e| {
        log::error!(
            "[get_externally_locked_skills] Failed to acquire DB lock: {}",
            e
        );
        e.to_string()
    })?;
    crate::db::reclaim_dead_locks(&conn)?;
    let all_locks = crate::db::get_all_skill_locks(&conn)?;
    let external: Vec<i64> = all_locks
        .into_iter()
        .filter(|lock| lock.instance_id != instance.id)
        .map(|lock| lock.skill_id)
        .collect();
    if let Some(message) = externally_locked_skills_log_message(&external) {
        log::info!("{}", message);
    }
    Ok(external)
}

pub(crate) fn externally_locked_skills_log_message(skill_ids: &[i64]) -> Option<String> {
    if skill_ids.is_empty() {
        None
    } else {
        Some(format!(
            "[get_externally_locked_skills] locked_skill_ids={:?}",
            skill_ids
        ))
    }
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn update_skill_metadata(
    skill_name: String,
    plugin_slug: String,
    purpose: Option<String>,
    tags: Option<Vec<String>>,
    intake_json: Option<String>,
    description: Option<String>,
    version: Option<String>,
    user_invocable: Option<bool>,
    disable_model_invocation: Option<bool>,
    db: tauri::State<'_, Db>,
) -> Result<(), String> {
    log::info!(
        "[update_skill_metadata] skill={} plugin={} purpose={:?} tags={:?} intake={} description={}",
        skill_name,
        plugin_slug,
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
        crate::db::set_skill_tags(&conn, &skill_name, &plugin_slug, tags).map_err(|e| {
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
        || user_invocable.is_some()
        || disable_model_invocation.is_some()
    {
        // set_skill_behaviour writes to skills master only (canonical store for all skill sources).
        // Works for all skill sources — marketplace/imported updates skills master directly.
        crate::db::set_skill_behaviour_in_plugin(
            &conn,
            &skill_name,
            &plugin_slug,
            description.as_deref(),
            version.as_deref(),
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
    // Lock the owning plugin against upgrades when a marketplace skill is edited.
    // No-op for builder or non-marketplace plugins (SQL guard: source_type = 'marketplace').
    if let Err(e) = crate::db::lock_plugin_for_skill(&conn, &skill_name) {
        log::warn!(
            "[update_skill_metadata] lock_plugin_for_skill failed (non-fatal): {}",
            e
        );
    }

    // VU-1157: user-context.md is no longer written. Skill metadata is read
    // directly from the DB during prompt rendering (Task 5), so a metadata
    // edit no longer needs to refresh a workspace file.

    Ok(())
}

/// Validate kebab-case: lowercase alphanumeric segments separated by single hyphens.
#[allow(dead_code)]
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
    db: tauri::State<'_, Db>,
) -> Result<(), String> {
    log::info!("[rename_skill] old={} new={}", old_name, new_name);

    // Skill renaming is disabled — names are immutable after creation.
    if old_name != new_name {
        log::warn!("[rename_skill] Rejected: skill renaming is disabled");
        return Err("Skill names cannot be changed after creation".to_string());
    }

    // No-op if same name
    let _ = (new_name, db);
    Ok(())
}

// Retained for tests and future reactivation (VU-986).
#[allow(dead_code)]
pub(crate) fn rename_skill_inner(
    old_name: &str,
    new_name: &str,
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
            "UPDATE conversation_runs SET skill_name = ?2 WHERE skill_name = ?1",
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
        crate::db::rename_skill_conversation_id(&tx, old_name, new_name).map_err(|e| {
            log::error!(
                "[rename_skill] failed to rename persisted conversation: {}",
                e
            );
            e
        })?;

        tx.commit().map_err(&tx_err)?;
    }

    // Look up the actual plugin slug for this skill from the DB
    let plugin_slug: String = conn
        .query_row(
            "SELECT p.slug FROM skills s JOIN plugins p ON s.plugin_id = p.id WHERE s.name = ?1",
            rusqlite::params![new_name],
            |row| row.get(0),
        )
        .unwrap_or_else(|_| crate::skill_paths::DEFAULT_PLUGIN_SLUG.to_string());

    // Move directories on disk (DB already committed — if disk fails, reconciler can fix)
    if let Some(sp) = skills_path {
        let skills_root = Path::new(sp);
        let skills_old =
            crate::skill_paths::resolve_existing_skill_dir(skills_root, &plugin_slug, old_name);
        let skills_new = crate::skill_paths::resolve_skill_dir(skills_root, &plugin_slug, new_name);
        if skills_old.exists() {
            let canonical_skills = fs::canonicalize(sp).map_err(|e| e.to_string())?;
            let canonical_old = fs::canonicalize(&skills_old).map_err(|e| e.to_string())?;
            if !canonical_old.starts_with(&canonical_skills) {
                return Err("Invalid skill path".to_string());
            }
            // Ensure the parent directory for the new nested path exists
            if let Some(parent) = skills_new.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            fs::rename(&skills_old, &skills_new).map_err(|e| {
                log::error!("[rename_skill] Failed to rename skills dir: {}", e);
                format!("Failed to rename skills directory: {}", e)
            })?;
        }
    }

    Ok(())
}
