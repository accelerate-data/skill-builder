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
            Ok(())
        })
        .manage(agents::sidecar::create_registry())
        .invoke_handler(tauri::generate_handler![
            commands::agent::start_agent,
            commands::agent::cancel_agent,
            commands::node::check_node,
            commands::settings::get_settings,
            commands::settings::save_settings,
            commands::settings::test_api_key,
            commands::skill::list_skills,
            commands::skill::create_skill,
            commands::skill::delete_skill,
            commands::clarification::parse_clarifications,
            commands::clarification::save_clarification_answers,
            commands::clarification::save_raw_file,
            commands::files::list_skill_files,
            commands::files::read_file,
            commands::workflow::run_workflow_step,
            commands::workflow::run_parallel_agents,
            commands::workflow::run_review_step,
            commands::workflow::package_skill,
            commands::workflow::reset_workflow_step,
            commands::workflow::get_workflow_state,
            commands::workflow::save_workflow_state,
            commands::chat::create_chat_session,
            commands::chat::list_chat_sessions,
            commands::chat::add_chat_message,
            commands::chat::get_chat_messages,
            commands::chat::run_chat_agent,
            commands::lifecycle::check_workspace_path,
            commands::lifecycle::has_running_agents,
            commands::diff::generate_diff,
            commands::diff::apply_suggestion,
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
