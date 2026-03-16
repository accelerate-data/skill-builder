use crate::db::Db;
use crate::types::SkillFileEntry;
use base64::Engine;
use std::fs;
use std::path::{Component, Path, PathBuf};

/// Maximum file size for base64 reading and writing (5 MB).
const MAX_BASE64_FILE_SIZE: u64 = 5_242_880;
/// Maximum recursion depth for collect_entries to prevent symlink cycles.
const MAX_COLLECT_DEPTH: u32 = 20;
const ATTACHMENTS_DIR_NAME: &str = "skill-builder-attachments";

fn list_skill_files_with_roots(
    workspace_path: &str,
    skill_name: &str,
    allowed_roots: &[PathBuf],
) -> Result<Vec<SkillFileEntry>, String> {
    super::imported_skills::validate_skill_name(skill_name)?;

    let skill_dir = Path::new(workspace_path).join(skill_name);
    // Validate workspace_path is within allowed roots
    if skill_dir.exists() {
        let canonical = fs::canonicalize(&skill_dir)
            .map_err(|e| format!("Failed to canonicalize '{}': {}", skill_dir.display(), e))?;
        if !is_within_allowed_roots(&canonical, allowed_roots) {
            return Err(format!(
                "List rejected: '{}' is outside allowed roots",
                canonical.display()
            ));
        }
    }

    if !skill_dir.exists() {
        return Ok(vec![]);
    }

    let mut entries = Vec::new();
    collect_entries(&skill_dir, &skill_dir, &mut entries, 0)?;
    entries.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));
    Ok(entries)
}

#[tauri::command]
pub fn list_skill_files(
    workspace_path: String,
    skill_name: String,
    db: tauri::State<'_, Db>,
) -> Result<Vec<SkillFileEntry>, String> {
    log::info!("[list_skill_files] skill_name={}", skill_name);
    let allowed_roots = get_allowed_roots(&db)?;
    list_skill_files_with_roots(&workspace_path, &skill_name, &allowed_roots)
}

fn collect_entries(
    base: &Path,
    current: &Path,
    entries: &mut Vec<SkillFileEntry>,
    depth: u32,
) -> Result<(), String> {
    if depth > MAX_COLLECT_DEPTH {
        return Err(format!(
            "Directory traversal exceeded maximum depth of {}",
            MAX_COLLECT_DEPTH
        ));
    }

    let dir_entries = fs::read_dir(current).map_err(|e| e.to_string())?;
    for entry in dir_entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let metadata = entry.metadata().map_err(|e| e.to_string())?;

        let relative = path
            .strip_prefix(base)
            .map_err(|e| e.to_string())?
            .to_string_lossy()
            .replace('\\', "/");

        let absolute = fs::canonicalize(&path)
            .unwrap_or_else(|_| path.clone())
            .to_string_lossy()
            .to_string();

        let name = entry.file_name().to_string_lossy().to_string();
        let is_directory = metadata.is_dir();
        let is_readonly = false;
        let size_bytes = if is_directory { 0 } else { metadata.len() };

        entries.push(SkillFileEntry {
            name,
            relative_path: relative,
            absolute_path: absolute,
            is_directory,
            is_readonly,
            size_bytes,
        });

        if is_directory {
            // Skip symlinks to prevent infinite cycles
            let file_type = entry.file_type().map_err(|e| e.to_string())?;
            if file_type.is_symlink() {
                log::debug!(
                    "[collect_entries] skipping symlink directory: {}",
                    path.display()
                );
                continue;
            }
            collect_entries(base, &path, entries, depth + 1)?;
        }
    }
    Ok(())
}

fn attachment_temp_dir() -> PathBuf {
    std::env::temp_dir().join(ATTACHMENTS_DIR_NAME)
}

