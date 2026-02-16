use serde::{Deserialize, Serialize};

const GITHUB_REPO: &str = "hbanerjee74/skill-builder";

#[derive(Debug, Deserialize)]
pub struct CreateGithubIssueRequest {
    pub title: String,
    pub body: String,
    pub labels: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct CreateGithubIssueResponse {
    pub url: String,
    pub number: u64,
}

/// Create a GitHub issue via the GitHub API.
#[tauri::command]
pub async fn create_github_issue(
    db: tauri::State<'_, crate::db::Db>,
    request: CreateGithubIssueRequest,
) -> Result<CreateGithubIssueResponse, String> {
    log::info!("[create_github_issue] title={}", request.title);
    // 1. Get GitHub OAuth token from settings
    let github_token = {
        let conn = db.0.lock().map_err(|e| {
            log::error!("[create_github_issue] Failed to acquire DB lock: {}", e);
            e.to_string()
        })?;
        let settings = crate::db::read_settings(&conn).map_err(|e| {
            log::error!("[create_github_issue] Failed to read settings: {}", e);
            e.to_string()
        })?;
        settings.github_oauth_token.ok_or_else(|| {
            "Not signed in to GitHub. Sign in with GitHub in Settings.".to_string()
        })?
    };

    let client = reqwest::Client::new();

    // 2. Ensure labels exist (create if needed, best-effort)
    for label in &request.labels {
        ensure_label(&client, &github_token, label).await.ok();
    }

    // 3. Create the issue
    let response = client
        .post(format!(
            "https://api.github.com/repos/{}/issues",
            GITHUB_REPO
        ))
        .header("Authorization", format!("Bearer {}", github_token))
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", "SkillBuilder")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .json(&serde_json::json!({
            "title": request.title,
            "body": request.body,
            "labels": request.labels,
        }))
        .send()
        .await
        .map_err(|e| {
            log::error!("[create_github_issue] GitHub API request failed: {}", e);
            format!("GitHub API request failed: {e}")
        })?;

    let status = response.status();
    let body: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse GitHub response: {e}"))?;

    if !status.is_success() {
        let message = body["message"].as_str().unwrap_or("Unknown error");
        log::error!("[create_github_issue] GitHub API error ({}): {}", status, message);
        return Err(format!("GitHub API error ({}): {}", status, message));
    }

    let url = body["html_url"]
        .as_str()
        .ok_or("Missing html_url in response")?
        .to_string();
    let number = body["number"]
        .as_u64()
        .ok_or("Missing number in response")?;

    Ok(CreateGithubIssueResponse { url, number })
}

/// Ensure a label exists on the repo (best-effort, 422 = already exists).
async fn ensure_label(
    client: &reqwest::Client,
    token: &str,
    label: &str,
) -> Result<(), String> {
    let response = client
        .post(format!(
            "https://api.github.com/repos/{}/labels",
            GITHUB_REPO
        ))
        .header("Authorization", format!("Bearer {}", token))
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", "SkillBuilder")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .json(&serde_json::json!({
            "name": label,
        }))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let status = response.status();
    // 422 means label already exists — that's fine
    if status.is_success() || status == reqwest::StatusCode::UNPROCESSABLE_ENTITY {
        Ok(())
    } else {
        Err(format!("Failed to create label: {}", status))
    }
}

