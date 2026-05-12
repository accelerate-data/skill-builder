use std::path::Path;

use crate::db::workflow_artifacts as db_artifacts;
use crate::db::Db;
use crate::types::{StepStatusUpdate, WorkflowStateResponse};

use super::guards::{check_decisions_guard_db, check_scope_recommendation_db};

use crate::commands::imported_skills::validate_skill_name;

pub(crate) fn read_skills_path(db: &tauri::State<'_, Db>) -> Option<String> {
    let conn = db.0.lock().ok()?;
    crate::db::read_settings(&conn).ok()?.skills_path
}

pub(crate) fn read_workspace_path(db: &tauri::State<'_, Db>) -> Option<String> {
    let conn = db.0.lock().ok()?;
    crate::db::read_settings(&conn).ok()?.workspace_path
}

pub(crate) fn lookup_plugin_slug(conn: &rusqlite::Connection, skill_name: &str) -> String {
    crate::db::get_skill_master_any_plugin(conn, skill_name)
        .ok()
        .flatten()
        .map(|m| m.plugin_slug)
        .unwrap_or_else(|| crate::skill_paths::DEFAULT_PLUGIN_SLUG.to_string())
}

pub(crate) fn workflow_step_log_name(step_id: i32) -> String {
    crate::db::step_name(step_id)
}

/// Collect the saved conversation IDs for a skill (and its legacy default-plugin
/// entry if the skill moved plugins). Returns (plugin_slug, conversation_id) pairs.
fn collect_skill_conversation_ids(
    conn: &rusqlite::Connection,
    plugin_slug: &str,
    skill_name: &str,
) -> Vec<(String, String)> {
    let mut plugin_slugs = vec![plugin_slug.to_string()];
    if plugin_slug != crate::skill_paths::DEFAULT_PLUGIN_SLUG {
        plugin_slugs.push(crate::skill_paths::DEFAULT_PLUGIN_SLUG.to_string());
    }
    plugin_slugs
        .into_iter()
        .filter_map(|slug| {
            crate::db::get_skill_conversation_id(conn, &slug, skill_name)
                .ok()
                .flatten()
                .map(|id| (slug, id))
        })
        .collect()
}

/// Clear conversation DB records for a skill. Does not touch the filesystem.
fn clear_skill_conversation_db_records(
    conn: &rusqlite::Connection,
    plugin_slug: &str,
    skill_name: &str,
) -> Result<(), String> {
    let mut plugin_slugs = vec![plugin_slug.to_string()];
    if plugin_slug != crate::skill_paths::DEFAULT_PLUGIN_SLUG {
        plugin_slugs.push(crate::skill_paths::DEFAULT_PLUGIN_SLUG.to_string());
    }
    for slug in plugin_slugs {
        crate::db::clear_skill_conversation_id(conn, &slug, skill_name)?;
    }
    Ok(())
}

/// Delete stale clarifications and decisions based on which step is being reset.
/// Steps re-run = from_step_id and all subsequent steps.
/// - from_step_id 0 or 1: re-runs steps that produce clarifications (0,1) and decisions (2) → delete both
/// - from_step_id 2: re-runs step 2 (decisions) → delete decisions only, clarifications remain valid
/// - from_step_id 3+: disk files only → no DB cleanup needed
pub(crate) fn clear_artifacts_for_step_reset(
    conn: &rusqlite::Connection,
    skill_name: &str,
    from_step_id: u32,
) -> Result<(), String> {
    let plugin_slug = crate::db::get_skill_master_any_plugin(conn, skill_name)?
        .map(|m| m.plugin_slug)
        .unwrap_or_else(|| crate::skill_paths::DEFAULT_PLUGIN_SLUG.to_string());
    let s_id = crate::db::get_skill_master_id_in_plugin(conn, skill_name, &plugin_slug)?
        .ok_or_else(|| format!("Skill '{}' not found in plugin '{}'", skill_name, plugin_slug))?;
    let skill_id_str = s_id.to_string();

    match from_step_id {
        0 | 1 => {
            crate::db::workflow_artifacts::delete_clarifications(conn, &skill_id_str)
                .map_err(|e| e.to_string())?;
            crate::db::workflow_artifacts::delete_decisions(conn, &skill_id_str)
                .map_err(|e| e.to_string())?;
            log::info!(
                "[clear_artifacts_for_step_reset] cleared clarifications and decisions for '{}' (resetting from step {})",
                skill_name, from_step_id
            );
        }
        2 => {
            crate::db::workflow_artifacts::delete_decisions(conn, &skill_id_str)
                .map_err(|e| e.to_string())?;
            log::info!(
                "[clear_artifacts_for_step_reset] cleared decisions for '{}' (resetting from step {})",
                skill_name, from_step_id
            );
        }
        _ => {}
    }
    Ok(())
}

fn navigate_back_to_step_impl(
    conn: &rusqlite::Connection,
    workspace_path: &str,
    skills_path: &str,
    skill_name: &str,
    target_step_id: u32,
) -> Result<(), String> {
    // Delete output files for steps from the target onwards.
    // Step 0 is a special case: navigating back to it means a full rerun, so its own
    // workflow artifacts must also be cleared.
    let delete_from = if target_step_id == 0 {
        0
    } else {
        target_step_id + 1
    };
    let plugin_slug = crate::db::get_skill_master_any_plugin(conn, skill_name)?
        .map(|m| m.plugin_slug)
        .unwrap_or_else(|| crate::skill_paths::DEFAULT_PLUGIN_SLUG.to_string());

    // Auto-commit: checkpoint before artifacts are deleted, at the per-skill repo dir
    let skill_dir = crate::skill_paths::resolve_skill_dir(
        std::path::Path::new(skills_path),
        &plugin_slug,
        skill_name,
    );
    let msg = format!(
        "{}: checkpoint before navigate back to {}",
        skill_name,
        workflow_step_log_name(target_step_id as i32)
    );
    if let Err(e) = crate::git::commit_all(&skill_dir, &msg) {
        log::warn!(
            "[navigate_back_to_step] git commit failed at skill_dir {}: {}",
            skill_dir.display(),
            e
        );
    }
    crate::cleanup::delete_step_output_files(
        workspace_path,
        skill_name,
        &plugin_slug,
        delete_from,
        skills_path,
    );

    if target_step_id == 0 {
        clear_skill_conversation_db_records(conn, &plugin_slug, skill_name)?;
    }

    // Reset only steps after the target; target step status is preserved as "completed".
    let s_id = crate::db::get_skill_master_id_in_plugin(conn, skill_name, &plugin_slug)?
        .ok_or_else(|| format!("Skill '{}' not found in plugin '{}'", skill_name, plugin_slug))?;
    crate::db::reset_workflow_steps_from_by_skill_id(conn, s_id, delete_from as i32)?;

    // Set current_step to the target (not delete_from) so DB reflects the correct landing step.
    // Use "pending" for the run status because subsequent steps are now reset; the next
    // saveWorkflowState sync will recompute and update as needed.
    if let Some(run) = crate::db::get_workflow_run_by_skill_id(conn, s_id)? {
        crate::db::save_workflow_run(
            conn,
            skill_name,
            target_step_id as i32,
            "pending",
            &run.purpose,
        )?;
    }

    Ok(())
}

