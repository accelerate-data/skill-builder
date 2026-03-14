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
        let settings = crate::db::read_settings_hydrated(&conn).map_err(|e| {
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
        ensure_label_inner(&client, &github_token, label, "https://api.github.com")
            .await
            .ok();
    }

    create_github_issue_inner(&client, &github_token, &request, "https://api.github.com").await
}

/// Inner testable function: create a GitHub issue using the given base URL.
pub(crate) async fn create_github_issue_inner(
    client: &reqwest::Client,
    github_token: &str,
    request: &CreateGithubIssueRequest,
    base_url: &str,
) -> Result<CreateGithubIssueResponse, String> {
    let response = client
        .post(format!("{}/repos/{}/issues", base_url, GITHUB_REPO))
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
        log::error!(
            "[create_github_issue] GitHub API error ({}): {}",
            status,
            message
        );
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
/// Inner testable function: ensure a label exists using the given base URL.
pub(crate) async fn ensure_label_inner(
    client: &reqwest::Client,
    token: &str,
    label: &str,
    base_url: &str,
) -> Result<(), String> {
    let response = client
        .post(format!("{}/repos/{}/labels", base_url, GITHUB_REPO))
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    fn make_request(title: &str) -> CreateGithubIssueRequest {
        CreateGithubIssueRequest {
            title: title.to_string(),
            body: "test body".to_string(),
            labels: vec!["bug".to_string()],
        }
    }

    #[tokio::test]
    async fn test_create_github_issue_no_token() {
        // Use an in-memory DB with no github_oauth_token set
        let conn = crate::db::create_test_db_for_tests();
        let db = crate::db::Db(Mutex::new(conn));
        // Directly test the token retrieval logic via a Tauri-less path:
        // read settings, confirm no token
        let inner_conn = db.0.lock().unwrap();
        let settings = crate::db::read_settings_hydrated(&inner_conn).unwrap();
        let result: Result<String, String> = settings
            .github_oauth_token
            .ok_or_else(|| "Not signed in to GitHub. Sign in with GitHub in Settings.".to_string());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Not signed in to GitHub"));
    }

    #[tokio::test]
    async fn test_ensure_label_already_exists() {
        let mut server = mockito::Server::new_async().await;
        let _mock = server
            .mock("POST", format!("/repos/{}/labels", GITHUB_REPO).as_str())
            .with_status(422)
            .with_body("{}")
            .create_async()
            .await;

        let client = reqwest::Client::new();
        let result = ensure_label_inner(&client, "token", "bug", &server.url()).await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_ensure_label_success() {
        let mut server = mockito::Server::new_async().await;
        let _mock = server
            .mock("POST", format!("/repos/{}/labels", GITHUB_REPO).as_str())
            .with_status(201)
            .with_body(r#"{"name":"bug"}"#)
            .create_async()
            .await;

        let client = reqwest::Client::new();
        let result = ensure_label_inner(&client, "token", "bug", &server.url()).await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_create_github_issue_api_error() {
        let mut server = mockito::Server::new_async().await;
        let _mock = server
            .mock("POST", format!("/repos/{}/issues", GITHUB_REPO).as_str())
            .with_status(403)
            .with_body(r#"{"message":"Forbidden"}"#)
            .create_async()
            .await;

        let client = reqwest::Client::new();
        let req = make_request("Test Issue");
        let result = create_github_issue_inner(&client, "bad-token", &req, &server.url()).await;
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.contains("GitHub API error"), "got: {}", err);
    }

    #[tokio::test]
    async fn test_create_github_issue_success() {
        let mut server = mockito::Server::new_async().await;
        let _mock = server
            .mock("POST", format!("/repos/{}/issues", GITHUB_REPO).as_str())
            .with_status(201)
            .with_body(
                r#"{"html_url":"https://github.com/hbanerjee74/skill-builder/issues/42","number":42}"#,
            )
            .create_async()
            .await;

        let client = reqwest::Client::new();
        let req = make_request("Test Issue");
        let result = create_github_issue_inner(&client, "token", &req, &server.url()).await;
        assert!(result.is_ok());
        let resp = result.unwrap();
        assert_eq!(resp.number, 42);
        assert!(resp.url.contains("issues/42"));
    }
}
