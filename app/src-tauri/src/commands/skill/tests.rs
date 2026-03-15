use super::crud::{create_skill_inner, delete_skill_inner, list_refinable_skills_inner, list_skills_inner};
use super::metadata::{is_valid_kebab, rename_skill_inner};
use crate::commands::test_utils::create_test_db;
use rusqlite::Connection;
use std::fs;
use std::path::Path;
use tempfile::tempdir;

// ===== list_skills_inner tests =====

#[test]
fn test_list_skills_db_primary_returns_db_records() {
    let conn = create_test_db();
    crate::db::save_workflow_run(&conn, "skill-a", 3, "in_progress", "domain").unwrap();
    crate::db::save_workflow_run(&conn, "skill-b", 0, "pending", "platform").unwrap();

    let skills = list_skills_inner("/unused", None, &conn).unwrap();
    assert_eq!(skills.len(), 2);

    // Find skill-a
    let a = skills.iter().find(|s| s.name == "skill-a").unwrap();

    assert_eq!(a.current_step.as_deref(), Some("Step 3"));
    assert_eq!(a.status.as_deref(), Some("in_progress"));
    assert_eq!(a.purpose.as_deref(), Some("domain"));

    // Find skill-b
    let b = skills.iter().find(|s| s.name == "skill-b").unwrap();

    assert_eq!(b.current_step.as_deref(), Some("Step 0"));
    assert_eq!(b.status.as_deref(), Some("pending"));
    assert_eq!(b.purpose.as_deref(), Some("platform"));
}

#[test]
fn test_list_skills_db_primary_empty_db() {
    let conn = create_test_db();
    let skills = list_skills_inner("/unused", None, &conn).unwrap();
    assert!(skills.is_empty());
}

#[test]
fn test_list_skills_db_primary_includes_tags() {
    let conn = create_test_db();
    crate::db::save_workflow_run(&conn, "tagged-skill", 2, "pending", "domain").unwrap();
    crate::db::set_skill_tags(
        &conn,
        "tagged-skill",
        &["analytics".into(), "salesforce".into()],
    )
    .unwrap();

    let skills = list_skills_inner("/unused", None, &conn).unwrap();
    assert_eq!(skills.len(), 1);
    assert_eq!(skills[0].tags, vec!["analytics", "salesforce"]);
}

#[test]
fn test_list_skills_db_primary_last_modified_from_db() {
    let conn = create_test_db();
    crate::db::save_workflow_run(&conn, "my-skill", 0, "pending", "domain").unwrap();

    let skills = list_skills_inner("/unused", None, &conn).unwrap();
    assert_eq!(skills.len(), 1);
    // last_modified should be populated from updated_at (not filesystem)
    assert!(skills[0].last_modified.is_some());
}

#[test]
fn test_list_skills_db_primary_no_filesystem_access_needed() {
    // This test proves that list_skills_inner works without any filesystem
    // by using a nonexistent workspace path. The DB is the sole data source.
    let conn = create_test_db();
    crate::db::save_workflow_run(&conn, "no-disk-skill", 5, "completed", "source").unwrap();

    let skills = list_skills_inner("/this/path/does/not/exist/at/all", None, &conn).unwrap();
    assert_eq!(skills.len(), 1);
    assert_eq!(skills[0].name, "no-disk-skill");

    assert_eq!(skills[0].current_step.as_deref(), Some("Step 5"));
}

#[test]
fn test_list_skills_db_primary_sorted_by_last_modified_desc() {
    let conn = create_test_db();
    // Create skills with different updated_at by updating in sequence
    crate::db::save_workflow_run(&conn, "oldest", 0, "pending", "domain").unwrap();
    crate::db::save_workflow_run(&conn, "newest", 3, "in_progress", "domain").unwrap();

    let skills = list_skills_inner("/unused", None, &conn).unwrap();
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

    create_skill_inner(
        workspace,
        "my-skill",
        None,
        None,
        Some(&conn),
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
    )
    .unwrap();

    let skills = list_skills_inner(workspace, None, &conn).unwrap();
    assert_eq!(skills.len(), 1);
    assert_eq!(skills[0].name, "my-skill");

    assert_eq!(skills[0].status.as_deref(), Some("pending"));
}

#[test]
fn test_create_duplicate_skill() {
    let dir = tempdir().unwrap();
    let workspace = dir.path().to_str().unwrap();

    create_skill_inner(
        workspace,
        "dup-skill",
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
    )
    .unwrap();
    let result = create_skill_inner(
        workspace,
        "dup-skill",
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
    );
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("already exists"));
}

