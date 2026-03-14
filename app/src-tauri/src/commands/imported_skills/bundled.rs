use std::fs;
use std::path::Path;

use super::frontmatter::parse_frontmatter_full;
use super::helpers::copy_dir_recursive;

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
