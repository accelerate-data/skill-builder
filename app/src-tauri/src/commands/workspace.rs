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
    // Workspace instructions now live at workspace/CLAUDE.md.
    let root_claude_md = base.join("CLAUDE.md");
    let nested_claude_md = base.join(".claude").join("CLAUDE.md");
    if root_claude_md.is_file() && nested_claude_md.is_file() {
        let _ = fs::remove_file(&nested_claude_md);
    }
}

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
        let skill_name = file_name.to_string_lossy();
        if skill_name.starts_with('.') {
            continue;
        }
        let skill_dir = entry.path();
        if !skill_dir.is_dir() {
            continue;
        }

        let legacy_context = skill_dir.join("context");
        if !legacy_context.is_dir() {
            continue;
        }

        let workspace_skill_dir = Path::new(workspace_path).join(skill_name.as_ref());
        let target_context = workspace_skill_dir.join("context");
        if let Err(e) = fs::create_dir_all(&target_context) {
            log::warn!(
                "[init_workspace] failed to create workspace context dir {}: {}",
                target_context.display(),
                e
            );
            continue;
        }

        let target_has_content = fs::read_dir(&target_context)
            .map(|mut d| d.next().is_some())
            .unwrap_or(false);
        if target_has_content {
            continue;
        }

        let legacy_entries = match fs::read_dir(&legacy_context) {
            Ok(entries) => entries,
            Err(e) => {
                log::warn!(
                    "[init_workspace] failed to read legacy context dir {}: {}",
                    legacy_context.display(),
                    e
                );
                continue;
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

        let legacy_empty = fs::read_dir(&legacy_context)
            .map(|mut d| d.next().is_none())
            .unwrap_or(false);
        if legacy_empty {
            let _ = fs::remove_dir(&legacy_context);
        }
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
        if let Err(e) = super::imported_skills::purge_stale_bundled_skills(
            &workspace_path,
            &bundled_skills_dir,
        ) {
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
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let (_, claude_md_src) = super::workflow::resolve_prompt_source_dirs_public(app);
        if claude_md_src.is_file() {
            if let Err(e) =
                super::workflow::rebuild_claude_md(&claude_md_src, &workspace_path, &conn)
            {
                log::warn!("Failed to rebuild CLAUDE.md on startup: {}", e);
            }
        } else {
            log::warn!("Bundled CLAUDE.md not found; skipping rebuild");
        }
    }

    // Clean up stale root-level files from pre-reorganization layout
    migrate_workspace_layout(&workspace_path);

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
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let (_, claude_md_src) = super::workflow::resolve_prompt_source_dirs_public(&app);
        if claude_md_src.is_file() {
            if let Err(e) =
                super::workflow::rebuild_claude_md(&claude_md_src, &workspace_path, &conn)
            {
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

        let target_context = workspace_root.path().join("skill-a").join("context");
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

        let target_context = workspace_root.path().join("skill-a").join("context");
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

        let target_context = workspace_root.path().join("skill-a").join("context");
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
}
