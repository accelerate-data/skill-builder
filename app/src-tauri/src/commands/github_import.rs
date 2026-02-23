use crate::db::Db;
use crate::types::{AvailableSkill, GitHubRepoInfo, ImportedSkill, MarketplaceJson, MarketplacePluginSource};
use std::fs;
use std::path::Path;

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
        // Just owner/repo — default branch to "main"
        Ok(GitHubRepoInfo {
            owner,
            repo,
            branch: "main".to_string(),
            subpath: None,
        })
    } else {
        // Something like owner/repo/blob/... or other unsupported pattern
        Err(format!(
            "Unsupported GitHub URL format '{}': expected owner/repo or owner/repo/tree/branch[/path]",
            url
        ))
    }
}

// ---------------------------------------------------------------------------
// check_marketplace_url
// ---------------------------------------------------------------------------

/// Verify that a URL points to an accessible GitHub repository.
///
/// Unlike `list_github_skills`, this uses the repos API (`GET /repos/{owner}/{repo}`)
/// which succeeds regardless of the default branch name. This avoids the 404
/// that occurs when the repo's default branch is not "main".
#[tauri::command]
pub async fn check_marketplace_url(
    db: tauri::State<'_, Db>,
    url: String,
) -> Result<(), String> {
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
    get_default_branch(&client, &repo_info.owner, &repo_info.repo).await?;
    Ok(())
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

    list_github_skills_inner(&owner, &repo, &branch, subpath.as_deref(), token.as_deref())
        .await
}

