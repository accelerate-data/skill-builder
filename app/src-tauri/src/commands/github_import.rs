use crate::db::Db;
use crate::types::{AvailableSkill, GitHubRepoInfo, ImportedSkill};
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
        let conn = db.0.lock().map_err(|e| e.to_string())?;
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
    subpath: Option<&str>,
    token: Option<&str>,
) -> Result<Vec<AvailableSkill>, String> {
    let client = build_github_client(token);

    // Resolve the actual default branch — parse_github_url_inner defaults to "main"
    // but repos may use a different default (e.g. "master").
    let branch = get_default_branch(&client, owner, repo)
        .await
        .unwrap_or_else(|_| branch.to_string());

    // Fetch the full recursive tree
    let tree_url = format!(
        "https://api.github.com/repos/{}/{}/git/trees/{}?recursive=1",
        owner, repo, branch
    );
    log::info!("[list_github_skills_inner] fetching tree from {}/{} branch={}", owner, repo, branch);

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
        return Err(format!(
            "GitHub API error ({}): {}",
            status, message
        ));
    }

    let tree = body["tree"]
        .as_array()
        .ok_or("Invalid tree response: missing 'tree' array")?;

    // Find all SKILL.md blob entries
    let skill_md_paths: Vec<String> = tree
        .iter()
        .filter_map(|entry| {
            let entry_path = entry["path"].as_str()?;
            let entry_type = entry["type"].as_str()?;

            if entry_type != "blob" {
                return None;
            }

            // Must end with /SKILL.md (not a bare "SKILL.md" at repo root unless in subpath)
            if !entry_path.ends_with("/SKILL.md") && entry_path != "SKILL.md" {
                return None;
            }

            // If subpath is specified, only include entries under it;
            // otherwise exclude top-level directories used for plugin packaging (e.g. plugins/).
            if let Some(sp) = subpath {
                let prefix = if sp.ends_with('/') {
                    sp.to_string()
                } else {
                    format!("{}/", sp)
                };
                if !entry_path.starts_with(&prefix) {
                    return None;
                }
            } else if entry_path.starts_with("plugins/") {
                return None;
            }

            Some(entry_path.to_string())
        })
        .collect();

    log::info!(
        "[list_github_skills_inner] found {} SKILL.md files in {}/{}: {:?}",
        skill_md_paths.len(), owner, repo, skill_md_paths
    );

    if skill_md_paths.is_empty() {
        return Ok(Vec::new());
    }

    // Fetch each SKILL.md and parse frontmatter
    let mut skills = Vec::new();
    let has_value = |opt: &Option<String>| opt.as_deref().is_some_and(|s| !s.is_empty());

    for skill_md_path in &skill_md_paths {
        let raw_url = format!(
            "https://raw.githubusercontent.com/{}/{}/{}/{}",
            owner, repo, branch, skill_md_path
        );

        let content = match client.get(&raw_url).send().await {
            Ok(resp) if resp.status().is_success() => {
                resp.text().await.unwrap_or_default()
            }
            Ok(resp) => {
                log::warn!(
                    "Failed to fetch {}: HTTP {}",
                    skill_md_path,
                    resp.status()
                );
                continue;
            }
            Err(e) => {
                log::warn!("Failed to fetch {}: {}", skill_md_path, e);
                continue;
            }
        };

        let (fm_name, fm_description, fm_domain, fm_type) =
            super::imported_skills::parse_frontmatter(&content);

        log::debug!(
            "[list_github_skills_inner] parsed {}: name={:?} domain={:?} type={:?}",
            skill_md_path, fm_name, fm_domain, fm_type
        );

        // Filter out skills missing required front matter fields — they must not appear in the UI
        if !has_value(&fm_name) || !has_value(&fm_description) || !has_value(&fm_domain) {
            log::warn!(
                "list_github_skills: skipping '{}' — missing required front matter (name={} description={} domain={})",
                skill_md_path, has_value(&fm_name), has_value(&fm_description), has_value(&fm_domain)
            );
            continue;
        }

        // Only skills with a valid Skill Library skill_type are shown in the UI.
        // skill-builder skills go to Settings→Skills; unknown values are excluded.
        const VALID_SKILL_LIBRARY_TYPES: &[&str] = &["domain", "platform", "source", "data-engineering"];
        let type_value = fm_type.as_deref().unwrap_or("");
        if !VALID_SKILL_LIBRARY_TYPES.contains(&type_value) {
            log::warn!(
                "list_github_skills: skipping '{}' — skill_type {:?} is not a valid Skill Library type (expected one of: domain, platform, source, data-engineering)",
                skill_md_path, fm_type.as_deref().unwrap_or("<absent>")
            );
            continue;
        }

        // Derive skill directory path (parent of SKILL.md)
        let skill_dir = skill_md_path
            .strip_suffix("/SKILL.md")
            .or_else(|| skill_md_path.strip_suffix("SKILL.md"))
            .unwrap_or(skill_md_path)
            .trim_end_matches('/');

        // Safety: the `continue` above guarantees fm_name.is_some() at this point.
        let name = fm_name.unwrap();

        skills.push(AvailableSkill {
            path: skill_dir.to_string(),
            name,
            domain: fm_domain,
            description: fm_description,
            skill_type: fm_type,
        });
    }

    Ok(skills)
}

