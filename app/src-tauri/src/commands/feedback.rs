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
    // 1. Get GitHub PAT from settings
    let github_pat = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let settings = crate::db::read_settings(&conn).map_err(|e| e.to_string())?;
        settings.github_pat.ok_or_else(|| {
            "GitHub personal access token not configured. Add it in Settings.".to_string()
        })?
    };

    let client = reqwest::Client::new();

    // 2. Ensure labels exist (create if needed, best-effort)
    for label in &request.labels {
        ensure_label(&client, &github_pat, label).await.ok();
    }

    // 3. Create the issue
    let response = client
        .post(format!(
            "https://api.github.com/repos/{}/issues",
            GITHUB_REPO
        ))
        .header("Authorization", format!("Bearer {}", github_pat))
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
        .map_err(|e| format!("GitHub API request failed: {e}"))?;

    let status = response.status();
    let body: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse GitHub response: {e}"))?;

    if !status.is_success() {
        let message = body["message"].as_str().unwrap_or("Unknown error");
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
    pat: &str,
    label: &str,
) -> Result<(), String> {
    let response = client
        .post(format!(
            "https://api.github.com/repos/{}/labels",
            GITHUB_REPO
        ))
        .header("Authorization", format!("Bearer {}", pat))
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

/// Test a GitHub PAT by verifying authentication, repo access, and issues enabled.
#[tauri::command]
pub async fn test_github_pat(github_pat: String) -> Result<String, String> {
    let client = reqwest::Client::new();

    // 1. Verify token is valid by getting the authenticated user
    let user_response = client
        .get("https://api.github.com/user")
        .header("Authorization", format!("Bearer {}", github_pat))
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", "SkillBuilder")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;

    if !user_response.status().is_success() {
        return Err("Invalid token — authentication failed. Make sure you created a classic token (not fine-grained).".to_string());
    }

    // Check token scopes from response header
    let scopes = user_response
        .headers()
        .get("x-oauth-scopes")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    let scope_list: Vec<&str> = scopes.split(',').map(|s| s.trim()).collect();
    let has_repo = scope_list.iter().any(|s| *s == "repo" || *s == "public_repo");

    if !has_repo {
        return Err("Token is missing the 'public_repo' scope. Edit your classic token at github.com/settings/tokens and enable it.".to_string());
    }

    let user: serde_json::Value = user_response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {e}"))?;
    let username = user["login"].as_str().unwrap_or("unknown");

    // 2. Verify the token can access the target repo
    let repo_response = client
        .get(format!("https://api.github.com/repos/{}", GITHUB_REPO))
        .header("Authorization", format!("Bearer {}", github_pat))
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", "SkillBuilder")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;

    if !repo_response.status().is_success() {
        return Err(format!(
            "Token valid for user '{}' but cannot access repo {}",
            username, GITHUB_REPO
        ));
    }

    let repo: serde_json::Value = repo_response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {e}"))?;

    // Check if issues are enabled on the repo
    let has_issues = repo["has_issues"].as_bool().unwrap_or(false);
    if !has_issues {
        return Err(format!("Repository {} has issues disabled", GITHUB_REPO));
    }

    Ok(format!(
        "Authenticated as '{}' — can access {}",
        username, GITHUB_REPO
    ))
}
