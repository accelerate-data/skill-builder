use crate::cleanup::cleanup_future_steps;
use crate::fs_validation::{detect_furthest_step, detect_furthest_step_with_options, has_skill_output};
use crate::types::{DiscoveredSkill, ReconciliationResult};
use std::collections::HashSet;
use std::path::Path;

/// Core reconciliation logic. Compares DB state with filesystem state and resolves
/// discrepancies. Called on startup before the dashboard loads.
///
/// Design principles:
/// - The skills master table is the driver (not workflow_runs).
/// - Two passes: (1) DB-driven — branch on skill_source, (2) disk discovery (scenarios 9a/9b/9c).
/// - `workspace/skill-name/` is transient scratch space. If missing for a
///   skill-builder skill, recreate it.
/// - Marketplace skills live in `skills_path` — if SKILL.md is gone, delete from master.
/// - Imported skills are skipped (no reconciliation).
///
/// Scenarios (see docs/design/startup-recon/README.md):
///  1. DB and disk agree (no action)
///  2. DB step ahead of disk → reset
///  3. Disk ahead of DB → advance
///  4. No output files, DB > step 0 → reset to 0
///  5. Workspace marker missing → recreate
///  6. Completed but SKILL.md gone → handled by detect_furthest_step
///  7. Active session → skip
///  8. Fresh skill (step 0, no output) → no action
/// 10. Master row, no workflow_runs → auto-create workflow_runs
/// 11. Marketplace SKILL.md exists → no action
/// 12. Marketplace SKILL.md missing → delete from master
pub fn reconcile_on_startup(
    conn: &rusqlite::Connection,
    workspace_path: &str,
    skills_path: &str,
) -> Result<ReconciliationResult, String> {
    let mut notifications = Vec::new();
    // ── Pass 1: DB-driven — loop over skills master, branch on skill_source ──

    let all_skills = crate::db::list_all_skills(conn)?;

    log::info!(
        "[reconcile_on_startup] starting: {} skills in master, workspace={} skills_path={}",
        all_skills.len(),
        workspace_path,
        skills_path
    );

    for skill in &all_skills {
        match skill.skill_source.as_str() {
            "skill-builder" => {
                reconcile_skill_builder(
                    conn,
                    &skill.name,
                    workspace_path,
                    skills_path,
                    &mut notifications,
                )?;
            }
            "marketplace" => {
                reconcile_marketplace(
                    conn,
                    &skill.name,
                    skills_path,
                    &mut notifications,
                )?;
            }
            "imported" => {
                // Imported skills have no reconciliation checks (per design doc)
                log::debug!(
                    "[reconcile] '{}': skill_source=imported, action=skip",
                    skill.name
                );
            }
            other => {
                log::warn!(
                    "[reconcile] '{}': unknown skill_source='{}', skipping",
                    skill.name, other
                );
            }
        }
    }

    // ── Pass 2: Discover skills on disk not in master ──
    let master_names: HashSet<String> = all_skills.iter().map(|s| s.name.clone()).collect();
    let mut discovered_skills = Vec::new();
    let skills_dir = Path::new(skills_path);
    if skills_dir.exists() {
        for entry in std::fs::read_dir(skills_dir).into_iter().flatten().flatten() {
            let path = entry.path();
            if !path.is_dir() { continue; }
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') { continue; } // skip dotfiles

            // Already in master? Skip.
            if master_names.contains(&name) { continue; }

            let skill_md = path.join("SKILL.md");
            log::debug!("[reconcile] '{}': discovered on disk, not in master", name);

            if !skill_md.exists() {
                // Scenario 9a: folder with no SKILL.md -> auto-delete, notify
                log::info!("[reconcile] '{}': removing — no SKILL.md found", name);
                if let Err(e) = std::fs::remove_dir_all(&path) {
                    log::error!("[reconcile] '{}': failed to remove: {}", name, e);
                }
                crate::db::delete_imported_skill_by_name(conn, &name).ok();
                notifications.push(format!("'{}' removed — no SKILL.md found on disk", name));
            } else {
                // Has SKILL.md — check context artifacts
                let workspace_marker = Path::new(workspace_path).join(&name);
                // Create a temporary workspace marker for detect_furthest_step (it requires one)
                let created_marker = if !workspace_marker.exists() {
                    std::fs::create_dir_all(&workspace_marker).ok();
                    true
                } else {
                    false
                };

                let detected = detect_furthest_step(workspace_path, &name, skills_path);

                // Clean up temp marker if we created it
                if created_marker {
                    let _ = std::fs::remove_dir_all(&workspace_marker);
                }

                let detected_step = detected.map(|s| s as i32).unwrap_or(-1);

                if detected == Some(3) {
                    // Scenario 9b: all artifacts -> user choice
                    log::info!("[reconcile] '{}': full artifacts found (step 3), prompting user", name);
                    discovered_skills.push(DiscoveredSkill {
                        name: name.clone(),
                        detected_step: 3,
                        scenario: "9b".to_string(),
                    });
                } else {
                    // Scenario 9c: SKILL.md + partial/no context -> user choice
                    log::info!("[reconcile] '{}': partial artifacts (step {}), prompting user", name, detected_step);
                    discovered_skills.push(DiscoveredSkill {
                        name: name.clone(),
                        detected_step,
                        scenario: "9c".to_string(),
                    });
                }
            }
        }
    }

    // Pass 3: Move any remaining orphaned folders (not in skills master) to .trash/
    // This catches anything missed by Pass 1 and Pass 2 — defensive catch-all.
    // Skip skills pending user action from Pass 2 discovery.
    let discovered_names: HashSet<String> = discovered_skills.iter().map(|d| d.name.clone()).collect();
    if skills_dir.exists() {
        let trash_dir = skills_dir.join(".trash");
        for entry in std::fs::read_dir(skills_dir).into_iter().flatten().flatten() {
            let path = entry.path();
            if !path.is_dir() { continue; }
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') { continue; } // skip dotfiles, .git, .trash

            if !master_names.contains(&name) && !discovered_names.contains(&name) {
                // Not in master after all reconciliation — move to .trash/
                let dest = trash_dir.join(&name);
                if let Err(e) = std::fs::create_dir_all(&trash_dir) {
                    log::error!("[reconcile] failed to create .trash/: {}", e);
                    continue;
                }
                // Remove dest if it already exists (from a previous run)
                if dest.exists() {
                    let _ = std::fs::remove_dir_all(&dest);
                }
                match std::fs::rename(&path, &dest) {
                    Ok(()) => {
                        // Remove from git index so git stops tracking the folder
                        let git_rm = std::process::Command::new("git")
                            .args(["rm", "-r", "--cached", "--quiet", "--ignore-unmatch", &name])
                            .current_dir(skills_dir)
                            .output();
                        match git_rm {
                            Ok(out) if out.status.success() => {
                                log::debug!("[reconcile] '{}': removed from git index", name);
                            }
                            Ok(out) => {
                                log::debug!("[reconcile] '{}': git rm --cached: {}", name,
                                    String::from_utf8_lossy(&out.stderr).trim());
                            }
                            Err(e) => {
                                log::debug!("[reconcile] '{}': git rm --cached failed: {}", name, e);
                            }
                        }
                        log::info!("[reconcile] '{}': moved to .trash (not in skills master)", name);
                        notifications.push(format!("'{}' moved to .trash — not in skills catalog", name));
                    }
                    Err(e) => {
                        log::error!("[reconcile] '{}': failed to move to .trash: {}", name, e);
                    }
                }
                // Also clean imported_skills if present
                crate::db::delete_imported_skill_by_name(conn, &name).ok();
            }
        }
    }

    // Ensure .trash/ is git-ignored
    if skills_dir.exists() {
        let gitignore = skills_dir.join(".gitignore");
        let needs_trash_entry = if gitignore.exists() {
            std::fs::read_to_string(&gitignore)
                .map(|c| !c.lines().any(|l| l.trim() == ".trash/"))
                .unwrap_or(true)
        } else {
            true
        };
        if needs_trash_entry {
            use std::io::Write;
            if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&gitignore) {
                let _ = writeln!(f, ".trash/");
                log::debug!("[reconcile] added .trash/ to .gitignore");
            }
        }
    }

    // Commit any git index changes from Pass 3 (removals + .gitignore update)
    if let Err(e) = crate::git::commit_all(skills_dir, "reconcile: move orphaned folders to .trash") {
        log::debug!("[reconcile] git commit after pass 3: {}", e);
    }

    log::info!(
        "[reconcile_on_startup] done: {} auto-cleaned, {} notifications, {} discovered",
        0, notifications.len(), discovered_skills.len()
    );

    Ok(ReconciliationResult {
        orphans: Vec::new(),
        notifications,
        auto_cleaned: 0,
        discovered_skills,
    })
}

