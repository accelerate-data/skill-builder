mod skill_builder;

use crate::skill_paths::{enumerate_skill_locations, DEFAULT_PLUGIN_SLUG};
use crate::types::ReconciliationResult;
use std::path::{Path, PathBuf};

fn normalized_plugin_slug(plugin_slug: &str) -> &str {
    if plugin_slug == "skills" {
        DEFAULT_PLUGIN_SLUG
    } else {
        plugin_slug
    }
}

fn file_contents_equal(left: &Path, right: &Path) -> Result<bool, String> {
    let left_meta = std::fs::metadata(left).map_err(|e| e.to_string())?;
    let right_meta = std::fs::metadata(right).map_err(|e| e.to_string())?;
    if left_meta.len() != right_meta.len() {
        return Ok(false);
    }
    let left_bytes = std::fs::read(left).map_err(|e| e.to_string())?;
    let right_bytes = std::fs::read(right).map_err(|e| e.to_string())?;
    Ok(left_bytes == right_bytes)
}

fn merge_skill_directory(source: &Path, destination: &Path) -> Result<bool, String> {
    if !source.exists() || source == destination {
        return Ok(false);
    }
    if !destination.exists() {
        if let Some(parent) = destination.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::rename(source, destination).map_err(|e| e.to_string())?;
        return Ok(true);
    }

    let mut moved_any = false;
    for entry in std::fs::read_dir(source).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let source_path = entry.path();
        let dest_path = destination.join(entry.file_name());
        let file_type = entry.file_type().map_err(|e| e.to_string())?;

        if file_type.is_dir() {
            if merge_skill_directory(&source_path, &dest_path)? {
                moved_any = true;
            }
            if source_path.exists()
                && std::fs::read_dir(&source_path)
                    .map_err(|e| e.to_string())?
                    .next()
                    .is_none()
            {
                std::fs::remove_dir(&source_path).map_err(|e| e.to_string())?;
            }
            continue;
        }

        if !dest_path.exists() {
            if let Some(parent) = dest_path.parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            std::fs::rename(&source_path, &dest_path).map_err(|e| e.to_string())?;
            moved_any = true;
            continue;
        }

        if file_contents_equal(&source_path, &dest_path)? {
            std::fs::remove_file(&source_path).map_err(|e| e.to_string())?;
            moved_any = true;
        }
    }

    Ok(moved_any)
}

fn prune_empty_legacy_roots(root: &Path, start: &Path) {
    let mut current = start.parent();
    while let Some(dir) = current {
        if dir == root {
            break;
        }
        let is_empty = match std::fs::read_dir(dir) {
            Ok(mut entries) => entries.next().is_none(),
            Err(_) => false,
        };
        if is_empty {
            if let Err(err) = std::fs::remove_dir(dir) {
                log::debug!(
                    "[reconcile] failed to prune empty legacy dir '{}': {}",
                    dir.display(),
                    err
                );
                break;
            }
        } else {
            break;
        }
        current = dir.parent();
    }
}

fn remove_legacy_default_plugin_root(root: &Path) -> Result<bool, String> {
    let legacy_root = root.join("skills");
    if !legacy_root.exists() {
        return Ok(false);
    }

    for entry in std::fs::read_dir(&legacy_root).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if matches!(name.as_str(), "skills" | ".claude-plugin") {
            continue;
        }
        if std::fs::read_dir(&path)
            .map_err(|e| e.to_string())?
            .next()
            .is_none()
        {
            std::fs::remove_dir(&path).map_err(|e| e.to_string())?;
        }
    }

    let nested_skills = legacy_root.join("skills");
    let nested_empty = !nested_skills.exists()
        || std::fs::read_dir(&nested_skills)
            .map_err(|e| e.to_string())?
            .next()
            .is_none();
    let only_legacy_entries = std::fs::read_dir(&legacy_root)
        .map_err(|e| e.to_string())?
        .filter_map(|entry| entry.ok())
        .all(|entry| {
            let name = entry.file_name().to_string_lossy().to_string();
            matches!(name.as_str(), "skills" | ".claude-plugin")
        });

    if nested_empty && only_legacy_entries {
        std::fs::remove_dir_all(&legacy_root).map_err(|e| e.to_string())?;
        return Ok(true);
    }

    Ok(false)
}

