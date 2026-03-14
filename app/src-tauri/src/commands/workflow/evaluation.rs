use std::path::Path;

use crate::db::Db;
use crate::types::{StepStatusUpdate, WorkflowStateResponse};

use super::runtime::{parse_decisions_guard, parse_scope_recommendation};
use super::step_config::validate_clarifications_json;

pub(crate) fn read_skills_path(db: &tauri::State<'_, Db>) -> Option<String> {
    let conn = db.0.lock().ok()?;
    crate::db::read_settings(&conn).ok()?.skills_path
}

pub(crate) fn read_workspace_path(db: &tauri::State<'_, Db>) -> Option<String> {
    let conn = db.0.lock().ok()?;
    crate::db::read_settings(&conn).ok()?.workspace_path
}

/// Reject skill names that could escape the parent directory.
/// Accepts only simple names: no path separators, no `..`, no null bytes, no leading `.`.
pub(crate) fn validate_skill_name(skill_name: &str) -> Result<(), String> {
    if skill_name.is_empty() {
        return Err("Skill name cannot be empty".to_string());
    }
    if skill_name.contains('/')
        || skill_name.contains('\\')
        || skill_name.contains("..")
        || skill_name.contains('\0')
        || skill_name.starts_with('.')
    {
        return Err(format!(
            "Invalid skill name '{}': must not contain path separators, '..', null bytes, or start with '.'",
            skill_name
        ));
    }
    Ok(())
}

