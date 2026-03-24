use crate::db::Db;
use crate::skill_paths::{
    ensure_nested_skill_dir, resolve_skill_dir, DEFAULT_PLUGIN_SLUG,
};
use crate::types::ReconciliationResult;
use std::fs;
use std::path::Path;

#[tauri::command]
pub fn reconcile_startup(
    _app: tauri::AppHandle,
    db: tauri::State<'_, Db>,
    apply: Option<bool>,
) -> Result<ReconciliationResult, String> {
    let apply = apply.unwrap_or(false);
    log::info!(
        "[reconcile_startup] mode={}",
        if apply { "apply" } else { "preview" }
    );
    let conn = db.0.lock().map_err(|e| {
        log::error!("[reconcile_startup] Failed to acquire DB lock: {}", e);
        e.to_string()
    })?;
    let settings = crate::db::read_settings(&conn)?;
    let workspace_path = settings
        .workspace_path
        .ok_or_else(|| "Workspace path not initialized".to_string())?;
    let skills_path = settings
        .skills_path
        .ok_or_else(|| "Skills path not configured. Please set it in Settings.".to_string())?;
    log::debug!(
        "[reconcile_startup] workspace={} skills_path={}",
        workspace_path,
        skills_path
    );

    // Migrate flat workspace dirs to plugin-organised layout.
    // e.g. workspace/britney-spears/ → workspace/skills/britney-spears/
    migrate_workspace_to_plugin_layout(Path::new(&workspace_path), &conn);

    // Always run full reconciliation — Phase 1 (plugin recon) is idempotent
    // and must run even in preview mode to discover plugins on disk.
    // Phase 2 (workflow recon) only touches incomplete skills.
    match crate::db::reconcile_orphaned_sessions(&conn) {
        Ok(count) if count > 0 => {
            log::info!("Reconciled {} orphaned workflow session(s)", count);
        }
        Err(e) => {
            log::warn!("Failed to reconcile orphaned sessions: {}", e);
        }
        _ => {}
    }

    let result =
        crate::reconciliation::reconcile_on_startup(&conn, &workspace_path, &skills_path)?;

    if apply {

        // Auto-commit new skill folders added while offline.
        // This is non-fatal: log warnings but don't block startup.
        let output_path = Path::new(&skills_path);
        if output_path.exists() {
            match crate::git::get_untracked_dirs(output_path) {
                Ok(untracked) if !untracked.is_empty() => {
                    let msg = format!("auto-commit new skill folders: {}", untracked.join(", "));
                    match crate::git::commit_all(output_path, &msg) {
                        Ok(Some(_)) => log::info!("[reconcile_startup] {}", msg),
                        Ok(None) => {
                            log::debug!(
                                "[reconcile_startup] No changes after staging untracked folders"
                            )
                        }
                        Err(e) => {
                            log::warn!(
                                "[reconcile_startup] Failed to commit untracked folders: {}",
                                e
                            )
                        }
                    }
                }
                Err(e) => log::warn!(
                    "[reconcile_startup] Failed to detect untracked folders: {}",
                    e
                ),
                _ => {}
            }
        }

        let details = serde_json::to_string(&serde_json::json!({
            "notifications": result.notifications,
            "discovered_skills": result.discovered_skills,
            "auto_cleaned": result.auto_cleaned,
        }))
        .unwrap_or_else(|_| "{\"error\":\"failed_to_serialize\"}".to_string());
        if let Err(e) = crate::db::record_reconciliation_event(&conn, "applied", &details) {
            log::warn!(
                "[reconcile_startup] failed to record reconciliation event: {}",
                e
            );
        }

    }

    if !apply {
        let details = serde_json::to_string(&serde_json::json!({
            "notifications": result.notifications.len(),
            "discovered_skills": result.discovered_skills.len(),
        }))
        .unwrap_or_else(|_| "{\"error\":\"failed_to_serialize\"}".to_string());
        if let Err(e) = crate::db::record_reconciliation_event(&conn, "previewed", &details) {
            log::warn!("[reconcile_startup] failed to record preview event: {}", e);
        }
    }

    Ok(result)
}

#[tauri::command]
pub fn record_reconciliation_cancel(
    db: tauri::State<'_, Db>,
    notification_count: Option<usize>,
    discovered_count: Option<usize>,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let details = serde_json::to_string(&serde_json::json!({
        "notifications": notification_count.unwrap_or(0),
        "discovered_skills": discovered_count.unwrap_or(0),
    }))
    .unwrap_or_else(|_| "{\"error\":\"failed_to_serialize\"}".to_string());
    crate::db::record_reconciliation_event(&conn, "cancelled", &details)
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
    let skills_path = settings
        .skills_path
        .ok_or_else(|| "Skills path not configured. Please set it in Settings.".to_string())?;

    crate::reconciliation::resolve_orphan(&conn, &skill_name, &action, &skills_path)
}

