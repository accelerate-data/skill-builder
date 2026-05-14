use crate::db::Db;
use crate::skill_paths::resolve_skill_dir;
use crate::types::ReconciliationResult;
use crate::DataDir;
use std::fs;
use std::path::Path;

#[tauri::command]
pub fn reconcile_startup(
    _app: tauri::AppHandle,
    db: tauri::State<'_, Db>,
    data_dir: tauri::State<'_, DataDir>,
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
    let skills_path = settings
        .skills_path
        .ok_or_else(|| "Skills path not configured. Please set it in Settings.".to_string())?;
    log::debug!("[reconcile_startup] skills_path={}", skills_path);

    // Migrate flat workspace dirs to plugin-organised layout.
    // e.g. skills/britney-spears/ → skills/default/skills/britney-spears/
    migrate_workspace_to_plugin_layout(Path::new(&skills_path), &conn);

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

    let startup_cleaned = cleanup_app_local_startup_state(&data_dir.0)?;
    let mut result = crate::reconciliation::reconcile_on_startup(&conn, &skills_path)?;
    result.auto_cleaned += startup_cleaned;

    if apply {
        // Per-skill repos: walk discovered skill dirs, init+commit any without .git/
        let output_path = Path::new(&skills_path);
        if output_path.exists() {
            if let Ok(locations) = crate::skill_paths::enumerate_skill_locations(output_path) {
                for location in locations {
                    let skill_dir = location.dir;
                    if skill_dir.join(".git").exists() {
                        continue;
                    }
                    if let Err(e) = crate::git::ensure_repo(&skill_dir) {
                        log::warn!(
                            "[reconcile_startup] failed to init repo at {}: {}",
                            skill_dir.display(),
                            e
                        );
                        continue;
                    }
                    let msg = format!("auto-commit new skill: {}", location.skill_name);
                    match crate::git::commit_all(&skill_dir, &msg) {
                        Ok(Some(_)) => log::info!("[reconcile_startup] {}", msg),
                        Ok(None) => {}
                        Err(e) => log::warn!(
                            "[reconcile_startup] commit failed for {}: {}",
                            location.skill_name,
                            e
                        ),
                    }
                }
            }
        }

        let details = serde_json::to_string(&serde_json::json!({
            "notifications": result.notifications,
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
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let details = serde_json::to_string(&serde_json::json!({
        "notifications": notification_count.unwrap_or(0),
    }))
    .unwrap_or_else(|_| "{\"error\":\"failed_to_serialize\"}".to_string());
    crate::db::record_reconciliation_event(&conn, "cancelled", &details)
}

fn cleanup_app_local_startup_state(data_dir: &Path) -> Result<u32, String> {
    let mut cleaned = 0u32;
    let conversations_root = data_dir.join("workspace").join("conversations");
    if conversations_root.exists() {
        for entry in fs::read_dir(&conversations_root).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            if path.join("meta.json").exists() {
                continue;
            }
            fs::remove_dir_all(&path).map_err(|e| e.to_string())?;
            cleaned += 1;
        }
    }

    let legacy_db = data_dir.join("skill-builder.db");
    if legacy_db.exists() {
        let metadata = fs::metadata(&legacy_db).map_err(|e| e.to_string())?;
        if metadata.is_file() && metadata.len() == 0 {
            fs::remove_file(&legacy_db).map_err(|e| e.to_string())?;
            cleaned += 1;
        }
    }

    Ok(cleaned)
}

/// Migrate flat skill dirs to the plugin-organised layout.
///
/// Skill dirs were previously flat: `skills_path/{skill_name}/`.
/// The new canonical layout is plugin-organised:
/// `skills_path/{plugin_slug}/skills/{skill_name}/`.
///
/// This function reads all skills from the DB and moves any existing flat dirs
/// to the correct plugin-organised location. It is idempotent: already-migrated
/// dirs are skipped. Non-fatal: individual move failures are logged as warnings.
fn migrate_workspace_to_plugin_layout(skills_path: &Path, conn: &rusqlite::Connection) {
    let all_skills = match crate::db::list_all_skills(conn) {
        Ok(s) => s,
        Err(e) => {
            log::warn!("[migrate_workspace] failed to list skills: {}", e);
            return;
        }
    };

    for skill in &all_skills {
        let flat_dir = skills_path.join(&skill.name);
        if !flat_dir.exists() {
            continue;
        }
        let plugin_dir = resolve_skill_dir(skills_path, &skill.plugin_slug, &skill.name);
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_migrate_workspace_to_plugin_layout_moves_flat_dirs() {
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path();
        let conn = crate::commands::test_utils::create_test_db();

        // Create a skill in the DB (default plugin "default")
        crate::db::upsert_skill(&conn, "britney-spears", "skill-builder", "domain").unwrap();

        // Create a flat workspace dir for the skill
        let flat_path = workspace.join("britney-spears");
        fs::create_dir_all(&flat_path).unwrap();
        fs::write(flat_path.join("user-context.md"), "context").unwrap();

        migrate_workspace_to_plugin_layout(workspace, &conn);

        // Should have been moved to the plugin-organised location
        let new_path = workspace
            .join("default")
            .join("skills")
            .join("britney-spears");
        assert!(
            new_path.exists(),
            "plugin-organised dir should exist after migration"
        );
        assert!(
            new_path.join("user-context.md").exists(),
            "contents should be preserved"
        );
        // Flat dir should be gone
        assert!(
            !flat_path.exists(),
            "flat dir should be removed after migration"
        );
    }

    #[test]
    fn test_migrate_workspace_to_plugin_layout_skips_already_migrated() {
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path();
        let conn = crate::commands::test_utils::create_test_db();

        crate::db::upsert_skill(&conn, "my-skill", "skill-builder", "domain").unwrap();

        // Pre-existing plugin-organised dir (already migrated)
        let plugin_path = workspace.join("default").join("skills").join("my-skill");
        fs::create_dir_all(&plugin_path).unwrap();
        fs::write(plugin_path.join("existing.md"), "existing").unwrap();

        // Also a flat dir (stale, should not overwrite)
        let flat_path = workspace.join("my-skill");
        fs::create_dir_all(&flat_path).unwrap();
        fs::write(flat_path.join("stale.md"), "stale").unwrap();

        migrate_workspace_to_plugin_layout(workspace, &conn);

        // Plugin-organised dir should be untouched (existing content preserved)
        assert!(plugin_path.join("existing.md").exists());
        assert!(
            !plugin_path.join("stale.md").exists(),
            "stale content must not overwrite"
        );
        // Flat dir should still be there (was not moved since target already exists)
        assert!(
            flat_path.exists(),
            "flat dir kept when plugin-organised already exists"
        );
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

    #[test]
    fn test_cleanup_app_local_startup_state_prunes_conversation_dirs_missing_meta_json() {
        let tmp = tempfile::tempdir().unwrap();
        let conversations_root = tmp.path().join("workspace").join("conversations");
        let orphan = conversations_root.join("orphaned-run");
        let valid = conversations_root.join("valid-run");
        fs::create_dir_all(&orphan).unwrap();
        fs::create_dir_all(&valid).unwrap();
        fs::write(valid.join("meta.json"), "{}").unwrap();

        let cleaned = cleanup_app_local_startup_state(tmp.path()).unwrap();

        assert_eq!(cleaned, 1);
        assert!(!orphan.exists());
        assert!(valid.exists());
    }

    #[test]
    fn test_cleanup_app_local_startup_state_prunes_zero_byte_legacy_db_file() {
        let tmp = tempfile::tempdir().unwrap();
        let legacy_db = tmp.path().join("skill-builder.db");
        fs::write(&legacy_db, "").unwrap();

        let cleaned = cleanup_app_local_startup_state(tmp.path()).unwrap();

        assert_eq!(cleaned, 1);
        assert!(!legacy_db.exists());
    }
}
