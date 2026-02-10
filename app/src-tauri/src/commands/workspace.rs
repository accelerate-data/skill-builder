use crate::db::Db;

const WORKSPACE_DIR_NAME: &str = ".vibedata";

/// Resolve the default workspace path: `~/.vibedata`
fn resolve_workspace_path() -> Result<String, String> {
    let home = dirs::home_dir().ok_or_else(|| "Could not determine home directory".to_string())?;
    let workspace = home.join(WORKSPACE_DIR_NAME);
    workspace
        .to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "Home directory path contains invalid UTF-8".to_string())
}

/// Initialize the workspace directory on app startup.
/// Creates `~/.vibedata` if it doesn't exist, updates settings,
/// and deploys bundled agents and references (always, so updates ship with the app).
pub fn init_workspace(
    app: &tauri::AppHandle,
    db: &tauri::State<'_, Db>,
) -> Result<String, String> {
    let workspace_path = resolve_workspace_path()?;

    // Create directory if it doesn't exist
    std::fs::create_dir_all(&workspace_path)
        .map_err(|e| format!("Failed to create workspace directory: {}", e))?;

    // Update settings with the workspace path
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut settings = crate::db::read_settings(&conn)?;
    if settings.workspace_path.as_deref() != Some(&workspace_path) {
        settings.workspace_path = Some(workspace_path.clone());
        crate::db::write_settings(&conn, &settings)?;
    }
    drop(conn);

    // Always sync bundled agents and references so app updates deploy new files
    super::workflow::ensure_workspace_prompts(app, &workspace_path)?;

    Ok(workspace_path)
}

#[tauri::command]
pub fn get_workspace_path(db: tauri::State<'_, Db>) -> Result<String, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let settings = crate::db::read_settings(&conn)?;
    settings
        .workspace_path
        .ok_or_else(|| "Workspace path not initialized".to_string())
}

#[tauri::command]
pub fn clear_workspace(
    app: tauri::AppHandle,
    db: tauri::State<'_, Db>,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let settings = crate::db::read_settings(&conn)?;
    let workspace_path = settings.workspace_path
        .ok_or_else(|| "Workspace path not initialized".to_string())?;

    let base = std::path::Path::new(&workspace_path);
    if !base.exists() {
        return Ok(());
    }

    // List all subdirectories, skip agents/ and references/
    let entries = std::fs::read_dir(base).map_err(|e| e.to_string())?;
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if !path.is_dir() { continue; }
        let name = entry.file_name().to_string_lossy().to_string();
        if name == "agents" || name == "references" { continue; }

        // Delete filesystem
        std::fs::remove_dir_all(&path).map_err(|e| e.to_string())?;

        // Delete DB records
        crate::db::delete_workflow_run(&conn, &name)?;
        // Delete chat sessions for this skill
        conn.execute("DELETE FROM chat_messages WHERE session_id IN (SELECT id FROM chat_sessions WHERE skill_name = ?1)", [&name])
            .map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM chat_sessions WHERE skill_name = ?1", [&name])
            .map_err(|e| e.to_string())?;
    }
    drop(conn);

    // Re-initialize workspace with bundled agents/references
    super::workflow::ensure_workspace_prompts(&app, &workspace_path)?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_resolve_workspace_path() {
        let path = resolve_workspace_path().unwrap();
        assert!(path.ends_with(".vibedata"));
        assert!(path.starts_with('/'));
    }
}
