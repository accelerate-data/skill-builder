mod agents;
mod commands;
mod db;
mod logging;
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
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            use tauri::Manager;

            // Native app menu with About item (macOS)
            {
                use tauri::menu::{AboutMetadata, MenuBuilder, PredefinedMenuItem, SubmenuBuilder};
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

                let app_submenu = SubmenuBuilder::new(app, "Skill Builder")
                    .item(&about)
                    .separator()
                    .services()
                    .separator()
                    .hide()
                    .hide_others()
                    .show_all()
                    .separator()
                    .quit()
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

                let window_submenu = SubmenuBuilder::new(app, "Window")
                    .minimize()
                    .maximize()
                    .separator()
                    .fullscreen()
                    .close_window()
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

            // Apply persisted log level setting (fall back to info if DB read fails)
            {
                let db_state = app.state::<db::Db>();
                let conn = db_state.0.lock().expect("failed to lock db for settings");
                match db::read_settings(&conn) {
                    Ok(settings) => {
                        logging::set_log_level(&settings.log_level);
                        log::debug!("Log level initialized from settings: {}", settings.log_level);
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

            Ok(())
        })
        .manage(agents::sidecar_pool::SidecarPool::new())
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
            commands::skill::list_skills,
            commands::skill::create_skill,
            commands::skill::delete_skill,
            commands::skill::update_skill_tags,
            commands::skill::get_all_tags,
            commands::skill::acquire_lock,
            commands::skill::release_lock,
            commands::skill::get_locked_skills,
            commands::skill::check_lock,
            commands::clarification::save_raw_file,
            commands::files::list_skill_files,
            commands::files::read_file,
            commands::files::write_file,
            commands::files::copy_file,
            commands::files::read_file_as_base64,
            commands::files::write_base64_to_temp_file,
            commands::workflow::run_workflow_step,
            commands::workflow::run_review_step,
            commands::workflow::package_skill,
            commands::workflow::reset_workflow_step,
            commands::workflow::get_workflow_state,
            commands::workflow::save_workflow_state,
            commands::workflow::capture_step_artifacts,
            commands::workflow::get_artifact_content,
            commands::workflow::save_artifact_content,
            commands::workflow::has_step_artifacts,
            commands::workflow::get_agent_prompt,
            commands::lifecycle::has_running_agents,
            commands::sidecar_lifecycle::cleanup_skill_sidecar,
            commands::workspace::get_workspace_path,
            commands::workspace::clear_workspace,
            commands::workspace::reconcile_startup,
            commands::workspace::resolve_orphan,
            commands::imported_skills::upload_skill,
            commands::imported_skills::list_imported_skills,
            commands::imported_skills::toggle_skill_active,
            commands::imported_skills::delete_imported_skill,
            commands::imported_skills::get_skill_content,
            commands::feedback::create_github_issue,
            commands::github_auth::github_start_device_flow,
            commands::github_auth::github_poll_for_token,
            commands::github_auth::github_get_user,
            commands::github_auth::github_logout,
        ])
        .on_window_event(|window, event| {
            use tauri::Emitter;
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.emit("close-requested", ());
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                use tauri::Manager;

                // Release all skill locks held by this instance
                let instance = app_handle.state::<InstanceInfo>();
                let db_state = app_handle.state::<crate::db::Db>();
                if let Ok(conn) = db_state.0.lock() {
                    let _ = crate::db::release_all_instance_locks(&conn, &instance.id);
                }

                // Shutdown all persistent sidecars on app exit
                let pool = app_handle.state::<agents::sidecar_pool::SidecarPool>();
                // The Tokio runtime may already be torn down during exit
                if let Ok(rt) = tokio::runtime::Handle::try_current() {
                    rt.block_on(pool.shutdown_all(app_handle));
                } else if let Ok(rt) = tokio::runtime::Runtime::new() {
                    rt.block_on(pool.shutdown_all(app_handle));
                }
            }
        });
}
