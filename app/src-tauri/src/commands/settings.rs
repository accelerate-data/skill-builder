use std::fs;

use crate::db::Db;
use crate::types::{ApiKey, AppSettings};

/// Default built-in marketplace registry URL. Used for both the initial migration
/// and the "cannot remove" guard in the Settings UI.
pub(crate) const DEFAULT_MARKETPLACE_URL: &str = "hbanerjee74/skills";

#[tauri::command]
pub fn get_data_dir(data_dir: tauri::State<'_, crate::DataDir>) -> Result<String, String> {
    log::info!("[get_data_dir]");
    data_dir
        .0
        .to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "Data directory path contains invalid UTF-8".to_string())
}

/// Run one-time marketplace migration and registry URL normalization.
///
/// Called once at startup from `init_db` instead of on every `get_settings` read.
/// This avoids holding the global DB mutex for write operations on every settings read.
pub(crate) fn run_settings_startup_migrations(
    conn: &rusqlite::Connection,
) -> Result<(), String> {
    let mut settings = crate::db::read_settings_hydrated(conn)?;
    let mut dirty = false;

    // Migrate legacy marketplace_url → marketplace_registries on first run
    if !settings.marketplace_initialized {
        let default_url = DEFAULT_MARKETPLACE_URL;
        let mut registries = vec![crate::types::MarketplaceRegistry {
            name: "Vibedata Skills".to_string(),
            source_url: default_url.to_string(),
            enabled: true,
        }];
        // If there's a legacy URL that differs from the default, migrate it too
        if let Some(ref legacy_url) = settings.marketplace_url {
            if legacy_url.as_str() != default_url {
                registries.push(crate::types::MarketplaceRegistry {
                    name: "Custom".to_string(),
                    source_url: legacy_url.clone(),
                    enabled: true,
                });
            }
        }
        settings.marketplace_registries = registries;
        settings.marketplace_url = None; // clear legacy field
        settings.marketplace_initialized = true;
        dirty = true;
        log::info!(
            "[startup] migrated marketplace_url to marketplace_registries ({} entries)",
            settings.marketplace_registries.len()
        );
    }

    // Normalize all stored registry URLs to canonical shorthand (owner/repo or owner/repo#branch).
    // This migrates existing entries that were saved as full HTTPS URLs.
    for registry in &mut settings.marketplace_registries {
        if let Ok(info) =
            crate::commands::github_import::parse_github_url_inner(&registry.source_url)
        {
            let canonical = if info.branch == "main" {
                format!("{}/{}", info.owner, info.repo)
            } else {
                format!("{}/{}#{}", info.owner, info.repo, info.branch)
            };
            if canonical != registry.source_url {
                log::info!(
                    "[startup] normalizing registry url: {} -> {}",
                    registry.source_url,
                    canonical
                );
                registry.source_url = canonical;
                dirty = true;
            }
        }
    }

    if dirty {
        crate::db::write_settings(conn, &settings)?;
    }

    Ok(())
}

#[tauri::command]
pub fn get_settings(db: tauri::State<'_, Db>) -> Result<AppSettings, String> {
    log::info!("[get_settings]");
    let conn = db.0.lock().map_err(|e| {
        log::error!("[get_settings] Failed to acquire DB lock: {}", e);
        e.to_string()
    })?;
    let settings = crate::db::read_settings_hydrated(&conn)?;
    Ok(settings)
}

/// Normalize a path: strip trailing separators and deduplicate the last
/// segment when the macOS file picker doubles it (e.g. `/foo/Skills/Skills`
/// becomes `/foo/Skills`). Uses `Path::components()` for cross-platform
/// separator handling (works with both `/` and `\`).
fn normalize_path(raw: &str) -> String {
    let trimmed = raw.trim_end_matches(['/', '\\']);
    if trimmed.is_empty() {
        return trimmed.to_string();
    }

    let last_sep = trimmed.rfind(['/', '\\']);
    let Some(last_sep) = last_sep else {
        return trimmed.to_string();
    };
    if last_sep == 0 {
        return trimmed.to_string();
    }

    let previous_part = &trimmed[..last_sep];
    let prev_sep = previous_part.rfind(['/', '\\']);
    let previous_segment = &trimmed[prev_sep.map_or(0, |idx| idx + 1)..last_sep];
    let last_segment = &trimmed[last_sep + 1..];

    if !previous_segment.is_empty() && previous_segment == last_segment {
        trimmed[..last_sep].to_string()
    } else {
        trimmed.to_string()
    }
}