fn get_allowed_roots(db: &tauri::State<'_, Db>) -> Result<Vec<PathBuf>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let settings = crate::db::read_settings(&conn)?;
    drop(conn);

    let mut roots = Vec::new();
    if let Some(workspace_path) = settings.workspace_path {
        roots.push(PathBuf::from(workspace_path));
    }
    if let Some(skills_path) = settings.skills_path {
        roots.push(PathBuf::from(skills_path));
    }

    let temp_dir = attachment_temp_dir();
    if !temp_dir.exists() {
        fs::create_dir_all(&temp_dir).map_err(|e| {
            format!(
                "Failed to initialize attachment temp directory '{}': {}",
                temp_dir.display(),
                e
            )
        })?;
    }
    roots.push(temp_dir);

    let mut canonical_roots = Vec::new();
    for root in roots {
        if root.exists() {
            let canonical = fs::canonicalize(&root).map_err(|e| {
                format!(
                    "Failed to canonicalize allowed root '{}': {}",
                    root.display(),
                    e
                )
            })?;
            if !canonical_roots.iter().any(|r| r == &canonical) {
                canonical_roots.push(canonical);
            }
        } else {
            log::warn!(
                "[get_allowed_roots] configured root does not exist and will be excluded: {}",
                root.display()
            );
        }
    }

    if canonical_roots.is_empty() {
        return Err("No allowed filesystem roots are configured".to_string());
    }
    Ok(canonical_roots)
}

fn reject_traversal(path: &Path) -> Result<(), String> {
    if !path.is_absolute() {
        return Err(format!("Path must be absolute: '{}'", path.display()));
    }
    if path.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err(format!(
            "Path traversal segment ('..') is not allowed: '{}'",
            path.display()
        ));
    }
    Ok(())
}

fn canonicalize_for_write_target(path: &Path) -> Result<PathBuf, String> {
    reject_traversal(path)?;

    let file_name = path
        .file_name()
        .ok_or_else(|| format!("Path must include a file name: '{}'", path.display()))?;
    let parent = path
        .parent()
        .ok_or_else(|| format!("Path has no parent directory: '{}'", path.display()))?;

    // Walk up to the nearest existing ancestor, then rebuild forward.
    let mut existing = parent;
    while !existing.exists() {
        existing = existing
            .parent()
            .ok_or_else(|| format!("Cannot resolve existing ancestor for '{}'", path.display()))?;
    }
    let canonical_existing = fs::canonicalize(existing)
        .map_err(|e| format!("Failed to canonicalize '{}': {}", existing.display(), e))?;
    let suffix = parent
        .strip_prefix(existing)
        .map_err(|e| format!("Failed to resolve write path '{}': {}", path.display(), e))?;
    let canonical_parent = canonical_existing.join(suffix);
    Ok(canonical_parent.join(file_name))
}

fn is_within_allowed_roots(path: &Path, allowed_roots: &[PathBuf]) -> bool {
    allowed_roots.iter().any(|root| path.starts_with(root))
}

fn get_workspace_root(db: &tauri::State<'_, Db>) -> Option<PathBuf> {
    let conn = db.0.lock().ok()?;
    let settings = crate::db::read_settings(&conn).ok()?;
    let workspace = settings.workspace_path?;
    fs::canonicalize(workspace).ok()
}

fn is_workspace_context_path(path: &Path, workspace_root: &Path) -> bool {
    if !path.starts_with(workspace_root) {
        return false;
    }
    let Ok(relative) = path.strip_prefix(workspace_root) else {
        return false;
    };
    let mut components = relative.components();
    // workspace/<skill>/context/<...>
    let _skill = components.next();
    matches!(
        components.next(),
        Some(Component::Normal(name)) if name == "context"
    )
}

fn read_file_with_roots(file_path: &str, allowed_roots: &[PathBuf]) -> Result<String, String> {
    let input = Path::new(file_path);
    reject_traversal(input)?;
    let canonical_path = fs::canonicalize(input)
        .map_err(|e| format!("Failed to canonicalize '{}': {}", input.display(), e))?;
    if !is_within_allowed_roots(&canonical_path, allowed_roots) {
        return Err(format!(
            "Read rejected: '{}' is outside allowed roots",
            canonical_path.display()
        ));
    }
    // Guard against reading excessively large files into memory
    const MAX_TEXT_FILE_SIZE: u64 = 50 * 1024 * 1024; // 50 MB
    let metadata = fs::metadata(&canonical_path)
        .map_err(|e| format!("Failed to stat '{}': {}", canonical_path.display(), e))?;
    if metadata.len() > MAX_TEXT_FILE_SIZE {
        return Err(format!(
            "File '{}' is too large ({} bytes, limit is {} bytes)",
            canonical_path.display(),
            metadata.len(),
            MAX_TEXT_FILE_SIZE,
        ));
    }
    fs::read_to_string(&canonical_path)
        .map_err(|e| format!("Failed to read '{}': {}", canonical_path.display(), e))
}

