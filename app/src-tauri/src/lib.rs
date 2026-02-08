mod agents;
mod auth;
mod commands;
mod markdown;
mod types;

pub use types::*;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .manage(agents::sidecar::create_registry())
        .invoke_handler(tauri::generate_handler![
            commands::agent::start_agent,
            commands::agent::cancel_agent,
            commands::auth::get_current_user,
            commands::node::check_node,
            commands::settings::get_settings,
            commands::settings::save_settings,
            commands::settings::test_api_key,
            commands::skill::list_skills,
            commands::skill::create_skill,
            commands::skill::delete_skill,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