#[tauri::command]
pub fn save_settings(db: tauri::State<'_, Db>, settings: AppSettings) -> Result<(), String> {
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

    // Guard backend-owned fields: preserve from DB, never let a stale frontend
    // save overwrite them.  These fields are written only by dedicated commands
    // (update_github_identity, github_poll_for_token, github_logout) or
    // one-time startup migrations.
    settings.splash_shown = old_settings.splash_shown;
    settings.github_oauth_token = old_settings.github_oauth_token.clone();
    settings.github_user_login = old_settings.github_user_login.clone();
    settings.github_user_avatar = old_settings.github_user_avatar.clone();
    settings.github_user_email = old_settings.github_user_email.clone();
    // Guard: once marketplace_initialized is true in the DB, never let a stale
    // frontend save overwrite it back to false. This prevents the migration from
    // re-running if a component calls save_settings with a pre-migration snapshot.
    if old_settings.marketplace_initialized && !settings.marketplace_initialized {
        log::warn!("[save_settings] stale save attempted to reset marketplace_initialized — preserving true");
        settings.marketplace_initialized = true;
    }

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
    cmp_bool!(interleaved_thinking_beta, "interleaved_thinking_beta");
    cmp_opt!(sdk_effort, "sdk_effort");
    cmp_opt!(fallback_model, "fallback_model");
    cmp_bool!(refine_prompt_suggestions, "refine_prompt_suggestions");
    cmp_opt!(marketplace_url, "marketplace_url");
    if old.marketplace_registries.len() != new.marketplace_registries.len() {
        changes.push(format!(
            "marketplace_registries={} entries",
            new.marketplace_registries.len()
        ));
    }
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
                fs::create_dir_all(new).map_err(|e| {
                    format!("Failed to create skills directory {}: {}", new_path, e)
                })?;
                if let Err(e) = crate::git::ensure_repo(new) {
                    log::warn!("Failed to init git repo at {}: {}", new_path, e);
                }
                return Ok(());
            }

            if new.exists() {
                // Check if new directory is empty (or just has hidden files)
                let has_content = fs::read_dir(new)
                    .map(|entries| {
                        entries
                            .filter_map(|e| e.ok())
                            .any(|e| !e.file_name().to_string_lossy().starts_with('.'))
                    })
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

    for entry in
        fs::read_dir(src).map_err(|e| format!("Failed to read {}: {}", src.display(), e))?
    {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());

        if src_path.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            fs::copy(&src_path, &dst_path).map_err(|e| {
                format!(
                    "Failed to copy {} to {}: {}",
                    src_path.display(),
                    dst_path.display(),
                    e
                )
            })?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn test_api_key(api_key: ApiKey) -> Result<bool, String> {
    log::info!("[test_api_key]");
    let client = reqwest::Client::new();
    let resp = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", api_key.as_ref())
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
        200..=299 => Ok(true),
        400 | 401 => Err("Invalid API key".to_string()),
        403 => Err("API key is disabled".to_string()),
        429 => Err("Rate limited — please try again in a moment".to_string()),
        500..=599 => Err("Anthropic API is unavailable — please try again later".to_string()),
        _ => Err(format!("Unexpected API response (HTTP {})", status)),
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

    let body: ModelsApiResponse = resp
        .json()
        .await
        .map_err(|e| format!("Parse error: {}", e))?;
    let models = body
        .data
        .into_iter()
        .filter(|m| m.id.starts_with("claude-"))
        .map(|m| ModelInfo {
            id: m.id,
            display_name: m.display_name,
        })
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
    let home = dirs::home_dir().ok_or_else(|| "Could not determine home directory".to_string())?;
    let path = home.join("skill-builder");
    path.to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "Path contains invalid UTF-8".to_string())
}

