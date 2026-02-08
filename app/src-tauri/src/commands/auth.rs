use crate::auth::device_flow;
use crate::types::GitHubUser;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitHubRepo {
    pub full_name: String,
    pub name: String,
    pub private: bool,
    pub description: Option<String>,
    pub clone_url: String,
}

#[tauri::command]
pub async fn get_current_user(token: String) -> Result<GitHubUser, String> {
    device_flow::fetch_github_user(&token)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_github_repos(token: String) -> Result<Vec<GitHubRepo>, String> {
    let client = reqwest::Client::new();
    let mut all_repos: Vec<GitHubRepo> = Vec::new();
    let mut page = 1u32;

    loop {
        let resp = client
            .get("https://api.github.com/user/repos")
            .header("Accept", "application/json")
            .header("Authorization", format!("Bearer {}", token))
            .header("User-Agent", "skill-builder-desktop")
            .query(&[
                ("per_page", "100"),
                ("sort", "updated"),
                ("page", &page.to_string()),
            ])
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            let text = resp.text().await.unwrap_or_default();
            return Err(format!("GitHub API error: {}", text));
        }

        let repos: Vec<GitHubRepo> = resp.json().await.map_err(|e| e.to_string())?;
        let count = repos.len();
        all_repos.extend(repos);

        if count < 100 {
            break;
        }
        page += 1;
    }

    Ok(all_repos)
}
