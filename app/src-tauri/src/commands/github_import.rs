use crate::db::Db;
use crate::types::{AvailableSkill, GitHubRepoInfo, ImportedSkill};
use std::fs;
use std::path::Path;

/// Build a `reqwest::Client` with standard GitHub API headers.
/// If an OAuth token is available in settings, it is included as a Bearer token.
fn build_github_client(token: Option<&str>) -> reqwest::Client {
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
        let settings = crate::db::read_settings(&conn)?;
        settings.github_oauth_token.clone()
    };

    list_github_skills_inner(&owner, &repo, &branch, subpath.as_deref(), token.as_deref())
        .await
}

async fn list_github_skills_inner(
    owner: &str,
    repo: &str,
    branch: &str,
    subpath: Option<&str>,
    token: Option<&str>,
) -> Result<Vec<AvailableSkill>, String> {
    let client = build_github_client(token);

    // Fetch the full recursive tree
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

            // If subpath is specified, only include entries under it
            if let Some(sp) = subpath {
                let prefix = if sp.ends_with('/') {
                    sp.to_string()
                } else {
                    format!("{}/", sp)
                };
                if !entry_path.starts_with(&prefix) {
                    return None;
                }
            }

            Some(entry_path.to_string())
        })
        .collect();

    if skill_md_paths.is_empty() {
        return Ok(Vec::new());
    }

    // Fetch each SKILL.md and parse frontmatter
    let mut skills = Vec::new();

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

        let (fm_name, fm_description, fm_domain) =
            super::imported_skills::parse_frontmatter(&content);

        // Derive skill directory path (parent of SKILL.md)
        let skill_dir = skill_md_path
            .strip_suffix("/SKILL.md")
            .or_else(|| skill_md_path.strip_suffix("SKILL.md"))
            .unwrap_or(skill_md_path)
            .trim_end_matches('/');

        // Derive a display name: frontmatter name > directory name > "unknown"
        let dir_name = skill_dir
            .rsplit('/')
            .next()
            .unwrap_or(skill_dir);

        let name = fm_name.unwrap_or_else(|| dir_name.to_string());

        skills.push(AvailableSkill {
            path: skill_dir.to_string(),
            name,
            domain: fm_domain,
            description: fm_description,
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
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let settings = crate::db::read_settings(&conn)?;
        let wp = settings
            .workspace_path
            .ok_or_else(|| "Workspace path not initialized".to_string())?;
        (wp, settings.github_oauth_token.clone())
    };

    let client = build_github_client(token.as_deref());

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

/// Import a single skill directory from the repo tree.
async fn import_single_skill(
    client: &reqwest::Client,
    owner: &str,
    repo: &str,
    branch: &str,
    skill_path: &str,
    tree: &[serde_json::Value],
    skills_dir: &Path,
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

    let (fm_name, fm_description, fm_domain) =
        super::imported_skills::parse_frontmatter(&skill_md_content);

    let skill_name = fm_name.unwrap_or_else(|| dir_name.to_string());

    if skill_name.is_empty() {
        return Err("Could not determine skill name".to_string());
    }

    super::imported_skills::validate_skill_name(&skill_name)?;

    // Check if skill directory already exists on disk
    let dest_dir = skills_dir.join(&skill_name);
    if dest_dir.exists() {
        return Err(format!(
            "Skill '{}' already exists at '{}'",
            skill_name,
            dest_dir.display()
        ));
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

        // Reject files larger than 10 MB
        if let Some(len) = response.content_length() {
            if len > 10_000_000 {
                return Err(format!(
                    "File '{}' too large: {} bytes (max 10 MB)",
                    file_path, len
                ));
            }
        }

        let content = response
            .bytes()
            .await
            .map_err(|e| format!("Failed to read '{}': {}", file_path, e))?;

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
        domain: fm_domain,
        description: fm_description,
        is_active: true,
        disk_path: dest_dir.to_string_lossy().to_string(),
        trigger_text: None,
        imported_at,
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
        let (name, desc, domain) = super::super::imported_skills::parse_frontmatter(
            "---\nname: test\ndescription: a test\ndomain: analytics\n---\n# Content",
        );
        assert_eq!(name.as_deref(), Some("test"));
        assert_eq!(desc.as_deref(), Some("a test"));
        assert_eq!(domain.as_deref(), Some("analytics"));
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
}