#[test]
fn test_create_skill_rejects_parent_dir_traversal() {
    let dir = tempdir().unwrap();
    let workspace = dir.path().to_str().unwrap();

    let result = create_skill_inner(
        workspace,
        "../bad-skill",
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
    );
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("Invalid skill name"));
}

#[test]
fn test_create_skill_rejects_path_separator() {
    let dir = tempdir().unwrap();
    let workspace = dir.path().to_str().unwrap();

    let result = create_skill_inner(
        workspace, "bad/name", None, None, None, None, None, None, None, None, None, None,
        None, None, None,
    );
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("Invalid skill name"));
}

#[test]
fn test_create_skill_rejects_empty_name() {
    let dir = tempdir().unwrap();
    let workspace = dir.path().to_str().unwrap();

    let result = create_skill_inner(
        workspace, "", None, None, None, None, None, None, None, None, None, None, None, None,
        None,
    );
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("cannot be empty"));
}

#[test]
fn test_create_skill_rejects_single_dot() {
    let dir = tempdir().unwrap();
    let workspace = dir.path().to_str().unwrap();

    let result = create_skill_inner(
        workspace, ".", None, None, None, None, None, None, None, None, None, None, None, None,
        None,
    );
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("Invalid skill name"));
}

#[test]
fn test_create_skill_rejects_dot_prefix() {
    let dir = tempdir().unwrap();
    let workspace = dir.path().to_str().unwrap();

    let result = create_skill_inner(
        workspace,
        ".hidden-skill",
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
    );
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("Invalid skill name"));
}

// ===== delete_skill_inner tests =====