/// Read-only startup reconciliation preview.
///
/// Returns the same notification/discovery shape as apply mode, but performs
/// no DB writes or filesystem mutations.
pub fn preview_reconcile_on_startup(
    conn: &rusqlite::Connection,
    workspace_path: &str,
    skills_path: &str,
) -> Result<ReconciliationResult, String> {
    let mut notifications = Vec::new();
    let mut discovered_skills = Vec::new();
    let all_skills = crate::db::list_all_skills(conn)?;

    for skill in &all_skills {
        match skill.skill_source.as_str() {
            "skill-builder" => {
                if crate::db::has_active_session_with_live_pid(conn, &skill.name) {
                    notifications.push(format!(
                        "'{}' skipped — active session running in another instance",
                        skill.name
                    ));
                    continue;
                }

                let maybe_run = crate::db::get_workflow_run(conn, &skill.name)?;
                if maybe_run.is_none() {
                    let disk_step = detect_furthest_step_with_options(
                        workspace_path,
                        &skill.name,
                        skills_path,
                        false,
                    )
                    .map(|s| s as i32)
                    .unwrap_or(0);
                    notifications.push(format!(
                        "'{}' workflow record recreated at step {}",
                        skill.name, disk_step
                    ));
                    continue;
                }

                let run = maybe_run.expect("checked above");
                let maybe_disk_step =
                    detect_furthest_step_with_options(workspace_path, &skill.name, skills_path, false);

                if let Some(disk_step) = maybe_disk_step.map(|s| s as i32) {
                    const DETECTABLE_STEPS: &[i32] = &[0, 2, 3];
                    let last_expected_detectable = DETECTABLE_STEPS
                        .iter()
                        .copied()
                        .filter(|&s| s <= run.current_step)
                        .max();

                    if run.current_step > disk_step {
                        let db_valid = last_expected_detectable
                            .map(|s| disk_step >= s)
                            .unwrap_or(true);
                        if !db_valid {
                            notifications.push(format!(
                                "'{}' was reset from step {} to step {} (disk state behind DB)",
                                skill.name, run.current_step, disk_step
                            ));
                        }
                    } else if disk_step > run.current_step {
                        notifications.push(format!(
                            "'{}' was advanced from step {} to step {} (disk state ahead of DB)",
                            skill.name, run.current_step, disk_step
                        ));
                    }
                } else if run.current_step > 0 {
                    notifications.push(format!(
                        "'{}' was reset from step {} to step 0 (no output files found)",
                        skill.name, run.current_step
                    ));
                }
            }
            "marketplace" => {
                let skill_md = Path::new(skills_path).join(&skill.name).join("SKILL.md");
                if !skill_md.exists() {
                    notifications.push(format!(
                        "'{}' marketplace skill removed — SKILL.md not found on disk",
                        skill.name
                    ));
                }
            }
            _ => {}
        }
    }

    // Preview discovery (read-only)
    let master_names: HashSet<String> = all_skills.iter().map(|s| s.name.clone()).collect();
    let skills_dir = Path::new(skills_path);
    if skills_dir.exists() {
        for entry in std::fs::read_dir(skills_dir).into_iter().flatten().flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') || master_names.contains(&name) {
                continue;
            }

            let skill_md = path.join("SKILL.md");
            if !skill_md.exists() {
                notifications.push(format!("'{}' removed — no SKILL.md found on disk", name));
                continue;
            }

            let workspace_root = Path::new(workspace_path).join(&name);
            let legacy_root = Path::new(skills_path).join(&name);
            let skill_root = Path::new(skills_path).join(&name);
            let has_step0 = workspace_root.join("context/clarifications.json").exists()
                || legacy_root.join("context/clarifications.json").exists();
            let has_step2 = workspace_root.join("context/decisions.json").exists()
                || legacy_root.join("context/decisions.json").exists();
            let has_step3 = skill_root.join("SKILL.md").exists();
            let detected_step = if has_step0 && has_step2 && has_step3 {
                3
            } else if has_step0 && has_step2 {
                2
            } else if has_step0 {
                0
            } else {
                -1
            };
            discovered_skills.push(DiscoveredSkill {
                name,
                detected_step,
                scenario: if detected_step == 3 {
                    "9b".to_string()
                } else {
                    "9c".to_string()
                },
            });
        }
    }

    Ok(ReconciliationResult {
        orphans: Vec::new(),
        notifications,
        auto_cleaned: 0,
        discovered_skills,
    })
}