fn normalize_root_layout(
    root: &Path,
    notifications: &mut Vec<String>,
    label: &str,
) -> Result<(), String> {
    if !root.exists() {
        return Ok(());
    }

    let locations = enumerate_skill_locations(root)?;
    for location in locations {
        let target_plugin_slug = normalized_plugin_slug(&location.plugin_slug);
        let canonical_dir =
            crate::skill_paths::resolve_skill_dir(root, target_plugin_slug, &location.skill_name);
        if canonical_dir == location.dir {
            continue;
        }

        let source_dir = location.dir.clone();
        let source_display = source_dir.display().to_string();
        let destination_display = canonical_dir.display().to_string();
        if merge_skill_directory(&source_dir, &canonical_dir)? {
            notifications.push(format!(
                "'{}' {} path normalized from '{}' to '{}'",
                location.skill_name, label, source_display, destination_display
            ));
        }

        if source_dir.exists()
            && std::fs::read_dir(&source_dir)
                .map_err(|e| e.to_string())?
                .next()
                .is_none()
        {
            std::fs::remove_dir(&source_dir).map_err(|e| e.to_string())?;
        }
        prune_empty_legacy_roots(root, &source_dir);
    }

    if remove_legacy_default_plugin_root(root)? {
        notifications.push(format!(
            "Removed legacy 'skills' plugin wrapper from {} root",
            label
        ));
    }

    Ok(())
}

fn workspace_legacy_skill_candidates(
    skills_root: &Path,
    plugin_slug: &str,
    skill_name: &str,
) -> Vec<PathBuf> {
    let mut candidates = vec![
        skills_root.join(plugin_slug).join(skill_name),
        skills_root.join(skill_name),
    ];
    if plugin_slug == DEFAULT_PLUGIN_SLUG {
        candidates.push(skills_root.join("skills").join(skill_name));
        candidates.push(
            skills_root
                .join("skills")
                .join("skills")
                .join(skill_name),
        );
    }
    candidates
}

/// Legacy migration: normalizes old skill directory layouts into the
/// canonical skill directory. Operates on the skills root for historical
/// artifact cleanup.
fn normalize_legacy_skills_skill_layouts(
    conn: &rusqlite::Connection,
    skills_root: &Path,
    notifications: &mut Vec<String>,
) -> Result<(), String> {
    let all_skills = crate::db::list_all_skills(conn)?;
    for skill in all_skills {
        let canonical_dir = crate::skill_paths::resolve_skill_dir(
            skills_root,
            normalized_plugin_slug(&skill.plugin_slug),
            &skill.name,
        );
        for source_dir in workspace_legacy_skill_candidates(
            skills_root,
            normalized_plugin_slug(&skill.plugin_slug),
            &skill.name,
        ) {
            if source_dir == canonical_dir || !source_dir.exists() {
                continue;
            }
            let source_display = source_dir.display().to_string();
            let destination_display = canonical_dir.display().to_string();
            if merge_skill_directory(&source_dir, &canonical_dir)? {
                notifications.push(format!(
                    "'{}' path normalized from '{}' to '{}'",
                    skill.name, source_display, destination_display
                ));
            }
            if source_dir.exists()
                && std::fs::read_dir(&source_dir)
                    .map_err(|e| e.to_string())?
                    .next()
                    .is_none()
            {
                std::fs::remove_dir(&source_dir).map_err(|e| e.to_string())?;
            }
            prune_empty_legacy_roots(skills_root, &source_dir);
        }
    }

    if remove_legacy_default_plugin_root(skills_root)? {
        notifications.push("Removed legacy 'skills' plugin wrapper from skills root".into());
    }

    Ok(())
}

fn normalize_legacy_startup_state(
    conn: &rusqlite::Connection,
    skills_root: &Path,
    notifications: &mut Vec<String>,
) -> Result<(), String> {
    crate::db::migrations::repair_plugin_ownership_schema(conn).map_err(|e| e.to_string())?;
    normalize_legacy_skills_skill_layouts(conn, skills_root, notifications)?;
    normalize_root_layout(skills_root, notifications, "skills")?;
    Ok(())
}

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

    normalize_legacy_startup_state(conn, skills_dir, &mut notifications)?;

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
        orphans: Vec::new(),
        notifications,
        auto_cleaned: 0,
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
        skill_name,
        action,
        skills_path
    );
    match action {
        "delete" => {
            crate::commands::imported_skills::validate_skill_name(skill_name)?;

            // Look up plugin slug BEFORE delete so we can pass it through.
            let plugin_slug = crate::db::get_skill_master_any_plugin(conn, skill_name)
                .ok()
                .flatten()
                .map(|m| m.plugin_slug)
                .unwrap_or_else(|| crate::skill_paths::DEFAULT_PLUGIN_SLUG.to_string());
            crate::db::delete_workflow_run(conn, skill_name, &plugin_slug)?;
            let output_dir = crate::skill_paths::resolve_existing_skill_dir(
                Path::new(skills_path),
                &plugin_slug,
                skill_name,
            );
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
            let s_id = crate::db::get_skill_master_id_in_plugin(
                conn,
                skill_name,
                crate::skill_paths::DEFAULT_PLUGIN_SLUG,
            )?;
            if let Some(s_id) = s_id {
                if let Some(run) = crate::db::get_workflow_run_by_skill_id(conn, s_id)? {
                    crate::db::save_workflow_run(conn, skill_name, 0, "pending", &run.purpose)?;
                    crate::db::reset_workflow_steps_from_by_skill_id(conn, s_id, 0)?;
                }
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
