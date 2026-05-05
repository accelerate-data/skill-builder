use std::collections::{HashMap, HashSet};
use std::path::Path;

use crate::db::Db;
use crate::skill_paths::DEFAULT_PLUGIN_SLUG;
use crate::types::{AvailablePlugin, AvailableSkill};

use super::catalog::{
    discover_plugins_from_catalog, discover_skills_from_catalog, extract_plugin_path,
};
use super::http::{build_github_client, fetch_repo_tree, get_default_branch};
use super::import::{compute_skill_content_hash, import_single_skill, merge_imported_fields};
use super::url::{marketplace_manifest_path, parse_github_url_inner};

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
        let settings = crate::db::read_settings(&conn)?;
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
        owner,
        repo,
        resolved_branch
    );

    let not_found_msg = format!(
        "marketplace.json not found at {} in {}/{}. Ensure the repository has this file.",
        manifest_path, owner, repo
    );

    let response = client.get(&raw_url).send().await.map_err(|e| {
        log::error!(
            "[check_marketplace_url] failed to fetch marketplace.json for {}/{}: {}",
            owner,
            repo,
            e
        );
        format!("Failed to reach {}/{}: {}", owner, repo, e)
    })?;

    if !response.status().is_success() {
        log::error!(
            "[check_marketplace_url] marketplace.json not found for {}/{}: HTTP {}",
            owner,
            repo,
            response.status()
        );
        return Err(not_found_msg);
    }

    let body = response.text().await.map_err(|e| {
        log::error!(
            "[check_marketplace_url] failed to read marketplace.json body for {}/{}: {}",
            owner,
            repo,
            e
        );
        format!("Failed to read marketplace.json: {}", e)
    })?;

    let manifest = serde_json::from_str::<crate::types::MarketplaceJson>(&body).map_err(|e| {
        log::error!(
            "[check_marketplace_url] marketplace.json is not valid JSON for {}/{}: {}",
            owner,
            repo,
            e
        );
        format!(
            "marketplace.json at {} in {}/{} is not valid JSON.",
            manifest_path, owner, repo
        )
    })?;

    let name = manifest
        .name
        .filter(|n| !n.trim().is_empty())
        .unwrap_or_else(|| format!("{}/{}", owner, repo));

    log::info!(
        "[check_marketplace_url] marketplace.json validated for {}/{} name={}",
        owner,
        repo,
        name
    );
    Ok(name)
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
    log::info!(
        "[list_github_skills] owner={} repo={} branch={} subpath={:?}",
        owner,
        repo,
        branch,
        subpath
    );
    // Read OAuth token if available
    let token = {
        let conn = db.0.lock().map_err(|e| {
            log::error!("[list_github_skills] failed to acquire DB lock: {}", e);
            e.to_string()
        })?;
        let settings = crate::db::read_settings(&conn)?;
        settings.github_oauth_token.clone()
    };

    let (_, skills) =
        list_github_skills_inner(&owner, &repo, &branch, subpath.as_deref(), token.as_deref())
            .await?;
    Ok(skills)
}

#[tauri::command]
pub async fn list_github_plugins(
    db: tauri::State<'_, Db>,
    owner: String,
    repo: String,
    branch: String,
    subpath: Option<String>,
) -> Result<Vec<AvailablePlugin>, String> {
    log::info!(
        "[list_github_plugins] owner={} repo={} branch={} subpath={:?}",
        owner,
        repo,
        branch,
        subpath
    );
    let token = {
        let conn = db.0.lock().map_err(|e| {
            log::error!("[list_github_plugins] failed to acquire DB lock: {}", e);
            e.to_string()
        })?;
        let settings = crate::db::read_settings(&conn)?;
        settings.github_oauth_token.clone()
    };

    let (_, plugins) =
        list_github_plugins_inner(&owner, &repo, &branch, subpath.as_deref(), token.as_deref())
            .await?;
    Ok(plugins)
}

