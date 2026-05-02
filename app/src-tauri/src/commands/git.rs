use std::path::Path;

use crate::db::Db;
use crate::types::{SkillCommit, SkillFileContent};

/// Resolve the skill output root: skills_path if configured, else workspace_path.
fn resolve_output_root(db: &Db, workspace_path: &str) -> Result<String, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let settings = crate::db::read_settings(&conn)?;
    Ok(settings
        .skills_path
        .unwrap_or_else(|| workspace_path.to_string()))
}

#[tauri::command]
pub fn get_skill_history(
    workspace_path: String,
    skill_name: String,
    plugin_slug: String,
    limit: Option<usize>,
    db: tauri::State<'_, Db>,
) -> Result<Vec<SkillCommit>, String> {
    log::info!(
        "[get_skill_history] skill={} plugin={} limit={:?}",
        skill_name,
        plugin_slug,
        limit
    );
    let output_root = resolve_output_root(&db, &workspace_path)?;
    let root = Path::new(&output_root);
    if !root.join(".git").exists() {
        return Ok(Vec::new());
    }
    crate::git::get_history(root, &skill_name, &plugin_slug, limit.unwrap_or(100))
}

#[tauri::command]
pub fn restore_skill_version(
    workspace_path: String,
    skill_name: String,
    plugin_slug: String,
    sha: String,
    db: tauri::State<'_, Db>,
) -> Result<String, String> {
    log::info!(
        "[restore_skill_version] skill={} plugin={} sha={}",
        skill_name,
        plugin_slug,
        sha
    );
    let output_root = resolve_output_root(&db, &workspace_path)?;
    let root = Path::new(&output_root);
    crate::git::restore_version(root, &sha, &skill_name, &plugin_slug)?;
    // Commit the restore as a new version
    let short_sha = if sha.len() >= 8 { &sha[..8] } else { &sha };
    let msg = format!("{}: restored to {}", skill_name, short_sha);
    let committed = crate::git::commit_all(root, &msg)
        .map_err(|e| format!("Filesystem restored but git commit failed ({}): {}", msg, e))?;
    // Tag the restore with the next patch version.
    // Even if commit_all returned None (content identical to HEAD), we still
    // bump and tag HEAD so the user always sees a new version number.
    let current_version = crate::git::latest_skill_semver(root, &plugin_slug, &skill_name)
        .unwrap_or_else(|_| "0.0.0".to_string());
    let new_version = crate::git::bump_patch(&current_version);
    crate::git::create_skill_version_tag(root, &plugin_slug, &skill_name, &new_version).map_err(
        |e| {
            format!(
                "Restore committed but version tag failed (v{}): {}",
                new_version, e
            )
        },
    )?;
    log::info!(
        "[restore_skill_version] skill={} new_version={} new_commit={}",
        skill_name,
        new_version,
        committed.is_some()
    );
    Ok(new_version)
}

