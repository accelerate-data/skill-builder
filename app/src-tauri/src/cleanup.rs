use crate::commands::workflow::get_step_output_files;
use std::path::Path;

/// Delete output files for a single step from both workspace and skills_path.
/// Used defensively to clean up partial output from interrupted agent runs.
pub fn cleanup_step_files(
    workspace_path: &str,
    skill_name: &str,
    step_id: u32,
    skills_path: Option<&str>,
) {
    let skill_dir = Path::new(workspace_path).join(skill_name);
    let files = get_step_output_files(step_id);

    if step_id == 5 {
        let output_dir = if let Some(sp) = skills_path {
            Path::new(sp).join(skill_name)
        } else {
            skill_dir.clone()
        };
        let skill_md = output_dir.join("SKILL.md");
        if skill_md.exists() {
            let _ = std::fs::remove_file(&skill_md);
            log::debug!("[cleanup_step_files] deleted {}", skill_md.display());
        }
        let refs_dir = output_dir.join("references");
        if refs_dir.is_dir() {
            // Only delete if non-empty (empty dir is from create_skill_inner)
            if std::fs::read_dir(&refs_dir).map(|mut d| d.next().is_some()).unwrap_or(false) {
                let _ = std::fs::remove_dir_all(&refs_dir);
                // Recreate empty dir (create_skill_inner expects it)
                let _ = std::fs::create_dir_all(&refs_dir);
                log::debug!("[cleanup_step_files] cleaned references/ in {}", output_dir.display());
            }
        }
        return;
    }

    // Context files — check both workspace and skills_path locations
    let context_dir = if let Some(sp) = skills_path {
        if matches!(step_id, 0 | 2 | 4 | 6) {
            Path::new(sp).join(skill_name)
        } else {
            skill_dir.clone()
        }
    } else {
        skill_dir.clone()
    };

    for file in &files {
        for dir in [&skill_dir, &context_dir] {
            let path = dir.join(file);
            if path.exists() {
                let _ = std::fs::remove_file(&path);
                log::debug!("[cleanup_step_files] deleted {}", path.display());
            }
        }
    }
}

/// Clean up files from all steps after the reconciled step.
/// Removes both partial and complete output for future steps to prevent
/// stale files from causing incorrect reconciliation on next startup.
pub fn cleanup_future_steps(
    workspace_path: &str,
    skill_name: &str,
    after_step: i32,
    skills_path: Option<&str>,
) {
    for step_id in [0u32, 2, 4, 5, 6] {
        if (step_id as i32) <= after_step {
            continue;
        }
        cleanup_step_files(workspace_path, skill_name, step_id, skills_path);
    }
}

