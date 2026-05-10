use crate::db::Db;
use std::fs;
use std::path::Path;

const WORKSPACE_PARENT: &str = ".vibedata";
const WORKSPACE_SUBDIR: &str = "workspace";
const OPENHANDS_SUBDIR: &str = "openhands";

/// Resolve the app-local OpenHands conversations directory.
/// Shape: `{app_data_root}/openhands/conversations/`
pub fn resolve_openhands_conversations_dir(app_data_root: &Path) -> std::path::PathBuf {
    app_data_root.join(OPENHANDS_SUBDIR).join("conversations")
}

/// One-time: move logs/conversations/bash_events from workspace/.openhands/ to openhands/,
/// then remove the legacy workspace/ wrapper.
/// Preserves in-flight conversation directories so DB conversation IDs remain valid.
fn migrate_flatten_openhands_dir(app_data_root: &Path) {
    let old_openhands = app_data_root.join(WORKSPACE_SUBDIR).join(".openhands");
    let new_openhands = app_data_root.join(OPENHANDS_SUBDIR);

    if !old_openhands.exists() {
        return;
    }

    // Move each known subdirectory: logs/, conversations/, bash_events/
    for subdir in &["logs", "conversations", "bash_events"] {
        let src = old_openhands.join(subdir);
        if src.exists() {
            let dst = new_openhands.join(subdir);
            if !dst.exists() {
                if let Err(e) = fs::rename(&src, &dst) {
                    log::warn!("[migrate] failed to move {} → {}: {}", src.display(), dst.display(), e);
                } else {
                    log::info!("[migrate] moved {} → {}", src.display(), dst.display());
                }
            }
        }
    }

    // Remove the old workspace/ wrapper after moving
    let old_workspace = app_data_root.join(WORKSPACE_SUBDIR);
    if let Err(e) = fs::remove_dir_all(&old_workspace) {
        log::warn!("[migrate] failed to remove legacy workspace dir {}: {}", old_workspace.display(), e);
    } else {
        log::info!("[migrate] removed legacy workspace dir {}", old_workspace.display());
    }
}

/// Iterate over immediate subdirectories of `dir`, skipping hidden (dotfile)
/// entries. Returns an empty iterator if `dir` cannot be read.
fn non_hidden_subdirs(dir: &Path) -> impl Iterator<Item = std::path::PathBuf> {
    fs::read_dir(dir)
        .ok()
        .into_iter()
        .flatten()
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            path.is_dir()
                && path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .is_some_and(|s| !s.starts_with('.'))
        })
}

/// Resolve the workspace path from the shared app-local data directory.
fn resolve_workspace_path(data_dir: &Path) -> Result<String, String> {
    let workspace = data_dir.join(WORKSPACE_SUBDIR);
    workspace
        .to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "Data directory path contains invalid UTF-8".to_string())
}

/// Best-effort cleanup for legacy `~/.vibedata` folder from pre-DataDir builds.
/// Non-fatal by design: startup must continue even if cleanup fails.
fn cleanup_legacy_vibedata(home: &Path) {
    let legacy_root = home.join(WORKSPACE_PARENT);
    if !legacy_root.exists() {
        return;
    }
    match fs::remove_dir_all(&legacy_root) {
        Ok(()) => log::info!(
            "[init_workspace] removed legacy path {}",
            legacy_root.display()
        ),
        Err(e) => log::warn!(
            "[init_workspace] failed to remove legacy path {}: {}",
            legacy_root.display(),
            e
        ),
    }
}

