use std::path::Path;

use crate::db::Db;
use crate::types::{SkillCommit, SkillDiff};

/// Resolve the skill output root: skills_path if configured, else workspace_path.
fn resolve_output_root(db: &Db, workspace_path: &str) -> Result<String, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let settings = crate::db::read_settings(&conn)?;
    Ok(settings
        .skills_path
        .unwrap_or_else(|| workspace_path.to_string()))
}

#[tauri::command]
pub fn get_skill_history(
    workspace_path: String,
    skill_name: String,
    limit: Option<usize>,
    db: tauri::State<'_, Db>,
) -> Result<Vec<SkillCommit>, String> {
    log::info!("[get_skill_history] skill={} limit={:?}", skill_name, limit);
    let output_root = resolve_output_root(&db, &workspace_path)?;
    let root = Path::new(&output_root);
    if !root.join(".git").exists() {
        return Ok(Vec::new());
    }
    crate::git::get_history(root, &skill_name, limit.unwrap_or(100))
}

#[tauri::command]
pub fn get_skill_diff(
    workspace_path: String,
    skill_name: String,
    sha_a: String,
    sha_b: String,
    db: tauri::State<'_, Db>,
) -> Result<SkillDiff, String> {
    log::info!("[get_skill_diff] skill={} sha_a={} sha_b={}", skill_name, sha_a, sha_b);
    let output_root = resolve_output_root(&db, &workspace_path)?;
    crate::git::get_diff(Path::new(&output_root), &sha_a, &sha_b, &skill_name)
}

#[tauri::command]
pub fn restore_skill_version(
    workspace_path: String,
    skill_name: String,
    sha: String,
    db: tauri::State<'_, Db>,
) -> Result<(), String> {
    log::info!("[restore_skill_version] skill={} sha={}", skill_name, sha);
    let output_root = resolve_output_root(&db, &workspace_path)?;
    let root = Path::new(&output_root);
    crate::git::restore_version(root, &sha, &skill_name)?;
    // Commit the restore as a new version
    let short_sha = if sha.len() >= 8 { &sha[..8] } else { &sha };
    let msg = format!("{}: restored to {}", skill_name, short_sha);
    if let Err(e) = crate::git::commit_all(root, &msg) {
        log::error!(
            "Git auto-commit failed after restore ({}): {}. Filesystem restored but git state is inconsistent.",
            msg, e
        );
    }
    Ok(())
}
