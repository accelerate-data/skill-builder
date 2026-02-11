mod agents;
mod commands;
mod db;
mod markdown;
mod types;

pub use types::*;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            use tauri::Manager;
            let db = db::init_db(app).expect("failed to initialize database");
            app.manage(db);

            // Initialize workspace directory and deploy bundled prompts
            let db_state = app.state::<db::Db>();
            let handle = app.handle().clone();
            commands::workspace::init_workspace(&handle, &db_state)
                .expect("failed to initialize workspace");

            Ok(())
        })
        .manage(agents::sidecar::create_registry())
        .invoke_handler(tauri::generate_handler![
            commands::agent::start_agent,
            commands::node::check_node,
            commands::settings::get_settings,
            commands::settings::save_settings,
            commands::settings::test_api_key,
            commands::skill::list_skills,
            commands::skill::create_skill,
            commands::skill::delete_skill,
            commands::skill::update_skill_tags,
            commands::skill::get_all_tags,
            commands::clarification::save_raw_file,
            commands::files::list_skill_files,
            commands::files::read_file,
            commands::files::copy_file,
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
            commands::workspace::get_workspace_path,
            commands::workspace::clear_workspace,
            commands::workspace::reconcile_startup,
            commands::workspace::resolve_orphan,
        ])
        .on_window_event(|window, event| {
            use tauri::Emitter;
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.emit("close-requested", ());
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
