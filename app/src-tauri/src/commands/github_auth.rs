use crate::db::Db;
use crate::types::{DeviceFlowResponse, GitHubAuthResult, GitHubUser};

// Public client ID — intentional for OAuth device flow; not a secret.
const GITHUB_CLIENT_ID: &str = "Ov23lioPbQz4gAFxEfhM";

/// Start the GitHub Device Flow by requesting a device code.
#[tauri::command]
pub async fn github_start_device_flow() -> Result<DeviceFlowResponse, String> {
    log::info!("[github_start_device_flow] starting device flow");
    let client = reqwest::Client::new();
    github_start_device_flow_inner(&client, "https://github.com").await
}

/// Inner testable function: start device flow using the given base URL.
pub(crate) async fn github_start_device_flow_inner(
    client: &reqwest::Client,
    base_url: &str,
) -> Result<DeviceFlowResponse, String> {
    let response = client
        .post(format!("{}/login/device/code", base_url))
        .header("Accept", "application/json")
        .form(&[("client_id", GITHUB_CLIENT_ID), ("scope", "repo,read:user")])
        .send()
        .await
        .map_err(|e| format!("Failed to start device flow: {e}"))?;

    let status = response.status();
    let body: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse device flow response: {e}"))?;

    if !status.is_success() {
        let message = body["error_description"]
            .as_str()
            .or_else(|| body["error"].as_str())
            .unwrap_or("Unknown error");
        return Err(format!(
            "GitHub device flow error ({}): {}",
            status, message
        ));
    }

    let device_code = body["device_code"]
        .as_str()
        .ok_or("Missing device_code in response")?
        .to_string();
    let user_code = body["user_code"]
        .as_str()
        .ok_or("Missing user_code in response")?
        .to_string();
    let verification_uri = body["verification_uri"]
        .as_str()
        .ok_or("Missing verification_uri in response")?
        .to_string();
    let expires_in = body["expires_in"]
        .as_u64()
        .ok_or("Missing expires_in in response")?;
    let interval = body["interval"].as_u64().unwrap_or(5);

    Ok(DeviceFlowResponse {
        device_code,
        user_code,
        verification_uri,
        expires_in,
        interval,
    })
}

/// Poll GitHub for the access token using the device code.
/// Returns Pending while the user hasn't authorized, SlowDown if polling too fast,
/// or Success with the user profile once authorized.
#[tauri::command]
pub async fn github_poll_for_token(
    db: tauri::State<'_, Db>,
    device_code: String,
) -> Result<GitHubAuthResult, String> {
    log::info!("[github_poll_for_token] polling for token");
    let client = reqwest::Client::new();

    let (result, maybe_token_and_user) = github_poll_for_token_full(
        &client,
        &device_code,
        "https://github.com",
        "https://api.github.com",
    )
    .await?;

    if let Some((access_token, user)) = maybe_token_and_user {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let mut settings = crate::db::read_settings(&conn)?;
        settings.github_user_login = Some(user.login.clone());
        settings.github_user_avatar = Some(user.avatar_url.clone());
        settings.github_user_email = user.email.clone();
        settings.github_oauth_token = Some(access_token);
        crate::db::write_settings(&conn, &settings)?;
    }

    Ok(result)
}

