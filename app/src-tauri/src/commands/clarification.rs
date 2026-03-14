use std::fs;
use std::path::{Path, PathBuf};

use crate::db::Db;

/// Inner implementation that accepts explicit allowed_roots for testability.
fn save_raw_file_inner(
    file_path: &str,
    content: &str,
    allowed_roots: &[PathBuf],
) -> Result<(), String> {
    let path = Path::new(file_path);
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            return Err(format!(
                "Parent directory does not exist: {}",
                parent.display()
            ));
        }
    }

    // Canonicalize and check against allowed roots
    if !allowed_roots.is_empty() {
        let resolve_target = path.parent().unwrap_or(path);
        let canonical = fs::canonicalize(resolve_target)
            .map_err(|e| format!("Cannot resolve path '{}': {}", file_path, e))?;
        if !allowed_roots.iter().any(|root| {
            root.canonicalize()
                .map(|cr| canonical.starts_with(&cr))
                .unwrap_or(false)
        }) {
            return Err(format!(
                "Write rejected: '{}' is outside allowed roots",
                file_path
            ));
        }
    }

    fs::write(file_path, content).map_err(|e| {
        log::error!("[save_raw_file] Failed to write {}: {}", file_path, e);
        e.to_string()
    })?;
    Ok(())
}

#[tauri::command]
pub fn save_raw_file(
    file_path: String,
    content: String,
    db: tauri::State<'_, Db>,
) -> Result<(), String> {
    log::info!("[save_raw_file] path={}", file_path);

    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let settings = crate::db::read_settings(&conn).map_err(|e| e.to_string())?;
    drop(conn);

    let mut allowed_roots: Vec<PathBuf> = Vec::new();
    if let Some(ref wp) = settings.workspace_path {
        allowed_roots.push(PathBuf::from(wp));
    }
    if let Some(ref sp) = settings.skills_path {
        allowed_roots.push(PathBuf::from(sp));
    }

    save_raw_file_inner(&file_path, &content, &allowed_roots)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_save_raw_file_and_read_back() {
        let dir = tempdir().unwrap();
        let file_path = dir.path().join("test.md").to_str().unwrap().to_string();

        save_raw_file_inner(&file_path, "# Hello\nWorld", &[dir.path().to_path_buf()]).unwrap();
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

        let result = save_raw_file_inner(&file_path, "content", &[dir.path().to_path_buf()]);
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

        save_raw_file_inner(&file_path, "", &[dir.path().to_path_buf()]).unwrap();
        let content = std::fs::read_to_string(&file_path).unwrap();
        assert_eq!(content, "");
    }

    #[test]
    fn test_save_raw_file_rejects_path_outside_allowed_roots() {
        let allowed_dir = tempdir().unwrap();
        let outside_dir = tempdir().unwrap();
        let file_path = outside_dir
            .path()
            .join("evil.md")
            .to_str()
            .unwrap()
            .to_string();

        let result = save_raw_file_inner(
            &file_path,
            "malicious content",
            &[allowed_dir.path().to_path_buf()],
        );
        assert!(result.is_err());
        assert!(
            result.unwrap_err().contains("outside allowed roots"),
            "expected outside-allowed-roots error"
        );
    }

    #[test]
    fn test_save_raw_file_allows_path_inside_root() {
        let dir = tempdir().unwrap();
        let sub = dir.path().join("sub");
        std::fs::create_dir_all(&sub).unwrap();
        let file_path = sub.join("ok.md").to_str().unwrap().to_string();

        save_raw_file_inner(&file_path, "allowed", &[dir.path().to_path_buf()]).unwrap();
        assert_eq!(std::fs::read_to_string(&file_path).unwrap(), "allowed");
    }
}
