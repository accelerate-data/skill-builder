use crate::db::Db;
use crate::types::ReconciliationResult;
use std::fs;
use std::path::Path;

const WORKSPACE_PARENT: &str = ".vibedata";
const WORKSPACE_SUBDIR: &str = "skill-builder";

/// Resolve the default workspace path: `~/.vibedata/skill-builder`
fn resolve_workspace_path() -> Result<String, String> {
    let home = dirs::home_dir().ok_or_else(|| "Could not determine home directory".to_string())?;
    let workspace = home.join(WORKSPACE_PARENT).join(WORKSPACE_SUBDIR);
    workspace
        .to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "Home directory path contains invalid UTF-8".to_string())
}

/// Migrate existing `~/.vibedata` workspace to `~/.vibedata/skill-builder`.
/// Safe to call on every startup — skips if already migrated or if old dir is empty/absent.
/// Uses a three-step atomic rename to avoid data loss:
///   ~/.vibedata → ~/.vibedata-migrating (take old dir out of the way)
///   mkdir ~/.vibedata                   (recreate the parent)
///   ~/.vibedata-migrating → ~/.vibedata/skill-builder (move data to new location)
fn migrate_to_skill_builder_subdir(home: &Path) {
    let old_root = home.join(WORKSPACE_PARENT);
    let new_root = home.join(WORKSPACE_PARENT).join(WORKSPACE_SUBDIR);

    // Already on new layout, or nothing to migrate
    if !old_root.is_dir() || new_root.exists() {
        return;
    }

    // If old root is empty, nothing to move (create_dir_all will handle it)
    let has_content = fs::read_dir(&old_root)
        .map(|mut d| d.next().is_some())
        .unwrap_or(false);
    if !has_content {
        return;
    }

    let tmp_name = format!("{}-migrating", WORKSPACE_PARENT);
    let tmp = home.join(&tmp_name);
    if tmp.exists() {
        log::warn!("[init_workspace] migration skipped: ~/{} already exists (leftover from a previous failed migration?)", tmp_name);
        return;
    }

    if let Err(e) = fs::rename(&old_root, &tmp) {
        log::warn!("[init_workspace] migration step 1 failed (rename ~/.vibedata to tmp): {}", e);
        return;
    }

    if let Err(e) = fs::create_dir_all(&old_root) {
        log::warn!("[init_workspace] migration step 2 failed (recreate ~/.vibedata): {}", e);
        let _ = fs::rename(&tmp, &old_root); // restore
        return;
    }

    if let Err(e) = fs::rename(&tmp, &new_root) {
        log::warn!("[init_workspace] migration step 3 failed (rename tmp to ~/.vibedata/skill-builder): {}", e);
        // Try to restore: drop newly created empty parent, rename tmp back
        let _ = fs::remove_dir(&old_root);
        let _ = fs::rename(&tmp, &old_root);
        return;
    }

    log::info!("[init_workspace] migrated workspace: ~/.vibedata → ~/.vibedata/skill-builder");
}

/// Migrate from the old workspace layout (agents/, references/, CLAUDE.md at root)
/// to the new layout where everything lives under `.claude/`.
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
    // Remove root CLAUDE.md only if .claude/CLAUDE.md exists (migration complete)
    let old_claude_md = base.join("CLAUDE.md");
    let new_claude_md = base.join(".claude").join("CLAUDE.md");
    if old_claude_md.is_file() && new_claude_md.is_file() {
        let _ = fs::remove_file(&old_claude_md);
    }
}

