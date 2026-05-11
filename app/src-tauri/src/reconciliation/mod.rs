mod skill_builder;

use crate::fs_validation::detect_furthest_step;
use crate::skill_paths::{enumerate_skill_locations, DEFAULT_PLUGIN_SLUG};
use crate::types::{DiscoveredSkill, ReconciliationResult};
use std::collections::HashSet;
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
    workspace_root: &Path,
    plugin_slug: &str,
    skill_name: &str,
) -> Vec<PathBuf> {
    let mut candidates = vec![
        workspace_root.join(plugin_slug).join(skill_name),
        workspace_root.join(skill_name),
    ];
    if plugin_slug == DEFAULT_PLUGIN_SLUG {
        candidates.push(workspace_root.join("skills").join(skill_name));
        candidates.push(
            workspace_root
                .join("skills")
                .join("skills")
                .join(skill_name),
        );
    }
    candidates
}

/// Legacy migration: normalizes old workspace skill directory layouts into the
/// canonical skill directory. Operates on the workspace root only for historical
/// artifact cleanup — does not touch the canonical skills tree.
fn normalize_legacy_workspace_skill_dirs(
    conn: &rusqlite::Connection,
    workspace_root: &Path,
    notifications: &mut Vec<String>,
) -> Result<(), String> {
    let all_skills = crate::db::list_all_skills(conn)?;
    for skill in all_skills {
        let canonical_dir = crate::skill_paths::resolve_skill_dir(
            workspace_root,
            normalized_plugin_slug(&skill.plugin_slug),
            &skill.name,
        );
        for source_dir in workspace_legacy_skill_candidates(
            workspace_root,
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
                    "'{}' workspace path normalized from '{}' to '{}'",
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
            prune_empty_legacy_roots(workspace_root, &source_dir);
        }
    }

    if remove_legacy_default_plugin_root(workspace_root)? {
        notifications.push("Removed legacy 'skills' plugin wrapper from workspace root".into());
    }

    Ok(())
}

fn normalize_legacy_startup_state(
    conn: &rusqlite::Connection,
    workspace_root: &Path,
    skills_root: &Path,
    notifications: &mut Vec<String>,
) -> Result<(), String> {
    crate::db::migrations::repair_plugin_ownership_schema(conn).map_err(|e| e.to_string())?;
    normalize_legacy_workspace_skill_dirs(conn, workspace_root, notifications)?;
    normalize_root_layout(skills_root, notifications, "skills")?;
    Ok(())
}

