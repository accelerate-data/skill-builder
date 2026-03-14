use crate::db::Db;
use crate::types::ImportedSkill;
use rusqlite::OptionalExtension;
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

/// Parsed YAML frontmatter fields from a SKILL.md file.
#[derive(Default)]
pub(crate) struct Frontmatter {
    pub name: Option<String>,
    pub description: Option<String>,
    pub version: Option<String>,
    pub model: Option<String>,
    pub argument_hint: Option<String>,
    pub user_invocable: Option<bool>,
    pub disable_model_invocation: Option<bool>,
}

/// Parse YAML frontmatter from SKILL.md content.
/// Extracts `name` and `description` fields from YAML between `---` markers.
/// Multi-line YAML values (using `>` folded scalar) are joined into a single line.
#[allow(dead_code)]
pub(crate) fn parse_frontmatter(content: &str) -> (Option<String>, Option<String>) {
    let fm = parse_frontmatter_full(content);
    (fm.name, fm.description)
}

/// Parse YAML frontmatter returning all fields.
pub(crate) fn parse_frontmatter_full(content: &str) -> Frontmatter {
    let trimmed = content.trim_start();
    if !trimmed.starts_with("---") {
        return Frontmatter::default();
    }

    // Find the closing ---
    let after_first = &trimmed[3..];
    let end = match after_first.find("\n---") {
        Some(pos) => pos,
        None => return Frontmatter::default(),
    };

    let yaml_block = &after_first[..end];

    let mut name = None;
    let mut description = None;
    let mut version = None;
    let mut model = None;
    let mut argument_hint = None;
    let mut user_invocable: Option<bool> = None;
    let mut disable_model_invocation: Option<bool> = None;

    // Track which multi-line field we're accumulating (for `>` folded scalars)
    let mut current_multiline: Option<&str> = None;
    let mut multiline_buf = String::new();

    for line in yaml_block.lines() {
        let trimmed_line = line.trim();

        // Check if this is a continuation line (indented, part of a multi-line value)
        if current_multiline.is_some()
            && (line.starts_with(' ') || line.starts_with('\t'))
            && !trimmed_line.is_empty()
        {
            if !multiline_buf.is_empty() {
                multiline_buf.push(' ');
            }
            multiline_buf.push_str(trimmed_line);
            continue;
        }

        // Flush any accumulated multi-line value
        if current_multiline.take().is_some() {
            let val = multiline_buf.trim().to_string();
            if !val.is_empty() {
                description = Some(val);
            }
            multiline_buf.clear();
        }

        // Parse new field
        if let Some(val) = trimmed_line.strip_prefix("name:") {
            name = Some(val.trim().trim_matches('"').trim_matches('\'').to_string());
        } else if let Some(val) = trimmed_line.strip_prefix("description:") {
            let val = val.trim();
            if val == ">" || val == "|" {
                current_multiline = Some("description");
            } else {
                description = Some(val.trim_matches('"').trim_matches('\'').to_string());
            }
        } else if let Some(val) = trimmed_line.strip_prefix("version:") {
            version = Some(val.trim().trim_matches('"').trim_matches('\'').to_string());
        } else if let Some(val) = trimmed_line.strip_prefix("model:") {
            model = Some(val.trim().trim_matches('"').trim_matches('\'').to_string());
        } else if let Some(val) = trimmed_line.strip_prefix("argument-hint:") {
            argument_hint = Some(val.trim().trim_matches('"').trim_matches('\'').to_string());
        } else if let Some(val) = trimmed_line.strip_prefix("user-invocable:") {
            let v = val.trim().to_lowercase();
            user_invocable = Some(v == "true" || v == "yes" || v == "1");
        } else if let Some(val) = trimmed_line.strip_prefix("disable-model-invocation:") {
            let v = val.trim().to_lowercase();
            disable_model_invocation = Some(v == "true" || v == "yes" || v == "1");
        }
        // All other keys (domain:, type:, purpose:, tools:, trigger:, etc.) are silently ignored.
    }

    // Flush any trailing multi-line value
    if current_multiline.is_some() {
        let val = multiline_buf.trim().to_string();
        if !val.is_empty() {
            description = Some(val);
        }
    }

    // Trim all fields — frontmatter values may have leading/trailing whitespace or newlines
    let trim_opt = |s: Option<String>| -> Option<String> {
        s.map(|v| v.trim().to_string()).filter(|v| !v.is_empty())
    };

    Frontmatter {
        name: trim_opt(name),
        description: trim_opt(description),
        version: trim_opt(version),
        model: trim_opt(model),
        argument_hint: trim_opt(argument_hint),
        user_invocable,
        disable_model_invocation,
    }
}

