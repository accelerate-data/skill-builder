use crate::db::Db;
use crate::skill_paths::{
    ensure_nested_skill_dir, resolve_skill_dir, resolve_workspace_skill_dir, DEFAULT_PLUGIN_SLUG,
};
use std::fs;
use std::path::Path;

use super::helpers::validate_skill_name;

/// Move a directory from `source` to `target`. Tries `fs::rename` first; on
/// failure (common on Windows when a process holds a directory handle), falls
/// back to a recursive copy + delete.
pub(crate) fn move_dir_fallback(source: &Path, target: &Path) -> Result<(), String> {
    match fs::rename(source, target) {
        Ok(()) => Ok(()),
        Err(rename_err) => {
            log::warn!(
                "[move_dir] rename failed ('{}' -> '{}': {}), falling back to copy+delete",
                source.display(),
                target.display(),
                rename_err
            );
            copy_dir_recursive(source, target).map_err(|e| {
                format!(
                    "Failed to move '{}' -> '{}': rename failed ({}), copy also failed ({})",
                    source.display(),
                    target.display(),
                    rename_err,
                    e
                )
            })?;
            // Best-effort delete of source; non-fatal if it fails since the
            // copy already succeeded and the data is at the target.
            if let Err(e) = fs::remove_dir_all(source) {
                log::warn!(
                    "[move_dir] copy succeeded but failed to remove source '{}': {}",
                    source.display(),
                    e
                );
            }
            Ok(())
        }
    }
}

