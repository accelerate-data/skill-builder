use super::crud::{
    cleanup_openhands_conversations_with, create_skill_db_records_inner,
    create_skill_filesystem_inner, create_skill_inner, delete_skill_db_records_inner,
    delete_skill_filesystem_inner, delete_skill_inner, list_refinable_skills_inner,
    list_skills_inner, prepare_skill_runtime_shutdown_inner,
};
use super::metadata::{externally_locked_skills_log_message, is_valid_kebab, rename_skill_inner};
use crate::agents::runtime_config::OpenHandsRuntimeConfig;
use crate::commands::skill_session::{SkillSession, SkillSessionManager};
use crate::commands::test_utils::create_test_db;
use crate::commands::workflow::runtime::{WorkflowStepRun, WorkflowStepRunManager};
use crate::skill_paths::DEFAULT_PLUGIN_SLUG;
use crate::types::SecretString;
use rusqlite::Connection;
use std::fs;
use std::path::Path;
use std::sync::{Arc, Mutex};
use tempfile::tempdir;

/// Helper: canonical plugin-layout skill path: {root}/{DEFAULT_PLUGIN_SLUG}/skills/{name}/
fn nested_skill(root: &str, skill_name: &str) -> std::path::PathBuf {
    crate::skill_paths::resolve_skill_dir(Path::new(root), DEFAULT_PLUGIN_SLUG, skill_name)
}

/// Helper: plugin-organised skill path: {root}/{DEFAULT_PLUGIN_SLUG}/skills/{name}/
/// Use this for workspace assertions (workspace is now plugin-namespaced with canonical layout).
fn flat_skill(root: &str, skill_name: &str) -> std::path::PathBuf {
    crate::skill_paths::resolve_skill_dir(Path::new(root), DEFAULT_PLUGIN_SLUG, skill_name)
}

fn test_runtime_config() -> OpenHandsRuntimeConfig {
    OpenHandsRuntimeConfig {
        mode: None,
        prompt: "test".to_string(),
        system_prompt: None,
        model: None,
        llm: None,
        model_base_url: None,
        openhands_api_key: SecretString::new("test-key".to_string()),
        app_data_root: "/tmp/app-data".to_string(),
        skills_root: "/tmp/skills".to_string(),
        skill_dir: "/tmp/skills/default/skills/test-skill".to_string(),
        allowed_tools: None,
        max_turns: None,
        permission_mode: None,
        betas: None,
        thinking: None,
        output_format: None,
        prompt_suggestions: None,
        agent_name: Some("skill-creator".to_string()),
        required_plugins: None,
        setting_sources: None,
        conversation_history: None,
        skill_name: Some("test-skill".to_string()),
        step_id: None,
        usage_session_id: None,
        run_source: Some("workflow".to_string()),
        persistence_dir: None,
        plugin_slug: DEFAULT_PLUGIN_SLUG.to_string(),
        task_kind: Some("workflow.research".to_string()),
        user_message_suffix: None,
        system_message_suffix: None,
    }
}

// ===== list_skills_inner tests =====

#[test]
fn test_list_skills_db_primary_returns_db_records() {
    let conn = create_test_db();
    crate::db::save_workflow_run(&conn, "skill-a", 3, "in_progress", "domain").unwrap();
    crate::db::save_workflow_run(&conn, "skill-b", 0, "pending", "platform").unwrap();

    let skills = list_skills_inner(None, &conn).unwrap();
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
    let skills = list_skills_inner(None, &conn).unwrap();
    assert!(skills.is_empty());
}

#[test]
fn test_list_skills_db_primary_includes_tags() {
    let conn = create_test_db();
    crate::db::save_workflow_run(&conn, "tagged-skill", 2, "pending", "domain").unwrap();
    crate::db::set_skill_tags(
        &conn,
        "tagged-skill",
        crate::skill_paths::DEFAULT_PLUGIN_SLUG,
        &["analytics".into(), "salesforce".into()],
    )
    .unwrap();

    let skills = list_skills_inner(None, &conn).unwrap();
    assert_eq!(skills.len(), 1);
    assert_eq!(skills[0].tags, vec!["analytics", "salesforce"]);
}

#[test]
fn test_list_skills_db_primary_last_modified_from_db() {
    let conn = create_test_db();
    crate::db::save_workflow_run(&conn, "my-skill", 0, "pending", "domain").unwrap();

    let skills = list_skills_inner(None, &conn).unwrap();
    assert_eq!(skills.len(), 1);
    // last_modified should be populated from updated_at (not filesystem)
    assert!(skills[0].last_modified.is_some());
}

#[test]
fn test_list_skills_db_primary_no_filesystem_access_needed() {
    // This test proves that list_skills_inner works without any filesystem
    // by using a nonexistent path. The DB is the sole data source.
    let conn = create_test_db();
    crate::db::save_workflow_run(&conn, "no-disk-skill", 5, "completed", "source").unwrap();

    let skills = list_skills_inner(None, &conn).unwrap();
    assert_eq!(skills.len(), 1);
    assert_eq!(skills[0].name, "no-disk-skill");

    assert_eq!(skills[0].current_step.as_deref(), Some("Step 5"));
}

#[test]
fn test_list_skills_db_primary_sorted_by_created_at_desc() {
    let conn = create_test_db();
    // Insert skills with explicit created_at timestamps to guarantee ordering
    crate::db::save_workflow_run(&conn, "oldest", 0, "pending", "domain").unwrap();
    conn.execute(
        "UPDATE skills SET created_at = '2024-01-01T00:00:00Z' WHERE name = 'oldest'",
        [],
    )
    .unwrap();

    crate::db::save_workflow_run(&conn, "newest", 3, "in_progress", "domain").unwrap();
    conn.execute(
        "UPDATE skills SET created_at = '2024-06-01T00:00:00Z' WHERE name = 'newest'",
        [],
    )
    .unwrap();

    let skills = list_skills_inner(None, &conn).unwrap();
    assert_eq!(skills.len(), 2);
    // Sort is by created_at DESC — newest first
    assert_eq!(skills[0].name, "newest");
    assert_eq!(skills[1].name, "oldest");
}