pub(crate) async fn list_github_plugins_inner(
    owner: &str,
    repo: &str,
    branch: &str,
    subpath: Option<&str>,
    token: Option<&str>,
) -> Result<(Option<String>, Vec<AvailablePlugin>), String> {
    let client = build_github_client(token);
    let resolved_branch = if branch.is_empty() {
        get_default_branch(&client, owner, repo)
            .await
            .unwrap_or_else(|_| "main".to_string())
    } else {
        get_default_branch(&client, owner, repo)
            .await
            .unwrap_or_else(|_| branch.to_string())
    };

    let manifest_path = marketplace_manifest_path(subpath);
    let raw_url = format!(
        "https://raw.githubusercontent.com/{}/{}/{}/{}",
        owner, repo, resolved_branch, manifest_path
    );

    let response = client.get(&raw_url).send().await.map_err(|e| {
        log::error!(
            "[list_github_plugins_inner] failed to fetch marketplace.json for {}/{}: {}",
            owner,
            repo,
            e
        );
        format!(
            "marketplace.json not found at {} in {}/{}. Ensure the repository has this file.",
            manifest_path, owner, repo
        )
    })?;

    let status = response.status();
    if !status.is_success() {
        log::error!(
            "[list_github_plugins_inner] failed to fetch marketplace.json for {}/{}: HTTP {}",
            owner,
            repo,
            status
        );
        return Err(format!(
            "marketplace.json not found at {} in {}/{}. Ensure the repository has this file.",
            manifest_path, owner, repo
        ));
    }

    let body = response.text().await.map_err(|e| {
        log::error!(
            "[list_github_plugins_inner] failed to read marketplace.json body for {}/{}: {}",
            owner,
            repo,
            e
        );
        format!("Failed to read marketplace.json: {}", e)
    })?;

    let marketplace: crate::types::MarketplaceJson = serde_json::from_str(&body).map_err(|e| {
        log::error!(
            "[list_github_plugins_inner] failed to parse marketplace.json for {}/{}: {}",
            owner,
            repo,
            e
        );
        format!("Failed to parse marketplace.json: {}", e)
    })?;

    let plugin_root = marketplace
        .metadata
        .as_ref()
        .and_then(|m| m.plugin_root.as_deref());
    let plugins = discover_plugins_from_catalog(&marketplace.plugins, plugin_root, subpath);

    log::info!(
        "[list_github_plugins_inner] returning {} plugins from marketplace {}",
        plugins.len(),
        marketplace.name.as_deref().unwrap_or("unknown")
    );

    Ok((marketplace.name.clone(), plugins))
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
        owner,
        repo,
        resolved_branch
    );

    let response = client.get(&raw_url).send().await.map_err(|e| {
        log::error!(
            "[list_github_skills_inner] failed to fetch marketplace.json for {}/{}: {}",
            owner,
            repo,
            e
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
            owner,
            repo,
            status
        );
        return Err(format!(
            "marketplace.json not found at {} in {}/{}. Ensure the repository has this file.",
            manifest_path, owner, repo
        ));
    }

    let body = response.text().await.map_err(|e| {
        log::error!(
            "[list_github_skills_inner] failed to read marketplace.json body for {}/{}: {}",
            owner,
            repo,
            e
        );
        format!("Failed to read marketplace.json: {}", e)
    })?;

    let marketplace: crate::types::MarketplaceJson = serde_json::from_str(&body).map_err(|e| {
        log::error!(
            "[list_github_skills_inner] failed to parse marketplace.json for {}/{}: {}",
            owner,
            repo,
            e
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

    let plugin_root = marketplace
        .metadata
        .as_ref()
        .and_then(|m| m.plugin_root.as_deref());
    let skills =
        discover_skills_from_catalog(&marketplace.plugins, plugin_root, &skill_dirs, subpath);

    log::info!(
        "[list_github_skills_inner] found {} candidate skills from catalog in {}/{} (registry={})",
        skills.len(),
        owner,
        repo,
        marketplace.name.as_deref().unwrap_or("unknown")
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
                match client
                    .get(&url)
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
                let fm = crate::commands::imported_skills::parse_frontmatter_full(&content);
                match fm.name {
                    Some(name) => {
                        skill.name = name;
                        if let Some(desc) = fm.description {
                            skill.description = Some(desc);
                        }
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

async fn import_marketplace_entries_to_library(
    db: tauri::State<'_, Db>,
    source_url: String,
    skill_paths: Vec<String>,
    metadata_overrides: Option<
        std::collections::HashMap<String, crate::types::SkillMetadataOverride>,
    >,
    _plugin_display_name_override: Option<String>,
) -> Result<Vec<MarketplaceImportResult>, String> {
    log::info!(
        "[import_marketplace_entries_to_library] importing {} skills from {} (with_overrides={})",
        skill_paths.len(),
        source_url,
        metadata_overrides.is_some()
    );

    // Read settings
    let (skills_path, token) = {
        let conn = db.0.lock().map_err(|e| {
            log::error!(
                "[import_marketplace_entries_to_library] failed to acquire DB lock: {}",
                e
            );
            e.to_string()
        })?;
        let settings = crate::db::read_settings(&conn).map_err(|e| {
            log::error!(
                "[import_marketplace_entries_to_library] failed to read settings: {}",
                e
            );
            e
        })?;
        let sp = settings
            .skills_path
            .ok_or_else(|| "Skills path not configured. Set it in Settings.".to_string())?;
        (sp, settings.github_oauth_token.clone())
    };

    let repo_info = parse_github_url_inner(&source_url)?;
    let owner = &repo_info.owner;
    let repo = &repo_info.repo;

    let client = build_github_client(token.as_deref());
    let (branch, tree) = fetch_repo_tree(&client, owner, repo, &repo_info.branch).await?;

    let skills_root = Path::new(&skills_path);
    let mut results: Vec<MarketplaceImportResult> = Vec::new();

    // Individual skill imports always go into the default plugin.
    // Use import_marketplace_plugin_to_library for full plugin imports.
    let plugin_slug = DEFAULT_PLUGIN_SLUG.to_string();
    let plugin_display_name = crate::skill_paths::DEFAULT_PLUGIN_DISPLAY_NAME.to_string();
    {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        crate::db::ensure_default_plugin(&conn)?;
    }

    for skill_path in &skill_paths {
        let override_ref = metadata_overrides
            .as_ref()
            .and_then(|m| m.get(skill_path.as_str()));
        match import_single_skill(
            &client,
            "https://raw.githubusercontent.com",
            owner,
            repo,
            &branch,
            skill_path,
            &tree,
            skills_root,
            &plugin_slug,
            true,
            override_ref,
        )
        .await
        {
            Ok(mut skill) => {
                let final_version = match skill.version.clone() {
                    Some(version) => version,
                    None => {
                        let missing_skill_name = skill.skill_name.clone();
                        results.push(MarketplaceImportResult {
                            skill_name: missing_skill_name.clone(),
                            success: false,
                            error: Some(format!(
                                "Imported skill '{}' is missing a version after normalization",
                                missing_skill_name
                            )),
                        });
                        continue;
                    }
                };

                let skill_dir = crate::skill_paths::resolve_skill_dir(
                    skills_root,
                    &plugin_slug,
                    &skill.skill_name,
                );
                if let Err(e) = (|| -> Result<(), String> {
                    crate::git::ensure_repo(&skill_dir)
                        .map_err(|e| format!("Failed to init git repo: {}", e))?;
                    if crate::git::skill_version_tag_exists(
                        &skill_dir,
                        &plugin_slug,
                        &skill.skill_name,
                        &final_version,
                    )? {
                        return Err(format!(
                            "Tag '{}' already exists",
                            crate::git::skill_version_tag_name(
                                &plugin_slug,
                                &skill.skill_name,
                                &final_version
                            )
                        ));
                    }
                    crate::git::commit_all(
                        &skill_dir,
                        &format!("{}: import from marketplace", skill.skill_name),
                    )?;
                    crate::git::create_skill_version_tag(
                        &skill_dir,
                        &plugin_slug,
                        &skill.skill_name,
                        &final_version,
                    )?;
                    Ok(())
                })() {
                    results.push(MarketplaceImportResult {
                        skill_name: skill.skill_name,
                        success: false,
                        error: Some(e),
                    });
                    continue;
                }

                let conn = db.0.lock().map_err(|e| e.to_string())?;
                skill.marketplace_source_url = Some(source_url.clone());
                // plugin_slug and is_default_plugin are already set by import_single_skill.
                // Set display_name here since it comes from the marketplace DB record.
                skill.plugin_display_name = Some(plugin_display_name.clone());

                let existing_imported =
                    crate::db::get_imported_skill(&conn, &skill.skill_name, &plugin_slug)
                        .unwrap_or(None);
                if let Some(ref existing) = existing_imported {
                    merge_imported_fields(&mut skill, existing);
                }

                // Step 2a: Create/update skill master row (with plugin FK)
                // Step 2b: Create/update imported_skills row (with skill master FK)
                let purpose_for_master = skill.purpose.as_deref().unwrap_or("domain");
                let db_result: Result<(), String> = (|| {
                    let skill_master_id = crate::db::upsert_skill_in_plugin(
                        &conn,
                        &skill.skill_name,
                        "marketplace",
                        purpose_for_master,
                        &plugin_slug,
                    )?;
                    crate::db::upsert_imported_skill(&conn, &skill, skill_master_id)?;
                    Ok(())
                })();
                if let Err(e) = db_result {
                    results.push(MarketplaceImportResult {
                        skill_name: skill.skill_name,
                        success: false,
                        error: Some(e),
                    });
                    continue;
                }

                if let Some(hash) = compute_skill_content_hash(&skill.disk_path) {
                    if let Err(e) =
                        crate::db::set_imported_skill_content_hash(&conn, &skill.skill_name, &hash)
                    {
                        log::warn!("[import_marketplace_entries_to_library] failed to set content_hash for '{}': {}", skill.skill_name, e);
                    }
                }

                results.push(MarketplaceImportResult {
                    skill_name: skill.skill_name,
                    success: true,
                    error: None,
                });
            }
            Err(e) => {
                results.push(MarketplaceImportResult {
                    skill_name: skill_path.clone(),
                    success: false,
                    error: Some(e),
                });
            }
        }
    }

    if results.iter().any(|r| r.success) {
        // Regenerate marketplace manifests after successful imports
        if let Err(e) = crate::marketplace_manifest::regenerate_all_manifests(skills_root) {
            log::warn!(
                "[import_marketplace_entries_to_library] failed to regenerate manifests: {}",
                e
            );
        }

        // No CLAUDE.md update needed — import is for Skill Builder management,
        // not Claude Code runtime discovery.
    }

    Ok(results)
}

// ---------------------------------------------------------------------------
// get_dashboard_skill_names
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_dashboard_skill_names(db: tauri::State<'_, Db>) -> Result<Vec<String>, String> {
    log::info!("[get_dashboard_skill_names]");
    let conn = db.0.lock().map_err(|e| {
        log::error!("[get_dashboard_skill_names] lock failed: {}", e);
        e.to_string()
    })?;
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
    metadata_overrides: Option<
        std::collections::HashMap<String, crate::types::SkillMetadataOverride>,
    >,
) -> Result<Vec<MarketplaceImportResult>, String> {
    import_marketplace_entries_to_library(db, source_url, skill_paths, metadata_overrides, None)
        .await
}

/// Import an entire plugin directory from a marketplace registry.
///
/// This follows the Claude Code plugin standard:
/// 1. Download the whole plugin directory (plugin.json, skills/, agents/, hooks/, etc.)
/// 2. Read plugin.json from disk for metadata
/// 3. Enumerate skills from the downloaded skills/ directory
/// 4. Create DB rows: plugin → skills → imported_skills
#[tauri::command]
pub async fn import_marketplace_plugin_to_library(
    db: tauri::State<'_, Db>,
    source_url: String,
    plugin_path: String,
    plugin_name: String,
) -> Result<Vec<MarketplaceImportResult>, String> {
    use super::import::{
        compute_skill_content_hash, download_plugin_directory, enumerate_plugin_skills,
        read_plugin_json,
    };

    log::info!(
        "[import_marketplace_plugin_to_library] plugin='{}' path='{}' source='{}'",
        plugin_name,
        plugin_path,
        source_url
    );

    let repo_info = parse_github_url_inner(&source_url)?;
    let (skills_path, token) = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let settings = crate::db::read_settings(&conn)?;
        let sp = settings.skills_path.ok_or("Skills path not configured")?;
        (sp, settings.github_oauth_token.clone())
    };

    let client = build_github_client(token.as_deref());
    let (branch, tree) = fetch_repo_tree(
        &client,
        &repo_info.owner,
        &repo_info.repo,
        &repo_info.branch,
    )
    .await?;

    let skills_root = Path::new(&skills_path);
    let plugin_slug = crate::db::slugify_plugin_name(&plugin_name);

    // Reject if a plugin with this slug already exists
    {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        if crate::db::get_plugin_id_by_slug(&conn, &plugin_slug)?.is_some() {
            return Err(format!("A plugin named '{}' already exists", plugin_name));
        }
    }

    // --- Step 1: Download the entire plugin directory to disk ---
    let dest_plugin_dir = skills_root.join(&plugin_slug);
    download_plugin_directory(
        &client,
        "https://raw.githubusercontent.com",
        &repo_info.owner,
        &repo_info.repo,
        &branch,
        &plugin_path,
        &tree,
        &dest_plugin_dir,
    )
    .await?;

    // --- Step 2: Read plugin.json from disk for metadata ---
    let (pj_name, _pj_description, pj_version) = read_plugin_json(&dest_plugin_dir);
    let display_name = if pj_name.is_empty() {
        plugin_name.clone()
    } else {
        pj_name
    };

    // --- Step 3: Create plugin row in DB ---
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    crate::db::ensure_plugin(
        &conn,
        &plugin_slug,
        &display_name,
        "marketplace",
        Some(&source_url),
        pj_version.as_deref(),
        false,
    )?;

    // --- Step 4: Enumerate skills from the downloaded plugin directory ---
    let skills = enumerate_plugin_skills(&dest_plugin_dir);
    if skills.is_empty() {
        return Err(format!(
            "Plugin '{}' contains no importable skills",
            plugin_name
        ));
    }

    let mut results: Vec<MarketplaceImportResult> = Vec::new();
    let imported_at = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();

    for (skill_name, skill_dir) in &skills {
        // Read frontmatter from the downloaded SKILL.md
        let skill_md_path = skill_dir.join("SKILL.md");
        let skill_md_content = match std::fs::read_to_string(&skill_md_path) {
            Ok(c) => c,
            Err(e) => {
                results.push(MarketplaceImportResult {
                    skill_name: skill_name.clone(),
                    success: false,
                    error: Some(format!("Failed to read SKILL.md: {}", e)),
                });
                continue;
            }
        };

        let fm = crate::commands::imported_skills::frontmatter::parse_frontmatter_full(
            &skill_md_content,
        );
        let version = fm.version.as_deref().unwrap_or("0.1.0");
        let purpose = "domain";

        // Step 4a: Create skill master row (with plugin FK)
        let skill_master_id = match crate::db::upsert_skill_in_plugin(
            &conn,
            skill_name,
            "marketplace",
            purpose,
            &plugin_slug,
        ) {
            Ok(id) => id,
            Err(e) => {
                results.push(MarketplaceImportResult {
                    skill_name: skill_name.clone(),
                    success: false,
                    error: Some(format!("Failed to create skill master: {}", e)),
                });
                continue;
            }
        };

        // Update frontmatter metadata on skill master
        let _ = conn.execute(
            "UPDATE skills SET description = ?2, version = ?3, model = ?4, argument_hint = ?5,
                    user_invocable = ?6, disable_model_invocation = ?7, updated_at = datetime('now')
             WHERE id = ?1",
            rusqlite::params![
                skill_master_id,
                fm.description,
                fm.version,
                fm.model,
                fm.argument_hint,
                fm.user_invocable.map(|v| v as i32),
                fm.disable_model_invocation.map(|v| v as i32),
            ],
        );

        // Step 4b: Create imported_skills row (with skill master FK)
        let skill_id = crate::commands::imported_skills::generate_skill_id(skill_name);
        let imported_skill = crate::types::ImportedSkill {
            skill_id,
            skill_name: skill_name.clone(),
            library_key: None,
            is_active: true,
            disk_path: skill_dir.to_string_lossy().to_string(),
            imported_at: imported_at.clone(),
            is_bundled: false,
            description: fm.description.clone(),
            purpose: Some(purpose.to_string()),
            version: Some(version.to_string()),
            model: fm.model.clone(),
            argument_hint: fm.argument_hint.clone(),
            user_invocable: fm.user_invocable,
            disable_model_invocation: fm.disable_model_invocation,
            marketplace_source_url: Some(source_url.clone()),
            plugin_slug: Some(plugin_slug.clone()),
            plugin_display_name: Some(display_name.clone()),
            is_default_plugin: Some(false),
        };

        if let Err(e) = crate::db::upsert_imported_skill(&conn, &imported_skill, skill_master_id) {
            results.push(MarketplaceImportResult {
                skill_name: skill_name.clone(),
                success: false,
                error: Some(e),
            });
            continue;
        }

        // Set content hash for update detection
        if let Some(hash) = compute_skill_content_hash(&skill_dir.to_string_lossy()) {
            let _ = crate::db::set_imported_skill_content_hash(&conn, skill_name, &hash);
        }

        // Git: commit and tag (per-skill repo at skill_dir)
        if let Err(e) = (|| -> Result<(), String> {
            crate::git::ensure_repo(skill_dir)
                .map_err(|e| format!("Failed to init git repo: {}", e))?;
            crate::git::commit_all(
                skill_dir,
                &format!("{}: import from marketplace", skill_name),
            )?;
            if !crate::git::skill_version_tag_exists(
                skill_dir,
                &plugin_slug,
                skill_name,
                version,
            )? {
                crate::git::create_skill_version_tag(
                    skill_dir,
                    &plugin_slug,
                    skill_name,
                    version,
                )?;
            }
            Ok(())
        })() {
            log::warn!(
                "[import_marketplace_plugin_to_library] git operations failed for '{}': {}",
                skill_name,
                e
            );
        }

        results.push(MarketplaceImportResult {
            skill_name: skill_name.clone(),
            success: true,
            error: None,
        });
    }

    // --- Step 5: Regenerate manifests and update CLAUDE.md ---
    if results.iter().any(|r| r.success) {
        if let Err(e) = crate::marketplace_manifest::regenerate_all_manifests(skills_root) {
            log::warn!(
                "[import_marketplace_plugin_to_library] manifest regeneration failed: {}",
                e
            );
        }
    }

    Ok(results)
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

    // Query imported_skills for hash info
    let hash_info = crate::db::get_imported_skill_hash_info(&conn, &skill_name)?;

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
        let settings = crate::db::read_settings(&conn)?;
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

        let workspace_root_ok = settings
            .workspace_path
            .as_ref()
            .is_some_and(|wp| is_under_root(Path::new(wp)));
        let skills_path_ok = settings
            .skills_path
            .as_ref()
            .is_some_and(|sp| is_under_root(Path::new(sp)));

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
            log::debug!(
                "[check_skill_customized] could not read SKILL.md for '{}'",
                skill_name
            );
            return Ok(false);
        }
    };

    Ok(current != stored)
}
