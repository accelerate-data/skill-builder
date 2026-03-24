use crate::db::Db;
use crate::skill_paths::{ensure_nested_skill_dir, resolve_skill_dir, DEFAULT_PLUGIN_SLUG};
use std::fs;
use std::path::Path;

use super::helpers::validate_skill_name;

// ---------------------------------------------------------------------------
// delete_imported_skill
// ---------------------------------------------------------------------------

pub(crate) fn delete_imported_skill_inner(
    conn: &rusqlite::Connection,
    skill_id: &str,
    workspace_path: &str,
) -> Result<(), String> {
    // Look up skill
    let skill = crate::db::get_imported_skill_by_id(conn, skill_id)?
        .ok_or_else(|| {
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

    // Regenerate CLAUDE.md
    if !workspace_path.is_empty() {
        if let Err(e) = crate::commands::workflow::update_skills_section(workspace_path, conn) {
            log::warn!(
                "[delete_imported_skill] update_skills_section failed: {}",
                e
            );
        }
    }

    log::info!(
        "[delete_imported_skill] deleted skill_id={} name={}",
        skill_id,
        skill_name
    );
    Ok(())
}

fn resolve_skill_target(
    conn: &rusqlite::Connection,
    skill_key: &str,
) -> Result<(String, String, Option<String>), String> {
    if let Some(skill_id) = skill_key.strip_prefix("imported:") {
        let imported = crate::db::get_imported_skill_by_id(conn, skill_id)?
            .ok_or_else(|| format!("Imported skill '{}' not found", skill_id))?;
        return Ok((
            imported.skill_name,
            imported.plugin_slug.unwrap_or_else(|| DEFAULT_PLUGIN_SLUG.to_string()),
            Some(skill_id.to_string()),
        ));
    }
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
        let source = resolve_skill_dir(Path::new(workspace_path), from_plugin_slug, skill_name);
        if source.exists() {
            let target = ensure_nested_skill_dir(Path::new(workspace_path), to_plugin_slug, skill_name)?;
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent).map_err(|e| format!("Failed to create '{}': {}", parent.display(), e))?;
            }
            fs::rename(&source, &target)
                .map_err(|e| format!("Failed to move workspace dir '{}' -> '{}': {}", source.display(), target.display(), e))?;
            workspace_target = Some(target.to_string_lossy().to_string());
        }
    }

    if let Some(skills_path) = skills_path {
        let source = resolve_skill_dir(Path::new(skills_path), from_plugin_slug, skill_name);
        if source.exists() {
            let target = ensure_nested_skill_dir(Path::new(skills_path), to_plugin_slug, skill_name)?;
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent).map_err(|e| format!("Failed to create '{}': {}", parent.display(), e))?;
            }
            fs::rename(&source, &target)
                .map_err(|e| format!("Failed to move skills dir '{}' -> '{}': {}", source.display(), target.display(), e))?;
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

    // Check for active (non-deleted) skills — refuse to delete if any exist
    let active_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM skills s JOIN plugins p ON s.plugin_id = p.id WHERE p.slug = ?1 AND COALESCE(s.deleted_at, '') = ''",
            rusqlite::params![&plugin_slug],
            |row| row.get(0),
        )
        .unwrap_or(0);
    if active_count > 0 {
        return Err(format!(
            "Cannot delete plugin '{}' — it still has {} active skill(s). Remove them first.",
            plugin_slug, active_count
        ));
    }

    // Hard-delete any soft-deleted skills so FK RESTRICT doesn't block plugin deletion
    conn.execute(
        "DELETE FROM skills WHERE plugin_id = (SELECT id FROM plugins WHERE slug = ?1)",
        rusqlite::params![&plugin_slug],
    ).map_err(|e| format!("Failed to clean up deleted skills: {}", e))?;

    // Now delete the plugin row
    crate::db::delete_plugin_by_slug(&conn, &plugin_slug)?;

    // Remove from disk
    if let Some(ref sp) = settings.skills_path {
        let plugin_dir = std::path::Path::new(sp).join(&plugin_slug);
        if plugin_dir.exists() {
            std::fs::remove_dir_all(&plugin_dir)
                .map_err(|e| format!("Failed to remove plugin directory: {}", e))?;
        }
        // Update marketplace.json
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
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let settings = crate::db::read_settings(&conn)?;
    let (_plugin_id, plugin_slug) =
        crate::db::create_plugin(&conn, &plugin_name, "local", None, None)?;

    // Write plugin directory and manifests to disk
    if let Some(ref sp) = settings.skills_path {
        let skills_root = std::path::Path::new(sp);
        // Create the plugin dir with skills/ subfolder and plugin.json
        let plugin_skills_dir = skills_root.join(&plugin_slug).join("skills");
        std::fs::create_dir_all(&plugin_skills_dir).map_err(|e| format!("Failed to create plugin directory: {}", e))?;
        crate::marketplace_manifest::write_plugin_json(skills_root, &plugin_slug, &plugin_name, None, None)?;
        crate::marketplace_manifest::write_marketplace_json(skills_root)?;
        let msg = format!("{}: create plugin", plugin_slug);
        if let Err(e) = crate::git::commit_all(skills_root, &msg) {
            log::warn!("Git auto-commit failed ({}): {}", msg, e);
        }
    }

    for skill_key in skill_keys {
        let (skill_name, current_plugin_slug, imported_skill_id) = resolve_skill_target(&conn, &skill_key)?;
        let (_, skills_target) = move_skill_directories(
            settings.workspace_path.as_deref(),
            settings.skills_path.as_deref(),
            &skill_name,
            &current_plugin_slug,
            &plugin_slug,
        )?;
        crate::db::move_skill_to_plugin(&conn, &skill_name, &current_plugin_slug, &plugin_slug)?;
        if let (Some(skill_id), Some(disk_path)) = (imported_skill_id.as_deref(), skills_target.as_deref()) {
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
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let settings = crate::db::read_settings(&conn)?;
    let (skill_name, current_plugin_slug, imported_skill_id) = resolve_skill_target(&conn, &skill_key)?;
    let (_, skills_target) = move_skill_directories(
        settings.workspace_path.as_deref(),
        settings.skills_path.as_deref(),
        &skill_name,
        &current_plugin_slug,
        &plugin_slug,
    )?;
    crate::db::move_skill_to_plugin(&conn, &skill_name, &current_plugin_slug, &plugin_slug)
        .and_then(|_| {
            if let (Some(skill_id), Some(disk_path)) = (imported_skill_id.as_deref(), skills_target.as_deref()) {
                crate::db::update_imported_skill_disk_path(&conn, skill_id, disk_path)?;
            }
            Ok(())
        })
}

#[tauri::command]
pub fn remove_skill_from_plugin(
    skill_key: String,
    db: tauri::State<'_, Db>,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let settings = crate::db::read_settings(&conn)?;
    let (skill_name, current_plugin_slug, imported_skill_id) = resolve_skill_target(&conn, &skill_key)?;
    crate::db::ensure_default_plugin(&conn)?;
    let (_, skills_target) = move_skill_directories(
        settings.workspace_path.as_deref(),
        settings.skills_path.as_deref(),
        &skill_name,
        &current_plugin_slug,
        DEFAULT_PLUGIN_SLUG,
    )?;
    crate::db::move_skill_to_plugin(&conn, &skill_name, &current_plugin_slug, DEFAULT_PLUGIN_SLUG)
        .and_then(|_| {
            if let (Some(skill_id), Some(disk_path)) = (imported_skill_id.as_deref(), skills_target.as_deref()) {
                crate::db::update_imported_skill_disk_path(&conn, skill_id, disk_path)?;
            }
            Ok(())
        })
}

#[tauri::command]
pub fn delete_imported_skill(skill_id: String, db: tauri::State<'_, Db>) -> Result<(), String> {
    log::info!("delete_imported_skill: skill_id={}", skill_id);
    let conn = db.0.lock().map_err(|e| {
        log::error!("[delete_imported_skill] Failed to acquire DB lock: {}", e);
        e.to_string()
    })?;
    let settings = crate::db::read_settings(&conn)?;
    let workspace_path = settings.workspace_path.unwrap_or_default();
    delete_imported_skill_inner(&conn, &skill_id, &workspace_path)
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
        let skill = make_test_skill("del-happy-id", "del-happy");
        crate::db::test_insert_imported_skill(&conn, &skill).unwrap();
        // disk_path points to a non-existent temp dir — absence is handled gracefully
        let result = delete_imported_skill_inner(&conn, "del-happy-id", "");
        assert!(result.is_ok(), "expected Ok, got {:?}", result);
        let after = crate::db::get_imported_skill_by_id(&conn, "del-happy-id").unwrap();
        assert!(after.is_none(), "skill should have been removed from imported_skills");
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
}
