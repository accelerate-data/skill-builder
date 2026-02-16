use std::fs;

use tauri::Manager;

use crate::db::Db;
use crate::types::AppSettings;

#[tauri::command]
pub fn get_data_dir(app: tauri::AppHandle) -> Result<String, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get data directory: {}", e))?;

    if !data_dir.exists() {
        fs::create_dir_all(&data_dir)
            .map_err(|e| format!("Failed to create data directory: {}", e))?;
    }

    data_dir
        .to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "Data directory path contains invalid UTF-8".to_string())
}

#[tauri::command]
pub fn get_settings(db: tauri::State<'_, Db>) -> Result<AppSettings, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    crate::db::read_settings(&conn)
}

/// Normalize a path: strip trailing separators and deduplicate the last
/// segment when the macOS file picker doubles it (e.g. `/foo/Skills/Skills`
/// becomes `/foo/Skills`).
fn normalize_path(raw: &str) -> String {
    let trimmed = raw.trim_end_matches(['/', '\\']);
    let parts: Vec<&str> = trimmed.split('/').collect();
    if parts.len() >= 2 && parts[parts.len() - 1] == parts[parts.len() - 2] {
        parts[..parts.len() - 1].join("/")
    } else {
        trimmed.to_string()
    }
}

#[tauri::command]
pub fn save_settings(
    db: tauri::State<'_, Db>,
    settings: AppSettings,
) -> Result<(), String> {
    let mut settings = settings;
    // Normalize skills_path before persisting
    if let Some(ref sp) = settings.skills_path {
        let normalized = normalize_path(sp);
        settings.skills_path = Some(normalized);
    }

    let conn = db.0.lock().map_err(|e| e.to_string())?;

    // Handle skills_path changes: first set → init; changed → move
    let old_settings = crate::db::read_settings(&conn)?;
    let old_sp = old_settings.skills_path.as_deref();
    let new_sp = settings.skills_path.as_deref();
    handle_skills_path_change(old_sp, new_sp)?;

    crate::db::write_settings(&conn, &settings)?;
    Ok(())
}

/// Handle skills_path init or move when the setting changes.
fn handle_skills_path_change(old: Option<&str>, new: Option<&str>) -> Result<(), String> {
    match (old, new) {
        (None, Some(new_path)) => {
            // First set: create directory + init git repo
            let path = std::path::Path::new(new_path);
            fs::create_dir_all(path)
                .map_err(|e| format!("Failed to create skills directory {}: {}", new_path, e))?;
            if let Err(e) = crate::git::ensure_repo(path) {
                log::warn!("Failed to init git repo at {}: {}", new_path, e);
            }
        }
        (Some(old_path), Some(new_path)) if old_path != new_path => {
            // Changed: move contents from old → new
            let old = std::path::Path::new(old_path);
            let new = std::path::Path::new(new_path);

            if !old.exists() {
                // Old doesn't exist, just create new + init
                fs::create_dir_all(new)
                    .map_err(|e| format!("Failed to create skills directory {}: {}", new_path, e))?;
                if let Err(e) = crate::git::ensure_repo(new) {
                    log::warn!("Failed to init git repo at {}: {}", new_path, e);
                }
                return Ok(());
            }

            if new.exists() {
                // Check if new directory is empty (or just has hidden files)
                let has_content = fs::read_dir(new)
                    .map(|entries| entries.filter_map(|e| e.ok()).any(|e| {
                        !e.file_name().to_string_lossy().starts_with('.')
                    }))
                    .unwrap_or(false);
                if has_content {
                    return Err(format!(
                        "Cannot move skills to {}: directory already has content",
                        new_path
                    ));
                }
            }

            // Try rename first (same filesystem), fall back to recursive copy
            move_directory(old, new).map_err(|e| {
                format!(
                    "Failed to move skills from {} to {}: {}",
                    old_path, new_path, e
                )
            })?;

            // Ensure git repo exists at new location and record the migration
            if let Err(e) = crate::git::ensure_repo(new) {
                log::warn!("Failed to ensure git repo at {}: {}", new_path, e);
            } else {
                let msg = format!("Moved skills from {} to {}", old_path, new_path);
                if let Err(e) = crate::git::commit_all(new, &msg) {
                    log::warn!("Failed to record skills_path migration: {}", e);
                }
            }
        }
        _ => {} // Same path or both None — no-op
    }
    Ok(())
}

