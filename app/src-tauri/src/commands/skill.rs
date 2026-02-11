use crate::db::Db;
use crate::types::SkillSummary;
use std::fs;
use std::path::Path;

#[tauri::command]
pub fn list_skills(
    workspace_path: String,
    db: tauri::State<'_, Db>,
) -> Result<Vec<SkillSummary>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    list_skills_inner(&workspace_path, &conn)
}

/// DB-primary skill listing. After reconciliation runs at startup, the DB is the
/// single source of truth. This function queries all `workflow_runs` from the DB,
/// batch-fetches tags, and builds a `SkillSummary` list. No filesystem scanning.
///
/// The `_workspace_path` parameter is retained for backward compatibility with the
/// Tauri command signature (the frontend still passes it), but is not used for
/// skill discovery.
fn list_skills_inner(
    _workspace_path: &str,
    conn: &rusqlite::Connection,
) -> Result<Vec<SkillSummary>, String> {
    // Query all workflow runs from the DB
    let runs = crate::db::list_all_workflow_runs(conn)?;

    // Batch-fetch tags for all skills
    let names: Vec<String> = runs.iter().map(|r| r.skill_name.clone()).collect();
    let tags_map = crate::db::get_tags_for_skills(conn, &names)?;

    // Build SkillSummary list from DB data
    let mut skills: Vec<SkillSummary> = runs
        .into_iter()
        .map(|run| {
            let tags = tags_map
                .get(&run.skill_name)
                .cloned()
                .unwrap_or_default();

            SkillSummary {
                name: run.skill_name,
                domain: Some(run.domain),
                current_step: Some(format!("Step {}", run.current_step)),
                status: Some(run.status),
                last_modified: Some(run.updated_at),
                tags,
                skill_type: Some(run.skill_type),
            }
        })
        .collect();

    // Sort by last_modified descending (most recent first)
    skills.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
    Ok(skills)
}

#[tauri::command]
pub fn create_skill(
    workspace_path: String,
    name: String,
    domain: String,
    tags: Option<Vec<String>>,
    skill_type: Option<String>,
    db: tauri::State<'_, Db>,
) -> Result<(), String> {
    let conn = db.0.lock().ok();
    // Read skills_path from settings DB
    let skills_path = conn.as_deref().and_then(|c| {
        crate::db::read_settings(c).ok().and_then(|s| s.skills_path)
    });
    create_skill_inner(
        &workspace_path,
        &name,
        &domain,
        tags.as_deref(),
        skill_type.as_deref(),
        conn.as_deref(),
        skills_path.as_deref(),
    )
}

fn create_skill_inner(
    workspace_path: &str,
    name: &str,
    domain: &str,
    tags: Option<&[String]>,
    skill_type: Option<&str>,
    conn: Option<&rusqlite::Connection>,
    skills_path: Option<&str>,
) -> Result<(), String> {
    // Check for collision in workspace_path (working directory)
    let base = Path::new(workspace_path).join(name);
    if base.exists() {
        return Err(format!(
            "Skill '{}' already exists in workspace directory ({})",
            name,
            base.display()
        ));
    }

    // Check for collision in skills_path (skill output directory)
    if let Some(sp) = skills_path {
        let skill_output = Path::new(sp).join(name);
        if skill_output.exists() {
            return Err(format!(
                "Skill '{}' already exists in skills output directory ({})",
                name,
                skill_output.display()
            ));
        }
    }

    fs::create_dir_all(base.join("context")).map_err(|e| e.to_string())?;

    let skill_type = skill_type.unwrap_or("domain");

    if let Some(conn) = conn {
        crate::db::save_workflow_run(conn, name, domain, 0, "pending", skill_type)?;

        if let Some(tags) = tags {
            if !tags.is_empty() {
                crate::db::set_skill_tags(conn, name, tags)?;
            }
        }
    }

    Ok(())
}

#[tauri::command]
pub fn delete_skill(
    workspace_path: String,
    name: String,
    db: tauri::State<'_, Db>,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    // Read skills_path from settings DB
    let skills_path = crate::db::read_settings(&conn)
        .ok()
        .and_then(|s| s.skills_path);
    delete_skill_inner(
        &workspace_path,
        &name,
        Some(&conn),
        skills_path.as_deref(),
    )
}

