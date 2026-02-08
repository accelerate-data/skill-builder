use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiffResult {
    pub file_path: String,
    pub old_content: String,
    pub new_content: String,
    pub has_changes: bool,
}

/// Generate a diff between the current file content and proposed new content
#[tauri::command]
pub fn generate_diff(file_path: String, new_content: String) -> Result<DiffResult, String> {
    let old_content = std::fs::read_to_string(&file_path).unwrap_or_default();

    let has_changes = old_content != new_content;

    Ok(DiffResult {
        file_path,
        old_content,
        new_content,
        has_changes,
    })
}

/// Apply a suggestion by writing new content to a file
#[tauri::command]
pub fn apply_suggestion(file_path: String, new_content: String) -> Result<(), String> {
    if let Some(parent) = std::path::Path::new(&file_path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&file_path, &new_content).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn test_generate_diff_with_changes() {
        let dir = TempDir::new().unwrap();
        let file = dir.path().join("test.md");
        fs::write(&file, "old content").unwrap();

        let result = generate_diff(
            file.to_str().unwrap().to_string(),
            "new content".to_string(),
        )
        .unwrap();

        assert!(result.has_changes);
        assert_eq!(result.old_content, "old content");
        assert_eq!(result.new_content, "new content");
    }

    #[test]
    fn test_generate_diff_no_changes() {
        let dir = TempDir::new().unwrap();
        let file = dir.path().join("test.md");
        fs::write(&file, "same content").unwrap();

        let result = generate_diff(
            file.to_str().unwrap().to_string(),
            "same content".to_string(),
        )
        .unwrap();

        assert!(!result.has_changes);
    }

    #[test]
    fn test_generate_diff_missing_file() {
        let result = generate_diff(
            "/nonexistent/path/file.md".to_string(),
            "new content".to_string(),
        )
        .unwrap();

        assert!(result.has_changes);
        assert_eq!(result.old_content, "");
    }

    #[test]
    fn test_apply_suggestion() {
        let dir = TempDir::new().unwrap();
        let file = dir.path().join("test.md");

        apply_suggestion(
            file.to_str().unwrap().to_string(),
            "applied content".to_string(),
        )
        .unwrap();

        assert_eq!(fs::read_to_string(&file).unwrap(), "applied content");
    }
}