/// Move a directory from src to dst. Tries rename first, falls back to recursive copy + delete.
fn move_directory(src: &std::path::Path, dst: &std::path::Path) -> Result<(), String> {
    // Ensure parent of dst exists
    if let Some(parent) = dst.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create parent directory: {}", e))?;
    }

    // Try rename (fast, same-device only)
    if fs::rename(src, dst).is_ok() {
        return Ok(());
    }

    // Fall back to recursive copy + delete (cross-device)
    copy_dir_recursive(src, dst)?;
    fs::remove_dir_all(src).map_err(|e| format!("Failed to remove old directory: {}", e))?;
    Ok(())
}

/// Recursively copy a directory.
fn copy_dir_recursive(src: &std::path::Path, dst: &std::path::Path) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| format!("Failed to create {}: {}", dst.display(), e))?;

    for entry in fs::read_dir(src).map_err(|e| format!("Failed to read {}: {}", src.display(), e))? {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());

        if src_path.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            fs::copy(&src_path, &dst_path).map_err(|e| {
                format!("Failed to copy {} to {}: {}", src_path.display(), dst_path.display(), e)
            })?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn test_api_key(api_key: String) -> Result<bool, String> {
    let client = reqwest::Client::new();
    let resp = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", &api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .body(
            serde_json::json!({
                "model": "claude-sonnet-4-5-20250929",
                "max_tokens": 1,
                "messages": [{"role": "user", "content": "hi"}]
            })
            .to_string(),
        )
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let status = resp.status().as_u16();
    Ok(status != 401)
}

#[tauri::command]
pub fn set_log_level(level: String) -> Result<(), String> {
    crate::logging::set_log_level(&level);
    Ok(())
}

