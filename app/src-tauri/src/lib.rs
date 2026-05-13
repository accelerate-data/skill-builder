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
mod services;
mod skill_paths;
mod types;

use std::any::Any;
use std::fs;
use std::io;
use std::panic::PanicHookInfo;
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

fn panic_payload_message(payload: &(dyn Any + Send)) -> String {
    if let Some(message) = payload.downcast_ref::<&'static str>() {
        (*message).to_string()
    } else if let Some(message) = payload.downcast_ref::<String>() {
        message.clone()
    } else {
        "non-string panic payload".to_string()
    }
}

fn startup_context_summary(pid: u32, parent_pid: Option<u32>, argv: &[String]) -> String {
    let parent = parent_pid
        .map(|value| value.to_string())
        .unwrap_or_else(|| "unknown".to_string());
    let argv = if argv.is_empty() {
        "<empty>".to_string()
    } else {
        argv.join(" | ")
    };
    format!("pid={pid} ppid={parent} argv={argv}")
}

fn install_panic_hook() {
    std::panic::set_hook(Box::new(|panic_info: &PanicHookInfo<'_>| {
        let location = panic_info
            .location()
            .map(|value| format!("{}:{}", value.file(), value.line()))
            .unwrap_or_else(|| "unknown".to_string());
        let payload = panic_payload_message(panic_info.payload());
        let message = format!("[panic] location={location} payload={payload}");
        eprintln!("{message}");
        log::error!("{message}");
    }));
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
    install_panic_hook();
    let pid = std::process::id();
    tauri::Builder::default()
        .plugin(logging::build_log_plugin(pid).build())
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
                        credits: Some("Built with Tauri, OpenHands Agent Server, and React\n\nLicense terms: https://github.com/hbanerjee74/skill-builder/blob/main/LICENSE".to_string()),
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
            let argv: Vec<String> = std::env::args().collect();
            #[cfg(unix)]
            let parent_pid = Some(nix::unistd::getppid().as_raw() as u32);
            #[cfg(not(unix))]
            let parent_pid: Option<u32> = None;
            log::info!("Instance ID: {}, PID: {}", instance_info.id, instance_info.pid);
            log::info!(
                "[startup] {}",
                startup_context_summary(instance_info.pid, parent_pid, &argv)
            );
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

            // Resolve bundled uv binary for the OpenHands agent server.
            // Falls back to system uvx when the binary is not present (dev builds).
            match app.path().resource_dir() {
                Ok(resource_dir) => {
                    crate::agents::openhands_server::process::init_bundled_uv_path(&resource_dir);
                }
                Err(e) => {
                    log::warn!(
                        "[startup] could not resolve resource_dir for bundled uv: {e}; will use system uvx"
                    );
                    crate::agents::openhands_server::process::init_bundled_uv_path(
                        std::path::Path::new(""),
                    );
                }
            }

            Ok(())
        })
        .manage(CloseGuardState::default())
        .manage(commands::skill_session::SkillSessionManager::new())
        .manage(commands::workflow::runtime::WorkflowStepRunManager::new())

        .invoke_handler(tauri::generate_handler![
            commands::startup::check_startup_deps,
            commands::settings::get_data_dir,
            commands::settings::get_settings,
            commands::settings::save_settings,
            commands::settings::update_user_settings,
            commands::settings::update_github_identity,
            commands::api_validation::test_model_connection,
            commands::lifecycle::set_log_level,
            commands::lifecycle::get_log_file_path,
            commands::lifecycle::log_frontend,
            commands::settings::get_default_skills_path,
            commands::skill::list_skills,
            commands::skill::create_skill,
            commands::skill::delete_skill,
            commands::skill::update_skill_metadata,
            commands::skill::rename_skill,
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
            commands::workflow::evaluation::reset_workflow_step,
            commands::workflow::evaluation::navigate_back_to_step,
            commands::workflow::evaluation::preview_step_reset,
            commands::workflow::evaluation::get_workflow_state,
            commands::workflow::evaluation::save_workflow_state,
            commands::workflow::evaluation::verify_step_output,
            commands::workflow::evaluation::get_disabled_steps,
            commands::workflow::clarifications::get_clarifications,
            commands::workflow::clarifications::update_clarification_answer,
            commands::workflow::clarifications::update_clarification_verdicts,
            commands::workflow::decisions::get_decisions,
            commands::workflow::decisions::save_decisions_edit,
            commands::workflow::runtime::run_answer_evaluator,
            commands::workflow::output_format::materialize_answer_evaluation_output,
            commands::workflow::runtime::log_gate_decision,
            commands::runtime_lifecycle::graceful_shutdown,
            commands::runtime_lifecycle::allow_app_exit,
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
            commands::skill_session::select_skill_openhands_session,
            commands::refine::send_refine_message,
            commands::skill_session::pause_openhands_session,
            commands::refine::output::finalize_refine_run,
            commands::refine::output::clean_benchmark_snapshot,
            commands::workflow::evaluation::read_latest_benchmark,
            commands::imported_skills::upload::parse_skill_file,
            commands::imported_skills::upload::import_skill_from_file,
            commands::eval_workbench::list_scenarios,
            commands::eval_workbench::load_scenario,
            commands::eval_workbench::create_scenario,
            commands::eval_workbench::save_scenario,
            commands::eval_workbench::delete_scenario,
            commands::eval_workbench::define_eval_scenario,

            commands::documents::list_documents,
            commands::documents::list_skills_for_documents,
            commands::documents::add_document_file,
            commands::documents::add_document_url,
            commands::documents::add_document_folder,
            commands::documents::update_document,
            commands::documents::delete_document,

            commands::model_catalog::refresh_model_catalog,
            commands::model_catalog::get_cached_model_catalog,
            commands::model_catalog::get_cached_model_providers,
            commands::model_catalog::filter_models,
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

                // Shut down the OpenHands Agent Server.
                if let Ok(rt) = tokio::runtime::Handle::try_current() {
                    rt.block_on(shutdown_openhands_agent_server_for_exit());
                } else if let Ok(rt) = tokio::runtime::Runtime::new() {
                    rt.block_on(shutdown_openhands_agent_server_for_exit());
                } else {
                    log::warn!("[exit] No Tokio runtime available — skipping OpenHands server shutdown");
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

    #[test]
    fn test_panic_payload_message_handles_string_payloads() {
        let static_payload: &(dyn Any + Send) = &"panic text";
        let owned_payload: &(dyn Any + Send) = &"owned panic".to_string();

        assert_eq!(panic_payload_message(static_payload), "panic text");
        assert_eq!(panic_payload_message(owned_payload), "owned panic");
    }

    #[test]
    fn test_startup_context_summary_includes_pid_parent_and_args() {
        let summary = startup_context_summary(
            4242,
            Some(111),
            &[
                "/Applications/Skill Builder.app".to_string(),
                "--flag".to_string(),
            ],
        );

        assert_eq!(
            summary,
            "pid=4242 ppid=111 argv=/Applications/Skill Builder.app | --flag"
        );
    }
}