/// Migrate stale workspace layout artifacts after reorganization.
/// Safe to call on every startup — only removes files that exist.
fn migrate_workspace_layout(workspace_path: &str) {
    let base = Path::new(workspace_path);
    let claude_md = base.join("CLAUDE.md");
    if claude_md.is_file() {
        let _ = fs::remove_file(&claude_md);
    }
    let legacy_claude_dir = base.join(".claude");
    if legacy_claude_dir.is_dir() {
        let _ = fs::remove_dir_all(&legacy_claude_dir);
    }
    // Remove stale root-level infrastructure from pre-reorganization layout
    for name in &["agents", "references"] {
        let path = base.join(name);
        if path.is_dir() {
            let _ = fs::remove_dir_all(&path);
        }
    }
    // Remove dead database artifact
    let db_file = base.join("vibedata.db");
    if db_file.is_file() {
        let _ = fs::remove_file(&db_file);
    }

    // VU-1157 aftermath: remove stale per-skill JSON artifacts that were
    // written before context data moved to SQLite, and clean up the dead
    // logs/ dirs created by the removed create_openhands_persistence_dir
    // function (per-run dirs were never written to).
    // Walk legacy and canonical workspace layouts:
    // - legacy plugin layout: {workspace}/{plugin}/{skill}/
    // - canonical layout:     {workspace}/{plugin}/skills/{skill}/
    let Ok(plugin_entries) = fs::read_dir(base) else {
        return;
    };
    for plugin_entry in plugin_entries.flatten() {
        let plugin_path = plugin_entry.path();
        if !plugin_path.is_dir() {
            continue;
        }
        let mut candidate_roots = vec![plugin_path.clone()];
        let canonical_skills_dir = plugin_path.join("skills");
        if canonical_skills_dir.is_dir() {
            candidate_roots.push(canonical_skills_dir);
        }
        for candidate_root in candidate_roots {
            let Ok(skill_entries) = fs::read_dir(&candidate_root) else {
                continue;
            };
            for skill_entry in skill_entries.flatten() {
                let skill_dir = skill_entry.path();
                if !skill_dir.is_dir() {
                    continue;
                }
                // Skip the canonical container dir itself when walking the legacy root.
                if skill_dir.file_name().and_then(|n| n.to_str()) == Some("skills") {
                    continue;
                }
                // Remove stale VU-1157 context files.
                for name in &[
                    "context/clarifications.json",
                    "context/decisions.json",
                    "context/benchmark-meta.json",
                    "user-context.md",
                    "answer-evaluation.json",
                    "gate-result.json",
                ] {
                    let _ = fs::remove_file(skill_dir.join(name));
                }
                // Remove context/ dir only if now empty.
                let _ = fs::remove_dir(skill_dir.join("context"));
                // Remove empty per-run dirs under logs/, then logs/ itself.
                let logs_dir = skill_dir.join("logs");
                if logs_dir.is_dir() {
                    if let Ok(run_entries) = fs::read_dir(&logs_dir) {
                        for run_entry in run_entries.flatten() {
                            let _ = fs::remove_dir(run_entry.path());
                        }
                    }
                    let _ = fs::remove_dir(&logs_dir);
                }
            }
        }
    }
}

// migrate_context_from_skills_path and move_context_files were removed in VU-1157.
// Context files (clarifications, decisions, user-context) now live in SQLite.
// The workspace is runtime scratch only: .agents/, logs/, tmp/.

/// Remove stale `skill-snapshot` directories left by prior benchmark runs
/// that were interrupted by crash, cancellation, or error.
/// Non-fatal by design: startup must continue even if cleanup fails.
///
/// Scans two levels deep to cover both the legacy flat workspace layout
/// (`{workspace}/{skill}/skill-snapshot/`) and the current plugin layout
/// (`{workspace}/{plugin}/{skill}/skill-snapshot/`).
fn cleanup_stale_snapshots(workspace_path: &str) {
    let base = Path::new(workspace_path);
    let Ok(entries) = fs::read_dir(base) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        // Legacy flat layout: {workspace}/{skill}/skill-snapshot/
        let snapshot_dir = path.join("skill-snapshot");
        if snapshot_dir.is_dir() {
            match fs::remove_dir_all(&snapshot_dir) {
                Ok(()) => log::info!(
                    "[init_workspace] cleaned up stale snapshot at {}",
                    snapshot_dir.display()
                ),
                Err(e) => log::warn!(
                    "[init_workspace] failed to clean up stale snapshot at {}: {}",
                    snapshot_dir.display(),
                    e
                ),
            }
        }
        // Plugin layout: {workspace}/{plugin}/{skill}/skill-snapshot/
        // Canonical layout: {workspace}/{plugin}/skills/{skill}/skill-snapshot/
        let Ok(children) = fs::read_dir(&path) else {
            continue;
        };
        for child in children.flatten() {
            let child_path = child.path();
            if !child_path.is_dir() {
                continue;
            }
            if child_path.file_name().and_then(|n| n.to_str()) == Some("skills") {
                if let Ok(skill_entries) = fs::read_dir(&child_path) {
                    for skill_entry in skill_entries.flatten() {
                        let skill_path = skill_entry.path();
                        if !skill_path.is_dir() {
                            continue;
                        }
                        let snapshot_dir = skill_path.join("skill-snapshot");
                        if snapshot_dir.is_dir() {
                            match fs::remove_dir_all(&snapshot_dir) {
                                Ok(()) => log::info!(
                                    "[init_workspace] cleaned up stale snapshot at {}",
                                    snapshot_dir.display()
                                ),
                                Err(e) => log::warn!(
                                    "[init_workspace] failed to clean up stale snapshot at {}: {}",
                                    snapshot_dir.display(),
                                    e
                                ),
                            }
                        }
                    }
                }
                continue;
            }
            let snapshot_dir = child_path.join("skill-snapshot");
            if snapshot_dir.is_dir() {
                match fs::remove_dir_all(&snapshot_dir) {
                    Ok(()) => log::info!(
                        "[init_workspace] cleaned up stale snapshot at {}",
                        snapshot_dir.display()
                    ),
                    Err(e) => log::warn!(
                        "[init_workspace] failed to clean up stale snapshot at {}: {}",
                        snapshot_dir.display(),
                        e
                    ),
                }
            }
        }
    }
}

