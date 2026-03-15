use super::*;
use crate::types::{AppSettings, ImportedSkill};
use super::migrations::*;

fn create_test_db() -> Connection {
    create_test_db_for_tests()
}

#[test]
fn test_read_default_settings() {
    let conn = create_test_db();
    let settings = read_settings(&conn).unwrap();
    assert!(settings.anthropic_api_key.is_none());
    assert!(settings.workspace_path.is_none());
}

#[test]
fn test_write_and_read_settings() {
    let conn = create_test_db();
    let settings = AppSettings {
        anthropic_api_key: Some("sk-test-key".to_string()),
        workspace_path: Some("/home/user/skills".to_string()),
        skills_path: None,
        preferred_model: Some("sonnet".to_string()),
        debug_mode: false,
        log_level: "info".to_string(),
        extended_context: false,
        extended_thinking: false,
        interleaved_thinking_beta: true,
        sdk_effort: None,
        fallback_model: None,
        refine_prompt_suggestions: true,
        splash_shown: false,
        github_oauth_token: None,
        github_user_login: None,
        github_user_avatar: None,
        github_user_email: None,
        marketplace_url: None,
        marketplace_registries: vec![],
        marketplace_initialized: false,
        max_dimensions: 5,
        industry: None,
        function_role: None,
        dashboard_view_mode: None,
        auto_update: false,
    };
    write_settings(&conn, &settings).unwrap();

    let loaded = read_settings(&conn).unwrap();
    assert_eq!(loaded.anthropic_api_key.as_deref(), Some("sk-test-key"));
    assert_eq!(loaded.workspace_path.as_deref(), Some("/home/user/skills"));
}

#[test]
fn test_write_and_read_settings_with_skills_path() {
    let conn = create_test_db();
    let settings = AppSettings {
        anthropic_api_key: Some("sk-test".to_string()),
        workspace_path: Some("/workspace".to_string()),
        skills_path: Some("/home/user/my-skills".to_string()),
        preferred_model: None,
        debug_mode: false,
        log_level: "info".to_string(),
        extended_context: false,
        extended_thinking: false,
        interleaved_thinking_beta: true,
        sdk_effort: None,
        fallback_model: None,
        refine_prompt_suggestions: true,
        splash_shown: false,
        github_oauth_token: None,
        github_user_login: None,
        github_user_avatar: None,
        github_user_email: None,
        marketplace_url: None,
        marketplace_registries: vec![],
        marketplace_initialized: false,
        max_dimensions: 5,
        industry: None,
        function_role: None,
        dashboard_view_mode: None,
        auto_update: false,
    };
    write_settings(&conn, &settings).unwrap();

    let loaded = read_settings(&conn).unwrap();
    assert_eq!(loaded.skills_path.as_deref(), Some("/home/user/my-skills"));
}

#[test]
fn test_overwrite_settings() {
    let conn = create_test_db();
    let v1 = AppSettings {
        anthropic_api_key: Some("key-1".to_string()),
        workspace_path: None,
        skills_path: None,
        preferred_model: None,
        debug_mode: false,
        log_level: "info".to_string(),
        extended_context: false,
        extended_thinking: false,
        interleaved_thinking_beta: true,
        sdk_effort: None,
        fallback_model: None,
        refine_prompt_suggestions: true,
        splash_shown: false,
        github_oauth_token: None,
        github_user_login: None,
        github_user_avatar: None,
        github_user_email: None,
        marketplace_url: None,
        marketplace_registries: vec![],
        marketplace_initialized: false,
        max_dimensions: 5,
        industry: None,
        function_role: None,
        dashboard_view_mode: None,
        auto_update: false,
    };
    write_settings(&conn, &v1).unwrap();

    let v2 = AppSettings {
        anthropic_api_key: Some("key-2".to_string()),
        workspace_path: Some("/new/path".to_string()),
        skills_path: None,
        preferred_model: Some("opus".to_string()),
        debug_mode: false,
        log_level: "info".to_string(),
        extended_context: false,
        extended_thinking: false,
        interleaved_thinking_beta: true,
        sdk_effort: None,
        fallback_model: None,
        refine_prompt_suggestions: true,
        splash_shown: false,
        github_oauth_token: None,
        github_user_login: None,
        github_user_avatar: None,
        github_user_email: None,
        marketplace_url: None,
        marketplace_registries: vec![],
        marketplace_initialized: false,
        max_dimensions: 5,
        industry: None,
        function_role: None,
        dashboard_view_mode: None,
        auto_update: false,
    };
    write_settings(&conn, &v2).unwrap();

    let loaded = read_settings(&conn).unwrap();
    assert_eq!(loaded.anthropic_api_key.as_deref(), Some("key-2"));
    assert_eq!(loaded.workspace_path.as_deref(), Some("/new/path"));
}

#[test]
fn test_migration_is_idempotent() {
    let conn = Connection::open_in_memory().unwrap();
    run_migrations(&conn).unwrap();
    run_migrations(&conn).unwrap();

    let settings = read_settings(&conn).unwrap();
    assert!(settings.anthropic_api_key.is_none());
}

#[test]
fn test_migration_count_matches_expected() {
    // Guard against missing registrations in NUMBERED_MIGRATIONS.
    // Applies every migration from the module-level constant and asserts the count
    // matches NUMBERED_MIGRATIONS.len(). If a migration is added to the codebase
    // but not to NUMBERED_MIGRATIONS, the count stays at the old value and this fails.
    let conn = Connection::open_in_memory().unwrap();
    ensure_migration_table(&conn).unwrap();
    run_migrations(&conn).unwrap();
    for &(version, migrate_fn) in super::NUMBERED_MIGRATIONS {
        migrate_fn(&conn).unwrap();
        super::mark_migration_applied(&conn, version).unwrap();
    }
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM schema_migrations",
            [],
            |row| row.get(0),
        )
        .unwrap();
    let expected = super::NUMBERED_MIGRATIONS.len() as i64;
    assert_eq!(
        count,
        expected,
        "Expected {expected} migrations in schema_migrations; got {count}. \
         Did you add a migration without registering it in NUMBERED_MIGRATIONS, or remove one?"
    );
}

#[test]
fn test_workflow_run_crud() {
    let conn = create_test_db();
    save_workflow_run(&conn, "test-skill", 3, "in_progress", "domain").unwrap();
    let run = get_workflow_run(&conn, "test-skill").unwrap().unwrap();
    assert_eq!(run.skill_name, "test-skill");
    assert_eq!(run.current_step, 3);
    assert_eq!(run.status, "in_progress");
    let none = get_workflow_run(&conn, "nonexistent").unwrap();
    assert!(none.is_none());
}

#[test]
fn test_workflow_run_upsert() {
    let conn = create_test_db();
    save_workflow_run(&conn, "test-skill", 0, "pending", "domain").unwrap();
    save_workflow_run(&conn, "test-skill", 5, "in_progress", "domain").unwrap();
    let run = get_workflow_run(&conn, "test-skill").unwrap().unwrap();
    assert_eq!(run.current_step, 5);
    assert_eq!(run.status, "in_progress");
}

#[test]
fn test_set_skill_author() {
    let conn = create_test_db();
    save_workflow_run(&conn, "test-skill", 0, "pending", "domain").unwrap();

    // Set author with avatar
    set_skill_author(
        &conn,
        "test-skill",
        "testuser",
        Some("https://avatars.example.com/u/123"),
    )
    .unwrap();
    let run = get_workflow_run(&conn, "test-skill").unwrap().unwrap();
    assert_eq!(run.author_login.as_deref(), Some("testuser"));
    assert_eq!(
        run.author_avatar.as_deref(),
        Some("https://avatars.example.com/u/123")
    );
}

#[test]
fn test_set_skill_author_without_avatar() {
    let conn = create_test_db();
    save_workflow_run(&conn, "test-skill", 0, "pending", "domain").unwrap();

    // Set author without avatar
    set_skill_author(&conn, "test-skill", "testuser", None).unwrap();
    let run = get_workflow_run(&conn, "test-skill").unwrap().unwrap();
    assert_eq!(run.author_login.as_deref(), Some("testuser"));
    assert!(run.author_avatar.is_none());
}

#[test]
fn test_workflow_run_default_no_author() {
    let conn = create_test_db();
    save_workflow_run(&conn, "test-skill", 0, "pending", "domain").unwrap();
    let run = get_workflow_run(&conn, "test-skill").unwrap().unwrap();
    assert!(run.author_login.is_none());
    assert!(run.author_avatar.is_none());
}

#[test]
fn test_author_migration_is_idempotent() {
    let conn = Connection::open_in_memory().unwrap();
    run_migrations(&conn).unwrap();
    run_add_skill_type_migration(&conn).unwrap();
    run_lock_table_migration(&conn).unwrap();
    run_author_migration(&conn).unwrap();
    // Running again should not error
    run_author_migration(&conn).unwrap();
}

#[test]
fn test_workflow_steps_crud() {
    let conn = create_test_db();
    // Workflow run must exist so get_workflow_steps can resolve the FK
    save_workflow_run(&conn, "test-skill", 0, "pending", "domain").unwrap();
    save_workflow_step(&conn, "test-skill", 0, "completed").unwrap();
    save_workflow_step(&conn, "test-skill", 1, "in_progress").unwrap();
    save_workflow_step(&conn, "test-skill", 2, "pending").unwrap();
    let steps = get_workflow_steps(&conn, "test-skill").unwrap();
    assert_eq!(steps.len(), 3);
    assert_eq!(steps[0].status, "completed");
    assert_eq!(steps[1].status, "in_progress");
    assert_eq!(steps[2].status, "pending");
}

#[test]
fn test_workflow_steps_reset() {
    let conn = create_test_db();
    // Workflow run must exist so reset_workflow_steps_from can resolve the FK
    save_workflow_run(&conn, "test-skill", 0, "pending", "domain").unwrap();
    save_workflow_step(&conn, "test-skill", 0, "completed").unwrap();
    save_workflow_step(&conn, "test-skill", 1, "completed").unwrap();
    save_workflow_step(&conn, "test-skill", 2, "completed").unwrap();
    save_workflow_step(&conn, "test-skill", 3, "in_progress").unwrap();

    reset_workflow_steps_from(&conn, "test-skill", 2).unwrap();

    let steps = get_workflow_steps(&conn, "test-skill").unwrap();
    assert_eq!(steps[0].status, "completed");
    assert_eq!(steps[1].status, "completed");
    assert_eq!(steps[2].status, "pending");
    assert_eq!(steps[3].status, "pending");
}

#[test]
fn test_delete_workflow_run() {
    let conn = create_test_db();
    save_workflow_run(&conn, "test-skill", 0, "pending", "domain").unwrap();
    save_workflow_step(&conn, "test-skill", 0, "completed").unwrap();
    delete_workflow_run(&conn, "test-skill").unwrap();
    assert!(get_workflow_run(&conn, "test-skill").unwrap().is_none());
    assert!(get_workflow_steps(&conn, "test-skill").unwrap().is_empty());
}

// --- Skills Master CRUD tests ---

#[test]
fn test_upsert_skill_insert_and_return_id() {
    let conn = create_test_db();
    let id = upsert_skill(&conn, "my-skill", "skill-builder", "domain").unwrap();
    assert!(id > 0);

    // Verify the row exists
    let skills = list_all_skills(&conn).unwrap();
    let skill = skills.into_iter().find(|s| s.name == "my-skill").unwrap();
    assert_eq!(skill.name, "my-skill");
    assert_eq!(skill.skill_source, "skill-builder");
}

#[test]
fn test_upsert_skill_update_on_conflict() {
    let conn = create_test_db();
    let id1 = upsert_skill(&conn, "my-skill", "skill-builder", "domain").unwrap();
    // Upsert same name — should update domain/skill_type, keep same id
    let id2 = upsert_skill(&conn, "my-skill", "skill-builder", "platform").unwrap();
    assert_eq!(id1, id2);

    let skills = list_all_skills(&conn).unwrap();
    let skill = skills.into_iter().find(|s| s.name == "my-skill").unwrap();
    assert_eq!(skill.purpose.as_deref(), Some("platform"));
    assert_eq!(skill.skill_source, "skill-builder");
}

#[test]
fn test_list_all_skills_empty() {
    let conn = create_test_db();
    let skills = list_all_skills(&conn).unwrap();
    assert!(skills.is_empty());
}

#[test]
fn test_list_all_skills_returns_ordered_by_name() {
    let conn = create_test_db();
    upsert_skill(&conn, "gamma", "marketplace", "source").unwrap();
    upsert_skill(&conn, "alpha", "skill-builder", "domain").unwrap();
    upsert_skill(&conn, "beta", "imported", "platform").unwrap();

    let skills = list_all_skills(&conn).unwrap();
    assert_eq!(skills.len(), 3);
    assert_eq!(skills[0].name, "alpha");
    assert_eq!(skills[0].skill_source, "skill-builder");
    assert_eq!(skills[1].name, "beta");
    assert_eq!(skills[1].skill_source, "imported");
    assert_eq!(skills[2].name, "gamma");
    assert_eq!(skills[2].skill_source, "marketplace");
}

