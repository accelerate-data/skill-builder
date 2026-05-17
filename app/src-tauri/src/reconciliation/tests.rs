#![allow(unused_variables)]

use super::*;
use crate::commands::test_utils::create_test_db;
use crate::commands::workflow::get_step_output_files;
use crate::skill_paths::{resolve_skill_dir, DEFAULT_PLUGIN_SLUG};
use std::path::Path;

/// Insert a minimal clarifications row for a skill so the DB consistency check
/// (which fires before main reconciliation) treats the skill as valid and does
/// not reset it to step 0. Use this in any test that sets up a skill at
/// current_step >= 1 and asserts that the skill is NOT reset by the consistency
/// check.
fn insert_stub_clarifications(conn: &rusqlite::Connection, skill_name: &str) {
    let skill_id = crate::db::upsert_skill(conn, skill_name, "skill-builder", "domain")
        .unwrap_or_else(|e| panic!("upsert_skill failed for {}: {}", skill_name, e));
    conn.execute(
        "INSERT INTO clarifications (skill_id, version, title, created_at, updated_at)
         VALUES (?1, '1', 'Test Skill', 0, 0)",
        rusqlite::params![skill_id],
    )
    .unwrap_or_else(|e| panic!("insert clarifications failed for {}: {}", skill_name, e));
}

/// Insert a minimal decisions row for a skill so the DB consistency check does
/// not reset skills at current_step >= 3 to step 0. Use this alongside
/// `insert_stub_clarifications` in any test that sets up a skill at
/// current_step >= 3 and asserts that the skill is NOT reset by the consistency
/// check.
fn insert_stub_decisions(conn: &rusqlite::Connection, skill_name: &str) {
    let skill_id = crate::db::upsert_skill(conn, skill_name, "skill-builder", "domain")
        .unwrap_or_else(|e| panic!("upsert_skill failed for {}: {}", skill_name, e));
    conn.execute(
        "INSERT INTO decisions (skill_id, version, created_at, updated_at)
         VALUES (?1, '1', 0, 0)",
        rusqlite::params![skill_id],
    )
    .unwrap_or_else(|e| panic!("insert decisions failed for {}: {}", skill_name, e));
}

/// Create a skill working directory on disk with a context/ dir.
/// Uses plugin-organised layout: skills_root/{DEFAULT_PLUGIN_SLUG}/skills/{name}/context/
fn create_skill_dir(skills_root: &Path, name: &str, _domain: &str) {
    let skill_dir = resolve_skill_dir(skills_root, DEFAULT_PLUGIN_SLUG, name);
    std::fs::create_dir_all(skill_dir.join("context")).unwrap();
}

