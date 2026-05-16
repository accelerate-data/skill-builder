use crate::commands::skill_session::SkillSessionManager;
use crate::commands::workflow::runtime::WorkflowStepRunManager;
use crate::db::Db;
use crate::skill_paths::{
    ensure_nested_skill_dir, resolve_existing_skill_dir, skill_library_key, DEFAULT_PLUGIN_SLUG,
};
use crate::types::SkillSummary;
use std::fs;
use std::path::Path;

pub(crate) async fn cleanup_openhands_conversations_with<Pause, PauseFuture, Delete, DeleteFuture>(
    pause_config: Result<crate::agents::runtime_config::OpenHandsRuntimeConfig, String>,
    conversation_ids: &[String],
    pause: Pause,
    delete: Delete,
) where
    Pause: Fn(crate::agents::runtime_config::OpenHandsRuntimeConfig, String) -> PauseFuture,
    PauseFuture: std::future::Future<Output = Result<(), String>>,
    Delete: Fn(crate::agents::runtime_config::OpenHandsRuntimeConfig, String) -> DeleteFuture,
    DeleteFuture: std::future::Future<Output = Result<(), String>>,
{
    let Ok(config) = pause_config else {
        return;
    };

    for conversation_id in conversation_ids {
        if let Err(error) = pause(config.clone(), conversation_id.clone()).await {
            log::warn!(
                "[delete_skill] failed to pause conversation {}: {}",
                conversation_id,
                error
            );
        }
        if let Err(error) = delete(config.clone(), conversation_id.clone()).await {
            log::warn!(
                "[delete_skill] failed to delete conversation {}: {}",
                conversation_id,
                error
            );
        }
    }
}

#[tauri::command]
pub fn list_skills(
    source_url: Option<String>,
    db: tauri::State<'_, Db>,
) -> Result<Vec<SkillSummary>, String> {
    log::info!("[list_skills] source_url={:?}", source_url);
    let conn = db.0.lock().map_err(|e| {
        log::error!("[list_skills] Failed to acquire DB lock: {}", e);
        e.to_string()
    })?;
    list_skills_inner(source_url.as_deref(), &conn)
}

/// Unified skill listing driven by the `skills` master table.
/// For skill-builder skills, LEFT JOINs to `workflow_runs` for step state.
/// For marketplace/imported skills, they're always "completed" with no workflow_runs.
pub(crate) fn list_skills_inner(
    source_url: Option<&str>,
    conn: &rusqlite::Connection,
) -> Result<Vec<SkillSummary>, String> {
    let workflow_run_key =
        |plugin_slug: &str, skill_name: &str| format!("{plugin_slug}::{skill_name}");

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
        .map(|r| (workflow_run_key(&r.plugin_slug, &r.skill_name), r))
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
            let library_key = if master.skill_source == "skill-builder" {
                Some(skill_library_key(&master.plugin_slug, &master.name))
            } else {
                Some(format!("imported:{}", master.id))
            };

            if master.skill_source == "skill-builder" {
                // For skill-builder: workflow_runs provides step state and workflow-specific fields.
                // Frontmatter fields come from skills master (canonical since migration 24).
                if let Some(run) =
                    runs_map.get(&workflow_run_key(&master.plugin_slug, &master.name))
                {
                    return SkillSummary {
                        id: master.id,
                        name: run.skill_name.clone(),
                        library_key,
                        current_step: Some(format!("Step {}", run.current_step)),
                        status: Some(run.status.clone()),
                        last_modified: Some(run.updated_at.clone()),
                        created_at: Some(master.created_at.clone()),
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
                        user_invocable: master.user_invocable,
                        disable_model_invocation: master.disable_model_invocation,
                        plugin_slug: Some(master.plugin_slug.clone()),
                        plugin_display_name: Some(master.plugin_display_name.clone()),
                        is_default_plugin: Some(master.plugin_is_default),
                    };
                }
            }

            // For marketplace/imported skills (or skill-builder with no workflow_runs row):
            // show as completed with master data. Frontmatter fields all come from skills master.
            SkillSummary {
                id: master.id,
                name: master.name.clone(),
                library_key,
                current_step: Some("Step 5".to_string()),
                status: Some("completed".to_string()),
                last_modified: Some(master.updated_at.clone()),
                created_at: Some(master.created_at.clone()),
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
                user_invocable: master.user_invocable,
                disable_model_invocation: master.disable_model_invocation,
                plugin_slug: Some(master.plugin_slug.clone()),
                plugin_display_name: Some(master.plugin_display_name.clone()),
                is_default_plugin: Some(master.plugin_is_default),
            }
        })
        .collect();

    if let Some(source_url) = source_url {
        let mut stmt = conn
            .prepare("SELECT skill_name FROM imported_skills WHERE marketplace_source_url = ?1")
            .map_err(|e| format!("list_skills_inner source filter prepare: {}", e))?;
        let scoped_names: std::collections::HashSet<String> = stmt
            .query_map(rusqlite::params![source_url], |row| row.get::<_, String>(0))
            .map_err(|e| format!("list_skills_inner source filter query: {}", e))?
            .collect::<Result<std::collections::HashSet<_>, _>>()
            .map_err(|e| format!("list_skills_inner source filter collect: {}", e))?;
        skills.retain(|s| scoped_names.contains(&s.name));
    }

    // Sort by created_at descending (newest skill first, stable across edits)
    skills.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(skills)
}