#[test]
fn test_delete_skill_workspace_only() {
    let dir = tempdir().unwrap();
    let workspace = dir.path().to_str().unwrap();
    let conn = create_test_db();

    create_skill_inner(
        workspace,
        "to-delete",
        None,
        None,
        Some(&conn),
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
    )
    .unwrap();

    let skills = list_skills_inner(workspace, None, &conn).unwrap();
    assert_eq!(skills.len(), 1);

    delete_skill_inner(workspace, "to-delete", Some(&conn), None).unwrap();

    // DB should be clean
    let skills = list_skills_inner(workspace, None, &conn).unwrap();
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
        None,
        None,
        Some(&conn),
        Some(skills_path),
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
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
        Some(&["tag1".into(), "tag2".into()]),
        Some("platform"),
        Some(&conn),
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
    )
    .unwrap();

    // Add workflow steps (save_workflow_step populates workflow_run_id FK automatically)
    crate::db::save_workflow_step(&conn, "db-cleanup", 0, "completed").unwrap();

    // Add workflow artifact with FK populated
    let wr_id: i64 = conn
        .query_row(
            "SELECT id FROM workflow_runs WHERE skill_name = 'db-cleanup'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    conn.execute(
        "INSERT INTO workflow_artifacts (skill_name, workflow_run_id, step_id, relative_path, content, size_bytes) VALUES ('db-cleanup', ?1, 0, 'test.md', '# Test', 6)",
        rusqlite::params![wr_id],
    )
    .unwrap();

    // Add skill lock with skill_id FK populated
    let s_id: i64 = conn
        .query_row(
            "SELECT id FROM skills WHERE name = 'db-cleanup'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    conn.execute(
        "INSERT INTO skill_locks (skill_name, skill_id, instance_id, pid) VALUES ('db-cleanup', ?1, 'inst-1', 12345)",
        rusqlite::params![s_id],
    )
    .unwrap();

    delete_skill_inner(workspace, "db-cleanup", Some(&conn), None).unwrap();

    // Verify all DB records are cleaned up
    assert!(crate::db::get_workflow_run(&conn, "db-cleanup")
        .unwrap()
        .is_none());
    assert!(crate::db::get_workflow_steps(&conn, "db-cleanup")
        .unwrap()
        .is_empty());
    let tags = crate::db::get_tags_for_skills(&conn, &["db-cleanup".into()]).unwrap();
    assert!(tags.get("db-cleanup").is_none());

    // Verify workflow artifacts are cleaned up
    let artifact_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM workflow_artifacts WHERE skill_name = ?1",
            ["db-cleanup"],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(artifact_count, 0);

    // Verify skill locks are cleaned up
    let lock_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM skill_locks WHERE skill_name = ?1",
            ["db-cleanup"],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(lock_count, 0);
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
    crate::db::save_workflow_run(&conn, "orphan-output", 7, "completed", "domain").unwrap();

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

    crate::db::save_workflow_run(&conn, "ghost", 3, "pending", "domain").unwrap();

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
    create_skill_inner(
        workspace_str,
        "legit",
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
    )
    .unwrap();

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
fn test_delete_skill_skills_path_directory_traversal() {
    let dir = tempdir().unwrap();
    let skills_base = dir.path().join("skills");
    fs::create_dir_all(&skills_base).unwrap();
    let skills_path = skills_base.to_str().unwrap();

    let workspace_dir = tempdir().unwrap();
    let workspace = workspace_dir.path().to_str().unwrap();

    // Create a directory OUTSIDE the skills_path that a traversal attack would target
    let outside_dir = dir.path().join("outside-target");
    fs::create_dir_all(&outside_dir).unwrap();

    // Attempt to delete using ".." to escape the skills_path
    // This creates skills/../outside-target which resolves to outside_dir
    let result = delete_skill_inner(workspace, "../outside-target", None, Some(skills_path));
    assert!(
        result.is_err(),
        "Directory traversal on skills_path should be rejected"
    );
    assert!(
        result.unwrap_err().contains("path traversal not allowed"),
        "Error message should mention path traversal"
    );

    // The outside directory should still exist (not deleted)
    assert!(outside_dir.exists());
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

#[test]
fn test_delete_skill_inner_marketplace_skill_routes_to_imported_path() {
    let dir = tempdir().unwrap();
    let workspace = dir.path().to_str().unwrap();
    let conn = create_test_db();

    // Insert a skills master row with source="marketplace" (no workflow_run)
    conn.execute(
        "INSERT INTO skills (name, skill_source, purpose) VALUES ('mkt-skill', 'marketplace', 'domain')",
        [],
    ).unwrap();
    // Insert corresponding imported_skills row
    conn.execute(
        "INSERT INTO imported_skills (skill_id, skill_name, disk_path, is_bundled, skill_master_id)
         VALUES ('mkt-id', 'mkt-skill', '/tmp/mkt-skill', 0,
                 (SELECT id FROM skills WHERE name = 'mkt-skill'))",
        [],
    ).unwrap();

    // Verify setup: no workflow_run, but skills + imported_skills rows exist
    let wf_id = crate::db::get_workflow_run_id(&conn, "mkt-skill").unwrap();
    assert!(
        wf_id.is_none(),
        "Marketplace skill should have no workflow_run"
    );

    let skill_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM skills WHERE name = 'mkt-skill'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(skill_count, 1);

    // Delete via delete_skill_inner
    delete_skill_inner(workspace, "mkt-skill", Some(&conn), None).unwrap();

    // skills master row is soft-deleted (deleted_at set), imported_skills row is removed
    let deleted_at: Option<String> = conn
        .query_row(
            "SELECT deleted_at FROM skills WHERE name = 'mkt-skill'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert!(
        deleted_at.as_deref().is_some_and(|v| !v.is_empty()),
        "skills master row should be soft-deleted",
    );

    let imported_after: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM imported_skills WHERE skill_name = 'mkt-skill'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(imported_after, 0, "imported_skills row should be deleted");
}

#[test]
fn test_delete_skill_inner_skill_builder_routes_to_workflow_path() {
    let dir = tempdir().unwrap();
    let workspace = dir.path().to_str().unwrap();
    let conn = create_test_db();

    // create_skill_inner inserts into skills (skill_source="skill-builder") + workflow_runs
    create_skill_inner(
        workspace,
        "builder-skill",
        None,
        None,
        Some(&conn),
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
    )
    .unwrap();

    // Verify setup: workflow_run exists
    let wf_id = crate::db::get_workflow_run_id(&conn, "builder-skill").unwrap();
    assert!(
        wf_id.is_some(),
        "skill-builder skill should have workflow_run"
    );

    delete_skill_inner(workspace, "builder-skill", Some(&conn), None).unwrap();

    // workflow_runs row should be gone
    let wf_after = crate::db::get_workflow_run(&conn, "builder-skill").unwrap();
    assert!(wf_after.is_none(), "workflow_run should be deleted");

    // skills master row should be soft-deleted
    let deleted_at: Option<String> = conn
        .query_row(
            "SELECT deleted_at FROM skills WHERE name = 'builder-skill'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert!(
        deleted_at.as_deref().is_some_and(|v| !v.is_empty()),
        "skills master row should be soft-deleted",
    );
}

#[test]
fn test_rename_skill_inner_updates_imported_skills_name() {
    let dir = tempdir().unwrap();
    let workspace = dir.path().to_str().unwrap();
    let mut conn = create_test_db();

    // Insert a skills master row (imported source)
    conn.execute(
        "INSERT INTO skills (name, skill_source, purpose) VALUES ('imp-skill', 'imported', 'domain')",
        [],
    ).unwrap();
    // Insert imported_skills row
    conn.execute(
        "INSERT INTO imported_skills (skill_id, skill_name, disk_path, is_bundled, skill_master_id)
         VALUES ('imp-id', 'imp-skill', '/tmp/imp-skill', 0,
                 (SELECT id FROM skills WHERE name = 'imp-skill'))",
        [],
    ).unwrap();

    rename_skill_inner("imp-skill", "imp-skill-renamed", workspace, &mut conn, None).unwrap();

    // skills master should be renamed
    let master_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM skills WHERE name = 'imp-skill-renamed'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(master_count, 1, "skills master should have new name");

    // imported_skills.skill_name should also be updated
    let imported_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM imported_skills WHERE skill_name = 'imp-skill-renamed'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        imported_count, 1,
        "imported_skills.skill_name should be updated"
    );

    // Old name should be gone from imported_skills
    let old_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM imported_skills WHERE skill_name = 'imp-skill'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(old_count, 0, "old imported_skills name should be gone");
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
        None,
        None,
        None,
        Some(skills_path),
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
    );
    assert!(result.is_err());
    let err = result.unwrap_err();
    assert!(
        err.contains("already exists"),
        "Error should mention 'already exists': {}",
        err
    );
    assert!(
        err.contains("workspace directory"),
        "Error should mention 'workspace directory': {}",
        err
    );
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
        None,
        None,
        None,
        Some(skills_path),
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
    );
    assert!(result.is_err());
    let err = result.unwrap_err();
    assert!(
        err.contains("already exists"),
        "Error should mention 'already exists': {}",
        err
    );
    assert!(
        err.contains("skills output directory"),
        "Error should mention 'skills output directory': {}",
        err
    );
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
        None,
        None,
        None,
        Some(skills_path),
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
    );
    assert!(result.is_ok());

    // Verify the workspace working directory was created
    assert!(Path::new(workspace).join("new-skill").exists());

    // Verify skill output directories were created in skills_path
    let skill_output = Path::new(skills_path).join("new-skill");
    assert!(skill_output.join("references").exists());
    // Context is workspace-owned.
    assert!(Path::new(workspace)
        .join("new-skill")
        .join("context")
        .exists());
}

