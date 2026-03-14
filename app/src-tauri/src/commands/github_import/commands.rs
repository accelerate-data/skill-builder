use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;

use crate::db::Db;
use crate::types::AvailableSkill;

use super::catalog::{discover_skills_from_catalog, extract_plugin_path};
use super::http::{build_github_client, fetch_repo_tree, get_default_branch};
use super::import::{
    compute_skill_content_hash, import_single_skill, merge_imported_fields,
};
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
        let settings = crate::db::read_settings_hydrated(&conn)?;
        settings.github_oauth_token.clone()
    };

    let (_, skills) =
        list_github_skills_inner(&owner, &repo, &branch, subpath.as_deref(), token.as_deref())
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
    log::info!(
        "[import_marketplace_to_library] importing {} skills from {} (with_overrides={})",
        skill_paths.len(),
        source_url,
        metadata_overrides.is_some()
    );

    // Read settings
    let (workspace_path, skills_path, token) = {
        let conn = db.0.lock().map_err(|e| {
            log::error!(
                "[import_marketplace_to_library] failed to acquire DB lock: {}",
                e
            );
            e.to_string()
        })?;
        let settings = crate::db::read_settings_hydrated(&conn).map_err(|e| {
            log::error!(
                "[import_marketplace_to_library] failed to read settings: {}",
                e
            );
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
        log::error!(
            "[import_marketplace_to_library] failed to parse source_url '{}': {}",
            source_url,
            e
        );
        e
    })?;
    let owner = &repo_info.owner;
    let repo = &repo_info.repo;

    let client = build_github_client(token.as_deref());
    let (branch, tree) = fetch_repo_tree(&client, owner, repo, &repo_info.branch)
        .await
        .map_err(|e| {
            log::error!(
                "[import_marketplace_to_library] failed to fetch repo tree for {}/{}: {}",
                owner,
                repo,
                e
            );
            e
        })?;

    let skills_dir = Path::new(&skills_path);
    let mut results: Vec<MarketplaceImportResult> = Vec::new();

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
            skills_dir,
            true,
            override_ref,
        )
        .await
        {
            Ok(mut skill) => {
                let conn = db.0.lock().map_err(|e| {
                    log::error!(
                        "[import_marketplace_to_library] failed to acquire DB lock for '{}': {}",
                        skill_path,
                        e
                    );
                    e.to_string()
                })?;

                // Tag the skill with the registry it was imported from
                skill.marketplace_source_url = Some(source_url.clone());

                // Fetch existing imported skill metadata (if any) for merging on upgrade
                let existing_imported =
                    crate::db::get_imported_skill(&conn, &skill.skill_name).unwrap_or(None);

                // Merge: new frontmatter value wins if Some, else fall back to existing installed value.
                // Version and skill_name are intentionally NOT merged — keep the new values.
                if let Some(ref existing) = existing_imported {
                    merge_imported_fields(&mut skill, existing);
                }

                // Insert into skills master first so that skills.id is available as a FK
                // when inserting into imported_skills below.
                let purpose_for_master = skill.purpose.as_deref().unwrap_or("domain");
                if let Err(e) =
                    crate::db::save_marketplace_skill(&conn, &skill.skill_name, purpose_for_master)
                {
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
                            skill.disk_path,
                            ce
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
                    if let Err(e) =
                        crate::db::set_imported_skill_content_hash(&conn, &skill.skill_name, &hash)
                    {
                        log::warn!("[import_marketplace_to_library] failed to set content_hash for '{}': {}", skill.skill_name, e);
                    }
                }

                log::info!(
                    "[import_marketplace_to_library] imported '{}' to '{}'",
                    skill.skill_name,
                    skill.disk_path
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
                    skill_path,
                    e
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
        if let Err(e) = crate::commands::workflow::update_skills_section(&workspace_path, &conn) {
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
    /// Source registry URL this update came from.
    pub source_url: String,
}

/// Registry name discovered from marketplace.json for a source URL.
#[derive(serde::Serialize, serde::Deserialize)]
pub struct RegistryNameInfo {
    pub source_url: String,
    pub registry_name: String,
}

/// Separate update lists for each registry source.
#[derive(serde::Serialize, serde::Deserialize)]
pub struct MarketplaceUpdateResult {
    /// Skills with updates in imported_skills (Skills Library / marketplace source).
    pub library: Vec<SkillUpdateInfo>,
    /// Skills with updates in workspace (legacy, always empty after consolidation).
    pub workspace: Vec<SkillUpdateInfo>,
    /// Backward-compatible field for older callers; now always None.
    pub registry_name: Option<String>,
    /// Registry names discovered per source URL (used to refresh stored names).
    pub registry_names: Vec<RegistryNameInfo>,
}

#[derive(Debug, Clone)]
pub(super) struct InstalledMarketplaceSkill {
    pub(super) name: String,
    pub(super) version: Option<String>,
    pub(super) source_url: String,
}

fn load_installed_marketplace_skills(
    conn: &rusqlite::Connection,
) -> Result<Vec<InstalledMarketplaceSkill>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT skill_name, version, marketplace_source_url
             FROM imported_skills
             WHERE marketplace_source_url IS NOT NULL",
        )
        .map_err(|e| format!("load_installed_marketplace_skills prepare: {e}"))?;
    let skills = stmt
        .query_map([], |row| {
            Ok(InstalledMarketplaceSkill {
                name: row.get(0)?,
                version: row.get(1)?,
                source_url: row.get(2)?,
            })
        })
        .map_err(|e| format!("load_installed_marketplace_skills query: {e}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("load_installed_marketplace_skills collect: {e}"))?;

    Ok(skills)
}

/// Returns true if `marketplace` is strictly newer than `installed` by semver rules.
/// Returns false if either value fails to parse (avoids false positives for non-standard version strings).
fn semver_gt(marketplace: &str, installed: &str) -> bool {
    match (
        semver::Version::parse(marketplace),
        semver::Version::parse(installed),
    ) {
        (Ok(mp), Ok(inst)) => mp > inst,
        _ => false,
    }
}

pub(super) fn collect_updates_for_installed(
    installed: &[InstalledMarketplaceSkill],
    available_by_name: &HashMap<String, &AvailableSkill>,
    source_url: &str,
) -> Vec<SkillUpdateInfo> {
    let mut updates = Vec::new();
    for row in installed {
        if let Some(skill) = available_by_name.get(&row.name) {
            let marketplace_ver = skill.version.as_deref().unwrap_or("");
            if marketplace_ver.is_empty() {
                continue;
            }
            let inst_ver = row.version.as_deref().unwrap_or("");
            if inst_ver.is_empty() || semver_gt(marketplace_ver, inst_ver) {
                updates.push(SkillUpdateInfo {
                    name: row.name.clone(),
                    path: skill.path.clone(),
                    version: marketplace_ver.to_string(),
                    source_url: source_url.to_string(),
                });
            }
        }
    }
    updates
}

/// Check the marketplace for skills that have a newer version than those installed.
/// This command is DB-driven and handles all enabled registries in one pass.
#[tauri::command]
pub async fn check_marketplace_updates(
    db: tauri::State<'_, Db>,
) -> Result<MarketplaceUpdateResult, String> {
    log::info!("[check_marketplace_updates] checking all enabled registries");

    let (token, enabled_sources, installed_rows) = {
        let conn = db.0.lock().map_err(|e| {
            log::error!(
                "[check_marketplace_updates] failed to acquire DB lock: {}",
                e
            );
            e.to_string()
        })?;
        let settings = crate::db::read_settings_hydrated(&conn)?;
        let enabled_sources: HashSet<String> = settings
            .marketplace_registries
            .into_iter()
            .filter(|r| r.enabled)
            .map(|r| r.source_url)
            .collect();
        let installed_rows = load_installed_marketplace_skills(&conn)?;
        (
            settings.github_oauth_token.clone(),
            enabled_sources,
            installed_rows,
        )
    };

    let mut by_source: HashMap<String, Vec<InstalledMarketplaceSkill>> = HashMap::new();
    for row in installed_rows {
        if enabled_sources.contains(&row.source_url) {
            by_source
                .entry(row.source_url.clone())
                .or_default()
                .push(row);
        }
    }

    let all_sources: HashSet<String> = by_source.keys().cloned().collect();

    let mut library: Vec<SkillUpdateInfo> = Vec::new();
    let mut registry_names = Vec::new();

    for source_url in all_sources {
        let repo_info = match parse_github_url_inner(&source_url) {
            Ok(info) => info,
            Err(err) => {
                log::warn!(
                    "[check_marketplace_updates] skipping source '{}' due to parse error: {}",
                    source_url,
                    err
                );
                continue;
            }
        };
        let list_result = list_github_skills_inner(
            &repo_info.owner,
            &repo_info.repo,
            &repo_info.branch,
            repo_info.subpath.as_deref(),
            token.as_deref(),
        )
        .await;
        let (registry_name, available) = match list_result {
            Ok(v) => v,
            Err(err) => {
                log::warn!(
                    "[check_marketplace_updates] skipping source '{}' due to fetch error: {}",
                    source_url,
                    err
                );
                continue;
            }
        };
        if let Some(name) = registry_name {
            registry_names.push(RegistryNameInfo {
                source_url: source_url.clone(),
                registry_name: name,
            });
        }

        let available_by_name: HashMap<String, &AvailableSkill> =
            available.iter().map(|s| (s.name.clone(), s)).collect();

        if let Some(rows) = by_source.get(&source_url) {
            library.extend(collect_updates_for_installed(
                rows,
                &available_by_name,
                &source_url,
            ));
        }
    }

    let result = MarketplaceUpdateResult {
        library,
        workspace: Vec::new(),
        registry_name: None,
        registry_names,
    };

    log::info!(
        "[check_marketplace_updates] found {} updates",
        result.library.len()
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

        let workspace_root_ok = settings
            .workspace_path
            .as_ref()
            .is_some_and(|wp| is_under_root(&Path::new(wp).join(".claude").join("skills")));
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