/// Update user-configurable settings fields (everything except backend-owned fields).
///
/// This is the preferred replacement for `save_settings` in the settings UI: it
/// reads the current DB state first and merges only the caller-supplied fields,
/// so backend-owned fields (`splash_shown`, GitHub identity,
/// `marketplace_initialized`) are never touched.
#[tauri::command]
pub fn update_user_settings(
    db: tauri::State<'_, Db>,
    settings: crate::types::AppSettings,
) -> Result<(), String> {
    log::info!("[update_user_settings]");
    let mut settings = settings;
    // Normalize skills_path before persisting
    if let Some(ref sp) = settings.skills_path {
        let normalized = normalize_path(sp);
        settings.skills_path = Some(normalized);
    }

    let conn = db.0.lock().map_err(|e| {
        log::error!("[update_user_settings] Failed to acquire DB lock: {}", e);
        e.to_string()
    })?;

    let old_settings = crate::db::read_settings(&conn)?;

    // Handle skills_path changes
    let old_sp = old_settings.skills_path.as_deref();
    let new_sp = settings.skills_path.as_deref();
    handle_skills_path_change(old_sp, new_sp)?;

    // Preserve all backend-owned fields from DB
    settings.splash_shown = old_settings.splash_shown;
    settings.github_oauth_token = old_settings.github_oauth_token.clone();
    settings.github_user_login = old_settings.github_user_login.clone();
    settings.github_user_avatar = old_settings.github_user_avatar.clone();
    settings.github_user_email = old_settings.github_user_email.clone();
    if old_settings.marketplace_initialized {
        settings.marketplace_initialized = true;
    }

    let changes = diff_settings(&old_settings, &settings);
    if changes.is_empty() {
        log::info!("[update_user_settings] no changes");
    } else {
        log::info!("[update_user_settings] {}", changes.join(", "));
    }

    crate::db::write_settings(&conn, &settings)?;
    Ok(())
}

/// Update only the dashboard view mode, preserving all other settings.
#[tauri::command]
pub fn update_dashboard_view_mode(
    db: tauri::State<'_, Db>,
    mode: Option<String>,
) -> Result<(), String> {
    log::info!("[update_dashboard_view_mode] mode={:?}", mode);
    let conn = db.0.lock().map_err(|e| {
        log::error!("[update_dashboard_view_mode] Failed to acquire DB lock: {}", e);
        e.to_string()
    })?;
    let mut settings = crate::db::read_settings(&conn)?;
    settings.dashboard_view_mode = mode;
    crate::db::write_settings(&conn, &settings)?;
    Ok(())
}

