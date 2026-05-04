mod agents;
mod cleanup;
mod commands;
pub mod contracts;
mod db;
mod fs_utils;
mod fs_validation;
pub mod generated;
pub mod git;
mod logging;
mod marketplace_manifest;
mod reconciliation;
mod skill_paths;
mod types;

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
pub use types::*;

const LEGACY_APP_DATA_DIR_NAME: &str = "com.skillbuilder.app";

#[derive(Clone)]
pub struct InstanceInfo {
    pub id: String,
    pub pid: u32,
}

#[derive(Clone)]
pub struct DataDir(pub PathBuf);

pub struct CloseGuardState {
    allow_exit: AtomicBool,
}

impl Default for CloseGuardState {
    fn default() -> Self {
        Self {
            allow_exit: AtomicBool::new(false),
        }
    }
}

impl CloseGuardState {
    pub fn allow_exit(&self) {
        self.allow_exit.store(true, Ordering::SeqCst);
    }

    pub fn is_exit_allowed(&self) -> bool {
        self.allow_exit.load(Ordering::SeqCst)
    }
}

async fn shutdown_openhands_agent_server_for_exit() {
    if let Err(e) = crate::agents::openhands_server::process::shutdown_agent_server().await {
        log::warn!("[exit] OpenHands Agent Server shutdown failed: {e}");
    }
}

fn dir_is_empty(path: &Path) -> Result<bool, io::Error> {
    Ok(fs::read_dir(path)?.next().is_none())
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), io::Error> {
    crate::fs_utils::copy_dir_recursive(src, dst).map_err(io::Error::other)
}

