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
        .plugin(tauri_plugin_dialog::init())
        .manage(agents::sidecar::create_registry())
        .invoke_handler(tauri::generate_handler![
            commands::agent::start_agent,
            commands::agent::cancel_agent,
            commands::auth::get_current_user,
            commands::auth::list_github_repos,
            commands::git::clone_repo,
            commands::git::commit_and_push,
            commands::git::git_pull,
            commands::git::git_commit,
            commands::git::git_diff,
            commands::git::git_log,
            commands::git::git_file_status,
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
            commands::workflow::package_skill,
            commands::workflow::auto_commit_step,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