fn write_file_with_roots(
    path: &str,
    content: &str,
    allowed_roots: &[PathBuf],
) -> Result<(), String> {
    let input = Path::new(path);
    let canonical_target = canonicalize_for_write_target(input)?;
    if !is_within_allowed_roots(&canonical_target, allowed_roots) {
        return Err(format!(
            "Write rejected: '{}' is outside allowed roots",
            canonical_target.display()
        ));
    }
    // Guard against writing excessively large content
    const MAX_WRITE_SIZE: usize = 50 * 1024 * 1024; // 50 MB
    if content.len() > MAX_WRITE_SIZE {
        return Err(format!(
            "Content too large to write ({} bytes, limit is {} bytes)",
            content.len(),
            MAX_WRITE_SIZE,
        ));
    }
    if let Some(parent) = canonical_target.parent() {
        fs::create_dir_all(parent).map_err(|e| {
            format!(
                "Failed to create parent directory '{}': {}",
                parent.display(),
                e
            )
        })?;
    }
    fs::write(&canonical_target, content)
        .map_err(|e| format!("Failed to write '{}': {}", canonical_target.display(), e))
}

fn copy_file_with_roots(src: &str, dest: &str, allowed_roots: &[PathBuf]) -> Result<(), String> {
    let src_input = Path::new(src);
    reject_traversal(src_input)?;
    let canonical_src = fs::canonicalize(src_input).map_err(|e| {
        format!(
            "Failed to canonicalize source '{}': {}",
            src_input.display(),
            e
        )
    })?;
    if !is_within_allowed_roots(&canonical_src, allowed_roots) {
        return Err(format!(
            "Copy rejected: source '{}' is outside allowed roots",
            canonical_src.display()
        ));
    }

    let dest_input = Path::new(dest);
    let canonical_dest = canonicalize_for_write_target(dest_input)?;
    if !is_within_allowed_roots(&canonical_dest, allowed_roots) {
        return Err(format!(
            "Copy rejected: destination '{}' is outside allowed roots",
            canonical_dest.display()
        ));
    }
    if let Some(parent) = canonical_dest.parent() {
        fs::create_dir_all(parent).map_err(|e| {
            format!(
                "Failed to create destination parent '{}': {}",
                parent.display(),
                e
            )
        })?;
    }

    fs::copy(&canonical_src, &canonical_dest)
        .map(|_| ())
        .map_err(|e| {
            format!(
                "Failed to copy '{}' to '{}': {}",
                canonical_src.display(),
                canonical_dest.display(),
                e
            )
        })
}

fn read_file_as_base64_with_roots(
    file_path: &str,
    allowed_roots: &[PathBuf],
) -> Result<String, String> {
    let input = Path::new(file_path);
    reject_traversal(input)?;
    let canonical_path = fs::canonicalize(input)
        .map_err(|e| format!("Failed to canonicalize '{}': {}", input.display(), e))?;
    if !is_within_allowed_roots(&canonical_path, allowed_roots) {
        return Err(format!(
            "Read rejected: '{}' is outside allowed roots",
            canonical_path.display()
        ));
    }
    let metadata = fs::metadata(&canonical_path)
        .map_err(|e| format!("Cannot read file '{}': {}", canonical_path.display(), e))?;
    if metadata.len() > MAX_BASE64_FILE_SIZE {
        return Err("File exceeds 5 MB limit".to_string());
    }
    let bytes = fs::read(&canonical_path)
        .map_err(|e| format!("Failed to read file '{}': {}", canonical_path.display(), e))?;
    Ok(base64::engine::general_purpose::STANDARD.encode(&bytes))
}

#[tauri::command]
pub fn read_file(file_path: String, db: tauri::State<'_, Db>) -> Result<String, String> {
    log::info!("[read_file] path={}", file_path);
    let allowed_roots = get_allowed_roots(&db)?;
    if let Some(workspace_root) = get_workspace_root(&db) {
        let input = Path::new(&file_path);
        if let Ok(canonical_path) = fs::canonicalize(input) {
            if is_workspace_context_path(&canonical_path, &workspace_root) {
                return Err(
                    "Read rejected: context files are backend-owned; use workflow/refine domain commands"
                        .to_string(),
                );
            }
        }
    }
    read_file_with_roots(&file_path, &allowed_roots).map_err(|e| {
        log::error!("[read_file] Failed to read {}: {}", file_path, e);
        e
    })
}