/// Migrate flat workspace dirs to the plugin-organised layout.
///
/// Workspace dirs were previously flat: `workspace/{skill_name}/`.
/// The new canonical layout is plugin-organised: `workspace/{plugin_slug}/{skill_name}/`.
///
/// This function reads all skills from the DB and moves any existing flat dirs
/// to the correct plugin-organised location. It is idempotent: already-migrated
/// dirs are skipped. Non-fatal: individual move failures are logged as warnings.
fn migrate_workspace_to_plugin_layout(workspace_path: &Path, conn: &rusqlite::Connection) {
    let all_skills = match crate::db::list_all_skills(conn) {
        Ok(s) => s,
        Err(e) => {
            log::warn!("[migrate_workspace] failed to list skills: {}", e);
            return;
        }
    };

    for skill in &all_skills {
        let flat_dir = workspace_path.join(&skill.name);
        if !flat_dir.exists() {
            continue;
        }
        let plugin_dir = workspace_path
            .join(&skill.plugin_slug)
            .join(&skill.name);
        if plugin_dir.exists() {
            log::debug!(
                "[migrate_workspace] '{}': already at plugin-organised path, skipping",
                skill.name
            );
            continue;
        }
        if flat_dir == plugin_dir {
            // Shouldn't happen in practice but guard against no-op rename.
            continue;
        }
        if let Some(parent) = plugin_dir.parent() {
            if let Err(e) = std::fs::create_dir_all(parent) {
                log::warn!(
                    "[migrate_workspace] '{}': failed to create parent '{}': {}",
                    skill.name,
                    parent.display(),
                    e
                );
                continue;
            }
        }
        match std::fs::rename(&flat_dir, &plugin_dir) {
            Ok(()) => log::info!(
                "[migrate_workspace] moved '{}' → '{}'",
                flat_dir.display(),
                plugin_dir.display()
            ),
            Err(e) => log::warn!(
                "[migrate_workspace] failed to move '{}': {}",
                flat_dir.display(),
                e
            ),
        }
    }
}

/// Validate that a path derived from `skill_name` stays inside `parent`.
/// The `parent` directory must exist; `child` is joined from it.
fn validate_path_within(parent: &Path, skill_name: &str, label: &str) -> Result<(), String> {
    let child = parent.join(skill_name);
    if child.exists() {
        let canonical_parent = fs::canonicalize(parent).map_err(|e| {
            format!(
                "[resolve_discovery] Failed to canonicalize {}: {}",
                label, e
            )
        })?;
        let canonical_child = fs::canonicalize(&child).map_err(|e| {
            format!(
                "[resolve_discovery] Failed to canonicalize {} child: {}",
                label, e
            )
        })?;
        if !canonical_child.starts_with(&canonical_parent) {
            log::error!(
                "[resolve_discovery] Path traversal attempt on {}: {}",
                label,
                skill_name
            );
            return Err(format!(
                "Invalid skill path: path traversal not allowed on {}",
                label
            ));
        }
    }
    Ok(())
}