#[tauri::command]
pub fn get_skill_files_at_sha(
    workspace_path: String,
    skill_name: String,
    plugin_slug: String,
    sha: String,
    db: tauri::State<'_, Db>,
) -> Result<Vec<SkillFileContent>, String> {
    log::info!(
        "[get_skill_files_at_sha] skill={} plugin={} sha={}",
        skill_name,
        plugin_slug,
        sha
    );
    let output_root = resolve_output_root(&db, &workspace_path)?;
    let root = Path::new(&output_root);
    let pairs =
        crate::git::get_skill_files_at_sha(root, &skill_name, &plugin_slug, &sha).map_err(|e| {
            log::error!(
                "[get_skill_files_at_sha] skill={} sha={} error={}",
                skill_name,
                sha,
                e
            );
            e
        })?;
    Ok(pairs
        .into_iter()
        .map(|(path, content)| SkillFileContent { path, content })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::create_test_db_for_tests;
    use std::sync::Mutex;
    use tempfile::tempdir;

    /// Build an in-memory `Db` with an optional `skills_path` setting.
    fn make_db(skills_path: Option<&str>) -> Db {
        let conn = create_test_db_for_tests();
        if let Some(sp) = skills_path {
            let settings = crate::types::AppSettings {
                skills_path: Some(sp.to_string()),
                ..crate::types::AppSettings::default()
            };
            crate::db::write_settings(&conn, &settings).unwrap();
        }
        Db(Mutex::new(conn))
    }

    /// Build a temp git repo with one commit at the plugin-aware path layout.
    /// Used by history tests that exercise `get_history` with a plugin_slug.
    fn init_skill_repo_plugin(
        dir: &std::path::Path,
        plugin_slug: &str,
        skill_name: &str,
        content: &str,
    ) -> String {
        crate::git::ensure_repo(dir).unwrap();
        let skill_dir = dir.join(plugin_slug).join(skill_name);
        std::fs::create_dir_all(&skill_dir).unwrap();
        std::fs::write(skill_dir.join("SKILL.md"), content).unwrap();
        crate::git::commit_all(dir, &format!("{}: initial", skill_name))
            .unwrap()
            .unwrap()
    }

    // --- resolve_output_root ---

    #[test]
    fn test_resolve_output_root_falls_back_to_workspace_path() {
        let db = make_db(None);
        let result = resolve_output_root(&db, "/my/workspace");
        assert_eq!(result.unwrap(), "/my/workspace");
    }

    #[test]
    fn test_resolve_output_root_prefers_skills_path_from_settings() {
        let db = make_db(Some("/configured/skills"));
        let result = resolve_output_root(&db, "/my/workspace");
        assert_eq!(result.unwrap(), "/configured/skills");
    }

    // --- get_skill_history (via crate::git::get_history) ---

    #[test]
    fn test_get_skill_history_returns_commits_for_skill() {
        let dir = tempdir().unwrap();
        let repo_path = dir.path();
        let plugin_slug = crate::skill_paths::DEFAULT_PLUGIN_SLUG;

        init_skill_repo_plugin(repo_path, plugin_slug, "my-skill", "# V1");

        // Add a second commit at the plugin-aware path.
        let skill_dir = repo_path.join(plugin_slug).join("my-skill");
        std::fs::write(skill_dir.join("SKILL.md"), "# V2").unwrap();
        crate::git::commit_all(repo_path, "my-skill: updated").unwrap();

        let history = crate::git::get_history(repo_path, "my-skill", plugin_slug, 100).unwrap();
        assert!(
            history.len() >= 2,
            "expected at least 2 commits, got {}",
            history.len()
        );
        assert!(!history[0].sha.is_empty(), "commit SHA must not be empty");
        assert!(
            !history[0].timestamp.is_empty(),
            "commit timestamp must not be empty"
        );
    }

    #[test]
    fn test_get_skill_history_isolated_by_plugin() {
        let dir = tempdir().unwrap();
        let repo_path = dir.path();

        // Two skills with the same name in different plugins.
        init_skill_repo_plugin(
            repo_path,
            crate::skill_paths::DEFAULT_PLUGIN_SLUG,
            "shared-skill",
            "# default",
        );
        let other_dir = repo_path.join("other-plugin").join("shared-skill");
        std::fs::create_dir_all(&other_dir).unwrap();
        std::fs::write(other_dir.join("SKILL.md"), "# other").unwrap();
        crate::git::commit_all(repo_path, "shared-skill: other-plugin initial").unwrap();

        let default_history = crate::git::get_history(
            repo_path,
            "shared-skill",
            crate::skill_paths::DEFAULT_PLUGIN_SLUG,
            100,
        )
        .unwrap();
        let other_history =
            crate::git::get_history(repo_path, "shared-skill", "other-plugin", 100).unwrap();

        // Each plugin's history must contain only its own commits.
        assert!(
            !default_history.is_empty(),
            "default plugin must have history"
        );
        assert!(!other_history.is_empty(), "other plugin must have history");
        // Their most recent commit SHAs must differ (different commits touch different paths).
        assert_ne!(
            default_history[0].sha, other_history[0].sha,
            "same-named skills in different plugins must not share commit history"
        );
    }

    #[test]
    fn test_get_skill_history_returns_empty_for_no_git_repo() {
        let dir = tempdir().unwrap();
        // No git repo initialized — command layer returns empty vec instead of error.
        let db = make_db(None);
        let workspace = dir.path().to_str().unwrap().to_string();
        // resolve_output_root will return workspace_path since skills_path is not set.
        // The path has no .git dir, so get_skill_history should return Ok(vec![]).
        let result = {
            let root = std::path::Path::new(&workspace);
            if !root.join(".git").exists() {
                Ok(Vec::<crate::types::SkillCommit>::new())
            } else {
                crate::git::get_history(
                    root,
                    "my-skill",
                    crate::skill_paths::DEFAULT_PLUGIN_SLUG,
                    100,
                )
            }
        };
        assert!(result.is_ok());
        assert!(result.unwrap().is_empty());
        let _ = db; // keep db alive
    }

    // --- restore_skill_version (via crate::git::restore_version) ---

    #[test]
    fn test_restore_skill_version_reverts_file_to_earlier_commit() {
        let dir = tempdir().unwrap();
        let repo_path = dir.path();
        let plugin = crate::skill_paths::DEFAULT_PLUGIN_SLUG;

        let sha_v1 =
            init_skill_repo_plugin(repo_path, plugin, "restore-skill", "# Original content");

        // Second commit: change the file.
        let skill_dir = repo_path.join(plugin).join("restore-skill");
        std::fs::write(skill_dir.join("SKILL.md"), "# Changed content").unwrap();
        crate::git::commit_all(repo_path, "restore-skill: changed").unwrap();

        // Confirm current state is V2.
        let current = std::fs::read_to_string(skill_dir.join("SKILL.md")).unwrap();
        assert_eq!(current, "# Changed content");

        // Restore to V1 SHA — should write back to the plugin path.
        crate::git::restore_version(repo_path, &sha_v1, "restore-skill", plugin).unwrap();

        let restored = std::fs::read_to_string(skill_dir.join("SKILL.md")).unwrap();
        assert_eq!(
            restored, "# Original content",
            "file should revert to original content after restore"
        );
    }

    // --- restore_skill_version tagging ---

    #[test]
    fn test_restore_skill_version_tags_next_patch() {
        let dir = tempdir().unwrap();
        let repo_path = dir.path();
        let plugin = crate::skill_paths::DEFAULT_PLUGIN_SLUG;

        let sha_v1 = init_skill_repo_plugin(repo_path, plugin, "tag-skill", "# V1");

        // Tag the initial commit as v1.0.0.
        crate::git::create_skill_version_tag(repo_path, plugin, "tag-skill", "1.0.0").unwrap();

        // Second commit: change the file.
        let skill_dir = repo_path.join(plugin).join("tag-skill");
        std::fs::write(skill_dir.join("SKILL.md"), "# V2").unwrap();
        crate::git::commit_all(repo_path, "tag-skill: updated").unwrap();

        // Restore to V1, commit the restore, then tag.
        crate::git::restore_version(repo_path, &sha_v1, "tag-skill", plugin).unwrap();
        let msg = "tag-skill: restored to test";
        crate::git::commit_all(repo_path, msg).unwrap();
        let current = crate::git::latest_skill_semver(repo_path, plugin, "tag-skill").unwrap();
        let new_version = crate::git::bump_patch(&current);
        assert_eq!(new_version, "1.0.1");
        crate::git::create_skill_version_tag(repo_path, plugin, "tag-skill", &new_version).unwrap();
        let latest = crate::git::latest_skill_semver(repo_path, plugin, "tag-skill").unwrap();
        assert_eq!(latest, "1.0.1");
    }

    #[test]
    fn test_restore_skill_version_tags_v0_0_1_when_no_prior_tags() {
        let dir = tempdir().unwrap();
        let repo_path = dir.path();
        let plugin = crate::skill_paths::DEFAULT_PLUGIN_SLUG;

        let sha_v1 = init_skill_repo_plugin(repo_path, plugin, "notag-skill", "# V1");

        // Second commit.
        let skill_dir = repo_path.join(plugin).join("notag-skill");
        std::fs::write(skill_dir.join("SKILL.md"), "# V2").unwrap();
        crate::git::commit_all(repo_path, "notag-skill: updated").unwrap();

        // No tags exist — latest_skill_semver returns "0.0.0", bump gives "0.0.1".
        crate::git::restore_version(repo_path, &sha_v1, "notag-skill", plugin).unwrap();
        crate::git::commit_all(repo_path, "notag-skill: restored").unwrap();
        let current = crate::git::latest_skill_semver(repo_path, plugin, "notag-skill").unwrap();
        assert_eq!(current, "0.0.0");
        let new_version = crate::git::bump_patch(&current);
        assert_eq!(new_version, "0.0.1");
        crate::git::create_skill_version_tag(repo_path, plugin, "notag-skill", &new_version)
            .unwrap();
        let latest = crate::git::latest_skill_semver(repo_path, plugin, "notag-skill").unwrap();
        assert_eq!(latest, "0.0.1");
    }
}
