use std::path::Path;

use crate::db::Db;
use crate::types::{StepStatusUpdate, WorkflowStateResponse};

use super::guards::{parse_decisions_guard, parse_scope_recommendation};
use super::step_config::validate_clarifications_json;

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

pub(crate) fn workspace_context_dir(workspace_path: &str, plugin_slug: &str, skill_name: &str) -> std::path::PathBuf {
    crate::skill_paths::workspace_skill_dir(Path::new(workspace_path), plugin_slug, skill_name)
        .join("context")
}

pub(crate) fn workflow_step_log_name(step_id: i32) -> String {
    crate::db::step_name(step_id)
}

// --- Workflow state persistence (SQLite-backed) ---

#[tauri::command]
pub fn get_workflow_state(
    skill_name: String,
    db: tauri::State<'_, Db>,
) -> Result<WorkflowStateResponse, String> {
    log::info!("[get_workflow_state] skill={}", skill_name);
    let conn = db.0.lock().map_err(|e| {
        log::error!("[get_workflow_state] Failed to acquire DB lock: {}", e);
        e.to_string()
    })?;
    let run = crate::db::get_workflow_run(&conn, &skill_name)?;
    let steps = crate::db::get_workflow_steps(&conn, &skill_name)?;
    Ok(WorkflowStateResponse { run, steps })
}