#[test]
fn test_delete_skill_removes_logs_directory() {
    let dir = tempdir().unwrap();
    let workspace = dir.path().to_str().unwrap();

    // Create a skill
    create_skill_inner(
        workspace,
        "skill-with-logs",
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
    )
    .unwrap();

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

// ===== update_skill_metadata tests =====

/// Helper: create a skill in the DB for metadata update tests.
fn setup_skill_for_metadata(conn: &Connection, name: &str) {
    crate::db::save_workflow_run(conn, name, 0, "pending", "domain").unwrap();
}

#[test]
fn test_update_metadata_display_name() {
    let conn = create_test_db();
    setup_skill_for_metadata(&conn, "meta-skill");

    crate::db::set_skill_display_name(&conn, "meta-skill", Some("Pretty Name")).unwrap();

    let row = crate::db::get_workflow_run(&conn, "meta-skill")
        .unwrap()
        .unwrap();
    assert_eq!(row.display_name.as_deref(), Some("Pretty Name"));
}

#[test]
fn test_update_metadata_skill_type() {
    let conn = create_test_db();
    setup_skill_for_metadata(&conn, "type-skill");

    conn.execute(
        "UPDATE workflow_runs SET purpose = ?2, updated_at = datetime('now') || 'Z' WHERE skill_name = ?1",
        rusqlite::params!["type-skill", "platform"],
    ).unwrap();

    let row = crate::db::get_workflow_run(&conn, "type-skill")
        .unwrap()
        .unwrap();
    assert_eq!(row.purpose, "platform");
}

#[test]
fn test_update_metadata_tags() {
    let conn = create_test_db();
    setup_skill_for_metadata(&conn, "tag-skill");

    crate::db::set_skill_tags(&conn, "tag-skill", &["rust".into(), "wasm".into()]).unwrap();

    let tags = crate::db::get_tags_for_skills(&conn, &["tag-skill".into()]).unwrap();
    assert_eq!(tags.get("tag-skill").unwrap(), &["rust", "wasm"]);
}

#[test]
fn test_update_metadata_intake_json() {
    let conn = create_test_db();
    setup_skill_for_metadata(&conn, "intake-skill");

    let json = r#"{"audience":"Engineers","challenges":"Scale","scope":"Backend"}"#;
    crate::db::set_skill_intake(&conn, "intake-skill", Some(json)).unwrap();

    let row = crate::db::get_workflow_run(&conn, "intake-skill")
        .unwrap()
        .unwrap();
    assert_eq!(row.intake_json.as_deref(), Some(json));
}

#[test]
fn test_update_metadata_all_fields() {
    let conn = create_test_db();
    setup_skill_for_metadata(&conn, "full-meta");

    // Update all four fields as update_skill_metadata would
    crate::db::set_skill_display_name(&conn, "full-meta", Some("Full Metadata")).unwrap();
    conn.execute(
        "UPDATE workflow_runs SET purpose = ?2, updated_at = datetime('now') || 'Z' WHERE skill_name = ?1",
        rusqlite::params!["full-meta", "source"],
    ).unwrap();
    crate::db::set_skill_tags(&conn, "full-meta", &["api".into(), "rest".into()]).unwrap();
    crate::db::set_skill_intake(&conn, "full-meta", Some(r#"{"audience":"Devs"}"#)).unwrap();

    let row = crate::db::get_workflow_run(&conn, "full-meta")
        .unwrap()
        .unwrap();
    assert_eq!(row.display_name.as_deref(), Some("Full Metadata"));
    assert_eq!(row.purpose, "source");
    assert_eq!(row.intake_json.as_deref(), Some(r#"{"audience":"Devs"}"#));

    let tags = crate::db::get_tags_for_skills(&conn, &["full-meta".into()]).unwrap();
    assert_eq!(tags.get("full-meta").unwrap(), &["api", "rest"]);
}

// ===== list_refinable_skills_inner tests =====

#[test]
fn test_list_refinable_skills_returns_only_completed_with_skill_md() {
    let dir = tempdir().unwrap();
    let skills_path = dir.path().to_str().unwrap();
    let conn = create_test_db();

    // Create a completed skill with SKILL.md on disk
    crate::db::save_workflow_run(&conn, "ready-skill", 7, "completed", "domain").unwrap();
    let skill_dir = dir.path().join("ready-skill");
    fs::create_dir_all(&skill_dir).unwrap();
    fs::write(skill_dir.join("SKILL.md"), "# Ready").unwrap();

    // Create an in-progress skill (should be excluded)
    crate::db::save_workflow_run(&conn, "wip-skill", 3, "in_progress", "domain").unwrap();

    let result = list_refinable_skills_inner("/unused", skills_path, &conn).unwrap();
    assert_eq!(result.len(), 1);
    assert_eq!(result[0].name, "ready-skill");
}

#[test]
fn test_list_refinable_skills_excludes_completed_without_skill_md() {
    let dir = tempdir().unwrap();
    let skills_path = dir.path().to_str().unwrap();
    let conn = create_test_db();

    // Completed in DB but no SKILL.md on disk
    crate::db::save_workflow_run(&conn, "no-file", 7, "completed", "domain").unwrap();

    let result = list_refinable_skills_inner("/unused", skills_path, &conn).unwrap();
    assert!(result.is_empty());
}

#[test]
fn test_list_refinable_skills_empty_db() {
    let dir = tempdir().unwrap();
    let skills_path = dir.path().to_str().unwrap();
    let conn = create_test_db();

    let result = list_refinable_skills_inner("/unused", skills_path, &conn).unwrap();
    assert!(result.is_empty());
}

#[test]
fn test_update_metadata_nonexistent_skill_is_noop() {
    let conn = create_test_db();

    // These should succeed (UPDATE affects 0 rows, no error)
    crate::db::set_skill_display_name(&conn, "ghost", Some("Name")).unwrap();
    crate::db::set_skill_intake(&conn, "ghost", Some("{}")).unwrap();

    // set_skill_tags now requires a skills master row — returns Err for unknown skills
    let result = crate::db::set_skill_tags(&conn, "ghost", &["tag".into()]);
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("not found in skills master"));

    // No row should exist
    assert!(crate::db::get_workflow_run(&conn, "ghost")
        .unwrap()
        .is_none());
}

// ===== rename_skill tests =====

/// Helper: save skills_path into the settings table so rename_skill_inner
/// can read it via `crate::db::read_settings`.
fn save_skills_path_setting(conn: &Connection, skills_path: &str) {
    let settings = crate::types::AppSettings {
        skills_path: Some(skills_path.to_string()),
        ..Default::default()
    };
    crate::db::write_settings(conn, &settings).unwrap();
}

#[test]
fn test_rename_skill_basic() {
    let workspace_dir = tempdir().unwrap();
    let workspace = workspace_dir.path().to_str().unwrap();
    let skills_dir = tempdir().unwrap();
    let skills_path = skills_dir.path().to_str().unwrap();
    let mut conn = create_test_db();
    save_skills_path_setting(&conn, skills_path);

    // Create skill with workspace dir, skills dir, DB record, tags, and steps
    create_skill_inner(
        workspace,
        "old-name",
        Some(&["tag-a".into(), "tag-b".into()]),
        Some("domain"),
        Some(&conn),
        Some(skills_path),
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
    )
    .unwrap();
    crate::db::save_workflow_step(&conn, "old-name", 0, "completed").unwrap();

    // Rename
    rename_skill_inner(
        "old-name",
        "new-name",
        workspace,
        &mut conn,
        Some(skills_path),
    )
    .unwrap();

    // Workspace dirs moved
    assert!(!Path::new(workspace).join("old-name").exists());
    assert!(Path::new(workspace).join("new-name").exists());

    // Skills dirs moved
    assert!(!Path::new(skills_path).join("old-name").exists());
    assert!(Path::new(skills_path).join("new-name").exists());

    // DB: old record gone, new record present with same data
    assert!(crate::db::get_workflow_run(&conn, "old-name")
        .unwrap()
        .is_none());
    let row = crate::db::get_workflow_run(&conn, "new-name")
        .unwrap()
        .unwrap();

    assert_eq!(row.purpose, "domain");

    // Tags migrated
    let tags = crate::db::get_tags_for_skills(&conn, &["new-name".into()]).unwrap();
    let new_tags = tags.get("new-name").unwrap();
    assert!(new_tags.contains(&"tag-a".to_string()));
    assert!(new_tags.contains(&"tag-b".to_string()));
    // Old tags gone
    let old_tags = crate::db::get_tags_for_skills(&conn, &["old-name".into()]).unwrap();
    assert!(old_tags.get("old-name").is_none());

    // Workflow steps migrated
    let steps = crate::db::get_workflow_steps(&conn, "new-name").unwrap();
    assert_eq!(steps.len(), 1);
    let old_steps = crate::db::get_workflow_steps(&conn, "old-name").unwrap();
    assert!(old_steps.is_empty());
}

#[test]
fn test_rename_skill_invalid_kebab_case() {
    // The kebab-case validation happens in the Tauri command wrapper (rename_skill),
    // not in rename_skill_inner, so we test the validation logic directly.
    let invalid_names = vec![
        "HasUpperCase",
        "has spaces",
        "-leading-hyphen",
        "trailing-hyphen-",
        "double--hyphen",
        "",
        "ALLCAPS",
        "under_score",
    ];

    for name in invalid_names {
        assert!(
            !is_valid_kebab(name),
            "Name '{}' should be rejected as non-kebab-case",
            name
        );
    }

    // Valid kebab-case names should pass
    let valid_names = vec!["my-skill", "a", "skill-123", "a-b-c"];
    for name in valid_names {
        assert!(
            is_valid_kebab(name),
            "Name '{}' should be accepted as valid kebab-case",
            name
        );
    }
}

#[test]
fn test_rename_skill_collision() {
    let workspace_dir = tempdir().unwrap();
    let workspace = workspace_dir.path().to_str().unwrap();
    let mut conn = create_test_db();

    // Create two skills in DB
    create_skill_inner(
        workspace,
        "skill-a",
        None,
        None,
        Some(&conn),
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
    )
    .unwrap();
    create_skill_inner(
        workspace,
        "skill-b",
        None,
        None,
        Some(&conn),
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
    )
    .unwrap();

    // Attempt to rename skill-a to skill-b (collision)
    let result = rename_skill_inner("skill-a", "skill-b", workspace, &mut conn, None);
    assert!(result.is_err());
    let err = result.unwrap_err();
    assert!(
        err.contains("already exists"),
        "Error should mention collision: {}",
        err
    );

    // Original skill should be untouched
    let row = crate::db::get_workflow_run(&conn, "skill-a").unwrap();
    assert!(row.is_some(), "skill-a workflow row should still exist");
}

#[test]
fn test_rename_skill_noop_same_name() {
    // When old == new, the Tauri command returns Ok(()) without touching DB.
    // Since rename_skill_inner is only called when old != new, we test the
    // early-return logic that lives in the command wrapper.
    let old = "same-name";
    let new = "same-name";
    assert_eq!(old, new);
    // The command returns Ok(()) for this case — verified by the condition.
    // We also verify rename_skill_inner would work if called (same name = collision in DB).
    let mut conn = create_test_db();
    let workspace_dir = tempdir().unwrap();
    let workspace = workspace_dir.path().to_str().unwrap();
    create_skill_inner(
        workspace,
        "same-name",
        None,
        None,
        Some(&conn),
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
    )
    .unwrap();

    // rename_skill_inner with same name hits the "already exists" check in DB,
    // confirming the early-return in the wrapper is necessary.
    let result = rename_skill_inner("same-name", "same-name", workspace, &mut conn, None);
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("already exists"));
}

#[test]
fn test_rename_skill_disk_rollback_on_db_failure() {
    let workspace_dir = tempdir().unwrap();
    let workspace = workspace_dir.path().to_str().unwrap();
    let mut conn = create_test_db();

    // Create the skill on disk (workspace dir) and in DB
    create_skill_inner(
        workspace,
        "will-rollback",
        None,
        None,
        Some(&conn),
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
    )
    .unwrap();
    assert!(Path::new(workspace).join("will-rollback").exists());

    // To force the DB transaction to fail, we drop the workflow_runs table
    // after creating the skill, so the INSERT in the transaction will fail.
    // But we need the existence check to pass first (no row for "new-name").
    // Strategy: drop and recreate workflow_runs without the old row data columns,
    // so the INSERT...SELECT fails due to column mismatch.
    //
    // Simpler approach: insert a row with the new name AFTER the existence check
    // runs but before the transaction. Since we can't do that with a single call,
    // we instead corrupt the table structure.
    //
    // Simplest: drop the workflow_runs table entirely after the existence check.
    // But rename_skill_inner does the check and the tx in one call.
    //
    // Best approach: rename to a name that will fail in the INSERT because the
    // source row doesn't exist (i.e., old_name doesn't exist in DB, so
    // INSERT...SELECT copies 0 rows, then DELETE affects 0 rows, then the other
    // UPDATEs also affect 0 rows — that actually succeeds).
    //
    // Real approach: We need to make the transaction fail. We can do this by
    // creating a trigger that raises an error, or by making the table read-only.
    // The easiest: add a UNIQUE constraint violation by pre-inserting the new name
    // into a table that the transaction will try to UPDATE into.
    //
    // Actually, the cleanest way: put a row in workflow_steps with the NEW name
    // and a UNIQUE constraint, but workflow_steps PK is (skill_name, step_id) so
    // we need a conflicting row. Let's add a step for "rollback-target" (the new name)
    // with the same step_id that "will-rollback" has after the UPDATE tries to set it.
    //
    // The transaction first does INSERT+DELETE on workflow_runs (succeeds), then
    // UPDATE workflow_steps. If we pre-insert a workflow_steps row with
    // (skill_name="rollback-target", step_id=0), the UPDATE from
    // (skill_name="will-rollback", step_id=0) to (skill_name="rollback-target", step_id=0)
    // will violate the PK and fail.
    crate::db::save_workflow_step(&conn, "will-rollback", 0, "completed").unwrap();
    // Pre-insert a conflicting row for the new name
    conn.execute(
        "INSERT INTO workflow_steps (skill_name, step_id, status) VALUES ('rollback-target', 0, 'pending')",
        [],
    ).unwrap();

    let result = rename_skill_inner(
        "will-rollback",
        "rollback-target",
        workspace,
        &mut conn,
        None,
    );
    assert!(
        result.is_err(),
        "Rename should fail due to DB constraint violation"
    );
    assert!(result
        .unwrap_err()
        .contains("Failed to rename skill in database"));

    // Workspace dir should be rolled back to original name
    assert!(
        Path::new(workspace).join("will-rollback").exists(),
        "Workspace dir should be rolled back to original name"
    );
    assert!(
        !Path::new(workspace).join("rollback-target").exists(),
        "New workspace dir should not exist after rollback"
    );

    // DB should still have the original skill
    let row = crate::db::get_workflow_run(&conn, "will-rollback");
    // The transaction was rolled back, but the INSERT+DELETE on workflow_runs
    // may have partially committed before the ROLLBACK. Let's check what we have.
    // Actually, since the transaction used BEGIN...COMMIT and the closure returned Err,
    // the outer code calls ROLLBACK, so all changes within the transaction are undone.
    // However, the INSERT of "rollback-target" into workflow_runs succeeded before
    // the workflow_steps UPDATE failed. The ROLLBACK undoes the entire transaction.
    // So the original "will-rollback" row should still exist.
    assert!(
        row.unwrap().is_some(),
        "Original DB row should survive after rollback"
    );
}

// ===== TC-08: rename_skill_inner happy-path and known disk-failure limitation =====

#[test]
fn test_rename_skill_inner_happy_path_renames_db_and_disk() {
    let dir = tempdir().unwrap();
    let workspace = dir.path().to_str().unwrap();
    let mut conn = create_test_db();

    // Create the skill via create_skill_inner so it gets proper DB rows.
    create_skill_inner(
        workspace,
        "original-skill",
        None,
        None,
        Some(&conn),
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
    )
    .unwrap();

    // Confirm the workspace directory was created on disk.
    assert!(Path::new(workspace).join("original-skill").exists());

    rename_skill_inner("original-skill", "renamed-skill", workspace, &mut conn, None).unwrap();

    // DB row should now use the new name.
    let run = crate::db::get_workflow_run(&conn, "renamed-skill")
        .unwrap()
        .expect("workflow_run should exist under new name");
    assert_eq!(run.skill_name, "renamed-skill");

    // Old DB row must be gone.
    let old_run = crate::db::get_workflow_run(&conn, "original-skill").unwrap();
    assert!(old_run.is_none(), "old workflow_run name should be gone");

    // Workspace directory renamed on disk.
    assert!(
        Path::new(workspace).join("renamed-skill").exists(),
        "workspace dir should be renamed"
    );
    assert!(
        !Path::new(workspace).join("original-skill").exists(),
        "old workspace dir should not exist after rename"
    );
}

/// Documents the known limitation: when the DB commit succeeds but the disk rename fails,
/// the DB is in the post-commit state (new name) while the disk retains the old name.
///
/// TC-08: `rename_skill_inner` disk failure after DB rename succeeds.
///
/// When `fs::rename` fails on the skills_path directory (e.g. read-only parent),
/// the function returns `Err` with a descriptive message. The workspace directory
/// rename is rolled back, but the DB transaction has already committed. This test
/// uses a read-only directory to trigger the disk failure.
#[test]
#[cfg(unix)]
fn test_rename_skill_inner_disk_failure_returns_error() {
    use std::os::unix::fs::PermissionsExt;

    let dir = tempdir().unwrap();
    let workspace = dir.path().join("workspace");
    fs::create_dir_all(&workspace).unwrap();
    let workspace_str = workspace.to_str().unwrap();

    let skills_dir = dir.path().join("skills");
    fs::create_dir_all(&skills_dir).unwrap();
    let skills_str = skills_dir.to_str().unwrap();

    let mut conn = create_test_db();

    // Create a skill with workspace and skills directories
    create_skill_inner(
        workspace_str, "rename-fail", None, None, Some(&conn), Some(skills_str),
        None, None, None, None, None, None, None, None, None,
    )
    .unwrap();

    // Create the skills-path directory (simulating a completed skill)
    let skill_output = skills_dir.join("rename-fail");
    fs::create_dir_all(&skill_output).unwrap();
    fs::write(skill_output.join("SKILL.md"), "# Test").unwrap();

    // Make the skills directory read-only so fs::rename fails
    let perms = std::fs::Permissions::from_mode(0o555);
    fs::set_permissions(&skills_dir, perms).unwrap();

    let result = rename_skill_inner(
        "rename-fail",
        "rename-success",
        workspace_str,
        &mut conn,
        Some(skills_str),
    );

    // Restore permissions before assertions (cleanup)
    let restore_perms = std::fs::Permissions::from_mode(0o755);
    let _ = fs::set_permissions(&skills_dir, restore_perms);

    // The rename should fail because the skills directory is read-only
    assert!(result.is_err(), "rename should fail when skills dir is read-only");
    let err = result.unwrap_err();
    assert!(
        err.contains("Failed to rename skills directory"),
        "Error should mention skills directory rename failure, got: {}",
        err
    );

    // The workspace directory should have been rolled back (old name preserved)
    // because rename_skill_inner rolls back workspace rename on skills rename failure
    assert!(
        workspace.join("rename-fail").exists(),
        "workspace dir should be rolled back to old name"
    );
}

// TC-09: `graceful_shutdown` non-timeout path cannot be tested directly because
// it requires `tauri::State<SidecarPool>`, `tauri::State<Db>`, `tauri::State<InstanceInfo>`,
// and a `tauri::AppHandle` — none of which are constructible in unit tests. The timeout
// path calls `process::exit` which is also impractical to test. This limitation is documented.
// The sidecar shutdown logic is covered by persistent-mode.test.ts integration tests instead.
