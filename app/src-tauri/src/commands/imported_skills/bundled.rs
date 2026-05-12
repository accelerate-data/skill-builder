use std::fs;
use std::path::Path;

use super::frontmatter::parse_frontmatter_full;
use super::helpers::copy_dir_recursive;
use crate::skill_paths::{resolve_skill_dir, DEFAULT_PLUGIN_SLUG};

const WORKFLOW_INTERNAL_SKILLS: &[&str] = &["research"];
const BUNDLED_WORKSPACE_MARKER: &str = ".skill-builder-bundled";

fn is_workflow_internal_skill(skill_name: &str) -> bool {
    WORKFLOW_INTERNAL_SKILLS.contains(&skill_name)
}

/// Remove bundled skill directories from the workspace that are no longer present in the current bundle.
/// This is a filesystem-only operation — no DB reads or writes.
///
/// Startup owns the workspace lifecycle cleanup around this function.
pub(crate) fn purge_stale_bundled_skills(
    workspace_path: &str,
    bundled_skills_dir: &std::path::Path,
    protected_skill_names: &std::collections::HashSet<String>,
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
            if is_workflow_internal_skill(&skill_name) {
                continue;
            }
            names.insert(skill_name);
        }
        names
    } else {
        std::collections::HashSet::new()
    };

    // Scan the canonical workspace plugin directory for bundled skills that
    // no longer exist in the current bundle.
    let skills_base = Path::new(workspace_path)
        .join(DEFAULT_PLUGIN_SLUG)
        .join("skills");
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
                let bundled_marker = path.join(BUNDLED_WORKSPACE_MARKER);
                if !current_names.contains(&skill_name)
                    && (bundled_marker.is_file() || !protected_skill_names.contains(&skill_name))
                {
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

    Ok(())
}