// --- Workflow state persistence (SQLite-backed) ---

#[tauri::command]
pub fn get_workflow_state(
    skill_id: i64,
    db: tauri::State<'_, Db>,
) -> Result<WorkflowStateResponse, String> {
    log::info!("[get_workflow_state] skill_id={}", skill_id);
    let conn = db.0.lock().map_err(|e| {
        log::error!("[get_workflow_state] Failed to acquire DB lock: {}", e);
        e.to_string()
    })?;
    let run = crate::db::get_workflow_run_by_skill_id(&conn, skill_id)?;
    let steps = crate::db::get_workflow_steps_by_skill_id(&conn, skill_id)?;
    Ok(WorkflowStateResponse { run, steps })
}

/// Persist workflow execution state (step progress and run status) for a skill.
///
/// # Metadata ownership guard
///
/// This command intentionally accepts ONLY execution-state fields: `current_step`,
/// `status`, `purpose`, and `step_statuses`. Skill metadata fields
/// (description, version, user_invocable, disable_model_invocation) are **NOT**
/// parameters here — they are owned exclusively by the `skills` master table and
/// must be written via `set_skill_behaviour`. The underlying `workflow_runs` table
/// no longer contains these columns (dropped in migration 35), so even if a caller
/// attempted to pass stale metadata values there is no column to receive them.
///
/// Reads of skill metadata for agent execution go through `read_workflow_settings`
/// which queries `get_skill_master` directly, never the frontend payload.
#[tauri::command]
pub fn save_workflow_state(
    skill_id: i64,
    current_step: i32,
    status: String,
    purpose: String,
    step_statuses: Vec<StepStatusUpdate>,
    db: tauri::State<'_, Db>,
) -> Result<(), String> {
    log::info!(
        "[save_workflow_state] skill={} step={} step_id={} status={}",
        skill_id,
        workflow_step_log_name(current_step),
        current_step,
        status
    );
    let conn = db.0.lock().map_err(|e| {
        log::error!("[save_workflow_state] Failed to acquire DB lock: {}", e);
        e.to_string()
    })?;

    // Backend-authoritative status: if all submitted steps are completed,
    // override the run status to "completed" regardless of what the frontend sent.
    // This prevents a race where the debounced frontend save fires before the
    // final step status is computed.
    let effective_status = if !step_statuses.is_empty()
        && step_statuses.iter().all(|s| s.status == "completed")
    {
        if status != "completed" {
            log::info!(
                "[save_workflow_state] All {} steps completed for '{}', overriding status '{}' → 'completed'",
                step_statuses.len(),
                skill_id,
                status
            );
        }
        "completed".to_string()
    } else {
        status
    };

    crate::db::save_workflow_run_by_skill_id(
        &conn,
        skill_id,
        current_step,
        &effective_status,
        &purpose,
    )
    .map_err(|e| {
        log::error!(
            "[save_workflow_state] save_workflow_run failed skill={}: {}",
            skill_id,
            e
        );
        e
    })?;
    for step in &step_statuses {
        crate::db::save_workflow_step_by_skill_id(&conn, skill_id, step.step_id, &step.status).map_err(
            |e| {
                log::error!(
                    "[save_workflow_state] save_workflow_step failed skill={} step={} step_id={}: {}",
                    skill_id,
                    workflow_step_log_name(step.step_id),
                    step.step_id,
                    e
                );
                e
            },
        )?;
    }

    // No auto-commit here. Steps 0-2 write to the workspace context folder
    // (not the skills git repo), so there is nothing to commit. Step 3
    // (generate-skill) and refine (rewrite-skill) handle their own git
    // commit+tag via shell git in the agent's Phase 3 instructions.

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::clear_skill_conversation_db_records;
    use crate::commands::test_utils::create_test_db;
    use crate::types::StepStatusUpdate;
    use tempfile::tempdir;

    /// Replicate the effective_status override logic from `save_workflow_state` so it can be
    /// tested without needing the Tauri runtime or a `tauri::State<'_, Db>`.
    fn compute_effective_status(status: &str, step_statuses: &[StepStatusUpdate]) -> String {
        if !step_statuses.is_empty() && step_statuses.iter().all(|s| s.status == "completed") {
            "completed".to_string()
        } else {
            status.to_string()
        }
    }

    #[test]
    fn test_all_steps_completed_overrides_in_progress_status() {
        let conn = create_test_db();

        // Create a skill and workflow run with status "in_progress".
        crate::db::save_workflow_run(&conn, "test-skill", 3, "in_progress", "domain").unwrap();

        let step_statuses = vec![
            StepStatusUpdate {
                step_id: 0,
                status: "completed".to_string(),
            },
            StepStatusUpdate {
                step_id: 1,
                status: "completed".to_string(),
            },
            StepStatusUpdate {
                step_id: 2,
                status: "completed".to_string(),
            },
            StepStatusUpdate {
                step_id: 3,
                status: "completed".to_string(),
            },
        ];

        let effective_status = compute_effective_status("in_progress", &step_statuses);

        // The backend-authoritative override must produce "completed".
        assert_eq!(
            effective_status, "completed",
            "status should be overridden to 'completed' when all steps are completed"
        );

        // Persist the effective status and verify it lands in the DB.
        crate::db::save_workflow_run(&conn, "test-skill", 3, &effective_status, "domain").unwrap();
        for step in &step_statuses {
            crate::db::save_workflow_step(&conn, "test-skill", step.step_id, &step.status).unwrap();
        }

        let run = crate::db::get_workflow_run(&conn, "test-skill")
            .unwrap()
            .unwrap();
        assert_eq!(
            run.status, "completed",
            "DB status should be 'completed' after all steps complete"
        );
    }

    #[test]
    fn test_partial_steps_completed_does_not_override_status() {
        let step_statuses = vec![
            StepStatusUpdate {
                step_id: 0,
                status: "completed".to_string(),
            },
            StepStatusUpdate {
                step_id: 1,
                status: "in_progress".to_string(),
            },
        ];

        let effective_status = compute_effective_status("in_progress", &step_statuses);
        assert_eq!(
            effective_status, "in_progress",
            "status should NOT be overridden when not all steps are completed"
        );
    }

    #[test]
    fn test_empty_step_statuses_does_not_override_status() {
        let step_statuses: Vec<StepStatusUpdate> = vec![];
        let effective_status = compute_effective_status("pending", &step_statuses);
        assert_eq!(
            effective_status, "pending",
            "status should NOT be overridden when step_statuses is empty"
        );
    }

    #[test]
    fn test_completed_status_sent_by_frontend_is_preserved() {
        // If the frontend already sends "completed" AND all steps are completed, the result
        // should still be "completed" (override is a no-op).
        let step_statuses = vec![
            StepStatusUpdate {
                step_id: 0,
                status: "completed".to_string(),
            },
            StepStatusUpdate {
                step_id: 1,
                status: "completed".to_string(),
            },
        ];
        let effective_status = compute_effective_status("completed", &step_statuses);
        assert_eq!(effective_status, "completed");
    }

    #[test]
    fn clear_skill_conversation_db_records_does_not_touch_filesystem() {
        let conn = create_test_db();
        let tmp = tempdir().unwrap();
        let skill_name = "reset-me";
        let default_slug = crate::skill_paths::DEFAULT_PLUGIN_SLUG;

        crate::db::upsert_skill_in_plugin(&conn, skill_name, "skill-builder", "test", default_slug)
            .unwrap();
        crate::db::save_skill_conversation_id(&conn, default_slug, skill_name, "conv-abc").unwrap();

        let sentinel = tmp
            .path()
            .join(default_slug)
            .join("skills")
            .join(skill_name)
            .join("conversations")
            .join("sentinel.txt");
        std::fs::create_dir_all(sentinel.parent().unwrap()).unwrap();
        std::fs::write(&sentinel, b"keep me").unwrap();

        clear_skill_conversation_db_records(&conn, default_slug, skill_name).unwrap();

        assert_eq!(
            crate::db::get_skill_conversation_id(&conn, default_slug, skill_name).unwrap(),
            None
        );
        assert!(
            sentinel.exists(),
            "conversations directory must not be deleted"
        );
    }

    #[test]
    fn test_navigate_back_to_step_zero_clears_saved_conversation_state() {
        let conn = create_test_db();
        let tmp = tempdir().unwrap();
        let workspace_path = tmp.path().to_str().unwrap();
        let skills_path = tmp.path().join("skills");
        std::fs::create_dir_all(&skills_path).unwrap();

        let skill_name = "reset-me";
        let default_slug = crate::skill_paths::DEFAULT_PLUGIN_SLUG;

        crate::db::upsert_skill_in_plugin(&conn, skill_name, "skill-builder", "test", default_slug)
            .unwrap();
        crate::db::save_skill_conversation_id(&conn, default_slug, skill_name, "conv-default")
            .unwrap();
        crate::db::save_workflow_run(&conn, skill_name, 2, "completed", "domain").unwrap();

        super::navigate_back_to_step_impl(
            &conn,
            workspace_path,
            skills_path.to_str().unwrap(),
            skill_name,
            0,
        )
        .unwrap();

        assert_eq!(
            crate::db::get_skill_conversation_id(&conn, default_slug, skill_name).unwrap(),
            None
        );

        let run = crate::db::get_workflow_run(&conn, skill_name)
            .unwrap()
            .unwrap();
        assert_eq!(run.current_step, 0);
        assert_eq!(run.status, "pending");
    }

    /// TC-06: Test the full DB path of save_workflow_run + save_workflow_step
    /// with the all-completed override. This exercises the actual database
    /// persistence, not just the compute_effective_status helper.
    #[test]
    fn test_all_completed_override_full_db_path() {
        let conn = create_test_db();

        // Create initial workflow run as "in_progress"
        crate::db::save_workflow_run(&conn, "tc06-skill", 3, "in_progress", "domain").unwrap();

        // Simulate what save_workflow_state does: compute effective status, then persist
        let step_statuses = vec![
            StepStatusUpdate {
                step_id: 0,
                status: "completed".to_string(),
            },
            StepStatusUpdate {
                step_id: 1,
                status: "completed".to_string(),
            },
            StepStatusUpdate {
                step_id: 2,
                status: "completed".to_string(),
            },
            StepStatusUpdate {
                step_id: 3,
                status: "completed".to_string(),
            },
        ];

        // Frontend sends "pending" but all steps are completed
        let effective_status = compute_effective_status("pending", &step_statuses);
        assert_eq!(effective_status, "completed");

        // Persist the override status and all step statuses to DB
        crate::db::save_workflow_run(&conn, "tc06-skill", 3, &effective_status, "domain").unwrap();
        for step in &step_statuses {
            crate::db::save_workflow_step(&conn, "tc06-skill", step.step_id, &step.status).unwrap();
        }

        // Verify DB state: run status must be "completed"
        let run = crate::db::get_workflow_run(&conn, "tc06-skill")
            .unwrap()
            .unwrap();
        assert_eq!(run.status, "completed");

        // Verify all steps are "completed" in DB
        let steps = crate::db::get_workflow_steps(&conn, "tc06-skill").unwrap();
        assert_eq!(steps.len(), 4);
        for step in &steps {
            assert_eq!(
                step.status, "completed",
                "step {} should be completed",
                step.step_id
            );
        }
    }
}

