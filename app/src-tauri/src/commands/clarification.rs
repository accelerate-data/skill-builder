use std::fs;

#[tauri::command]
pub fn save_raw_file(file_path: String, content: String) -> Result<(), String> {
    log::info!("[save_raw_file] path={}", file_path);
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
        let file_path = dir
            .path()
            .join("test.md")
            .to_str()
            .unwrap()
            .to_string();

        save_raw_file(file_path.clone(), "# Hello\nWorld".into()).unwrap();
        let content = std::fs::read_to_string(&file_path).unwrap();
        assert_eq!(content, "# Hello\nWorld");
    }
}
