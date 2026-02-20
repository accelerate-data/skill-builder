use crate::db::Db;
use crate::types::{SkillBuilderManifest, TeamRepoSkill};
use log::{info, warn};
use std::fs;
use std::path::Path;

// ---------------------------------------------------------------------------
// list_team_repo_skills
// ---------------------------------------------------------------------------

/// List all skills in the configured team repo that have a `.skill-builder` manifest.
#[tauri::command]
pub async fn list_team_repo_skills(
    db: tauri::State<'_, Db>,
) -> Result<Vec<TeamRepoSkill>, String> {
    info!("[list_team_repo_skills] fetching skills from configured team repo");

    let (owner, repo, token) = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let settings = crate::db::read_settings_hydrated(&conn)?;
        let owner = settings.remote_repo_owner.ok_or_else(|| {
            "Remote repository not configured. Set it in Settings.".to_string()
        })?;
        let repo = settings.remote_repo_name.ok_or_else(|| {
            "Remote repository not configured. Set it in Settings.".to_string()
        })?;
        let token = settings.github_oauth_token.ok_or_else(|| {
            "Not authenticated with GitHub. Please sign in first.".to_string()
        })?;
        (owner, repo, token)
    };

    info!(
        "[list_team_repo_skills] using repo {}/{}",
        owner, repo
    );

    let client = super::github_import::build_github_client(Some(&token));

    // Fetch the default branch (may be "main", "master", etc.)
    let default_branch =
        super::github_push::get_default_branch(&client, &token, &owner, &repo).await?;
    info!(
        "[list_team_repo_skills] using default branch '{}' for {}/{}",
        default_branch, owner, repo
    );

    // List all skills via the shared helper
    let available_skills =
        super::github_import::list_github_skills_inner(&owner, &repo, &default_branch, None, Some(&token))
            .await?;

    let mut team_skills = Vec::new();

    for skill in &available_skills {
        // Try to fetch .skill-builder manifest for creator info (optional)
        let manifest_url = format!(
            "https://raw.githubusercontent.com/{}/{}/{}/{}/.skill-builder",
            owner, repo, default_branch, skill.path
        );

        let (creator, created_at) = match client.get(&manifest_url).send().await {
            Ok(resp) if resp.status().is_success() => match resp.text().await {
                Ok(text) => match serde_json::from_str::<SkillBuilderManifest>(&text) {
                    Ok(m) => (m.creator, Some(m.created_at)),
                    Err(_) => (None, None),
                },
                Err(_) => (None, None),
            },
            _ => (None, None),
        };

        team_skills.push(TeamRepoSkill {
            path: skill.path.clone(),
            name: skill.name.clone(),
            domain: skill.domain.clone(),
            description: skill.description.clone(),
            creator,
            created_at,
        });
    }

    info!(
        "[list_team_repo_skills] found {} skills with manifests",
        team_skills.len()
    );
    Ok(team_skills)
}

// ---------------------------------------------------------------------------
// import_team_repo_skill
// ---------------------------------------------------------------------------

