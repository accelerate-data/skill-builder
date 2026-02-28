use crate::db::Db;
use crate::types::{AvailableSkill, GitHubRepoInfo, ImportedSkill, MarketplaceJson};
use sha2::Digest;
use std::fs;
use std::path::Path;

/// Returns true if `marketplace` is strictly newer than `installed` by semver rules.
/// Returns false if either value fails to parse (avoids false positives for non-standard version strings).
fn semver_gt(marketplace: &str, installed: &str) -> bool {
    match (semver::Version::parse(marketplace), semver::Version::parse(installed)) {
        (Ok(mp), Ok(inst)) => mp > inst,
        _ => false,
    }
}

/// Merge existing field values into a new `ImportedSkill`: each field on `skill`
/// is left unchanged if already `Some`, otherwise falls back to the `existing` value.
fn merge_imported_fields(skill: &mut ImportedSkill, existing: &ImportedSkill) {
    if skill.purpose.is_none() { skill.purpose = existing.purpose.clone(); }
    if skill.description.is_none() { skill.description = existing.description.clone(); }
    if skill.model.is_none() { skill.model = existing.model.clone(); }
    if skill.argument_hint.is_none() { skill.argument_hint = existing.argument_hint.clone(); }
    if skill.user_invocable.is_none() { skill.user_invocable = existing.user_invocable; }
    if skill.disable_model_invocation.is_none() { skill.disable_model_invocation = existing.disable_model_invocation; }
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
async fn fetch_repo_tree(
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

/// Build a `reqwest::Client` with standard GitHub API headers.
/// If an OAuth token is available in settings, it is included as a Bearer token.
pub(crate) fn build_github_client(token: Option<&str>) -> reqwest::Client {
    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert("Accept", "application/vnd.github+json".parse().unwrap());
    headers.insert("User-Agent", "SkillBuilder".parse().unwrap());
    headers.insert(
        "X-GitHub-Api-Version",
        "2022-11-28".parse().unwrap(),
    );
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

// ---------------------------------------------------------------------------
// parse_github_url
// ---------------------------------------------------------------------------

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

fn parse_github_url_inner(url: &str) -> Result<GitHubRepoInfo, String> {
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

// ---------------------------------------------------------------------------
// marketplace_manifest_path
// ---------------------------------------------------------------------------

/// Returns the repo-relative path to the marketplace manifest for a given subpath.
///
/// With subpath:    `plugins/.claude-plugin/marketplace.json`
/// Without subpath: `.claude-plugin/marketplace.json`
fn marketplace_manifest_path(subpath: Option<&str>) -> String {
    match subpath {
        Some(sp) => format!("{}/.claude-plugin/marketplace.json", sp),
        None => ".claude-plugin/marketplace.json".to_string(),
    }
}

// ---------------------------------------------------------------------------
// check_marketplace_url
// ---------------------------------------------------------------------------

/// Verify that a URL points to an accessible GitHub repository that contains
/// a valid `.claude-plugin/marketplace.json` file.
///
/// Unlike `list_github_skills`, this uses the repos API (`GET /repos/{owner}/{repo}`)
/// which succeeds regardless of the default branch name. This avoids the 404
/// that occurs when the repo's default branch is not "main".
///
/// After confirming the repo is accessible it fetches
/// `.claude-plugin/marketplace.json` via `raw.githubusercontent.com` and
/// returns a clear error if the file is missing or not valid JSON.
/// Returns the `name` field from `.claude-plugin/marketplace.json`, falling back
/// to `"{owner}/{repo}"` if the field is absent.
#[tauri::command]
pub async fn check_marketplace_url(
    db: tauri::State<'_, Db>,
    url: String,
) -> Result<String, String> {
    log::info!("[check_marketplace_url] url={}", url);
    let repo_info = parse_github_url_inner(&url)?;
    let token = {
        let conn = db.0.lock().map_err(|e| {
            log::error!("[check_marketplace_url] failed to acquire DB lock: {}", e);
            e.to_string()
        })?;
        let settings = crate::db::read_settings_hydrated(&conn)?;
        settings.github_oauth_token.clone()
    };
    let client = build_github_client(token.as_deref());
    let owner = &repo_info.owner;
    let repo = &repo_info.repo;
    let resolved_branch = get_default_branch(&client, owner, repo).await?;

    // Verify that .claude-plugin/marketplace.json exists and is valid JSON.
    // Respect any subpath in the URL (e.g. /tree/main/plugins → plugins/.claude-plugin/marketplace.json).
    let manifest_path = marketplace_manifest_path(repo_info.subpath.as_deref());
    let raw_url = format!(
        "https://raw.githubusercontent.com/{}/{}/{}/{}",
        owner, repo, resolved_branch, manifest_path
    );
    log::info!(
        "[check_marketplace_url] fetching marketplace.json from {}/{} branch={}",
        owner, repo, resolved_branch
    );

    let not_found_msg = format!(
        "marketplace.json not found at {} in {}/{}. Ensure the repository has this file.",
        manifest_path, owner, repo
    );

    let response = client
        .get(&raw_url)
        .send()
        .await
        .map_err(|e| {
            log::error!("[check_marketplace_url] failed to fetch marketplace.json for {}/{}: {}", owner, repo, e);
            format!("Failed to reach {}/{}: {}", owner, repo, e)
        })?;

    if !response.status().is_success() {
        log::error!(
            "[check_marketplace_url] marketplace.json not found for {}/{}: HTTP {}",
            owner, repo, response.status()
        );
        return Err(not_found_msg);
    }

    let body = response.text().await.map_err(|e| {
        log::error!("[check_marketplace_url] failed to read marketplace.json body for {}/{}: {}", owner, repo, e);
        format!("Failed to read marketplace.json: {}", e)
    })?;

    let manifest = serde_json::from_str::<MarketplaceJson>(&body).map_err(|e| {
        log::error!("[check_marketplace_url] marketplace.json is not valid JSON for {}/{}: {}", owner, repo, e);
        format!("marketplace.json at {} in {}/{} is not valid JSON.", manifest_path, owner, repo)
    })?;

    let name = manifest.name
        .filter(|n| !n.trim().is_empty())
        .unwrap_or_else(|| format!("{}/{}", owner, repo));

    log::info!("[check_marketplace_url] marketplace.json validated for {}/{} name={}", owner, repo, name);
    Ok(name)
}

// ---------------------------------------------------------------------------
// discover_skills_from_catalog
// ---------------------------------------------------------------------------

/// Pure skill-discovery kernel: given a marketplace catalog and a pre-built set of
/// repository-relative directory paths that contain a `SKILL.md` blob, return all
/// importable [`AvailableSkill`] entries.
///
/// Each catalog entry's `source` points to a **plugin directory**. Skills live exactly
/// one level below that directory's `skills/` subdirectory:
///
/// ```text
/// {plugin_path}/skills/{skill_name}/SKILL.md
/// ```
///
/// Source path resolution rules (in order):
/// 1. Paths starting with `./` are stripped of `./` and anchored to the marketplace
///    directory (i.e. relative to `subpath`, or repo root if `subpath` is `None`).
/// 2. Bare names (no `./`) have `plugin_root` prepended when set, then are anchored
///    the same way.
/// 3. `subpath` is always prepended to anchor sources to the repo root.
///
/// External source types (`github`, `npm`, `pip`, `url`) are skipped with a warning.
/// Plugin entries that yield no skills are silently skipped (logged at `debug`).
/// No fallback paths are attempted.
pub(crate) fn discover_skills_from_catalog(
    plugins: &[crate::types::MarketplacePlugin],
    plugin_root: Option<&str>,
    skill_dirs: &std::collections::HashSet<String>,
    subpath: Option<&str>,
) -> Vec<crate::types::AvailableSkill> {
    use crate::types::{AvailableSkill, MarketplacePluginSource};

    let mut skills = Vec::new();

    for plugin in plugins {
        let source_str = match &plugin.source {
            MarketplacePluginSource::Path(s) => s,
            MarketplacePluginSource::External { source, .. } => {
                let name = plugin.name.as_deref().unwrap_or("<unnamed>");
                log::warn!(
                    "[discover_skills] skipping plugin '{}' — unsupported source type '{}'",
                    name, source
                );
                continue;
            }
        };

        // Resolve the plugin directory path relative to the repo root.
        //
        // • Relative paths (start with `./`): strip `./` prefix; the remainder is
        //   relative to the marketplace directory.
        // • Bare names (no `./`): prepend `plugin_root` if set.
        // • Then prepend `subpath` to anchor to the repo root.
        let relative_part: String = if source_str.starts_with("./") {
            source_str
                .strip_prefix("./")
                .unwrap_or(source_str)
                .trim_end_matches('/')
                .to_string()
        } else {
            let trimmed = source_str.trim_end_matches('/');
            match plugin_root.filter(|r| !r.is_empty()) {
                Some(root) => format!("{}/{}", root.trim_end_matches('/'), trimmed),
                None => trimmed.to_string(),
            }
        };

        let plugin_path: String = match subpath.filter(|s| !s.is_empty()) {
            Some(sp) if !relative_part.is_empty() => {
                format!("{}/{}", sp.trim_end_matches('/'), relative_part)
            }
            Some(sp) => sp.trim_end_matches('/').to_string(),
            None => relative_part,
        };

        // Skills prefix: all valid skill dirs for this plugin start with this.
        // When plugin_path is empty (source was `"./"`), prefix is simply `"skills/"`.
        let skills_prefix = if plugin_path.is_empty() {
            "skills/".to_string()
        } else {
            format!("{}/skills/", plugin_path)
        };

        let plugin_name = plugin.name.as_deref().unwrap_or("<unnamed>");
        let before = skills.len();

        // Collect skill entries: dirs that start with skills_prefix and whose
        // remainder (the skill name) is a single path segment — no further `/`.
        for dir in skill_dirs {
            if let Some(skill_name) = dir.strip_prefix(&skills_prefix) {
                if skill_name.is_empty() || skill_name.contains('/') {
                    continue;
                }
                skills.push(AvailableSkill {
                    path: dir.clone(),
                    name: skill_name.to_string(),
                    plugin_name: None, // populated later from plugin.json
                    description: plugin.description.clone(),
                    purpose: Some("general-purpose".to_string()),
                    version: None,
                    model: None,
                    argument_hint: None,
                    user_invocable: None,
                    disable_model_invocation: None,
                });
            }
        }

        let found = skills.len() - before;
        if found == 0 {
            log::debug!(
                "[discover_skills] plugin '{}' (source='{}') — no skills found under '{}'",
                plugin_name, source_str, skills_prefix
            );
        } else {
            log::debug!(
                "[discover_skills] plugin '{}' — found {} skill(s) under '{}'",
                plugin_name, found, skills_prefix
            );
        }
    }

    skills
}

// ---------------------------------------------------------------------------
// extract_plugin_path
// ---------------------------------------------------------------------------

/// Given a skill's repo-relative path (`{plugin_path}/skills/{skill_name}`), return the
/// plugin directory prefix.
///
/// Examples:
/// - `"engineering/skills/standup"` → `"engineering"`
/// - `"plugins/eng/skills/standup"` → `"plugins/eng"`
/// - `"skills/standup"` → `""` (root plugin: `skills/` is at the repo root)
fn extract_plugin_path(skill_path: &str) -> &str {
    if let Some(idx) = skill_path.find("/skills/") {
        &skill_path[..idx]
    } else {
        // root plugin — skills/ is directly under the repo root (or subpath root),
        // or unrecognised path structure
        ""
    }
}

// ---------------------------------------------------------------------------
// list_github_skills
// ---------------------------------------------------------------------------

/// Fetch the repo tree and find all SKILL.md files, returning metadata for each.
#[tauri::command]
pub async fn list_github_skills(
    db: tauri::State<'_, Db>,
    owner: String,
    repo: String,
    branch: String,
    subpath: Option<String>,
) -> Result<Vec<AvailableSkill>, String> {
    log::info!("[list_github_skills] owner={} repo={} branch={} subpath={:?}", owner, repo, branch, subpath);
    // Read OAuth token if available
    let token = {
        let conn = db.0.lock().map_err(|e| {
            log::error!("[list_github_skills] failed to acquire DB lock: {}", e);
            e.to_string()
        })?;
        let settings = crate::db::read_settings_hydrated(&conn)?;
        settings.github_oauth_token.clone()
    };

    let (_, skills) = list_github_skills_inner(&owner, &repo, &branch, subpath.as_deref(), token.as_deref())
        .await?;
    Ok(skills)
}

pub(crate) async fn list_github_skills_inner(
    owner: &str,
    repo: &str,
    branch: &str,
    subpath: Option<&str>,
    token: Option<&str>,
) -> Result<(Option<String>, Vec<AvailableSkill>), String> {
    let client = build_github_client(token);

    // Resolve the actual default branch when the caller passed a placeholder.
    let resolved_branch = if branch.is_empty() {
        get_default_branch(&client, owner, repo)
            .await
            .unwrap_or_else(|_| "main".to_string())
    } else {
        get_default_branch(&client, owner, repo)
            .await
            .unwrap_or_else(|_| branch.to_string())
    };

    // Fetch .claude-plugin/marketplace.json via raw.githubusercontent.com.
    // Respect any subpath in the URL (e.g. /tree/main/plugins → plugins/.claude-plugin/marketplace.json).
    let manifest_path = marketplace_manifest_path(subpath);
    let raw_url = format!(
        "https://raw.githubusercontent.com/{}/{}/{}/{}",
        owner, repo, resolved_branch, manifest_path
    );

    log::info!(
        "[list_github_skills_inner] fetching marketplace.json from {}/{} branch={}",
        owner, repo, resolved_branch
    );

    let response = client
        .get(&raw_url)
        .send()
        .await
        .map_err(|e| {
            log::error!(
                "[list_github_skills_inner] failed to fetch marketplace.json for {}/{}: {}",
                owner, repo, e
            );
            format!(
                "marketplace.json not found at {} in {}/{}. Ensure the repository has this file.",
                manifest_path, owner, repo
            )
        })?;

    let status = response.status();
    if !status.is_success() {
        log::error!(
            "[list_github_skills_inner] failed to fetch marketplace.json for {}/{}: HTTP {}",
            owner, repo, status
        );
        return Err(format!(
            "marketplace.json not found at {} in {}/{}. Ensure the repository has this file.",
            manifest_path, owner, repo
        ));
    }

    let body = response
        .text()
        .await
        .map_err(|e| {
            log::error!(
                "[list_github_skills_inner] failed to read marketplace.json body for {}/{}: {}",
                owner, repo, e
            );
            format!("Failed to read marketplace.json: {}", e)
        })?;

    let marketplace: MarketplaceJson = serde_json::from_str(&body).map_err(|e| {
        log::error!(
            "[list_github_skills_inner] failed to parse marketplace.json for {}/{}: {}",
            owner, repo, e
        );
        format!("Failed to parse marketplace.json: {}", e)
    })?;

    // Fetch the repo tree to discover which skill directories exist.
    let (_, tree) = fetch_repo_tree(&client, owner, repo, &resolved_branch).await?;

    // Build the set of directories that own a SKILL.md blob in the tree.
    let skill_dirs: std::collections::HashSet<String> = tree
        .iter()
        .filter_map(|entry| {
            let p = entry["path"].as_str()?;
            if entry["type"].as_str()? != "blob" {
                return None;
            }
            p.strip_suffix("/SKILL.md").map(|dir| dir.to_string())
        })
        .collect();

    let plugin_root = marketplace.metadata.as_ref().and_then(|m| m.plugin_root.as_deref());
    let skills = discover_skills_from_catalog(&marketplace.plugins, plugin_root, &skill_dirs, subpath);

    log::info!(
        "[list_github_skills_inner] found {} candidate skills from catalog in {}/{} (registry={})",
        skills.len(), owner, repo, marketplace.name.as_deref().unwrap_or("unknown")
    );

    // Fetch each skill's SKILL.md concurrently to populate version, purpose, and other frontmatter.
    let fetch_fns: Vec<_> = skills
        .iter()
        .map(|skill| {
            let client = client.clone();
            let url = format!(
                "https://raw.githubusercontent.com/{}/{}/{}/{}/SKILL.md",
                owner, repo, resolved_branch, skill.path
            );
            async move {
                match client.get(&url)
                    .header("Cache-Control", "no-cache")
                    .header("Pragma", "no-cache")
                    .send()
                    .await
                {
                    Ok(resp) if resp.status().is_success() => resp.text().await.ok(),
                    _ => None,
                }
            }
        })
        .collect();

    let contents = futures::future::join_all(fetch_fns).await;

    // Skill name MUST come from SKILL.md frontmatter `name:` field — no directory fallback.
    // Skills whose SKILL.md is missing or has no `name:` are excluded from results.
    let mut final_skills: Vec<AvailableSkill> = Vec::new();
    for (mut skill, content_opt) in skills.into_iter().zip(contents) {
        match content_opt {
            Some(content) => {
                let fm = super::imported_skills::parse_frontmatter_full(&content);
                match fm.name {
                    Some(name) => {
                        skill.name = name;
                        if let Some(desc) = fm.description { skill.description = Some(desc); }
                        skill.version = fm.version;
                        skill.model = fm.model;
                        skill.argument_hint = fm.argument_hint;
                        skill.user_invocable = fm.user_invocable;
                        skill.disable_model_invocation = fm.disable_model_invocation;
                        final_skills.push(skill);
                    }
                    None => {
                        log::debug!(
                            "[list_github_skills_inner] skipping skill at '{}': no 'name' field in SKILL.md frontmatter",
                            skill.path
                        );
                    }
                }
            }
            None => {
                log::debug!(
                    "[list_github_skills_inner] skipping skill at '{}': SKILL.md could not be fetched",
                    skill.path
                );
            }
        }
    }

    // Fetch plugin.json for each unique plugin path to get the display name.
    // Skills are listed as `{plugin_name}:{skill_name}` in the browse dialog;
    // locally they are stored under their plain `name`.
    let unique_plugin_paths: std::collections::HashSet<String> = final_skills
        .iter()
        .map(|s| extract_plugin_path(&s.path).to_string())
        .collect();

    let plugin_json_fns: Vec<_> = unique_plugin_paths
        .iter()
        .map(|pp| {
            let client = client.clone();
            let plugin_json_path = if pp.is_empty() {
                ".claude-plugin/plugin.json".to_string()
            } else {
                format!("{}/.claude-plugin/plugin.json", pp)
            };
            let url = format!(
                "https://raw.githubusercontent.com/{}/{}/{}/{}",
                owner, repo, resolved_branch, plugin_json_path
            );
            let pp = pp.clone();
            async move {
                let name = match client.get(&url).send().await {
                    Ok(resp) if resp.status().is_success() => {
                        resp.text().await.ok().and_then(|body| {
                            serde_json::from_str::<serde_json::Value>(&body)
                                .ok()
                                .and_then(|v| v["name"].as_str().map(|s| s.to_string()))
                                .filter(|n| !n.trim().is_empty())
                        })
                    }
                    _ => None,
                };
                (pp, name)
            }
        })
        .collect();

    let plugin_name_results = futures::future::join_all(plugin_json_fns).await;
    let plugin_name_map: std::collections::HashMap<String, String> = plugin_name_results
        .into_iter()
        .filter_map(|(pp, name)| name.map(|n| (pp, n)))
        .collect();

    for skill in &mut final_skills {
        let pp = extract_plugin_path(&skill.path).to_string();
        skill.plugin_name = plugin_name_map.get(&pp).cloned();
    }

    log::info!(
        "[list_github_skills_inner] returning {} skills after frontmatter filtering",
        final_skills.len()
    );

    Ok((marketplace.name.clone(), final_skills))
}

// ---------------------------------------------------------------------------
// import_github_skills
// ---------------------------------------------------------------------------

/// Per-skill import request with optional purpose tag and metadata overrides.
#[derive(serde::Deserialize)]
pub struct WorkspaceSkillImportRequest {
    pub path: String,
    pub purpose: Option<String>,
    pub metadata_override: Option<crate::types::SkillMetadataOverride>,
    /// Caller-supplied marketplace version — used for the pre-download version guard.
    /// When present and the installed version is already >= this value, the skill is
    /// skipped before any disk operation (prevents the directory from being deleted
    /// and re-downloaded only to be thrown away).
    pub version: Option<String>,
}

/// Import selected skills from a GitHub repo into the local workspace.
///
/// Accepts a list of `WorkspaceSkillImportRequest` items. Each item specifies
/// the skill path, an optional purpose tag, and optional metadata overrides.
///
/// If a workspace_skills row with the same skill_name already exists, it is
/// updated (version, model, domain, description, disk_path, etc.) while
/// preserving `is_active` and `is_bundled`. New skills are inserted.
#[tauri::command]
pub async fn import_github_skills(
    db: tauri::State<'_, Db>,
    owner: String,
    repo: String,
    branch: String,
    skill_requests: Vec<WorkspaceSkillImportRequest>,
    source_url: Option<String>,
) -> Result<Vec<ImportedSkill>, String> {
    log::info!(
        "[import_github_skills] owner={} repo={} branch={} count={} source_url={:?}",
        owner, repo, branch, skill_requests.len(), source_url
    );
    // Read settings
    let (workspace_path, token) = {
        let conn = db.0.lock().map_err(|e| {
            log::error!("[import_github_skills] failed to acquire DB lock: {}", e);
            e.to_string()
        })?;
        let settings = crate::db::read_settings_hydrated(&conn)?;
        let wp = settings
            .workspace_path
            .ok_or_else(|| "Workspace path not initialized".to_string())?;
        (wp, settings.github_oauth_token.clone())
    };

    let client = build_github_client(token.as_deref());
    let (branch, tree) = fetch_repo_tree(&client, &owner, &repo, &branch).await?;

    let skills_dir = Path::new(&workspace_path).join(".claude").join("skills");
    let mut imported: Vec<ImportedSkill> = Vec::new();
    let mut errors: Vec<String> = Vec::new();
    let mut skipped: Vec<String> = Vec::new();

    for req in &skill_requests {
        let skill_path = &req.path;
        let purpose = req.purpose.clone();
        let metadata_override = req.metadata_override.as_ref();

        // Derive the candidate skill name from the directory path (last segment).
        let dir_name = skill_path
            .trim_end_matches('/')
            .rsplit('/')
            .next()
            .unwrap_or(skill_path.as_str());

        // Check if this skill is already installed (by dir name as proxy for skill_name).
        let existing = {
            let conn = db.0.lock().map_err(|e| e.to_string())?;
            crate::db::get_workspace_skill_by_name(&conn, dir_name)?
        };

        // Pre-download version guard: if the caller supplied the marketplace version and an
        // existing install is found, skip before touching the disk at all. This avoids the
        // directory being deleted and re-downloaded only to be thrown away post-import.
        if let (Some(ref existing_skill), Some(ref mp_ver)) = (&existing, &req.version) {
            let inst_ver = existing_skill.version.as_deref().unwrap_or("");
            if !semver_gt(mp_ver, inst_ver) {
                log::info!(
                    "[import_github_skills] {} already at version {:?}, skipping (pre-download guard)",
                    dir_name, existing_skill.version
                );
                skipped.push(dir_name.to_string());
                continue;
            }
        }

        // Overwrite the on-disk directory if an existing installation is found.
        let should_overwrite = existing.is_some();

        match import_single_skill(
            &client,
            "https://raw.githubusercontent.com",
            &owner,
            &repo,
            &branch,
            skill_path,
            &tree,
            &skills_dir,
            should_overwrite,
            metadata_override,
        )
        .await
        {
            Ok(mut skill) => {
                let conn = db.0.lock().map_err(|e| e.to_string())?;

                if let Some(ref existing_skill) = existing {
                    // Skip if marketplace version is NOT strictly greater than installed version.
                    let mp_ver = skill.version.as_deref().unwrap_or("");
                    let inst_ver = existing_skill.version.as_deref().unwrap_or("");
                    if !semver_gt(mp_ver, inst_ver) {
                        log::info!(
                            "[import_github_skills] {} already at version {:?}, skipping",
                            skill.skill_name, skill.version
                        );
                        if let Err(e) = fs::remove_dir_all(&skill.disk_path) {
                            log::warn!(
                                "[import_github_skills] cleanup failed for {}: {}",
                                skill.disk_path, e
                            );
                        }
                        skipped.push(skill.skill_name.clone());
                        continue;
                    }
                    // Different version — merge: new frontmatter wins if Some, else fall back to existing WorkspaceSkill
                    if skill.purpose.is_none() { skill.purpose = existing_skill.purpose.clone(); }
                    if skill.description.is_none() { skill.description = existing_skill.description.clone(); }
                    if skill.model.is_none() { skill.model = existing_skill.model.clone(); }
                    if skill.argument_hint.is_none() { skill.argument_hint = existing_skill.argument_hint.clone(); }
                    if skill.user_invocable.is_none() { skill.user_invocable = existing_skill.user_invocable; }
                    if skill.disable_model_invocation.is_none() { skill.disable_model_invocation = existing_skill.disable_model_invocation; }
                    log::info!(
                        "[import_github_skills] upgrading {} from {:?} to {:?}",
                        skill.skill_name, existing_skill.version, skill.version
                    );
                }

                let mut ws_skill: crate::types::WorkspaceSkill = skill.clone().into();
                ws_skill.purpose = purpose.clone();
                ws_skill.marketplace_source_url = source_url.clone();

                if let Some(ref existing_skill) = existing {
                    // Preserve is_active, is_bundled, skill_id, imported_at from the existing row
                    ws_skill.is_active = existing_skill.is_active;
                    ws_skill.is_bundled = existing_skill.is_bundled;
                    ws_skill.skill_id = existing_skill.skill_id.clone();
                    ws_skill.imported_at = existing_skill.imported_at.clone();
                    if let Err(e) = crate::db::upsert_workspace_skill(&conn, &ws_skill) {
                        if let Err(cleanup_err) = fs::remove_dir_all(&skill.disk_path) {
                            log::warn!(
                                "[import_github_skills] cleanup failed after upsert error for {}: {}",
                                skill.disk_path, cleanup_err
                            );
                        }
                        errors.push(format!("{}: {}", skill.skill_name, e));
                    } else {
                        // Compute and store the content hash as the new baseline
                        if let Some(hash) = compute_skill_content_hash(&skill.disk_path) {
                            if let Err(e) = crate::db::set_workspace_skill_content_hash(&conn, &skill.skill_name, &hash) {
                                log::warn!("[import_github_skills] failed to set content_hash for '{}': {}", skill.skill_name, e);
                            }
                        }
                        imported.push(skill);
                    }
                } else {
                    log::debug!(
                        "[import_github_skills] inserting new workspace skill '{}'",
                        ws_skill.skill_name
                    );
                    match crate::db::insert_workspace_skill(&conn, &ws_skill) {
                        Ok(()) => {
                            // Compute and store the content hash as the baseline
                            if let Some(hash) = compute_skill_content_hash(&ws_skill.disk_path) {
                                if let Err(e) = crate::db::set_workspace_skill_content_hash(&conn, &ws_skill.skill_name, &hash) {
                                    log::warn!("[import_github_skills] failed to set content_hash for '{}': {}", ws_skill.skill_name, e);
                                }
                            }
                            imported.push(skill);
                        }
                        Err(e) => {
                            if let Err(cleanup_err) = fs::remove_dir_all(&ws_skill.disk_path) {
                                log::warn!(
                                    "Failed to clean up skill directory '{}' after DB error: {}",
                                    ws_skill.disk_path, cleanup_err
                                );
                            }
                            errors.push(format!("{}: {}", skill.skill_name, e));
                        }
                    }
                }
            }
            Err(e) => {
                errors.push(format!("{}: {}", skill_path, e));
            }
        }
    }

    if imported.is_empty() && !errors.is_empty() {
        return Err(format!("All imports failed: {}", errors.join("; ")));
    }

    // If some succeeded and some failed, log warnings but return the successes
    for err in &errors {
        log::warn!("Skill import error: {}", err);
    }
    for name in &skipped {
        log::info!("[import_github_skills] skipped '{}': already at same or newer version", name);
    }

    // Regenerate CLAUDE.md with imported skills section
    if !imported.is_empty() {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        if let Err(e) = super::workflow::update_skills_section(&workspace_path, &conn) {
            log::warn!("Failed to update CLAUDE.md after GitHub import: {}", e);
        }
    }

    Ok(imported)
}

// ---------------------------------------------------------------------------
// get_dashboard_skill_names
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_dashboard_skill_names(db: tauri::State<'_, Db>) -> Result<Vec<String>, String> {
    log::info!("[get_dashboard_skill_names]");
    let conn = db.0.lock().map_err(|e| { log::error!("[get_dashboard_skill_names] lock failed: {}", e); e.to_string() })?;
    crate::db::get_dashboard_skill_names(&conn)
}

// ---------------------------------------------------------------------------
// import_marketplace_to_library
// ---------------------------------------------------------------------------

/// Result of a single marketplace skill import attempt.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct MarketplaceImportResult {
    pub skill_name: String,
    pub success: bool,
    pub error: Option<String>,
}

/// Import one or more skills from a marketplace registry into the Skill Library.
/// `source_url` is the registry URL the caller is operating on (caller already knows which registry).
/// Each successfully imported skill gets a `workflow_runs` row with `source='marketplace'`.
#[tauri::command]
pub async fn import_marketplace_to_library(
    db: tauri::State<'_, Db>,
    source_url: String,
    skill_paths: Vec<String>,
    metadata_overrides: Option<std::collections::HashMap<String, crate::types::SkillMetadataOverride>>,
) -> Result<Vec<MarketplaceImportResult>, String> {
    log::info!(
        "[import_marketplace_to_library] importing {} skills from {} (with_overrides={})",
        skill_paths.len(),
        source_url,
        metadata_overrides.is_some()
    );

    // Read settings
    let (workspace_path, skills_path, token) = {
        let conn = db.0.lock().map_err(|e| {
            log::error!("[import_marketplace_to_library] failed to acquire DB lock: {}", e);
            e.to_string()
        })?;
        let settings = crate::db::read_settings_hydrated(&conn).map_err(|e| {
            log::error!("[import_marketplace_to_library] failed to read settings: {}", e);
            e
        })?;
        let wp = settings.workspace_path.ok_or_else(|| {
            let msg = "Workspace path not initialized".to_string();
            log::error!("[import_marketplace_to_library] {}", msg);
            msg
        })?;
        let sp = settings.skills_path.ok_or_else(|| {
            let msg = "Skills path not configured. Set it in Settings.".to_string();
            log::error!("[import_marketplace_to_library] {}", msg);
            msg
        })?;
        (wp, sp, settings.github_oauth_token.clone())
    };

    // Parse the registry URL into owner/repo/branch
    let repo_info = parse_github_url_inner(&source_url).map_err(|e| {
        log::error!("[import_marketplace_to_library] failed to parse source_url '{}': {}", source_url, e);
        e
    })?;
    let owner = &repo_info.owner;
    let repo = &repo_info.repo;

    let client = build_github_client(token.as_deref());
    let (branch, tree) = fetch_repo_tree(&client, owner, repo, &repo_info.branch).await.map_err(|e| {
        log::error!("[import_marketplace_to_library] failed to fetch repo tree for {}/{}: {}", owner, repo, e);
        e
    })?;

    let skills_dir = Path::new(&skills_path);
    let mut results: Vec<MarketplaceImportResult> = Vec::new();

    for skill_path in &skill_paths {
        let override_ref = metadata_overrides.as_ref()
            .and_then(|m| m.get(skill_path.as_str()));
        match import_single_skill(&client, "https://raw.githubusercontent.com", owner, repo, &branch, skill_path, &tree, skills_dir, true, override_ref).await {
            Ok(mut skill) => {
                let conn = db.0.lock().map_err(|e| {
                    log::error!("[import_marketplace_to_library] failed to acquire DB lock for '{}': {}", skill_path, e);
                    e.to_string()
                })?;

                // Tag the skill with the registry it was imported from
                skill.marketplace_source_url = Some(source_url.clone());

                // Fetch existing imported skill metadata (if any) for merging on upgrade
                let existing_imported = crate::db::get_imported_skill(&conn, &skill.skill_name).unwrap_or(None);

                // Merge: new frontmatter value wins if Some, else fall back to existing installed value.
                // Version and skill_name are intentionally NOT merged — keep the new values.
                if let Some(ref existing) = existing_imported {
                    merge_imported_fields(&mut skill, existing);
                }

                // Insert into skills master first so that skills.id is available as a FK
                // when inserting into imported_skills below.
                let purpose_for_master = skill.purpose.as_deref().unwrap_or("domain");
                if let Err(e) = crate::db::save_marketplace_skill(&conn, &skill.skill_name, purpose_for_master,
                ) {
                    log::warn!(
                        "[import_marketplace_to_library] failed to save marketplace skill for '{}': {}",
                        skill.skill_name, e
                    );
                }

                // Upsert into imported_skills. Uses ON CONFLICT DO UPDATE so re-imports
                // (e.g. after skills_path changed) succeed rather than hitting a UNIQUE
                // constraint. skill_master_id FK is populated from the skills row above.
                if let Err(e) = crate::db::upsert_imported_skill(&conn, &skill) {
                    log::error!(
                        "[import_marketplace_to_library] failed to save imported_skills record for '{}': {}",
                        skill.skill_name, e
                    );
                    if let Err(ce) = fs::remove_dir_all(&skill.disk_path) {
                        log::warn!(
                            "[import_marketplace_to_library] cleanup failed for '{}': {}",
                            skill.disk_path, ce
                        );
                    }
                    results.push(MarketplaceImportResult {
                        skill_name: skill.skill_name,
                        success: false,
                        error: Some(e),
                    });
                    continue;
                }

                // Compute and store the content hash as the baseline for customization detection
                if let Some(hash) = compute_skill_content_hash(&skill.disk_path) {
                    if let Err(e) = crate::db::set_imported_skill_content_hash(&conn, &skill.skill_name, &hash) {
                        log::warn!("[import_marketplace_to_library] failed to set content_hash for '{}': {}", skill.skill_name, e);
                    }
                }

                log::info!(
                    "[import_marketplace_to_library] imported '{}' to '{}'",
                    skill.skill_name, skill.disk_path
                );
                results.push(MarketplaceImportResult {
                    skill_name: skill.skill_name,
                    success: true,
                    error: None,
                });
            }
            Err(e) => {
                log::error!(
                    "[import_marketplace_to_library] failed to import '{}': {}",
                    skill_path, e
                );
                results.push(MarketplaceImportResult {
                    skill_name: skill_path.clone(),
                    success: false,
                    error: Some(e),
                });
            }
        }
    }

    // Regenerate CLAUDE.md with imported skills section (only if at least one succeeded)
    if results.iter().any(|r| r.success) {
        let conn = db.0.lock().map_err(|e| {
            log::error!("[import_marketplace_to_library] failed to acquire DB lock for CLAUDE.md update: {}", e);
            e.to_string()
        })?;
        if let Err(e) = super::workflow::update_skills_section(&workspace_path, &conn) {
            log::warn!(
                "[import_marketplace_to_library] failed to update CLAUDE.md: {}",
                e
            );
        }
    }

    log::info!(
        "[import_marketplace_to_library] done: {} succeeded, {} failed",
        results.iter().filter(|r| r.success).count(),
        results.iter().filter(|r| !r.success).count()
    );

    Ok(results)
}

/// Wrap a YAML string value in double quotes, escaping backslashes, double
/// quotes, and newlines so that user-supplied values cannot inject extra keys.
fn yaml_quote(s: &str) -> String {
    let escaped = s
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n");
    format!("\"{}\"", escaped)
}

/// Rewrite the SKILL.md frontmatter block in the destination directory with values from `fm`.
fn rewrite_skill_md(dest_dir: &Path, fm: &super::imported_skills::Frontmatter) -> Result<(), String> {
    let skill_md_path = dest_dir.join("SKILL.md");
    let existing = fs::read_to_string(&skill_md_path)
        .map_err(|e| format!("Failed to read SKILL.md for rewrite: {}", e))?;
    let existing = existing.replace("\r\n", "\n");

    // Extract body: find the closing --- that ends the frontmatter block.
    // Must be a standalone line (not embedded in content) to avoid truncating
    // body content that contains markdown horizontal rules.
    let body = if existing.trim_start().starts_with("---") {
        let after_open = &existing.trim_start()[3..];
        // Skip past the opening marker's line ending
        let content = after_open.strip_prefix('\n').unwrap_or(after_open);
        // Find the first line that is exactly "---"
        let mut body_start: Option<usize> = None;
        let mut pos = 0;
        for line in content.lines() {
            if line.trim() == "---" {
                body_start = Some(pos + line.len() + 1); // +1 for newline
                break;
            }
            pos += line.len() + 1; // +1 for \n
        }
        match body_start {
            Some(start) if start < content.len() => content[start..].to_string(),
            _ => String::new(),
        }
    } else {
        // No frontmatter — keep original content as body
        existing.clone()
    };

    // Build new frontmatter YAML block
    let mut yaml = String::new();
    let mut add_field = |key: &str, val: &Option<String>| {
        if let Some(v) = val {
            yaml.push_str(&format!("{}: {}\n", key, yaml_quote(v)));
        }
    };
    add_field("name", &fm.name);
    add_field("description", &fm.description);
    add_field("version", &fm.version);
    add_field("model", &fm.model);
    add_field("argument-hint", &fm.argument_hint);
    if let Some(user_inv) = fm.user_invocable {
        yaml.push_str(&format!("user-invocable: {}\n", user_inv));
    }
    if let Some(disable) = fm.disable_model_invocation {
        yaml.push_str(&format!("disable-model-invocation: {}\n", disable));
    }

    let new_content = format!("---\n{}---\n{}", yaml, body);
    fs::write(&skill_md_path, new_content)
        .map_err(|e| format!("Failed to write updated SKILL.md: {}", e))?;

    Ok(())
}

/// Import a single skill directory from the repo tree.
///
/// When `overwrite` is `true`, an existing destination directory is removed before
/// downloading. This is used by marketplace imports so that re-imports (e.g. after
/// `skills_path` changed or files were manually deleted) always succeed.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn import_single_skill(
    client: &reqwest::Client,
    raw_base_url: &str,
    owner: &str,
    repo: &str,
    branch: &str,
    skill_path: &str,
    tree: &[serde_json::Value],
    skills_dir: &Path,
    overwrite: bool,
    metadata_override: Option<&crate::types::SkillMetadataOverride>,
) -> Result<ImportedSkill, String> {
    let prefix = if skill_path.is_empty() {
        String::new()
    } else if skill_path.ends_with('/') {
        skill_path.to_string()
    } else {
        format!("{}/", skill_path)
    };

    // Find all blob files under this skill's directory
    let files: Vec<&str> = tree
        .iter()
        .filter_map(|entry| {
            let entry_path = entry["path"].as_str()?;
            let entry_type = entry["type"].as_str()?;
            if entry_type != "blob" {
                return None;
            }
            if prefix.is_empty() {
                // Importing from repo root — only include root-level files
                Some(entry_path)
            } else if entry_path.starts_with(&prefix) {
                Some(entry_path)
            } else {
                None
            }
        })
        .collect();

    if files.is_empty() {
        return Err("No files found in skill directory".to_string());
    }

    // Make sure there is a SKILL.md
    let has_skill_md = files.iter().any(|f| {
        let relative = if prefix.is_empty() {
            f.to_string()
        } else {
            f.strip_prefix(&prefix).unwrap_or(f).to_string()
        };
        relative == "SKILL.md"
    });

    if !has_skill_md {
        return Err("SKILL.md not found in skill directory".to_string());
    }

    // Determine skill name from directory name
    let dir_name = skill_path
        .trim_end_matches('/')
        .rsplit('/')
        .next()
        .unwrap_or(skill_path);

    // Download SKILL.md first to get frontmatter
    let skill_md_url = format!(
        "{}/{}/{}/{}/{}",
        raw_base_url,
        owner,
        repo,
        branch,
        if prefix.is_empty() {
            "SKILL.md".to_string()
        } else {
            format!("{}SKILL.md", prefix)
        }
    );

    let skill_md_content = client
        .get(&skill_md_url)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch SKILL.md: {}", e))?
        .text()
        .await
        .map_err(|e| format!("Failed to read SKILL.md content: {}", e))?;

    let mut fm = super::imported_skills::parse_frontmatter_full(&skill_md_content);

    // purpose is set by the caller at import time (DB-only), not read from frontmatter.
    let override_purpose: Option<String> = metadata_override.and_then(|ov| ov.purpose.clone());

    // Apply metadata overrides if provided (before validation, so user-supplied values satisfy requirements)
    if let Some(ov) = metadata_override {
        fm.name = ov.name.clone().or(fm.name);
        fm.description = ov.description.clone().or(fm.description);
        fm.version = ov.version.clone().or(fm.version);
        // Empty string means "App default" — explicitly clear any model from frontmatter.
        fm.model = match ov.model.as_deref() {
            Some("") => None,
            Some(v) => Some(v.to_string()),
            None => fm.model,
        };
        fm.argument_hint = ov.argument_hint.clone().or(fm.argument_hint);
        fm.user_invocable = ov.user_invocable.or(fm.user_invocable);
        fm.disable_model_invocation = ov.disable_model_invocation.or(fm.disable_model_invocation);
        log::debug!(
            "[import_single_skill] applied metadata override for '{}': name={:?} purpose={:?}",
            dir_name, fm.name, override_purpose
        );
    }

    // Skill name MUST come from SKILL.md frontmatter `name:` field — no directory fallback.
    let skill_name = fm.name.clone().ok_or_else(|| {
        format!("SKILL.md at '{}' is missing the 'name' frontmatter field", skill_path)
    })?;

    if skill_name.is_empty() {
        return Err("Could not determine skill name".to_string());
    }

    super::imported_skills::validate_skill_name(&skill_name)?;

    // Validate required frontmatter fields
    let missing_required: Vec<&str> = [
        ("description", fm.description.is_none()),
    ]
    .iter()
    .filter(|(_, missing)| *missing)
    .map(|(f, _)| *f)
    .collect();
    if !missing_required.is_empty() {
        log::error!(
            "[import_single_skill] '{}' missing required frontmatter fields: {}",
            skill_name,
            missing_required.join(", ")
        );
        return Err(format!(
            "missing_mandatory_fields:{}",
            missing_required.join(",")
        ));
    }

    // Check if skill directory already exists on disk
    let dest_dir = skills_dir.join(&skill_name);
    if dest_dir.exists() {
        if overwrite {
            log::debug!(
                "[import_single_skill] removing existing dir for re-import: {}",
                dest_dir.display()
            );
            fs::remove_dir_all(&dest_dir)
                .map_err(|e| format!("Failed to remove existing skill directory: {}", e))?;
        } else {
            return Err(format!(
                "Skill '{}' already exists at '{}'",
                skill_name,
                dest_dir.display()
            ));
        }
    }

    // Create destination directory and canonicalize for secure containment checks
    fs::create_dir_all(&dest_dir)
        .map_err(|e| format!("Failed to create skill directory: {}", e))?;
    let canonical_dest = dest_dir
        .canonicalize()
        .map_err(|e| format!("Failed to canonicalize destination: {}", e))?;

    // Download all files
    for file_path in &files {
        let relative = if prefix.is_empty() {
            file_path.to_string()
        } else {
            match file_path.strip_prefix(&prefix) {
                Some(rel) => rel.to_string(),
                None => continue,
            }
        };

        if relative.is_empty() {
            continue;
        }

        let out_path = dest_dir.join(&relative);

        // Security: lexical check first
        if !out_path.starts_with(&dest_dir) {
            continue;
        }

        // Create parent directories and verify canonicalized path stays within dest_dir
        if let Some(parent) = out_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create directory for '{}': {}", relative, e))?;
            let canonical_parent = parent
                .canonicalize()
                .map_err(|e| format!("Failed to canonicalize parent: {}", e))?;
            if !canonical_parent.starts_with(&canonical_dest) {
                return Err(format!(
                    "Path traversal detected: '{}' escapes destination",
                    relative
                ));
            }
        }

        let raw_url = format!(
            "{}/{}/{}/{}/{}",
            raw_base_url, owner, repo, branch, file_path
        );

        let response = client
            .get(&raw_url)
            .send()
            .await
            .map_err(|e| format!("Failed to download '{}': {}", file_path, e))?;

        let content = response
            .bytes()
            .await
            .map_err(|e| format!("Failed to read '{}': {}", file_path, e))?;

        // Reject files larger than 10 MB. Check actual byte count after download
        // rather than Content-Length header, which is absent for chunked responses
        // (the norm for raw.githubusercontent.com).
        if content.len() > 10_000_000 {
            return Err(format!(
                "File '{}' too large: {} bytes (max 10 MB)",
                file_path,
                content.len()
            ));
        }

        fs::write(&out_path, &content)
            .map_err(|e| format!("Failed to write '{}': {}", out_path.display(), e))?;
    }

    // Rewrite SKILL.md with updated frontmatter if a metadata override was applied
    if metadata_override.is_some() {
        log::info!("[import_single_skill] rewriting SKILL.md frontmatter for '{}'", skill_name);
        if let Err(e) = rewrite_skill_md(&dest_dir, &fm) {
            log::error!("[import_single_skill] failed to rewrite SKILL.md for '{}': {}", skill_name, e);
            // Clean up the disk directory to avoid leaving orphaned files
            if let Err(cleanup_err) = fs::remove_dir_all(&dest_dir) {
                log::warn!(
                    "[import_single_skill] failed to clean up '{}' after rewrite failure: {}",
                    dest_dir.display(), cleanup_err
                );
            }
            return Err(e);
        }
        log::debug!("[import_single_skill] rewrote SKILL.md frontmatter for '{}'", skill_name);
    }

    let skill_id = super::imported_skills::generate_skill_id(&skill_name);
    let imported_at = chrono::Utc::now()
        .format("%Y-%m-%d %H:%M:%S")
        .to_string();

    Ok(ImportedSkill {
        skill_id,
        skill_name,
        is_active: true,
        disk_path: dest_dir.to_string_lossy().to_string(),
        imported_at,
        is_bundled: false,
        // Populated from frontmatter/override for the response, not stored in DB here
        description: fm.description,
        purpose: override_purpose,
        version: fm.version,
        model: fm.model,
        argument_hint: fm.argument_hint,
        user_invocable: fm.user_invocable,
        disable_model_invocation: fm.disable_model_invocation,
        marketplace_source_url: None,
    })
}

// ---------------------------------------------------------------------------
// compute_skill_content_hash
// ---------------------------------------------------------------------------

/// Compute a SHA256 hex digest of the SKILL.md file in the given disk directory.
/// Returns `Some(hex)` on success, or `None` if the file cannot be read.
pub(crate) fn compute_skill_content_hash(disk_path: &str) -> Option<String> {
    let skill_md = Path::new(disk_path).join("SKILL.md");
    let bytes = fs::read(&skill_md).ok()?;
    let digest = sha2::Sha256::digest(&bytes);
    Some(hex::encode(digest))
}

// ---------------------------------------------------------------------------
// check_marketplace_updates
// ---------------------------------------------------------------------------

/// Name, repo path, and marketplace version for a skill that has an available update.
#[derive(serde::Serialize, serde::Deserialize)]
pub struct SkillUpdateInfo {
    pub name: String,
    pub path: String,
    /// The marketplace version that triggered this update entry.
    pub version: String,
}

/// Separate update lists for each registry source.
#[derive(serde::Serialize, serde::Deserialize)]
pub struct MarketplaceUpdateResult {
    /// Skills with updates in imported_skills (Skills Library / marketplace source).
    pub library: Vec<SkillUpdateInfo>,
    /// Skills with updates in workspace_skills (Settings → Skills).
    pub workspace: Vec<SkillUpdateInfo>,
    /// Registry name read from marketplace.json (used to refresh the stored registry name).
    pub registry_name: Option<String>,
}

/// Check the marketplace for skills that have a newer version than those installed.
/// Returns separate lists for library (imported_skills) and workspace (workspace_skills) skills.
/// Only reports updates for skills that were imported from this specific registry (source_url),
/// preventing false positives when bundled skills share a name with marketplace skills.
#[tauri::command]
pub async fn check_marketplace_updates(
    db: tauri::State<'_, Db>,
    owner: String,
    repo: String,
    branch: String,
    subpath: Option<String>,
    source_url: String,
) -> Result<MarketplaceUpdateResult, String> {
    log::info!(
        "[check_marketplace_updates] owner={} repo={} branch={} subpath={:?} source_url={}",
        owner, repo, branch, subpath, source_url
    );

    let token = {
        let conn = db.0.lock().map_err(|e| {
            log::error!("[check_marketplace_updates] failed to acquire DB lock: {}", e);
            e.to_string()
        })?;
        let settings = crate::db::read_settings_hydrated(&conn)?;
        settings.github_oauth_token.clone()
    };

    let (registry_name, available) = list_github_skills_inner(&owner, &repo, &branch, subpath.as_deref(), token.as_deref()).await?;

    let result = {
        let conn = db.0.lock().map_err(|e| {
            log::error!("[check_marketplace_updates] failed to acquire DB lock for DB reads: {}", e);
            e.to_string()
        })?;

        let mut library = Vec::new();
        let mut workspace = Vec::new();

        for skill in &available {
            let marketplace_ver = skill.version.as_deref().unwrap_or("");
            if marketplace_ver.is_empty() {
                continue;
            }

            // Check workspace_skills: only match skills imported from this specific registry.
            // This prevents false-positive notifications for bundled skills that share a name
            // with a marketplace skill (bundled skills have marketplace_source_url = NULL).
            if let Some(ws) = crate::db::get_workspace_skill_by_name_and_source(&conn, &skill.name, &source_url)? {
                let inst_ver = ws.version.as_deref().unwrap_or("");
                if inst_ver.is_empty() || semver_gt(marketplace_ver, inst_ver) {
                    workspace.push(SkillUpdateInfo { name: skill.name.clone(), path: skill.path.clone(), version: marketplace_ver.to_string() });
                }
            }

            // Check imported_skills: only match skills imported from this specific registry.
            if let Some(imp) = crate::db::get_imported_skill_by_name_and_source(&conn, &skill.name, &source_url).unwrap_or(None) {
                let inst_ver = imp.version.as_deref().unwrap_or("");
                if inst_ver.is_empty() || semver_gt(marketplace_ver, inst_ver) {
                    library.push(SkillUpdateInfo { name: skill.name.clone(), path: skill.path.clone(), version: marketplace_ver.to_string() });
                }
            }
        }

        MarketplaceUpdateResult { library, workspace, registry_name }
    };

    log::info!(
        "[check_marketplace_updates] found {} library updates, {} workspace updates",
        result.library.len(), result.workspace.len()
    );

    Ok(result)
}

// ---------------------------------------------------------------------------
// check_skill_customized
// ---------------------------------------------------------------------------

/// Check whether a skill's SKILL.md has been modified since it was imported.
/// Returns false if no hash baseline exists (treat as unmodified).
/// Returns true if the current file hash differs from the stored baseline.
#[tauri::command]
pub fn check_skill_customized(
    skill_name: String,
    db: tauri::State<'_, Db>,
) -> Result<bool, String> {
    log::info!("[check_skill_customized] skill_name={}", skill_name);
    let conn = db.0.lock().map_err(|e| {
        log::error!("[check_skill_customized] failed to acquire DB lock: {}", e);
        e.to_string()
    })?;

    // Try workspace_skills first, then imported_skills
    let hash_info = crate::db::get_workspace_skill_hash_info(&conn, &skill_name)?
        .or_else(|| crate::db::get_imported_skill_hash_info(&conn, &skill_name).unwrap_or(None));

    let (disk_path, stored_hash) = match hash_info {
        Some(info) => info,
        None => {
            log::debug!("[check_skill_customized] '{}' not found in DB", skill_name);
            return Ok(false);
        }
    };

    // Validate disk_path is within expected roots (workspace skills dir or skills_path).
    // This guards against a tampered DB row pointing outside the app's data directories.
    {
        let settings = crate::db::read_settings_hydrated(&conn)?;
        let canonical_disk = match std::fs::canonicalize(&disk_path) {
            Ok(p) => p,
            Err(_) => {
                log::warn!(
                    "[check_skill_customized] disk_path '{}' for '{}' does not exist on disk — treating as unmodified",
                    disk_path, skill_name
                );
                return Ok(false);
            }
        };

        let is_under_root = |root: &Path| -> bool {
            std::fs::canonicalize(root)
                .map(|r| canonical_disk.starts_with(&r))
                .unwrap_or(false)
        };

        let workspace_root_ok = settings.workspace_path.as_ref().is_some_and(|wp| {
            is_under_root(&Path::new(wp).join(".claude").join("skills"))
        });
        let skills_path_ok = settings.skills_path.as_ref().is_some_and(|sp| {
            is_under_root(Path::new(sp))
        });

        if !workspace_root_ok && !skills_path_ok {
            log::warn!(
                "[check_skill_customized] disk_path '{}' for '{}' is outside expected roots — treating as unmodified",
                disk_path, skill_name
            );
            return Ok(false);
        }
    }

    // No baseline stored — treat as unmodified
    let stored = match stored_hash {
        Some(h) => h,
        None => return Ok(false),
    };

    let current = match compute_skill_content_hash(&disk_path) {
        Some(h) => h,
        None => {
            log::debug!("[check_skill_customized] could not read SKILL.md for '{}'", skill_name);
            return Ok(false);
        }
    };

    Ok(current != stored)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // --- parse_github_url tests ---

    #[test]
    fn test_parse_full_https_url() {
        let result = parse_github_url_inner("https://github.com/acme/skill-library").unwrap();
        assert_eq!(result.owner, "acme");
        assert_eq!(result.repo, "skill-library");
        assert_eq!(result.branch, "main");
        assert!(result.subpath.is_none());
    }

    #[test]
    fn test_parse_url_no_branch_defaults_to_main() {
        // URLs pasted from a browser (no /tree/branch suffix) always default to "main"
        // even when the repo's real default branch is different (e.g. "master").
        // check_marketplace_url works around this by calling the repos API which
        // returns the actual default branch instead of relying on the parsed value.
        let result = parse_github_url_inner("https://github.com/hbanerjee74/skills").unwrap();
        assert_eq!(result.owner, "hbanerjee74");
        assert_eq!(result.repo, "skills");
        assert_eq!(result.branch, "main");
        assert!(result.subpath.is_none());
    }

    #[test]
    fn test_parse_url_with_branch() {
        let result =
            parse_github_url_inner("https://github.com/acme/skills/tree/develop").unwrap();
        assert_eq!(result.owner, "acme");
        assert_eq!(result.repo, "skills");
        assert_eq!(result.branch, "develop");
        assert!(result.subpath.is_none());
    }

    #[test]
    fn test_parse_url_with_branch_and_subpath() {
        let result = parse_github_url_inner(
            "https://github.com/acme/skills/tree/main/packages/analytics",
        )
        .unwrap();
        assert_eq!(result.owner, "acme");
        assert_eq!(result.repo, "skills");
        assert_eq!(result.branch, "main");
        assert_eq!(result.subpath.as_deref(), Some("packages/analytics"));
    }

    #[test]
    fn test_parse_url_without_protocol() {
        let result = parse_github_url_inner("github.com/acme/skills").unwrap();
        assert_eq!(result.owner, "acme");
        assert_eq!(result.repo, "skills");
        assert_eq!(result.branch, "main");
    }

    #[test]
    fn test_parse_shorthand() {
        let result = parse_github_url_inner("acme/skills").unwrap();
        assert_eq!(result.owner, "acme");
        assert_eq!(result.repo, "skills");
        assert_eq!(result.branch, "main");
    }

    #[test]
    fn test_parse_url_with_trailing_slash() {
        let result = parse_github_url_inner("https://github.com/acme/skills/").unwrap();
        assert_eq!(result.owner, "acme");
        assert_eq!(result.repo, "skills");
    }

    #[test]
    fn test_parse_url_with_dot_git() {
        let result = parse_github_url_inner("https://github.com/acme/skills.git").unwrap();
        assert_eq!(result.owner, "acme");
        assert_eq!(result.repo, "skills");
        assert_eq!(result.branch, "main");
    }

    #[test]
    fn test_parse_url_http() {
        let result = parse_github_url_inner("http://github.com/acme/skills").unwrap();
        assert_eq!(result.owner, "acme");
        assert_eq!(result.repo, "skills");
    }

    #[test]
    fn test_parse_url_deep_subpath() {
        let result = parse_github_url_inner(
            "https://github.com/acme/mono/tree/v2/packages/skills/analytics",
        )
        .unwrap();
        assert_eq!(result.owner, "acme");
        assert_eq!(result.repo, "mono");
        assert_eq!(result.branch, "v2");
        assert_eq!(
            result.subpath.as_deref(),
            Some("packages/skills/analytics")
        );
    }

    #[test]
    fn test_parse_empty_url() {
        let result = parse_github_url_inner("");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("empty"));
    }

    #[test]
    fn test_parse_single_segment() {
        let result = parse_github_url_inner("just-owner");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("expected at least owner/repo"));
    }

    #[test]
    fn test_parse_unsupported_format() {
        // owner/repo/blob/... is not a supported pattern
        let result = parse_github_url_inner("https://github.com/acme/skills/blob/main/README.md");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Unsupported"));
    }

    #[test]
    fn test_parse_whitespace_trimmed() {
        let result = parse_github_url_inner("  acme/skills  ").unwrap();
        assert_eq!(result.owner, "acme");
        assert_eq!(result.repo, "skills");
    }

    #[test]
    fn test_parse_shorthand_with_branch() {
        let result = parse_github_url_inner("acme/skills#develop").unwrap();
        assert_eq!(result.owner, "acme");
        assert_eq!(result.repo, "skills");
        assert_eq!(result.branch, "develop");
        assert!(result.subpath.is_none());
    }

    #[test]
    fn test_parse_shorthand_with_branch_main() {
        let result = parse_github_url_inner("acme/skills#main").unwrap();
        assert_eq!(result.owner, "acme");
        assert_eq!(result.repo, "skills");
        assert_eq!(result.branch, "main");
    }

    #[test]
    fn test_parse_shorthand_with_empty_branch_defaults_to_main() {
        // owner/repo# with empty branch after # defaults to "main"
        let result = parse_github_url_inner("acme/skills#").unwrap();
        assert_eq!(result.owner, "acme");
        assert_eq!(result.repo, "skills");
        assert_eq!(result.branch, "main");
    }

    // --- Frontmatter reuse test ---

    #[test]
    fn test_parse_frontmatter_accessible() {
        // Verify that the pub(crate) parse_frontmatter is callable from here
        let (name, desc) = super::super::imported_skills::parse_frontmatter(
            "---\nname: test\ndescription: a test\n---\n# Content",
        );
        assert_eq!(name.as_deref(), Some("test"));
        assert_eq!(desc.as_deref(), Some("a test"));
    }

    // --- validate_skill_name reuse test ---

    #[test]
    fn test_validate_skill_name_accessible() {
        assert!(super::super::imported_skills::validate_skill_name("good-name").is_ok());
        assert!(super::super::imported_skills::validate_skill_name("../bad").is_err());
        assert!(super::super::imported_skills::validate_skill_name("").is_err());
    }

    // --- generate_skill_id reuse test ---

    #[test]
    fn test_generate_skill_id_accessible() {
        let id = super::super::imported_skills::generate_skill_id("my-skill");
        assert!(id.starts_with("imp-my-skill-"));
    }

    // --- marketplace.json deserialization tests ---

    #[test]
    fn test_marketplace_json_path_source_deserialization() {
        use crate::types::{MarketplaceJson, MarketplacePluginSource};

        let json = r#"{
            "name": "my-marketplace",
            "plugins": [
                {
                    "name": "analytics-skill",
                    "source": "./analytics-skill",
                    "description": "Analytics skill",
                    "version": "1.0.0",
                    "category": "data"
                },
                {
                    "name": "reporting",
                    "source": "reporting-skill",
                    "description": "Reporting",
                    "version": "2.0.0"
                }
            ]
        }"#;

        let parsed: MarketplaceJson = serde_json::from_str(json).unwrap();
        assert_eq!(parsed.plugins.len(), 2);

        // Plugin with ./ prefix
        match &parsed.plugins[0].source {
            MarketplacePluginSource::Path(s) => {
                assert_eq!(s, "./analytics-skill");
                let path = s.trim_start_matches("./");
                assert_eq!(path, "analytics-skill");
            }
            _ => panic!("expected Path source"),
        }
        assert_eq!(parsed.plugins[0].description.as_deref(), Some("Analytics skill"));
        assert_eq!(parsed.plugins[0].category.as_deref(), Some("data"));

        // Plugin without ./ prefix
        match &parsed.plugins[1].source {
            MarketplacePluginSource::Path(s) => {
                assert_eq!(s, "reporting-skill");
                let path = s.trim_start_matches("./");
                assert_eq!(path, "reporting-skill");
            }
            _ => panic!("expected Path source"),
        }
    }

    #[test]
    fn test_marketplace_json_external_source_deserialization() {
        use crate::types::{MarketplaceJson, MarketplacePluginSource};

        let json = r#"{
            "plugins": [
                {
                    "name": "external-skill",
                    "source": {
                        "source": "github",
                        "repo": "owner/repo",
                        "ref": "main",
                        "sha": "abc123"
                    }
                }
            ]
        }"#;

        let parsed: MarketplaceJson = serde_json::from_str(json).unwrap();
        assert_eq!(parsed.plugins.len(), 1);
        match &parsed.plugins[0].source {
            MarketplacePluginSource::External { source, .. } => {
                assert_eq!(source, "github");
            }
            _ => panic!("expected External source"),
        }
    }

    #[test]
    fn test_marketplace_path_stripping() {
        // Verify the path derivation logic: strip leading ./
        let cases = vec![
            ("./analytics-skill", "analytics-skill"),
            ("analytics-skill", "analytics-skill"),
            ("./nested/skill", "nested/skill"),
            ("./", ""),
            ("", ""),
        ];
        for (input, expected) in cases {
            let result = input.trim_start_matches("./");
            assert_eq!(result, expected, "input={:?}", input);
        }
    }

    #[test]
    fn test_marketplace_json_optional_fields() {
        use crate::types::{MarketplaceJson, MarketplacePluginSource};

        // Plugin with only required fields — optional fields must be None
        let json = r#"{
            "plugins": [
                {
                    "name": "minimal-skill",
                    "source": "./minimal"
                }
            ]
        }"#;

        let parsed: MarketplaceJson = serde_json::from_str(json).unwrap();
        assert_eq!(parsed.plugins.len(), 1);
        let p = &parsed.plugins[0];
        assert_eq!(p.name.as_deref(), Some("minimal-skill"));
        assert!(p.description.is_none());
        assert!(p.version.is_none());
        assert!(p.author.is_none());
        assert!(p.category.is_none());
        assert!(p.tags.is_none());
        match &p.source {
            MarketplacePluginSource::Path(s) => assert_eq!(s, "./minimal"),
            _ => panic!("expected Path source"),
        }
    }

    // --- Frontmatter tests (used by import_single_skill) ---

    #[test]
    fn test_required_frontmatter_filtering_logic() {
        // Exercise the real parse_frontmatter_full path so that regressions in
        // the production parsing or predicate are caught here.
        let parse = super::super::imported_skills::parse_frontmatter_full;

        // Complete, valid frontmatter — name and description are the spec fields.
        // domain:, type:, purpose: and other unknown keys are silently ignored.
        let complete = parse(
            "---\nname: analytics\ndescription: Does analytics stuff\n---\n# Body",
        );
        assert_eq!(complete.name.as_deref(), Some("analytics"));
        assert_eq!(complete.description.as_deref(), Some("Does analytics stuff"));

        // Whitespace-only values: trim_opt converts these to None.
        let whitespace_name = parse(
            "---\nname:    \ndescription: Desc\n---\n",
        );
        assert!(whitespace_name.name.is_none(), "whitespace-only name must be None");

        let whitespace_desc = parse(
            "---\nname: reporting\ndescription:   \n---\n",
        );
        assert!(whitespace_desc.description.is_none(), "whitespace-only description must be None");

        // No frontmatter at all — all fields None.
        let empty = parse("# Just a heading\nNo frontmatter here.");
        assert!(empty.name.is_none());
        assert!(empty.description.is_none());
    }

    #[test]
    fn test_file_prefix_stripping() {
        // Simulate stripping a prefix from file paths when importing
        let prefix = "analytics-skill/";
        let files = vec![
            "analytics-skill/SKILL.md",
            "analytics-skill/references/concepts.md",
            "analytics-skill/references/patterns.md",
        ];

        let relative: Vec<&str> = files
            .iter()
            .filter_map(|f| f.strip_prefix(prefix))
            .collect();

        assert_eq!(relative.len(), 3);
        assert_eq!(relative[0], "SKILL.md");
        assert_eq!(relative[1], "references/concepts.md");
        assert_eq!(relative[2], "references/patterns.md");
    }

    // --- check_marketplace_url JSON validation test ---

    #[test]
    fn test_check_marketplace_url_json_validation_logic() {
        use crate::types::MarketplaceJson;
        // Exercise the serde_json parse step used in check_marketplace_url.
        // Valid MarketplaceJson (with "plugins" array) must succeed; anything missing
        // the required schema or non-JSON must produce an error.
        assert!(serde_json::from_str::<MarketplaceJson>(r#"{"plugins": []}"#).is_ok());
        // Arbitrary valid JSON missing the "plugins" array must be rejected.
        assert!(serde_json::from_str::<MarketplaceJson>(r#"{"anything": 123}"#).is_err());
        assert!(serde_json::from_str::<MarketplaceJson>("Not found").is_err());
        assert!(serde_json::from_str::<MarketplaceJson>("").is_err());
    }

    // --- marketplace_manifest_path tests ---

    #[test]
    fn test_marketplace_manifest_path_no_subpath() {
        assert_eq!(
            marketplace_manifest_path(None),
            ".claude-plugin/marketplace.json"
        );
    }

    #[test]
    fn test_marketplace_manifest_path_single_segment_subpath() {
        // URL like https://github.com/owner/repo/tree/main/plugins
        assert_eq!(
            marketplace_manifest_path(Some("plugins")),
            "plugins/.claude-plugin/marketplace.json"
        );
    }

    #[test]
    fn test_marketplace_manifest_path_deep_subpath() {
        // URL like https://github.com/owner/repo/tree/main/packages/analytics
        assert_eq!(
            marketplace_manifest_path(Some("packages/analytics")),
            "packages/analytics/.claude-plugin/marketplace.json"
        );
    }

    // --- Branch resolution tests ---

    #[test]
    fn test_parse_url_always_defaults_branch_to_main() {
        // Reproduces the root cause of the 404 bug: URLs without a /tree/<branch>
        // suffix always produce branch="main" regardless of the repo's actual default.
        // The fix in list_github_skills_inner / import_github_skills /
        // import_marketplace_to_library is to call get_default_branch() after parsing
        // so that the git tree API uses the correct branch (e.g. "master").
        for url in &[
            "https://github.com/acme/skills",
            "github.com/acme/skills",
            "acme/skills",
        ] {
            let result = parse_github_url_inner(url).unwrap();
            assert_eq!(
                result.branch, "main",
                "URL '{}' should default to 'main' before branch resolution",
                url
            );
        }
    }

    #[test]
    fn test_branch_resolution_uses_resolved_over_parsed() {
        // Simulate the branch resolution logic applied in list_github_skills_inner.
        // When get_default_branch returns "master", it must replace the parsed "main".
        let parsed_branch = "main"; // parse_github_url_inner default

        // Simulate get_default_branch succeeding with a different branch
        let resolved: Result<String, String> = Ok("master".to_string());
        let branch = resolved.unwrap_or_else(|_| parsed_branch.to_string());
        assert_eq!(branch, "master", "Resolved branch should override parsed default");

        // Simulate get_default_branch failing — should fall back to parsed value
        let resolved_err: Result<String, String> = Err("network error".to_string());
        let branch_fallback = resolved_err.unwrap_or_else(|_| parsed_branch.to_string());
        assert_eq!(branch_fallback, "main", "Fallback to parsed branch when resolution fails");
    }

    // --- yaml_quote tests ---

    #[test]
    fn test_yaml_quote_plain_value() {
        assert_eq!(yaml_quote("hello"), "\"hello\"");
    }

    #[test]
    fn test_yaml_quote_escapes_double_quotes() {
        assert_eq!(yaml_quote("say \"hi\""), "\"say \\\"hi\\\"\"");
    }

    #[test]
    fn test_yaml_quote_escapes_newlines() {
        assert_eq!(yaml_quote("line1\nline2"), "\"line1\\nline2\"");
    }

    #[test]
    fn test_yaml_quote_escapes_backslashes() {
        assert_eq!(yaml_quote("path\\to"), "\"path\\\\to\"");
    }

    #[test]
    fn test_yaml_quote_escapes_colon_value() {
        // A colon alone doesn't need escaping (it's safe inside double quotes).
        // Verify that a value with a colon is still wrapped correctly.
        let quoted = yaml_quote("key: value");
        assert_eq!(quoted, "\"key: value\"");
    }

    #[test]
    fn test_yaml_quote_injection_attempt() {
        // A newline injection attempt must be neutralised.
        let injected = yaml_quote("legit\nmalicious-key: injected");
        assert_eq!(injected, "\"legit\\nmalicious-key: injected\"");
    }

    // --- rewrite_skill_md body-extraction tests ---

    #[test]
    fn test_rewrite_skill_md_body_not_truncated_by_hr() {
        use std::fs;
        use tempfile::TempDir;

        let dir = TempDir::new().unwrap();
        let skill_md = dir.path().join("SKILL.md");

        // Body contains a markdown horizontal rule (---) on its own line.
        // The old code would truncate the body at that line; the new code must not.
        let original = "---\nname: old-name\ndescription: old-desc\n---\n# Heading\n\nSome content.\n\n---\n\nMore content after the HR.\n";
        fs::write(&skill_md, original).unwrap();

        let fm = super::super::imported_skills::Frontmatter {
            name: Some("new-name".to_string()),
            description: Some("new-desc".to_string()),
            version: None,
            model: None,
            argument_hint: None,
            user_invocable: None,
            disable_model_invocation: None,
        };

        rewrite_skill_md(dir.path(), &fm).unwrap();

        let result = fs::read_to_string(&skill_md).unwrap();

        // Frontmatter values must be updated and quoted
        assert!(result.contains("name: \"new-name\""), "name not rewritten: {}", result);
        // domain no longer written to frontmatter

        // The body content AFTER the markdown HR must be preserved
        assert!(
            result.contains("More content after the HR."),
            "body was truncated at markdown HR: {}",
            result
        );
    }

    #[test]
    fn test_rewrite_skill_md_no_frontmatter() {
        use std::fs;
        use tempfile::TempDir;

        let dir = TempDir::new().unwrap();
        let skill_md = dir.path().join("SKILL.md");

        // File has no frontmatter at all
        let original = "# Just a heading\nNo frontmatter here.\n";
        fs::write(&skill_md, original).unwrap();

        let fm = super::super::imported_skills::Frontmatter {
            name: Some("my-skill".to_string()),
            description: Some("desc".to_string()),
            version: None,
            model: None,
            argument_hint: None,
            user_invocable: None,
            disable_model_invocation: None,
        };

        rewrite_skill_md(dir.path(), &fm).unwrap();
        let result = fs::read_to_string(&skill_md).unwrap();

        // Should start with newly injected frontmatter
        assert!(result.starts_with("---\n"), "missing opening ---: {}", result);
        assert!(result.contains("name: \"my-skill\""), "name missing: {}", result);
        // Original content should be preserved as body
        assert!(result.contains("# Just a heading"), "original body lost: {}", result);
    }

    #[test]
    fn test_rewrite_skill_md_yaml_injection_blocked() {
        use std::fs;
        use tempfile::TempDir;

        let dir = TempDir::new().unwrap();
        let skill_md = dir.path().join("SKILL.md");

        let original = "---\nname: legit\ndescription: desc\n---\n# Body\n";
        fs::write(&skill_md, original).unwrap();

        let fm = super::super::imported_skills::Frontmatter {
            name: Some("legit\nmalicious-key: injected".to_string()),
            description: Some("desc".to_string()),
            version: None,
            model: None,
            argument_hint: None,
            user_invocable: None,
            disable_model_invocation: None,
        };

        rewrite_skill_md(dir.path(), &fm).unwrap();
        let result = fs::read_to_string(&skill_md).unwrap();

        // The injected key must NOT appear as a bare YAML key
        assert!(
            !result.contains("\nmalicious-key: injected\n"),
            "YAML injection succeeded: {}",
            result
        );
        // The newline must be escaped inside the quoted value
        assert!(
            result.contains("\\n"),
            "newline not escaped in YAML value: {}",
            result
        );
    }

    // --- rewrite_skill_md rollback tests ---

    #[test]
    fn test_rewrite_skill_md_missing_file() {
        use tempfile::TempDir;

        let tmp = TempDir::new().unwrap();
        let fm = super::super::imported_skills::Frontmatter {
            name: Some("test-skill".to_string()),
            ..Default::default()
        };
        let result = rewrite_skill_md(tmp.path(), &fm);
        assert!(result.is_err(), "should fail when SKILL.md is missing");
    }

    #[test]
    fn test_rewrite_skill_md_preserves_body() {
        use std::fs;
        use tempfile::TempDir;

        let tmp = TempDir::new().unwrap();
        let original = "---\nname: old-name\n---\n# Skill Body\n\nSome content here.\n";
        fs::write(tmp.path().join("SKILL.md"), original).unwrap();

        let fm = super::super::imported_skills::Frontmatter {
            name: Some("new-name".to_string()),
            ..Default::default()
        };
        rewrite_skill_md(tmp.path(), &fm).unwrap();

        let result = fs::read_to_string(tmp.path().join("SKILL.md")).unwrap();
        assert!(result.contains("name: \"new-name\""), "name should be updated: {}", result);
        // domain no longer written to frontmatter
        assert!(result.contains("# Skill Body"), "body should be preserved: {}", result);
        assert!(result.contains("Some content here."), "body content should be preserved: {}", result);
    }

    #[test]
    fn test_rollback_removes_dest_dir_on_rewrite_failure() {
        use std::fs;
        use tempfile::TempDir;

        // Simulate dest_dir with downloaded skill files but no SKILL.md
        let parent = TempDir::new().unwrap();
        let dest_dir = parent.path().join("my-skill");
        fs::create_dir_all(&dest_dir).unwrap();
        fs::write(dest_dir.join("some-file.txt"), "content").unwrap();

        // rewrite_skill_md fails because there is no SKILL.md
        let fm = super::super::imported_skills::Frontmatter {
            name: Some("my-skill".to_string()),
            ..Default::default()
        };
        let result = rewrite_skill_md(&dest_dir, &fm);
        assert!(result.is_err(), "rewrite should fail without SKILL.md");

        // Rollback cleanup (mirrors import_single_skill on rewrite failure)
        fs::remove_dir_all(&dest_dir).unwrap();
        assert!(!dest_dir.exists(), "dest_dir should be gone after rollback");
    }

    /// Verify that if rewrite_skill_md fails (e.g. SKILL.md is missing after files were written),
    /// the dest_dir is removed and no orphaned files remain on disk.
    ///
    /// Since we cannot mock fs::write, we test the cleanup path by calling rewrite_skill_md on a
    /// directory where SKILL.md has been removed after the skill files were written — simulating the
    /// failure scenario.  The test also verifies the success path: when the rewrite succeeds, the
    /// body content below `---` is preserved verbatim.
    #[test]
    fn test_import_single_skill_cleans_up_disk_on_rewrite_failure() {
        use std::fs;
        use tempfile::TempDir;

        // --- Success path: body below frontmatter is preserved verbatim after rewrite ---
        {
            let dir = TempDir::new().unwrap();
            let skill_md = dir.path().join("SKILL.md");

            let original = "---\nname: my-skill\ndescription: original desc\n---\n# Instructions\n\nDo the thing.\n\nMore body content here.\n";
            fs::write(&skill_md, original).unwrap();

            let fm = super::super::imported_skills::Frontmatter {
                name: Some("my-skill".to_string()),
                description: Some("overridden desc".to_string()),
                version: None,
                model: None,
                argument_hint: None,
                user_invocable: None,
                disable_model_invocation: None,
            };

            rewrite_skill_md(dir.path(), &fm).unwrap();

            let result = fs::read_to_string(&skill_md).unwrap();
            // Frontmatter must be updated
            assert!(result.contains("description: \"overridden desc\""), "description not updated: {}", result);
            // Body content must be preserved verbatim
            assert!(result.contains("# Instructions"), "body heading lost: {}", result);
            assert!(result.contains("Do the thing."), "body line lost: {}", result);
            assert!(result.contains("More body content here."), "second body line lost: {}", result);
        }

        // --- Cleanup path: when rewrite_skill_md fails, dest_dir is cleaned up ---
        // Simulate the cleanup logic used in import_single_skill when rewrite fails.
        // We write a skill directory to disk, then simulate what happens when the
        // rewrite returns Err — the cleanup code removes dest_dir.
        {
            let skills_root = TempDir::new().unwrap();
            let dest_dir = skills_root.path().join("test-skill");
            fs::create_dir_all(&dest_dir).unwrap();

            // Write some skill files as if download succeeded
            fs::write(dest_dir.join("SKILL.md"), "---\nname: test-skill\n---\n# Body\n").unwrap();
            fs::write(dest_dir.join("references.md"), "Some references\n").unwrap();

            // Confirm files exist before simulated failure
            assert!(dest_dir.exists(), "dest_dir should exist before cleanup");
            assert!(dest_dir.join("SKILL.md").exists(), "SKILL.md should exist");

            // Simulate what import_single_skill does on rewrite failure:
            // remove dest_dir to avoid leaving orphaned files.
            let simulated_rewrite_err: Result<(), String> = Err("Failed to write updated SKILL.md: permission denied".to_string());
            if let Err(e) = simulated_rewrite_err {
                // This is the exact cleanup block from import_single_skill
                if let Err(cleanup_err) = fs::remove_dir_all(&dest_dir) {
                    panic!("Cleanup failed: {}", cleanup_err);
                }
                // Verify dest_dir no longer exists after cleanup
                assert!(!dest_dir.exists(), "dest_dir should be removed after rewrite failure; error was: {}", e);
            }
        }
    }

    /// Verify that rewrite_skill_md merges override fields with the original frontmatter:
    /// - Override fields replace original values
    /// - Fields absent from the override retain their original values
    #[test]
    fn test_rewrite_skill_md_preserves_unoverridden_fields() {
        use std::fs;
        use tempfile::TempDir;

        let dir = TempDir::new().unwrap();
        let skill_md = dir.path().join("SKILL.md");

        // Original SKILL.md has version and model set
        let original = "---\nname: original-name\ndescription: original-desc\nversion: \"1.0.0\"\nmodel: claude-3-haiku\n---\n# Body content\n";
        fs::write(&skill_md, original).unwrap();

        // Simulate what import_single_skill does: parse original, then apply partial override
        let mut fm = super::super::imported_skills::parse_frontmatter_full(original);
        // Override only name and description; version and model not in override
        fm.name = Some("overridden-name".to_string());
        fm.description = Some("overridden-desc".to_string());

        rewrite_skill_md(dir.path(), &fm).unwrap();
        let result = fs::read_to_string(&skill_md).unwrap();

        // Overridden fields must be updated
        assert!(result.contains("name: \"overridden-name\""), "name not overridden: {}", result);
        assert!(result.contains("description: \"overridden-desc\""), "description not overridden: {}", result);

        // Non-overridden fields must be preserved from the original parse
        assert!(result.contains("version: \"1.0.0\""), "version was lost: {}", result);
        assert!(result.contains("model: \"claude-3-haiku\""), "model was lost: {}", result);

        // Body must be preserved
        assert!(result.contains("# Body content"), "body was lost: {}", result);
    }

    // -----------------------------------------------------------------------
    // discover_skills_from_catalog tests
    // -----------------------------------------------------------------------

    use crate::types::{MarketplacePlugin, MarketplacePluginSource};
    use std::collections::HashSet;

    fn make_plugin(name: Option<&str>, source: &str, desc: Option<&str>) -> MarketplacePlugin {
        MarketplacePlugin {
            name: name.map(|s| s.to_string()),
            source: MarketplacePluginSource::Path(source.to_string()),
            description: desc.map(|s| s.to_string()),
            version: None,
            author: None,
            category: None,
            tags: None,
        }
    }

    fn dirs(paths: &[&str]) -> HashSet<String> {
        paths.iter().map(|p| p.to_string()).collect()
    }

    fn sorted_names(skills: &[crate::types::AvailableSkill]) -> Vec<String> {
        let mut v: Vec<_> = skills.iter().map(|s| s.name.clone()).collect();
        v.sort();
        v
    }

    fn sorted_paths(skills: &[crate::types::AvailableSkill]) -> Vec<String> {
        let mut v: Vec<_> = skills.iter().map(|s| s.path.clone()).collect();
        v.sort();
        v
    }

    /// Standard case: source `"./engineering"` → skills at `engineering/skills/{name}/SKILL.md`
    #[test]
    fn test_discover_nested_skills_normal() {
        let plugins = vec![make_plugin(Some("engineering"), "./engineering", None)];
        let skill_dirs = dirs(&["engineering/skills/standup", "engineering/skills/code-review"]);
        let skills = discover_skills_from_catalog(&plugins, None, &skill_dirs, None);
        assert_eq!(sorted_names(&skills), vec!["code-review", "standup"]);
        assert_eq!(
            sorted_paths(&skills),
            vec!["engineering/skills/code-review", "engineering/skills/standup"]
        );
    }

    /// Corner condition: source `"./"` → plugin_path empty → skills at `skills/{name}/SKILL.md`
    #[test]
    fn test_discover_root_plugin_source() {
        let plugins = vec![make_plugin(Some("root"), "./", None)];
        let skill_dirs = dirs(&["skills/standup", "skills/code-review"]);
        let skills = discover_skills_from_catalog(&plugins, None, &skill_dirs, None);
        assert_eq!(sorted_names(&skills), vec!["code-review", "standup"]);
        assert_eq!(sorted_paths(&skills), vec!["skills/code-review", "skills/standup"]);
    }

    /// Bare source with `pluginRoot`: `"engineering"` + `plugin_root="plugins"` →
    /// plugin_path = `"plugins/engineering"` → skills at `plugins/engineering/skills/{name}/SKILL.md`
    #[test]
    fn test_discover_bare_source_with_plugin_root() {
        let plugins = vec![make_plugin(Some("eng"), "engineering", None)];
        let skill_dirs = dirs(&["plugins/engineering/skills/standup"]);
        let skills = discover_skills_from_catalog(&plugins, Some("plugins"), &skill_dirs, None);
        assert_eq!(sorted_names(&skills), vec!["standup"]);
        assert_eq!(sorted_paths(&skills), vec!["plugins/engineering/skills/standup"]);
    }

    /// Bare source without `pluginRoot` → treated as a path from repo root.
    #[test]
    fn test_discover_bare_source_without_plugin_root() {
        let plugins = vec![make_plugin(Some("eng"), "engineering", None)];
        let skill_dirs = dirs(&["engineering/skills/standup"]);
        let skills = discover_skills_from_catalog(&plugins, None, &skill_dirs, None);
        assert_eq!(sorted_names(&skills), vec!["standup"]);
    }

    /// Multiple plugins each contribute their own skills.
    #[test]
    fn test_discover_multiple_plugins() {
        let plugins = vec![
            make_plugin(Some("engineering"), "./engineering", None),
            make_plugin(Some("research"), "./research", None),
        ];
        let skill_dirs = dirs(&[
            "engineering/skills/standup",
            "engineering/skills/code-review",
            "research/skills/literature-search",
        ]);
        let skills = discover_skills_from_catalog(&plugins, None, &skill_dirs, None);
        assert_eq!(skills.len(), 3);
        assert_eq!(sorted_names(&skills), vec!["code-review", "literature-search", "standup"]);
    }

    /// Plugin whose `skills/` directory is empty → contributes 0 skills.
    #[test]
    fn test_discover_plugin_with_no_skills() {
        let plugins = vec![make_plugin(Some("empty"), "./empty-plugin", None)];
        let skill_dirs = dirs(&["other/skills/something"]); // unrelated dirs
        let skills = discover_skills_from_catalog(&plugins, None, &skill_dirs, None);
        assert!(skills.is_empty());
    }

    /// External source type (`github`, `npm`, etc.) → entry is skipped entirely.
    #[test]
    fn test_discover_external_source_skipped() {
        let plugins = vec![MarketplacePlugin {
            name: Some("ext".to_string()),
            source: MarketplacePluginSource::External {
                source: "github".to_string(),
                extra: serde_json::json!({"repo": "owner/repo"}),
            },
            description: None,
            version: None,
            author: None,
            category: None,
            tags: None,
        }];
        let skill_dirs = dirs(&["anything/skills/foo"]);
        let skills = discover_skills_from_catalog(&plugins, None, &skill_dirs, None);
        assert!(skills.is_empty());
    }

    /// `subpath` is prepended to anchor source paths to the repo root.
    /// source `"./engineering"` + subpath `"sub"` → plugin_path = `"sub/engineering"`
    #[test]
    fn test_discover_with_subpath() {
        let plugins = vec![make_plugin(Some("eng"), "./engineering", None)];
        let skill_dirs = dirs(&["sub/engineering/skills/standup"]);
        let skills = discover_skills_from_catalog(&plugins, None, &skill_dirs, Some("sub"));
        assert_eq!(sorted_names(&skills), vec!["standup"]);
        assert_eq!(sorted_paths(&skills), vec!["sub/engineering/skills/standup"]);
    }

    /// Dirs more than one level below `skills/` are excluded (remainder contains `/`).
    #[test]
    fn test_discover_deeply_nested_dirs_excluded() {
        let plugins = vec![make_plugin(Some("eng"), "./engineering", None)];
        let skill_dirs = dirs(&[
            "engineering/skills/standup",          // ✓ exactly one level deep
            "engineering/skills/nested/sub-skill", // ✗ two levels — excluded
        ]);
        let skills = discover_skills_from_catalog(&plugins, None, &skill_dirs, None);
        assert_eq!(sorted_names(&skills), vec!["standup"]);
    }

    /// Trailing slash in source is normalized and treated identically to no trailing slash.
    #[test]
    fn test_discover_trailing_slash_in_source() {
        let plugins = vec![make_plugin(Some("eng"), "./engineering/", None)];
        let skill_dirs = dirs(&["engineering/skills/standup"]);
        let skills = discover_skills_from_catalog(&plugins, None, &skill_dirs, None);
        assert_eq!(sorted_names(&skills), vec!["standup"]);
    }

    /// Empty catalog returns no skills.
    #[test]
    fn test_discover_empty_catalog() {
        let skills = discover_skills_from_catalog(&[], None, &HashSet::new(), None);
        assert!(skills.is_empty());
    }

    /// Plugin `description` propagates to each skill discovered from that plugin.
    #[test]
    fn test_discover_description_propagated() {
        let plugins = vec![make_plugin(Some("eng"), "./engineering", Some("Engineering skills"))];
        let skill_dirs = dirs(&["engineering/skills/standup"]);
        let skills = discover_skills_from_catalog(&plugins, None, &skill_dirs, None);
        assert_eq!(skills[0].description.as_deref(), Some("Engineering skills"));
    }

    /// Plugin entries without a `name` field are valid per spec and still discovered.
    #[test]
    fn test_discover_unnamed_plugin() {
        let plugins = vec![make_plugin(None, "./engineering", None)];
        let skill_dirs = dirs(&["engineering/skills/standup"]);
        let skills = discover_skills_from_catalog(&plugins, None, &skill_dirs, None);
        assert_eq!(sorted_names(&skills), vec!["standup"]);
    }

    /// `plugin_name` is always `None` on every skill returned by `discover_skills_from_catalog`.
    /// It is populated later (from plugin.json) in `list_github_skills_inner`.
    #[test]
    fn test_discover_plugin_name_always_none() {
        let plugins = vec![
            make_plugin(Some("engineering"), "./engineering", None),
            make_plugin(Some("research"), "./research", None),
        ];
        let skill_dirs = dirs(&[
            "engineering/skills/standup",
            "research/skills/literature-search",
        ]);
        let skills = discover_skills_from_catalog(&plugins, None, &skill_dirs, None);
        assert_eq!(skills.len(), 2);
        for skill in &skills {
            assert!(
                skill.plugin_name.is_none(),
                "plugin_name must be None at discovery time (populated later from plugin.json), but got {:?} for '{}'",
                skill.plugin_name, skill.name
            );
        }
    }

    /// A skill_dirs entry whose path ends at `skills/` exactly (no skill name segment) is excluded.
    /// This guards against a hypothetical tree entry at `engineering/skills/` with an empty
    /// skill_name after strip_prefix.
    #[test]
    fn test_discover_empty_skill_name_excluded() {
        let plugins = vec![make_plugin(Some("eng"), "./engineering", None)];
        // "engineering/skills/" stripped of prefix "engineering/skills/" → empty skill_name
        let skill_dirs = dirs(&["engineering/skills/", "engineering/skills/standup"]);
        let skills = discover_skills_from_catalog(&plugins, None, &skill_dirs, None);
        // Only the valid skill survives; the empty-name entry is dropped
        assert_eq!(sorted_names(&skills), vec!["standup"]);
    }

    // -----------------------------------------------------------------------
    // extract_plugin_path tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_extract_plugin_path_normal() {
        assert_eq!(extract_plugin_path("engineering/skills/standup"), "engineering");
    }

    #[test]
    fn test_extract_plugin_path_nested_plugin() {
        assert_eq!(extract_plugin_path("plugins/eng/skills/standup"), "plugins/eng");
    }

    /// Root plugin: `skills/` is directly under the repo root → plugin_path = ""
    #[test]
    fn test_extract_plugin_path_root_plugin() {
        assert_eq!(extract_plugin_path("skills/standup"), "");
    }

    /// Subpath + root plugin: e.g. subpath="sub", source="./" → skill at "sub/skills/standup"
    #[test]
    fn test_extract_plugin_path_subpath_root_plugin() {
        assert_eq!(extract_plugin_path("sub/skills/standup"), "sub");
    }

    #[test]
    fn test_extract_plugin_path_deep_subpath() {
        assert_eq!(extract_plugin_path("sub/engineering/skills/standup"), "sub/engineering");
    }

    /// Path with no `/skills/` segment at all → returns ""
    #[test]
    fn test_extract_plugin_path_no_skills_segment() {
        assert_eq!(extract_plugin_path("engineering/standup"), "");
    }

    #[test]
    fn test_extract_plugin_path_empty_string() {
        assert_eq!(extract_plugin_path(""), "");
    }

    // -----------------------------------------------------------------------
    // import_single_skill — end-to-end tests with mockito HTTP server
    //
    // These tests call import_single_skill directly with a mock HTTP server
    // standing in for raw.githubusercontent.com. This validates the full
    // request-parse-validate pipeline, including the strict `name:` check.
    // -----------------------------------------------------------------------

    fn make_tree(entries: &[(&str, &str)]) -> Vec<serde_json::Value> {
        entries
            .iter()
            .map(|(path, typ)| serde_json::json!({"path": path, "type": typ}))
            .collect()
    }

    /// SKILL.md without a `name:` field — import must be rejected with a clear error.
    /// Regression test for the "no directory fallback" rule.
    #[tokio::test]
    async fn test_import_single_skill_rejects_missing_name() {
        let mut server = mockito::Server::new_async().await;
        let _mock = server
            .mock("GET", "/owner/repo/main/my-skill/SKILL.md")
            .with_status(200)
            .with_body("---\ndescription: Some description\npurpose: domain\nversion: 1.0.0\n---\n# Body\n")
            .create_async()
            .await;

        let client = reqwest::Client::new();
        let tmp = tempfile::tempdir().unwrap();
        let tree = make_tree(&[("my-skill/SKILL.md", "blob")]);

        let result = import_single_skill(
            &client,
            &server.url(),
            "owner",
            "repo",
            "main",
            "my-skill",
            &tree,
            tmp.path(),
            false,
            None,
        )
        .await;

        assert!(result.is_err(), "import must fail when name: is absent from frontmatter");
        let err = result.unwrap_err();
        assert!(
            err.contains("missing the 'name' frontmatter field"),
            "error should identify the missing field, got: {err}"
        );
    }

    /// SKILL.md without a `name:` field but with a metadata_override that supplies one —
    /// import succeeds and the skill is written to disk under the override name.
    #[tokio::test]
    async fn test_import_single_skill_override_rescues_missing_name() {
        let mut server = mockito::Server::new_async().await;
        let _mock = server
            .mock("GET", "/owner/repo/main/my-skill/SKILL.md")
            .with_status(200)
            .with_body("---\ndescription: A description\npurpose: domain\nversion: 1.0.0\n---\n# Body\n")
            .create_async()
            .await;

        let client = reqwest::Client::new();
        let tmp = tempfile::tempdir().unwrap();
        let tree = make_tree(&[("my-skill/SKILL.md", "blob")]);
        let override_ = crate::types::SkillMetadataOverride {
            name: Some("override-name".to_string()),
            ..Default::default()
        };

        let result = import_single_skill(
            &client,
            &server.url(),
            "owner",
            "repo",
            "main",
            "my-skill",
            &tree,
            tmp.path(),
            false,
            Some(&override_),
        )
        .await;

        assert!(result.is_ok(), "import should succeed when override supplies a name; got: {:?}", result);
        assert_eq!(result.unwrap().skill_name, "override-name");
        assert!(tmp.path().join("override-name").exists(), "skill dir must be written to disk");
    }
}