/// Core reconciliation logic. Runs on startup before the dashboard loads.
///
/// Phase 1: Plugin recon (covers all completed skills)
///
/// - DB is the starting point, disk always wins on contention
/// - a. Ensure the canonical default plugin exists in DB
/// - b. DB → disk: for each plugin in DB, verify folder exists; if gone, delete plugin + skills from DB
/// - c. Disk → DB: for each plugin folder on disk, ensure DB row exists; for each skill with SKILL.md, ensure DB row
/// - d. Sync display names from marketplace.json (source of truth); do NOT regenerate marketplace.json
///
/// Phase 2: Workflow recon (incomplete skills only)
///
/// - For each skill-builder skill where status != completed, check step artifacts and reset/advance
pub fn reconcile_on_startup(
    conn: &rusqlite::Connection,
    workspace_path: &str,
    skills_path: &str,
) -> Result<ReconciliationResult, String> {
    let mut notifications = Vec::new();
    let workspace_dir = Path::new(workspace_path);
    let skills_dir = Path::new(skills_path);

    // ── Phase 0: Clean up incomplete benchmark iterations ──
    crate::commands::workflow::evaluation::clean_all_incomplete_iterations(workspace_path);
    normalize_legacy_startup_state(conn, workspace_dir, skills_dir, &mut notifications)?;

    // ════════════════════════════════════════════════════════════════════════
    // Phase 1: Plugin recon
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

    // 1b. DB → disk cleanup: delete plugins (and their skills) whose folders are gone
    {
        let db_plugins = crate::db::list_plugins(conn)?;
        for plugin in &db_plugins {
            if plugin.is_default {
                continue;
            }
            let plugin_dir = skills_dir.join(&plugin.slug);
            if !plugin_dir.exists() {
                // Folder gone — delete all skills in this plugin, then the plugin row.
                // This fires on intentional deletion AND on a crash mid-import (plugin DB row
                // was created but the folder was never written). Either way the DB record is
                // stale. Log at WARN so the event is clearly visible in logs.
                log::warn!(
                    "[reconcile] plugin '{}': folder not found on disk — removing plugin and all skills from DB \
                     (this may indicate a deleted plugin or a crash during import)",
                    plugin.slug
                );
                // Hard-delete all skills (including soft-deleted) in this plugin
                if let Err(e) = conn.execute(
                    "DELETE FROM skills WHERE plugin_id = ?1",
                    rusqlite::params![plugin.id],
                ) {
                    log::warn!(
                        "[reconcile] plugin '{}': failed to delete skills: {}",
                        plugin.slug,
                        e
                    );
                    continue;
                }
                if let Err(e) = crate::db::delete_plugin_by_slug(conn, &plugin.slug) {
                    log::warn!(
                        "[reconcile] plugin '{}': failed to delete plugin row: {}",
                        plugin.slug,
                        e
                    );
                } else {
                    notifications.push(format!(
                        "Plugin '{}' removed — folder not found on disk. \
                         If this was an in-progress import, re-import from the marketplace to restore it.",
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
        for entry in std::fs::read_dir(skills_dir)
            .into_iter()
            .flatten()
            .flatten()
        {
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
                log::info!(
                    "[reconcile] discovered plugin '{}' on disk, creating DB row",
                    slug
                );
                if let Err(e) = crate::db::ensure_plugin(
                    conn,
                    &slug,
                    &display_name,
                    "local",
                    None,
                    None,
                    slug == DEFAULT_PLUGIN_SLUG,
                ) {
                    log::warn!("[reconcile] failed to create plugin '{}': {}", slug, e);
                }
            }
        }

        // Discover skills inside plugins
        let all_skills_in_db_list = crate::db::list_all_skills(conn)?;
        let all_skills_in_db: HashSet<String> = all_skills_in_db_list
            .iter()
            .map(|s| format!("{}:{}", s.plugin_slug, s.name))
            .collect();
        // Name-only set: used to detect skills already tracked under a different plugin.
        // If a skill name exists in the DB under any plugin, it is already known — Phase 1c
        // must not create a second row, which would trigger Phase 1f dedup every startup.
        let all_skill_names_in_db: HashSet<String> = all_skills_in_db_list
            .iter()
            .map(|s| s.name.clone())
            .collect();

        for loc in enumerate_skill_locations(skills_dir)? {
            let key = format!("{}:{}", loc.plugin_slug, loc.skill_name);
            if all_skills_in_db.contains(&key) {
                continue;
            }
            // Skill exists in DB under a different plugin — already tracked, nothing to discover.
            // Creating a second DB row here would trigger Phase 1f dedup on every startup.
            if all_skill_names_in_db.contains(&loc.skill_name) {
                log::debug!(
                    "[reconcile] skipping '{}' in plugin '{}' — already tracked in DB under another plugin",
                    loc.skill_name, loc.plugin_slug
                );
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
                loc.skill_name,
                loc.plugin_slug
            );
            match crate::db::upsert_skill_in_plugin(
                conn,
                &loc.skill_name,
                "skill-builder",
                "domain",
                &loc.plugin_slug,
            ) {
                Ok(skill_id) => {
                    // Create a workflow_runs row at step 3 (completed) since SKILL.md exists.
                    // Insert directly using the known skill_id to avoid save_workflow_run's
                    // upsert_skill call which always targets the default plugin and would create
                    // a duplicate skills row for non-default-plugin skills.
                    let disk_step = detect_furthest_step(
                        workspace_path,
                        &loc.plugin_slug,
                        &loc.skill_name,
                        skills_path,
                    )
                    .map(|s| s as i32)
                    .unwrap_or(3);
                    let status = if disk_step >= 3 {
                        "completed"
                    } else {
                        "pending"
                    };
                    conn.execute(
                        "INSERT INTO workflow_runs \
                             (skill_name, current_step, status, purpose, skill_id, updated_at) \
                         VALUES (?1, ?2, ?3, ?4, ?5, datetime('now') || 'Z') \
                         ON CONFLICT(skill_name) DO UPDATE SET \
                             current_step = ?2, status = ?3, purpose = ?4, \
                             skill_id = ?5, updated_at = datetime('now') || 'Z'",
                        rusqlite::params![loc.skill_name, disk_step, status, "domain", skill_id],
                    )
                    .map_err(|e| e.to_string())?;
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
                        loc.skill_name,
                        loc.plugin_slug,
                        e
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
            let plugin_root_dir = skills_dir.join(&plugin.slug);
            if !plugin_root_dir.is_dir() {
                continue;
            }
            let skills_subdir = plugin_root_dir.join("skills");
            let missing_in_canonical = if skills_subdir.is_dir() {
                std::fs::read_dir(&skills_subdir)
                    .into_iter()
                    .flatten()
                    .flatten()
                    .any(|entry| {
                        let path = entry.path();
                        path.is_dir()
                            && !entry.file_name().to_string_lossy().starts_with('.')
                            && !path.join("SKILL.md").is_file()
                    })
            } else {
                false
            };
            let missing_in_legacy = std::fs::read_dir(&plugin_root_dir)
                .into_iter()
                .flatten()
                .flatten()
                .any(|entry| {
                    let path = entry.path();
                    let name = entry.file_name().to_string_lossy().to_string();
                    path.is_dir()
                        && !name.starts_with('.')
                        && name != "skills"
                        && !path.join("SKILL.md").is_file()
                });
            let has_missing_skill_md = missing_in_canonical || missing_in_legacy;
            if has_missing_skill_md {
                log::info!(
                    "[reconcile] marketplace plugin '{}': skill with missing SKILL.md detected, deleting plugin",
                    plugin.slug
                );
                // Hard-delete all skills then the plugin
                if let Err(e) = conn.execute(
                    "DELETE FROM skills WHERE plugin_id = ?1",
                    rusqlite::params![plugin.id],
                ) {
                    log::warn!(
                        "[reconcile] marketplace plugin '{}': failed to delete skills: {}, skipping plugin delete",
                        plugin.slug, e
                    );
                    continue;
                }
                if let Err(e) = crate::db::delete_plugin_by_slug(conn, &plugin.slug) {
                    log::warn!(
                        "[reconcile] failed to delete marketplace plugin '{}': {}",
                        plugin.slug,
                        e
                    );
                } else {
                    // Remove from disk — guard against path traversal via a crafted plugin slug
                    let plugin_dir = skills_dir.join(&plugin.slug);
                    if plugin_dir.exists() {
                        let safe = std::fs::canonicalize(skills_dir)
                            .and_then(|base| std::fs::canonicalize(&plugin_dir).map(|t| (base, t)))
                            .map(|(base, target)| target.starts_with(&base))
                            .unwrap_or(false);
                        if safe {
                            let _ = std::fs::remove_dir_all(&plugin_dir);
                        } else {
                            log::warn!(
                                "[reconcile] marketplace plugin '{}': skipping disk delete — path traversal guard triggered",
                                plugin.slug
                            );
                        }
                    }
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
                log::debug!(
                    "[reconcile] failed to sync display name for '{}': {}",
                    slug,
                    e
                );
            }
        }
    }

    // ════════════════════════════════════════════════════════════════════════
    // Phase 1e: Reconcile skills against skills_path
    //
    // Signal: does the skill have a directory in skills_path?
    // create_skill always creates this directory immediately, so any skill
    // that was legitimately created has a presence here regardless of how
    // far the workflow has progressed.
    //
    // Pass A: restore skills that were previously soft-deleted but DO have
    //         a directory in skills_path (recovers from over-aggressive
    //         prior cleanup runs).
    // Pass B: soft-delete active skills that have NO directory in
    //         skills_path — genuine orphans with no on-disk footprint.
    //
    // Wrapped in BEGIN IMMEDIATE so Pass A and Pass B see a consistent
    // DB snapshot and a concurrent IPC call cannot race between them.
    // ════════════════════════════════════════════════════════════════════════
    conn.execute_batch("BEGIN IMMEDIATE")
        .map_err(|e| e.to_string())?;
    let phase1e_result: Result<Vec<String>, String> = (|| {
        let mut phase_notifs: Vec<String> = Vec::new();
        let skills_dir_1e = Path::new(skills_path);

        // Returns true if the skill has ANY directory in skills_path, checking
        // both the current nested layout and the legacy flat layout.
        //
        // Guard: skip the legacy flat check when name == DEFAULT_PLUGIN_SLUG
        // to avoid a false positive — skills_path/skills/ is the default
        // plugin directory itself, not a skill named "skills".
        let skill_dir_exists = |plugin_slug: &str, name: &str| -> bool {
            crate::skill_paths::resolve_existing_skill_dir(skills_dir_1e, plugin_slug, name)
                .exists()
        };

        // Pass A: hard-delete active skills (builder or imported) with no directory in skills_path.
        // Skip in-progress skill-builder skills — they don't have a skills_path dir until
        // the workflow completes and deploys SKILL.md.
        let all_active = crate::db::list_all_skills(conn)?;
        for skill in &all_active {
            if skill_dir_exists(&skill.plugin_slug, &skill.name) {
                continue;
            }
            if skill.skill_source == "skill-builder" {
                let run = crate::db::get_workflow_run(conn, &skill.name)?;
                let is_completed = run
                    .as_ref()
                    .map(|r| r.status == "completed")
                    .unwrap_or(false);
                if !is_completed {
                    continue;
                }
            }
            log::info!(
                "[reconcile] deleting '{}' in plugin '{}': no directory in skills_path",
                skill.name,
                skill.plugin_slug
            );
            if let Err(e) = conn.execute(
                "DELETE FROM skills WHERE id = ?1",
                rusqlite::params![skill.id],
            ) {
                log::warn!("[reconcile] failed to delete '{}': {}", skill.name, e);
            } else {
                phase_notifs.push(format!(
                    "'{}' removed — no directory found in skills_path",
                    skill.name
                ));
            }
        }
        Ok(phase_notifs)
    })();
    match phase1e_result {
        Ok(phase_notifs) => {
            conn.execute_batch("COMMIT").map_err(|e| e.to_string())?;
            notifications.extend(phase_notifs);
        }
        Err(e) => {
            let _ = conn.execute_batch("ROLLBACK");
            return Err(e);
        }
    }

    // ════════════════════════════════════════════════════════════════════════
    // Phase 1f: Dedup — remove stale skills rows created by a failed move
    //
    // A failed move (disk moved, DB update silently returned 0 rows) leaves
    // one row in the old plugin and a second row added by Phase 1c discovery.
    // Detect all skill names with more than one active row and keep only the
    // row whose plugin directory contains SKILL.md on disk.
    //
    // Tie-break: when SKILL.md exists in both plugins, prefer the non-default
    // plugin (the intended destination of the move).
    // ════════════════════════════════════════════════════════════════════════
    {
        // Find skill names that appear in multiple active rows.
        let mut dup_stmt = conn
            .prepare(
                "SELECT s.name
                 FROM skills s
                 WHERE COALESCE(s.deleted_at, '') = ''
                 GROUP BY s.name
                 HAVING COUNT(*) > 1",
            )
            .map_err(|e| e.to_string())?;
        let dup_names: Vec<String> = dup_stmt
            .query_map([], |r| r.get(0))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();

        for name in &dup_names {
            log::info!(
                "[reconcile] dedup: '{}' has multiple active rows — resolving using disk state",
                name
            );
            // Collect all (plugin_slug, plugin_id, is_default) rows for this name.
            let mut rows_stmt = conn
                .prepare(
                    "SELECT p.slug, p.id, p.is_default
                     FROM skills s
                     JOIN plugins p ON p.id = s.plugin_id
                     WHERE s.name = ?1 AND COALESCE(s.deleted_at, '') = ''",
                )
                .map_err(|e| e.to_string())?;
            let rows: Vec<(String, i64, bool)> = rows_stmt
                .query_map(rusqlite::params![name], |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, i64>(1)?,
                        r.get::<_, bool>(2)?,
                    ))
                })
                .map_err(|e| e.to_string())?
                .filter_map(|r| r.ok())
                .collect();

            // Determine which rows have SKILL.md on disk.
            let has_skill_md: Vec<bool> = rows
                .iter()
                .map(|(plugin_slug, _, _)| {
                    crate::skill_paths::resolve_skill_dir(skills_dir, plugin_slug, name)
                        .join("SKILL.md")
                        .is_file()
                })
                .collect();

            // Choose the row to keep:
            // 1. Any non-default plugin with SKILL.md on disk (preferred destination)
            // 2. Any plugin with SKILL.md on disk
            // 3. First row (fallback)
            let keep_idx = rows
                .iter()
                .enumerate()
                .find(|(i, (_, _, is_default))| has_skill_md[*i] && !is_default)
                .or_else(|| rows.iter().enumerate().find(|(i, _)| has_skill_md[*i]))
                .map(|(i, _)| i)
                .unwrap_or(0);

            for (i, (_slug, plugin_id, _)) in rows.iter().enumerate() {
                if i == keep_idx {
                    continue;
                }
                log::info!(
                    "[reconcile] dedup: '{}' removing stale row in plugin '{}' (keeping '{}')",
                    name,
                    rows[i].0,
                    rows[keep_idx].0
                );
                if let Err(e) = conn.execute(
                    "DELETE FROM skills WHERE name = ?1 AND plugin_id = ?2",
                    rusqlite::params![name, plugin_id],
                ) {
                    log::warn!(
                        "[reconcile] dedup: failed to delete stale row for '{}' in plugin '{}': {}",
                        name,
                        rows[i].0,
                        e
                    );
                } else {
                    notifications.push(format!(
                        "'{}': removed stale duplicate row in plugin '{}' (kept in '{}')",
                        name, rows[i].0, rows[keep_idx].0
                    ));
                }
            }
        }
    }

    // ════════════════════════════════════════════════════════════════════════
    // Phase 2: Workflow recon (incomplete skills only)
    // ════════════════════════════════════════════════════════════════════════

    let all_skills = crate::db::list_all_skills(conn)?;
    log::info!(
        "[reconcile] phase 2: workflow recon for {} skills, workspace={} skills_path={}",
        all_skills.len(),
        workspace_path,
        skills_path
    );

    for skill in &all_skills {
        if skill.skill_source != "skill-builder" {
            continue;
        }

        // Only reconcile incomplete skills — completed skills were handled in Phase 1
        let maybe_run = crate::db::get_workflow_run(conn, &skill.name)?;
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
