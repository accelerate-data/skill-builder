use std::fs;
use std::io::Read;
use std::path::Path;

/// Validate that a skill name is safe for use in file paths.
/// Rejects empty names, names starting with a dot (including "."), and
/// names containing path traversal characters.
pub(crate) fn validate_skill_name(name: &str) -> Result<(), String> {
    if name.is_empty() {
        return Err("Skill name cannot be empty".to_string());
    }
    if name.starts_with('.') {
        return Err(format!(
            "Invalid skill name '{}': must not start with '.'",
            name
        ));
    }
    if name.contains('/') || name.contains('\\') || name.contains("..") {
        return Err(format!(
            "Invalid skill name '{}': must not contain '/', '\\', or '..'",
            name
        ));
    }
    Ok(())
}

/// Helper to generate a simple unique ID from inputs
pub(crate) fn generate_skill_id(skill_name: &str) -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!("imp-{}-{}", skill_name, timestamp)
}

/// Recursively copy a directory's contents from src to dst.
pub(crate) fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    for entry in fs::read_dir(src).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());

        if src_path.is_dir() {
            fs::create_dir_all(&dst_path).map_err(|e| e.to_string())?;
            copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            fs::copy(&src_path, &dst_path).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Find SKILL.md in the zip archive, either at the root or one level deep.
/// Returns the path within the archive and the content.
pub(crate) fn find_skill_md(
    archive: &mut zip::ZipArchive<std::fs::File>,
) -> Result<(String, String), String> {
    // First pass: collect all file names to find SKILL.md index
    let mut target_index: Option<(usize, String)> = None;

    for i in 0..archive.len() {
        let file = archive.by_index(i).map_err(|e| e.to_string())?;
        let name = file.name().to_string();
        drop(file);

        // Check root level first
        if name == "SKILL.md" || name == "./SKILL.md" {
            target_index = Some((i, name));
            break;
        }
    }

    // If not found at root, check one level deep
    if target_index.is_none() {
        for i in 0..archive.len() {
            let file = archive.by_index(i).map_err(|e| e.to_string())?;
            let name = file.name().to_string();
            drop(file);

            let parts: Vec<&str> = name.split('/').filter(|p| !p.is_empty()).collect();
            if parts.len() == 2 && parts[1] == "SKILL.md" {
                target_index = Some((i, name));
                break;
            }
        }
    }

    match target_index {
        Some((idx, name)) => {
            let mut content = String::new();
            let mut file = archive.by_index(idx).map_err(|e| e.to_string())?;
            file.read_to_string(&mut content)
                .map_err(|e| e.to_string())?;
            Ok((name, content))
        }
        None => {
            Err("Invalid skill package: SKILL.md not found at root or one level deep".to_string())
        }
    }
}

/// Determine the prefix to strip when extracting files.
/// If SKILL.md is at "dirname/SKILL.md", the prefix is "dirname/".
/// If at root, the prefix is empty.
pub(crate) fn get_archive_prefix(skill_md_path: &str) -> String {
    let parts: Vec<&str> = skill_md_path
        .split('/')
        .filter(|p| !p.is_empty())
        .collect();
    if parts.len() == 2 {
        format!("{}/", parts[0])
    } else {
        String::new()
    }
}

/// Extract archive contents to destination, stripping the prefix.
pub(crate) fn extract_archive(
    archive: &mut zip::ZipArchive<std::fs::File>,
    prefix: &str,
    dest_dir: &Path,
) -> Result<(), String> {
    // Ensure dest_dir exists and canonicalize it for reliable containment checks
    fs::create_dir_all(dest_dir)
        .map_err(|e| format!("Failed to create destination directory: {}", e))?;
    let canonical_dest = dest_dir
        .canonicalize()
        .map_err(|e| format!("Failed to canonicalize destination: {}", e))?;

    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| e.to_string())?;

        // Skip symlink entries — skill packages should never contain symlinks
        if file.is_symlink() {
            continue;
        }

        let raw_name = file.name().to_string();

        // Strip prefix
        let relative = if !prefix.is_empty() {
            match raw_name.strip_prefix(prefix) {
                Some(rel) => rel.to_string(),
                None => continue, // Skip files outside the prefix
            }
        } else {
            raw_name.clone()
        };

        if relative.is_empty() {
            continue;
        }

        let out_path = dest_dir.join(&relative);

        // Prevent directory traversal (lexical check first)
        if !out_path.starts_with(dest_dir) {
            continue;
        }

        if file.is_dir() {
            fs::create_dir_all(&out_path)
                .map_err(|e| format!("Failed to create directory: {}", e))?;
            // Verify canonicalized path is still inside dest_dir (catches symlink tricks)
            let canonical_out = out_path
                .canonicalize()
                .map_err(|e| format!("Failed to canonicalize directory: {}", e))?;
            if !canonical_out.starts_with(&canonical_dest) {
                return Err(format!(
                    "Path traversal detected: '{}' escapes destination",
                    relative
                ));
            }
        } else {
            if let Some(parent) = out_path.parent() {
                fs::create_dir_all(parent)
                    .map_err(|e| format!("Failed to create parent directory: {}", e))?;
                // Verify parent is still inside dest_dir after canonicalization
                let canonical_parent = parent
                    .canonicalize()
                    .map_err(|e| format!("Failed to canonicalize parent: {}", e))?;
                if !canonical_parent.starts_with(&canonical_dest) {
                    return Err(format!(
                        "Path traversal detected: '{}' escapes destination",
                        relative
                    ));
                }
            }
            let mut outfile = fs::File::create(&out_path)
                .map_err(|e| format!("Failed to create file '{}': {}", out_path.display(), e))?;
            std::io::copy(&mut file, &mut outfile)
                .map_err(|e| format!("Failed to write file '{}': {}", out_path.display(), e))?;
        }
    }
    Ok(())
}

pub(crate) fn add_dir_to_zip(
    writer: &mut zip::ZipWriter<fs::File>,
    dir: &Path,
    prefix: &str,
    options: &zip::write::SimpleFileOptions,
) -> Result<(), String> {
    for entry in fs::read_dir(dir).map_err(|e| format!("Failed to read dir: {}", e))? {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let path = entry.path();
        let name = format!("{}/{}", prefix, entry.file_name().to_string_lossy());

        if path.is_dir() {
            add_dir_to_zip(writer, &path, &name, options)?;
        } else {
            let content = fs::read(&path)
                .map_err(|e| format!("Failed to read {}: {}", path.display(), e))?;
            writer
                .start_file(&name, *options)
                .map_err(|e| format!("Failed to add to zip: {}", e))?;
            std::io::Write::write_all(writer, &content)
                .map_err(|e| format!("Failed to write zip content: {}", e))?;
        }
    }
    Ok(())
}