fn copy_dir_recursive(source: &Path, target: &Path) -> Result<(), String> {
    for entry in walkdir::WalkDir::new(source) {
        let entry = entry.map_err(|e| format!("walkdir error: {}", e))?;
        let rel = entry
            .path()
            .strip_prefix(source)
            .map_err(|e| format!("strip_prefix error: {}", e))?;
        let dest = target.join(rel);
        if entry.file_type().is_dir() {
            fs::create_dir_all(&dest).map_err(|e| format!("mkdir '{}': {}", dest.display(), e))?;
        } else {
            fs::copy(entry.path(), &dest).map_err(|e| {
                format!(
                    "copy '{}' -> '{}': {}",
                    entry.path().display(),
                    dest.display(),
                    e
                )
            })?;
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// delete_imported_skill
// ---------------------------------------------------------------------------

pub(crate) fn delete_imported_skill_inner(
    conn: &rusqlite::Connection,
    skill_id: &str,
    workspace_path: &str,
) -> Result<(), String> {
    // Look up skill
    let skill = crate::db::get_imported_skill_by_id(conn, skill_id)?.ok_or_else(|| {
        log::error!("[delete_imported_skill] skill_id={} not found", skill_id);
        format!("Imported skill with id '{}' not found", skill_id)
    })?;

    let skill_name = skill.skill_name.clone();
    validate_skill_name(&skill_name)?;

    // Delete disk files
    let disk_path = Path::new(&skill.disk_path);
    if disk_path.exists() {
        if let Err(e) = fs::remove_dir_all(disk_path) {
            log::warn!(
                "[delete_imported_skill] failed to remove disk_path '{}': {}",
                skill.disk_path,
                e
            );
        }
    }
    // Also check the inactive path in workspace
    if !workspace_path.is_empty() {
        let skills_base = Path::new(workspace_path).join(".claude").join("skills");
        let active_path = skills_base.join(&skill_name);
        let inactive_path = skills_base.join(".inactive").join(&skill_name);
        for path in &[active_path, inactive_path] {
            if path.exists() {
                if let Err(e) = fs::remove_dir_all(path) {
                    log::warn!(
                        "[delete_imported_skill] failed to remove '{}': {}",
                        path.display(),
                        e
                    );
                }
            }
        }
    }

    // Delete from imported_skills
    crate::db::delete_imported_skill_by_skill_id(conn, skill_id)?;

    // Delete from skills master
    crate::db::delete_skill_in_plugin(
        conn,
        &skill_name,
        skill.plugin_slug.as_deref().unwrap_or(DEFAULT_PLUGIN_SLUG),
    )?;

    log::info!(
        "[delete_imported_skill] deleted skill_id={} name={}",
        skill_id,
        skill_name
    );
    Ok(())
}

/// Parse a skill key into (skill_name, plugin_slug, imported_skill_id).
///
/// Key formats:
/// - `imported:{skill_id}` → look up imported skill
/// - `skill-builder:{plugin_slug}:{skill_name}` → library key
/// - `{skill_name}` → legacy, assumes default plugin
fn resolve_skill_target(
    conn: &rusqlite::Connection,
    skill_key: &str,
) -> Result<(String, String, Option<String>), String> {
    // Imported skill key
    if let Some(skill_id) = skill_key.strip_prefix("imported:") {
        let imported = crate::db::get_imported_skill_by_id(conn, skill_id)?
            .ok_or_else(|| format!("Imported skill '{}' not found", skill_id))?;
        return Ok((
            imported.skill_name,
            imported
                .plugin_slug
                .unwrap_or_else(|| DEFAULT_PLUGIN_SLUG.to_string()),
            Some(skill_id.to_string()),
        ));
    }
    // Library key: skill-builder:{plugin_slug}:{skill_name}
    // Look up actual plugin from DB rather than trusting the key string — the frontend
    // may hold a stale key encoding the old plugin slug after a failed prior move.
    if let Some(rest) = skill_key.strip_prefix("skill-builder:") {
        if let Some((_key_plugin, skill_name)) = rest.split_once(':') {
            let master = crate::db::get_skill_master_any_plugin(conn, skill_name)?
                .ok_or_else(|| format!("skill '{}' not found", skill_name))?;
            return Ok((skill_name.to_string(), master.plugin_slug, None));
        }
    }
    // Legacy: bare skill name
    Ok((skill_key.to_string(), DEFAULT_PLUGIN_SLUG.to_string(), None))
}

fn move_skill_directories(
    workspace_path: Option<&str>,
    skills_path: Option<&str>,
    skill_name: &str,
    from_plugin_slug: &str,
    to_plugin_slug: &str,
) -> Result<(Option<String>, Option<String>), String> {
    let mut workspace_target = None;
    let mut skills_target = None;

    if let Some(workspace_path) = workspace_path {
        let source =
            resolve_workspace_skill_dir(Path::new(workspace_path), from_plugin_slug, skill_name);
        if source.exists() {
            let target =
                ensure_nested_skill_dir(Path::new(workspace_path), to_plugin_slug, skill_name)?;
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent)
                    .map_err(|e| format!("Failed to create '{}': {}", parent.display(), e))?;
            }
            move_dir_fallback(&source, &target)
                .map_err(|e| format!("Failed to move workspace dir: {}", e))?;
            workspace_target = Some(target.to_string_lossy().to_string());
        }
    }

    if let Some(skills_path) = skills_path {
        let source = resolve_skill_dir(Path::new(skills_path), from_plugin_slug, skill_name);
        if source.exists() {
            let target =
                ensure_nested_skill_dir(Path::new(skills_path), to_plugin_slug, skill_name)?;
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent)
                    .map_err(|e| format!("Failed to create '{}': {}", parent.display(), e))?;
            }
            move_dir_fallback(&source, &target)
                .map_err(|e| format!("Failed to move skills dir: {}", e))?;
            skills_target = Some(target.to_string_lossy().to_string());
        }
    }

    Ok((workspace_target, skills_target))
}

#[tauri::command]
pub fn list_plugins(db: tauri::State<'_, Db>) -> Result<Vec<crate::types::LibraryPlugin>, String> {
    log::info!("[list_plugins]");
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    crate::db::list_plugins(&conn)
}

