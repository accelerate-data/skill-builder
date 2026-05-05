use crate::commands::workflow::get_step_output_files;
use crate::skill_paths::{
    resolve_existing_skill_dir, resolve_existing_workspace_skill_dir,
};
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
/// For step 3, checks skills_path for skill artifacts and tolerates legacy
/// workspace eval directories when present.
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
    let skill_dir =
        resolve_existing_workspace_skill_dir(Path::new(workspace_path), plugin_slug, skill_name);
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
            let skill_output_dir =
                resolve_existing_skill_dir(Path::new(skills_path), plugin_slug, skill_name);
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
                                    files.push(format!("references/{}", name.to_string_lossy()));
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

    let skill_dir =
        resolve_existing_workspace_skill_dir(Path::new(workspace_path), plugin_slug, skill_name);

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
            let skill_output_dir =
                resolve_existing_skill_dir(Path::new(skills_path), plugin_slug, skill_name);
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
            // Remove legacy workspace eval folders without treating any file name there
            // as part of the current step 3 contract.
            remove_dir_logged(LABEL, &skill_dir.join("evals"));
            // Remove git version tags so re-running step 3 can create 1.0.0 again.
            if let Err(e) = crate::git::delete_skill_version_tags(
                &skill_output_dir,
                plugin_slug,
                skill_name,
            ) {
                log::warn!(
                    "[{}] failed to delete git version tags for '{}': {}",
                    LABEL,
                    skill_name,
                    e
                );
            }
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
        clean_step_output(
            workspace_path,
            skill_name,
            plugin_slug,
            step_id,
            skills_path,
        );
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
        clean_step_output(
            workspace_path,
            skill_name,
            plugin_slug,
            step_id,
            skills_path,
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::workflow::get_step_output_files;
    use crate::skill_paths::{resolve_skill_dir, resolve_workspace_skill_dir, DEFAULT_PLUGIN_SLUG};
    use std::path::Path;

    const SLUG: &str = DEFAULT_PLUGIN_SLUG;

    /// Create a skill working directory under the plugin-organised layout.
    /// Workspace skill dirs contain only .agents/, logs/, and tmp/ (no context/).
    fn create_skill_dir(workspace: &Path, name: &str, _domain: &str) {
        let skill_dir = resolve_workspace_skill_dir(workspace, SLUG, name);
        std::fs::create_dir_all(&skill_dir).unwrap();
    }

    /// Create step output files on disk for the given step using the canonical
    /// workspace layout for steps 0-2 and the canonical skill output layout for step 3.
    fn create_step_output(root: &Path, name: &str, step_id: u32) {
        let skill_dir = if step_id == 3 {
            resolve_skill_dir(root, SLUG, name)
        } else {
            resolve_workspace_skill_dir(root, SLUG, name)
        };
        std::fs::create_dir_all(&skill_dir).unwrap();
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
        // Steps 0-2 are DB-authoritative and have no filesystem outputs.
        // If reconciled to step 1, only step 3 (SKILL.md) should be cleaned up.
        let tmp = tempfile::tempdir().unwrap();
        let skills_tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        let skills_path = skills_tmp.path().to_str().unwrap();
        create_skill_dir(tmp.path(), "my-skill", "test");

        // Create step 3 output (SKILL.md) in skills_path
        create_step_output(skills_tmp.path(), "my-skill", 3);

        // Clean up everything after step 1
        cleanup_future_steps(workspace, "my-skill", SLUG, 1, skills_path);

        // Step 3 SKILL.md should be gone
        let output_dir = resolve_skill_dir(skills_tmp.path(), SLUG, "my-skill");
        assert!(!output_dir.join("SKILL.md").exists());
    }

    #[test]
    fn test_delete_step1_cleans_step3_only() {
        // Steps 0-2 are DB-authoritative with no filesystem outputs.
        // Deleting from step 1 onwards should clean only step 3 (SKILL.md).
        let tmp = tempfile::tempdir().unwrap();
        let skills_tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        let skills_path = skills_tmp.path().to_str().unwrap();
        create_skill_dir(tmp.path(), "my-skill", "test");

        // Step 3 output
        create_step_output(skills_tmp.path(), "my-skill", 3);

        // Delete from step 1 onwards
        delete_step_output_files(workspace, "my-skill", SLUG, 1, skills_path);

        // Step 3 SKILL.md must be gone
        let output_dir = resolve_skill_dir(skills_tmp.path(), SLUG, "my-skill");
        assert!(!output_dir.join("SKILL.md").exists());
    }

    #[test]
    fn test_delete_step0_deletes_all_artifacts() {
        // Deleting from step 0 must remove all files: gate, evaluation, skill, evals.
        // Steps 0-2 are DB-authoritative — clarifications/decisions have no filesystem form.
        let tmp = tempfile::tempdir().unwrap();
        let skills_tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        let skills_path = skills_tmp.path().to_str().unwrap();
        create_skill_dir(tmp.path(), "my-skill", "test");

        // Step 0 workflow-level files
        let skill_dir = resolve_workspace_skill_dir(tmp.path(), SLUG, "my-skill");
        std::fs::write(skill_dir.join("gate-result.json"), "{}").unwrap();
        std::fs::write(skill_dir.join("answer-evaluation.json"), "{}").unwrap();

        // Step 3 artifacts in canonical plugin layout
        let output_dir = resolve_skill_dir(skills_tmp.path(), SLUG, "my-skill");
        std::fs::create_dir_all(output_dir.join("references")).unwrap();
        std::fs::write(output_dir.join("SKILL.md"), "# Skill").unwrap();
        std::fs::create_dir_all(skill_dir.join("evals")).unwrap();
        std::fs::write(skill_dir.join("evals/eval-review.html"), "<html>").unwrap();

        // Delete from step 0 onwards
        delete_step_output_files(workspace, "my-skill", SLUG, 0, skills_path);

        // Everything must be gone
        assert!(!skill_dir.join("gate-result.json").exists());
        assert!(!skill_dir.join("answer-evaluation.json").exists());
        assert!(!output_dir.join("SKILL.md").exists());
        assert!(!output_dir.join("references").exists());
        assert!(!skill_dir.join("evals").exists());
    }

    #[test]
    fn test_clean_step_output_step1_is_noop() {
        // Steps 0-2 are DB-authoritative with no filesystem outputs.
        // Step 1 has no unique output files, so clean_step_output for step 1 is a no-op.
        // Verify it does not delete SKILL.md (step 3 artifact) as a side effect.
        let tmp = tempfile::tempdir().unwrap();
        let skills_tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        let skills_path = skills_tmp.path().to_str().unwrap();
        create_skill_dir(tmp.path(), "my-skill", "test");

        // Create step 3 output (SKILL.md) in skills_path
        create_step_output(skills_tmp.path(), "my-skill", 3);

        // Cleaning step 1 should not remove SKILL.md
        clean_step_output(workspace, "my-skill", SLUG, 1, skills_path);

        let output_dir = resolve_skill_dir(skills_tmp.path(), SLUG, "my-skill");
        assert!(output_dir.join("SKILL.md").exists());
    }

    #[test]
    fn test_clean_step3_deletes_evals_and_skill() {
        let tmp = tempfile::tempdir().unwrap();
        let skills_tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        let skills_path = skills_tmp.path().to_str().unwrap();

        // Create a legacy workspace eval folder.
        let skill_dir = resolve_workspace_skill_dir(tmp.path(), SLUG, "my-skill");
        std::fs::create_dir_all(skill_dir.join("evals")).unwrap();
        std::fs::write(skill_dir.join("evals/eval-review.html"), "<html>").unwrap();

        // Create skill output dir with SKILL.md in canonical plugin layout
        let output_dir = resolve_skill_dir(skills_tmp.path(), SLUG, "my-skill");
        std::fs::create_dir_all(output_dir.join("references")).unwrap();
        std::fs::write(output_dir.join("SKILL.md"), "# Skill").unwrap();

        clean_step_output(workspace, "my-skill", SLUG, 3, skills_path);

        assert!(!skill_dir.join("evals").exists());
        assert!(!output_dir.join("SKILL.md").exists());
        assert!(!output_dir.join("references").exists());
    }

    #[test]
    fn test_clean_step0_deletes_gate_and_evaluation_files() {
        // Step 0 cleanup removes workflow-level gate and evaluation files.
        // Clarifications are DB-authoritative and have no filesystem representation.
        let tmp = tempfile::tempdir().unwrap();
        let skills_tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        let skills_path = skills_tmp.path().to_str().unwrap();

        let skill_dir = resolve_workspace_skill_dir(tmp.path(), SLUG, "my-skill");
        std::fs::create_dir_all(&skill_dir).unwrap();
        std::fs::write(skill_dir.join("gate-result.json"), "{}").unwrap();
        std::fs::write(skill_dir.join("answer-evaluation.json"), "{}").unwrap();

        clean_step_output(workspace, "my-skill", SLUG, 0, skills_path);

        assert!(!skill_dir.join("gate-result.json").exists());
        assert!(!skill_dir.join("answer-evaluation.json").exists());
    }

    // ── list_step_output_files tests ──

    #[test]
    fn test_list_step0_returns_empty_without_gate_files() {
        // Steps 0-2 are DB-authoritative. Step 0 has no filesystem outputs
        // unless gate-result.json or answer-evaluation.json are present.
        let tmp = tempfile::tempdir().unwrap();
        let skills_tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        let skills_path = skills_tmp.path().to_str().unwrap();

        create_skill_dir(tmp.path(), "my-skill", "test");

        let files = list_step_output_files(workspace, "my-skill", SLUG, 0, skills_path);
        assert!(
            files.is_empty(),
            "step 0 should list no files without gate artifacts"
        );
    }

    #[test]
    fn test_list_step0_includes_gate_and_evaluation() {
        // Step 0 lists gate-result.json and answer-evaluation.json when present.
        // Clarifications are DB-authoritative and not listed as filesystem outputs.
        let tmp = tempfile::tempdir().unwrap();
        let skills_tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        let skills_path = skills_tmp.path().to_str().unwrap();

        let skill_dir = resolve_workspace_skill_dir(tmp.path(), SLUG, "my-skill");
        std::fs::create_dir_all(&skill_dir).unwrap();
        std::fs::write(skill_dir.join("gate-result.json"), "{}").unwrap();
        std::fs::write(skill_dir.join("answer-evaluation.json"), "{}").unwrap();

        let files = list_step_output_files(workspace, "my-skill", SLUG, 0, skills_path);
        assert!(!files.contains(&"context/clarifications.json".to_string()));
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
    fn test_list_step2_returns_empty() {
        // Step 2 decisions are DB-authoritative with no filesystem representation.
        let tmp = tempfile::tempdir().unwrap();
        let skills_tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        let skills_path = skills_tmp.path().to_str().unwrap();

        create_skill_dir(tmp.path(), "my-skill", "test");

        let files = list_step_output_files(workspace, "my-skill", SLUG, 2, skills_path);
        assert!(files.is_empty(), "step 2 should list no filesystem outputs");
    }

    #[test]
    fn test_list_step3_includes_all_artifacts() {
        let tmp = tempfile::tempdir().unwrap();
        let skills_tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        let skills_path = skills_tmp.path().to_str().unwrap();

        // Skill output in canonical plugin layout
        let output_dir = resolve_skill_dir(skills_tmp.path(), SLUG, "my-skill");
        std::fs::create_dir_all(output_dir.join("references")).unwrap();
        std::fs::write(output_dir.join("SKILL.md"), "# Skill").unwrap();
        std::fs::write(output_dir.join("references/foo.md"), "ref").unwrap();
        std::fs::write(output_dir.join("references/bar.md"), "ref").unwrap();
        std::fs::write(output_dir.join("my-skill.skill"), "zip").unwrap();

        // Legacy eval folder in plugin-organised workspace.
        let skill_dir = resolve_workspace_skill_dir(tmp.path(), SLUG, "my-skill");
        std::fs::create_dir_all(skill_dir.join("evals")).unwrap();
        std::fs::write(skill_dir.join("evals/legacy-case.json"), "{}").unwrap();

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
        let output_dir = resolve_skill_dir(skills_tmp.path(), SLUG, "my-skill");
        std::fs::create_dir_all(&output_dir).unwrap();
        std::fs::write(output_dir.join("SKILL.md"), "# Skill").unwrap();

        // Empty plugin-organised workspace dir
        std::fs::create_dir_all(resolve_workspace_skill_dir(tmp.path(), SLUG, "my-skill")).unwrap();

        let files = list_step_output_files(workspace, "my-skill", SLUG, 3, skills_path);

        assert_eq!(files, vec!["SKILL.md"]);
        assert!(!files.contains(&"evals/".to_string()));
    }

    // ── Pre-run cleanup contract tests ──
    // These verify the cleanup behavior when re-running each step,
    // matching the call in runtime.rs run_workflow_step().

    #[test]
    fn test_prerun_step0_deletes_own_output() {
        // Re-running step 0 deletes gate-result.json and answer-evaluation.json.
        // Clarifications are DB-authoritative and have no filesystem representation.
        let tmp = tempfile::tempdir().unwrap();
        let skills_tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        let skills_path = skills_tmp.path().to_str().unwrap();

        // Step 0 workflow-level files
        let skill_dir = resolve_workspace_skill_dir(tmp.path(), SLUG, "my-skill");
        std::fs::create_dir_all(&skill_dir).unwrap();
        std::fs::write(skill_dir.join("gate-result.json"), "{}").unwrap();
        std::fs::write(skill_dir.join("answer-evaluation.json"), "{}").unwrap();

        // Re-running step 0 should delete them
        clean_step_output(workspace, "my-skill", SLUG, 0, skills_path);
        assert!(!skill_dir.join("gate-result.json").exists());
        assert!(!skill_dir.join("answer-evaluation.json").exists());
    }

    #[test]
    fn test_prerun_step1_is_noop() {
        // Steps 0-2 are DB-authoritative. Step 1 has no unique filesystem output.
        // Re-running step 1 must not delete SKILL.md (step 3 artifact in skills_path).
        let tmp = tempfile::tempdir().unwrap();
        let skills_tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        let skills_path = skills_tmp.path().to_str().unwrap();

        // Create SKILL.md in skills_path (step 3 output)
        create_step_output(skills_tmp.path(), "my-skill", 3);
        let output_dir = resolve_skill_dir(skills_tmp.path(), SLUG, "my-skill");
        assert!(output_dir.join("SKILL.md").exists());

        // Re-running step 1 should not touch any files
        clean_step_output(workspace, "my-skill", SLUG, 1, skills_path);

        assert!(output_dir.join("SKILL.md").exists());
    }

    #[test]
    fn test_prerun_step2_is_noop() {
        // Steps 0-2 are DB-authoritative. Step 2 decisions have no filesystem representation.
        // Re-running step 2 must not delete SKILL.md (step 3 artifact in skills_path).
        let tmp = tempfile::tempdir().unwrap();
        let skills_tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        let skills_path = skills_tmp.path().to_str().unwrap();

        // Create SKILL.md in skills_path (step 3 output)
        create_step_output(skills_tmp.path(), "my-skill", 3);
        let output_dir = resolve_skill_dir(skills_tmp.path(), SLUG, "my-skill");
        assert!(output_dir.join("SKILL.md").exists());

        // Re-running step 2 should not delete SKILL.md
        clean_step_output(workspace, "my-skill", SLUG, 2, skills_path);

        assert!(output_dir.join("SKILL.md").exists());
    }

    #[test]
    fn test_prerun_step3_deletes_skill_and_evals() {
        // Re-running step 3 deletes SKILL.md, references/, skill zip, and evals/.
        // Steps 0-2 are DB-authoritative with no filesystem context to preserve.
        let tmp = tempfile::tempdir().unwrap();
        let skills_tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        let skills_path = skills_tmp.path().to_str().unwrap();

        // Step 3 artifacts in canonical plugin layout
        let output_dir = resolve_skill_dir(skills_tmp.path(), SLUG, "my-skill");
        std::fs::create_dir_all(output_dir.join("references")).unwrap();
        std::fs::write(output_dir.join("SKILL.md"), "# Skill").unwrap();
        std::fs::write(output_dir.join("references/data-model.md"), "ref").unwrap();
        std::fs::write(output_dir.join("my-skill.skill"), "zip").unwrap();

        // Legacy eval folder content.
        let skill_dir = resolve_workspace_skill_dir(tmp.path(), SLUG, "my-skill");
        std::fs::create_dir_all(skill_dir.join("evals/workspace")).unwrap();
        std::fs::write(skill_dir.join("evals/workspace/results.json"), "{}").unwrap();
        std::fs::write(skill_dir.join("evals/eval-review.html"), "<html>").unwrap();

        // Re-running step 3 should delete all step 3 artifacts
        clean_step_output(workspace, "my-skill", SLUG, 3, skills_path);

        // Step 3 artifacts gone (evals/ dir removal covers eval-review.html inside it)
        assert!(!output_dir.join("SKILL.md").exists());
        assert!(!output_dir.join("references").exists());
        assert!(!output_dir.join("my-skill.skill").exists());
        assert!(!skill_dir.join("evals").exists());
    }

    #[test]
    fn test_clean_step3_deletes_git_version_tags() {
        // Verifies that resetting step 3 removes the 1.0.0 git tag so the next
        // run of step 3 can create it again without a collision.
        let tmp = tempfile::tempdir().unwrap();
        let skills_tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        let skills_path = skills_tmp.path().to_str().unwrap();

        // Set up a per-skill git repo, write SKILL.md and commit it.
        let skill_dir =
            crate::skill_paths::resolve_skill_dir(skills_tmp.path(), SLUG, "my-skill");
        std::fs::create_dir_all(&skill_dir).unwrap();
        crate::git::ensure_repo(&skill_dir).unwrap();
        std::fs::write(skill_dir.join("SKILL.md"), "# Skill").unwrap();
        crate::git::commit_all(&skill_dir, "generated skill").unwrap();
        crate::git::create_skill_version_tag(&skill_dir, SLUG, "my-skill", "1.0.0").unwrap();
        assert!(crate::git::skill_version_tag_exists(&skill_dir, SLUG, "my-skill", "1.0.0").unwrap());

        clean_step_output(workspace, "my-skill", SLUG, 3, skills_path);

        assert!(!crate::git::skill_version_tag_exists(&skill_dir, SLUG, "my-skill", "1.0.0").unwrap());
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