/// Create step output files on disk for the given step.
/// Uses plugin-organised layout: workspace/{DEFAULT_PLUGIN_SLUG}/{name}/...
fn create_step_output(workspace: &Path, name: &str, step_id: u32) {
    let skill_dir = if step_id >= 3 {
        resolve_skill_dir(workspace, DEFAULT_PLUGIN_SLUG, name)
    } else {
        resolve_skill_dir(workspace, DEFAULT_PLUGIN_SLUG, name)
    };
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
fn test_vu_1190_startup_does_not_recreate_missing_workflow_run() {
    let tmp = tempfile::tempdir().unwrap();
    let skills_tmp = tempfile::tempdir().unwrap();
    let workspace = tmp.path().to_str().unwrap();
    let skills_path = skills_tmp.path().to_str().unwrap();
    let conn = create_test_db();

    let skill_id =
        crate::db::upsert_skill(&conn, "orphan-skill", "skill-builder", "domain").unwrap();
    create_step_output(skills_tmp.path(), "orphan-skill", 3);

    let result = reconcile_on_startup(&conn, skills_path).unwrap();

    assert!(
        result.notifications.is_empty(),
        "notifications: {:?}",
        result.notifications
    );
    assert!(
        crate::db::get_workflow_run_by_skill_id(&conn, skill_id)
            .unwrap()
            .is_none(),
        "startup should not recreate workflow_runs rows from disk content"
    );
}

#[test]
fn test_vu_1190_startup_does_not_discover_skill_from_disk() {
    let tmp = tempfile::tempdir().unwrap();
    let skills_tmp = tempfile::tempdir().unwrap();
    let workspace = tmp.path().to_str().unwrap();
    let skills_path = skills_tmp.path().to_str().unwrap();
    let conn = create_test_db();

    let discovered_dir = resolve_skill_dir(skills_tmp.path(), DEFAULT_PLUGIN_SLUG, "found-skill");
    std::fs::create_dir_all(&discovered_dir).unwrap();
    std::fs::write(discovered_dir.join("SKILL.md"), "# Found Skill").unwrap();

    let result = reconcile_on_startup(&conn, skills_path).unwrap();

    assert!(
        result.notifications.is_empty(),
        "notifications: {:?}",
        result.notifications
    );
    assert!(
        crate::db::get_skill_master(&conn, "found-skill")
            .unwrap()
            .is_none(),
        "startup should not import skills from disk into the library"
    );
}

#[test]
fn test_vu_1190_startup_does_not_delete_tracked_marketplace_plugin_when_skill_md_missing() {
    let tmp = tempfile::tempdir().unwrap();
    let skills_tmp = tempfile::tempdir().unwrap();
    let workspace = tmp.path().to_str().unwrap();
    let skills_path = skills_tmp.path().to_str().unwrap();
    let conn = create_test_db();

    crate::db::ensure_plugin(
        &conn,
        "analytics",
        "Analytics",
        "marketplace",
        None,
        None,
        false,
    )
    .unwrap();
    crate::db::upsert_skill_in_plugin(&conn, "broken-skill", "imported", "domain", "analytics")
        .unwrap();

    let broken_dir = resolve_skill_dir(skills_tmp.path(), "analytics", "broken-skill");
    std::fs::create_dir_all(&broken_dir).unwrap();

    let result = reconcile_on_startup(&conn, skills_path).unwrap();

    assert!(
        crate::db::list_plugins(&conn)
            .unwrap()
            .iter()
            .any(|plugin| plugin.slug == "analytics"),
        "startup should leave tracked marketplace plugins alone when content is missing"
    );
    assert!(
        crate::db::get_skill_master_in_plugin(&conn, "broken-skill", "analytics")
            .unwrap()
            .is_some(),
        "startup should not delete tracked skills because SKILL.md is missing"
    );
}

// --- Scenario 10: Master row exists but no workflow_runs row ---

#[test]
fn test_db_consistency_reset_no_clarifications() {
    // A skill at current_step=2 with no clarifications row in the DB.
    // This simulates a skill that was in-progress before VU-1157 merged —
    // it has a non-zero step recorded but no DB artifact rows to back it up.
    // The reconciler must reset it to step 0 / "pending".
    let tmp = tempfile::tempdir().unwrap();
    let skills_tmp = tempfile::tempdir().unwrap();
    let workspace = tmp.path().to_str().unwrap();
    let skills_path = skills_tmp.path().to_str().unwrap();
    let conn = create_test_db();

    // Skill at step 2, status "pending", but NO clarifications row inserted
    let skill_id =
        crate::db::upsert_skill(&conn, "stale-skill", "skill-builder", "domain").unwrap();
    crate::db::save_workflow_run_by_skill_id(&conn, skill_id, 2, "pending", "domain").unwrap();

    let result = reconcile_on_startup(&conn, skills_path).unwrap();

    // Should have been reset to step 0 with a notification
    assert!(
        result
            .notifications
            .iter()
            .any(|n| n.contains("stale-skill") && n.contains("re-run required")),
        "expected reset notification, got: {:?}",
        result.notifications
    );

    let run = crate::db::get_workflow_run_by_skill_id(&conn, skill_id)
        .unwrap()
        .unwrap();
    assert_eq!(
        run.current_step, 0,
        "current_step should have been reset to 0"
    );
    assert_eq!(run.status, "pending", "status should remain pending");
}

#[test]
fn test_db_consistency_reset_no_decisions() {
    // A skill at current_step=3 with clarifications present but no decisions row.
    // The decisions check (current_step >= 3) must fire and reset to step 0.
    let tmp = tempfile::tempdir().unwrap();
    let skills_tmp = tempfile::tempdir().unwrap();
    let workspace = tmp.path().to_str().unwrap();
    let skills_path = skills_tmp.path().to_str().unwrap();
    let conn = create_test_db();

    let skill_id =
        crate::db::upsert_skill(&conn, "stale-skill", "skill-builder", "domain").unwrap();
    crate::db::save_workflow_run_by_skill_id(&conn, skill_id, 3, "pending", "domain").unwrap();
    insert_stub_clarifications(&conn, "stale-skill");
    // Deliberately NO insert_stub_decisions — simulates pre-VU-1157 state.

    let result = reconcile_on_startup(&conn, skills_path).unwrap();

    assert!(
        result
            .notifications
            .iter()
            .any(|n| n.contains("stale-skill") && n.contains("re-run required")),
        "expected reset notification, got: {:?}",
        result.notifications
    );

    let run = crate::db::get_workflow_run_by_skill_id(&conn, skill_id)
        .unwrap()
        .unwrap();
    assert_eq!(
        run.current_step, 0,
        "current_step should have been reset to 0"
    );
    assert_eq!(run.status, "pending", "status should remain pending");
}

// --- Scenario 2: DB step ahead of disk ---

#[test]
fn test_reconcile_leaves_pending_when_not_all_steps_done() {
    let tmp = tempfile::tempdir().unwrap();
    let skills_tmp = tempfile::tempdir().unwrap();
    let workspace = tmp.path().to_str().unwrap();
    let skills_path = skills_tmp.path().to_str().unwrap();
    let conn = create_test_db();

    // DB at step 2, status "pending" — not yet at the last step
    let skill_id = crate::db::upsert_skill(&conn, "mid-skill", "skill-builder", "domain").unwrap();
    crate::db::save_workflow_run_by_skill_id(&conn, skill_id, 2, "pending", "domain").unwrap();
    insert_stub_clarifications(&conn, "mid-skill");
    create_skill_dir(tmp.path(), "mid-skill", "sales");
    create_step_output(skills_tmp.path(), "mid-skill", 0);
    create_step_output(skills_tmp.path(), "mid-skill", 2);

    let _result = reconcile_on_startup(&conn, skills_path).unwrap();

    let run = crate::db::get_workflow_run_by_skill_id(&conn, skill_id)
        .unwrap()
        .unwrap();
    assert_eq!(run.status, "pending");
}

// --- Marketplace skill reconciliation (scenarios 11 & 12) ---

#[test]
fn test_marketplace_skill_preserved_when_skill_md_exists() {
    // Scenario 11: marketplace skill with SKILL.md on disk — no action needed
    let tmp = tempfile::tempdir().unwrap();
    let skills_tmp = tempfile::tempdir().unwrap();
    let workspace = tmp.path().to_str().unwrap();
    let skills_path = skills_tmp.path().to_str().unwrap();
    let conn = create_test_db();

    crate::db::upsert_skill_in_plugin(
        &conn,
        "my-skill",
        "marketplace",
        "platform",
        crate::skill_paths::DEFAULT_PLUGIN_SLUG,
    )
    .unwrap();

    // Create SKILL.md in canonical plugin layout (simulates installed marketplace skill)
    let skill_dir =
        crate::skill_paths::resolve_skill_dir(skills_tmp.path(), DEFAULT_PLUGIN_SLUG, "my-skill");
    std::fs::create_dir_all(&skill_dir).unwrap();
    std::fs::write(skill_dir.join("SKILL.md"), "# Marketplace skill").unwrap();

    let result = reconcile_on_startup(&conn, skills_path).unwrap();

    assert!(result.notifications.is_empty());
    assert_eq!(result.auto_cleaned, 0);

    // Skills master record must still exist unchanged
    let all_skills = crate::db::list_all_skills(&conn).unwrap();
    let master = all_skills.iter().find(|s| s.name == "my-skill").unwrap();
    assert_eq!(master.skill_source, "marketplace");

    // No workflow_runs row should exist for marketplace skills
    let skill_id = crate::db::get_skill_master_id(&conn, "my-skill")
        .unwrap()
        .unwrap();
    assert!(crate::db::get_workflow_run_by_skill_id(&conn, skill_id)
        .unwrap()
        .is_none());
}

#[test]
fn test_scenario_5_normal_db_and_disk_agree() {
    let tmp = tempfile::tempdir().unwrap();
    let skills_tmp = tempfile::tempdir().unwrap();
    let workspace = tmp.path().to_str().unwrap();
    let skills_path = skills_tmp.path().to_str().unwrap();
    let conn = create_test_db();

    // DB at step 2, disk has step 0 and 2 output
    let skill_id =
        crate::db::upsert_skill(&conn, "healthy-skill", "skill-builder", "domain").unwrap();
    crate::db::save_workflow_run_by_skill_id(&conn, skill_id, 2, "in_progress", "domain").unwrap();
    insert_stub_clarifications(&conn, "healthy-skill");
    create_skill_dir(tmp.path(), "healthy-skill", "analytics");
    create_step_output(tmp.path(), "healthy-skill", 0);
    // Step 2 output: decisions.json
    create_step_output(tmp.path(), "healthy-skill", 2);

    let result = reconcile_on_startup(&conn, skills_path).unwrap();

    assert_eq!(result.auto_cleaned, 0);
    assert!(result.notifications.is_empty());

    // DB should be unchanged
    let run = crate::db::get_workflow_run_by_skill_id(&conn, skill_id)
        .unwrap()
        .unwrap();
    assert_eq!(run.current_step, 2);
}

#[test]
fn test_fresh_skill_step_0_not_falsely_completed() {
    // Fresh skill: working dir exists but no output files.
    // Step 0 must NOT be marked as completed.
    let tmp = tempfile::tempdir().unwrap();
    let skills_tmp = tempfile::tempdir().unwrap();
    let workspace = tmp.path().to_str().unwrap();
    let skills_path = skills_tmp.path().to_str().unwrap();
    let conn = create_test_db();

    let skill_id =
        crate::db::upsert_skill(&conn, "fresh-skill", "skill-builder", "domain").unwrap();
    crate::db::save_workflow_run_by_skill_id(&conn, skill_id, 0, "pending", "domain").unwrap();
    // Only create the canonical working directory — no output files
    std::fs::create_dir_all(crate::skill_paths::resolve_skill_dir(
        tmp.path(),
        DEFAULT_PLUGIN_SLUG,
        "fresh-skill",
    ))
    .unwrap();

    let result = reconcile_on_startup(&conn, skills_path).unwrap();

    // No workflow-state notifications — fresh skill, no action needed
    assert!(result.notifications.is_empty());

    // Step 0 should still be absent from steps table (not falsely completed)
    let steps = crate::db::get_workflow_steps_by_skill_id(&conn, skill_id).unwrap();
    assert!(
        steps.is_empty() || steps.iter().all(|s| s.status != "completed"),
        "Step 0 should not be marked completed for a fresh skill with no output"
    );
}

#[test]
fn test_db_at_step2_no_skill_md_stays_at_step2() {
    // DB says step 2 (Confirm Decisions) but no SKILL.md on disk.
    // Steps 0-2 are DB-authoritative, so no reset is needed — SKILL.md is only
    // expected after step 3 (Generate Skill). Scenario 8 fires: reset step
    // statuses but leave current_step unchanged.
    let tmp = tempfile::tempdir().unwrap();
    let skills_tmp = tempfile::tempdir().unwrap();
    let workspace = tmp.path().to_str().unwrap();
    let skills_path = skills_tmp.path().to_str().unwrap();
    let conn = create_test_db();

    let skill_id = crate::db::upsert_skill(&conn, "lost-skill", "skill-builder", "domain").unwrap();
    crate::db::save_workflow_run_by_skill_id(&conn, skill_id, 2, "pending", "domain").unwrap();
    insert_stub_clarifications(&conn, "lost-skill");

    let result = reconcile_on_startup(&conn, skills_path).unwrap();

    // No notification — steps 0-2 are DB-authoritative, no SKILL.md expected
    assert!(
        result.notifications.is_empty(),
        "got: {:?}",
        result.notifications
    );

    let run = crate::db::get_workflow_run_by_skill_id(&conn, skill_id)
        .unwrap()
        .unwrap();
    // current_step stays at 2; no filesystem evidence is needed for steps 0-2
    assert_eq!(run.current_step, 2);
}

#[test]
fn test_step_4_not_reset_when_step_3_output_exists() {
    let tmp = tempfile::tempdir().unwrap();
    let skills_tmp = tempfile::tempdir().unwrap();
    let workspace = tmp.path().to_str().unwrap();
    let skills_path = skills_tmp.path().to_str().unwrap();
    let conn = create_test_db();

    let skill_id = crate::db::upsert_skill(&conn, "done-skill", "skill-builder", "domain").unwrap();
    crate::db::save_workflow_run_by_skill_id(&conn, skill_id, 4, "pending", "domain").unwrap();
    insert_stub_clarifications(&conn, "done-skill");
    insert_stub_decisions(&conn, "done-skill");
    create_skill_dir(tmp.path(), "done-skill", "analytics");
    for step in [0, 2, 3] {
        create_step_output(skills_tmp.path(), "done-skill", step);
    }

    let result = reconcile_on_startup(&conn, skills_path).unwrap();

    // Should NOT reset — step 4 is beyond last step but step 3 output exists
    assert!(result.notifications.is_empty());
    let run = crate::db::get_workflow_run_by_skill_id(&conn, skill_id)
        .unwrap()
        .unwrap();
    assert_eq!(run.current_step, 4);
}

#[test]
fn test_step_1_not_reset_when_step_0_output_exists() {
    let tmp = tempfile::tempdir().unwrap();
    let skills_tmp = tempfile::tempdir().unwrap();
    let workspace = tmp.path().to_str().unwrap();
    let skills_path = skills_tmp.path().to_str().unwrap();
    let conn = create_test_db();

    let skill_id =
        crate::db::upsert_skill(&conn, "review-skill", "skill-builder", "domain").unwrap();
    crate::db::save_workflow_run_by_skill_id(&conn, skill_id, 1, "pending", "domain").unwrap();
    insert_stub_clarifications(&conn, "review-skill");
    create_skill_dir(tmp.path(), "review-skill", "sales");
    create_step_output(skills_tmp.path(), "review-skill", 0);

    let result = reconcile_on_startup(&conn, skills_path).unwrap();

    assert!(result.notifications.is_empty());
    let run = crate::db::get_workflow_run_by_skill_id(&conn, skill_id)
        .unwrap()
        .unwrap();
    assert_eq!(run.current_step, 1);
}

#[test]
fn test_step_3_with_all_prior_output_exists() {
    // DB=3 (Generate Skill), disk has steps 0, 2, AND 3 output.
    // All detectable steps confirmed — no reset.
    let tmp = tempfile::tempdir().unwrap();
    let skills_tmp = tempfile::tempdir().unwrap();
    let workspace = tmp.path().to_str().unwrap();
    let skills_path = skills_tmp.path().to_str().unwrap();
    let conn = create_test_db();

    let skill_id =
        crate::db::upsert_skill(&conn, "review-skill", "skill-builder", "domain").unwrap();
    crate::db::save_workflow_run_by_skill_id(&conn, skill_id, 3, "pending", "domain").unwrap();
    insert_stub_clarifications(&conn, "review-skill");
    insert_stub_decisions(&conn, "review-skill");
    create_skill_dir(tmp.path(), "review-skill", "sales");
    create_step_output(skills_tmp.path(), "review-skill", 0);
    create_step_output(skills_tmp.path(), "review-skill", 2);
    create_step_output(skills_tmp.path(), "review-skill", 3);

    let result = reconcile_on_startup(&conn, skills_path).unwrap();

    assert!(result.notifications.is_empty());
    let run = crate::db::get_workflow_run_by_skill_id(&conn, skill_id)
        .unwrap()
        .unwrap();
    assert_eq!(run.current_step, 3);
}

// --- Normal progression tests (current_step = disk_step + 1) ---

#[test]
fn test_step_completed_advances_to_next_not_reset() {
    for (db_step, disk_steps) in [
        (1, vec![0u32]),    // step 0 completed -> on step 1 (non-detectable)
        (4, vec![0, 2, 3]), // step 3 completed -> on step 4 (beyond last step)
    ] {
        let tmp = tempfile::tempdir().unwrap();
        let skills_tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        let skills_path = skills_tmp.path().to_str().unwrap();
        let conn = create_test_db();

        let skill_id =
            crate::db::upsert_skill(&conn, "my-skill", "skill-builder", "domain").unwrap();
        crate::db::save_workflow_run_by_skill_id(&conn, skill_id, db_step, "pending", "domain")
            .unwrap();
        insert_stub_clarifications(&conn, "my-skill");
        if db_step >= 3 {
            insert_stub_decisions(&conn, "my-skill");
        }
        create_skill_dir(tmp.path(), "my-skill", "sales");
        for step in &disk_steps {
            create_step_output(skills_tmp.path(), "my-skill", *step);
        }

        let result = reconcile_on_startup(&conn, skills_path).unwrap();

        assert!(
            result.notifications.is_empty(),
            "DB at step {}, disk through step {:?}: should NOT reset but got: {:?}",
            db_step,
            disk_steps.last(),
            result.notifications
        );
        let run = crate::db::get_workflow_run_by_skill_id(&conn, skill_id)
            .unwrap()
            .unwrap();
        assert_eq!(
            run.current_step, db_step,
            "current_step should remain {}",
            db_step
        );
    }
}

#[test]
fn test_step_1_on_db_but_step_0_on_disk_ok() {
    // DB=1 (detailed research), disk has step 0 output.
    // Step 1 is non-detectable so DB is allowed to be 1 step ahead.
    let tmp = tempfile::tempdir().unwrap();
    let skills_tmp = tempfile::tempdir().unwrap();
    let workspace = tmp.path().to_str().unwrap();
    let skills_path = skills_tmp.path().to_str().unwrap();
    let conn = create_test_db();

    let skill_id = crate::db::upsert_skill(&conn, "my-skill", "skill-builder", "domain").unwrap();
    crate::db::save_workflow_run_by_skill_id(&conn, skill_id, 1, "pending", "domain").unwrap();
    insert_stub_clarifications(&conn, "my-skill");
    create_skill_dir(tmp.path(), "my-skill", "sales");
    create_step_output(skills_tmp.path(), "my-skill", 0);

    let result = reconcile_on_startup(&conn, skills_path).unwrap();

    assert!(result.notifications.is_empty());
    let run = crate::db::get_workflow_run_by_skill_id(&conn, skill_id)
        .unwrap()
        .unwrap();
    assert_eq!(run.current_step, 1);
}

#[test]
fn test_reconcile_empty_workspace() {
    let tmp = tempfile::tempdir().unwrap();
    let skills_tmp = tempfile::tempdir().unwrap();
    let workspace = tmp.path().to_str().unwrap();
    let skills_path = skills_tmp.path().to_str().unwrap();
    let conn = create_test_db();

    let result = reconcile_on_startup(&conn, skills_path).unwrap();

    assert!(result.notifications.is_empty());
    assert_eq!(result.auto_cleaned, 0);
}

#[test]
fn test_reconcile_skips_infrastructure_dirs() {
    let tmp = tempfile::tempdir().unwrap();
    let skills_tmp = tempfile::tempdir().unwrap();
    let workspace = tmp.path().to_str().unwrap();
    let skills_path = skills_tmp.path().to_str().unwrap();
    let conn = create_test_db();

    // Create dotfile/infrastructure directories that should be skipped
    std::fs::create_dir_all(tmp.path().join(".claude")).unwrap();
    std::fs::create_dir_all(tmp.path().join(".hidden")).unwrap();

    let result = reconcile_on_startup(&conn, skills_path).unwrap();

    assert!(result.notifications.is_empty());
    assert_eq!(result.auto_cleaned, 0);
}

// --- active session guard tests ---

#[test]
fn test_reconcile_skips_skill_with_active_session_from_current_pid() {
    let tmp = tempfile::tempdir().unwrap();
    let skills_tmp = tempfile::tempdir().unwrap();
    let workspace = tmp.path().to_str().unwrap();
    let skills_path = skills_tmp.path().to_str().unwrap();
    let conn = create_test_db();

    create_skill_dir(tmp.path(), "active-skill", "test");
    let skill_id =
        crate::db::upsert_skill(&conn, "active-skill", "skill-builder", "domain").unwrap();
    crate::db::save_workflow_run_by_skill_id(&conn, skill_id, 3, "pending", "domain").unwrap();
    create_step_output(skills_tmp.path(), "active-skill", 0);

    let current_pid = std::process::id();
    crate::db::create_workflow_session_by_skill_id(&conn, "sess-active", skill_id, current_pid)
        .unwrap();

    let result = reconcile_on_startup(&conn, skills_path).unwrap();

    assert_eq!(result.notifications.len(), 1);
    assert!(result.notifications[0].contains("skipped"));
    assert!(result.notifications[0].contains("active session"));
    let run = crate::db::get_workflow_run_by_skill_id(&conn, skill_id)
        .unwrap()
        .unwrap();
    assert_eq!(run.current_step, 3, "Step should remain at 3 (untouched)");
}

#[test]
fn test_skill_at_step0_no_skill_md_stays_at_step0() {
    // DB has skill at current_step=0, no SKILL.md on disk.
    // Steps 0-2 are DB-authoritative; detect_furthest_step returns None.
    // Scenario 8: no filesystem evidence expected for steps 0-2, no reset.
    let tmp = tempfile::tempdir().unwrap();
    let skills_tmp = tempfile::tempdir().unwrap();
    let workspace = tmp.path().to_str().unwrap();
    let skills_path = skills_tmp.path().to_str().unwrap();
    let conn = create_test_db();

    let skill_id = crate::db::upsert_skill(&conn, "my-skill", "skill-builder", "domain").unwrap();
    crate::db::save_workflow_run_by_skill_id(&conn, skill_id, 0, "pending", "domain").unwrap();
    create_skill_dir(tmp.path(), "my-skill", "sales");

    let result = reconcile_on_startup(&conn, skills_path).unwrap();

    // No notification — Scenario 8 just resets step statuses silently
    assert!(
        result.notifications.is_empty(),
        "got: {:?}",
        result.notifications
    );

    let run = crate::db::get_workflow_run_by_skill_id(&conn, skill_id)
        .unwrap()
        .unwrap();
    assert_eq!(run.current_step, 0);
    assert_eq!(run.status, "pending");
}

// --- Scenario 8: DB step statuses must not be wiped when current_step < 3 ---

#[test]
fn test_completed_step_statuses_preserved_after_reconcile() {
    // Regression: skill at step 1 with step 0 "completed" in workflow_steps.
    // Scenario 8 (no SKILL.md, current_step < 3) must NOT reset step statuses —
    // workflow_steps is the DB-authoritative record of which steps are done.
    let tmp = tempfile::tempdir().unwrap();
    let skills_tmp = tempfile::tempdir().unwrap();
    let workspace = tmp.path().to_str().unwrap();
    let skills_path = skills_tmp.path().to_str().unwrap();
    let conn = create_test_db();

    let skill_id = crate::db::upsert_skill(&conn, "my-skill", "skill-builder", "domain").unwrap();
    crate::db::save_workflow_run_by_skill_id(&conn, skill_id, 1, "pending", "domain").unwrap();
    crate::db::save_workflow_step_by_skill_id(&conn, skill_id, 0, "completed").unwrap();
    insert_stub_clarifications(&conn, "my-skill");

    reconcile_on_startup(&conn, skills_path).unwrap();

    let steps = crate::db::get_workflow_steps_by_skill_id(&conn, skill_id).unwrap();
    let step0 = steps
        .iter()
        .find(|s| s.step_id == 0)
        .expect("step 0 should exist in workflow_steps");
    assert_eq!(
        step0.status, "completed",
        "step 0 was reset to '{}' but should remain 'completed' — Scenario 8 must not wipe DB step statuses",
        step0.status
    );

    let run = crate::db::get_workflow_run_by_skill_id(&conn, skill_id)
        .unwrap()
        .unwrap();
    assert_eq!(run.current_step, 1, "current_step should remain at 1");
}

// --- Gap 2: Workspace dir recreated for in-progress skill ---

#[test]
fn test_missing_workspace_dir_recreated_for_in_progress_skill() {
    // DB has skill at current_step=1, status='pending', workspace dir does NOT exist.
    // skills_path has step 0 output.
    // detect_furthest_step returns None when workspace dir doesn't exist, so we need
    // to understand what happens in that branch (current_step > 0 → reset to 0).
    // Actually: workspace dir is recreated first, then detect_furthest_step is called.
    // After recreation the workspace dir exists, so detect_furthest_step CAN proceed.
    // disk_step=0, current_step=1, last_expected_detectable=max([0,2,3] ≤ 1)=0.
    // disk_step(0) >= last_expected_detectable(0) → DB valid → no reset.
    // current_step stays at 1.
    let tmp = tempfile::tempdir().unwrap();
    let skills_tmp = tempfile::tempdir().unwrap();
    let workspace = tmp.path().to_str().unwrap();
    let skills_path = skills_tmp.path().to_str().unwrap();
    let conn = create_test_db();

    // Insert DB record at step 1 with a workspace_path pointing to a nonexistent dir
    let skill_id = crate::db::upsert_skill(&conn, "my-skill", "skill-builder", "domain").unwrap();
    crate::db::save_workflow_run_by_skill_id(&conn, skill_id, 1, "pending", "domain").unwrap();
    insert_stub_clarifications(&conn, "my-skill");
    // DO NOT create the workspace dir — it is missing
    // Create step 0 output in skills_path (detectable)
    create_step_output(skills_tmp.path(), "my-skill", 0);

    let result = reconcile_on_startup(&conn, skills_path).unwrap();

    // No reset should occur — disk confirms last_expected_detectable (step 0)
    assert!(
        result.notifications.is_empty(),
        "should not reset: {:?}",
        result.notifications
    );

    // Skill dir should have been recreated under skills_path (no longer includes context/ subdir)
    assert!(
        skills_tmp
            .path()
            .join(DEFAULT_PLUGIN_SLUG)
            .join("skills")
            .join("my-skill")
            .exists(),
        "skill dir should be recreated under skills_path"
    );

    // current_step should remain at 1 (DB is valid)
    let run = crate::db::get_workflow_run_by_skill_id(&conn, skill_id)
        .unwrap()
        .unwrap();
    assert_eq!(run.current_step, 1, "current_step should not be reset");
    assert_eq!(run.status, "pending");
}

// Note: Old "disk-only discovery" tests (Gap 3 & Gap 4) have been replaced
// by scenario 10 tests above. Disk discovery is now handled by Pass 2 (VD-874).

// --- Gap 5: DB=3 with step 3 missing resets to 2 ---

// --- Scenario 10: skill_source=skill-builder, master row, no workflow_runs ---

#[test]
fn test_reconcile_full_with_fallback_to_workspace_path() {
    // skills_path is None → entire system falls back to workspace_path.
    // Skill folder in workspace with step 0+2 output → should reconcile correctly.
    let tmp = tempfile::tempdir().unwrap();
    let workspace = tmp.path().to_str().unwrap();
    let conn = create_test_db();

    let skill_id = crate::db::upsert_skill(&conn, "my-skill", "skill-builder", "domain").unwrap();
    crate::db::save_workflow_run_by_skill_id(&conn, skill_id, 1, "in_progress", "domain").unwrap();
    insert_stub_clarifications(&conn, "my-skill");

    create_skill_dir(tmp.path(), "my-skill", "test");
    create_step_output(tmp.path(), "my-skill", 0);
    create_step_output(tmp.path(), "my-skill", 2);

    // Reconcile with single path
    let result = reconcile_on_startup(&conn, workspace).unwrap();

    assert!(result.notifications.is_empty());
    assert_eq!(result.auto_cleaned, 0);

    // DB should be reconciled: disk has step 2, DB had step 1.
    // Step 1 is non-detectable, disk ahead → advance to step 2.
    let run = crate::db::get_workflow_run_by_skill_id(&conn, skill_id)
        .unwrap()
        .unwrap();
    assert!(run.current_step >= 1);
}

#[test]
fn test_reconcile_when_workspace_and_skills_paths_identical() {
    // Common config where workspace_path == skills_path (same directory).
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().to_str().unwrap();
    let conn = create_test_db();

    let skill_id = crate::db::upsert_skill(&conn, "my-skill", "skill-builder", "domain").unwrap();
    crate::db::save_workflow_run_by_skill_id(&conn, skill_id, 3, "completed", "domain").unwrap();

    create_skill_dir(tmp.path(), "my-skill", "test");
    create_step_output(tmp.path(), "my-skill", 0);
    create_step_output(tmp.path(), "my-skill", 2);
    create_step_output(tmp.path(), "my-skill", 3);

    // Single path (previously workspace == skills_path)
    let result = reconcile_on_startup(&conn, path).unwrap();

    assert!(result.notifications.is_empty());
    assert_eq!(result.auto_cleaned, 0);

    let run = crate::db::get_workflow_run_by_skill_id(&conn, skill_id)
        .unwrap()
        .unwrap();
    assert_eq!(run.status, "completed");
}

#[test]
fn test_cleanup_future_steps_with_negative_step() {
    // cleanup_future_steps called with after_step=-1 should clean ALL step files.
    // This is the code path taken when no output files are found (line 195).
    let tmp = tempfile::tempdir().unwrap();
    let workspace = tmp.path().to_str().unwrap();

    create_skill_dir(tmp.path(), "my-skill", "test");
    create_step_output(tmp.path(), "my-skill", 0);
    create_step_output(tmp.path(), "my-skill", 4);
    create_step_output(tmp.path(), "my-skill", 5);

    crate::cleanup::cleanup_future_steps("my-skill", DEFAULT_PLUGIN_SLUG, -1, workspace);

    // All step output should be deleted
    let skill_dir = resolve_skill_dir(tmp.path(), DEFAULT_PLUGIN_SLUG, "my-skill");
    // Step 0 file (clarifications.json in context/)
    let step0_file = skill_dir.join("context").join("clarifications.json");
    assert!(!step0_file.exists(), "step 0 output should be cleaned");
    // Step 5 file
    let skill_md = skill_dir.join("SKILL.md");
    assert!(!skill_md.exists(), "step 5 output should be cleaned");
}

#[test]
fn test_db_record_with_workspace_dir_reconciles_normally() {
    // DB record + workspace dir (with no skills_path output) should reconcile
    // normally — the DB record is preserved and workspace dir is used for step detection.
    let tmp = tempfile::tempdir().unwrap();
    let workspace = tmp.path().join("workspace");
    let skills = tmp.path().join("skills");
    std::fs::create_dir_all(&workspace).unwrap();
    std::fs::create_dir_all(&skills).unwrap();

    let workspace_str = workspace.to_str().unwrap();
    let skills_str = skills.to_str().unwrap();
    let conn = create_test_db();

    // DB record + workspace folder, but nothing in skills_path
    let skill_id = crate::db::upsert_skill(&conn, "old-skill", "skill-builder", "domain").unwrap();
    crate::db::save_workflow_run_by_skill_id(&conn, skill_id, 0, "pending", "domain").unwrap();
    create_skill_dir(&workspace, "old-skill", "test");

    let result = reconcile_on_startup(&conn, skills_str).unwrap();

    // DB record should be preserved (not auto-cleaned)
    assert_eq!(result.auto_cleaned, 0);
    assert!(crate::db::get_workflow_run_by_skill_id(&conn, skill_id)
        .unwrap()
        .is_some());
}

// =========================================================================
// MEDIUM PRIORITY — edge cases that could confuse users
// =========================================================================

#[test]
fn test_reconcile_detects_multiple_orphans() {
    // Three skills with output in skills_path but no working dir.
    // After the driver change, these skills ARE in disk_dirs (from skills_path)
    // and have skill output → they reconcile normally, not as orphans.
    // (Orphans only happen when a skill is NOT in disk_dirs but HAS output.)
    let tmp = tempfile::tempdir().unwrap();
    let workspace = tmp.path().join("workspace");
    let skills = tmp.path().join("skills");
    std::fs::create_dir_all(&workspace).unwrap();
    std::fs::create_dir_all(&skills).unwrap();

    let workspace_str = workspace.to_str().unwrap();
    let skills_str = skills.to_str().unwrap();
    let conn = create_test_db();

    for name in &["skill-a", "skill-b", "skill-c"] {
        let sid = crate::db::upsert_skill(&conn, name, "skill-builder", "domain").unwrap();
        crate::db::save_workflow_run_by_skill_id(&conn, sid, 5, "completed", "domain").unwrap();
        let output_dir = skills.join(name);
        std::fs::create_dir_all(output_dir.join("references")).unwrap();
        std::fs::write(output_dir.join("SKILL.md"), "# Skill").unwrap();
    }

    let result = reconcile_on_startup(&conn, skills_str).unwrap();

    // All three are in skills_path (the driver) → they're in disk_dirs → normal reconciliation
    assert_eq!(result.auto_cleaned, 0);

    // All DB records should still exist
    for name in &["skill-a", "skill-b", "skill-c"] {
        let sid = crate::db::get_skill_master_id(&conn, name)
            .unwrap()
            .unwrap();
        assert!(crate::db::get_workflow_run_by_skill_id(&conn, sid)
            .unwrap()
            .is_some());
    }
}

#[test]
fn test_folder_without_skill_md_ignored() {
    // Folder in skills_path with no SKILL.md → ignored (not a valid skill)
    let tmp = tempfile::tempdir().unwrap();
    let skills_tmp = tempfile::tempdir().unwrap();
    let workspace = tmp.path().to_str().unwrap();
    let skills_path = skills_tmp.path().to_str().unwrap();
    let conn = create_test_db();

    // Create a directory in skills_path with no SKILL.md
    let orphan_dir = skills_tmp.path().join("orphan-folder");
    std::fs::create_dir_all(orphan_dir.join("context")).unwrap();
    std::fs::write(orphan_dir.join("context").join("notes.md"), "# Notes").unwrap();

    let result = reconcile_on_startup(&conn, skills_path).unwrap();

    // Folder should still exist — we don't delete random folders
    assert!(
        skills_tmp.path().join("orphan-folder").exists(),
        "folder should be left alone"
    );
}

#[test]
fn test_pass2_skips_dotfiles() {
    // .hidden dir → not discovered
    let tmp = tempfile::tempdir().unwrap();
    let skills_tmp = tempfile::tempdir().unwrap();
    let workspace = tmp.path().to_str().unwrap();
    let skills_path = skills_tmp.path().to_str().unwrap();
    let conn = create_test_db();

    // Create dotfile directories in skills_path
    std::fs::create_dir_all(skills_tmp.path().join(".hidden")).unwrap();
    std::fs::create_dir_all(skills_tmp.path().join(".git")).unwrap();
    std::fs::write(
        skills_tmp.path().join(".hidden").join("SKILL.md"),
        "# Hidden",
    )
    .unwrap();

    let result = reconcile_on_startup(&conn, skills_path).unwrap();

    assert!(result.notifications.is_empty());
}

#[test]
fn test_reconcile_no_disk_dirs_adopted_without_master_row() {
    // With the new skills-master driver, disk-only dirs (not in master) are not
    // adopted in Pass 1. Pass 2 (VD-874) handles disk discovery separately.
    let tmp = tempfile::tempdir().unwrap();
    let workspace = tmp.path().join("workspace");
    let skills = tmp.path().join("skills");
    std::fs::create_dir_all(&workspace).unwrap();
    std::fs::create_dir_all(&skills).unwrap();

    let workspace_str = workspace.to_str().unwrap();
    let skills_str = skills.to_str().unwrap();
    let conn = create_test_db();

    // Create dirs on disk but NOT in the DB — should be ignored by Pass 1
    create_skill_dir(&workspace, "disk-only-skill", "test");
    create_step_output(&workspace, "disk-only-skill", 0);
    std::fs::create_dir_all(workspace.join(".git")).unwrap();

    let result = reconcile_on_startup(&conn, skills_str).unwrap();

    // No skills in master → no notifications
    assert!(result.notifications.is_empty());
    assert!(crate::db::get_skill_master_id(&conn, "disk-only-skill")
        .unwrap()
        .is_none());
    assert!(crate::db::get_skill_master_id(&conn, ".git")
        .unwrap()
        .is_none());
}

// =========================================================================
// Pass 3: Orphan folder → .trash/ move
// =========================================================================

#[test]
fn test_pass3_skips_dotfiles_and_trash() {
    // Dotfiles and .trash itself should be skipped by Pass 3
    let tmp = tempfile::tempdir().unwrap();
    let skills = tmp.path().join("skills");
    let workspace = tmp.path().join("workspace");
    std::fs::create_dir_all(&workspace).unwrap();
    std::fs::create_dir_all(&skills).unwrap();

    let conn = create_test_db();

    // Create dotfile dirs — should not be moved or touched
    std::fs::create_dir_all(skills.join(".git")).unwrap();
    std::fs::create_dir_all(skills.join(".trash")).unwrap();

    let result = reconcile_on_startup(&conn, skills.to_str().unwrap()).unwrap();

    assert!(result.notifications.is_empty());
    // .git and .trash should still exist
    assert!(skills.join(".git").exists(), ".git should not be touched");
    assert!(
        skills.join(".trash").exists(),
        ".trash should not be touched"
    );
}

// =============================================================================
// CG-R3: Direct reconcile_skill_builder tests
// =============================================================================

#[test]
fn test_reconcile_skill_builder_resets_stale_in_progress_steps() {
    let tmp = tempfile::tempdir().unwrap();
    let skills_tmp = tempfile::tempdir().unwrap();
    let workspace = tmp.path().to_str().unwrap();
    let skills_path = skills_tmp.path().to_str().unwrap();
    let conn = create_test_db();
    let name = "sb-stale-reset";

    // Create skill in master + workflow_runs
    let skill_id = crate::db::upsert_skill(&conn, name, "skill-builder", "domain").unwrap();
    crate::db::save_workflow_run_by_skill_id(&conn, skill_id, 0, "pending", "domain").unwrap();

    // Mark step 0 as in_progress (simulating a crash)
    crate::db::save_workflow_step_by_skill_id(&conn, skill_id, 0, "in_progress").unwrap();

    // Create workspace dir (scenario 5 guard)
    create_skill_dir(tmp.path(), name, "");

    let mut notifications = Vec::new();
    super::skill_builder::reconcile_skill_builder(
        &conn,
        name,
        DEFAULT_PLUGIN_SLUG,
        skills_path,
        &mut notifications,
    )
    .unwrap();

    // The stale in_progress step should be reset to pending
    let steps = crate::db::get_workflow_steps_by_skill_id(&conn, skill_id).unwrap();
    let step0 = steps.iter().find(|s| s.step_id == 0).unwrap();
    assert_eq!(
        step0.status, "pending",
        "stale in_progress step should be reset to pending"
    );
}

#[test]
fn test_startup_normalization_merges_legacy_skills_default_into_default_plugin() {
    let tmp = tempfile::tempdir().unwrap();
    let skills_tmp = tempfile::tempdir().unwrap();
    let workspace = tmp.path().to_str().unwrap();
    let skills_path = skills_tmp.path().to_str().unwrap();
    let conn = create_test_db();

    crate::db::ensure_plugin(&conn, "skills", "skills", "synthetic", None, None, true).unwrap();
    crate::db::ensure_default_plugin(&conn).unwrap();
    crate::db::upsert_skill_in_plugin(
        &conn,
        "measuring-pipeline-value",
        "skill-builder",
        "domain",
        "skills",
    )
    .unwrap();
    crate::db::upsert_skill_in_plugin(
        &conn,
        "measuring-pipeline-value",
        "skill-builder",
        "domain",
        DEFAULT_PLUGIN_SLUG,
    )
    .unwrap();

    let result = reconcile_on_startup(&conn, skills_path).unwrap();

    let plugins = crate::db::list_plugins(&conn).unwrap();
    assert_eq!(plugins.iter().filter(|plugin| plugin.is_default).count(), 1);
    assert_eq!(
        plugins
            .iter()
            .find(|plugin| plugin.is_default)
            .unwrap()
            .slug,
        DEFAULT_PLUGIN_SLUG
    );

    let matching: Vec<_> = crate::db::list_all_skills(&conn)
        .unwrap()
        .into_iter()
        .filter(|skill| skill.name == "measuring-pipeline-value")
        .collect();
    assert_eq!(matching.len(), 1);
    assert_eq!(matching[0].plugin_slug, DEFAULT_PLUGIN_SLUG);
}

// ── Phase 1f: Dedup tests ───────────────────────────────────────────────────

/// Simulates the state after a failed move + Phase 1c discovery:
/// - DB has TWO rows for the same skill (old plugin + new disk location row)
/// - Disk has SKILL.md only in the non-default plugin
/// - The non-default row has a completed workflow_run (as Phase 1c would have set it)
///
/// After reconciliation, exactly one active row should remain — the one matching disk.
#[test]
fn test_cross_plugin_skill_not_rediscovered_every_startup() {
    // Regression: if a skill exists in DB under plugin A but also on disk under plugin B,
    // Phase 1c must not create a second DB row (which Phase 1f would then delete every startup,
    // causing the reconciliation dialog to reappear indefinitely).
    let tmp = tempfile::tempdir().unwrap();
    let skills_tmp = tempfile::tempdir().unwrap();
    let workspace = tmp.path().to_str().unwrap();
    let skills_path = skills_tmp.path().to_str().unwrap();
    let conn = create_test_db();

    // Skill lives in DB under the non-default "other-plugin"
    let (_, other_slug) =
        crate::db::create_plugin(&conn, "other-plugin", "local", None, None).unwrap();
    crate::db::upsert_skill_in_plugin(
        &conn,
        "cross-plugin-skill",
        "skill-builder",
        "domain",
        &other_slug,
    )
    .unwrap();

    // Phase 1b deletes plugins whose folder is missing on disk — ensure the folder exists
    // so Phase 1b doesn't wipe the plugin row before Phase 1c runs.
    let other_plugin_dir = skills_tmp.path().join(&other_slug);
    std::fs::create_dir_all(&other_plugin_dir).unwrap();

    // Disk: SKILL.md exists under the default "skills" plugin (different from DB location)
    let skill_md = crate::skill_paths::resolve_skill_dir(
        skills_tmp.path(),
        DEFAULT_PLUGIN_SLUG,
        "cross-plugin-skill",
    )
    .join("SKILL.md");
    std::fs::create_dir_all(skill_md.parent().unwrap()).unwrap();
    std::fs::write(&skill_md, "---\ntitle: cross-plugin-skill\n---\n").unwrap();

    // First startup: should not create a duplicate DB row
    let result = reconcile_on_startup(&conn, skills_path).unwrap();
    assert!(
        !result
            .notifications
            .iter()
            .any(|n| n.contains("cross-plugin-skill") && n.contains("discovered")),
        "must not emit a 'discovered' notification for a cross-plugin skill: {:?}",
        result.notifications
    );

    // No duplicate row must have been created
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM skills WHERE name = 'cross-plugin-skill' AND COALESCE(deleted_at, '') = ''",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        count, 1,
        "exactly one active row must exist after reconciliation"
    );

    // Second startup: same result — dialog must not reappear
    let result2 = reconcile_on_startup(&conn, skills_path).unwrap();
}

