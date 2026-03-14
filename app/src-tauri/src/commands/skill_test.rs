use std::path::{Path, PathBuf};

use crate::commands::imported_skills::validate_skill_name;
use crate::db::{self, Db};

#[derive(serde::Serialize)]
pub struct PrepareResult {
    pub test_id: String,
    pub baseline_cwd: String,
    pub with_skill_cwd: String,
    pub transcript_log_dir: String,
}

/// Resolve the bundled `agent-sources/workspace/` directory.
/// Dev mode: `{CARGO_MANIFEST_DIR}/../../agent-sources/workspace/`.
/// Production: Tauri resource directory `agent-sources/workspace/`.
fn resolve_bundled_workspace_dir(app_handle: &tauri::AppHandle) -> PathBuf {
    use tauri::Manager;

    let repo_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|p| p.parent())
        .map(|p| p.to_path_buf());

    let dev_path = repo_root
        .as_ref()
        .map(|r| r.join("agent-sources").join("workspace"));

    match dev_path {
        Some(ref p) if p.is_dir() => p.clone(),
        _ => app_handle
            .path()
            .resource_dir()
            .map(|r| r.join("agent-sources").join("workspace"))
            .unwrap_or_default(),
    }
}

/// Copy `CLAUDE-MINIMAL.md` from the bundled workspace directory into `dest_workspace_dir`
/// as `CLAUDE.md`. Falls back to an empty file with a warning if the source is absent.
fn copy_minimal_claude_md(
    src_workspace_dir: &Path,
    dest_workspace_dir: &Path,
    label: &str,
) -> Result<(), String> {
    std::fs::create_dir_all(dest_workspace_dir).map_err(|e| {
        log::error!(
            "[prepare_skill_test] Failed to create {} workspace dir: {}",
            label,
            e
        );
        format!("Failed to create {} workspace: {}", label, e)
    })?;
    let src = src_workspace_dir.join("CLAUDE-MINIMAL.md");
    let dest = dest_workspace_dir.join("CLAUDE.md");
    if src.exists() {
        std::fs::copy(&src, &dest).map_err(|e| {
            log::error!(
                "[prepare_skill_test] Failed to copy CLAUDE-MINIMAL.md to {} workspace: {}",
                label,
                e
            );
            format!(
                "Failed to copy CLAUDE-MINIMAL.md to {} workspace: {}",
                label, e
            )
        })?;
    } else {
        log::warn!(
            "[prepare_skill_test] CLAUDE-MINIMAL.md not found at {:?}; writing empty fallback for {} workspace",
            src,
            label
        );
        std::fs::write(&dest, "").map_err(|e| {
            log::error!(
                "[prepare_skill_test] Failed to write fallback {} CLAUDE.md: {}",
                label,
                e
            );
            format!("Failed to write fallback {} CLAUDE.md: {}", label, e)
        })?;
    }
    Ok(())
}

/// Copy a named plugin from `src_plugins_dir/{plugin_name}/` into
/// `dest_workspace_dir/.claude/plugins/{plugin_name}/`.
///
/// Gracefully no-ops (with a `warn!`) if the source plugin directory does not exist,
/// so test runs still work in environments where the plugin is absent.
fn copy_plugin_into_workspace(
    src_plugins_dir: &Path,
    dest_workspace_dir: &Path,
    plugin_name: &str,
) -> Result<(), String> {
    let src = src_plugins_dir.join(plugin_name);
    if !src.is_dir() {
        log::warn!(
            "[copy_plugin_into_workspace] plugin '{}' not found at {:?}; skipping",
            plugin_name,
            src
        );
        return Ok(());
    }
    let dest = dest_workspace_dir
        .join(".claude")
        .join("plugins")
        .join(plugin_name);
    std::fs::create_dir_all(&dest).map_err(|e| {
        let msg = format!("Failed to create plugin dir {:?}: {}", dest, e);
        log::error!("[copy_plugin_into_workspace] {}", msg);
        msg
    })?;
    super::imported_skills::copy_dir_recursive(&src, &dest).map_err(|e| {
        log::error!(
            "[copy_plugin_into_workspace] failed to copy plugin '{}': {}",
            plugin_name,
            e
        );
        e
    })
}