pub(crate) fn workspace_context_dir(workspace_path: &str, skill_name: &str) -> std::path::PathBuf {
    Path::new(workspace_path).join(skill_name).join("context")
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

    // Auto-commit when a step is completed.
    // Called on every debounced save (~300ms) but commit_all is a no-op when
    // nothing changed on disk, so redundant calls are cheap.
    let has_completed_step = step_statuses.iter().any(|s| s.status == "completed");
    if has_completed_step {
        log::info!(
            "[save_workflow_state] Step completed for '{}', checking git auto-commit",
            skill_name
        );
        match crate::db::read_settings(&conn) {
            Ok(settings) => {
                let Some(skills_path) = settings.skills_path else {
                    log::warn!(
                        "[save_workflow_state] skills_path not configured — skipping git auto-commit for '{}'",
                        skill_name
                    );
                    return Ok(());
                };
                let completed_steps: Vec<i32> = step_statuses
                    .iter()
                    .filter(|s| s.status == "completed")
                    .map(|s| s.step_id)
                    .collect();
                let msg = format!(
                    "{}: {} completed",
                    skill_name,
                    completed_steps
                        .iter()
                        .map(|id| workflow_step_log_name(*id))
                        .collect::<Vec<_>>()
                        .join(", ")
                );
                if let Err(e) = crate::git::commit_all(std::path::Path::new(&skills_path), &msg) {
                    log::warn!("Git auto-commit failed ({}): {}", msg, e);
                }
            }
            Err(e) => {
                log::warn!(
                    "[save_workflow_state] Failed to read settings — skipping git auto-commit: {}",
                    e
                );
            }
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
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

    // --- validate_skill_name tests (TC-01 regression coverage) ---

    #[test]
    fn test_validate_skill_name_accepts_simple_name() {
        assert!(validate_skill_name("my-skill").is_ok());
        assert!(validate_skill_name("skill_v2").is_ok());
        assert!(validate_skill_name("HR Analytics").is_ok());
    }

    #[test]
    fn test_validate_skill_name_rejects_empty() {
        assert!(validate_skill_name("").is_err());
    }

    #[test]
    fn test_validate_skill_name_rejects_traversal() {
        assert!(validate_skill_name("../../etc").is_err());
        assert!(validate_skill_name("..").is_err());
        assert!(validate_skill_name("foo/../bar").is_err());
    }

    #[test]
    fn test_validate_skill_name_rejects_path_separators() {
        assert!(validate_skill_name("foo/bar").is_err());
        assert!(validate_skill_name("foo\\bar").is_err());
    }

    #[test]
    fn test_validate_skill_name_rejects_null_byte() {
        assert!(validate_skill_name("skill\0name").is_err());
    }

    #[test]
    fn test_validate_skill_name_rejects_leading_dot() {
        assert!(validate_skill_name(".hidden").is_err());
        assert!(validate_skill_name(".").is_err());
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

    let target_dir = if step_id == 3 {
        Path::new(&skills_path).join(&skill_name)
    } else {
        Path::new(&workspace_path).join(&skill_name)
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
    let context_dir = Path::new(&workspace_path).join(&skill_name).join("context");
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
) -> Result<String, String> {
    validate_skill_name(&skill_name)?;
    let path = workspace_context_dir(&workspace_path, &skill_name).join("clarifications.json");
    std::fs::read_to_string(&path).map_err(|e| {
        format!(
            "Failed to read clarifications from '{}': {}",
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
) -> Result<(), String> {
    validate_skill_name(&skill_name)?;
    let parsed: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("Invalid clarifications JSON: {}", e))?;
    validate_clarifications_json(&parsed)
        .map_err(|e| format!("Invalid clarifications JSON: {}", e))?;
    let path = workspace_context_dir(&workspace_path, &skill_name).join("clarifications.json");
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
pub fn get_decisions_content(skill_name: String, workspace_path: String) -> Result<String, String> {
    validate_skill_name(&skill_name)?;
    let path = workspace_context_dir(&workspace_path, &skill_name).join("decisions.json");
    std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read decisions from '{}': {}", path.display(), e))
}

#[tauri::command]
pub fn save_decisions_content(
    skill_name: String,
    workspace_path: String,
    content: String,
) -> Result<(), String> {
    validate_skill_name(&skill_name)?;
    if content.trim().is_empty() {
        return Err("decisions.json content cannot be empty".to_string());
    }
    let path = workspace_context_dir(&workspace_path, &skill_name).join("decisions.json");
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
) -> Result<String, String> {
    validate_skill_name(&skill_name)?;
    if file_name.contains('/') || file_name.contains('\\') || file_name.contains("..") {
        return Err("Invalid context file name".to_string());
    }
    let path = workspace_context_dir(&workspace_path, &skill_name).join(file_name);
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

    crate::cleanup::delete_step_output_files(
        &workspace_path,
        &skill_name,
        from_step_id,
        &skills_path,
    );

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

    // Delete output files only for steps AFTER the target; target step keeps its files.
    let delete_from = target_step_id + 1;
    crate::cleanup::delete_step_output_files(
        &workspace_path,
        &skill_name,
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
pub fn scan_legacy_clarifications(db: tauri::State<'_, Db>) -> Result<Vec<String>, String> {
    log::info!("scan_legacy_clarifications: checking for legacy clarifications.md files");

    let workspace_path = match read_workspace_path(&db) {
        Some(p) => p,
        None => return Ok(vec![]),
    };

    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT name FROM skills")
        .map_err(|e| e.to_string())?;
    let skill_names: Vec<String> = stmt
        .query_map([], |row| row.get(0))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    let mut legacy_skills = Vec::new();
    for name in &skill_names {
        let md_path = Path::new(&workspace_path)
            .join(name)
            .join("context")
            .join("clarifications.md");
        if md_path.exists() {
            legacy_skills.push(name.clone());
        }
    }

    log::info!(
        "scan_legacy_clarifications: found {} skills with legacy clarifications.md",
        legacy_skills.len()
    );
    Ok(legacy_skills)
}

#[tauri::command]
pub fn reset_legacy_skills(
    skill_names: Vec<String>,
    db: tauri::State<'_, Db>,
) -> Result<(), String> {
    log::info!(
        "reset_legacy_skills: resetting {} skills",
        skill_names.len()
    );

    let skills_path =
        read_skills_path(&db).ok_or_else(|| "Skills path not configured".to_string())?;
    let workspace_path =
        read_workspace_path(&db).ok_or_else(|| "Workspace path not configured".to_string())?;

    for name in &skill_names {
        validate_skill_name(name)?;
    }

    let conn = db.0.lock().map_err(|e| e.to_string())?;

    for name in &skill_names {
        let skill_root = Path::new(&skills_path).join(name);
        let workspace_skill_root = Path::new(&workspace_path).join(name);

        // Delete context/ contents
        let context_dir = workspace_skill_root.join("context");
        if context_dir.is_dir() {
            if let Err(e) = std::fs::remove_dir_all(&context_dir) {
                log::warn!(
                    "reset_legacy_skills: failed to remove context/ for {}: {}",
                    name,
                    e
                );
            }
            let _ = std::fs::create_dir_all(&context_dir);
        }

        // Delete SKILL.md
        let skill_md = skill_root.join("SKILL.md");
        if skill_md.exists() {
            let _ = std::fs::remove_file(&skill_md);
        }

        // Delete references/ contents
        let refs_dir = skill_root.join("references");
        if refs_dir.is_dir() {
            if let Err(e) = std::fs::remove_dir_all(&refs_dir) {
                log::warn!(
                    "reset_legacy_skills: failed to remove references/ for {}: {}",
                    name,
                    e
                );
            }
            let _ = std::fs::create_dir_all(&refs_dir);
        }

        // Reset workflow to step 0 in DB
        conn.execute(
            "UPDATE workflow_steps SET status = 'pending' WHERE skill_name = ?1",
            rusqlite::params![name],
        )
        .map_err(|e| e.to_string())?;

        log::info!("reset_legacy_skills: reset {}", name);
    }

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
    let skill_output_dir = Path::new(&skills_path).join(&skill_name);

    let step_names = [
        "Research",
        "Detailed Research",
        "Confirm Decisions",
        "Generate Skill",
    ];

    let mut result = Vec::new();
    for step_id in from_step_id..=3 {
        // skills_path is required — single code path, no workspace fallback
        let mut existing_files: Vec<String> = Vec::new();

        for file in get_step_output_files(step_id) {
            let exists = if step_id == 3 {
                skill_output_dir.join(file).exists()
            } else {
                Path::new(&workspace_path)
                    .join(&skill_name)
                    .join(file)
                    .exists()
            };
            if exists {
                existing_files.push(file.to_string());
            }
        }

        // Step 3: also list individual files in references/ directory
        if step_id == 3 {
            let refs_dir = skill_output_dir.join("references");
            if refs_dir.is_dir() {
                if let Ok(entries) = std::fs::read_dir(&refs_dir) {
                    for entry in entries.flatten() {
                        let path = entry.path();
                        if path.is_file() {
                            if let Some(name) = path.file_name() {
                                existing_files
                                    .push(format!("references/{}", name.to_string_lossy()));
                            }
                        }
                    }
                }
            }
        }

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
