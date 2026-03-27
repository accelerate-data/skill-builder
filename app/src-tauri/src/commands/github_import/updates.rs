use std::collections::{HashMap, HashSet};

use crate::db::Db;
use crate::types::AvailableSkill;

use super::commands::list_github_skills_inner;
use super::url::parse_github_url_inner;

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
        let settings = crate::db::read_settings(&conn)?;
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
