use std::fs;
use std::path::Path;

/// Recursively copy a directory and all its contents.
///
/// Skips symlinks to prevent infinite cycles from circular symlinks in
/// user-controlled skill directories. Regular files and directories are
/// copied; symlinked entries are logged and skipped.
///
/// This is the single canonical implementation — all recursive directory
/// copies in the codebase should use this function.
pub(crate) fn copy_dir_recursive(src: &Path, dest: &Path) -> Result<(), String> {
    fs::create_dir_all(dest)
        .map_err(|e| format!("Failed to create dir {}: {}", dest.display(), e))?;

    let entries = fs::read_dir(src)
        .map_err(|e| format!("Failed to read dir {}: {}", src.display(), e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read dir entry: {}", e))?;
        let src_path = entry.path();
        let dest_path = dest.join(entry.file_name());

        // Guard against symlink cycles: skip any symlinked entry.
        if src_path.is_symlink() {
            log::debug!(
                "[copy_dir_recursive] skipping symlink: {}",
                src_path.display()
            );
            continue;
        }

        if src_path.is_dir() {
            copy_dir_recursive(&src_path, &dest_path)?;
        } else if src_path.is_file() {
            fs::copy(&src_path, &dest_path).map_err(|e| {
                format!(
                    "Failed to copy {} -> {}: {}",
                    src_path.display(),
                    dest_path.display(),
                    e
                )
            })?;
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn copies_all_file_types() {
        let src = tempfile::tempdir().unwrap();
        fs::write(src.path().join("a.txt"), "hello").unwrap();
        fs::write(src.path().join("b.rs"), "world").unwrap();

        let dest_parent = tempfile::tempdir().unwrap();
        let dest = dest_parent.path().join("out");
        copy_dir_recursive(src.path(), &dest).unwrap();

        assert_eq!(fs::read_to_string(dest.join("a.txt")).unwrap(), "hello");
        assert_eq!(fs::read_to_string(dest.join("b.rs")).unwrap(), "world");
    }

    #[test]
    fn handles_nested_dirs() {
        let src = tempfile::tempdir().unwrap();
        fs::create_dir_all(src.path().join("sub/deep")).unwrap();
        fs::write(src.path().join("sub/deep/file.md"), "nested").unwrap();

        let dest_parent = tempfile::tempdir().unwrap();
        let dest = dest_parent.path().join("out");
        copy_dir_recursive(src.path(), &dest).unwrap();

        assert_eq!(
            fs::read_to_string(dest.join("sub/deep/file.md")).unwrap(),
            "nested"
        );
    }

    #[test]
    fn creates_dest_dir() {
        let src = tempfile::tempdir().unwrap();
        fs::write(src.path().join("x.txt"), "data").unwrap();

        let dest_parent = tempfile::tempdir().unwrap();
        let dest = dest_parent.path().join("nonexistent/out");
        copy_dir_recursive(src.path(), &dest).unwrap();

        assert!(dest.join("x.txt").exists());
    }

    #[test]
    fn empty_dir_succeeds() {
        let src = tempfile::tempdir().unwrap();
        let dest_parent = tempfile::tempdir().unwrap();
        let dest = dest_parent.path().join("out");
        copy_dir_recursive(src.path(), &dest).unwrap();
        assert!(dest.exists());
    }

    #[test]
    fn nonexistent_source_fails() {
        let dest = tempfile::tempdir().unwrap();
        let result =
            copy_dir_recursive(Path::new("/nonexistent/source"), &dest.path().join("dest"));
        assert!(result.is_err());
    }

    #[cfg(unix)]
    #[test]
    fn skips_symlinks() {
        let src = tempfile::tempdir().unwrap();
        fs::write(src.path().join("real.txt"), "real").unwrap();
        std::os::unix::fs::symlink(src.path().join("real.txt"), src.path().join("link.txt"))
            .unwrap();
        // Symlink cycle
        std::os::unix::fs::symlink(src.path(), src.path().join("cycle")).unwrap();

        let dest_parent = tempfile::tempdir().unwrap();
        let dest = dest_parent.path().join("out");
        copy_dir_recursive(src.path(), &dest).unwrap();

        assert!(dest.join("real.txt").exists());
        assert!(!dest.join("link.txt").exists(), "symlink file should be skipped");
        assert!(!dest.join("cycle").exists(), "symlink directory cycle should be skipped");
    }
}
