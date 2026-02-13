mod agents;
mod commands;
mod db;
mod logging;
mod types;

pub use types::*;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Truncate the log file before the plugin opens it so each session starts fresh.
    logging::truncate_log_file();

    tauri::Builder::default()
        .plugin(logging::build_log_plugin().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            use tauri::Manager;
            let db = db::init_db(app).expect("failed to initialize database");
            app.manage(db);

            // Apply persisted verbose_logging setting to the log level
            {
                let db_state = app.state::<db::Db>();
                let conn = db_state.0.lock().expect("failed to lock db for settings");
                if let Ok(settings) = db::read_settings(&conn) {
                    logging::set_log_level(settings.verbose_logging);
                    log::debug!("Log level initialized from settings: verbose={}", settings.verbose_logging);
                }
            }

            log::info!("Skill Builder starting up");

            // Initialize workspace directory and deploy bundled prompts
            let db_state = app.state::<db::Db>();
            let handle = app.handle().clone();
            commands::workspace::init_workspace(&handle, &db_state)
                .expect("failed to initialize workspace");

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
            commands::feedback::test_github_pat,
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
                // Shutdown all persistent sidecars on app exit
                use tauri::Manager;
                let pool = app_handle.state::<agents::sidecar_pool::SidecarPool>();
                // The Tokio runtime may already be torn down during exit
                if let Ok(rt) = tokio::runtime::Handle::try_current() {
                    rt.block_on(pool.shutdown_all());
                } else if let Ok(rt) = tokio::runtime::Runtime::new() {
                    rt.block_on(pool.shutdown_all());
                }
            }
        });
}
