use crate::db::Db;
use crate::types::WorkspaceSkill;
use std::fs;
use std::io::Read;
use std::path::Path;

/// Validate that a skill name is safe for use in file paths.
/// Rejects names containing path traversal characters or empty strings.
pub(crate) fn validate_skill_name(name: &str) -> Result<(), String> {
    if name.is_empty() {
        return Err("Skill name cannot be empty".to_string());
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
pub(crate) fn parse_frontmatter(
    content: &str,
) -> (Option<String>, Option<String>) {
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
        if current_multiline.is_some() && (line.starts_with(' ') || line.starts_with('\t')) && !trimmed_line.is_empty() {
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

/// Derive a skill name from a zip filename by removing the extension
/// and replacing non-alphanumeric characters with hyphens.
fn derive_name_from_filename(file_path: &str) -> String {
    let path = Path::new(file_path);
    let stem = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("imported-skill");

    // Clean up: replace spaces and underscores with hyphens, lowercase
    stem.to_lowercase()
        .replace(['_', ' '], "-")
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '-')
        .collect()
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
            file.read_to_string(&mut content).map_err(|e| e.to_string())?;
            Ok((name, content))
        }
        None => Err("Invalid skill package: SKILL.md not found at root or one level deep".to_string()),
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

#[tauri::command]
pub fn upload_skill(
    file_path: String,
    db: tauri::State<'_, Db>,
) -> Result<WorkspaceSkill, String> {
    log::info!("[upload_skill] file_path={}", file_path);
    let conn = db.0.lock().map_err(|e| {
        log::error!("[upload_skill] Failed to acquire DB lock: {}", e);
        e.to_string()
    })?;
    let settings = crate::db::read_settings(&conn)?;
    let workspace_path = settings
        .workspace_path
        .ok_or_else(|| "Workspace path not initialized".to_string())?;

    let result = upload_skill_inner(&file_path, &workspace_path, &conn)?;

    // Regenerate CLAUDE.md with updated workspace skills
    if let Err(e) = super::workflow::update_skills_section(&workspace_path, &conn) {
        log::warn!("Failed to update CLAUDE.md after skill upload: {}", e);
    }

    Ok(result)
}

fn upload_skill_inner(
    file_path: &str,
    workspace_path: &str,
    conn: &rusqlite::Connection,
) -> Result<WorkspaceSkill, String> {
    // Open and validate zip
    let zip_file = fs::File::open(file_path)
        .map_err(|e| format!("Failed to open file '{}': {}", file_path, e))?;
    let mut archive = zip::ZipArchive::new(zip_file)
        .map_err(|e| format!("Invalid zip file '{}': {}", file_path, e))?;

    // Find and read SKILL.md
    let (skill_md_path, skill_md_content) = find_skill_md(&mut archive)?;
    let prefix = get_archive_prefix(&skill_md_path);

    // Parse frontmatter for metadata
    let fm = parse_frontmatter_full(&skill_md_content);

    // Validate mandatory fields: name and description must both be present
    let missing_fields: Vec<&str> = [
        ("name", fm.name.is_none()),
        ("description", fm.description.is_none()),
    ]
    .iter()
    .filter(|(_, missing)| *missing)
    .map(|(f, _)| *f)
    .collect();
    if !missing_fields.is_empty() {
        log::error!(
            "[upload_skill_inner] '{}' missing required frontmatter fields: {}",
            file_path,
            missing_fields.join(", ")
        );
        return Err(format!(
            "missing_mandatory_fields:{}",
            missing_fields.join(",")
        ));
    }

    // Determine skill name: frontmatter name > filename
    let skill_name = fm.name
        .unwrap_or_else(|| derive_name_from_filename(file_path));

    if skill_name.is_empty() {
        return Err("Could not determine skill name from file".to_string());
    }

    // Set up destination directory
    let skills_dir = Path::new(workspace_path).join(".claude").join("skills");
    let dest_dir = skills_dir.join(&skill_name);

    if dest_dir.exists() {
        return Err(format!(
            "Skill '{}' already exists at '{}'",
            skill_name,
            dest_dir.display()
        ));
    }

    fs::create_dir_all(&skills_dir)
        .map_err(|e| format!("Failed to create skills directory: {}", e))?;

    // Extract files
    extract_archive(&mut archive, &prefix, &dest_dir)?;

    // Generate skill ID and timestamp
    let skill_id = generate_skill_id(&skill_name);
    let imported_at = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();

    let skill = WorkspaceSkill {
        skill_id,
        skill_name: skill_name.clone(),
                is_active: true,
        disk_path: dest_dir.to_string_lossy().to_string(),
        imported_at,
        is_bundled: false,
        // Store description from frontmatter in DB
        description: fm.description,
        purpose: None,
        version: fm.version,
        model: fm.model,
        argument_hint: fm.argument_hint,
        user_invocable: fm.user_invocable,
        disable_model_invocation: fm.disable_model_invocation,
        marketplace_source_url: None,
    };

    // Insert into workspace_skills DB
    crate::db::insert_workspace_skill(conn, &skill)?;

    Ok(skill)
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
    let canonical_dest = dest_dir.canonicalize()
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
            let canonical_out = out_path.canonicalize()
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
                let canonical_parent = parent.canonicalize()
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

#[tauri::command]
pub fn list_workspace_skills(
    db: tauri::State<'_, Db>,
) -> Result<Vec<WorkspaceSkill>, String> {
    log::info!("[list_workspace_skills]");
    let conn = db.0.lock().map_err(|e| {
        log::error!("[list_workspace_skills] Failed to acquire DB lock: {}", e);
        e.to_string()
    })?;
    crate::db::list_workspace_skills(&conn)
}

#[tauri::command]
pub fn toggle_skill_active(
    skill_id: String,
    active: bool,
    db: tauri::State<'_, Db>,
) -> Result<(), String> {
    log::info!("[toggle_skill_active] skill_id={} active={}", skill_id, active);
    let conn = db.0.lock().map_err(|e| {
        log::error!("[toggle_skill_active] Failed to acquire DB lock: {}", e);
        e.to_string()
    })?;
    let settings = crate::db::read_settings(&conn)?;
    let workspace_path = settings
        .workspace_path
        .ok_or_else(|| "Workspace path not initialized".to_string())?;

    // Look up skill_name from skill_id for disk path operations
    let skill = crate::db::get_workspace_skill(&conn, &skill_id)?
        .ok_or_else(|| format!("Workspace skill with id '{}' not found", skill_id))?;
    let skill_name = &skill.skill_name;

    toggle_skill_active_inner(&skill_id, skill_name, active, &workspace_path, &conn)?;

    // When activating, auto-deactivate any other active skill with the same purpose
    if active {
        if let Some(ref purpose) = skill.purpose {
            // Query siblings before the UPDATE so we can move them on disk afterward
            let mut sibling_stmt = conn.prepare(
                "SELECT skill_id, skill_name FROM workspace_skills WHERE purpose = ?1 AND skill_id != ?2 AND is_active = 1"
            ).map_err(|e| format!("Failed to prepare sibling query: {}", e))?;
            let siblings: Vec<(String, String)> = sibling_stmt.query_map(rusqlite::params![purpose, skill_id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|e| format!("Failed to query siblings: {}", e))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Failed to collect siblings: {}", e))?;
            drop(sibling_stmt);

            let rows_affected = conn.execute(
                "UPDATE workspace_skills SET is_active = 0 WHERE purpose = ?1 AND skill_id != ?2 AND is_active = 1",
                rusqlite::params![purpose, skill_id],
            ).map_err(|e| {
                log::error!("[toggle_skill_active] failed to deactivate conflicting purposes: {}", e);
                format!("Failed to deactivate conflicting purpose skills: {}", e)
            })?;
            if rows_affected > 0 {
                log::info!(
                    "[toggle_skill_active] deactivated {} other skill(s) with purpose='{}'",
                    rows_affected, purpose
                );
            }

            // Move deactivated siblings' directories from active to inactive on disk
            let skills_dir = Path::new(&workspace_path).join(".claude").join("skills");
            let inactive_dir = skills_dir.join(".inactive");
            for (sibling_id, sibling_name) in &siblings {
                let src = skills_dir.join(sibling_name);
                let dst = inactive_dir.join(sibling_name);
                if src.exists() {
                    if let Err(e) = fs::create_dir_all(&inactive_dir) {
                        log::error!(
                            "[toggle_skill_active] failed to create .inactive dir for sibling '{}': {}",
                            sibling_name, e
                        );
                        continue;
                    }
                    if let Err(e) = fs::rename(&src, &dst) {
                        log::error!(
                            "[toggle_skill_active] failed to move sibling '{}' to inactive: {}",
                            sibling_name, e
                        );
                        // Don't fail the whole activation — DB is already updated
                        continue;
                    }
                    // Update disk_path in DB to reflect the new location
                    let new_disk_path = dst.to_string_lossy().to_string();
                    if let Err(e) = crate::db::update_workspace_skill_active(&conn, sibling_id, false, &new_disk_path) {
                        log::error!(
                            "[toggle_skill_active] failed to update disk_path for sibling '{}': {}",
                            sibling_name, e
                        );
                    }
                    log::debug!(
                        "[toggle_skill_active] moved sibling '{}' to inactive on disk",
                        sibling_name
                    );
                }
            }
        }
    }

    // Regenerate CLAUDE.md with updated active skills
    if let Err(e) = super::workflow::update_skills_section(&workspace_path, &conn) {
        log::warn!("Failed to update CLAUDE.md after toggling skill: {}", e);
    }

    Ok(())
}

fn toggle_skill_active_inner(
    skill_id: &str,
    skill_name: &str,
    active: bool,
    workspace_path: &str,
    conn: &rusqlite::Connection,
) -> Result<(), String> {
    validate_skill_name(skill_name)?;

    let skills_dir = Path::new(workspace_path).join(".claude").join("skills");
    let active_path = skills_dir.join(skill_name);
    let inactive_dir = skills_dir.join(".inactive");
    let inactive_path = inactive_dir.join(skill_name);

    let (src, dst) = if active {
        (&inactive_path, &active_path)
    } else {
        (&active_path, &inactive_path)
    };

    let new_disk_path = dst.to_string_lossy().to_string();
    let old_disk_path = src.to_string_lossy().to_string();

    // Step 1: Update DB first (clean failure — no side effects if this fails)
    crate::db::update_workspace_skill_active(conn, skill_id, active, &new_disk_path)?;

    // Step 2: Move files on disk. If this fails, revert the DB update.
    if src.exists() {
        // Ensure destination parent directory exists (skills_dir when activating, .inactive when deactivating)
        let dest_parent = if active { &skills_dir } else { &inactive_dir };
        if let Err(e) = fs::create_dir_all(dest_parent) {
            let _ = crate::db::update_workspace_skill_active(
                conn, skill_id, !active, &old_disk_path,
            );
            return Err(format!("Failed to create destination directory: {}", e));
        }

        // If dst already exists (disk/DB desync: skill is in both places), remove the stale
        // destination before renaming so we don't hit ENOTEMPTY on macOS/Linux.
        if dst.exists() {
            log::warn!(
                "[toggle_skill_active] destination already exists, removing stale copy: {}",
                dst.display()
            );
            if let Err(e) = fs::remove_dir_all(dst) {
                let _ = crate::db::update_workspace_skill_active(
                    conn, skill_id, !active, &old_disk_path,
                );
                return Err(format!("Failed to clear stale destination for '{}': {}", skill_name, e));
            }
        }

        if let Err(move_err) = fs::rename(src, dst) {
            // Revert the DB update
            let _ = crate::db::update_workspace_skill_active(
                conn, skill_id, !active, &old_disk_path,
            );
            return Err(format!(
                "Failed to {} skill '{}': {}",
                if active { "activate" } else { "deactivate" },
                skill_name,
                move_err
            ));
        }
    } else if active && dst.exists() {
        // Skill is already at the active path but DB thought it was inactive — disk/DB desync.
        // DB was already updated above; nothing to move.
        log::warn!(
            "[toggle_skill_active] activating '{}': src not found but dst exists, DB updated only",
            skill_name
        );
    }

    Ok(())
}

/// Set or clear the `purpose` tag on a workspace skill.
/// Purpose tags allow callers to resolve skills by role (e.g. "test-context",
/// "research", "validate", "skill-building") instead of by name.
#[tauri::command]
pub fn set_workspace_skill_purpose(
    state: tauri::State<'_, crate::db::Db>,
    skill_id: String,
    purpose: Option<String>,
) -> Result<(), String> {
    log::info!(
        "[set_workspace_skill_purpose] skill_id={} purpose={:?}",
        skill_id, purpose
    );
    let conn = state.0.lock().map_err(|e| {
        log::error!("[set_workspace_skill_purpose] Failed to acquire DB lock: {}", e);
        e.to_string()
    })?;
    conn.execute(
        "UPDATE workspace_skills SET purpose = ?1 WHERE skill_id = ?2",
        rusqlite::params![purpose, skill_id],
    ).map_err(|e| {
        log::error!("[set_workspace_skill_purpose] DB update failed: {}", e);
        format!("set_workspace_skill_purpose: {}", e)
    })?;
    Ok(())
}

#[tauri::command]
pub fn delete_imported_skill(
    skill_id: String,
    db: tauri::State<'_, Db>,
) -> Result<(), String> {
    log::info!("[delete_imported_skill] skill_id={}", skill_id);
    let conn = db.0.lock().map_err(|e| {
        log::error!("[delete_imported_skill] Failed to acquire DB lock: {}", e);
        e.to_string()
    })?;
    let settings = crate::db::read_settings(&conn)?;
    let workspace_path = settings
        .workspace_path
        .ok_or_else(|| "Workspace path not initialized".to_string())?;

    // Look up skill_name from skill_id for disk path operations
    let skill = crate::db::get_workspace_skill(&conn, &skill_id)?
        .ok_or_else(|| format!("Workspace skill with id '{}' not found", skill_id))?;
    let skill_name = skill.skill_name.clone();

    delete_imported_skill_inner(&skill_id, &skill_name, &workspace_path, &conn)?;

    // Regenerate CLAUDE.md without the deleted skill
    if let Err(e) = super::workflow::update_skills_section(&workspace_path, &conn) {
        log::warn!("Failed to update CLAUDE.md after deleting skill: {}", e);
    }

    Ok(())
}

fn delete_imported_skill_inner(
    skill_id: &str,
    skill_name: &str,
    workspace_path: &str,
    conn: &rusqlite::Connection,
) -> Result<(), String> {
    validate_skill_name(skill_name)?;

    // Guard: prevent deletion of bundled skills
    if let Some(existing) = crate::db::get_workspace_skill(conn, skill_id)? {
        if existing.is_bundled {
            return Err(format!(
                "Cannot delete bundled skill '{}'. Deactivate it instead.",
                skill_name
            ));
        }
    }

    let skills_dir = Path::new(workspace_path).join(".claude").join("skills");
    let active_path = skills_dir.join(skill_name);
    let inactive_path = skills_dir.join(".inactive").join(skill_name);

    // Remove from disk (check both locations)
    if active_path.exists() {
        fs::remove_dir_all(&active_path)
            .map_err(|e| format!("Failed to delete skill directory: {}", e))?;
    }
    if inactive_path.exists() {
        fs::remove_dir_all(&inactive_path)
            .map_err(|e| format!("Failed to delete inactive skill directory: {}", e))?;
    }

    // Remove from workspace_skills DB using skill_id PK
    crate::db::delete_workspace_skill(conn, skill_id)?;

    Ok(())
}

#[tauri::command]
pub fn export_skill(
    skill_name: String,
    db: tauri::State<'_, Db>,
) -> Result<String, String> {
    log::info!("[export_skill] skill_name={}", skill_name);
    let conn = db.0.lock().map_err(|e| {
        log::error!("[export_skill] Failed to acquire DB lock: {}", e);
        e.to_string()
    })?;

    let skill = crate::db::get_workspace_skill_by_name(&conn, &skill_name)?
        .ok_or_else(|| format!("Skill '{}' not found", skill_name))?;

    let skill_dir = Path::new(&skill.disk_path);
    if !skill_dir.is_dir() {
        return Err(format!("Skill directory not found: {}", skill.disk_path));
    }

    let tmp_dir = std::env::temp_dir();
    let zip_path = tmp_dir.join(format!("{}.zip", skill_name));

    let file = fs::File::create(&zip_path)
        .map_err(|e| format!("Failed to create zip file: {}", e))?;
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

#[tauri::command]
pub fn get_skill_content(
    skill_name: String,
    db: tauri::State<'_, Db>,
) -> Result<String, String> {
    log::info!("[get_skill_content] skill_name={}", skill_name);
    let conn = db.0.lock().map_err(|e| {
        log::error!("[get_skill_content] Failed to acquire DB lock: {}", e);
        e.to_string()
    })?;
    let skill = crate::db::get_workspace_skill_by_name(&conn, &skill_name)?
        .ok_or_else(|| format!("Workspace skill '{}' not found", skill_name))?;

    let skill_md_path = Path::new(&skill.disk_path).join("SKILL.md");
    fs::read_to_string(&skill_md_path)
        .map_err(|e| format!("Failed to read SKILL.md: {}", e))
}

/// Seed bundled skills from the app's bundled-skills directory into the workspace.
/// For each subdirectory containing SKILL.md:
/// 1. Copies the directory to `{workspace}/.claude/skills/{name}/` (always overwrite)
/// 2. Upserts into DB with `is_bundled: true` (preserves `is_active` if already exists)
pub(crate) fn seed_bundled_skills(
    workspace_path: &str,
    conn: &rusqlite::Connection,
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

        let dir_name = entry
            .file_name()
            .to_string_lossy()
            .to_string();

        log::debug!("seed_bundled_skills: processing {}", dir_name);

        // Read and parse SKILL.md frontmatter
        let content = fs::read_to_string(&skill_md_path)
            .map_err(|e| format!("Failed to read {}: {}", skill_md_path.display(), e))?;
        let fm = parse_frontmatter_full(&content);

        let skill_name = fm.name.unwrap_or_else(|| dir_name.clone());

        // Validate required frontmatter fields; skip and error-log if any are missing
        let mut missing_required: Vec<&str> = Vec::new();
        if fm.description.is_none() { missing_required.push("description"); }
        if !missing_required.is_empty() {
            log::error!(
                "seed_bundled_skills: skipping '{}' — missing required frontmatter fields: {}",
                skill_name,
                missing_required.join(", ")
            );
            continue;
        }

        // Check if the skill already exists to preserve is_active
        let existing = crate::db::get_workspace_skill_by_name(conn, &skill_name)?;
        let is_active = existing.as_ref().is_none_or(|s| s.is_active);

        // Copy directory to the correct workspace location based on toggle state:
        //   active  → {workspace}/.claude/skills/{name}/
        //   inactive → {workspace}/.claude/skills/.inactive/{name}/
        let skills_base = Path::new(workspace_path).join(".claude").join("skills");
        let dest_dir = if is_active {
            skills_base.join(&skill_name)
        } else {
            skills_base.join(".inactive").join(&skill_name)
        };

        // Clean up both possible locations to avoid stale copies
        let active_path = skills_base.join(&skill_name);
        let inactive_path = skills_base.join(".inactive").join(&skill_name);
        if active_path.exists() {
            fs::remove_dir_all(&active_path)
                .map_err(|e| format!("Failed to remove existing bundled skill dir: {}", e))?;
        }
        if inactive_path.exists() {
            fs::remove_dir_all(&inactive_path)
                .map_err(|e| format!("Failed to remove existing inactive bundled skill dir: {}", e))?;
        }

        fs::create_dir_all(&dest_dir)
            .map_err(|e| format!("Failed to create bundled skill dir: {}", e))?;

        copy_dir_recursive(&entry_path, &dest_dir)
            .map_err(|e| format!("Failed to copy bundled skill '{}': {}", skill_name, e))?;

        let skill = crate::types::WorkspaceSkill {
            skill_id: format!("bundled-{}", skill_name),
            skill_name: skill_name.clone(),
                        is_active,
            disk_path: dest_dir.to_string_lossy().to_string(),
            imported_at: "2000-01-01T00:00:00Z".to_string(),
            is_bundled: true,
            // Store description from frontmatter in DB
            description: fm.description,
                        version: fm.version,
            model: fm.model,
            argument_hint: fm.argument_hint,
            user_invocable: fm.user_invocable,
            disable_model_invocation: fm.disable_model_invocation,
            purpose: None,
            marketplace_source_url: None,
        };

        crate::db::upsert_bundled_workspace_skill(conn, &skill)?;
        log::info!(
            "seed_bundled_skills: seeded '{}' (is_active={} version={} model={} user_invocable={} disable_model_invocation={})",
            skill_name,
            is_active,
            skill.version.as_deref().unwrap_or("-"),
            skill.model.as_deref().unwrap_or("-"),
            skill.user_invocable.map_or("-".to_string(), |v| v.to_string()),
            skill.disable_model_invocation.map_or("-".to_string(), |v| v.to_string()),
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::test_utils::create_test_db;
    use crate::types::{ImportedSkill, WorkspaceSkill};
    use std::io::Write;
    use tempfile::tempdir;

    fn make_test_skill() -> ImportedSkill {
        ImportedSkill {
            skill_id: "test-id-123".to_string(),
            skill_name: "my-test-skill".to_string(),
            is_active: true,
            disk_path: "/tmp/test-skill".to_string(),
            imported_at: "2025-01-01 00:00:00".to_string(),
            is_bundled: false,
            description: None,            version: None,
            model: None,
            argument_hint: None,
            user_invocable: None,
            disable_model_invocation: None,
            purpose: None,
            marketplace_source_url: None,
        }
    }

    // --- DB CRUD tests ---

    #[test]
    fn test_insert_and_list_workspace_skill() {
        let conn = create_test_db();
        let skill = WorkspaceSkill::from(make_test_skill());
        crate::db::insert_workspace_skill(&conn, &skill).unwrap();

        let skills = crate::db::list_workspace_skills(&conn).unwrap();
        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].skill_name, "my-test-skill");
        assert_eq!(skills[0].purpose, None);
        assert!(skills[0].is_active);
    }

    #[test]
    fn test_insert_duplicate_skill_name_errors() {
        let conn = create_test_db();
        let skill = make_test_skill();
        crate::db::insert_imported_skill(&conn, &skill).unwrap();

        let mut dup = make_test_skill();
        dup.skill_id = "different-id".to_string();
        let result = crate::db::insert_imported_skill(&conn, &dup);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("already been imported"));
    }

    #[test]
    fn test_update_imported_skill_active() {
        let conn = create_test_db();
        // Skills master row required for FK-based update
        crate::db::upsert_skill(&conn, "my-test-skill", "imported", "domain").unwrap();
        let skill = make_test_skill();
        crate::db::insert_imported_skill(&conn, &skill).unwrap();

        crate::db::update_imported_skill_active(&conn, "my-test-skill", false, "/tmp/inactive/my-test-skill").unwrap();
        let found = crate::db::get_imported_skill(&conn, "my-test-skill").unwrap().unwrap();
        assert!(!found.is_active);
        assert_eq!(found.disk_path, "/tmp/inactive/my-test-skill");

        crate::db::update_imported_skill_active(&conn, "my-test-skill", true, "/tmp/active/my-test-skill").unwrap();
        let found = crate::db::get_imported_skill(&conn, "my-test-skill").unwrap().unwrap();
        assert!(found.is_active);
        assert_eq!(found.disk_path, "/tmp/active/my-test-skill");
    }

    #[test]
    fn test_update_nonexistent_skill_errors() {
        let conn = create_test_db();
        let result = crate::db::update_imported_skill_active(&conn, "no-such-skill", true, "/tmp/path");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not found"));
    }

    #[test]
    fn test_delete_imported_skill_db() {
        let conn = create_test_db();
        let skill = make_test_skill();
        crate::db::insert_imported_skill(&conn, &skill).unwrap();

        crate::db::delete_imported_skill(&conn, "my-test-skill").unwrap();
        let found = crate::db::get_imported_skill(&conn, "my-test-skill").unwrap();
        assert!(found.is_none());
    }

    #[test]
    fn test_get_imported_skill_not_found() {
        let conn = create_test_db();
        let found = crate::db::get_imported_skill(&conn, "nonexistent").unwrap();
        assert!(found.is_none());
    }

    // --- Frontmatter parsing tests ---

    #[test]
    fn test_parse_frontmatter_all_fields() {
        let content = r#"---
name: my-skill
description: A great skill for analytics
---

# My Skill
"#;
        let (name, desc) = parse_frontmatter(content);
        assert_eq!(name.as_deref(), Some("my-skill"));
        assert_eq!(desc.as_deref(), Some("A great skill for analytics"));
    }

    #[test]
    fn test_parse_frontmatter_quoted_values() {
        let content = r#"---
name: "quoted-name"
description: 'single quoted'
---
"#;
        let (name, desc) = parse_frontmatter(content);
        assert_eq!(name.as_deref(), Some("quoted-name"));
        assert_eq!(desc.as_deref(), Some("single quoted"));
    }

    #[test]
    fn test_parse_frontmatter_no_frontmatter() {
        let content = "# Just a heading\nSome content";
        let (name, desc) = parse_frontmatter(content);
        assert!(name.is_none());
        assert!(desc.is_none());
    }

    #[test]
    fn test_parse_frontmatter_partial() {
        let content = r#"---
name: only-name
---
# Content
"#;
        let (name, desc) = parse_frontmatter(content);
        assert_eq!(name.as_deref(), Some("only-name"));
        assert!(desc.is_none());
    }

    #[test]
    fn test_parse_frontmatter_unknown_keys_ignored() {
        // domain:, type:, purpose:, tools:, trigger: and any other unknown keys are silently ignored.
        let content = r#"---
name: my-platform-skill
description: A platform skill
domain: aws
type: platform
purpose: skill-builder
tools: Read, Write
trigger: some trigger text
---
# My Skill
"#;
        let (name, desc) = parse_frontmatter(content);
        assert_eq!(name.as_deref(), Some("my-platform-skill"));
        assert_eq!(desc.as_deref(), Some("A platform skill"));
    }

    // --- Optional field parsing tests ---

    #[test]
    fn test_parse_frontmatter_optional_fields_present() {
        let content = r#"---
name: my-skill
description: A skill
version: 1.2.3
model: claude-opus-4-5
argument-hint: <topic>
user-invocable: true
disable-model-invocation: false
---
# My Skill
"#;
        let fm = parse_frontmatter_full(content);
        assert_eq!(fm.version.as_deref(), Some("1.2.3"));
        assert_eq!(fm.model.as_deref(), Some("claude-opus-4-5"));
        assert_eq!(fm.argument_hint.as_deref(), Some("<topic>"));
        assert_eq!(fm.user_invocable, Some(true));
        assert_eq!(fm.disable_model_invocation, Some(false));
    }

    #[test]
    fn test_parse_frontmatter_optional_fields_absent() {
        let content = r#"---
name: my-skill
description: A skill
---
# My Skill
"#;
        let fm = parse_frontmatter_full(content);
        assert!(fm.version.is_none());
        assert!(fm.model.is_none());
        assert!(fm.argument_hint.is_none());
        assert!(fm.user_invocable.is_none());
        assert!(fm.disable_model_invocation.is_none());
    }

    #[test]
    fn test_parse_frontmatter_boolean_coercion_true_values() {
        // "true", "yes", "1" all coerce to true
        let content_true = "---\nname: s\ndescription: d\nuser-invocable: true\ndisable-model-invocation: true\n---\n";
        let fm = parse_frontmatter_full(content_true);
        assert_eq!(fm.user_invocable, Some(true));
        assert_eq!(fm.disable_model_invocation, Some(true));

        let content_yes = "---\nname: s\ndescription: d\nuser-invocable: yes\ndisable-model-invocation: yes\n---\n";
        let fm = parse_frontmatter_full(content_yes);
        assert_eq!(fm.user_invocable, Some(true));
        assert_eq!(fm.disable_model_invocation, Some(true));

        let content_one = "---\nname: s\ndescription: d\nuser-invocable: 1\ndisable-model-invocation: 1\n---\n";
        let fm = parse_frontmatter_full(content_one);
        assert_eq!(fm.user_invocable, Some(true));
        assert_eq!(fm.disable_model_invocation, Some(true));
    }

    #[test]
    fn test_parse_frontmatter_boolean_coercion_false_values() {
        // "false", "no", "0", and any other value coerce to false
        let content_false = "---\nname: s\ndescription: d\nuser-invocable: false\ndisable-model-invocation: false\n---\n";
        let fm = parse_frontmatter_full(content_false);
        assert_eq!(fm.user_invocable, Some(false));
        assert_eq!(fm.disable_model_invocation, Some(false));

        let content_no = "---\nname: s\ndescription: d\nuser-invocable: no\ndisable-model-invocation: no\n---\n";
        let fm = parse_frontmatter_full(content_no);
        assert_eq!(fm.user_invocable, Some(false));
        assert_eq!(fm.disable_model_invocation, Some(false));

        let content_zero = "---\nname: s\ndescription: d\nuser-invocable: 0\ndisable-model-invocation: 0\n---\n";
        let fm = parse_frontmatter_full(content_zero);
        assert_eq!(fm.user_invocable, Some(false));
        assert_eq!(fm.disable_model_invocation, Some(false));
    }

    #[test]
    fn test_parse_frontmatter_argument_hint_with_angle_brackets() {
        // argument-hint often contains angle-bracket placeholders like "<topic>"
        let content = "---\nname: s\ndescription: d\nargument-hint: <keyword>\n---\n";
        let fm = parse_frontmatter_full(content);
        assert_eq!(fm.argument_hint.as_deref(), Some("<keyword>"));
    }

    #[test]
    fn test_parse_frontmatter_argument_hint_quoted() {
        let content = "---\nname: s\ndescription: d\nargument-hint: \"my hint\"\n---\n";
        let fm = parse_frontmatter_full(content);
        assert_eq!(fm.argument_hint.as_deref(), Some("my hint"));
    }

    // --- Filename derivation tests ---

    #[test]
    fn test_derive_name_from_filename() {
        assert_eq!(derive_name_from_filename("/path/to/My Skill.skill"), "my-skill");
        assert_eq!(derive_name_from_filename("analytics_v2.zip"), "analytics-v2");
        assert_eq!(derive_name_from_filename("simple.skill"), "simple");
    }

    // --- Zip validation tests ---

    fn create_test_zip(files: &[(&str, &str)]) -> tempfile::NamedTempFile {
        let tmp = tempfile::NamedTempFile::new().unwrap();
        let mut writer = zip::ZipWriter::new(tmp.as_file().try_clone().unwrap());
        let options = zip::write::SimpleFileOptions::default();

        for (name, content) in files {
            writer.start_file(name.to_string(), options).unwrap();
            writer.write_all(content.as_bytes()).unwrap();
        }
        writer.finish().unwrap();
        tmp
    }

    #[test]
    fn test_find_skill_md_at_root() {
        let zip_file = create_test_zip(&[
            ("SKILL.md", "---\nname: test\n---\n# Test"),
            ("references/ref.md", "# Ref"),
        ]);

        let file = fs::File::open(zip_file.path()).unwrap();
        let mut archive = zip::ZipArchive::new(file).unwrap();
        let (path, content) = find_skill_md(&mut archive).unwrap();
        assert_eq!(path, "SKILL.md");
        assert!(content.contains("# Test"));
    }

    #[test]
    fn test_find_skill_md_one_level_deep() {
        let zip_file = create_test_zip(&[
            ("my-skill/SKILL.md", "---\nname: nested\n---\n# Nested"),
            ("my-skill/references/ref.md", "# Ref"),
        ]);

        let file = fs::File::open(zip_file.path()).unwrap();
        let mut archive = zip::ZipArchive::new(file).unwrap();
        let (path, content) = find_skill_md(&mut archive).unwrap();
        assert_eq!(path, "my-skill/SKILL.md");
        assert!(content.contains("# Nested"));
    }

    #[test]
    fn test_find_skill_md_missing() {
        let zip_file = create_test_zip(&[
            ("README.md", "# No skill here"),
        ]);

        let file = fs::File::open(zip_file.path()).unwrap();
        let mut archive = zip::ZipArchive::new(file).unwrap();
        let result = find_skill_md(&mut archive);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("SKILL.md not found"));
    }

    #[test]
    fn test_invalid_zip() {
        let tmp = tempfile::NamedTempFile::new().unwrap();
        std::io::Write::write_all(&mut tmp.as_file().try_clone().unwrap(), b"not a zip").unwrap();

        let file = fs::File::open(tmp.path()).unwrap();
        let result = zip::ZipArchive::new(file);
        assert!(result.is_err());
    }

    // --- Upload integration tests ---

    #[test]
    fn test_upload_skill_with_frontmatter() {
        let conn = create_test_db();
        let workspace = tempdir().unwrap();
        let workspace_path = workspace.path().to_str().unwrap();

        let zip_file = create_test_zip(&[
            ("SKILL.md", "---\nname: analytics-skill\ndescription: Analytics domain skill\n---\n# Analytics Skill"),
            ("references/concepts.md", "# Concepts"),
        ]);

        let result = upload_skill_inner(
            zip_file.path().to_str().unwrap(),
            workspace_path,
            &conn,
        );
        assert!(result.is_ok(), "upload_skill_inner failed: {:?}", result.err());

        let skill = result.unwrap();
        assert_eq!(skill.skill_name, "analytics-skill");
        assert_eq!(skill.description.as_deref(), Some("Analytics domain skill"));
        assert!(skill.is_active);
        // purpose is None by default on zip upload
        assert_eq!(skill.purpose, None);

        // Verify files were extracted
        let skill_dir = workspace.path().join(".claude").join("skills").join("analytics-skill");
        assert!(skill_dir.join("SKILL.md").exists());
        assert!(skill_dir.join("references").join("concepts.md").exists());

        // Verify DB record
        let db_skill = crate::db::get_workspace_skill_by_name(&conn, "analytics-skill").unwrap().unwrap();
        assert_eq!(db_skill.skill_name, "analytics-skill");
    }

    #[test]
    fn test_upload_skill_no_frontmatter_fails_missing_fields() {
        let conn = create_test_db();
        let workspace = tempdir().unwrap();
        let workspace_path = workspace.path().to_str().unwrap();

        let zip_file = create_test_zip(&[
            ("SKILL.md", "# A Skill Without Frontmatter"),
        ]);

        let result = upload_skill_inner(
            zip_file.path().to_str().unwrap(),
            workspace_path,
            &conn,
        );
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            err.starts_with("missing_mandatory_fields:"),
            "Expected missing_mandatory_fields error, got: {}",
            err
        );
    }

    #[test]
    fn test_upload_skill_partial_frontmatter_fails_missing_fields() {
        let conn = create_test_db();
        let workspace = tempdir().unwrap();
        let workspace_path = workspace.path().to_str().unwrap();

        // Has name but missing domain and description
        let zip_file = create_test_zip(&[
            ("SKILL.md", "---\nname: my-skill\n---\n# My Skill"),
        ]);

        let result = upload_skill_inner(
            zip_file.path().to_str().unwrap(),
            workspace_path,
            &conn,
        );
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.starts_with("missing_mandatory_fields:"), "got: {}", err);
        // domain no longer mandatory
        assert!(err.contains("description"), "should report description missing");
    }

    #[test]
    fn test_upload_skill_nested_zip() {
        let conn = create_test_db();
        let workspace = tempdir().unwrap();
        let workspace_path = workspace.path().to_str().unwrap();

        let zip_file = create_test_zip(&[
            ("nested-skill/SKILL.md", "---\nname: nested-test\ndescription: A nested test skill\n---\n# Nested"),
            ("nested-skill/references/data.md", "# Data"),
        ]);

        let result = upload_skill_inner(
            zip_file.path().to_str().unwrap(),
            workspace_path,
            &conn,
        );
        assert!(result.is_ok());
        let skill = result.unwrap();
        assert_eq!(skill.skill_name, "nested-test");

        // Verify files extracted correctly (prefix stripped)
        let skill_dir = workspace.path().join(".claude").join("skills").join("nested-test");
        assert!(skill_dir.join("SKILL.md").exists());
        assert!(skill_dir.join("references").join("data.md").exists());
    }

    #[test]
    fn test_upload_duplicate_skill_errors() {
        let conn = create_test_db();
        let workspace = tempdir().unwrap();
        let workspace_path = workspace.path().to_str().unwrap();

        let zip_file = create_test_zip(&[
            ("SKILL.md", "---\nname: dup-skill\ndescription: A duplicate skill\n---\n# Dup"),
        ]);

        // First upload succeeds
        upload_skill_inner(zip_file.path().to_str().unwrap(), workspace_path, &conn).unwrap();

        // Second upload with same name should fail
        let zip_file2 = create_test_zip(&[
            ("SKILL.md", "---\nname: dup-skill\ndescription: A duplicate skill\n---\n# Dup 2"),
        ]);
        let result = upload_skill_inner(zip_file2.path().to_str().unwrap(), workspace_path, &conn);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("already exists"));
    }

    #[test]
    fn test_upload_skill_purpose_is_none() {
        let conn = create_test_db();
        let workspace = tempdir().unwrap();
        let workspace_path = workspace.path().to_str().unwrap();

        let zip_file = create_test_zip(&[
            ("SKILL.md", "---\nname: purpose-test\ndescription: Purpose test skill\n---\n# Purpose Test"),
        ]);

        let result = upload_skill_inner(
            zip_file.path().to_str().unwrap(),
            workspace_path,
            &conn,
        );
        assert!(result.is_ok(), "upload_skill_inner failed: {:?}", result.err());

        let skill = result.unwrap();
        assert_eq!(
            skill.purpose, None,
            "uploaded zip should have purpose == None, not a hardcoded value"
        );
    }

    // --- Toggle active/inactive tests ---

    #[test]
    fn test_toggle_skill_deactivate() {
        let conn = create_test_db();
        let workspace = tempdir().unwrap();
        let workspace_path = workspace.path().to_str().unwrap();

        // Create skill directory structure
        let skills_dir = workspace.path().join(".claude").join("skills");
        let skill_dir = skills_dir.join("my-skill");
        fs::create_dir_all(&skill_dir).unwrap();
        fs::write(skill_dir.join("SKILL.md"), "# Skill").unwrap();

        // Insert DB record
        let skill = WorkspaceSkill {
            skill_id: "id1".to_string(),
            skill_name: "my-skill".to_string(),            is_active: true,
            disk_path: skill_dir.to_string_lossy().to_string(),
            imported_at: "2025-01-01 00:00:00".to_string(),
            is_bundled: false,
            description: None,            version: None,
            model: None,
            argument_hint: None,
            user_invocable: None,
            disable_model_invocation: None,
        purpose: None,
            marketplace_source_url: None,
        };
        crate::db::insert_workspace_skill(&conn, &skill).unwrap();

        // Deactivate
        toggle_skill_active_inner("id1", "my-skill", false, workspace_path, &conn).unwrap();

        // Verify directory moved
        assert!(!skill_dir.exists());
        let inactive_path = skills_dir.join(".inactive").join("my-skill");
        assert!(inactive_path.exists());
        assert!(inactive_path.join("SKILL.md").exists());

        // Verify DB updated
        let db_skill = crate::db::get_workspace_skill_by_name(&conn, "my-skill").unwrap().unwrap();
        assert!(!db_skill.is_active);
    }

    #[test]
    fn test_toggle_skill_activate() {
        let conn = create_test_db();
        let workspace = tempdir().unwrap();
        let workspace_path = workspace.path().to_str().unwrap();

        // Create inactive skill directory
        let skills_dir = workspace.path().join(".claude").join("skills");
        let inactive_path = skills_dir.join(".inactive").join("my-skill");
        fs::create_dir_all(&inactive_path).unwrap();
        fs::write(inactive_path.join("SKILL.md"), "# Skill").unwrap();

        // Insert DB record as inactive
        let skill = WorkspaceSkill {
            skill_id: "id1".to_string(),
            skill_name: "my-skill".to_string(),            is_active: false,
            disk_path: inactive_path.to_string_lossy().to_string(),
            imported_at: "2025-01-01 00:00:00".to_string(),
            is_bundled: false,
            description: None,            version: None,
            model: None,
            argument_hint: None,
            user_invocable: None,
            disable_model_invocation: None,
        purpose: None,
            marketplace_source_url: None,
        };
        crate::db::insert_workspace_skill(&conn, &skill).unwrap();

        // Activate
        toggle_skill_active_inner("id1", "my-skill", true, workspace_path, &conn).unwrap();

        // Verify directory moved back
        assert!(!inactive_path.exists());
        let active_path = skills_dir.join("my-skill");
        assert!(active_path.exists());
        assert!(active_path.join("SKILL.md").exists());

        // Verify DB updated
        let db_skill = crate::db::get_workspace_skill_by_name(&conn, "my-skill").unwrap().unwrap();
        assert!(db_skill.is_active);
    }

    // --- Delete tests ---

    #[test]
    fn test_delete_imported_skill_active() {
        let conn = create_test_db();
        let workspace = tempdir().unwrap();
        let workspace_path = workspace.path().to_str().unwrap();

        // Create skill directory
        let skills_dir = workspace.path().join(".claude").join("skills");
        let skill_dir = skills_dir.join("del-skill");
        fs::create_dir_all(&skill_dir).unwrap();
        fs::write(skill_dir.join("SKILL.md"), "# Skill").unwrap();

        let skill = WorkspaceSkill {
            skill_id: "id1".to_string(),
            skill_name: "del-skill".to_string(),            is_active: true,
            disk_path: skill_dir.to_string_lossy().to_string(),
            imported_at: "2025-01-01 00:00:00".to_string(),
            is_bundled: false,
            description: None,            version: None,
            model: None,
            argument_hint: None,
            user_invocable: None,
            disable_model_invocation: None,
        purpose: None,
            marketplace_source_url: None,
        };
        crate::db::insert_workspace_skill(&conn, &skill).unwrap();

        delete_imported_skill_inner("id1", "del-skill", workspace_path, &conn).unwrap();

        // Directory gone
        assert!(!skill_dir.exists());
        // DB record gone
        assert!(crate::db::get_workspace_skill_by_name(&conn, "del-skill").unwrap().is_none());
    }

    #[test]
    fn test_delete_imported_skill_inactive() {
        let conn = create_test_db();
        let workspace = tempdir().unwrap();
        let workspace_path = workspace.path().to_str().unwrap();

        // Create inactive skill directory
        let skills_dir = workspace.path().join(".claude").join("skills");
        let inactive_path = skills_dir.join(".inactive").join("del-skill");
        fs::create_dir_all(&inactive_path).unwrap();
        fs::write(inactive_path.join("SKILL.md"), "# Skill").unwrap();

        let skill = WorkspaceSkill {
            skill_id: "id1".to_string(),
            skill_name: "del-skill".to_string(),            is_active: false,
            disk_path: inactive_path.to_string_lossy().to_string(),
            imported_at: "2025-01-01 00:00:00".to_string(),
            is_bundled: false,
            description: None,            version: None,
            model: None,
            argument_hint: None,
            user_invocable: None,
            disable_model_invocation: None,
        purpose: None,
            marketplace_source_url: None,
        };
        crate::db::insert_workspace_skill(&conn, &skill).unwrap();

        delete_imported_skill_inner("id1", "del-skill", workspace_path, &conn).unwrap();

        assert!(!inactive_path.exists());
        assert!(crate::db::get_workspace_skill_by_name(&conn, "del-skill").unwrap().is_none());
    }

    // --- Get skill content test ---

    #[test]
    fn test_get_skill_content() {
        let workspace = tempdir().unwrap();
        let skill_dir = workspace.path().join("my-skill");
        fs::create_dir_all(&skill_dir).unwrap();
        let content = "---\nname: my-skill\n---\n# My Skill\nContent here";
        fs::write(skill_dir.join("SKILL.md"), content).unwrap();

        // Test the inlined logic: read SKILL.md from disk_path
        let disk_path = skill_dir.to_string_lossy().to_string();
        let skill_md_path = std::path::Path::new(&disk_path).join("SKILL.md");
        let result = fs::read_to_string(&skill_md_path).unwrap();
        assert_eq!(result, content);
    }

    #[test]
    fn test_get_skill_content_missing_file() {
        let disk_path = "/nonexistent/path";
        let skill_md_path = std::path::Path::new(disk_path).join("SKILL.md");
        let result = fs::read_to_string(&skill_md_path);
        assert!(result.is_err());
    }

    // --- CLAUDE.md generation tests ---

    /// Helper: create a skill directory with a SKILL.md containing frontmatter.
    /// Returns the disk_path string.
    fn create_skill_on_disk(
        base: &std::path::Path,
        name: &str,
        trigger: Option<&str>,
        description: Option<&str>,
    ) -> String {
        let skill_dir = base.join(name);
        fs::create_dir_all(&skill_dir).unwrap();
        let mut fm = String::from("---\n");
        fm.push_str(&format!("name: {}\n", name));
        if let Some(desc) = description {
            fm.push_str(&format!("description: {}\n", desc));
        }
        if let Some(trig) = trigger {
            fm.push_str(&format!("trigger: {}\n", trig));
        }
        fm.push_str("---\n# Skill\n");
        fs::write(skill_dir.join("SKILL.md"), &fm).unwrap();
        skill_dir.to_string_lossy().to_string()
    }

    #[test]
    fn test_update_skills_section_creates_section() {
        let conn = create_test_db();
        let workspace = tempdir().unwrap();
        let workspace_path = workspace.path().to_str().unwrap();

        // Create a base CLAUDE.md with customization marker
        let claude_dir = workspace.path().join(".claude");
        fs::create_dir_all(&claude_dir).unwrap();
        fs::write(claude_dir.join("CLAUDE.md"), "# Base Content\n\nSome instructions.\n\n## Customization\n\nUser notes.\n").unwrap();

        // Create skill on disk with trigger in frontmatter
        let skill_tmp = tempdir().unwrap();
        let disk_path = create_skill_on_disk(
            skill_tmp.path(),
            "my-analytics",
            Some("When the user asks about analytics, use this skill."),
            Some("Analytics skill for data queries."),
        );

        // Insert an active skill (description stored in DB)
        let skill = WorkspaceSkill {
            skill_id: "imp-1".to_string(),
            skill_name: "my-analytics".to_string(),
            is_active: true,
            disk_path,
            imported_at: "2025-01-01 00:00:00".to_string(),
            is_bundled: false,
            description: Some("Analytics skill for data queries.".to_string()),            version: None,
            model: None,
            argument_hint: None,
            user_invocable: None,
            disable_model_invocation: None,
        purpose: None,
            marketplace_source_url: None,
        };
        crate::db::insert_workspace_skill(&conn, &skill).unwrap();

        crate::commands::workflow::update_skills_section(workspace_path, &conn).unwrap();

        let content = fs::read_to_string(claude_dir.join("CLAUDE.md")).unwrap();
        assert!(content.contains("# Base Content"));
        assert!(content.contains("## Custom Skills"));
        assert!(content.contains("### /my-analytics"));
        assert!(content.contains("Analytics skill for data queries."), "should include description");
        assert!(!content.contains("When the user asks about analytics"), "trigger must not appear");
        // Customization preserved
        assert!(content.contains("## Customization"));
        assert!(content.contains("User notes."));
    }

    #[test]
    fn test_update_skills_section_no_active_skills() {
        let conn = create_test_db();
        let workspace = tempdir().unwrap();
        let workspace_path = workspace.path().to_str().unwrap();

        // Create a base CLAUDE.md with customization marker
        let claude_dir = workspace.path().join(".claude");
        fs::create_dir_all(&claude_dir).unwrap();
        fs::write(claude_dir.join("CLAUDE.md"), "# Base Content\n\n## Customization\n\nMy rules.\n").unwrap();

        // No skills inserted — section should not be present
        crate::commands::workflow::update_skills_section(workspace_path, &conn).unwrap();

        let content = fs::read_to_string(claude_dir.join("CLAUDE.md")).unwrap();
        assert!(content.contains("# Base Content"));
        assert!(!content.contains("## Custom Skills"));
        // Customization preserved
        assert!(content.contains("## Customization"));
        assert!(content.contains("My rules."));
    }

    #[test]
    fn test_update_skills_section_replaces_existing() {
        let conn = create_test_db();
        let workspace = tempdir().unwrap();
        let workspace_path = workspace.path().to_str().unwrap();

        // Create CLAUDE.md with an existing imported skills section + customization
        let claude_dir = workspace.path().join(".claude");
        fs::create_dir_all(&claude_dir).unwrap();
        fs::write(
            claude_dir.join("CLAUDE.md"),
            "# Base\n\n## Custom Skills\n\n### /old-skill\nOld trigger text.\n\n## Customization\n\nKeep me.\n",
        ).unwrap();

        // Create skill on disk with description in frontmatter
        let skill_tmp = tempdir().unwrap();
        let disk_path = create_skill_on_disk(skill_tmp.path(), "new-skill", None, Some("New skill description."));

        // Insert a new active skill (description stored in DB)
        let skill = WorkspaceSkill {
            skill_id: "imp-new".to_string(),
            skill_name: "new-skill".to_string(),            is_active: true,
            disk_path,
            imported_at: "2025-01-01 00:00:00".to_string(),
            is_bundled: false,
            description: Some("New skill description.".to_string()),            version: None,
            model: None,
            argument_hint: None,
            user_invocable: None,
            disable_model_invocation: None,
        purpose: None,
            marketplace_source_url: None,
        };
        crate::db::insert_workspace_skill(&conn, &skill).unwrap();

        crate::commands::workflow::update_skills_section(workspace_path, &conn).unwrap();

        let content = fs::read_to_string(claude_dir.join("CLAUDE.md")).unwrap();
        assert!(content.contains("# Base"));
        assert!(content.contains("### /new-skill"));
        assert!(content.contains("New skill description."), "should include description");
        // Old section should be replaced
        assert!(!content.contains("### /old-skill"));
        assert!(!content.contains("Old trigger text."));
        // Customization preserved
        assert!(content.contains("## Customization"));
        assert!(content.contains("Keep me."));
    }

    #[test]
    fn test_update_skills_section_preserves_customization() {
        let conn = create_test_db();
        let workspace = tempdir().unwrap();
        let workspace_path = workspace.path().to_str().unwrap();

        // CLAUDE.md with imported skills in the middle and customization after
        let claude_dir = workspace.path().join(".claude");
        fs::create_dir_all(&claude_dir).unwrap();
        fs::write(
            claude_dir.join("CLAUDE.md"),
            "# Base Content\n\nSome text.\n\n## Custom Skills\n\n### /old-skill\nOld trigger.\n\n## Customization\n\nMy workspace rules.\n",
        ).unwrap();

        // Create skill on disk with description in frontmatter
        let skill_tmp = tempdir().unwrap();
        let disk_path = create_skill_on_disk(skill_tmp.path(), "new-skill", None, Some("New skill description."));

        // Insert a new active skill (description stored in DB)
        let skill = WorkspaceSkill {
            skill_id: "imp-new".to_string(),
            skill_name: "new-skill".to_string(),            is_active: true,
            disk_path,
            imported_at: "2025-01-01 00:00:00".to_string(),
            is_bundled: false,
            description: Some("New skill description.".to_string()),            version: None,
            model: None,
            argument_hint: None,
            user_invocable: None,
            disable_model_invocation: None,
        purpose: None,
            marketplace_source_url: None,
        };
        crate::db::insert_workspace_skill(&conn, &skill).unwrap();

        crate::commands::workflow::update_skills_section(workspace_path, &conn).unwrap();

        let content = fs::read_to_string(claude_dir.join("CLAUDE.md")).unwrap();
        // Base content preserved
        assert!(content.contains("# Base Content"));
        assert!(content.contains("Some text."));
        // New imported skills section present
        assert!(content.contains("### /new-skill"));
        assert!(content.contains("New skill description."), "should include description");
        // Old skill removed
        assert!(!content.contains("### /old-skill"));
        // Customization section preserved with user content
        assert!(content.contains("## Customization"));
        assert!(content.contains("My workspace rules."));
    }

    #[test]
    fn test_rebuild_claude_md_preserves_customization() {
        let conn = create_test_db();
        let workspace = tempdir().unwrap();
        let workspace_path = workspace.path().to_str().unwrap();

        // Create a bundled base template with customization marker
        let base_dir = tempdir().unwrap();
        let base_path = base_dir.path().join("CLAUDE.md");
        fs::write(&base_path, "# Agent Instructions\n\nBase content.\n\n## Customization\n\nDefault instructions.\n").unwrap();

        // Create an existing workspace CLAUDE.md with user customization
        let claude_dir = workspace.path().join(".claude");
        fs::create_dir_all(&claude_dir).unwrap();
        fs::write(
            claude_dir.join("CLAUDE.md"),
            "# Old Base\n\n## Custom Skills\n\n### /stale-skill\nStale.\n\n## Customization\n\nMy custom instructions.\nDo not lose this.\n",
        ).unwrap();

        // Create skill on disk with description in frontmatter
        let skill_tmp = tempdir().unwrap();
        let disk_path = create_skill_on_disk(skill_tmp.path(), "analytics", None, Some("Analytics skill description."));

        // Insert an active skill (description stored in DB, not read from disk at list time)
        let skill = WorkspaceSkill {
            skill_id: "imp-1".to_string(),
            skill_name: "analytics".to_string(),            is_active: true,
            disk_path,
            imported_at: "2025-01-01 00:00:00".to_string(),
            is_bundled: false,
            description: Some("Analytics skill description.".to_string()),            version: None,
            model: None,
            argument_hint: None,
            user_invocable: None,
            disable_model_invocation: None,
        purpose: None,
            marketplace_source_url: None,
        };
        crate::db::insert_workspace_skill(&conn, &skill).unwrap();

        // Simulate startup: rebuild from bundled base
        crate::commands::workflow::rebuild_claude_md(&base_path, workspace_path, &conn).unwrap();

        let content = fs::read_to_string(claude_dir.join("CLAUDE.md")).unwrap();
        // Base content from bundled template (not old base)
        assert!(content.contains("# Agent Instructions"));
        assert!(content.contains("Base content."));
        assert!(!content.contains("# Old Base"));
        // Skills regenerated from DB (description read from disk)
        assert!(content.contains("## Custom Skills"));
        assert!(content.contains("### /analytics"));
        assert!(content.contains("Analytics skill description."), "should include description");
        // Stale skill gone
        assert!(!content.contains("### /stale-skill"));
        // User customization preserved (not replaced with default)
        assert!(content.contains("## Customization"));
        assert!(content.contains("My custom instructions."));
        assert!(content.contains("Do not lose this."));
        assert!(!content.contains("Default instructions."));
    }

    // --- Bundled skill tests ---

    #[test]
    fn test_delete_bundled_skill_returns_error() {
        let conn = create_test_db();
        let workspace = tempdir().unwrap();
        let workspace_path = workspace.path().to_str().unwrap();

        // Create bundled skill directory
        let skills_dir = workspace.path().join(".claude").join("skills");
        let skill_dir = skills_dir.join("bundled-skill");
        fs::create_dir_all(&skill_dir).unwrap();
        fs::write(skill_dir.join("SKILL.md"), "# Bundled").unwrap();

        let skill = WorkspaceSkill {
            skill_id: "bundled-test-id".to_string(),
            skill_name: "bundled-skill".to_string(),            is_active: true,
            disk_path: skill_dir.to_string_lossy().to_string(),
            imported_at: "2000-01-01T00:00:00Z".to_string(),
            is_bundled: true,
            description: None,            version: None,
            model: None,
            argument_hint: None,
            user_invocable: None,
            disable_model_invocation: None,
        purpose: None,
            marketplace_source_url: None,
        };
        crate::db::insert_workspace_skill(&conn, &skill).unwrap();

        // Attempt to delete — should fail
        let result = delete_imported_skill_inner("bundled-test-id", "bundled-skill", workspace_path, &conn);
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.contains("Cannot delete bundled skill"), "Expected bundled guard error, got: {}", err);

        // Verify skill still exists
        assert!(skill_dir.exists());
        assert!(crate::db::get_workspace_skill_by_name(&conn, "bundled-skill").unwrap().is_some());
    }

    #[test]
    fn test_delete_non_bundled_skill_succeeds() {
        let conn = create_test_db();
        let workspace = tempdir().unwrap();
        let workspace_path = workspace.path().to_str().unwrap();

        // Create non-bundled skill directory
        let skills_dir = workspace.path().join(".claude").join("skills");
        let skill_dir = skills_dir.join("regular-skill");
        fs::create_dir_all(&skill_dir).unwrap();
        fs::write(skill_dir.join("SKILL.md"), "# Regular").unwrap();

        let skill = WorkspaceSkill {
            skill_id: "regular-test-id".to_string(),
            skill_name: "regular-skill".to_string(),            is_active: true,
            disk_path: skill_dir.to_string_lossy().to_string(),
            imported_at: "2025-01-01 00:00:00".to_string(),
            is_bundled: false,
            description: None,            version: None,
            model: None,
            argument_hint: None,
            user_invocable: None,
            disable_model_invocation: None,
        purpose: None,
            marketplace_source_url: None,
        };
        crate::db::insert_workspace_skill(&conn, &skill).unwrap();

        // Delete should succeed
        let result = delete_imported_skill_inner("regular-test-id", "regular-skill", workspace_path, &conn);
        assert!(result.is_ok());
        assert!(!skill_dir.exists());
        assert!(crate::db::get_workspace_skill_by_name(&conn, "regular-skill").unwrap().is_none());
    }

    #[test]
    fn test_seed_bundled_skills() {
        let conn = create_test_db();
        let workspace = tempdir().unwrap();
        let workspace_path = workspace.path().to_str().unwrap();

        // Create a mock bundled-skills directory
        let bundled_dir = tempdir().unwrap();
        let skill_src = bundled_dir.path().join("test-bundled");
        fs::create_dir_all(skill_src.join("references")).unwrap();
        fs::write(
            skill_src.join("SKILL.md"),
            "---\nname: test-bundled\ndescription: A test bundled skill\n---\n# Test",
        ).unwrap();
        fs::write(skill_src.join("references").join("ref.md"), "# Ref").unwrap();

        // Seed
        seed_bundled_skills(workspace_path, &conn, bundled_dir.path()).unwrap();

        // Verify files copied
        let dest = workspace.path().join(".claude").join("skills").join("test-bundled");
        assert!(dest.join("SKILL.md").exists());
        assert!(dest.join("references").join("ref.md").exists());

        // Verify DB record (description stored in DB)
        let skill = crate::db::get_workspace_skill_by_name(&conn, "test-bundled").unwrap().unwrap();
        assert!(skill.is_bundled);
        assert!(skill.is_active);
        assert_eq!(skill.imported_at, "2000-01-01T00:00:00Z");
        // Description stored in DB from frontmatter
        assert_eq!(skill.description.as_deref(), Some("A test bundled skill"));
    }

    #[test]
    fn test_seed_bundled_skills_purpose_is_null() {
        // purpose is a DB-only field set by the user after import; seeding always inserts NULL.
        let conn = create_test_db();
        let workspace = tempdir().unwrap();
        let workspace_path = workspace.path().to_str().unwrap();

        let bundled_dir = tempdir().unwrap();
        let skill_src = bundled_dir.path().join("research");
        fs::create_dir_all(&skill_src).unwrap();
        fs::write(
            skill_src.join("SKILL.md"),
            "---\nname: research\ndescription: Research skill\n---\n# Research",
        ).unwrap();

        seed_bundled_skills(workspace_path, &conn, bundled_dir.path()).unwrap();

        let skill = crate::db::get_workspace_skill_by_name(&conn, "research").unwrap().unwrap();
        assert!(skill.purpose.is_none(), "purpose must be NULL after seeding — it is set by the user via the UI");
    }

    #[test]
    fn test_seed_bundled_skills_skips_missing_required_fields() {
        // Only description is required; name must also be present (enforced earlier).
        // domain, type, purpose, and other unknown keys are silently ignored.
        let conn = create_test_db();
        let workspace = tempdir().unwrap();
        let workspace_path = workspace.path().to_str().unwrap();

        let bundled_dir = tempdir().unwrap();

        // Has all required fields — accepted
        let ok_skill = bundled_dir.path().join("ok-skill");
        fs::create_dir_all(&ok_skill).unwrap();
        fs::write(ok_skill.join("SKILL.md"),
            "---\nname: ok-skill\ndescription: A skill\n---\n# OK",
        ).unwrap();

        // Missing description — rejected
        let no_desc = bundled_dir.path().join("no-description");
        fs::create_dir_all(&no_desc).unwrap();
        fs::write(no_desc.join("SKILL.md"),
            "---\nname: no-description\n---\n# No Desc",
        ).unwrap();

        seed_bundled_skills(workspace_path, &conn, bundled_dir.path()).unwrap();

        assert!(crate::db::get_workspace_skill_by_name(&conn, "ok-skill").unwrap().is_some());
        assert!(crate::db::get_workspace_skill_by_name(&conn, "no-description").unwrap().is_none());
    }

    #[test]
    fn test_seed_bundled_skills_preserves_is_active() {
        let conn = create_test_db();
        let workspace = tempdir().unwrap();
        let workspace_path = workspace.path().to_str().unwrap();

        // Pre-insert the skill as deactivated (in workspace_skills, since seed reads from there)
        let skill = WorkspaceSkill {
            skill_id: "bundled-test-bundled".to_string(),
            skill_name: "test-bundled".to_string(),            is_active: false,
            disk_path: "/old/path".to_string(),
            imported_at: "2000-01-01T00:00:00Z".to_string(),
            is_bundled: true,
            description: None,            version: None,
            model: None,
            argument_hint: None,
            user_invocable: None,
            disable_model_invocation: None,
        purpose: None,
            marketplace_source_url: None,
        };
        crate::db::insert_workspace_skill(&conn, &skill).unwrap();

        // Create bundled source
        let bundled_dir = tempdir().unwrap();
        let skill_src = bundled_dir.path().join("test-bundled");
        fs::create_dir_all(&skill_src).unwrap();
        fs::write(
            skill_src.join("SKILL.md"),
            "---\nname: test-bundled\ndescription: Updated\ndomain: testing\ntype: skill-builder\n---\n# Test",
        ).unwrap();

        // Re-seed
        seed_bundled_skills(workspace_path, &conn, bundled_dir.path()).unwrap();

        // Verify is_active was preserved as false
        let updated = crate::db::get_workspace_skill_by_name(&conn, "test-bundled").unwrap().unwrap();
        assert!(!updated.is_active, "is_active should be preserved as false");
        assert!(updated.is_bundled);
        // Description should be updated (stored in DB from frontmatter)
        assert_eq!(updated.description.as_deref(), Some("Updated"));

        // Verify files copied to .inactive/ (not active path)
        let active_dest = workspace.path().join(".claude").join("skills").join("test-bundled");
        let inactive_dest = workspace.path().join(".claude").join("skills").join(".inactive").join("test-bundled");
        assert!(!active_dest.exists(), "inactive skill should not be in active path");
        assert!(inactive_dest.join("SKILL.md").exists(), "inactive skill should be in .inactive/ path");
    }

    #[test]
    fn test_seed_bundled_skills_seeds_multiple() {
        let conn = create_test_db();
        let workspace = tempdir().unwrap();
        let workspace_path = workspace.path().to_str().unwrap();

        // Create two bundled skill dirs (simulating research + skill-builder-practices)
        let bundled_dir = tempdir().unwrap();

        let skill_a = bundled_dir.path().join("skill-a");
        fs::create_dir_all(&skill_a).unwrap();
        fs::write(skill_a.join("SKILL.md"), "---\nname: skill-a\ndescription: Skill A\n---\n# A").unwrap();

        let skill_b = bundled_dir.path().join("skill-b");
        fs::create_dir_all(&skill_b).unwrap();
        fs::write(skill_b.join("SKILL.md"), "---\nname: skill-b\ndescription: Skill B\n---\n# B").unwrap();

        seed_bundled_skills(workspace_path, &conn, bundled_dir.path()).unwrap();

        let a = crate::db::get_workspace_skill_by_name(&conn, "skill-a").unwrap();
        assert!(a.is_some(), "skill-a should be seeded");
        assert!(a.unwrap().is_bundled, "skill-a should be bundled");

        let b = crate::db::get_workspace_skill_by_name(&conn, "skill-b").unwrap();
        assert!(b.is_some(), "skill-b should be seeded");
        assert!(b.unwrap().is_bundled, "skill-b should be bundled");

        // Both files on disk
        let skills_dir = workspace.path().join(".claude").join("skills");
        assert!(skills_dir.join("skill-a").join("SKILL.md").exists());
        assert!(skills_dir.join("skill-b").join("SKILL.md").exists());
    }

    #[test]
    fn test_seed_bundled_skills_copies_nested_dirs() {
        // The research skill has references/dimensions/ nested structure.
        // Verify seed_bundled_skills copies nested subdirectories recursively.
        let conn = create_test_db();
        let workspace = tempdir().unwrap();
        let workspace_path = workspace.path().to_str().unwrap();

        let bundled_dir = tempdir().unwrap();
        let skill_src = bundled_dir.path().join("research");
        fs::create_dir_all(skill_src.join("references").join("dimensions")).unwrap();
        fs::write(
            skill_src.join("SKILL.md"),
            "---\nname: research\ndescription: Research skill\n---\n# Research",
        ).unwrap();
        fs::write(skill_src.join("references").join("dimension-sets.md"), "# Dimension Sets").unwrap();
        fs::write(skill_src.join("references").join("dimensions").join("entities.md"), "# Entities").unwrap();
        fs::write(skill_src.join("references").join("dimensions").join("metrics.md"), "# Metrics").unwrap();

        seed_bundled_skills(workspace_path, &conn, bundled_dir.path()).unwrap();

        let skill = crate::db::get_workspace_skill_by_name(&conn, "research").unwrap().unwrap();
        assert!(skill.is_bundled);
        assert_eq!(skill.skill_id, "bundled-research");
        assert_eq!(skill.description.as_deref(), Some("Research skill"));

        let dest = workspace.path().join(".claude").join("skills").join("research");
        assert!(dest.join("SKILL.md").exists());
        assert!(dest.join("references").join("dimension-sets.md").exists());
        assert!(dest.join("references").join("dimensions").join("entities.md").exists());
        assert!(dest.join("references").join("dimensions").join("metrics.md").exists());
    }

    #[test]
    fn test_delete_bundled_research_skill_blocked() {
        let conn = create_test_db();
        let workspace = tempdir().unwrap();
        let workspace_path = workspace.path().to_str().unwrap();

        // Seed the research skill as bundled
        let skills_dir = workspace.path().join(".claude").join("skills").join("research");
        fs::create_dir_all(&skills_dir).unwrap();
        fs::write(skills_dir.join("SKILL.md"), "---\nname: research\n---\n# Research").unwrap();

        let skill = WorkspaceSkill {
            skill_id: "bundled-research".to_string(),
            skill_name: "research".to_string(),            is_active: true,
            disk_path: skills_dir.to_string_lossy().to_string(),
            imported_at: "2000-01-01T00:00:00Z".to_string(),
            is_bundled: true,
            description: None,            version: None,
            model: None,
            argument_hint: None,
            user_invocable: None,
            disable_model_invocation: None,
        purpose: None,
            marketplace_source_url: None,
        };
        crate::db::insert_workspace_skill(&conn, &skill).unwrap();

        // Attempt to delete — should fail with bundled guard
        let result = delete_imported_skill_inner("bundled-research", "research", workspace_path, &conn);
        assert!(result.is_err(), "Deleting bundled research skill should fail");
        let err = result.unwrap_err();
        assert!(err.contains("Cannot delete bundled skill"), "Expected bundled guard error, got: {}", err);

        // Skill still in DB
        assert!(crate::db::get_workspace_skill_by_name(&conn, "research").unwrap().is_some());
    }

    #[test]
    fn test_seed_bundled_validate_skill_copies_reference_specs() {
        // The validate-skill bundled skill has 3 reference spec files (no nested subdirs).
        let conn = create_test_db();
        let workspace = tempdir().unwrap();
        let workspace_path = workspace.path().to_str().unwrap();

        let bundled_dir = tempdir().unwrap();
        let skill_src = bundled_dir.path().join("validate-skill");
        fs::create_dir_all(skill_src.join("references")).unwrap();
        fs::write(
            skill_src.join("SKILL.md"),
            "---\nname: validate-skill\ndescription: Validates a completed skill\n---\n# Validate Skill",
        ).unwrap();
        fs::write(skill_src.join("references").join("validate-quality-spec.md"), "# Quality Checker").unwrap();
        fs::write(skill_src.join("references").join("test-skill-spec.md"), "# Test Evaluator").unwrap();
        fs::write(skill_src.join("references").join("companion-recommender-spec.md"), "# Companion Recommender").unwrap();

        seed_bundled_skills(workspace_path, &conn, bundled_dir.path()).unwrap();

        let skill = crate::db::get_workspace_skill_by_name(&conn, "validate-skill").unwrap().unwrap();
        assert!(skill.is_bundled);
        assert_eq!(skill.skill_id, "bundled-validate-skill");
        assert_eq!(skill.description.as_deref(), Some("Validates a completed skill"));

        let dest = workspace.path().join(".claude").join("skills").join("validate-skill");
        assert!(dest.join("SKILL.md").exists());
        assert!(dest.join("references").join("validate-quality-spec.md").exists());
        assert!(dest.join("references").join("test-skill-spec.md").exists());
        assert!(dest.join("references").join("companion-recommender-spec.md").exists());
    }

    #[test]
    fn test_delete_bundled_validate_skill_blocked() {
        let conn = create_test_db();
        let workspace = tempdir().unwrap();
        let workspace_path = workspace.path().to_str().unwrap();

        let skills_dir = workspace.path().join(".claude").join("skills").join("validate-skill");
        fs::create_dir_all(&skills_dir).unwrap();
        fs::write(skills_dir.join("SKILL.md"), "---\nname: validate-skill\n---\n# Validate Skill").unwrap();

        let skill = WorkspaceSkill {
            skill_id: "bundled-validate-skill".to_string(),
            skill_name: "validate-skill".to_string(),            is_active: true,
            disk_path: skills_dir.to_string_lossy().to_string(),
            imported_at: "2000-01-01T00:00:00Z".to_string(),
            is_bundled: true,
            description: None,            version: None,
            model: None,
            argument_hint: None,
            user_invocable: None,
            disable_model_invocation: None,
        purpose: None,
            marketplace_source_url: None,
        };
        crate::db::insert_workspace_skill(&conn, &skill).unwrap();

        let result = delete_imported_skill_inner("bundled-validate-skill", "validate-skill", workspace_path, &conn);
        assert!(result.is_err(), "Deleting bundled validate-skill should fail");
        let err = result.unwrap_err();
        assert!(err.contains("Cannot delete bundled skill"), "Expected bundled guard error, got: {}", err);

        assert!(crate::db::get_workspace_skill_by_name(&conn, "validate-skill").unwrap().is_some());
    }

    // --- Export skill tests ---

    #[test]
    fn test_export_skill_creates_zip_with_correct_structure() {
        let workspace = tempdir().unwrap();
        let skill_dir = workspace.path().join("my-export-skill");
        fs::create_dir_all(skill_dir.join("references")).unwrap();
        fs::write(
            skill_dir.join("SKILL.md"),
            "---\nname: my-export-skill\n---\n# Export Test",
        )
        .unwrap();
        fs::write(skill_dir.join("references").join("guide.md"), "# Guide").unwrap();

        // Create the zip using add_dir_to_zip
        let zip_dir = tempdir().unwrap();
        let zip_path = zip_dir.path().join("my-export-skill.zip");
        let file = fs::File::create(&zip_path).unwrap();
        let mut writer = zip::ZipWriter::new(file);
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);

        add_dir_to_zip(&mut writer, &skill_dir, "my-export-skill", &options).unwrap();
        writer.finish().unwrap();

        // Verify the zip contents
        let zip_file = fs::File::open(&zip_path).unwrap();
        let mut archive = zip::ZipArchive::new(zip_file).unwrap();

        let mut names: Vec<String> = (0..archive.len())
            .map(|i| archive.by_index(i).unwrap().name().to_string())
            .collect();
        names.sort();

        assert!(
            names.contains(&"my-export-skill/SKILL.md".to_string()),
            "Expected SKILL.md in zip, got: {:?}",
            names
        );
        assert!(
            names.contains(&"my-export-skill/references/guide.md".to_string()),
            "Expected references/guide.md in zip, got: {:?}",
            names
        );

        // Verify content
        let mut skill_md = String::new();
        archive
            .by_name("my-export-skill/SKILL.md")
            .unwrap()
            .read_to_string(&mut skill_md)
            .unwrap();
        assert!(skill_md.contains("# Export Test"));
    }

    #[test]
    fn test_upsert_imported_skill_preserves_is_active() {
        let conn = create_test_db();

        // Skills master row required for FK-based get/update operations
        crate::db::upsert_skill(&conn, "upsert-test", "imported", "domain").unwrap();

        // Create skill dirs on disk so hydration works
        let skill_tmp = tempdir().unwrap();
        let disk1 = create_skill_on_disk(skill_tmp.path(), "upsert-test", Some("Original trigger"), Some("Original"));
        let disk2 = create_skill_on_disk(skill_tmp.path(), "upsert-test-v2", Some("Updated trigger"), Some("Updated"));

        // First insert with is_active = true
        let skill = ImportedSkill {
            skill_id: "bundled-1".to_string(),
            skill_name: "upsert-test".to_string(),
            is_active: true,
            disk_path: disk1,
            imported_at: "2000-01-01T00:00:00Z".to_string(),
            is_bundled: true,
            description: None,            version: None,
            model: None,
            argument_hint: None,
            user_invocable: None,
            disable_model_invocation: None,
            purpose: None,
            marketplace_source_url: None,
        };
        crate::db::upsert_imported_skill(&conn, &skill).unwrap();

        let saved = crate::db::get_imported_skill(&conn, "upsert-test").unwrap().unwrap();
        assert!(saved.is_active);

        // Deactivate via DB
        crate::db::update_imported_skill_active(&conn, "upsert-test", false, "/tmp/inactive").unwrap();

        // Re-upsert with is_active = true in the struct and a new disk_path
        let skill2 = ImportedSkill {
            skill_id: "bundled-1".to_string(),
            skill_name: "upsert-test".to_string(),
            is_active: true,
            disk_path: disk2,
            imported_at: "2000-01-01T00:00:00Z".to_string(),
            is_bundled: true,
            description: None,            version: None,
            model: None,
            argument_hint: None,
            user_invocable: None,
            disable_model_invocation: None,
            purpose: None,
            marketplace_source_url: None,
        };
        crate::db::upsert_imported_skill(&conn, &skill2).unwrap();

        // The upsert should NOT override is_active (ON CONFLICT doesn't touch it)
        let updated = crate::db::get_imported_skill(&conn, "upsert-test").unwrap().unwrap();
        assert!(!updated.is_active, "upsert should preserve is_active from existing row");
        // disk_path should be updated
        assert!(updated.disk_path.contains("upsert-test-v2"));
        // description is hydrated from the new disk_path's SKILL.md
        assert_eq!(updated.description.as_deref(), Some("Updated"));
    }

    // --- set_workspace_skill_purpose tests ---

    #[test]
    fn test_set_workspace_skill_purpose_persists() {
        let conn = create_test_db();

        // Insert a workspace skill with no purpose
        let skill = WorkspaceSkill {
            skill_id: "id-purpose-test".to_string(),
            skill_name: "purpose-skill".to_string(),            description: None,
            is_active: true,
            is_bundled: false,
            disk_path: "/tmp/purpose-skill".to_string(),
            imported_at: "2025-01-01 00:00:00".to_string(),            version: None,
            model: None,
            argument_hint: None,
            user_invocable: None,
            disable_model_invocation: None,
            purpose: None,
            marketplace_source_url: None,
        };
        crate::db::insert_workspace_skill(&conn, &skill).unwrap();

        // Set purpose to "research"
        conn.execute(
            "UPDATE workspace_skills SET purpose = ?1 WHERE skill_id = ?2",
            rusqlite::params!["research", "id-purpose-test"],
        ).unwrap();

        let updated = crate::db::get_workspace_skill_by_name(&conn, "purpose-skill").unwrap().unwrap();
        assert_eq!(updated.purpose.as_deref(), Some("research"), "purpose should be set to 'research'");

        // Clear purpose (set to NULL)
        conn.execute(
            "UPDATE workspace_skills SET purpose = ?1 WHERE skill_id = ?2",
            rusqlite::params![Option::<String>::None, "id-purpose-test"],
        ).unwrap();

        let cleared = crate::db::get_workspace_skill_by_name(&conn, "purpose-skill").unwrap().unwrap();
        assert!(cleared.purpose.is_none(), "purpose should be NULL after clearing");
    }

    // --- toggle_skill_active sibling deactivation test ---

    #[test]
    fn test_toggle_skill_active_deactivates_same_purpose_sibling() {
        let conn = create_test_db();
        let workspace = tempdir().unwrap();
        let workspace_path = workspace.path().to_str().unwrap();

        let skills_dir = workspace.path().join(".claude").join("skills");

        // Skill A: active, purpose "research"
        let skill_a_dir = skills_dir.join("skill-a");
        fs::create_dir_all(&skill_a_dir).unwrap();
        fs::write(skill_a_dir.join("SKILL.md"), "# Skill A").unwrap();
        let skill_a = WorkspaceSkill {
            skill_id: "id-a".to_string(),
            skill_name: "skill-a".to_string(),            description: None,
            is_active: true,
            is_bundled: false,
            disk_path: skill_a_dir.to_string_lossy().to_string(),
            imported_at: "2025-01-01 00:00:00".to_string(),            version: None,
            model: None,
            argument_hint: None,
            user_invocable: None,
            disable_model_invocation: None,
            purpose: Some("research".to_string()),
            marketplace_source_url: None,
        };
        crate::db::insert_workspace_skill(&conn, &skill_a).unwrap();

        // Skill B: inactive, purpose "research"
        let inactive_dir = skills_dir.join(".inactive");
        let skill_b_inactive = inactive_dir.join("skill-b");
        fs::create_dir_all(&skill_b_inactive).unwrap();
        fs::write(skill_b_inactive.join("SKILL.md"), "# Skill B").unwrap();
        let skill_b = WorkspaceSkill {
            skill_id: "id-b".to_string(),
            skill_name: "skill-b".to_string(),            description: None,
            is_active: false,
            is_bundled: false,
            disk_path: skill_b_inactive.to_string_lossy().to_string(),
            imported_at: "2025-01-01 00:00:00".to_string(),            version: None,
            model: None,
            argument_hint: None,
            user_invocable: None,
            disable_model_invocation: None,
            purpose: Some("research".to_string()),
            marketplace_source_url: None,
        };
        crate::db::insert_workspace_skill(&conn, &skill_b).unwrap();

        // Activate skill B — this triggers sibling deactivation of skill A
        toggle_skill_active_inner("id-b", "skill-b", true, workspace_path, &conn).unwrap();

        // Deactivate siblings with the same purpose (mimics the body of toggle_skill_active)
        let rows_affected = conn.execute(
            "UPDATE workspace_skills SET is_active = 0 WHERE purpose = ?1 AND skill_id != ?2 AND is_active = 1",
            rusqlite::params!["research", "id-b"],
        ).unwrap();
        assert_eq!(rows_affected, 1, "exactly one sibling (skill-a) should be deactivated");

        // Verify DB state
        let a = crate::db::get_workspace_skill_by_name(&conn, "skill-a").unwrap().unwrap();
        assert!(!a.is_active, "skill-a should be deactivated as the same-purpose sibling");

        let b = crate::db::get_workspace_skill_by_name(&conn, "skill-b").unwrap().unwrap();
        assert!(b.is_active, "skill-b should now be active");
    }
}