#[tauri::command]
pub fn get_log_file_path(app: tauri::AppHandle) -> Result<String, String> {
    crate::logging::get_log_file_path(&app)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_path_no_change_needed() {
        assert_eq!(normalize_path("/Users/me/Skills"), "/Users/me/Skills");
    }

    #[test]
    fn test_normalize_path_strips_trailing_slash() {
        assert_eq!(normalize_path("/Users/me/Skills/"), "/Users/me/Skills");
    }

    #[test]
    fn test_normalize_path_strips_duplicate_last_segment() {
        assert_eq!(
            normalize_path("/Users/me/Skills/Skills"),
            "/Users/me/Skills"
        );
    }

    #[test]
    fn test_normalize_path_strips_duplicate_with_trailing_slash() {
        assert_eq!(
            normalize_path("/Users/me/Skills/Skills/"),
            "/Users/me/Skills"
        );
    }

    #[test]
    fn test_normalize_path_no_false_positive_on_different_segments() {
        // Different last two segments should NOT be deduplicated
        assert_eq!(
            normalize_path("/Users/me/Skills/Output"),
            "/Users/me/Skills/Output"
        );
    }

    #[test]
    fn test_normalize_path_single_segment() {
        assert_eq!(normalize_path("/Skills"), "/Skills");
    }

    #[test]
    fn test_normalize_path_root_duplicate() {
        // Edge case: root-level duplicate
        assert_eq!(normalize_path("/Skills/Skills"), "/Skills");
    }

    // ===== handle_skills_path_change tests =====

    #[test]
    fn test_skills_path_first_set_creates_dir_and_git() {
        let dir = tempfile::tempdir().unwrap();
        let new_path = dir.path().join("skills-output");
        let new_str = new_path.to_str().unwrap();

        handle_skills_path_change(None, Some(new_str)).unwrap();

        assert!(new_path.exists());
        assert!(new_path.join(".git").exists());
    }

    #[test]
    fn test_skills_path_change_moves_contents() {
        let dir = tempfile::tempdir().unwrap();
        let old_path = dir.path().join("old-skills");
        let new_path = dir.path().join("new-skills");

        // Set up old path with a skill
        fs::create_dir_all(old_path.join("my-skill")).unwrap();
        fs::write(old_path.join("my-skill").join("SKILL.md"), "# Skill").unwrap();

        handle_skills_path_change(
            Some(old_path.to_str().unwrap()),
            Some(new_path.to_str().unwrap()),
        )
        .unwrap();

        // Old should be gone, new should have the content
        assert!(!old_path.exists());
        assert!(new_path.join("my-skill").join("SKILL.md").exists());
        assert_eq!(
            fs::read_to_string(new_path.join("my-skill").join("SKILL.md")).unwrap(),
            "# Skill"
        );
    }

    #[test]
    fn test_skills_path_change_preserves_git_history() {
        let dir = tempfile::tempdir().unwrap();
        let old_path = dir.path().join("old");
        let new_path = dir.path().join("new");

        // Set up old path with git repo and a commit
        fs::create_dir_all(&old_path).unwrap();
        crate::git::ensure_repo(&old_path).unwrap();
        fs::create_dir_all(old_path.join("my-skill")).unwrap();
        fs::write(old_path.join("my-skill").join("SKILL.md"), "# V1").unwrap();
        crate::git::commit_all(&old_path, "v1").unwrap();

        handle_skills_path_change(
            Some(old_path.to_str().unwrap()),
            Some(new_path.to_str().unwrap()),
        )
        .unwrap();

        // Git history should be preserved at new location
        let history = crate::git::get_history(&new_path, "my-skill", 50).unwrap();
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].message, "v1");
    }

    #[test]
    fn test_skills_path_change_rejects_nonempty_target() {
        let dir = tempfile::tempdir().unwrap();
        let old_path = dir.path().join("old");
        let new_path = dir.path().join("new");

        fs::create_dir_all(&old_path).unwrap();
        fs::create_dir_all(new_path.join("existing-skill")).unwrap();
        fs::write(
            new_path.join("existing-skill").join("SKILL.md"),
            "already here",
        )
        .unwrap();

        let result = handle_skills_path_change(
            Some(old_path.to_str().unwrap()),
            Some(new_path.to_str().unwrap()),
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("already has content"));
    }

    #[test]
    fn test_skills_path_same_is_noop() {
        let result = handle_skills_path_change(Some("/same/path"), Some("/same/path"));
        assert!(result.is_ok());
    }

    #[test]
    fn test_skills_path_both_none_is_noop() {
        let result = handle_skills_path_change(None, None);
        assert!(result.is_ok());
    }

    #[test]
    fn test_skills_path_change_old_missing_creates_new() {
        let dir = tempfile::tempdir().unwrap();
        let new_path = dir.path().join("new-skills");

        // Old path doesn't exist
        handle_skills_path_change(Some("/nonexistent/old"), Some(new_path.to_str().unwrap()))
            .unwrap();

        assert!(new_path.exists());
        assert!(new_path.join(".git").exists());
    }

    // ===== move_directory tests =====

    #[test]
    fn test_move_directory_same_device() {
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("src");
        let dst = dir.path().join("dst");

        fs::create_dir_all(src.join("sub")).unwrap();
        fs::write(src.join("file.txt"), "hello").unwrap();
        fs::write(src.join("sub").join("nested.txt"), "nested").unwrap();

        move_directory(&src, &dst).unwrap();

        assert!(!src.exists());
        assert_eq!(fs::read_to_string(dst.join("file.txt")).unwrap(), "hello");
        assert_eq!(
            fs::read_to_string(dst.join("sub").join("nested.txt")).unwrap(),
            "nested"
        );
    }
}