/// Migrate skills from legacy flat layout (`{name}/`) to
/// the plugin layout (`{slug}/{name}/`).
///
/// Idempotent: if skills are already in `{slug}/{name}/` layout, the move is a no-op.
/// Non-fatal: logs warnings on failure, never crashes.
fn migrate_to_marketplace_layout(skills_path: &str) {
    let root = Path::new(skills_path);
    if !root.exists() {
        return;
    }

    // Discover skills using the legacy layout scanner
    let locations = match crate::skill_paths::enumerate_skill_locations_legacy(root) {
        Ok(locs) => locs,
        Err(e) => {
            log::warn!("[migrate_marketplace] legacy enumeration failed: {}", e);
            return;
        }
    };

    if locations.is_empty() {
        // Nothing to migrate — just write manifests
        if let Err(e) = crate::marketplace_manifest::write_marketplace_json(root) {
            log::warn!(
                "[migrate_marketplace] failed to write marketplace.json: {}",
                e
            );
        }
        return;
    }

    log::info!(
        "[migrate_marketplace] migrating {} skill(s) to plugin layout at {}",
        locations.len(),
        skills_path
    );

    // Collect old plugin directory paths for cleanup
    let mut old_plugin_dirs: std::collections::HashSet<std::path::PathBuf> =
        std::collections::HashSet::new();

    // Move each skill to the plugin layout using resolve_skill_dir
    // (default plugin: root/skills/{name}, others: root/{slug}/{name})
    for loc in &locations {
        let new_dir =
            crate::skill_paths::resolve_skill_dir(root, &loc.plugin_slug, &loc.skill_name);

        if new_dir.exists() {
            log::debug!(
                "[migrate_marketplace] {} already at target, skipping",
                loc.skill_name
            );
            continue;
        }

        if let Some(parent) = new_dir.parent() {
            if let Err(e) = fs::create_dir_all(parent) {
                log::warn!(
                    "[migrate_marketplace] mkdir failed for {}: {}",
                    parent.display(),
                    e
                );
                continue;
            }
        }

        // Track old parent dir for cleanup
        if !loc.is_default_plugin {
            old_plugin_dirs.insert(root.join(&loc.plugin_slug));
        }

        match fs::rename(&loc.dir, &new_dir) {
            Ok(()) => {
                log::info!(
                    "[migrate_marketplace] moved {} -> {}",
                    loc.dir.display(),
                    new_dir.display()
                );
            }
            Err(e) => {
                log::warn!(
                    "[migrate_marketplace] failed to move {} -> {}: {}",
                    loc.dir.display(),
                    new_dir.display(),
                    e
                );
            }
        }
    }

    // Clean up empty old plugin directories at root
    for old_dir in &old_plugin_dirs {
        if !old_dir.exists() {
            continue;
        }
        let is_empty = fs::read_dir(old_dir)
            .map(|mut d| d.next().is_none())
            .unwrap_or(false);
        if is_empty {
            if let Err(e) = fs::remove_dir(old_dir) {
                log::warn!(
                    "[migrate_marketplace] failed to remove empty dir {}: {}",
                    old_dir.display(),
                    e
                );
            }
        }
    }

    // Write manifests
    if let Err(e) = crate::marketplace_manifest::regenerate_all_manifests(root) {
        log::warn!("[migrate_marketplace] manifest write failed: {}", e);
    }

    // Git commit the reorganization
    match crate::git::commit_all(root, "migrate to marketplace plugin layout") {
        Ok(_) => log::info!("[migrate_marketplace] committed layout migration"),
        Err(e) => log::warn!("[migrate_marketplace] git commit failed: {}", e),
    }
}