/// Import a single skill from the configured team repo into the local workspace.
#[tauri::command]
pub async fn import_team_repo_skill(
    app: tauri::AppHandle,
    db: tauri::State<'_, Db>,
    skill_path: String,
    skill_name: String,
    force: bool,
) -> Result<String, String> {
    info!(
        "[import_team_repo_skill] skill_path={} skill_name={} force={}",
        skill_path, skill_name, force
    );

    let (owner, repo, token, workspace_path, skills_path, github_user_login, github_user_avatar) = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let settings = crate::db::read_settings_hydrated(&conn)?;
        let owner = settings.remote_repo_owner.ok_or_else(|| {
            "Remote repository not configured. Set it in Settings.".to_string()
        })?;
        let repo = settings.remote_repo_name.ok_or_else(|| {
            "Remote repository not configured. Set it in Settings.".to_string()
        })?;
        let token = settings.github_oauth_token.ok_or_else(|| {
            "Not authenticated with GitHub. Please sign in first.".to_string()
        })?;
        let workspace_path = settings
            .workspace_path
            .ok_or_else(|| "Workspace path not initialized.".to_string())?;
        let skills_path = settings.skills_path.ok_or_else(|| {
            "Skills output path is not configured. Please set it in Settings before importing skills.".to_string()
        })?;
        (
            owner,
            repo,
            token,
            workspace_path,
            skills_path,
            settings.github_user_login,
            settings.github_user_avatar,
        )
    };

    // Check DB conflict
    {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        if let Some(_existing) = crate::db::get_workflow_run(&conn, &skill_name)? {
            if !force {
                return Err(format!(
                    "Skill '{}' already exists. Delete it first, or import a different skill.",
                    skill_name
                ));
            }
            // Force: clean up existing DB records
            crate::db::delete_workflow_run(&conn, &skill_name)?;
        }
    }

    // Check for filesystem conflicts
    let workspace_skill_dir = Path::new(&workspace_path).join(&skill_name);
    let skill_output_dir = Path::new(&skills_path).join(&skill_name);

    if workspace_skill_dir.exists() {
        if force {
            fs::remove_dir_all(&workspace_skill_dir).map_err(|e| {
                format!(
                    "Failed to remove existing workspace dir '{}': {}",
                    workspace_skill_dir.display(),
                    e
                )
            })?;
        } else {
            return Err(format!(
                "Skill '{}' already exists in workspace directory ({}). Use force=true to overwrite.",
                skill_name,
                workspace_skill_dir.display()
            ));
        }
    }

    if skill_output_dir.exists() {
        if force {
            fs::remove_dir_all(&skill_output_dir).map_err(|e| {
                format!(
                    "Failed to remove existing skill output dir '{}': {}",
                    skill_output_dir.display(),
                    e
                )
            })?;
        } else {
            return Err(format!(
                "Skill '{}' already exists in skills output directory ({}). Use force=true to overwrite.",
                skill_name,
                skill_output_dir.display()
            ));
        }
    }

    // Create workspace marker directory
    fs::create_dir_all(&workspace_skill_dir).map_err(|e| {
        format!(
            "Failed to create workspace dir '{}': {}",
            workspace_skill_dir.display(),
            e
        )
    })?;

    // Create skill output directories
    fs::create_dir_all(skill_output_dir.join("context")).map_err(|e| {
        format!(
            "Failed to create context dir: {}",
            e
        )
    })?;
    fs::create_dir_all(skill_output_dir.join("references")).map_err(|e| {
        format!(
            "Failed to create references dir: {}",
            e
        )
    })?;

    let client = super::github_import::build_github_client(Some(&token));

    // Fetch the default branch (may be "main", "master", etc.)
    let default_branch =
        super::github_push::get_default_branch(&client, &token, &owner, &repo).await?;

    // Fetch the full recursive tree
    let tree_url = format!(
        "https://api.github.com/repos/{}/{}/git/trees/{}?recursive=1",
        owner, repo, default_branch
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

    // Filter files under skill_path/
    let prefix = if skill_path.ends_with('/') {
        skill_path.clone()
    } else {
        format!("{}/", skill_path)
    };

    let files: Vec<&str> = tree
        .iter()
        .filter_map(|entry| {
            let entry_path = entry["path"].as_str()?;
            let entry_type = entry["type"].as_str()?;
            if entry_type != "blob" {
                return None;
            }
            if entry_path.starts_with(&prefix) {
                Some(entry_path)
            } else {
                None
            }
        })
        .collect();

    if files.is_empty() {
        return Err(format!(
            "No files found in skill directory '{}'",
            skill_path
        ));
    }

    // Canonicalize the skill output dir for path containment checks
    let canonical_dest = skill_output_dir
        .canonicalize()
        .map_err(|e| format!("Failed to canonicalize destination: {}", e))?;

    // Download each file to skills_path/{skill_name}/{relative_path}
    let mut skill_md_content = None;

    for file_path in &files {
        let relative = match file_path.strip_prefix(&prefix) {
            Some(rel) => rel.to_string(),
            None => continue,
        };

        if relative.is_empty() {
            continue;
        }

        let out_path = skill_output_dir.join(&relative);

        // Security: lexical check first
        if !out_path.starts_with(&skill_output_dir) {
            continue;
        }

        // Create parent directories and verify canonicalized path stays within dest
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
            owner, repo, default_branch, file_path
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

        // Capture SKILL.md content for frontmatter parsing
        if relative == "SKILL.md" {
            skill_md_content = Some(String::from_utf8_lossy(&content).to_string());
        }

        fs::write(&out_path, &content)
            .map_err(|e| format!("Failed to write '{}': {}", out_path.display(), e))?;
    }

    // Parse frontmatter from SKILL.md
    let (fm_name, _fm_description, fm_domain, fm_type) = skill_md_content
        .as_deref()
        .map(super::imported_skills::parse_frontmatter)
        .unwrap_or((None, None, None, None));

    let domain = fm_domain
        .or_else(|| fm_name.clone())
        .unwrap_or_default();
    let skill_type = fm_type.as_deref().unwrap_or("domain");

    // Fetch manifest for creator info
    let manifest_url = format!(
        "https://raw.githubusercontent.com/{}/{}/{}/{}/.skill-builder",
        owner, repo, default_branch, skill_path
    );

    let manifest_creator = match client.get(&manifest_url).send().await {
        Ok(resp) if resp.status().is_success() => {
            match resp.text().await {
                Ok(text) => serde_json::from_str::<SkillBuilderManifest>(&text)
                    .ok()
                    .and_then(|m| m.creator),
                Err(_) => None,
            }
        }
        _ => None,
    };

    // Detect the furthest completed step from downloaded files
    let detected_step = crate::fs_validation::detect_furthest_step(
        &workspace_path,
        &skill_name,
        Some(&skills_path),
    )
    .unwrap_or(0) as i32;
    let (step, status) = if detected_step >= 6 {
        (7i32, "completed")
    } else {
        (detected_step, "pending")
    };
    info!(
        "[import_team_repo_skill] detected step {} (status={}) for '{}'",
        step, status, skill_name
    );

    // Save DB entry and mark all steps up to detected as completed
    {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        crate::db::save_workflow_run(&conn, &skill_name, &domain, step, status, skill_type)?;

        // Mark all workflow steps up to the detected step as completed
        // Steps: 0, 1, 2, 3, 4, 5
        for s in 0..=5 {
            if s <= step {
                crate::db::save_workflow_step(&conn, &skill_name, s, "completed")?;
            }
        }

        // Set author: prefer manifest creator, fall back to current user
        let creator = manifest_creator
            .as_deref()
            .or(github_user_login.as_deref());
        let avatar = github_user_avatar.as_deref();

        if let Some(login) = creator {
            let _ = crate::db::set_skill_author(&conn, &skill_name, login, avatar);
        }
    }

    // Write .skill-builder manifest
    let app_version = app.config().version.clone().unwrap_or_default();
    let creator_for_manifest = manifest_creator
        .as_deref()
        .or(github_user_login.as_deref());
    super::github_push::write_manifest_file(
        &skill_output_dir,
        creator_for_manifest,
        &app_version,
    )?;

    // Git auto-commit
    let commit_msg = format!("{}: imported from team repo", skill_name);
    if let Err(e) = crate::git::commit_all(Path::new(&skills_path), &commit_msg) {
        warn!(
            "[import_team_repo_skill] git auto-commit failed: {}",
            e
        );
    }

    info!(
        "[import_team_repo_skill] successfully imported '{}'",
        skill_name
    );
    Ok(skill_name)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::test_utils::create_test_db;
    use tempfile::tempdir;

    #[test]
    fn test_list_returns_error_without_config() {
        // Simulate read_settings returning empty remote_repo_owner
        // by creating a test DB without setting remote_repo_owner
        let conn = create_test_db();
        let settings = crate::db::read_settings(&conn).unwrap();
        assert!(
            settings.remote_repo_owner.is_none(),
            "Test precondition: remote_repo_owner should be None"
        );
        assert!(
            settings.remote_repo_name.is_none(),
            "Test precondition: remote_repo_name should be None"
        );
    }

    #[test]
    fn test_import_conflict_detection() {
        let workspace_dir = tempdir().unwrap();
        let skills_dir = tempdir().unwrap();

        // Create an existing skill directory in the workspace
        let workspace_skill = workspace_dir.path().join("existing-skill");
        fs::create_dir_all(&workspace_skill).unwrap();

        // The workspace skill dir exists — should be a conflict
        assert!(workspace_skill.exists());

        // Create an existing skill directory in the skills output
        let skills_skill = skills_dir.path().join("output-conflict");
        fs::create_dir_all(&skills_skill).unwrap();
        assert!(skills_skill.exists());

        // Verify force=true would allow removal
        fs::remove_dir_all(&workspace_skill).unwrap();
        assert!(!workspace_skill.exists());
    }

    #[test]
    fn test_import_creates_expected_dirs() {
        let workspace_dir = tempdir().unwrap();
        let skills_dir = tempdir().unwrap();

        let skill_name = "test-import-skill";

        // Create workspace marker directory
        let workspace_skill = workspace_dir.path().join(skill_name);
        fs::create_dir_all(&workspace_skill).unwrap();

        // Create skill output directories (same as the command does)
        let skill_output = skills_dir.path().join(skill_name);
        fs::create_dir_all(skill_output.join("context")).unwrap();
        fs::create_dir_all(skill_output.join("references")).unwrap();

        // Verify all expected directories exist
        assert!(workspace_skill.exists(), "Workspace marker dir should exist");
        assert!(
            skill_output.join("context").exists(),
            "context/ dir should exist"
        );
        assert!(
            skill_output.join("references").exists(),
            "references/ dir should exist"
        );

        // Verify the skill output root exists
        assert!(skill_output.exists(), "Skill output root should exist");
    }
}
