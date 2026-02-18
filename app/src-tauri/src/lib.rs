mod agents;
mod cleanup;
mod commands;
mod db;
mod fs_validation;
pub mod git;
mod logging;
mod reconciliation;
mod types;

pub use types::*;

#[derive(Clone)]
pub struct InstanceInfo {
    pub id: String,
    pub pid: u32,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(logging::build_log_plugin().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            use tauri::Manager;

            // Native app menu with About item (macOS)
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
                        credits: Some("Built with Tauri, Claude Agent SDK, and React\n\nPowered by Claude from Anthropic".to_string()),
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

            let db = db::init_db(app).expect("failed to initialize database");
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
            let workspace_path = commands::workspace::init_workspace(&handle, &db_state)
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
        .manage(commands::refine::RefineSessionManager::new())
        .invoke_handler(tauri::generate_handler![
            commands::agent::start_agent,
            commands::node::check_node,
            commands::node::check_startup_deps,
            commands::settings::get_data_dir,
            commands::settings::get_settings,
            commands::settings::save_settings,
            commands::settings::test_api_key,
            commands::settings::set_log_level,
            commands::settings::get_log_file_path,
            commands::settings::get_default_skills_path,
            commands::skill::list_skills,
            commands::skill::create_skill,
            commands::skill::delete_skill,
            commands::skill::update_skill_tags,
            commands::skill::update_skill_metadata,
            commands::skill::rename_skill,
            commands::skill::generate_suggestions,
            commands::skill::get_all_tags,
            commands::skill::acquire_lock,
            commands::skill::release_lock,
            commands::skill::get_locked_skills,
            commands::skill::check_lock,
            commands::skill::list_refinable_skills,
            commands::clarification::save_raw_file,
            commands::files::list_skill_files,
            commands::files::read_file,
            commands::files::write_file,
            commands::files::copy_file,
            commands::files::read_file_as_base64,
            commands::files::write_base64_to_temp_file,
            commands::workflow::run_workflow_step,
            commands::workflow::package_skill,
            commands::workflow::reset_workflow_step,
            commands::workflow::preview_step_reset,
            commands::workflow::get_workflow_state,
            commands::workflow::save_workflow_state,
            commands::workflow::get_agent_prompt,
            commands::workflow::verify_step_output,
            commands::workflow::get_disabled_steps,
            commands::lifecycle::has_running_agents,
            commands::sidecar_lifecycle::cleanup_skill_sidecar,
            commands::sidecar_lifecycle::graceful_shutdown,
            commands::workspace::get_workspace_path,
            commands::workspace::clear_workspace,
            commands::workspace::reconcile_startup,
            commands::workspace::resolve_orphan,
            commands::workspace::create_workflow_session,
            commands::workspace::end_workflow_session,
            commands::imported_skills::upload_skill,
            commands::imported_skills::list_imported_skills,
            commands::imported_skills::toggle_skill_active,
            commands::imported_skills::delete_imported_skill,
            commands::imported_skills::get_skill_content,
            commands::imported_skills::update_trigger_text,
            commands::imported_skills::regenerate_claude_md,
            commands::imported_skills::generate_trigger_text,
            commands::feedback::create_github_issue,
            commands::github_import::parse_github_url,
            commands::github_import::list_github_skills,
            commands::github_import::import_github_skills,
            commands::github_auth::github_start_device_flow,
            commands::github_auth::github_poll_for_token,
            commands::github_auth::github_get_user,
            commands::github_auth::github_logout,
            commands::github_push::validate_remote_repo,
            commands::github_push::push_skill_to_remote,
            commands::github_push::reconcile_manifests,
            commands::github_push::write_skill_manifest,
            commands::github_push::list_user_repos,
            commands::team_import::list_team_repo_skills,
            commands::team_import::import_team_repo_skill,
            commands::usage::persist_agent_run,
            commands::usage::get_usage_summary,
            commands::usage::get_recent_runs,
            commands::usage::get_usage_by_step,
            commands::usage::get_usage_by_model,
            commands::usage::reset_usage,
            commands::usage::get_recent_workflow_sessions,
            commands::usage::get_session_agent_runs,
            commands::usage::get_step_agent_runs,
            commands::git::get_skill_history,
            commands::git::get_skill_diff,
            commands::git::restore_skill_version,
            commands::skill::list_refinable_skills,
            commands::refine::get_skill_content_for_refine,
            commands::refine::get_refine_diff,
            commands::refine::start_refine_session,
            commands::refine::send_refine_message,
            commands::refine::close_refine_session,
        ])
        .on_window_event(|window, event| {
            use tauri::Emitter;
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
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
            if let tauri::RunEvent::Exit = event {
                use tauri::Manager;

                let timeout_secs = agents::sidecar_pool::DEFAULT_SHUTDOWN_TIMEOUT_SECS;

                // Release all skill locks and close workflow sessions held by this instance
                let instance = app_handle.state::<InstanceInfo>();
                let db_state = app_handle.state::<crate::db::Db>();
                if let Ok(conn) = db_state.0.lock() {
                    let _ = crate::db::release_all_instance_locks(&conn, &instance.id);
                    let _ = crate::db::end_all_sessions_for_pid(&conn, instance.pid);
                }

                // Shutdown all persistent sidecars on app exit with a timeout.
                // If graceful shutdown hangs (stuck sidecar, locked DB), force-exit.
                let pool = app_handle.state::<agents::sidecar_pool::SidecarPool>();
                let shutdown_fn = async {
                    pool.shutdown_all_with_timeout(app_handle, timeout_secs).await
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
        });
}