/// Find SKILL.md in the zip archive, either at the root or one level deep.
/// Returns the path within the archive and the content.
fn find_skill_md(archive: &mut zip::ZipArchive<std::fs::File>) -> Result<(String, String), String> {
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
fn get_archive_prefix(skill_md_path: &str) -> String {
    let parts: Vec<&str> = skill_md_path.split('/').filter(|p| !p.is_empty()).collect();
    if parts.len() == 2 {
        format!("{}/", parts[0])
    } else {
        String::new()
    }
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

/// Extract archive contents to destination, stripping the prefix.
fn extract_archive(
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

// ---------------------------------------------------------------------------
// list_imported_skills
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn list_imported_skills(
    source_url: Option<String>,
    db: tauri::State<'_, Db>,
) -> Result<Vec<ImportedSkill>, String> {
    log::info!("list_imported_skills: source_url={:?}", source_url);
    let conn = db.0.lock().map_err(|e| {
        log::error!("[list_imported_skills] Failed to acquire DB lock: {}", e);
        e.to_string()
    })?;
    crate::db::list_imported_skills_filtered(&conn, source_url.as_deref())
}

// ---------------------------------------------------------------------------
// delete_imported_skill
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn delete_imported_skill(skill_id: String, db: tauri::State<'_, Db>) -> Result<(), String> {
    log::info!("delete_imported_skill: skill_id={}", skill_id);
    let conn = db.0.lock().map_err(|e| {
        log::error!("[delete_imported_skill] Failed to acquire DB lock: {}", e);
        e.to_string()
    })?;
    let settings = crate::db::read_settings(&conn)?;
    let workspace_path = settings.workspace_path.unwrap_or_default();

    // Look up skill
    let skill = crate::db::get_imported_skill_by_id(&conn, &skill_id)?
        .ok_or_else(|| {
            log::error!("[delete_imported_skill] skill_id={} not found", skill_id);
            format!("Imported skill with id '{}' not found", skill_id)
        })?;

    let skill_name = skill.skill_name.clone();
    validate_skill_name(&skill_name)?;

    // Delete disk files
    let disk_path = Path::new(&skill.disk_path);
    if disk_path.exists() {
        if let Err(e) = fs::remove_dir_all(disk_path) {
            log::warn!(
                "[delete_imported_skill] failed to remove disk_path '{}': {}",
                skill.disk_path,
                e
            );
        }
    }
    // Also check the inactive path in workspace
    if !workspace_path.is_empty() {
        let skills_base = Path::new(&workspace_path).join(".claude").join("skills");
        let active_path = skills_base.join(&skill_name);
        let inactive_path = skills_base.join(".inactive").join(&skill_name);
        for path in &[active_path, inactive_path] {
            if path.exists() {
                if let Err(e) = fs::remove_dir_all(path) {
                    log::warn!(
                        "[delete_imported_skill] failed to remove '{}': {}",
                        path.display(),
                        e
                    );
                }
            }
        }
    }

    // Delete from imported_skills
    crate::db::delete_imported_skill_by_skill_id(&conn, &skill_id)?;

    // Delete from skills master
    crate::db::delete_skill(&conn, &skill_name)?;

    // Regenerate CLAUDE.md
    if !workspace_path.is_empty() {
        if let Err(e) = super::workflow::update_skills_section(&workspace_path, &conn) {
            log::warn!(
                "[delete_imported_skill] update_skills_section failed: {}",
                e
            );
        }
    }

    log::info!(
        "[delete_imported_skill] deleted skill_id={} name={}",
        skill_id,
        skill_name
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// export_skill
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn export_skill(skill_name: String, db: tauri::State<'_, Db>) -> Result<String, String> {
    log::info!("[export_skill] skill_name={}", skill_name);
    let conn = db.0.lock().map_err(|e| {
        log::error!("[export_skill] Failed to acquire DB lock: {}", e);
        e.to_string()
    })?;

    let skill = crate::db::get_imported_skill(&conn, &skill_name)?
        .ok_or_else(|| format!("Skill '{}' not found", skill_name))?;

    let skill_dir = Path::new(&skill.disk_path);
    if !skill_dir.is_dir() {
        return Err(format!("Skill directory not found: {}", skill.disk_path));
    }

    let tmp_dir = std::env::temp_dir();
    let zip_path = tmp_dir.join(format!("{}.zip", skill_name));

    let file =
        fs::File::create(&zip_path).map_err(|e| format!("Failed to create zip file: {}", e))?;
    let mut writer = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    // Walk the skill directory and add files with skill name as root prefix
    add_dir_to_zip(&mut writer, skill_dir, &skill_name, &options)?;

    writer
        .finish()
        .map_err(|e| format!("Failed to finalize zip: {}", e))?;

    log::info!("[export_skill] exported to {}", zip_path.display());
    Ok(zip_path.to_string_lossy().to_string())
}

fn add_dir_to_zip(
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
            let content =
                fs::read(&path).map_err(|e| format!("Failed to read {}: {}", path.display(), e))?;
            writer
                .start_file(&name, *options)
                .map_err(|e| format!("Failed to add to zip: {}", e))?;
            std::io::Write::write_all(writer, &content)
                .map_err(|e| format!("Failed to write zip content: {}", e))?;
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// get_skill_content
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_skill_content(skill_name: String, db: tauri::State<'_, Db>) -> Result<String, String> {
    log::info!("[get_skill_content] skill_name={}", skill_name);
    let conn = db.0.lock().map_err(|e| {
        log::error!("[get_skill_content] Failed to acquire DB lock: {}", e);
        e.to_string()
    })?;
    let skill = crate::db::get_imported_skill(&conn, &skill_name)?
        .ok_or_else(|| format!("Imported skill '{}' not found", skill_name))?;

    let skill_md_path = Path::new(&skill.disk_path).join("SKILL.md");
    fs::read_to_string(&skill_md_path).map_err(|e| format!("Failed to read SKILL.md: {}", e))
}

// ---------------------------------------------------------------------------
// purge_stale_bundled_skills (filesystem-only, no DB)
// ---------------------------------------------------------------------------

/// Remove bundled skill directories from the workspace that are no longer present in the current bundle.
/// This is a filesystem-only operation — no DB reads or writes.
///
/// **Caller responsibility:** This function does not regenerate `CLAUDE.md`. In `init_workspace`
/// that is handled by the subsequent `rebuild_claude_md` call.
pub(crate) fn purge_stale_bundled_skills(
    workspace_path: &str,
    bundled_skills_dir: &std::path::Path,
) -> Result<(), String> {
    log::info!(
        "purge_stale_bundled_skills: scanning {}",
        bundled_skills_dir.display()
    );

    // Collect currently-bundled skill names from the source directory.
    let current_names: std::collections::HashSet<String> = if bundled_skills_dir.is_dir() {
        let entries = fs::read_dir(bundled_skills_dir)
            .map_err(|e| format!("purge_stale_bundled_skills: Failed to read dir: {}", e))?;
        let mut names = std::collections::HashSet::new();
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let skill_md_path = path.join("SKILL.md");
            if !skill_md_path.is_file() {
                continue;
            }
            let dir_name = entry.file_name().to_string_lossy().to_string();
            let skill_name = fs::read_to_string(&skill_md_path)
                .ok()
                .and_then(|c| parse_frontmatter_full(&c).name)
                .unwrap_or(dir_name);
            names.insert(skill_name);
        }
        names
    } else {
        std::collections::HashSet::new()
    };

    // Scan the workspace skills directory for dirs not in current_names
    let skills_base = Path::new(workspace_path).join(".claude").join("skills");
    if skills_base.is_dir() {
        if let Ok(entries) = fs::read_dir(&skills_base) {
            for entry in entries.flatten() {
                let path = entry.path();
                if !path.is_dir() {
                    continue;
                }
                let dir_name = entry.file_name().to_string_lossy().to_string();
                // Skip .inactive and hidden dirs
                if dir_name.starts_with('.') {
                    continue;
                }
                // Only remove dirs that look like bundled skills (have SKILL.md) but are not in current bundle
                let skill_md = path.join("SKILL.md");
                if !skill_md.is_file() {
                    continue;
                }
                let skill_name = fs::read_to_string(&skill_md)
                    .ok()
                    .and_then(|c| parse_frontmatter_full(&c).name)
                    .unwrap_or_else(|| dir_name.clone());
                if !current_names.contains(&skill_name) {
                    // Check if this might be a user-imported skill — skip if it is
                    // (bundled skills have a specific ID pattern; we only purge if the dir existed before)
                    log::info!(
                        "purge_stale_bundled_skills: removing stale skill dir '{}'",
                        dir_name
                    );
                    if let Err(e) = fs::remove_dir_all(&path) {
                        log::warn!(
                            "purge_stale_bundled_skills: failed to remove '{}': {}",
                            path.display(),
                            e
                        );
                    }
                }
            }
        }
    }

    // Also check .inactive dir
    let inactive_dir = skills_base.join(".inactive");
    if inactive_dir.is_dir() {
        if let Ok(entries) = fs::read_dir(&inactive_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if !path.is_dir() {
                    continue;
                }
                let dir_name = entry.file_name().to_string_lossy().to_string();
                let skill_md = path.join("SKILL.md");
                if !skill_md.is_file() {
                    continue;
                }
                let skill_name = fs::read_to_string(&skill_md)
                    .ok()
                    .and_then(|c| parse_frontmatter_full(&c).name)
                    .unwrap_or_else(|| dir_name.clone());
                if !current_names.contains(&skill_name) {
                    log::info!(
                        "purge_stale_bundled_skills: removing stale inactive skill dir '{}'",
                        dir_name
                    );
                    if let Err(e) = fs::remove_dir_all(&path) {
                        log::warn!(
                            "purge_stale_bundled_skills: failed to remove '{}': {}",
                            path.display(),
                            e
                        );
                    }
                }
            }
        }
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// seed_bundled_skills (filesystem-only, no DB)
// ---------------------------------------------------------------------------

/// Seed bundled skills from the app's bundled-skills directory into the workspace.
/// For each subdirectory containing SKILL.md:
/// 1. Copies the directory to `{workspace}/.claude/skills/{name}/` (always overwrite)
/// This is a filesystem-only operation — no DB writes.
pub(crate) fn seed_bundled_skills(
    workspace_path: &str,
    bundled_skills_dir: &std::path::Path,
) -> Result<(), String> {
    log::info!(
        "seed_bundled_skills: scanning {}",
        bundled_skills_dir.display()
    );

    if !bundled_skills_dir.is_dir() {
        log::debug!(
            "seed_bundled_skills: bundled skills dir not found at {}",
            bundled_skills_dir.display()
        );
        return Ok(());
    }

    let entries = fs::read_dir(bundled_skills_dir)
        .map_err(|e| format!("Failed to read bundled skills dir: {}", e))?;

    for entry in entries.flatten() {
        let entry_path = entry.path();
        if !entry_path.is_dir() {
            continue;
        }

        let skill_md_path = entry_path.join("SKILL.md");
        if !skill_md_path.is_file() {
            continue;
        }

        let dir_name = entry.file_name().to_string_lossy().to_string();

        log::debug!("seed_bundled_skills: processing {}", dir_name);

        // Read and parse SKILL.md frontmatter
        let content = fs::read_to_string(&skill_md_path)
            .map_err(|e| format!("Failed to read {}: {}", skill_md_path.display(), e))?;
        let fm = parse_frontmatter_full(&content);

        let skill_name = fm.name.unwrap_or_else(|| dir_name.clone());

        // Research is plugin-owned and must not be seeded as a bundled workspace skill.
        if skill_name == "research" {
            log::debug!(
                "seed_bundled_skills: skipping plugin-owned skill '{}'",
                skill_name
            );
            continue;
        }

        // Validate required frontmatter fields; skip and error-log if any are missing
        if fm.description.is_none() {
            log::error!(
                "seed_bundled_skills: skipping '{}' — missing required frontmatter field: description",
                skill_name,
            );
            continue;
        }

        // Copy directory to the active workspace location
        let skills_base = Path::new(workspace_path).join(".claude").join("skills");
        let dest_dir = skills_base.join(&skill_name);

        // Clean up both possible locations to avoid stale copies
        let active_path = skills_base.join(&skill_name);
        let inactive_path = skills_base.join(".inactive").join(&skill_name);
        if active_path.exists() {
            fs::remove_dir_all(&active_path)
                .map_err(|e| format!("Failed to remove existing bundled skill dir: {}", e))?;
        }
        if inactive_path.exists() {
            fs::remove_dir_all(&inactive_path).map_err(|e| {
                format!(
                    "Failed to remove existing inactive bundled skill dir: {}",
                    e
                )
            })?;
        }

        fs::create_dir_all(&dest_dir)
            .map_err(|e| format!("Failed to create bundled skill dir: {}", e))?;

        copy_dir_recursive(&entry_path, &dest_dir)
            .map_err(|e| format!("Failed to copy bundled skill '{}': {}", skill_name, e))?;

        log::info!(
            "seed_bundled_skills: seeded '{}' (version={} model={} user_invocable={} disable_model_invocation={})",
            skill_name,
            fm.version.as_deref().unwrap_or("-"),
            fm.model.as_deref().unwrap_or("-"),
            fm.user_invocable.map_or("-".to_string(), |v| v.to_string()),
            fm.disable_model_invocation.map_or("-".to_string(), |v| v.to_string()),
        );
    }

    Ok(())
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

// ---------------------------------------------------------------------------
// parse_skill_file / import_skill_from_file
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn parse_skill_file(file_path: String) -> Result<crate::types::SkillFileMeta, String> {
    log::info!("[parse_skill_file] file_path={}", file_path);
    let zip_file =
        std::fs::File::open(&file_path).map_err(|e| format!("Failed to open file: {}", e))?;
    let mut archive =
        zip::ZipArchive::new(zip_file).map_err(|_| "not a valid skill package".to_string())?;
    let (_, skill_md_content) = find_skill_md(&mut archive)?;
    let fm = parse_frontmatter_full(&skill_md_content);
    if fm.name.is_none() {
        return Err("not a valid skill package: missing name field".to_string());
    }
    Ok(crate::types::SkillFileMeta {
        name: fm.name,
        description: fm.description,
        version: fm.version,
        model: fm.model,
        argument_hint: fm.argument_hint,
        user_invocable: fm.user_invocable,
        disable_model_invocation: fm.disable_model_invocation,
    })
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn import_skill_from_file(
    file_path: String,
    name: String,
    description: String,
    version: String,
    model: Option<String>,
    argument_hint: Option<String>,
    user_invocable: Option<bool>,
    disable_model_invocation: Option<bool>,
    force_overwrite: bool,
    db: tauri::State<'_, Db>,
) -> Result<String, String> {
    log::info!(
        "[import_skill_from_file] name={} force_overwrite={}",
        name,
        force_overwrite
    );

    validate_skill_name(&name)?;

    let conn = db.0.lock().map_err(|e| {
        log::error!("[import_skill_from_file] failed to acquire DB lock: {}", e);
        e.to_string()
    })?;
    let settings = crate::db::read_settings_hydrated(&conn).map_err(|e| {
        log::error!("[import_skill_from_file] failed to read settings: {}", e);
        e
    })?;
    let skills_path = settings
        .skills_path
        .ok_or_else(|| "Skills path not configured. Set it in Settings.".to_string())?;
    let workspace_path = settings.workspace_path.unwrap_or_default();

    // Re-validate zip (prevent TOCTOU between parse and import)
    let zip_file =
        std::fs::File::open(&file_path).map_err(|e| format!("Failed to open file: {}", e))?;
    let mut archive =
        zip::ZipArchive::new(zip_file).map_err(|_| "not a valid skill package".to_string())?;
    let (skill_md_path, _) = find_skill_md(&mut archive)?;
    let prefix = get_archive_prefix(&skill_md_path);

    // Conflict check
    let existing_source: Option<String> = conn
        .query_row(
            "SELECT skill_source FROM skills WHERE name = ?1",
            rusqlite::params![&name],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;

    match existing_source.as_deref() {
        Some("skill-builder") | Some("marketplace") => {
            return Err(format!("conflict_no_overwrite:{}", name));
        }
        Some("imported") if !force_overwrite => {
            return Err(format!("conflict_overwrite_required:{}", name));
        }
        Some("imported") => {
            // force_overwrite=true — clean up existing
            let dest = std::path::Path::new(&skills_path).join(&name);
            if dest.exists() {
                std::fs::remove_dir_all(&dest).map_err(|e| {
                    log::error!("[import_skill_from_file] failed to remove dir: {}", e);
                    e.to_string()
                })?;
            }
            crate::db::delete_imported_skill_by_name(&conn, &name)?;
            crate::db::delete_skill(&conn, &name)?;
        }
        _ => {} // Not found — proceed normally
    }

    // Extract all files to {skills_path}/{name}/
    let dest_dir = std::path::Path::new(&skills_path).join(&name);
    std::fs::create_dir_all(&dest_dir).map_err(|e| e.to_string())?;
    // Re-open archive (consumed during prefix scan)
    let zip_file2 =
        std::fs::File::open(&file_path).map_err(|e| format!("Failed to re-open file: {}", e))?;
    let mut archive2 =
        zip::ZipArchive::new(zip_file2).map_err(|_| "not a valid skill package".to_string())?;
    extract_archive(&mut archive2, &prefix, &dest_dir)?;

    // Write to skills master table
    crate::db::upsert_skill_with_source(&conn, &name, "imported", "domain")?;

    // Update description (not mirrored by upsert_imported_skill)
    conn.execute(
        "UPDATE skills SET description = ?2 WHERE name = ?1",
        rusqlite::params![&name, &description],
    )
    .map_err(|e| e.to_string())?;

    // Build ImportedSkill and upsert to imported_skills + mirror frontmatter to skills master
    let skill_id = generate_skill_id(&name);
    let imported_at = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let skill = crate::types::ImportedSkill {
        skill_id,
        skill_name: name.clone(),
        is_active: true,
        disk_path: dest_dir.to_string_lossy().to_string(),
        imported_at,
        is_bundled: false,
        description: Some(description),
        purpose: Some("domain".to_string()),
        version: if version.is_empty() {
            None
        } else {
            Some(version)
        },
        model,
        argument_hint,
        user_invocable,
        disable_model_invocation,
        marketplace_source_url: None,
    };
    crate::db::upsert_imported_skill(&conn, &skill)?;

    // Regenerate CLAUDE.md
    if !workspace_path.is_empty() {
        if let Err(e) = super::workflow::update_skills_section(&workspace_path, &conn) {
            log::warn!(
                "[import_skill_from_file] update_skills_section failed: {}",
                e
            );
        }
    }

    log::info!(
        "[import_skill_from_file] imported '{}' to '{}'",
        name,
        dest_dir.display()
    );
    Ok(name)
}