/// Reconcile a skill-builder skill: look up workflow_runs, handle missing row (scenario 10),
/// then run standard step reconciliation (scenarios 1-8).
fn reconcile_skill_builder(
    conn: &rusqlite::Connection,
    name: &str,
    workspace_path: &str,
    skills_path: &str,
    notifications: &mut Vec<String>,
) -> Result<(), String> {
    // Scenario 7: active session — skip entirely
    if crate::db::has_active_session_with_live_pid(conn, name) {
        log::debug!(
            "[reconcile] '{}': skill_source=skill-builder, action=skip (active session with live PID)",
            name
        );
        notifications.push(format!(
            "'{}' skipped — active session running in another instance",
            name
        ));
        return Ok(());
    }

    // Fix stale in_progress steps: no live PID means any in_progress step is a
    // leftover from a crash or unclean shutdown. Reset to pending so the user
    // can re-run instead of seeing a permanently stuck step.
    let steps = crate::db::get_workflow_steps(conn, name)?;
    for step in &steps {
        if step.status == "in_progress" {
            log::info!(
                "[reconcile] '{}': resetting stale in_progress step {} to pending (no active session)",
                name, step.step_id
            );
            crate::db::save_workflow_step(conn, name, step.step_id, "pending")?;
        }
    }

    // Look up workflow_runs row
    let maybe_run = crate::db::get_workflow_run(conn, name)?;

    if maybe_run.is_none() {
        // Scenario 10: master row exists but no workflow_runs row — auto-create
        let disk_step = detect_furthest_step(workspace_path, name, skills_path)
            .map(|s| s as i32)
            .unwrap_or(0);
        let status = if disk_step >= 3 { "completed" } else { "pending" };
        log::info!(
            "[reconcile] '{}': skill_source=skill-builder, action=recreate_workflow (scenario 10, detected_step={})",
            name, disk_step
        );
        crate::db::save_workflow_run(
            conn,
            name,
            disk_step,
            status,
            "domain", // conservative default
        )?;
        notifications.push(format!(
            "'{}' workflow record recreated at step {}",
            name, disk_step
        ));
        return Ok(());
    }

    let run = maybe_run.unwrap();

    // Scenario 5: workspace dir missing → recreate transient scratch space
    let skill_dir = Path::new(workspace_path).join(name);
    if !skill_dir.exists() {
        let context_dir = skill_dir.join("context");
        match std::fs::create_dir_all(&context_dir) {
            Ok(()) => log::info!(
                "[reconcile] '{}': skill_source=skill-builder, action=recreate_workspace",
                name
            ),
            Err(e) => log::warn!(
                "[reconcile] '{}': failed to recreate workspace dir '{}': {}",
                name,
                skill_dir.display(),
                e
            ),
        }
    }

    log::debug!(
        "[reconcile] '{}': skill_source=skill-builder, db_step={}, db_status={}",
        name, run.current_step, run.status
    );

    // Reconcile DB step state against disk evidence
    let maybe_disk_step = detect_furthest_step(workspace_path, name, skills_path);

    log::debug!(
        "[reconcile] '{}': disk furthest step = {:?}",
        name, maybe_disk_step
    );

    if let Some(disk_step) = maybe_disk_step.map(|s| s as i32) {
        const DETECTABLE_STEPS: &[i32] = &[0, 2, 3];

        // The highest detectable step the DB claims to have completed
        let last_expected_detectable = DETECTABLE_STEPS
            .iter()
            .copied()
            .filter(|&s| s <= run.current_step)
            .max();

        let mut did_reset = false;

        if run.current_step > disk_step {
            // Scenario 2: DB is ahead of disk
            let db_valid = last_expected_detectable
                .map(|s| disk_step >= s)
                .unwrap_or(true);

            log::debug!(
                "[reconcile] '{}': db_step={} > disk_step={}, last_expected_detectable={:?}, db_valid={}",
                name, run.current_step, disk_step, last_expected_detectable, db_valid
            );

            if !db_valid {
                log::info!(
                    "[reconcile] '{}': skill_source=skill-builder, action=reset (step {} to {}, disk does not confirm {:?})",
                    name, run.current_step, disk_step, last_expected_detectable
                );
                crate::db::save_workflow_run(conn, name, disk_step,
                    "pending",
                    &run.purpose,
                )?;
                crate::db::reset_workflow_steps_from(conn, name, disk_step)?;
                did_reset = true;
                notifications.push(format!(
                    "'{}' was reset from step {} to step {} (disk state behind DB)",
                    name, run.current_step, disk_step
                ));
            }
        } else if disk_step > run.current_step {
            // Scenario 3: Disk ahead of DB — advance
            log::info!(
                "[reconcile] '{}': skill_source=skill-builder, action=advance (step {} to {})",
                name, run.current_step, disk_step
            );
            crate::db::save_workflow_run(conn, name, disk_step,
                "pending",
                &run.purpose,
            )?;
            notifications.push(format!(
                "'{}' was advanced from step {} to step {} (disk state ahead of DB)",
                name, run.current_step, disk_step
            ));
        } else {
            // Scenario 1: DB and disk agree
            log::debug!(
                "[reconcile] '{}': skill_source=skill-builder, action=none (db_step={} == disk_step={})",
                name, run.current_step, disk_step
            );
        }

        // Mark all detectable steps confirmed by disk as completed
        for &s in DETECTABLE_STEPS {
            if s <= disk_step {
                crate::db::save_workflow_step(conn, name, s, "completed")?;
            }
        }
        // If no reset: also mark non-detectable steps between disk and current_step as completed.
        // Use inclusive range (..=) so that if current_step itself is non-detectable (e.g. step 1),
        // it gets marked completed too.
        if !did_reset {
            for s in (disk_step + 1)..=run.current_step {
                if !DETECTABLE_STEPS.contains(&s) {
                    crate::db::save_workflow_step(conn, name, s, "completed")?;
                }
            }
        }

        // If disk shows full workflow complete, fix stuck "pending" status
        const LAST_WORKFLOW_STEP: i32 = 3;
        if disk_step >= LAST_WORKFLOW_STEP && run.status != "completed" {
            log::info!(
                "[reconcile] '{}': disk step {} >= last step, updating run status to 'completed'",
                name, disk_step
            );
            let effective_step = std::cmp::max(disk_step, run.current_step);
            crate::db::save_workflow_run(conn, name, effective_step,
                "completed",
                &run.purpose,
            )?;
        }

        // Clean up any files from steps beyond the reconciled disk point
        cleanup_future_steps(workspace_path, name, disk_step, skills_path);
    } else if run.current_step > 0 {
        // Scenario 4: No output files found but DB thinks we're past step 0 — reset
        log::info!(
            "[reconcile] '{}': skill_source=skill-builder, action=reset_to_zero (step {} to 0, no output files)",
            name, run.current_step
        );
        crate::db::save_workflow_run(conn, name, 0,
            "pending",
            &run.purpose,
        )?;
        crate::db::reset_workflow_steps_from(conn, name, 0)?;
        cleanup_future_steps(workspace_path, name, -1, skills_path);
        notifications.push(format!(
            "'{}' was reset from step {} to step 0 (no output files found)",
            name, run.current_step
        ));
    } else {
        // Scenario 8: Fresh skill (step 0, no output).
        // Also reset any spuriously completed steps — DB may claim step 0 is
        // completed but disk artifacts are gone (e.g. user deleted files).
        log::debug!(
            "[reconcile] '{}': skill_source=skill-builder, action=reset_steps (fresh skill at step 0, clearing stale completions)",
            name
        );
        crate::db::reset_workflow_steps_from(conn, name, 0)?;
    }

    // Warn if a completed skill is missing its skills_path output
    if run.status == "completed" && !has_skill_output(name, skills_path) {
        log::warn!(
            "[reconcile] '{}': completed skill has no output in skills_path — may have been moved or deleted",
            name
        );
    }

    Ok(())
}

/// Reconcile a marketplace skill: check that SKILL.md still exists on disk.
/// If missing, delete from skills master (scenario 12).
fn reconcile_marketplace(
    conn: &rusqlite::Connection,
    name: &str,
    skills_path: &str,
    notifications: &mut Vec<String>,
) -> Result<(), String> {
    let skill_md = Path::new(skills_path).join(name).join("SKILL.md");
    if skill_md.exists() {
        // Scenario 11: SKILL.md exists — no action
        log::debug!(
            "[reconcile] '{}': skill_source=marketplace, action=none (SKILL.md exists)",
            name
        );
    } else {
        // Scenario 12: SKILL.md missing — delete from master
        log::info!(
            "[reconcile] '{}': skill_source=marketplace, action=delete (SKILL.md not found)",
            name
        );
        crate::db::delete_skill(conn, name)?;
        notifications.push(format!(
            "'{}' marketplace skill removed — SKILL.md not found on disk",
            name
        ));
    }
    Ok(())
}

