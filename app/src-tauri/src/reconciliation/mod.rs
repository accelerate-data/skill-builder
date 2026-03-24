mod marketplace;
mod skill_builder;

use crate::fs_validation::detect_furthest_step;
use crate::skill_paths::{enumerate_skill_locations, resolve_skill_dir, DEFAULT_PLUGIN_SLUG};
use crate::types::{DiscoveredSkill, ReconciliationResult};
use std::collections::HashSet;
use std::path::Path;

/// Core reconciliation logic. Runs on startup before the dashboard loads.
///
/// Phase 1: Plugin recon (covers all completed skills)
///   - DB is the starting point, disk always wins on contention
///   a. Ensure "skills" default plugin exists in DB
///   b. DB → disk: for each plugin in DB, verify folder exists; if gone, delete plugin + skills from DB
///   c. Disk → DB: for each plugin folder on disk, ensure DB row exists; for each skill with SKILL.md, ensure DB row
///   d. Sync display names from marketplace.json (source of truth); do NOT regenerate marketplace.json
///
/// Phase 2: Workflow recon (incomplete skills only)
///   - For each skill-builder skill where status != completed, check step artifacts and reset/advance
pub fn reconcile_on_startup(
    conn: &rusqlite::Connection,
    workspace_path: &str,
    skills_path: &str,
) -> Result<ReconciliationResult, String> {
    let mut notifications = Vec::new();
    let skills_dir = Path::new(skills_path);

    // ── Phase 0: Clean up incomplete benchmark iterations ──
    crate::commands::workflow::evaluation::clean_all_incomplete_iterations(workspace_path);

    // ════════════════════════════════════════════════════════════════════════
    // Phase 1: Plugin recon
    // ════════════════════════════════════════════════════════════════════════

    // 1a. Ensure default "skills" plugin exists in DB and on disk
    crate::db::ensure_default_plugin(conn)?;
    if skills_dir.exists() {
        let default_skills_dir = skills_dir.join(DEFAULT_PLUGIN_SLUG).join("skills");
        if let Err(e) = std::fs::create_dir_all(&default_skills_dir) {
            log::warn!("[reconcile] failed to create default plugin dir: {}", e);
        }
        // Ensure plugin.json exists for the default plugin
        let pj_path = skills_dir.join(DEFAULT_PLUGIN_SLUG).join(".claude-plugin").join("plugin.json");
        if !pj_path.is_file() {
            if let Err(e) = crate::marketplace_manifest::write_plugin_json(
                skills_dir, DEFAULT_PLUGIN_SLUG, crate::skill_paths::DEFAULT_PLUGIN_DISPLAY_NAME, None, None,
            ) {
                log::warn!("[reconcile] failed to write default plugin.json: {}", e);
            }
        }
        // Ensure the default plugin is listed in marketplace.json
        if let Err(e) = crate::marketplace_manifest::ensure_plugin_in_marketplace(
            skills_dir, DEFAULT_PLUGIN_SLUG, crate::skill_paths::DEFAULT_PLUGIN_DISPLAY_NAME,
        ) {
            log::warn!("[reconcile] failed to ensure default plugin in marketplace.json: {}", e);
        }
    }

    // 1b. DB → disk cleanup: delete plugins (and their skills) whose folders are gone
    {
        let db_plugins = crate::db::list_plugins(conn)?;
        for plugin in &db_plugins {
            if plugin.is_default {
                continue;
            }
            let plugin_dir = skills_dir.join(&plugin.slug);
            if !plugin_dir.exists() {
                // Folder gone — delete all skills in this plugin, then the plugin row
                log::info!(
                    "[reconcile] plugin '{}': folder gone, deleting plugin and all skills from DB",
                    plugin.slug
                );
                // Hard-delete all skills (including soft-deleted) in this plugin
                if let Err(e) = conn.execute(
                    "DELETE FROM skills WHERE plugin_id = ?1",
                    rusqlite::params![plugin.id],
                ) {
                    log::warn!(
                        "[reconcile] plugin '{}': failed to delete skills: {}",
                        plugin.slug, e
                    );
                    continue;
                }
                if let Err(e) = crate::db::delete_plugin_by_slug(conn, &plugin.slug) {
                    log::warn!(
                        "[reconcile] plugin '{}': failed to delete plugin row: {}",
                        plugin.slug, e
                    );
                } else {
                    notifications.push(format!(
                        "Plugin '{}' removed — folder not found on disk",
                        plugin.slug
                    ));
                }
            }
        }
    }

    // 1c. Disk → DB discovery: create DB rows for plugins/skills found on disk
    let mut discovered_skills = Vec::new();
    if skills_dir.exists() {
        let db_plugins: HashSet<String> = crate::db::list_plugins(conn)?
            .into_iter()
            .map(|p| p.slug)
            .collect();

        // Discover plugin folders
        for entry in std::fs::read_dir(skills_dir).into_iter().flatten().flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let slug = entry.file_name().to_string_lossy().to_string();
            if slug.starts_with('.') {
                continue;
            }
            let is_plugin = path.join("skills").is_dir() || path.join(".claude-plugin").is_dir();
            if !is_plugin {
                continue;
            }
            if !db_plugins.contains(&slug) {
                let display_name = crate::skill_paths::plugin_display_name(&slug);
                log::info!("[reconcile] discovered plugin '{}' on disk, creating DB row", slug);
                if let Err(e) = crate::db::ensure_plugin(conn, &slug, &display_name, "local", None, None, slug == DEFAULT_PLUGIN_SLUG) {
                    log::warn!("[reconcile] failed to create plugin '{}': {}", slug, e);
                }
            }
        }

        // Discover skills inside plugins
        let all_skills_in_db: HashSet<String> = crate::db::list_all_skills(conn)?
            .iter()
            .map(|s| format!("{}:{}", s.plugin_slug, s.name))
            .collect();

        for loc in enumerate_skill_locations(skills_dir)? {
            let key = format!("{}:{}", loc.plugin_slug, loc.skill_name);
            if all_skills_in_db.contains(&key) {
                continue;
            }

            let skill_md = loc.dir.join("SKILL.md");
            if !skill_md.exists() {
                // Folder with no SKILL.md — skip (not a valid skill)
                continue;
            }

            // New skill on disk not in DB — create it
            log::info!(
                "[reconcile] discovered skill '{}' in plugin '{}', creating DB row",
                loc.skill_name, loc.plugin_slug
            );
            match crate::db::upsert_skill_in_plugin(
                conn,
                &loc.skill_name,
                "skill-builder",
                "domain",
                &loc.plugin_slug,
            ) {
                Ok(_id) => {
                    // Create a workflow_runs row at step 3 (completed) since SKILL.md exists
                    let disk_step = detect_furthest_step(workspace_path, &loc.skill_name, skills_path)
                        .map(|s| s as i32)
                        .unwrap_or(3);
                    let status = if disk_step >= 3 { "completed" } else { "pending" };
                    crate::db::save_workflow_run(conn, &loc.skill_name, disk_step, status, "domain")?;
                    discovered_skills.push(DiscoveredSkill {
                        name: loc.skill_name.clone(),
                        plugin_slug: Some(loc.plugin_slug.clone()),
                        plugin_display_name: Some(loc.plugin_display_name.clone()),
                        is_default_plugin: Some(loc.is_default_plugin),
                        detected_step: disk_step,
                        scenario: "discovered".to_string(),
                    });
                    notifications.push(format!(
                        "'{}' discovered in plugin '{}'",
                        loc.skill_name, loc.plugin_slug
                    ));
                }
                Err(e) => {
                    log::warn!(
                        "[reconcile] failed to create skill '{}' in plugin '{}': {}",
                        loc.skill_name, loc.plugin_slug, e
                    );
                }
            }
        }
    }

    // 1c-ii. Marketplace plugin integrity: if any skill in a marketplace plugin
    // is missing SKILL.md, delete the entire plugin (someone tampered with it).
    // For created/local plugins, missing SKILL.md is fine (work in progress).
    {
        let db_plugins = crate::db::list_plugins(conn)?;
        for plugin in &db_plugins {
            if plugin.is_default || plugin.source_type != "marketplace" {
                continue;
            }
            let plugin_skills_dir = skills_dir.join(&plugin.slug).join("skills");
            if !plugin_skills_dir.is_dir() {
                continue;
            }
            let has_missing_skill_md = std::fs::read_dir(&plugin_skills_dir)
                .into_iter()
                .flatten()
                .flatten()
                .any(|entry| {
                    let path = entry.path();
                    path.is_dir() && !path.join("SKILL.md").is_file()
                });
            if has_missing_skill_md {
                log::info!(
                    "[reconcile] marketplace plugin '{}': skill with missing SKILL.md detected, deleting plugin",
                    plugin.slug
                );
                // Hard-delete all skills then the plugin
                let _ = conn.execute(
                    "DELETE FROM skills WHERE plugin_id = ?1",
                    rusqlite::params![plugin.id],
                );
                if let Err(e) = crate::db::delete_plugin_by_slug(conn, &plugin.slug) {
                    log::warn!("[reconcile] failed to delete marketplace plugin '{}': {}", plugin.slug, e);
                } else {
                    // Remove from disk too
                    let plugin_dir = skills_dir.join(&plugin.slug);
                    let _ = std::fs::remove_dir_all(&plugin_dir);
                    notifications.push(format!(
                        "Marketplace plugin '{}' removed — skill with missing SKILL.md detected",
                        plugin.slug
                    ));
                }
            }
        }
    }

    // 1d. Sync display names from marketplace.json (source of truth)
    // Do NOT regenerate marketplace.json — it's git-backed
    {
        let display_names = crate::marketplace_manifest::read_plugin_display_names(skills_dir);
        for (slug, name) in &display_names {
            if let Err(e) = crate::db::update_plugin_display_name(conn, slug, name) {
                log::debug!("[reconcile] failed to sync display name for '{}': {}", slug, e);
            }
        }
    }

    // ════════════════════════════════════════════════════════════════════════
    // Phase 2: Workflow recon (incomplete skills only)
    // ════════════════════════════════════════════════════════════════════════

    let all_skills = crate::db::list_all_skills(conn)?;
    log::info!(
        "[reconcile] phase 2: workflow recon for {} skills, workspace={} skills_path={}",
        all_skills.len(), workspace_path, skills_path
    );

    for skill in &all_skills {
        if skill.skill_source != "skill-builder" {
            continue;
        }

        // Only reconcile incomplete skills — completed skills were handled in Phase 1
        let maybe_run = crate::db::get_workflow_run(conn, &skill.name)?;
        let is_completed = maybe_run.as_ref().map(|r| r.status == "completed").unwrap_or(false);
        if is_completed {
            continue;
        }

        skill_builder::reconcile_skill_builder(
            conn,
            &skill.name,
            workspace_path,
            skills_path,
            &mut notifications,
        )?;
    }

    log::info!(
        "[reconcile] done: {} notifications, {} discovered skills",
        notifications.len(),
        discovered_skills.len()
    );

    Ok(ReconciliationResult {
        orphans: Vec::new(),
        notifications,
        auto_cleaned: 0,
        discovered_skills,
    })
}