/// One-time migration from historical app-local dir to the current bundle identifier path.
/// This runs before DB/workspace init so existing user state is preserved after identifier changes.
fn migrate_legacy_app_data_dir(new_data_dir: &Path) {
    let Some(parent) = new_data_dir.parent() else {
        log::warn!(
            "[startup] Could not resolve app data dir parent for migration: {}",
            new_data_dir.display()
        );
        return;
    };

    let legacy_data_dir = parent.join(LEGACY_APP_DATA_DIR_NAME);
    if !legacy_data_dir.exists() {
        return;
    }

    if new_data_dir.exists() {
        match dir_is_empty(new_data_dir) {
            Ok(false) => {
                log::info!(
                    "[startup] Skipping legacy app-data migration; target already has data: {}",
                    new_data_dir.display()
                );
                return;
            }
            Ok(true) => {
                if let Err(e) = fs::remove_dir_all(new_data_dir) {
                    log::warn!(
                        "[startup] Failed to clear empty target dir before migration {}: {}",
                        new_data_dir.display(),
                        e
                    );
                    return;
                }
            }
            Err(e) => {
                log::warn!(
                    "[startup] Failed to inspect target dir before migration {}: {}",
                    new_data_dir.display(),
                    e
                );
                return;
            }
        }
    }

    match fs::rename(&legacy_data_dir, new_data_dir) {
        Ok(()) => {
            log::info!(
                "[startup] Migrated legacy app-local data directory from {} to {}",
                legacy_data_dir.display(),
                new_data_dir.display()
            );
        }
        Err(rename_err) => {
            log::warn!(
                "[startup] Rename migration failed ({} -> {}): {}; trying copy+remove fallback",
                legacy_data_dir.display(),
                new_data_dir.display(),
                rename_err
            );
            match copy_dir_recursive(&legacy_data_dir, new_data_dir) {
                Ok(()) => match fs::remove_dir_all(&legacy_data_dir) {
                    Ok(()) => {
                        log::info!(
                            "[startup] Migrated legacy app-local data directory via copy+remove fallback"
                        );
                    }
                    Err(remove_err) => {
                        log::warn!(
                            "[startup] Copied legacy app-local data but failed to remove old dir {}: {}",
                            legacy_data_dir.display(),
                            remove_err
                        );
                    }
                },
                Err(copy_err) => {
                    log::warn!(
                        "[startup] Legacy app-local data migration failed during copy ({} -> {}): {}",
                        legacy_data_dir.display(),
                        new_data_dir.display(),
                        copy_err
                    );
                }
            }
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(logging::build_log_plugin().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            use tauri::Manager;

            // Native app menu with About item (macOS only)
            #[cfg(target_os = "macos")]
            {
                use tauri::menu::{AboutMetadata, MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
                let icon = app.default_window_icon().cloned();
                let about = PredefinedMenuItem::about(
                    app,
                    Some("About Skill Builder"),
                    Some(AboutMetadata {
                        name: Some("Skill Builder".to_string()),
                        version: Some(app.config().version.clone().unwrap_or_default()),
                        copyright: Some(format!("© {} Accelerate Data, Inc.", chrono::Utc::now().format("%Y"))),
                        credits: Some("Built with Tauri, Claude Agent SDK, and React\n\nPowered by Claude from Anthropic\n\nLicense terms: https://github.com/hbanerjee74/skill-builder/blob/main/LICENSE".to_string()),
                        icon,
                        ..Default::default()
                    }),
                )?;

                let quit_item = MenuItemBuilder::with_id("graceful-quit", "Quit Skill Builder")
                    .accelerator("CmdOrCtrl+Q")
                    .build(app)?;

                let app_submenu = SubmenuBuilder::new(app, "Skill Builder")
                    .item(&about)
                    .separator()
                    .services()
                    .separator()
                    .hide()
                    .hide_others()
                    .show_all()
                    .separator()
                    .item(&quit_item)
                    .build()?;

                let edit_submenu = SubmenuBuilder::new(app, "Edit")
                    .undo()
                    .redo()
                    .separator()
                    .cut()
                    .copy()
                    .paste()
                    .select_all()
                    .build()?;

                let close_window_item = MenuItemBuilder::with_id("graceful-close", "Close Window")
                    .accelerator("CmdOrCtrl+W")
                    .build(app)?;

                let window_submenu = SubmenuBuilder::new(app, "Window")
                    .minimize()
                    .maximize()
                    .separator()
                    .fullscreen()
                    .item(&close_window_item)
                    .build()?;

                let menu = MenuBuilder::new(app)
                    .item(&app_submenu)
                    .item(&edit_submenu)
                    .item(&window_submenu)
                    .build()?;

                app.set_menu(menu)?;
            }

            // Truncate the log file now that the Tauri path resolver is available.
            // Uses app_log_dir() so the path always matches the log plugin's target.
            logging::truncate_log_file(app.handle());

            let data_dir = app
                .path()
                .app_local_data_dir()
                .expect("failed to resolve app_local_data_dir");
            migrate_legacy_app_data_dir(&data_dir);
            std::fs::create_dir_all(&data_dir).expect("failed to create data directory");
            app.manage(DataDir(data_dir.clone()));

            let db = db::init_db(&data_dir).expect("failed to initialize database");
            app.manage(db);

            let instance_info = InstanceInfo {
                id: uuid::Uuid::new_v4().to_string(),
                pid: std::process::id(),
            };
            log::info!("Instance ID: {}, PID: {}", instance_info.id, instance_info.pid);
            app.manage(instance_info);

            // Apply persisted log level setting (fall back to info if DB read fails).
            {
                let db_state = app.state::<db::Db>();
                let conn = db_state.0.lock().expect("failed to lock db for settings");
                match db::read_settings(&conn) {
                    Ok(settings) => {
                        logging::set_log_level(&settings.log_level);
                        log::info!("Log level: {}", settings.log_level);
                        log::info!("Skills path: {}", settings.skills_path.as_deref().unwrap_or("(not configured)"));

                    }
                    Err(e) => {
                        logging::set_log_level("info");
                        log::warn!("Failed to read settings for log level, defaulting to info: {}", e);
                    }
                }
            }

            log::info!("Skill Builder starting up");

            // Initialize workspace directory and deploy bundled prompts
            let db_state = app.state::<db::Db>();
            let handle = app.handle().clone();
            let workspace_path = commands::workspace::init_workspace(&handle, &db_state, &data_dir)
                .expect("failed to initialize workspace");

            // Prune old transcript files before any agents are spawned.
            // Non-fatal: errors are logged as warnings and startup continues.
            logging::prune_transcript_files(&workspace_path);

            // Start the sidecar pool's idle cleanup task via Tauri's async runtime.
            // setup() runs on the main macOS thread which is not a Tokio thread.
            let pool = app.state::<agents::sidecar_pool::SidecarPool>();
            pool.start_on_tauri_runtime();

            Ok(())
        })
        .manage(agents::sidecar_pool::SidecarPool::new())
        .manage(CloseGuardState::default())
        .manage(commands::refine::RefineSessionManager::new())
        .manage(commands::workflow::runtime::WorkflowStepRunManager::new())
        .manage(commands::description::DescriptionProcessState::new())
        .invoke_handler(tauri::generate_handler![
            commands::agent::start_agent,
            commands::node::check_node,
            commands::node::check_startup_deps,
            commands::settings::get_data_dir,
            commands::settings::get_settings,
            commands::settings::save_settings,
            commands::settings::update_user_settings,
            commands::settings::update_github_identity,
            commands::api_validation::test_api_key,
            commands::api_validation::test_model_connection,
            commands::api_validation::list_models,
            commands::lifecycle::set_log_level,
            commands::lifecycle::get_log_file_path,
            commands::lifecycle::log_frontend,
            commands::settings::get_default_skills_path,
            commands::skill::list_skills,
            commands::skill::create_skill,
            commands::skill::delete_skill,
            commands::skill::update_skill_metadata,
            commands::skill::rename_skill,
            commands::skill::generate_suggestions,
            commands::skill::review_skill_scope,
            commands::skill::get_all_tags,
            commands::skill::acquire_lock,
            commands::skill::release_lock,
            commands::skill::get_externally_locked_skills,
            commands::skill::export_skill_as_file,
            commands::files::list_skill_files,
            commands::files::read_file,
            commands::files::write_file,
            commands::workflow::runtime::run_workflow_step,
            commands::workflow::output_format::materialize_workflow_step_output,
            commands::workflow::evaluation::reset_workflow_step,
            commands::workflow::evaluation::navigate_back_to_step,
            commands::workflow::evaluation::preview_step_reset,
            commands::workflow::evaluation::get_workflow_state,
            commands::workflow::evaluation::save_workflow_state,
            commands::workflow::evaluation::verify_step_output,
            commands::workflow::evaluation::get_disabled_steps,
            commands::workflow::evaluation::get_clarifications_content,
            commands::workflow::evaluation::save_clarifications_content,
            commands::workflow::evaluation::get_decisions_content,
            commands::workflow::evaluation::save_decisions_content,
            commands::workflow::evaluation::get_context_file_content,
            commands::workflow::runtime::run_answer_evaluator,
            commands::workflow::output_format::materialize_answer_evaluation_output,
            commands::workflow::runtime::log_gate_decision,
            commands::workflow::runtime::cancel_workflow_step,
            commands::sidecar_lifecycle::cleanup_skill_sidecar,
            commands::sidecar_lifecycle::graceful_shutdown,
            commands::sidecar_lifecycle::allow_app_exit,
            commands::workspace::get_workspace_path,
            commands::workspace::clear_workspace,
            commands::reconciliation::reconcile_startup,
            commands::reconciliation::record_reconciliation_cancel,
            commands::reconciliation::resolve_orphan,
            commands::reconciliation::resolve_discovery,
            commands::workflow_session::create_workflow_session,
            commands::workflow_session::end_workflow_session,
            commands::imported_skills::listing::list_imported_skills,
            commands::imported_skills::lifecycle::delete_imported_skill,
            commands::imported_skills::lifecycle::list_plugins,
            commands::imported_skills::lifecycle::delete_plugin,
            commands::imported_skills::lifecycle::create_plugin_from_skills,
            commands::imported_skills::lifecycle::move_skill_to_plugin,
            commands::imported_skills::lifecycle::remove_skill_from_plugin,
            commands::imported_skills::lifecycle::set_plugin_upgrade_lock,
            commands::feedback::create_github_issue,
            commands::github_import::url::parse_github_url,
            commands::github_import::commands::check_marketplace_url,
            commands::github_import::commands::list_github_plugins,
            commands::github_import::commands::list_github_skills,
            commands::github_auth::github_start_device_flow,
            commands::github_auth::github_poll_for_token,
            commands::github_auth::github_get_user,
            commands::github_auth::github_logout,
            commands::github_import::commands::import_marketplace_to_library,
            commands::github_import::commands::import_marketplace_plugin_to_library,
            commands::github_import::commands::get_dashboard_skill_names,
            commands::github_import::updates::check_marketplace_updates,
            commands::github_import::commands::check_skill_customized,
            commands::usage::get_usage_summary,
            commands::usage::get_usage_by_step,
            commands::usage::get_usage_by_model,
            commands::usage::reset_usage,
            commands::usage::get_recent_workflow_sessions,
            commands::usage::get_step_agent_runs,
            commands::usage::get_agent_runs,
            commands::usage::get_usage_by_day,
            commands::usage::get_workflow_skill_names,
            commands::git::get_skill_history,
            commands::git::restore_skill_version,
            commands::git::get_skill_files_at_sha,
            commands::refine::content::get_skill_content_at_path,
            commands::refine::content::get_skill_content_for_refine,
            commands::refine::start_refine_session,
            commands::refine::send_refine_message,
            commands::refine::cancel_refine_turn,
            commands::refine::cancel_agent_run,
            commands::refine::close_refine_session,
            commands::refine::output::finalize_refine_run,
            commands::refine::output::clean_benchmark_snapshot,
            commands::workflow::evaluation::read_latest_benchmark,
            commands::imported_skills::upload::parse_skill_file,
            commands::imported_skills::upload::import_skill_from_file,
            commands::evals::list_test_cases,
            commands::evals::save_test_case,
            commands::evals::delete_test_case,
            commands::evals::list_iterations,
            commands::evals::create_next_iteration_dir,
            commands::evals::materialize_eval_benchmark,
            commands::evals::read_iteration_result,
            commands::evals::read_grading,
            commands::evals::read_skill_context_for_eval_gen,
            commands::evals::read_pending_eval,
            commands::evals::discard_pending_eval,
            commands::evals::build_eval_prompt,
            commands::evals::build_eval_gen_prompt,
            commands::description::start_generate_desc_evals,
            commands::description::run_optimization_loop,
            commands::description::apply_description,
            commands::description::save_eval_queries,
            commands::description::load_eval_queries,
            commands::description::cancel_description_optimization,
            commands::description::write_desc_opt_log,
            commands::documents::list_documents,
            commands::documents::list_skills_for_documents,
            commands::documents::add_document_file,
            commands::documents::add_document_url,
            commands::documents::add_document_folder,
            commands::documents::update_document,
            commands::documents::delete_document,
        ])
        .on_window_event(|window, event| {
            use tauri::{Emitter, Manager};
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let close_guard = window.state::<CloseGuardState>();
                if close_guard.is_exit_allowed() {
                    log::debug!("close-guard: WindowEvent::CloseRequested allowed");
                    return;
                }
                log::debug!("close-guard: WindowEvent::CloseRequested intercepted, emitting close-requested");
                api.prevent_close();
                let _ = window.emit("close-requested", ());
            }
        })
        .on_menu_event(|app_handle, event| {
            use tauri::Manager;
            use tauri::Emitter;
            let id = event.id().0.as_str();
            if id == "graceful-quit" || id == "graceful-close" {
                log::debug!("close-guard: menu item '{}' triggered, emitting close-requested", id);
                if let Some(window) = app_handle.get_webview_window("main") {
                    let _ = window.emit("close-requested", ());
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            use tauri::{Emitter, Manager};

            match event {
            tauri::RunEvent::ExitRequested { api, .. } => {
                let close_guard = app_handle.state::<CloseGuardState>();
                if close_guard.is_exit_allowed() {
                    log::debug!("close-guard: RunEvent::ExitRequested allowed");
                    return;
                }

                log::debug!("close-guard: RunEvent::ExitRequested intercepted, emitting close-requested");
                api.prevent_exit();
                if let Some(window) = app_handle.get_webview_window("main") {
                    let _ = window.emit("close-requested", ());
                }
            }
            tauri::RunEvent::Exit => {
                // Release all skill locks and close workflow sessions held by this instance
                let instance = app_handle.state::<InstanceInfo>();
                let db_state = app_handle.state::<crate::db::Db>();
                if let Ok(conn) = db_state.0.lock() {
                    let _ = crate::db::release_all_instance_locks(&conn, &instance.id);
                    let _ = crate::db::end_all_sessions_for_pid(&conn, instance.pid);
                }

                // Check if graceful_shutdown already completed sidecar shutdown.
                // If so, skip the redundant shutdown to avoid burning through the timeout.
                let pool = app_handle.state::<agents::sidecar_pool::SidecarPool>();
                if pool.is_shutdown_completed() {
                    log::info!("[exit] Sidecar shutdown already completed by graceful_shutdown, skipping");
                    if let Ok(rt) = tokio::runtime::Handle::try_current() {
                        rt.block_on(shutdown_openhands_agent_server_for_exit());
                    }
                    return;
                }

                // Shutdown all persistent sidecars on app exit with a timeout.
                // If graceful shutdown hangs (stuck sidecar, locked DB), force-exit.
                let timeout_secs = agents::sidecar_pool::DEFAULT_SHUTDOWN_TIMEOUT_SECS;
                let shutdown_fn = async {
                    let sidecar_result = pool
                        .shutdown_all_with_timeout(app_handle, timeout_secs)
                        .await;
                    shutdown_openhands_agent_server_for_exit().await;
                    sidecar_result
                };

                let result = if let Ok(rt) = tokio::runtime::Handle::try_current() {
                    rt.block_on(shutdown_fn)
                } else if let Ok(rt) = tokio::runtime::Runtime::new() {
                    rt.block_on(shutdown_fn)
                } else {
                    log::warn!("[exit] No Tokio runtime available — skipping sidecar shutdown");
                    Ok(())
                };

                if let Err(e) = result {
                    log::warn!("[exit] Shutdown failed: {} — force-exiting", e);
                    std::process::exit(1);
                }
            }
            _ => {}
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_migrate_legacy_app_data_dir_moves_when_target_missing() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let parent = tmp.path();
        let legacy = parent.join(LEGACY_APP_DATA_DIR_NAME);
        let new_dir = parent.join("com.vibedata.skill-builder");

        fs::create_dir_all(&legacy).expect("create legacy dir");
        fs::write(legacy.join("skill-builder.db"), "db").expect("write db");

        migrate_legacy_app_data_dir(&new_dir);

        assert!(new_dir.exists(), "new data dir should exist");
        assert!(!legacy.exists(), "legacy dir should be moved away");
        assert!(
            new_dir.join("skill-builder.db").exists(),
            "db should be present after migration"
        );
    }

    #[test]
    fn test_migrate_legacy_app_data_dir_skips_when_target_has_data() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let parent = tmp.path();
        let legacy = parent.join(LEGACY_APP_DATA_DIR_NAME);
        let new_dir = parent.join("com.vibedata.skill-builder");

        fs::create_dir_all(&legacy).expect("create legacy dir");
        fs::write(legacy.join("legacy.txt"), "legacy").expect("write legacy file");
        fs::create_dir_all(&new_dir).expect("create new dir");
        fs::write(new_dir.join("existing.txt"), "existing").expect("write existing file");

        migrate_legacy_app_data_dir(&new_dir);

        assert!(
            legacy.exists(),
            "legacy dir should remain when target is populated"
        );
        assert!(
            new_dir.join("existing.txt").exists(),
            "existing target content must be preserved"
        );
    }
}
