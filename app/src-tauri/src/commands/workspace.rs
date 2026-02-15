use crate::commands::workflow::get_step_output_files;
use crate::db::Db;
use crate::types::{OrphanSkill, ReconciliationResult};
use std::collections::HashSet;
use std::path::Path;

const WORKSPACE_DIR_NAME: &str = ".vibedata";

/// Inspect files on disk to determine the furthest completed step for a skill.
/// Returns `None` if no steps have been completed (no output files found),
/// or `Some(n)` where n is the furthest completed step number. A step counts
/// as complete only if ALL of its expected output files exist. Partial output
/// (some but not all files) is cleaned up defensively.
fn detect_furthest_step(
    workspace_path: &str,
    skill_name: &str,
    skills_path: Option<&str>,
) -> Option<u32> {
    let skill_dir = Path::new(workspace_path).join(skill_name);
    if !skill_dir.exists() {
        return None;
    }

    let mut furthest: Option<u32> = None;

    for step_id in [0u32, 2, 4, 5, 6] {
        let files = get_step_output_files(step_id);
        let (has_all, has_any) = if step_id == 5 {
            let output_dir = if let Some(sp) = skills_path {
                Path::new(sp).join(skill_name)
            } else {
                skill_dir.clone()
            };
            let exists = output_dir.join("SKILL.md").exists();
            (exists, exists)
        } else if skills_path.is_some() && matches!(step_id, 0 | 2 | 4 | 6) {
            let target_dir = Path::new(skills_path.unwrap()).join(skill_name);
            let all = files.iter().all(|f| target_dir.join(f).exists());
            let any = files.iter().any(|f| target_dir.join(f).exists());
            (all, any)
        } else {
            let all = files.iter().all(|f| skill_dir.join(f).exists());
            let any = files.iter().any(|f| skill_dir.join(f).exists());
            (all, any)
        };

        if has_all {
            furthest = Some(step_id);
        } else {
            if has_any {
                // Partial output — clean up orphaned files from this incomplete step
                log::info!(
                    "[detect_furthest_step] step {} has partial output for '{}', cleaning up",
                    step_id, skill_name
                );
                cleanup_step_files(workspace_path, skill_name, step_id, skills_path);
            }
            // Stop at first incomplete step — later steps can't be valid
            // without earlier ones completing first. Clean up any files from
            // steps beyond this point.
            break;
        }
    }

    furthest
}

/// Delete output files for a single step from both workspace and skills_path.
/// Used defensively to clean up partial output from interrupted agent runs.
fn cleanup_step_files(
    workspace_path: &str,
    skill_name: &str,
    step_id: u32,
    skills_path: Option<&str>,
) {
    let skill_dir = Path::new(workspace_path).join(skill_name);
    let files = get_step_output_files(step_id);

    if step_id == 5 {
        let output_dir = if let Some(sp) = skills_path {
            Path::new(sp).join(skill_name)
        } else {
            skill_dir.clone()
        };
        let skill_md = output_dir.join("SKILL.md");
        if skill_md.exists() {
            let _ = std::fs::remove_file(&skill_md);
            log::info!("[cleanup_step_files] deleted {}", skill_md.display());
        }
        let refs_dir = output_dir.join("references");
        if refs_dir.is_dir() {
            // Only delete if non-empty (empty dir is from create_skill_inner)
            if std::fs::read_dir(&refs_dir).map(|mut d| d.next().is_some()).unwrap_or(false) {
                let _ = std::fs::remove_dir_all(&refs_dir);
                // Recreate empty dir (create_skill_inner expects it)
                let _ = std::fs::create_dir_all(&refs_dir);
                log::info!("[cleanup_step_files] cleaned references/ in {}", output_dir.display());
            }
        }
        return;
    }

    // Context files — check both workspace and skills_path locations
    let context_dir = if let Some(sp) = skills_path {
        if matches!(step_id, 0 | 2 | 4 | 6) {
            Path::new(sp).join(skill_name)
        } else {
            skill_dir.clone()
        }
    } else {
        skill_dir.clone()
    };

    for file in &files {
        for dir in [&skill_dir, &context_dir] {
            let path = dir.join(file);
            if path.exists() {
                let _ = std::fs::remove_file(&path);
                log::info!("[cleanup_step_files] deleted {}", path.display());
            }
        }
    }
}

/// Clean up files from all steps after the reconciled step.
/// Removes both partial and complete output for future steps to prevent
/// stale files from causing incorrect reconciliation on next startup.
fn cleanup_future_steps(
    workspace_path: &str,
    skill_name: &str,
    after_step: i32,
    skills_path: Option<&str>,
) {
    for step_id in [0u32, 2, 4, 5, 6] {
        if (step_id as i32) <= after_step {
            continue;
        }
        cleanup_step_files(workspace_path, skill_name, step_id, skills_path);
    }
}

