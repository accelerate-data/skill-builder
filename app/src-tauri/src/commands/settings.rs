use std::fs;

use tauri::Manager;

use crate::db::Db;
use crate::types::AppSettings;

#[tauri::command]
pub fn get_data_dir(app: tauri::AppHandle) -> Result<String, String> {
    log::info!("[get_data_dir]");
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
    log::info!("[get_settings]");
    let conn = db.0.lock().map_err(|e| {
        log::error!("[get_settings] Failed to acquire DB lock: {}", e);
        e.to_string()
    })?;
    crate::db::read_settings_hydrated(&conn)
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
    log::info!("[save_settings]");
    let mut settings = settings;
    // Normalize skills_path before persisting
    if let Some(ref sp) = settings.skills_path {
        let normalized = normalize_path(sp);
        settings.skills_path = Some(normalized);
    }

    let conn = db.0.lock().map_err(|e| {
        log::error!("[save_settings] Failed to acquire DB lock: {}", e);
        e.to_string()
    })?;

    // Handle skills_path changes: first set → init; changed → move
    let old_settings = crate::db::read_settings(&conn)?;
    let old_sp = old_settings.skills_path.as_deref();
    let new_sp = settings.skills_path.as_deref();
    handle_skills_path_change(old_sp, new_sp)?;

    // Log what changed
    let changes = diff_settings(&old_settings, &settings);
    if changes.is_empty() {
        log::info!("[save_settings] no changes");
    } else {
        log::info!("[save_settings] {}", changes.join(", "));
    }

    crate::db::write_settings(&conn, &settings)?;
    Ok(())
}

/// Compare old and new settings, returning a list of human-readable changes.
/// Skips sensitive fields (API key, OAuth token) and auth-managed fields.
fn diff_settings(old: &AppSettings, new: &AppSettings) -> Vec<String> {
    let mut changes = Vec::new();
    macro_rules! cmp_opt {
        ($field:ident, $label:expr) => {
            if old.$field != new.$field {
                changes.push(format!(
                    "{}={}",
                    $label,
                    new.$field.as_deref().unwrap_or("(none)")
                ));
            }
        };
    }
    macro_rules! cmp_bool {
        ($field:ident, $label:expr) => {
            if old.$field != new.$field {
                changes.push(format!("{}={}", $label, new.$field));
            }
        };
    }
    macro_rules! cmp_val {
        ($field:ident, $label:expr) => {
            if old.$field != new.$field {
                changes.push(format!("{}={}", $label, new.$field));
            }
        };
    }
    // Skip: anthropic_api_key (sensitive), github_oauth_token/login/avatar/email (auth-managed)
    cmp_opt!(skills_path, "skills_path");
    cmp_opt!(preferred_model, "preferred_model");
    cmp_val!(log_level, "log_level");
    cmp_bool!(extended_context, "extended_context");
    cmp_bool!(extended_thinking, "extended_thinking");
    cmp_opt!(marketplace_url, "marketplace_url");
    cmp_val!(max_dimensions, "max_dimensions");
    cmp_opt!(industry, "industry");
    cmp_opt!(function_role, "function_role");
    cmp_opt!(dashboard_view_mode, "dashboard_view_mode");
    cmp_bool!(auto_update, "auto_update");
    changes
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
    log::info!("[test_api_key]");
    let client = reqwest::Client::new();
    let resp = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", &api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .body(
            serde_json::json!({
                "model": "claude-haiku-4-5",
                "max_tokens": 1,
                "messages": [{"role": "user", "content": "hi"}]
            })
            .to_string(),
        )
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let status = resp.status().as_u16();
    match status {
        400 | 401 => Err("Invalid API key".to_string()),
        403 => Err("API key is disabled".to_string()),
        _ => Ok(true),
    }
}

#[derive(serde::Serialize, serde::Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    pub id: String,
    pub display_name: String,
}

#[derive(serde::Deserialize)]
struct ModelsApiResponse {
    data: Vec<ModelsApiItem>,
}

#[derive(serde::Deserialize)]
struct ModelsApiItem {
    id: String,
    display_name: String,
}

/// Fetch the list of models available for the given API key from the Anthropic API.
/// Returns models sorted as returned by the API (newest first).
#[tauri::command]
pub async fn list_models(api_key: String) -> Result<Vec<ModelInfo>, String> {
    log::info!("[list_models]");
    let client = reqwest::Client::new();
    let resp = client
        .get("https://api.anthropic.com/v1/models")
        .header("x-api-key", &api_key)
        .header("anthropic-version", "2023-06-01")
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("API error: {}", resp.status()));
    }

    let body: ModelsApiResponse = resp.json().await.map_err(|e| format!("Parse error: {}", e))?;
    let models = body
        .data
        .into_iter()
        .filter(|m| m.id.starts_with("claude-"))
        .map(|m| ModelInfo { id: m.id, display_name: m.display_name })
        .collect();

    Ok(models)
}

#[tauri::command]
pub fn set_log_level(level: String) -> Result<(), String> {
    log::info!("[set_log_level] level={}", level);
    crate::logging::set_log_level(&level);
    Ok(())
}

#[tauri::command]
pub fn get_log_file_path(app: tauri::AppHandle) -> Result<String, String> {
    log::info!("[get_log_file_path]");
    crate::logging::get_log_file_path(&app)
}

#[tauri::command]
pub fn get_default_skills_path() -> Result<String, String> {
    log::info!("[get_default_skills_path]");
    let home = dirs::home_dir()
        .ok_or_else(|| "Could not determine home directory".to_string())?;
    let path = home.join("skill-builder");
    path.to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "Path contains invalid UTF-8".to_string())
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

    #[test]
    fn test_get_default_skills_path_returns_home_skill_builder() {
        let result = get_default_skills_path().unwrap();
        assert!(result.ends_with("/skill-builder") || result.ends_with("\\skill-builder"));
        // Should be an absolute path
        assert!(result.starts_with('/') || result.chars().nth(1) == Some(':'));
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

    #[test]
    fn test_skills_path_change_does_not_affect_db_records() {
        // Workflow runs are keyed by skill_name (not path), so changing
        // skills_path should leave DB records intact and resolvable.
        let conn = crate::commands::test_utils::create_test_db();
        crate::db::save_workflow_run(&conn, "my-skill", 3, "in_progress", "domain").unwrap();

        let dir = tempfile::tempdir().unwrap();
        let old_path = dir.path().join("old-skills");
        let new_path = dir.path().join("new-skills");

        // Set up old path with the skill directory
        fs::create_dir_all(old_path.join("my-skill")).unwrap();
        fs::write(old_path.join("my-skill").join("SKILL.md"), "# Test").unwrap();

        // Migrate
        handle_skills_path_change(
            Some(old_path.to_str().unwrap()),
            Some(new_path.to_str().unwrap()),
        )
        .unwrap();

        // Verify DB records are unchanged — skill_name still resolves
        let run = crate::db::get_workflow_run(&conn, "my-skill").unwrap().unwrap();
        assert_eq!(run.skill_name, "my-skill");
        assert_eq!(run.current_step, 3);
        assert_eq!(run.status, "in_progress");

        // And the skill files are at the new location
        assert!(new_path.join("my-skill").join("SKILL.md").exists());
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