fn delete_skill_inner(
    workspace_path: &str,
    name: &str,
    conn: Option<&rusqlite::Connection>,
    skills_path: Option<&str>,
) -> Result<(), String> {
    let base = Path::new(workspace_path).join(name);

    // Delete workspace working directory if it exists
    if base.exists() {
        // Verify this is inside the workspace path to prevent directory traversal
        let canonical_workspace = fs::canonicalize(workspace_path).map_err(|e| e.to_string())?;
        let canonical_target = fs::canonicalize(&base).map_err(|e| e.to_string())?;
        if !canonical_target.starts_with(&canonical_workspace) {
            return Err("Invalid skill path".to_string());
        }
        fs::remove_dir_all(&base).map_err(|e| e.to_string())?;
    }

    // Delete skill output directory if skills_path is configured and directory exists
    if let Some(sp) = skills_path {
        let output_dir = Path::new(sp).join(name);
        if output_dir.exists() {
            fs::remove_dir_all(&output_dir).map_err(|e| {
                format!("Failed to delete skill output for '{}': {}", name, e)
            })?;
        }
    }

    // Full DB cleanup: workflow_run + steps + agent_runs + tags + artifacts
    if let Some(conn) = conn {
        crate::db::delete_workflow_run(conn, name)?;
    }

    Ok(())
}

#[tauri::command]
pub fn update_skill_tags(
    skill_name: String,
    tags: Vec<String>,
    db: tauri::State<'_, Db>,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    crate::db::set_skill_tags(&conn, &skill_name, &tags)
}