/// Seed bundled skills from the app's bundled-skills directory into the workspace.
/// For each subdirectory containing SKILL.md:
/// 1. Copies the directory to `{workspace}/{default_plugin_slug}/skills/{name}/` (always overwrite)
///
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

        // Workflow-internal skills are deployed into the OpenHands .agents tree
        // when needed. They must not become user-visible Claude skills.
        if is_workflow_internal_skill(&skill_name) {
            log::debug!(
                "seed_bundled_skills: skipping workflow-internal skill '{}'",
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

        // Copy directory to the canonical workspace skill location.
        let dest_dir =
            resolve_skill_dir(Path::new(workspace_path), DEFAULT_PLUGIN_SLUG, &skill_name);
        if dest_dir.exists() {
            fs::remove_dir_all(&dest_dir)
                .map_err(|e| format!("Failed to remove existing bundled skill dir: {}", e))?;
        }

        fs::create_dir_all(&dest_dir)
            .map_err(|e| format!("Failed to create bundled skill dir: {}", e))?;

        copy_dir_recursive(&entry_path, &dest_dir)
            .map_err(|e| format!("Failed to copy bundled skill '{}': {}", skill_name, e))?;
        fs::write(dest_dir.join(BUNDLED_WORKSPACE_MARKER), "").map_err(|e| {
            format!(
                "Failed to write bundled skill marker '{}': {}",
                skill_name, e
            )
        })?;

        log::info!(
            "seed_bundled_skills: seeded '{}' (version={} user_invocable={} disable_model_invocation={})",
            skill_name,
            fm.version.as_deref().unwrap_or("-"),
            fm.user_invocable.map_or("-".to_string(), |v| v.to_string()),
            fm.disable_model_invocation.map_or("-".to_string(), |v| v.to_string()),
        );
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{purge_stale_bundled_skills, seed_bundled_skills, BUNDLED_WORKSPACE_MARKER};
    use crate::skill_paths::{resolve_skill_dir, DEFAULT_PLUGIN_SLUG};

    #[test]
    fn seed_bundled_skills_uses_canonical_workspace_layout() {
        let workspace = tempfile::tempdir().unwrap();
        let bundled = tempfile::tempdir().unwrap();
        let bundled_skill_dir = bundled.path().join("demo-skill");
        std::fs::create_dir_all(&bundled_skill_dir).unwrap();
        std::fs::write(
            bundled_skill_dir.join("SKILL.md"),
            "---\nname: demo-skill\ndescription: Demo bundled skill\n---\n# Body\n",
        )
        .unwrap();

        seed_bundled_skills(workspace.path().to_str().unwrap(), bundled.path()).unwrap();

        assert!(
            resolve_skill_dir(workspace.path(), DEFAULT_PLUGIN_SLUG, "demo-skill")
                .join("SKILL.md")
                .is_file()
        );
        assert!(
            !workspace
                .path()
                .join(".claude/skills/demo-skill/SKILL.md")
                .exists(),
            "legacy workspace .claude skill mirror should not be recreated"
        );
    }

    #[test]
    fn purge_stale_bundled_skills_removes_canonical_skill_dirs() {
        let workspace = tempfile::tempdir().unwrap();
        let bundled = tempfile::tempdir().unwrap();
        let kept_bundle_dir = bundled.path().join("kept-skill");
        std::fs::create_dir_all(&kept_bundle_dir).unwrap();
        std::fs::write(
            kept_bundle_dir.join("SKILL.md"),
            "---\nname: kept-skill\ndescription: Keep me\n---\n# Body\n",
        )
        .unwrap();

        let kept_workspace_dir =
            resolve_skill_dir(workspace.path(), DEFAULT_PLUGIN_SLUG, "kept-skill");
        std::fs::create_dir_all(&kept_workspace_dir).unwrap();
        std::fs::write(
            kept_workspace_dir.join("SKILL.md"),
            "---\nname: kept-skill\ndescription: Keep me\n---\n# Body\n",
        )
        .unwrap();

        let stale_workspace_dir =
            resolve_skill_dir(workspace.path(), DEFAULT_PLUGIN_SLUG, "stale-skill");
        std::fs::create_dir_all(&stale_workspace_dir).unwrap();
        std::fs::write(
            stale_workspace_dir.join("SKILL.md"),
            "---\nname: stale-skill\ndescription: Remove me\n---\n# Body\n",
        )
        .unwrap();
        std::fs::write(stale_workspace_dir.join(BUNDLED_WORKSPACE_MARKER), "").unwrap();

        purge_stale_bundled_skills(
            workspace.path().to_str().unwrap(),
            bundled.path(),
            &std::collections::HashSet::new(),
        )
        .unwrap();

        assert!(
            kept_workspace_dir.exists(),
            "current bundled skill should remain"
        );
        assert!(
            !stale_workspace_dir.exists(),
            "stale bundled skill mirror should be removed from canonical workspace layout"
        );
    }

    #[test]
    fn purge_stale_bundled_skills_preserves_custom_skill_dirs() {
        let workspace = tempfile::tempdir().unwrap();
        let bundled = tempfile::tempdir().unwrap();
        let bundled_skill_dir = bundled.path().join("kept-skill");
        std::fs::create_dir_all(&bundled_skill_dir).unwrap();
        std::fs::write(
            bundled_skill_dir.join("SKILL.md"),
            "---\nname: kept-skill\ndescription: Keep me\n---\n# Body\n",
        )
        .unwrap();

        let custom_workspace_dir =
            resolve_skill_dir(workspace.path(), DEFAULT_PLUGIN_SLUG, "custom-skill");
        std::fs::create_dir_all(&custom_workspace_dir).unwrap();
        std::fs::write(
            custom_workspace_dir.join("SKILL.md"),
            "---\nname: custom-skill\ndescription: User authored\n---\n# Body\n",
        )
        .unwrap();

        let mut protected = std::collections::HashSet::new();
        protected.insert("custom-skill".to_string());

        purge_stale_bundled_skills(
            workspace.path().to_str().unwrap(),
            bundled.path(),
            &protected,
        )
        .unwrap();

        assert!(
            custom_workspace_dir.exists(),
            "non-bundled user/custom workspace skills must not be deleted during bundled purge"
        );
    }

    #[test]
    fn purge_stale_bundled_skills_removes_unmarked_upgrade_mirror_when_not_protected() {
        let workspace = tempfile::tempdir().unwrap();
        let bundled = tempfile::tempdir().unwrap();
        let bundled_skill_dir = bundled.path().join("kept-skill");
        std::fs::create_dir_all(&bundled_skill_dir).unwrap();
        std::fs::write(
            bundled_skill_dir.join("SKILL.md"),
            "---\nname: kept-skill\ndescription: Keep me\n---\n# Body\n",
        )
        .unwrap();

        let stale_workspace_dir =
            resolve_skill_dir(workspace.path(), DEFAULT_PLUGIN_SLUG, "old-bundled-skill");
        std::fs::create_dir_all(&stale_workspace_dir).unwrap();
        std::fs::write(
            stale_workspace_dir.join("SKILL.md"),
            "---\nname: old-bundled-skill\ndescription: Old bundled mirror\n---\n# Body\n",
        )
        .unwrap();

        let mut protected = std::collections::HashSet::new();
        protected.insert("custom-skill".to_string());

        purge_stale_bundled_skills(
            workspace.path().to_str().unwrap(),
            bundled.path(),
            &protected,
        )
        .unwrap();

        assert!(
            !stale_workspace_dir.exists(),
            "pre-marker bundled workspace mirrors should still be purgeable after upgrade"
        );
    }
}