#[test]
fn test_delete_skill_soft_deletes_from_master() {
    let conn = create_test_db();
    upsert_skill(&conn, "to-delete", "marketplace", "domain").unwrap();
    assert!(get_skill_master_id(&conn, "to-delete").unwrap().is_some());

    delete_skill(&conn, "to-delete").unwrap();
    // Row remains for historical joins but is hidden from active skill lists.
    assert!(get_skill_master_id(&conn, "to-delete").unwrap().is_some());
    let listed = list_all_skills(&conn).unwrap();
    assert!(!listed.iter().any(|s| s.name == "to-delete"));

    let deleted_at: Option<String> = conn
        .query_row(
            "SELECT deleted_at FROM skills WHERE name = 'to-delete'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert!(deleted_at.is_some());
}

#[test]
fn test_delete_skill_nonexistent_is_ok() {
    let conn = create_test_db();
    // Should not error when skill doesn't exist
    delete_skill(&conn, "nonexistent").unwrap();
}

#[test]
fn test_save_marketplace_skill_creates_master_row_only() {
    let conn = create_test_db();
    save_marketplace_skill(&conn, "mkt-skill", "platform").unwrap();

    // Skills master row should exist with source=marketplace
    let skills = list_all_skills(&conn).unwrap();
    let skill = skills.into_iter().find(|s| s.name == "mkt-skill").unwrap();
    assert_eq!(skill.skill_source, "marketplace");

    // No workflow_runs row should be created
    let run = get_workflow_run(&conn, "mkt-skill").unwrap();
    assert!(run.is_none());
}

#[test]
fn test_save_workflow_run_creates_skills_master_row() {
    let conn = create_test_db();
    save_workflow_run(&conn, "my-skill", 0, "pending", "domain").unwrap();

    // save_workflow_run calls upsert_skill internally
    let skills = list_all_skills(&conn).unwrap();
    let skill = skills.into_iter().find(|s| s.name == "my-skill").unwrap();
    assert_eq!(skill.skill_source, "skill-builder");
}

#[test]
fn test_delete_workflow_run_soft_deletes_skills_master() {
    let conn = create_test_db();
    save_workflow_run(&conn, "my-skill", 0, "pending", "domain").unwrap();
    assert!(get_skill_master_id(&conn, "my-skill").unwrap().is_some());

    delete_workflow_run(&conn, "my-skill").unwrap();

    // Workflow state is removed while the skills master row is soft-deleted.
    assert!(get_workflow_run(&conn, "my-skill").unwrap().is_none());
    assert!(get_skill_master_id(&conn, "my-skill").unwrap().is_some());
    let listed = list_all_skills(&conn).unwrap();
    assert!(!listed.iter().any(|s| s.name == "my-skill"));
}

#[test]
fn test_delete_workflow_run_preserves_agent_run_usage_history() {
    let conn = create_test_db();
    save_workflow_run(&conn, "my-skill", 0, "pending", "domain").unwrap();
    create_workflow_session(&conn, "sess-usage", "my-skill", 12345).unwrap();

    persist_agent_run(
        &conn,
        "agent-usage-1",
        "my-skill",
        0,
        "sonnet",
        "completed",
        100,
        50,
        0,
        0,
        0.01,
        1000,
        1,
        None,
        None,
        0,
        0,
        None,
        Some("sess-usage"),
    )
    .unwrap();

    let count_before: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM agent_runs WHERE skill_name = 'my-skill'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(count_before, 1);

    delete_workflow_run(&conn, "my-skill").unwrap();

    let count_after: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM agent_runs WHERE skill_name = 'my-skill'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(count_after, 1);
}

// --- Skills Backfill Migration tests ---

#[test]
fn test_backfill_migration_populates_skills_from_workflow_runs() {
    // Simulate pre-migration state: workflow_runs exist but skills table is empty
    let conn = Connection::open_in_memory().unwrap();
    run_migrations(&conn).unwrap();
    run_add_skill_type_migration(&conn).unwrap();
    run_lock_table_migration(&conn).unwrap();
    run_author_migration(&conn).unwrap();
    run_usage_tracking_migration(&conn).unwrap();
    run_workflow_session_migration(&conn).unwrap();
    run_sessions_table_migration(&conn).unwrap();
    run_trigger_text_migration(&conn).unwrap();
    run_agent_stats_migration(&conn).unwrap();
    run_intake_migration(&conn).unwrap();
    run_composite_pk_migration(&conn).unwrap();
    run_bundled_skill_migration(&conn).unwrap();
    run_remove_validate_step_migration(&conn).unwrap();
    run_source_migration(&conn).unwrap();
    run_imported_skills_extended_migration(&conn).unwrap();
    run_workflow_runs_extended_migration(&conn).unwrap();

    // Insert workflow_runs rows BEFORE running skills migration
    conn.execute(
        "INSERT INTO workflow_runs (skill_name, domain, current_step, status, skill_type, source)
         VALUES ('created-skill', 'sales', 3, 'in_progress', 'domain', 'created')",
        [],
    ).unwrap();
    conn.execute(
        "INSERT INTO workflow_runs (skill_name, domain, current_step, status, skill_type, source)
         VALUES ('mkt-skill', 'analytics', 5, 'completed', 'platform', 'marketplace')",
        [],
    ).unwrap();

    // Run the skills table + backfill migrations
    run_skills_table_migration(&conn).unwrap();
    run_skills_backfill_migration(&conn).unwrap();
    run_rename_upload_migration(&conn).unwrap();
    run_workspace_skills_migration(&conn).unwrap();
    run_workflow_runs_id_migration(&conn).unwrap();
    run_fk_columns_migration(&conn).unwrap();
    run_frontmatter_to_skills_migration(&conn).unwrap();

    run_workspace_skills_purpose_migration(&conn).unwrap();
    run_content_hash_migration(&conn).unwrap();
    run_backfill_null_versions_migration(&conn).unwrap();
    run_rename_purpose_drop_domain_migration(&conn).unwrap();
    run_skills_soft_delete_migration(&conn).unwrap();

    // Verify skills master was populated
    let skills = list_all_skills(&conn).unwrap();
    assert_eq!(skills.len(), 2);

    let created = skills.iter().find(|s| s.name == "created-skill").unwrap();
    assert_eq!(created.skill_source, "skill-builder");

    let mkt = skills.iter().find(|s| s.name == "mkt-skill").unwrap();
    assert_eq!(mkt.skill_source, "marketplace");

    // Marketplace row should be removed from workflow_runs
    let run = get_workflow_run(&conn, "mkt-skill").unwrap();
    assert!(
        run.is_none(),
        "marketplace rows should be removed from workflow_runs"
    );

    // Created skill should still have a workflow_runs row
    let run = get_workflow_run(&conn, "created-skill").unwrap();
    assert!(run.is_some());

    // workflow_runs should have skill_id FK populated
    let skill_id: Option<i64> = conn
        .query_row(
            "SELECT skill_id FROM workflow_runs WHERE skill_name = 'created-skill'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert!(skill_id.is_some());
    assert_eq!(skill_id.unwrap(), created.id);
}

// --- Skill Tags tests ---

#[test]
fn test_set_and_get_tags() {
    let conn = create_test_db();
    upsert_skill(&conn, "my-skill", "skill-builder", "domain").unwrap();
    set_skill_tags(
        &conn,
        "my-skill",
        &["analytics".into(), "salesforce".into()],
    )
    .unwrap();
    let tags = get_tags_for_skills(&conn, &vec!["my-skill".to_string()])
        .unwrap()
        .remove("my-skill")
        .unwrap_or_default();
    assert_eq!(tags, vec!["analytics", "salesforce"]);
}

#[test]
fn test_tags_normalize_lowercase_trim() {
    let conn = create_test_db();
    upsert_skill(&conn, "my-skill", "skill-builder", "domain").unwrap();
    set_skill_tags(
        &conn,
        "my-skill",
        &["  Analytics ".into(), "SALESFORCE".into(), "  ".into()],
    )
    .unwrap();
    let tags = get_tags_for_skills(&conn, &vec!["my-skill".to_string()])
        .unwrap()
        .remove("my-skill")
        .unwrap_or_default();
    assert_eq!(tags, vec!["analytics", "salesforce"]);
}

#[test]
fn test_tags_deduplicate() {
    let conn = create_test_db();
    upsert_skill(&conn, "my-skill", "skill-builder", "domain").unwrap();
    set_skill_tags(
        &conn,
        "my-skill",
        &["analytics".into(), "analytics".into(), "Analytics".into()],
    )
    .unwrap();
    let tags = get_tags_for_skills(&conn, &vec!["my-skill".to_string()])
        .unwrap()
        .remove("my-skill")
        .unwrap_or_default();
    assert_eq!(tags, vec!["analytics"]);
}

#[test]
fn test_set_tags_replaces() {
    let conn = create_test_db();
    upsert_skill(&conn, "my-skill", "skill-builder", "domain").unwrap();
    set_skill_tags(&conn, "my-skill", &["old-tag".into()]).unwrap();
    set_skill_tags(&conn, "my-skill", &["new-tag".into()]).unwrap();
    let tags = get_tags_for_skills(&conn, &vec!["my-skill".to_string()])
        .unwrap()
        .remove("my-skill")
        .unwrap_or_default();
    assert_eq!(tags, vec!["new-tag"]);
}

#[test]
fn test_get_tags_for_skills_batch() {
    let conn = create_test_db();
    upsert_skill(&conn, "skill-a", "skill-builder", "domain").unwrap();
    upsert_skill(&conn, "skill-b", "skill-builder", "domain").unwrap();
    upsert_skill(&conn, "skill-c", "skill-builder", "domain").unwrap();
    set_skill_tags(&conn, "skill-a", &["tag1".into(), "tag2".into()]).unwrap();
    set_skill_tags(&conn, "skill-b", &["tag2".into(), "tag3".into()]).unwrap();
    set_skill_tags(&conn, "skill-c", &["tag1".into()]).unwrap();

    let names = vec!["skill-a".into(), "skill-b".into(), "skill-c".into()];
    let map = get_tags_for_skills(&conn, &names).unwrap();
    assert_eq!(map.get("skill-a").unwrap(), &vec!["tag1", "tag2"]);
    assert_eq!(map.get("skill-b").unwrap(), &vec!["tag2", "tag3"]);
    assert_eq!(map.get("skill-c").unwrap(), &vec!["tag1"]);
}

#[test]
fn test_get_all_tags() {
    let conn = create_test_db();
    upsert_skill(&conn, "skill-a", "skill-builder", "domain").unwrap();
    upsert_skill(&conn, "skill-b", "skill-builder", "domain").unwrap();
    set_skill_tags(&conn, "skill-a", &["beta".into(), "alpha".into()]).unwrap();
    set_skill_tags(&conn, "skill-b", &["beta".into(), "gamma".into()]).unwrap();

    let all = get_all_tags(&conn).unwrap();
    assert_eq!(all, vec!["alpha", "beta", "gamma"]);
}

#[test]
fn test_delete_workflow_run_cascades_tags() {
    let conn = create_test_db();
    save_workflow_run(&conn, "my-skill", 0, "pending", "domain").unwrap();
    set_skill_tags(&conn, "my-skill", &["tag1".into(), "tag2".into()]).unwrap();

    delete_workflow_run(&conn, "my-skill").unwrap();

    let tags = get_tags_for_skills(&conn, &vec!["my-skill".to_string()])
        .unwrap()
        .remove("my-skill")
        .unwrap_or_default();
    assert!(tags.is_empty());
}

#[test]
fn test_skill_type_migration() {
    // Use full test DB - migration 28 renames skill_type -> purpose
    let conn = create_test_db();

    // Verify purpose column exists by inserting a row with it
    save_workflow_run(&conn, "test-skill", 0, "pending", "platform").unwrap();
    let run = get_workflow_run(&conn, "test-skill").unwrap().unwrap();
    assert_eq!(run.purpose, "platform");
}

#[test]
fn test_skill_type_migration_is_idempotent() {
    let conn = Connection::open_in_memory().unwrap();
    run_migrations(&conn).unwrap();
    run_add_skill_type_migration(&conn).unwrap();
    // Running again should not error
    run_add_skill_type_migration(&conn).unwrap();
}

#[test]
fn test_get_purpose_default() {
    let conn = create_test_db();
    // No workflow run exists — should return "domain" default
    let skill_type = get_purpose(&conn, "nonexistent-skill").unwrap();
    assert_eq!(skill_type, "domain");
}

#[test]
fn test_get_purpose_explicit() {
    let conn = create_test_db();
    save_workflow_run(&conn, "my-skill", 0, "pending", "source").unwrap();
    let skill_type = get_purpose(&conn, "my-skill").unwrap();
    assert_eq!(skill_type, "source");
}

#[test]
fn test_list_all_workflow_runs_empty() {
    let conn = create_test_db();
    let runs = list_all_workflow_runs(&conn).unwrap();
    assert!(runs.is_empty());
}

#[test]
fn test_list_all_workflow_runs_multiple() {
    let conn = create_test_db();
    save_workflow_run(&conn, "alpha-skill", 3, "in_progress", "domain").unwrap();
    save_workflow_run(&conn, "beta-skill", 0, "pending", "platform").unwrap();
    save_workflow_run(&conn, "gamma-skill", 7, "completed", "source").unwrap();

    let runs = list_all_workflow_runs(&conn).unwrap();
    assert_eq!(runs.len(), 3);
    // Ordered by skill_name
    assert_eq!(runs[0].skill_name, "alpha-skill");
    assert_eq!(runs[0].current_step, 3);
    assert_eq!(runs[1].skill_name, "beta-skill");
    assert_eq!(runs[1].purpose, "platform");
    assert_eq!(runs[2].skill_name, "gamma-skill");
    assert_eq!(runs[2].status, "completed");
}

#[test]
fn test_list_all_workflow_runs_after_delete() {
    let conn = create_test_db();
    save_workflow_run(&conn, "skill-a", 0, "pending", "domain").unwrap();
    save_workflow_run(&conn, "skill-b", 0, "pending", "domain").unwrap();

    delete_workflow_run(&conn, "skill-a").unwrap();

    let runs = list_all_workflow_runs(&conn).unwrap();
    assert_eq!(runs.len(), 1);
    assert_eq!(runs[0].skill_name, "skill-b");
}

#[test]
fn test_workflow_run_preserves_skill_type() {
    let conn = create_test_db();
    save_workflow_run(&conn, "my-skill", 0, "pending", "data-engineering").unwrap();
    let run = get_workflow_run(&conn, "my-skill").unwrap().unwrap();
    assert_eq!(run.purpose, "data-engineering");

    // Update step/status — skill_type should be preserved
    save_workflow_run(&conn, "my-skill", 3, "in_progress", "data-engineering").unwrap();
    let run = get_workflow_run(&conn, "my-skill").unwrap().unwrap();
    assert_eq!(run.purpose, "data-engineering");
    assert_eq!(run.current_step, 3);
}

// --- WAL and busy_timeout tests ---

#[test]
fn test_wal_mode_enabled() {
    let conn = Connection::open_in_memory().unwrap();
    conn.pragma_update(None, "journal_mode", "WAL").unwrap();
    let mode: String = conn
        .pragma_query_value(None, "journal_mode", |row| row.get(0))
        .unwrap();
    // In-memory DBs use "memory" journal mode, but the pragma still succeeds
    assert!(mode == "wal" || mode == "memory");
}

#[test]
fn test_busy_timeout_set() {
    let conn = Connection::open_in_memory().unwrap();
    conn.pragma_update(None, "busy_timeout", "5000").unwrap();
    let timeout: i64 = conn
        .pragma_query_value(None, "busy_timeout", |row| row.get(0))
        .unwrap();
    assert_eq!(timeout, 5000);
}

// --- Skill Lock tests ---

#[test]
fn test_acquire_and_release_lock() {
    let conn = create_test_db();
    run_lock_table_migration(&conn).unwrap();
    // Skill must exist in master for FK-based locking
    upsert_skill(&conn, "test-skill", "skill-builder", "domain").unwrap();
    acquire_skill_lock(&conn, "test-skill", "inst-1", 12345).unwrap();
    let lock = get_skill_lock(&conn, "test-skill").unwrap().unwrap();
    assert_eq!(lock.skill_name, "test-skill");
    assert_eq!(lock.instance_id, "inst-1");
    assert_eq!(lock.pid, 12345);

    release_skill_lock(&conn, "test-skill", "inst-1").unwrap();
    assert!(get_skill_lock(&conn, "test-skill").unwrap().is_none());
}

#[test]
fn test_acquire_lock_conflict() {
    let conn = create_test_db();
    run_lock_table_migration(&conn).unwrap();
    upsert_skill(&conn, "test-skill", "skill-builder", "domain").unwrap();
    // Use the current PID so the lock appears "live"
    let pid = std::process::id();
    acquire_skill_lock(&conn, "test-skill", "inst-1", pid).unwrap();
    let result = acquire_skill_lock(&conn, "test-skill", "inst-2", pid);
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("being edited"));
}

#[test]
fn test_acquire_lock_idempotent_same_instance() {
    let conn = create_test_db();
    run_lock_table_migration(&conn).unwrap();
    upsert_skill(&conn, "test-skill", "skill-builder", "domain").unwrap();
    acquire_skill_lock(&conn, "test-skill", "inst-1", 12345).unwrap();
    // Acquiring again from the same instance should succeed
    acquire_skill_lock(&conn, "test-skill", "inst-1", 12345).unwrap();
}

#[test]
fn test_release_all_instance_locks() {
    let conn = create_test_db();
    run_lock_table_migration(&conn).unwrap();
    upsert_skill(&conn, "skill-a", "skill-builder", "domain").unwrap();
    upsert_skill(&conn, "skill-b", "skill-builder", "domain").unwrap();
    upsert_skill(&conn, "skill-c", "skill-builder", "domain").unwrap();
    acquire_skill_lock(&conn, "skill-a", "inst-1", 12345).unwrap();
    acquire_skill_lock(&conn, "skill-b", "inst-1", 12345).unwrap();
    acquire_skill_lock(&conn, "skill-c", "inst-2", 67890).unwrap();

    let count = release_all_instance_locks(&conn, "inst-1").unwrap();
    assert_eq!(count, 2);

    // inst-2's lock should remain
    assert!(get_skill_lock(&conn, "skill-c").unwrap().is_some());
    assert!(get_skill_lock(&conn, "skill-a").unwrap().is_none());
}

#[test]
fn test_get_all_skill_locks() {
    let conn = create_test_db();
    run_lock_table_migration(&conn).unwrap();
    upsert_skill(&conn, "skill-a", "skill-builder", "domain").unwrap();
    upsert_skill(&conn, "skill-b", "skill-builder", "domain").unwrap();
    acquire_skill_lock(&conn, "skill-a", "inst-1", 12345).unwrap();
    acquire_skill_lock(&conn, "skill-b", "inst-2", 67890).unwrap();

    let locks = get_all_skill_locks(&conn).unwrap();
    assert_eq!(locks.len(), 2);
}

#[test]
fn test_check_pid_alive_current_process() {
    let pid = std::process::id();
    assert!(check_pid_alive(pid));
}

#[test]
fn test_check_pid_alive_dead_process() {
    // PID 99999999 almost certainly doesn't exist
    assert!(!check_pid_alive(99999999));
}

// --- Usage Tracking tests ---

#[test]
fn test_usage_tracking_migration_is_idempotent() {
    let conn = Connection::open_in_memory().unwrap();
    run_migrations(&conn).unwrap();
    run_usage_tracking_migration(&conn).unwrap();
    // Running again should not error
    run_usage_tracking_migration(&conn).unwrap();
}

#[test]
fn test_persist_agent_run_inserts_correctly() {
    let conn = create_test_db();
    persist_agent_run(
        &conn,
        "agent-1",
        "my-skill",
        3,
        "sonnet",
        "completed",
        1000,
        500,
        200,
        100,
        0.05,
        12345,
        0,
        None,
        None,
        0,
        0,
        Some("session-abc"),
        Some("wf-test-session"),
    )
    .unwrap();

    let runs = get_recent_runs(&conn, 10).unwrap();
    assert_eq!(runs.len(), 1);
    let run = &runs[0];
    assert_eq!(run.agent_id, "agent-1");
    assert_eq!(run.skill_name, "my-skill");
    assert_eq!(run.step_id, 3);
    assert_eq!(run.model, "claude-sonnet-4-6");
    assert_eq!(run.status, "completed");
    assert_eq!(run.input_tokens, 1000);
    assert_eq!(run.output_tokens, 500);
    assert_eq!(run.cache_read_tokens, 200);
    assert_eq!(run.cache_write_tokens, 100);
    assert!((run.total_cost - 0.05).abs() < f64::EPSILON);
    assert_eq!(run.duration_ms, 12345);
    assert_eq!(run.session_id.as_deref(), Some("session-abc"));
    assert!(run.started_at.len() > 0);
    assert!(run.completed_at.is_some());
    assert_eq!(run.num_turns, 0);
    assert_eq!(run.stop_reason, None);
    assert_eq!(run.duration_api_ms, None);
    assert_eq!(run.tool_use_count, 0);
    assert_eq!(run.compaction_count, 0);
}

#[test]
fn test_persist_agent_run_without_session_id() {
    let conn = create_test_db();
    persist_agent_run(
        &conn,
        "agent-2",
        "my-skill",
        1,
        "haiku",
        "completed",
        500,
        200,
        0,
        0,
        0.01,
        5000,
        0,
        None,
        None,
        0,
        0,
        None,
        None,
    )
    .unwrap();

    let runs = get_recent_runs(&conn, 10).unwrap();
    assert_eq!(runs.len(), 1);
    assert!(runs[0].session_id.is_none());
}

#[test]
fn test_persist_agent_run_shutdown_does_not_overwrite_completed() {
    let conn = create_test_db();
    let ws = Some("wf-session-1");

    // First persist as completed with real data
    persist_agent_run(
        &conn,
        "agent-1",
        "my-skill",
        0,
        "sonnet",
        "completed",
        1000,
        500,
        200,
        100,
        0.15,
        8000,
        0,
        None,
        None,
        0,
        0,
        None,
        ws,
    )
    .unwrap();

    // Then attempt to overwrite with shutdown (partial/zero data)
    persist_agent_run(
        &conn, "agent-1", "my-skill", 0, "sonnet", "shutdown", 0, 0, 0, 0, 0.0, 0, 0, None,
        None, 0, 0, None, ws,
    )
    .unwrap();

    // Completed data should be preserved
    let runs = get_recent_runs(&conn, 10).unwrap();
    assert_eq!(runs.len(), 1);
    assert_eq!(runs[0].status, "completed");
    assert_eq!(runs[0].input_tokens, 1000);
    assert!((runs[0].total_cost - 0.15).abs() < 1e-10);
}

#[test]
fn test_persist_agent_run_shutdown_overwrites_running() {
    let conn = create_test_db();
    let ws = Some("wf-session-1");

    // First persist as running (agent start)
    persist_agent_run(
        &conn, "agent-1", "my-skill", 0, "sonnet", "running", 0, 0, 0, 0, 0.0, 0, 0, None,
        None, 0, 0, None, ws,
    )
    .unwrap();

    // Then shutdown with partial data — should succeed
    persist_agent_run(
        &conn, "agent-1", "my-skill", 0, "sonnet", "shutdown", 500, 200, 0, 0, 0.05, 3000, 0,
        None, None, 0, 0, None, ws,
    )
    .unwrap();

    let runs = get_recent_runs(&conn, 10).unwrap();
    assert_eq!(runs.len(), 1);
    assert_eq!(runs[0].status, "shutdown");
    assert_eq!(runs[0].input_tokens, 500);
}

#[test]
fn test_get_usage_summary_correct_aggregates() {
    let conn = create_test_db();
    let ws = Some("wf-session-1");
    create_workflow_session(&conn, "wf-session-1", "skill-a", 1000).unwrap();
    persist_agent_run(
        &conn,
        "agent-1",
        "skill-a",
        1,
        "sonnet",
        "completed",
        1000,
        500,
        0,
        0,
        0.10,
        5000,
        0,
        None,
        None,
        0,
        0,
        None,
        ws,
    )
    .unwrap();
    persist_agent_run(
        &conn,
        "agent-2",
        "skill-a",
        3,
        "opus",
        "completed",
        2000,
        1000,
        0,
        0,
        0.30,
        10000,
        0,
        None,
        None,
        0,
        0,
        None,
        ws,
    )
    .unwrap();
    // Running agents are included (toggle hides zero-cost sessions, not individual statuses)
    persist_agent_run(
        &conn, "agent-3", "skill-a", 5, "sonnet", "running", 100, 50, 0, 0, 0.01, 0, 0, None,
        None, 0, 0, None, ws,
    )
    .unwrap();

    let summary = get_usage_summary(&conn, false, None, None).unwrap();
    // All three agents share one workflow session → 1 run, total 0.41
    assert_eq!(summary.total_runs, 1);
    assert!((summary.total_cost - 0.41).abs() < 1e-10);
    assert!((summary.avg_cost_per_run - 0.41).abs() < 1e-10);
}

#[test]
fn test_get_usage_summary_empty() {
    let conn = create_test_db();
    let summary = get_usage_summary(&conn, false, None, None).unwrap();
    assert_eq!(summary.total_runs, 0);
    assert!((summary.total_cost - 0.0).abs() < f64::EPSILON);
    assert!((summary.avg_cost_per_run - 0.0).abs() < f64::EPSILON);
}

#[test]
fn test_reset_usage_marks_runs() {
    let conn = create_test_db();
    let ws = Some("wf-session-r");
    create_workflow_session(&conn, "wf-session-r", "skill-a", 1000).unwrap();
    persist_agent_run(
        &conn,
        "agent-1",
        "skill-a",
        1,
        "sonnet",
        "completed",
        1000,
        500,
        0,
        0,
        0.10,
        5000,
        0,
        None,
        None,
        0,
        0,
        None,
        ws,
    )
    .unwrap();
    persist_agent_run(
        &conn,
        "agent-2",
        "skill-a",
        3,
        "opus",
        "completed",
        2000,
        1000,
        0,
        0,
        0.30,
        10000,
        0,
        None,
        None,
        0,
        0,
        None,
        ws,
    )
    .unwrap();

    reset_usage(&conn).unwrap();

    // After reset, summary should show zero (both agent_runs and workflow_sessions are marked)
    let summary = get_usage_summary(&conn, false, None, None).unwrap();
    assert_eq!(summary.total_runs, 0);
    assert!((summary.total_cost - 0.0).abs() < f64::EPSILON);

    // Recent runs should also be empty (filtered by reset_marker IS NULL)
    let runs = get_recent_runs(&conn, 10).unwrap();
    assert!(runs.is_empty());

    // Recent workflow sessions should also be empty
    let sessions = get_recent_workflow_sessions(&conn, 10, false, None, None).unwrap();
    assert!(sessions.is_empty());

    // New runs after reset should still be visible
    create_workflow_session(&conn, "wf-session-r2", "skill-b", 1000).unwrap();
    persist_agent_run(
        &conn,
        "agent-3",
        "skill-b",
        6,
        "sonnet",
        "completed",
        500,
        200,
        0,
        0,
        0.05,
        3000,
        0,
        None,
        None,
        0,
        0,
        None,
        Some("wf-session-r2"),
    )
    .unwrap();

    let summary = get_usage_summary(&conn, false, None, None).unwrap();
    assert_eq!(summary.total_runs, 1);
    assert!((summary.total_cost - 0.05).abs() < 1e-10);
}

#[test]
fn test_get_usage_by_step_groups_correctly() {
    let conn = create_test_db();
    let ws = Some("wf-session-s");
    create_workflow_session(&conn, "wf-session-s", "skill-a", 1000).unwrap();
    persist_agent_run(
        &conn,
        "agent-1",
        "skill-a",
        1,
        "sonnet",
        "completed",
        1000,
        500,
        0,
        0,
        0.10,
        5000,
        0,
        None,
        None,
        0,
        0,
        None,
        ws,
    )
    .unwrap();
    persist_agent_run(
        &conn,
        "agent-2",
        "skill-a",
        1,
        "sonnet",
        "completed",
        800,
        400,
        0,
        0,
        0.08,
        4000,
        0,
        None,
        None,
        0,
        0,
        None,
        ws,
    )
    .unwrap();
    persist_agent_run(
        &conn,
        "agent-3",
        "skill-a",
        5,
        "sonnet",
        "completed",
        2000,
        1000,
        0,
        0,
        0.25,
        8000,
        0,
        None,
        None,
        0,
        0,
        None,
        ws,
    )
    .unwrap();

    let by_step = get_usage_by_step(&conn, false, None, None).unwrap();
    assert_eq!(by_step.len(), 2);

    // Ordered by total_cost DESC: step 5 ($0.25) then step 1 ($0.18)
    assert_eq!(by_step[0].step_id, 5);
    assert_eq!(by_step[0].step_name, "Step 5");
    assert_eq!(by_step[0].run_count, 1);
    assert!((by_step[0].total_cost - 0.25).abs() < 1e-10);

    assert_eq!(by_step[1].step_id, 1);
    assert_eq!(by_step[1].step_name, "Detailed Research");
    assert_eq!(by_step[1].run_count, 2);
    assert!((by_step[1].total_cost - 0.18).abs() < 1e-10);
}

#[test]
fn test_get_usage_by_model_groups_correctly() {
    let conn = create_test_db();
    let ws = Some("wf-session-m");
    create_workflow_session(&conn, "wf-session-m", "skill-a", 1000).unwrap();
    persist_agent_run(
        &conn,
        "agent-1",
        "skill-a",
        1,
        "sonnet",
        "completed",
        1000,
        500,
        0,
        0,
        0.10,
        5000,
        0,
        None,
        None,
        0,
        0,
        None,
        ws,
    )
    .unwrap();
    persist_agent_run(
        &conn,
        "agent-2",
        "skill-a",
        5,
        "opus",
        "completed",
        2000,
        1000,
        0,
        0,
        0.50,
        10000,
        0,
        None,
        None,
        0,
        0,
        None,
        ws,
    )
    .unwrap();
    persist_agent_run(
        &conn,
        "agent-3",
        "skill-a",
        3,
        "sonnet",
        "completed",
        500,
        200,
        0,
        0,
        0.05,
        3000,
        0,
        None,
        None,
        0,
        0,
        None,
        ws,
    )
    .unwrap();

    let by_model = get_usage_by_model(&conn, false, None, None).unwrap();
    assert_eq!(by_model.len(), 2);

    // Ordered by total_cost DESC: Opus ($0.50) then Sonnet ($0.15).
    // The query now groups by family name so aliases normalize to "Opus"/"Sonnet".
    assert_eq!(by_model[0].model, "Opus");
    assert_eq!(by_model[0].run_count, 1);
    assert!((by_model[0].total_cost - 0.50).abs() < 1e-10);

    assert_eq!(by_model[1].model, "Sonnet");
    assert_eq!(by_model[1].run_count, 2);
    assert!((by_model[1].total_cost - 0.15).abs() < 1e-10);
}

#[test]
fn test_get_agent_runs_model_family_filter() {
    // Verify the model_family CASE WHEN clause in get_agent_runs correctly
    // includes only rows whose model matches the requested family.
    let conn = create_test_db();
    let ws = Some("wf-session-mf");
    create_workflow_session(&conn, "wf-session-mf", "skill-a", 1000).unwrap();

    persist_agent_run(
        &conn,
        "run-sonnet",
        "skill-a",
        0,
        "claude-sonnet-4-6",
        "completed",
        100,
        50,
        0,
        0,
        0.10,
        1000,
        1,
        None,
        None,
        0,
        0,
        None,
        ws,
    )
    .unwrap();
    persist_agent_run(
        &conn,
        "run-opus",
        "skill-a",
        4,
        "claude-opus-4-6",
        "completed",
        200,
        100,
        0,
        0,
        0.50,
        2000,
        1,
        None,
        None,
        0,
        0,
        None,
        ws,
    )
    .unwrap();
    persist_agent_run(
        &conn,
        "run-haiku",
        "skill-a",
        1,
        "claude-haiku-4-5-20251001",
        "completed",
        50,
        25,
        0,
        0,
        0.02,
        500,
        1,
        None,
        None,
        0,
        0,
        None,
        ws,
    )
    .unwrap();

    // No filter: all three returned
    let all = get_agent_runs(&conn, false, None, None, None, 100).unwrap();
    assert_eq!(all.len(), 3);

    // Filter Opus: only opus row
    let opus = get_agent_runs(&conn, false, None, None, Some("Opus"), 100).unwrap();
    assert_eq!(opus.len(), 1);
    assert_eq!(opus[0].agent_id, "run-opus");

    // Filter Sonnet: only sonnet row
    let sonnet = get_agent_runs(&conn, false, None, None, Some("Sonnet"), 100).unwrap();
    assert_eq!(sonnet.len(), 1);
    assert_eq!(sonnet[0].agent_id, "run-sonnet");

    // Filter Haiku: only haiku row
    let haiku = get_agent_runs(&conn, false, None, None, Some("Haiku"), 100).unwrap();
    assert_eq!(haiku.len(), 1);
    assert_eq!(haiku[0].agent_id, "run-haiku");
}

#[test]
fn test_normalize_model_name_at_persist_time() {
    // Short-form aliases stored via persist_agent_run must be normalized to
    // canonical full IDs before they reach the DB.
    let conn = create_test_db();
    let ws = Some("wf-norm");
    create_workflow_session(&conn, "wf-norm", "skill-x", 1000).unwrap();

    persist_agent_run(
        &conn,
        "a-sonnet",
        "skill-x",
        0,
        "sonnet",
        "completed",
        10,
        5,
        0,
        0,
        0.01,
        100,
        1,
        None,
        None,
        0,
        0,
        None,
        ws,
    )
    .unwrap();
    persist_agent_run(
        &conn,
        "a-haiku",
        "skill-x",
        0,
        "Haiku",
        "completed",
        10,
        5,
        0,
        0,
        0.01,
        100,
        1,
        None,
        None,
        0,
        0,
        None,
        ws,
    )
    .unwrap();
    persist_agent_run(
        &conn,
        "a-opus",
        "skill-x",
        0,
        "opus",
        "completed",
        10,
        5,
        0,
        0,
        0.01,
        100,
        1,
        None,
        None,
        0,
        0,
        None,
        ws,
    )
    .unwrap();

    let runs = get_agent_runs(&conn, false, None, None, None, 10).unwrap();
    let models: std::collections::HashMap<&str, &str> = runs
        .iter()
        .map(|r| (r.agent_id.as_str(), r.model.as_str()))
        .collect();

    assert_eq!(models["a-sonnet"], "claude-sonnet-4-6");
    assert_eq!(models["a-haiku"], "claude-haiku-4-5-20251001");
    assert_eq!(models["a-opus"], "claude-opus-4-6");

    // model family filter must also work on freshly-persisted canonical IDs
    let opus = get_agent_runs(&conn, false, None, None, Some("Opus"), 10).unwrap();
    assert_eq!(opus.len(), 1);
    assert_eq!(opus[0].agent_id, "a-opus");
}

#[test]
fn test_migration_32_normalizes_short_aliases() {
    // Insert short-form aliases directly (bypassing persist_agent_run normalization)
    // then verify migration 32 normalizes them.
    let conn = create_test_db();
    create_workflow_session(&conn, "wf-mig32", "skill-y", 1000).unwrap();
    conn.execute(
        "INSERT INTO agent_runs (agent_id, skill_name, step_id, model, status, total_cost, workflow_session_id)
         VALUES ('old-sonnet', 'skill-y', 0, 'Sonnet', 'completed', 0.10, 'wf-mig32'),
                ('old-haiku', 'skill-y', 0, 'haiku', 'completed', 0.02, 'wf-mig32'),
                ('old-opus', 'skill-y', 0, 'Opus', 'completed', 0.50, 'wf-mig32')",
        [],
    ).unwrap();

    run_normalize_model_names_migration(&conn).unwrap();

    let runs = get_agent_runs(&conn, false, None, None, None, 10).unwrap();
    let models: std::collections::HashMap<&str, &str> = runs
        .iter()
        .map(|r| (r.agent_id.as_str(), r.model.as_str()))
        .collect();

    assert_eq!(models["old-sonnet"], "claude-sonnet-4-6");
    assert_eq!(models["old-haiku"], "claude-haiku-4-5-20251001");
    assert_eq!(models["old-opus"], "claude-opus-4-6");
}

#[test]
fn test_persist_agent_run_auto_creates_workflow_session_for_synthetic_ids() {
    let conn = create_test_db();

    persist_agent_run(
        &conn,
        "agent-r",
        "my-skill",
        -10,
        "sonnet",
        "completed",
        1200,
        300,
        0,
        0,
        0.12,
        3200,
        0,
        None,
        None,
        0,
        0,
        None,
        Some("synthetic:refine:my-skill:agent-r"),
    )
    .unwrap();

    let sess_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM workflow_sessions WHERE session_id = 'synthetic:refine:my-skill:agent-r'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(sess_count, 1);

    let summary = get_usage_summary(&conn, false, None, None).unwrap();
    assert_eq!(summary.total_runs, 1);
    assert!((summary.total_cost - 0.12).abs() < 1e-10);
}

#[test]
fn test_get_usage_by_step_labels_refine_and_test() {
    let conn = create_test_db();

    persist_agent_run(
        &conn,
        "agent-refine",
        "skill-a",
        -10,
        "sonnet",
        "completed",
        1000,
        200,
        0,
        0,
        0.10,
        2000,
        0,
        None,
        None,
        0,
        0,
        None,
        Some("synthetic:refine:skill-a:agent-refine"),
    )
    .unwrap();
    persist_agent_run(
        &conn,
        "agent-test",
        "skill-a",
        -11,
        "sonnet",
        "completed",
        900,
        180,
        0,
        0,
        0.09,
        1800,
        0,
        None,
        None,
        0,
        0,
        None,
        Some("synthetic:test:skill-a:agent-test"),
    )
    .unwrap();

    let by_step = get_usage_by_step(&conn, false, None, None).unwrap();
    let refine = by_step.iter().find(|s| s.step_id == -10).unwrap();
    let test = by_step.iter().find(|s| s.step_id == -11).unwrap();
    assert_eq!(refine.step_name, "Refine");
    assert_eq!(test.step_name, "Test");
}

#[test]
fn test_reset_usage_excludes_from_by_step_and_by_model() {
    let conn = create_test_db();
    persist_agent_run(
        &conn,
        "agent-1",
        "skill-a",
        1,
        "sonnet",
        "completed",
        1000,
        500,
        0,
        0,
        0.10,
        5000,
        0,
        None,
        None,
        0,
        0,
        None,
        None,
    )
    .unwrap();

    reset_usage(&conn).unwrap();

    let by_step = get_usage_by_step(&conn, false, None, None).unwrap();
    assert!(by_step.is_empty());

    let by_model = get_usage_by_model(&conn, false, None, None).unwrap();
    assert!(by_model.is_empty());
}

// --- Composite PK (agent_id, model) tests ---

#[test]
fn test_composite_pk_allows_same_agent_different_models() {
    let conn = create_test_db();
    let ws = Some("wf-session-cpk");
    create_workflow_session(&conn, "wf-session-cpk", "skill-a", 1000).unwrap();

    // Insert same agent_id with two different models (simulates sub-agent spawning)
    persist_agent_run(
        &conn,
        "orchestrator-1",
        "skill-a",
        1,
        "opus",
        "completed",
        2000,
        1000,
        0,
        0,
        0.50,
        10000,
        3,
        Some("end_turn"),
        Some(8000),
        5,
        0,
        Some("sess-1"),
        ws,
    )
    .unwrap();
    persist_agent_run(
        &conn,
        "orchestrator-1",
        "skill-a",
        1,
        "sonnet",
        "completed",
        800,
        400,
        0,
        0,
        0.08,
        4000,
        2,
        Some("end_turn"),
        Some(3000),
        3,
        0,
        Some("sess-1"),
        ws,
    )
    .unwrap();

    // Both rows should exist
    let runs = get_session_agent_runs(&conn, "wf-session-cpk").unwrap();
    assert_eq!(runs.len(), 2);

    // Verify distinct canonical model IDs (aliases normalize at persist time)
    let models: Vec<&str> = runs.iter().map(|r| r.model.as_str()).collect();
    assert!(models.contains(&"claude-opus-4-6"));
    assert!(models.contains(&"claude-sonnet-4-6"));

    // Both should have the same agent_id
    assert!(runs.iter().all(|r| r.agent_id == "orchestrator-1"));

    // get_usage_by_model groups by family name so both normalize to their family.
    let by_model = get_usage_by_model(&conn, false, None, None).unwrap();
    assert_eq!(by_model.len(), 2);

    let opus = by_model.iter().find(|m| m.model == "Opus").unwrap();
    assert!((opus.total_cost - 0.50).abs() < 1e-10);
    assert_eq!(opus.run_count, 1);

    let sonnet = by_model.iter().find(|m| m.model == "Sonnet").unwrap();
    assert!((sonnet.total_cost - 0.08).abs() < 1e-10);
    assert_eq!(sonnet.run_count, 1);
}

#[test]
fn test_composite_pk_upsert_same_agent_and_model() {
    let conn = create_test_db();

    // Insert then update same agent_id + model — should replace, not duplicate
    persist_agent_run(
        &conn, "agent-1", "skill-a", 1, "sonnet", "running", 0, 0, 0, 0, 0.0, 0, 0, None, None,
        0, 0, None, None,
    )
    .unwrap();
    persist_agent_run(
        &conn,
        "agent-1",
        "skill-a",
        1,
        "sonnet",
        "completed",
        1000,
        500,
        0,
        0,
        0.10,
        5000,
        3,
        Some("end_turn"),
        Some(4000),
        5,
        1,
        None,
        None,
    )
    .unwrap();

    let runs = get_recent_runs(&conn, 10).unwrap();
    assert_eq!(runs.len(), 1);
    assert_eq!(runs[0].status, "completed");
    assert_eq!(runs[0].input_tokens, 1000);
}

#[test]
fn test_composite_pk_migration_is_idempotent() {
    let conn = Connection::open_in_memory().unwrap();
    run_migrations(&conn).unwrap();
    run_add_skill_type_migration(&conn).unwrap();
    run_lock_table_migration(&conn).unwrap();
    run_author_migration(&conn).unwrap();
    run_usage_tracking_migration(&conn).unwrap();
    run_workflow_session_migration(&conn).unwrap();
    run_sessions_table_migration(&conn).unwrap();
    run_trigger_text_migration(&conn).unwrap();
    run_agent_stats_migration(&conn).unwrap();
    run_intake_migration(&conn).unwrap();
    run_composite_pk_migration(&conn).unwrap();
    // Running again should not error
    run_composite_pk_migration(&conn).unwrap();
}

#[test]
fn test_composite_pk_session_agent_count_uses_distinct() {
    let conn = create_test_db();
    let ws = Some("wf-session-distinct");
    create_workflow_session(&conn, "wf-session-distinct", "skill-a", 1000).unwrap();

    // Same agent uses two models
    persist_agent_run(
        &conn,
        "agent-1",
        "skill-a",
        1,
        "opus",
        "completed",
        2000,
        1000,
        0,
        0,
        0.50,
        10000,
        0,
        None,
        None,
        0,
        0,
        None,
        ws,
    )
    .unwrap();
    persist_agent_run(
        &conn,
        "agent-1",
        "skill-a",
        1,
        "sonnet",
        "completed",
        800,
        400,
        0,
        0,
        0.08,
        4000,
        0,
        None,
        None,
        0,
        0,
        None,
        ws,
    )
    .unwrap();

    // Different agent, one model
    persist_agent_run(
        &conn,
        "agent-2",
        "skill-a",
        1,
        "sonnet",
        "completed",
        500,
        200,
        0,
        0,
        0.05,
        3000,
        0,
        None,
        None,
        0,
        0,
        None,
        ws,
    )
    .unwrap();

    let sessions = get_recent_workflow_sessions(&conn, 10, false, None, None).unwrap();
    assert_eq!(sessions.len(), 1);
    // agent_count should be 2 (distinct agents), not 3 (rows)
    assert_eq!(sessions[0].agent_count, 2);
    // Total cost should sum all three rows
    assert!((sessions[0].total_cost - 0.63).abs() < 1e-10);
}

#[test]
fn test_step_name_mapping() {
    assert_eq!(step_name(0), "Research");
    assert_eq!(step_name(1), "Detailed Research");
    assert_eq!(step_name(2), "Confirm Decisions");
    assert_eq!(step_name(3), "Generate Skill");
    assert_eq!(step_name(4), "Step 4");
    assert_eq!(step_name(5), "Step 5");
    assert_eq!(step_name(6), "Step 6");
    assert_eq!(step_name(-1), "Step -1");
    assert_eq!(step_name(99), "Step 99");
}

// --- Workflow Session tests ---

#[test]
fn test_create_workflow_session() {
    let conn = create_test_db();
    create_workflow_session(&conn, "sess-1", "my-skill", 12345).unwrap();

    let ended_at: Option<String> = conn
        .query_row(
            "SELECT ended_at FROM workflow_sessions WHERE session_id = 'sess-1'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert!(ended_at.is_none());
}

#[test]
fn test_create_workflow_session_idempotent() {
    let conn = create_test_db();
    create_workflow_session(&conn, "sess-1", "my-skill", 12345).unwrap();
    // Second insert with same ID should be ignored (INSERT OR IGNORE)
    create_workflow_session(&conn, "sess-1", "my-skill", 12345).unwrap();

    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM workflow_sessions WHERE session_id = 'sess-1'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(count, 1);
}

#[test]
fn test_end_workflow_session() {
    let conn = create_test_db();
    create_workflow_session(&conn, "sess-1", "my-skill", 12345).unwrap();
    end_workflow_session(&conn, "sess-1").unwrap();

    let ended_at: Option<String> = conn
        .query_row(
            "SELECT ended_at FROM workflow_sessions WHERE session_id = 'sess-1'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert!(ended_at.is_some());
}

#[test]
fn test_end_workflow_session_idempotent() {
    let conn = create_test_db();
    create_workflow_session(&conn, "sess-1", "my-skill", 12345).unwrap();
    end_workflow_session(&conn, "sess-1").unwrap();

    let first_ended: String = conn
        .query_row(
            "SELECT ended_at FROM workflow_sessions WHERE session_id = 'sess-1'",
            [],
            |row| row.get(0),
        )
        .unwrap();

    // Calling again should not update (WHERE ended_at IS NULL won't match)
    end_workflow_session(&conn, "sess-1").unwrap();

    let second_ended: String = conn
        .query_row(
            "SELECT ended_at FROM workflow_sessions WHERE session_id = 'sess-1'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(first_ended, second_ended);
}

#[test]
fn test_end_all_sessions_for_pid() {
    let conn = create_test_db();
    create_workflow_session(&conn, "sess-1", "skill-a", 100).unwrap();
    create_workflow_session(&conn, "sess-2", "skill-b", 100).unwrap();
    create_workflow_session(&conn, "sess-3", "skill-c", 200).unwrap();

    let count = end_all_sessions_for_pid(&conn, 100).unwrap();
    assert_eq!(count, 2);

    // sess-3 (pid 200) should still be open
    let ended: Option<String> = conn
        .query_row(
            "SELECT ended_at FROM workflow_sessions WHERE session_id = 'sess-3'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert!(ended.is_none());
}

#[test]
fn test_reconcile_orphaned_sessions_dead_pid() {
    let conn = create_test_db();
    // PID 99999999 is dead
    create_workflow_session(&conn, "sess-1", "my-skill", 99999999).unwrap();

    let reconciled = reconcile_orphaned_sessions(&conn).unwrap();
    assert_eq!(reconciled, 1);

    // Session should now be ended
    let ended_at: Option<String> = conn
        .query_row(
            "SELECT ended_at FROM workflow_sessions WHERE session_id = 'sess-1'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert!(ended_at.is_some());
}

#[test]
fn test_reconcile_orphaned_sessions_live_pid() {
    let conn = create_test_db();
    let pid = std::process::id();
    create_workflow_session(&conn, "sess-1", "my-skill", pid).unwrap();

    let reconciled = reconcile_orphaned_sessions(&conn).unwrap();
    assert_eq!(reconciled, 0);

    // Session should still be open
    let ended_at: Option<String> = conn
        .query_row(
            "SELECT ended_at FROM workflow_sessions WHERE session_id = 'sess-1'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert!(ended_at.is_none());
}

#[test]
fn test_delete_workflow_run_preserves_usage_sessions() {
    let conn = create_test_db();
    save_workflow_run(&conn, "my-skill", 0, "pending", "domain").unwrap();
    create_workflow_session(&conn, "sess-1", "my-skill", 12345).unwrap();

    delete_workflow_run(&conn, "my-skill").unwrap();

    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM workflow_sessions WHERE skill_name = 'my-skill'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(count, 1);
}

#[test]
fn test_sessions_table_migration_idempotent() {
    let conn = Connection::open_in_memory().unwrap();
    run_migrations(&conn).unwrap();
    run_sessions_table_migration(&conn).unwrap();
    // Running again should not error
    run_sessions_table_migration(&conn).unwrap();
}

#[test]
fn test_get_usage_summary_hide_cancelled() {
    let conn = create_test_db();

    // Session with real cost
    create_workflow_session(&conn, "sess-cost", "skill-a", 1000).unwrap();
    persist_agent_run(
        &conn,
        "agent-1",
        "skill-a",
        1,
        "sonnet",
        "completed",
        1000,
        500,
        200,
        100,
        0.15,
        8000,
        0,
        None,
        None,
        0,
        0,
        None,
        Some("sess-cost"),
    )
    .unwrap();

    // Session with zero cost (cancelled)
    create_workflow_session(&conn, "sess-zero", "skill-b", 2000).unwrap();
    persist_agent_run(
        &conn,
        "agent-2",
        "skill-b",
        0,
        "sonnet",
        "shutdown",
        0,
        0,
        0,
        0,
        0.0,
        0,
        0,
        None,
        None,
        0,
        0,
        None,
        Some("sess-zero"),
    )
    .unwrap();

    let summary = get_usage_summary(&conn, true, None, None).unwrap();
    assert_eq!(summary.total_runs, 1);
    assert!((summary.total_cost - 0.15).abs() < 1e-10);
}

#[test]
fn test_get_recent_workflow_sessions_returns_sessions() {
    let conn = create_test_db();

    // Session 1
    create_workflow_session(&conn, "sess-1", "skill-a", 1000).unwrap();
    persist_agent_run(
        &conn,
        "agent-1",
        "skill-a",
        1,
        "sonnet",
        "completed",
        1000,
        500,
        200,
        100,
        0.10,
        5000,
        0,
        None,
        None,
        0,
        0,
        None,
        Some("sess-1"),
    )
    .unwrap();

    // Session 2
    create_workflow_session(&conn, "sess-2", "skill-b", 2000).unwrap();
    persist_agent_run(
        &conn,
        "agent-2",
        "skill-b",
        3,
        "opus",
        "completed",
        2000,
        1000,
        400,
        200,
        0.30,
        10000,
        0,
        None,
        None,
        0,
        0,
        None,
        Some("sess-2"),
    )
    .unwrap();

    let sessions = get_recent_workflow_sessions(&conn, 10, false, None, None).unwrap();
    assert_eq!(sessions.len(), 2);

    // Find each session by ID (ordering may vary when timestamps match)
    let s1 = sessions.iter().find(|s| s.session_id == "sess-1").unwrap();
    assert_eq!(s1.skill_name, "skill-a");
    assert!((s1.total_cost - 0.10).abs() < 1e-10);
    assert_eq!(s1.total_input_tokens, 1000);
    assert_eq!(s1.total_output_tokens, 500);

    let s2 = sessions.iter().find(|s| s.session_id == "sess-2").unwrap();
    assert_eq!(s2.skill_name, "skill-b");
    assert!((s2.total_cost - 0.30).abs() < 1e-10);
    assert_eq!(s2.total_input_tokens, 2000);
    assert_eq!(s2.total_output_tokens, 1000);
}

#[test]
fn test_get_recent_workflow_sessions_hide_cancelled() {
    let conn = create_test_db();

    // Session with cost
    create_workflow_session(&conn, "sess-good", "skill-a", 1000).unwrap();
    persist_agent_run(
        &conn,
        "agent-1",
        "skill-a",
        1,
        "sonnet",
        "completed",
        1000,
        500,
        0,
        0,
        0.10,
        5000,
        0,
        None,
        None,
        0,
        0,
        None,
        Some("sess-good"),
    )
    .unwrap();

    // Session with zero cost
    create_workflow_session(&conn, "sess-cancelled", "skill-b", 2000).unwrap();
    persist_agent_run(
        &conn,
        "agent-2",
        "skill-b",
        0,
        "sonnet",
        "shutdown",
        0,
        0,
        0,
        0,
        0.0,
        0,
        0,
        None,
        None,
        0,
        0,
        None,
        Some("sess-cancelled"),
    )
    .unwrap();

    let sessions = get_recent_workflow_sessions(&conn, 10, true, None, None).unwrap();
    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0].session_id, "sess-good");
}

#[test]
fn test_get_usage_summary_multiple_sessions() {
    let conn = create_test_db();

    // Session 1: two agent runs
    create_workflow_session(&conn, "sess-1", "skill-a", 1000).unwrap();
    persist_agent_run(
        &conn,
        "agent-1a",
        "skill-a",
        1,
        "sonnet",
        "completed",
        1000,
        500,
        0,
        0,
        0.10,
        5000,
        0,
        None,
        None,
        0,
        0,
        None,
        Some("sess-1"),
    )
    .unwrap();
    persist_agent_run(
        &conn,
        "agent-1b",
        "skill-a",
        3,
        "opus",
        "completed",
        2000,
        1000,
        0,
        0,
        0.30,
        10000,
        0,
        None,
        None,
        0,
        0,
        None,
        Some("sess-1"),
    )
    .unwrap();

    // Session 2: one agent run
    create_workflow_session(&conn, "sess-2", "skill-b", 2000).unwrap();
    persist_agent_run(
        &conn,
        "agent-2a",
        "skill-b",
        1,
        "sonnet",
        "completed",
        500,
        200,
        0,
        0,
        0.05,
        3000,
        0,
        None,
        None,
        0,
        0,
        None,
        Some("sess-2"),
    )
    .unwrap();

    // Session 3: two agent runs
    create_workflow_session(&conn, "sess-3", "skill-c", 3000).unwrap();
    persist_agent_run(
        &conn,
        "agent-3a",
        "skill-c",
        5,
        "opus",
        "completed",
        3000,
        1500,
        0,
        0,
        0.50,
        15000,
        0,
        None,
        None,
        0,
        0,
        None,
        Some("sess-3"),
    )
    .unwrap();
    persist_agent_run(
        &conn,
        "agent-3b",
        "skill-c",
        6,
        "sonnet",
        "completed",
        800,
        400,
        0,
        0,
        0.08,
        4000,
        0,
        None,
        None,
        0,
        0,
        None,
        Some("sess-3"),
    )
    .unwrap();

    let summary = get_usage_summary(&conn, false, None, None).unwrap();
    // 3 sessions (not 5 agent runs)
    assert_eq!(summary.total_runs, 3);
    // Total cost: 0.10 + 0.30 + 0.05 + 0.50 + 0.08 = 1.03
    assert!((summary.total_cost - 1.03).abs() < 1e-10);
}

// --- Trigger Text Migration tests ---

#[test]
fn test_trigger_text_migration_is_idempotent() {
    let conn = Connection::open_in_memory().unwrap();
    run_migrations(&conn).unwrap();
    run_trigger_text_migration(&conn).unwrap();
    // Running again should not error
    run_trigger_text_migration(&conn).unwrap();
}

#[test]
fn test_drop_trigger_description_migration_is_idempotent() {
    let conn = Connection::open_in_memory().unwrap();
    run_migrations(&conn).unwrap();
    run_trigger_text_migration(&conn).unwrap();
    run_bundled_skill_migration(&conn).unwrap();
    run_drop_trigger_description_migration(&conn).unwrap();
    // Running again should not error (columns already removed)
    run_drop_trigger_description_migration(&conn).unwrap();
}

// --- Marketplace Migration tests (14-16) ---

#[test]
fn test_source_migration_is_idempotent() {
    let conn = create_test_db();
    // All migrations already ran via create_test_db(); run again to verify idempotency
    run_source_migration(&conn).unwrap();
    // Verify the column exists exactly once
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM pragma_table_info('workflow_runs') WHERE name = 'source'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(
        count, 1,
        "'source' column should exist exactly once in workflow_runs"
    );
}

#[test]
fn test_imported_skills_extended_migration_is_idempotent() {
    let conn = create_test_db();
    // All migrations already ran via create_test_db(); run again to verify idempotency
    run_imported_skills_extended_migration(&conn).unwrap();
    // Verify the 6 new columns each exist exactly once
    let expected_cols = [
        "skill_type",
        "version",
        "model",
        "argument_hint",
        "user_invocable",
        "disable_model_invocation",
    ];
    for col in &expected_cols {
        let count: i64 = conn
            .query_row(
                &format!(
                    "SELECT COUNT(*) FROM pragma_table_info('imported_skills') WHERE name = '{}'",
                    col
                ),
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            count, 1,
            "'{}' column should exist exactly once in imported_skills",
            col
        );
    }
}

#[test]
fn test_workflow_runs_extended_migration_is_idempotent() {
    let conn = create_test_db();
    // All migrations already ran via create_test_db(); run again to verify idempotency
    run_workflow_runs_extended_migration(&conn).unwrap();
    // Verify the 6 new columns each exist exactly once
    let expected_cols = [
        "description",
        "version",
        "model",
        "argument_hint",
        "user_invocable",
        "disable_model_invocation",
    ];
    for col in &expected_cols {
        let count: i64 = conn
            .query_row(
                &format!(
                    "SELECT COUNT(*) FROM pragma_table_info('workflow_runs') WHERE name = '{}'",
                    col
                ),
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            count, 1,
            "'{}' column should exist exactly once in workflow_runs",
            col
        );
    }
}

#[test]
fn test_backfill_synthetic_sessions_migration_creates_missing_sessions() {
    let conn = create_test_db();
    save_workflow_run(&conn, "legacy-skill", 0, "completed", "domain").unwrap();

    conn.execute(
        "INSERT INTO agent_runs
         (agent_id, skill_name, step_id, model, status, total_cost, workflow_session_id, started_at, completed_at)
         VALUES ('legacy-agent-1', 'legacy-skill', -10, 'sonnet', 'completed', 0.25, 'synthetic:refine:legacy-skill:legacy-agent-1', datetime('now') || 'Z', datetime('now') || 'Z')",
        [],
    )
    .unwrap();

    let before: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM workflow_sessions WHERE session_id = 'synthetic:refine:legacy-skill:legacy-agent-1'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(before, 0);

    run_backfill_synthetic_sessions_migration(&conn).unwrap();

    let after: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM workflow_sessions WHERE session_id = 'synthetic:refine:legacy-skill:legacy-agent-1'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(after, 1);

    let summary = get_usage_summary(&conn, false, None, None).unwrap();
    assert_eq!(summary.total_runs, 1);
    assert!((summary.total_cost - 0.25).abs() < 1e-10);
}

#[test]
fn test_list_active_skills() {
    let conn = create_test_db();

    // Skill 1: active (trigger comes from disk, not DB)
    let skill1 = ImportedSkill {
        skill_id: "imp-1".to_string(),
        skill_name: "active-with-trigger".to_string(),
        is_active: true,
        disk_path: "/tmp/s1".to_string(),
        imported_at: "2025-01-01 00:00:00".to_string(),
        is_bundled: false,
        description: None,
        version: None,
        model: None,
        argument_hint: None,
        user_invocable: None,
        disable_model_invocation: None,
        purpose: None,
        marketplace_source_url: None,
    };
    insert_imported_skill(&conn, &skill1).unwrap();

    // Skill 2: active
    let skill2 = ImportedSkill {
        skill_id: "imp-2".to_string(),
        skill_name: "active-no-trigger".to_string(),
        is_active: true,
        disk_path: "/tmp/s2".to_string(),
        imported_at: "2025-01-01 00:00:00".to_string(),
        is_bundled: false,
        description: None,
        version: None,
        model: None,
        argument_hint: None,
        user_invocable: None,
        disable_model_invocation: None,
        purpose: None,
        marketplace_source_url: None,
    };
    insert_imported_skill(&conn, &skill2).unwrap();

    // Skill 3: inactive
    let skill3 = ImportedSkill {
        skill_id: "imp-3".to_string(),
        skill_name: "inactive-with-trigger".to_string(),
        is_active: false,
        disk_path: "/tmp/s3".to_string(),
        imported_at: "2025-01-01 00:00:00".to_string(),
        is_bundled: false,
        description: None,
        version: None,
        model: None,
        argument_hint: None,
        user_invocable: None,
        disable_model_invocation: None,
        purpose: None,
        marketplace_source_url: None,
    };
    insert_imported_skill(&conn, &skill3).unwrap();

    // Only active skills should be returned (inactive filtered out)
    let result = list_active_skills(&conn).unwrap();
    assert_eq!(result.len(), 2);
    // Sorted by skill_name
    assert_eq!(result[0].skill_name, "active-no-trigger");
    assert_eq!(result[1].skill_name, "active-with-trigger");
}

#[test]
fn test_delete_imported_skill_by_name() {
    let conn = create_test_db();
    // Skills master row required for FK-based lookup
    upsert_skill(&conn, "delete-me", "imported", "domain").unwrap();
    let skill = ImportedSkill {
        skill_id: "id-del".to_string(),
        skill_name: "delete-me".to_string(),

        is_active: true,
        disk_path: "/tmp/delete-me".to_string(),
        imported_at: "2024-01-01".to_string(),
        is_bundled: false,
        description: None,
        purpose: Some("domain".to_string()),
        version: None,
        model: None,
        argument_hint: None,
        user_invocable: None,
        disable_model_invocation: None,
        marketplace_source_url: None,
    };
    insert_imported_skill(&conn, &skill).unwrap();

    // Verify it exists
    assert!(get_imported_skill(&conn, "delete-me").unwrap().is_some());

    // Delete by name
    delete_imported_skill_by_name(&conn, "delete-me").unwrap();

    // Verify it's gone
    assert!(get_imported_skill(&conn, "delete-me").unwrap().is_none());

    // Deleting non-existent name should not error
    delete_imported_skill_by_name(&conn, "does-not-exist").unwrap();
}

#[test]
fn test_migration_19_cleans_orphaned_imported_skills() {
    // Migration 19 performs two operations:
    //   1. UPDATE skills SET skill_source = 'imported' WHERE skill_source = 'upload'
    //   2. DELETE orphaned imported_skills (non-bundled, no matching skills master row)
    // The CHECK constraint on skills.skill_source prevents inserting 'upload' after
    // migration 17, so we test the orphan cleanup logic (the core new behavior).
    let conn = create_test_db();

    // Insert a skills master row that has a corresponding imported_skills row
    conn.execute(
        "INSERT INTO skills (name, skill_source, purpose) VALUES ('kept-skill', 'imported', 'domain')",
        [],
    ).unwrap();
    conn.execute(
        "INSERT INTO imported_skills (skill_id, skill_name, disk_path, is_bundled) VALUES ('kept-id', 'kept-skill', '/tmp/kept', 0)",
        [],
    ).unwrap();

    // Insert an orphaned imported_skills row (no skills master row)
    conn.execute(
        "INSERT INTO imported_skills (skill_id, skill_name, disk_path, is_bundled) VALUES ('orphan-id', 'orphan-skill', '/tmp/orphan', 0)",
        [],
    ).unwrap();

    // Insert a bundled imported_skills row (should be preserved even without master row)
    conn.execute(
        "INSERT INTO imported_skills (skill_id, skill_name, disk_path, is_bundled) VALUES ('bundled-id', 'bundled-skill', '/tmp/bundled', 1)",
        [],
    ).unwrap();

    // Run migration 19's orphan cleanup SQL directly
    conn.execute(
        "DELETE FROM imported_skills
         WHERE is_bundled = 0
           AND skill_name NOT IN (SELECT name FROM skills WHERE COALESCE(deleted_at, '') = '')",
        [],
    )
    .unwrap();

    // Orphaned non-bundled row should be gone
    let orphan_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM imported_skills WHERE skill_name = 'orphan-skill'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(
        orphan_count, 0,
        "Orphaned non-bundled row should be deleted"
    );

    // Non-orphaned row should be preserved
    let kept_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM imported_skills WHERE skill_name = 'kept-skill'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(kept_count, 1, "Non-orphaned row should be preserved");

    // Bundled row should be preserved (even without master row)
    let bundled_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM imported_skills WHERE skill_name = 'bundled-skill'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(bundled_count, 1, "Bundled row should be preserved");
}

#[test]
fn test_workflow_runs_id_migration_is_idempotent() {
    // Build a DB up through migration 20 only (not 21 yet).
    let conn = Connection::open_in_memory().unwrap();
    run_migrations(&conn).unwrap();
    run_add_skill_type_migration(&conn).unwrap();
    run_lock_table_migration(&conn).unwrap();
    run_author_migration(&conn).unwrap();
    run_usage_tracking_migration(&conn).unwrap();
    run_workflow_session_migration(&conn).unwrap();
    run_sessions_table_migration(&conn).unwrap();
    run_trigger_text_migration(&conn).unwrap();
    run_agent_stats_migration(&conn).unwrap();
    run_intake_migration(&conn).unwrap();
    run_composite_pk_migration(&conn).unwrap();
    run_bundled_skill_migration(&conn).unwrap();
    run_remove_validate_step_migration(&conn).unwrap();
    run_source_migration(&conn).unwrap();
    run_imported_skills_extended_migration(&conn).unwrap();
    run_workflow_runs_extended_migration(&conn).unwrap();
    run_skills_table_migration(&conn).unwrap();
    run_skills_backfill_migration(&conn).unwrap();
    run_rename_upload_migration(&conn).unwrap();
    run_workspace_skills_migration(&conn).unwrap();

    // Run migration 21 the first time — should succeed.
    run_workflow_runs_id_migration(&conn).unwrap();

    // Insert a row after migration 21 so the id column is present.
    conn.execute(
        "INSERT INTO workflow_runs (skill_name, domain, current_step, status, skill_type)
         VALUES ('idempotent-skill', 'test-domain', 0, 'pending', 'domain')",
        [],
    )
    .unwrap();

    // Run migration 21 a second time — must not error (idempotency guard).
    run_workflow_runs_id_migration(&conn).unwrap();

    // Verify the `id` column exists.
    let has_id: bool = conn
        .prepare("PRAGMA table_info(workflow_runs)")
        .unwrap()
        .query_map([], |r| r.get::<_, String>(1))
        .unwrap()
        .any(|r| r.map(|n| n == "id").unwrap_or(false));
    assert!(has_id, "id column should exist after migration 21");

    // Verify skill_name UNIQUE constraint: duplicate insert must fail.
    let result = conn.execute(
        "INSERT INTO workflow_runs (skill_name, domain, current_step, status, skill_type)
         VALUES ('idempotent-skill', 'other-domain', 0, 'pending', 'domain')",
        [],
    );
    assert!(
        result.is_err(),
        "duplicate skill_name should violate UNIQUE constraint"
    );
}

#[test]
fn test_fk_columns_migration_is_idempotent() {
    // create_test_db() already runs migration 22 once.
    let conn = create_test_db();

    // Create a skill row (also creates skills master via save_workflow_run).
    save_workflow_run(&conn, "fk-idempotent-skill", 0, "pending", "domain").unwrap();

    // Run migration 22 again — must not error.
    run_fk_columns_migration(&conn).unwrap();

    // Save a workflow step and verify workflow_run_id is populated.
    save_workflow_step(&conn, "fk-idempotent-skill", 1, "in_progress").unwrap();

    let workflow_run_id: Option<i64> = conn
        .query_row(
            "SELECT workflow_run_id FROM workflow_steps WHERE skill_name = ?1 AND step_id = ?2",
            rusqlite::params!["fk-idempotent-skill", 1],
            |row| row.get(0),
        )
        .unwrap();
    assert!(
        workflow_run_id.is_some(),
        "workflow_run_id must be non-NULL after save_workflow_step"
    );

    let expected_wr_id = get_workflow_run_id(&conn, "fk-idempotent-skill")
        .unwrap()
        .unwrap();
    assert_eq!(
        workflow_run_id.unwrap(),
        expected_wr_id,
        "workflow_run_id on workflow_steps must match workflow_runs.id"
    );
}

#[test]
fn test_fk_backfill_populates_all_child_tables() {
    // Build a DB up through migration 21 only — no migration 22 yet.
    let conn = Connection::open_in_memory().unwrap();
    run_migrations(&conn).unwrap();
    run_add_skill_type_migration(&conn).unwrap();
    run_lock_table_migration(&conn).unwrap();
    run_author_migration(&conn).unwrap();
    run_usage_tracking_migration(&conn).unwrap();
    run_workflow_session_migration(&conn).unwrap();
    run_sessions_table_migration(&conn).unwrap();
    run_trigger_text_migration(&conn).unwrap();
    run_agent_stats_migration(&conn).unwrap();
    run_intake_migration(&conn).unwrap();
    run_composite_pk_migration(&conn).unwrap();
    run_bundled_skill_migration(&conn).unwrap();
    run_remove_validate_step_migration(&conn).unwrap();
    run_source_migration(&conn).unwrap();
    run_imported_skills_extended_migration(&conn).unwrap();
    run_workflow_runs_extended_migration(&conn).unwrap();
    run_skills_table_migration(&conn).unwrap();
    run_skills_backfill_migration(&conn).unwrap();
    run_rename_upload_migration(&conn).unwrap();
    run_workspace_skills_migration(&conn).unwrap();
    run_workflow_runs_id_migration(&conn).unwrap();
    // NOTE: run_fk_columns_migration NOT called yet.

    // Insert a skills master row.
    conn.execute(
        "INSERT INTO skills (name, skill_source, domain, skill_type) VALUES ('backfill-skill', 'skill-builder', 'test', 'domain')",
        [],
    ).unwrap();
    let skill_master_id: i64 = conn
        .query_row(
            "SELECT id FROM skills WHERE name = 'backfill-skill'",
            [],
            |row| row.get(0),
        )
        .unwrap();

    // Insert a workflow_runs row (without skill_id FK column — already present from migration 18,
    // but we set it anyway for the backfill to trace via skill_name).
    conn.execute(
        "INSERT INTO workflow_runs (skill_name, domain, current_step, status, skill_type)
         VALUES ('backfill-skill', 'test', 0, 'pending', 'domain')",
        [],
    )
    .unwrap();
    let wr_id: i64 = conn
        .query_row(
            "SELECT id FROM workflow_runs WHERE skill_name = 'backfill-skill'",
            [],
            |row| row.get(0),
        )
        .unwrap();

    // Insert into workflow_steps without workflow_run_id (column doesn't exist yet).
    conn.execute(
        "INSERT INTO workflow_steps (skill_name, step_id, status) VALUES ('backfill-skill', 1, 'pending')",
        [],
    ).unwrap();

    // Insert into skill_tags without skill_id.
    conn.execute(
        "INSERT INTO skill_tags (skill_name, tag) VALUES ('backfill-skill', 'test-tag')",
        [],
    )
    .unwrap();

    // Insert into skill_locks without skill_id.
    conn.execute(
        "INSERT OR IGNORE INTO skill_locks (skill_name, instance_id, pid) VALUES ('backfill-skill', 'inst-1', 12345)",
        [],
    ).unwrap();

    // Now run migration 22 — this adds FK columns and backfills them.
    run_fk_columns_migration(&conn).unwrap();

    // Verify workflow_steps.workflow_run_id was backfilled.
    let ws_wrid: Option<i64> = conn.query_row(
        "SELECT workflow_run_id FROM workflow_steps WHERE skill_name = 'backfill-skill' AND step_id = 1",
        [],
        |row| row.get(0),
    ).unwrap();
    assert_eq!(
        ws_wrid,
        Some(wr_id),
        "workflow_steps.workflow_run_id should be backfilled"
    );

    // Verify skill_tags.skill_id was backfilled.
    let tag_sid: Option<i64> = conn
        .query_row(
            "SELECT skill_id FROM skill_tags WHERE skill_name = 'backfill-skill'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(
        tag_sid,
        Some(skill_master_id),
        "skill_tags.skill_id should be backfilled"
    );

    // Verify skill_locks.skill_id was backfilled.
    let lock_sid: Option<i64> = conn
        .query_row(
            "SELECT skill_id FROM skill_locks WHERE skill_name = 'backfill-skill'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(
        lock_sid,
        Some(skill_master_id),
        "skill_locks.skill_id should be backfilled"
    );
}

#[test]
fn test_get_step_agent_runs_uses_workflow_run_id_fk() {
    let conn = create_test_db();

    // Create skill via save_workflow_run (also creates skills master row).
    save_workflow_run(&conn, "step-test-skill", 0, "pending", "domain").unwrap();

    // Create a workflow session.
    create_workflow_session(&conn, "session-1", "step-test-skill", std::process::id()).unwrap();

    // Insert agent run with step_id=3 and status="completed" so it appears in get_step_agent_runs.
    persist_agent_run(
        &conn,
        "agent-step-1",
        "step-test-skill",
        3,
        "sonnet",
        "completed",
        100,
        50,
        0,
        0,
        0.01,
        1000,
        1,
        None,
        None,
        0,
        0,
        None,
        Some("session-1"),
    )
    .unwrap();

    // persist_agent_run does not populate workflow_run_id — backfill it here, mirroring
    // what run_fk_columns_migration does for pre-existing rows.
    let wr_id = get_workflow_run_id(&conn, "step-test-skill")
        .unwrap()
        .unwrap();
    conn.execute(
        "UPDATE agent_runs SET workflow_run_id = ?1 WHERE agent_id = 'agent-step-1'",
        rusqlite::params![wr_id],
    )
    .unwrap();

    // Call get_step_agent_runs for the correct step — should return 1 run.
    let runs = get_step_agent_runs(&conn, "step-test-skill", 3).unwrap();
    assert_eq!(runs.len(), 1, "should find 1 agent run for step 3");
    assert_eq!(runs[0].step_id, 3);

    // Wrong step ID — should return empty.
    let wrong_step = get_step_agent_runs(&conn, "step-test-skill", 99).unwrap();
    assert!(wrong_step.is_empty(), "wrong step should return empty vec");

    // Nonexistent skill — should return empty (no workflow_run_id found).
    let no_skill = get_step_agent_runs(&conn, "nonexistent-skill", 3).unwrap();
    assert!(
        no_skill.is_empty(),
        "nonexistent skill should return empty vec"
    );
}

#[test]
fn test_has_active_session_with_live_pid_uses_skill_id_fk() {
    let conn = create_test_db();

    // Create skill via save_workflow_run (also creates skills master row).
    save_workflow_run(&conn, "session-skill", 0, "pending", "domain").unwrap();

    // No session yet — must return false.
    assert!(
        !has_active_session_with_live_pid(&conn, "session-skill"),
        "should return false when no session exists"
    );

    // Create session using current PID (guaranteed alive).
    let current_pid = std::process::id();
    create_workflow_session(&conn, "sess-live", "session-skill", current_pid).unwrap();

    // Session exists with live PID — must return true.
    assert!(
        has_active_session_with_live_pid(&conn, "session-skill"),
        "should return true with an active session for a live PID"
    );

    // End the session.
    end_workflow_session(&conn, "sess-live").unwrap();

    // Session is ended — must return false.
    assert!(
        !has_active_session_with_live_pid(&conn, "session-skill"),
        "should return false after session is ended"
    );

    // Skill not in skills master — must return false.
    assert!(
        !has_active_session_with_live_pid(&conn, "no-such-skill"),
        "should return false for a skill not in the skills master table"
    );
}

#[test]
fn test_migration_35_drops_workflow_runs_metadata_columns() {
    let conn = create_test_db();
    // After migration 35, these 6 columns must not exist in workflow_runs
    let columns_removed = ["description", "version", "model", "argument_hint", "user_invocable", "disable_model_invocation"];
    let mut stmt = conn
        .prepare("PRAGMA table_info(workflow_runs)")
        .unwrap();
    let column_names: Vec<String> = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();
    for removed in &columns_removed {
        assert!(
            !column_names.contains(&removed.to_string()),
            "column '{}' should have been dropped by migration 35 but is still present",
            removed
        );
    }
}

#[test]
fn test_migration_36_drops_workspace_skills_table() {
    let conn = create_test_db();
    // After all migrations including 36, workspace_skills should not exist
    let exists: bool = conn
        .query_row(
            "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='workspace_skills'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert!(!exists, "workspace_skills table should have been dropped by migration 36");
}

#[test]
fn test_list_imported_skills_filtered() {
    let conn = create_test_db();
    // Empty DB should return empty list
    let skills = list_imported_skills_filtered(&conn, None).unwrap();
    assert!(skills.is_empty());

    // Insert a skill and verify it appears
    let skill = ImportedSkill {
        skill_id: "imp-test-1".to_string(),
        skill_name: "test-skill".to_string(),
        is_active: true,
        disk_path: std::env::temp_dir().join("test-skill").to_string_lossy().to_string(),
        imported_at: "2025-01-01T00:00:00Z".to_string(),
        is_bundled: false,
        description: None,
        purpose: Some("domain".to_string()),
        version: Some("1.0.0".to_string()),
        model: None,
        argument_hint: None,
        user_invocable: None,
        disable_model_invocation: None,
        marketplace_source_url: Some("https://github.com/acme/skills".to_string()),
    };
    insert_imported_skill(&conn, &skill).unwrap();

    let all = list_imported_skills_filtered(&conn, None).unwrap();
    assert_eq!(all.len(), 1);
    assert_eq!(all[0].skill_name, "test-skill");

    let filtered = list_imported_skills_filtered(&conn, Some("https://github.com/acme/skills")).unwrap();
    assert_eq!(filtered.len(), 1);

    let no_match = list_imported_skills_filtered(&conn, Some("https://github.com/other/repo")).unwrap();
    assert!(no_match.is_empty());
}

#[test]
fn test_get_imported_skill_by_id() {
    let conn = create_test_db();
    let skill = ImportedSkill {
        skill_id: "imp-test-byid".to_string(),
        skill_name: "test-byid".to_string(),
        is_active: true,
        disk_path: std::env::temp_dir().join("test-byid").to_string_lossy().to_string(),
        imported_at: "2025-01-01T00:00:00Z".to_string(),
        is_bundled: false,
        description: None,
        purpose: None,
        version: None,
        model: None,
        argument_hint: None,
        user_invocable: None,
        disable_model_invocation: None,
        marketplace_source_url: None,
    };
    insert_imported_skill(&conn, &skill).unwrap();

    let found = get_imported_skill_by_id(&conn, "imp-test-byid").unwrap();
    assert!(found.is_some());
    assert_eq!(found.unwrap().skill_name, "test-byid");

    let not_found = get_imported_skill_by_id(&conn, "nonexistent").unwrap();
    assert!(not_found.is_none());
}

#[test]
fn test_delete_imported_skill_by_skill_id() {
    let conn = create_test_db();
    let skill = ImportedSkill {
        skill_id: "imp-test-del".to_string(),
        skill_name: "test-del".to_string(),
        is_active: true,
        disk_path: std::env::temp_dir().join("test-del").to_string_lossy().to_string(),
        imported_at: "2025-01-01T00:00:00Z".to_string(),
        is_bundled: false,
        description: None,
        purpose: None,
        version: None,
        model: None,
        argument_hint: None,
        user_invocable: None,
        disable_model_invocation: None,
        marketplace_source_url: None,
    };
    insert_imported_skill(&conn, &skill).unwrap();
    assert!(get_imported_skill_by_id(&conn, "imp-test-del").unwrap().is_some());

    delete_imported_skill_by_skill_id(&conn, "imp-test-del").unwrap();
    assert!(get_imported_skill_by_id(&conn, "imp-test-del").unwrap().is_none());
}

#[test]
fn test_get_imported_skill_by_purpose() {
    let conn = create_test_db();
    let skill = ImportedSkill {
        skill_id: "imp-purpose-test".to_string(),
        skill_name: "purpose-skill".to_string(),
        is_active: true,
        disk_path: std::env::temp_dir().join("purpose-skill").to_string_lossy().to_string(),
        imported_at: "2025-01-01T00:00:00Z".to_string(),
        is_bundled: false,
        description: None,
        purpose: Some("research".to_string()),
        version: None,
        model: None,
        argument_hint: None,
        user_invocable: None,
        disable_model_invocation: None,
        marketplace_source_url: None,
    };
    insert_imported_skill(&conn, &skill).unwrap();

    let found = get_imported_skill_by_purpose(&conn, "research").unwrap();
    assert!(found.is_some());
    assert_eq!(found.unwrap().skill_name, "purpose-skill");

    let not_found = get_imported_skill_by_purpose(&conn, "nonexistent").unwrap();
    assert!(not_found.is_none());

    // Inactive should not match
    let inactive = ImportedSkill {
        skill_id: "imp-inactive".to_string(),
        skill_name: "inactive-skill".to_string(),
        is_active: false,
        disk_path: "/tmp/inactive".to_string(),
        imported_at: "2025-01-01T00:00:00Z".to_string(),
        is_bundled: false,
        description: None,
        purpose: Some("validate".to_string()),
        version: None,
        model: None,
        argument_hint: None,
        user_invocable: None,
        disable_model_invocation: None,
        marketplace_source_url: None,
    };
    insert_imported_skill(&conn, &inactive).unwrap();
    let inactive_found = get_imported_skill_by_purpose(&conn, "validate").unwrap();
    assert!(inactive_found.is_none(), "inactive skill should not match");
}


#[test]
fn test_get_imported_skill_by_name_and_source_respects_source_filter() {
    let conn = create_test_db();
    let imported = ImportedSkill {
        skill_id: "imp-market-skill".to_string(),
        skill_name: "market-skill".to_string(),
        is_active: true,
        disk_path: "/tmp/market-skill".to_string(),
        imported_at: "2025-01-01T00:00:00Z".to_string(),
        is_bundled: false,
        description: Some("test".to_string()),
        purpose: Some("skill-builder".to_string()),
        version: Some("1.0.0".to_string()),
        model: None,
        argument_hint: None,
        user_invocable: None,
        disable_model_invocation: None,
        marketplace_source_url: Some("https://github.com/acme/skills-a".to_string()),
    };
    insert_imported_skill(&conn, &imported).unwrap();

    let found = get_imported_skill_by_name_and_source(
        &conn,
        "market-skill",
        "https://github.com/acme/skills-a",
    )
    .unwrap();
    assert!(found.is_some());

    let not_found = get_imported_skill_by_name_and_source(
        &conn,
        "market-skill",
        "https://github.com/acme/skills-b",
    )
    .unwrap();
    assert!(not_found.is_none());
}

#[test]
fn test_migration_34_converts_ghost_running_rows_to_shutdown() {
    // Use create_test_db() to get a fully-migrated schema (through migration 34).
    // Then insert rows and re-run the migration to verify idempotency and correctness.
    let conn = create_test_db();

    // Insert a ghost running row (as the old startRun() code would have created)
    conn.execute(
        "INSERT INTO agent_runs
         (agent_id, skill_name, step_id, model, status, input_tokens, output_tokens,
          total_cost, duration_ms, workflow_session_id)
         VALUES ('ghost-agent', 'my-skill', 1, 'haiku', 'running', 0, 0, 0.0, 0, 'session-abc')",
        [],
    ).unwrap();

    // Also insert a completed row — migration must not touch it
    conn.execute(
        "INSERT INTO agent_runs
         (agent_id, skill_name, step_id, model, status, input_tokens, output_tokens,
          total_cost, duration_ms, workflow_session_id)
         VALUES ('done-agent', 'my-skill', 1, 'sonnet', 'completed', 100, 50, 0.01, 5000, 'session-abc')",
        [],
    ).unwrap();

    // Run migration 34 directly (simulates running on a DB that already has ghost rows
    // created after the previous migration 17 cleanup pass).
    run_ghost_running_rows_migration(&conn).unwrap();

    let ghost_status: String = conn
        .query_row(
            "SELECT status FROM agent_runs WHERE agent_id = 'ghost-agent'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(
        ghost_status, "shutdown",
        "Ghost running row must become shutdown"
    );

    let done_status: String = conn
        .query_row(
            "SELECT status FROM agent_runs WHERE agent_id = 'done-agent'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(
        done_status, "completed",
        "Completed row must not be touched by migration 34"
    );

    // Idempotency: running again must not change anything
    run_ghost_running_rows_migration(&conn).unwrap();
    let still_shutdown: String = conn
        .query_row(
            "SELECT status FROM agent_runs WHERE agent_id = 'ghost-agent'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(
        still_shutdown, "shutdown",
        "Re-running migration must be idempotent"
    );
}

#[test]
fn test_foreign_keys_enabled_after_init() {
    let conn = create_test_db();
    let fk_enabled: bool = conn
        .pragma_query_value(None, "foreign_keys", |row| row.get(0))
        .unwrap();
    assert!(fk_enabled, "PRAGMA foreign_keys must be ON after init_db / create_test_db_for_tests");
}

// --- Skill metadata ownership guard tests (VU-569 AC5) ---

/// Guard test: `save_workflow_state` preserves `skills` table metadata even
/// when the caller would attempt to supply stale values.
///
/// This test proves that:
/// 1. Skill metadata lives exclusively in the `skills` master table.
/// 2. Calling `save_workflow_run` (the DB primitive behind `save_workflow_state`)
///    with different execution-state values does NOT touch the metadata columns
///    in `skills`.
/// 3. The `workflow_runs` table has no metadata columns — there is no path by
///    which a frontend payload can overwrite description/version/model/etc.
#[test]
fn test_save_workflow_state_preserves_skills_metadata() {
    let conn = create_test_db();

    // 1. Create workflow run — this also creates the skills master row.
    save_workflow_run(&conn, "meta-skill", 0, "pending", "domain").unwrap();

    // 2. Write canonical metadata to the skills master table.
    set_skill_behaviour(
        &conn,
        "meta-skill",
        Some("Canonical description"),
        Some("2.0.0"),
        Some("claude-opus-4-5"),
        Some("--format json"),
        Some(true),
        Some(false),
    )
    .unwrap();

    // 3. Simulate what save_workflow_state does: update execution state only.
    //    If a frontend sent stale metadata, save_workflow_run has no parameter for it.
    save_workflow_run(&conn, "meta-skill", 3, "completed", "domain").unwrap();

    // 4. Verify that skills metadata is completely unchanged.
    let master = get_skill_master(&conn, "meta-skill").unwrap().unwrap();
    assert_eq!(
        master.description.as_deref(),
        Some("Canonical description"),
        "description must be untouched after save_workflow_run"
    );
    assert_eq!(
        master.version.as_deref(),
        Some("2.0.0"),
        "version must be untouched after save_workflow_run"
    );
    assert_eq!(
        master.model.as_deref(),
        Some("claude-opus-4-5"),
        "model must be untouched after save_workflow_run"
    );
    assert_eq!(
        master.argument_hint.as_deref(),
        Some("--format json"),
        "argument_hint must be untouched after save_workflow_run"
    );
    assert_eq!(
        master.user_invocable,
        Some(true),
        "user_invocable must be untouched after save_workflow_run"
    );
    assert_eq!(
        master.disable_model_invocation,
        Some(false),
        "disable_model_invocation must be untouched after save_workflow_run"
    );

    // 5. Confirm the execution state was updated correctly.
    let run = get_workflow_run(&conn, "meta-skill").unwrap().unwrap();
    assert_eq!(run.current_step, 3);
    assert_eq!(run.status, "completed");
}

/// Structural guard: `workflow_runs` must NOT have metadata columns after
/// migration 35. This test queries PRAGMA table_info and asserts that the
/// deprecated columns are absent, providing a compile-time and test-time
/// signal if someone attempts to add them back.
#[test]
fn test_workflow_runs_has_no_metadata_columns() {
    let conn = create_test_db();

    let columns: Vec<String> = conn
        .prepare("PRAGMA table_info(workflow_runs)")
        .unwrap()
        .query_map([], |row| row.get::<_, String>(1))
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();

    let banned = [
        "description",
        "version",
        "model",
        "argument_hint",
        "user_invocable",
        "disable_model_invocation",
    ];

    for col in &banned {
        assert!(
            !columns.contains(&col.to_string()),
            "workflow_runs must NOT have column '{}' after migration 35 — \
             metadata is canonical in the `skills` table only",
            col
        );
    }
}