/// Migrate from a shared root git repo to per-skill git repositories.
///
/// If `{skills_path}/.git/` exists (legacy shared repo), this function:
/// 1. Enumerates all skill directories in legacy or canonical plugin layouts.
/// 2. Inits a per-skill repo for each that doesn't already have one.
/// 3. Commits current files as `"initial commit"` in each new per-skill repo.
/// 4. Removes `{skills_path}/.git/`.
///
/// Non-fatal: logs warnings on failure, never crashes.
pub(super) fn migrate_to_per_skill_repos(skills_path: &Path) {
    if !skills_path.join(".git").exists() {
        return;
    }
    log::info!(
        "[migrate_to_per_skill_repos] shared repo detected at {}; migrating to per-skill repos",
        skills_path.display()
    );

    for plugin_dir in non_hidden_subdirs(skills_path) {
        let canonical_skills_dir = plugin_dir.join("skills");
        let skill_roots = if canonical_skills_dir.is_dir() {
            vec![canonical_skills_dir]
        } else {
            vec![plugin_dir.clone()]
        };
        for skill_root in skill_roots {
            for skill_dir in non_hidden_subdirs(&skill_root) {
                if skill_dir.join(".git").exists() {
                    log::debug!(
                        "[migrate_to_per_skill_repos] {} already has .git, skipping",
                        skill_dir.display()
                    );
                    continue;
                }
                if let Err(e) = crate::git::ensure_repo(&skill_dir) {
                    log::warn!(
                        "[migrate_to_per_skill_repos] failed to init repo at {}: {}",
                        skill_dir.display(),
                        e
                    );
                    continue;
                }
                match crate::git::commit_all(&skill_dir, "initial commit") {
                    Ok(_) => log::info!(
                        "[migrate_to_per_skill_repos] initialized repo at {}",
                        skill_dir.display()
                    ),
                    Err(e) => log::warn!(
                        "[migrate_to_per_skill_repos] commit failed at {}: {}",
                        skill_dir.display(),
                        e
                    ),
                }
            }
        }
    }

    let shared_git = skills_path.join(".git");
    if let Err(e) = std::fs::remove_dir_all(&shared_git) {
        log::warn!(
            "[migrate_to_per_skill_repos] failed to remove shared .git: {}",
            e
        );
    } else {
        log::info!("[migrate_to_per_skill_repos] removed shared root .git/");
    }
}

/// Initialize the workspace directory on app startup.
/// Creates `<data_dir>/workspace` if it doesn't exist, updates settings,
/// removes legacy Claude-era workspace artifacts, and deploys bundled agents
/// to `.agents/`.
pub fn init_workspace(
    app: &tauri::AppHandle,
    db: &tauri::State<'_, Db>,
    data_dir: &Path,
) -> Result<String, String> {
    // Best-effort cleanup of pre-DataDir legacy folder.
    if let Some(home) = dirs::home_dir() {
        cleanup_legacy_vibedata(&home);
    }

    let workspace_path = resolve_workspace_path(data_dir)?;

    // Create directory if it doesn't exist
    fs::create_dir_all(&workspace_path)
        .map_err(|e| format!("Failed to create workspace directory: {}", e))?;

    // Update settings with the workspace path
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut settings = crate::db::read_settings(&conn)?;
    if settings.workspace_path.as_deref() != Some(&workspace_path) {
        settings.workspace_path = Some(workspace_path.clone());
        crate::db::write_settings(&conn, &settings)?;
    }
    drop(conn);

    // One-time cleanup for legacy workspace layout before seeding current runtime files.
    migrate_workspace_layout(&workspace_path);

    // One-time: flatten app-local storage from workspace/.openhands/ to openhands/
    migrate_flatten_openhands_dir(data_dir);

    // Purge stale bundled workspace mirrors then seed current ones (filesystem-only, no DB).
    {
        let bundled_skills_dir = super::workflow::resolve_bundled_skills_dir(app);
        let protected_workspace_skill_names = {
            let conn = db.0.lock().map_err(|e| e.to_string())?;
            crate::db::list_all_skills(&conn)?
                .into_iter()
                .filter(|skill| skill.plugin_slug == crate::skill_paths::DEFAULT_PLUGIN_SLUG)
                .map(|skill| skill.name)
                .collect::<std::collections::HashSet<_>>()
        };
        if let Err(e) = super::imported_skills::purge_stale_bundled_skills(
            &workspace_path,
            &bundled_skills_dir,
            &protected_workspace_skill_names,
        ) {
            log::warn!("purge_stale_bundled_skills: failed: {}", e);
        }
        if let Err(e) =
            super::imported_skills::seed_bundled_skills(&workspace_path, &bundled_skills_dir)
        {
            log::warn!("seed_bundled_skills: failed: {}", e);
        }
    }

    // Deploy bundled workflow agents/skills to the OpenHands .agents layout.
    super::workflow::ensure_workspace_prompts_sync(app, &workspace_path)?;

    // Seed .agents/ into every existing skill's canonical directory.
    if let Ok(conn) = db.0.lock() {
        if let Ok(settings) = crate::db::read_settings(&conn) {
            if let Some(ref skills_path) = settings.skills_path {
                if let Ok(all_skills) = crate::db::list_all_skills(&conn) {
                    for skill in all_skills {
                        let skill_dir = crate::skill_paths::resolve_skill_dir(
                            std::path::Path::new(skills_path),
                            &skill.plugin_slug,
                            &skill.name,
                        );
                        if let Err(e) = crate::commands::workflow::deploy::seed_skill_agents_dir(
                            app,
                            &skill_dir,
                        ) {
                            log::warn!(
                                "[init_workspace] failed to seed .agents/ for skill {}/{}: {}",
                                skill.plugin_slug,
                                skill.name,
                                e
                            );
                        }
                    }
                }
            }
        }
    }

    // Remove stale benchmark snapshots left by interrupted runs
    cleanup_stale_snapshots(&workspace_path);

    // One-time migrations for the skills path
    {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        if let Ok(settings) = crate::db::read_settings(&conn) {
            if let Some(ref sp) = settings.skills_path {
                // Marketplace layout migration must run before per-skill repo migration.
                migrate_to_marketplace_layout(sp);
                // Per-skill repo migration: if shared root .git exists, move to per-skill repos.
                migrate_to_per_skill_repos(Path::new(sp));
            }
        }
    }

    Ok(workspace_path)
}