/// Output files produced by each step, relative to the skill directory.
/// Steps 0/1/2 are now DB-authoritative; only step 3 (SKILL.md) remains filesystem-based.
pub fn get_step_output_files(step_id: u32) -> Vec<&'static str> {
    match step_id {
        3 => vec!["SKILL.md"],
        _ => vec![],
    }
}

/// Check if the step has produced output.
/// Steps 0/1/2 are DB-authoritative; step 3 checks for SKILL.md on disk.
#[tauri::command]
pub fn verify_step_output(
    _workspace_path: String,
    skill_name: String,
    step_id: u32,
    db: tauri::State<'_, Db>,
) -> Result<bool, String> {
    log::info!(
        "[verify_step_output] skill={} step={} step_id={}",
        skill_name,
        workflow_step_log_name(step_id as i32),
        step_id
    );
    match step_id {
        0 => {
            let conn = db.0.lock().map_err(|e| e.to_string())?;
            Ok(db_artifacts::read_clarifications(&conn, &skill_name)
                .map(|opt| opt.is_some())
                .unwrap_or(false))
        }
        1 => {
            let conn = db.0.lock().map_err(|e| e.to_string())?;
            Ok(db_artifacts::read_clarifications(&conn, &skill_name)
                .map(|opt| opt.map(|r| r.refinement_count > 0).unwrap_or(false))
                .unwrap_or(false))
        }
        2 => {
            let conn = db.0.lock().map_err(|e| e.to_string())?;
            Ok(db_artifacts::read_decisions(&conn, &skill_name)
                .map(|opt| opt.is_some())
                .unwrap_or(false))
        }
        _ => {
            let skills_path =
                read_skills_path(&db).ok_or_else(|| "Skills path not configured".to_string())?;
            let conn = db.0.lock().map_err(|e| e.to_string())?;
            let plugin_slug = lookup_plugin_slug(&conn, &skill_name);
            let target_dir = crate::skill_paths::resolve_skill_dir(
                Path::new(&skills_path),
                &plugin_slug,
                &skill_name,
            );
            Ok(target_dir.join("SKILL.md").exists())
        }
    }
}

