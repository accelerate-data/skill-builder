use super::*;
use crate::commands::test_utils::create_test_db;
use crate::commands::workflow::get_step_output_files;
use crate::skill_paths::{resolve_skill_dir, resolve_workspace_skill_dir, DEFAULT_PLUGIN_SLUG};
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
/// Uses plugin-organised layout: workspace/{DEFAULT_PLUGIN_SLUG}/{name}/context/
fn create_skill_dir(workspace: &Path, name: &str, _domain: &str) {
    let skill_dir = resolve_workspace_skill_dir(workspace, DEFAULT_PLUGIN_SLUG, name);
    std::fs::create_dir_all(skill_dir.join("context")).unwrap();
}

/// Create step output files on disk for the given step.
/// Uses plugin-organised layout: workspace/{DEFAULT_PLUGIN_SLUG}/{name}/...
fn create_step_output(workspace: &Path, name: &str, step_id: u32) {
    let skill_dir = if step_id >= 3 {
        resolve_skill_dir(workspace, DEFAULT_PLUGIN_SLUG, name)
    } else {
        resolve_workspace_skill_dir(workspace, DEFAULT_PLUGIN_SLUG, name)
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

// --- Scenario 10: Master row exists but no workflow_runs row ---

#[test]
fn test_scenario_10_master_row_no_workflow_runs() {
    let tmp = tempfile::tempdir().unwrap();
    let skills_tmp = tempfile::tempdir().unwrap();
    let workspace = tmp.path().to_str().unwrap();
    let skills_path = skills_tmp.path().to_str().unwrap();
    let conn = create_test_db();

    // Insert into skills master directly (skill-builder, but no workflow_runs row)
    crate::db::upsert_skill(&conn, "orphan-skill", "skill-builder", "domain").unwrap();
    // Create step 0 output on disk so detect_furthest_step finds it
    create_step_output(skills_tmp.path(), "orphan-skill", 0);

    let result = reconcile_on_startup(&conn, workspace, skills_path).unwrap();

    assert!(result.orphans.is_empty());
    assert_eq!(result.auto_cleaned, 0);
    assert_eq!(result.notifications.len(), 1);
    assert!(result.notifications[0].contains("orphan-skill"));
    assert!(result.notifications[0].contains("workflow record recreated at step 1"));

    // Verify workflow_runs record was auto-created
    let run = crate::db::get_workflow_run(&conn, "orphan-skill")
        .unwrap()
        .unwrap();
    assert_eq!(run.current_step, 0);
    assert_eq!(run.status, "pending");
}

// --- DB consistency reset: pre-VU-1157 in-progress skills with no artifact rows ---

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
    crate::db::save_workflow_run(&conn, "stale-skill", 2, "pending", "domain").unwrap();

    let result = reconcile_on_startup(&conn, workspace, skills_path).unwrap();

    // Should have been reset to step 0 with a notification
    assert!(
        result
            .notifications
            .iter()
            .any(|n| n.contains("stale-skill") && n.contains("re-run required")),
        "expected reset notification, got: {:?}",
        result.notifications
    );

    let run = crate::db::get_workflow_run(&conn, "stale-skill")
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

    crate::db::save_workflow_run(&conn, "stale-skill", 3, "pending", "domain").unwrap();
    insert_stub_clarifications(&conn, "stale-skill");
    // Deliberately NO insert_stub_decisions — simulates pre-VU-1157 state.

    let result = reconcile_on_startup(&conn, workspace, skills_path).unwrap();

    assert!(
        result
            .notifications
            .iter()
            .any(|n| n.contains("stale-skill") && n.contains("re-run required")),
        "expected reset notification, got: {:?}",
        result.notifications
    );

    let run = crate::db::get_workflow_run(&conn, "stale-skill")
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
fn test_scenario_2_db_ahead_of_disk() {
    let tmp = tempfile::tempdir().unwrap();
    let skills_tmp = tempfile::tempdir().unwrap();
    let workspace = tmp.path().to_str().unwrap();
    let skills_path = skills_tmp.path().to_str().unwrap();
    let conn = create_test_db();

    // DB says step 3 but no SKILL.md on disk.
    // Steps 0-2 are DB-authoritative; only SKILL.md is filesystem-based.
    // Scenario 4 fires: reset to step 2 so the user can re-run step 3.
    crate::db::save_workflow_run(&conn, "my-skill", 3, "in_progress", "domain").unwrap();
    insert_stub_clarifications(&conn, "my-skill");
    insert_stub_decisions(&conn, "my-skill");
    // Verify the stubs were inserted
    let clar_check = crate::db::workflow_artifacts::read_clarifications(&conn, "my-skill").unwrap();
    assert!(clar_check.is_some(), "stub clarifications should exist");
    create_skill_dir(tmp.path(), "my-skill", "sales");

    let result = reconcile_on_startup(&conn, workspace, skills_path).unwrap();

    assert!(result.orphans.is_empty());
    assert_eq!(result.auto_cleaned, 0);
    assert_eq!(
        result.notifications.len(),
        1,
        "expected 1 notification, got: {:?}",
        result.notifications
    );
    assert!(
        result.notifications[0].contains("reset from step 4 to step 3"),
        "got: {:?}",
        result.notifications[0]
    );

    // Verify DB was reset to step 2 (= "step 3" in 1-indexed display)
    let run = crate::db::get_workflow_run(&conn, "my-skill")
        .unwrap()
        .unwrap();
    assert_eq!(run.current_step, 2);
    assert_eq!(run.status, "pending");
}

// --- Status completion fix: all steps done but status stuck on "pending" ---

#[test]
fn test_reconcile_sets_completed_when_all_steps_done() {
    let tmp = tempfile::tempdir().unwrap();
    let skills_tmp = tempfile::tempdir().unwrap();
    let workspace = tmp.path().to_str().unwrap();
    let skills_path = skills_tmp.path().to_str().unwrap();
    let conn = create_test_db();

    // DB says step 3 (last step), status "pending" — simulates the race where
    // the frontend debounced save never sent "completed"
    crate::db::save_workflow_run(&conn, "done-skill", 3, "pending", "domain").unwrap();
    insert_stub_clarifications(&conn, "done-skill");
    insert_stub_decisions(&conn, "done-skill");
    create_skill_dir(tmp.path(), "done-skill", "sales");
    // Create output for all detectable steps (0, 2, 3) in skills_path
    for step in [0, 2, 3] {
        create_step_output(skills_tmp.path(), "done-skill", step);
    }

    let result = reconcile_on_startup(&conn, workspace, skills_path).unwrap();

    assert!(result.orphans.is_empty());
    assert_eq!(result.auto_cleaned, 0);
    assert!(result.notifications.is_empty());

    // Status should now be "completed"
    let run = crate::db::get_workflow_run(&conn, "done-skill")
        .unwrap()
        .unwrap();
    assert_eq!(run.status, "completed");
}

#[test]
fn test_reconcile_leaves_pending_when_not_all_steps_done() {
    let tmp = tempfile::tempdir().unwrap();
    let skills_tmp = tempfile::tempdir().unwrap();
    let workspace = tmp.path().to_str().unwrap();
    let skills_path = skills_tmp.path().to_str().unwrap();
    let conn = create_test_db();

    // DB at step 2, status "pending" — not yet at the last step
    crate::db::save_workflow_run(&conn, "mid-skill", 2, "pending", "domain").unwrap();
    insert_stub_clarifications(&conn, "mid-skill");
    create_skill_dir(tmp.path(), "mid-skill", "sales");
    create_step_output(skills_tmp.path(), "mid-skill", 0);
    create_step_output(skills_tmp.path(), "mid-skill", 2);

    let _result = reconcile_on_startup(&conn, workspace, skills_path).unwrap();

    let run = crate::db::get_workflow_run(&conn, "mid-skill")
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

    let result = reconcile_on_startup(&conn, workspace, skills_path).unwrap();

    assert!(result.orphans.is_empty());
    assert_eq!(result.auto_cleaned, 0);
    assert!(result.notifications.is_empty());

    // Skills master record must still exist unchanged
    let all_skills = crate::db::list_all_skills(&conn).unwrap();
    let master = all_skills.iter().find(|s| s.name == "my-skill").unwrap();
    assert_eq!(master.skill_source, "marketplace");

    // No workflow_runs row should exist for marketplace skills
    assert!(crate::db::get_workflow_run(&conn, "my-skill")
        .unwrap()
        .is_none());
}

#[test]
fn test_marketplace_plugin_deleted_when_skill_md_missing() {
    // Marketplace plugin with a skill folder missing SKILL.md → entire plugin deleted
    let tmp = tempfile::tempdir().unwrap();
    let skills_tmp = tempfile::tempdir().unwrap();
    let workspace = tmp.path().to_str().unwrap();
    let skills_path = skills_tmp.path().to_str().unwrap();
    let conn = create_test_db();

    // Create a marketplace plugin with a skill folder that has no SKILL.md
    let plugin_slug = "test-marketplace";
    crate::db::ensure_plugin(
        &conn,
        plugin_slug,
        "Test Marketplace",
        "marketplace",
        None,
        None,
        false,
    )
    .unwrap();
    crate::db::upsert_skill_in_plugin(&conn, "some-skill", "marketplace", "domain", plugin_slug)
        .unwrap();
    let plugin_skills = skills_tmp
        .path()
        .join(plugin_slug)
        .join("skills")
        .join("some-skill");
    std::fs::create_dir_all(&plugin_skills).unwrap();
    // Deliberately NOT creating SKILL.md — simulates tampering

    let _result = reconcile_on_startup(&conn, workspace, skills_path).unwrap();

    // Plugin should be deleted
    // Plugin folder should be gone from disk
    assert!(!skills_tmp.path().join(plugin_slug).exists());
    // Plugin should be gone from DB
    assert!(crate::db::get_plugin_id_by_slug(&conn, plugin_slug)
        .unwrap()
        .is_none());
}

// --- Missing workspace dir is recreated, not treated as stale ---

#[test]
fn test_missing_workspace_dir_is_recreated() {
    let tmp = tempfile::tempdir().unwrap();
    let skills_tmp = tempfile::tempdir().unwrap();
    let workspace = tmp.path().to_str().unwrap();
    let skills_path = skills_tmp.path().to_str().unwrap();
    let conn = create_test_db();

    // DB record exists at step 0 but workspace dir was deleted
    crate::db::save_workflow_run(&conn, "my-skill", 0, "pending", "domain").unwrap();
    // No workspace dir on disk

    let result = reconcile_on_startup(&conn, workspace, skills_path).unwrap();

    assert!(result.orphans.is_empty());
    assert_eq!(result.auto_cleaned, 0);
    // No notification — just silently recreated the transient dir

    // DB record must still exist
    let run = crate::db::get_workflow_run(&conn, "my-skill")
        .unwrap()
        .unwrap();
    assert_eq!(run.current_step, 0);

    // Workspace dir should have been recreated (no longer includes context/ subdir)
    assert!(tmp
        .path()
        .join(DEFAULT_PLUGIN_SLUG)
        .join("skills")
        .join("my-skill")
        .exists());
}

// --- Normal case ---

#[test]
fn test_scenario_5_normal_db_and_disk_agree() {
    let tmp = tempfile::tempdir().unwrap();
    let skills_tmp = tempfile::tempdir().unwrap();
    let workspace = tmp.path().to_str().unwrap();
    let skills_path = skills_tmp.path().to_str().unwrap();
    let conn = create_test_db();

    // DB at step 2, disk has step 0 and 2 output
    crate::db::save_workflow_run(&conn, "healthy-skill", 2, "in_progress", "domain").unwrap();
    insert_stub_clarifications(&conn, "healthy-skill");
    create_skill_dir(tmp.path(), "healthy-skill", "analytics");
    create_step_output(tmp.path(), "healthy-skill", 0);
    // Step 2 output: decisions.json
    create_step_output(tmp.path(), "healthy-skill", 2);

    let result = reconcile_on_startup(&conn, workspace, skills_path).unwrap();

    assert!(result.orphans.is_empty());
    assert_eq!(result.auto_cleaned, 0);
    assert!(result.notifications.is_empty());

    // DB should be unchanged
    let run = crate::db::get_workflow_run(&conn, "healthy-skill")
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

    crate::db::save_workflow_run(&conn, "fresh-skill", 0, "pending", "domain").unwrap();
    // Only create the canonical working directory — no output files
    std::fs::create_dir_all(crate::skill_paths::workspace_skill_dir(
        tmp.path(),
        DEFAULT_PLUGIN_SLUG,
        "fresh-skill",
    ))
    .unwrap();

    let result = reconcile_on_startup(&conn, workspace, skills_path).unwrap();

    // No workflow-state notifications — fresh skill, no action needed
    assert!(result.notifications.is_empty());

    // Step 0 should still be absent from steps table (not falsely completed)
    let steps = crate::db::get_workflow_steps(&conn, "fresh-skill").unwrap();
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

    crate::db::save_workflow_run(&conn, "lost-skill", 2, "pending", "domain").unwrap();
    insert_stub_clarifications(&conn, "lost-skill");

    let result = reconcile_on_startup(&conn, workspace, skills_path).unwrap();

    // No notification — steps 0-2 are DB-authoritative, no SKILL.md expected
    assert!(
        result.notifications.is_empty(),
        "got: {:?}",
        result.notifications
    );

    let run = crate::db::get_workflow_run(&conn, "lost-skill")
        .unwrap()
        .unwrap();
    // current_step stays at 2; no filesystem evidence is needed for steps 0-2
    assert_eq!(run.current_step, 2);
}

#[test]
fn test_reset_does_not_mark_non_detectable_steps_completed() {
    // DB at step 3 with no SKILL.md on disk.
    // Scenario 4 fires: reset to step 2 (steps 0-2 DB-authoritative, SKILL.md missing).
    // After reset, only step 3 status should be cleared.
    let tmp = tempfile::tempdir().unwrap();
    let skills_tmp = tempfile::tempdir().unwrap();
    let workspace = tmp.path().to_str().unwrap();
    let skills_path = skills_tmp.path().to_str().unwrap();
    let conn = create_test_db();

    crate::db::save_workflow_run(&conn, "my-skill", 3, "pending", "domain").unwrap();
    insert_stub_clarifications(&conn, "my-skill");
    insert_stub_decisions(&conn, "my-skill");
    // Mark steps 0-2 as completed in DB (pre-existing state)
    for s in 0..=2 {
        crate::db::save_workflow_step(&conn, "my-skill", s, "completed").unwrap();
    }
    create_skill_dir(tmp.path(), "my-skill", "sales");
    // No SKILL.md on disk

    let result = reconcile_on_startup(&conn, workspace, skills_path).unwrap();

    assert!(result.notifications[0].contains("reset from step 4 to step 3"));
    let run = crate::db::get_workflow_run(&conn, "my-skill")
        .unwrap()
        .unwrap();
    // Reset to step 2 (index 2 = "step 3" in 1-indexed display)
    assert_eq!(run.current_step, 2);

    // Steps 0-2 should remain completed (DB-authoritative); step 3 reset
    let steps = crate::db::get_workflow_steps(&conn, "my-skill").unwrap();
    for step in &steps {
        if step.step_id <= 2 {
            assert_eq!(
                step.status, "completed",
                "Step {} should remain completed (DB-authoritative)",
                step.step_id
            );
        } else {
            assert_ne!(
                step.status, "completed",
                "Step {} should NOT be completed after reset",
                step.step_id
            );
        }
    }
}

// --- Non-detectable step tests ---

#[test]
fn test_step_4_not_reset_when_step_3_output_exists() {
    let tmp = tempfile::tempdir().unwrap();
    let skills_tmp = tempfile::tempdir().unwrap();
    let workspace = tmp.path().to_str().unwrap();
    let skills_path = skills_tmp.path().to_str().unwrap();
    let conn = create_test_db();

    crate::db::save_workflow_run(&conn, "done-skill", 4, "pending", "domain").unwrap();
    insert_stub_clarifications(&conn, "done-skill");
    insert_stub_decisions(&conn, "done-skill");
    create_skill_dir(tmp.path(), "done-skill", "analytics");
    for step in [0, 2, 3] {
        create_step_output(skills_tmp.path(), "done-skill", step);
    }

    let result = reconcile_on_startup(&conn, workspace, skills_path).unwrap();

    // Should NOT reset — step 4 is beyond last step but step 3 output exists
    assert!(result.notifications.is_empty());
    let run = crate::db::get_workflow_run(&conn, "done-skill")
        .unwrap()
        .unwrap();
    assert_eq!(run.current_step, 4);
}

#[test]
fn test_step_4_reset_when_step_3_output_missing() {
    let tmp = tempfile::tempdir().unwrap();
    let skills_tmp = tempfile::tempdir().unwrap();
    let workspace = tmp.path().to_str().unwrap();
    let skills_path = skills_tmp.path().to_str().unwrap();
    let conn = create_test_db();

    crate::db::save_workflow_run(&conn, "bad-skill", 4, "pending", "domain").unwrap();
    insert_stub_clarifications(&conn, "bad-skill");
    insert_stub_decisions(&conn, "bad-skill");
    create_skill_dir(tmp.path(), "bad-skill", "analytics");
    // Only steps 0-2 have output, step 3 is missing
    for step in [0, 2] {
        create_step_output(skills_tmp.path(), "bad-skill", step);
    }

    let result = reconcile_on_startup(&conn, workspace, skills_path).unwrap();

    // Should reset — disk is genuinely behind
    assert_eq!(result.notifications.len(), 1);
    assert!(result.notifications[0].contains("reset from step 5 to step 3"));
    let run = crate::db::get_workflow_run(&conn, "bad-skill")
        .unwrap()
        .unwrap();
    assert_eq!(run.current_step, 2);
}

#[test]
fn test_step_1_not_reset_when_step_0_output_exists() {
    let tmp = tempfile::tempdir().unwrap();
    let skills_tmp = tempfile::tempdir().unwrap();
    let workspace = tmp.path().to_str().unwrap();
    let skills_path = skills_tmp.path().to_str().unwrap();
    let conn = create_test_db();

    crate::db::save_workflow_run(&conn, "review-skill", 1, "pending", "domain").unwrap();
    insert_stub_clarifications(&conn, "review-skill");
    create_skill_dir(tmp.path(), "review-skill", "sales");
    create_step_output(skills_tmp.path(), "review-skill", 0);

    let result = reconcile_on_startup(&conn, workspace, skills_path).unwrap();

    assert!(result.notifications.is_empty());
    let run = crate::db::get_workflow_run(&conn, "review-skill")
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

    crate::db::save_workflow_run(&conn, "review-skill", 3, "pending", "domain").unwrap();
    insert_stub_clarifications(&conn, "review-skill");
    insert_stub_decisions(&conn, "review-skill");
    create_skill_dir(tmp.path(), "review-skill", "sales");
    create_step_output(skills_tmp.path(), "review-skill", 0);
    create_step_output(skills_tmp.path(), "review-skill", 2);
    create_step_output(skills_tmp.path(), "review-skill", 3);

    let result = reconcile_on_startup(&conn, workspace, skills_path).unwrap();

    assert!(result.notifications.is_empty());
    let run = crate::db::get_workflow_run(&conn, "review-skill")
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

        crate::db::save_workflow_run(&conn, "my-skill", db_step, "pending", "domain").unwrap();
        insert_stub_clarifications(&conn, "my-skill");
        if db_step >= 3 {
            insert_stub_decisions(&conn, "my-skill");
        }
        create_skill_dir(tmp.path(), "my-skill", "sales");
        for step in &disk_steps {
            create_step_output(skills_tmp.path(), "my-skill", *step);
        }

        let result = reconcile_on_startup(&conn, workspace, skills_path).unwrap();

        assert!(
            result.notifications.is_empty(),
            "DB at step {}, disk through step {:?}: should NOT reset but got: {:?}",
            db_step,
            disk_steps.last(),
            result.notifications
        );
        let run = crate::db::get_workflow_run(&conn, "my-skill")
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

    crate::db::save_workflow_run(&conn, "my-skill", 1, "pending", "domain").unwrap();
    insert_stub_clarifications(&conn, "my-skill");
    create_skill_dir(tmp.path(), "my-skill", "sales");
    create_step_output(skills_tmp.path(), "my-skill", 0);

    let result = reconcile_on_startup(&conn, workspace, skills_path).unwrap();

    assert!(result.notifications.is_empty());
    let run = crate::db::get_workflow_run(&conn, "my-skill")
        .unwrap()
        .unwrap();
    assert_eq!(run.current_step, 1);
}

#[test]
fn test_step_3_on_db_but_no_skill_md_resets_to_step_2() {
    // DB=3, no SKILL.md on disk.
    // Steps 0-2 are DB-authoritative; SKILL.md is the only filesystem artifact.
    // Scenario 4 fires: reset to step 2 so the user can re-run step 3.
    let tmp = tempfile::tempdir().unwrap();
    let skills_tmp = tempfile::tempdir().unwrap();
    let workspace = tmp.path().to_str().unwrap();
    let skills_path = skills_tmp.path().to_str().unwrap();
    let conn = create_test_db();

    crate::db::save_workflow_run(&conn, "my-skill", 3, "pending", "domain").unwrap();
    insert_stub_clarifications(&conn, "my-skill");
    insert_stub_decisions(&conn, "my-skill");
    create_skill_dir(tmp.path(), "my-skill", "sales");

    let result = reconcile_on_startup(&conn, workspace, skills_path).unwrap();

    assert_eq!(result.notifications.len(), 1);
    assert!(result.notifications[0].contains("reset from step 4 to step 3"));
    let run = crate::db::get_workflow_run(&conn, "my-skill")
        .unwrap()
        .unwrap();
    assert_eq!(run.current_step, 2);
}

// --- Disk ahead ---

#[test]
fn test_disk_ahead_stale_db_advances_current_step() {
    let tmp = tempfile::tempdir().unwrap();
    let skills_tmp = tempfile::tempdir().unwrap();
    let workspace = tmp.path().to_str().unwrap();
    let skills_path = skills_tmp.path().to_str().unwrap();
    let conn = create_test_db();

    crate::db::save_workflow_run(&conn, "my-skill", 0, "pending", "domain").unwrap();
    create_skill_dir(tmp.path(), "my-skill", "sales");
    create_step_output(tmp.path(), "my-skill", 0);
    create_step_output(tmp.path(), "my-skill", 2);
    create_step_output(skills_tmp.path(), "my-skill", 3);

    let result = reconcile_on_startup(&conn, workspace, skills_path).unwrap();

    assert_eq!(result.notifications.len(), 1);
    assert!(result.notifications[0].contains("advanced from step 1 to step 4"));
    let run = crate::db::get_workflow_run(&conn, "my-skill")
        .unwrap()
        .unwrap();
    assert_eq!(run.current_step, 3);
}

// --- Edge cases ---

#[test]
fn test_reconcile_empty_workspace() {
    let tmp = tempfile::tempdir().unwrap();
    let skills_tmp = tempfile::tempdir().unwrap();
    let workspace = tmp.path().to_str().unwrap();
    let skills_path = skills_tmp.path().to_str().unwrap();
    let conn = create_test_db();

    let result = reconcile_on_startup(&conn, workspace, skills_path).unwrap();

    assert!(result.orphans.is_empty());
    assert!(result.notifications.is_empty());
    assert_eq!(result.auto_cleaned, 0);
}

#[test]
fn test_reconcile_mixed_scenarios() {
    let tmp = tempfile::tempdir().unwrap();
    let workspace = tmp.path().to_str().unwrap();
    let skills_tmp = tempfile::tempdir().unwrap();
    let skills_path = skills_tmp.path().to_str().unwrap();
    let conn = create_test_db();

    // Skill-builder skill with workspace dir missing — should recreate it
    crate::db::save_workflow_run(&conn, "db-only", 0, "pending", "domain").unwrap();

    // Normal — skill in skills_path with matching DB record
    crate::db::save_workflow_run(&conn, "normal", 0, "pending", "domain").unwrap();
    create_skill_dir(tmp.path(), "normal", "domain-c");
    create_step_output(skills_tmp.path(), "normal", 0);

    // Marketplace skill with SKILL.md
    crate::db::upsert_skill_in_plugin(
        &conn,
        "mkt-skill",
        "marketplace",
        "platform",
        crate::skill_paths::DEFAULT_PLUGIN_SLUG,
    )
    .unwrap();
    let mkt_dir = resolve_skill_dir(
        skills_tmp.path(),
        crate::skill_paths::DEFAULT_PLUGIN_SLUG,
        "mkt-skill",
    );
    std::fs::create_dir_all(&mkt_dir).unwrap();
    std::fs::write(mkt_dir.join("SKILL.md"), "# Marketplace").unwrap();

    let result = reconcile_on_startup(&conn, workspace, skills_path).unwrap();

    // No auto-cleaning, no disk-only discovery (all skills_path dirs are in master)
    assert_eq!(result.auto_cleaned, 0);
    assert!(result.notifications.is_empty());
    assert!(result.orphans.is_empty());

    // db-only skill's workspace dir should have been recreated (no context/ subdir)
    assert!(tmp
        .path()
        .join(DEFAULT_PLUGIN_SLUG)
        .join("skills")
        .join("db-only")
        .exists());

    // DB records for all skills should still be present
    assert!(crate::db::get_workflow_run(&conn, "db-only")
        .unwrap()
        .is_some());
    assert!(crate::db::get_workflow_run(&conn, "normal")
        .unwrap()
        .is_some());
    assert!(crate::db::get_skill_master_id(&conn, "mkt-skill")
        .unwrap()
        .is_some());
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

    let result = reconcile_on_startup(&conn, workspace, skills_path).unwrap();

    assert!(result.orphans.is_empty());
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
    crate::db::save_workflow_run(&conn, "active-skill", 3, "pending", "domain").unwrap();
    create_step_output(skills_tmp.path(), "active-skill", 0);

    let current_pid = std::process::id();
    crate::db::create_workflow_session(&conn, "sess-active", "active-skill", current_pid).unwrap();

    let result = reconcile_on_startup(&conn, workspace, skills_path).unwrap();

    assert_eq!(result.notifications.len(), 1);
    assert!(result.notifications[0].contains("skipped"));
    assert!(result.notifications[0].contains("active session"));
    let run = crate::db::get_workflow_run(&conn, "active-skill")
        .unwrap()
        .unwrap();
    assert_eq!(run.current_step, 3, "Step should remain at 3 (untouched)");
}

#[test]
fn test_reconcile_processes_skill_with_dead_session() {
    let tmp = tempfile::tempdir().unwrap();
    let skills_tmp = tempfile::tempdir().unwrap();
    let workspace = tmp.path().to_str().unwrap();
    let skills_path = skills_tmp.path().to_str().unwrap();
    let conn = create_test_db();

    create_skill_dir(tmp.path(), "crashed-skill", "test");
    crate::db::save_workflow_run(&conn, "crashed-skill", 3, "pending", "domain").unwrap();
    insert_stub_clarifications(&conn, "crashed-skill");
    insert_stub_decisions(&conn, "crashed-skill");
    // No SKILL.md on disk (crashed before completing step 3)

    crate::db::create_workflow_session(&conn, "sess-dead", "crashed-skill", 999999).unwrap();
    crate::db::reconcile_orphaned_sessions(&conn).unwrap();

    let result = reconcile_on_startup(&conn, workspace, skills_path).unwrap();

    assert_eq!(result.notifications.len(), 1);
    // Scenario 4: DB=3 but no SKILL.md → reset to step 2
    assert!(result.notifications[0].contains("reset from step 4 to step 3"));
    let run = crate::db::get_workflow_run(&conn, "crashed-skill")
        .unwrap()
        .unwrap();
    assert_eq!(run.current_step, 2);
}

#[test]
fn test_reconcile_resets_to_step2_when_skill_md_missing() {
    // DB says step 3, no SKILL.md on disk.
    // Scenario 4: reset to step 2 so user can re-run Generate Skill.
    let tmp = tempfile::tempdir().unwrap();
    let skills_tmp = tempfile::tempdir().unwrap();
    let workspace = tmp.path().to_str().unwrap();
    let skills_path = skills_tmp.path().to_str().unwrap();
    let conn = create_test_db();

    create_skill_dir(tmp.path(), "my-skill", "test");
    crate::db::save_workflow_run(&conn, "my-skill", 3, "pending", "domain").unwrap();
    insert_stub_clarifications(&conn, "my-skill");
    insert_stub_decisions(&conn, "my-skill");

    let result = reconcile_on_startup(&conn, workspace, skills_path).unwrap();

    let run = crate::db::get_workflow_run(&conn, "my-skill")
        .unwrap()
        .unwrap();
    assert_eq!(
        run.current_step, 2,
        "should reconcile to step 2 (steps 0-2 DB-authoritative)"
    );
    assert!(!result.notifications.is_empty());
    assert!(result.notifications[0].contains("reset from step 4 to step 3"));
}

// --- Gap 1: Disk ahead also triggers status='completed' when disk_step >= LAST_WORKFLOW_STEP ---

#[test]
fn test_disk_ahead_with_all_steps_sets_status_completed() {
    // DB has skill at current_step=1, status='pending'.
    // Disk has step 0, 2, AND 3 outputs (disk_step=3 >= LAST_WORKFLOW_STEP=3).
    // After reconcile: current_step advanced to 3 AND status='completed'.
    let tmp = tempfile::tempdir().unwrap();
    let skills_tmp = tempfile::tempdir().unwrap();
    let workspace = tmp.path().to_str().unwrap();
    let skills_path = skills_tmp.path().to_str().unwrap();
    let conn = create_test_db();

    crate::db::save_workflow_run(&conn, "my-skill", 1, "pending", "domain").unwrap();
    insert_stub_clarifications(&conn, "my-skill");
    create_skill_dir(tmp.path(), "my-skill", "sales");
    for step in [0u32, 2, 3] {
        create_step_output(skills_tmp.path(), "my-skill", step);
    }

    let result = reconcile_on_startup(&conn, workspace, skills_path).unwrap();

    // Disk ahead (3 > 1) triggers an "advanced" notification
    assert_eq!(result.notifications.len(), 1);
    assert!(result.notifications[0].contains("advanced from step 2 to step 4"));

    let run = crate::db::get_workflow_run(&conn, "my-skill")
        .unwrap()
        .unwrap();
    assert_eq!(run.current_step, 3);
    assert_eq!(
        run.status, "completed",
        "status should be 'completed' when disk_step >= LAST_WORKFLOW_STEP"
    );
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

    crate::db::save_workflow_run(&conn, "my-skill", 0, "pending", "domain").unwrap();
    create_skill_dir(tmp.path(), "my-skill", "sales");

    let result = reconcile_on_startup(&conn, workspace, skills_path).unwrap();

    // No notification — Scenario 8 just resets step statuses silently
    assert!(
        result.notifications.is_empty(),
        "got: {:?}",
        result.notifications
    );

    let run = crate::db::get_workflow_run(&conn, "my-skill")
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

    crate::db::save_workflow_run(&conn, "my-skill", 1, "pending", "domain").unwrap();
    crate::db::save_workflow_step(&conn, "my-skill", 0, "completed").unwrap();
    insert_stub_clarifications(&conn, "my-skill");

    reconcile_on_startup(&conn, workspace, skills_path).unwrap();

    let steps = crate::db::get_workflow_steps(&conn, "my-skill").unwrap();
    let step0 = steps
        .iter()
        .find(|s| s.step_id == 0)
        .expect("step 0 should exist in workflow_steps");
    assert_eq!(
        step0.status, "completed",
        "step 0 was reset to '{}' but should remain 'completed' — Scenario 8 must not wipe DB step statuses",
        step0.status
    );

    let run = crate::db::get_workflow_run(&conn, "my-skill")
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
    crate::db::save_workflow_run(&conn, "my-skill", 1, "pending", "domain").unwrap();
    insert_stub_clarifications(&conn, "my-skill");
    // DO NOT create the workspace dir — it is missing
    // Create step 0 output in skills_path (detectable)
    create_step_output(skills_tmp.path(), "my-skill", 0);

    let result = reconcile_on_startup(&conn, workspace, skills_path).unwrap();

    // No reset should occur — disk confirms last_expected_detectable (step 0)
    assert!(
        result.notifications.is_empty(),
        "should not reset: {:?}",
        result.notifications
    );

    // Workspace dir should have been recreated (no longer includes context/ subdir)
    assert!(
        tmp.path()
            .join(DEFAULT_PLUGIN_SLUG)
            .join("skills")
            .join("my-skill")
            .exists(),
        "workspace skill dir should be recreated"
    );

    // current_step should remain at 1 (DB is valid)
    let run = crate::db::get_workflow_run(&conn, "my-skill")
        .unwrap()
        .unwrap();
    assert_eq!(run.current_step, 1, "current_step should not be reset");
    assert_eq!(run.status, "pending");
}

// Note: Old "disk-only discovery" tests (Gap 3 & Gap 4) have been replaced
// by scenario 10 tests above. Disk discovery is now handled by Pass 2 (VD-874).

// --- Gap 5: DB=3 with step 3 missing resets to 2 ---

#[test]
fn test_step_3_on_db_but_step_3_missing_resets_to_2() {
    // DB has skill at current_step=3.
    // Disk has step 0 and step 2 outputs but NOT step 3.
    // last_expected_detectable = max([0,2,3] filter <= 3) = 3.
    // disk_step = 2 (highest detectable found).
    // disk_step(2) >= last_expected_detectable(3) → false → reset to disk_step=2.
    // After reconcile: current_step=2.
    let tmp = tempfile::tempdir().unwrap();
    let skills_tmp = tempfile::tempdir().unwrap();
    let workspace = tmp.path().to_str().unwrap();
    let skills_path = skills_tmp.path().to_str().unwrap();
    let conn = create_test_db();

    crate::db::save_workflow_run(&conn, "my-skill", 3, "pending", "domain").unwrap();
    insert_stub_clarifications(&conn, "my-skill");
    insert_stub_decisions(&conn, "my-skill");
    create_skill_dir(tmp.path(), "my-skill", "sales");
    // Steps 0 and 2 exist but NOT step 3
    create_step_output(tmp.path(), "my-skill", 0);
    create_step_output(tmp.path(), "my-skill", 2);
    // Note: step 3 output (SKILL.md) is intentionally absent

    let result = reconcile_on_startup(&conn, workspace, skills_path).unwrap();

    assert_eq!(result.notifications.len(), 1);
    assert!(
        result.notifications[0].contains("reset from step 4 to step 3"),
        "expected reset from 4 to 3, got: {:?}",
        result.notifications
    );

    let run = crate::db::get_workflow_run(&conn, "my-skill")
        .unwrap()
        .unwrap();
    assert_eq!(run.current_step, 2, "should be reset to disk_step=2");
    // Status should not be completed since disk_step(2) < LAST_WORKFLOW_STEP(3)
    assert_eq!(run.status, "pending");
}

// --- Gap 6: Non-detectable steps marked completed after valid reconciliation ---

#[test]
fn test_skill_md_marks_all_prior_steps_completed() {
    // Steps 0-2 are DB-authoritative; SKILL.md is the only filesystem artifact (step 3).
    // When SKILL.md is present (disk_step=3) and DB is at step 1 (behind disk),
    // reconciliation advances DB to step 3 and marks steps 0, 2, 3 completed.
    // Step 1 (non-detectable, between old current_step 1 and disk_step 3) is
    // NOT in the non-detectable loop since the advance sets did_reset=false and
    // the loop is (disk_step+1)..=old_current_step = (4)..=1 which is empty.
    let tmp = tempfile::tempdir().unwrap();
    let skills_tmp = tempfile::tempdir().unwrap();
    let workspace = tmp.path().to_str().unwrap();
    let skills_path = skills_tmp.path().to_str().unwrap();
    let conn = create_test_db();

    crate::db::save_workflow_run(&conn, "my-skill", 1, "pending", "domain").unwrap();
    insert_stub_clarifications(&conn, "my-skill");
    create_skill_dir(tmp.path(), "my-skill", "sales");
    // Create SKILL.md in skills_path to simulate a completed workflow
    create_step_output(skills_tmp.path(), "my-skill", 3);

    let result = reconcile_on_startup(&conn, workspace, skills_path).unwrap();

    // Disk ahead of DB → advance notification
    assert_eq!(result.notifications.len(), 1);
    assert!(result.notifications[0].contains("my-skill"));

    // DB should be advanced to disk_step=3
    let run = crate::db::get_workflow_run(&conn, "my-skill")
        .unwrap()
        .unwrap();
    assert_eq!(run.current_step, 3);

    // Steps 0, 2, 3 are detectable and confirmed by disk → completed
    let steps = crate::db::get_workflow_steps(&conn, "my-skill").unwrap();
    for &step_id in &[0i32, 2, 3] {
        let s = steps.iter().find(|s| s.step_id == step_id);
        assert!(
            s.map(|s| s.status == "completed").unwrap_or(false),
            "step {} should be marked completed (detectable, disk_step=3)",
            step_id
        );
    }
}

// --- resolve_orphan tests ---

#[test]
fn test_resolve_orphan_delete() {
    let tmp = tempfile::tempdir().unwrap();
    let skills_path = tmp.path().to_str().unwrap();
    let conn = create_test_db();

    crate::db::save_workflow_run(&conn, "orphan", 7, "completed", "domain").unwrap();
    let output_dir = resolve_skill_dir(
        tmp.path(),
        crate::skill_paths::DEFAULT_PLUGIN_SLUG,
        "orphan",
    );
    std::fs::create_dir_all(output_dir.join("references")).unwrap();
    std::fs::write(output_dir.join("SKILL.md"), "# Skill").unwrap();

    resolve_orphan(&conn, "orphan", "delete", skills_path).unwrap();

    assert!(crate::db::get_workflow_run(&conn, "orphan")
        .unwrap()
        .is_none());
    assert!(!output_dir.exists());
}

#[test]
fn test_resolve_orphan_keep() {
    let tmp = tempfile::tempdir().unwrap();
    let skills_path = tmp.path().to_str().unwrap();
    let conn = create_test_db();

    crate::db::save_workflow_run(&conn, "orphan", 7, "completed", "domain").unwrap();
    let output_dir = tmp.path().join("orphan");
    std::fs::create_dir_all(&output_dir).unwrap();
    std::fs::write(output_dir.join("SKILL.md"), "# Skill").unwrap();

    resolve_orphan(&conn, "orphan", "keep", skills_path).unwrap();

    let run = crate::db::get_workflow_run(&conn, "orphan")
        .unwrap()
        .unwrap();
    assert_eq!(run.current_step, 0);
    assert_eq!(run.status, "pending");
    assert!(output_dir.join("SKILL.md").exists());
}

#[test]
fn test_resolve_orphan_delete_already_gone() {
    let conn = create_test_db();

    crate::db::save_workflow_run(&conn, "orphan", 5, "completed", "domain").unwrap();

    resolve_orphan(&conn, "orphan", "delete", "/nonexistent/path").unwrap();
    assert!(crate::db::get_workflow_run(&conn, "orphan")
        .unwrap()
        .is_none());
}

#[test]
fn test_resolve_orphan_invalid_action() {
    let tmp = tempfile::tempdir().unwrap();
    let skills_path = tmp.path().to_str().unwrap();
    let conn = create_test_db();
    crate::db::save_workflow_run(&conn, "orphan", 5, "completed", "domain").unwrap();

    let result = resolve_orphan(&conn, "orphan", "invalid", skills_path);
    assert!(result.is_err());
    assert!(result
        .unwrap_err()
        .contains("Invalid orphan resolution action"));
}

// --- Scenario 10: skill_source=skill-builder, master row, no workflow_runs ---

#[test]
fn test_scenario_10_master_row_no_workflow_runs_with_step_output() {
    // Master has skill-builder row but no workflow_runs.
    // Steps 0-2 are DB-authoritative; no clarifications in DB, no SKILL.md on disk.
    // Auto-creates workflow_runs at step 0 (default when no DB artifacts found).
    let tmp = tempfile::tempdir().unwrap();
    let skills_tmp = tempfile::tempdir().unwrap();
    let workspace = tmp.path().to_str().unwrap();
    let skills_path = skills_tmp.path().to_str().unwrap();
    let conn = create_test_db();

    crate::db::upsert_skill(&conn, "real-skill", "skill-builder", "domain").unwrap();
    create_skill_dir(tmp.path(), "real-skill", "analytics");

    let result = reconcile_on_startup(&conn, workspace, skills_path).unwrap();

    assert_eq!(result.notifications.len(), 1);
    assert!(result.notifications[0].contains("real-skill"));
    assert!(result.notifications[0].contains("workflow record recreated at step 1"));

    let run = crate::db::get_workflow_run(&conn, "real-skill")
        .unwrap()
        .unwrap();
    assert_eq!(run.current_step, 0);
    assert_eq!(run.status, "pending");
}

#[test]
fn test_scenario_10_master_row_no_workflow_runs_all_steps_complete() {
    // Master has skill-builder row, disk has all steps including SKILL.md → completed
    let tmp = tempfile::tempdir().unwrap();
    let skills_tmp = tempfile::tempdir().unwrap();
    let workspace = tmp.path().to_str().unwrap();
    let skills_path = skills_tmp.path().to_str().unwrap();
    let conn = create_test_db();

    crate::db::upsert_skill(&conn, "done-skill", "skill-builder", "domain").unwrap();
    // detect_furthest_step requires workspace dir to exist
    create_skill_dir(tmp.path(), "done-skill", "analytics");
    for step in [0u32, 2, 3] {
        create_step_output(skills_tmp.path(), "done-skill", step);
    }

    let result = reconcile_on_startup(&conn, workspace, skills_path).unwrap();

    assert_eq!(result.notifications.len(), 1);
    assert!(result.notifications[0].contains("workflow record recreated at step 4"));

    let run = crate::db::get_workflow_run(&conn, "done-skill")
        .unwrap()
        .unwrap();
    assert_eq!(run.current_step, 3);
    assert_eq!(run.status, "completed");
}

#[test]
fn test_scenario_10_master_row_no_workflow_runs_no_output() {
    // Master has skill-builder row, no disk output → workflow_runs at step 0
    let tmp = tempfile::tempdir().unwrap();
    let skills_tmp = tempfile::tempdir().unwrap();
    let workspace = tmp.path().to_str().unwrap();
    let skills_path = skills_tmp.path().to_str().unwrap();
    let conn = create_test_db();

    crate::db::upsert_skill(&conn, "bare-skill", "skill-builder", "domain").unwrap();

    let result = reconcile_on_startup(&conn, workspace, skills_path).unwrap();

    assert_eq!(result.notifications.len(), 1);
    assert!(result.notifications[0].contains("workflow record recreated at step 1"));

    let run = crate::db::get_workflow_run(&conn, "bare-skill")
        .unwrap()
        .unwrap();
    assert_eq!(run.current_step, 0);
    assert_eq!(run.status, "pending");
}

// =========================================================================
// HIGH PRIORITY — data integrity and UI correctness
// =========================================================================

#[test]
fn test_disk_ahead_advances_db_with_old_steps() {
    // DB is at step 0, but disk has output through step 5 → DB should advance.
    let tmp = tempfile::tempdir().unwrap();
    let workspace = tmp.path().to_str().unwrap();
    let conn = create_test_db();

    crate::db::save_workflow_run(&conn, "my-skill", 0, "pending", "domain").unwrap();
    crate::db::save_workflow_step(&conn, "my-skill", 0, "completed").unwrap();

    create_skill_dir(tmp.path(), "my-skill", "sales");
    create_step_output(tmp.path(), "my-skill", 0);
    create_step_output(tmp.path(), "my-skill", 2);
    create_step_output(tmp.path(), "my-skill", 3);

    let result = reconcile_on_startup(&conn, workspace, workspace).unwrap();

    assert!(result.orphans.is_empty());
    assert_eq!(result.auto_cleaned, 0);
    assert_eq!(result.notifications.len(), 1);
    assert!(result.notifications[0].contains("advanced from step 1 to step 4"));

    let run = crate::db::get_workflow_run(&conn, "my-skill")
        .unwrap()
        .unwrap();
    assert_eq!(run.current_step, 3);
    assert_eq!(run.status, "completed"); // step 3 = last step → completed
}

#[test]
fn test_no_skill_md_resets_step3_to_step2() {
    // DB says step 3, no SKILL.md on disk.
    // Steps 0-2 are DB-authoritative, so reset to step 2 to re-run Generate Skill.
    let tmp = tempfile::tempdir().unwrap();
    let workspace = tmp.path().to_str().unwrap();
    let conn = create_test_db();

    crate::db::save_workflow_run(&conn, "my-skill", 3, "in_progress", "domain").unwrap();
    insert_stub_clarifications(&conn, "my-skill");
    insert_stub_decisions(&conn, "my-skill");

    create_skill_dir(tmp.path(), "my-skill", "test");

    let result = reconcile_on_startup(&conn, workspace, workspace).unwrap();

    // DB had step 3 → reset to step 2 (SKILL.md not found)
    let run = crate::db::get_workflow_run(&conn, "my-skill")
        .unwrap()
        .unwrap();
    assert_eq!(run.current_step, 2);
    assert_eq!(result.notifications.len(), 1);
    assert!(result.notifications[0].contains("reset from step 4 to step 3"));
}

#[test]
fn test_reconcile_full_with_fallback_to_workspace_path() {
    // skills_path is None → entire system falls back to workspace_path.
    // Skill folder in workspace with step 0+2 output → should reconcile correctly.
    let tmp = tempfile::tempdir().unwrap();
    let workspace = tmp.path().to_str().unwrap();
    let conn = create_test_db();

    crate::db::save_workflow_run(&conn, "my-skill", 1, "in_progress", "domain").unwrap();
    insert_stub_clarifications(&conn, "my-skill");

    create_skill_dir(tmp.path(), "my-skill", "test");
    create_step_output(tmp.path(), "my-skill", 0);
    create_step_output(tmp.path(), "my-skill", 2);

    // skills_path = None → fallback to workspace
    let result = reconcile_on_startup(&conn, workspace, workspace).unwrap();

    assert!(result.orphans.is_empty());
    assert_eq!(result.auto_cleaned, 0);

    // DB should be reconciled: disk has step 2, DB had step 1.
    // Step 1 is non-detectable, disk ahead → advance to step 2.
    let run = crate::db::get_workflow_run(&conn, "my-skill")
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

    crate::db::save_workflow_run(&conn, "my-skill", 3, "completed", "domain").unwrap();

    create_skill_dir(tmp.path(), "my-skill", "test");
    create_step_output(tmp.path(), "my-skill", 0);
    create_step_output(tmp.path(), "my-skill", 2);
    create_step_output(tmp.path(), "my-skill", 3);

    // workspace = skills_path = same directory
    let result = reconcile_on_startup(&conn, path, path).unwrap();

    assert!(result.orphans.is_empty());
    assert_eq!(result.auto_cleaned, 0);

    let run = crate::db::get_workflow_run(&conn, "my-skill")
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

    crate::cleanup::cleanup_future_steps(workspace, "my-skill", DEFAULT_PLUGIN_SLUG, -1, workspace);

    // All step output should be deleted
    let skill_dir = resolve_workspace_skill_dir(tmp.path(), DEFAULT_PLUGIN_SLUG, "my-skill");
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
    crate::db::save_workflow_run(&conn, "old-skill", 0, "pending", "domain").unwrap();
    create_skill_dir(&workspace, "old-skill", "test");

    let result = reconcile_on_startup(&conn, workspace_str, skills_str).unwrap();

    // DB record should be preserved (not auto-cleaned)
    assert_eq!(result.auto_cleaned, 0);
    assert!(result.orphans.is_empty());
    assert!(crate::db::get_workflow_run(&conn, "old-skill")
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
        crate::db::save_workflow_run(&conn, name, 5, "completed", "domain").unwrap();
        let output_dir = skills.join(name);
        std::fs::create_dir_all(output_dir.join("references")).unwrap();
        std::fs::write(output_dir.join("SKILL.md"), "# Skill").unwrap();
    }

    let result = reconcile_on_startup(&conn, workspace_str, skills_str).unwrap();

    // All three are in skills_path (the driver) → they're in disk_dirs → normal reconciliation
    assert!(result.orphans.is_empty());
    assert_eq!(result.auto_cleaned, 0);

    // All DB records should still exist
    for name in &["skill-a", "skill-b", "skill-c"] {
        assert!(crate::db::get_workflow_run(&conn, name).unwrap().is_some());
    }
}

#[test]
fn test_scenario_10_uses_unknown_domain() {
    // Scenario 10: master row (skill-builder), no workflow_runs → auto-create with domain="unknown"
    let tmp = tempfile::tempdir().unwrap();
    let skills_tmp = tempfile::tempdir().unwrap();
    let workspace = tmp.path().to_str().unwrap();
    let skills_path = skills_tmp.path().to_str().unwrap();
    let conn = create_test_db();

    crate::db::upsert_skill(&conn, "new-skill", "skill-builder", "domain").unwrap();
    // No step output — just a master row

    let result = reconcile_on_startup(&conn, workspace, skills_path).unwrap();

    assert_eq!(result.notifications.len(), 1);
    assert!(result.notifications[0].contains("new-skill"));

    let run = crate::db::get_workflow_run(&conn, "new-skill")
        .unwrap()
        .unwrap();
    // domain column dropped - no longer checking "unknown" // domain defaults to "unknown" when workflow_runs row is recreated
    assert_eq!(run.purpose, "domain"); // conservative default
    assert_eq!(run.current_step, 0);
    assert_eq!(run.status, "pending");
}

#[test]
fn test_reconcile_skips_only_protected_skill() {
    // Skill A has an active session (protected). Skill B needs a reset.
    // Reconciliation should skip A but still process B.
    let tmp = tempfile::tempdir().unwrap();
    let workspace = tmp.path().to_str().unwrap();
    let conn = create_test_db();

    // Skill A: active session with current PID
    crate::db::save_workflow_run(&conn, "protected", 3, "in_progress", "domain").unwrap();
    create_skill_dir(tmp.path(), "protected", "test");
    let pid = std::process::id();
    let session_id = uuid::Uuid::new_v4().to_string();
    crate::db::create_workflow_session(&conn, &session_id, "protected", pid).unwrap();

    // Skill B: DB at step 5, disk at step 0 → needs reset
    crate::db::save_workflow_run(&conn, "reset-me", 5, "in_progress", "domain").unwrap();
    insert_stub_clarifications(&conn, "reset-me");
    insert_stub_decisions(&conn, "reset-me");
    create_skill_dir(tmp.path(), "reset-me", "test");
    create_step_output(tmp.path(), "reset-me", 0);

    let result = reconcile_on_startup(&conn, workspace, workspace).unwrap();

    // A was skipped (notification says so), B was reset
    assert!(result
        .notifications
        .iter()
        .any(|n| n.contains("protected") && n.contains("skipped")));
    assert!(result
        .notifications
        .iter()
        .any(|n| n.contains("reset-me") && n.contains("reset from step 6")));

    // A's DB state should be unchanged
    let run_a = crate::db::get_workflow_run(&conn, "protected")
        .unwrap()
        .unwrap();
    assert_eq!(run_a.current_step, 3);
    assert_eq!(run_a.status, "in_progress");

    // B should be reset to step 2 (Scenario 4: DB=5 >= 3, no SKILL.md)
    let run_b = crate::db::get_workflow_run(&conn, "reset-me")
        .unwrap()
        .unwrap();
    assert_eq!(run_b.current_step, 2);
}

#[test]
fn test_notification_messages_exact_text() {
    let tmp = tempfile::tempdir().unwrap();
    let skills_tmp = tempfile::tempdir().unwrap();
    let workspace = tmp.path().to_str().unwrap();
    let skills_path = skills_tmp.path().to_str().unwrap();
    let conn = create_test_db();

    // Case 1: DB at step 5, no SKILL.md → Scenario 4: reset to step 2
    crate::db::save_workflow_run(&conn, "ahead-skill", 5, "in_progress", "domain").unwrap();
    insert_stub_clarifications(&conn, "ahead-skill");
    insert_stub_decisions(&conn, "ahead-skill");
    create_skill_dir(tmp.path(), "ahead-skill", "test");

    // Case 2: DB at step 3, no SKILL.md → Scenario 4: reset to step 2
    crate::db::save_workflow_run(&conn, "empty-skill", 3, "in_progress", "domain").unwrap();
    insert_stub_clarifications(&conn, "empty-skill");
    insert_stub_decisions(&conn, "empty-skill");
    create_skill_dir(tmp.path(), "empty-skill", "test");

    // Case 3: Scenario 10 — master row, no workflow_runs, no DB artifacts
    crate::db::upsert_skill(&conn, "found-skill", "skill-builder", "domain").unwrap();

    let result = reconcile_on_startup(&conn, workspace, skills_path).unwrap();

    // Scenario 4 message: "reset from step N to step 3 (SKILL.md not found)"
    assert!(
        result
            .notifications
            .iter()
            .any(|n| n == "'ahead-skill' was reset from step 6 to step 3 (SKILL.md not found)"),
        "notifications: {:?}",
        result.notifications
    );
    assert!(
        result
            .notifications
            .iter()
            .any(|n| n == "'empty-skill' was reset from step 4 to step 3 (SKILL.md not found)"),
        "notifications: {:?}",
        result.notifications
    );
    assert!(
        result
            .notifications
            .iter()
            .any(|n| n == "'found-skill' workflow record recreated at step 1"),
        "notifications: {:?}",
        result.notifications
    );
}

// =========================================================================
// LOW PRIORITY — defensive, locking down current behavior
// =========================================================================

// =========================================================================
// Pass 2: Disk discovery (VD-874)
// =========================================================================

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

    let result = reconcile_on_startup(&conn, workspace, skills_path).unwrap();

    // Folder should still exist — we don't delete random folders
    assert!(
        skills_tmp.path().join("orphan-folder").exists(),
        "folder should be left alone"
    );
    assert!(result.discovered_skills.is_empty());
}

#[test]
fn test_skill_on_disk_auto_created_in_db() {
    // Skill with SKILL.md on disk but not in DB → auto-created with notification
    let tmp = tempfile::tempdir().unwrap();
    let skills_tmp = tempfile::tempdir().unwrap();
    let workspace = tmp.path().to_str().unwrap();
    let skills_path = skills_tmp.path().to_str().unwrap();
    let conn = create_test_db();

    // Create full artifacts in skills_path (not in master) — legacy flat layout
    create_step_output(skills_tmp.path(), "complete-skill", 0);
    create_step_output(skills_tmp.path(), "complete-skill", 2);
    create_step_output(skills_tmp.path(), "complete-skill", 3);

    let result = reconcile_on_startup(&conn, workspace, skills_path).unwrap();

    // Should be auto-created in DB and appear in discovered_skills
    assert_eq!(result.discovered_skills.len(), 1);
    assert_eq!(result.discovered_skills[0].name, "complete-skill");
    assert_eq!(result.discovered_skills[0].scenario, "discovered");
    // Should have a notification
    assert!(result
        .notifications
        .iter()
        .any(|n| n.contains("complete-skill") && n.contains("discovered")));
    // Skill should now be in DB
    let all = crate::db::list_all_skills(&conn).unwrap();
    assert!(all.iter().any(|s| s.name == "complete-skill"));
}

#[test]
fn test_partial_skill_on_disk_auto_created() {
    // SKILL.md on disk but not in DB, partial context → auto-created
    let tmp = tempfile::tempdir().unwrap();
    let skills_tmp = tempfile::tempdir().unwrap();
    let workspace = tmp.path().to_str().unwrap();
    let skills_path = skills_tmp.path().to_str().unwrap();
    let conn = create_test_db();

    // Create SKILL.md only (no context artifacts)
    let skill_dir = skills_tmp.path().join("partial-skill");
    std::fs::create_dir_all(&skill_dir).unwrap();
    std::fs::write(skill_dir.join("SKILL.md"), "# Partial skill").unwrap();

    let result = reconcile_on_startup(&conn, workspace, skills_path).unwrap();

    assert_eq!(result.discovered_skills.len(), 1);
    assert_eq!(result.discovered_skills[0].name, "partial-skill");
    assert_eq!(result.discovered_skills[0].scenario, "discovered");
    // Should have a notification
    assert!(result
        .notifications
        .iter()
        .any(|n| n.contains("partial-skill")));
    // Skill should now be in DB
    let all = crate::db::list_all_skills(&conn).unwrap();
    assert!(all.iter().any(|s| s.name == "partial-skill"));
}

#[test]
fn test_pass2_skips_skills_already_in_master() {
    // Skill in master + on disk → not in discovered_skills
    let tmp = tempfile::tempdir().unwrap();
    let skills_tmp = tempfile::tempdir().unwrap();
    let workspace = tmp.path().to_str().unwrap();
    let skills_path = skills_tmp.path().to_str().unwrap();
    let conn = create_test_db();

    // Add skill to master and create it on disk
    crate::db::save_workflow_run(&conn, "known-skill", 5, "completed", "domain").unwrap();
    create_skill_dir(tmp.path(), "known-skill", "test");
    create_step_output(skills_tmp.path(), "known-skill", 0);
    create_step_output(skills_tmp.path(), "known-skill", 4);
    create_step_output(skills_tmp.path(), "known-skill", 5);

    // Also create an unknown skill on disk
    let unknown_dir = skills_tmp.path().join("unknown-skill");
    std::fs::create_dir_all(&unknown_dir).unwrap();
    std::fs::write(unknown_dir.join("SKILL.md"), "# Unknown").unwrap();

    let result = reconcile_on_startup(&conn, workspace, skills_path).unwrap();

    // Only the unknown skill should be discovered
    assert_eq!(result.discovered_skills.len(), 1);
    assert_eq!(result.discovered_skills[0].name, "unknown-skill");
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

    let result = reconcile_on_startup(&conn, workspace, skills_path).unwrap();

    assert!(result.discovered_skills.is_empty());
    assert!(result.notifications.is_empty());
}

#[test]
fn test_pass2_scenario_9c_with_some_context() {
    // SKILL.md + step 0 context (partial — no step 4 or 5 context) → scenario "9c"
    let tmp = tempfile::tempdir().unwrap();
    let skills_tmp = tempfile::tempdir().unwrap();
    let workspace = tmp.path().to_str().unwrap();
    let skills_path = skills_tmp.path().to_str().unwrap();
    let conn = create_test_db();

    // Create step 0 output + SKILL.md but no step 4
    create_step_output(skills_tmp.path(), "some-context-skill", 0);
    let skill_dir = crate::skill_paths::workspace_skill_dir(
        skills_tmp.path(),
        DEFAULT_PLUGIN_SLUG,
        "some-context-skill",
    );
    std::fs::write(skill_dir.join("SKILL.md"), "# Some context skill").unwrap();

    let result = reconcile_on_startup(&conn, workspace, skills_path).unwrap();

    assert_eq!(result.discovered_skills.len(), 1);
    assert_eq!(result.discovered_skills[0].name, "some-context-skill");
    assert_eq!(result.discovered_skills[0].scenario, "discovered");
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

    let result = reconcile_on_startup(&conn, workspace_str, skills_str).unwrap();

    // No skills in master → no notifications
    assert!(result.notifications.is_empty());
    assert!(result.discovered_skills.is_empty()); // disk-only-skill is in workspace, not skills_path
    assert!(crate::db::get_workflow_run(&conn, "disk-only-skill")
        .unwrap()
        .is_none());
    assert!(crate::db::get_workflow_run(&conn, ".git")
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

    let result =
        reconcile_on_startup(&conn, workspace.to_str().unwrap(), skills.to_str().unwrap()).unwrap();

    assert!(result.notifications.is_empty());
    // .git and .trash should still exist
    assert!(skills.join(".git").exists(), ".git should not be touched");
    assert!(
        skills.join(".trash").exists(),
        ".trash should not be touched"
    );
}

// --- Path traversal guard tests ---

#[test]
fn test_resolve_orphan_delete_rejects_traversal_name() {
    let tmp = tempfile::tempdir().unwrap();
    let skills_path = tmp.path().to_str().unwrap();
    let conn = create_test_db();
    crate::db::save_workflow_run(&conn, "some-skill", 1, "pending", "domain").unwrap();

    // skill_name contains path traversal sequences — must be rejected before any FS op
    let result = resolve_orphan(&conn, "../escape", "delete", skills_path);
    assert!(result.is_err());
    let err = result.unwrap_err();
    assert!(
        err.contains("Invalid skill name") || err.contains("traversal"),
        "unexpected error: {}",
        err
    );
    // DB row must NOT have been deleted (error before db write)
    assert!(
        crate::db::get_workflow_run(&conn, "some-skill")
            .unwrap()
            .is_some(),
        "unrelated skill should be untouched"
    );
}

#[test]
fn test_resolve_orphan_delete_rejects_slash_in_name() {
    let tmp = tempfile::tempdir().unwrap();
    let skills_path = tmp.path().to_str().unwrap();
    let conn = create_test_db();

    let result = resolve_orphan(&conn, "foo/bar", "delete", skills_path);
    assert!(result.is_err());
    assert!(
        result.unwrap_err().contains("Invalid skill name"),
        "slash in skill_name must be rejected"
    );
}

#[test]
fn test_resolve_orphan_delete_rejects_empty_name() {
    let tmp = tempfile::tempdir().unwrap();
    let skills_path = tmp.path().to_str().unwrap();
    let conn = create_test_db();

    let result = resolve_orphan(&conn, "", "delete", skills_path);
    assert!(result.is_err());
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
    crate::db::upsert_skill(&conn, name, "skill-builder", "domain").unwrap();
    crate::db::save_workflow_run(&conn, name, 0, "pending", "domain").unwrap();

    // Mark step 0 as in_progress (simulating a crash)
    crate::db::save_workflow_step(&conn, name, 0, "in_progress").unwrap();

    // Create workspace dir (scenario 5 guard)
    create_skill_dir(tmp.path(), name, "");

    let mut notifications = Vec::new();
    super::skill_builder::reconcile_skill_builder(
        &conn,
        name,
        DEFAULT_PLUGIN_SLUG,
        workspace,
        skills_path,
        &mut notifications,
    )
    .unwrap();

    // The stale in_progress step should be reset to pending
    let steps = crate::db::get_workflow_steps(&conn, name).unwrap();
    let step0 = steps.iter().find(|s| s.step_id == 0).unwrap();
    assert_eq!(
        step0.status, "pending",
        "stale in_progress step should be reset to pending"
    );
}

#[test]
fn test_reconcile_skill_builder_scenario_10_missing_workflow_run() {
    let tmp = tempfile::tempdir().unwrap();
    let skills_tmp = tempfile::tempdir().unwrap();
    let workspace = tmp.path().to_str().unwrap();
    let skills_path = skills_tmp.path().to_str().unwrap();
    let conn = create_test_db();
    let name = "sb-scenario10";

    // Create skill in master but NO workflow_runs row
    crate::db::upsert_skill(&conn, name, "skill-builder", "domain").unwrap();

    // Create workspace dir with step 0 output (clarifications.json)
    create_skill_dir(tmp.path(), name, "");
    create_step_output(tmp.path(), name, 0);

    let mut notifications = Vec::new();
    super::skill_builder::reconcile_skill_builder(
        &conn,
        name,
        DEFAULT_PLUGIN_SLUG,
        workspace,
        skills_path,
        &mut notifications,
    )
    .unwrap();

    // Should auto-create workflow_runs row
    let run = crate::db::get_workflow_run(&conn, name).unwrap();
    assert!(run.is_some(), "workflow_runs row should be auto-created");
    assert!(
        notifications.iter().any(|n| n.contains("recreated")),
        "should notify about recreation"
    );
}

#[test]
fn test_reconcile_skill_builder_recreates_missing_workspace_dir() {
    let tmp = tempfile::tempdir().unwrap();
    let skills_tmp = tempfile::tempdir().unwrap();
    let workspace = tmp.path().to_str().unwrap();
    let skills_path = skills_tmp.path().to_str().unwrap();
    let conn = create_test_db();
    let name = "sb-missing-ws";

    // Create skill + workflow_runs but do NOT create workspace dir
    crate::db::upsert_skill(&conn, name, "skill-builder", "domain").unwrap();
    crate::db::save_workflow_run(&conn, name, 0, "pending", "domain").unwrap();

    let mut notifications = Vec::new();
    super::skill_builder::reconcile_skill_builder(
        &conn,
        name,
        DEFAULT_PLUGIN_SLUG,
        workspace,
        skills_path,
        &mut notifications,
    )
    .unwrap();

    // The workspace dir should be recreated (scenario 5)
    // Steps 0-2 are DB-authoritative; no context/ subdir is created.
    let skill_dir = crate::skill_paths::workspace_skill_dir(tmp.path(), DEFAULT_PLUGIN_SLUG, name);
    assert!(skill_dir.exists(), "workspace dir should be recreated");
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

    let result = reconcile_on_startup(&conn, workspace, skills_path).unwrap();

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
    assert!(result.discovered_skills.is_empty());
}

#[test]
fn test_startup_normalization_moves_legacy_skills_and_workspace_dirs_to_default_plugin() {
    let tmp = tempfile::tempdir().unwrap();
    let workspace_root = tmp.path().join("workspace");
    let skills_root = tmp.path().join("skills");
    std::fs::create_dir_all(&workspace_root).unwrap();
    std::fs::create_dir_all(&skills_root).unwrap();

    let workspace = workspace_root.to_str().unwrap();
    let skills_path = skills_root.to_str().unwrap();
    let conn = create_test_db();

    crate::db::ensure_plugin(&conn, "skills", "skills", "synthetic", None, None, true).unwrap();
    crate::db::save_workflow_run(&conn, "analyzing-bookings", 3, "completed", "domain").unwrap();
    insert_stub_clarifications(&conn, "analyzing-bookings");
    insert_stub_decisions(&conn, "analyzing-bookings");

    let legacy_workspace = workspace_root
        .join("skills")
        .join("skills")
        .join("analyzing-bookings");
    let legacy_output = skills_root
        .join("skills")
        .join("skills")
        .join("analyzing-bookings");
    std::fs::create_dir_all(legacy_workspace.join("context")).unwrap();
    std::fs::create_dir_all(legacy_output.join("references")).unwrap();
    std::fs::write(legacy_output.join("SKILL.md"), "# migrated\n").unwrap();
    std::fs::write(legacy_output.join("references").join("notes.md"), "hello\n").unwrap();

    reconcile_on_startup(&conn, workspace, skills_path).unwrap();

    let canonical_workspace = workspace_root
        .join(DEFAULT_PLUGIN_SLUG)
        .join("skills")
        .join("analyzing-bookings");
    let canonical_output = skills_root
        .join(DEFAULT_PLUGIN_SLUG)
        .join("skills")
        .join("analyzing-bookings");

    assert!(canonical_workspace.exists());
    assert!(canonical_output.join("SKILL.md").exists());
    assert!(canonical_output
        .join("references")
        .join("notes.md")
        .exists());
    assert!(
        !legacy_workspace.exists(),
        "legacy workspace dir should be migrated"
    );
    assert!(
        !legacy_output.exists(),
        "legacy output dir should be migrated"
    );
}

#[test]
fn test_startup_normalization_prunes_empty_legacy_default_plugin_dirs() {
    let tmp = tempfile::tempdir().unwrap();
    let workspace_root = tmp.path().join("workspace");
    let skills_root = tmp.path().join("skills");
    std::fs::create_dir_all(&workspace_root).unwrap();
    std::fs::create_dir_all(&skills_root).unwrap();

    let workspace = workspace_root.to_str().unwrap();
    let skills_path = skills_root.to_str().unwrap();
    let conn = create_test_db();

    crate::db::ensure_plugin(&conn, "skills", "skills", "synthetic", None, None, true).unwrap();

    let legacy_plugin_root = skills_root.join("skills");
    std::fs::create_dir_all(legacy_plugin_root.join("hr-analytics")).unwrap();
    std::fs::create_dir_all(legacy_plugin_root.join(".claude-plugin")).unwrap();
    std::fs::write(
        legacy_plugin_root
            .join(".claude-plugin")
            .join("plugin.json"),
        "{}\n",
    )
    .unwrap();

    reconcile_on_startup(&conn, workspace, skills_path).unwrap();

    assert!(
        !legacy_plugin_root.exists(),
        "legacy default-plugin wrapper should be removed even when it only contains empty stray dirs"
    );
}

#[test]
fn test_startup_normalization_moves_workspace_legacy_dirs_with_agents_only_content() {
    let tmp = tempfile::tempdir().unwrap();
    let workspace_root = tmp.path().join("workspace");
    let skills_root = tmp.path().join("skills");
    std::fs::create_dir_all(&workspace_root).unwrap();
    std::fs::create_dir_all(&skills_root).unwrap();

    let workspace = workspace_root.to_str().unwrap();
    let skills_path = skills_root.to_str().unwrap();
    let conn = create_test_db();

    crate::db::ensure_plugin(
        &conn,
        "sample-plugin",
        "Sample Plugin",
        "local",
        None,
        None,
        false,
    )
    .unwrap();
    crate::db::upsert_skill(&conn, "hr-analytics", "skill-builder", "domain").unwrap();
    crate::db::upsert_skill_in_plugin(
        &conn,
        "pipeline-analysis",
        "skill-builder",
        "domain",
        "sample-plugin",
    )
    .unwrap();

    let default_legacy = workspace_root.join("skills").join("hr-analytics");
    let nested_legacy = workspace_root
        .join("skills")
        .join("skills")
        .join("hr-analytics");
    let plugin_legacy = workspace_root
        .join("sample-plugin")
        .join("pipeline-analysis");

    std::fs::create_dir_all(default_legacy.join(".agents").join("agents")).unwrap();
    std::fs::write(
        default_legacy
            .join(".agents")
            .join("agents")
            .join("agent.md"),
        "default legacy\n",
    )
    .unwrap();
    std::fs::create_dir_all(nested_legacy.join(".agents").join("skills")).unwrap();
    std::fs::write(
        nested_legacy
            .join(".agents")
            .join("skills")
            .join("skill.md"),
        "nested legacy\n",
    )
    .unwrap();
    std::fs::create_dir_all(plugin_legacy.join(".agents").join("agents")).unwrap();
    std::fs::write(
        plugin_legacy
            .join(".agents")
            .join("agents")
            .join("agent.md"),
        "plugin legacy\n",
    )
    .unwrap();

    reconcile_on_startup(&conn, workspace, skills_path).unwrap();

    let default_canonical = workspace_root
        .join(DEFAULT_PLUGIN_SLUG)
        .join("skills")
        .join("hr-analytics");
    let plugin_canonical = workspace_root
        .join("sample-plugin")
        .join("skills")
        .join("pipeline-analysis");

    assert!(
        default_canonical
            .join(".agents")
            .join("agents")
            .join("agent.md")
            .exists(),
        "default legacy workspace dir should move into canonical location"
    );
    assert!(
        default_canonical
            .join(".agents")
            .join("skills")
            .join("skill.md")
            .exists(),
        "nested legacy workspace dir should merge into canonical location"
    );
    assert!(
        plugin_canonical
            .join(".agents")
            .join("agents")
            .join("agent.md")
            .exists(),
        "plugin legacy workspace dir should move into canonical location"
    );
    assert!(!workspace_root.join("skills").exists());
    assert!(!workspace_root
        .join("sample-plugin")
        .join("pipeline-analysis")
        .exists());
}

// ── Phase 1f: Dedup tests ───────────────────────────────────────────────────

/// Simulates the state after a failed move + Phase 1c discovery:
/// - DB has TWO rows for the same skill (old plugin + new disk location row)
/// - Disk has SKILL.md only in the non-default plugin
/// - The non-default row has a completed workflow_run (as Phase 1c would have set it)
///
/// After reconciliation, exactly one active row should remain — the one matching disk.
#[test]
fn test_reconciliation_dedup_removes_stale_row() {
    let tmp = tempfile::tempdir().unwrap();
    let skills_tmp = tempfile::tempdir().unwrap();
    let workspace = tmp.path().to_str().unwrap();
    let skills_path = skills_tmp.path().to_str().unwrap();
    let skills_dir = skills_tmp.path();
    let conn = create_test_db();

    crate::db::ensure_default_plugin(&conn).unwrap();
    let (_, non_default_slug) =
        crate::db::create_plugin(&conn, "my-plugin", "local", None, None).unwrap();

    // Stale row in the default plugin (the old location before the move)
    crate::db::upsert_skill(&conn, "moved-skill", "skill-builder", "domain").unwrap();

    // Row in the non-default plugin (the new location, added by Phase 1c discovery)
    let nd_id = crate::db::upsert_skill_in_plugin(
        &conn,
        "moved-skill",
        "skill-builder",
        "domain",
        &non_default_slug,
    )
    .unwrap();

    // Phase 1c would have also created a completed workflow_run for the new row.
    // Insert it directly (mimicking Phase 1c) so Phase 2 sees the skill as completed
    // and skips the save_workflow_run path that would reset the skill to default.
    conn.execute(
        "INSERT INTO workflow_runs (skill_name, current_step, status, purpose, skill_id, updated_at)
         VALUES ('moved-skill', 3, 'completed', 'domain', ?1, datetime('now') || 'Z')
         ON CONFLICT(skill_name) DO UPDATE SET current_step=3, status='completed', skill_id=?1",
        rusqlite::params![nd_id],
    ).unwrap();

    // Disk: SKILL.md only in the non-default plugin location
    let skill_md_path =
        crate::skill_paths::resolve_skill_dir(skills_dir, &non_default_slug, "moved-skill")
            .join("SKILL.md");
    std::fs::create_dir_all(skill_md_path.parent().unwrap()).unwrap();
    std::fs::write(&skill_md_path, "---\ntitle: moved-skill\n---\n").unwrap();

    reconcile_on_startup(&conn, workspace, skills_path).unwrap();

    // Exactly one active row should remain
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM skills WHERE name = 'moved-skill' AND COALESCE(deleted_at, '') = ''",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count, 1, "exactly one active row must remain after dedup");

    // The surviving row must be in the non-default plugin
    let master =
        crate::db::get_skill_master_in_plugin(&conn, "moved-skill", &non_default_slug).unwrap();
    assert!(
        master.is_some(),
        "surviving row must be in the non-default plugin"
    );
}

/// When SKILL.md exists under both plugins (edge case), the non-default plugin
/// should be preferred (it's the intended destination).
#[test]
fn test_reconciliation_dedup_prefers_non_default_when_both_have_skill_md() {
    let tmp = tempfile::tempdir().unwrap();
    let skills_tmp = tempfile::tempdir().unwrap();
    let workspace = tmp.path().to_str().unwrap();
    let skills_path = skills_tmp.path().to_str().unwrap();
    let skills_dir = skills_tmp.path();
    let conn = create_test_db();

    crate::db::ensure_default_plugin(&conn).unwrap();
    let (_, non_default_slug) =
        crate::db::create_plugin(&conn, "preferred-plugin", "local", None, None).unwrap();

    // Two rows for the same skill
    crate::db::upsert_skill(&conn, "ambiguous-skill", "skill-builder", "domain").unwrap();
    let nd_id = crate::db::upsert_skill_in_plugin(
        &conn,
        "ambiguous-skill",
        "skill-builder",
        "domain",
        &non_default_slug,
    )
    .unwrap();

    // Completed workflow_run pointing at non-default row so Phase 2 skips it
    conn.execute(
        "INSERT INTO workflow_runs (skill_name, current_step, status, purpose, skill_id, updated_at)
         VALUES ('ambiguous-skill', 3, 'completed', 'domain', ?1, datetime('now') || 'Z')
         ON CONFLICT(skill_name) DO UPDATE SET current_step=3, status='completed', skill_id=?1",
        rusqlite::params![nd_id],
    ).unwrap();

    // Disk: SKILL.md in BOTH plugin locations
    for plugin in &[DEFAULT_PLUGIN_SLUG, non_default_slug.as_str()] {
        let skill_md = crate::skill_paths::resolve_skill_dir(skills_dir, plugin, "ambiguous-skill")
            .join("SKILL.md");
        std::fs::create_dir_all(skill_md.parent().unwrap()).unwrap();
        std::fs::write(&skill_md, "---\ntitle: ambiguous-skill\n---\n").unwrap();
    }

    reconcile_on_startup(&conn, workspace, skills_path).unwrap();

    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM skills WHERE name = 'ambiguous-skill' AND COALESCE(deleted_at, '') = ''",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count, 1, "exactly one active row must remain");

    // Non-default plugin must win the tie-break
    let master =
        crate::db::get_skill_master_in_plugin(&conn, "ambiguous-skill", &non_default_slug).unwrap();
    assert!(master.is_some(), "non-default plugin must win tie-break");
}

// --- VU-967: skill in DB under one plugin, also on disk under another plugin ---

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

    // First startup: should NOT add to discovered_skills or create a duplicate DB row
    let result = reconcile_on_startup(&conn, workspace, skills_path).unwrap();
    assert!(
        result.discovered_skills.is_empty(),
        "cross-plugin skill must not appear in discovered_skills: {:?}",
        result.discovered_skills
    );
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
    let result2 = reconcile_on_startup(&conn, workspace, skills_path).unwrap();
    assert!(
        result2.discovered_skills.is_empty(),
        "cross-plugin skill must not reappear on second startup: {:?}",
        result2.discovered_skills
    );
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
    reconcile_on_startup(&conn, workspace, skills_path).unwrap();

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