/// Recursively copy a skill directory into `dest_skills_dir/{skill_name}/`.
/// Creates `dest_skills_dir` and the destination subdirectory if they don't exist.
fn copy_skill_dir(
    src_skills_dir: &Path,
    dest_skills_dir: &Path,
    skill_name: &str,
) -> Result<(), String> {
    let src = src_skills_dir.join(skill_name);
    let dest = dest_skills_dir.join(skill_name);
    std::fs::create_dir_all(&dest).map_err(|e| {
        let msg = format!("Failed to create skills dir {:?}: {}", dest, e);
        log::error!("[copy_skill_dir] {}", msg);
        msg
    })?;
    super::imported_skills::copy_dir_recursive(&src, &dest).map_err(|e| {
        log::error!(
            "[copy_skill_dir] Failed to copy skill '{}': {}",
            skill_name,
            e
        );
        e
    })
}

/// Prepare isolated temp workspaces for a skill test run.
///
/// Creates TWO temp dirs:
/// - `baseline_cwd`: skill-test context only (no user skill)
/// - `with_skill_cwd`: skill-test context + user skill
///
/// Both contain a root `CLAUDE.md` and `.claude/skills/skill-test/` so agents
/// pick up skill context automatically via the SDK's workspace loading.
#[tauri::command]
pub fn prepare_skill_test(
    app: tauri::AppHandle,
    workspace_path: String,
    skill_name: String,
    db: tauri::State<'_, Db>,
) -> Result<PrepareResult, String> {
    log::info!(
        "[prepare_skill_test] skill={} workspace_path={}",
        skill_name,
        workspace_path
    );

    validate_skill_name(&skill_name)?;

    // Resolve skills_path from DB (falls back to workspace_path if not configured)
    // Also look up the purpose-based "test-context" skill if one is configured.
    let (skills_path, test_context_skill) = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let settings = db::read_settings(&conn)?;
        let sp = settings
            .skills_path
            .unwrap_or_else(|| workspace_path.clone());
        let tc = crate::db::get_imported_skill_by_purpose(&conn, "test-context").map_err(|e| {
            log::error!(
                "[prepare_skill_test] failed to query test-context skill: {}",
                e
            );
            e.to_string()
        })?;
        (sp, tc)
    };

    let test_id = uuid::Uuid::new_v4().to_string();
    let tmp_parent = std::env::temp_dir().join(format!("skill-builder-test-{}", test_id));

    let baseline_dir = tmp_parent.join("baseline");
    let with_skill_dir = tmp_parent.join("with-skill");

    // Copy CLAUDE-MINIMAL.md from bundled workspace sources into both test workspaces.
    // The live workspace CLAUDE.md carries skill-builder identity framing ("This workspace
    // generates skills…") which confuses the data-product-builder agent. The minimal file
    // gives the agent a neutral data engineering project context instead.
    let bundled_workspace_dir = resolve_bundled_workspace_dir(&app);
    copy_minimal_claude_md(&bundled_workspace_dir, &baseline_dir, "baseline")?;
    copy_minimal_claude_md(&bundled_workspace_dir, &with_skill_dir, "with-skill")?;

    let baseline_skills_dir = baseline_dir.join(".claude").join("skills");
    let with_skill_skills_dir = with_skill_dir.join(".claude").join("skills");

    // Resolve skill-test source: prefer purpose-based workspace skill, fall back to bundled
    if let Some(ref tc_skill) = test_context_skill {
        let tc_path = std::path::Path::new(&tc_skill.disk_path);
        log::debug!(
            "[prepare_skill_test] using test-context workspace skill from {}",
            tc_skill.disk_path
        );
        // Copy the test-context skill into both workspaces as "skill-test"
        for (label, dest_dir) in [
            ("baseline", &baseline_skills_dir),
            ("with-skill", &with_skill_skills_dir),
        ] {
            let dest = dest_dir.join("skill-test");
            std::fs::create_dir_all(&dest)
                .map_err(|e| format!("Failed to create {} skill-test dir: {}", label, e))?;
            super::imported_skills::copy_dir_recursive(tc_path, &dest).map_err(|e| {
                log::error!(
                    "[prepare_skill_test] failed to copy test-context to {}: {}",
                    label,
                    e
                );
                e
            })?;
        }
        log::info!("[prepare_skill_test] copied skill-test from test-context workspace skill");
    } else {
        // Fallback: copy from bundled resources
        let bundled_skills_dir = super::workflow::resolve_bundled_skills_dir(&app);
        log::debug!(
            "[prepare_skill_test] using bundled skill-test from {}",
            bundled_skills_dir.display()
        );
        log::info!("[prepare_skill_test] copying skill-test into baseline workspace");
        copy_skill_dir(&bundled_skills_dir, &baseline_skills_dir, "skill-test")?;

        log::info!("[prepare_skill_test] copying skill-test into with-skill workspace");
        copy_skill_dir(&bundled_skills_dir, &with_skill_skills_dir, "skill-test")?;
    }

    // User skill is in skills_path (may differ from workspace_path when custom skills dir is configured)
    // User skills live in skills_path; bundled skills (like skill-test) live in workspace_path/.claude/skills/
    log::info!(
        "[prepare_skill_test] copying skill '{}' into with-skill workspace",
        skill_name
    );
    copy_skill_dir(Path::new(&skills_path), &with_skill_skills_dir, &skill_name)?;

    // Install vd-agent plugin into both workspaces so agents run with the plugin as base context.
    // The sidecar discovers plugins from {cwd}/.claude/plugins/ and passes each as --plugin-dir.
    let bundled_plugins_dir = super::workflow::resolve_bundled_plugins_dir(&app);
    log::info!(
        "[prepare_skill_test] plugin_src={:?} baseline_dir={:?} with_skill_dir={:?}",
        bundled_plugins_dir.join("vd-agent"),
        baseline_dir,
        with_skill_dir
    );
    copy_plugin_into_workspace(&bundled_plugins_dir, &baseline_dir, "vd-agent")?;
    copy_plugin_into_workspace(&bundled_plugins_dir, &with_skill_dir, "vd-agent")?;

    // Append skill @-import to with-skill CLAUDE.md so the data-product-builder agent
    // receives skill context in the with-skill run only.
    {
        use std::io::Write;
        let with_skill_claude_md = with_skill_dir.join("CLAUDE.md");
        let skill_ref = format!("\n@.claude/skills/{}/SKILL.md\n", skill_name);
        std::fs::OpenOptions::new()
            .append(true)
            .open(&with_skill_claude_md)
            .and_then(|mut f| f.write_all(skill_ref.as_bytes()))
            .map_err(|e| {
                log::error!(
                    "[prepare_skill_test] failed to append skill ref to CLAUDE.md: {}",
                    e
                );
                format!("Failed to append skill ref to with-skill CLAUDE.md: {}", e)
            })?;
    }
    log::info!(
        "[prepare_skill_test] with-skill CLAUDE.md updated with skill ref for '{}'",
        skill_name
    );

    let transcript_log_dir = Path::new(&workspace_path)
        .join(&skill_name)
        .join("logs")
        .to_string_lossy()
        .to_string();
    let baseline_cwd = baseline_dir.to_string_lossy().to_string();
    let with_skill_cwd = with_skill_dir.to_string_lossy().to_string();

    log::info!(
        "[prepare_skill_test] test_id={} skill={} baseline_cwd={} with_skill_cwd={}",
        test_id,
        skill_name,
        baseline_cwd,
        with_skill_cwd
    );

    Ok(PrepareResult {
        test_id,
        baseline_cwd,
        with_skill_cwd,
        transcript_log_dir,
    })
}