/// Core reconciliation logic. Compares DB state with filesystem state and resolves
/// discrepancies. Called on startup before the dashboard loads.
///
/// The 5 reconciliation scenarios:
/// 1. Working dir exists, no DB record → create DB record conservatively
/// 2. DB step ahead of disk → reset to latest safe step + notification
/// 3. DB record + skill output + no working dir → orphan (needs user dialog)
/// 4. DB record + no working dir + no skill output → auto-clean stale record
/// 5. Normal case: DB and disk agree → no action
pub fn reconcile_on_startup(
    conn: &rusqlite::Connection,
    workspace_path: &str,
    skills_path: Option<&str>,
) -> Result<ReconciliationResult, String> {
    let mut orphans = Vec::new();
    let mut notifications = Vec::new();
    let mut auto_cleaned: u32 = 0;

    // Collect all DB workflow runs
    let db_runs = crate::db::list_all_workflow_runs(conn)?;
    let mut db_names: HashSet<String> = db_runs.iter().map(|r| r.skill_name.clone()).collect();

    // Collect all skill directories on disk (working dirs in workspace)
    let workspace = Path::new(workspace_path);
    let mut disk_dirs: HashSet<String> = HashSet::new();
    if workspace.exists() {
        if let Ok(entries) = std::fs::read_dir(workspace) {
            for entry in entries.flatten() {
                let path = entry.path();
                if !path.is_dir() {
                    continue;
                }
                let name = entry.file_name().to_string_lossy().to_string();
                // Skip infrastructure directories
                if name == "agents" || name == "references" || name == ".claude" {
                    continue;
                }
                // Any non-infrastructure subdirectory of the workspace is
                // treated as a skill working directory. The workspace path
                // itself is a DB setting, so every subfolder here is assumed
                // to belong to a skill.
                disk_dirs.insert(name);
            }
        }
    }

    // Process DB runs against filesystem state
    for run in &db_runs {
        let working_dir_exists = disk_dirs.contains(&run.skill_name);
        let skill_output_exists = has_skill_output(&run.skill_name, skills_path);

        match (working_dir_exists, skill_output_exists) {
            (true, _) => {
                // Working dir exists — reconcile DB state with disk reality
                let maybe_disk_step = detect_furthest_step(workspace_path, &run.skill_name, skills_path);

                if let Some(disk_step) = maybe_disk_step.map(|s| s as i32) {
                    // current_step semantics: "the step you're on / about to run".
                    // After step N completes, current_step = N+1. detect_furthest_step
                    // returns N (the last step with output files). So current_step being
                    // disk_step + 1 is the normal state after step N completes.
                    //
                    // Additionally, current_step can be disk_step + 2 when the step after
                    // the last agent step is a human review (1, 3) or refinement (7) that
                    // auto-advances without producing files.
                    //
                    // Count how many non-detectable (file-less) steps sit between disk_step
                    // and current_step. If the gap is fully explained by normal progression
                    // plus non-detectable steps, the DB state is valid.
                    if run.current_step > disk_step {
                        let gap = run.current_step - disk_step;
                        let non_detectable_in_gap = ((disk_step + 1)..run.current_step)
                            .filter(|s| matches!(s, 1 | 3 | 7))
                            .count() as i32;
                        // gap of 1 is always normal (step completed → advanced to next).
                        // Each non-detectable step in the range accounts for one more.
                        let should_reset = gap > 1 + non_detectable_in_gap;

                        if should_reset {
                            // Scenario 2: DB genuinely ahead of disk → reset
                            crate::db::save_workflow_run(
                                conn,
                                &run.skill_name,
                                &run.domain,
                                disk_step,
                                "pending",
                                &run.skill_type,
                            )?;
                            crate::db::reset_workflow_steps_from(conn, &run.skill_name, disk_step)?;
                            notifications.push(format!(
                                "'{}' was reset from step {} to step {} (disk state behind DB)",
                                run.skill_name, run.current_step, disk_step
                            ));
                        }
                    } else if disk_step > run.current_step {
                        // Disk is ahead of DB — advance current_step to match.
                        // The reset dialog always deletes both files and DB step
                        // records when navigating back, so disk ahead always means
                        // the DB is stale (never intentional navigation).
                        crate::db::save_workflow_run(
                            conn,
                            &run.skill_name,
                            &run.domain,
                            disk_step,
                            "pending",
                            &run.skill_type,
                        )?;
                        notifications.push(format!(
                            "'{}' was advanced from step {} to step {} (disk state ahead of DB)",
                            run.skill_name, run.current_step, disk_step
                        ));
                    }

                    // Mark steps with output on disk as completed.
                    // Also mark intervening non-detectable steps as completed when
                    // the DB position accounts for them (they leave no files but were done).
                    for s in 0..=disk_step {
                        crate::db::save_workflow_step(conn, &run.skill_name, s, "completed")?;
                    }
                    // If current_step > disk_step and we didn't reset, the steps between
                    // disk_step+1 and current_step-1 are non-detectable — mark them too.
                    if run.current_step > disk_step + 1 {
                        for s in (disk_step + 1)..run.current_step {
                            if matches!(s, 1 | 3 | 7) {
                                crate::db::save_workflow_step(conn, &run.skill_name, s, "completed")?;
                            }
                        }
                    }

                    // Defensive: clean up any files from steps beyond the reconciled point.
                    // Prevents stale future-step files from causing incorrect reconciliation.
                    cleanup_future_steps(workspace_path, &run.skill_name, disk_step, skills_path);
                } else if run.current_step > 0 {
                    // No output files on disk but DB thinks we're past step 0.
                    // Reset to step 0 pending — all work was lost.
                    crate::db::save_workflow_run(
                        conn,
                        &run.skill_name,
                        &run.domain,
                        0,
                        "pending",
                        &run.skill_type,
                    )?;
                    crate::db::reset_workflow_steps_from(conn, &run.skill_name, 0)?;
                    // Defensive: clean up any lingering files from all steps
                    cleanup_future_steps(workspace_path, &run.skill_name, -1, skills_path);
                    notifications.push(format!(
                        "'{}' was reset from step {} to step 0 (no output files found)",
                        run.skill_name, run.current_step
                    ));
                }
                // else: No output files and DB at step 0 — fresh skill, no action needed
            }
            (false, true) => {
                // Scenario 3: Orphan — skill output exists but working dir is gone
                orphans.push(OrphanSkill {
                    skill_name: run.skill_name.clone(),
                    domain: run.domain.clone(),
                    skill_type: run.skill_type.clone(),
                });
            }
            (false, false) => {
                // Scenario 4: Stale DB record — auto-clean
                crate::db::delete_workflow_run(conn, &run.skill_name)?;
                auto_cleaned += 1;
            }
        }
    }

    // Scenario 1: Disk dirs with no DB record — create records conservatively
    for name in &disk_dirs {
        if !db_names.contains(name) {
            let disk_step_opt = detect_furthest_step(workspace_path, name, skills_path);
            let disk_step = disk_step_opt.map(|s| s as i32).unwrap_or(0);
            // Domain defaults to "unknown" for disk-only discoveries
            let domain = read_domain_from_disk(workspace_path, name);
            crate::db::save_workflow_run(
                conn,
                name,
                &domain,
                disk_step,
                "pending",
                "domain", // conservative default
            )?;
            // Mark completed steps only if output files were detected
            if let Some(furthest) = disk_step_opt {
                for step_id in 0..=(furthest as i32) {
                    crate::db::save_workflow_step(conn, name, step_id, "completed")?;
                }
            }
            notifications.push(format!(
                "'{}' was discovered on disk at step {} and added to the database",
                name, disk_step
            ));
            db_names.insert(name.clone());
        }
    }

    Ok(ReconciliationResult {
        orphans,
        notifications,
        auto_cleaned,
    })
}

/// Check if a skill has ANY output files in the skills_path directory.
/// This includes build output (SKILL.md, references/) and context files
/// (clarifications, decisions) that are written directly to skills_path.
fn has_skill_output(skill_name: &str, skills_path: Option<&str>) -> bool {
    if let Some(sp) = skills_path {
        let output_dir = Path::new(sp).join(skill_name);
        output_dir.join("SKILL.md").exists()
            || output_dir.join("references").is_dir()
            || output_dir.join("context").is_dir()
    } else {
        false
    }
}

/// Return a default domain for disk-only skills that have no DB record.
/// Previously this read from workflow.md, but that file no longer exists —
/// the DB is the single source of truth for domain metadata.
fn read_domain_from_disk(_workspace_path: &str, _skill_name: &str) -> String {
    "unknown".to_string()
}