#[test]
fn test_externally_locked_skills_log_message_is_silent_when_empty() {
    assert_eq!(externally_locked_skills_log_message(&[]), None);
}

#[test]
fn test_externally_locked_skills_log_message_includes_locked_ids() {
    assert_eq!(
        externally_locked_skills_log_message(&[7, 11]),
        Some("[get_externally_locked_skills] locked_skill_ids=[7, 11]".to_string())
    );
}

// ===== create + list integration =====

#[test]
fn test_create_and_list_skills_db_primary() {
    let dir = tempdir().unwrap();
    let skills_path = dir.path().to_str().unwrap();
    let conn = create_test_db();

    create_skill_inner(
        "my-skill",
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
    )
    .unwrap();

    let skills = list_skills_inner(None, &conn).unwrap();
    assert_eq!(skills.len(), 1);
    assert_eq!(skills[0].name, "my-skill");

    assert_eq!(skills[0].status.as_deref(), Some("pending"));
}

#[test]
fn test_create_skill_filesystem_phase_does_not_write_db_records() {
    let dir = tempdir().unwrap();
    let workspace = dir.path().join("workspace");
    let skills = dir.path().join("skills");
    let workspace_path = workspace.to_str().unwrap();
    let skills_path = skills.to_str().unwrap();
    let conn = create_test_db();

    create_skill_filesystem_inner("fs-only-skill", Some(skills_path)).unwrap();

    // context/ subdir is no longer created on skill creation (removed in VU-1157 aftermath).
    assert!(nested_skill(skills_path, "fs-only-skill")
        .join("references")
        .is_dir());
    assert!(crate::db::get_workflow_run_by_skill_id(&conn, 99999)
        .unwrap()
        .is_none());
}

