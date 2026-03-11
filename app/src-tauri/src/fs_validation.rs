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
    skills_path: &str,
) -> Option<u32> {
    detect_furthest_step_with_options(workspace_path, skill_name, skills_path, true)
}

/// Inspect files on disk to determine the furthest completed step for a skill.
/// When `cleanup_partial` is false, this is a read-only check suitable for
/// preview flows that must not mutate disk state.
pub fn detect_furthest_step_with_options(
    workspace_path: &str,
    skill_name: &str,
    skills_path: &str,
    cleanup_partial: bool,
) -> Option<u32> {
    log::debug!(
        "[detect_furthest_step] skill='{}': workspace={} skills_path={}",
        skill_name,
        workspace_path,
        skills_path
    );
    let skill_dir = Path::new(workspace_path).join(skill_name);
    if !skill_dir.exists() {
        log::debug!(
            "[detect_furthest_step] skill='{}': workspace dir does not exist, returning None",
            skill_name
        );
        return None;
    }

    let mut furthest: Option<u32> = None;
    let workspace_root = Path::new(workspace_path).join(skill_name);
    let legacy_root = Path::new(skills_path).join(skill_name);

    // Detectable steps: those that write unique output files.
    // Steps 0, 2 write context files to workspace_path/skill_name/context/.
    // Step 3 writes SKILL.md to skills_path/skill_name/.
    // Step 1 edits clarifications.json in-place (no unique artifact) — non-detectable.
    for step_id in [0u32, 2, 3] {
        let files = get_step_output_files(step_id);
        let (has_all, has_any) = if step_id == 3 {
            let output_dir = Path::new(skills_path).join(skill_name);
            let exists = output_dir.join("SKILL.md").exists();
            log::debug!(
                "[detect_furthest_step] skill='{}': step={} checking SKILL.md at {} exists={}",
                skill_name,
                step_id,
                output_dir.join("SKILL.md").display(),
                exists
            );
            (exists, exists)
        } else {
            // Steps 0, 2: context files live in workspace_path/skill_name/context/*.
            // During migration we also recognize legacy skills_path/skill_name/context/*.
            let all_workspace =
                files.iter().all(|f| {
                    let p = workspace_root.join(f);
                    let e = p.exists();
                    log::debug!(
                    "[detect_furthest_step] skill='{}': step={} checking workspace {} exists={}",
                    skill_name, step_id, p.display(), e
                );
                    e
                });
            let all_legacy = files.iter().all(|f| legacy_root.join(f).exists());
            let any_workspace = files.iter().any(|f| workspace_root.join(f).exists());
            let any_legacy = files.iter().any(|f| legacy_root.join(f).exists());
            (all_workspace || all_legacy, any_workspace || any_legacy)
        };

        if has_all {
            furthest = Some(step_id);
        } else {
            if has_any {
                // Partial output — clean up orphaned files from this incomplete step
                if cleanup_partial {
                    log::debug!(
                        "[detect_furthest_step] skill='{}': step {} has partial output, cleaning up",
                        skill_name, step_id
                    );
                    cleanup_step_files(workspace_path, skill_name, step_id, skills_path);
                }
            }
            // Stop at first incomplete step — later steps can't be valid
            // without earlier ones completing first. Clean up any files from
            // steps beyond this point.
            break;
        }
    }

    log::debug!(
        "[detect_furthest_step] skill='{}': furthest={:?}",
        skill_name,
        furthest
    );
    furthest
}

