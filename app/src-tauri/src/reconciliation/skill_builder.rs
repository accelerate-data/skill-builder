use crate::cleanup::cleanup_future_steps;
use crate::db::workflow_artifacts as db_artifacts;
use crate::fs_validation::{detect_furthest_step, has_skill_output};
use std::path::Path;

/// Reconcile a skill-builder skill: look up workflow_runs, handle missing row (scenario 10),
/// then run standard step reconciliation (scenarios 1-8).
pub(crate) fn reconcile_skill_builder(
    conn: &rusqlite::Connection,
    name: &str,
    plugin_slug: &str,
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

    // DB consistency reset: skills that were in-progress when VU-1157 merged have
    // current_step > 0 but no rows in the clarifications/decisions tables — their
    // data only ever existed in the now-dead workspace JSON files. Reset them to
    // step 0 so the user can re-run from the beginning.
    if let Some(early_run) = crate::db::get_workflow_run(conn, name)? {
        if early_run.status != "completed" && early_run.current_step > 0 {
            // current_step > 0 already guarantees >= 1; check clarifications unconditionally.
            let has_clarifications = db_artifacts::read_clarifications(conn, name)
                .map_err(|e| e.to_string())?
                .is_some();
            if !has_clarifications {
                log::info!(
                    "[reconcile] '{}': resetting step {} → 0 (clarifications missing from DB)",
                    name,
                    early_run.current_step
                );
                crate::db::save_workflow_run(conn, name, 0, "pending", &early_run.purpose)?;
                notifications.push(format!(
                    "'{}' was reset from step {} to step 1 (DB artifact data missing — re-run required)",
                    name,
                    early_run.current_step + 1
                ));
            } else if early_run.current_step >= 3 {
                let has_decisions = db_artifacts::read_decisions(conn, name)
                    .map_err(|e| e.to_string())?
                    .is_some();
                if !has_decisions {
                    log::info!(
                        "[reconcile] '{}': resetting step {} → 0 (decisions missing from DB)",
                        name,
                        early_run.current_step
                    );
                    crate::db::save_workflow_run(conn, name, 0, "pending", &early_run.purpose)?;
                    notifications.push(format!(
                        "'{}' was reset from step {} to step 1 (DB artifact data missing — re-run required)",
                        name,
                        early_run.current_step + 1
                    ));
                }
            }
        }
    }

    // Look up workflow_runs row
    let maybe_run = crate::db::get_workflow_run(conn, name)?;

    if maybe_run.is_none() {
        // Scenario 10: master row exists but no workflow_runs row — auto-create.
        // Check both DB artifact rows and filesystem for step detection.
        let has_decisions = db_artifacts::read_decisions(conn, name)
            .map(|opt| opt.is_some())
            .unwrap_or(false);
        let has_skill_md =
            detect_furthest_step(workspace_path, plugin_slug, name, skills_path).is_some();

        let disk_step: i32 = if has_skill_md {
            3
        } else if has_decisions {
            2
        } else {
            0
        };
        let status = if disk_step >= 3 {
            "completed"
        } else {
            "pending"
        };
        log::info!(
            "[reconcile] '{}': skill_source=skill-builder, action=recreate_workflow (scenario 10, detected_step={})",
            name, disk_step
        );
        crate::db::save_workflow_run(
            conn, name, disk_step, status, "domain", // conservative default
        )?;
        notifications.push(format!(
            "'{}' workflow record recreated at step {}",
            name,
            disk_step + 1
        ));
        return Ok(());
    }

    let run = maybe_run.unwrap();

    // Scenario 5: canonical skill dir missing → recreate
    let skill_dir = match crate::skill_paths::ensure_nested_skill_dir(
        Path::new(skills_path),
        plugin_slug,
        name,
    ) {
        Ok(d) => d,
        Err(e) => {
            log::warn!("[reconcile] '{}': failed to ensure skill dir: {}", name, e);
            return Ok(());
        }
    };
    if !skill_dir.exists() {
        match std::fs::create_dir_all(&skill_dir) {
            Ok(()) => log::info!(
                "[reconcile] '{}': skill_source=skill-builder, action=recreate_skill_dir",
                name
            ),
            Err(e) => log::warn!(
                "[reconcile] '{}': failed to recreate skill dir '{}': {}",
                name,
                skill_dir.display(),
                e
            ),
        }
    }

    log::debug!(
        "[reconcile] '{}': skill_source=skill-builder, db_step={}, db_status={}",
        name,
        run.current_step,
        run.status
    );

    // Reconcile DB step state against disk evidence
    let maybe_disk_step = detect_furthest_step(workspace_path, plugin_slug, name, skills_path);

    log::debug!(
        "[reconcile] '{}': disk furthest step = {:?}",
        name,
        maybe_disk_step
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
                crate::db::save_workflow_run(conn, name, disk_step, "pending", &run.purpose)?;
                crate::db::reset_workflow_steps_from(conn, name, disk_step)?;
                did_reset = true;
                notifications.push(format!(
                    "'{}' was reset from step {} to step {} (disk state behind DB)",
                    name,
                    run.current_step + 1,
                    disk_step + 1
                ));
            }
        } else if disk_step > run.current_step {
            // Scenario 3: Disk ahead of DB — advance
            log::info!(
                "[reconcile] '{}': skill_source=skill-builder, action=advance (step {} to {})",
                name,
                run.current_step,
                disk_step
            );
            crate::db::save_workflow_run(conn, name, disk_step, "pending", &run.purpose)?;
            notifications.push(format!(
                "'{}' was advanced from step {} to step {} (disk state ahead of DB)",
                name,
                run.current_step + 1,
                disk_step + 1
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
                name,
                disk_step
            );
            let effective_step = std::cmp::max(disk_step, run.current_step);
            crate::db::save_workflow_run(conn, name, effective_step, "completed", &run.purpose)?;
        }

        // Clean up any files from steps beyond the reconciled disk point
        cleanup_future_steps(workspace_path, name, plugin_slug, disk_step, skills_path);
    } else if run.current_step >= 3 {
        // Scenario 4: DB says step 3+ but no SKILL.md on disk — reset to step 2.
        // Steps 0-2 are DB-authoritative; their data is still in the DB.
        // Only SKILL.md is filesystem-based, so a missing SKILL.md means step 3
        // needs to re-run, but prior steps remain valid.
        log::info!(
            "[reconcile] '{}': skill_source=skill-builder, action=reset_to_step2 (step {} to 2, SKILL.md not found)",
            name, run.current_step
        );
        crate::db::save_workflow_run(conn, name, 2, "pending", &run.purpose)?;
        crate::db::reset_workflow_steps_from(conn, name, 3)?;
        cleanup_future_steps(workspace_path, name, plugin_slug, 2, skills_path);
        notifications.push(format!(
            "'{}' was reset from step {} to step 3 (SKILL.md not found)",
            name,
            run.current_step + 1
        ));
    } else {
        // Scenario 8: current_step < 3, no SKILL.md on disk.
        // Steps 0-2 are fully DB-authoritative — their completion status lives in
        // workflow_steps, not on disk. Nothing to do; trust the DB.
        log::debug!(
            "[reconcile] '{}': skill_source=skill-builder, action=none (steps 0-2 are DB-authoritative, step={})",
            name, run.current_step
        );
    }

    // Warn if a completed skill is missing its skills_path output
    if run.status == "completed" && !has_skill_output(plugin_slug, name, skills_path) {
        log::warn!(
            "[reconcile] '{}': completed skill has no output in skills_path — may have been moved or deleted",
            name
        );
    }

    Ok(())
}