/// Inner testable function: poll for token, return (GitHubAuthResult, Option<(token, user)>).
/// The Option is Some only on Success so callers can persist the token.
pub(crate) async fn github_poll_for_token_full(
    client: &reqwest::Client,
    device_code: &str,
    github_base_url: &str,
    api_base_url: &str,
) -> Result<(GitHubAuthResult, Option<(String, GitHubUser)>), String> {
    let response = client
        .post(format!("{}/login/oauth/access_token", github_base_url))
        .header("Accept", "application/json")
        .form(&[
            ("client_id", GITHUB_CLIENT_ID),
            ("device_code", device_code),
            ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
        ])
        .send()
        .await
        .map_err(|e| format!("Failed to poll for token: {e}"))?;

    let body: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse token response: {e}"))?;

    if let Some(error) = body["error"].as_str() {
        return match error {
            "authorization_pending" => Ok((GitHubAuthResult::Pending, None)),
            "slow_down" => Ok((GitHubAuthResult::SlowDown, None)),
            _ => {
                let description = body["error_description"]
                    .as_str()
                    .unwrap_or("Unknown error");
                Err(format!("GitHub OAuth error: {} — {}", error, description))
            }
        };
    }

    let access_token = body["access_token"]
        .as_str()
        .ok_or("Missing access_token in response")?
        .to_string();

    let user = fetch_github_user_inner(client, &access_token, api_base_url).await?;

    Ok((
        GitHubAuthResult::Success { user: user.clone() },
        Some((access_token, user)),
    ))
}

/// Inner testable function: poll for token result only (no DB writes, no token returned).
#[cfg(test)]
pub(crate) async fn github_poll_for_token_inner(
    client: &reqwest::Client,
    device_code: &str,
    github_base_url: &str,
    api_base_url: &str,
) -> Result<GitHubAuthResult, String> {
    let (result, _) =
        github_poll_for_token_full(client, device_code, github_base_url, api_base_url).await?;
    Ok(result)
}

/// Core get-user logic, extracted for testability (avoids requiring AppHandle/State).
pub(crate) fn github_get_user_impl(
    conn: &rusqlite::Connection,
) -> Result<Option<GitHubUser>, String> {
    let settings = crate::db::read_settings_hydrated(conn)?;
    if settings.github_oauth_token.is_some() {
        let login = settings.github_user_login.unwrap_or_default();
        let avatar_url = settings.github_user_avatar.unwrap_or_default();
        let email = settings.github_user_email;
        Ok(Some(GitHubUser {
            login,
            avatar_url,
            email,
        }))
    } else {
        Ok(None)
    }
}

/// Get the currently authenticated GitHub user from the database.
/// Returns None if not signed in.
#[tauri::command]
pub fn github_get_user(db: tauri::State<'_, Db>) -> Result<Option<GitHubUser>, String> {
    log::info!("[github_get_user]");
    let conn = db.0.lock().map_err(|e| {
        log::error!("[github_get_user] Failed to acquire DB lock: {}", e);
        e.to_string()
    })?;
    github_get_user_impl(&conn)
}

/// Core logout logic, extracted for testability (avoids requiring AppHandle/State).
pub(crate) fn github_logout_impl(conn: &rusqlite::Connection) -> Result<(), String> {
    let mut settings = crate::db::read_settings(conn)?;
    settings.github_oauth_token = None;
    settings.github_user_login = None;
    settings.github_user_avatar = None;
    settings.github_user_email = None;
    crate::db::write_settings(conn, &settings)?;
    Ok(())
}

/// Sign out of GitHub by clearing all OAuth fields from the database.
#[tauri::command]
pub fn github_logout(db: tauri::State<'_, Db>) -> Result<(), String> {
    log::info!("[github_logout]");

    let conn = db.0.lock().map_err(|e| {
        log::error!("[github_logout] Failed to acquire DB lock: {}", e);
        e.to_string()
    })?;
    github_logout_impl(&conn)
}

/// Fetch the authenticated user's profile from GitHub.
#[allow(dead_code)]
async fn fetch_github_user(client: &reqwest::Client, token: &str) -> Result<GitHubUser, String> {
    fetch_github_user_inner(client, token, "https://api.github.com").await
}