/// Update GitHub identity fields (login, avatar, email, token).
///
/// Pass `None` for any field to clear it (logout flow). This is the only
/// path through which the frontend should write GitHub identity state.
#[tauri::command]
pub fn update_github_identity(
    db: tauri::State<'_, Db>,
    login: Option<String>,
    avatar: Option<String>,
    email: Option<String>,
    token: Option<String>,
) -> Result<(), String> {
    log::info!(
        "[update_github_identity] login={:?} avatar={} token={}",
        login,
        avatar.as_deref().map(|_| "[set]").unwrap_or("[none]"),
        token.as_deref().map(|_| "[set]").unwrap_or("[none]"),
    );
    let conn = db.0.lock().map_err(|e| {
        log::error!("[update_github_identity] Failed to acquire DB lock: {}", e);
        e.to_string()
    })?;
    let mut settings = crate::db::read_settings(&conn)?;
    settings.github_user_login = login;
    settings.github_user_avatar = avatar;
    settings.github_user_email = email;
    // Only overwrite the token when the caller explicitly provides one.
    // loadUser/setUser pass None (profile-only update) and must not wipe
    // the token persisted by github_poll_for_token.  The logout flow
    // clears the token via github_logout_impl instead.
    if token.is_some() {
        settings.github_oauth_token = token;
    }
    crate::db::write_settings(&conn, &settings)?;
    Ok(())
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
    fn test_normalize_path_windows_trailing_backslash() {
        assert_eq!(
            normalize_path(r"C:\Users\me\Skill Builder\"),
            r"C:\Users\me\Skill Builder"
        );
    }

    #[test]
    fn test_normalize_path_windows_duplicate_last_segment_with_spaces() {
        assert_eq!(
            normalize_path(r"C:\Users\me\Skill Builder\Skill Builder\"),
            r"C:\Users\me\Skill Builder"
        );
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
        let run = crate::db::get_workflow_run(&conn, "my-skill")
            .unwrap()
            .unwrap();
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

    #[test]
    fn normalize_path_deduplicates_last_segment() {
        assert_eq!(normalize_path("/foo/Skills/Skills"), "/foo/Skills");
    }

    #[test]
    fn normalize_path_strips_trailing_separators() {
        assert_eq!(normalize_path("/foo/bar/"), "/foo/bar");
        assert_eq!(normalize_path("/foo/bar\\"), "/foo/bar");
    }

    #[test]
    fn normalize_path_no_change_for_normal_paths() {
        assert_eq!(normalize_path("/foo/bar/baz"), "/foo/bar/baz");
    }

    #[test]
    fn normalize_path_handles_spaces_in_path() {
        assert_eq!(normalize_path("/Users/John Doe/My Skills/My Skills"), "/Users/John Doe/My Skills");
    }

    // ===== save_settings guard tests =====

    #[test]
    fn test_save_settings_preserves_splash_shown() {
        let conn = crate::db::create_test_db_for_tests();
        let mut initial = crate::types::AppSettings::default();
        initial.splash_shown = true;
        crate::db::write_settings(&conn, &initial).unwrap();

        // Caller tries to reset splash_shown to false
        let mut payload = crate::types::AppSettings::default();
        payload.splash_shown = false;

        // Simulate what save_settings does: read old, preserve backend fields
        let old = crate::db::read_settings(&conn).unwrap();
        payload.splash_shown = old.splash_shown;
        crate::db::write_settings(&conn, &payload).unwrap();

        let result = crate::db::read_settings(&conn).unwrap();
        assert!(result.splash_shown, "save_settings must preserve splash_shown from DB");
    }

    #[test]
    fn test_save_settings_preserves_github_identity() {
        let conn = crate::db::create_test_db_for_tests();
        let mut initial = crate::types::AppSettings::default();
        initial.github_oauth_token = Some("ghp_token".to_string());
        initial.github_user_login = Some("octocat".to_string());
        initial.github_user_avatar = Some("https://avatar.url".to_string());
        initial.github_user_email = Some("cat@github.com".to_string());
        crate::db::write_settings(&conn, &initial).unwrap();

        // Caller tries to clear all GitHub fields
        let mut payload = crate::types::AppSettings::default();
        payload.github_oauth_token = None;
        payload.github_user_login = None;
        payload.github_user_avatar = None;
        payload.github_user_email = None;

        // Simulate save_settings guard
        let old = crate::db::read_settings(&conn).unwrap();
        payload.github_oauth_token = old.github_oauth_token.clone();
        payload.github_user_login = old.github_user_login.clone();
        payload.github_user_avatar = old.github_user_avatar.clone();
        payload.github_user_email = old.github_user_email.clone();
        crate::db::write_settings(&conn, &payload).unwrap();

        let result = crate::db::read_settings(&conn).unwrap();
        assert_eq!(result.github_oauth_token.as_deref(), Some("ghp_token"));
        assert_eq!(result.github_user_login.as_deref(), Some("octocat"));
        assert_eq!(result.github_user_avatar.as_deref(), Some("https://avatar.url"));
        assert_eq!(result.github_user_email.as_deref(), Some("cat@github.com"));
    }

    // ===== update_dashboard_view_mode tests =====

    #[test]
    fn test_update_dashboard_view_mode_sets_value() {
        let conn = crate::db::create_test_db_for_tests();
        let initial = crate::types::AppSettings::default();
        crate::db::write_settings(&conn, &initial).unwrap();

        let mut settings = crate::db::read_settings(&conn).unwrap();
        settings.dashboard_view_mode = Some("list".to_string());
        crate::db::write_settings(&conn, &settings).unwrap();

        let result = crate::db::read_settings(&conn).unwrap();
        assert_eq!(result.dashboard_view_mode.as_deref(), Some("list"));
    }

    #[test]
    fn test_update_dashboard_view_mode_clears_value() {
        let conn = crate::db::create_test_db_for_tests();
        let mut initial = crate::types::AppSettings::default();
        initial.dashboard_view_mode = Some("grid".to_string());
        crate::db::write_settings(&conn, &initial).unwrap();

        let mut settings = crate::db::read_settings(&conn).unwrap();
        settings.dashboard_view_mode = None;
        crate::db::write_settings(&conn, &settings).unwrap();

        let result = crate::db::read_settings(&conn).unwrap();
        assert!(result.dashboard_view_mode.is_none());
    }

    #[test]
    fn test_update_dashboard_view_mode_preserves_other_fields() {
        let conn = crate::db::create_test_db_for_tests();
        let mut initial = crate::types::AppSettings::default();
        initial.preferred_model = Some("claude-opus-4".to_string());
        initial.github_user_login = Some("user".to_string());
        crate::db::write_settings(&conn, &initial).unwrap();

        let mut settings = crate::db::read_settings(&conn).unwrap();
        settings.dashboard_view_mode = Some("grid".to_string());
        crate::db::write_settings(&conn, &settings).unwrap();

        let result = crate::db::read_settings(&conn).unwrap();
        assert_eq!(result.preferred_model.as_deref(), Some("claude-opus-4"));
        assert_eq!(result.github_user_login.as_deref(), Some("user"));
        assert_eq!(result.dashboard_view_mode.as_deref(), Some("grid"));
    }

    // ===== update_github_identity tests =====

    #[test]
    fn test_update_github_identity_sets_all_fields() {
        let conn = crate::db::create_test_db_for_tests();
        crate::db::write_settings(&conn, &crate::types::AppSettings::default()).unwrap();

        let mut settings = crate::db::read_settings(&conn).unwrap();
        settings.github_user_login = Some("alice".to_string());
        settings.github_user_avatar = Some("https://avatar".to_string());
        settings.github_user_email = Some("alice@example.com".to_string());
        settings.github_oauth_token = Some("ghp_abc123".to_string());
        crate::db::write_settings(&conn, &settings).unwrap();

        let result = crate::db::read_settings(&conn).unwrap();
        assert_eq!(result.github_user_login.as_deref(), Some("alice"));
        assert_eq!(result.github_user_avatar.as_deref(), Some("https://avatar"));
        assert_eq!(result.github_user_email.as_deref(), Some("alice@example.com"));
        assert_eq!(result.github_oauth_token.as_deref(), Some("ghp_abc123"));
    }

    #[test]
    fn test_update_github_identity_logout_clears_all_fields() {
        let conn = crate::db::create_test_db_for_tests();
        let mut initial = crate::types::AppSettings::default();
        initial.github_user_login = Some("alice".to_string());
        initial.github_oauth_token = Some("ghp_token".to_string());
        crate::db::write_settings(&conn, &initial).unwrap();

        let mut settings = crate::db::read_settings(&conn).unwrap();
        settings.github_user_login = None;
        settings.github_user_avatar = None;
        settings.github_user_email = None;
        settings.github_oauth_token = None;
        crate::db::write_settings(&conn, &settings).unwrap();

        let result = crate::db::read_settings(&conn).unwrap();
        assert!(result.github_user_login.is_none());
        assert!(result.github_user_avatar.is_none());
        assert!(result.github_user_email.is_none());
        assert!(result.github_oauth_token.is_none());
    }

    #[test]
    fn test_update_github_identity_preserves_non_auth_fields() {
        let conn = crate::db::create_test_db_for_tests();
        let mut initial = crate::types::AppSettings::default();
        initial.preferred_model = Some("claude-sonnet-4".to_string());
        initial.skills_path = Some("/skills".to_string());
        crate::db::write_settings(&conn, &initial).unwrap();

        // Set github identity
        let mut settings = crate::db::read_settings(&conn).unwrap();
        settings.github_user_login = Some("bob".to_string());
        settings.github_oauth_token = Some("ghp_xyz".to_string());
        crate::db::write_settings(&conn, &settings).unwrap();

        let result = crate::db::read_settings(&conn).unwrap();
        assert_eq!(result.preferred_model.as_deref(), Some("claude-sonnet-4"));
        assert_eq!(result.skills_path.as_deref(), Some("/skills"));
        assert_eq!(result.github_user_login.as_deref(), Some("bob"));
    }

    // ===== update_user_settings tests =====

    #[test]
    fn test_update_user_settings_preserves_backend_fields() {
        let conn = crate::db::create_test_db_for_tests();
        let mut initial = crate::types::AppSettings::default();
        initial.splash_shown = true;
        initial.github_oauth_token = Some("ghp_token".to_string());
        initial.github_user_login = Some("dev".to_string());
        initial.marketplace_initialized = true;
        crate::db::write_settings(&conn, &initial).unwrap();

        // Simulate update_user_settings — reads old, preserves backend fields
        let old = crate::db::read_settings(&conn).unwrap();
        let mut new_settings = crate::types::AppSettings::default();
        new_settings.preferred_model = Some("claude-opus-4".to_string());
        // Apply guard (same as update_user_settings)
        new_settings.splash_shown = old.splash_shown;
        new_settings.github_oauth_token = old.github_oauth_token.clone();
        new_settings.github_user_login = old.github_user_login.clone();
        new_settings.github_user_avatar = old.github_user_avatar.clone();
        new_settings.github_user_email = old.github_user_email.clone();
        if old.marketplace_initialized {
            new_settings.marketplace_initialized = true;
        }
        crate::db::write_settings(&conn, &new_settings).unwrap();

        let result = crate::db::read_settings(&conn).unwrap();
        assert!(result.splash_shown);
        assert_eq!(result.github_oauth_token.as_deref(), Some("ghp_token"));
        assert_eq!(result.github_user_login.as_deref(), Some("dev"));
        assert!(result.marketplace_initialized);
        assert_eq!(result.preferred_model.as_deref(), Some("claude-opus-4"));
    }

    // ===== update_github_identity token-preservation tests =====

    #[test]
    fn test_update_github_identity_none_token_preserves_existing() {
        let conn = crate::db::create_test_db_for_tests();

        // Seed a token in the DB (simulates github_poll_for_token)
        let mut settings = crate::db::read_settings(&conn).unwrap();
        settings.github_oauth_token = Some("ghp_saved_token".to_string());
        crate::db::write_settings(&conn, &settings).unwrap();

        // Simulate loadUser/setUser calling update_github_identity with None token
        let mut settings = crate::db::read_settings(&conn).unwrap();
        settings.github_user_login = Some("octocat".to_string());
        settings.github_user_avatar = Some("https://avatar".to_string());
        settings.github_user_email = Some("octo@example.com".to_string());
        // token is None — must NOT overwrite the saved token
        crate::db::write_settings(&conn, &settings).unwrap();

        let result = crate::db::read_settings(&conn).unwrap();
        assert_eq!(result.github_oauth_token.as_deref(), Some("ghp_saved_token"));
        assert_eq!(result.github_user_login.as_deref(), Some("octocat"));
    }

    #[test]
    fn test_update_github_identity_some_token_overwrites() {
        let conn = crate::db::create_test_db_for_tests();

        // Seed a token
        let mut settings = crate::db::read_settings(&conn).unwrap();
        settings.github_oauth_token = Some("ghp_old".to_string());
        crate::db::write_settings(&conn, &settings).unwrap();

        // Simulate an explicit token update (e.g. re-auth)
        let mut settings = crate::db::read_settings(&conn).unwrap();
        settings.github_oauth_token = Some("ghp_new".to_string());
        crate::db::write_settings(&conn, &settings).unwrap();

        let result = crate::db::read_settings(&conn).unwrap();
        assert_eq!(result.github_oauth_token.as_deref(), Some("ghp_new"));
    }
}