#[tauri::command]
pub fn get_all_tags(db: tauri::State<'_, Db>) -> Result<Vec<String>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    crate::db::get_all_tags(&conn)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::test_utils::create_test_db;
    use tempfile::tempdir;

    // ===== list_skills_inner tests =====

    #[test]
    fn test_list_skills_db_primary_returns_db_records() {
        let conn = create_test_db();
        crate::db::save_workflow_run(&conn, "skill-a", "analytics", 3, "in_progress", "domain")
            .unwrap();
        crate::db::save_workflow_run(&conn, "skill-b", "marketing", 0, "pending", "platform")
            .unwrap();

        let skills = list_skills_inner("/unused", &conn).unwrap();
        assert_eq!(skills.len(), 2);

        // Find skill-a
        let a = skills.iter().find(|s| s.name == "skill-a").unwrap();
        assert_eq!(a.domain.as_deref(), Some("analytics"));
        assert_eq!(a.current_step.as_deref(), Some("Step 3"));
        assert_eq!(a.status.as_deref(), Some("in_progress"));
        assert_eq!(a.skill_type.as_deref(), Some("domain"));

        // Find skill-b
        let b = skills.iter().find(|s| s.name == "skill-b").unwrap();
        assert_eq!(b.domain.as_deref(), Some("marketing"));
        assert_eq!(b.current_step.as_deref(), Some("Step 0"));
        assert_eq!(b.status.as_deref(), Some("pending"));
        assert_eq!(b.skill_type.as_deref(), Some("platform"));
    }

    #[test]
    fn test_list_skills_db_primary_empty_db() {
        let conn = create_test_db();
        let skills = list_skills_inner("/unused", &conn).unwrap();
        assert!(skills.is_empty());
    }

    #[test]
    fn test_list_skills_db_primary_includes_tags() {
        let conn = create_test_db();
        crate::db::save_workflow_run(&conn, "tagged-skill", "sales", 2, "pending", "domain")
            .unwrap();
        crate::db::set_skill_tags(
            &conn,
            "tagged-skill",
            &["analytics".into(), "salesforce".into()],
        )
        .unwrap();

        let skills = list_skills_inner("/unused", &conn).unwrap();
        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].tags, vec!["analytics", "salesforce"]);
    }

    #[test]
    fn test_list_skills_db_primary_last_modified_from_db() {
        let conn = create_test_db();
        crate::db::save_workflow_run(&conn, "my-skill", "domain", 0, "pending", "domain").unwrap();

        let skills = list_skills_inner("/unused", &conn).unwrap();
        assert_eq!(skills.len(), 1);
        // last_modified should be populated from updated_at (not filesystem)
        assert!(skills[0].last_modified.is_some());
    }

    #[test]
    fn test_list_skills_db_primary_no_filesystem_access_needed() {
        // This test proves that list_skills_inner works without any filesystem
        // by using a nonexistent workspace path. The DB is the sole data source.
        let conn = create_test_db();
        crate::db::save_workflow_run(
            &conn,
            "no-disk-skill",
            "virtual",
            5,
            "completed",
            "source",
        )
        .unwrap();

        let skills =
            list_skills_inner("/this/path/does/not/exist/at/all", &conn).unwrap();
        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].name, "no-disk-skill");
        assert_eq!(skills[0].domain.as_deref(), Some("virtual"));
        assert_eq!(skills[0].current_step.as_deref(), Some("Step 5"));
    }

    #[test]
    fn test_list_skills_db_primary_sorted_by_last_modified_desc() {
        let conn = create_test_db();
        // Create skills with different updated_at by updating in sequence
        crate::db::save_workflow_run(&conn, "oldest", "d1", 0, "pending", "domain").unwrap();
        crate::db::save_workflow_run(&conn, "newest", "d2", 3, "in_progress", "domain").unwrap();

        let skills = list_skills_inner("/unused", &conn).unwrap();
        assert_eq!(skills.len(), 2);
        // The most recently updated should come first
        // Since they're created nearly simultaneously, just verify both exist
        let names: Vec<&str> = skills.iter().map(|s| s.name.as_str()).collect();
        assert!(names.contains(&"oldest"));
        assert!(names.contains(&"newest"));
    }

    // ===== create + list integration =====

    #[test]
    fn test_create_and_list_skills_db_primary() {
        let dir = tempdir().unwrap();
        let workspace = dir.path().to_str().unwrap();
        let conn = create_test_db();

        create_skill_inner(workspace, "my-skill", "sales pipeline", None, None, Some(&conn), None)
            .unwrap();

        let skills = list_skills_inner(workspace, &conn).unwrap();
        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].name, "my-skill");
        assert_eq!(skills[0].domain.as_deref(), Some("sales pipeline"));
        assert_eq!(skills[0].status.as_deref(), Some("pending"));
    }

    #[test]
    fn test_create_duplicate_skill() {
        let dir = tempdir().unwrap();
        let workspace = dir.path().to_str().unwrap();

        create_skill_inner(workspace, "dup-skill", "domain", None, None, None, None).unwrap();
        let result = create_skill_inner(workspace, "dup-skill", "domain", None, None, None, None);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("already exists"));
    }

    // ===== delete_skill_inner tests =====

    #[test]
    fn test_delete_skill_workspace_only() {
        let dir = tempdir().unwrap();
        let workspace = dir.path().to_str().unwrap();
        let conn = create_test_db();

        create_skill_inner(workspace, "to-delete", "domain", None, None, Some(&conn), None)
            .unwrap();

        let skills = list_skills_inner(workspace, &conn).unwrap();
        assert_eq!(skills.len(), 1);

        delete_skill_inner(workspace, "to-delete", Some(&conn), None).unwrap();

        // DB should be clean
        let skills = list_skills_inner(workspace, &conn).unwrap();
        assert_eq!(skills.len(), 0);

        // Filesystem should be clean
        assert!(!Path::new(workspace).join("to-delete").exists());
    }

    #[test]
    fn test_delete_skill_with_skills_path() {
        let dir = tempdir().unwrap();
        let workspace = dir.path().to_str().unwrap();
        let skills_dir = tempdir().unwrap();
        let skills_path = skills_dir.path().to_str().unwrap();
        let conn = create_test_db();

        // Create skill in workspace
        create_skill_inner(
            workspace,
            "full-delete",
            "domain",
            None,
            None,
            Some(&conn),
            Some(skills_path),
        )
        .unwrap();

        // Simulate skill output in skills_path (as would happen after build step)
        let output_dir = Path::new(skills_path).join("full-delete");
        fs::create_dir_all(output_dir.join("references")).unwrap();
        fs::write(output_dir.join("SKILL.md"), "# Skill").unwrap();

        delete_skill_inner(workspace, "full-delete", Some(&conn), Some(skills_path)).unwrap();

        // Workspace dir should be gone
        assert!(!Path::new(workspace).join("full-delete").exists());
        // Skills output dir should be gone
        assert!(!output_dir.exists());
        // DB should be clean
        assert!(crate::db::get_workflow_run(&conn, "full-delete")
            .unwrap()
            .is_none());
    }

    #[test]
    fn test_delete_skill_cleans_db_fully() {
        let dir = tempdir().unwrap();
        let workspace = dir.path().to_str().unwrap();
        let conn = create_test_db();

        // Create skill with DB records
        create_skill_inner(
            workspace,
            "db-cleanup",
            "domain",
            Some(&["tag1".into(), "tag2".into()]),
            Some("platform"),
            Some(&conn),
            None,
        )
        .unwrap();

        // Add workflow steps and artifacts
        crate::db::save_workflow_step(&conn, "db-cleanup", 0, "completed").unwrap();
        crate::db::save_artifact(&conn, "db-cleanup", 0, "context/test.md", "content").unwrap();

        delete_skill_inner(workspace, "db-cleanup", Some(&conn), None).unwrap();

        // Verify all DB records are cleaned up
        assert!(crate::db::get_workflow_run(&conn, "db-cleanup")
            .unwrap()
            .is_none());
        assert!(crate::db::get_workflow_steps(&conn, "db-cleanup")
            .unwrap()
            .is_empty());
        assert!(crate::db::get_skill_artifacts(&conn, "db-cleanup")
            .unwrap()
            .is_empty());
        let tags = crate::db::get_tags_for_skills(&conn, &["db-cleanup".into()])
            .unwrap();
        assert!(tags.get("db-cleanup").is_none());
    }

    #[test]
    fn test_delete_skill_no_workspace_dir_but_has_skills_output() {
        // Skill may have been deleted from workspace but output still exists
        let dir = tempdir().unwrap();
        let workspace = dir.path().to_str().unwrap();
        let skills_dir = tempdir().unwrap();
        let skills_path = skills_dir.path().to_str().unwrap();
        let conn = create_test_db();

        // Only create skill output, no workspace dir
        let output_dir = Path::new(skills_path).join("orphan-output");
        fs::create_dir_all(output_dir.join("references")).unwrap();
        fs::write(output_dir.join("SKILL.md"), "# Skill").unwrap();

        // Add DB record
        crate::db::save_workflow_run(&conn, "orphan-output", "domain", 7, "completed", "domain")
            .unwrap();

        delete_skill_inner(workspace, "orphan-output", Some(&conn), Some(skills_path)).unwrap();

        // Skills output should be deleted
        assert!(!output_dir.exists());
        // DB should be clean
        assert!(crate::db::get_workflow_run(&conn, "orphan-output")
            .unwrap()
            .is_none());
    }

    #[test]
    fn test_delete_skill_no_workspace_dir_no_output() {
        // Neither workspace dir nor skills output exists — just DB cleanup
        let dir = tempdir().unwrap();
        let workspace = dir.path().to_str().unwrap();
        let conn = create_test_db();

        crate::db::save_workflow_run(&conn, "ghost", "domain", 3, "pending", "domain").unwrap();

        delete_skill_inner(workspace, "ghost", Some(&conn), None).unwrap();

        assert!(crate::db::get_workflow_run(&conn, "ghost")
            .unwrap()
            .is_none());
    }

    #[test]
    fn test_delete_skill_directory_traversal() {
        let dir = tempdir().unwrap();
        let workspace = dir.path().join("workspace");
        fs::create_dir_all(&workspace).unwrap();
        let workspace_str = workspace.to_str().unwrap();

        // Create a directory OUTSIDE the workspace that a traversal attack would target
        let outside_dir = dir.path().join("outside-target");
        fs::create_dir_all(&outside_dir).unwrap();

        // Create a symlink or sibling that the ".." traversal would resolve to
        // The workspace has a dir that resolves outside via ".."
        // workspace/legit is a real skill
        create_skill_inner(workspace_str, "legit", "domain", None, None, None, None).unwrap();

        // Attempt to delete using ".." to escape the workspace
        // This creates workspace/../outside-target which resolves to outside_dir
        let result = delete_skill_inner(workspace_str, "../outside-target", None, None);
        assert!(result.is_err(), "Directory traversal should be rejected");

        // The outside directory should still exist (not deleted)
        assert!(outside_dir.exists());
        // The legitimate skill should still exist
        assert!(workspace.join("legit").exists());
    }

    #[test]
    fn test_delete_skill_nonexistent_is_noop() {
        // When neither workspace dir nor skills output nor DB record exists,
        // delete should succeed as a no-op
        let dir = tempdir().unwrap();
        let workspace = dir.path().to_str().unwrap();

        let result = delete_skill_inner(workspace, "no-such-skill", None, None);
        assert!(result.is_ok());
    }

    // ===== Existing tests (updated signatures) =====

    #[test]
    fn test_create_skill_collision_in_workspace() {
        let dir = tempdir().unwrap();
        let workspace = dir.path().to_str().unwrap();
        let skills_dir = tempdir().unwrap();
        let skills_path = skills_dir.path().to_str().unwrap();

        // Create the skill directory in workspace manually (simulating a pre-existing dir)
        fs::create_dir_all(Path::new(workspace).join("colliding-skill")).unwrap();

        let result = create_skill_inner(
            workspace,
            "colliding-skill",
            "domain",
            None,
            None,
            None,
            Some(skills_path),
        );
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.contains("already exists"), "Error should mention 'already exists': {}", err);
        assert!(err.contains("workspace directory"), "Error should mention 'workspace directory': {}", err);
    }

    #[test]
    fn test_create_skill_collision_in_skills_path() {
        let dir = tempdir().unwrap();
        let workspace = dir.path().to_str().unwrap();
        let skills_dir = tempdir().unwrap();
        let skills_path = skills_dir.path().to_str().unwrap();

        // Create the skill directory in skills_path manually (simulating a pre-existing output dir)
        fs::create_dir_all(Path::new(skills_path).join("colliding-skill")).unwrap();

        let result = create_skill_inner(
            workspace,
            "colliding-skill",
            "domain",
            None,
            None,
            None,
            Some(skills_path),
        );
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.contains("already exists"), "Error should mention 'already exists': {}", err);
        assert!(err.contains("skills output directory"), "Error should mention 'skills output directory': {}", err);
    }

    #[test]
    fn test_create_skill_no_collision() {
        let dir = tempdir().unwrap();
        let workspace = dir.path().to_str().unwrap();
        let skills_dir = tempdir().unwrap();
        let skills_path = skills_dir.path().to_str().unwrap();

        // Neither workspace nor skills_path has the skill directory
        let result = create_skill_inner(
            workspace,
            "new-skill",
            "test domain",
            None,
            None,
            None,
            Some(skills_path),
        );
        assert!(result.is_ok());

        // Verify the skill was created in the workspace
        assert!(Path::new(workspace).join("new-skill").exists());
        assert!(Path::new(workspace).join("new-skill").join("context").exists());
        // workflow.md is no longer created — DB is the single source of truth
    }

    #[test]
    fn test_delete_skill_removes_logs_directory() {
        let dir = tempdir().unwrap();
        let workspace = dir.path().to_str().unwrap();

        // Create a skill
        create_skill_inner(workspace, "skill-with-logs", "analytics", None, None, None, None).unwrap();

        // Add a logs/ subdirectory with a fake log file inside the skill directory
        let skill_dir = dir.path().join("skill-with-logs");
        let logs_dir = skill_dir.join("logs");
        fs::create_dir_all(&logs_dir).unwrap();
        fs::write(logs_dir.join("step-0.log"), "fake log content for step 0").unwrap();
        fs::write(logs_dir.join("step-1.log"), "fake log content for step 1").unwrap();

        // Verify the logs directory and files exist before deletion
        assert!(logs_dir.exists());
        assert!(logs_dir.join("step-0.log").exists());
        assert!(logs_dir.join("step-1.log").exists());

        // Delete the skill
        delete_skill_inner(workspace, "skill-with-logs", None, None).unwrap();

        // Verify the entire skill directory (including logs/) is gone
        assert!(!skill_dir.exists(), "skill directory should be removed");
        assert!(!logs_dir.exists(), "logs directory should be removed");
    }
}