#[tauri::command]
pub fn get_workspace_path(db: tauri::State<'_, Db>) -> Result<String, String> {
    log::info!("[get_workspace_path]");
    let conn = db.0.lock().map_err(|e| {
        log::error!("[get_workspace_path] Failed to acquire DB lock: {}", e);
        e.to_string()
    })?;
    let settings = crate::db::read_settings(&conn)?;
    settings
        .workspace_path
        .ok_or_else(|| "Workspace path not initialized".to_string())
}

#[tauri::command]
pub fn clear_workspace(app: tauri::AppHandle, db: tauri::State<'_, Db>) -> Result<(), String> {
    log::info!("[clear_workspace]");
    let conn = db.0.lock().map_err(|e| {
        log::error!("[clear_workspace] Failed to acquire DB lock: {}", e);
        e.to_string()
    })?;
    let settings = crate::db::read_settings(&conn)?;
    let workspace_path = settings
        .workspace_path
        .ok_or_else(|| "Workspace path not initialized".to_string())?;
    drop(conn);

    // Remove legacy workspace artifacts if they still exist.
    migrate_workspace_layout(&workspace_path);

    // Invalidate the session cache so next workflow start re-checks
    super::workflow::invalidate_workspace_cache(&workspace_path);

    // Re-deploy only bundled OpenHands agents/skills under `.agents/`.
    super::workflow::redeploy_agents(&app, &workspace_path)?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_resolve_workspace_path() {
        let tmp = tempfile::tempdir().unwrap();
        let path = resolve_workspace_path(tmp.path()).unwrap();
        assert!(
            std::path::Path::new(&path).ends_with("workspace"),
            "expected path ending in workspace, got {}",
            path
        );
    }

    // --- cleanup_legacy_vibedata tests ---

    #[test]
    fn test_cleanup_legacy_vibedata_happy_path() {
        let home = tempfile::tempdir().unwrap();
        let old_root = home.path().join(".vibedata");
        fs::create_dir_all(&old_root).unwrap();
        fs::write(old_root.join("agents.md"), "content").unwrap();

        cleanup_legacy_vibedata(home.path());
        assert!(!old_root.exists(), "legacy root should be removed");
    }

    #[test]
    fn test_cleanup_legacy_vibedata_skips_if_absent() {
        let home = tempfile::tempdir().unwrap();

        cleanup_legacy_vibedata(home.path());
        assert!(
            !home.path().join(".vibedata").exists(),
            "absent legacy path should remain absent"
        );
    }

    // --- cleanup_stale_snapshots tests ---

    #[test]
    fn test_cleanup_stale_snapshots_removes_skill_snapshot_dirs() {
        let workspace = tempfile::tempdir().unwrap();
        let skill_a = workspace.path().join("skill-a");
        let skill_b = workspace.path().join("skill-b");

        // skill-a has a stale snapshot
        let snapshot_a = skill_a.join("skill-snapshot");
        fs::create_dir_all(snapshot_a.join("sub")).unwrap();
        fs::write(snapshot_a.join("sub/SKILL.md"), "old").unwrap();

        // skill-b has no snapshot
        fs::create_dir_all(&skill_b).unwrap();

        cleanup_stale_snapshots(workspace.path().to_str().unwrap());

        assert!(!snapshot_a.exists(), "stale snapshot should be removed");
        assert!(skill_a.exists(), "skill dir itself should remain");
        assert!(skill_b.exists(), "unrelated skill dir should remain");
    }

    #[test]
    fn test_cleanup_stale_snapshots_noop_when_no_snapshots() {
        let workspace = tempfile::tempdir().unwrap();
        let skill_dir = workspace
            .path()
            .join("default")
            .join("skills")
            .join("my-skill");
        fs::create_dir_all(skill_dir.join("references")).unwrap();

        cleanup_stale_snapshots(workspace.path().to_str().unwrap());

        assert!(
            skill_dir.join("references").exists(),
            "non-snapshot dirs should remain"
        );
    }

    // --- migrate_to_marketplace_layout tests ---

    #[test]
    fn test_migrate_marketplace_nested_skills_stay_in_place() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();

        // Create legacy nested layout: root/analytics/weekly-report/SKILL.md
        // This is already the canonical layout — migration should be a no-op.
        let skill = root.join("analytics").join("weekly-report");
        fs::create_dir_all(&skill).unwrap();
        fs::write(skill.join("SKILL.md"), "# weekly report").unwrap();
        fs::create_dir_all(skill.join("references")).unwrap();

        let _ = crate::git::ensure_repo(root);

        migrate_to_marketplace_layout(root.to_str().unwrap());

        let migrated = root.join("analytics").join("skills").join("weekly-report");
        assert!(
            migrated.join("SKILL.md").is_file(),
            "SKILL.md should be canonicalized"
        );
        assert!(
            migrated.join("references").is_dir(),
            "references/ should remain"
        );
        assert!(root.join("analytics").is_dir(), "plugin dir should exist");
    }

    #[test]
    fn test_migrate_marketplace_moves_legacy_flat_skills() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();

        // Create legacy flat layout: root/my-skill/SKILL.md
        let old_skill = root.join("my-skill");
        fs::create_dir_all(&old_skill).unwrap();
        fs::write(old_skill.join("SKILL.md"), "# my skill").unwrap();

        let _ = crate::git::ensure_repo(root);

        migrate_to_marketplace_layout(root.to_str().unwrap());

        // Skill should be at plugin path under default plugin
        let new_skill = root.join("default").join("skills").join("my-skill");
        assert!(new_skill.join("SKILL.md").is_file());
    }

    #[test]
    fn test_migrate_marketplace_idempotent() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();

        // Create canonical layout directly: root/analytics/skills/report/SKILL.md
        let skill = root.join("analytics").join("skills").join("report");
        fs::create_dir_all(&skill).unwrap();
        fs::write(skill.join("SKILL.md"), "# report").unwrap();

        let _ = crate::git::ensure_repo(root);

        // Run migration twice — should not crash or move anything
        migrate_to_marketplace_layout(root.to_str().unwrap());
        migrate_to_marketplace_layout(root.to_str().unwrap());

        // Skill should still be at the same place
        assert!(skill.join("SKILL.md").is_file());
    }

    #[test]
    fn test_migrate_marketplace_empty_dir() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();

        let _ = crate::git::ensure_repo(root);

        migrate_to_marketplace_layout(root.to_str().unwrap());

        // Should create marketplace.json even with no skills
        assert!(root
            .join(".claude-plugin")
            .join("marketplace.json")
            .is_file());
    }

    #[test]
    fn test_migrate_marketplace_mixed_flat_and_nested() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();

        // Legacy flat: root/my-skill/SKILL.md
        let flat = root.join("my-skill");
        fs::create_dir_all(&flat).unwrap();
        fs::write(flat.join("SKILL.md"), "# flat").unwrap();

        // Legacy nested: root/analytics/report/SKILL.md
        let nested = root.join("analytics").join("report");
        fs::create_dir_all(&nested).unwrap();
        fs::write(nested.join("SKILL.md"), "# nested").unwrap();

        let _ = crate::git::ensure_repo(root);
        migrate_to_marketplace_layout(root.to_str().unwrap());

        // Flat skill should be under default plugin canonical layout
        let default_slug = crate::skill_paths::DEFAULT_PLUGIN_SLUG;
        assert!(root
            .join(default_slug)
            .join("skills")
            .join("my-skill")
            .join("SKILL.md")
            .is_file());

        // Nested skill should be canonicalized under its plugin.
        assert!(root
            .join("analytics")
            .join("skills")
            .join("report")
            .join("SKILL.md")
            .is_file());

        // Both should be discoverable
        let locations = crate::skill_paths::enumerate_skill_locations(root).unwrap();
        assert_eq!(locations.len(), 2);
    }

    // --- migrate_workspace_layout stale-artifact cleanup tests ---

    #[test]
    fn test_migrate_workspace_layout_cleans_stale_files() {
        let workspace = tempfile::tempdir().unwrap();
        let skill_dir = workspace
            .path()
            .join("some-plugin")
            .join("skills")
            .join("some-skill");

        // Write stale VU-1157 context files.
        fs::create_dir_all(skill_dir.join("context")).unwrap();
        fs::write(skill_dir.join("context/clarifications.json"), "{}").unwrap();
        fs::write(skill_dir.join("context/decisions.json"), "{}").unwrap();
        fs::write(skill_dir.join("user-context.md"), "# ctx").unwrap();
        fs::write(skill_dir.join("answer-evaluation.json"), "{}").unwrap();
        fs::write(skill_dir.join("gate-result.json"), "{}").unwrap();

        // Write an unrelated file inside context/ — should survive.
        fs::write(skill_dir.join("context/something-else.txt"), "keep me").unwrap();

        // Create an empty logs/ dir (simulating dead persistence dirs).
        fs::create_dir_all(skill_dir.join("logs")).unwrap();

        migrate_workspace_layout(workspace.path().to_str().unwrap());

        // Stale files must be gone.
        assert!(
            !skill_dir.join("context/clarifications.json").exists(),
            "clarifications.json should be removed"
        );
        assert!(
            !skill_dir.join("context/decisions.json").exists(),
            "decisions.json should be removed"
        );
        assert!(
            !skill_dir.join("user-context.md").exists(),
            "user-context.md should be removed"
        );
        assert!(
            !skill_dir.join("answer-evaluation.json").exists(),
            "answer-evaluation.json should be removed"
        );
        assert!(
            !skill_dir.join("gate-result.json").exists(),
            "gate-result.json should be removed"
        );

        // context/ dir must survive because something-else.txt is still inside.
        assert!(
            skill_dir.join("context").is_dir(),
            "context/ must survive when it still has other content"
        );
        assert!(
            skill_dir.join("context/something-else.txt").exists(),
            "unrelated file in context/ must survive"
        );

        // Empty logs/ dir must be removed.
        assert!(
            !skill_dir.join("logs").exists(),
            "empty logs/ dir should be removed"
        );
    }

    #[test]
    fn test_migrate_workspace_layout_removes_context_dir_when_empty() {
        let workspace = tempfile::tempdir().unwrap();
        let skill_dir = workspace
            .path()
            .join("some-plugin")
            .join("skills")
            .join("some-skill");

        fs::create_dir_all(skill_dir.join("context")).unwrap();
        fs::write(skill_dir.join("context/clarifications.json"), "{}").unwrap();

        migrate_workspace_layout(workspace.path().to_str().unwrap());

        assert!(
            !skill_dir.join("context").exists(),
            "context/ dir should be removed when empty after stale file deletion"
        );
    }

    #[test]
    fn test_migrate_workspace_layout_removes_empty_log_run_dirs() {
        let workspace = tempfile::tempdir().unwrap();
        let skill_dir = workspace
            .path()
            .join("some-plugin")
            .join("skills")
            .join("some-skill");

        // Simulate dead per-run log dirs.
        fs::create_dir_all(skill_dir.join("logs/agent-xyz-2024-01-01T00-00-00")).unwrap();
        fs::create_dir_all(skill_dir.join("logs/agent-abc-2024-01-02T00-00-00")).unwrap();

        migrate_workspace_layout(workspace.path().to_str().unwrap());

        assert!(
            !skill_dir.join("logs").exists(),
            "logs/ dir should be removed after emptying per-run subdirs"
        );
    }

    #[test]
    fn test_migrate_workspace_layout_preserves_nonempty_log_run_dirs() {
        let workspace = tempfile::tempdir().unwrap();
        let skill_dir = workspace
            .path()
            .join("some-plugin")
            .join("skills")
            .join("some-skill");

        // A per-run dir with content should survive — remove_dir is non-recursive.
        let run_dir = skill_dir.join("logs/agent-xyz-2024-01-01T00-00-00");
        fs::create_dir_all(&run_dir).unwrap();
        fs::write(run_dir.join("run.jsonl"), "{}").unwrap();

        migrate_workspace_layout(workspace.path().to_str().unwrap());

        assert!(
            run_dir.exists(),
            "non-empty per-run log dir should survive migration"
        );
        assert!(
            skill_dir.join("logs").exists(),
            "logs/ parent should survive when a run dir has content"
        );
    }

    #[test]
    fn test_migrate_workspace_layout_removes_claude_workspace_artifacts() {
        let workspace = tempfile::tempdir().unwrap();

        fs::write(workspace.path().join("CLAUDE.md"), "# legacy").unwrap();
        fs::create_dir_all(workspace.path().join(".claude/skills/legacy-skill")).unwrap();
        fs::write(
            workspace
                .path()
                .join(".claude/skills/legacy-skill/SKILL.md"),
            "# legacy skill",
        )
        .unwrap();
        fs::create_dir_all(workspace.path().join(".claude/agents")).unwrap();
        fs::write(
            workspace.path().join(".claude/agents/skill-creator.md"),
            "# legacy agent",
        )
        .unwrap();
        fs::create_dir_all(workspace.path().join(".agents/agents")).unwrap();
        fs::write(
            workspace.path().join(".agents/agents/skill-creator.md"),
            "# current agent",
        )
        .unwrap();

        migrate_workspace_layout(workspace.path().to_str().unwrap());

        assert!(
            !workspace.path().join("CLAUDE.md").exists(),
            "workspace CLAUDE.md should be removed during migration"
        );
        assert!(
            !workspace.path().join(".claude").exists(),
            "legacy workspace .claude directory should be removed during migration"
        );
        assert!(
            workspace
                .path()
                .join(".agents/agents/skill-creator.md")
                .is_file(),
            "OpenHands .agents layout must be preserved"
        );
    }

    #[test]
    fn test_migrate_marketplace_nested_already_canonical() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();

        // Nested: root/analytics/skills/report/SKILL.md — already at canonical path
        let skill = root.join("analytics").join("skills").join("report");
        fs::create_dir_all(&skill).unwrap();
        fs::write(skill.join("SKILL.md"), "# report").unwrap();

        let _ = crate::git::ensure_repo(root);
        migrate_to_marketplace_layout(root.to_str().unwrap());

        // Skill stays in place — already at canonical path
        assert!(skill.join("SKILL.md").is_file());
        assert!(root.join("analytics").is_dir());
    }
}

