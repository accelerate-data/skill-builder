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
    let trimmed = raw.trim_end_matches(|c| c == '/' || c == '\\');
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
    crate::db::write_settings(&conn, &settings)?;
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
pub fn set_log_level(verbose: bool) -> Result<(), String> {
    crate::logging::set_log_level(verbose);
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
}