/// Check if a skill has ANY output files in the skills_path directory.
/// This includes build output (SKILL.md, references/) in skills_path.
pub fn has_skill_output(skill_name: &str, skills_path: &str) -> bool {
    log::debug!(
        "[has_skill_output] skill='{}': skills_path={}",
        skill_name,
        skills_path
    );
    let output_dir = Path::new(skills_path).join(skill_name);
    let result = output_dir.join("SKILL.md").exists() || output_dir.join("references").is_dir();
    log::debug!(
        "[has_skill_output] skill='{}': result={}",
        skill_name,
        result
    );
    result
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
        let skills_tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        let skills_path = skills_tmp.path().to_str().unwrap();
        create_skill_dir(tmp.path(), "empty-skill", "test");

        let step = detect_furthest_step(workspace, "empty-skill", skills_path);
        assert_eq!(step, None);
    }

    #[test]
    fn test_detect_furthest_step_through_steps() {
        let tmp = tempfile::tempdir().unwrap();
        let skills_tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        let skills_path = skills_tmp.path().to_str().unwrap();
        create_skill_dir(tmp.path(), "my-skill", "test");

        // Step 0 output in skills_path
        create_step_output(skills_tmp.path(), "my-skill", 0);
        assert_eq!(
            detect_furthest_step(workspace, "my-skill", skills_path),
            Some(0)
        );

        // Step 1 edits clarifications.json in-place — no unique artifact, not detectable alone.
        // Detection goes from 0 to 2.

        // Step 2 output in skills_path
        create_step_output(skills_tmp.path(), "my-skill", 2);
        assert_eq!(
            detect_furthest_step(workspace, "my-skill", skills_path),
            Some(2)
        );
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
        create_step_output(&skills, "my-skill", 1);
        create_step_output(&skills, "my-skill", 2);

        // Step 3 output lives in skills_path
        std::fs::create_dir_all(skills.join("my-skill")).unwrap();
        std::fs::write(skills.join("my-skill").join("SKILL.md"), "# Skill").unwrap();

        let step = detect_furthest_step(
            workspace.to_str().unwrap(),
            "my-skill",
            skills.to_str().unwrap(),
        );
        assert_eq!(step, Some(3));

        // Verify context steps are individually detectable
        assert_eq!(
            detect_furthest_step(
                workspace.to_str().unwrap(),
                "my-skill",
                skills.to_str().unwrap()
            ),
            Some(3)
        );
    }

    #[test]
    fn test_detect_furthest_step_skill_md_only() {
        // SKILL.md exists but no context files (steps 0/2 missing).
        // Detection stops at first incomplete step, so step 3 is NOT reached.
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().join("workspace");
        let skills = tmp.path().join("skills");

        std::fs::create_dir_all(workspace.join("my-skill")).unwrap();
        std::fs::create_dir_all(skills.join("my-skill")).unwrap();
        std::fs::write(skills.join("my-skill").join("SKILL.md"), "# Skill").unwrap();

        let step = detect_furthest_step(
            workspace.to_str().unwrap(),
            "my-skill",
            skills.to_str().unwrap(),
        );
        assert_eq!(
            step, None,
            "step 3 without earlier steps should not be detected"
        );
    }

    #[test]
    fn test_detect_furthest_step_nonexistent_dir() {
        let tmp = tempfile::tempdir().unwrap();
        let skills_path = tmp.path().to_str().unwrap();
        let step = detect_furthest_step("/nonexistent/path", "no-skill", skills_path);
        assert_eq!(step, None);
    }

    #[test]
    fn test_detect_step3_ignores_empty_references_dir() {
        // Regression: create_skill_inner creates an empty references/ dir in
        // skills_path at skill creation time. detect_furthest_step must not
        // treat this as proof that step 3 (generate skill) completed.
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
            skills.to_str().unwrap(),
        );
        // Should detect step 0 only — NOT step 3
        assert_eq!(step, Some(0));
    }

    #[test]
    fn test_has_skill_output_with_skill_md() {
        let tmp = tempfile::tempdir().unwrap();
        let output_dir = tmp.path().join("my-skill");
        std::fs::create_dir_all(&output_dir).unwrap();
        std::fs::write(output_dir.join("SKILL.md"), "# Skill").unwrap();

        assert!(has_skill_output("my-skill", tmp.path().to_str().unwrap()));
    }

    #[test]
    fn test_has_skill_output_with_references() {
        let tmp = tempfile::tempdir().unwrap();
        let output_dir = tmp.path().join("my-skill");
        std::fs::create_dir_all(output_dir.join("references")).unwrap();

        assert!(has_skill_output("my-skill", tmp.path().to_str().unwrap()));
    }

    #[test]
    fn test_has_skill_output_empty_dir() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(tmp.path().join("my-skill")).unwrap();

        assert!(!has_skill_output("my-skill", tmp.path().to_str().unwrap()));
    }

    #[test]
    fn test_has_skill_output_with_context() {
        let tmp = tempfile::tempdir().unwrap();
        let output_dir = tmp.path().join("my-skill");
        std::fs::create_dir_all(output_dir.join("context")).unwrap();

        assert!(!has_skill_output("my-skill", tmp.path().to_str().unwrap()));
    }

    #[test]
    fn test_detect_step1_is_not_independently_detectable() {
        // Step 1 edits clarifications.json in-place (no unique artifact).
        // Detection skips step 1 entirely and goes 0 -> 2 -> 3.
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().join("workspace");
        let skills = tmp.path().join("skills");

        std::fs::create_dir_all(workspace.join("my-skill")).unwrap();
        // Create step 0 context output (clarifications.json) in skills_path
        create_step_output(&skills, "my-skill", 0);
        // No step 2 output — should detect step 0 only
        let step = detect_furthest_step(
            workspace.to_str().unwrap(),
            "my-skill",
            skills.to_str().unwrap(),
        );
        assert_eq!(
            step,
            Some(0),
            "Step 1 is non-detectable; step 0 should be furthest"
        );

        // Now add step 2 output
        create_step_output(&skills, "my-skill", 2);
        let step = detect_furthest_step(
            workspace.to_str().unwrap(),
            "my-skill",
            skills.to_str().unwrap(),
        );
        assert_eq!(
            step,
            Some(2),
            "Should detect step 2 with step 0 and 2 output"
        );
    }
}