#[cfg(test)]
mod migration_tests {
    use tempfile::tempdir;

    fn setup_shared_repo(skills_path: &std::path::Path) {
        crate::git::ensure_repo(skills_path).unwrap();
        let skill_dir = skills_path.join("default").join("skills").join("my-skill");
        std::fs::create_dir_all(&skill_dir).unwrap();
        std::fs::write(skill_dir.join("SKILL.md"), "# My skill").unwrap();
        crate::git::commit_all(skills_path, "my-skill: initial").unwrap();
    }

    #[test]
    fn test_migrate_to_per_skill_repos_removes_shared_git() {
        let dir = tempdir().unwrap();
        let skills_path = dir.path();
        setup_shared_repo(skills_path);

        assert!(
            skills_path.join(".git").exists(),
            "pre: shared .git must exist"
        );

        super::migrate_to_per_skill_repos(skills_path);

        assert!(
            !skills_path.join(".git").exists(),
            "shared .git must be removed after migration"
        );
    }

    #[test]
    fn test_migrate_to_per_skill_repos_inits_per_skill_git() {
        let dir = tempdir().unwrap();
        let skills_path = dir.path();
        setup_shared_repo(skills_path);

        super::migrate_to_per_skill_repos(skills_path);

        let skill_dir = skills_path.join("default").join("skills").join("my-skill");
        assert!(
            skill_dir.join(".git").exists(),
            "per-skill .git must exist after migration"
        );
    }

