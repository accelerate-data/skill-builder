use crate::db::Db;
use crate::types::ImportedSkill;
use std::fs;
use std::path::Path;

use super::helpers::add_dir_to_zip;

// ---------------------------------------------------------------------------
// list_imported_skills
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn list_imported_skills(
    source_url: Option<String>,
    db: tauri::State<'_, Db>,
) -> Result<Vec<ImportedSkill>, String> {
    log::info!("list_imported_skills: source_url={:?}", source_url);
    let conn = db.0.lock().map_err(|e| {
        log::error!("[list_imported_skills] Failed to acquire DB lock: {}", e);
        e.to_string()
    })?;
    crate::db::list_imported_skills_filtered(&conn, source_url.as_deref())
}

// ---------------------------------------------------------------------------
// get_skill_content
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_skill_content(skill_name: String, db: tauri::State<'_, Db>) -> Result<String, String> {
    log::info!("[get_skill_content] skill_name={}", skill_name);
    let conn = db.0.lock().map_err(|e| {
        log::error!("[get_skill_content] Failed to acquire DB lock: {}", e);
        e.to_string()
    })?;
    let skill = crate::db::get_imported_skill(&conn, &skill_name)?
        .ok_or_else(|| format!("Imported skill '{}' not found", skill_name))?;

    let skill_md_path = Path::new(&skill.disk_path).join("SKILL.md");
    fs::read_to_string(&skill_md_path).map_err(|e| format!("Failed to read SKILL.md: {}", e))
}

// ---------------------------------------------------------------------------
// export_skill
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn export_skill(skill_name: String, db: tauri::State<'_, Db>) -> Result<String, String> {
    log::info!("[export_skill] skill_name={}", skill_name);
    let conn = db.0.lock().map_err(|e| {
        log::error!("[export_skill] Failed to acquire DB lock: {}", e);
        e.to_string()
    })?;

    let skill = crate::db::get_imported_skill(&conn, &skill_name)?
        .ok_or_else(|| format!("Skill '{}' not found", skill_name))?;

    let skill_dir = Path::new(&skill.disk_path);
    if !skill_dir.is_dir() {
        return Err(format!("Skill directory not found: {}", skill.disk_path));
    }

    let tmp_dir = std::env::temp_dir();
    let zip_path = tmp_dir.join(format!("{}.zip", skill_name));

    let file =
        fs::File::create(&zip_path).map_err(|e| format!("Failed to create zip file: {}", e))?;
    let mut writer = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    // Walk the skill directory and add files with skill name as root prefix
    add_dir_to_zip(&mut writer, skill_dir, &skill_name, &options)?;

    writer
        .finish()
        .map_err(|e| format!("Failed to finalize zip: {}", e))?;

    log::info!("[export_skill] exported to {}", zip_path.display());
    Ok(zip_path.to_string_lossy().to_string())
}