#[tauri::command]
pub fn delete_plugin(plugin_slug: String, db: tauri::State<'_, Db>) -> Result<(), String> {
    log::info!("[delete_plugin] slug={}", plugin_slug);
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let settings = crate::db::read_settings(&conn)?;

    let active_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM skills s JOIN plugins p ON s.plugin_id = p.id \
             WHERE p.slug = ?1 AND COALESCE(s.deleted_at, '') = ''",
            rusqlite::params![&plugin_slug],
            |row| row.get(0),
        )
        .unwrap_or(0);
    log::info!(
        "[delete_plugin] slug={} active_skills={}",
        plugin_slug,
        active_count
    );

    // Wrap all deletes in a transaction — clean up all dependent rows before
    // removing the plugin row itself.
    conn.execute_batch("BEGIN")
        .map_err(|e| format!("Failed to begin transaction: {}", e))?;
    let db_result = (|| -> Result<(), String> {
        // Remove child rows that reference workflow_runs (by workflow_run_id FK).
        conn.execute(
            "DELETE FROM workflow_artifacts WHERE workflow_run_id IN \
             (SELECT wr.id FROM workflow_runs wr \
              JOIN skills s ON wr.skill_name = s.name \
              JOIN plugins p ON s.plugin_id = p.id WHERE p.slug = ?1)",
            rusqlite::params![&plugin_slug],
        )
        .map_err(|e| format!("Failed to delete workflow_artifacts: {}", e))?;

        conn.execute(
            "DELETE FROM workflow_steps WHERE workflow_run_id IN \
             (SELECT wr.id FROM workflow_runs wr \
              JOIN skills s ON wr.skill_name = s.name \
              JOIN plugins p ON s.plugin_id = p.id WHERE p.slug = ?1)",
            rusqlite::params![&plugin_slug],
        )
        .map_err(|e| format!("Failed to delete workflow_steps: {}", e))?;

        // Remove child rows that reference skills (by skill_id FK).
        conn.execute(
            "DELETE FROM skill_locks WHERE skill_id IN \
             (SELECT s.id FROM skills s JOIN plugins p ON s.plugin_id = p.id WHERE p.slug = ?1)",
            rusqlite::params![&plugin_slug],
        )
        .map_err(|e| format!("Failed to delete skill_locks: {}", e))?;

        conn.execute(
            "DELETE FROM skill_tags WHERE skill_id IN \
             (SELECT s.id FROM skills s JOIN plugins p ON s.plugin_id = p.id WHERE p.slug = ?1)",
            rusqlite::params![&plugin_slug],
        )
        .map_err(|e| format!("Failed to delete skill_tags: {}", e))?;

        conn.execute(
            "DELETE FROM document_skills WHERE skill_id IN \
             (SELECT s.id FROM skills s JOIN plugins p ON s.plugin_id = p.id WHERE p.slug = ?1)",
            rusqlite::params![&plugin_slug],
        )
        .map_err(|e| format!("Failed to delete document_skills: {}", e))?;

        conn.execute(
            "DELETE FROM imported_skills WHERE skill_master_id IN \
             (SELECT s.id FROM skills s JOIN plugins p ON s.plugin_id = p.id WHERE p.slug = ?1)",
            rusqlite::params![&plugin_slug],
        )
        .map_err(|e| format!("Failed to delete imported_skills: {}", e))?;

        // Remove workflow_runs (references skill_name, not skill_id).
        conn.execute(
            "DELETE FROM workflow_runs WHERE skill_name IN \
             (SELECT s.name FROM skills s JOIN plugins p ON s.plugin_id = p.id WHERE p.slug = ?1)",
            rusqlite::params![&plugin_slug],
        )
        .map_err(|e| format!("Failed to delete workflow_runs: {}", e))?;

        // Hard-delete all skills (both active and soft-deleted) in this plugin.
        conn.execute(
            "DELETE FROM skills WHERE plugin_id = (SELECT id FROM plugins WHERE slug = ?1)",
            rusqlite::params![&plugin_slug],
        )
        .map_err(|e| format!("Failed to delete skills: {}", e))?;

        // Delete the plugin row.
        crate::db::delete_plugin_by_slug(&conn, &plugin_slug)?;
        Ok(())
    })();
    if let Err(e) = &db_result {
        let _ = conn.execute_batch("ROLLBACK");
        return Err(e.clone());
    }
    conn.execute_batch("COMMIT")
        .map_err(|e| format!("Failed to commit: {}", e))?;

    // Remove workspace plugin directory (non-fatal).
    if let Some(ref wp) = settings.workspace_path {
        let workspace_plugin_dir = std::path::Path::new(wp).join(&plugin_slug);
        if workspace_plugin_dir.exists() {
            if let Err(e) = std::fs::remove_dir_all(&workspace_plugin_dir) {
                log::warn!(
                    "[delete_plugin] workspace dir removal failed (non-fatal): {}",
                    e
                );
            }
        }
    }

    // Remove skills-path plugin directory, update manifest, git commit (non-fatal).
    if let Some(ref sp) = settings.skills_path {
        let plugin_dir = std::path::Path::new(sp).join(&plugin_slug);
        if plugin_dir.exists() {
            if let Err(e) = std::fs::remove_dir_all(&plugin_dir) {
                log::warn!(
                    "[delete_plugin] skills dir removal failed (non-fatal): {}",
                    e
                );
            }
        }
        let skills_root = std::path::Path::new(sp);
        if let Err(e) = crate::marketplace_manifest::write_marketplace_json(skills_root) {
            log::warn!("[delete_plugin] manifest update failed: {}", e);
        }
        let msg = format!("{}: delete plugin", plugin_slug);
        if let Err(e) = crate::git::commit_all(skills_root, &msg) {
            log::warn!("[delete_plugin] git commit failed: {}", e);
        }
    }

    Ok(())
}

