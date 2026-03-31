use std::path::Path;

pub(crate) const DEFAULT_CUSTOMIZATION_SECTION: &str =
    "## Customization\n\nAdd your workspace-specific instructions below. This section is preserved across app updates.\n";

/// Rebuild workspace CLAUDE.md:
///   1. Read existing workspace CLAUDE.md → extract ## Customization section
///   2. Read bundled template → replace its ## Customization section with the one from step 1
///   3. Write to the workspace location
pub fn rebuild_claude_md(bundled_base_path: &Path, workspace_path: &str) -> Result<(), String> {
    let claude_md_path = Path::new(workspace_path).join("CLAUDE.md");

    // 1. Extract ## Customization from the existing workspace file (preserve user edits)
    let customization = if claude_md_path.is_file() {
        let existing = std::fs::read_to_string(&claude_md_path)
            .map_err(|e| format!("Failed to read existing CLAUDE.md: {}", e))?;
        if let Some(pos) = existing.find("\n## Customization\n") {
            existing[pos + 1..].to_string()
        } else {
            DEFAULT_CUSTOMIZATION_SECTION.to_string()
        }
    } else {
        DEFAULT_CUSTOMIZATION_SECTION.to_string()
    };

    // 2. Read bundled template, replace its ## Customization section
    let bundled = std::fs::read_to_string(bundled_base_path)
        .map_err(|e| format!("Failed to read bundled CLAUDE.md: {}", e))?;
    let base = if let Some(pos) = bundled.find("\n## Customization\n") {
        bundled[..pos].trim_end()
    } else {
        bundled.trim_end()
    };
    let content = format!("{}\n\n{}", base, customization);

    // 3. Write to workspace
    std::fs::write(&claude_md_path, content)
        .map_err(|e| format!("Failed to write CLAUDE.md: {}", e))?;
    Ok(())
}