#[tauri::command]
pub fn write_file(path: String, content: String, db: tauri::State<'_, Db>) -> Result<(), String> {
    log::info!("[write_file] path={}", path);
    let allowed_roots = get_allowed_roots(&db)?;
    if let Some(workspace_root) = get_workspace_root(&db) {
        if let Ok(canonical_target) = canonicalize_for_write_target(Path::new(&path)) {
            if is_workspace_context_path(&canonical_target, &workspace_root) {
                return Err(
                    "Write rejected: context files are backend-owned; use workflow/refine domain commands"
                        .to_string(),
                );
            }
        }
    }
    write_file_with_roots(&path, &content, &allowed_roots).map_err(|e| {
        log::error!("[write_file] Failed to write {}: {}", path, e);
        e
    })
}

#[tauri::command]
pub fn copy_file(src: String, dest: String, db: tauri::State<'_, Db>) -> Result<(), String> {
    log::info!("[copy_file] src={} dest={}", src, dest);
    let allowed_roots = get_allowed_roots(&db)?;
    if let Some(workspace_root) = get_workspace_root(&db) {
        let src_input = Path::new(&src);
        if let Ok(canonical_src) = fs::canonicalize(src_input) {
            if is_workspace_context_path(&canonical_src, &workspace_root) {
                return Err(
                    "Copy rejected: context files are backend-owned; use workflow/refine domain commands"
                        .to_string(),
                );
            }
        }
        if let Ok(canonical_dest) = canonicalize_for_write_target(Path::new(&dest)) {
            if is_workspace_context_path(&canonical_dest, &workspace_root) {
                return Err(
                    "Copy rejected: context files are backend-owned; use workflow/refine domain commands"
                        .to_string(),
                );
            }
        }
    }
    copy_file_with_roots(&src, &dest, &allowed_roots).map_err(|e| {
        log::error!("[copy_file] Failed to copy {} to {}: {}", src, dest, e);
        e
    })
}

#[tauri::command]
pub fn read_file_as_base64(file_path: String, db: tauri::State<'_, Db>) -> Result<String, String> {
    log::info!("[read_file_as_base64] path={}", file_path);
    let allowed_roots = get_allowed_roots(&db)?;
    read_file_as_base64_with_roots(&file_path, &allowed_roots)
}

