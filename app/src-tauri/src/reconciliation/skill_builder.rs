use crate::db::workflow_artifacts as db_artifacts;
use crate::fs_validation::has_skill_output;

/// Reconcile a skill-builder skill: look up workflow_runs, handle missing row (scenario 10),
/// then run standard step reconciliation (scenarios 1-8).
pub(crate) fn reconcile_skill_builder(
    conn: &rusqlite::Connection,
    name: &str,
    plugin_slug: &str,
    skills_path: &str,
    notifications: &mut Vec<String>,
) -> Result<(), String> {
    let s_id = crate::db::get_skill_master_id_in_plugin(conn, name, plugin_slug)?
        .ok_or_else(|| format!("Skill '{}' not found in plugin '{}'", name, plugin_slug))?;

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
    let steps = crate::db::get_workflow_steps_by_skill_id(conn, s_id)?;
    for step in &steps {
        if step.status == "in_progress" {
            log::info!(
                "[reconcile] '{}': resetting stale in_progress step {} to pending (no active session)",
                name, step.step_id
            );
            crate::db::save_workflow_step_by_skill_id(conn, s_id, step.step_id, "pending")?;
        }
    }

    // DB consistency reset: skills that were in-progress when VU-1157 merged have
    // current_step > 0 but no rows in the clarifications/decisions tables — their
    // data only ever existed in the now-dead workspace JSON files. Reset them to
    // step 0 so the user can re-run from the beginning.
    if let Some(early_run) = crate::db::get_workflow_run_by_skill_id(conn, s_id)? {
        if early_run.status != "completed" && early_run.current_step > 0 {
            // current_step > 0 already guarantees >= 1; check clarifications unconditionally.
            let skill_id_str = s_id.to_string();
            let has_clarifications = db_artifacts::read_clarifications(conn, &skill_id_str)
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
                let has_decisions = db_artifacts::read_decisions(conn, &skill_id_str)
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
    let maybe_run = crate::db::get_workflow_run_by_skill_id(conn, s_id)?;

    if maybe_run.is_none() {
        log::warn!(
            "[reconcile] '{}': workflow_runs row missing; leaving tracked skill unchanged until an explicit repair flow handles it",
            name
        );
        return Ok(());
    }

    let run = maybe_run.unwrap();

    log::debug!(
        "[reconcile] '{}': skill_source=skill-builder, db_step={}, db_status={}",
        name,
        run.current_step,
        run.status
    );

    // Warn if a completed skill is missing its skills_path output
    if run.status == "completed" && !has_skill_output(plugin_slug, name, skills_path) {
        log::warn!(
            "[reconcile] '{}': completed skill has no output in skills_path — may have been moved or deleted",
            name
        );
        notifications.push(format!(
            "'{}' is missing published skill content and will fail when a feature tries to use it",
            name
        ));
    }

    Ok(())
}