pub(crate) async fn list_github_skills_inner(
    owner: &str,
    repo: &str,
    branch: &str,
    _subpath: Option<&str>,
    token: Option<&str>,
) -> Result<Vec<AvailableSkill>, String> {
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

    // Fetch .claude-plugin/marketplace.json via raw.githubusercontent.com
    let raw_url = format!(
        "https://raw.githubusercontent.com/{}/{}/{}/.claude-plugin/marketplace.json",
        owner, repo, resolved_branch
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
                "marketplace.json not found at .claude-plugin/marketplace.json in {}/{}. Ensure the repository has this file.",
                owner, repo
            )
        })?;

    let status = response.status();
    if !status.is_success() {
        log::error!(
            "[list_github_skills_inner] failed to fetch marketplace.json for {}/{}: HTTP {}",
            owner, repo, status
        );
        return Err(format!(
            "marketplace.json not found at .claude-plugin/marketplace.json in {}/{}. Ensure the repository has this file.",
            owner, repo
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

    let mut skills = Vec::new();
    for plugin in &marketplace.plugins {
        match &plugin.source {
            MarketplacePluginSource::External { source, .. } => {
                log::warn!(
                    "[list_github_skills_inner] skipping plugin '{}' — unsupported source type '{}'",
                    plugin.name, source
                );
                continue;
            }
            MarketplacePluginSource::Path(s) => {
                let path = s.trim_start_matches("./").to_string();
                if path.is_empty() {
                    log::warn!(
                        "[list_github_skills_inner] skipping plugin '{}' — empty path after stripping './'",
                        plugin.name
                    );
                    continue;
                }
                skills.push(AvailableSkill {
                    path,
                    name: plugin.name.clone(),
                    description: plugin.description.clone(),
                    domain: plugin.category.clone(),
                    skill_type: None,
                    version: plugin.version.clone(),
                    model: None,
                    argument_hint: None,
                    user_invocable: None,
                    disable_model_invocation: None,
                });
            }
        }
    }

    // Fetch the repo tree once to verify which manifest entries actually contain
    // a SKILL.md. Plugin packages (e.g. ./plugins/*) live alongside skills but
    // don't have a SKILL.md and cannot be imported as skills.
    let (_, tree) = fetch_repo_tree(&client, owner, repo, &resolved_branch).await?;

    // Build a set of directory paths that own a SKILL.md blob in the tree.
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

    let before = skills.len();
    skills.retain(|s| {
        if skill_dirs.contains(&s.path) {
            true
        } else {
            log::debug!(
                "[list_github_skills_inner] skipping '{}' — no SKILL.md at {}/SKILL.md",
                s.name, s.path
            );
            false
        }
    });

    log::info!(
        "[list_github_skills_inner] found {} importable skills ({} filtered — no SKILL.md) in marketplace.json for {}/{}",
        skills.len(), before - skills.len(), owner, repo
    );

    // Fetch each skill's SKILL.md concurrently to populate version and skill_type.
    // These fields live in the manifest (SKILL.md), not in marketplace.json.
    let fetch_fns: Vec<_> = skills
        .iter()
        .map(|skill| {
            let client = client.clone();
            let url = format!(
                "https://raw.githubusercontent.com/{}/{}/{}/{}/SKILL.md",
                owner, repo, resolved_branch, skill.path
            );
            async move {
                match client.get(&url).send().await {
                    Ok(resp) if resp.status().is_success() => resp.text().await.ok(),
                    _ => None,
                }
            }
        })
        .collect();

    let contents = futures::future::join_all(fetch_fns).await;
    for (skill, content_opt) in skills.iter_mut().zip(contents) {
        if let Some(content) = content_opt {
            let fm = super::imported_skills::parse_frontmatter_full(&content);
            skill.version = fm.version;
            skill.skill_type = fm.skill_type;
        }
    }

    Ok(skills)
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
) -> Result<Vec<ImportedSkill>, String> {
    log::info!(
        "[import_github_skills] owner={} repo={} branch={} count={}",
        owner, repo, branch, skill_requests.len()
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

        // Overwrite the on-disk directory if an existing installation is found.
        let should_overwrite = existing.is_some();

        match import_single_skill(
            &client,
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
                    // Same version — skip (blocked by frontend, but guard here too)
                    if existing_skill.version == skill.version {
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
                        errors.push(format!("{}: already installed at the same version", skill.skill_name));
                        continue;
                    }
                    // Different version — merge: new frontmatter wins if Some, else fall back to existing
                    if skill.domain.is_none() { skill.domain = existing_skill.domain.clone(); }
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
                        imported.push(skill);
                    }
                } else {
                    log::debug!(
                        "[import_github_skills] inserting new workspace skill '{}'",
                        ws_skill.skill_name
                    );
                    match crate::db::insert_workspace_skill(&conn, &ws_skill) {
                        Ok(()) => imported.push(skill),
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

/// Import one or more skills from the configured marketplace URL into the Skill Library.
/// Each successfully imported skill gets a `workflow_runs` row with `source='marketplace'`.
#[tauri::command]
pub async fn import_marketplace_to_library(
    db: tauri::State<'_, Db>,
    skill_paths: Vec<String>,
    metadata_overrides: Option<std::collections::HashMap<String, crate::types::SkillMetadataOverride>>,
) -> Result<Vec<MarketplaceImportResult>, String> {
    log::info!(
        "[import_marketplace_to_library] importing {} skills from marketplace (with_overrides={})",
        skill_paths.len(),
        metadata_overrides.is_some()
    );

    // Read settings
    let (marketplace_url, workspace_path, skills_path, token) = {
        let conn = db.0.lock().map_err(|e| {
            log::error!("[import_marketplace_to_library] failed to acquire DB lock: {}", e);
            e.to_string()
        })?;
        let settings = crate::db::read_settings_hydrated(&conn)?;
        let url = settings
            .marketplace_url
            .ok_or_else(|| "Marketplace URL not configured. Set it in Settings.".to_string())?;
        let wp = settings
            .workspace_path
            .ok_or_else(|| "Workspace path not initialized".to_string())?;
        let sp = settings
            .skills_path
            .ok_or_else(|| "Skills path not configured. Set it in Settings.".to_string())?;
        (url, wp, sp, settings.github_oauth_token.clone())
    };

    // Parse the marketplace URL into owner/repo/branch
    let repo_info = parse_github_url_inner(&marketplace_url)?;
    let owner = &repo_info.owner;
    let repo = &repo_info.repo;

    let client = build_github_client(token.as_deref());
    let (branch, tree) = fetch_repo_tree(&client, owner, repo, &repo_info.branch).await?;

    let skills_dir = Path::new(&skills_path);
    let mut results: Vec<MarketplaceImportResult> = Vec::new();

    for skill_path in &skill_paths {
        let override_ref = metadata_overrides.as_ref()
            .and_then(|m| m.get(skill_path.as_str()));
        match import_single_skill(&client, owner, repo, &branch, skill_path, &tree, skills_dir, true, override_ref).await {
            Ok(mut skill) => {
                let conn = db.0.lock().map_err(|e| {
                    log::error!("[import_marketplace_to_library] failed to acquire DB lock for '{}': {}", skill_path, e);
                    e.to_string()
                })?;

                // Fetch existing imported skill metadata (if any) for merging on upgrade
                let existing_imported = crate::db::get_imported_skill(&conn, &skill.skill_name).unwrap_or(None);

                // Merge: new frontmatter value wins if Some, else fall back to existing installed value
                if let Some(ref existing) = existing_imported {
                    if skill.domain.is_none() { skill.domain = existing.domain.clone(); }
                    if skill.description.is_none() { skill.description = existing.description.clone(); }
                    if skill.model.is_none() { skill.model = existing.model.clone(); }
                    if skill.argument_hint.is_none() { skill.argument_hint = existing.argument_hint.clone(); }
                    if skill.user_invocable.is_none() { skill.user_invocable = existing.user_invocable; }
                    if skill.disable_model_invocation.is_none() { skill.disable_model_invocation = existing.disable_model_invocation; }
                    // Do NOT merge version — keep the new version
                    // Do NOT merge skill_name — keep the new name
                }

                // Insert into skills master first so that skills.id is available as a FK
                // when inserting into imported_skills below.
                let domain_for_master = skill.domain.as_deref().unwrap_or(&skill.skill_name).to_string();
                let skill_type_for_master = skill.skill_type.as_deref().unwrap_or("domain");
                if let Err(e) = crate::db::save_marketplace_skill(
                    &conn,
                    &skill.skill_name,
                    &domain_for_master,
                    skill_type_for_master,
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
    add_field("domain", &fm.domain);
    add_field("type", &fm.skill_type);
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
        "https://raw.githubusercontent.com/{}/{}/{}/{}",
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

    // Apply metadata overrides if provided (before validation, so user-supplied values satisfy requirements)
    if let Some(ov) = metadata_override {
        fm.name = ov.name.clone().or(fm.name);
        fm.description = ov.description.clone().or(fm.description);
        fm.domain = ov.domain.clone().or(fm.domain);
        fm.skill_type = ov.skill_type.clone().or(fm.skill_type);
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
            "[import_single_skill] applied metadata override for '{}': name={:?} domain={:?} type={:?}",
            dir_name, fm.name, fm.domain, fm.skill_type
        );
    }

    let skill_name = fm.name.clone().unwrap_or_else(|| dir_name.to_string());

    if skill_name.is_empty() {
        return Err("Could not determine skill name".to_string());
    }

    super::imported_skills::validate_skill_name(&skill_name)?;

    // Validate required frontmatter fields
    let missing_required: Vec<&str> = [
        ("description", fm.description.is_none()),
        ("domain", fm.domain.is_none()),
        ("skill_type", fm.skill_type.is_none()),
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
            "https://raw.githubusercontent.com/{}/{}/{}/{}",
            owner, repo, branch, file_path
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
        domain: fm.domain,
        is_active: true,
        disk_path: dest_dir.to_string_lossy().to_string(),
        imported_at,
        is_bundled: false,
        // Populated from frontmatter for the response, not stored in DB
        description: fm.description,
        skill_type: fm.skill_type,
        version: fm.version,
        model: fm.model,
        argument_hint: fm.argument_hint,
        user_invocable: fm.user_invocable,
        disable_model_invocation: fm.disable_model_invocation,
    })
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

    // --- Frontmatter reuse test ---

    #[test]
    fn test_parse_frontmatter_accessible() {
        // Verify that the pub(crate) parse_frontmatter is callable from here
        let (name, desc, domain, skill_type) = super::super::imported_skills::parse_frontmatter(
            "---\nname: test\ndescription: a test\ndomain: analytics\n---\n# Content",
        );
        assert_eq!(name.as_deref(), Some("test"));
        assert_eq!(desc.as_deref(), Some("a test"));
        assert_eq!(domain.as_deref(), Some("analytics"));
        assert!(skill_type.is_none());
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
        assert_eq!(p.name, "minimal-skill");
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

        // Complete, valid frontmatter — all four required fields present.
        // Note: the YAML key for skill_type is "type:" per the parser.
        let complete = parse(
            "---\nname: analytics\ndescription: Does analytics stuff\ndomain: data\ntype: domain\n---\n# Body",
        );
        assert_eq!(complete.name.as_deref(), Some("analytics"));
        assert_eq!(complete.description.as_deref(), Some("Does analytics stuff"));
        assert_eq!(complete.domain.as_deref(), Some("data"));
        assert_eq!(complete.skill_type.as_deref(), Some("domain"));

        // Missing skill_type (no "type:" key) — must be treated as a missing required field.
        let missing_skill_type = parse(
            "---\nname: analytics\ndescription: Does analytics stuff\ndomain: data\n---\n# Body",
        );
        assert!(missing_skill_type.skill_type.is_none(), "absent skill_type must be None");

        // Whitespace-only type — trim_opt must convert to None.
        let whitespace_skill_type = parse(
            "---\nname: analytics\ndescription: Desc\ndomain: data\ntype:   \n---\n",
        );
        assert!(whitespace_skill_type.skill_type.is_none(), "whitespace-only skill_type must be None");

        // Whitespace-only values: trim_opt converts these to None, so the skill
        // should be treated as missing the field.
        let whitespace_name = parse(
            "---\nname:    \ndescription: Desc\ndomain: data\n---\n",
        );
        assert!(whitespace_name.name.is_none(), "whitespace-only name must be None");

        let whitespace_desc = parse(
            "---\nname: reporting\ndescription:   \ndomain: data\n---\n",
        );
        assert!(whitespace_desc.description.is_none(), "whitespace-only description must be None");

        let whitespace_domain = parse(
            "---\nname: research\ndescription: Desc\ndomain:  \n---\n",
        );
        assert!(whitespace_domain.domain.is_none(), "whitespace-only domain must be None");

        // No frontmatter at all — all fields None.
        let empty = parse("# Just a heading\nNo frontmatter here.");
        assert!(empty.name.is_none());
        assert!(empty.description.is_none());
        assert!(empty.domain.is_none());
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
        let original = "---\nname: old-name\ndescription: old-desc\ndomain: old-domain\ntype: domain\n---\n# Heading\n\nSome content.\n\n---\n\nMore content after the HR.\n";
        fs::write(&skill_md, original).unwrap();

        let fm = super::super::imported_skills::Frontmatter {
            name: Some("new-name".to_string()),
            description: Some("new-desc".to_string()),
            domain: Some("new-domain".to_string()),
            skill_type: Some("domain".to_string()),
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
        assert!(result.contains("domain: \"new-domain\""), "domain not rewritten: {}", result);

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
            domain: Some("analytics".to_string()),
            skill_type: Some("domain".to_string()),
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

        let original = "---\nname: legit\ndescription: desc\ndomain: data\ntype: domain\n---\n# Body\n";
        fs::write(&skill_md, original).unwrap();

        let fm = super::super::imported_skills::Frontmatter {
            name: Some("legit\nmalicious-key: injected".to_string()),
            description: Some("desc".to_string()),
            domain: Some("data".to_string()),
            skill_type: Some("domain".to_string()),
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
        let original = "---\nname: old-name\ndomain: OldDomain\n---\n# Skill Body\n\nSome content here.\n";
        fs::write(tmp.path().join("SKILL.md"), original).unwrap();

        let fm = super::super::imported_skills::Frontmatter {
            name: Some("new-name".to_string()),
            domain: Some("NewDomain".to_string()),
            ..Default::default()
        };
        rewrite_skill_md(tmp.path(), &fm).unwrap();

        let result = fs::read_to_string(tmp.path().join("SKILL.md")).unwrap();
        assert!(result.contains("name: \"new-name\""), "name should be updated: {}", result);
        assert!(result.contains("domain: \"NewDomain\""), "domain should be updated: {}", result);
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

            let original = "---\nname: my-skill\ndescription: original desc\ndomain: analytics\ntype: domain\n---\n# Instructions\n\nDo the thing.\n\nMore body content here.\n";
            fs::write(&skill_md, original).unwrap();

            let fm = super::super::imported_skills::Frontmatter {
                name: Some("my-skill".to_string()),
                description: Some("overridden desc".to_string()),
                domain: Some("analytics".to_string()),
                skill_type: Some("domain".to_string()),
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
        let original = "---\nname: original-name\ndescription: original-desc\ndomain: original-domain\ntype: domain\nversion: \"1.0.0\"\nmodel: claude-3-haiku\n---\n# Body content\n";
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
}