/// Initialize the workspace directory on app startup.
/// Creates `~/.vibedata/skill-builder` if it doesn't exist, updates settings,
/// and deploys bundled agents to `.claude/`.
/// Also migrates existing `~/.vibedata` data to `~/.vibedata/skill-builder` on first run.
pub fn init_workspace(
    app: &tauri::AppHandle,
    db: &tauri::State<'_, Db>,
) -> Result<String, String> {
    // Migrate old ~/.vibedata workspace to ~/.vibedata/skill-builder on first launch after upgrade
    if let Some(home) = dirs::home_dir() {
        migrate_to_skill_builder_subdir(&home);
    }

    let workspace_path = resolve_workspace_path()?;

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

    // Seed bundled skills (always overwrite files, preserve is_active)
    {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let bundled_skills_dir = super::workflow::resolve_bundled_skills_dir(app);
        if let Err(e) = super::imported_skills::seed_bundled_skills(&workspace_path, &conn, &bundled_skills_dir) {
            log::warn!("seed_bundled_skills: failed: {}", e);
        }
    }

    // Rebuild CLAUDE.md: base template + imported skills from DB + user customization
    {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let (_, claude_md_src) = super::workflow::resolve_prompt_source_dirs_public(app);
        if claude_md_src.is_file() {
            if let Err(e) = super::workflow::rebuild_claude_md(&claude_md_src, &workspace_path, &conn) {
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
pub fn clear_workspace(
    app: tauri::AppHandle,
    db: tauri::State<'_, Db>,
) -> Result<(), String> {
    log::info!("[clear_workspace]");
    let conn = db.0.lock().map_err(|e| {
        log::error!("[clear_workspace] Failed to acquire DB lock: {}", e);
        e.to_string()
    })?;
    let settings = crate::db::read_settings(&conn)?;
    let workspace_path = settings.workspace_path
        .ok_or_else(|| "Workspace path not initialized".to_string())?;
    drop(conn);

    // Delete only .claude/agents/ — preserve skills/ and CLAUDE.md
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
            if let Err(e) = super::workflow::rebuild_claude_md(&claude_md_src, &workspace_path, &conn) {
                log::warn!("Failed to rebuild CLAUDE.md on clear: {}", e);
            }
        }
    }

    // Clean up stale root-level files from pre-reorganization layout
    migrate_workspace_layout(&workspace_path);

    Ok(())
}

#[tauri::command]
pub fn reconcile_startup(_app: tauri::AppHandle, db: tauri::State<'_, Db>) -> Result<ReconciliationResult, String> {
    log::info!("[reconcile_startup]");
    let conn = db.0.lock().map_err(|e| {
        log::error!("[reconcile_startup] Failed to acquire DB lock: {}", e);
        e.to_string()
    })?;
    let settings = crate::db::read_settings(&conn)?;
    let workspace_path = settings
        .workspace_path
        .ok_or_else(|| "Workspace path not initialized".to_string())?;
    let skills_path = settings.skills_path
        .ok_or_else(|| "Skills path not configured. Please set it in Settings.".to_string())?;
    log::debug!("[reconcile_startup] workspace={} skills_path={}", workspace_path, skills_path);

    // Reconcile orphaned workflow sessions from crashed instances
    match crate::db::reconcile_orphaned_sessions(&conn) {
        Ok(count) if count > 0 => {
            log::info!("Reconciled {} orphaned workflow session(s)", count);
        }
        Err(e) => {
            log::warn!("Failed to reconcile orphaned sessions: {}", e);
        }
        _ => {}
    }

    let result = crate::reconciliation::reconcile_on_startup(&conn, &workspace_path, &skills_path)?;

    // Auto-commit new skill folders added while offline.
    // This is non-fatal: log warnings but don't block startup.
    let output_path = Path::new(&skills_path);

    if output_path.exists() {
        // Commit untracked skill folders to git
        match crate::git::get_untracked_dirs(output_path) {
            Ok(untracked) if !untracked.is_empty() => {
                let msg = format!("auto-commit new skill folders: {}", untracked.join(", "));
                match crate::git::commit_all(output_path, &msg) {
                    Ok(Some(_)) => log::info!("[reconcile_startup] {}", msg),
                    Ok(None) => log::debug!("[reconcile_startup] No changes after staging untracked folders"),
                    Err(e) => log::warn!("[reconcile_startup] Failed to commit untracked folders: {}", e),
                }
            }
            Err(e) => log::warn!("[reconcile_startup] Failed to detect untracked folders: {}", e),
            _ => {}
        }
    }

    Ok(result)
}

#[tauri::command]
pub fn resolve_orphan(
    skill_name: String,
    action: String,
    db: tauri::State<'_, Db>,
) -> Result<(), String> {
    log::info!("[resolve_orphan] skill={} action={}", skill_name, action);
    let conn = db.0.lock().map_err(|e| {
        log::error!("[resolve_orphan] Failed to acquire DB lock: {}", e);
        e.to_string()
    })?;
    let settings = crate::db::read_settings(&conn)?;
    let skills_path = settings.skills_path
        .ok_or_else(|| "Skills path not configured. Please set it in Settings.".to_string())?;

    crate::reconciliation::resolve_orphan(&conn, &skill_name, &action, &skills_path)
}

// --- Discovery Resolution ---

/// Validate that a path derived from `skill_name` stays inside `parent`.
/// The `parent` directory must exist; `child` is joined from it.
fn validate_path_within(parent: &Path, skill_name: &str, label: &str) -> Result<(), String> {
    let child = parent.join(skill_name);
    if child.exists() {
        let canonical_parent = fs::canonicalize(parent).map_err(|e| {
            format!("[resolve_discovery] Failed to canonicalize {}: {}", label, e)
        })?;
        let canonical_child = fs::canonicalize(&child).map_err(|e| {
            format!("[resolve_discovery] Failed to canonicalize {} child: {}", label, e)
        })?;
        if !canonical_child.starts_with(&canonical_parent) {
            log::error!("[resolve_discovery] Path traversal attempt on {}: {}", label, skill_name);
            return Err(format!("Invalid skill path: path traversal not allowed on {}", label));
        }
    }
    Ok(())
}

#[tauri::command]
pub fn resolve_discovery(
    skill_name: String,
    action: String,
    db: tauri::State<'_, Db>,
) -> Result<(), String> {
    log::info!("[resolve_discovery] skill={} action={}", skill_name, action);

    // Defense-in-depth: reject obviously malicious skill names early
    super::imported_skills::validate_skill_name(&skill_name)?;

    let conn = db.0.lock().map_err(|e| {
        log::error!("[resolve_discovery] Failed to acquire DB lock: {}", e);
        e.to_string()
    })?;
    let settings = crate::db::read_settings(&conn)?;
    let skills_path = settings.skills_path
        .ok_or_else(|| "Skills path not configured".to_string())?;
    let workspace_path = settings.workspace_path
        .ok_or_else(|| "Workspace path not initialized".to_string())?;

    match action.as_str() {
        "add-skill-builder" => {
            // Add as skill-builder with workflow_runs at step 5
            crate::db::save_workflow_run(
                &conn, &skill_name, 5, "completed", "domain",
            )?;
            // Validate workspace path before creating directory
            let ws_path = Path::new(&workspace_path);
            validate_path_within(ws_path, &skill_name, "workspace_path")?;
            // Create workspace marker
            let workspace_dir = ws_path.join(&skill_name);
            let _ = fs::create_dir_all(&workspace_dir);
            log::info!("[resolve_discovery] '{}': added as skill-builder (completed)", skill_name);
            Ok(())
        }
        "add-imported" => {
            // Add as imported, clear context folder — force skill_source to "imported"
            crate::db::upsert_skill_with_source(&conn, &skill_name, "imported", "domain")?;
            // Validate skills_path before touching filesystem
            let sp = Path::new(&skills_path);
            validate_path_within(sp, &skill_name, "skills_path")?;
            // Clear context folder
            let context_dir = sp.join(&skill_name).join("context");
            if context_dir.exists() {
                let _ = fs::remove_dir_all(&context_dir);
                log::info!("[resolve_discovery] '{}': cleared context folder", skill_name);
            }
            log::info!("[resolve_discovery] '{}': added as imported", skill_name);
            Ok(())
        }
        "remove" => {
            // Validate skills_path before deleting
            let sp = Path::new(&skills_path);
            validate_path_within(sp, &skill_name, "skills_path")?;
            // Delete from disk
            let skill_dir = sp.join(&skill_name);
            if skill_dir.exists() {
                fs::remove_dir_all(&skill_dir)
                    .map_err(|e| format!("Failed to remove '{}': {}", skill_name, e))?;
            }
            log::info!("[resolve_discovery] '{}': removed from disk", skill_name);
            Ok(())
        }
        _ => Err(format!("Invalid discovery action: '{}'. Expected 'add-skill-builder', 'add-imported', or 'remove'.", action)),
    }
}

// --- Workflow Sessions ---

#[tauri::command]
pub fn create_workflow_session(
    db: tauri::State<'_, Db>,
    instance: tauri::State<'_, crate::InstanceInfo>,
    session_id: String,
    skill_name: String,
) -> Result<(), String> {
    log::info!("[create_workflow_session] session=[REDACTED] skill={}", skill_name);
    let conn = db.0.lock().map_err(|e| {
        log::error!("[create_workflow_session] Failed to acquire DB lock: {}", e);
        e.to_string()
    })?;
    crate::db::create_workflow_session(&conn, &session_id, &skill_name, instance.pid)
}

#[tauri::command]
pub fn end_workflow_session(
    db: tauri::State<'_, Db>,
    session_id: String,
) -> Result<(), String> {
    log::info!("[end_workflow_session] session=[REDACTED]");
    let conn = db.0.lock().map_err(|e| {
        log::error!("[end_workflow_session] Failed to acquire DB lock: {}", e);
        e.to_string()
    })?;
    crate::db::end_workflow_session(&conn, &session_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_resolve_workspace_path() {
        let path = resolve_workspace_path().unwrap();
        assert!(path.ends_with(".vibedata/skill-builder"), "expected path ending in .vibedata/skill-builder, got {}", path);
    }

    #[test]
    fn test_validate_path_within_rejects_traversal() {
        let tmp = tempfile::tempdir().unwrap();
        let parent = tmp.path().join("parent");
        fs::create_dir_all(&parent).unwrap();

        // Create a directory outside parent that a traversal would reach
        let outside = tmp.path().join("outside");
        fs::create_dir_all(&outside).unwrap();

        // The traversal path "../outside" resolves to tmp/outside which is outside parent
        // It must exist for canonicalize to work
        let result = validate_path_within(&parent, "../outside", "test");
        assert!(result.is_err(), "Path traversal should be rejected");
        assert!(
            result.unwrap_err().contains("path traversal not allowed"),
            "Error should mention path traversal"
        );
    }

    #[test]
    fn test_validate_path_within_accepts_valid_path() {
        let tmp = tempfile::tempdir().unwrap();
        let parent = tmp.path().join("parent");
        fs::create_dir_all(&parent).unwrap();

        // Create a valid child directory
        let child = parent.join("valid-skill");
        fs::create_dir_all(&child).unwrap();

        // Should succeed
        let result = validate_path_within(&parent, "valid-skill", "test");
        assert!(result.is_ok(), "Valid path should be accepted");
    }

    #[test]
    fn test_validate_path_within_skips_nonexistent_path() {
        let tmp = tempfile::tempdir().unwrap();
        let parent = tmp.path().join("parent");
        fs::create_dir_all(&parent).unwrap();

        // Non-existent child: no validation happens (path doesn't exist yet)
        let result = validate_path_within(&parent, "does-not-exist", "test");
        assert!(result.is_ok(), "Non-existent path should be accepted (not yet created)");
    }

    // --- migrate_to_skill_builder_subdir tests ---

    #[test]
    fn test_migrate_happy_path() {
        let home = tempfile::tempdir().unwrap();
        let old_root = home.path().join(".vibedata");
        fs::create_dir_all(&old_root).unwrap();
        fs::write(old_root.join("agents.md"), "content").unwrap();

        migrate_to_skill_builder_subdir(home.path());

        let new_root = home.path().join(".vibedata").join("skill-builder");
        assert!(new_root.join("agents.md").exists(), "file should be at new location");
        assert!(!home.path().join(".vibedata-migrating").exists(), "tmp should be cleaned up");
    }

    #[test]
    fn test_migrate_skips_if_already_migrated() {
        let home = tempfile::tempdir().unwrap();
        let new_root = home.path().join(".vibedata").join("skill-builder");
        fs::create_dir_all(&new_root).unwrap();
        fs::write(new_root.join("agents.md"), "content").unwrap();

        // Should be a no-op
        migrate_to_skill_builder_subdir(home.path());

        assert!(new_root.join("agents.md").exists(), "existing new layout should be untouched");
    }

    #[test]
    fn test_migrate_skips_if_old_dir_absent() {
        let home = tempfile::tempdir().unwrap();

        // Old ~/.vibedata doesn't exist — nothing to do
        migrate_to_skill_builder_subdir(home.path());

        assert!(!home.path().join(".vibedata").exists(), "nothing should be created");
    }

    #[test]
    fn test_migrate_skips_if_old_dir_empty() {
        let home = tempfile::tempdir().unwrap();
        let old_root = home.path().join(".vibedata");
        fs::create_dir_all(&old_root).unwrap();
        // No files inside

        migrate_to_skill_builder_subdir(home.path());

        // Old empty dir should still be there (create_dir_all would have made it anyway)
        // New subdir should not have been created by migration
        assert!(!old_root.join("skill-builder").exists(), "should not create skill-builder from empty dir");
    }

    #[test]
    fn test_migrate_skips_if_tmp_exists() {
        let home = tempfile::tempdir().unwrap();
        let old_root = home.path().join(".vibedata");
        fs::create_dir_all(&old_root).unwrap();
        fs::write(old_root.join("agents.md"), "content").unwrap();

        // Simulate a leftover tmp from a previous failed migration
        let tmp = home.path().join(".vibedata-migrating");
        fs::create_dir_all(&tmp).unwrap();

        migrate_to_skill_builder_subdir(home.path());

        // Should be a no-op: original file still in old location
        assert!(old_root.join("agents.md").exists(), "file should remain in old location");
        assert!(!old_root.join("skill-builder").exists(), "skill-builder should not be created");
    }
}
