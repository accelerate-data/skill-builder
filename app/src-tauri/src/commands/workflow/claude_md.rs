use std::path::Path;

/// Extract the user's customization content from an existing CLAUDE.md.
/// Returns everything starting from `## Customization\n` (without leading newlines),
/// or empty string if the marker is not found.
pub(crate) fn extract_customization_section(content: &str) -> String {
    if let Some(pos) = content.find("\n## Customization\n") {
        // Skip the leading newline — caller adds consistent spacing
        content[pos + 1..].to_string()
    } else {
        String::new()
    }
}

/// Generate the "## Custom Skills" section from DB, or empty string if none.
/// All active workspace skills are treated identically regardless of is_bundled.
pub(crate) fn generate_skills_section(conn: &rusqlite::Connection) -> Result<String, String> {
    let skills = crate::db::list_active_skills(conn)?;
    if skills.is_empty() {
        return Ok(String::new());
    }

    let mut section = String::from("\n\n## Custom Skills\n");
    for skill in &skills {
        section.push_str(&format!("\n### /{}\n", skill.skill_name));
        if let Some(desc) = skill.description.as_deref().filter(|d| !d.is_empty()) {
            section.push_str(desc);
            section.push('\n');
        }
    }

    Ok(section)
}

pub(crate) const DEFAULT_CUSTOMIZATION_SECTION: &str =
    "## Customization\n\nAdd your workspace-specific instructions below. This section is preserved across app updates and skill changes.\n";

/// Merge base + skills + customization and write to workspace CLAUDE.md.
pub(crate) fn write_claude_md(
    base: &str,
    workspace_path: &str,
    conn: &rusqlite::Connection,
) -> Result<(), String> {
    let claude_md_path = Path::new(workspace_path).join("CLAUDE.md");

    let skills_section = generate_skills_section(conn)?;

    let customization = if claude_md_path.is_file() {
        let existing = std::fs::read_to_string(&claude_md_path)
            .map_err(|e| format!("Failed to read existing CLAUDE.md: {}", e))?;
        let section = extract_customization_section(&existing);
        if section.is_empty() {
            DEFAULT_CUSTOMIZATION_SECTION.to_string()
        } else {
            section
        }
    } else {
        DEFAULT_CUSTOMIZATION_SECTION.to_string()
    };

    let mut final_content = base.to_string();
    final_content.push_str(&skills_section);
    final_content.push_str("\n\n");
    final_content.push_str(&customization);

    std::fs::write(&claude_md_path, final_content)
        .map_err(|e| format!("Failed to write CLAUDE.md: {}", e))?;
    Ok(())
}

/// Rebuild workspace CLAUDE.md with a three-section merge:
///   1. Base (from bundled template — always overwritten)
///   2. Custom Skills (from DB — regenerated)
///   3. Customization (from existing file — preserved)
///
/// Used by `init_workspace` and `clear_workspace` which have access to
/// the bundled template path via AppHandle.
pub fn rebuild_claude_md(
    bundled_base_path: &Path,
    workspace_path: &str,
    conn: &rusqlite::Connection,
) -> Result<(), String> {
    let raw_base = std::fs::read_to_string(bundled_base_path)
        .map_err(|e| format!("Failed to read bundled CLAUDE.md: {}", e))?;
    let base = if let Some(pos) = raw_base.find("\n## Customization\n") {
        raw_base[..pos].trim_end().to_string()
    } else {
        raw_base.trim_end().to_string()
    };
    write_claude_md(&base, workspace_path, conn)
}

/// Update only the Custom Skills zone in an existing workspace CLAUDE.md,
/// preserving both the base section above and customization section below.
///
/// Used by skill mutation callers (import, activate, delete, trigger edit)
/// which don't have access to the bundled template path.
pub fn update_skills_section(
    workspace_path: &str,
    conn: &rusqlite::Connection,
) -> Result<(), String> {
    let claude_md_path = Path::new(workspace_path).join("CLAUDE.md");
    let content = if claude_md_path.is_file() {
        std::fs::read_to_string(&claude_md_path)
            .map_err(|e| format!("Failed to read CLAUDE.md: {}", e))?
    } else {
        return Err("CLAUDE.md does not exist; run init_workspace first".to_string());
    };

    let base_end = content
        .find("\n## Custom Skills\n")
        .or_else(|| content.find("\n## Skill Generation Guidance\n"))
        .or_else(|| content.find("\n## Imported Skills\n"))
        .or_else(|| content.find("\n## Customization\n"))
        .unwrap_or(content.len());
    let base = content[..base_end].trim_end().to_string();

    write_claude_md(&base, workspace_path, conn)
}