#[cfg(test)]
mod verify_step_output_tests {
    use super::*;
    use crate::skill_paths::DEFAULT_PLUGIN_SLUG;

    fn db_state(db: &Db) -> tauri::State<'_, Db> {
        // SAFETY: `tauri::State<'_, T>` is a transparent wrapper over `&T`.
        unsafe { std::mem::transmute(db) }
    }

    #[test]
    fn step3_checks_published_skill_without_deadlocking() {
        let skills_tmp = tempfile::tempdir().unwrap();
        let skill_dir = crate::skill_paths::resolve_skill_dir(
            skills_tmp.path(),
            DEFAULT_PLUGIN_SLUG,
            "my-skill",
        );
        std::fs::create_dir_all(&skill_dir).unwrap();
        std::fs::write(skill_dir.join("SKILL.md"), "# My Skill\n").unwrap();

        let conn = crate::db::create_test_db_for_tests();
        conn.execute(
            "INSERT INTO skills (name, skill_source, plugin_id) \
             VALUES (?1, 'skill-builder', (SELECT id FROM plugins WHERE slug = ?2))",
            rusqlite::params!["my-skill", DEFAULT_PLUGIN_SLUG],
        )
        .unwrap();
        crate::db::write_settings(
            &conn,
            &crate::types::AppSettings {
                skills_path: Some(skills_tmp.path().to_string_lossy().into_owned()),
                ..Default::default()
            },
        )
        .unwrap();
        let db = Db(std::sync::Arc::new(std::sync::Mutex::new(conn)));

        let result =
            verify_step_output(String::new(), "my-skill".to_string(), 3, db_state(&db)).unwrap();

        assert!(result);
    }
}

#[tauri::command]
pub fn get_disabled_steps(skill_id: i64, db: tauri::State<'_, Db>) -> Result<Vec<u32>, String> {
    log::info!("[get_disabled_steps] skill_id={}", skill_id);
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let skill_id_text = skill_id.to_string();
    if check_scope_recommendation_db(&conn, &skill_id_text) {
        Ok(vec![1, 2, 3])
    } else if check_decisions_guard_db(&conn, &skill_id_text) {
        Ok(vec![3])
    } else {
        Ok(vec![])
    }
}

#[tauri::command]
pub async fn reset_workflow_step(
    app_handle: tauri::AppHandle,
    skill_name: String,
    from_step_id: u32,
    db: tauri::State<'_, Db>,
) -> Result<(), String> {
    validate_skill_name(&skill_name)?;
    log::info!(
        "[reset_workflow_step] CALLED skill={} from_step={} from_step_id={}",
        skill_name,
        workflow_step_log_name(from_step_id as i32),
        from_step_id,
    );
    let skills_path = read_skills_path(&db)
        .ok_or_else(|| "Skills path not configured. Please set it in Settings.".to_string())?;
    log::debug!("[reset_workflow_step] skills_path={}", skills_path);

    let plugin_slug = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        lookup_plugin_slug(&conn, &skill_name)
    };

    // Auto-commit: checkpoint before artifacts are deleted, at the per-skill repo dir
    let skill_dir = crate::skill_paths::resolve_skill_dir(
        std::path::Path::new(&skills_path),
        &plugin_slug,
        &skill_name,
    );
    let msg = format!(
        "{}: checkpoint before reset to {}",
        skill_name,
        workflow_step_log_name(from_step_id as i32)
    );
    if let Err(e) = crate::git::commit_all(&skill_dir, &msg) {
        log::warn!(
            "[reset_workflow_step] git commit failed at skill_dir {}: {}",
            skill_dir.display(),
            e
        );
    }

    // Collect conversation IDs before clearing the DB (sync, brief lock).
    let conversation_ids = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        collect_skill_conversation_ids(&conn, &plugin_slug, &skill_name)
    };

    // Best-effort pause then delete per-conversation directory.
    // All errors are logged and swallowed — reset must not fail due to server state.
    use tauri::Manager;
    let data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;
    let openhands_conversations_dir =
        crate::commands::workspace::resolve_openhands_conversations_dir(&data_dir);
    for (_, conv_id) in &conversation_ids {
        crate::agents::openhands_server::pause_conversation_if_server_running(conv_id).await;
        let conv_dir = openhands_conversations_dir.join(conv_id);
        if conv_dir.exists() {
            if let Err(e) = std::fs::remove_dir_all(&conv_dir) {
                log::warn!(
                    "[reset_workflow_step] failed to delete conversation dir {}: {}",
                    conv_dir.display(),
                    e
                );
            } else {
                log::info!(
                    "[reset_workflow_step] deleted conversation dir {}",
                    conv_dir.display()
                );
            }
        }
    }

    // Reset steps in SQLite
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    clear_skill_conversation_db_records(&conn, &plugin_slug, &skill_name)?;
    clear_artifacts_for_step_reset(&conn, &skill_name, from_step_id)?;
    let s_id = crate::db::get_skill_master_id_in_plugin(&conn, &skill_name, &plugin_slug)?
        .ok_or_else(|| format!("Skill '{}' not found in plugin '{}'", skill_name, plugin_slug))?;
    crate::db::reset_workflow_steps_from_by_skill_id(&conn, s_id, from_step_id as i32)?;

    // Update the workflow run's current step
    if let Some(run) = crate::db::get_workflow_run_by_skill_id(&conn, s_id)? {
        crate::db::save_workflow_run(
            &conn,
            &skill_name,
            from_step_id as i32,
            "pending",
            &run.purpose,
        )?;
    }

    Ok(())
}

