use crate::db::Db;
use std::fs;
use std::path::Path;

use super::helpers::validate_skill_name;

// ---------------------------------------------------------------------------
// delete_imported_skill
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn delete_imported_skill(skill_id: String, db: tauri::State<'_, Db>) -> Result<(), String> {
    log::info!("delete_imported_skill: skill_id={}", skill_id);
    let conn = db.0.lock().map_err(|e| {
        log::error!("[delete_imported_skill] Failed to acquire DB lock: {}", e);
        e.to_string()
    })?;
    let settings = crate::db::read_settings(&conn)?;
    let workspace_path = settings.workspace_path.unwrap_or_default();

    // Look up skill
    let skill = crate::db::get_imported_skill_by_id(&conn, &skill_id)?
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
        let skills_base = Path::new(&workspace_path).join(".claude").join("skills");
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
    crate::db::delete_imported_skill_by_skill_id(&conn, &skill_id)?;

    // Delete from skills master
    crate::db::delete_skill(&conn, &skill_name)?;

    // Regenerate CLAUDE.md
    if !workspace_path.is_empty() {
        if let Err(e) = crate::commands::workflow::update_skills_section(&workspace_path, &conn) {
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
