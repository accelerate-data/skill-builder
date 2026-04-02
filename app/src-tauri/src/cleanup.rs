use crate::commands::workflow::get_step_output_files;
use crate::skill_paths::{resolve_skill_dir, resolve_workspace_skill_dir};
use std::path::Path;

/// Try to remove a file, logging the outcome.
fn remove_file_logged(label: &str, path: &Path) {
    if path.exists() {
        match std::fs::remove_file(path) {
            Ok(()) => log::debug!("[{}] deleted {}", label, path.display()),
            Err(e) => log::warn!("[{}] FAILED to delete {}: {}", label, path.display(), e),
        }
    }
}

/// Try to remove a directory tree, logging the outcome.
fn remove_dir_logged(label: &str, path: &Path) {
    if path.is_dir() {
        match std::fs::remove_dir_all(path) {
            Ok(()) => log::debug!("[{}] deleted dir {}", label, path.display()),
            Err(e) => log::warn!("[{}] FAILED to delete dir {}: {}", label, path.display(), e),
        }
    }
}

/// List existing output files for a single step (display names, not full paths).
///
/// For step 0, also lists workflow-level files (gate-result.json, answer-evaluation.json).
/// For step 3, checks skills_path for skill artifacts and workspace for evals.
/// For other steps, checks context files in workspace_path/skill_name/.
pub fn list_step_output_files(
    workspace_path: &str,
    skill_name: &str,
    plugin_slug: &str,
    step_id: u32,
    skills_path: &str,
) -> Vec<String> {
    log::debug!(
        "[list_step_output_files] skill='{}': step={} workspace={} skills_path={}",
        skill_name,
        step_id,
        workspace_path,
        skills_path
    );
    let skill_dir = resolve_workspace_skill_dir(Path::new(workspace_path), plugin_slug, skill_name);
    let mut files = Vec::new();

    match step_id {
        0 => {
            for file in get_step_output_files(0) {
                if skill_dir.join(file).exists() {
                    files.push(file.to_string());
                }
            }
            for extra in ["gate-result.json", "answer-evaluation.json"] {
                if skill_dir.join(extra).exists() {
                    files.push(extra.to_string());
                }
            }
        }
        3 => {
            let skill_output_dir = resolve_skill_dir(Path::new(skills_path), plugin_slug, skill_name);
            if skill_output_dir.exists() {
                for file in get_step_output_files(3) {
                    if skill_output_dir.join(file).exists() {
                        files.push(file.to_string());
                    }
                }
                let refs_dir = skill_output_dir.join("references");
                if refs_dir.is_dir() {
                    if let Ok(entries) = std::fs::read_dir(&refs_dir) {
                        for entry in entries.flatten() {
                            if entry.path().is_file() {
                                if let Some(name) = entry.path().file_name() {
                                    files.push(format!(
                                        "references/{}",
                                        name.to_string_lossy()
                                    ));
                                }
                            }
                        }
                    }
                }
                let skill_zip = format!("{}.skill", skill_name);
                if skill_output_dir.join(&skill_zip).exists() {
                    files.push(skill_zip);
                }
            }
            if skill_dir.join("evals").is_dir() {
                files.push("evals/".to_string());
            }
        }
        _ => {
            for file in get_step_output_files(step_id) {
                if skill_dir.join(file).exists() {
                    files.push(file.to_string());
                }
            }
        }
    }
    files
}

