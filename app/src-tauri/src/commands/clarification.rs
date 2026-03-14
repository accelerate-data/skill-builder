use std::fs;
use std::path::Path;

#[tauri::command]
pub fn save_raw_file(file_path: String, content: String) -> Result<(), String> {
    log::info!("[save_raw_file] path={}", file_path);
    // Validate that the parent directory exists
    let path = Path::new(&file_path);
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            return Err(format!(
                "Parent directory does not exist: {}",
                parent.display()
            ));
        }
    }
    fs::write(&file_path, &content).map_err(|e| {
        log::error!("[save_raw_file] Failed to write {}: {}", file_path, e);
        e.to_string()
    })?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_save_raw_file_and_read_back() {
        let dir = tempdir().unwrap();
        let file_path = dir.path().join("test.md").to_str().unwrap().to_string();

        save_raw_file(file_path.clone(), "# Hello\nWorld".into()).unwrap();
        let content = std::fs::read_to_string(&file_path).unwrap();
        assert_eq!(content, "# Hello\nWorld");
    }

    #[test]
    fn test_save_raw_file_missing_parent() {
        let dir = tempdir().unwrap();
        let file_path = dir
            .path()
            .join("nonexistent_subdir")
            .join("file.md")
            .to_str()
            .unwrap()
            .to_string();

        let result = save_raw_file(file_path, "content".into());
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            err.contains("Parent directory does not exist")
                || err.contains("No such file or directory"),
            "got: {}",
            err
        );
    }

    #[test]
    fn test_save_raw_file_empty_content() {
        let dir = tempdir().unwrap();
        let file_path = dir.path().join("empty.md").to_str().unwrap().to_string();

        save_raw_file(file_path.clone(), "".into()).unwrap();
        let content = std::fs::read_to_string(&file_path).unwrap();
        assert_eq!(content, "");
    }
}