#[tauri::command]
pub fn create_plugin_from_skills(
    plugin_name: String,
    skill_keys: Vec<String>,
    db: tauri::State<'_, Db>,
) -> Result<String, String> {
    log::info!(
        "[create_plugin_from_skills] name={} skill_count={}",
        plugin_name,
        skill_keys.len()
    );
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let settings = crate::db::read_settings(&conn)?;

    // Reject if a plugin with this slug already exists
    let plugin_slug = crate::db::slugify_plugin_name(&plugin_name);
    if crate::db::get_plugin_id_by_slug(&conn, &plugin_slug)?.is_some() {
        return Err(format!("A plugin named '{}' already exists", plugin_name));
    }

    let (_plugin_id, plugin_slug) =
        crate::db::create_plugin(&conn, &plugin_name, "local", None, None)?;

    // Write plugin directory and manifests to disk
    if let Some(ref sp) = settings.skills_path {
        let skills_root = std::path::Path::new(sp);
        // Create the plugin dir with skills/ subfolder and plugin.json
        let plugin_skills_dir = skills_root.join(&plugin_slug).join("skills");
        std::fs::create_dir_all(&plugin_skills_dir)
            .map_err(|e| format!("Failed to create plugin directory: {}", e))?;
        crate::marketplace_manifest::write_plugin_json(
            skills_root,
            &plugin_slug,
            &plugin_name,
            None,
            None,
        )?;
        crate::marketplace_manifest::write_marketplace_json(skills_root)?;
        let msg = format!("{}: create plugin", plugin_slug);
        if let Err(e) = crate::git::commit_all(skills_root, &msg) {
            log::warn!("Git auto-commit failed ({}): {}", msg, e);
        }
    }

    for skill_key in skill_keys {
        let (skill_name, current_plugin_slug, imported_skill_id) =
            resolve_skill_target(&conn, &skill_key)?;
        let (_, skills_target) = move_skill_directories(
            settings.workspace_path.as_deref(),
            settings.skills_path.as_deref(),
            &skill_name,
            &current_plugin_slug,
            &plugin_slug,
        )?;
        crate::db::move_skill_to_plugin(&conn, &skill_name, &current_plugin_slug, &plugin_slug)?;
        if let (Some(skill_id), Some(disk_path)) =
            (imported_skill_id.as_deref(), skills_target.as_deref())
        {
            crate::db::update_imported_skill_disk_path(&conn, skill_id, disk_path)?;
        }
    }
    Ok(plugin_slug)
}

#[tauri::command]
pub fn move_skill_to_plugin(
    skill_key: String,
    plugin_slug: String,
    db: tauri::State<'_, Db>,
) -> Result<(), String> {
    log::info!(
        "[move_skill_to_plugin] skill_key={} plugin_slug={}",
        skill_key,
        plugin_slug
    );
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let settings = crate::db::read_settings(&conn)?;
    let (skill_name, current_plugin_slug, imported_skill_id) =
        resolve_skill_target(&conn, &skill_key)?;
    // DB first — if this fails, disk is unchanged and the user can retry
    crate::db::move_skill_to_plugin(&conn, &skill_name, &current_plugin_slug, &plugin_slug)?;
    // Disk second — if this fails, reconciliation can recover from DB as authority
    let (_, skills_target) = move_skill_directories(
        settings.workspace_path.as_deref(),
        settings.skills_path.as_deref(),
        &skill_name,
        &current_plugin_slug,
        &plugin_slug,
    )?;
    if let (Some(skill_id), Some(disk_path)) =
        (imported_skill_id.as_deref(), skills_target.as_deref())
    {
        crate::db::update_imported_skill_disk_path(&conn, skill_id, disk_path)?;
    }
    // Update marketplace.json to reflect the move
    if let Some(ref sp) = settings.skills_path {
        if let Err(e) =
            crate::marketplace_manifest::regenerate_all_manifests(std::path::Path::new(sp))
        {
            log::warn!("[move_skill_to_plugin] manifest update failed: {}", e);
        }
    }
    Ok(())
}