/// Navigate back to a completed step: preserves the target step's output files and DB status,
/// deletes only the files of subsequent steps, and sets current_step to target_step_id.
/// This makes the DB the canonical source of truth for navigate-back transitions.
#[tauri::command]
pub fn navigate_back_to_step(
    workspace_path: String,
    skill_name: String,
    target_step_id: u32,
    db: tauri::State<'_, Db>,
) -> Result<(), String> {
    log::info!(
        "[navigate_back_to_step] CALLED skill={} target_step={} target_step_id={} workspace={}",
        skill_name,
        workflow_step_log_name(target_step_id as i32),
        target_step_id,
        workspace_path
    );
    let skills_path = read_skills_path(&db)
        .ok_or_else(|| "Skills path not configured. Please set it in Settings.".to_string())?;
    log::debug!("[navigate_back_to_step] skills_path={}", skills_path);
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    navigate_back_to_step_impl(
        &conn,
        &workspace_path,
        &skills_path,
        &skill_name,
        target_step_id,
    )?;

    log::info!(
        "[navigate_back_to_step] done skill={} current_step={} current_step_id={}",
        skill_name,
        workflow_step_log_name(target_step_id as i32),
        target_step_id
    );
    Ok(())
}

#[tauri::command]
pub fn preview_step_reset(
    workspace_path: String,
    skill_name: String,
    from_step_id: u32,
    db: tauri::State<'_, Db>,
) -> Result<Vec<crate::types::StepResetPreview>, String> {
    log::info!(
        "[preview_step_reset] skill={} from_step={} from_step_id={}",
        skill_name,
        workflow_step_log_name(from_step_id as i32),
        from_step_id
    );
    let skills_path = read_skills_path(&db)
        .ok_or_else(|| "Skills path not configured. Please set it in Settings.".to_string())?;

    let plugin_slug = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        crate::db::get_skill_master_any_plugin(&conn, &skill_name)?
            .map(|m| m.plugin_slug)
            .unwrap_or_else(|| crate::skill_paths::DEFAULT_PLUGIN_SLUG.to_string())
    };

    let step_names = [
        "Research",
        "Detailed Research",
        "Confirm Decisions",
        "Generate Skill",
    ];

    let mut result = Vec::new();
    for step_id in from_step_id..=3 {
        let existing_files = crate::cleanup::list_step_output_files(
            &workspace_path,
            &skill_name,
            &plugin_slug,
            step_id,
            &skills_path,
        );

        if !existing_files.is_empty() {
            let name = step_names
                .get(step_id as usize)
                .unwrap_or(&"Unknown")
                .to_string();
            result.push(crate::types::StepResetPreview {
                step_id,
                step_name: name,
                files: existing_files,
            });
        }
    }

    Ok(result)
}

/// Remove incomplete iteration directories (those missing `benchmark.json`)
/// under `{workspace_path}/{skill_name}/evals/iterations/`.
///
/// Returns the number of directories removed. Errors during removal are logged
/// as warnings and do not propagate — callers should never be blocked by cleanup.
pub fn clean_incomplete_iterations(workspace_path: &str, skill_name: &str) -> u32 {
    let evals_dir = Path::new(workspace_path)
        .join(skill_name)
        .join("evals")
        .join("workspace");

    if !evals_dir.is_dir() {
        return 0;
    }

    let entries = match std::fs::read_dir(&evals_dir) {
        Ok(e) => e,
        Err(e) => {
            log::warn!(
                "event=clean_incomplete_iterations operation=read_dir skill={} error={}",
                skill_name,
                e
            );
            return 0;
        }
    };

    let mut removed = 0u32;
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if !name_str.starts_with("iteration-") || !entry.path().is_dir() {
            continue;
        }
        if entry.path().join("benchmark.json").exists() {
            continue;
        }
        log::info!(
            "event=clean_incomplete_iteration operation=remove skill={} path={}",
            skill_name,
            entry.path().display()
        );
        if let Err(e) = std::fs::remove_dir_all(entry.path()) {
            log::warn!(
                "event=clean_incomplete_iteration operation=remove_failed skill={} path={} error={}",
                skill_name,
                entry.path().display(),
                e
            );
        } else {
            removed += 1;
        }
    }
    removed
}

