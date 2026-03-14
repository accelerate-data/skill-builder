/// Build a `reqwest::Client` with standard GitHub API headers.
/// If an OAuth token is available in settings, it is included as a Bearer token.
pub(crate) fn build_github_client(token: Option<&str>) -> reqwest::Client {
    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert("Accept", "application/vnd.github+json".parse().unwrap());
    headers.insert("User-Agent", "SkillBuilder".parse().unwrap());
    headers.insert("X-GitHub-Api-Version", "2022-11-28".parse().unwrap());
    if let Some(tok) = token {
        if let Ok(val) = format!("Bearer {}", tok).parse() {
            headers.insert("Authorization", val);
        }
    }
    reqwest::Client::builder()
        .default_headers(headers)
        .timeout(std::time::Duration::from_secs(30))
        .connect_timeout(std::time::Duration::from_secs(10))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
}

/// Fetch the default branch name for a GitHub repo via the API.
pub(crate) async fn get_default_branch(
    client: &reqwest::Client,
    owner: &str,
    repo: &str,
) -> Result<String, String> {
    let url = format!("https://api.github.com/repos/{}/{}", owner, repo);
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch repo info: {}", e))?;
    let status = response.status();
    let body: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse repo response: {}", e))?;
    if !status.is_success() {
        let message = body["message"].as_str().unwrap_or("Unknown error");
        return Err(format!("GitHub API error ({}): {}", status, message));
    }
    Ok(body["default_branch"]
        .as_str()
        .unwrap_or("main")
        .to_string())
}

/// Resolve the actual default branch and fetch the full recursive git tree.
///
/// Combines two API calls (repos + git/trees) that are repeated across
/// `list_github_skills_inner`, `import_github_skills`, and
/// `import_marketplace_to_library`.
pub(crate) async fn fetch_repo_tree(
    client: &reqwest::Client,
    owner: &str,
    repo: &str,
    fallback_branch: &str,
) -> Result<(String, Vec<serde_json::Value>), String> {
    let branch = get_default_branch(client, owner, repo)
        .await
        .unwrap_or_else(|_| fallback_branch.to_string());

    let tree_url = format!(
        "https://api.github.com/repos/{}/{}/git/trees/{}?recursive=1",
        owner, repo, branch
    );

    let response = client
        .get(&tree_url)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch repo tree: {}", e))?;

    let status = response.status();
    let body: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse tree response: {}", e))?;

    if !status.is_success() {
        let message = body["message"].as_str().unwrap_or("Unknown error");
        return Err(format!("GitHub API error ({}): {}", status, message));
    }

    let tree = body["tree"]
        .as_array()
        .ok_or("Invalid tree response: missing 'tree' array")?
        .clone();

    Ok((branch, tree))
}