/// Delete output files for a single step (thorough version).
/// For step 5 (build), files are in `skill_output_dir` (skills_path/skill_name or
/// workspace_path/skill_name). For other steps, files are in workspace_path/skill_name.
/// More thorough than `cleanup_step_files` — used by the reset flow.
pub fn clean_step_output_thorough(workspace_path: &str, skill_name: &str, step_id: u32, skills_path: Option<&str>) {
    let skill_dir = Path::new(workspace_path).join(skill_name);
    log::debug!(
        "[clean_step_output_thorough] step={} skill={} workspace={} skills_path={:?}",
        step_id, skill_name, workspace_path, skills_path
    );

    if step_id == 5 {
        // Step 5 output lives in skill_output_dir
        let skill_output_dir = if let Some(sp) = skills_path {
            Path::new(sp).join(skill_name)
        } else {
            skill_dir.clone()
        };
        log::debug!("[clean_step_output_thorough] step=5 output_dir={} exists={}", skill_output_dir.display(), skill_output_dir.exists());
        if skill_output_dir.exists() {
            for file in get_step_output_files(5) {
                let path = skill_output_dir.join(file);
                if path.exists() {
                    match std::fs::remove_file(&path) {
                        Ok(()) => log::debug!("[clean_step_output_thorough] deleted {}", path.display()),
                        Err(e) => log::warn!("[clean_step_output_thorough] FAILED to delete {}: {}", path.display(), e),
                    }
                }
            }
            let refs_dir = skill_output_dir.join("references");
            if refs_dir.is_dir() {
                match std::fs::remove_dir_all(&refs_dir) {
                    Ok(()) => log::debug!("[clean_step_output_thorough] deleted dir {}", refs_dir.display()),
                    Err(e) => log::warn!("[clean_step_output_thorough] FAILED to delete dir {}: {}", refs_dir.display(), e),
                }
            }
            // Clean up .skill zip from skill output dir
            let skill_file = skill_output_dir.join(format!("{}.skill", skill_name));
            if skill_file.exists() {
                match std::fs::remove_file(&skill_file) {
                    Ok(()) => log::debug!("[clean_step_output_thorough] deleted {}", skill_file.display()),
                    Err(e) => log::warn!("[clean_step_output_thorough] FAILED to delete {}: {}", skill_file.display(), e),
                }
            }
        }
        return;
    }

    // Context files (steps 0, 2, 4, 6) may live in skills_path when configured
    let context_dir = if let Some(sp) = skills_path {
        if matches!(step_id, 0 | 2 | 4 | 6) {
            Path::new(sp).join(skill_name)
        } else {
            skill_dir.clone()
        }
    } else {
        skill_dir.clone()
    };
    log::debug!(
        "[clean_step_output_thorough] step={} skill_dir={} context_dir={}",
        step_id, skill_dir.display(), context_dir.display()
    );

    for file in get_step_output_files(step_id) {
        // Check both locations — workspace and skills_path
        for dir in [&skill_dir, &context_dir] {
            let path = dir.join(file);
            if path.exists() {
                match std::fs::remove_file(&path) {
                    Ok(()) => log::debug!("[clean_step_output_thorough] deleted {}", path.display()),
                    Err(e) => log::warn!("[clean_step_output_thorough] FAILED to delete {}: {}", path.display(), e),
                }
            } else {
                log::debug!("[clean_step_output_thorough] not found: {}", path.display());
            }
        }
    }

}

/// Delete output files for the given step and all subsequent steps.
pub fn delete_step_output_files(workspace_path: &str, skill_name: &str, from_step_id: u32, skills_path: Option<&str>) {
    log::debug!(
        "[delete_step_output_files] skill={} from_step={} workspace={} skills_path={:?}",
        skill_name, from_step_id, workspace_path, skills_path
    );
    for step_id in from_step_id..=6 {
        clean_step_output_thorough(workspace_path, skill_name, step_id, skills_path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::workflow::get_step_output_files;
    use std::path::Path;

    /// Create a skill working directory on disk with a context/ dir.
    fn create_skill_dir(workspace: &Path, name: &str, _domain: &str) {
        let skill_dir = workspace.join(name);
        std::fs::create_dir_all(skill_dir.join("context")).unwrap();
    }

    /// Create step output files on disk for the given step.
    fn create_step_output(workspace: &Path, name: &str, step_id: u32) {
        let skill_dir = workspace.join(name);
        std::fs::create_dir_all(skill_dir.join("context")).unwrap();
        for file in get_step_output_files(step_id) {
            let path = skill_dir.join(file);
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent).unwrap();
            }
            std::fs::write(&path, format!("# Step {} output", step_id)).unwrap();
        }
    }

    #[test]
    fn test_cleanup_future_steps() {
        // If reconciled to step 2, files from steps 4/5/6 should be cleaned up
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        create_skill_dir(tmp.path(), "my-skill", "test");

        // Create complete output for steps 0, 2, 4
        create_step_output(tmp.path(), "my-skill", 0);
        create_step_output(tmp.path(), "my-skill", 2);
        create_step_output(tmp.path(), "my-skill", 4);

        // Clean up everything after step 2
        cleanup_future_steps(workspace, "my-skill", 2, None);

        // Step 0 and 2 files should remain
        let skill_dir = tmp.path().join("my-skill");
        assert!(skill_dir.join("context/clarifications.md").exists());

        // Step 4 files should be gone
        assert!(!skill_dir.join("context/decisions.md").exists());
    }
}
