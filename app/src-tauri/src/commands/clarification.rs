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