/// Inner testable function: fetch GitHub user using the given base URL.
pub(crate) async fn fetch_github_user_inner(
    client: &reqwest::Client,
    token: &str,
    base_url: &str,
) -> Result<GitHubUser, String> {
    let response = client
        .get(format!("{}/user", base_url))
        .header("Authorization", format!("Bearer {}", token))
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", "SkillBuilder")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .await
        .map_err(|e| format!("Failed to fetch GitHub user: {e}"))?;

    let status = response.status();
    let body: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse GitHub user response: {e}"))?;

    if !status.is_success() {
        let message = body["message"].as_str().unwrap_or("Unknown error");
        return Err(format!(
            "GitHub API error fetching user ({}): {}",
            status, message
        ));
    }

    let login = body["login"]
        .as_str()
        .ok_or("Missing login in user response")?
        .to_string();
    let avatar_url = body["avatar_url"]
        .as_str()
        .ok_or("Missing avatar_url in user response")?
        .to_string();
    let email = body["email"].as_str().map(|s| s.to_string());

    Ok(GitHubUser {
        login,
        avatar_url,
        email,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::create_test_db_for_tests;

    // ── vu-561 tests: github_get_user_impl / github_logout_impl ──────────

    #[test]
    fn test_github_get_user_returns_user_when_token_set() {
        let conn = create_test_db_for_tests();
        let mut settings = crate::db::read_settings(&conn).unwrap();
        settings.github_oauth_token = Some("ghp_test_token".to_string());
        settings.github_user_login = Some("octocat".to_string());
        settings.github_user_avatar = Some("https://github.com/octocat.png".to_string());
        settings.github_user_email = Some("octocat@github.com".to_string());
        crate::db::write_settings(&conn, &settings).unwrap();

        let user = github_get_user_impl(&conn).unwrap();
        assert!(user.is_some());
        let user = user.unwrap();
        assert_eq!(user.login, "octocat");
        assert_eq!(user.avatar_url, "https://github.com/octocat.png");
        assert_eq!(user.email.as_deref(), Some("octocat@github.com"));
    }

    #[test]
    fn test_github_get_user_returns_none_without_token() {
        let conn = create_test_db_for_tests();
        let user = github_get_user_impl(&conn).unwrap();
        assert!(user.is_none());
    }

    #[test]
    fn test_github_logout_clears_all_oauth_fields() {
        let conn = create_test_db_for_tests();
        let mut settings = crate::db::read_settings(&conn).unwrap();
        settings.github_oauth_token = Some("ghp_test_token".to_string());
        settings.github_user_login = Some("octocat".to_string());
        settings.github_user_avatar = Some("https://github.com/octocat.png".to_string());
        settings.github_user_email = Some("octocat@github.com".to_string());
        crate::db::write_settings(&conn, &settings).unwrap();

        github_logout_impl(&conn).unwrap();

        let after = crate::db::read_settings_hydrated(&conn).unwrap();
        assert!(after.github_oauth_token.is_none());
        assert!(after.github_user_login.is_none());
        assert!(after.github_user_avatar.is_none());
        assert!(after.github_user_email.is_none());
    }

    #[test]
    fn test_github_logout_leaves_other_settings_intact() {
        let conn = create_test_db_for_tests();
        let mut settings = crate::db::read_settings(&conn).unwrap();
        settings.anthropic_api_key = Some("sk-ant-test-key".to_string());
        settings.github_oauth_token = Some("ghp_test_token".to_string());
        settings.github_user_login = Some("octocat".to_string());
        crate::db::write_settings(&conn, &settings).unwrap();

        github_logout_impl(&conn).unwrap();

        let after = crate::db::read_settings(&conn).unwrap();
        assert_eq!(after.anthropic_api_key.as_deref(), Some("sk-ant-test-key"));
        assert!(after.github_oauth_token.is_none());
    }

    // ── vu-578 tests: device flow, poll states, token persistence ────────

    #[tokio::test]
    async fn test_github_poll_for_token_pending() {
        let mut server = mockito::Server::new_async().await;
        let _mock = server
            .mock("POST", "/login/oauth/access_token")
            .with_status(200)
            .with_body(r#"{"error":"authorization_pending"}"#)
            .create_async()
            .await;

        let client = reqwest::Client::new();
        let result =
            github_poll_for_token_inner(&client, "test-device-code", &server.url(), &server.url())
                .await;
        assert!(result.is_ok());
        assert!(matches!(result.unwrap(), GitHubAuthResult::Pending));
    }

    #[tokio::test]
    async fn test_github_poll_for_token_slow_down() {
        let mut server = mockito::Server::new_async().await;
        let _mock = server
            .mock("POST", "/login/oauth/access_token")
            .with_status(200)
            .with_body(r#"{"error":"slow_down"}"#)
            .create_async()
            .await;

        let client = reqwest::Client::new();
        let result =
            github_poll_for_token_inner(&client, "test-device-code", &server.url(), &server.url())
                .await;
        assert!(result.is_ok());
        assert!(matches!(result.unwrap(), GitHubAuthResult::SlowDown));
    }

    #[tokio::test]
    async fn test_github_poll_for_token_error() {
        let mut server = mockito::Server::new_async().await;
        let _mock = server
            .mock("POST", "/login/oauth/access_token")
            .with_status(200)
            .with_body(r#"{"error":"access_denied","error_description":"User denied"}"#)
            .create_async()
            .await;

        let client = reqwest::Client::new();
        let result =
            github_poll_for_token_inner(&client, "test-device-code", &server.url(), &server.url())
                .await;
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.contains("access_denied"), "got: {}", err);
        assert!(err.contains("User denied"), "got: {}", err);
    }

    #[tokio::test]
    async fn test_github_start_device_flow_parses_response() {
        let mut server = mockito::Server::new_async().await;
        let _mock = server
            .mock("POST", "/login/device/code")
            .with_status(200)
            .with_body(
                r#"{"device_code":"abc123","user_code":"ABCD-1234","verification_uri":"https://github.com/login/device","expires_in":900,"interval":5}"#,
            )
            .create_async()
            .await;

        let client = reqwest::Client::new();
        let result = github_start_device_flow_inner(&client, &server.url()).await;
        assert!(result.is_ok());
        let resp = result.unwrap();
        assert_eq!(resp.device_code, "abc123");
        assert_eq!(resp.user_code, "ABCD-1234");
        assert_eq!(resp.expires_in, 900);
        assert_eq!(resp.interval, 5);
    }

    #[tokio::test]
    async fn test_github_start_device_flow_error() {
        let mut server = mockito::Server::new_async().await;
        let _mock = server
            .mock("POST", "/login/device/code")
            .with_status(401)
            .with_body(r#"{"error":"unauthorized","error_description":"Bad credentials"}"#)
            .create_async()
            .await;

        let client = reqwest::Client::new();
        let result = github_start_device_flow_inner(&client, &server.url()).await;
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.contains("GitHub device flow error"), "got: {}", err);
    }

    #[tokio::test]
    async fn test_github_poll_for_token_success_with_user() {
        let mut server = mockito::Server::new_async().await;

        let _token_mock = server
            .mock("POST", "/login/oauth/access_token")
            .with_status(200)
            .with_body(r#"{"access_token":"gho_test_token_12345"}"#)
            .create_async()
            .await;

        let _user_mock = server
            .mock("GET", "/user")
            .with_status(200)
            .with_body(r#"{"login":"octocat","avatar_url":"https://avatar.example.com","email":"octo@test.com"}"#)
            .create_async()
            .await;

        let client = reqwest::Client::new();
        let result =
            github_poll_for_token_full(&client, "test-device-code", &server.url(), &server.url())
                .await;
        assert!(result.is_ok(), "expected Ok, got: {:?}", result);

        let (auth_result, token_user) = result.unwrap();
        assert!(
            matches!(auth_result, GitHubAuthResult::Success { .. }),
            "expected Success variant"
        );

        let (token, user) = token_user.expect("should return token+user on success");
        assert_eq!(token, "gho_test_token_12345");
        assert_eq!(user.login, "octocat");
        assert_eq!(user.avatar_url, "https://avatar.example.com");
        assert_eq!(user.email, Some("octo@test.com".to_string()));
    }
}
