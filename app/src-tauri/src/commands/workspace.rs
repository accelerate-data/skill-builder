use crate::db::Db;
use std::fs;
use std::path::Path;

const WORKSPACE_PARENT: &str = ".vibedata";
const WORKSPACE_SUBDIR: &str = "workspace";

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
    // Remove stale nested CLAUDE.md if both files exist.
    // Legacy Claude instructions now live at workspace/CLAUDE.md.
    let root_claude_md = base.join("CLAUDE.md");
    let nested_claude_md = base.join(".claude").join("CLAUDE.md");
    if root_claude_md.is_file() && nested_claude_md.is_file() {
        let _ = fs::remove_file(&nested_claude_md);
    }
}

/// Move context files from `skills_path` into `workspace`.
///
/// Handles both the legacy flat layout and the current plugin layout:
///
/// - Legacy flat:  `{skills_path}/{skill}/context/`
///   → `{workspace}/{DEFAULT_PLUGIN_SLUG}/{skill}/context/`
///
/// - Plugin layout: `{skills_path}/{plugin}/{skill}/context/`
///   → `{workspace}/{plugin}/{skill}/context/`
///
/// Idempotent: skips any target context dir that already has content.
fn migrate_context_from_skills_path(workspace_path: &str, skills_path: &str) {
    let skills_root = Path::new(skills_path);
    if !skills_root.is_dir() {
        return;
    }

    let entries = match fs::read_dir(skills_root) {
        Ok(entries) => entries,
        Err(e) => {
            log::warn!(
                "[init_workspace] failed to read skills_path for context migration {}: {}",
                skills_root.display(),
                e
            );
            return;
        }
    };

    for entry in entries.flatten() {
        let file_name = entry.file_name();
        let dir_name = file_name.to_string_lossy();
        if dir_name.starts_with('.') {
            continue;
        }
        let dir_path = entry.path();
        if !dir_path.is_dir() {
            continue;
        }

        // Plugin layout: scan {plugin}/{skill}/context/
        let mut found_child = false;
        if let Ok(skill_entries) = fs::read_dir(&dir_path) {
            let plugin_slug = dir_name.as_ref();
            for skill_entry in skill_entries.flatten() {
                let skill_name = skill_entry.file_name();
                let skill_name_str = skill_name.to_string_lossy();
                if skill_name_str.starts_with('.') {
                    continue;
                }
                let skill_dir = skill_entry.path();
                if !skill_dir.is_dir() {
                    continue;
                }
                let legacy_context = skill_dir.join("context");
                if !legacy_context.is_dir() {
                    continue;
                }
                let target_context = Path::new(workspace_path)
                    .join(plugin_slug)
                    .join(skill_name_str.as_ref())
                    .join("context");
                move_context_files(&legacy_context, &target_context);
                found_child = true;
            }
        }
        if !found_child {
            // Legacy flat layout: {skill}/context/ — flat skills belonged to the default plugin
            let legacy_context = dir_path.join("context");
            if !legacy_context.is_dir() {
                continue;
            }
            let target_context = Path::new(workspace_path)
                .join(crate::skill_paths::DEFAULT_PLUGIN_SLUG)
                .join(dir_name.as_ref())
                .join("context");
            move_context_files(&legacy_context, &target_context);
        }
    }
}