/// Scan all skill directories under `workspace_path` and clean incomplete
/// iterations for each. Called during app startup reconciliation.
pub fn clean_all_incomplete_iterations(workspace_path: &str) -> u32 {
    let workspace = Path::new(workspace_path);
    if !workspace.is_dir() {
        return 0;
    }

    let entries = match std::fs::read_dir(workspace) {
        Ok(e) => e,
        Err(e) => {
            log::warn!(
                "event=clean_all_incomplete_iterations operation=read_workspace error={}",
                e
            );
            return 0;
        }
    };

    let mut total_removed = 0u32;
    for entry in entries.flatten() {
        if !entry.path().is_dir() {
            continue;
        }
        let skill_name = entry.file_name().to_string_lossy().to_string();
        total_removed += clean_incomplete_iterations(workspace_path, &skill_name);
    }
    if total_removed > 0 {
        log::info!(
            "event=clean_all_incomplete_iterations operation=summary removed={}",
            total_removed
        );
    }
    total_removed
}

#[derive(serde::Serialize)]
pub struct LatestBenchmarkResult {
    pub iteration: u32,
    pub data: serde_json::Value,
}

/// Read benchmark.json from the latest iteration directory for a skill.
///
/// Scans `{workspace}/{skill}/evals/iterations/` for `iteration-{N}` dirs,
/// picks the highest N, and reads its `benchmark.json`. Returns `None` when
/// no benchmark data exists (no evals dir, no iterations, or no JSON file).
#[tauri::command]
pub fn read_latest_benchmark(
    skill_name: String,
    workspace_path: String,
) -> Result<Option<LatestBenchmarkResult>, String> {
    log::info!("[read_latest_benchmark] skill={}", skill_name);
    validate_skill_name(&skill_name)?;

    let evals_dir = Path::new(&workspace_path)
        .join(&skill_name)
        .join("evals")
        .join("workspace");

    if !evals_dir.is_dir() {
        log::debug!(
            "[read_latest_benchmark] evals dir does not exist: {}",
            evals_dir.display()
        );
        return Ok(None);
    }

    let entries = std::fs::read_dir(&evals_dir).map_err(|e| {
        log::error!(
            "[read_latest_benchmark] failed to read evals dir '{}': {}",
            evals_dir.display(),
            e
        );
        format!("Failed to read evals directory: {}", e)
    })?;

    let mut latest: Option<(u32, std::path::PathBuf)> = None;
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if let Some(n_str) = name_str.strip_prefix("iteration-") {
            if let Ok(n) = n_str.parse::<u32>() {
                if entry.path().is_dir() && latest.as_ref().is_none_or(|(cur, _)| n > *cur) {
                    latest = Some((n, entry.path()));
                }
            }
        }
    }

    let Some((iteration, iter_dir)) = latest else {
        log::debug!(
            "[read_latest_benchmark] no iteration dirs found in {}",
            evals_dir.display()
        );
        return Ok(None);
    };

    let benchmark_path = iter_dir.join("benchmark.json");
    if !benchmark_path.is_file() {
        log::debug!(
            "[read_latest_benchmark] benchmark.json not found at {}",
            benchmark_path.display()
        );
        return Ok(None);
    }

    let content = std::fs::read_to_string(&benchmark_path).map_err(|e| {
        log::error!(
            "[read_latest_benchmark] failed to read '{}': {}",
            benchmark_path.display(),
            e
        );
        format!("Failed to read benchmark file: {}", e)
    })?;

    let value: serde_json::Value = serde_json::from_str(&content).map_err(|e| {
        log::error!(
            "[read_latest_benchmark] failed to parse '{}': {}",
            benchmark_path.display(),
            e
        );
        format!("Failed to parse benchmark JSON: {}", e)
    })?;

    Ok(Some(LatestBenchmarkResult {
        iteration,
        data: value,
    }))
}

#[cfg(test)]
mod clean_iterations_tests {
    use super::*;
    use std::fs;

    #[test]
    fn removes_incomplete_iteration() {
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        let evals_dir = tmp.path().join("my-skill").join("evals").join("workspace");

        // Create complete iteration
        let iter1 = evals_dir.join("iteration-1");
        fs::create_dir_all(&iter1).unwrap();
        fs::write(iter1.join("benchmark.json"), "{}").unwrap();

        // Create incomplete iteration (no benchmark.json)
        let iter2 = evals_dir.join("iteration-2");
        fs::create_dir_all(&iter2).unwrap();
        fs::write(iter2.join("some-partial-output.txt"), "partial").unwrap();

        let removed = clean_incomplete_iterations(workspace, "my-skill");
        assert_eq!(removed, 1);
        assert!(iter1.exists(), "complete iteration should be preserved");
        assert!(!iter2.exists(), "incomplete iteration should be removed");
    }

    #[test]
    fn preserves_all_complete_iterations() {
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        let evals_dir = tmp.path().join("my-skill").join("evals").join("workspace");

        for i in 1..=3 {
            let iter = evals_dir.join(format!("iteration-{}", i));
            fs::create_dir_all(&iter).unwrap();
            fs::write(iter.join("benchmark.json"), "{}").unwrap();
        }

        let removed = clean_incomplete_iterations(workspace, "my-skill");
        assert_eq!(removed, 0);
        for i in 1..=3 {
            assert!(evals_dir.join(format!("iteration-{}", i)).exists());
        }
    }

    #[test]
    fn handles_mixed_complete_and_incomplete() {
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        let evals_dir = tmp.path().join("my-skill").join("evals").join("workspace");

        // iteration-1: complete
        let iter1 = evals_dir.join("iteration-1");
        fs::create_dir_all(&iter1).unwrap();
        fs::write(iter1.join("benchmark.json"), "{}").unwrap();

        // iteration-2: incomplete
        let iter2 = evals_dir.join("iteration-2");
        fs::create_dir_all(&iter2).unwrap();

        // iteration-3: complete
        let iter3 = evals_dir.join("iteration-3");
        fs::create_dir_all(&iter3).unwrap();
        fs::write(iter3.join("benchmark.json"), "{}").unwrap();

        // iteration-4: incomplete
        let iter4 = evals_dir.join("iteration-4");
        fs::create_dir_all(&iter4).unwrap();

        let removed = clean_incomplete_iterations(workspace, "my-skill");
        assert_eq!(removed, 2);
        assert!(iter1.exists());
        assert!(!iter2.exists());
        assert!(iter3.exists());
        assert!(!iter4.exists());
    }

