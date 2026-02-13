use serde::{Deserialize, Serialize};

const GITHUB_REPO: &str = "hbanerjee74/skill-builder";

#[derive(Debug, Deserialize)]
pub struct CreateGithubIssueRequest {
    pub title: String,
    pub body: String,
    pub labels: Vec<String>,
    pub attachments: Vec<FeedbackAttachment>,
}

#[derive(Debug, Deserialize)]
pub struct FeedbackAttachment {
    pub name: String,
    #[serde(rename = "base64Content")]
    pub base64_content: String,
    #[serde(rename = "mimeType")]
    pub mime_type: String,
    pub size: u64,
}

#[derive(Debug, Serialize)]
pub struct CreateGithubIssueResponse {
    pub url: String,
    pub number: u64,
    #[serde(rename = "failedUploads")]
    pub failed_uploads: Vec<String>,
}

/// Create a GitHub issue with optional attachments.
/// Images are uploaded to the repo's `attachments` branch and embedded inline.
/// Falls back gracefully for non-collaborators (listed by name instead).
/// Small text files are included inline as code blocks.
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

    // 2. Process attachments into markdown
    let mut attachment_markdown = String::new();
    let mut has_attachments = false;
    let mut failed_uploads: Vec<String> = Vec::new();

    for att in &request.attachments {
        if att.mime_type.starts_with("image/") {
            // Upload image to repo and embed inline
            match upload_attachment_to_repo(&client, &github_pat, &att.name, &att.base64_content).await {
                Ok(image_url) => {
                    if !has_attachments {
                        attachment_markdown.push_str("\n\n## Attachments\n\n");
                        has_attachments = true;
                    }
                    attachment_markdown.push_str(&format!(
                        "![{}]({})\n\n",
                        att.name, image_url
                    ));
                }
                Err(e) => {
                    log::warn!("Failed to upload image {}: {}", att.name, e);
                    failed_uploads.push(att.name.clone());
                    if !has_attachments {
                        attachment_markdown.push_str("\n\n## Attachments\n\n");
                        has_attachments = true;
                    }
                    attachment_markdown.push_str(&format!(
                        "- {} ({} bytes) — _image not embedded, please add via comment below_\n",
                        att.name, att.size
                    ));
                }
            }
        } else if is_text_type(&att.mime_type) && att.size < 10240 {
            // Inline small text files as code blocks
            use base64::Engine;
            if let Ok(bytes) =
                base64::engine::general_purpose::STANDARD.decode(&att.base64_content)
            {
                if let Ok(text) = String::from_utf8(bytes) {
                    if !has_attachments {
                        attachment_markdown.push_str("\n\n## Attachments\n\n");
                        has_attachments = true;
                    }
                    attachment_markdown.push_str(&format!(
                        "<details>\n<summary>{} ({} bytes)</summary>\n\n```\n{}\n```\n\n</details>\n\n",
                        att.name, att.size, text
                    ));
                }
            }
        } else {
            // Large or binary files: mention by name
            if !has_attachments {
                attachment_markdown.push_str("\n\n## Attachments\n\n");
                has_attachments = true;
            }
            attachment_markdown.push_str(&format!("- {} ({} bytes)\n", att.name, att.size));
        }
    }

    // 3. Build full body
    let full_body = format!("{}{}", request.body, attachment_markdown);

    // 4. Ensure labels exist (create if needed, best-effort)
    for label in &request.labels {
        ensure_label(&client, &github_pat, label).await.ok();
    }

    // 5. Create the issue
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
            "body": full_body,
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

    Ok(CreateGithubIssueResponse { url, number, failed_uploads })
}

/// Upload a file to the repo's `attachments` branch via the GitHub Contents API.
/// Returns the raw URL that serves the actual binary file with correct MIME type.
/// This lets images render inline in GitHub issues.
async fn upload_attachment_to_repo(
    client: &reqwest::Client,
    pat: &str,
    filename: &str,
    base64_content: &str,
) -> Result<String, String> {
    let branch = "attachments";

    // Ensure the attachments branch exists
    ensure_attachments_branch(client, pat, branch).await?;

    // Use a unique path to avoid collisions: attachments/{timestamp}-{filename}
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let path = format!("feedback/{}-{}", timestamp, filename);

    let response = client
        .put(format!(
            "https://api.github.com/repos/{}/contents/{}",
            GITHUB_REPO, path
        ))
        .header("Authorization", format!("Bearer {}", pat))
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", "SkillBuilder")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .json(&serde_json::json!({
            "message": format!("feedback attachment: {}", filename),
            "content": base64_content,
            "branch": branch,
        }))
        .send()
        .await
        .map_err(|e| format!("Upload failed: {e}"))?;

    let status = response.status();
    let body: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse upload response: {e}"))?;

    if !status.is_success() {
        let msg = body["message"].as_str().unwrap_or("Unknown error");
        return Err(format!("Upload error ({}): {}", status, msg));
    }

    let download_url = body["content"]["download_url"]
        .as_str()
        .ok_or("Missing download_url in response")?
        .to_string();

    Ok(download_url)
}

/// Ensure the `attachments` branch exists in the repo. Creates it from the default
/// branch HEAD if it doesn't exist yet.
async fn ensure_attachments_branch(
    client: &reqwest::Client,
    pat: &str,
    branch: &str,
) -> Result<(), String> {
    // Check if branch exists
    let check = client
        .get(format!(
            "https://api.github.com/repos/{}/branches/{}",
            GITHUB_REPO, branch
        ))
        .header("Authorization", format!("Bearer {}", pat))
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", "SkillBuilder")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .await
        .map_err(|e| format!("Branch check failed: {e}"))?;

    if check.status().is_success() {
        return Ok(());
    }

    // Get the default branch SHA to branch from
    let repo_response = client
        .get(format!("https://api.github.com/repos/{}", GITHUB_REPO))
        .header("Authorization", format!("Bearer {}", pat))
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", "SkillBuilder")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .await
        .map_err(|e| format!("Repo fetch failed: {e}"))?;

    let repo: serde_json::Value = repo_response
        .json()
        .await
        .map_err(|e| format!("Failed to parse repo: {e}"))?;

    let default_branch = repo["default_branch"]
        .as_str()
        .unwrap_or("main");

    let ref_response = client
        .get(format!(
            "https://api.github.com/repos/{}/git/ref/heads/{}",
            GITHUB_REPO, default_branch
        ))
        .header("Authorization", format!("Bearer {}", pat))
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", "SkillBuilder")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .await
        .map_err(|e| format!("Ref fetch failed: {e}"))?;

    let ref_data: serde_json::Value = ref_response
        .json()
        .await
        .map_err(|e| format!("Failed to parse ref: {e}"))?;

    let sha = ref_data["object"]["sha"]
        .as_str()
        .ok_or("Missing SHA for default branch")?;

    // Create the branch
    let create = client
        .post(format!(
            "https://api.github.com/repos/{}/git/refs",
            GITHUB_REPO
        ))
        .header("Authorization", format!("Bearer {}", pat))
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", "SkillBuilder")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .json(&serde_json::json!({
            "ref": format!("refs/heads/{}", branch),
            "sha": sha,
        }))
        .send()
        .await
        .map_err(|e| format!("Branch creation failed: {e}"))?;

    if create.status().is_success() || create.status() == reqwest::StatusCode::UNPROCESSABLE_ENTITY {
        Ok(())
    } else {
        Err(format!("Failed to create branch: {}", create.status()))
    }
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

fn is_text_type(mime: &str) -> bool {
    mime.starts_with("text/") || mime == "application/json"
}