/// Move files from `legacy_context` into `target_context`.
/// Creates `target_context` if needed. Skips if target already has content.
fn move_context_files(legacy_context: &Path, target_context: &Path) {
    if let Err(e) = fs::create_dir_all(target_context) {
        log::warn!(
            "[init_workspace] failed to create workspace context dir {}: {}",
            target_context.display(),
            e
        );
        return;
    }

    let target_has_content = fs::read_dir(target_context)
        .map(|mut d| d.next().is_some())
        .unwrap_or(false);
    if target_has_content {
        return;
    }

    let legacy_entries = match fs::read_dir(legacy_context) {
        Ok(entries) => entries,
        Err(e) => {
            log::warn!(
                "[init_workspace] failed to read legacy context dir {}: {}",
                legacy_context.display(),
                e
            );
            return;
        }
    };

    for legacy_entry in legacy_entries.flatten() {
        let src = legacy_entry.path();
        let dst = target_context.join(legacy_entry.file_name());
        if dst.exists() {
            continue;
        }
        if let Err(rename_err) = fs::rename(&src, &dst) {
            if src.is_file() {
                if let Err(copy_err) = fs::copy(&src, &dst) {
                    log::warn!(
                        "[init_workspace] failed to migrate context file {} -> {}: {} ({})",
                        src.display(),
                        dst.display(),
                        rename_err,
                        copy_err
                    );
                    continue;
                }
                let _ = fs::remove_file(&src);
            } else {
                log::warn!(
                    "[init_workspace] failed to migrate context entry {} -> {}: {}",
                    src.display(),
                    dst.display(),
                    rename_err
                );
            }
        }
    }

    let legacy_empty = fs::read_dir(legacy_context)
        .map(|mut d| d.next().is_none())
        .unwrap_or(false);
    if legacy_empty {
        let _ = fs::remove_dir(legacy_context);
    }
}

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
        let Ok(children) = fs::read_dir(&path) else {
            continue;
        };
        for child in children.flatten() {
            let child_path = child.path();
            if !child_path.is_dir() {
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

/// Initialize the workspace directory on app startup.
/// Creates `<data_dir>/workspace` if it doesn't exist, updates settings,
/// and deploys bundled agents to `.claude/`.
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

    // Deploy bundled agents to .claude/
    super::workflow::ensure_workspace_prompts_sync(app, &workspace_path)?;

    // Purge stale bundled skills then seed current ones (filesystem-only, no DB)
    {
        let bundled_skills_dir = super::workflow::resolve_bundled_skills_dir(app);
        if let Err(e) =
            super::imported_skills::purge_stale_bundled_skills(&workspace_path, &bundled_skills_dir)
        {
            log::warn!("purge_stale_bundled_skills: failed: {}", e);
        }
        if let Err(e) =
            super::imported_skills::seed_bundled_skills(&workspace_path, &bundled_skills_dir)
        {
            log::warn!("seed_bundled_skills: failed: {}", e);
        }
    }

    // Rebuild CLAUDE.md: base template + imported skills from DB + user customization
    {
        let _conn = db.0.lock().map_err(|e| e.to_string())?;
        let (_, claude_md_src) = super::workflow::resolve_prompt_source_dirs_public(app);
        if claude_md_src.is_file() {
            if let Err(e) = super::workflow::rebuild_claude_md(&claude_md_src, &workspace_path) {
                log::warn!("Failed to rebuild CLAUDE.md on startup: {}", e);
            }
        } else {
            log::warn!("Bundled CLAUDE.md not found; skipping rebuild");
        }
    }

    // Clean up stale root-level files from pre-reorganization layout
    migrate_workspace_layout(&workspace_path);

    // Remove stale benchmark snapshots left by interrupted runs
    cleanup_stale_snapshots(&workspace_path);

    // One-time git upgrade: if skills_path has content but no .git, init + snapshot
    {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        if let Ok(settings) = crate::db::read_settings(&conn) {
            if let Some(ref sp) = settings.skills_path {
                migrate_context_from_skills_path(&workspace_path, sp);
                let sp_path = Path::new(sp);
                if sp_path.exists() && !sp_path.join(".git").exists() {
                    log::info!("One-time git upgrade: initializing repo at {}", sp);
                    if let Err(e) = crate::git::ensure_repo(sp_path) {
                        log::warn!("Failed to init git repo at {}: {}", sp, e);
                    } else if let Err(e) =
                        crate::git::commit_all(sp_path, "initial snapshot of existing skills")
                    {
                        log::warn!("Failed to create initial snapshot at {}: {}", sp, e);
                    }
                }
                // Migrate skills folder to marketplace plugin layout
                migrate_to_marketplace_layout(sp);
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

    // Delete only .claude/agents/ — preserve skills/ and CLAUDE.md.
    // Managed plugins are refreshed by redeploy_agents() and unmanaged plugins are preserved.
    let agents_dir = Path::new(&workspace_path).join(".claude").join("agents");
    if agents_dir.is_dir() {
        fs::remove_dir_all(&agents_dir).map_err(|e| e.to_string())?;
    }

    // Invalidate the session cache so next workflow start re-checks
    super::workflow::invalidate_workspace_cache(&workspace_path);

    // Re-deploy only bundled agents (not CLAUDE.md or skills)
    super::workflow::redeploy_agents(&app, &workspace_path)?;

    // Rebuild CLAUDE.md: base template + imported skills from DB + user customization
    {
        let _conn = db.0.lock().map_err(|e| e.to_string())?;
        let (_, claude_md_src) = super::workflow::resolve_prompt_source_dirs_public(&app);
        if claude_md_src.is_file() {
            if let Err(e) = super::workflow::rebuild_claude_md(&claude_md_src, &workspace_path) {
                log::warn!("Failed to rebuild CLAUDE.md on clear: {}", e);
            }
        }
    }

    // Clean up stale root-level files from pre-reorganization layout
    migrate_workspace_layout(&workspace_path);

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

    #[test]
    fn test_migrate_context_from_skills_path_moves_legacy_context_into_workspace() {
        let workspace_root = tempfile::tempdir().unwrap();
        let skills_root = tempfile::tempdir().unwrap();

        let legacy_context = skills_root.path().join("skill-a").join("context");
        fs::create_dir_all(&legacy_context).unwrap();
        fs::write(legacy_context.join("clarifications.json"), r#"{"ok":true}"#).unwrap();
        fs::write(legacy_context.join("research-plan.md"), "legacy plan").unwrap();

        migrate_context_from_skills_path(
            &workspace_root.path().to_string_lossy(),
            &skills_root.path().to_string_lossy(),
        );

        // Legacy flat skills (skills_path/skill-a/context) are migrated to the plugin-namespaced
        // workspace layout: workspace/DEFAULT_PLUGIN_SLUG/skill-a/context
        let target_context = workspace_root
            .path()
            .join(crate::skill_paths::DEFAULT_PLUGIN_SLUG)
            .join("skill-a")
            .join("context");
        assert_eq!(
            fs::read_to_string(target_context.join("clarifications.json")).unwrap(),
            r#"{"ok":true}"#
        );
        assert_eq!(
            fs::read_to_string(target_context.join("research-plan.md")).unwrap(),
            "legacy plan"
        );
        assert!(
            !legacy_context.exists(),
            "legacy context dir should be removed after successful move"
        );
    }

    #[test]
    fn test_migrate_context_from_skills_path_skips_when_target_has_content() {
        let workspace_root = tempfile::tempdir().unwrap();
        let skills_root = tempfile::tempdir().unwrap();

        let legacy_context = skills_root.path().join("skill-a").join("context");
        fs::create_dir_all(&legacy_context).unwrap();
        fs::write(legacy_context.join("clarifications.json"), "legacy").unwrap();

        // Pre-populate the plugin-namespaced target to simulate a skill already migrated
        let target_context = workspace_root
            .path()
            .join(crate::skill_paths::DEFAULT_PLUGIN_SLUG)
            .join("skill-a")
            .join("context");
        fs::create_dir_all(&target_context).unwrap();
        fs::write(target_context.join("existing.md"), "keep-me").unwrap();

        migrate_context_from_skills_path(
            &workspace_root.path().to_string_lossy(),
            &skills_root.path().to_string_lossy(),
        );

        assert_eq!(
            fs::read_to_string(target_context.join("existing.md")).unwrap(),
            "keep-me"
        );
        assert!(
            !target_context.join("clarifications.json").exists(),
            "migration should skip this skill when target context is already non-empty"
        );
        assert_eq!(
            fs::read_to_string(legacy_context.join("clarifications.json")).unwrap(),
            "legacy",
            "legacy content should remain untouched when target already has content"
        );
    }

    #[test]
    fn test_migrate_context_from_skills_path_does_not_overwrite_destination_files() {
        let workspace_root = tempfile::tempdir().unwrap();
        let skills_root = tempfile::tempdir().unwrap();

        let legacy_context = skills_root.path().join("skill-a").join("context");
        fs::create_dir_all(&legacy_context).unwrap();
        fs::write(legacy_context.join("decisions.md"), "legacy-decisions").unwrap();

        // Pre-populate the plugin-namespaced target with a conflicting file
        let target_context = workspace_root
            .path()
            .join(crate::skill_paths::DEFAULT_PLUGIN_SLUG)
            .join("skill-a")
            .join("context");
        fs::create_dir_all(&target_context).unwrap();
        fs::write(target_context.join("decisions.md"), "newer-decisions").unwrap();

        migrate_context_from_skills_path(
            &workspace_root.path().to_string_lossy(),
            &skills_root.path().to_string_lossy(),
        );

        assert_eq!(
            fs::read_to_string(target_context.join("decisions.md")).unwrap(),
            "newer-decisions",
            "destination file should not be overwritten by legacy content"
        );
        assert_eq!(
            fs::read_to_string(legacy_context.join("decisions.md")).unwrap(),
            "legacy-decisions"
        );
    }

    #[test]
    fn test_migrate_context_from_skills_path_is_idempotent_on_rerun() {
        let workspace_root = tempfile::tempdir().unwrap();
        let skills_root = tempfile::tempdir().unwrap();

        let legacy_context = skills_root.path().join("skill-a").join("context");
        fs::create_dir_all(&legacy_context).unwrap();
        fs::write(
            legacy_context.join("clarifications.json"),
            r#"{"first":"run"}"#,
        )
        .unwrap();

        let workspace_path = workspace_root.path().to_string_lossy().to_string();
        let skills_path = skills_root.path().to_string_lossy().to_string();
        migrate_context_from_skills_path(&workspace_path, &skills_path);
        migrate_context_from_skills_path(&workspace_path, &skills_path);

        let target_file = workspace_root
            .path()
            .join(crate::skill_paths::DEFAULT_PLUGIN_SLUG)
            .join("skill-a")
            .join("context")
            .join("clarifications.json");
        assert_eq!(
            fs::read_to_string(target_file).unwrap(),
            r#"{"first":"run"}"#
        );
        assert!(
            !legacy_context.exists(),
            "legacy context should stay removed after repeated migration"
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
        let skill_dir = workspace.path().join("my-skill");
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

        // Create nested layout: root/analytics/weekly-report/SKILL.md
        // This is already the canonical layout — migration should be a no-op.
        let skill = root.join("analytics").join("weekly-report");
        fs::create_dir_all(&skill).unwrap();
        fs::write(skill.join("SKILL.md"), "# weekly report").unwrap();
        fs::create_dir_all(skill.join("references")).unwrap();

        let _ = crate::git::ensure_repo(root);

        migrate_to_marketplace_layout(root.to_str().unwrap());

        // Skill should still be at the same path
        assert!(
            skill.join("SKILL.md").is_file(),
            "SKILL.md should remain in place"
        );
        assert!(
            skill.join("references").is_dir(),
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

        // Skill should be at plugin path under default plugin (skills)
        let new_skill = root.join("skills").join("my-skill");
        assert!(new_skill.join("SKILL.md").is_file());
    }

    #[test]
    fn test_migrate_marketplace_idempotent() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();

        // Create canonical layout directly: root/analytics/report/SKILL.md
        let skill = root.join("analytics").join("report");
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

        // Old nested: root/analytics/report/SKILL.md
        let nested = root.join("analytics").join("report");
        fs::create_dir_all(&nested).unwrap();
        fs::write(nested.join("SKILL.md"), "# nested").unwrap();

        let _ = crate::git::ensure_repo(root);
        migrate_to_marketplace_layout(root.to_str().unwrap());

        // Flat skill should be under default plugin (directly, no inner skills/ nesting)
        let default_slug = crate::skill_paths::DEFAULT_PLUGIN_SLUG;
        assert!(root
            .join(default_slug)
            .join("my-skill")
            .join("SKILL.md")
            .is_file());

        // Nested skill should stay under its plugin (already at canonical path)
        assert!(root
            .join("analytics")
            .join("report")
            .join("SKILL.md")
            .is_file());

        // Both should be discoverable
        let locations = crate::skill_paths::enumerate_skill_locations(root).unwrap();
        assert_eq!(locations.len(), 2);
    }

    #[test]
    fn test_migrate_marketplace_nested_already_canonical() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();

        // Nested: root/analytics/report/SKILL.md — already at canonical path
        let skill = root.join("analytics").join("report");
        fs::create_dir_all(&skill).unwrap();
        fs::write(skill.join("SKILL.md"), "# report").unwrap();

        let _ = crate::git::ensure_repo(root);
        migrate_to_marketplace_layout(root.to_str().unwrap());

        // Skill stays in place — already at canonical path
        assert!(skill.join("SKILL.md").is_file());
        assert!(root.join("analytics").is_dir());
    }
}