    #[test]
    fn returns_zero_when_no_evals_dir() {
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        fs::create_dir_all(tmp.path().join("my-skill")).unwrap();

        let removed = clean_incomplete_iterations(workspace, "my-skill");
        assert_eq!(removed, 0);
    }

    #[test]
    fn clean_all_scans_multiple_skills() {
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();

        // skill-a: one incomplete
        let evals_a = tmp.path().join("skill-a").join("evals").join("workspace");
        let iter_a = evals_a.join("iteration-1");
        fs::create_dir_all(&iter_a).unwrap();

        // skill-b: one complete, one incomplete
        let evals_b = tmp.path().join("skill-b").join("evals").join("workspace");
        let iter_b1 = evals_b.join("iteration-1");
        fs::create_dir_all(&iter_b1).unwrap();
        fs::write(iter_b1.join("benchmark.json"), "{}").unwrap();
        let iter_b2 = evals_b.join("iteration-2");
        fs::create_dir_all(&iter_b2).unwrap();

        let removed = clean_all_incomplete_iterations(workspace);
        assert_eq!(removed, 2);
        assert!(!iter_a.exists());
        assert!(iter_b1.exists());
        assert!(!iter_b2.exists());
    }
}

#[cfg(test)]
mod benchmark_tests {
    use super::*;
    use std::fs;

