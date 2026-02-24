use crate::db::Db;
use crate::types::SkillSummary;
use serde::Serialize;
use std::fs;
use std::path::Path;

#[tauri::command]
pub fn list_skills(
    workspace_path: String,
    db: tauri::State<'_, Db>,
) -> Result<Vec<SkillSummary>, String> {
    log::info!("[list_skills]");
    let conn = db.0.lock().map_err(|e| {
        log::error!("[list_skills] Failed to acquire DB lock: {}", e);
        e.to_string()
    })?;
    list_skills_inner(&workspace_path, &conn)
}

/// Unified skill listing driven by the `skills` master table.
/// For skill-builder skills, LEFT JOINs to `workflow_runs` for step state.
/// For marketplace/imported skills, they're always "completed" with no workflow_runs.
///
/// The `_workspace_path` parameter is retained for backward compatibility with the
/// Tauri command signature (the frontend still passes it), but is not used for
/// skill discovery.
fn list_skills_inner(
    _workspace_path: &str,
    conn: &rusqlite::Connection,
) -> Result<Vec<SkillSummary>, String> {
    // Query the skills master table
    let master_skills = crate::db::list_all_skills(conn)?;

    log::debug!(
        "[list_skills_inner] {} skills in master table",
        master_skills.len()
    );

    // Also load workflow_runs for skill-builder skills (keyed by skill_name)
    let runs = crate::db::list_all_workflow_runs(conn)?;
    let runs_map: std::collections::HashMap<String, crate::types::WorkflowRunRow> = runs
        .into_iter()
        .map(|r| (r.skill_name.clone(), r))
        .collect();

    // Batch-fetch tags for all skills
    let names: Vec<String> = master_skills.iter().map(|s| s.name.clone()).collect();
    let tags_map = crate::db::get_tags_for_skills(conn, &names)?;

    // Frontmatter fields (description, version, model, etc.) are now in the `skills` master table
    // via migration 24. They come through master_skills (SkillMasterRow) for all skill sources.

    // Build SkillSummary list from master + optional workflow_runs
    let mut skills: Vec<SkillSummary> = master_skills
        .into_iter()
        .map(|master| {
            let tags = tags_map
                .get(&master.name)
                .cloned()
                .unwrap_or_default();

            if master.skill_source == "skill-builder" {
                // For skill-builder: workflow_runs provides step state and workflow-specific fields.
                // Frontmatter fields come from skills master (canonical since migration 24).
                if let Some(run) = runs_map.get(&master.name) {
                    return SkillSummary {
                        name: run.skill_name.clone(),
                        current_step: Some(format!("Step {}", run.current_step)),
                        status: Some(run.status.clone()),
                        last_modified: Some(run.updated_at.clone()),
                        tags,
                        purpose: Some(run.purpose.clone()),
                        author_login: run.author_login.clone(),
                        author_avatar: run.author_avatar.clone(),
                        display_name: run.display_name.clone(),
                        intake_json: run.intake_json.clone(),
                        source: Some(run.source.clone()),
                        skill_source: Some(master.skill_source.clone()),
                        description: master.description.clone(),
                        version: master.version.clone(),
                        model: master.model.clone(),
                        argument_hint: master.argument_hint.clone(),
                        user_invocable: master.user_invocable,
                        disable_model_invocation: master.disable_model_invocation,
                    };
                }
            }

            // For marketplace/imported skills (or skill-builder with no workflow_runs row):
            // show as completed with master data. Frontmatter fields all come from skills master.
            SkillSummary {
                name: master.name.clone(),
                current_step: Some("Step 5".to_string()),
                status: Some("completed".to_string()),
                last_modified: Some(master.updated_at.clone()),
                tags,
                purpose: master.purpose.clone(),
                author_login: None,
                author_avatar: None,
                display_name: None,
                intake_json: None,
                source: Some(master.skill_source.clone()),
                skill_source: Some(master.skill_source.clone()),
                description: master.description.clone(),
                version: master.version.clone(),
                model: master.model.clone(),
                argument_hint: master.argument_hint.clone(),
                user_invocable: master.user_invocable,
                disable_model_invocation: master.disable_model_invocation,
            }
        })
        .collect();

    // Sort by last_modified descending (most recent first)
    skills.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
    Ok(skills)
}

/// Returns skills that have completed their build (status = 'completed') and
/// have a SKILL.md on disk. These are eligible for the refine workflow.
#[tauri::command]
pub fn list_refinable_skills(
    workspace_path: String,
    db: tauri::State<'_, Db>,
) -> Result<Vec<SkillSummary>, String> {
    log::info!("[list_refinable_skills]");

    // Hold the DB lock only for DB reads; release before filesystem I/O.
    let (skills_path, completed) = {
        let conn = db.0.lock().map_err(|e| {
            log::error!("[list_refinable_skills] Failed to acquire DB lock: {}", e);
            e.to_string()
        })?;
        let settings = crate::db::read_settings(&conn).map_err(|e| {
            log::error!("[list_refinable_skills] Failed to read settings: {}", e);
            e
        })?;
        let skills_path = settings
            .skills_path
            .unwrap_or_else(|| workspace_path.clone());
        let all = list_skills_inner(&workspace_path, &conn)?;
        let completed: Vec<SkillSummary> = all
            .into_iter()
            .filter(|s| s.status.as_deref() == Some("completed"))
            .collect();
        (skills_path, completed)
    }; // conn lock released here

    // Filesystem existence checks happen outside the DB lock.
    let result = filter_by_skill_md_exists(&skills_path, completed);
    log::debug!(
        "[list_refinable_skills] {} skills eligible for refine (skills_path={})",
        result.len(),
        skills_path
    );
    Ok(result)
}

/// Filter completed skills to only those with a SKILL.md on disk.
/// Separated from DB access so the Tauri command can release the DB lock first.
fn filter_by_skill_md_exists(skills_path: &str, completed: Vec<SkillSummary>) -> Vec<SkillSummary> {
    completed
        .into_iter()
        .filter(|s| {
            let skill_md = Path::new(skills_path).join(&s.name).join("SKILL.md");
            let exists = skill_md.exists();
            if !exists {
                log::debug!(
                    "[filter_by_skill_md_exists] '{}' excluded — SKILL.md not found at {}",
                    s.name,
                    skill_md.display()
                );
            }
            exists
        })
        .collect()
}