#[tauri::command]
pub fn resolve_discovery(
    skill_name: String,
    action: String,
    plugin_slug: Option<String>,
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
    let skills_path = settings
        .skills_path
        .ok_or_else(|| "Skills path not configured".to_string())?;
    let workspace_path = settings
        .workspace_path
        .ok_or_else(|| "Workspace path not initialized".to_string())?;

    let plugin_slug = plugin_slug.unwrap_or_else(|| DEFAULT_PLUGIN_SLUG.to_string());

    match action.as_str() {
        "add-skill-builder" => {
            // Add as skill-builder with workflow_runs at step 5
            let plugin_id = if plugin_slug == DEFAULT_PLUGIN_SLUG {
                crate::db::ensure_default_plugin(&conn)?
            } else {
                let display_name = crate::skill_paths::plugin_display_name(&plugin_slug);
                crate::db::ensure_plugin(&conn, &plugin_slug, &display_name, "local", None, None, false)?
            };
            crate::db::upsert_skill_in_plugin(&conn, &skill_name, "skill-builder", "domain", &plugin_slug)?;
            conn.execute(
                "INSERT INTO workflow_runs (skill_name, current_step, status, purpose, skill_id, updated_at)
                 VALUES (?1, 5, 'completed', 'domain',
                         (SELECT s.id FROM skills s JOIN plugins p ON p.id = s.plugin_id WHERE s.name = ?1 AND p.id = ?2),
                         datetime('now') || 'Z')
                 ON CONFLICT(skill_name) DO UPDATE SET current_step = 5, status = 'completed', purpose = 'domain', updated_at = datetime('now') || 'Z'",
                rusqlite::params![&skill_name, plugin_id],
            )
            .map_err(|e| e.to_string())?;
            // Validate workspace path before creating directory
            let ws_path = Path::new(&workspace_path);
            let workspace_dir = ensure_nested_skill_dir(ws_path, &plugin_slug, &skill_name)?;
            if workspace_dir.exists() {
                validate_path_within(ws_path, &skill_name, "workspace_path")?;
            }
            // Create workspace marker
            let _ = fs::create_dir_all(&workspace_dir);
            log::info!(
                "[resolve_discovery] '{}': added as skill-builder (completed) in plugin '{}'",
                skill_name,
                plugin_slug
            );
            Ok(())
        }
        "add-imported" => {
            // Add as imported, clear context folder — force skill_source to "imported"
            crate::db::upsert_skill_with_source_in_plugin(&conn, &skill_name, "imported", "domain", &plugin_slug)?;
            // Validate workspace_path before touching context filesystem
            let wp = Path::new(&workspace_path);
            let workspace_root = resolve_skill_dir(wp, &plugin_slug, &skill_name);
            if workspace_root.exists() {
                validate_path_within(wp, &skill_name, "workspace_path")?;
            }
            // Clear context folder
            let context_dir = workspace_root.join("context");
            if context_dir.exists() {
                let _ = fs::remove_dir_all(&context_dir);
                log::info!("[resolve_discovery] '{}': cleared context folder", skill_name);
            }
            log::info!(
                "[resolve_discovery] '{}': added as imported in plugin '{}'",
                skill_name,
                plugin_slug
            );
            Ok(())
        }
        "remove" => {
            // Validate skills_path before deleting
            let sp = Path::new(&skills_path);
            validate_path_within(sp, &skill_name, "skills_path")?;
            // Delete from disk
            let skill_dir = resolve_skill_dir(sp, &plugin_slug, &skill_name);
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

#[cfg(test)]
mod tests {
    use super::*;

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
        assert!(
            result.is_ok(),
            "Non-existent path should be accepted (not yet created)"
        );
    }

    #[test]
    fn test_migrate_workspace_to_plugin_layout_moves_flat_dirs() {
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path();
        let conn = crate::commands::test_utils::create_test_db();

        // Create a skill in the DB (default plugin "skills")
        crate::db::upsert_skill(&conn, "britney-spears", "skill-builder", "domain").unwrap();

        // Create a flat workspace dir for the skill
        let flat_path = workspace.join("britney-spears");
        fs::create_dir_all(&flat_path).unwrap();
        fs::write(flat_path.join("user-context.md"), "context").unwrap();

        migrate_workspace_to_plugin_layout(workspace, &conn);

        // Should have been moved to the plugin-organised location
        let new_path = workspace.join("skills").join("britney-spears");
        assert!(new_path.exists(), "plugin-organised dir should exist after migration");
        assert!(new_path.join("user-context.md").exists(), "contents should be preserved");
        // Flat dir should be gone
        assert!(!flat_path.exists(), "flat dir should be removed after migration");
    }

    #[test]
    fn test_migrate_workspace_to_plugin_layout_skips_already_migrated() {
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path();
        let conn = crate::commands::test_utils::create_test_db();

        crate::db::upsert_skill(&conn, "my-skill", "skill-builder", "domain").unwrap();

        // Pre-existing plugin-organised dir (already migrated)
        let plugin_path = workspace.join("skills").join("my-skill");
        fs::create_dir_all(&plugin_path).unwrap();
        fs::write(plugin_path.join("existing.md"), "existing").unwrap();

        // Also a flat dir (stale, should not overwrite)
        let flat_path = workspace.join("my-skill");
        fs::create_dir_all(&flat_path).unwrap();
        fs::write(flat_path.join("stale.md"), "stale").unwrap();

        migrate_workspace_to_plugin_layout(workspace, &conn);

        // Plugin-organised dir should be untouched (existing content preserved)
        assert!(plugin_path.join("existing.md").exists());
        assert!(!plugin_path.join("stale.md").exists(), "stale content must not overwrite");
        // Flat dir should still be there (was not moved since target already exists)
        assert!(flat_path.exists(), "flat dir kept when plugin-organised already exists");
    }

    #[test]
    fn test_migrate_workspace_to_plugin_layout_skips_unknown_skills() {
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path();
        let conn = crate::commands::test_utils::create_test_db();

        // No skills in DB — nothing should be moved

        let flat_path = workspace.join("unknown-skill");
        fs::create_dir_all(&flat_path).unwrap();
        fs::write(flat_path.join("data.md"), "data").unwrap();

        migrate_workspace_to_plugin_layout(workspace, &conn);

        // Should be untouched since it's not in the DB
        assert!(flat_path.exists(), "unknown skill dir should not be moved");
    }
}
