use std::path::Path;
use crate::agents::sidecar::AgentRegistry;

#[tauri::command]
pub fn check_workspace_path(workspace_path: String) -> Result<bool, String> {
    let path = Path::new(&workspace_path);
    Ok(path.exists() && path.is_dir())
}

#[tauri::command]
pub async fn has_running_agents(
    state: tauri::State<'_, AgentRegistry>,
) -> Result<bool, String> {
    let reg = state.lock().await;
    Ok(!reg.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_existing_dir() {
        let dir = tempdir().unwrap();
        assert!(check_workspace_path(dir.path().to_str().unwrap().to_string()).unwrap());
    }

    #[test]
    fn test_nonexistent() {
        assert!(!check_workspace_path("/nonexistent/path/abc123".to_string()).unwrap());
    }

    #[test]
    fn test_file_not_dir() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("file.txt");
        std::fs::write(&file, "x").unwrap();
        assert!(!check_workspace_path(file.to_str().unwrap().to_string()).unwrap());
    }

    #[test]
    fn test_empty_string() {
        assert!(!check_workspace_path("".to_string()).unwrap());
    }
}