/// Persist workflow execution state (step progress and run status) for a skill.
///
/// # Metadata ownership guard
///
/// This command intentionally accepts ONLY execution-state fields: `current_step`,
/// `status`, `purpose`, and `step_statuses`. Skill metadata fields
/// (description, version, model, argument_hint, user_invocable,
/// disable_model_invocation) are **NOT** parameters here — they are owned
/// exclusively by the `skills` master table and must be written via
/// `set_skill_behaviour`. The underlying `workflow_runs` table no longer
/// contains these columns (dropped in migration 35), so even if a caller
/// attempted to pass stale metadata values there is no column to receive them.
///
/// Reads of skill metadata for agent execution go through `read_workflow_settings`
/// which queries `get_skill_master` directly, never the frontend payload.
#[tauri::command]
pub fn save_workflow_state(
    skill_name: String,
    current_step: i32,
    status: String,
    purpose: String,
    step_statuses: Vec<StepStatusUpdate>,
    db: tauri::State<'_, Db>,
) -> Result<(), String> {
    log::info!(
        "[save_workflow_state] skill={} step={} step_id={} status={}",
        skill_name,
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
                skill_name,
                status
            );
        }
        "completed".to_string()
    } else {
        status
    };

    crate::db::save_workflow_run(
        &conn,
        &skill_name,
        current_step,
        &effective_status,
        &purpose,
    )
    .map_err(|e| {
        log::error!(
            "[save_workflow_state] save_workflow_run failed skill={}: {}",
            skill_name,
            e
        );
        e
    })?;
    for step in &step_statuses {
        crate::db::save_workflow_step(&conn, &skill_name, step.step_id, &step.status).map_err(
            |e| {
                log::error!(
                    "[save_workflow_state] save_workflow_step failed skill={} step={} step_id={}: {}",
                    skill_name,
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
    use crate::commands::test_utils::create_test_db;
    use crate::types::StepStatusUpdate;

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
            StepStatusUpdate { step_id: 0, status: "completed".to_string() },
            StepStatusUpdate { step_id: 1, status: "completed".to_string() },
            StepStatusUpdate { step_id: 2, status: "completed".to_string() },
            StepStatusUpdate { step_id: 3, status: "completed".to_string() },
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

        let run = crate::db::get_workflow_run(&conn, "test-skill").unwrap().unwrap();
        assert_eq!(
            run.status, "completed",
            "DB status should be 'completed' after all steps complete"
        );
    }

    #[test]
    fn test_partial_steps_completed_does_not_override_status() {
        let step_statuses = vec![
            StepStatusUpdate { step_id: 0, status: "completed".to_string() },
            StepStatusUpdate { step_id: 1, status: "in_progress".to_string() },
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
            StepStatusUpdate { step_id: 0, status: "completed".to_string() },
            StepStatusUpdate { step_id: 1, status: "completed".to_string() },
        ];
        let effective_status = compute_effective_status("completed", &step_statuses);
        assert_eq!(effective_status, "completed");
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
            StepStatusUpdate { step_id: 0, status: "completed".to_string() },
            StepStatusUpdate { step_id: 1, status: "completed".to_string() },
            StepStatusUpdate { step_id: 2, status: "completed".to_string() },
            StepStatusUpdate { step_id: 3, status: "completed".to_string() },
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
        let run = crate::db::get_workflow_run(&conn, "tc06-skill").unwrap().unwrap();
        assert_eq!(run.status, "completed");

        // Verify all steps are "completed" in DB
        let steps = crate::db::get_workflow_steps(&conn, "tc06-skill").unwrap();
        assert_eq!(steps.len(), 4);
        for step in &steps {
            assert_eq!(step.status, "completed", "step {} should be completed", step.step_id);
        }
    }

}

/// Output files produced by each step, relative to the skill directory.
pub fn get_step_output_files(step_id: u32) -> Vec<&'static str> {
    match step_id {
        0 => vec!["context/clarifications.json"],
        1 => vec![], // Step 1 edits clarifications.json in-place (no unique artifact)
        2 => vec!["context/decisions.json"],
        3 => vec!["SKILL.md"], // Also has references/ dir; path is relative to skill output dir
        _ => vec![],
    }
}

/// Check if at least one expected output file exists for a completed step.
/// Returns `true` if the step produced output, `false` if no files were written.
/// Step 1 (Detailed Research) always returns `true` because it edits
/// clarifications.json in-place and has no unique output file to check.
#[tauri::command]
pub fn verify_step_output(
    workspace_path: String,
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
    let files = get_step_output_files(step_id);
    // Steps with no expected output files are always valid
    if files.is_empty() {
        return Ok(true);
    }

    let skills_path = read_skills_path(&db)
        .ok_or_else(|| "Skills path not configured. Please set it in Settings.".to_string())?;

    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let plugin_slug = lookup_plugin_slug(&conn, &skill_name);
    drop(conn);
    let target_dir = if step_id == 3 {
        crate::skill_paths::resolve_skill_dir(Path::new(&skills_path), &plugin_slug, &skill_name)
    } else {
        crate::skill_paths::workspace_skill_dir(Path::new(&workspace_path), &plugin_slug, &skill_name)
    };
    let has_output = if step_id == 3 {
        target_dir.join("SKILL.md").exists()
    } else {
        files.iter().any(|f| target_dir.join(f).exists())
    };

    Ok(has_output)
}

#[tauri::command]
pub fn get_disabled_steps(
    skill_name: String,
    db: tauri::State<'_, Db>,
) -> Result<Vec<u32>, String> {
    validate_skill_name(&skill_name)?;
    log::info!("[get_disabled_steps] skill={}", skill_name);
    let workspace_path =
        read_workspace_path(&db).ok_or_else(|| "Workspace path not configured".to_string())?;
    let plugin_slug = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        lookup_plugin_slug(&conn, &skill_name)
    };
    let context_dir = workspace_context_dir(&workspace_path, &plugin_slug, &skill_name);
    let clarifications_path = context_dir.join("clarifications.json");
    let decisions_path = context_dir.join("decisions.json");

    if parse_scope_recommendation(&clarifications_path) {
        Ok(vec![1, 2, 3])
    } else if parse_decisions_guard(&decisions_path) {
        Ok(vec![3])
    } else {
        Ok(vec![])
    }
}

#[tauri::command]
pub fn get_clarifications_content(
    skill_name: String,
    workspace_path: String,
    db: tauri::State<'_, Db>,
) -> Result<String, String> {
    validate_skill_name(&skill_name)?;
    let plugin_slug = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        lookup_plugin_slug(&conn, &skill_name)
    };
    let path = workspace_context_dir(&workspace_path, &plugin_slug, &skill_name).join("clarifications.json");
    std::fs::read_to_string(&path).map_err(|e| {
        format!(
            "Failed to read clarifications from '{}': {}",
            path.display(),
            e
        )
    })
}