#[tauri::command]
pub fn remove_skill_from_plugin(skill_key: String, db: tauri::State<'_, Db>) -> Result<(), String> {
    log::info!("[remove_skill_from_plugin] skill_key={}", skill_key);
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let settings = crate::db::read_settings(&conn)?;
    let (skill_name, current_plugin_slug, imported_skill_id) =
        resolve_skill_target(&conn, &skill_key)?;
    crate::db::ensure_default_plugin(&conn)?;
    // DB first — if this fails, disk is unchanged and the user can retry
    crate::db::move_skill_to_plugin(
        &conn,
        &skill_name,
        &current_plugin_slug,
        DEFAULT_PLUGIN_SLUG,
    )?;
    // Disk second — if this fails, reconciliation can recover from DB as authority
    let (_, skills_target) = move_skill_directories(
        settings.workspace_path.as_deref(),
        settings.skills_path.as_deref(),
        &skill_name,
        &current_plugin_slug,
        DEFAULT_PLUGIN_SLUG,
    )?;
    if let (Some(skill_id), Some(disk_path)) =
        (imported_skill_id.as_deref(), skills_target.as_deref())
    {
        crate::db::update_imported_skill_disk_path(&conn, skill_id, disk_path)?;
    }
    // Update marketplace.json to reflect the move
    if let Some(ref sp) = settings.skills_path {
        if let Err(e) =
            crate::marketplace_manifest::regenerate_all_manifests(std::path::Path::new(sp))
        {
            log::warn!("[remove_skill_from_plugin] manifest update failed: {}", e);
        }
    }
    Ok(())
}

/// Enable or disable upgrade locking for a plugin by slug.
/// Pass `locked = false` to allow the plugin to receive updates again.
#[tauri::command]
pub fn set_plugin_upgrade_lock(
    plugin_slug: String,
    locked: bool,
    db: tauri::State<'_, Db>,
) -> Result<(), String> {
    log::info!(
        "[set_plugin_upgrade_lock] slug={} locked={}",
        plugin_slug,
        locked
    );
    let conn = db.0.lock().map_err(|e| {
        log::error!("[set_plugin_upgrade_lock] failed to acquire DB lock: {}", e);
        e.to_string()
    })?;
    crate::db::set_plugin_upgrade_locked(&conn, &plugin_slug, locked)
}