#[test]
fn test_create_skill_db_phase_does_not_create_filesystem_dirs() {
    let dir = tempdir().unwrap();
    let workspace = dir.path().join("workspace");
    let skills = dir.path().join("skills");
    let workspace_path = workspace.to_str().unwrap();
    let skills_path = skills.to_str().unwrap();
    let conn = create_test_db();

    create_skill_db_records_inner(
        &conn,
        "db-only-skill",
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

    let skill_id: i64 = conn
        .query_row(
            "SELECT id FROM skills WHERE name = 'db-only-skill'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert!(crate::db::get_workflow_run_by_skill_id(&conn, skill_id)
        .unwrap()
        .is_some());
    assert!(!flat_skill(workspace_path, "db-only-skill").exists());
    assert!(!nested_skill(skills_path, "db-only-skill").exists());
}

#[test]
fn test_create_duplicate_skill() {
    let dir = tempdir().unwrap();
    let workspace = dir.path().to_str().unwrap();
    let skills = dir.path().join("skills");
    let skills_str = skills.to_str().unwrap();

    create_skill_inner(
        "dup-skill",
        None,
        None,
        None,
        Some(skills_str),
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
        "dup-skill",
        None,
        None,
        None,
        Some(skills_str),
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
fn test_delete_skill_filesystem_phase_does_not_delete_db_records() {
    let dir = tempdir().unwrap();
    let workspace = dir.path().join("workspace");
    let skills = dir.path().join("skills");
    let workspace_path = workspace.to_str().unwrap();
    let skills_path = skills.to_str().unwrap();
    let conn = create_test_db();

    create_skill_inner(
        "delete-fs-only",
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
    )
    .unwrap();

    delete_skill_filesystem_inner(
        "delete-fs-only",
        DEFAULT_PLUGIN_SLUG,
        Some(skills_path),
    )
    .unwrap();

    let skill_id: i64 = conn
        .query_row(
            "SELECT id FROM skills WHERE name = 'delete-fs-only'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert!(crate::db::get_workflow_run_by_skill_id(&conn, skill_id)
        .unwrap()
        .is_some());
    assert!(!flat_skill(workspace_path, "delete-fs-only").exists());
    assert!(!nested_skill(skills_path, "delete-fs-only").exists());
}

#[test]
fn test_delete_skill_db_phase_does_not_delete_filesystem_dirs() {
    let dir = tempdir().unwrap();
    let workspace = dir.path().join("workspace");
    let skills = dir.path().join("skills");
    let workspace_path = workspace.to_str().unwrap();
    let skills_path = skills.to_str().unwrap();
    let conn = create_test_db();

    create_skill_inner(
        "delete-db-only",
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
    )
    .unwrap();

    let skill_id: i64 = conn
        .query_row(
            "SELECT id FROM skills WHERE name = 'delete-db-only'",
            [],
            |row| row.get(0),
        )
        .unwrap();

    delete_skill_db_records_inner(&conn, "delete-db-only", DEFAULT_PLUGIN_SLUG).unwrap();

    assert!(crate::db::get_workflow_run_by_skill_id(&conn, skill_id)
        .unwrap()
        .is_none());
    assert!(nested_skill(skills_path, "delete-db-only").exists());
}

#[test]
fn test_prepare_skill_runtime_shutdown_cancels_managed_runs_and_ends_sessions() {
    let conn = create_test_db();
    let active_skill_id =
        crate::db::upsert_skill(&conn, "active-skill", "skill-builder", "domain").unwrap();
    let other_skill_id =
        crate::db::upsert_skill(&conn, "other-skill", "skill-builder", "domain").unwrap();
    crate::db::save_workflow_run(&conn, "active-skill", 0, "pending", "domain").unwrap();
    crate::db::create_workflow_session_by_skill_id(&conn, "sess-active", active_skill_id, 4321)
        .unwrap();
    crate::db::create_workflow_session_by_skill_id(&conn, "sess-other", other_skill_id, 4321)
        .unwrap();

    let workflow_runs = WorkflowStepRunManager::new();
    {
        let mut map = workflow_runs.0.lock().unwrap();
        map.insert(
            "workflow-agent".to_string(),
            WorkflowStepRun {
                skill_name: "active-skill".to_string(),
                conversation_id: None,
            },
        );
        map.insert(
            "other-agent".to_string(),
            WorkflowStepRun {
                skill_name: "other-skill".to_string(),
                conversation_id: None,
            },
        );
    }

    let refine_sessions = SkillSessionManager::new();
    {
        let mut map = refine_sessions.0.lock().unwrap();
        map.insert(
            "skill-builder::active-skill".to_string(),
            SkillSession {
                skill_name: "active-skill".to_string(),
                plugin_slug: DEFAULT_PLUGIN_SLUG.to_string(),
                usage_session_id: "usage-1".to_string(),
                conversation_id: Some("conversation-1".to_string()),
                current_agent_id: Some("refine-agent".to_string()),
                dispatched_user_turn_count: 0,
                head_sha_at_start: None,
            },
        );
        map.insert(
            "skill-builder::other-skill".to_string(),
            SkillSession {
                skill_name: "other-skill".to_string(),
                plugin_slug: DEFAULT_PLUGIN_SLUG.to_string(),
                usage_session_id: "usage-2".to_string(),
                conversation_id: Some("conversation-2".to_string()),
                current_agent_id: Some("other-refine-agent".to_string()),
                dispatched_user_turn_count: 0,
                head_sha_at_start: None,
            },
        );
    }

    let plan = prepare_skill_runtime_shutdown_inner(
        &conn,
        "active-skill",
        DEFAULT_PLUGIN_SLUG,
        &workflow_runs,
        &refine_sessions,
    )
    .unwrap();

    assert_eq!(plan.ended_workflow_sessions, 1);
    assert_eq!(plan.agent_ids.len(), 2);
    assert!(plan.agent_ids.contains(&"workflow-agent".to_string()));
    assert!(plan.agent_ids.contains(&"refine-agent".to_string()));

    let workflow_map = workflow_runs.0.lock().unwrap();
    assert!(!workflow_map.contains_key("workflow-agent"));
    assert!(workflow_map.contains_key("other-agent"));
    drop(workflow_map);

    let refine_map = refine_sessions.0.lock().unwrap();
    assert!(!refine_map.contains_key("skill-builder::active-skill"));
    assert!(refine_map.contains_key("skill-builder::other-skill"));
    drop(refine_map);

    let ended_active: Option<String> = conn
        .query_row(
            "SELECT ended_at FROM workflow_sessions WHERE session_id = 'sess-active'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert!(ended_active.is_some());

    let ended_other: Option<String> = conn
        .query_row(
            "SELECT ended_at FROM workflow_sessions WHERE session_id = 'sess-other'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert!(ended_other.is_none());
}

#[test]
fn test_prepare_skill_runtime_shutdown_tracks_agent_ids_not_conversation_ids() {
    let conn = create_test_db();
    crate::db::upsert_skill(&conn, "active-skill", "skill-builder", "domain").unwrap();
    crate::db::save_workflow_run(&conn, "active-skill", 0, "pending", "domain").unwrap();

    let workflow_runs = WorkflowStepRunManager::new();
    {
        let mut map = workflow_runs.0.lock().unwrap();
        map.insert(
            "workflow-agent".to_string(),
            WorkflowStepRun {
                skill_name: "active-skill".to_string(),
                conversation_id: Some("workflow-conversation".to_string()),
            },
        );
    }

    let refine_sessions = SkillSessionManager::new();
    {
        let mut map = refine_sessions.0.lock().unwrap();
        map.insert(
            "skill-builder::active-skill".to_string(),
            SkillSession {
                skill_name: "active-skill".to_string(),
                plugin_slug: DEFAULT_PLUGIN_SLUG.to_string(),
                usage_session_id: "usage-1".to_string(),
                conversation_id: Some("refine-conversation".to_string()),
                current_agent_id: Some("refine-agent".to_string()),
                dispatched_user_turn_count: 0,
                head_sha_at_start: None,
            },
        );
    }

    let plan = prepare_skill_runtime_shutdown_inner(
        &conn,
        "active-skill",
        DEFAULT_PLUGIN_SLUG,
        &workflow_runs,
        &refine_sessions,
    )
    .unwrap();

    assert!(plan.agent_ids.contains(&"workflow-agent".to_string()));
    assert!(plan.agent_ids.contains(&"refine-agent".to_string()));
    assert!(!plan.agent_ids.contains(&"workflow-conversation".to_string()));
    assert!(!plan.agent_ids.contains(&"refine-conversation".to_string()));
}

#[test]
fn test_cleanup_openhands_conversations_is_best_effort() {
    let rt = tokio::runtime::Runtime::new().unwrap();
    let events = Arc::new(Mutex::new(Vec::<String>::new()));
    let pause_events = Arc::clone(&events);
    let delete_events = Arc::clone(&events);
    let conversation_ids = vec!["conv-1".to_string(), "conv-2".to_string()];

    rt.block_on(cleanup_openhands_conversations_with(
        Ok(test_runtime_config()),
        &conversation_ids,
        move |_config, conversation_id| {
            let pause_events = Arc::clone(&pause_events);
            async move {
                pause_events
                    .lock()
                    .unwrap()
                    .push(format!("pause:{conversation_id}"));
                if conversation_id == "conv-1" {
                    Err("pause failed".to_string())
                } else {
                    Ok(())
                }
            }
        },
        move |_config, conversation_id| {
            let delete_events = Arc::clone(&delete_events);
            async move {
                delete_events
                    .lock()
                    .unwrap()
                    .push(format!("delete:{conversation_id}"));
                if conversation_id == "conv-2" {
                    Err("delete failed".to_string())
                } else {
                    Ok(())
                }
            }
        },
    ));

    assert_eq!(
        events.lock().unwrap().as_slice(),
        [
            "pause:conv-1",
            "delete:conv-1",
            "pause:conv-2",
            "delete:conv-2",
        ]
    );
}

#[test]
fn test_cleanup_openhands_conversations_skips_when_pause_config_fails() {
    let rt = tokio::runtime::Runtime::new().unwrap();
    let called = Arc::new(Mutex::new(false));
    let pause_called = Arc::clone(&called);
    let delete_called = Arc::clone(&called);
    let conversation_ids = vec!["conv-1".to_string()];

    rt.block_on(cleanup_openhands_conversations_with(
        Err("missing config".to_string()),
        &conversation_ids,
        move |_config, _conversation_id| {
            let pause_called = Arc::clone(&pause_called);
            async move {
                *pause_called.lock().unwrap() = true;
                Ok(())
            }
        },
        move |_config, _conversation_id| {
            let delete_called = Arc::clone(&delete_called);
            async move {
                *delete_called.lock().unwrap() = true;
                Ok(())
            }
        },
    ));

    assert!(!*called.lock().unwrap());
}

#[test]
fn test_create_skill_rejects_parent_dir_traversal() {
    let dir = tempdir().unwrap();
    let workspace = dir.path().to_str().unwrap();

    let result = create_skill_inner(
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
    );
    assert!(result.is_err());
}

#[test]
fn test_create_skill_rejects_path_separator() {
    let dir = tempdir().unwrap();
    let workspace = dir.path().to_str().unwrap();

    let result = create_skill_inner(
        "bad/name", None, None, None, None, None, None, None, None, None, None, None,
    );
    assert!(result.is_err());
}

#[test]
fn test_create_skill_rejects_empty_name() {
    let dir = tempdir().unwrap();
    let workspace = dir.path().to_str().unwrap();

    let result = create_skill_inner(
        "", None, None, None, None, None, None, None, None, None, None, None,
    );
    assert!(result.is_err());
}

#[test]
fn test_create_skill_rejects_single_dot() {
    let dir = tempdir().unwrap();
    let workspace = dir.path().to_str().unwrap();

    let result = create_skill_inner(
        ".", None, None, None, None, None, None, None, None, None, None, None,
    );
    assert!(result.is_err());
}

#[test]
fn test_delete_skill_workspace_only() {
    let dir = tempdir().unwrap();
    let skills_path = dir.path().to_str().unwrap();
    let conn = create_test_db();

    create_skill_inner(
        "to-delete",
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
    )
    .unwrap();

    let skills = list_skills_inner(None, &conn).unwrap();
    assert_eq!(skills.len(), 1);

    delete_skill_inner(
        "to-delete",
        DEFAULT_PLUGIN_SLUG,
        Some(&conn),
        Some(skills_path),
    )
    .unwrap();

    // DB should be clean
    let skills = list_skills_inner(None, &conn).unwrap();
    assert_eq!(skills.len(), 0);

    // Filesystem should be clean
    assert!(!flat_skill(skills_path, "to-delete").exists());
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
    )
    .unwrap();

    // Simulate skill output in skills_path (as would happen after build step, nested under default plugin)
    let output_dir = nested_skill(skills_path, "full-delete");
    fs::create_dir_all(output_dir.join("references")).unwrap();
    fs::write(output_dir.join("SKILL.md"), "# Skill").unwrap();

    // Capture skill_id before deletion
    let skill_id: i64 = conn
        .query_row(
            "SELECT id FROM skills WHERE name = 'full-delete'",
            [],
            |row| row.get(0),
        )
        .unwrap();

    delete_skill_inner(
        "full-delete",
        DEFAULT_PLUGIN_SLUG,
        Some(&conn),
        Some(skills_path),
    )
    .unwrap();

    // Skills output dir should be gone
    assert!(!output_dir.exists());
    // DB should be clean
    assert!(crate::db::get_workflow_run_by_skill_id(&conn, skill_id)
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
    )
    .unwrap();

    // Add workflow steps (save_workflow_step_by_skill_id populates workflow_run_id FK automatically)
    let skill_id: i64 = conn
        .query_row(
            "SELECT id FROM skills WHERE name = 'db-cleanup'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    crate::db::save_workflow_step_by_skill_id(&conn, skill_id, 0, "completed").unwrap();

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

    delete_skill_inner(
        "db-cleanup",
        DEFAULT_PLUGIN_SLUG,
        Some(&conn),
        None,
    )
    .unwrap();

    // Verify all DB records are cleaned up
    assert!(crate::db::get_workflow_run_by_skill_id(&conn, skill_id)
        .unwrap()
        .is_none());
    assert!(crate::db::get_workflow_steps_by_skill_id(&conn, skill_id)
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

    // Only create skill output, no workspace dir (canonical plugin layout)
    let output_dir = nested_skill(skills_path, "orphan-output");
    fs::create_dir_all(output_dir.join("references")).unwrap();
    fs::write(output_dir.join("SKILL.md"), "# Skill").unwrap();

    // Add DB record
    let orphan_skill_id =
        crate::db::upsert_skill(&conn, "orphan-output", "skill-builder", "domain").unwrap();
    crate::db::save_workflow_run_by_skill_id(&conn, orphan_skill_id, 7, "completed", "domain")
        .unwrap();

    delete_skill_inner(
        "orphan-output",
        DEFAULT_PLUGIN_SLUG,
        Some(&conn),
        Some(skills_path),
    )
    .unwrap();

    // Skills output should be deleted
    assert!(!output_dir.exists());
    // DB should be clean
    assert!(
        crate::db::get_workflow_run_by_skill_id(&conn, orphan_skill_id)
            .unwrap()
            .is_none()
    );
}

#[test]
fn test_delete_skill_no_workspace_dir_no_output() {
    // Neither workspace dir nor skills output exists — just DB cleanup
    let dir = tempdir().unwrap();
    let workspace = dir.path().to_str().unwrap();
    let conn = create_test_db();

    let ghost_skill_id =
        crate::db::upsert_skill(&conn, "ghost", "skill-builder", "domain").unwrap();
    crate::db::save_workflow_run_by_skill_id(&conn, ghost_skill_id, 3, "pending", "domain")
        .unwrap();

    delete_skill_inner("ghost", DEFAULT_PLUGIN_SLUG, Some(&conn), None).unwrap();

    assert!(
        crate::db::get_workflow_run_by_skill_id(&conn, ghost_skill_id)
            .unwrap()
            .is_none()
    );
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
    )
    .unwrap();

    // Attempt to delete using enough ".." segments to escape the canonical
    // workspace path workspace/{plugin}/skills/{skill}.
    let result = delete_skill_inner(
        "../../../outside-target",
        DEFAULT_PLUGIN_SLUG,
        None,
        None,
    );
    assert!(result.is_err(), "Directory traversal should be rejected");

    // The outside directory should still exist (not deleted)
    assert!(outside_dir.exists());
}

#[test]
fn test_delete_skill_skills_path_directory_traversal() {
    let dir = tempdir().unwrap();
    let skills_base = dir.path().join("skills");
    fs::create_dir_all(&skills_base).unwrap();
    // Create the plugin slug subdirectory so that path traversal via
    // "../../outside-target" resolves on all platforms. On Linux/macOS the
    // kernel traverses directories component-by-component and cannot resolve
    // ".." through a non-existent intermediate.
    fs::create_dir_all(skills_base.join(DEFAULT_PLUGIN_SLUG)).unwrap();
    let skills_path = skills_base.to_str().unwrap();

    let workspace_dir = tempdir().unwrap();
    let workspace = workspace_dir.path().to_str().unwrap();

    // Create a directory OUTSIDE the skills_path that a traversal attack would target
    let outside_dir = dir.path().join("outside-target");
    fs::create_dir_all(&outside_dir).unwrap();

    // Attempt to delete using enough ".." segments to escape the canonical
    // library path {root}/{plugin_slug}/skills/{skill}.
    let result = delete_skill_inner(
        "../../../outside-target",
        DEFAULT_PLUGIN_SLUG,
        None,
        Some(skills_path),
    );
    assert!(
        result.is_err(),
        "Directory traversal on skills_path should be rejected"
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

    let result = delete_skill_inner("no-such-skill", DEFAULT_PLUGIN_SLUG, None, None);
    assert!(result.is_ok());
}

#[test]
fn test_delete_skill_inner_marketplace_skill_routes_to_imported_path() {
    let dir = tempdir().unwrap();
    let workspace = dir.path().to_str().unwrap();
    let conn = create_test_db();

    // Insert a skills master row with source="marketplace" (no workflow_run)
    let mkt_skill_id =
        crate::db::upsert_skill(&conn, "mkt-skill", "marketplace", "domain").unwrap();
    // Insert corresponding imported_skills row
    conn.execute(
        "INSERT INTO imported_skills (skill_id, skill_name, disk_path, is_bundled, skill_master_id)
         VALUES ('mkt-id', 'mkt-skill', '/tmp/mkt-skill', 0,
                 (SELECT id FROM skills WHERE name = 'mkt-skill'))",
        [],
    )
    .unwrap();

    // Verify setup: no workflow_run, but skills + imported_skills rows exist
    let wf_id = crate::db::get_workflow_run_id_by_skill_id(&conn, mkt_skill_id).unwrap();
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

    crate::db::save_skill_conversation_id(&conn, DEFAULT_PLUGIN_SLUG, "mkt-skill", "conv-mkt")
        .unwrap();

    // Delete via delete_skill_inner
    delete_skill_inner(
        "mkt-skill",
        DEFAULT_PLUGIN_SLUG,
        Some(&conn),
        None,
    )
    .unwrap();

    // skills master row is removed and imported_skills row is removed
    let skill_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM skills WHERE name = 'mkt-skill'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(skill_count, 0, "skills master row should be deleted");

    let imported_after: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM imported_skills WHERE skill_name = 'mkt-skill'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(imported_after, 0, "imported_skills row should be deleted");
    assert_eq!(
        crate::db::get_skill_conversation_id(&conn, DEFAULT_PLUGIN_SLUG, "mkt-skill").unwrap(),
        None,
        "persisted skill conversation should be cleared"
    );
}

#[test]
fn test_delete_skill_inner_skill_builder_routes_to_workflow_path() {
    let dir = tempdir().unwrap();
    let workspace = dir.path().to_str().unwrap();
    let conn = create_test_db();

    // create_skill_inner inserts into skills (skill_source="skill-builder") + workflow_runs
    create_skill_inner(
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
    )
    .unwrap();

    // Verify setup: workflow_run exists
    let builder_skill_id: i64 = conn
        .query_row(
            "SELECT id FROM skills WHERE name = 'builder-skill'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    let wf_id = crate::db::get_workflow_run_id_by_skill_id(&conn, builder_skill_id).unwrap();
    assert!(
        wf_id.is_some(),
        "skill-builder skill should have workflow_run"
    );

    delete_skill_inner(
        "builder-skill",
        DEFAULT_PLUGIN_SLUG,
        Some(&conn),
        None,
    )
    .unwrap();

    // workflow_runs row should be gone
    let wf_after = crate::db::get_workflow_run_by_skill_id(&conn, builder_skill_id).unwrap();
    assert!(wf_after.is_none(), "workflow_run should be deleted");

    // skills master row should be deleted
    let skill_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM skills WHERE name = 'builder-skill'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(skill_count, 0, "skills master row should be deleted");
}

#[test]
fn test_rename_skill_inner_updates_imported_skills_name() {
    let dir = tempdir().unwrap();
    let workspace = dir.path().to_str().unwrap();
    let mut conn = create_test_db();

    // Insert a skills master row (imported source)
    crate::db::upsert_skill(&conn, "imp-skill", "imported", "domain").unwrap();
    // Insert imported_skills row
    conn.execute(
        "INSERT INTO imported_skills (skill_id, skill_name, disk_path, is_bundled, skill_master_id)
         VALUES ('imp-id', 'imp-skill', '/tmp/imp-skill', 0,
                 (SELECT id FROM skills WHERE name = 'imp-skill'))",
        [],
    )
    .unwrap();

    rename_skill_inner("imp-skill", "imp-skill-renamed", &mut conn, None).unwrap();

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
fn test_create_skill_collision_in_skills_path() {
    let dir = tempdir().unwrap();
    let workspace = dir.path().to_str().unwrap();
    let skills_dir = tempdir().unwrap();
    let skills_path = skills_dir.path().to_str().unwrap();

    // Create the skill directory in skills_path manually (simulating a pre-existing output dir)
    fs::create_dir_all(nested_skill(skills_path, "colliding-skill")).unwrap();

    let result = create_skill_inner(
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
    );
    assert!(result.is_err());
    let err = result.unwrap_err();
    assert!(
        err.contains("already exists"),
        "Error should mention 'already exists': {}",
        err
    );
    assert!(
        err.contains("skills directory"),
        "Error should mention 'skills directory': {}",
        err
    );
}

#[test]
fn test_create_skill_recreates_stale_skill_dir_when_db_row_missing() {
    let dir = tempdir().unwrap();
    let workspace = dir.path().to_str().unwrap();
    let skills_dir = tempdir().unwrap();
    let skills_path = skills_dir.path().to_str().unwrap();
    let conn = create_test_db();

    let stale_skill = nested_skill(skills_path, "stale-skill");
    fs::create_dir_all(stale_skill.join("conversations")).unwrap();
    fs::write(
        stale_skill.join("conversations").join("leftover.txt"),
        "stale",
    )
    .unwrap();

    create_skill_inner(
        "stale-skill",
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
    )
    .unwrap();

    assert!(nested_skill(skills_path, "stale-skill").exists());
    assert!(
        !nested_skill(skills_path, "stale-skill")
            .join("conversations")
            .join("leftover.txt")
            .exists(),
        "stale skill dir contents should be replaced"
    );
    let stale_skill_id: i64 = conn
        .query_row(
            "SELECT id FROM skills WHERE name = 'stale-skill'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert!(
        crate::db::get_workflow_run_by_skill_id(&conn, stale_skill_id)
            .unwrap()
            .is_some()
    );
}

#[test]
fn test_create_skill_recreates_stale_output_dir_when_db_row_missing() {
    let dir = tempdir().unwrap();
    let workspace = dir.path().to_str().unwrap();
    let skills_dir = tempdir().unwrap();
    let skills_path = skills_dir.path().to_str().unwrap();
    let conn = create_test_db();

    let stale_output = nested_skill(skills_path, "stale-output");
    fs::create_dir_all(stale_output.join("conversations")).unwrap();
    fs::write(stale_output.join("SKILL.md"), "stale").unwrap();

    create_skill_inner(
        "stale-output",
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
    )
    .unwrap();

    assert!(nested_skill(skills_path, "stale-output").exists());
    assert!(
        nested_skill(skills_path, "stale-output")
            .join("references")
            .is_dir(),
        "fresh output layout should be recreated"
    );
    let skill_md = nested_skill(skills_path, "stale-output").join("SKILL.md");
    assert!(
        !skill_md.exists(),
        "stale output contents should be replaced by a fresh directory scaffold"
    );
    let stale_skill_id: i64 = conn
        .query_row(
            "SELECT id FROM skills WHERE name = 'stale-output'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert!(
        crate::db::get_workflow_run_by_skill_id(&conn, stale_skill_id)
            .unwrap()
            .is_some()
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
    );
    assert!(result.is_ok());

    // Verify skill output directories were created in skills_path (nested under default plugin)
    let skill_output = nested_skill(skills_path, "new-skill");
    assert!(skill_output.join("references").exists());
}

#[test]
fn test_delete_skill_removes_logs_directory() {
    let dir = tempdir().unwrap();
    let skills_path = dir.path().to_str().unwrap();

    // Create a skill with skills_path
    create_skill_inner(
        "skill-with-logs",
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
    )
    .unwrap();

    // Add a logs/ subdirectory with a fake log file inside the skill directory (nested)
    let skill_dir = nested_skill(skills_path, "skill-with-logs");
    let logs_dir = skill_dir.join("logs");
    fs::create_dir_all(&logs_dir).unwrap();
    fs::write(logs_dir.join("step-0.log"), "fake log content for step 0").unwrap();
    fs::write(logs_dir.join("step-1.log"), "fake log content for step 1").unwrap();

    // Verify the logs directory and files exist before deletion
    assert!(logs_dir.exists());
    assert!(logs_dir.join("step-0.log").exists());
    assert!(logs_dir.join("step-1.log").exists());

    // Delete the skill
    delete_skill_inner(
        "skill-with-logs",
        DEFAULT_PLUGIN_SLUG,
        None,
        Some(skills_path),
    )
    .unwrap();

    // Verify the entire skill directory (including logs/) is gone
    assert!(!skill_dir.exists(), "skill directory should be removed");
    assert!(!logs_dir.exists(), "logs directory should be removed");
}

// ===== update_skill_metadata tests =====

/// Helper: create a skill in the DB for metadata update tests. Returns skill_id.
fn setup_skill_for_metadata(conn: &Connection, name: &str) -> i64 {
    crate::db::save_workflow_run(conn, name, 0, "pending", "domain").unwrap();
    crate::db::get_skill_master_id_in_plugin(conn, name, crate::skill_paths::DEFAULT_PLUGIN_SLUG)
        .unwrap()
        .unwrap()
}

#[test]
fn test_update_metadata_display_name() {
    let conn = create_test_db();
    let skill_id = setup_skill_for_metadata(&conn, "meta-skill");

    crate::db::set_skill_display_name(&conn, "meta-skill", Some("Pretty Name")).unwrap();

    let row = crate::db::get_workflow_run_by_skill_id(&conn, skill_id)
        .unwrap()
        .unwrap();
    assert_eq!(row.display_name.as_deref(), Some("Pretty Name"));
}

#[test]
fn test_update_metadata_skill_type() {
    let conn = create_test_db();
    let skill_id = setup_skill_for_metadata(&conn, "type-skill");

    conn.execute(
        "UPDATE workflow_runs SET purpose = ?2, updated_at = datetime('now') || 'Z' WHERE skill_name = ?1",
        rusqlite::params!["type-skill", "platform"],
    ).unwrap();

    let row = crate::db::get_workflow_run_by_skill_id(&conn, skill_id)
        .unwrap()
        .unwrap();
    assert_eq!(row.purpose, "platform");
}

#[test]
fn test_update_metadata_tags() {
    let conn = create_test_db();
    setup_skill_for_metadata(&conn, "tag-skill");

    crate::db::set_skill_tags(
        &conn,
        "tag-skill",
        crate::skill_paths::DEFAULT_PLUGIN_SLUG,
        &["rust".into(), "wasm".into()],
    )
    .unwrap();

    let tags = crate::db::get_tags_for_skills(&conn, &["tag-skill".into()]).unwrap();
    assert_eq!(tags.get("tag-skill").unwrap(), &["rust", "wasm"]);
}

#[test]
fn test_update_metadata_intake_json() {
    let conn = create_test_db();
    let skill_id = setup_skill_for_metadata(&conn, "intake-skill");

    let json = r#"{"audience":"Engineers","challenges":"Scale","scope":"Backend"}"#;
    crate::db::set_skill_intake(&conn, "intake-skill", Some(json)).unwrap();

    let row = crate::db::get_workflow_run_by_skill_id(&conn, skill_id)
        .unwrap()
        .unwrap();
    assert_eq!(row.intake_json.as_deref(), Some(json));
}

#[test]
fn test_update_metadata_all_fields() {
    let conn = create_test_db();
    let skill_id = setup_skill_for_metadata(&conn, "full-meta");

    crate::db::set_skill_display_name(&conn, "full-meta", Some("Full Metadata")).unwrap();
    conn.execute(
        "UPDATE workflow_runs SET purpose = ?2, updated_at = datetime('now') || 'Z' WHERE skill_name = ?1",
        rusqlite::params!["full-meta", "source"],
    ).unwrap();
    crate::db::set_skill_tags(
        &conn,
        "full-meta",
        crate::skill_paths::DEFAULT_PLUGIN_SLUG,
        &["api".into(), "rest".into()],
    )
    .unwrap();
    crate::db::set_skill_intake(&conn, "full-meta", Some(r#"{"audience":"Devs"}"#)).unwrap();

    let row = crate::db::get_workflow_run_by_skill_id(&conn, skill_id)
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

    // Create a completed skill with SKILL.md on disk (canonical plugin layout)
    crate::db::save_workflow_run(&conn, "ready-skill", 7, "completed", "domain").unwrap();
    let skill_dir = nested_skill(skills_path, "ready-skill");
    fs::create_dir_all(&skill_dir).unwrap();
    fs::write(skill_dir.join("SKILL.md"), "# Ready").unwrap();

    // Create an in-progress skill (should be excluded)
    crate::db::save_workflow_run(&conn, "wip-skill", 3, "in_progress", "domain").unwrap();

    let result = list_refinable_skills_inner(skills_path, &conn).unwrap();
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

    let result = list_refinable_skills_inner(skills_path, &conn).unwrap();
    assert!(result.is_empty());
}

#[test]
fn test_list_refinable_skills_empty_db() {
    let dir = tempdir().unwrap();
    let skills_path = dir.path().to_str().unwrap();
    let conn = create_test_db();

    let result = list_refinable_skills_inner(skills_path, &conn).unwrap();
    assert!(result.is_empty());
}

#[test]
fn test_update_metadata_nonexistent_skill_is_noop() {
    let conn = create_test_db();

    // These should succeed (UPDATE affects 0 rows, no error)
    crate::db::set_skill_display_name(&conn, "ghost", Some("Name")).unwrap();
    crate::db::set_skill_intake(&conn, "ghost", Some("{}")).unwrap();

    // set_skill_tags now requires a skills master row — returns Err for unknown skills
    let result = crate::db::set_skill_tags(
        &conn,
        "ghost",
        crate::skill_paths::DEFAULT_PLUGIN_SLUG,
        &["tag".into()],
    );
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("not found in plugin"));

    // No row should exist
    assert!(crate::db::get_workflow_run_by_skill_id(&conn, 99999)
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

    create_skill_inner(
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
    )
    .unwrap();
    let old_skill_id =
        crate::db::get_skill_master_id_in_plugin(&conn, "old-name", DEFAULT_PLUGIN_SLUG)
            .unwrap()
            .unwrap();
    crate::db::save_workflow_step_by_skill_id(&conn, old_skill_id, 0, "completed").unwrap();
    crate::db::save_skill_conversation_id(&conn, DEFAULT_PLUGIN_SLUG, "old-name", "conv-old")
        .unwrap();

    rename_skill_inner(
        "old-name",
        "new-name",
        &mut conn,
        Some(skills_path),
    )
    .unwrap();

    assert!(!nested_skill(skills_path, "old-name").exists());
    assert!(nested_skill(skills_path, "new-name").exists());

    // After rename, the skill_id is the same but the name changed.
    let row = crate::db::get_workflow_run_by_skill_id(&conn, old_skill_id)
        .unwrap()
        .unwrap();
    assert_eq!(row.skill_name, "new-name");

    assert_eq!(row.purpose, "domain");

    let tags = crate::db::get_tags_for_skills(&conn, &["new-name".into()]).unwrap();
    let new_tags = tags.get("new-name").unwrap();
    assert!(new_tags.contains(&"tag-a".to_string()));
    assert!(new_tags.contains(&"tag-b".to_string()));
    let old_tags = crate::db::get_tags_for_skills(&conn, &["old-name".into()]).unwrap();
    assert!(old_tags.get("old-name").is_none());

    let steps = crate::db::get_workflow_steps_by_skill_id(&conn, old_skill_id).unwrap();
    assert_eq!(steps.len(), 1);
    assert_eq!(
        crate::db::get_skill_conversation_id(&conn, DEFAULT_PLUGIN_SLUG, "old-name").unwrap(),
        None
    );
    assert_eq!(
        crate::db::get_skill_conversation_id(&conn, DEFAULT_PLUGIN_SLUG, "new-name").unwrap(),
        Some("conv-old".to_string())
    );
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
    )
    .unwrap();
    create_skill_inner(
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
    )
    .unwrap();

    // Attempt to rename skill-a to skill-b (collision)
    let result = rename_skill_inner("skill-a", "skill-b", &mut conn, None);
    assert!(result.is_err());
    let err = result.unwrap_err();
    assert!(
        err.contains("already exists"),
        "Error should mention collision: {}",
        err
    );

    // Original skill should be untouched
    let skill_a_id =
        crate::db::get_skill_master_id_in_plugin(&conn, "skill-a", DEFAULT_PLUGIN_SLUG)
            .unwrap()
            .unwrap();
    let row = crate::db::get_workflow_run_by_skill_id(&conn, skill_a_id).unwrap();
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
    )
    .unwrap();

    // rename_skill_inner with same name hits the "already exists" check in DB,
    // confirming the early-return in the wrapper is necessary.
    let result = rename_skill_inner("same-name", "same-name", &mut conn, None);
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
    )
    .unwrap();

    let will_rollback_id =
        crate::db::get_skill_master_id_in_plugin(&conn, "will-rollback", DEFAULT_PLUGIN_SLUG)
            .unwrap()
            .unwrap();

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
    crate::db::save_workflow_step_by_skill_id(&conn, will_rollback_id, 0, "completed").unwrap();
    // Pre-insert a conflicting row for the new name
    conn.execute(
        "INSERT INTO workflow_steps (skill_name, step_id, status) VALUES ('rollback-target', 0, 'pending')",
        [],
    ).unwrap();

    let result = rename_skill_inner(
        "will-rollback",
        "rollback-target",
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

    let row = crate::db::get_workflow_run_by_skill_id(&conn, will_rollback_id);
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
    let skills_dir = tempdir().unwrap();
    let skills_path = skills_dir.path().to_str().unwrap();
    let mut conn = create_test_db();

    // Create the skill via create_skill_inner so it gets proper DB rows.
    create_skill_inner(
        "original-skill",
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
    )
    .unwrap();

    // Confirm the skills output directory was created on disk.
    assert!(nested_skill(skills_path, "original-skill").exists());

    rename_skill_inner(
        "original-skill",
        "renamed-skill",
        &mut conn,
        Some(skills_path),
    )
    .unwrap();

    // DB row should now use the new name.
    let renamed_skill_id =
        crate::db::get_skill_master_id_in_plugin(&conn, "renamed-skill", DEFAULT_PLUGIN_SLUG)
            .unwrap()
            .unwrap();
    let run = crate::db::get_workflow_run_by_skill_id(&conn, renamed_skill_id)
        .unwrap()
        .expect("workflow_run should exist under new name");
    assert_eq!(run.skill_name, "renamed-skill");

    // Old DB row must be gone — skill was renamed, so lookup by old name returns None.
    let old_skill_lookup =
        crate::db::get_skill_master_id_in_plugin(&conn, "original-skill", DEFAULT_PLUGIN_SLUG);
    match old_skill_lookup {
        Ok(Some(id)) => assert!(
            crate::db::get_workflow_run_by_skill_id(&conn, id)
                .unwrap()
                .is_none(),
            "old workflow_run should be gone"
        ),
        _ => {} // Skill no longer exists under old name — expected
    }

    // Skills output directory renamed on disk.
    assert!(
        nested_skill(skills_path, "renamed-skill").exists(),
        "skills dir should be renamed"
    );
    assert!(
        !nested_skill(skills_path, "original-skill").exists(),
        "old skills dir should not exist after rename"
    );
}

/// Documents the known limitation: when the DB commit succeeds but the disk rename fails,
/// the DB is in the post-commit state (new name) while the disk retains the old name.
///
/// TC-08: `rename_skill_inner` disk failure after DB rename succeeds.
///
/// When `fs::rename` fails on the skills_path directory (e.g. target already exists),
/// the function returns `Err` with a descriptive message. The workspace directory
/// rename is rolled back, but the DB transaction has already committed. This test
/// uses a pre-existing non-empty target directory to trigger the disk failure.
#[cfg(unix)]
#[test]
#[cfg(unix)]
fn test_rename_skill_inner_disk_failure_returns_error() {
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
        "rename-fail",
        None,
        None,
        Some(&conn),
        Some(skills_str),
        None,
        None,
        None,
        None,
        None,
        None,
        None,
    )
    .unwrap();

    // Create the canonical skills-path directory for the existing skill and a
    // conflicting non-empty target directory for the new name.
    let skill_output = nested_skill(skills_str, "rename-fail");
    fs::create_dir_all(&skill_output).unwrap();
    fs::write(skill_output.join("SKILL.md"), "# Test").unwrap();
    let conflicting_target = nested_skill(skills_str, "rename-success");
    fs::create_dir_all(&conflicting_target).unwrap();
    fs::write(conflicting_target.join("SKILL.md"), "# Existing").unwrap();

    let result = rename_skill_inner(
        "rename-fail",
        "rename-success",
        &mut conn,
        Some(skills_str),
    );

    // The rename should fail because the target directory already exists.
    assert!(
        result.is_err(),
        "rename should fail when the target skills dir already exists"
    );
    let err = result.unwrap_err();
    assert!(
        err.contains("Failed to rename skills directory"),
        "Error should mention skills directory rename failure, got: {}",
        err
    );

    // DB was already committed (new name), but skills dir rename was rolled back.
    let renamed_skill_id =
        crate::db::get_skill_master_id_in_plugin(&conn, "rename-success", DEFAULT_PLUGIN_SLUG)
            .unwrap()
            .unwrap();
    assert!(
        crate::db::get_workflow_run_by_skill_id(&conn, renamed_skill_id)
            .unwrap()
            .is_some(),
        "DB should have the new name (committed before disk failure)"
    );
    assert!(
        nested_skill(skills_str, "rename-fail").exists(),
        "skills dir should retain old name after rollback"
    );
}

// TC-09: `graceful_shutdown` non-timeout path cannot be tested directly because
// it requires `tauri::State<Db>`, `tauri::State<InstanceInfo>`, and a `tauri::AppHandle`
// — none of which are constructible in unit tests. The timeout path calls `process::exit`
// which is also impractical to test. This limitation is documented.
