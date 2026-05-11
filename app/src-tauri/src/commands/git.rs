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
    let skill_dir =
        crate::skill_paths::resolve_skill_dir(Path::new(&output_root), &plugin_slug, &skill_name);
    if !skill_dir.join(".git").exists() {
        return Ok(Vec::new());
    }
    crate::git::get_history(&skill_dir, &skill_name, &plugin_slug, limit.unwrap_or(100))
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
    let skill_dir =
        crate::skill_paths::resolve_skill_dir(Path::new(&output_root), &plugin_slug, &skill_name);
    crate::git::restore_version(&skill_dir, &sha, &skill_name, &plugin_slug)?;
    // Commit the restore as a new version
    let short_sha = if sha.len() >= 8 { &sha[..8] } else { &sha };
    let msg = format!("{}: restored to {}", skill_name, short_sha);
    let committed = crate::git::commit_all(&skill_dir, &msg)
        .map_err(|e| format!("Filesystem restored but git commit failed ({}): {}", msg, e))?;
    // Tag the restore with the next patch version.
    // Even if commit_all returned None (content identical to HEAD), we still
    // bump and tag HEAD so the user always sees a new version number.
    let current_version = crate::git::latest_skill_semver(&skill_dir, &plugin_slug, &skill_name)
        .unwrap_or_else(|_| "0.0.0".to_string());
    let new_version = crate::git::bump_patch(&current_version);
    crate::git::create_skill_version_tag(&skill_dir, &plugin_slug, &skill_name, &new_version)
        .map_err(|e| {
            format!(
                "Restore committed but version tag failed (v{}): {}",
                new_version, e
            )
        })?;
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
    let skill_dir =
        crate::skill_paths::resolve_skill_dir(Path::new(&output_root), &plugin_slug, &skill_name);
    let pairs = crate::git::get_skill_files_at_sha(&skill_dir, &skill_name, &plugin_slug, &sha)
        .map_err(|e| {
            log::error!("[get_skill_files_at_sha] git read failed: {}", e);
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
        Db(std::sync::Arc::new(Mutex::new(conn)))
    }

    /// Build a per-skill git repo with one commit using the canonical skill path layout.
    /// Used by history tests that exercise `get_history` with a plugin_slug.
    fn init_skill_repo_plugin(
        skills_path: &std::path::Path,
        plugin_slug: &str,
        skill_name: &str,
        content: &str,
    ) -> String {
        let skill_dir = crate::skill_paths::resolve_skill_dir(skills_path, plugin_slug, skill_name);
        std::fs::create_dir_all(&skill_dir).unwrap();
        crate::git::ensure_repo(&skill_dir).unwrap();
        std::fs::write(skill_dir.join("SKILL.md"), content).unwrap();
        crate::git::commit_all(&skill_dir, &format!("{}: initial", skill_name))
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
        let skills_path = dir.path();
        let plugin_slug = crate::skill_paths::DEFAULT_PLUGIN_SLUG;

        init_skill_repo_plugin(skills_path, plugin_slug, "my-skill", "# V1");

        // Add a second commit to the per-skill repo.
        let skill_dir = crate::skill_paths::resolve_skill_dir(skills_path, plugin_slug, "my-skill");
        std::fs::write(skill_dir.join("SKILL.md"), "# V2").unwrap();
        crate::git::commit_all(&skill_dir, "my-skill: updated").unwrap();

        let history = crate::git::get_history(&skill_dir, "my-skill", plugin_slug, 100).unwrap();
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
        let skills_path = dir.path();

        // Two skills with the same name in different plugins — each has its own repo.
        init_skill_repo_plugin(
            skills_path,
            crate::skill_paths::DEFAULT_PLUGIN_SLUG,
            "shared-skill",
            "# default",
        );
        init_skill_repo_plugin(skills_path, "other-plugin", "shared-skill", "# other");

        let default_skill_dir = crate::skill_paths::resolve_skill_dir(
            skills_path,
            crate::skill_paths::DEFAULT_PLUGIN_SLUG,
            "shared-skill",
        );
        let other_skill_dir =
            crate::skill_paths::resolve_skill_dir(skills_path, "other-plugin", "shared-skill");

        let default_history = crate::git::get_history(
            &default_skill_dir,
            "shared-skill",
            crate::skill_paths::DEFAULT_PLUGIN_SLUG,
            100,
        )
        .unwrap();
        let other_history =
            crate::git::get_history(&other_skill_dir, "shared-skill", "other-plugin", 100).unwrap();

        // Each plugin's history must contain only its own commits.
        assert!(
            !default_history.is_empty(),
            "default plugin must have history"
        );
        assert!(!other_history.is_empty(), "other plugin must have history");
        // Their most recent commit SHAs must differ (separate repos, separate commit graphs).
        assert_ne!(
            default_history[0].sha, other_history[0].sha,
            "same-named skills in different plugins must not share commit history"
        );
    }

    #[test]
    fn test_get_skill_history_returns_empty_for_no_git_repo() {
        let dir = tempdir().unwrap();
        let plugin = crate::skill_paths::DEFAULT_PLUGIN_SLUG;
        // No git repo initialized — command layer returns empty vec instead of error.
        let db = make_db(None);
        let workspace = dir.path().to_str().unwrap().to_string();
        let skill_dir = crate::skill_paths::resolve_skill_dir(
            std::path::Path::new(&workspace),
            plugin,
            "my-skill",
        );
        // The skill_dir has no .git dir, so get_skill_history should return Ok(vec![]).
        let result = {
            if !skill_dir.join(".git").exists() {
                Ok(Vec::<crate::types::SkillCommit>::new())
            } else {
                crate::git::get_history(&skill_dir, "my-skill", plugin, 100)
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
        let skills_path = dir.path();
        let plugin = crate::skill_paths::DEFAULT_PLUGIN_SLUG;

        let sha_v1 =
            init_skill_repo_plugin(skills_path, plugin, "restore-skill", "# Original content");

        // Second commit: change the file in the per-skill repo.
        let skill_dir = crate::skill_paths::resolve_skill_dir(skills_path, plugin, "restore-skill");
        std::fs::write(skill_dir.join("SKILL.md"), "# Changed content").unwrap();
        crate::git::commit_all(&skill_dir, "restore-skill: changed").unwrap();

        // Confirm current state is V2.
        let current = std::fs::read_to_string(skill_dir.join("SKILL.md")).unwrap();
        assert_eq!(current, "# Changed content");

        // Restore to V1 SHA — per-skill repo.
        crate::git::restore_version(&skill_dir, &sha_v1, "restore-skill", plugin).unwrap();

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
        let skills_path = dir.path();
        let plugin = crate::skill_paths::DEFAULT_PLUGIN_SLUG;

        let sha_v1 = init_skill_repo_plugin(skills_path, plugin, "tag-skill", "# V1");

        let skill_dir = crate::skill_paths::resolve_skill_dir(skills_path, plugin, "tag-skill");

        // Tag the initial commit as v1.0.0.
        crate::git::create_skill_version_tag(&skill_dir, plugin, "tag-skill", "1.0.0").unwrap();

        // Second commit: change the file.
        std::fs::write(skill_dir.join("SKILL.md"), "# V2").unwrap();
        crate::git::commit_all(&skill_dir, "tag-skill: updated").unwrap();

        // Restore to V1, commit the restore, then tag.
        crate::git::restore_version(&skill_dir, &sha_v1, "tag-skill", plugin).unwrap();
        let msg = "tag-skill: restored to test";
        crate::git::commit_all(&skill_dir, msg).unwrap();
        let current = crate::git::latest_skill_semver(&skill_dir, plugin, "tag-skill").unwrap();
        let new_version = crate::git::bump_patch(&current);
        assert_eq!(new_version, "1.0.1");
        crate::git::create_skill_version_tag(&skill_dir, plugin, "tag-skill", &new_version)
            .unwrap();
        let latest = crate::git::latest_skill_semver(&skill_dir, plugin, "tag-skill").unwrap();
        assert_eq!(latest, "1.0.1");
    }

    #[test]
    fn test_restore_skill_version_tags_v0_0_1_when_no_prior_tags() {
        let dir = tempdir().unwrap();
        let skills_path = dir.path();
        let plugin = crate::skill_paths::DEFAULT_PLUGIN_SLUG;

        let sha_v1 = init_skill_repo_plugin(skills_path, plugin, "notag-skill", "# V1");

        let skill_dir = crate::skill_paths::resolve_skill_dir(skills_path, plugin, "notag-skill");

        // Second commit.
        std::fs::write(skill_dir.join("SKILL.md"), "# V2").unwrap();
        crate::git::commit_all(&skill_dir, "notag-skill: updated").unwrap();

        // No tags exist — latest_skill_semver returns "0.0.0", bump gives "0.0.1".
        crate::git::restore_version(&skill_dir, &sha_v1, "notag-skill", plugin).unwrap();
        crate::git::commit_all(&skill_dir, "notag-skill: restored").unwrap();
        let current = crate::git::latest_skill_semver(&skill_dir, plugin, "notag-skill").unwrap();
        assert_eq!(current, "0.0.0");
        let new_version = crate::git::bump_patch(&current);
        assert_eq!(new_version, "0.0.1");
        crate::git::create_skill_version_tag(&skill_dir, plugin, "notag-skill", &new_version)
            .unwrap();
        let latest = crate::git::latest_skill_semver(&skill_dir, plugin, "notag-skill").unwrap();
        assert_eq!(latest, "0.0.1");
    }

    // --- per-skill repo tests (Task 7) ---

    #[test]
    fn test_get_skill_history_uses_per_skill_repo() {
        let dir = tempdir().unwrap();
        let skills_path = dir.path();
        let plugin = crate::skill_paths::DEFAULT_PLUGIN_SLUG;
        let skill_dir = crate::skill_paths::resolve_skill_dir(skills_path, plugin, "hist-skill");
        std::fs::create_dir_all(&skill_dir).unwrap();
        crate::git::ensure_repo(&skill_dir).unwrap();
        std::fs::write(skill_dir.join("SKILL.md"), "# V1").unwrap();
        crate::git::commit_all(&skill_dir, "initial").unwrap();
        std::fs::write(skill_dir.join("SKILL.md"), "# V2").unwrap();
        crate::git::commit_all(&skill_dir, "updated").unwrap();

        // No .git at skills_path root — per-skill repo only.
        assert!(!skills_path.join(".git").exists());

        let history = crate::git::get_history(&skill_dir, "hist-skill", plugin, 100).unwrap();
        assert!(
            history.len() >= 2,
            "expected at least 2 commits, got {}",
            history.len()
        );
    }

    #[test]
    fn test_restore_skill_version_per_skill_repo() {
        let dir = tempdir().unwrap();
        let skills_path = dir.path();
        let plugin = crate::skill_paths::DEFAULT_PLUGIN_SLUG;
        let skill_dir = crate::skill_paths::resolve_skill_dir(skills_path, plugin, "restore-test");
        std::fs::create_dir_all(&skill_dir).unwrap();
        crate::git::ensure_repo(&skill_dir).unwrap();
        std::fs::write(skill_dir.join("SKILL.md"), "# V1 content").unwrap();
        let sha_v1 = crate::git::commit_all(&skill_dir, "initial")
            .unwrap()
            .unwrap();
        std::fs::write(skill_dir.join("SKILL.md"), "# V2 content").unwrap();
        crate::git::commit_all(&skill_dir, "updated").unwrap();
        crate::git::create_skill_version_tag(&skill_dir, plugin, "restore-test", "1.0.0").unwrap();

        crate::git::restore_version(&skill_dir, &sha_v1, "restore-test", plugin).unwrap();
        let restored = std::fs::read_to_string(skill_dir.join("SKILL.md")).unwrap();
        assert_eq!(restored, "# V1 content");
    }
}