/// Filter completed skills to only those with a SKILL.md on disk.
/// Test-only helper for list_refinable_skills_inner.
#[cfg(test)]
fn filter_by_skill_md_exists(skills_path: &str, completed: Vec<SkillSummary>) -> Vec<SkillSummary> {
    completed
        .into_iter()
        .filter(|s| {
            let plugin_slug = s.plugin_slug.as_deref().unwrap_or(DEFAULT_PLUGIN_SLUG);
            let skill_md = resolve_existing_skill_dir(Path::new(skills_path), plugin_slug, &s.name)
                .join("SKILL.md");
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
    skills_path: &str,
    conn: &rusqlite::Connection,
) -> Result<Vec<SkillSummary>, String> {
    let all = list_skills_inner(None, conn)?;
    let completed: Vec<SkillSummary> = all
        .into_iter()
        .filter(|s| s.status.as_deref() == Some("completed"))
        .collect();
    Ok(filter_by_skill_md_exists(skills_path, completed))
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub fn create_skill(
    app: tauri::AppHandle,
    name: String,
    tags: Option<Vec<String>>,
    purpose: Option<String>,
    intake_json: Option<String>,
    description: Option<String>,
    version: Option<String>,
    user_invocable: Option<bool>,
    disable_model_invocation: Option<bool>,
    db: tauri::State<'_, Db>,
) -> Result<i64, String> {
    log::info!(
        "[create_skill] name={} purpose={:?} tags={:?} intake={} description={}",
        name,
        purpose,
        tags,
        intake_json.is_some(),
        description.is_some()
    );
    super::super::imported_skills::validate_skill_name(&name)?;
    let settings = {
        let conn = db.0.lock().map_err(|e| {
            log::error!("[create_skill] Failed to acquire DB lock: {}", e);
            e.to_string()
        })?;
        crate::db::read_settings(&conn).ok()
    };
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

    let skill_id = {
        let conn = db.0.lock().map_err(|e| {
            log::error!("[create_skill] Failed to acquire DB lock: {}", e);
            e.to_string()
        })?;
        let overwrite_orphaned = should_overwrite_orphaned_skill_dirs(Some(&conn), &name)?;
        create_skill_filesystem_inner_with_policy(
            &name,
            skills_path.as_deref(),
            overwrite_orphaned,
        )?;
        create_skill_db_records_inner(
            &conn,
            &name,
            tags.as_deref(),
            purpose.as_deref(),
            author_login.as_deref(),
            author_avatar.as_deref(),
            intake_json.as_deref(),
            description.as_deref(),
            version.as_deref(),
            user_invocable,
            disable_model_invocation,
        )?;
        crate::db::get_skill_master_id_in_plugin(
            &conn,
            &name,
            crate::skill_paths::DEFAULT_PLUGIN_SLUG,
        )?
        .ok_or_else(|| format!("Failed to find created skill '{}'", name))?
    };

    post_create_skill_filesystem_inner(
        &name,
        skills_path.as_deref(),
        DEFAULT_PLUGIN_SLUG,
        Some(&app),
    );
    Ok(skill_id)
}

#[allow(clippy::too_many_arguments)]
#[allow(dead_code)]
pub(crate) fn create_skill_inner(
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
    user_invocable: Option<bool>,
    disable_model_invocation: Option<bool>,
) -> Result<(), String> {
    super::super::imported_skills::validate_skill_name(name)?;
    let overwrite_orphaned = should_overwrite_orphaned_skill_dirs(conn, name)?;
    create_skill_filesystem_inner_with_policy(name, skills_path, overwrite_orphaned)?;
    if let Some(conn) = conn {
        create_skill_db_records_inner(
            conn,
            name,
            tags,
            purpose,
            author_login,
            author_avatar,
            intake_json,
            description,
            version,
            user_invocable,
            disable_model_invocation,
        )?;
    }
    post_create_skill_filesystem_inner(name, skills_path, DEFAULT_PLUGIN_SLUG, None);
    Ok(())
}

#[allow(dead_code)]
pub(crate) fn create_skill_filesystem_inner(
    name: &str,
    skills_path: Option<&str>,
) -> Result<(), String> {
    create_skill_filesystem_inner_with_policy(name, skills_path, false)
}

fn create_skill_filesystem_inner_with_policy(
    name: &str,
    skills_path: Option<&str>,
    overwrite_orphaned: bool,
) -> Result<(), String> {
    super::super::imported_skills::validate_skill_name(name)
        .map_err(|_| "Invalid skill path: path traversal not allowed".to_string())?;

    // Check for collision in skills_path (canonical skill directory).
    if let Some(sp) = skills_path {
        let skill_dir =
            crate::skill_paths::resolve_skill_dir(Path::new(sp), DEFAULT_PLUGIN_SLUG, name);
        if skill_dir.exists() {
            if overwrite_orphaned {
                fs::remove_dir_all(&skill_dir).map_err(|e| {
                    format!(
                        "Failed to remove stale skills directory for '{}': {}",
                        name, e
                    )
                })?;
                log::warn!(
                    "[create_skill] removed stale dir before recreate skill={} path={}",
                    name,
                    skill_dir.display()
                );
            } else {
                return Err(format!(
                    "Skill '{}' already exists in skills directory ({})",
                    name,
                    skill_dir.display()
                ));
            }
        }

        // Create canonical skill dir and references subdir.
        let skill_dir = ensure_nested_skill_dir(Path::new(sp), DEFAULT_PLUGIN_SLUG, name)?;
        fs::create_dir_all(skill_dir.join("references")).map_err(|e| e.to_string())?;
    }

    Ok(())
}

fn should_overwrite_orphaned_skill_dirs(
    conn: Option<&rusqlite::Connection>,
    name: &str,
) -> Result<bool, String> {
    let Some(conn) = conn else {
        return Ok(false);
    };
    Ok(crate::db::get_skill_master_any_plugin(conn, name)?.is_none())
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn create_skill_db_records_inner(
    conn: &rusqlite::Connection,
    name: &str,
    tags: Option<&[String]>,
    purpose: Option<&str>,
    author_login: Option<&str>,
    author_avatar: Option<&str>,
    intake_json: Option<&str>,
    description: Option<&str>,
    version: Option<&str>,
    user_invocable: Option<bool>,
    disable_model_invocation: Option<bool>,
) -> Result<(), String> {
    let purpose = purpose.unwrap_or("domain");

    conn.execute_batch("BEGIN").map_err(|e| e.to_string())?;
    let result = (|| -> Result<(), String> {
        crate::db::save_workflow_run(conn, name, 0, "pending", purpose)?;

        if let Some(tags) = tags {
            if !tags.is_empty() {
                crate::db::set_skill_tags(
                    conn,
                    name,
                    crate::skill_paths::DEFAULT_PLUGIN_SLUG,
                    tags,
                )?;
            }
        }

        if let Some(login) = author_login {
            crate::db::set_skill_author(conn, name, login, author_avatar).map_err(|e| {
                log::warn!(
                    "[create_skill_inner] set_skill_author failed for {}: {}",
                    name,
                    e
                );
                e
            })?;
        }

        if let Some(ij) = intake_json {
            crate::db::set_skill_intake(conn, name, Some(ij)).map_err(|e| {
                log::warn!(
                    "[create_skill_inner] set_skill_intake failed for {}: {}",
                    name,
                    e
                );
                e
            })?;
        }

        if description.is_some()
            || version.is_some()
            || user_invocable.is_some()
            || disable_model_invocation.is_some()
        {
            crate::db::set_skill_behaviour_in_plugin(
                conn,
                name,
                crate::skill_paths::DEFAULT_PLUGIN_SLUG,
                description,
                version,
                user_invocable,
                disable_model_invocation,
            )
            .map_err(|e| {
                log::warn!(
                    "[create_skill_inner] set_skill_behaviour failed for {}: {}",
                    name,
                    e
                );
                e
            })?;
        }

        Ok(())
    })();
    if let Err(e) = result {
        let _ = conn.execute_batch("ROLLBACK");
        return Err(e);
    }
    conn.execute_batch("COMMIT").map_err(|e| e.to_string())?;
    Ok(())
}

fn post_create_skill_filesystem_inner(
    name: &str,
    skills_path: Option<&str>,
    plugin_slug: &str,
    app_handle: Option<&tauri::AppHandle>,
) {
    // INTENTIONAL: DB committed first; git commit may fail.
    // Reconciler corrects disk/DB divergence on next startup.
    if let Some(sp) = skills_path {
        let skill_dir = crate::skill_paths::resolve_skill_dir(Path::new(sp), plugin_slug, name);

        // Seed .agents/ so OpenHands can find agents immediately.
        if let Some(app) = app_handle {
            if let Err(e) =
                crate::commands::workflow::deploy::seed_skill_agents_dir(app, &skill_dir)
            {
                log::warn!(
                    "[create_skill] failed to seed .agents/ for {}: {}",
                    skill_dir.display(),
                    e
                );
            }
        }

        // Regenerate marketplace manifests
        if let Err(e) = crate::marketplace_manifest::regenerate_all_manifests(Path::new(sp)) {
            log::warn!("Manifest regeneration failed after create: {}", e);
        }
        // Initialize per-skill git repo and commit at the skill dir level
        if let Err(e) = crate::git::ensure_repo(&skill_dir) {
            log::warn!(
                "[post_create_skill_filesystem_inner] failed to init git repo for '{}': {}",
                name,
                e
            );
        }
        let msg = format!("{}: created", name);
        if let Err(e) = crate::git::commit_all(&skill_dir, &msg) {
            log::warn!(
                "[post_create_skill_filesystem_inner] git commit failed ({}): {:?}",
                msg,
                e
            );
        }
    }
}

#[tauri::command]
pub async fn delete_skill(
    app: tauri::AppHandle,
    workspace_path: String,
    name: String,
    db: tauri::State<'_, Db>,
    workflow_runs: tauri::State<'_, WorkflowStepRunManager>,
    refine_sessions: tauri::State<'_, SkillSessionManager>,
) -> Result<(), String> {
    log::info!(
        "[delete_skill] name={} workspace_path={}",
        name,
        workspace_path
    );
    let (skills_path, plugin_slug) = {
        let conn = db.0.lock().map_err(|e| {
            log::error!("[delete_skill] Failed to acquire DB lock: {}", e);
            e.to_string()
        })?;
        let settings = crate::db::read_settings(&conn).ok();
        let skills_path = settings.as_ref().and_then(|s| s.skills_path.clone());
        let plugin_slug = crate::db::get_skill_master_any_plugin(&conn, &name)
            .ok()
            .flatten()
            .map(|m| m.plugin_slug)
            .unwrap_or_else(|| DEFAULT_PLUGIN_SLUG.to_string());
        (skills_path, plugin_slug)
    };

    // DB cleanup works even without skills_path; only filesystem cleanup needs it
    if skills_path.is_none() {
        log::warn!(
            "[delete_skill] skills_path not configured; skipping filesystem cleanup for '{}'",
            name
        );
    }

    let shutdown_plan = {
        let conn = db.0.lock().map_err(|e| {
            log::error!(
                "[delete_skill] Failed to acquire DB lock during runtime shutdown: {}",
                e
            );
            e.to_string()
        })?;
        prepare_skill_runtime_shutdown_inner(
            &conn,
            &name,
            &plugin_slug,
            &workflow_runs,
            &refine_sessions,
        )?
    };

    // Collect conversation IDs before any cleanup
    let conversation_ids: Vec<String> = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let mut ids = Vec::new();
        let slugs_to_check = if plugin_slug != crate::skill_paths::DEFAULT_PLUGIN_SLUG {
            vec![
                plugin_slug.clone(),
                crate::skill_paths::DEFAULT_PLUGIN_SLUG.to_string(),
            ]
        } else {
            vec![plugin_slug.clone()]
        };
        for slug in &slugs_to_check {
            if let Ok(Some(id)) = crate::db::get_skill_conversation_id(&conn, slug, &name) {
                ids.push(id);
            }
        }
        ids
    };

    // Best-effort pause conversations before deletion
    let pause_config =
        crate::commands::skill_session::build_pause_runtime_config(&app, &db, &name, &plugin_slug);

    cleanup_openhands_conversations_with(
        pause_config,
        &conversation_ids,
        |config, conversation_id| async move {
            crate::agents::openhands_server::pause_openhands_conversation(config, &conversation_id)
                .await
        },
        |config, conversation_id| async move {
            crate::agents::openhands_server::delete_openhands_conversation(config, &conversation_id)
                .await
        },
    )
    .await;

    for conversation_id in &shutdown_plan.conversation_ids {
        let stopped = crate::agents::openhands_server::close_local_openhands_run(conversation_id);
        log::info!(
            "[delete_skill] quiesce runtime skill={} conversation={} stopped={} ended_workflow_sessions={}",
            name,
            conversation_id,
            stopped,
            shutdown_plan.ended_workflow_sessions
        );
    }

    if shutdown_plan.conversation_ids.is_empty() && shutdown_plan.ended_workflow_sessions > 0 {
        log::info!(
            "[delete_skill] ended {} active workflow session(s) for skill={} before deletion",
            shutdown_plan.ended_workflow_sessions,
            name
        );
    }

    delete_skill_filesystem_inner(&name, &plugin_slug, skills_path.as_deref())?;
    post_delete_skill_filesystem_inner(&name, skills_path.as_deref(), &plugin_slug);
    {
        let conn = db.0.lock().map_err(|e| {
            log::error!("[delete_skill] Failed to acquire DB lock: {}", e);
            e.to_string()
        })?;
        delete_skill_db_records_inner(&conn, &name, &plugin_slug)?;
    }
    Ok(())
}

#[allow(dead_code)]
pub(crate) fn delete_skill_inner(
    name: &str,
    plugin_slug: &str,
    conn: Option<&rusqlite::Connection>,
    skills_path: Option<&str>,
) -> Result<(), String> {
    delete_skill_filesystem_inner(name, plugin_slug, skills_path)?;
    post_delete_skill_filesystem_inner(name, skills_path, plugin_slug);
    if let Some(conn) = conn {
        delete_skill_db_records_inner(conn, name, plugin_slug)?;
    }
    Ok(())
}

pub(crate) fn delete_skill_filesystem_inner(
    name: &str,
    plugin_slug: &str,
    skills_path: Option<&str>,
) -> Result<(), String> {
    log::info!(
        "[delete_skill] skill={} skills_path={:?}",
        name,
        skills_path
    );
    super::super::imported_skills::validate_skill_name(name)
        .map_err(|_| "Invalid skill path: path traversal not allowed".to_string())?;

    if let Some(sp) = skills_path {
        let output_dir = resolve_existing_skill_dir(Path::new(sp), plugin_slug, name);
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

    Ok(())
}

fn post_delete_skill_filesystem_inner(name: &str, skills_path: Option<&str>, plugin_slug: &str) {
    if let Some(sp) = skills_path {
        if let Err(e) = crate::marketplace_manifest::regenerate_all_manifests(Path::new(sp)) {
            log::warn!("Manifest regeneration failed after delete: {}", e);
        }
        // Per-skill repo is gone with the directory — nothing to commit.
        let skill_dir = crate::skill_paths::resolve_skill_dir(Path::new(sp), plugin_slug, name);
        if !skill_dir.exists() {
            return;
        }
        let msg = format!("{}: deleted", name);
        if let Err(e) = crate::git::commit_all(&skill_dir, &msg) {
            log::warn!(
                "[post_delete_skill_filesystem_inner] git commit failed ({}): {:?}",
                msg,
                e
            );
        }
    }
}

#[derive(Debug, Default, PartialEq, Eq)]
pub(crate) struct SkillRuntimeShutdownPlan {
    pub conversation_ids: Vec<String>,
    pub ended_workflow_sessions: u32,
}

pub(crate) fn prepare_skill_runtime_shutdown_inner(
    conn: &rusqlite::Connection,
    name: &str,
    plugin_slug: &str,
    workflow_runs: &WorkflowStepRunManager,
    refine_sessions: &SkillSessionManager,
) -> Result<SkillRuntimeShutdownPlan, String> {
    let mut conversation_ids = Vec::new();
    let skill_id = crate::db::get_skill_master_id_in_plugin(conn, name, plugin_slug)?
        .ok_or_else(|| format!("Skill '{}' not found in plugin '{}'", name, plugin_slug))?;

    {
        let mut map = workflow_runs.0.lock().map_err(|e| e.to_string())?;
        let stale_runs: Vec<(String, String)> = map
            .iter()
            .filter(|(_, run)| run.skill_name == name && run.plugin_slug == plugin_slug)
            .map(|(entry_key, run)| (entry_key.clone(), run.conversation_id.clone()))
            .collect();
        for (entry_key, _) in &stale_runs {
            map.remove(entry_key);
        }
        conversation_ids.extend(
            stale_runs
                .into_iter()
                .map(|(_, conversation_id)| conversation_id),
        );
    }

    {
        let mut map = refine_sessions.0.lock().map_err(|e| e.to_string())?;
        let stale_sessions: Vec<String> = map
            .iter()
            .filter(|(_, session)| session.skill_name == name && session.plugin_slug == plugin_slug)
            .map(|(session_key, _)| session_key.clone())
            .collect();
        for session_key in stale_sessions {
            if let Some(session) = map.remove(&session_key) {
                if let Some(conversation_id) = session.conversation_id {
                    conversation_ids.push(conversation_id);
                }
            }
        }
    }

    let ended_workflow_sessions =
        crate::db::end_active_workflow_sessions_for_skill_id(conn, skill_id)?;

    Ok(SkillRuntimeShutdownPlan {
        conversation_ids,
        ended_workflow_sessions,
    })
}

pub(crate) fn delete_skill_db_records_inner(
    conn: &rusqlite::Connection,
    name: &str,
    plugin_slug: &str,
) -> Result<(), String> {
    conn.execute_batch("SAVEPOINT delete_skill")
        .map_err(|e| e.to_string())?;
    let skill_identifier = format!("skill-builder:{}:{}", plugin_slug, name);
    let result = (|| -> Result<(), String> {
        // Purge workflow artifact rows keyed by skill name (clarifications, decisions).
        // These exist for any skill source and must be cleaned up unconditionally.
        crate::db::workflow_artifacts::delete_clarifications(conn, &skill_identifier)
            .map_err(|e| e.to_string())?;
        crate::db::workflow_artifacts::delete_decisions(conn, &skill_identifier)
            .map_err(|e| e.to_string())?;

        // Full DB cleanup: route to the right delete based on what's in the DB.
        // Skill-builder skills have a workflow_run; marketplace/imported skills do not.
        let s_id = crate::db::get_skill_master_id_in_plugin(conn, name, plugin_slug)?
            .ok_or_else(|| format!("Skill '{}' not found in plugin '{}'", name, plugin_slug))?;
        let has_workflow_run = crate::db::get_workflow_run_id_by_skill_id(conn, s_id)
            .unwrap_or(None)
            .is_some();
        if has_workflow_run {
            crate::db::delete_workflow_run(conn, name, plugin_slug)?;
            log::info!(
                "[delete_skill] workflow run DB records cleaned for {}",
                name
            );
        } else {
            crate::db::clear_skill_conversation_id(conn, plugin_slug, name)?;
            crate::db::delete_imported_skill_by_name(conn, name, plugin_slug)?;
            crate::db::delete_skill_in_plugin(conn, name, plugin_slug)?;
            log::info!(
                "[delete_skill] imported skill DB records cleaned for {}",
                name
            );
        }

        Ok(())
    })();
    if let Err(e) = result {
        let _ = conn.execute_batch("ROLLBACK TO delete_skill");
        let _ = conn.execute_batch("RELEASE delete_skill");
        return Err(e);
    }
    conn.execute_batch("RELEASE delete_skill")
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_skill_initializes_per_skill_git_repo() {
        let dir = tempfile::tempdir().unwrap();
        let skills_path = dir.path().to_str().unwrap();
        let plugin_slug = crate::skill_paths::DEFAULT_PLUGIN_SLUG;

        post_create_skill_filesystem_inner("brand-new-skill", Some(skills_path), plugin_slug, None);

        let skill_dir =
            crate::skill_paths::resolve_skill_dir(dir.path(), plugin_slug, "brand-new-skill");
        assert!(
            skill_dir.join(".git").exists(),
            "per-skill .git must exist after create"
        );
    }

    #[test]
    fn create_skill_filesystem_inner_does_not_create_context_subdir() {
        let skills = tempfile::tempdir().unwrap();
        let skills_str = skills.path().to_str().unwrap();

        // Skills dir is created via ensure_nested_skill_dir.
        create_skill_filesystem_inner_with_policy("my-new-skill", Some(skills_str), false).unwrap();

        let skill_dir = crate::skill_paths::resolve_skill_dir(
            skills.path(),
            crate::skill_paths::DEFAULT_PLUGIN_SLUG,
            "my-new-skill",
        );

        assert!(skill_dir.is_dir(), "skill dir should be created");
        assert!(
            !skill_dir.join("context").exists(),
            "context/ subdir must NOT be created"
        );
    }
}