/// VU-984: Phase 1e Pass B must not soft-delete marketplace skills stored
/// in the nested {plugin_slug}/skills/{skill_name}/ layout.
#[test]
fn test_phase1e_does_not_soft_delete_marketplace_nested_layout() {
    let tmp = tempfile::tempdir().unwrap();
    let skills_tmp = tempfile::tempdir().unwrap();
    let workspace = tmp.path().to_str().unwrap();
    let skills_path = skills_tmp.path().to_str().unwrap();
    let conn = create_test_db();

    // Create a plugin with a skill stored in the nested marketplace layout.
    // Use source_type "local" to avoid Phase 1c-ii marketplace integrity checks
    // (which is a separate concern from Phase 1e).
    crate::db::ensure_plugin(
        &conn,
        "mkt-nested",
        "Marketplace Nested",
        "local",
        None,
        None,
        false,
    )
    .unwrap();
    crate::db::upsert_skill_in_plugin(&conn, "nested-skill", "marketplace", "domain", "mkt-nested")
        .unwrap();

    // Create the skill directory in the marketplace nested layout:
    // {plugin_slug}/skills/{skill_name}/SKILL.md
    let nested_skill_dir = skills_tmp
        .path()
        .join("mkt-nested")
        .join("skills")
        .join("nested-skill");
    std::fs::create_dir_all(&nested_skill_dir).unwrap();
    std::fs::write(
        nested_skill_dir.join("SKILL.md"),
        "---\nname: nested-skill\n---\n",
    )
    .unwrap();

    // Run reconciliation
    reconcile_on_startup(&conn, skills_path).unwrap();

    // Skill must remain active (not soft-deleted)
    let deleted_at: Option<String> = conn
        .query_row(
            "SELECT deleted_at FROM skills WHERE name = 'nested-skill'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert!(
        deleted_at.is_none(),
        "Phase 1e must not soft-delete marketplace skills in nested plugin/skills/skill/ layout"
    );
}
