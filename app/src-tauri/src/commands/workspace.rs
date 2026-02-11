use crate::commands::workflow::get_step_output_files;
use crate::db::Db;
use crate::types::{OrphanSkill, ReconciliationResult};
use std::collections::HashSet;
use std::path::Path;

const WORKSPACE_DIR_NAME: &str = ".vibedata";

/// Inspect files on disk to determine the furthest completed step for a skill.
/// Returns `None` if no steps have been completed (no output files found),
/// or `Some(n)` where n is the furthest completed step number. Only counts a
/// step as complete if at least one of its expected output files exists.
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

    for step_id in [0u32, 2, 4, 5, 6, 7] {
        let files = get_step_output_files(step_id);
        let has_output = if step_id == 5 {
            // Step 5 output may live in skills_path or workspace_path
            let output_dir = if let Some(sp) = skills_path {
                Path::new(sp).join(skill_name)
            } else {
                skill_dir.clone()
            };
            output_dir.join("SKILL.md").exists()
                || output_dir.join("references").is_dir()
        } else {
            files.iter().any(|f| skill_dir.join(f).exists())
        };

        if has_output {
            // Steps 1 and 3 are human review — if step 2 output exists,
            // step 1 must have been completed; if step 4 exists, step 3 was done.
            furthest = Some(step_id);
        }
    }

    furthest
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
                // Working dir exists — check if DB step is ahead of disk
                let disk_step = detect_furthest_step(workspace_path, &run.skill_name, skills_path)
                    .map(|s| s as i32)
                    .unwrap_or(0);
                if run.current_step > disk_step {
                    // Scenario 2: DB ahead of disk → reset to disk reality
                    crate::db::save_workflow_run(
                        conn,
                        &run.skill_name,
                        &run.domain,
                        disk_step,
                        "pending",
                        &run.skill_type,
                    )?;
                    crate::db::reset_workflow_steps_from(conn, &run.skill_name, disk_step)?;
                    crate::db::delete_artifacts_from(conn, &run.skill_name, disk_step)?;
                    notifications.push(format!(
                        "'{}' was reset from step {} to step {} (disk state behind DB)",
                        run.skill_name, run.current_step, disk_step
                    ));
                }
                // else: Scenario 5 — normal, no action
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

/// Check if a skill has output files in the skills_path directory.
/// Skills output is SKILL.md and/or references/ in skills_path/skill_name/.
fn has_skill_output(skill_name: &str, skills_path: Option<&str>) -> bool {
    if let Some(sp) = skills_path {
        let output_dir = Path::new(sp).join(skill_name);
        output_dir.join("SKILL.md").exists() || output_dir.join("references").is_dir()
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
    super::workflow::ensure_workspace_prompts(app, &workspace_path)?;

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
    super::workflow::ensure_workspace_prompts(&app, &workspace_path)?;

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

        std::fs::create_dir_all(workspace.join("my-skill").join("context")).unwrap();
        create_step_output(&workspace, "my-skill", 0);
        create_step_output(&workspace, "my-skill", 2);
        create_step_output(&workspace, "my-skill", 4);

        // Step 5 output lives in skills_path
        std::fs::create_dir_all(skills.join("my-skill")).unwrap();
        std::fs::write(skills.join("my-skill").join("SKILL.md"), "# Skill").unwrap();

        let step = detect_furthest_step(
            workspace.to_str().unwrap(),
            "my-skill",
            Some(skills.to_str().unwrap()),
        );
        assert_eq!(step, Some(5));
    }

    #[test]
    fn test_detect_furthest_step_nonexistent_dir() {
        let step = detect_furthest_step("/nonexistent/path", "no-skill", None);
        assert_eq!(step, None);
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
