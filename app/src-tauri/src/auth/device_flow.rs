use crate::types::GitHubUser;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum DeviceFlowError {
    #[error("HTTP request failed: {0}")]
    Http(#[from] reqwest::Error),
    #[error("GitHub API error: {0}")]
    Api(String),
}

pub async fn fetch_github_user(token: &str) -> Result<GitHubUser, DeviceFlowError> {
    let client = reqwest::Client::new();
    let resp = client
        .get("https://api.github.com/user")
        .header("Accept", "application/json")
        .header("Authorization", format!("Bearer {}", token))
        .header("User-Agent", "skill-builder-desktop")
        .send()
        .await?;

    if !resp.status().is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(DeviceFlowError::Api(text));
    }

    let user: GitHubUser = resp.json().await?;
    Ok(user)
}