/// Delete output files for a single step.
pub fn clean_step_output(
    workspace_path: &str,
    skill_name: &str,
    plugin_slug: &str,
    step_id: u32,
    skills_path: &str,
) {
    const LABEL: &str = "clean_step_output";
    log::debug!(
        "[{}] skill='{}': step={} workspace={} skills_path={}",
        LABEL,
        skill_name,
        step_id,
        workspace_path,
        skills_path
    );

    let skill_dir = resolve_workspace_skill_dir(Path::new(workspace_path), plugin_slug, skill_name);

    match step_id {
        0 => {
            // Step 0 output + workflow-level files written to skill_dir
            for file in get_step_output_files(0) {
                remove_file_logged(LABEL, &skill_dir.join(file));
            }
            remove_file_logged(LABEL, &skill_dir.join("gate-result.json"));
            remove_file_logged(LABEL, &skill_dir.join("answer-evaluation.json"));
        }
        3 => {
            // Skill artifacts in skills_path
            let skill_output_dir = resolve_skill_dir(Path::new(skills_path), plugin_slug, skill_name);
            if skill_output_dir.exists() {
                for file in get_step_output_files(3) {
                    remove_file_logged(LABEL, &skill_output_dir.join(file));
                }
                remove_dir_logged(LABEL, &skill_output_dir.join("references"));
                remove_file_logged(
                    LABEL,
                    &skill_output_dir.join(format!("{}.skill", skill_name)),
                );
            }
            // Eval artifacts in workspace (eval-review.html is inside evals/)
            remove_dir_logged(LABEL, &skill_dir.join("evals"));
        }
        _ => {
            // Steps 1, 2: context files in workspace
            for file in get_step_output_files(step_id) {
                remove_file_logged(LABEL, &skill_dir.join(file));
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
    plugin_slug: &str,
    after_step: i32,
    skills_path: &str,
) {
    log::debug!(
        "[cleanup_future_steps] skill='{}': after_step={} workspace={} skills_path={}",
        skill_name,
        after_step,
        workspace_path,
        skills_path
    );
    for step_id in [0u32, 1, 2, 3] {
        if (step_id as i32) <= after_step {
            continue;
        }
        clean_step_output(workspace_path, skill_name, plugin_slug, step_id, skills_path);
    }
}

/// Delete output files for the given step and all subsequent steps.
pub fn delete_step_output_files(
    workspace_path: &str,
    skill_name: &str,
    plugin_slug: &str,
    from_step_id: u32,
    skills_path: &str,
) {
    log::debug!(
        "[delete_step_output_files] skill='{}': from_step={} workspace={} skills_path={}",
        skill_name,
        from_step_id,
        workspace_path,
        skills_path
    );
    for step_id in from_step_id..=3 {
        clean_step_output(workspace_path, skill_name, plugin_slug, step_id, skills_path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::workflow::get_step_output_files;
    use crate::skill_paths::DEFAULT_PLUGIN_SLUG;
    use std::path::Path;

    const SLUG: &str = DEFAULT_PLUGIN_SLUG;

    /// Create a skill working directory under the plugin-organised layout.
    fn create_skill_dir(workspace: &Path, name: &str, _domain: &str) {
        let skill_dir = workspace.join(SLUG).join(name);
        std::fs::create_dir_all(skill_dir.join("context")).unwrap();
    }

    /// Create step output files on disk for the given step (plugin-organised workspace).
    fn create_step_output(workspace: &Path, name: &str, step_id: u32) {
        let skill_dir = workspace.join(SLUG).join(name);
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
        // If reconciled to step 1, files from steps 2/3 should be cleaned up
        let tmp = tempfile::tempdir().unwrap();
        let skills_tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        let skills_path = skills_tmp.path().to_str().unwrap();
        create_skill_dir(tmp.path(), "my-skill", "test");

        // Create complete output for steps 0, 1, 2 in workspace context
        create_step_output(tmp.path(), "my-skill", 0);
        create_step_output(tmp.path(), "my-skill", 1);
        create_step_output(tmp.path(), "my-skill", 2);

        // Clean up everything after step 1
        cleanup_future_steps(workspace, "my-skill", SLUG, 1, skills_path);

        // Step 0 and 1 files should remain (clarifications.json from step 0)
        let skill_dir = tmp.path().join(SLUG).join("my-skill");
        assert!(skill_dir.join("context/clarifications.json").exists());

        // Step 2 files should be gone
        assert!(!skill_dir.join("context/decisions.json").exists());
    }

    #[test]
    fn test_delete_step1_preserves_step0_files() {
        // Regression for Bug 1: deleting from step 1 must not remove step 0 output.
        let tmp = tempfile::tempdir().unwrap();
        let skills_tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        let skills_path = skills_tmp.path().to_str().unwrap();
        create_skill_dir(tmp.path(), "my-skill", "test");

        // Create step 0 output (clarifications.json) and step 2 output (decisions.json)
        create_step_output(tmp.path(), "my-skill", 0);
        create_step_output(tmp.path(), "my-skill", 2);

        // Delete from step 1 onwards
        delete_step_output_files(workspace, "my-skill", SLUG, 1, skills_path);

        let skill_dir = tmp.path().join(SLUG).join("my-skill");
        // Step 0 file must survive
        assert!(skill_dir.join("context/clarifications.json").exists());
        // Step 2 file must be gone
        assert!(!skill_dir.join("context/decisions.json").exists());
    }

    #[test]
    fn test_delete_step0_deletes_all_artifacts() {
        // Deleting from step 0 must remove all files: context, gate, evaluation, skill, evals.
        let tmp = tempfile::tempdir().unwrap();
        let skills_tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        let skills_path = skills_tmp.path().to_str().unwrap();
        create_skill_dir(tmp.path(), "my-skill", "test");

        // Step 0 + workflow-level files
        create_step_output(tmp.path(), "my-skill", 0);
        let skill_dir = tmp.path().join(SLUG).join("my-skill");
        std::fs::write(skill_dir.join("gate-result.json"), "{}").unwrap();
        std::fs::write(skill_dir.join("answer-evaluation.json"), "{}").unwrap();

        // Step 2
        create_step_output(tmp.path(), "my-skill", 2);

        // Step 3 artifacts in canonical plugin layout
        let output_dir = skills_tmp.path().join(SLUG).join("my-skill");
        std::fs::create_dir_all(output_dir.join("references")).unwrap();
        std::fs::write(output_dir.join("SKILL.md"), "# Skill").unwrap();
        std::fs::create_dir_all(skill_dir.join("evals")).unwrap();
        std::fs::write(skill_dir.join("evals/evals.json"), "{}").unwrap();

        // Delete from step 0 onwards
        delete_step_output_files(workspace, "my-skill", SLUG, 0, skills_path);

        // Everything must be gone
        assert!(!skill_dir.join("context/clarifications.json").exists());
        assert!(!skill_dir.join("gate-result.json").exists());
        assert!(!skill_dir.join("answer-evaluation.json").exists());
        assert!(!skill_dir.join("context/decisions.json").exists());
        assert!(!output_dir.join("SKILL.md").exists());
        assert!(!output_dir.join("references").exists());
        assert!(!skill_dir.join("evals").exists());
    }

    #[test]
    fn test_clean_step_output_step1_is_noop() {
        // Step 1 has no unique output files, so clean_step_output for step 1 is a no-op.
        let tmp = tempfile::tempdir().unwrap();
        let skills_tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        let skills_path = skills_tmp.path().to_str().unwrap();
        create_skill_dir(tmp.path(), "my-skill", "test");

        // Create step 0 output file in skills_path legacy flat
        let sd = skills_tmp.path().join("my-skill");
        std::fs::create_dir_all(sd.join("context")).unwrap();
        for file in get_step_output_files(0) {
            let p = sd.join(file);
            if let Some(parent) = p.parent() { std::fs::create_dir_all(parent).unwrap(); }
            std::fs::write(&p, "# step 0").unwrap();
        }

        // Cleaning step 1 should leave step 0 files untouched
        clean_step_output(workspace, "my-skill", SLUG, 1, skills_path);

        assert!(sd.join("context/clarifications.json").exists());
    }

    #[test]
    fn test_clean_step3_deletes_evals_and_skill() {
        let tmp = tempfile::tempdir().unwrap();
        let skills_tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        let skills_path = skills_tmp.path().to_str().unwrap();

        // Create workspace dir with eval artifacts (eval-review.html is inside evals/)
        let skill_dir = tmp.path().join(SLUG).join("my-skill");
        std::fs::create_dir_all(skill_dir.join("evals")).unwrap();
        std::fs::write(skill_dir.join("evals/evals.json"), "{}").unwrap();
        std::fs::write(skill_dir.join("evals/eval-review.html"), "<html>").unwrap();

        // Create skill output dir with SKILL.md in canonical plugin layout
        let output_dir = skills_tmp.path().join(SLUG).join("my-skill");
        std::fs::create_dir_all(output_dir.join("references")).unwrap();
        std::fs::write(output_dir.join("SKILL.md"), "# Skill").unwrap();

        clean_step_output(workspace, "my-skill", SLUG, 3, skills_path);

        assert!(!skill_dir.join("evals").exists());
        assert!(!output_dir.join("SKILL.md").exists());
        assert!(!output_dir.join("references").exists());
    }

    #[test]
    fn test_clean_step0_deletes_gate_and_evaluation_files() {
        let tmp = tempfile::tempdir().unwrap();
        let skills_tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        let skills_path = skills_tmp.path().to_str().unwrap();

        let skill_dir = tmp.path().join(SLUG).join("my-skill");
        std::fs::create_dir_all(skill_dir.join("context")).unwrap();
        std::fs::write(skill_dir.join("context/clarifications.json"), "{}").unwrap();
        std::fs::write(skill_dir.join("gate-result.json"), "{}").unwrap();
        std::fs::write(skill_dir.join("answer-evaluation.json"), "{}").unwrap();

        clean_step_output(workspace, "my-skill", SLUG, 0, skills_path);

        assert!(!skill_dir.join("context/clarifications.json").exists());
        assert!(!skill_dir.join("gate-result.json").exists());
        assert!(!skill_dir.join("answer-evaluation.json").exists());
    }

    // ── list_step_output_files tests ──

    #[test]
    fn test_list_step0_returns_clarifications() {
        let tmp = tempfile::tempdir().unwrap();
        let skills_tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        let skills_path = skills_tmp.path().to_str().unwrap();

        create_step_output(tmp.path(), "my-skill", 0);

        let files = list_step_output_files(workspace, "my-skill", SLUG, 0, skills_path);
        assert!(files.contains(&"context/clarifications.json".to_string()));
    }

    #[test]
    fn test_list_step0_includes_gate_and_evaluation() {
        let tmp = tempfile::tempdir().unwrap();
        let skills_tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        let skills_path = skills_tmp.path().to_str().unwrap();

        let skill_dir = tmp.path().join(SLUG).join("my-skill");
        std::fs::create_dir_all(skill_dir.join("context")).unwrap();
        std::fs::write(skill_dir.join("context/clarifications.json"), "{}").unwrap();
        std::fs::write(skill_dir.join("gate-result.json"), "{}").unwrap();
        std::fs::write(skill_dir.join("answer-evaluation.json"), "{}").unwrap();

        let files = list_step_output_files(workspace, "my-skill", SLUG, 0, skills_path);
        assert!(files.contains(&"context/clarifications.json".to_string()));
        assert!(files.contains(&"gate-result.json".to_string()));
        assert!(files.contains(&"answer-evaluation.json".to_string()));
    }

    #[test]
    fn test_list_step1_returns_empty() {
        let tmp = tempfile::tempdir().unwrap();
        let skills_tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        let skills_path = skills_tmp.path().to_str().unwrap();

        create_skill_dir(tmp.path(), "my-skill", "test");

        let files = list_step_output_files(workspace, "my-skill", SLUG, 1, skills_path);
        assert!(files.is_empty());
    }

    #[test]
    fn test_list_step2_returns_decisions() {
        let tmp = tempfile::tempdir().unwrap();
        let skills_tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        let skills_path = skills_tmp.path().to_str().unwrap();

        create_step_output(tmp.path(), "my-skill", 2);

        let files = list_step_output_files(workspace, "my-skill", SLUG, 2, skills_path);
        assert_eq!(files, vec!["context/decisions.json"]);
    }

    #[test]
    fn test_list_step3_includes_all_artifacts() {
        let tmp = tempfile::tempdir().unwrap();
        let skills_tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        let skills_path = skills_tmp.path().to_str().unwrap();

        // Skill output in canonical plugin layout
        let output_dir = skills_tmp.path().join(SLUG).join("my-skill");
        std::fs::create_dir_all(output_dir.join("references")).unwrap();
        std::fs::write(output_dir.join("SKILL.md"), "# Skill").unwrap();
        std::fs::write(output_dir.join("references/foo.md"), "ref").unwrap();
        std::fs::write(output_dir.join("references/bar.md"), "ref").unwrap();
        std::fs::write(output_dir.join("my-skill.skill"), "zip").unwrap();

        // Eval artifacts in plugin-organised workspace
        let skill_dir = tmp.path().join(SLUG).join("my-skill");
        std::fs::create_dir_all(skill_dir.join("evals")).unwrap();
        std::fs::write(skill_dir.join("evals/evals.json"), "{}").unwrap();

        let files = list_step_output_files(workspace, "my-skill", SLUG, 3, skills_path);

        assert!(files.contains(&"SKILL.md".to_string()));
        assert!(files.contains(&"references/foo.md".to_string()));
        assert!(files.contains(&"references/bar.md".to_string()));
        assert!(files.contains(&"my-skill.skill".to_string()));
        assert!(files.contains(&"evals/".to_string()));
    }

    #[test]
    fn test_list_step3_without_evals_omits_them() {
        let tmp = tempfile::tempdir().unwrap();
        let skills_tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        let skills_path = skills_tmp.path().to_str().unwrap();

        // Only SKILL.md in canonical plugin layout, no evals
        let output_dir = skills_tmp.path().join(SLUG).join("my-skill");
        std::fs::create_dir_all(&output_dir).unwrap();
        std::fs::write(output_dir.join("SKILL.md"), "# Skill").unwrap();

        // Empty plugin-organised workspace dir
        std::fs::create_dir_all(tmp.path().join(SLUG).join("my-skill")).unwrap();

        let files = list_step_output_files(workspace, "my-skill", SLUG, 3, skills_path);

        assert_eq!(files, vec!["SKILL.md"]);
        assert!(!files.contains(&"evals/".to_string()));
    }

    // ── Pre-run cleanup contract tests ──
    // These verify the cleanup behavior when re-running each step,
    // matching the call in runtime.rs run_workflow_step().

    #[test]
    fn test_prerun_step0_deletes_own_output() {
        let tmp = tempfile::tempdir().unwrap();
        let skills_tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        let skills_path = skills_tmp.path().to_str().unwrap();

        // Step 0 produced clarifications.json + workflow-level files
        create_step_output(tmp.path(), "my-skill", 0);
        let skill_dir = tmp.path().join(SLUG).join("my-skill");
        std::fs::write(skill_dir.join("gate-result.json"), "{}").unwrap();
        std::fs::write(skill_dir.join("answer-evaluation.json"), "{}").unwrap();

        // Re-running step 0 should delete all of them
        clean_step_output(workspace, "my-skill", SLUG, 0, skills_path);
        assert!(!skill_dir.join("context/clarifications.json").exists());
        assert!(!skill_dir.join("gate-result.json").exists());
        assert!(!skill_dir.join("answer-evaluation.json").exists());
    }

    #[test]
    fn test_prerun_step1_preserves_clarifications() {
        // Step 1 edits clarifications.json in-place — re-running step 1
        // must NOT delete it, otherwise the agent has no input.
        let tmp = tempfile::tempdir().unwrap();
        let skills_tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        let skills_path = skills_tmp.path().to_str().unwrap();

        create_step_output(tmp.path(), "my-skill", 0); // clarifications.json
        create_step_output(tmp.path(), "my-skill", 2); // decisions.json

        let skill_dir = tmp.path().join(SLUG).join("my-skill");
        assert!(skill_dir.join("context/clarifications.json").exists());
        assert!(skill_dir.join("context/decisions.json").exists());

        // Re-running step 1 should not touch any files
        clean_step_output(workspace, "my-skill", SLUG, 1, skills_path);

        assert!(skill_dir.join("context/clarifications.json").exists());
        assert!(skill_dir.join("context/decisions.json").exists());
    }

    #[test]
    fn test_prerun_step2_deletes_decisions_preserves_clarifications() {
        let tmp = tempfile::tempdir().unwrap();
        let skills_tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        let skills_path = skills_tmp.path().to_str().unwrap();

        create_step_output(tmp.path(), "my-skill", 0); // clarifications.json
        create_step_output(tmp.path(), "my-skill", 2); // decisions.json

        let skill_dir = tmp.path().join(SLUG).join("my-skill");

        // Re-running step 2 should delete decisions.json but keep clarifications.json
        clean_step_output(workspace, "my-skill", SLUG, 2, skills_path);

        assert!(skill_dir.join("context/clarifications.json").exists());
        assert!(!skill_dir.join("context/decisions.json").exists());
    }

    #[test]
    fn test_prerun_step3_deletes_skill_and_evals_preserves_context() {
        let tmp = tempfile::tempdir().unwrap();
        let skills_tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        let skills_path = skills_tmp.path().to_str().unwrap();

        // Context files from earlier steps
        create_step_output(tmp.path(), "my-skill", 0);
        create_step_output(tmp.path(), "my-skill", 2);

        // Step 3 artifacts in canonical plugin layout
        let output_dir = skills_tmp.path().join(SLUG).join("my-skill");
        std::fs::create_dir_all(output_dir.join("references")).unwrap();
        std::fs::write(output_dir.join("SKILL.md"), "# Skill").unwrap();
        std::fs::write(output_dir.join("references/data-model.md"), "ref").unwrap();
        std::fs::write(output_dir.join("my-skill.skill"), "zip").unwrap();

        // Eval artifacts (eval-review.html is inside evals/)
        let skill_dir = tmp.path().join(SLUG).join("my-skill");
        std::fs::create_dir_all(skill_dir.join("evals/workspace")).unwrap();
        std::fs::write(skill_dir.join("evals/evals.json"), "{}").unwrap();
        std::fs::write(skill_dir.join("evals/eval-review.html"), "<html>").unwrap();

        // Re-running step 3 should delete all step 3 artifacts
        clean_step_output(workspace, "my-skill", SLUG, 3, skills_path);

        // Step 3 artifacts gone (evals/ dir removal covers eval-review.html inside it)
        assert!(!output_dir.join("SKILL.md").exists());
        assert!(!output_dir.join("references").exists());
        assert!(!output_dir.join("my-skill.skill").exists());
        assert!(!skill_dir.join("evals").exists());

        // Context files from earlier steps preserved
        assert!(skill_dir.join("context/clarifications.json").exists());
        assert!(skill_dir.join("context/decisions.json").exists());
    }

    #[test]
    fn test_list_step0_missing_files_returns_empty() {
        let tmp = tempfile::tempdir().unwrap();
        let skills_tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        let skills_path = skills_tmp.path().to_str().unwrap();

        // Create workspace dir but no output files
        create_skill_dir(tmp.path(), "my-skill", "test");

        let files = list_step_output_files(workspace, "my-skill", SLUG, 0, skills_path);
        assert!(files.is_empty());
    }
}