    #[test]
    fn test_migrate_to_per_skill_repos_is_noop_without_shared_git() {
        let dir = tempdir().unwrap();
        let skills_path = dir.path();
        std::fs::create_dir_all(skills_path.join("default").join("skills").join("my-skill"))
            .unwrap();

        // No .git at root — should be a no-op, no panic
        super::migrate_to_per_skill_repos(skills_path);

        assert!(!skills_path.join(".git").exists());
    }

    #[test]
    fn test_migrate_to_per_skill_repos_skips_already_migrated_skill_dir() {
        // A skill_dir that already has .git/ must not be re-initialized or disturbed.
        let dir = tempdir().unwrap();
        let skills_path = dir.path();
        // Shared root .git exists (triggers migration)
        crate::git::ensure_repo(skills_path).unwrap();
        let skill_dir = skills_path.join("default").join("skills").join("my-skill");
        std::fs::create_dir_all(&skill_dir).unwrap();
        // Pre-create a per-skill repo with one commit
        crate::git::ensure_repo(&skill_dir).unwrap();
        std::fs::write(skill_dir.join("SKILL.md"), "# Pre-existing").unwrap();
        let original_sha = crate::git::commit_all(&skill_dir, "pre-existing")
            .unwrap()
            .unwrap();

        super::migrate_to_per_skill_repos(skills_path);

        // Per-skill repo must still have exactly the same HEAD commit (not reinit'd)
        let repo = git2::Repository::open(&skill_dir).unwrap();
        let head_sha = repo
            .head()
            .unwrap()
            .peel_to_commit()
            .unwrap()
            .id()
            .to_string();
        assert_eq!(
            head_sha, original_sha,
            "existing per-skill repo must not be disturbed by migration"
        );
        assert!(
            !skills_path.join(".git").exists(),
            "shared .git must still be removed"
        );
    }
}