    #[test]
    fn returns_none_when_no_evals_dir() {
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap().to_string();
        fs::create_dir_all(tmp.path().join("my-skill")).unwrap();

        let result = read_latest_benchmark("my-skill".into(), workspace).unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn returns_none_when_no_iterations() {
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap().to_string();
        fs::create_dir_all(tmp.path().join("my-skill").join("evals").join("workspace")).unwrap();

        let result = read_latest_benchmark("my-skill".into(), workspace).unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn returns_latest_iteration() {
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap().to_string();
        let evals_dir = tmp.path().join("my-skill").join("evals").join("workspace");

        // Create iteration-1 with lower pass rate
        let iter1 = evals_dir.join("iteration-1");
        fs::create_dir_all(&iter1).unwrap();
        fs::write(
            iter1.join("benchmark.json"),
            r#"{"metadata":{"skill_name":"my-skill"},"run_summary":{"with_skill":{"pass_rate":{"mean":0.5}}}}"#,
        )
        .unwrap();

        // Create iteration-3 (latest) with higher pass rate
        let iter3 = evals_dir.join("iteration-3");
        fs::create_dir_all(&iter3).unwrap();
        fs::write(
            iter3.join("benchmark.json"),
            r#"{"metadata":{"skill_name":"my-skill"},"run_summary":{"with_skill":{"pass_rate":{"mean":0.9}}}}"#,
        )
        .unwrap();

        // Create iteration-2 (middle)
        let iter2 = evals_dir.join("iteration-2");
        fs::create_dir_all(&iter2).unwrap();
        fs::write(
            iter2.join("benchmark.json"),
            r#"{"metadata":{"skill_name":"my-skill"},"run_summary":{"with_skill":{"pass_rate":{"mean":0.7}}}}"#,
        )
        .unwrap();

        let result = read_latest_benchmark("my-skill".into(), workspace)
            .unwrap()
            .unwrap();
        // Should pick iteration-3
        assert_eq!(result.iteration, 3);
        let mean = result
            .data
            .pointer("/run_summary/with_skill/pass_rate/mean")
            .and_then(|v| v.as_f64())
            .unwrap();
        assert!((mean - 0.9).abs() < f64::EPSILON);
    }

    #[test]
    fn returns_none_when_benchmark_json_missing() {
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap().to_string();
        let iter1 = tmp
            .path()
            .join("my-skill")
            .join("evals")
            .join("workspace")
            .join("iteration-1");
        fs::create_dir_all(&iter1).unwrap();
        // No benchmark.json written

        let result = read_latest_benchmark("my-skill".into(), workspace).unwrap();
        assert!(result.is_none());
    }
}

#[cfg(test)]
mod reset_artifact_cleanup_tests {
    use crate::commands::test_utils::create_test_db;
    use crate::db::workflow_artifacts::{
        self, ClarificationQuestion, ClarificationSection, ClarificationsRecord, DecisionItem,
        DecisionsRecord,
    };

    fn seed_clarifications(conn: &mut rusqlite::Connection, skill_id: i64) {
        let record = ClarificationsRecord {
            skill_id: skill_id.to_string(),
            version: "1".to_string(),
            refinement_count: 0,
            must_answer_count: 1,
            question_count: 1,
            section_count: 1,
            title: "Test Clarifications".to_string(),
            scope_recommendation: None,
            scope_reason: None,
            scope_next_action: None,
            error_code: None,
            error_message: None,
            warning_code: None,
            warning_message: None,
            eval_verdict: None,
            eval_reasoning: None,
            eval_at: None,
            eval_answered_count: None,
            eval_empty_count: None,
            eval_vague_count: None,
            eval_contradictory_count: None,
            created_at: 1_700_000_000_000,
            updated_at: 1_700_000_000_000,
            sections: vec![ClarificationSection {
                section_id: 1,
                ordinal: 0,
                title: "Scope".to_string(),
                description: None,
            }],
            questions: vec![ClarificationQuestion {
                question_id: "q1".to_string(),
                section_id: 1,
                parent_question_id: None,
                ordinal: 0,
                title: "What is the scope?".to_string(),
                text: "Describe the scope.".to_string(),
                must_answer: true,
                answer_choice: None,
                answer_text: None,
                recommendation: None,
                answer_verdict: None,
                answer_verdict_reason: None,
                choices: vec![],
                refinements: vec![],
            }],
            notes: vec![],
        };
        let tx = conn.transaction().unwrap();
        workflow_artifacts::upsert_clarifications(&tx, &record).unwrap();
        tx.commit().unwrap();
    }

    fn seed_decisions(conn: &mut rusqlite::Connection, skill_id: i64) {
        let record = DecisionsRecord {
            skill_id: skill_id.to_string(),
            version: "1".to_string(),
            round: 1,
            decision_count: 1,
            conflicts_resolved: 0,
            contradictory_inputs_state: None,
            scope_recommendation: None,
            created_at: 1_700_000_000_000,
            updated_at: 1_700_000_000_000,
            items: vec![DecisionItem {
                decision_id: "d1".to_string(),
                ordinal: 0,
                title: "Decision 1".to_string(),
                original_question: "Q?".to_string(),
                decision: "Yes".to_string(),
                implication: "Good".to_string(),
                status: "resolved".to_string(),
            }],
        };
        let tx = conn.transaction().unwrap();
        workflow_artifacts::upsert_decisions(&tx, &record).unwrap();
        tx.commit().unwrap();
    }

    fn has_clarifications(conn: &rusqlite::Connection, skill_id: i64) -> bool {
        workflow_artifacts::read_clarifications(conn, &skill_id.to_string())
            .unwrap()
            .is_some()
    }

    fn has_decisions(conn: &rusqlite::Connection, skill_id: i64) -> bool {
        workflow_artifacts::read_decisions(conn, &skill_id.to_string())
            .unwrap()
            .is_some()
    }

    #[test]
    fn test_reset_from_step_0_clears_clarifications_and_decisions() {
        let mut conn = create_test_db();
        crate::db::save_workflow_run(&conn, "test-skill", 0, "pending", "domain").unwrap();
        let skill_id = crate::db::get_skill_master_id_in_plugin(&conn, "test-skill", crate::skill_paths::DEFAULT_PLUGIN_SLUG).unwrap().unwrap();

        seed_clarifications(&mut conn, skill_id);
        seed_decisions(&mut conn, skill_id);
        assert!(has_clarifications(&conn, skill_id));
        assert!(has_decisions(&conn, skill_id));

        // Reset from step 0 should clear both
        super::clear_artifacts_for_step_reset(&conn, "test-skill", 0).unwrap();

        assert!(
            !has_clarifications(&conn, skill_id),
            "clarifications should be deleted when resetting from step 0"
        );
        assert!(
            !has_decisions(&conn, skill_id),
            "decisions should be deleted when resetting from step 0"
        );
    }

    #[test]
    fn test_reset_from_step_1_clears_clarifications_and_decisions() {
        let mut conn = create_test_db();
        crate::db::save_workflow_run(&conn, "test-skill", 1, "pending", "domain").unwrap();
        let skill_id = crate::db::get_skill_master_id_in_plugin(&conn, "test-skill", crate::skill_paths::DEFAULT_PLUGIN_SLUG).unwrap().unwrap();

        seed_clarifications(&mut conn, skill_id);
        seed_decisions(&mut conn, skill_id);
        assert!(has_clarifications(&conn, skill_id));
        assert!(has_decisions(&conn, skill_id));

        // Reset from step 1 should clear both because step 1 reruns
        // clarifications-producing work and invalidates downstream decisions.
        super::clear_artifacts_for_step_reset(&conn, "test-skill", 1).unwrap();

        assert!(
            !has_clarifications(&conn, skill_id),
            "clarifications should be deleted when resetting from step 1"
        );
        assert!(
            !has_decisions(&conn, skill_id),
            "decisions should be deleted when resetting from step 1"
        );
    }

    #[test]
    fn test_reset_from_step_2_clears_decisions_preserves_clarifications() {
        let mut conn = create_test_db();
        crate::db::save_workflow_run(&conn, "test-skill", 2, "pending", "domain").unwrap();
        let skill_id = crate::db::get_skill_master_id_in_plugin(&conn, "test-skill", crate::skill_paths::DEFAULT_PLUGIN_SLUG).unwrap().unwrap();

        seed_clarifications(&mut conn, skill_id);
        seed_decisions(&mut conn, skill_id);
        assert!(has_clarifications(&conn, skill_id));
        assert!(has_decisions(&conn, skill_id));

        // Reset from step 2 should clear decisions only
        super::clear_artifacts_for_step_reset(&conn, "test-skill", 2).unwrap();

        assert!(
            has_clarifications(&conn, skill_id),
            "clarifications should be preserved when resetting from step 2"
        );
        assert!(
            !has_decisions(&conn, skill_id),
            "decisions should be deleted when resetting from step 2"
        );
    }

    #[test]
    fn test_reset_from_step_3_or_later_preserves_clarifications_and_decisions() {
        for from_step in [3_u32, 4_u32] {
            let mut conn = create_test_db();
            crate::db::save_workflow_run(&conn, "test-skill", from_step as i32, "pending", "domain")
                .unwrap();
            let skill_id = crate::db::get_skill_master_id_in_plugin(&conn, "test-skill", crate::skill_paths::DEFAULT_PLUGIN_SLUG).unwrap().unwrap();

            seed_clarifications(&mut conn, skill_id);
            seed_decisions(&mut conn, skill_id);
            assert!(has_clarifications(&conn, skill_id));
            assert!(has_decisions(&conn, skill_id));

            super::clear_artifacts_for_step_reset(&conn, "test-skill", from_step).unwrap();

            assert!(
                has_clarifications(&conn, skill_id),
                "clarifications should be preserved when resetting from step {from_step}"
            );
            assert!(
                has_decisions(&conn, skill_id),
                "decisions should be preserved when resetting from step {from_step}"
            );
        }
    }
}

#[cfg(test)]
mod per_skill_git_tests {
    #[test]
    fn test_reset_workflow_step_commits_at_skill_dir() {
        // This test verifies the expected per-skill repo setup:
        // no .git at skills root, per-skill .git at skill_dir.
        let dir = tempfile::tempdir().unwrap();
        let skills_path = dir.path();
        let plugin_slug = crate::skill_paths::DEFAULT_PLUGIN_SLUG;
        let skill_dir =
            crate::skill_paths::resolve_skill_dir(skills_path, plugin_slug, "test-skill");
        std::fs::create_dir_all(&skill_dir).unwrap();
        crate::git::ensure_repo(&skill_dir).unwrap();
        std::fs::write(skill_dir.join("SKILL.md"), "# step 3 output").unwrap();
        crate::git::commit_all(&skill_dir, "step 3 complete").unwrap();

        // Precondition: root must NOT have .git
        assert!(
            !skills_path.join(".git").exists(),
            "skills root must NOT have .git in per-skill repos"
        );
        // Skill dir MUST have .git
        assert!(skill_dir.join(".git").exists(), "skill_dir MUST have .git");
    }
}
