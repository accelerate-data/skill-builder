use crate::skill_paths::resolve_existing_skill_dir;
use std::path::Path;

/// Returns `Some(3)` if SKILL.md exists in skills_path for this skill, `None` otherwise.
/// Steps 0/1/2 artifact completion is DB-authoritative and not detected here.
#[allow(dead_code)]
pub fn detect_furthest_step(plugin_slug: &str, skill_name: &str, skills_path: &str) -> Option<u32> {
    log::debug!("[detect_furthest_step] skill='{}'", skill_name);
    let output_dir = resolve_existing_skill_dir(Path::new(skills_path), plugin_slug, skill_name);
    if output_dir.join("SKILL.md").exists() {
        Some(3)
    } else {
        None
    }
}

/// Check if a skill has ANY output files in the skills_path directory.
pub fn has_skill_output(plugin_slug: &str, skill_name: &str, skills_path: &str) -> bool {
    let output_dir = resolve_existing_skill_dir(Path::new(skills_path), plugin_slug, skill_name);
    output_dir.join("SKILL.md").exists() || output_dir.join("references").is_dir()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::skill_paths::DEFAULT_PLUGIN_SLUG;

    const SLUG: &str = DEFAULT_PLUGIN_SLUG;

    #[test]
    fn test_detect_furthest_step_no_skill_md() {
        let skills_tmp = tempfile::tempdir().unwrap();
        let skills_path = skills_tmp.path().to_str().unwrap();
        // Create workspace dir but no SKILL.md
        std::fs::create_dir_all(crate::skill_paths::resolve_skill_dir(
            skills_tmp.path(),
            SLUG,
            "my-skill",
        ))
        .unwrap();

        let step = detect_furthest_step(SLUG, "my-skill", skills_path);
        assert_eq!(step, None);
    }

    #[test]
    fn test_detect_furthest_step_with_skill_md() {
        let tmp = tempfile::tempdir().unwrap();
        let skills_tmp = tempfile::tempdir().unwrap();
        let skills_path = skills_tmp.path().to_str().unwrap();

        // Create SKILL.md in skills_path
        let skill_output =
            crate::skill_paths::resolve_skill_dir(skills_tmp.path(), SLUG, "my-skill");
        std::fs::create_dir_all(&skill_output).unwrap();
        std::fs::write(skill_output.join("SKILL.md"), "# Skill").unwrap();

        let step = detect_furthest_step(SLUG, "my-skill", skills_path);
        assert_eq!(step, Some(3));
    }

    #[test]
    fn test_detect_furthest_step_nonexistent_dir() {
        let tmp = tempfile::tempdir().unwrap();
        let skills_path = tmp.path().to_str().unwrap();
        let step = detect_furthest_step(SLUG, "no-skill", skills_path);
        assert_eq!(step, None);
    }

    #[test]
    fn test_has_skill_output_with_skill_md() {
        let tmp = tempfile::tempdir().unwrap();
        let output_dir = crate::skill_paths::resolve_skill_dir(tmp.path(), SLUG, "my-skill");
        std::fs::create_dir_all(&output_dir).unwrap();
        std::fs::write(output_dir.join("SKILL.md"), "# Skill").unwrap();

        assert!(has_skill_output(
            SLUG,
            "my-skill",
            tmp.path().to_str().unwrap()
        ));
    }

    #[test]
    fn test_has_skill_output_with_references() {
        let tmp = tempfile::tempdir().unwrap();
        let output_dir = crate::skill_paths::resolve_skill_dir(tmp.path(), SLUG, "my-skill");
        std::fs::create_dir_all(output_dir.join("references")).unwrap();

        assert!(has_skill_output(
            SLUG,
            "my-skill",
            tmp.path().to_str().unwrap()
        ));
    }

    #[test]
    fn test_has_skill_output_empty_dir() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(crate::skill_paths::resolve_skill_dir(
            tmp.path(),
            SLUG,
            "my-skill",
        ))
        .unwrap();

        assert!(!has_skill_output(
            SLUG,
            "my-skill",
            tmp.path().to_str().unwrap()
        ));
    }
}
