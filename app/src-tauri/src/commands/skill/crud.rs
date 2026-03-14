use crate::db::Db;
use crate::types::SkillSummary;
use std::fs;
use std::path::Path;

#[tauri::command]
pub fn list_skills(
    workspace_path: String,
    source_url: Option<String>,
    db: tauri::State<'_, Db>,
) -> Result<Vec<SkillSummary>, String> {
    log::info!("[list_skills] source_url={:?}", source_url);
    let conn = db.0.lock().map_err(|e| {
        log::error!("[list_skills] Failed to acquire DB lock: {}", e);
        e.to_string()
    })?;
    list_skills_inner(&workspace_path, source_url.as_deref(), &conn)
}

/// Unified skill listing driven by the `skills` master table.
/// For skill-builder skills, LEFT JOINs to `workflow_runs` for step state.
/// For marketplace/imported skills, they're always "completed" with no workflow_runs.
///
/// The `_workspace_path` parameter is retained for backward compatibility with the
/// Tauri command signature (the frontend still passes it), but is not used for
/// skill discovery.
pub(crate) fn list_skills_inner(
    _workspace_path: &str,
    source_url: Option<&str>,
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
            let tags = tags_map.get(&master.name).cloned().unwrap_or_default();

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

    if let Some(source_url) = source_url {
        let mut stmt = conn
            .prepare(
                "SELECT skill_name FROM imported_skills WHERE marketplace_source_url = ?1",
            )
            .map_err(|e| format!("list_skills_inner source filter prepare: {}", e))?;
        let scoped_names: std::collections::HashSet<String> = stmt
            .query_map(rusqlite::params![source_url], |row| row.get::<_, String>(0))
            .map_err(|e| format!("list_skills_inner source filter query: {}", e))?
            .collect::<Result<std::collections::HashSet<_>, _>>()
            .map_err(|e| format!("list_skills_inner source filter collect: {}", e))?;
        skills.retain(|s| scoped_names.contains(&s.name));
    }

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
        let all = list_skills_inner(&workspace_path, None, &conn)?;
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
pub(crate) fn list_refinable_skills_inner(
    workspace_path: &str,
    skills_path: &str,
    conn: &rusqlite::Connection,
) -> Result<Vec<SkillSummary>, String> {
    let all = list_skills_inner(workspace_path, None, conn)?;
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
    log::info!(
        "[create_skill] name={} purpose={:?} tags={:?} intake={} description={}",
        name,
        purpose,
        tags,
        intake_json.is_some(),
        description.is_some()
    );
    super::super::imported_skills::validate_skill_name(&name)?;
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
pub(crate) fn create_skill_inner(
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
    super::super::imported_skills::validate_skill_name(name)?;
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
        // Workspace dir holds runtime context; skill output remains in skills_path
        fs::create_dir_all(base.join("context")).map_err(|e| e.to_string())?;
        let skill_output = Path::new(sp).join(name);
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
        log::warn!(
            "[delete_skill] skills_path not configured; skipping filesystem cleanup for '{}'",
            name
        );
    }

    delete_skill_inner(&workspace_path, &name, Some(&conn), skills_path.as_deref())
}

pub(crate) fn delete_skill_inner(
    workspace_path: &str,
    name: &str,
    conn: Option<&rusqlite::Connection>,
    skills_path: Option<&str>,
) -> Result<(), String> {
    log::info!(
        "[delete_skill] skill={} workspace={} skills_path={:?}",
        name,
        workspace_path,
        skills_path
    );

    let base = Path::new(workspace_path).join(name);

    // Delete workspace working directory if it exists
    if base.exists() {
        // Verify this is inside the workspace path to prevent directory traversal
        if !Path::new(workspace_path).exists() {
            return Err(format!("Workspace not found: {}", workspace_path));
        }
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
                log::error!(
                    "[delete_skill] Path traversal attempt on skills_path: {}",
                    name
                );
                return Err("Invalid skill path: path traversal not allowed".to_string());
            }
            fs::remove_dir_all(&output_dir)
                .map_err(|e| format!("Failed to delete skill output for '{}': {}", name, e))?;
            log::info!("[delete_skill] deleted output dir {}", output_dir.display());
        } else {
            log::info!(
                "[delete_skill] output dir not found: {}",
                output_dir.display()
            );
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
            log::info!(
                "[delete_skill] workflow run DB records cleaned for {}",
                name
            );
        } else {
            crate::db::delete_imported_skill_by_name(conn, name)?;
            crate::db::delete_skill(conn, name)?;
            log::info!(
                "[delete_skill] imported skill DB records cleaned for {}",
                name
            );
        }
    }

    Ok(())
}