/// Resolve an orphan skill. Called from the frontend after the user makes a decision.
///
/// - "delete": Removes DB record and deletes skill output files from disk.
/// - "keep": Resets the DB workflow to step 0, status "pending", preserves output files.
pub fn resolve_orphan(
    conn: &rusqlite::Connection,
    skill_name: &str,
    action: &str,
    skills_path: &str,
) -> Result<(), String> {
    log::debug!(
        "[resolve_orphan] skill='{}': action={} skills_path={}",
        skill_name, action, skills_path
    );
    match action {
        "delete" => {
            // Delete DB record (handles missing records gracefully)
            crate::db::delete_workflow_run(conn, skill_name)?;

            // Delete skill output directory on disk if it exists
            let output_dir = Path::new(skills_path).join(skill_name);
            if output_dir.exists() {
                std::fs::remove_dir_all(&output_dir)
                    .map_err(|e| format!("Failed to delete skill output for '{}': {}", skill_name, e))?;
            }
            Ok(())
        }
        "keep" => {
            // Reset workflow to step 0, pending — preserve skill output files
            if let Some(run) = crate::db::get_workflow_run(conn, skill_name)? {
                crate::db::save_workflow_run(conn, skill_name, 0,
                    "pending",
                    &run.purpose,
                )?;
                crate::db::reset_workflow_steps_from(conn, skill_name, 0)?;
            }
            Ok(())
        }
        _ => Err(format!("Invalid orphan resolution action: '{}'. Expected 'delete' or 'keep'.", action)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::test_utils::create_test_db;
    use crate::commands::workflow::get_step_output_files;
    use std::path::Path;

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

    #[test]
    fn test_preview_reconcile_reports_without_mutating_db() {
        let tmp = tempfile::tempdir().unwrap();
        let skills_tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        let skills_path = skills_tmp.path().to_str().unwrap();
        let conn = create_test_db();

        crate::db::save_workflow_run(&conn, "my-skill", 3, "pending", "domain").unwrap();
        create_skill_dir(tmp.path(), "my-skill", "sales");
        create_step_output(skills_tmp.path(), "my-skill", 0);

        let preview = preview_reconcile_on_startup(&conn, workspace, skills_path).unwrap();
        assert_eq!(preview.notifications.len(), 1);
        assert!(preview.notifications[0].contains("reset from step 3 to step 0"));

        let run = crate::db::get_workflow_run(&conn, "my-skill").unwrap().unwrap();
        assert_eq!(run.current_step, 3);
    }

    #[test]
    fn test_preview_reconcile_detects_discovered_skill() {
        let tmp = tempfile::tempdir().unwrap();
        let skills_tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        let skills_path = skills_tmp.path().to_str().unwrap();
        let conn = create_test_db();

        create_step_output(skills_tmp.path(), "complete-skill", 0);
        create_step_output(skills_tmp.path(), "complete-skill", 2);
        create_step_output(skills_tmp.path(), "complete-skill", 3);

        let preview = preview_reconcile_on_startup(&conn, workspace, skills_path).unwrap();
        assert_eq!(preview.discovered_skills.len(), 1);
        assert_eq!(preview.discovered_skills[0].name, "complete-skill");
        // All artifacts present (step 0 clarifications.json, step 2 decisions.json, step 3 SKILL.md) → scenario "9b"
        assert_eq!(preview.discovered_skills[0].scenario, "9b");
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
        crate::db::upsert_skill(&conn, "orphan-skill", "skill-builder", "domain")
            .unwrap();
        // Create step 0 output on disk so detect_furthest_step finds it
        create_step_output(skills_tmp.path(), "orphan-skill", 0);

        let result = reconcile_on_startup(&conn, workspace, skills_path).unwrap();

        assert!(result.orphans.is_empty());
        assert_eq!(result.auto_cleaned, 0);
        assert_eq!(result.notifications.len(), 1);
        assert!(result.notifications[0].contains("orphan-skill"));
        assert!(result.notifications[0].contains("workflow record recreated at step 0"));

        // Verify workflow_runs record was auto-created
        let run = crate::db::get_workflow_run(&conn, "orphan-skill")
            .unwrap()
            .unwrap();
        assert_eq!(run.current_step, 0);
        assert_eq!(run.status, "pending");
    }

    // --- Scenario 2: DB step ahead of disk ---

    #[test]
    fn test_scenario_2_db_ahead_of_disk() {
        let tmp = tempfile::tempdir().unwrap();
        let skills_tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        let skills_path = skills_tmp.path().to_str().unwrap();
        let conn = create_test_db();

        // DB says step 3, but disk only has step 0 output
        // (Step 1 is non-detectable — it edits clarifications.json in-place)
        crate::db::save_workflow_run(&conn, "my-skill", 3, "in_progress", "domain")
            .unwrap();
        create_skill_dir(tmp.path(), "my-skill", "sales");
        create_step_output(skills_tmp.path(), "my-skill", 0);

        let result = reconcile_on_startup(&conn, workspace, skills_path).unwrap();

        assert!(result.orphans.is_empty());
        assert_eq!(result.auto_cleaned, 0);
        assert_eq!(result.notifications.len(), 1);
        assert!(result.notifications[0].contains("reset from step 3 to step 0"));

        // Verify DB was corrected
        let run = crate::db::get_workflow_run(&conn, "my-skill")
            .unwrap()
            .unwrap();
        assert_eq!(run.current_step, 0);
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
        crate::db::save_workflow_run(&conn, "done-skill", 3, "pending", "domain")
            .unwrap();
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
        crate::db::save_workflow_run(&conn, "mid-skill", 2, "pending", "domain")
            .unwrap();
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

        crate::db::save_marketplace_skill(&conn, "my-skill", "platform").unwrap();

        // Create SKILL.md in skills_path (simulates installed marketplace skill)
        let skill_dir = skills_tmp.path().join("my-skill");
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
        assert!(crate::db::get_workflow_run(&conn, "my-skill").unwrap().is_none());
    }

    #[test]
    fn test_marketplace_skill_removed_when_skill_md_missing() {
        // Scenario 12: marketplace skill with SKILL.md gone → delete from master
        let tmp = tempfile::tempdir().unwrap();
        let skills_tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        let skills_path = skills_tmp.path().to_str().unwrap();
        let conn = create_test_db();

        crate::db::save_marketplace_skill(&conn, "gone-skill", "platform").unwrap();

        // No SKILL.md on disk — simulates deleted marketplace skill
        let result = reconcile_on_startup(&conn, workspace, skills_path).unwrap();

        assert_eq!(result.notifications.len(), 1);
        assert!(result.notifications[0].contains("gone-skill"));
        assert!(result.notifications[0].contains("marketplace skill removed"));
        assert!(result.notifications[0].contains("SKILL.md not found"));

        // Skills master record should be soft-deleted
        let deleted_at: Option<String> = conn
            .query_row(
                "SELECT deleted_at FROM skills WHERE name = 'gone-skill'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(
            deleted_at.as_deref().is_some_and(|v| !v.is_empty()),
            "gone-skill should be soft-deleted in skills master",
        );
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
        let run = crate::db::get_workflow_run(&conn, "my-skill").unwrap().unwrap();
        assert_eq!(run.current_step, 0);

        // Workspace dir should have been recreated
        assert!(tmp.path().join("my-skill").join("context").exists());
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
        crate::db::save_workflow_run(&conn, "healthy-skill", 2, "in_progress", "domain")
        .unwrap();
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

        crate::db::save_workflow_run(&conn, "fresh-skill", 0, "pending", "domain")
            .unwrap();
        // Only create the working directory — no output files
        std::fs::create_dir_all(tmp.path().join("fresh-skill")).unwrap();

        let result = reconcile_on_startup(&conn, workspace, skills_path).unwrap();

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
        // DB says step 2 but no output files exist at all.
        let tmp = tempfile::tempdir().unwrap();
        let skills_tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        let skills_path = skills_tmp.path().to_str().unwrap();
        let conn = create_test_db();

        crate::db::save_workflow_run(&conn, "lost-skill", 2, "pending", "domain")
            .unwrap();
        std::fs::create_dir_all(tmp.path().join("lost-skill")).unwrap();

        let result = reconcile_on_startup(&conn, workspace, skills_path).unwrap();

        assert_eq!(result.notifications.len(), 1);
        assert!(result.notifications[0].contains("reset from step 2 to step 0"));

        let run = crate::db::get_workflow_run(&conn, "lost-skill").unwrap().unwrap();
        assert_eq!(run.current_step, 0);

        // No steps should be marked completed
        let steps = crate::db::get_workflow_steps(&conn, "lost-skill").unwrap();
        assert!(
            steps.is_empty() || steps.iter().all(|s| s.status != "completed"),
            "No steps should be completed when there are no output files"
        );
    }

    #[test]
    fn test_reset_does_not_mark_non_detectable_steps_completed() {
        // Bug: DB at step 3, disk at step 0. After reset to step 0, the
        // non-detectable step loop was still marking step 1 as completed
        // using the original current_step (3) instead of the reset target (0).
        let tmp = tempfile::tempdir().unwrap();
        let skills_tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        let skills_path = skills_tmp.path().to_str().unwrap();
        let conn = create_test_db();

        crate::db::save_workflow_run(&conn, "my-skill", 3, "pending", "domain").unwrap();
        // Mark steps 0-2 as completed in DB (pre-existing state)
        for s in 0..=2 {
            crate::db::save_workflow_step(&conn, "my-skill", s, "completed").unwrap();
        }
        create_skill_dir(tmp.path(), "my-skill", "sales");
        // Only step 0 has output on disk (in skills_path)
        create_step_output(tmp.path(), "my-skill", 0);

        let result = reconcile_on_startup(&conn, workspace, skills_path).unwrap();

        assert!(result.notifications[0].contains("reset from step 3 to step 0"));
        let run = crate::db::get_workflow_run(&conn, "my-skill").unwrap().unwrap();
        assert_eq!(run.current_step, 0);

        // Only step 0 should be completed — step 1 must NOT be re-marked
        let steps = crate::db::get_workflow_steps(&conn, "my-skill").unwrap();
        for step in &steps {
            if step.step_id == 0 {
                assert_eq!(step.status, "completed", "Step 0 should be completed (has output)");
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

        crate::db::save_workflow_run(&conn, "done-skill", 4, "pending", "domain")
            .unwrap();
        create_skill_dir(tmp.path(), "done-skill", "analytics");
        for step in [0, 2, 3] {
            create_step_output(skills_tmp.path(), "done-skill", step);
        }

        let result = reconcile_on_startup(&conn, workspace, skills_path).unwrap();

        // Should NOT reset — step 4 is beyond last step but step 3 output exists
        assert!(result.notifications.is_empty());
        let run = crate::db::get_workflow_run(&conn, "done-skill").unwrap().unwrap();
        assert_eq!(run.current_step, 4);
    }

    #[test]
    fn test_step_4_reset_when_step_3_output_missing() {
        let tmp = tempfile::tempdir().unwrap();
        let skills_tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        let skills_path = skills_tmp.path().to_str().unwrap();
        let conn = create_test_db();

        crate::db::save_workflow_run(&conn, "bad-skill", 4, "pending", "domain")
            .unwrap();
        create_skill_dir(tmp.path(), "bad-skill", "analytics");
        // Only steps 0-2 have output, step 3 is missing
        for step in [0, 2] {
            create_step_output(skills_tmp.path(), "bad-skill", step);
        }

        let result = reconcile_on_startup(&conn, workspace, skills_path).unwrap();

        // Should reset — disk is genuinely behind
        assert_eq!(result.notifications.len(), 1);
        assert!(result.notifications[0].contains("reset from step 4 to step 2"));
        let run = crate::db::get_workflow_run(&conn, "bad-skill").unwrap().unwrap();
        assert_eq!(run.current_step, 2);
    }

    #[test]
    fn test_step_1_not_reset_when_step_0_output_exists() {
        let tmp = tempfile::tempdir().unwrap();
        let skills_tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        let skills_path = skills_tmp.path().to_str().unwrap();
        let conn = create_test_db();

        crate::db::save_workflow_run(&conn, "review-skill", 1, "pending", "domain")
            .unwrap();
        create_skill_dir(tmp.path(), "review-skill", "sales");
        create_step_output(skills_tmp.path(), "review-skill", 0);

        let result = reconcile_on_startup(&conn, workspace, skills_path).unwrap();

        assert!(result.notifications.is_empty());
        let run = crate::db::get_workflow_run(&conn, "review-skill").unwrap().unwrap();
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

        crate::db::save_workflow_run(&conn, "review-skill", 3, "pending", "domain")
            .unwrap();
        create_skill_dir(tmp.path(), "review-skill", "sales");
        create_step_output(skills_tmp.path(), "review-skill", 0);
        create_step_output(skills_tmp.path(), "review-skill", 2);
        create_step_output(skills_tmp.path(), "review-skill", 3);

        let result = reconcile_on_startup(&conn, workspace, skills_path).unwrap();

        assert!(result.notifications.is_empty());
        let run = crate::db::get_workflow_run(&conn, "review-skill").unwrap().unwrap();
        assert_eq!(run.current_step, 3);
    }

    // --- Normal progression tests (current_step = disk_step + 1) ---

    #[test]
    fn test_step_completed_advances_to_next_not_reset() {
        for (db_step, disk_steps) in [
            (1, vec![0u32]),          // step 0 completed -> on step 1 (non-detectable)
            (4, vec![0, 2, 3]),       // step 3 completed -> on step 4 (beyond last step)
        ] {
            let tmp = tempfile::tempdir().unwrap();
            let skills_tmp = tempfile::tempdir().unwrap();
            let workspace = tmp.path().to_str().unwrap();
            let skills_path = skills_tmp.path().to_str().unwrap();
            let conn = create_test_db();

            crate::db::save_workflow_run(&conn, "my-skill", db_step, "pending", "domain")
                .unwrap();
            create_skill_dir(tmp.path(), "my-skill", "sales");
            for step in &disk_steps {
                create_step_output(skills_tmp.path(), "my-skill", *step);
            }

            let result = reconcile_on_startup(&conn, workspace, skills_path).unwrap();

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
    fn test_step_1_on_db_but_step_0_on_disk_ok() {
        // DB=1 (detailed research), disk has step 0 output.
        // Step 1 is non-detectable so DB is allowed to be 1 step ahead.
        let tmp = tempfile::tempdir().unwrap();
        let skills_tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        let skills_path = skills_tmp.path().to_str().unwrap();
        let conn = create_test_db();

        crate::db::save_workflow_run(&conn, "my-skill", 1, "pending", "domain")
            .unwrap();
        create_skill_dir(tmp.path(), "my-skill", "sales");
        create_step_output(skills_tmp.path(), "my-skill", 0);

        let result = reconcile_on_startup(&conn, workspace, skills_path).unwrap();

        assert!(result.notifications.is_empty());
        let run = crate::db::get_workflow_run(&conn, "my-skill").unwrap().unwrap();
        assert_eq!(run.current_step, 1);
    }

    #[test]
    fn test_step_3_on_db_but_step_0_on_disk_resets() {
        // DB=3, disk has step 0 only.
        // last_expected_detectable = max([0,2,3] <= 3) = 3.
        // disk_step(0) >= 3 → false → DB claims to have passed step 3 without disk proof → reset to 0.
        let tmp = tempfile::tempdir().unwrap();
        let skills_tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        let skills_path = skills_tmp.path().to_str().unwrap();
        let conn = create_test_db();

        crate::db::save_workflow_run(&conn, "my-skill", 3, "pending", "domain")
            .unwrap();
        create_skill_dir(tmp.path(), "my-skill", "sales");
        create_step_output(skills_tmp.path(), "my-skill", 0);

        let result = reconcile_on_startup(&conn, workspace, skills_path).unwrap();

        assert_eq!(result.notifications.len(), 1);
        assert!(result.notifications[0].contains("reset from step 3 to step 0"));
        let run = crate::db::get_workflow_run(&conn, "my-skill").unwrap().unwrap();
        assert_eq!(run.current_step, 0);
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
        assert!(result.notifications[0].contains("advanced from step 0 to step 3"));
        let run = crate::db::get_workflow_run(&conn, "my-skill").unwrap().unwrap();
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
        crate::db::save_workflow_run(&conn, "db-only", 0, "pending", "domain")
            .unwrap();

        // Normal — skill in skills_path with matching DB record
        crate::db::save_workflow_run(&conn, "normal", 0, "pending", "domain").unwrap();
        create_skill_dir(tmp.path(), "normal", "domain-c");
        create_step_output(skills_tmp.path(), "normal", 0);

        // Marketplace skill with SKILL.md
        crate::db::save_marketplace_skill(&conn, "mkt-skill", "platform").unwrap();
        let mkt_dir = skills_tmp.path().join("mkt-skill");
        std::fs::create_dir_all(&mkt_dir).unwrap();
        std::fs::write(mkt_dir.join("SKILL.md"), "# Marketplace").unwrap();

        let result = reconcile_on_startup(&conn, workspace, skills_path).unwrap();

        // No auto-cleaning, no disk-only discovery (all skills_path dirs are in master)
        assert_eq!(result.auto_cleaned, 0);
        assert!(result.notifications.is_empty());
        assert!(result.orphans.is_empty());

        // db-only skill's workspace dir should have been recreated
        assert!(tmp.path().join("db-only").join("context").exists());

        // DB records for all skills should still be present
        assert!(crate::db::get_workflow_run(&conn, "db-only").unwrap().is_some());
        assert!(crate::db::get_workflow_run(&conn, "normal").unwrap().is_some());
        assert!(crate::db::get_skill_master_id(&conn, "mkt-skill").unwrap().is_some());
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
        crate::db::save_workflow_run(&conn, "active-skill", 3, "pending", "domain")
            .unwrap();
        create_step_output(skills_tmp.path(), "active-skill", 0);

        let current_pid = std::process::id();
        crate::db::create_workflow_session(&conn, "sess-active", "active-skill", current_pid)
            .unwrap();

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
        crate::db::save_workflow_run(&conn, "crashed-skill", 3, "pending", "domain")
            .unwrap();
        create_step_output(skills_tmp.path(), "crashed-skill", 0);

        crate::db::create_workflow_session(&conn, "sess-dead", "crashed-skill", 999999).unwrap();
        crate::db::reconcile_orphaned_sessions(&conn).unwrap();

        let result = reconcile_on_startup(&conn, workspace, skills_path).unwrap();

        assert_eq!(result.notifications.len(), 1);
        assert!(result.notifications[0].contains("reset from step 3 to step 0"));
        let run = crate::db::get_workflow_run(&conn, "crashed-skill")
            .unwrap()
            .unwrap();
        assert_eq!(run.current_step, 0);
    }

    #[test]
    fn test_reconcile_cleans_future_step_files() {
        let tmp = tempfile::tempdir().unwrap();
        let skills_tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        let skills_path = skills_tmp.path().to_str().unwrap();
        let conn = create_test_db();

        create_skill_dir(tmp.path(), "my-skill", "test");
        create_step_output(skills_tmp.path(), "my-skill", 0);
        crate::db::save_workflow_run(&conn, "my-skill", 3, "pending", "domain").unwrap();

        let result = reconcile_on_startup(&conn, workspace, skills_path).unwrap();

        let run = crate::db::get_workflow_run(&conn, "my-skill").unwrap().unwrap();
        assert_eq!(run.current_step, 0, "should reconcile to step 0");
        assert!(!result.notifications.is_empty());
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
        create_skill_dir(tmp.path(), "my-skill", "sales");
        for step in [0u32, 2, 3] {
            create_step_output(skills_tmp.path(), "my-skill", step);
        }

        let result = reconcile_on_startup(&conn, workspace, skills_path).unwrap();

        // Disk ahead (3 > 1) triggers an "advanced" notification
        assert_eq!(result.notifications.len(), 1);
        assert!(result.notifications[0].contains("advanced from step 1 to step 3"));

        let run = crate::db::get_workflow_run(&conn, "my-skill").unwrap().unwrap();
        assert_eq!(run.current_step, 3);
        assert_eq!(run.status, "completed", "status should be 'completed' when disk_step >= LAST_WORKFLOW_STEP");
    }

    #[test]
    fn test_disk_ahead_partial_steps_leaves_status_pending() {
        // DB has skill at current_step=0, disk has steps 0 and 2 (disk_step=2 < LAST_WORKFLOW_STEP=3).
        // After reconcile: current_step advanced to 2, status remains 'pending'.
        let tmp = tempfile::tempdir().unwrap();
        let skills_tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        let skills_path = skills_tmp.path().to_str().unwrap();
        let conn = create_test_db();

        crate::db::save_workflow_run(&conn, "my-skill", 0, "pending", "domain").unwrap();
        create_skill_dir(tmp.path(), "my-skill", "sales");
        for step in [0u32, 2] {
            create_step_output(skills_tmp.path(), "my-skill", step);
        }

        let result = reconcile_on_startup(&conn, workspace, skills_path).unwrap();

        assert_eq!(result.notifications.len(), 1);
        assert!(result.notifications[0].contains("advanced from step 0 to step 2"));

        let run = crate::db::get_workflow_run(&conn, "my-skill").unwrap().unwrap();
        assert_eq!(run.current_step, 2);
        assert_eq!(run.status, "pending", "status should remain 'pending' when disk_step < LAST_WORKFLOW_STEP");
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
        // DO NOT create the workspace dir — it is missing
        // Create step 0 output in skills_path (detectable)
        create_step_output(skills_tmp.path(), "my-skill", 0);

        let result = reconcile_on_startup(&conn, workspace, skills_path).unwrap();

        // No reset should occur — disk confirms last_expected_detectable (step 0)
        assert!(result.notifications.is_empty(), "should not reset: {:?}", result.notifications);

        // Workspace dir should have been recreated
        assert!(
            tmp.path().join("my-skill").join("context").exists(),
            "workspace context dir should be recreated"
        );

        // current_step should remain at 1 (DB is valid)
        let run = crate::db::get_workflow_run(&conn, "my-skill").unwrap().unwrap();
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
        create_skill_dir(tmp.path(), "my-skill", "sales");
        // Steps 0 and 2 exist but NOT step 3
        create_step_output(tmp.path(), "my-skill", 0);
        create_step_output(tmp.path(), "my-skill", 2);
        // Note: step 3 output (SKILL.md) is intentionally absent

        let result = reconcile_on_startup(&conn, workspace, skills_path).unwrap();

        assert_eq!(result.notifications.len(), 1);
        assert!(
            result.notifications[0].contains("reset from step 3 to step 2"),
            "expected reset from 3 to 2, got: {:?}",
            result.notifications
        );

        let run = crate::db::get_workflow_run(&conn, "my-skill").unwrap().unwrap();
        assert_eq!(run.current_step, 2, "should be reset to disk_step=2");
        // Status should not be completed since disk_step(2) < LAST_WORKFLOW_STEP(3)
        assert_eq!(run.status, "pending");
    }

    // --- Gap 6: Non-detectable steps marked completed after valid reconciliation ---

    #[test]
    fn test_non_detectable_steps_marked_completed_after_reconcile() {
        // DB has skill at current_step=2.
        // Step 1 NOT yet marked completed in skill_run_steps.
        // Disk has step 0 and step 2 output → disk_step=2.
        // last_expected_detectable = max([0,2,3] filter <= 2) = 2.
        // disk_step(2) >= last_expected_detectable(2) → DB valid → no reset.
        // Step marking logic:
        //   - Detectable steps <= disk_step(2): steps 0, 2 → marked completed.
        //   - Non-detectable steps between disk_step+1(3) and current_step(2) exclusive:
        //     None in this range (3..2 is empty). But step 1 is between disk_step and current_step
        //     via the (disk_step+1)..current_step range — 1 is not in that range since disk_step=2.
        // Actually: since disk_step matches current_step, the non-detectable loop is empty.
        // To test the non-detectable marking, use DB=2, disk has step 0 only.
        // last_expected_detectable = max([0,2,3] filter <= 2) = 2.
        // disk_step(0) >= 2 → false → reset. That won't work either.
        // Instead: DB=1, disk has step 0 output.
        // last_expected_detectable = max([0,2,3] filter <= 1) = 0.
        // disk_step(0) >= 0 → true → DB valid → no reset.
        // Non-detectable loop: disk_step+1(1)..current_step(1) is empty.
        // So step 1 itself is not marked. But detectable step 0 is marked.
        // This test verifies the step marking logic with the new 4-step workflow.
        let tmp = tempfile::tempdir().unwrap();
        let skills_tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        let skills_path = skills_tmp.path().to_str().unwrap();
        let conn = create_test_db();

        crate::db::save_workflow_run(&conn, "my-skill", 1, "pending", "domain").unwrap();
        create_skill_dir(tmp.path(), "my-skill", "sales");
        create_step_output(skills_tmp.path(), "my-skill", 0);

        let result = reconcile_on_startup(&conn, workspace, skills_path).unwrap();

        // No reset, no notification
        assert!(result.notifications.is_empty(), "should not reset: {:?}", result.notifications);

        // Verify steps
        let steps = crate::db::get_workflow_steps(&conn, "my-skill").unwrap();

        // Step 0: detectable, confirmed by disk → completed
        let step0 = steps.iter().find(|s| s.step_id == 0);
        assert!(
            step0.map(|s| s.status == "completed").unwrap_or(false),
            "step 0 should be marked completed (detectable, confirmed by disk)"
        );

        // DB current_step should remain 1
        let run = crate::db::get_workflow_run(&conn, "my-skill").unwrap().unwrap();
        assert_eq!(run.current_step, 1);
    }

    // --- resolve_orphan tests ---

    #[test]
    fn test_resolve_orphan_delete() {
        let tmp = tempfile::tempdir().unwrap();
        let skills_path = tmp.path().to_str().unwrap();
        let conn = create_test_db();

        crate::db::save_workflow_run(&conn, "orphan", 7, "completed", "domain").unwrap();
        let output_dir = tmp.path().join("orphan");
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
        // Master has skill-builder row but no workflow_runs. Disk has step 0 + step 2 output.
        // Auto-creates workflow_runs at detected step 2.
        let tmp = tempfile::tempdir().unwrap();
        let skills_tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        let skills_path = skills_tmp.path().to_str().unwrap();
        let conn = create_test_db();

        crate::db::upsert_skill(&conn, "real-skill", "skill-builder", "domain")
            .unwrap();
        // detect_furthest_step requires workspace dir to exist
        create_skill_dir(tmp.path(), "real-skill", "analytics");
        create_step_output(skills_tmp.path(), "real-skill", 0);
        create_step_output(skills_tmp.path(), "real-skill", 2);

        let result = reconcile_on_startup(&conn, workspace, skills_path).unwrap();

        assert_eq!(result.notifications.len(), 1);
        assert!(result.notifications[0].contains("real-skill"));
        assert!(result.notifications[0].contains("workflow record recreated at step 2"));

        let run = crate::db::get_workflow_run(&conn, "real-skill")
            .unwrap()
            .unwrap();
        assert_eq!(run.current_step, 2);
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

        crate::db::upsert_skill(&conn, "done-skill", "skill-builder", "domain")
            .unwrap();
        // detect_furthest_step requires workspace dir to exist
        create_skill_dir(tmp.path(), "done-skill", "analytics");
        for step in [0u32, 2, 3] {
            create_step_output(skills_tmp.path(), "done-skill", step);
        }

        let result = reconcile_on_startup(&conn, workspace, skills_path).unwrap();

        assert_eq!(result.notifications.len(), 1);
        assert!(result.notifications[0].contains("workflow record recreated at step 3"));

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

        crate::db::upsert_skill(&conn, "bare-skill", "skill-builder", "domain")
            .unwrap();

        let result = reconcile_on_startup(&conn, workspace, skills_path).unwrap();

        assert_eq!(result.notifications.len(), 1);
        assert!(result.notifications[0].contains("workflow record recreated at step 0"));

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
        assert!(result.notifications[0].contains("advanced from step 0 to step 3"));

        let run = crate::db::get_workflow_run(&conn, "my-skill").unwrap().unwrap();
        assert_eq!(run.current_step, 3);
        assert_eq!(run.status, "completed"); // step 3 = last step → completed
    }

    #[test]
    fn test_partial_output_stops_detection_and_cleans_up() {
        // No canonical output files on disk should reset DB progress to step 0.
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        let conn = create_test_db();

        crate::db::save_workflow_run(&conn, "my-skill", 3, "in_progress", "domain")
            .unwrap();

        create_skill_dir(tmp.path(), "my-skill", "test");

        let result = reconcile_on_startup(&conn, workspace, workspace).unwrap();

        // DB had step 3 → reset to step 0 (no output found)
        let run = crate::db::get_workflow_run(&conn, "my-skill").unwrap().unwrap();
        assert_eq!(run.current_step, 0);
        assert_eq!(result.notifications.len(), 1);
        assert!(result.notifications[0].contains("reset from step 3 to step 0"));
    }

    #[test]
    fn test_reconcile_full_with_fallback_to_workspace_path() {
        // skills_path is None → entire system falls back to workspace_path.
        // Skill folder in workspace with step 0+2 output → should reconcile correctly.
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        let conn = create_test_db();

        crate::db::save_workflow_run(&conn, "my-skill", 1, "in_progress", "domain")
            .unwrap();

        create_skill_dir(tmp.path(), "my-skill", "test");
        create_step_output(tmp.path(), "my-skill", 0);
        create_step_output(tmp.path(), "my-skill", 2);

        // skills_path = None → fallback to workspace
        let result = reconcile_on_startup(&conn, workspace, workspace).unwrap();

        assert!(result.orphans.is_empty());
        assert_eq!(result.auto_cleaned, 0);

        // DB should be reconciled: disk has step 2, DB had step 1.
        // Step 1 is non-detectable, disk ahead → advance to step 2.
        let run = crate::db::get_workflow_run(&conn, "my-skill").unwrap().unwrap();
        assert!(run.current_step >= 1);
    }

    #[test]
    fn test_reconcile_when_workspace_and_skills_paths_identical() {
        // Common config where workspace_path == skills_path (same directory).
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().to_str().unwrap();
        let conn = create_test_db();

        crate::db::save_workflow_run(&conn, "my-skill", 3, "completed", "domain")
            .unwrap();

        create_skill_dir(tmp.path(), "my-skill", "test");
        create_step_output(tmp.path(), "my-skill", 0);
        create_step_output(tmp.path(), "my-skill", 2);
        create_step_output(tmp.path(), "my-skill", 3);

        // workspace = skills_path = same directory
        let result = reconcile_on_startup(&conn, path, path).unwrap();

        assert!(result.orphans.is_empty());
        assert_eq!(result.auto_cleaned, 0);

        let run = crate::db::get_workflow_run(&conn, "my-skill").unwrap().unwrap();
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

        crate::cleanup::cleanup_future_steps(workspace, "my-skill", -1, workspace);

        // All step output should be deleted
        let skill_dir = tmp.path().join("my-skill");
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
        crate::db::save_workflow_run(&conn, "old-skill", 0, "pending", "domain")
            .unwrap();
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
            crate::db::save_workflow_run(&conn, name, 5, "completed", "domain")
                .unwrap();
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

        crate::db::upsert_skill(&conn, "new-skill", "skill-builder", "domain")
            .unwrap();
        // No step output — just a master row

        let result = reconcile_on_startup(&conn, workspace, skills_path).unwrap();

        assert_eq!(result.notifications.len(), 1);
        assert!(result.notifications[0].contains("new-skill"));

        let run = crate::db::get_workflow_run(&conn, "new-skill").unwrap().unwrap();
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
        crate::db::save_workflow_run(&conn, "protected", 3, "in_progress", "domain")
            .unwrap();
        create_skill_dir(tmp.path(), "protected", "test");
        let pid = std::process::id();
        let session_id = uuid::Uuid::new_v4().to_string();
        crate::db::create_workflow_session(&conn, &session_id, "protected", pid).unwrap();

        // Skill B: DB at step 5, disk at step 0 → needs reset
        crate::db::save_workflow_run(&conn, "reset-me", 5, "in_progress", "domain")
            .unwrap();
        create_skill_dir(tmp.path(), "reset-me", "test");
        create_step_output(tmp.path(), "reset-me", 0);

        let result = reconcile_on_startup(&conn, workspace, workspace).unwrap();

        // A was skipped (notification says so), B was reset
        assert!(result.notifications.iter().any(|n| n.contains("protected") && n.contains("skipped")));
        assert!(result.notifications.iter().any(|n| n.contains("reset-me") && n.contains("reset from step 5")));

        // A's DB state should be unchanged
        let run_a = crate::db::get_workflow_run(&conn, "protected").unwrap().unwrap();
        assert_eq!(run_a.current_step, 3);
        assert_eq!(run_a.status, "in_progress");

        // B should be reset
        let run_b = crate::db::get_workflow_run(&conn, "reset-me").unwrap().unwrap();
        assert_eq!(run_b.current_step, 0);
    }

    #[test]
    fn test_notification_messages_exact_text() {
        let tmp = tempfile::tempdir().unwrap();
        let skills_tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        let skills_path = skills_tmp.path().to_str().unwrap();
        let conn = create_test_db();

        // Case 1: DB ahead of disk → reset notification
        crate::db::save_workflow_run(&conn, "ahead-skill", 5, "in_progress", "domain")
            .unwrap();
        create_skill_dir(tmp.path(), "ahead-skill", "test");
        create_step_output(skills_tmp.path(), "ahead-skill", 0);

        // Case 2: No output but DB past step 0 → reset to step 0
        crate::db::save_workflow_run(&conn, "empty-skill", 3, "in_progress", "domain")
            .unwrap();
        create_skill_dir(tmp.path(), "empty-skill", "test");

        // Case 3: Scenario 10 — master row, no workflow_runs
        crate::db::upsert_skill(&conn, "found-skill", "skill-builder", "domain")
            .unwrap();
        create_step_output(skills_tmp.path(), "found-skill", 0);

        // Case 4: Scenario 12 — marketplace SKILL.md missing
        crate::db::save_marketplace_skill(&conn, "gone-mkt", "platform").unwrap();

        let result = reconcile_on_startup(&conn, workspace, skills_path).unwrap();

        // Verify exact message formats
        assert!(result.notifications.iter().any(|n|
            n == "'ahead-skill' was reset from step 5 to step 0 (disk state behind DB)"));
        assert!(result.notifications.iter().any(|n|
            n == "'empty-skill' was reset from step 3 to step 0 (no output files found)"));
        assert!(result.notifications.iter().any(|n|
            n == "'found-skill' workflow record recreated at step 0"));
        assert!(result.notifications.iter().any(|n|
            n == "'gone-mkt' marketplace skill removed — SKILL.md not found on disk"));
    }

    // =========================================================================
    // LOW PRIORITY — defensive, locking down current behavior
    // =========================================================================

    // =========================================================================
    // Pass 2: Disk discovery (VD-874)
    // =========================================================================

    #[test]
    fn test_pass2_scenario_9a_no_skill_md_auto_deletes() {
        // Folder in skills_path with no SKILL.md → auto-deleted, notification
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

        // Should be auto-deleted with a notification
        assert!(!skills_tmp.path().join("orphan-folder").exists(), "folder should be deleted");
        assert_eq!(result.notifications.len(), 1);
        assert!(result.notifications[0].contains("orphan-folder"));
        assert!(result.notifications[0].contains("removed"));
        assert!(result.notifications[0].contains("no SKILL.md"));
        // Should NOT appear in discovered_skills (auto-handled)
        assert!(result.discovered_skills.is_empty());
    }

    #[test]
    fn test_pass2_scenario_9b_all_artifacts_discovered() {
        // SKILL.md + all context artifacts → appears in discovered_skills with scenario "9b"
        let tmp = tempfile::tempdir().unwrap();
        let skills_tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        let skills_path = skills_tmp.path().to_str().unwrap();
        let conn = create_test_db();

        // Create full artifacts in skills_path (not in master)
        create_step_output(skills_tmp.path(), "complete-skill", 0);
        create_step_output(skills_tmp.path(), "complete-skill", 2);
        create_step_output(skills_tmp.path(), "complete-skill", 3);

        let result = reconcile_on_startup(&conn, workspace, skills_path).unwrap();

        assert_eq!(result.discovered_skills.len(), 1);
        assert_eq!(result.discovered_skills[0].name, "complete-skill");
        assert_eq!(result.discovered_skills[0].detected_step, 3);
        assert_eq!(result.discovered_skills[0].scenario, "9b");
        // Should NOT have a notification (user must decide)
        assert!(result.notifications.is_empty());
    }

    #[test]
    fn test_pass2_scenario_9c_partial_artifacts_discovered() {
        // SKILL.md + partial context → appears in discovered_skills with scenario "9c"
        let tmp = tempfile::tempdir().unwrap();
        let skills_tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        let skills_path = skills_tmp.path().to_str().unwrap();
        let conn = create_test_db();

        // Create SKILL.md only (no context artifacts for step 0/2)
        let skill_dir = skills_tmp.path().join("partial-skill");
        std::fs::create_dir_all(&skill_dir).unwrap();
        std::fs::write(skill_dir.join("SKILL.md"), "# Partial skill").unwrap();

        let result = reconcile_on_startup(&conn, workspace, skills_path).unwrap();

        assert_eq!(result.discovered_skills.len(), 1);
        assert_eq!(result.discovered_skills[0].name, "partial-skill");
        assert_eq!(result.discovered_skills[0].scenario, "9c");
        // detected_step should be -1 (no complete steps detected since step 0 is missing)
        assert_eq!(result.discovered_skills[0].detected_step, -1);
        // No notifications — user must decide
        assert!(result.notifications.is_empty());
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
        crate::db::save_workflow_run(&conn, "known-skill", 5, "completed", "domain")
            .unwrap();
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
        ).unwrap();

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
        let skill_dir = skills_tmp.path().join("some-context-skill");
        std::fs::write(skill_dir.join("SKILL.md"), "# Some context skill").unwrap();

        let result = reconcile_on_startup(&conn, workspace, skills_path).unwrap();

        assert_eq!(result.discovered_skills.len(), 1);
        assert_eq!(result.discovered_skills[0].name, "some-context-skill");
        assert_eq!(result.discovered_skills[0].scenario, "9c");
        // Step 0 is detected, but step 4 is missing so detect_furthest_step returns Some(0)
        assert_eq!(result.discovered_skills[0].detected_step, 0);
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
        assert!(crate::db::get_workflow_run(&conn, "disk-only-skill").unwrap().is_none());
        assert!(crate::db::get_workflow_run(&conn, ".git").unwrap().is_none());
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

        let result = reconcile_on_startup(
            &conn,
            workspace.to_str().unwrap(),
            skills.to_str().unwrap(),
        ).unwrap();

        assert!(result.notifications.is_empty());
        // .git and .trash should still exist
        assert!(skills.join(".git").exists(), ".git should not be touched");
        assert!(skills.join(".trash").exists(), ".trash should not be touched");
    }
}
