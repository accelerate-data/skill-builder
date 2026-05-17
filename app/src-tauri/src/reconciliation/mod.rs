mod skill_builder;

use crate::skill_paths::DEFAULT_PLUGIN_SLUG;
use crate::types::ReconciliationResult;
use std::path::Path;

/// Core reconciliation logic. Runs on startup before the dashboard loads.
///
/// Phase 1: Plugin recon (covers all completed skills)
///
/// - DB is the starting point, disk always wins on contention
/// - a. Ensure the canonical default plugin exists in DB
/// - b. Sync display names from marketplace.json (source of truth); do NOT regenerate marketplace.json
///
/// Phase 2: Workflow recon (DB-owned state only)
///
/// - For each skill-builder skill where status != completed, repair stale DB-owned state only
pub fn reconcile_on_startup(
    conn: &rusqlite::Connection,
    skills_path: &str,
) -> Result<ReconciliationResult, String> {
    let mut notifications = Vec::new();
    let skills_dir = Path::new(skills_path);
    crate::db::migrations::repair_plugin_ownership_schema(conn).map_err(|e| e.to_string())?;

    // ════════════════════════════════════════════════════════════════════════
    // Phase 1: App-owned plugin/layout normalization
    // ════════════════════════════════════════════════════════════════════════

    // 1a. Ensure the canonical default plugin exists in DB and on disk
    crate::db::ensure_default_plugin(conn)?;
    if skills_dir.exists() {
        let default_plugin_dir = skills_dir.join(DEFAULT_PLUGIN_SLUG);
        if let Err(e) = std::fs::create_dir_all(&default_plugin_dir) {
            log::warn!("[reconcile] failed to create default plugin dir: {}", e);
        }
        // Ensure plugin.json exists for the default plugin
        let pj_path = skills_dir
            .join(DEFAULT_PLUGIN_SLUG)
            .join(".claude-plugin")
            .join("plugin.json");
        if !pj_path.is_file() {
            if let Err(e) = crate::marketplace_manifest::write_plugin_json(
                skills_dir,
                DEFAULT_PLUGIN_SLUG,
                crate::skill_paths::DEFAULT_PLUGIN_DISPLAY_NAME,
                None,
                None,
            ) {
                log::warn!("[reconcile] failed to write default plugin.json: {}", e);
            }
        }
        // Ensure the default plugin is listed in marketplace.json
        if let Err(e) = crate::marketplace_manifest::ensure_plugin_in_marketplace(
            skills_dir,
            DEFAULT_PLUGIN_SLUG,
            crate::skill_paths::DEFAULT_PLUGIN_DISPLAY_NAME,
        ) {
            log::warn!(
                "[reconcile] failed to ensure default plugin in marketplace.json: {}",
                e
            );
        }
    }

    // 1b. Sync display names from marketplace.json (source of truth)
    // Do NOT regenerate marketplace.json — it's git-backed
    {
        let display_names = crate::marketplace_manifest::read_plugin_display_names(skills_dir);
        for (slug, name) in &display_names {
            if let Err(e) = crate::db::update_plugin_display_name(conn, slug, name) {
                log::debug!(
                    "[reconcile] failed to sync display name for '{}': {}",
                    slug,
                    e
                );
            }
        }
    }

    // ════════════════════════════════════════════════════════════════════════
    // Phase 2: Workflow recon (DB-owned state only)
    // ════════════════════════════════════════════════════════════════════════

    let all_skills = crate::db::list_all_skills(conn)?;
    log::info!(
        "[reconcile] phase 2: workflow recon for {} skills, skills_path={}",
        all_skills.len(),
        skills_path
    );

    for skill in &all_skills {
        if skill.skill_source != "skill-builder" {
            continue;
        }

        // Only reconcile incomplete skills — completed skills were handled in Phase 1
        let maybe_run = crate::db::get_workflow_run_by_skill_id(conn, skill.id)?;
        let is_completed = maybe_run
            .as_ref()
            .map(|r| r.status == "completed")
            .unwrap_or(false);
        if is_completed {
            continue;
        }

        skill_builder::reconcile_skill_builder(
            conn,
            &skill.name,
            &skill.plugin_slug,
            skills_path,
            &mut notifications,
        )?;
    }

    log::info!("[reconcile] done: {} notifications", notifications.len());

    Ok(ReconciliationResult {
        notifications,
        auto_cleaned: 0,
    })
}

#[cfg(test)]
mod tests;
