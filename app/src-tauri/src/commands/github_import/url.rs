use crate::types::GitHubRepoInfo;

/// Parse a GitHub URL or shorthand into structured repo info.
///
/// Supported formats:
/// - `https://github.com/owner/repo`
/// - `https://github.com/owner/repo/tree/branch`
/// - `https://github.com/owner/repo/tree/branch/sub/path`
/// - `github.com/owner/repo`
/// - `owner/repo`
/// - `owner/repo#branch`
#[tauri::command]
pub fn parse_github_url(url: String) -> Result<GitHubRepoInfo, String> {
    log::info!("[parse_github_url] url={}", url);
    parse_github_url_inner(&url)
}

pub(crate) fn parse_github_url_inner(url: &str) -> Result<GitHubRepoInfo, String> {
    let url = url.trim();
    if url.is_empty() {
        return Err("URL cannot be empty".to_string());
    }

    // Strip protocol + host prefix to get the path portion
    let path = url
        .strip_prefix("https://github.com/")
        .or_else(|| url.strip_prefix("http://github.com/"))
        .or_else(|| url.strip_prefix("github.com/"))
        .unwrap_or(url);

    // Remove trailing slash
    let path = path.trim_end_matches('/');

    // Remove trailing .git
    let path = path.strip_suffix(".git").unwrap_or(path);

    if path.is_empty() {
        return Err("Could not extract owner/repo from URL".to_string());
    }

    // Handle owner/repo#branch shorthand — extract branch before splitting on '/'
    let (path, hash_branch) = if let Some((before, after)) = path.split_once('#') {
        (before.trim_end_matches('/'), Some(after))
    } else {
        (path, None)
    };

    let segments: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();

    if segments.len() < 2 {
        return Err(format!(
            "Invalid GitHub URL '{}': expected at least owner/repo",
            url
        ));
    }

    let owner = segments[0].to_string();
    let repo = segments[1].to_string();

    // Validate owner and repo don't contain path separators or traversal patterns
    if owner.is_empty() || repo.is_empty() {
        return Err(format!("Owner and repo cannot be empty in URL '{}'", url));
    }
    if owner.contains('\\') || repo.contains('\\') || owner.contains("..") || repo.contains("..") {
        return Err(format!("Invalid owner/repo in URL '{}'", url));
    }

    // Check for /tree/branch[/subpath] pattern
    if segments.len() >= 4 && segments[2] == "tree" {
        let branch = segments[3].to_string();
        let subpath = if segments.len() > 4 {
            Some(segments[4..].join("/"))
        } else {
            None
        };
        Ok(GitHubRepoInfo {
            owner,
            repo,
            branch,
            subpath,
        })
    } else if segments.len() == 2 {
        // owner/repo or owner/repo#branch — use hash_branch if present, else default to "main"
        let branch = hash_branch
            .filter(|b| !b.is_empty())
            .map(|b| b.to_string())
            .unwrap_or_else(|| "main".to_string());
        Ok(GitHubRepoInfo {
            owner,
            repo,
            branch,
            subpath: None,
        })
    } else {
        // Something like owner/repo/blob/... or other unsupported pattern
        Err(format!(
            "Unsupported GitHub URL format '{}': expected owner/repo, owner/repo#branch, or owner/repo/tree/branch[/path]",
            url
        ))
    }
}

/// Returns the repo-relative path to the marketplace manifest for a given subpath.
///
/// With subpath:    `plugins/.claude-plugin/marketplace.json`
/// Without subpath: `.claude-plugin/marketplace.json`
pub(crate) fn marketplace_manifest_path(subpath: Option<&str>) -> String {
    match subpath {
        Some(sp) => format!("{}/.claude-plugin/marketplace.json", sp),
        None => ".claude-plugin/marketplace.json".to_string(),
    }
}