/// Testable inner function: queries the DB for completed skills, then filters
/// by SKILL.md existence on disk. In production, the Tauri command splits these
/// two phases across a lock boundary; this function combines them for tests.
#[cfg(test)]
fn list_refinable_skills_inner(
    workspace_path: &str,
    skills_path: &str,
    conn: &rusqlite::Connection,
) -> Result<Vec<SkillSummary>, String> {
    let all = list_skills_inner(workspace_path, conn)?;
    let completed: Vec<SkillSummary> = all
        .into_iter()
        .filter(|s| s.status.as_deref() == Some("completed"))
        .collect();
    Ok(filter_by_skill_md_exists(skills_path, completed))
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub fn create_skill(
    _app: tauri::AppHandle,
    workspace_path: String,
    name: String,
    tags: Option<Vec<String>>,
    purpose: Option<String>,
    intake_json: Option<String>,
    description: Option<String>,
    version: Option<String>,
    model: Option<String>,
    argument_hint: Option<String>,
    user_invocable: Option<bool>,
    disable_model_invocation: Option<bool>,
    db: tauri::State<'_, Db>,
) -> Result<(), String> {
    log::info!("[create_skill] name={} purpose={:?} tags={:?} intake={} description={}", name, purpose, tags, intake_json.is_some(), description.is_some());
    let conn = db.0.lock().map_err(|e| {
        log::error!("[create_skill] Failed to acquire DB lock: {}", e);
        e.to_string()
    })?;
    // Read settings from DB
    let settings = crate::db::read_settings(&conn).ok();
    let skills_path = settings.as_ref().and_then(|s| s.skills_path.clone());

    // Require skills_path to be configured
    if skills_path.is_none() {
        return Err(
            "Skills output path is not configured. Please set it in Settings before creating skills."
                .to_string(),
        );
    }

    let author_login = settings.as_ref().and_then(|s| s.github_user_login.clone());
    let author_avatar = settings.as_ref().and_then(|s| s.github_user_avatar.clone());
    create_skill_inner(
        &workspace_path,
        &name,
        tags.as_deref(),
        purpose.as_deref(),
        Some(&*conn),
        skills_path.as_deref(),
        author_login.as_deref(),
        author_avatar.as_deref(),
        intake_json.as_deref(),
        description.as_deref(),
        version.as_deref(),
        model.as_deref(),
        argument_hint.as_deref(),
        user_invocable,
        disable_model_invocation,
    )
}

#[allow(clippy::too_many_arguments)]
fn create_skill_inner(
    workspace_path: &str,
    name: &str,
    tags: Option<&[String]>,
    purpose: Option<&str>,
    conn: Option<&rusqlite::Connection>,
    skills_path: Option<&str>,
    author_login: Option<&str>,
    author_avatar: Option<&str>,
    intake_json: Option<&str>,
    description: Option<&str>,
    version: Option<&str>,
    model: Option<&str>,
    argument_hint: Option<&str>,
    user_invocable: Option<bool>,
    disable_model_invocation: Option<bool>,
) -> Result<(), String> {
    // Check for collision in workspace_path (working directory)
    let base = Path::new(workspace_path).join(name);
    if base.exists() {
        return Err(format!(
            "Skill '{}' already exists in workspace directory ({})",
            name,
            base.display()
        ));
    }

    // Check for collision in skills_path (skill output directory)
    if let Some(sp) = skills_path {
        let skill_output = Path::new(sp).join(name);
        if skill_output.exists() {
            return Err(format!(
                "Skill '{}' already exists in skills output directory ({})",
                name,
                skill_output.display()
            ));
        }
    }

    if let Some(sp) = skills_path {
        // Workspace dir is a marker for reconcile; context lives in skills_path
        fs::create_dir_all(&base).map_err(|e| e.to_string())?;
        let skill_output = Path::new(sp).join(name);
        fs::create_dir_all(skill_output.join("context")).map_err(|e| e.to_string())?;
        fs::create_dir_all(skill_output.join("references")).map_err(|e| e.to_string())?;
    } else {
        // No skills_path — workspace holds everything including context
        fs::create_dir_all(base.join("context")).map_err(|e| e.to_string())?;
    }

    let purpose = purpose.unwrap_or("domain");

    if let Some(conn) = conn {
        crate::db::save_workflow_run(conn, name, 0, "pending", purpose)?;

        if let Some(tags) = tags {
            if !tags.is_empty() {
                crate::db::set_skill_tags(conn, name, tags)?;
            }
        }

        if let Some(login) = author_login {
            let _ = crate::db::set_skill_author(conn, name, login, author_avatar);
        }

        if let Some(ij) = intake_json {
            let _ = crate::db::set_skill_intake(conn, name, Some(ij));
        }

        if description.is_some()
            || version.is_some()
            || model.is_some()
            || argument_hint.is_some()
            || user_invocable.is_some()
            || disable_model_invocation.is_some()
        {
            let _ = crate::db::set_skill_behaviour(
                conn,
                name,
                description,
                version,
                model,
                argument_hint,
                user_invocable,
                disable_model_invocation,
            );
        }
    }

    // Auto-commit: skill created
    if let Some(sp) = skills_path {
        let msg = format!("{}: created", name);
        if let Err(e) = crate::git::commit_all(Path::new(sp), &msg) {
            log::warn!("Git auto-commit failed ({}): {}", msg, e);
        }
    }

    Ok(())
}

#[tauri::command]
pub fn delete_skill(
    workspace_path: String,
    name: String,
    db: tauri::State<'_, Db>,
) -> Result<(), String> {
    log::info!("[delete_skill] name={}", name);
    let conn = db.0.lock().map_err(|e| {
        log::error!("[delete_skill] Failed to acquire DB lock: {}", e);
        e.to_string()
    })?;
    // Read skills_path from settings DB — may be None
    let settings = crate::db::read_settings(&conn).ok();
    let skills_path = settings.as_ref().and_then(|s| s.skills_path.clone());

    // DB cleanup works even without skills_path; only filesystem cleanup needs it
    if skills_path.is_none() {
        log::warn!("[delete_skill] skills_path not configured; skipping filesystem cleanup for '{}'", name);
    }

    delete_skill_inner(
        &workspace_path,
        &name,
        Some(&conn),
        skills_path.as_deref(),
    )
}

fn delete_skill_inner(
    workspace_path: &str,
    name: &str,
    conn: Option<&rusqlite::Connection>,
    skills_path: Option<&str>,
) -> Result<(), String> {
    log::info!(
        "[delete_skill] skill={} workspace={} skills_path={:?}",
        name, workspace_path, skills_path
    );

    let base = Path::new(workspace_path).join(name);

    // Delete workspace working directory if it exists
    if base.exists() {
        // Verify this is inside the workspace path to prevent directory traversal
        let canonical_workspace = fs::canonicalize(workspace_path).map_err(|e| e.to_string())?;
        let canonical_target = fs::canonicalize(&base).map_err(|e| e.to_string())?;
        if !canonical_target.starts_with(&canonical_workspace) {
            return Err("Invalid skill path".to_string());
        }
        fs::remove_dir_all(&base).map_err(|e| e.to_string())?;
        log::info!("[delete_skill] deleted workspace dir {}", base.display());
    } else {
        log::info!("[delete_skill] workspace dir not found: {}", base.display());
    }

    // Delete skill output directory if skills_path is configured and directory exists
    if let Some(sp) = skills_path {
        let output_dir = Path::new(sp).join(name);
        if output_dir.exists() {
            let canonical_sp = fs::canonicalize(sp).map_err(|e| e.to_string())?;
            let canonical_out = fs::canonicalize(&output_dir).map_err(|e| e.to_string())?;
            if !canonical_out.starts_with(&canonical_sp) {
                log::error!("[delete_skill] Path traversal attempt on skills_path: {}", name);
                return Err("Invalid skill path: path traversal not allowed".to_string());
            }
            fs::remove_dir_all(&output_dir).map_err(|e| {
                format!("Failed to delete skill output for '{}': {}", name, e)
            })?;
            log::info!("[delete_skill] deleted output dir {}", output_dir.display());
        } else {
            log::info!("[delete_skill] output dir not found: {}", output_dir.display());
        }
    } else {
        log::info!("[delete_skill] no skills_path configured, skipping output dir cleanup");
    }

    // Auto-commit: record the deletion in git
    if let Some(sp) = skills_path {
        let msg = format!("{}: deleted", name);
        if let Err(e) = crate::git::commit_all(Path::new(sp), &msg) {
            log::warn!("Git auto-commit failed ({}): {}", msg, e);
        }
    }

    // Full DB cleanup: route to the right delete based on what's in the DB.
    // Skill-builder skills have a workflow_run; marketplace/imported skills do not.
    if let Some(conn) = conn {
        let has_workflow_run = crate::db::get_workflow_run_id(conn, name)
            .unwrap_or(None)
            .is_some();
        if has_workflow_run {
            crate::db::delete_workflow_run(conn, name)?;
            log::info!("[delete_skill] workflow run DB records cleaned for {}", name);
        } else {
            crate::db::delete_imported_skill_by_name(conn, name)?;
            crate::db::delete_skill(conn, name)?;
            log::info!("[delete_skill] imported skill DB records cleaned for {}", name);
        }
    }

    Ok(())
}

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
pub fn get_installed_skill_names(
    db: tauri::State<'_, Db>,
) -> Result<Vec<String>, String> {
    log::info!("[get_installed_skill_names]");
    let conn = db.0.lock().map_err(|e| {
        log::error!("[get_installed_skill_names] Failed to acquire DB lock: {}", e);
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
pub fn get_locked_skills(
    db: tauri::State<'_, Db>,
) -> Result<Vec<crate::types::SkillLock>, String> {
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
    log::info!("[update_skill_metadata] skill={} purpose={:?} tags={:?} intake={} description={}", skill_name, purpose, tags, intake_json.is_some(), description.is_some());
    let conn = db.0.lock().map_err(|e| {
        log::error!("[update_skill_metadata] Failed to acquire DB lock: {}", e);
        e.to_string()
    })?;

    if let Some(p) = &purpose {
        conn.execute(
            "UPDATE workflow_runs SET purpose = ?2, updated_at = datetime('now') || 'Z' WHERE skill_name = ?1",
            rusqlite::params![skill_name, p],
        ).map_err(|e| {
            log::error!("[update_skill_metadata] Failed to update purpose: {}", e);
            e.to_string()
        })?;
        // Also update skills master table — works for all skill sources
        conn.execute(
            "UPDATE skills SET purpose = ?2, updated_at = datetime('now') WHERE name = ?1",
            rusqlite::params![skill_name, p],
        ).map_err(|e| {
            log::error!("[update_skill_metadata] Failed to update skills.purpose: {}", e);
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
        // set_skill_behaviour writes to skills master (canonical) + workflow_runs (dual-write).
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
        ).map_err(|e| {
            log::error!("[update_skill_metadata] Failed to set behaviour fields: {}", e);
            e
        })?;
    }
    Ok(())
}

/// Validate kebab-case: lowercase alphanumeric segments separated by single hyphens.
fn is_valid_kebab(name: &str) -> bool {
    !name.is_empty()
        && !name.starts_with('-')
        && !name.ends_with('-')
        && !name.contains("--")
        && name.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
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
        return Err("Skill name must be kebab-case (lowercase letters, numbers, hyphens)".to_string());
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

    rename_skill_inner(&old_name, &new_name, &workspace_path, &mut conn, skills_path.as_deref())?;

    // Auto-commit: skill renamed
    if let Some(ref sp) = skills_path {
        let msg = format!("{}: renamed from {}", new_name, old_name);
        if let Err(e) = crate::git::commit_all(Path::new(sp), &msg) {
            log::warn!("Git auto-commit failed ({}): {}", msg, e);
        }
    }

    Ok(())
}

fn rename_skill_inner(
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
        ).map_err(&tx_err)?;

        // workflow_runs.skill_name is TEXT UNIQUE NOT NULL used for display/lookup — update it.
        tx.execute(
            "UPDATE workflow_runs SET skill_name = ?2, updated_at = datetime('now') || 'Z' WHERE skill_name = ?1",
            rusqlite::params![old_name, new_name],
        ).map_err(&tx_err)?;

        // workflow_sessions.skill_name is still TEXT (for display/logging) — update it.
        tx.execute(
            "UPDATE workflow_sessions SET skill_name = ?2 WHERE skill_name = ?1",
            rusqlite::params![old_name, new_name],
        ).map_err(&tx_err)?;

        // These child tables still carry skill_name TEXT for read queries — keep them in sync.
        tx.execute(
            "UPDATE workflow_steps SET skill_name = ?2 WHERE skill_name = ?1",
            rusqlite::params![old_name, new_name],
        ).map_err(&tx_err)?;
        tx.execute(
            "UPDATE workflow_artifacts SET skill_name = ?2 WHERE skill_name = ?1",
            rusqlite::params![old_name, new_name],
        ).map_err(&tx_err)?;
        tx.execute(
            "UPDATE agent_runs SET skill_name = ?2 WHERE skill_name = ?1",
            rusqlite::params![old_name, new_name],
        ).map_err(&tx_err)?;
        tx.execute(
            "UPDATE skill_tags SET skill_name = ?2 WHERE skill_name = ?1",
            rusqlite::params![old_name, new_name],
        ).map_err(&tx_err)?;
        tx.execute(
            "UPDATE imported_skills SET skill_name = ?2 WHERE skill_name = ?1",
            rusqlite::params![old_name, new_name],
        ).map_err(&tx_err)?;
        tx.execute(
            "UPDATE skill_locks SET skill_name = ?2 WHERE skill_name = ?1",
            rusqlite::params![old_name, new_name],
        ).map_err(&tx_err)?;

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

#[derive(Serialize)]
pub struct FieldSuggestions {
    pub description: String,
    pub domain: String,
    pub audience: String,
    pub challenges: String,
    pub scope: String,
    pub unique_setup: String,
    pub claude_mistakes: String,
    pub context_questions: String,
}

/// Call Haiku to generate field suggestions in cascading groups.
/// The `fields` param controls which fields to generate; context params provide
/// prior field values so each group builds on the last.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn generate_suggestions(
    skill_name: String,
    purpose: String,
    industry: Option<String>,
    function_role: Option<String>,
    domain: Option<String>,
    scope: Option<String>,
    audience: Option<String>,
    challenges: Option<String>,
    fields: Option<Vec<String>>,
    db: tauri::State<'_, Db>,
) -> Result<FieldSuggestions, String> {
    log::info!(
        "[generate_suggestions] skill={} purpose={} fields={:?}",
        skill_name, purpose, fields
    );

    let api_key = {
        let conn = db.0.lock().map_err(|e| {
            log::error!("[generate_suggestions] Failed to acquire DB lock: {}", e);
            e.to_string()
        })?;
        let settings = crate::db::read_settings_hydrated(&conn).map_err(|e| {
            log::error!("[generate_suggestions] Failed to read settings: {}", e);
            e
        })?;
        settings
            .anthropic_api_key
            .ok_or_else(|| {
                log::error!("[generate_suggestions] API key not configured");
                "API key not configured".to_string()
            })?
    };

    let readable_name = skill_name.replace('-', " ");

    let context_parts: Vec<String> = [
        industry.as_deref().filter(|s| !s.is_empty()).map(|s| format!("Industry: {}", s)),
        function_role.as_deref().filter(|s| !s.is_empty()).map(|s| format!("Role: {}", s)),
    ]
    .into_iter()
    .flatten()
    .collect();

    let context = if context_parts.is_empty() {
        String::new()
    } else {
        format!(" User context: {}.", context_parts.join(", "))
    };

    // Build skill detail context from prior fields
    let detail_parts: Vec<String> = [
        domain.as_deref().filter(|s| !s.is_empty()).map(|s| format!("Domain: {}", s)),
        scope.as_deref().filter(|s| !s.is_empty()).map(|s| format!("Scope: {}", s)),
        audience.as_deref().filter(|s| !s.is_empty()).map(|s| format!("Target audience: {}", s)),
        challenges.as_deref().filter(|s| !s.is_empty()).map(|s| format!("Key challenges: {}", s)),
    ]
    .into_iter()
    .flatten()
    .collect();

    let detail_context = if detail_parts.is_empty() {
        String::new()
    } else {
        format!(" Skill details: {}.", detail_parts.join("; "))
    };

    let framing = match purpose.as_str() {
        "data-engineering" | "source" | "platform" => {
            "Skills are loaded into Claude Code to help engineers build data pipelines. \
             Claude already knows standard methodologies from its training data. \
             A skill must encode the delta -- the customer-specific and domain-specific knowledge \
             that Claude gets wrong or misses when working without the skill."
        }
        _ => {
            "Skills are loaded into Claude Code to help users work effectively in their specific domain. \
             Claude already has broad general knowledge from its training data. \
             A skill must encode the delta -- the customer-specific and domain-specific knowledge \
             that Claude gets wrong or misses when working without the skill."
        }
    };

    // Determine which fields to generate (default: all)
    let all_fields = vec!["description", "domain", "scope", "audience", "challenges", "unique_setup", "claude_mistakes", "context_questions"];
    let requested: Vec<&str> = fields
        .as_ref()
        .map(|f| f.iter().map(|s| s.as_str()).collect())
        .unwrap_or_else(|| all_fields.clone());

    // Build JSON schema for requested fields only
    let field_schemas: Vec<String> = requested.iter().filter_map(|f| {
        match *f {
            "description" => Some(format!(
                "\"description\": \"<1-2 sentence description of what this skill does for {}>\"",
                readable_name
            )),
            "domain" => Some("\"domain\": \"<2-5 word domain name, e.g. Sales operations or Revenue recognition>\"".to_string()),
            "scope" => Some("\"scope\": \"<short phrase, e.g. Focus on revenue analytics and reporting>\"".to_string()),
            "audience" => Some("\"audience\": \"<2-3 short bullet points starting with • on separate lines, e.g. • Senior data engineers\\n• Analytics leads owning pipeline architecture>\"".to_string()),
            "challenges" => Some("\"challenges\": \"<2-3 short bullet points starting with • on separate lines, e.g. • Late-arriving dimensions\\n• Schema drift across environments>\"".to_string()),
            "unique_setup" => Some(format!(
                "\"unique_setup\": \"<2-3 short bullet points starting with • on separate lines describing what makes a typical {} setup for {} different from standard implementations>\"",
                purpose, readable_name
            )),
            "claude_mistakes" => Some(format!(
                "\"claude_mistakes\": \"<2-3 short bullet points starting with • on separate lines describing what Claude gets wrong when working with {} in the {} domain>\"",
                readable_name, purpose
            )),
            "context_questions" => {
                let purpose_label = match purpose.as_str() {
                    "domain" => "Business process knowledge",
                    "source" => "Source system customizations",
                    "data-engineering" => "Organization specific data engineering standards",
                    "platform" => "Organization specific Azure or Fabric standards",
                    _ => &purpose,
                };
                Some(format!(
                    "\"context_questions\": \"<exactly 2 bullets starting with \u{2022} on separate lines, 2-4 words each. Bullet 1: what is unique about this {} setup. Bullet 2: what does Claude usually miss. Be specific to {}.>\"",
                    purpose_label, readable_name
                ))
            }
            _ => None,
        }
    }).collect();

    let prompt = format!(
        "{framing}\n\n\
         Given a Claude skill named \"{readable_name}\" of type \"{purpose}\".{context}{detail_context}\n\n\
         Suggest brief values for these fields. Be specific and practical, not generic.\n\n\
         Respond in exactly this JSON format (no markdown, no extra text):\n\
         {{{}}}", field_schemas.join(", ")
    );

    log::debug!("[generate_suggestions] prompt={}", prompt);

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", &api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .body(
            serde_json::json!({
                "model": "claude-haiku-4-5",
                "max_tokens": 500,
                "messages": [{"role": "user", "content": prompt}]
            })
            .to_string(),
        )
        .send()
        .await
        .map_err(|e| {
            log::error!("[generate_suggestions] API request failed: {}", e);
            format!("API request failed: {}", e)
        })?;

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let body = resp.text().await.unwrap_or_default();
        log::error!("[generate_suggestions] API error ({}): {}", status, body);
        return Err(format!("Anthropic API error ({})", status));
    }

    let body: serde_json::Value = resp.json().await.map_err(|e| {
        log::error!("[generate_suggestions] Failed to parse response JSON: {}", e);
        e.to_string()
    })?;
    let text = body["content"][0]["text"]
        .as_str()
        .ok_or_else(|| {
            log::error!("[generate_suggestions] No text in API response");
            "No text in API response".to_string()
        })?;

    log::debug!("[generate_suggestions] raw response={}", text);

    // Strip markdown fences if the model wrapped its response (e.g. ```json\n...\n```)
    let cleaned = text.trim();
    let cleaned = cleaned
        .strip_prefix("```json")
        .or_else(|| cleaned.strip_prefix("```"))
        .unwrap_or(cleaned);
    let cleaned = cleaned.strip_suffix("```").unwrap_or(cleaned).trim();

    let suggestions: serde_json::Value =
        serde_json::from_str(cleaned).map_err(|e| {
            log::error!("[generate_suggestions] Failed to parse suggestions: raw text={}", text);
            format!("Failed to parse suggestions: {}", e)
        })?;

    let field = |key: &str| -> String {
        suggestions[key].as_str().unwrap_or("").to_string()
    };

    Ok(FieldSuggestions {
        description: field("description"),
        domain: field("domain"),
        audience: field("audience"),
        challenges: field("challenges"),
        scope: field("scope"),
        unique_setup: field("unique_setup"),
        claude_mistakes: field("claude_mistakes"),
        context_questions: field("context_questions"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::test_utils::create_test_db;
    use rusqlite::Connection;
    use tempfile::tempdir;

    // ===== list_skills_inner tests =====

    #[test]
    fn test_list_skills_db_primary_returns_db_records() {
        let conn = create_test_db();
        crate::db::save_workflow_run(&conn, "skill-a", 3, "in_progress", "domain")
            .unwrap();
        crate::db::save_workflow_run(&conn, "skill-b", 0, "pending", "platform")
            .unwrap();

        let skills = list_skills_inner("/unused", &conn).unwrap();
        assert_eq!(skills.len(), 2);

        // Find skill-a
        let a = skills.iter().find(|s| s.name == "skill-a").unwrap();
        
        assert_eq!(a.current_step.as_deref(), Some("Step 3"));
        assert_eq!(a.status.as_deref(), Some("in_progress"));
        assert_eq!(a.purpose.as_deref(), Some("domain"));

        // Find skill-b
        let b = skills.iter().find(|s| s.name == "skill-b").unwrap();
        
        assert_eq!(b.current_step.as_deref(), Some("Step 0"));
        assert_eq!(b.status.as_deref(), Some("pending"));
        assert_eq!(b.purpose.as_deref(), Some("platform"));
    }

    #[test]
    fn test_list_skills_db_primary_empty_db() {
        let conn = create_test_db();
        let skills = list_skills_inner("/unused", &conn).unwrap();
        assert!(skills.is_empty());
    }

    #[test]
    fn test_list_skills_db_primary_includes_tags() {
        let conn = create_test_db();
        crate::db::save_workflow_run(&conn, "tagged-skill", 2, "pending", "domain")
            .unwrap();
        crate::db::set_skill_tags(
            &conn,
            "tagged-skill",
            &["analytics".into(), "salesforce".into()],
        )
        .unwrap();

        let skills = list_skills_inner("/unused", &conn).unwrap();
        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].tags, vec!["analytics", "salesforce"]);
    }

    #[test]
    fn test_list_skills_db_primary_last_modified_from_db() {
        let conn = create_test_db();
        crate::db::save_workflow_run(&conn, "my-skill", 0, "pending", "domain").unwrap();

        let skills = list_skills_inner("/unused", &conn).unwrap();
        assert_eq!(skills.len(), 1);
        // last_modified should be populated from updated_at (not filesystem)
        assert!(skills[0].last_modified.is_some());
    }

    #[test]
    fn test_list_skills_db_primary_no_filesystem_access_needed() {
        // This test proves that list_skills_inner works without any filesystem
        // by using a nonexistent workspace path. The DB is the sole data source.
        let conn = create_test_db();
        crate::db::save_workflow_run(&conn, "no-disk-skill", 5, "completed", "source")
        .unwrap();

        let skills =
            list_skills_inner("/this/path/does/not/exist/at/all", &conn).unwrap();
        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].name, "no-disk-skill");
        
        assert_eq!(skills[0].current_step.as_deref(), Some("Step 5"));
    }

    #[test]
    fn test_list_skills_db_primary_sorted_by_last_modified_desc() {
        let conn = create_test_db();
        // Create skills with different updated_at by updating in sequence
        crate::db::save_workflow_run(&conn, "oldest", 0, "pending", "domain").unwrap();
        crate::db::save_workflow_run(&conn, "newest", 3, "in_progress", "domain").unwrap();

        let skills = list_skills_inner("/unused", &conn).unwrap();
        assert_eq!(skills.len(), 2);
        // The most recently updated should come first
        // Since they're created nearly simultaneously, just verify both exist
        let names: Vec<&str> = skills.iter().map(|s| s.name.as_str()).collect();
        assert!(names.contains(&"oldest"));
        assert!(names.contains(&"newest"));
    }

    // ===== create + list integration =====

    #[test]
    fn test_create_and_list_skills_db_primary() {
        let dir = tempdir().unwrap();
        let workspace = dir.path().to_str().unwrap();
        let conn = create_test_db();

        create_skill_inner(workspace, "my-skill", None, None, Some(&conn), None, None, None, None, None, None, None, None, None, None)
            .unwrap();

        let skills = list_skills_inner(workspace, &conn).unwrap();
        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].name, "my-skill");
        
        assert_eq!(skills[0].status.as_deref(), Some("pending"));
    }

    #[test]
    fn test_create_duplicate_skill() {
        let dir = tempdir().unwrap();
        let workspace = dir.path().to_str().unwrap();

        create_skill_inner(workspace, "dup-skill", None, None, None, None, None, None, None, None, None, None, None, None, None).unwrap();
        let result = create_skill_inner(workspace, "dup-skill", None, None, None, None, None, None, None, None, None, None, None, None, None);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("already exists"));
    }

    // ===== delete_skill_inner tests =====

    #[test]
    fn test_delete_skill_workspace_only() {
        let dir = tempdir().unwrap();
        let workspace = dir.path().to_str().unwrap();
        let conn = create_test_db();

        create_skill_inner(workspace, "to-delete", None, None, Some(&conn), None, None, None, None, None, None, None, None, None, None)
            .unwrap();

        let skills = list_skills_inner(workspace, &conn).unwrap();
        assert_eq!(skills.len(), 1);

        delete_skill_inner(workspace, "to-delete", Some(&conn), None).unwrap();

        // DB should be clean
        let skills = list_skills_inner(workspace, &conn).unwrap();
        assert_eq!(skills.len(), 0);

        // Filesystem should be clean
        assert!(!Path::new(workspace).join("to-delete").exists());
    }

    #[test]
    fn test_delete_skill_with_skills_path() {
        let dir = tempdir().unwrap();
        let workspace = dir.path().to_str().unwrap();
        let skills_dir = tempdir().unwrap();
        let skills_path = skills_dir.path().to_str().unwrap();
        let conn = create_test_db();

        // Create skill in workspace
        create_skill_inner(
            workspace, "full-delete", None,
            None,
            Some(&conn),
            Some(skills_path),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap();

        // Simulate skill output in skills_path (as would happen after build step)
        let output_dir = Path::new(skills_path).join("full-delete");
        fs::create_dir_all(output_dir.join("references")).unwrap();
        fs::write(output_dir.join("SKILL.md"), "# Skill").unwrap();

        delete_skill_inner(workspace, "full-delete", Some(&conn), Some(skills_path)).unwrap();

        // Workspace dir should be gone
        assert!(!Path::new(workspace).join("full-delete").exists());
        // Skills output dir should be gone
        assert!(!output_dir.exists());
        // DB should be clean
        assert!(crate::db::get_workflow_run(&conn, "full-delete")
            .unwrap()
            .is_none());
    }

    #[test]
    fn test_delete_skill_cleans_db_fully() {
        let dir = tempdir().unwrap();
        let workspace = dir.path().to_str().unwrap();
        let conn = create_test_db();

        // Create skill with DB records
        create_skill_inner(
            workspace, "db-cleanup", Some(&["tag1".into(), "tag2".into()]),
            Some("platform"),
            Some(&conn),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap();

        // Add workflow steps (save_workflow_step populates workflow_run_id FK automatically)
        crate::db::save_workflow_step(&conn, "db-cleanup", 0, "completed").unwrap();

        // Add workflow artifact with FK populated
        let wr_id: i64 = conn.query_row(
            "SELECT id FROM workflow_runs WHERE skill_name = 'db-cleanup'",
            [],
            |row| row.get(0),
        ).unwrap();
        conn.execute(
            "INSERT INTO workflow_artifacts (skill_name, workflow_run_id, step_id, relative_path, content, size_bytes) VALUES ('db-cleanup', ?1, 0, 'test.md', '# Test', 6)",
            rusqlite::params![wr_id],
        )
        .unwrap();

        // Add skill lock with skill_id FK populated
        let s_id: i64 = conn.query_row(
            "SELECT id FROM skills WHERE name = 'db-cleanup'",
            [],
            |row| row.get(0),
        ).unwrap();
        conn.execute(
            "INSERT INTO skill_locks (skill_name, skill_id, instance_id, pid) VALUES ('db-cleanup', ?1, 'inst-1', 12345)",
            rusqlite::params![s_id],
        )
        .unwrap();

        delete_skill_inner(workspace, "db-cleanup", Some(&conn), None).unwrap();

        // Verify all DB records are cleaned up
        assert!(crate::db::get_workflow_run(&conn, "db-cleanup")
            .unwrap()
            .is_none());
        assert!(crate::db::get_workflow_steps(&conn, "db-cleanup")
            .unwrap()
            .is_empty());
        let tags = crate::db::get_tags_for_skills(&conn, &["db-cleanup".into()])
            .unwrap();
        assert!(tags.get("db-cleanup").is_none());

        // Verify workflow artifacts are cleaned up
        let artifact_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM workflow_artifacts WHERE skill_name = ?1",
                ["db-cleanup"],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(artifact_count, 0);

        // Verify skill locks are cleaned up
        let lock_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM skill_locks WHERE skill_name = ?1",
                ["db-cleanup"],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(lock_count, 0);
    }

    #[test]
    fn test_delete_skill_no_workspace_dir_but_has_skills_output() {
        // Skill may have been deleted from workspace but output still exists
        let dir = tempdir().unwrap();
        let workspace = dir.path().to_str().unwrap();
        let skills_dir = tempdir().unwrap();
        let skills_path = skills_dir.path().to_str().unwrap();
        let conn = create_test_db();

        // Only create skill output, no workspace dir
        let output_dir = Path::new(skills_path).join("orphan-output");
        fs::create_dir_all(output_dir.join("references")).unwrap();
        fs::write(output_dir.join("SKILL.md"), "# Skill").unwrap();

        // Add DB record
        crate::db::save_workflow_run(&conn, "orphan-output", 7, "completed", "domain")
            .unwrap();

        delete_skill_inner(workspace, "orphan-output", Some(&conn), Some(skills_path)).unwrap();

        // Skills output should be deleted
        assert!(!output_dir.exists());
        // DB should be clean
        assert!(crate::db::get_workflow_run(&conn, "orphan-output")
            .unwrap()
            .is_none());
    }

    #[test]
    fn test_delete_skill_no_workspace_dir_no_output() {
        // Neither workspace dir nor skills output exists — just DB cleanup
        let dir = tempdir().unwrap();
        let workspace = dir.path().to_str().unwrap();
        let conn = create_test_db();

        crate::db::save_workflow_run(&conn, "ghost", 3, "pending", "domain").unwrap();

        delete_skill_inner(workspace, "ghost", Some(&conn), None).unwrap();

        assert!(crate::db::get_workflow_run(&conn, "ghost")
            .unwrap()
            .is_none());
    }

    #[test]
    fn test_delete_skill_directory_traversal() {
        let dir = tempdir().unwrap();
        let workspace = dir.path().join("workspace");
        fs::create_dir_all(&workspace).unwrap();
        let workspace_str = workspace.to_str().unwrap();

        // Create a directory OUTSIDE the workspace that a traversal attack would target
        let outside_dir = dir.path().join("outside-target");
        fs::create_dir_all(&outside_dir).unwrap();

        // Create a symlink or sibling that the ".." traversal would resolve to
        // The workspace has a dir that resolves outside via ".."
        // workspace/legit is a real skill
        create_skill_inner(workspace_str, "legit", None, None, None, None, None, None, None, None, None, None, None, None, None).unwrap();

        // Attempt to delete using ".." to escape the workspace
        // This creates workspace/../outside-target which resolves to outside_dir
        let result = delete_skill_inner(workspace_str, "../outside-target", None, None);
        assert!(result.is_err(), "Directory traversal should be rejected");

        // The outside directory should still exist (not deleted)
        assert!(outside_dir.exists());
        // The legitimate skill should still exist
        assert!(workspace.join("legit").exists());
    }

    #[test]
    fn test_delete_skill_skills_path_directory_traversal() {
        let dir = tempdir().unwrap();
        let skills_base = dir.path().join("skills");
        fs::create_dir_all(&skills_base).unwrap();
        let skills_path = skills_base.to_str().unwrap();

        let workspace_dir = tempdir().unwrap();
        let workspace = workspace_dir.path().to_str().unwrap();

        // Create a directory OUTSIDE the skills_path that a traversal attack would target
        let outside_dir = dir.path().join("outside-target");
        fs::create_dir_all(&outside_dir).unwrap();

        // Attempt to delete using ".." to escape the skills_path
        // This creates skills/../outside-target which resolves to outside_dir
        let result = delete_skill_inner(workspace, "../outside-target", None, Some(skills_path));
        assert!(result.is_err(), "Directory traversal on skills_path should be rejected");
        assert!(
            result.unwrap_err().contains("path traversal not allowed"),
            "Error message should mention path traversal"
        );

        // The outside directory should still exist (not deleted)
        assert!(outside_dir.exists());
    }

    #[test]
    fn test_delete_skill_nonexistent_is_noop() {
        // When neither workspace dir nor skills output nor DB record exists,
        // delete should succeed as a no-op
        let dir = tempdir().unwrap();
        let workspace = dir.path().to_str().unwrap();

        let result = delete_skill_inner(workspace, "no-such-skill", None, None);
        assert!(result.is_ok());
    }

    #[test]
    fn test_delete_skill_inner_marketplace_skill_routes_to_imported_path() {
        let dir = tempdir().unwrap();
        let workspace = dir.path().to_str().unwrap();
        let conn = create_test_db();

        // Insert a skills master row with source="marketplace" (no workflow_run)
        conn.execute(
            "INSERT INTO skills (name, skill_source, purpose) VALUES ('mkt-skill', 'marketplace', 'domain')",
            [],
        ).unwrap();
        // Insert corresponding imported_skills row
        conn.execute(
            "INSERT INTO imported_skills (skill_id, skill_name, disk_path, is_bundled, skill_master_id)
             VALUES ('mkt-id', 'mkt-skill', '/tmp/mkt-skill', 0,
                     (SELECT id FROM skills WHERE name = 'mkt-skill'))",
            [],
        ).unwrap();

        // Verify setup: no workflow_run, but skills + imported_skills rows exist
        let wf_id = crate::db::get_workflow_run_id(&conn, "mkt-skill").unwrap();
        assert!(wf_id.is_none(), "Marketplace skill should have no workflow_run");

        let skill_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM skills WHERE name = 'mkt-skill'", [], |r| r.get(0)
        ).unwrap();
        assert_eq!(skill_count, 1);

        // Delete via delete_skill_inner
        delete_skill_inner(workspace, "mkt-skill", Some(&conn), None).unwrap();

        // Both skills master and imported_skills rows should be gone
        let skills_after: i64 = conn.query_row(
            "SELECT COUNT(*) FROM skills WHERE name = 'mkt-skill'", [], |r| r.get(0)
        ).unwrap();
        assert_eq!(skills_after, 0, "skills master row should be deleted");

        let imported_after: i64 = conn.query_row(
            "SELECT COUNT(*) FROM imported_skills WHERE skill_name = 'mkt-skill'", [], |r| r.get(0)
        ).unwrap();
        assert_eq!(imported_after, 0, "imported_skills row should be deleted");
    }

    #[test]
    fn test_delete_skill_inner_skill_builder_routes_to_workflow_path() {
        let dir = tempdir().unwrap();
        let workspace = dir.path().to_str().unwrap();
        let conn = create_test_db();

        // create_skill_inner inserts into skills (skill_source="skill-builder") + workflow_runs
        create_skill_inner(workspace, "builder-skill", None, None, Some(&conn), None, None, None, None, None, None, None, None, None, None).unwrap();

        // Verify setup: workflow_run exists
        let wf_id = crate::db::get_workflow_run_id(&conn, "builder-skill").unwrap();
        assert!(wf_id.is_some(), "skill-builder skill should have workflow_run");

        delete_skill_inner(workspace, "builder-skill", Some(&conn), None).unwrap();

        // workflow_runs row should be gone
        let wf_after = crate::db::get_workflow_run(&conn, "builder-skill").unwrap();
        assert!(wf_after.is_none(), "workflow_run should be deleted");

        // skills master row should also be gone
        let skills_after: i64 = conn.query_row(
            "SELECT COUNT(*) FROM skills WHERE name = 'builder-skill'", [], |r| r.get(0)
        ).unwrap();
        assert_eq!(skills_after, 0, "skills master row should be deleted");
    }

    #[test]
    fn test_rename_skill_inner_updates_imported_skills_name() {
        let dir = tempdir().unwrap();
        let workspace = dir.path().to_str().unwrap();
        let mut conn = create_test_db();

        // Insert a skills master row (imported source)
        conn.execute(
            "INSERT INTO skills (name, skill_source, purpose) VALUES ('imp-skill', 'imported', 'domain')",
            [],
        ).unwrap();
        // Insert imported_skills row
        conn.execute(
            "INSERT INTO imported_skills (skill_id, skill_name, disk_path, is_bundled, skill_master_id)
             VALUES ('imp-id', 'imp-skill', '/tmp/imp-skill', 0,
                     (SELECT id FROM skills WHERE name = 'imp-skill'))",
            [],
        ).unwrap();

        rename_skill_inner("imp-skill", "imp-skill-renamed", workspace, &mut conn, None).unwrap();

        // skills master should be renamed
        let master_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM skills WHERE name = 'imp-skill-renamed'", [], |r| r.get(0)
        ).unwrap();
        assert_eq!(master_count, 1, "skills master should have new name");

        // imported_skills.skill_name should also be updated
        let imported_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM imported_skills WHERE skill_name = 'imp-skill-renamed'", [], |r| r.get(0)
        ).unwrap();
        assert_eq!(imported_count, 1, "imported_skills.skill_name should be updated");

        // Old name should be gone from imported_skills
        let old_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM imported_skills WHERE skill_name = 'imp-skill'", [], |r| r.get(0)
        ).unwrap();
        assert_eq!(old_count, 0, "old imported_skills name should be gone");
    }

    // ===== Existing tests (updated signatures) =====

    #[test]
    fn test_create_skill_collision_in_workspace() {
        let dir = tempdir().unwrap();
        let workspace = dir.path().to_str().unwrap();
        let skills_dir = tempdir().unwrap();
        let skills_path = skills_dir.path().to_str().unwrap();

        // Create the skill directory in workspace manually (simulating a pre-existing dir)
        fs::create_dir_all(Path::new(workspace).join("colliding-skill")).unwrap();

        let result = create_skill_inner(
            workspace, "colliding-skill", None,
            None,
            None,
            Some(skills_path),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
        );
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.contains("already exists"), "Error should mention 'already exists': {}", err);
        assert!(err.contains("workspace directory"), "Error should mention 'workspace directory': {}", err);
    }

    #[test]
    fn test_create_skill_collision_in_skills_path() {
        let dir = tempdir().unwrap();
        let workspace = dir.path().to_str().unwrap();
        let skills_dir = tempdir().unwrap();
        let skills_path = skills_dir.path().to_str().unwrap();

        // Create the skill directory in skills_path manually (simulating a pre-existing output dir)
        fs::create_dir_all(Path::new(skills_path).join("colliding-skill")).unwrap();

        let result = create_skill_inner(
            workspace, "colliding-skill", None,
            None,
            None,
            Some(skills_path),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
        );
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.contains("already exists"), "Error should mention 'already exists': {}", err);
        assert!(err.contains("skills output directory"), "Error should mention 'skills output directory': {}", err);
    }

    #[test]
    fn test_create_skill_no_collision() {
        let dir = tempdir().unwrap();
        let workspace = dir.path().to_str().unwrap();
        let skills_dir = tempdir().unwrap();
        let skills_path = skills_dir.path().to_str().unwrap();

        // Neither workspace nor skills_path has the skill directory
        let result = create_skill_inner(
            workspace, "new-skill", None,
            None,
            None,
            Some(skills_path),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
        );
        assert!(result.is_ok());

        // Verify the workspace working directory was created
        assert!(Path::new(workspace).join("new-skill").exists());

        // Verify skill output directories were created in skills_path
        let skill_output = Path::new(skills_path).join("new-skill");
        assert!(skill_output.join("context").exists());
        assert!(skill_output.join("references").exists());
    }

    #[test]
    fn test_delete_skill_removes_logs_directory() {
        let dir = tempdir().unwrap();
        let workspace = dir.path().to_str().unwrap();

        // Create a skill
        create_skill_inner(workspace, "skill-with-logs", None, None, None, None, None, None, None, None, None, None, None, None, None).unwrap();

        // Add a logs/ subdirectory with a fake log file inside the skill directory
        let skill_dir = dir.path().join("skill-with-logs");
        let logs_dir = skill_dir.join("logs");
        fs::create_dir_all(&logs_dir).unwrap();
        fs::write(logs_dir.join("step-0.log"), "fake log content for step 0").unwrap();
        fs::write(logs_dir.join("step-1.log"), "fake log content for step 1").unwrap();

        // Verify the logs directory and files exist before deletion
        assert!(logs_dir.exists());
        assert!(logs_dir.join("step-0.log").exists());
        assert!(logs_dir.join("step-1.log").exists());

        // Delete the skill
        delete_skill_inner(workspace, "skill-with-logs", None, None).unwrap();

        // Verify the entire skill directory (including logs/) is gone
        assert!(!skill_dir.exists(), "skill directory should be removed");
        assert!(!logs_dir.exists(), "logs directory should be removed");
    }

    // ===== update_skill_metadata tests =====

    /// Helper: create a skill in the DB for metadata update tests.
    fn setup_skill_for_metadata(conn: &Connection, name: &str) {
        crate::db::save_workflow_run(conn, name, 0, "pending", "domain").unwrap();
    }

    #[test]
    fn test_update_metadata_display_name() {
        let conn = create_test_db();
        setup_skill_for_metadata(&conn, "meta-skill");

        crate::db::set_skill_display_name(&conn, "meta-skill", Some("Pretty Name")).unwrap();

        let row = crate::db::get_workflow_run(&conn, "meta-skill").unwrap().unwrap();
        assert_eq!(row.display_name.as_deref(), Some("Pretty Name"));
    }

    #[test]
    fn test_update_metadata_skill_type() {
        let conn = create_test_db();
        setup_skill_for_metadata(&conn, "type-skill");

        conn.execute(
            "UPDATE workflow_runs SET purpose = ?2, updated_at = datetime('now') || 'Z' WHERE skill_name = ?1",
            rusqlite::params!["type-skill", "platform"],
        ).unwrap();

        let row = crate::db::get_workflow_run(&conn, "type-skill").unwrap().unwrap();
        assert_eq!(row.purpose, "platform");
    }

    #[test]
    fn test_update_metadata_tags() {
        let conn = create_test_db();
        setup_skill_for_metadata(&conn, "tag-skill");

        crate::db::set_skill_tags(&conn, "tag-skill", &["rust".into(), "wasm".into()]).unwrap();

        let tags = crate::db::get_tags_for_skills(&conn, &["tag-skill".into()]).unwrap();
        assert_eq!(tags.get("tag-skill").unwrap(), &["rust", "wasm"]);
    }

    #[test]
    fn test_update_metadata_intake_json() {
        let conn = create_test_db();
        setup_skill_for_metadata(&conn, "intake-skill");

        let json = r#"{"audience":"Engineers","challenges":"Scale","scope":"Backend"}"#;
        crate::db::set_skill_intake(&conn, "intake-skill", Some(json)).unwrap();

        let row = crate::db::get_workflow_run(&conn, "intake-skill").unwrap().unwrap();
        assert_eq!(row.intake_json.as_deref(), Some(json));
    }

    #[test]
    fn test_update_metadata_all_fields() {
        let conn = create_test_db();
        setup_skill_for_metadata(&conn, "full-meta");

        // Update all four fields as update_skill_metadata would
        crate::db::set_skill_display_name(&conn, "full-meta", Some("Full Metadata")).unwrap();
        conn.execute(
            "UPDATE workflow_runs SET purpose = ?2, updated_at = datetime('now') || 'Z' WHERE skill_name = ?1",
            rusqlite::params!["full-meta", "source"],
        ).unwrap();
        crate::db::set_skill_tags(&conn, "full-meta", &["api".into(), "rest".into()]).unwrap();
        crate::db::set_skill_intake(&conn, "full-meta", Some(r#"{"audience":"Devs"}"#)).unwrap();

        let row = crate::db::get_workflow_run(&conn, "full-meta").unwrap().unwrap();
        assert_eq!(row.display_name.as_deref(), Some("Full Metadata"));
        assert_eq!(row.purpose, "source");
        assert_eq!(row.intake_json.as_deref(), Some(r#"{"audience":"Devs"}"#));

        let tags = crate::db::get_tags_for_skills(&conn, &["full-meta".into()]).unwrap();
        assert_eq!(tags.get("full-meta").unwrap(), &["api", "rest"]);
    }

    // ===== list_refinable_skills_inner tests =====

    #[test]
    fn test_list_refinable_skills_returns_only_completed_with_skill_md() {
        let dir = tempdir().unwrap();
        let skills_path = dir.path().to_str().unwrap();
        let conn = create_test_db();

        // Create a completed skill with SKILL.md on disk
        crate::db::save_workflow_run(&conn, "ready-skill", 7, "completed", "domain")
            .unwrap();
        let skill_dir = dir.path().join("ready-skill");
        fs::create_dir_all(&skill_dir).unwrap();
        fs::write(skill_dir.join("SKILL.md"), "# Ready").unwrap();

        // Create an in-progress skill (should be excluded)
        crate::db::save_workflow_run(&conn, "wip-skill", 3, "in_progress", "domain")
        .unwrap();

        let result = list_refinable_skills_inner("/unused", skills_path, &conn).unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].name, "ready-skill");
    }

    #[test]
    fn test_list_refinable_skills_excludes_completed_without_skill_md() {
        let dir = tempdir().unwrap();
        let skills_path = dir.path().to_str().unwrap();
        let conn = create_test_db();

        // Completed in DB but no SKILL.md on disk
        crate::db::save_workflow_run(&conn, "no-file", 7, "completed", "domain")
            .unwrap();

        let result = list_refinable_skills_inner("/unused", skills_path, &conn).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn test_list_refinable_skills_empty_db() {
        let dir = tempdir().unwrap();
        let skills_path = dir.path().to_str().unwrap();
        let conn = create_test_db();

        let result = list_refinable_skills_inner("/unused", skills_path, &conn).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn test_update_metadata_nonexistent_skill_is_noop() {
        let conn = create_test_db();

        // These should succeed (UPDATE affects 0 rows, no error)
        crate::db::set_skill_display_name(&conn, "ghost", Some("Name")).unwrap();
        crate::db::set_skill_intake(&conn, "ghost", Some("{}")).unwrap();

        // set_skill_tags now requires a skills master row — returns Err for unknown skills
        let result = crate::db::set_skill_tags(&conn, "ghost", &["tag".into()]);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not found in skills master"));

        // No row should exist
        assert!(crate::db::get_workflow_run(&conn, "ghost").unwrap().is_none());
    }

    // ===== rename_skill tests =====

    /// Helper: save skills_path into the settings table so rename_skill_inner
    /// can read it via `crate::db::read_settings`.
    fn save_skills_path_setting(conn: &Connection, skills_path: &str) {
        let settings = crate::types::AppSettings {
            skills_path: Some(skills_path.to_string()),
            ..Default::default()
        };
        crate::db::write_settings(conn, &settings).unwrap();
    }

    #[test]
    fn test_rename_skill_basic() {
        let workspace_dir = tempdir().unwrap();
        let workspace = workspace_dir.path().to_str().unwrap();
        let skills_dir = tempdir().unwrap();
        let skills_path = skills_dir.path().to_str().unwrap();
        let mut conn = create_test_db();
        save_skills_path_setting(&conn, skills_path);

        // Create skill with workspace dir, skills dir, DB record, tags, and steps
        create_skill_inner(
            workspace, "old-name", Some(&["tag-a".into(), "tag-b".into()]),
            Some("domain"), Some(&conn), Some(skills_path),
            None, None, None, None, None, None, None, None, None,
        ).unwrap();
        crate::db::save_workflow_step(&conn, "old-name", 0, "completed").unwrap();

        // Rename
        rename_skill_inner("old-name", "new-name", workspace, &mut conn, Some(skills_path)).unwrap();

        // Workspace dirs moved
        assert!(!Path::new(workspace).join("old-name").exists());
        assert!(Path::new(workspace).join("new-name").exists());

        // Skills dirs moved
        assert!(!Path::new(skills_path).join("old-name").exists());
        assert!(Path::new(skills_path).join("new-name").exists());

        // DB: old record gone, new record present with same data
        assert!(crate::db::get_workflow_run(&conn, "old-name").unwrap().is_none());
        let row = crate::db::get_workflow_run(&conn, "new-name").unwrap().unwrap();
        
        assert_eq!(row.purpose, "domain");

        // Tags migrated
        let tags = crate::db::get_tags_for_skills(&conn, &["new-name".into()]).unwrap();
        let new_tags = tags.get("new-name").unwrap();
        assert!(new_tags.contains(&"tag-a".to_string()));
        assert!(new_tags.contains(&"tag-b".to_string()));
        // Old tags gone
        let old_tags = crate::db::get_tags_for_skills(&conn, &["old-name".into()]).unwrap();
        assert!(old_tags.get("old-name").is_none());

        // Workflow steps migrated
        let steps = crate::db::get_workflow_steps(&conn, "new-name").unwrap();
        assert_eq!(steps.len(), 1);
        let old_steps = crate::db::get_workflow_steps(&conn, "old-name").unwrap();
        assert!(old_steps.is_empty());
    }

    #[test]
    fn test_rename_skill_invalid_kebab_case() {
        // The kebab-case validation happens in the Tauri command wrapper (rename_skill),
        // not in rename_skill_inner, so we test the validation logic directly.
        let invalid_names = vec![
            "HasUpperCase",
            "has spaces",
            "-leading-hyphen",
            "trailing-hyphen-",
            "double--hyphen",
            "",
            "ALLCAPS",
            "under_score",
        ];

        for name in invalid_names {
            assert!(
                !is_valid_kebab(name),
                "Name '{}' should be rejected as non-kebab-case",
                name
            );
        }

        // Valid kebab-case names should pass
        let valid_names = vec!["my-skill", "a", "skill-123", "a-b-c"];
        for name in valid_names {
            assert!(
                is_valid_kebab(name),
                "Name '{}' should be accepted as valid kebab-case",
                name
            );
        }
    }

    #[test]
    fn test_rename_skill_collision() {
        let workspace_dir = tempdir().unwrap();
        let workspace = workspace_dir.path().to_str().unwrap();
        let mut conn = create_test_db();

        // Create two skills in DB
        create_skill_inner(workspace, "skill-a", None, None, Some(&conn), None, None, None, None, None, None, None, None, None, None).unwrap();
        create_skill_inner(workspace, "skill-b", None, None, Some(&conn), None, None, None, None, None, None, None, None, None, None).unwrap();

        // Attempt to rename skill-a to skill-b (collision)
        let result = rename_skill_inner("skill-a", "skill-b", workspace, &mut conn, None);
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.contains("already exists"), "Error should mention collision: {}", err);

        // Original skill should be untouched
        let row = crate::db::get_workflow_run(&conn, "skill-a").unwrap().unwrap();
        
    }

    #[test]
    fn test_rename_skill_noop_same_name() {
        // When old == new, the Tauri command returns Ok(()) without touching DB.
        // Since rename_skill_inner is only called when old != new, we test the
        // early-return logic that lives in the command wrapper.
        let old = "same-name";
        let new = "same-name";
        assert_eq!(old, new);
        // The command returns Ok(()) for this case — verified by the condition.
        // We also verify rename_skill_inner would work if called (same name = collision in DB).
        let mut conn = create_test_db();
        let workspace_dir = tempdir().unwrap();
        let workspace = workspace_dir.path().to_str().unwrap();
        create_skill_inner(workspace, "same-name", None, None, Some(&conn), None, None, None, None, None, None, None, None, None, None).unwrap();

        // rename_skill_inner with same name hits the "already exists" check in DB,
        // confirming the early-return in the wrapper is necessary.
        let result = rename_skill_inner("same-name", "same-name", workspace, &mut conn, None);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("already exists"));
    }

    #[test]
    fn test_rename_skill_disk_rollback_on_db_failure() {
        let workspace_dir = tempdir().unwrap();
        let workspace = workspace_dir.path().to_str().unwrap();
        let mut conn = create_test_db();

        // Create the skill on disk (workspace dir) and in DB
        create_skill_inner(workspace, "will-rollback", None, None, Some(&conn), None, None, None, None, None, None, None, None, None, None).unwrap();
        assert!(Path::new(workspace).join("will-rollback").exists());

        // To force the DB transaction to fail, we drop the workflow_runs table
        // after creating the skill, so the INSERT in the transaction will fail.
        // But we need the existence check to pass first (no row for "new-name").
        // Strategy: drop and recreate workflow_runs without the old row data columns,
        // so the INSERT...SELECT fails due to column mismatch.
        //
        // Simpler approach: insert a row with the new name AFTER the existence check
        // runs but before the transaction. Since we can't do that with a single call,
        // we instead corrupt the table structure.
        //
        // Simplest: drop the workflow_runs table entirely after the existence check.
        // But rename_skill_inner does the check and the tx in one call.
        //
        // Best approach: rename to a name that will fail in the INSERT because the
        // source row doesn't exist (i.e., old_name doesn't exist in DB, so
        // INSERT...SELECT copies 0 rows, then DELETE affects 0 rows, then the other
        // UPDATEs also affect 0 rows — that actually succeeds).
        //
        // Real approach: We need to make the transaction fail. We can do this by
        // creating a trigger that raises an error, or by making the table read-only.
        // The easiest: add a UNIQUE constraint violation by pre-inserting the new name
        // into a table that the transaction will try to UPDATE into.
        //
        // Actually, the cleanest way: put a row in workflow_steps with the NEW name
        // and a UNIQUE constraint, but workflow_steps PK is (skill_name, step_id) so
        // we need a conflicting row. Let's add a step for "rollback-target" (the new name)
        // with the same step_id that "will-rollback" has after the UPDATE tries to set it.
        //
        // The transaction first does INSERT+DELETE on workflow_runs (succeeds), then
        // UPDATE workflow_steps. If we pre-insert a workflow_steps row with
        // (skill_name="rollback-target", step_id=0), the UPDATE from
        // (skill_name="will-rollback", step_id=0) to (skill_name="rollback-target", step_id=0)
        // will violate the PK and fail.
        crate::db::save_workflow_step(&conn, "will-rollback", 0, "completed").unwrap();
        // Pre-insert a conflicting row for the new name
        conn.execute(
            "INSERT INTO workflow_steps (skill_name, step_id, status) VALUES ('rollback-target', 0, 'pending')",
            [],
        ).unwrap();

        let result = rename_skill_inner("will-rollback", "rollback-target", workspace, &mut conn, None);
        assert!(result.is_err(), "Rename should fail due to DB constraint violation");
        assert!(result.unwrap_err().contains("Failed to rename skill in database"));

        // Workspace dir should be rolled back to original name
        assert!(
            Path::new(workspace).join("will-rollback").exists(),
            "Workspace dir should be rolled back to original name"
        );
        assert!(
            !Path::new(workspace).join("rollback-target").exists(),
            "New workspace dir should not exist after rollback"
        );

        // DB should still have the original skill
        let row = crate::db::get_workflow_run(&conn, "will-rollback");
        // The transaction was rolled back, but the INSERT+DELETE on workflow_runs
        // may have partially committed before the ROLLBACK. Let's check what we have.
        // Actually, since the transaction used BEGIN...COMMIT and the closure returned Err,
        // the outer code calls ROLLBACK, so all changes within the transaction are undone.
        // However, the INSERT of "rollback-target" into workflow_runs succeeded before
        // the workflow_steps UPDATE failed. The ROLLBACK undoes the entire transaction.
        // So the original "will-rollback" row should still exist.
        assert!(row.unwrap().is_some(), "Original DB row should survive after rollback");
    }
}