/// Clean up the temp workspaces created by `prepare_skill_test`.
/// Both baseline and with-skill dirs share a common parent, so we remove the parent.
#[tauri::command]
pub fn cleanup_skill_test(test_id: String) -> Result<(), String> {
    let tmp_parent = std::env::temp_dir().join(format!("skill-builder-test-{}", test_id));
    if tmp_parent.exists() {
        std::fs::remove_dir_all(&tmp_parent).map_err(|e| {
            log::warn!("[cleanup_skill_test] Failed to remove temp dir: {}", e);
            format!("Failed to clean up temp workspace: {}", e)
        })?;
        log::info!("[cleanup_skill_test] test_id={} cleaned up", test_id);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cleanup_nonexistent_is_ok() {
        // Cleaning up a non-existent test should succeed silently
        cleanup_skill_test("nonexistent-id".to_string()).unwrap();
    }

    #[test]
    fn test_copy_skill_dir_copies_files() {
        let tmp = std::env::temp_dir().join(format!("skill-test-copy-{}", uuid::Uuid::new_v4()));
        let src_skills = tmp.join("src");
        let skill_dir = src_skills.join("my-skill");
        std::fs::create_dir_all(&skill_dir).unwrap();
        std::fs::write(skill_dir.join("SKILL.md"), "# My Skill").unwrap();

        let dest_skills = tmp.join("dest");
        copy_skill_dir(&src_skills, &dest_skills, "my-skill").unwrap();

        assert!(dest_skills.join("my-skill").join("SKILL.md").exists());
        let content =
            std::fs::read_to_string(dest_skills.join("my-skill").join("SKILL.md")).unwrap();
        assert_eq!(content, "# My Skill");

        // Cleanup
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn test_copy_skill_dir_missing_source() {
        let tmp = std::env::temp_dir().join(format!("skill-test-missing-{}", uuid::Uuid::new_v4()));
        let result = copy_skill_dir(&tmp.join("nonexistent"), &tmp.join("dest"), "my-skill");
        assert!(result.is_err());
    }

    /// Resolve the bundled plugins directory the same way resolve_bundled_plugins_dir() does
    /// in dev mode, without requiring an AppHandle.
    fn dev_plugins_dir() -> std::path::PathBuf {
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("src-tauri → app")
            .parent()
            .expect("app → repo root")
            .join("agent-sources")
            .join("plugins")
    }

    #[test]
    fn test_copy_plugin_into_workspace_copies_real_vd_agent() {
        let plugins_dir = dev_plugins_dir();
        let tmp = std::env::temp_dir().join(format!("skill-test-plugin-{}", uuid::Uuid::new_v4()));

        copy_plugin_into_workspace(&plugins_dir, &tmp, "vd-agent").unwrap();

        // plugin.json must be present
        assert!(
            tmp.join(".claude")
                .join("plugins")
                .join("vd-agent")
                .join(".claude-plugin")
                .join("plugin.json")
                .exists(),
            "plugin.json not found after copy"
        );
        // data-product-builder agent must be present
        assert!(
            tmp.join(".claude")
                .join("plugins")
                .join("vd-agent")
                .join("agents")
                .join("data-product-builder.md")
                .exists(),
            "data-product-builder.md not found after copy"
        );

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn test_copy_plugin_into_workspace_graceful_skip_when_missing() {
        let plugins_dir = dev_plugins_dir();
        let tmp =
            std::env::temp_dir().join(format!("skill-test-plugin-skip-{}", uuid::Uuid::new_v4()));

        // "does-not-exist" is not a real plugin
        let result = copy_plugin_into_workspace(&plugins_dir, &tmp, "does-not-exist");
        assert!(
            result.is_ok(),
            "should succeed gracefully when plugin is missing"
        );
        assert!(
            !tmp.join(".claude")
                .join("plugins")
                .join("does-not-exist")
                .exists(),
            "dest dir should not be created when plugin is missing"
        );

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn test_copy_plugin_leaves_sibling_plugins_untouched() {
        let plugins_dir = dev_plugins_dir();
        let tmp =
            std::env::temp_dir().join(format!("skill-test-plugin-sib-{}", uuid::Uuid::new_v4()));

        // Create a pre-existing sibling plugin
        let sibling = tmp.join(".claude").join("plugins").join("other-plugin");
        std::fs::create_dir_all(&sibling).unwrap();
        std::fs::write(sibling.join("file.txt"), "keep me").unwrap();

        copy_plugin_into_workspace(&plugins_dir, &tmp, "vd-agent").unwrap();

        // Sibling must still be intact
        assert!(
            sibling.join("file.txt").exists(),
            "sibling plugin should be untouched"
        );

        let _ = std::fs::remove_dir_all(&tmp);
    }

    /// Resolve the bundled workspace directory the same way resolve_bundled_workspace_dir()
    /// does in dev mode, without requiring an AppHandle.
    fn dev_workspace_dir() -> std::path::PathBuf {
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("src-tauri → app")
            .parent()
            .expect("app → repo root")
            .join("agent-sources")
            .join("workspace")
    }

    #[test]
    fn test_bundled_claude_minimal_exists_and_has_expected_content() {
        let workspace_dir = dev_workspace_dir();
        let minimal = workspace_dir.join("CLAUDE-MINIMAL.md");
        assert!(
            minimal.exists(),
            "CLAUDE-MINIMAL.md not found at {:?}",
            minimal
        );
        let content = std::fs::read_to_string(&minimal).unwrap();
        assert!(
            content.contains("Medallion"),
            "CLAUDE-MINIMAL.md should contain medallion layer content"
        );
        assert!(
            !content.contains("Skill Builder"),
            "CLAUDE-MINIMAL.md must not contain skill-builder identity framing"
        );
    }

    #[test]
    fn test_copy_minimal_claude_md_copies_content() {
        let workspace_dir = dev_workspace_dir();
        let tmp = std::env::temp_dir().join(format!("skill-test-minimal-{}", uuid::Uuid::new_v4()));

        copy_minimal_claude_md(&workspace_dir, &tmp, "baseline").unwrap();

        let dest = tmp.join("CLAUDE.md");
        assert!(dest.exists(), "CLAUDE.md not created in dest workspace");
        let content = std::fs::read_to_string(&dest).unwrap();
        assert!(
            content.contains("Medallion"),
            "copied CLAUDE.md should contain minimal project content"
        );
        assert!(
            !content.contains("@.claude/skills/"),
            "minimal CLAUDE.md must not contain skill ref"
        );
        assert!(
            !content.contains("Skill Builder"),
            "minimal CLAUDE.md must not contain skill-builder identity framing"
        );

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn test_copy_minimal_claude_md_fallback_when_missing() {
        let tmp =
            std::env::temp_dir().join(format!("skill-test-minimal-fb-{}", uuid::Uuid::new_v4()));
        let fake_workspace = tmp.join("fake-workspace");
        std::fs::create_dir_all(&fake_workspace).unwrap();
        // No CLAUDE-MINIMAL.md in fake_workspace

        let dest_workspace = tmp.join("dest");
        copy_minimal_claude_md(&fake_workspace, &dest_workspace, "baseline").unwrap();

        let dest = dest_workspace.join("CLAUDE.md");
        assert!(dest.exists(), "fallback CLAUDE.md should be created");
        let content = std::fs::read_to_string(&dest).unwrap();
        assert_eq!(content, "", "fallback CLAUDE.md should be empty");

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn test_with_skill_claude_md_includes_skill_ref() {
        let tmp =
            std::env::temp_dir().join(format!("skill-test-claudemd-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&tmp).unwrap();

        // Simulate copy_minimal_claude_md writing a base CLAUDE.md
        let claude_md = tmp.join("CLAUDE.md");
        std::fs::write(&claude_md, "# Workspace\nbase content").unwrap();

        // Apply the same append logic as prepare_skill_test
        {
            use std::io::Write;
            let skill_ref = format!("\n@.claude/skills/{}/SKILL.md\n", "my-skill");
            std::fs::OpenOptions::new()
                .append(true)
                .open(&claude_md)
                .and_then(|mut f| f.write_all(skill_ref.as_bytes()))
                .unwrap();
        }

        let content = std::fs::read_to_string(&claude_md).unwrap();
        assert!(
            content.contains("@.claude/skills/my-skill/SKILL.md"),
            "skill ref not found"
        );
        assert!(
            content.contains("# Workspace\nbase content"),
            "original content should be preserved"
        );

        let _ = std::fs::remove_dir_all(&tmp);
    }
}