/// Read-only startup reconciliation preview.
pub fn preview_reconcile_on_startup(
    conn: &rusqlite::Connection,
    workspace_path: &str,
    skills_path: &str,
) -> Result<ReconciliationResult, String> {
    let mut notifications = Vec::new();
    let mut discovered_skills = Vec::new();
    let all_skills = crate::db::list_all_skills(conn)?;
    let skills_dir = Path::new(skills_path);

    // Preview plugin cleanup
    let db_plugins = crate::db::list_plugins(conn)?;
    for plugin in &db_plugins {
        if plugin.is_default {
            continue;
        }
        if !skills_dir.join(&plugin.slug).exists() {
            notifications.push(format!(
                "Plugin '{}' will be removed — folder not found on disk",
                plugin.slug
            ));
        }
    }

    // Preview skill discovery
    let master_names: HashSet<String> = all_skills
        .iter()
        .map(|s| format!("{}:{}", s.plugin_slug, s.name))
        .collect();
    if skills_dir.exists() {
        for loc in enumerate_skill_locations(skills_dir)? {
            let key = format!("{}:{}", loc.plugin_slug, loc.skill_name);
            if master_names.contains(&key) || !loc.dir.join("SKILL.md").exists() {
                continue;
            }
            discovered_skills.push(DiscoveredSkill {
                name: loc.skill_name,
                plugin_slug: Some(loc.plugin_slug),
                plugin_display_name: Some(loc.plugin_display_name),
                is_default_plugin: Some(loc.is_default_plugin),
                detected_step: 3,
                scenario: "discovered".to_string(),
            });
        }
    }

    // Preview workflow recon for incomplete skills
    for skill in &all_skills {
        if skill.skill_source != "skill-builder" {
            continue;
        }
        let maybe_run = crate::db::get_workflow_run(conn, &skill.name)?;
        let is_completed = maybe_run.as_ref().map(|r| r.status == "completed").unwrap_or(false);
        if is_completed {
            continue;
        }

        if crate::db::has_active_session_with_live_pid(conn, &skill.name) {
            notifications.push(format!(
                "'{}' skipped — active session running in another instance",
                skill.name
            ));
            continue;
        }

        if maybe_run.is_none() {
            notifications.push(format!("'{}' workflow record will be recreated", skill.name));
            continue;
        }

        let run = maybe_run.unwrap();
        let maybe_disk_step = crate::fs_validation::detect_furthest_step_with_options(
            workspace_path, &skill.name, skills_path, false,
        );

        if let Some(disk_step) = maybe_disk_step.map(|s| s as i32) {
            if run.current_step > disk_step {
                notifications.push(format!(
                    "'{}' will be reset from step {} to step {} (disk behind DB)",
                    skill.name, run.current_step + 1, disk_step + 1
                ));
            } else if disk_step > run.current_step {
                notifications.push(format!(
                    "'{}' will be advanced from step {} to step {} (disk ahead of DB)",
                    skill.name, run.current_step + 1, disk_step + 1
                ));
            }
        } else if run.current_step > 0 {
            notifications.push(format!(
                "'{}' will be reset to step 1 (no output files found)",
                skill.name
            ));
        }
    }

    Ok(ReconciliationResult {
        orphans: Vec::new(),
        notifications,
        auto_cleaned: 0,
        discovered_skills,
    })
}

