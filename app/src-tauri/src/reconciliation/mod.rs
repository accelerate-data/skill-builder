mod marketplace;
mod skill_builder;

use crate::fs_validation::{detect_furthest_step, detect_furthest_step_with_options};
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
                skill_builder::reconcile_skill_builder(
                    conn,
                    &skill.name,
                    workspace_path,
                    skills_path,
                    &mut notifications,
                )?;
            }
            "marketplace" => {
                marketplace::reconcile_marketplace(conn, &skill.name, skills_path, &mut notifications)?;
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
                    skill.name,
                    other
                );
            }
        }
    }

    // ── Pass 2: Discover skills on disk not in master ──
    let master_names: HashSet<String> = all_skills.iter().map(|s| s.name.clone()).collect();
    let mut discovered_skills = Vec::new();
    let skills_dir = Path::new(skills_path);
    if skills_dir.exists() {
        for entry in std::fs::read_dir(skills_dir)
            .into_iter()
            .flatten()
            .flatten()
        {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') {
                continue;
            } // skip dotfiles

            // Already in master? Skip.
            if master_names.contains(&name) {
                continue;
            }

            let skill_md = path.join("SKILL.md");
            log::debug!("[reconcile] '{}': discovered on disk, not in master", name);

            if !skill_md.exists() {
                // Scenario 9a: folder with no SKILL.md -> auto-delete, notify
                // Guard against symlinks that resolve outside skills_path
                let safe_to_delete = std::fs::canonicalize(skills_dir)
                    .and_then(|canon_base| {
                        std::fs::canonicalize(&path)
                            .map(|canon_path| canon_path.starts_with(canon_base))
                    })
                    .unwrap_or(false);
                if !safe_to_delete {
                    log::warn!(
                        "[reconcile] '{}': skipping delete — path escapes skills_path",
                        name
                    );
                    continue;
                }
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
                    log::info!(
                        "[reconcile] '{}': full artifacts found (step 3), prompting user",
                        name
                    );
                    discovered_skills.push(DiscoveredSkill {
                        name: name.clone(),
                        detected_step: 3,
                        scenario: "9b".to_string(),
                    });
                } else {
                    // Scenario 9c: SKILL.md + partial/no context -> user choice
                    log::info!(
                        "[reconcile] '{}': partial artifacts (step {}), prompting user",
                        name,
                        detected_step
                    );
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
    let discovered_names: HashSet<String> =
        discovered_skills.iter().map(|d| d.name.clone()).collect();
    if skills_dir.exists() {
        let trash_dir = skills_dir.join(".trash");
        for entry in std::fs::read_dir(skills_dir)
            .into_iter()
            .flatten()
            .flatten()
        {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') {
                continue;
            } // skip dotfiles, .git, .trash

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
                                log::debug!(
                                    "[reconcile] '{}': git rm --cached: {}",
                                    name,
                                    String::from_utf8_lossy(&out.stderr).trim()
                                );
                            }
                            Err(e) => {
                                log::debug!(
                                    "[reconcile] '{}': git rm --cached failed: {}",
                                    name,
                                    e
                                );
                            }
                        }
                        log::info!(
                            "[reconcile] '{}': moved to .trash (not in skills master)",
                            name
                        );
                        notifications.push(format!(
                            "'{}' moved to .trash — not in skills catalog",
                            name
                        ));
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
            if let Ok(mut f) = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&gitignore)
            {
                let _ = writeln!(f, ".trash/");
                log::debug!("[reconcile] added .trash/ to .gitignore");
            }
        }
    }

    // Commit any git index changes from Pass 3 (removals + .gitignore update)
    if let Err(e) = crate::git::commit_all(skills_dir, "reconcile: move orphaned folders to .trash")
    {
        log::debug!("[reconcile] git commit after pass 3: {}", e);
    }

    log::info!(
        "[reconcile_on_startup] done: {} auto-cleaned, {} notifications, {} discovered",
        0,
        notifications.len(),
        discovered_skills.len()
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
                        skill.name,
                        disk_step + 1
                    ));
                    continue;
                }

                let run = maybe_run.expect("checked above");
                let maybe_disk_step = detect_furthest_step_with_options(
                    workspace_path,
                    &skill.name,
                    skills_path,
                    false,
                );

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
                                skill.name,
                                run.current_step + 1,
                                disk_step + 1
                            ));
                        }
                    } else if disk_step > run.current_step {
                        notifications.push(format!(
                            "'{}' was advanced from step {} to step {} (disk state ahead of DB)",
                            skill.name,
                            run.current_step + 1,
                            disk_step + 1
                        ));
                    }
                } else if run.current_step > 0 {
                    notifications.push(format!(
                        "'{}' was reset from step {} to step 1 (no output files found)",
                        skill.name,
                        run.current_step + 1
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
        for entry in std::fs::read_dir(skills_dir)
            .into_iter()
            .flatten()
            .flatten()
        {
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
        skill_name,
        action,
        skills_path
    );
    match action {
        "delete" => {
            // Reject names that could escape skills_path via path traversal
            crate::commands::imported_skills::validate_skill_name(skill_name)?;

            // Delete DB record (handles missing records gracefully)
            crate::db::delete_workflow_run(conn, skill_name)?;

            // Delete skill output directory on disk if it exists
            let output_dir = Path::new(skills_path).join(skill_name);
            if output_dir.exists() {
                let canonical_base = std::fs::canonicalize(skills_path)
                    .map_err(|e| format!("Failed to canonicalize skills_path: {}", e))?;
                let canonical_target = std::fs::canonicalize(&output_dir)
                    .map_err(|e| format!("Failed to canonicalize output_dir: {}", e))?;
                if !canonical_target.starts_with(&canonical_base) {
                    return Err(format!(
                        "Path traversal attempt for skill '{}'",
                        skill_name
                    ));
                }
                std::fs::remove_dir_all(&output_dir).map_err(|e| {
                    format!("Failed to delete skill output for '{}': {}", skill_name, e)
                })?;
            }
            Ok(())
        }
        "keep" => {
            // Reset workflow to step 0, pending — preserve skill output files
            if let Some(run) = crate::db::get_workflow_run(conn, skill_name)? {
                crate::db::save_workflow_run(conn, skill_name, 0, "pending", &run.purpose)?;
                crate::db::reset_workflow_steps_from(conn, skill_name, 0)?;
            }
            Ok(())
        }
        _ => Err(format!(
            "Invalid orphan resolution action: '{}'. Expected 'delete' or 'keep'.",
            action
        )),
    }
}

#[cfg(test)]
mod tests;