pub(crate) fn save_clarifications_content_inner(
    skill_name: &str,
    workspace_path: &str,
    content: String,
    plugin_slug: &str,
) -> Result<(), String> {
    validate_skill_name(skill_name)?;
    let parsed: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("Invalid clarifications JSON: {}", e))?;
    validate_clarifications_json(&parsed)
        .map_err(|e| format!("Invalid clarifications JSON: {}", e))?;
    let path = workspace_context_dir(workspace_path, plugin_slug, skill_name).join("clarifications.json");
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| {
            format!(
                "Failed to create context directory '{}': {}",
                parent.display(),
                e
            )
        })?;
    }
    std::fs::write(
        &path,
        serde_json::to_string_pretty(&parsed).unwrap_or(content),
    )
    .map_err(|e| {
        format!(
            "Failed to write clarifications to '{}': {}",
            path.display(),
            e
        )
    })
}

#[tauri::command]
pub fn save_clarifications_content(
    skill_name: String,
    workspace_path: String,
    content: String,
    db: tauri::State<'_, Db>,
) -> Result<(), String> {
    let plugin_slug = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        lookup_plugin_slug(&conn, &skill_name)
    };
    save_clarifications_content_inner(&skill_name, &workspace_path, content, &plugin_slug)
}

#[tauri::command]
pub fn get_decisions_content(
    skill_name: String,
    workspace_path: String,
    db: tauri::State<'_, Db>,
) -> Result<String, String> {
    validate_skill_name(&skill_name)?;
    let plugin_slug = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        lookup_plugin_slug(&conn, &skill_name)
    };
    let path = workspace_context_dir(&workspace_path, &plugin_slug, &skill_name).join("decisions.json");
    std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read decisions from '{}': {}", path.display(), e))
}

#[tauri::command]
pub fn save_decisions_content(
    skill_name: String,
    workspace_path: String,
    content: String,
    db: tauri::State<'_, Db>,
) -> Result<(), String> {
    validate_skill_name(&skill_name)?;
    if content.trim().is_empty() {
        return Err("decisions.json content cannot be empty".to_string());
    }
    let plugin_slug = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        lookup_plugin_slug(&conn, &skill_name)
    };
    let path = workspace_context_dir(&workspace_path, &plugin_slug, &skill_name).join("decisions.json");
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| {
            format!(
                "Failed to create context directory '{}': {}",
                parent.display(),
                e
            )
        })?;
    }
    std::fs::write(&path, content)
        .map_err(|e| format!("Failed to write decisions to '{}': {}", path.display(), e))
}

#[tauri::command]
pub fn get_context_file_content(
    skill_name: String,
    workspace_path: String,
    file_name: String,
    db: tauri::State<'_, Db>,
) -> Result<String, String> {
    validate_skill_name(&skill_name)?;
    if file_name.contains('/') || file_name.contains('\\') || file_name.contains("..") {
        return Err("Invalid context file name".to_string());
    }
    let plugin_slug = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        lookup_plugin_slug(&conn, &skill_name)
    };
    let path = workspace_context_dir(&workspace_path, &plugin_slug, &skill_name).join(file_name);
    std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read context file '{}': {}", path.display(), e))
}

