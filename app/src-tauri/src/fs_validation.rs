use crate::cleanup::cleanup_step_files;
use crate::commands::workflow::get_step_output_files;
use std::path::Path;

/// Inspect files on disk to determine the furthest completed step for a skill.
/// Returns `None` if no steps have been completed (no output files found),
/// or `Some(n)` where n is the furthest completed step number. A step counts
/// as complete only if ALL of its expected output files exist. Partial output
/// (some but not all files) is cleaned up defensively.
pub fn detect_furthest_step(
    workspace_path: &str,
    skill_name: &str,
    skills_path: Option<&str>,
) -> Option<u32> {
    let skill_dir = Path::new(workspace_path).join(skill_name);
    if !skill_dir.exists() {
        return None;
    }

    let mut furthest: Option<u32> = None;

    // Step 2 (detailed research) edits clarifications.md in-place — no unique
    // artifact to detect, so it's treated as non-detectable (like steps 1/3).
    for step_id in [0u32, 4, 5] {
        let files = get_step_output_files(step_id);
        let (has_all, has_any) = if step_id == 5 {
            let output_dir = if let Some(sp) = skills_path {
                Path::new(sp).join(skill_name)
            } else {
                skill_dir.clone()
            };
            let exists = output_dir.join("SKILL.md").exists();
            (exists, exists)
        } else if skills_path.is_some() && matches!(step_id, 0 | 2 | 4) {
            let target_dir = Path::new(skills_path.unwrap()).join(skill_name);
            let all = files.iter().all(|f| target_dir.join(f).exists());
            let any = files.iter().any(|f| target_dir.join(f).exists());
            (all, any)
        } else {
            let all = files.iter().all(|f| skill_dir.join(f).exists());
            let any = files.iter().any(|f| skill_dir.join(f).exists());
            (all, any)
        };

        if has_all {
            furthest = Some(step_id);
        } else {
            if has_any {
                // Partial output — clean up orphaned files from this incomplete step
                log::debug!(
                    "[detect_furthest_step] step {} has partial output for '{}', cleaning up",
                    step_id, skill_name
                );
                cleanup_step_files(workspace_path, skill_name, step_id, skills_path);
            }
            // Stop at first incomplete step — later steps can't be valid
            // without earlier ones completing first. Clean up any files from
            // steps beyond this point.
            break;
        }
    }

    furthest
}