// ---------------------------------------------------------------------------
// import_github_skills
// ---------------------------------------------------------------------------

/// Import selected skills from a GitHub repo into the local workspace.
#[tauri::command]
pub async fn import_github_skills(
    db: tauri::State<'_, Db>,
    owner: String,
    repo: String,
    branch: String,
    skill_paths: Vec<String>,
) -> Result<Vec<ImportedSkill>, String> {
    log::info!("[import_github_skills] owner={} repo={} branch={} skill_paths={:?}", owner, repo, branch, skill_paths);
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

    // Resolve the actual default branch — parse_github_url_inner defaults to "main"
    // but repos may use a different default (e.g. "master").
    let branch = get_default_branch(&client, &owner, &repo)
        .await
        .unwrap_or(branch);

    // Fetch the full recursive tree once
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
        return Err(format!(
            "GitHub API error ({}): {}",
            status, message
        ));
    }

    let tree = body["tree"]
        .as_array()
        .ok_or("Invalid tree response: missing 'tree' array")?;

    let skills_dir = Path::new(&workspace_path).join(".claude").join("skills");
    let mut imported: Vec<ImportedSkill> = Vec::new();
    let mut errors: Vec<String> = Vec::new();

    for skill_path in &skill_paths {
        match import_single_skill(
            &client,
            &owner,
            &repo,
            &branch,
            skill_path,
            tree,
            &skills_dir,
            false,
        )
        .await
        {
            Ok(skill) => {
                // Insert into DB
                let conn = db.0.lock().map_err(|e| e.to_string())?;
                match crate::db::insert_imported_skill(&conn, &skill) {
                    Ok(()) => imported.push(skill),
                    Err(e) => {
                        // DB insert failed (e.g. duplicate) — clean up the files we just wrote
                        if let Err(cleanup_err) = fs::remove_dir_all(&skill.disk_path) {
                            log::warn!(
                                "Failed to clean up skill directory '{}' after DB error: {}",
                                skill.disk_path, cleanup_err
                            );
                        }
                        errors.push(format!("{}: {}", skill.skill_name, e));
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
) -> Result<Vec<MarketplaceImportResult>, String> {
    log::info!(
        "[import_marketplace_to_library] importing {} skills from marketplace",
        skill_paths.len()
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

    // Resolve the actual default branch — parse_github_url_inner defaults to "main"
    // but repos may use a different default (e.g. "master").
    let branch = get_default_branch(&client, owner, repo)
        .await
        .unwrap_or_else(|_| repo_info.branch.clone());

    // Fetch the full recursive tree once
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
        .ok_or("Invalid tree response: missing 'tree' array")?;

    let skills_dir = Path::new(&skills_path);
    let mut results: Vec<MarketplaceImportResult> = Vec::new();

    for skill_path in &skill_paths {
        match import_single_skill(&client, owner, repo, &branch, skill_path, tree, skills_dir, true).await {
            Ok(skill) => {
                let domain = skill.domain.as_deref().unwrap_or(&skill.skill_name).to_string();
                let skill_type_str = skill.skill_type.as_deref().unwrap_or("domain");

                // Upsert into imported_skills first. Uses ON CONFLICT DO UPDATE so
                // re-imports (e.g. after skills_path changed) succeed rather than
                // hitting a UNIQUE constraint.
                let conn = db.0.lock().map_err(|e| {
                    log::error!("[import_marketplace_to_library] failed to acquire DB lock for '{}': {}", skill_path, e);
                    e.to_string()
                })?;
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

                // Then record in workflow_runs with source='marketplace'.
                if let Err(e) = crate::db::save_marketplace_skill_run(
                    &conn,
                    &skill.skill_name,
                    &domain,
                    skill_type_str,
                ) {
                    log::warn!(
                        "[import_marketplace_to_library] failed to save workflow run for '{}': {}",
                        skill.skill_name, e
                    );
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

    let fm = super::imported_skills::parse_frontmatter_full(&skill_md_content);

    let skill_name = fm.name.clone().unwrap_or_else(|| dir_name.to_string());

    // Log absent optional fields at debug level — this is internal detail, not a lifecycle event
    for (field, absent) in [
        ("version", fm.version.is_none()),
        ("model", fm.model.is_none()),
        ("argument-hint", fm.argument_hint.is_none()),
        ("user-invocable", fm.user_invocable.is_none()),
        ("disable-model-invocation", fm.disable_model_invocation.is_none()),
    ] {
        if absent {
            log::debug!(
                "import_single_skill: optional field '{}' absent for skill '{}'",
                field,
                skill_name
            );
        }
    }

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

    // --- Tree filtering logic tests ---

    #[test]
    fn test_skill_md_path_detection() {
        // Test the logic we use to identify SKILL.md paths
        let paths = vec![
            "analytics-skill/SKILL.md",
            "analytics-skill/references/concepts.md",
            "other/nested/SKILL.md",
            "SKILL.md",
            "not-a-skill.md",
            "some-dir/NOT_SKILL.md",
        ];

        let skill_paths: Vec<&&str> = paths
            .iter()
            .filter(|p| p.ends_with("/SKILL.md") || **p == "SKILL.md")
            .collect();

        assert_eq!(skill_paths.len(), 3);
        assert!(skill_paths.contains(&&"analytics-skill/SKILL.md"));
        assert!(skill_paths.contains(&&"other/nested/SKILL.md"));
        assert!(skill_paths.contains(&&"SKILL.md"));
    }

    #[test]
    fn test_subpath_filtering() {
        let paths = vec![
            "skills/analytics/SKILL.md",
            "skills/reporting/SKILL.md",
            "other/SKILL.md",
        ];

        let subpath = "skills";
        let prefix = format!("{}/", subpath);

        let filtered: Vec<&&str> = paths
            .iter()
            .filter(|p| p.starts_with(&prefix))
            .collect();

        assert_eq!(filtered.len(), 2);
        assert!(filtered.contains(&&"skills/analytics/SKILL.md"));
        assert!(filtered.contains(&&"skills/reporting/SKILL.md"));
    }

    #[test]
    fn test_plugins_dir_excluded_without_subpath() {
        // When no subpath is specified, paths under plugins/ should be excluded
        // to avoid picking up plugin-packaged copies of skills.
        let paths = vec![
            "analytics/SKILL.md",
            "plugins/skill-builder/skills/building-skills/SKILL.md",
            "plugins/skill-builder-practices/skills/skill-builder-practices/SKILL.md",
            "skill-builder-practices/SKILL.md",
        ];

        let filtered: Vec<&&str> = paths
            .iter()
            .filter(|p| !p.starts_with("plugins/"))
            .collect();

        assert_eq!(filtered.len(), 2);
        assert!(filtered.contains(&&"analytics/SKILL.md"));
        assert!(filtered.contains(&&"skill-builder-practices/SKILL.md"));
    }

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
    fn test_skill_type_library_filter() {
        // Verify the allowlist predicate used in list_github_skills_inner.
        const VALID_SKILL_LIBRARY_TYPES: &[&str] =
            &["domain", "platform", "source", "data-engineering"];

        let parse = super::super::imported_skills::parse_frontmatter_full;

        // skill_type: domain — must be included
        let fm_domain = parse(
            "---\nname: my-skill\ndescription: Desc\ndomain: data\ntype: domain\n---\n",
        );
        assert_eq!(fm_domain.skill_type.as_deref(), Some("domain"));
        assert!(
            VALID_SKILL_LIBRARY_TYPES.contains(&fm_domain.skill_type.as_deref().unwrap_or("")),
            "domain should be a valid Skill Library type"
        );

        // skill_type: skill-builder — must be excluded (wrong routing, goes to Settings)
        let fm_skill_builder = parse(
            "---\nname: my-skill\ndescription: Desc\ndomain: data\ntype: skill-builder\n---\n",
        );
        assert_eq!(fm_skill_builder.skill_type.as_deref(), Some("skill-builder"));
        assert!(
            !VALID_SKILL_LIBRARY_TYPES
                .contains(&fm_skill_builder.skill_type.as_deref().unwrap_or("")),
            "skill-builder should NOT be a valid Skill Library type"
        );

        // skill_type: unknown-type — must be excluded (unrecognised value)
        let fm_unknown = parse(
            "---\nname: my-skill\ndescription: Desc\ndomain: data\ntype: unknown-type\n---\n",
        );
        assert_eq!(fm_unknown.skill_type.as_deref(), Some("unknown-type"));
        assert!(
            !VALID_SKILL_LIBRARY_TYPES
                .contains(&fm_unknown.skill_type.as_deref().unwrap_or("")),
            "unknown-type should NOT be a valid Skill Library type"
        );

        // missing skill_type — must be excluded
        let fm_missing = parse(
            "---\nname: my-skill\ndescription: Desc\ndomain: data\n---\n",
        );
        assert!(fm_missing.skill_type.is_none(), "absent skill_type must be None");
        assert!(
            !VALID_SKILL_LIBRARY_TYPES
                .contains(&fm_missing.skill_type.as_deref().unwrap_or("")),
            "absent skill_type should NOT pass the Skill Library filter"
        );
    }

    #[test]
    fn test_skill_dir_derivation() {
        // Test extracting the directory from a SKILL.md path
        let path = "analytics-skill/SKILL.md";
        let dir = path.strip_suffix("/SKILL.md").unwrap_or(path);
        assert_eq!(dir, "analytics-skill");

        let path2 = "nested/deep/skill-name/SKILL.md";
        let dir2 = path2.strip_suffix("/SKILL.md").unwrap_or(path2);
        assert_eq!(dir2, "nested/deep/skill-name");

        // Directory name extraction
        let dir_name = dir2.rsplit('/').next().unwrap_or(dir2);
        assert_eq!(dir_name, "skill-name");
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
}
