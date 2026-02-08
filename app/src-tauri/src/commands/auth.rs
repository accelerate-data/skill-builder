use crate::auth::device_flow;
use crate::types::GitHubUser;

#[tauri::command]
pub async fn get_current_user(token: String) -> Result<GitHubUser, String> {
    device_flow::fetch_github_user(&token)
        .await
        .map_err(|e| e.to_string())
}