#[tauri::command]
pub fn write_base64_to_temp_file(
    file_name: String,
    base64_content: String,
) -> Result<String, String> {
    log::info!("[write_base64_to_temp_file] file_name={}", file_name);

    // Reject path traversal attempts: no separators, no "..", no leading "."
    if file_name.contains('/')
        || file_name.contains('\\')
        || file_name.contains("..")
        || file_name.starts_with('.')
    {
        log::error!(
            "[write_base64_to_temp_file] Rejected invalid file name: {}",
            file_name
        );
        return Err("Invalid file name: path traversal not allowed".to_string());
    }

    // Reject payloads that would decode to more than MAX_BASE64_FILE_SIZE.
    // Base64 encodes 3 bytes as 4 chars, so decoded_len ≈ base64_len * 3/4.
    let estimated_decoded_len = (base64_content.len() as u64) * 3 / 4;
    if estimated_decoded_len > MAX_BASE64_FILE_SIZE {
        return Err(format!(
            "Base64 payload too large: estimated {} bytes exceeds {} byte limit",
            estimated_decoded_len, MAX_BASE64_FILE_SIZE
        ));
    }

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&base64_content)
        .map_err(|e| format!("Invalid base64: {e}"))?;
    let temp_dir = attachment_temp_dir();
    std::fs::create_dir_all(&temp_dir).map_err(|e| format!("Cannot create temp dir: {e}"))?;
    let dest = temp_dir.join(&file_name);
    std::fs::write(&dest, &bytes).map_err(|e| format!("Cannot write file: {e}"))?;
    dest.to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "Invalid path".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    fn setup_skill_dir(base: &Path) {
        let skill = base.join("my-skill");
        fs::create_dir_all(skill.join("context")).unwrap();
        fs::create_dir_all(skill.join("skill").join("references")).unwrap();
        fs::write(skill.join("skill").join("SKILL.md"), "# My Skill").unwrap();
        fs::write(
            skill.join("skill").join("references").join("ref1.md"),
            "# Ref 1",
        )
        .unwrap();
        fs::write(skill.join("context").join("clarifications.json"), "{}").unwrap();
    }

    #[test]
    fn test_list_skill_files_returns_all_entries() {
        let dir = tempdir().unwrap();
        setup_skill_dir(dir.path());

        let roots = vec![fs::canonicalize(dir.path()).unwrap()];
        let entries = list_skill_files_with_roots(
            dir.path().to_str().unwrap(),
            "my-skill",
            &roots,
        )
        .unwrap();

        // Should have: context/, context/clarifications.json,
        //              skill/, skill/SKILL.md, skill/references/, skill/references/ref1.md
        assert_eq!(entries.len(), 6);

        let paths: Vec<&str> = entries.iter().map(|e| e.relative_path.as_str()).collect();
        assert!(paths.contains(&"skill/SKILL.md"));
        assert!(paths.contains(&"context"));
        assert!(paths.contains(&"context/clarifications.json"));
        assert!(paths.contains(&"skill"));
        assert!(paths.contains(&"skill/references"));
        assert!(paths.contains(&"skill/references/ref1.md"));
    }

    #[test]
    fn test_list_skill_files_sorted_by_relative_path() {
        let dir = tempdir().unwrap();
        setup_skill_dir(dir.path());

        let roots = vec![fs::canonicalize(dir.path()).unwrap()];
        let entries = list_skill_files_with_roots(
            dir.path().to_str().unwrap(),
            "my-skill",
            &roots,
        )
        .unwrap();

        let paths: Vec<&str> = entries.iter().map(|e| e.relative_path.as_str()).collect();
        let mut sorted = paths.clone();
        sorted.sort();
        assert_eq!(paths, sorted);
    }

    #[test]
    fn test_no_files_are_readonly() {
        let dir = tempdir().unwrap();
        setup_skill_dir(dir.path());

        let roots = vec![fs::canonicalize(dir.path()).unwrap()];
        let entries = list_skill_files_with_roots(
            dir.path().to_str().unwrap(),
            "my-skill",
            &roots,
        )
        .unwrap();

        for entry in &entries {
            assert!(
                !entry.is_readonly,
                "{} should be editable",
                entry.relative_path
            );
        }
    }

    #[test]
    fn test_directory_entries() {
        let dir = tempdir().unwrap();
        setup_skill_dir(dir.path());

        let roots = vec![fs::canonicalize(dir.path()).unwrap()];
        let entries = list_skill_files_with_roots(
            dir.path().to_str().unwrap(),
            "my-skill",
            &roots,
        )
        .unwrap();

        let context_entry = entries
            .iter()
            .find(|e| e.relative_path == "context")
            .unwrap();
        assert!(context_entry.is_directory);
        assert_eq!(context_entry.size_bytes, 0);

        let skill_md = entries
            .iter()
            .find(|e| e.relative_path == "skill/SKILL.md")
            .unwrap();
        assert!(!skill_md.is_directory);
        assert!(skill_md.size_bytes > 0);
    }

    #[test]
    fn test_nonexistent_skill_returns_empty() {
        let dir = tempdir().unwrap();
        let roots = vec![fs::canonicalize(dir.path()).unwrap()];
        let entries = list_skill_files_with_roots(
            dir.path().to_str().unwrap(),
            "nonexistent",
            &roots,
        )
        .unwrap();
        assert!(entries.is_empty());
    }

    #[test]
    fn test_list_skill_files_rejects_outside_allowed_roots() {
        let dir = tempdir().unwrap();
        let outside = tempdir().unwrap();
        setup_skill_dir(outside.path());

        let roots = vec![fs::canonicalize(dir.path()).unwrap()];
        let result = list_skill_files_with_roots(
            outside.path().to_str().unwrap(),
            "my-skill",
            &roots,
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("outside allowed roots"));
    }

    #[test]
    fn test_read_file_success() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("test.txt");
        fs::write(&file, "hello world").unwrap();

        let roots = vec![fs::canonicalize(dir.path()).unwrap()];
        let content = read_file_with_roots(file.to_str().unwrap(), &roots).unwrap();
        assert_eq!(content, "hello world");
    }

    #[test]
    fn test_read_file_not_found() {
        let tmp = std::env::temp_dir();
        let roots = vec![fs::canonicalize(&tmp).unwrap()];
        let nonexistent = tmp.join("nonexistent-file-abc123xyz");
        let result = read_file_with_roots(nonexistent.to_str().unwrap(), &roots);
        assert!(result.is_err());
    }

    #[test]
    fn test_copy_file_success() {
        let dir = tempdir().unwrap();
        let src = dir.path().join("source.txt");
        let dest = dir.path().join("destination.txt");
        fs::write(&src, "copy me").unwrap();

        let roots = vec![fs::canonicalize(dir.path()).unwrap()];
        let result = copy_file_with_roots(src.to_str().unwrap(), dest.to_str().unwrap(), &roots);
        assert!(result.is_ok());

        let content = fs::read_to_string(&dest).unwrap();
        assert_eq!(content, "copy me");
    }

    #[test]
    fn test_copy_file_source_not_found() {
        let dir = tempdir().unwrap();
        let dest = dir.path().join("destination.txt");
        let roots = vec![fs::canonicalize(dir.path()).unwrap()];
        let result = copy_file_with_roots(
            "/tmp/nonexistent-source-abc123xyz",
            dest.to_str().unwrap(),
            &roots,
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_write_file_success() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("output.txt");

        let roots = vec![fs::canonicalize(dir.path()).unwrap()];
        let result = write_file_with_roots(file.to_str().unwrap(), "hello world", &roots);
        assert!(result.is_ok());

        let content = fs::read_to_string(&file).unwrap();
        assert_eq!(content, "hello world");
    }

    #[test]
    fn test_write_file_creates_parent_dirs() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("a").join("b").join("c").join("deep.txt");

        let roots = vec![fs::canonicalize(dir.path()).unwrap()];
        let result = write_file_with_roots(file.to_str().unwrap(), "nested content", &roots);
        assert!(result.is_ok());

        let content = fs::read_to_string(&file).unwrap();
        assert_eq!(content, "nested content");
    }

    #[test]
    fn test_write_file_overwrites_existing() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("existing.txt");
        fs::write(&file, "old content").unwrap();

        let roots = vec![fs::canonicalize(dir.path()).unwrap()];
        let result = write_file_with_roots(file.to_str().unwrap(), "new content", &roots);
        assert!(result.is_ok());

        let content = fs::read_to_string(&file).unwrap();
        assert_eq!(content, "new content");
    }

    #[test]
    fn test_copy_file_overwrites_existing() {
        let dir = tempdir().unwrap();
        let src = dir.path().join("source.txt");
        let dest = dir.path().join("destination.txt");
        fs::write(&src, "new content").unwrap();
        fs::write(&dest, "old content").unwrap();

        let roots = vec![fs::canonicalize(dir.path()).unwrap()];
        let result = copy_file_with_roots(src.to_str().unwrap(), dest.to_str().unwrap(), &roots);
        assert!(result.is_ok());

        let content = fs::read_to_string(&dest).unwrap();
        assert_eq!(content, "new content");
    }

    #[test]
    fn test_read_file_as_base64_success() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("test.bin");
        fs::write(&file, b"hello world").unwrap();

        let roots = vec![fs::canonicalize(dir.path()).unwrap()];
        let result = read_file_as_base64_with_roots(file.to_str().unwrap(), &roots).unwrap();
        // "hello world" in base64
        assert_eq!(result, "aGVsbG8gd29ybGQ=");
    }

    #[test]
    fn test_read_file_as_base64_not_found() {
        let tmp = std::env::temp_dir();
        let roots = vec![fs::canonicalize(&tmp).unwrap()];
        let nonexistent = tmp.join("nonexistent-base64-file-xyz");
        let result = read_file_as_base64_with_roots(nonexistent.to_str().unwrap(), &roots);
        assert!(result.is_err());
    }

    #[test]
    fn test_read_file_as_base64_exceeds_size_limit() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("large.bin");
        // Create a file just over the 5 MB limit
        let data = vec![0u8; 5_242_881];
        fs::write(&file, &data).unwrap();

        let roots = vec![fs::canonicalize(dir.path()).unwrap()];
        let result = read_file_as_base64_with_roots(file.to_str().unwrap(), &roots);
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "File exceeds 5 MB limit");
    }

    #[test]
    fn test_read_file_as_base64_at_size_limit() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("exact.bin");
        // Exactly 5 MB — should succeed
        let data = vec![0u8; 5_242_880];
        fs::write(&file, &data).unwrap();

        let roots = vec![fs::canonicalize(dir.path()).unwrap()];
        let result = read_file_as_base64_with_roots(file.to_str().unwrap(), &roots);
        assert!(result.is_ok());
    }

    #[test]
    fn test_write_file_rejects_outside_allowed_roots() {
        let dir = tempdir().unwrap();
        let outside = tempdir().unwrap();
        let roots = vec![fs::canonicalize(dir.path()).unwrap()];
        let target = outside.path().join("outside.txt");
        let result = write_file_with_roots(target.to_str().unwrap(), "nope", &roots);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("outside allowed roots"));
    }

    #[test]
    fn test_read_file_rejects_outside_allowed_roots() {
        let dir = tempdir().unwrap();
        let outside = tempdir().unwrap();
        let target = outside.path().join("outside.txt");
        fs::write(&target, "outside").unwrap();
        let roots = vec![fs::canonicalize(dir.path()).unwrap()];
        let result = read_file_with_roots(target.to_str().unwrap(), &roots);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("outside allowed roots"));
    }

    #[test]
    fn test_copy_file_rejects_destination_outside_allowed_roots() {
        let dir = tempdir().unwrap();
        let outside = tempdir().unwrap();
        let src = dir.path().join("source.txt");
        fs::write(&src, "safe").unwrap();
        let dest = outside.path().join("outside.txt");
        let roots = vec![fs::canonicalize(dir.path()).unwrap()];
        let result = copy_file_with_roots(src.to_str().unwrap(), dest.to_str().unwrap(), &roots);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("outside allowed roots"));
    }

    #[test]
    fn test_write_base64_to_temp_file_success() {
        // "hello world" in base64
        let result =
            write_base64_to_temp_file("test-att.txt".to_string(), "aGVsbG8gd29ybGQ=".to_string());
        assert!(result.is_ok());
        let path = result.unwrap();
        assert!(path.ends_with("test-att.txt"));
        let content = fs::read_to_string(&path).unwrap();
        assert_eq!(content, "hello world");
        // Cleanup
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_write_base64_to_temp_file_invalid_base64() {
        let result =
            write_base64_to_temp_file("bad.txt".to_string(), "!!!not-base64!!!".to_string());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Invalid base64"));
    }

    #[test]
    fn test_write_base64_rejects_path_traversal() {
        let result = write_base64_to_temp_file("../../etc/passwd".into(), "aGVsbG8=".into());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("path traversal"));
    }

    #[test]
    fn test_write_base64_rejects_nested_path() {
        let result = write_base64_to_temp_file("subdir/evil.txt".into(), "aGVsbG8=".into());
        assert!(result.is_err());
    }

    #[test]
    fn test_write_base64_rejects_absolute_path() {
        let result = write_base64_to_temp_file("/etc/passwd".into(), "aGVsbG8=".into());
        assert!(result.is_err());
    }

    #[test]
    fn test_write_base64_rejects_leading_dot() {
        let result = write_base64_to_temp_file(".hidden".into(), "aGVsbG8=".into());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("path traversal"));
    }

    // --- Text file size limit tests (S-08) ---

    #[test]
    fn test_read_file_rejects_text_exceeding_50mb() {
        let dir = tempfile::tempdir().unwrap();
        let big_file = dir.path().join("big.txt");
        let size: u64 = 50 * 1024 * 1024 + 1;
        {
            let f = std::fs::File::create(&big_file).unwrap();
            f.set_len(size).unwrap();
        }
        // Canonicalize the allowed root so it matches on macOS (/var → /private/var)
        let allowed = vec![dir.path().canonicalize().unwrap()];
        let result = read_file_with_roots(big_file.to_str().unwrap(), &allowed);
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.contains("too large"), "expected 'too large' in error: {}", err);
    }

    #[test]
    fn test_read_file_accepts_text_at_50mb() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("exact.txt");
        let size: u64 = 50 * 1024 * 1024;
        {
            let f = std::fs::File::create(&file).unwrap();
            f.set_len(size).unwrap();
        }
        let allowed = vec![dir.path().canonicalize().unwrap()];
        let result = read_file_with_roots(file.to_str().unwrap(), &allowed);
        assert!(result.is_ok(), "expected Ok for file at exactly 50MB: {:?}", result.err());
    }

    #[test]
    fn test_write_file_rejects_content_exceeding_50mb() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("big_write.txt");
        let allowed = vec![dir.path().canonicalize().unwrap()];
        let content = "x".repeat(50 * 1024 * 1024 + 1);
        let result = write_file_with_roots(target.to_str().unwrap(), &content, &allowed);
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.contains("too large"), "expected 'too large' in error: {}", err);
    }
}
