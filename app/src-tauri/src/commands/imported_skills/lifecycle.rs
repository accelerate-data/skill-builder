use crate::db::Db;
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
        skill.plugin_slug.as_deref().unwrap_or("no-plugin"),
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
) -> Result<(String, String), String> {
    if let Some(skill_id) = skill_key.strip_prefix("imported:") {
        let imported = crate::db::get_imported_skill_by_id(conn, skill_id)?
            .ok_or_else(|| format!("Imported skill '{}' not found", skill_id))?;
        return Ok((
            imported.skill_name,
            imported.plugin_slug.unwrap_or_else(|| "no-plugin".to_string()),
        ));
    }
    Ok((skill_key.to_string(), "no-plugin".to_string()))
}

#[tauri::command]
pub fn create_plugin_from_skills(
    plugin_name: String,
    skill_keys: Vec<String>,
    db: tauri::State<'_, Db>,
) -> Result<String, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let (_plugin_id, plugin_slug) =
        crate::db::create_plugin(&conn, &plugin_name, "local", None, None)?;
    for skill_key in skill_keys {
        let (skill_name, current_plugin_slug) = resolve_skill_target(&conn, &skill_key)?;
        crate::db::move_skill_to_plugin(&conn, &skill_name, &current_plugin_slug, &plugin_slug)?;
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
    let (skill_name, current_plugin_slug) = resolve_skill_target(&conn, &skill_key)?;
    crate::db::move_skill_to_plugin(&conn, &skill_name, &current_plugin_slug, &plugin_slug)
}

#[tauri::command]
pub fn remove_skill_from_plugin(
    skill_key: String,
    db: tauri::State<'_, Db>,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let (skill_name, current_plugin_slug) = resolve_skill_target(&conn, &skill_key)?;
    crate::db::ensure_default_plugin(&conn)?;
    crate::db::move_skill_to_plugin(&conn, &skill_name, &current_plugin_slug, "no-plugin")
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
            plugin_slug: Some("no-plugin".to_string()),
            plugin_display_name: Some("No Plugin".to_string()),
            is_default_plugin: Some(true),
        }
    }

    #[test]
    fn test_delete_imported_skill_inner_happy_path() {
        let conn = create_test_db_for_tests();
        let skill = make_test_skill("del-happy-id", "del-happy");
        crate::db::insert_imported_skill(&conn, &skill).unwrap();
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