/// Resolve an orphan skill. Called from the frontend after the user makes a decision.
///
/// - "delete": Removes DB record and deletes skill output files from disk.
/// - "keep": Resets the DB workflow to step 0, status "pending", preserves output files.
pub fn resolve_orphan_inner(
    conn: &rusqlite::Connection,
    skill_name: &str,
    action: &str,
    skills_path: Option<&str>,
) -> Result<(), String> {
    match action {
        "delete" => {
            // Delete DB record (handles missing records gracefully)
            crate::db::delete_workflow_run(conn, skill_name)?;

            // Delete skill output directory on disk if it exists
            if let Some(sp) = skills_path {
                let output_dir = Path::new(sp).join(skill_name);
                if output_dir.exists() {
                    std::fs::remove_dir_all(&output_dir)
                        .map_err(|e| format!("Failed to delete skill output for '{}': {}", skill_name, e))?;
                }
            }
            Ok(())
        }
        "keep" => {
            // Reset workflow to step 0, pending — preserve skill output files
            if let Some(run) = crate::db::get_workflow_run(conn, skill_name)? {
                crate::db::save_workflow_run(
                    conn,
                    skill_name,
                    &run.domain,
                    0,
                    "pending",
                    &run.skill_type,
                )?;
                crate::db::reset_workflow_steps_from(conn, skill_name, 0)?;
            }
            Ok(())
        }
        _ => Err(format!("Invalid orphan resolution action: '{}'. Expected 'delete' or 'keep'.", action)),
    }
}

/// Resolve the default workspace path: `~/.vibedata`
fn resolve_workspace_path() -> Result<String, String> {
    let home = dirs::home_dir().ok_or_else(|| "Could not determine home directory".to_string())?;
    let workspace = home.join(WORKSPACE_DIR_NAME);
    workspace
        .to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "Home directory path contains invalid UTF-8".to_string())
}

/// Initialize the workspace directory on app startup.
/// Creates `~/.vibedata` if it doesn't exist, updates settings,
/// and deploys bundled agents and references (always, so updates ship with the app).
pub fn init_workspace(
    app: &tauri::AppHandle,
    db: &tauri::State<'_, Db>,
) -> Result<String, String> {
    let workspace_path = resolve_workspace_path()?;

    // Create directory if it doesn't exist
    std::fs::create_dir_all(&workspace_path)
        .map_err(|e| format!("Failed to create workspace directory: {}", e))?;

    // Update settings with the workspace path
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut settings = crate::db::read_settings(&conn)?;
    if settings.workspace_path.as_deref() != Some(&workspace_path) {
        settings.workspace_path = Some(workspace_path.clone());
        crate::db::write_settings(&conn, &settings)?;
    }
    drop(conn);

    // Always sync bundled agents and references so app updates deploy new files
    super::workflow::ensure_workspace_prompts_sync(app, &workspace_path)?;

    Ok(workspace_path)
}

#[tauri::command]
pub fn get_workspace_path(db: tauri::State<'_, Db>) -> Result<String, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let settings = crate::db::read_settings(&conn)?;
    settings
        .workspace_path
        .ok_or_else(|| "Workspace path not initialized".to_string())
}