/// Resolve an orphan skill. Called from the frontend after the user makes a decision.
pub fn resolve_orphan(
    conn: &rusqlite::Connection,
    skill_name: &str,
    action: &str,
    skills_path: &str,
) -> Result<(), String> {
    log::debug!(
        "[resolve_orphan] skill='{}': action={} skills_path={}",
        skill_name, action, skills_path
    );
    match action {
        "delete" => {
            crate::commands::imported_skills::validate_skill_name(skill_name)?;
            crate::db::delete_workflow_run(conn, skill_name)?;

            let output_dir = Path::new(skills_path).join(skill_name);
            if output_dir.exists() {
                let canonical_base = std::fs::canonicalize(skills_path)
                    .map_err(|e| format!("Failed to canonicalize skills_path: {}", e))?;
                let canonical_target = std::fs::canonicalize(&output_dir)
                    .map_err(|e| format!("Failed to canonicalize output_dir: {}", e))?;
                if !canonical_target.starts_with(&canonical_base) {
                    return Err(format!("Path traversal attempt for skill '{}'", skill_name));
                }
                std::fs::remove_dir_all(&output_dir).map_err(|e| {
                    format!("Failed to delete skill output for '{}': {}", skill_name, e)
                })?;
            }
            Ok(())
        }
        "keep" => {
            if let Some(run) = crate::db::get_workflow_run(conn, skill_name)? {
                crate::db::save_workflow_run(conn, skill_name, 0, "pending", &run.purpose)?;
                crate::db::reset_workflow_steps_from(conn, skill_name, 0)?;
            }
            Ok(())
        }
        _ => Err(format!(
            "Invalid orphan resolution action: '{}'. Expected 'delete' or 'keep'.",
            action
        )),
    }
}

#[cfg(test)]
mod tests;
