use std::path::Path;

use crate::commands::imported_skills::validate_skill_name;
use crate::db::{self, Db};

#[derive(serde::Serialize)]
pub struct PrepareResult {
    pub test_id: String,
    pub baseline_cwd: String,
    pub with_skill_cwd: String,
    pub transcript_log_dir: String,
}

/// Strip YAML frontmatter from skill content.
/// Removes everything between the first and second `---` markers (inclusive).
fn strip_frontmatter(content: &str) -> String {
    let mut lines = content.lines();
    if lines.next().map(|l| l.trim()) != Some("---") {
        return content.to_string();
    }
    let body: Vec<&str> = lines.skip_while(|l| l.trim() != "---").skip(1).collect();
    body.join("\n").trim_start_matches('\n').to_string()
}

/// Create a `.claude/CLAUDE.md` file inside `parent_dir` with the given content.
fn write_workspace_claude_md(parent_dir: &Path, content: &str, label: &str) -> Result<(), String> {
    let claude_dir = parent_dir.join(".claude");
    std::fs::create_dir_all(&claude_dir).map_err(|e| {
        log::error!(
            "[prepare_skill_test] Failed to create {} dir: {}",
            label,
            e
        );
        format!("Failed to create {} workspace: {}", label, e)
    })?;
    std::fs::write(claude_dir.join("CLAUDE.md"), content).map_err(|e| {
        log::error!(
            "[prepare_skill_test] Failed to write {} CLAUDE.md: {}",
            label,
            e
        );
        format!("Failed to write {} CLAUDE.md: {}", label, e)
    })
}

/// Read a SKILL.md file and return its body with frontmatter stripped.
fn read_skill_body(path: &Path, label: &str) -> Result<String, String> {
    let raw = std::fs::read_to_string(path).map_err(|e| {
        log::error!(
            "[prepare_skill_test] Failed to read {} SKILL.md at {:?}: {}",
            label,
            path,
            e
        );
        format!("Failed to read {} content: {}", label, e)
    })?;
    Ok(strip_frontmatter(&raw))
}

/// Prepare isolated temp workspaces for a skill test run.
///
/// Creates TWO temp dirs:
/// - `baseline_cwd`: skill-test context only (no user skill)
/// - `with_skill_cwd`: skill-test context + user skill
///
/// Both contain a `.claude/CLAUDE.md` pre-populated with the appropriate context
/// so agents pick it up automatically via the SDK's workspace CLAUDE.md loading.
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
    let skills_path = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let settings = db::read_settings(&conn)?;
        settings.skills_path.unwrap_or_else(|| workspace_path.clone())
    };

    let test_id = uuid::Uuid::new_v4().to_string();
    let tmp_parent = std::env::temp_dir().join(format!("skill-builder-test-{}", test_id));

    // Read skill bodies (frontmatter stripped)
    let bundled_skills_dir = super::workflow::resolve_bundled_skills_dir(&app);
    let skill_test_body =
        read_skill_body(&bundled_skills_dir.join("skill-test").join("SKILL.md"), "skill-test")?;
    let user_skill_body = read_skill_body(
        &Path::new(&skills_path).join(&skill_name).join("SKILL.md"),
        &format!("skill '{}'", skill_name),
    )?;

    // Write workspace CLAUDE.md files
    let baseline_dir = tmp_parent.join("baseline");
    let with_skill_dir = tmp_parent.join("with-skill");

    write_workspace_claude_md(
        &baseline_dir,
        &format!("# Test Workspace\n\n## Skill Context\n\n{}", skill_test_body),
        "baseline",
    )?;
    write_workspace_claude_md(
        &with_skill_dir,
        &format!(
            "# Test Workspace\n\n## Skill Context\n\n{}\n\n---\n\n## Active Skill: {}\n\n{}",
            skill_test_body, skill_name, user_skill_body
        ),
        "with-skill",
    )?;

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
    fn test_strip_frontmatter_with_frontmatter() {
        let content = "---\nname: test\ndescription: foo\n---\n\n## Body\n\nHello world";
        let result = strip_frontmatter(content);
        assert!(!result.contains("name: test"));
        assert!(result.contains("## Body"));
        assert!(result.contains("Hello world"));
    }

    #[test]
    fn test_strip_frontmatter_no_frontmatter() {
        let content = "## Body\n\nHello world";
        let result = strip_frontmatter(content);
        assert_eq!(result, content);
    }

    #[test]
    fn test_cleanup_nonexistent_is_ok() {
        // Cleaning up a non-existent test should succeed silently
        cleanup_skill_test("nonexistent-id".to_string()).unwrap();
    }
}