/// Core logic for clearing workspace skill directories.
/// Deletes all skill working directories from `workspace_path`, while preserving:
/// - `agents/`, `references/`, `.claude/` (infrastructure dirs)
/// - Any directory that is or is inside `skills_path` (skill output is protected)
///
/// Also cleans up DB records for each deleted skill.
fn clear_workspace_inner(
    conn: &rusqlite::Connection,
    workspace_path: &str,
    skills_path: Option<&str>,
) -> Result<(), String> {
    let base = std::path::Path::new(workspace_path);
    if !base.exists() {
        return Ok(());
    }

    // Resolve the canonical skills_path so we can protect it during workspace clear.
    // If skills_path is inside the workspace, we must not delete it.
    let canonical_skills_path = skills_path
        .and_then(|sp| std::fs::canonicalize(sp).ok());

    // List all subdirectories, skip agents/, references/, and .claude/
    let entries = std::fs::read_dir(base).map_err(|e| e.to_string())?;
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if !path.is_dir() { continue; }
        let name = entry.file_name().to_string_lossy().to_string();
        if name == "agents" || name == "references" || name == ".claude" { continue; }

        // Skip if this directory IS the skills_path or is inside it
        if let Some(ref csp) = canonical_skills_path {
            if let Ok(canonical_entry) = std::fs::canonicalize(&path) {
                if canonical_entry == *csp || canonical_entry.starts_with(csp) {
                    continue;
                }
            }
        }

        // Delete filesystem
        std::fs::remove_dir_all(&path).map_err(|e| e.to_string())?;

        // Delete DB records
        crate::db::delete_workflow_run(conn, &name)?;
        // Delete chat sessions for this skill
        conn.execute("DELETE FROM chat_messages WHERE session_id IN (SELECT id FROM chat_sessions WHERE skill_name = ?1)", [&name])
            .map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM chat_sessions WHERE skill_name = ?1", [&name])
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub fn clear_workspace(
    app: tauri::AppHandle,
    db: tauri::State<'_, Db>,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let settings = crate::db::read_settings(&conn)?;
    let workspace_path = settings.workspace_path
        .ok_or_else(|| "Workspace path not initialized".to_string())?;
    let skills_path = settings.skills_path.clone();

    clear_workspace_inner(&conn, &workspace_path, skills_path.as_deref())?;
    drop(conn);

    // Re-initialize workspace with bundled agents/references
    super::workflow::ensure_workspace_prompts_sync(&app, &workspace_path)?;

    Ok(())
}

#[tauri::command]
pub fn reconcile_startup(db: tauri::State<'_, Db>) -> Result<ReconciliationResult, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let settings = crate::db::read_settings(&conn)?;
    let workspace_path = settings
        .workspace_path
        .ok_or_else(|| "Workspace path not initialized".to_string())?;
    let skills_path = settings.skills_path;

    reconcile_on_startup(&conn, &workspace_path, skills_path.as_deref())
}

#[tauri::command]
pub fn resolve_orphan(
    skill_name: String,
    action: String,
    db: tauri::State<'_, Db>,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let settings = crate::db::read_settings(&conn)?;
    let skills_path = settings.skills_path;

    resolve_orphan_inner(&conn, &skill_name, &action, skills_path.as_deref())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::test_utils::create_test_db;

    #[test]
    fn test_resolve_workspace_path() {
        let path = resolve_workspace_path().unwrap();
        assert!(path.ends_with(".vibedata"));
        assert!(path.starts_with('/'));
    }

    /// Create a skill working directory on disk with a context/ dir.
    fn create_skill_dir(workspace: &Path, name: &str, _domain: &str) {
        let skill_dir = workspace.join(name);
        std::fs::create_dir_all(skill_dir.join("context")).unwrap();
    }

    /// Create step output files on disk for the given step.
    fn create_step_output(workspace: &Path, name: &str, step_id: u32) {
        let skill_dir = workspace.join(name);
        std::fs::create_dir_all(skill_dir.join("context")).unwrap();
        for file in get_step_output_files(step_id) {
            let path = skill_dir.join(file);
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent).unwrap();
            }
            std::fs::write(&path, format!("# Step {} output", step_id)).unwrap();
        }
    }

    // --- Scenario 1: Working dir exists, no DB record ---

    #[test]
    fn test_scenario_1_disk_only_no_db_record() {
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        let conn = create_test_db();

        // Create a skill on disk with step 0 and step 2 output
        create_skill_dir(tmp.path(), "orphan-skill", "e-commerce");
        create_step_output(tmp.path(), "orphan-skill", 0);
        create_step_output(tmp.path(), "orphan-skill", 2);

        let result = reconcile_on_startup(&conn, workspace, None).unwrap();

        assert!(result.orphans.is_empty());
        assert_eq!(result.auto_cleaned, 0);
        assert_eq!(result.notifications.len(), 1);
        assert!(result.notifications[0].contains("orphan-skill"));
        assert!(result.notifications[0].contains("step 2"));

        // Verify DB record was created (domain defaults to "unknown" for disk-only discoveries)
        let run = crate::db::get_workflow_run(&conn, "orphan-skill")
            .unwrap()
            .unwrap();
        assert_eq!(run.current_step, 2);
        assert_eq!(run.status, "pending");
        assert_eq!(run.domain, "unknown");
    }

    // --- Scenario 2: DB step ahead of disk ---

    #[test]
    fn test_scenario_2_db_ahead_of_disk() {
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        let conn = create_test_db();

        // DB says step 5, but disk only has step 0 and 2 output
        crate::db::save_workflow_run(&conn, "my-skill", "sales", 5, "in_progress", "domain")
            .unwrap();
        create_skill_dir(tmp.path(), "my-skill", "sales");
        create_step_output(tmp.path(), "my-skill", 0);
        create_step_output(tmp.path(), "my-skill", 2);

        let result = reconcile_on_startup(&conn, workspace, None).unwrap();

        assert!(result.orphans.is_empty());
        assert_eq!(result.auto_cleaned, 0);
        assert_eq!(result.notifications.len(), 1);
        assert!(result.notifications[0].contains("reset from step 5 to step 2"));

        // Verify DB was corrected
        let run = crate::db::get_workflow_run(&conn, "my-skill")
            .unwrap()
            .unwrap();
        assert_eq!(run.current_step, 2);
        assert_eq!(run.status, "pending");
    }

    // --- Scenario 3: DB record + skill output + no working dir (orphan) ---

    #[test]
    fn test_scenario_3_orphan_skill_output_no_working_dir() {
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        let skills_tmp = tempfile::tempdir().unwrap();
        let skills_path = skills_tmp.path().to_str().unwrap();
        let conn = create_test_db();

        // DB record exists
        crate::db::save_workflow_run(
            &conn,
            "finished-skill",
            "marketing",
            7,
            "completed",
            "platform",
        )
        .unwrap();

        // Skill output exists in skills_path
        let output_dir = skills_tmp.path().join("finished-skill");
        std::fs::create_dir_all(output_dir.join("references")).unwrap();
        std::fs::write(output_dir.join("SKILL.md"), "# Skill").unwrap();

        // No working directory in workspace

        let result = reconcile_on_startup(&conn, workspace, Some(skills_path)).unwrap();

        assert_eq!(result.orphans.len(), 1);
        assert_eq!(result.orphans[0].skill_name, "finished-skill");
        assert_eq!(result.orphans[0].domain, "marketing");
        assert_eq!(result.orphans[0].skill_type, "platform");
        assert_eq!(result.auto_cleaned, 0);
        assert!(result.notifications.is_empty());
    }

    // --- Scenario 4: DB record + no working dir + no skill output (stale) ---

    #[test]
    fn test_scenario_4_stale_db_record_auto_clean() {
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        let conn = create_test_db();

        // DB record exists but no working dir and no skill output
        crate::db::save_workflow_run(&conn, "ghost-skill", "phantom", 3, "in_progress", "domain")
            .unwrap();

        let result = reconcile_on_startup(&conn, workspace, None).unwrap();

        assert!(result.orphans.is_empty());
        assert_eq!(result.auto_cleaned, 1);
        assert!(result.notifications.is_empty());

        // Verify DB record was deleted
        assert!(crate::db::get_workflow_run(&conn, "ghost-skill")
            .unwrap()
            .is_none());
    }

    // --- Scenario 5: Normal case, DB and disk agree ---

    #[test]
    fn test_scenario_5_normal_db_and_disk_agree() {
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        let conn = create_test_db();

        // DB at step 2, disk has step 0 and 2 output
        crate::db::save_workflow_run(
            &conn,
            "healthy-skill",
            "analytics",
            2,
            "in_progress",
            "domain",
        )
        .unwrap();
        create_skill_dir(tmp.path(), "healthy-skill", "analytics");
        create_step_output(tmp.path(), "healthy-skill", 0);
        create_step_output(tmp.path(), "healthy-skill", 2);

        let result = reconcile_on_startup(&conn, workspace, None).unwrap();

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
        let workspace = tmp.path().to_str().unwrap();
        let conn = create_test_db();

        crate::db::save_workflow_run(&conn, "fresh-skill", "sales", 0, "pending", "domain")
            .unwrap();
        // Only create the working directory — no output files
        std::fs::create_dir_all(tmp.path().join("fresh-skill")).unwrap();

        let result = reconcile_on_startup(&conn, workspace, None).unwrap();

        // No notifications — fresh skill, no action needed
        assert!(result.notifications.is_empty());

        // Step 0 should still be absent from steps table (not falsely completed)
        let steps = crate::db::get_workflow_steps(&conn, "fresh-skill").unwrap();
        assert!(
            steps.is_empty() || steps.iter().all(|s| s.status != "completed"),
            "Step 0 should not be marked completed for a fresh skill with no output"
        );
    }

    #[test]
    fn test_db_ahead_no_output_resets_to_zero() {
        // DB says step 4 but no output files exist at all.
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        let conn = create_test_db();

        crate::db::save_workflow_run(&conn, "lost-skill", "sales", 4, "pending", "domain")
            .unwrap();
        std::fs::create_dir_all(tmp.path().join("lost-skill")).unwrap();

        let result = reconcile_on_startup(&conn, workspace, None).unwrap();

        assert_eq!(result.notifications.len(), 1);
        assert!(result.notifications[0].contains("reset from step 4 to step 0"));

        let run = crate::db::get_workflow_run(&conn, "lost-skill").unwrap().unwrap();
        assert_eq!(run.current_step, 0);

        // No steps should be marked completed
        let steps = crate::db::get_workflow_steps(&conn, "lost-skill").unwrap();
        assert!(
            steps.is_empty() || steps.iter().all(|s| s.status != "completed"),
            "No steps should be completed when there are no output files"
        );
    }

    // --- Non-detectable step tests ---

    #[test]
    fn test_step_7_not_reset_when_step_6_output_exists() {
        // Bug: step 7 (refinement) produces no output files, so detect_furthest_step
        // returns 6 at most. The reconciler was incorrectly resetting from 7 to 6.
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        let conn = create_test_db();

        // DB at step 7, disk has all agent step outputs through step 6
        crate::db::save_workflow_run(&conn, "done-skill", "analytics", 7, "pending", "domain")
            .unwrap();
        create_skill_dir(tmp.path(), "done-skill", "analytics");
        for step in [0, 2, 4, 5, 6] {
            create_step_output(tmp.path(), "done-skill", step);
        }

        let result = reconcile_on_startup(&conn, workspace, None).unwrap();

        // Should NOT reset — step 7 is non-detectable but step 6 output exists
        assert!(result.notifications.is_empty());
        let run = crate::db::get_workflow_run(&conn, "done-skill").unwrap().unwrap();
        assert_eq!(run.current_step, 7);
    }

    #[test]
    fn test_step_7_reset_when_step_6_output_missing() {
        // Step 7 in DB but step 6 output is missing — genuine corruption
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        let conn = create_test_db();

        crate::db::save_workflow_run(&conn, "bad-skill", "analytics", 7, "pending", "domain")
            .unwrap();
        create_skill_dir(tmp.path(), "bad-skill", "analytics");
        // Only steps 0-5 have output, step 6 is missing
        for step in [0, 2, 4, 5] {
            create_step_output(tmp.path(), "bad-skill", step);
        }

        let result = reconcile_on_startup(&conn, workspace, None).unwrap();

        // Should reset — disk is genuinely behind
        assert_eq!(result.notifications.len(), 1);
        assert!(result.notifications[0].contains("reset from step 7 to step 5"));
        let run = crate::db::get_workflow_run(&conn, "bad-skill").unwrap().unwrap();
        assert_eq!(run.current_step, 5);
    }

    #[test]
    fn test_step_1_not_reset_when_step_0_output_exists() {
        // Step 1 (human review) produces no output — should not be reset if step 0 output exists
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        let conn = create_test_db();

        crate::db::save_workflow_run(&conn, "review-skill", "sales", 1, "pending", "domain")
            .unwrap();
        create_skill_dir(tmp.path(), "review-skill", "sales");
        create_step_output(tmp.path(), "review-skill", 0);

        let result = reconcile_on_startup(&conn, workspace, None).unwrap();

        assert!(result.notifications.is_empty());
        let run = crate::db::get_workflow_run(&conn, "review-skill").unwrap().unwrap();
        assert_eq!(run.current_step, 1);
    }

    #[test]
    fn test_step_3_not_reset_when_step_2_output_exists() {
        // Step 3 (human review) produces no output — should not be reset if step 2 output exists
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        let conn = create_test_db();

        crate::db::save_workflow_run(&conn, "review-skill", "sales", 3, "pending", "domain")
            .unwrap();
        create_skill_dir(tmp.path(), "review-skill", "sales");
        create_step_output(tmp.path(), "review-skill", 0);
        create_step_output(tmp.path(), "review-skill", 2);

        let result = reconcile_on_startup(&conn, workspace, None).unwrap();

        assert!(result.notifications.is_empty());
        let run = crate::db::get_workflow_run(&conn, "review-skill").unwrap().unwrap();
        assert_eq!(run.current_step, 3);
    }

    // --- Normal progression tests (current_step = disk_step + 1) ---

    #[test]
    fn test_step_completed_advances_to_next_not_reset() {
        // When step N completes, the app sets current_step = N+1 (next step to run).
        // detect_furthest_step returns N. The reconciler must NOT reset this —
        // it's the normal state after any step completes.
        for (db_step, disk_steps) in [
            (1, vec![0]),             // step 0 completed → on step 1
            (3, vec![0, 2]),          // step 2 completed → on step 3
            (5, vec![0, 2, 4]),       // step 4 completed → on step 5
            (6, vec![0, 2, 4, 5]),    // step 5 completed → on step 6
            (7, vec![0, 2, 4, 5, 6]), // step 6 completed → on step 7
        ] {
            let tmp = tempfile::tempdir().unwrap();
            let workspace = tmp.path().to_str().unwrap();
            let conn = create_test_db();

            crate::db::save_workflow_run(&conn, "my-skill", "sales", db_step, "pending", "domain")
                .unwrap();
            create_skill_dir(tmp.path(), "my-skill", "sales");
            for step in &disk_steps {
                create_step_output(tmp.path(), "my-skill", *step);
            }

            let result = reconcile_on_startup(&conn, workspace, None).unwrap();

            assert!(
                result.notifications.is_empty(),
                "DB at step {}, disk through step {:?}: should NOT reset but got: {:?}",
                db_step, disk_steps.last(), result.notifications
            );
            let run = crate::db::get_workflow_run(&conn, "my-skill").unwrap().unwrap();
            assert_eq!(run.current_step, db_step, "current_step should remain {}", db_step);
        }
    }

    #[test]
    fn test_step_2_on_db_but_step_0_on_disk_with_human_review() {
        // Step 0 completed → step 1 (human review, non-detectable) → step 2.
        // DB at step 2, disk at step 0. Gap = 2 but step 1 is non-detectable.
        // Should NOT reset.
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        let conn = create_test_db();

        crate::db::save_workflow_run(&conn, "my-skill", "sales", 2, "pending", "domain")
            .unwrap();
        create_skill_dir(tmp.path(), "my-skill", "sales");
        create_step_output(tmp.path(), "my-skill", 0);

        let result = reconcile_on_startup(&conn, workspace, None).unwrap();

        assert!(result.notifications.is_empty());
        let run = crate::db::get_workflow_run(&conn, "my-skill").unwrap().unwrap();
        assert_eq!(run.current_step, 2);
    }

    #[test]
    fn test_step_4_on_db_but_step_2_on_disk_with_human_review() {
        // Step 2 completed → step 3 (human review) → step 4.
        // DB at step 4, disk at step 2. Gap = 2 but step 3 is non-detectable.
        // Should NOT reset.
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        let conn = create_test_db();

        crate::db::save_workflow_run(&conn, "my-skill", "sales", 4, "pending", "domain")
            .unwrap();
        create_skill_dir(tmp.path(), "my-skill", "sales");
        create_step_output(tmp.path(), "my-skill", 0);
        create_step_output(tmp.path(), "my-skill", 2);

        let result = reconcile_on_startup(&conn, workspace, None).unwrap();

        assert!(result.notifications.is_empty());
        let run = crate::db::get_workflow_run(&conn, "my-skill").unwrap().unwrap();
        assert_eq!(run.current_step, 4);
    }

    // --- Disk ahead: stale DB vs intentional navigation ---

    #[test]
    fn test_disk_ahead_stale_db_advances_current_step() {
        // DB at step 0 with no step records, disk has output through step 5.
        // This is a stale DB — reconciler should advance current_step to 5.
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        let conn = create_test_db();

        crate::db::save_workflow_run(&conn, "my-skill", "sales", 0, "pending", "domain").unwrap();
        create_skill_dir(tmp.path(), "my-skill", "sales");
        for step in [0, 2, 4, 5] {
            create_step_output(tmp.path(), "my-skill", step);
        }

        let result = reconcile_on_startup(&conn, workspace, None).unwrap();

        assert_eq!(result.notifications.len(), 1);
        assert!(result.notifications[0].contains("advanced from step 0 to step 5"));
        let run = crate::db::get_workflow_run(&conn, "my-skill").unwrap().unwrap();
        assert_eq!(run.current_step, 5);
    }

    // --- Edge cases ---

    #[test]
    fn test_reconcile_empty_workspace() {
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        let conn = create_test_db();

        let result = reconcile_on_startup(&conn, workspace, None).unwrap();

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

        // Scenario 1: Disk-only skill
        create_skill_dir(tmp.path(), "disk-only", "domain-a");
        create_step_output(tmp.path(), "disk-only", 0);

        // Scenario 4: Stale DB record
        crate::db::save_workflow_run(&conn, "stale", "domain-b", 3, "in_progress", "domain")
            .unwrap();

        // Scenario 5: Normal
        crate::db::save_workflow_run(&conn, "normal", "domain-c", 0, "pending", "domain").unwrap();
        create_skill_dir(tmp.path(), "normal", "domain-c");
        create_step_output(tmp.path(), "normal", 0);

        let result = reconcile_on_startup(&conn, workspace, Some(skills_path)).unwrap();

        assert_eq!(result.auto_cleaned, 1); // stale
        assert_eq!(result.notifications.len(), 1); // disk-only discovery
        assert!(result.notifications[0].contains("disk-only"));
        assert!(result.orphans.is_empty());
    }

    #[test]
    fn test_reconcile_skips_infrastructure_dirs() {
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        let conn = create_test_db();

        // Create infrastructure directories that should be skipped
        std::fs::create_dir_all(tmp.path().join("agents")).unwrap();
        std::fs::create_dir_all(tmp.path().join("references")).unwrap();
        std::fs::create_dir_all(tmp.path().join(".claude")).unwrap();

        let result = reconcile_on_startup(&conn, workspace, None).unwrap();

        assert!(result.orphans.is_empty());
        assert!(result.notifications.is_empty());
        assert_eq!(result.auto_cleaned, 0);
    }

    // --- detect_furthest_step tests ---

    #[test]
    fn test_detect_furthest_step_empty_dir() {
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        create_skill_dir(tmp.path(), "empty-skill", "test");

        let step = detect_furthest_step(workspace, "empty-skill", None);
        assert_eq!(step, None);
    }

    #[test]
    fn test_detect_furthest_step_through_steps() {
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        create_skill_dir(tmp.path(), "my-skill", "test");

        // Step 0 output
        create_step_output(tmp.path(), "my-skill", 0);
        assert_eq!(detect_furthest_step(workspace, "my-skill", None), Some(0));

        // Step 2 output
        create_step_output(tmp.path(), "my-skill", 2);
        assert_eq!(detect_furthest_step(workspace, "my-skill", None), Some(2));

        // Step 4 output
        create_step_output(tmp.path(), "my-skill", 4);
        assert_eq!(detect_furthest_step(workspace, "my-skill", None), Some(4));
    }

    #[test]
    fn test_detect_furthest_step_with_skills_path() {
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().join("workspace");
        let skills = tmp.path().join("skills");

        // Working dir must exist for detect_furthest_step to proceed
        std::fs::create_dir_all(workspace.join("my-skill")).unwrap();

        // Context files live in skills_path when configured
        create_step_output(&skills, "my-skill", 0);
        create_step_output(&skills, "my-skill", 2);
        create_step_output(&skills, "my-skill", 4);

        // Step 5 output lives in skills_path
        std::fs::create_dir_all(skills.join("my-skill")).unwrap();
        std::fs::write(skills.join("my-skill").join("SKILL.md"), "# Skill").unwrap();

        let step = detect_furthest_step(
            workspace.to_str().unwrap(),
            "my-skill",
            Some(skills.to_str().unwrap()),
        );
        assert_eq!(step, Some(5));

        // Verify context steps are individually detectable
        assert_eq!(
            detect_furthest_step(workspace.to_str().unwrap(), "my-skill", Some(skills.to_str().unwrap())),
            Some(5)
        );
    }

    #[test]
    fn test_detect_furthest_step_6_in_skills_path() {
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().join("workspace");
        let skills = tmp.path().join("skills");

        std::fs::create_dir_all(workspace.join("my-skill")).unwrap();

        // Steps 0-5 in skills_path
        create_step_output(&skills, "my-skill", 0);
        create_step_output(&skills, "my-skill", 2);
        create_step_output(&skills, "my-skill", 4);
        std::fs::create_dir_all(skills.join("my-skill")).unwrap();
        std::fs::write(skills.join("my-skill").join("SKILL.md"), "# Skill").unwrap();

        // Step 6 context output also in skills_path
        create_step_output(&skills, "my-skill", 6);

        let step = detect_furthest_step(
            workspace.to_str().unwrap(),
            "my-skill",
            Some(skills.to_str().unwrap()),
        );
        assert_eq!(step, Some(6));
    }

    #[test]
    fn test_detect_furthest_step_skill_md_only() {
        // SKILL.md exists but no context files (steps 0/2/4 missing).
        // Detection stops at first incomplete step, so step 5 is NOT reached.
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().join("workspace");
        let skills = tmp.path().join("skills");

        std::fs::create_dir_all(workspace.join("my-skill")).unwrap();
        std::fs::create_dir_all(skills.join("my-skill")).unwrap();
        std::fs::write(skills.join("my-skill").join("SKILL.md"), "# Skill").unwrap();

        let step = detect_furthest_step(
            workspace.to_str().unwrap(),
            "my-skill",
            Some(skills.to_str().unwrap()),
        );
        assert_eq!(step, None, "step 5 without earlier steps should not be detected");
    }

    #[test]
    fn test_detect_furthest_step_nonexistent_dir() {
        let step = detect_furthest_step("/nonexistent/path", "no-skill", None);
        assert_eq!(step, None);
    }

    #[test]
    fn test_detect_step5_ignores_empty_references_dir() {
        // Regression: create_skill_inner creates an empty references/ dir in
        // skills_path at skill creation time. detect_furthest_step must not
        // treat this as proof that step 5 (build) completed.
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().join("workspace");
        let skills = tmp.path().join("skills");

        std::fs::create_dir_all(workspace.join("my-skill")).unwrap();
        // Simulate create_skill_inner: empty context/ and references/ dirs
        std::fs::create_dir_all(skills.join("my-skill").join("context")).unwrap();
        std::fs::create_dir_all(skills.join("my-skill").join("references")).unwrap();

        // Only step 0 output files exist
        create_step_output(&skills, "my-skill", 0);

        let step = detect_furthest_step(
            workspace.to_str().unwrap(),
            "my-skill",
            Some(skills.to_str().unwrap()),
        );
        // Should detect step 0 only — NOT step 5
        assert_eq!(step, Some(0));
    }

    #[test]
    fn test_detect_partial_step0_output_cleaned_up() {
        // If step 0 has only 2 of 3 expected files, it should not count as
        // completed and the partial files should be cleaned up.
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        create_skill_dir(tmp.path(), "partial", "test");

        let skill_dir = tmp.path().join("partial");
        std::fs::create_dir_all(skill_dir.join("context")).unwrap();
        // Write only 2 of 3 step 0 files
        std::fs::write(skill_dir.join("context/research-entities.md"), "# partial").unwrap();
        std::fs::write(skill_dir.join("context/research-metrics.md"), "# partial").unwrap();

        let step = detect_furthest_step(workspace, "partial", None);
        assert_eq!(step, None, "partial step 0 should not be detected");

        // Partial files should have been cleaned up
        assert!(!skill_dir.join("context/research-entities.md").exists());
        assert!(!skill_dir.join("context/research-metrics.md").exists());
    }

    #[test]
    fn test_detect_partial_step0_with_skills_path_cleaned_up() {
        // Same as above but with skills_path configured
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().join("workspace");
        let skills = tmp.path().join("skills");

        std::fs::create_dir_all(workspace.join("my-skill")).unwrap();
        let target = skills.join("my-skill");
        std::fs::create_dir_all(target.join("context")).unwrap();
        // Write only 2 of 3 step 0 files in skills_path
        std::fs::write(target.join("context/research-entities.md"), "# partial").unwrap();
        std::fs::write(target.join("context/research-metrics.md"), "# partial").unwrap();

        let step = detect_furthest_step(
            workspace.to_str().unwrap(),
            "my-skill",
            Some(skills.to_str().unwrap()),
        );
        assert_eq!(step, None, "partial step 0 in skills_path should not be detected");

        // Partial files should have been cleaned up from skills_path
        assert!(!target.join("context/research-entities.md").exists());
        assert!(!target.join("context/research-metrics.md").exists());
    }

    #[test]
    fn test_cleanup_future_steps() {
        // If reconciled to step 2, files from steps 4/5/6 should be cleaned up
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        create_skill_dir(tmp.path(), "my-skill", "test");

        // Create complete output for steps 0, 2, 4
        create_step_output(tmp.path(), "my-skill", 0);
        create_step_output(tmp.path(), "my-skill", 2);
        create_step_output(tmp.path(), "my-skill", 4);

        // Clean up everything after step 2
        cleanup_future_steps(workspace, "my-skill", 2, None);

        // Step 0 and 2 files should remain
        let skill_dir = tmp.path().join("my-skill");
        assert!(skill_dir.join("context/clarifications-concepts.md").exists());
        assert!(skill_dir.join("context/clarifications.md").exists());

        // Step 4 files should be gone
        assert!(!skill_dir.join("context/decisions.md").exists());
    }

    #[test]
    fn test_reconcile_cleans_future_step_files() {
        // Scenario: DB at step 5, disk has step 0 output + stale step 4 file.
        // Reconciler should reset to step 0 and clean up the step 4 file.
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        let conn = create_test_db();

        create_skill_dir(tmp.path(), "my-skill", "test");
        create_step_output(tmp.path(), "my-skill", 0);
        // Stale step 4 file from a previous run
        create_step_output(tmp.path(), "my-skill", 4);

        // DB thinks we're at step 5
        crate::db::save_workflow_run(&conn, "my-skill", "test", 5, "pending", "domain").unwrap();

        let result = reconcile_on_startup(&conn, workspace, None).unwrap();

        // Should reset to step 0 (disk has step 0 complete, but step 2 is missing)
        let run = crate::db::get_workflow_run(&conn, "my-skill").unwrap().unwrap();
        assert_eq!(run.current_step, 0, "should reconcile to step 0");

        // Step 4 file should be cleaned up (future step)
        let skill_dir = tmp.path().join("my-skill");
        assert!(!skill_dir.join("context/decisions.md").exists(), "step 4 file should be cleaned up");

        assert!(!result.notifications.is_empty());
    }

    // --- read_domain_from_disk tests ---

    #[test]
    fn test_read_domain_from_disk_always_returns_unknown() {
        // Domain is now always "unknown" for disk-only discoveries since
        // workflow.md no longer exists. The DB is the source of truth.
        let tmp = tempfile::tempdir().unwrap();
        create_skill_dir(tmp.path(), "my-skill", "e-commerce analytics");
        let domain = read_domain_from_disk(tmp.path().to_str().unwrap(), "my-skill");
        assert_eq!(domain, "unknown");
    }

    #[test]
    fn test_read_domain_from_disk_missing() {
        let tmp = tempfile::tempdir().unwrap();
        let domain = read_domain_from_disk(tmp.path().to_str().unwrap(), "nonexistent");
        assert_eq!(domain, "unknown");
    }

    // --- resolve_orphan tests ---

    #[test]
    fn test_resolve_orphan_delete() {
        let tmp = tempfile::tempdir().unwrap();
        let skills_path = tmp.path().to_str().unwrap();
        let conn = create_test_db();

        // Set up DB record and skill output
        crate::db::save_workflow_run(&conn, "orphan", "test", 7, "completed", "domain").unwrap();
        let output_dir = tmp.path().join("orphan");
        std::fs::create_dir_all(output_dir.join("references")).unwrap();
        std::fs::write(output_dir.join("SKILL.md"), "# Skill").unwrap();

        resolve_orphan_inner(&conn, "orphan", "delete", Some(skills_path)).unwrap();

        // DB record should be gone
        assert!(crate::db::get_workflow_run(&conn, "orphan")
            .unwrap()
            .is_none());
        // Skill output directory should be deleted
        assert!(!output_dir.exists());
    }

    #[test]
    fn test_resolve_orphan_keep() {
        let tmp = tempfile::tempdir().unwrap();
        let skills_path = tmp.path().to_str().unwrap();
        let conn = create_test_db();

        // Set up DB record and skill output
        crate::db::save_workflow_run(&conn, "orphan", "test", 7, "completed", "domain").unwrap();
        let output_dir = tmp.path().join("orphan");
        std::fs::create_dir_all(&output_dir).unwrap();
        std::fs::write(output_dir.join("SKILL.md"), "# Skill").unwrap();

        resolve_orphan_inner(&conn, "orphan", "keep", Some(skills_path)).unwrap();

        // DB record should be reset to step 0
        let run = crate::db::get_workflow_run(&conn, "orphan")
            .unwrap()
            .unwrap();
        assert_eq!(run.current_step, 0);
        assert_eq!(run.status, "pending");
        // Skill output should still exist
        assert!(output_dir.join("SKILL.md").exists());
    }

    #[test]
    fn test_resolve_orphan_delete_already_gone() {
        let conn = create_test_db();

        // DB record exists but skill output already deleted
        crate::db::save_workflow_run(&conn, "orphan", "test", 5, "completed", "domain").unwrap();

        // Should not error even if files are already gone
        resolve_orphan_inner(&conn, "orphan", "delete", Some("/nonexistent/path")).unwrap();
        assert!(crate::db::get_workflow_run(&conn, "orphan")
            .unwrap()
            .is_none());
    }

    #[test]
    fn test_resolve_orphan_invalid_action() {
        let conn = create_test_db();
        crate::db::save_workflow_run(&conn, "orphan", "test", 5, "completed", "domain").unwrap();

        let result = resolve_orphan_inner(&conn, "orphan", "invalid", None);
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .contains("Invalid orphan resolution action"));
    }

    #[test]
    fn test_resolve_orphan_delete_no_skills_path() {
        let conn = create_test_db();
        crate::db::save_workflow_run(&conn, "orphan", "test", 5, "completed", "domain").unwrap();

        // When skills_path is None, just delete the DB record
        resolve_orphan_inner(&conn, "orphan", "delete", None).unwrap();
        assert!(crate::db::get_workflow_run(&conn, "orphan")
            .unwrap()
            .is_none());
    }

    // --- has_skill_output tests ---

    #[test]
    fn test_has_skill_output_with_skill_md() {
        let tmp = tempfile::tempdir().unwrap();
        let output_dir = tmp.path().join("my-skill");
        std::fs::create_dir_all(&output_dir).unwrap();
        std::fs::write(output_dir.join("SKILL.md"), "# Skill").unwrap();

        assert!(has_skill_output(
            "my-skill",
            Some(tmp.path().to_str().unwrap())
        ));
    }

    #[test]
    fn test_has_skill_output_with_references() {
        let tmp = tempfile::tempdir().unwrap();
        let output_dir = tmp.path().join("my-skill");
        std::fs::create_dir_all(output_dir.join("references")).unwrap();

        assert!(has_skill_output(
            "my-skill",
            Some(tmp.path().to_str().unwrap())
        ));
    }

    #[test]
    fn test_has_skill_output_none() {
        assert!(!has_skill_output("my-skill", None));
    }

    #[test]
    fn test_has_skill_output_with_context() {
        let tmp = tempfile::tempdir().unwrap();
        let output_dir = tmp.path().join("my-skill");
        std::fs::create_dir_all(output_dir.join("context")).unwrap();

        assert!(has_skill_output(
            "my-skill",
            Some(tmp.path().to_str().unwrap())
        ));
    }

    #[test]
    fn test_has_skill_output_empty_dir() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(tmp.path().join("my-skill")).unwrap();

        assert!(!has_skill_output(
            "my-skill",
            Some(tmp.path().to_str().unwrap())
        ));
    }

    // --- clear_workspace_inner tests ---

    #[test]
    fn test_clear_workspace_deletes_skill_dirs() {
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path();
        let conn = create_test_db();

        // Create skill directories
        create_skill_dir(workspace, "skill-a", "domain-a");
        create_skill_dir(workspace, "skill-b", "domain-b");

        // Create DB records
        crate::db::save_workflow_run(&conn, "skill-a", "domain-a", 2, "pending", "domain").unwrap();
        crate::db::save_workflow_run(&conn, "skill-b", "domain-b", 0, "pending", "domain").unwrap();

        clear_workspace_inner(&conn, workspace.to_str().unwrap(), None).unwrap();

        // Skill directories should be deleted
        assert!(!workspace.join("skill-a").exists());
        assert!(!workspace.join("skill-b").exists());

        // DB records should be deleted
        assert!(crate::db::get_workflow_run(&conn, "skill-a").unwrap().is_none());
        assert!(crate::db::get_workflow_run(&conn, "skill-b").unwrap().is_none());
    }

    #[test]
    fn test_clear_workspace_preserves_infrastructure_dirs() {
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path();
        let conn = create_test_db();

        // Create infrastructure directories that should be preserved
        std::fs::create_dir_all(workspace.join("agents")).unwrap();
        std::fs::write(workspace.join("agents").join("test.md"), "agent").unwrap();
        std::fs::create_dir_all(workspace.join("references")).unwrap();
        std::fs::write(workspace.join("references").join("ref.md"), "ref").unwrap();
        std::fs::create_dir_all(workspace.join(".claude")).unwrap();

        // Create a skill directory to be deleted
        create_skill_dir(workspace, "my-skill", "test");

        clear_workspace_inner(&conn, workspace.to_str().unwrap(), None).unwrap();

        // Infrastructure dirs should survive
        assert!(workspace.join("agents").exists());
        assert!(workspace.join("references").exists());
        assert!(workspace.join(".claude").exists());

        // Skill dir should be deleted
        assert!(!workspace.join("my-skill").exists());
    }

    #[test]
    fn test_clear_workspace_preserves_skills_path_inside_workspace() {
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path();
        let conn = create_test_db();

        // skills_path is a subdirectory INSIDE the workspace
        let skills_dir = workspace.join("skill-output");
        std::fs::create_dir_all(skills_dir.join("my-skill")).unwrap();
        std::fs::write(
            skills_dir.join("my-skill").join("SKILL.md"),
            "# My Skill",
        )
        .unwrap();
        std::fs::create_dir_all(skills_dir.join("my-skill").join("context")).unwrap();
        std::fs::write(
            skills_dir.join("my-skill").join("context").join("decisions.md"),
            "# Decisions",
        )
        .unwrap();

        // Create a regular skill working dir to be deleted
        create_skill_dir(workspace, "working-skill", "test");

        clear_workspace_inner(
            &conn,
            workspace.to_str().unwrap(),
            Some(skills_dir.to_str().unwrap()),
        )
        .unwrap();

        // Skill output dir inside workspace should be preserved
        assert!(skills_dir.join("my-skill").join("SKILL.md").exists());
        assert!(skills_dir.join("my-skill").join("context").join("decisions.md").exists());

        // Working skill dir should be deleted
        assert!(!workspace.join("working-skill").exists());
    }

    #[test]
    fn test_clear_workspace_with_separate_skills_path() {
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().join("workspace");
        let skills = tmp.path().join("skills");
        let conn = create_test_db();

        // Set up workspace with a skill dir
        create_skill_dir(&workspace, "my-skill", "test");

        // Set up skills output dir (separate from workspace)
        std::fs::create_dir_all(skills.join("my-skill").join("context")).unwrap();
        std::fs::write(
            skills.join("my-skill").join("context").join("decisions.md"),
            "# Decisions",
        )
        .unwrap();

        clear_workspace_inner(
            &conn,
            workspace.to_str().unwrap(),
            Some(skills.to_str().unwrap()),
        )
        .unwrap();

        // Workspace skill dir should be deleted
        assert!(!workspace.join("my-skill").exists());

        // Skills output dir should be preserved (it's separate from workspace)
        assert!(skills.join("my-skill").join("context").join("decisions.md").exists());
    }

    #[test]
    fn test_clear_workspace_nonexistent_workspace() {
        let conn = create_test_db();
        // Should not error on nonexistent workspace
        clear_workspace_inner(&conn, "/nonexistent/workspace/path", None).unwrap();
    }
}