#[tauri::command]
pub fn reset_workflow_step(
    workspace_path: String,
    skill_name: String,
    from_step_id: u32,
    db: tauri::State<'_, Db>,
) -> Result<(), String> {
    validate_skill_name(&skill_name)?;
    log::info!(
        "[reset_workflow_step] CALLED skill={} from_step={} from_step_id={} workspace={}",
        skill_name,
        workflow_step_log_name(from_step_id as i32),
        from_step_id,
        workspace_path
    );
    let skills_path = read_skills_path(&db)
        .ok_or_else(|| "Skills path not configured. Please set it in Settings.".to_string())?;
    log::debug!("[reset_workflow_step] skills_path={}", skills_path);

    // Auto-commit: checkpoint before artifacts are deleted
    let msg = format!(
        "{}: checkpoint before reset to {}",
        skill_name,
        workflow_step_log_name(from_step_id as i32)
    );
    if let Err(e) = crate::git::commit_all(std::path::Path::new(&skills_path), &msg) {
        log::warn!("Git auto-commit failed ({}): {}", msg, e);
    }

    let plugin_slug = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        crate::db::get_skill_master_any_plugin(&conn, &skill_name)?
            .map(|m| m.plugin_slug)
            .unwrap_or_else(|| crate::skill_paths::DEFAULT_PLUGIN_SLUG.to_string())
    };
    crate::cleanup::delete_step_output_files(
        &workspace_path,
        &skill_name,
        &plugin_slug,
        from_step_id,
        &skills_path,
    );

    // If the skill is in a non-default plugin, remove the entire workspace skill dir.
    // save_workflow_run (below) moves the DB record back to the default plugin, so the
    // old workspace dir at {workspace_path}/{plugin_slug}/{skill_name}/ would become an
    // orphan. Remove it now while we still know its path.
    if plugin_slug != crate::skill_paths::DEFAULT_PLUGIN_SLUG {
        let old_workspace_dir = crate::skill_paths::workspace_skill_dir(
            std::path::Path::new(&workspace_path),
            &plugin_slug,
            &skill_name,
        );
        if old_workspace_dir.exists() {
            if let Err(e) = std::fs::remove_dir_all(&old_workspace_dir) {
                log::warn!(
                    "[reset_workflow_step] failed to remove old workspace dir {}: {}",
                    old_workspace_dir.display(),
                    e
                );
            } else {
                log::info!(
                    "[reset_workflow_step] removed old workspace dir {} (skill moving to default plugin)",
                    old_workspace_dir.display()
                );
            }
        }
    }

    // Reset steps in SQLite
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    crate::db::reset_workflow_steps_from(&conn, &skill_name, from_step_id as i32)?;

    // Update the workflow run's current step
    if let Some(run) = crate::db::get_workflow_run(&conn, &skill_name)? {
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

    // Auto-commit: checkpoint before artifacts are deleted
    let msg = format!(
        "{}: checkpoint before navigate back to {}",
        skill_name,
        workflow_step_log_name(target_step_id as i32)
    );
    if let Err(e) = crate::git::commit_all(std::path::Path::new(&skills_path), &msg) {
        log::warn!("Git auto-commit failed ({}): {}", msg, e);
    }

    // Delete output files for steps from the target onwards.
    // Step 0 is a special case: navigating back to it means a full rerun, so its own
    // artifacts (clarifications.json, answer-evaluation.json) must also be cleared.
    let delete_from = if target_step_id == 0 { 0 } else { target_step_id + 1 };
    let plugin_slug = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        crate::db::get_skill_master_any_plugin(&conn, &skill_name)?
            .map(|m| m.plugin_slug)
            .unwrap_or_else(|| crate::skill_paths::DEFAULT_PLUGIN_SLUG.to_string())
    };
    crate::cleanup::delete_step_output_files(
        &workspace_path,
        &skill_name,
        &plugin_slug,
        delete_from,
        &skills_path,
    );

    let conn = db.0.lock().map_err(|e| e.to_string())?;

    // Reset only steps after the target; target step status is preserved as "completed".
    crate::db::reset_workflow_steps_from(&conn, &skill_name, delete_from as i32)?;

    // Set current_step to the target (not delete_from) so DB reflects the correct landing step.
    // Use "pending" for the run status because subsequent steps are now reset; the next
    // saveWorkflowState sync will recompute and update as needed.
    if let Some(run) = crate::db::get_workflow_run(&conn, &skill_name)? {
        crate::db::save_workflow_run(
            &conn,
            &skill_name,
            target_step_id as i32,
            "pending",
            &run.purpose,
        )?;
    }

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
        let existing_files =
            crate::cleanup::list_step_output_files(&workspace_path, &skill_name, &plugin_slug, step_id, &skills_path);

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
                if entry.path().is_dir()
                    && latest.as_ref().is_none_or(|(cur, _)| n > *cur)
                {
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
        fs::create_dir_all(
            tmp.path()
                .join("my-skill")
                .join("evals")
                .join("workspace"),
        )
        .unwrap();

        let result = read_latest_benchmark("my-skill".into(), workspace).unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn returns_latest_iteration() {
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap().to_string();
        let evals_dir = tmp
            .path()
            .join("my-skill")
            .join("evals")
            .join("workspace");

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