/// Check if a skill has ANY output files in the skills_path directory.
/// This includes build output (SKILL.md, references/) and context files
/// (clarifications, decisions) that are written directly to skills_path.
pub fn has_skill_output(skill_name: &str, skills_path: Option<&str>) -> bool {
    if let Some(sp) = skills_path {
        let output_dir = Path::new(sp).join(skill_name);
        output_dir.join("SKILL.md").exists()
            || output_dir.join("references").is_dir()
            || output_dir.join("context").is_dir()
    } else {
        false
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
    fn test_detect_furthest_step_empty_dir() {
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        create_skill_dir(tmp.path(), "empty-skill", "test");

        let step = detect_furthest_step(workspace, "empty-skill", None);
        assert_eq!(step, None);
    }

    #[test]
    fn test_detect_furthest_step_through_steps() {
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        create_skill_dir(tmp.path(), "my-skill", "test");

        // Step 0 output
        create_step_output(tmp.path(), "my-skill", 0);
        assert_eq!(detect_furthest_step(workspace, "my-skill", None), Some(0));

        // Step 2 is non-detectable (edits clarifications.md in-place, no unique artifact).
        // Detection skips from step 0 to step 4.

        // Step 4 output
        create_step_output(tmp.path(), "my-skill", 4);
        assert_eq!(detect_furthest_step(workspace, "my-skill", None), Some(4));
    }

    #[test]
    fn test_detect_furthest_step_with_skills_path() {
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().join("workspace");
        let skills = tmp.path().join("skills");

        // Working dir must exist for detect_furthest_step to proceed
        std::fs::create_dir_all(workspace.join("my-skill")).unwrap();

        // Context files live in skills_path when configured
        create_step_output(&skills, "my-skill", 0);
        create_step_output(&skills, "my-skill", 2);
        create_step_output(&skills, "my-skill", 4);

        // Step 5 output lives in skills_path
        std::fs::create_dir_all(skills.join("my-skill")).unwrap();
        std::fs::write(skills.join("my-skill").join("SKILL.md"), "# Skill").unwrap();

        let step = detect_furthest_step(
            workspace.to_str().unwrap(),
            "my-skill",
            Some(skills.to_str().unwrap()),
        );
        assert_eq!(step, Some(5));

        // Verify context steps are individually detectable
        assert_eq!(
            detect_furthest_step(workspace.to_str().unwrap(), "my-skill", Some(skills.to_str().unwrap())),
            Some(5)
        );
    }

    #[test]
    fn test_detect_furthest_step_skill_md_only() {
        // SKILL.md exists but no context files (steps 0/2/4 missing).
        // Detection stops at first incomplete step, so step 5 is NOT reached.
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().join("workspace");
        let skills = tmp.path().join("skills");

        std::fs::create_dir_all(workspace.join("my-skill")).unwrap();
        std::fs::create_dir_all(skills.join("my-skill")).unwrap();
        std::fs::write(skills.join("my-skill").join("SKILL.md"), "# Skill").unwrap();

        let step = detect_furthest_step(
            workspace.to_str().unwrap(),
            "my-skill",
            Some(skills.to_str().unwrap()),
        );
        assert_eq!(step, None, "step 5 without earlier steps should not be detected");
    }

    #[test]
    fn test_detect_furthest_step_nonexistent_dir() {
        let step = detect_furthest_step("/nonexistent/path", "no-skill", None);
        assert_eq!(step, None);
    }

    #[test]
    fn test_detect_step5_ignores_empty_references_dir() {
        // Regression: create_skill_inner creates an empty references/ dir in
        // skills_path at skill creation time. detect_furthest_step must not
        // treat this as proof that step 5 (build) completed.
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().join("workspace");
        let skills = tmp.path().join("skills");

        std::fs::create_dir_all(workspace.join("my-skill")).unwrap();
        // Simulate create_skill_inner: empty context/ and references/ dirs
        std::fs::create_dir_all(skills.join("my-skill").join("context")).unwrap();
        std::fs::create_dir_all(skills.join("my-skill").join("references")).unwrap();

        // Only step 0 output files exist
        create_step_output(&skills, "my-skill", 0);

        let step = detect_furthest_step(
            workspace.to_str().unwrap(),
            "my-skill",
            Some(skills.to_str().unwrap()),
        );
        // Should detect step 0 only — NOT step 5
        assert_eq!(step, Some(0));
    }

    #[test]
    fn test_has_skill_output_with_skill_md() {
        let tmp = tempfile::tempdir().unwrap();
        let output_dir = tmp.path().join("my-skill");
        std::fs::create_dir_all(&output_dir).unwrap();
        std::fs::write(output_dir.join("SKILL.md"), "# Skill").unwrap();

        assert!(has_skill_output(
            "my-skill",
            Some(tmp.path().to_str().unwrap())
        ));
    }

    #[test]
    fn test_has_skill_output_with_references() {
        let tmp = tempfile::tempdir().unwrap();
        let output_dir = tmp.path().join("my-skill");
        std::fs::create_dir_all(output_dir.join("references")).unwrap();

        assert!(has_skill_output(
            "my-skill",
            Some(tmp.path().to_str().unwrap())
        ));
    }

    #[test]
    fn test_has_skill_output_none() {
        assert!(!has_skill_output("my-skill", None));
    }

    #[test]
    fn test_has_skill_output_with_context() {
        let tmp = tempfile::tempdir().unwrap();
        let output_dir = tmp.path().join("my-skill");
        std::fs::create_dir_all(output_dir.join("context")).unwrap();

        assert!(has_skill_output(
            "my-skill",
            Some(tmp.path().to_str().unwrap())
        ));
    }

    #[test]
    fn test_has_skill_output_empty_dir() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(tmp.path().join("my-skill")).unwrap();

        assert!(!has_skill_output(
            "my-skill",
            Some(tmp.path().to_str().unwrap())
        ));
    }
}