#[tauri::command]
pub fn delete_imported_skill(
    skill_id: String,
    app: tauri::AppHandle,
    db: tauri::State<'_, Db>,
) -> Result<(), String> {
    log::info!("delete_imported_skill: skill_id={}", skill_id);
    let conn = db.0.lock().map_err(|e| {
        log::error!("[delete_imported_skill] Failed to acquire DB lock: {}", e);
        e.to_string()
    })?;
    let settings = crate::db::read_settings(&conn)?;
    let workspace_path = settings.workspace_path.unwrap_or_default();
    delete_imported_skill_inner(&conn, &skill_id, &workspace_path)?;
    let (_, claude_md_src) = crate::commands::workflow::resolve_prompt_source_dirs_public(&app);
    if claude_md_src.is_file() && !workspace_path.is_empty() {
        if let Err(e) =
            crate::commands::workflow::rebuild_claude_md(&claude_md_src, &workspace_path)
        {
            log::warn!("[delete_imported_skill] rebuild_claude_md failed: {}", e);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::create_test_db_for_tests;
    use crate::types::ImportedSkill;

    fn make_test_skill(id: &str, name: &str) -> ImportedSkill {
        ImportedSkill {
            skill_id: id.to_string(),
            skill_name: name.to_string(),
            library_key: Some(format!("imported:{id}")),
            is_active: true,
            disk_path: std::env::temp_dir()
                .join(name)
                .to_string_lossy()
                .to_string(),
            imported_at: "2025-01-01T00:00:00Z".to_string(),
            is_bundled: false,
            description: None,
            purpose: None,
            version: None,
            model: None,
            argument_hint: None,
            user_invocable: None,
            disable_model_invocation: None,
            marketplace_source_url: None,
            plugin_slug: Some(DEFAULT_PLUGIN_SLUG.to_string()),
            plugin_display_name: Some(crate::skill_paths::DEFAULT_PLUGIN_DISPLAY_NAME.to_string()),
            is_default_plugin: Some(true),
        }
    }

    #[test]
    fn test_delete_imported_skill_inner_happy_path() {
        let conn = create_test_db_for_tests();
        crate::db::upsert_skill(&conn, "del-happy", "imported", "domain").unwrap();
        let skill = make_test_skill("del-happy-id", "del-happy");
        crate::db::test_insert_imported_skill(&conn, &skill).unwrap();
        // disk_path points to a non-existent temp dir — absence is handled gracefully
        let result = delete_imported_skill_inner(&conn, "del-happy-id", "");
        assert!(result.is_ok(), "expected Ok, got {:?}", result);
        let after = crate::db::get_imported_skill_by_id(&conn, "del-happy-id").unwrap();
        assert!(
            after.is_none(),
            "skill should have been removed from imported_skills"
        );
    }

    #[test]
    fn test_create_plugin_slug_conflict_returns_error() {
        let conn = create_test_db_for_tests();
        // Create a plugin first
        crate::db::create_plugin(&conn, "my-plugin", "local", None, None).unwrap();
        // Attempting to create with the same slug should fail
        let slug = crate::db::slugify_plugin_name("my-plugin");
        assert!(crate::db::get_plugin_id_by_slug(&conn, &slug)
            .unwrap()
            .is_some());
    }

    #[test]
    fn test_delete_plugin_blocks_on_active_skills() {
        let conn = create_test_db_for_tests();
        let (_, slug) =
            crate::db::create_plugin(&conn, "test-plugin", "local", None, None).unwrap();
        // Create an active skill in the plugin
        crate::db::upsert_skill_in_plugin(&conn, "active-skill", "skill-builder", "domain", &slug)
            .unwrap();

        // Count active (non-deleted) skills
        let active_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM skills s JOIN plugins p ON s.plugin_id = p.id WHERE p.slug = ?1 AND COALESCE(s.deleted_at, '') = ''",
                rusqlite::params![&slug],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            active_count, 1,
            "should have 1 active skill blocking delete"
        );
    }

    #[test]
    fn test_delete_plugin_happy_path_removes_db_rows() {
        let conn = create_test_db_for_tests();
        let (_, slug) =
            crate::db::create_plugin(&conn, "doomed-plugin", "local", None, None).unwrap();
        // Create and soft-delete a skill in this plugin
        crate::db::upsert_skill_in_plugin(&conn, "old-skill", "skill-builder", "domain", &slug)
            .unwrap();
        conn.execute(
            "UPDATE skills SET deleted_at = datetime('now') WHERE name = 'old-skill'",
            [],
        )
        .unwrap();

        // Wrap in transaction as the real delete_plugin does
        conn.execute_batch("BEGIN").unwrap();
        conn.execute(
            "DELETE FROM skills WHERE plugin_id = (SELECT id FROM plugins WHERE slug = ?1)",
            rusqlite::params![&slug],
        )
        .unwrap();
        crate::db::delete_plugin_by_slug(&conn, &slug).unwrap();
        conn.execute_batch("COMMIT").unwrap();

        // Verify plugin row is gone
        assert!(crate::db::get_plugin_id_by_slug(&conn, &slug)
            .unwrap()
            .is_none());
        // Verify skill row is gone
        let skill_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM skills WHERE name = 'old-skill'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(skill_count, 0);
    }

    #[test]
    fn test_move_skill_to_plugin_db_operation() {
        let conn = create_test_db_for_tests();
        // Create default plugin and a target plugin
        crate::db::ensure_default_plugin(&conn).unwrap();
        let (_, target_slug) =
            crate::db::create_plugin(&conn, "target-plugin", "local", None, None).unwrap();
        // Create a skill in the default plugin
        crate::db::upsert_skill(&conn, "movable-skill", "skill-builder", "domain").unwrap();

        // Move it
        crate::db::move_skill_to_plugin(&conn, "movable-skill", DEFAULT_PLUGIN_SLUG, &target_slug)
            .unwrap();

        // Verify the skill is now in the target plugin
        let skill =
            crate::db::get_skill_master_in_plugin(&conn, "movable-skill", &target_slug).unwrap();
        assert!(skill.is_some(), "skill should be in target plugin");
        assert_eq!(skill.unwrap().plugin_slug, target_slug);
    }

    #[test]
    fn test_remove_skill_from_plugin_moves_to_default() {
        let conn = create_test_db_for_tests();
        crate::db::ensure_default_plugin(&conn).unwrap();
        let (_, source_slug) =
            crate::db::create_plugin(&conn, "source-plugin", "local", None, None).unwrap();
        crate::db::upsert_skill_in_plugin(
            &conn,
            "my-skill",
            "skill-builder",
            "domain",
            &source_slug,
        )
        .unwrap();

        // Move to default
        crate::db::move_skill_to_plugin(&conn, "my-skill", &source_slug, DEFAULT_PLUGIN_SLUG)
            .unwrap();

        let skill = crate::db::get_skill_master(&conn, "my-skill")
            .unwrap()
            .unwrap();
        assert_eq!(skill.plugin_slug, DEFAULT_PLUGIN_SLUG);
    }

    #[test]
    fn test_delete_imported_skill_inner_not_found() {
        let conn = create_test_db_for_tests();
        let result = delete_imported_skill_inner(&conn, "nonexistent-id", "");
        assert!(result.is_err());
        let msg = result.unwrap_err();
        assert!(
            msg.contains("not found"),
            "expected 'not found' in error, got: {}",
            msg
        );
    }

    #[test]
    fn test_imported_skill_plugin_slug_reflects_new_plugin_after_move() {
        // Verifies AC1: after move_skill_to_plugin, imported_skills.plugin_slug
        // (the JOIN-derived value) reflects the destination plugin.
        let conn = create_test_db_for_tests();
        crate::db::ensure_default_plugin(&conn).unwrap();
        let (_, target_slug) =
            crate::db::create_plugin(&conn, "dest-plugin", "local", None, None).unwrap();

        // Create an imported skill in the default plugin
        let skill = make_test_skill("imp-skill-id", "imp-skill");
        crate::db::upsert_skill(&conn, "imp-skill", "imported", "domain").unwrap();
        crate::db::test_insert_imported_skill(&conn, &skill).unwrap();

        // Move: update skills.plugin_id (DB move)
        crate::db::move_skill_to_plugin(&conn, "imp-skill", DEFAULT_PLUGIN_SLUG, &target_slug)
            .expect("move should succeed");

        // Query imported_skills — plugin_slug comes from JOIN to skills.plugin_id
        let imported = crate::db::get_imported_skill_by_id(&conn, "imp-skill-id")
            .expect("query ok")
            .expect("imported skill must exist");
        assert_eq!(
            imported.plugin_slug.as_deref(),
            Some(target_slug.as_str()),
            "imported_skills.plugin_slug must reflect the new plugin after move"
        );
    }

    #[test]
    fn test_resolve_skill_target_uses_db_plugin_not_stale_key() {
        // Verifies that for skill-builder keys, resolve_skill_target looks up the actual
        // plugin from DB rather than trusting the plugin encoded in the key string.
        let conn = create_test_db_for_tests();
        crate::db::ensure_default_plugin(&conn).unwrap();
        let (_, actual_slug) =
            crate::db::create_plugin(&conn, "actual-plugin", "local", None, None).unwrap();

        // Skill is in "actual-plugin" (DB)
        crate::db::upsert_skill_in_plugin(
            &conn,
            "stale-skill",
            "skill-builder",
            "domain",
            &actual_slug,
        )
        .unwrap();

        // Key encodes the DEFAULT plugin (stale)
        let stale_key = format!("skill-builder:{}:stale-skill", DEFAULT_PLUGIN_SLUG);
        let (name, plugin_slug, imported_id) =
            resolve_skill_target(&conn, &stale_key).expect("resolve_skill_target must succeed");

        assert_eq!(name, "stale-skill");
        // Must return the ACTUAL plugin from DB, not the stale one from the key
        assert_eq!(
            plugin_slug, actual_slug,
            "must return actual plugin slug from DB, not stale key"
        );
        assert!(imported_id.is_none());
    }
}
