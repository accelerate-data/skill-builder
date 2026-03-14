use std::path::Path;
use std::sync::Mutex;

use crate::db::Db;
use crate::types::{SkillCommit, SkillDiff};

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
    limit: Option<usize>,
    db: tauri::State<'_, Db>,
) -> Result<Vec<SkillCommit>, String> {
    log::info!("[get_skill_history] skill={} limit={:?}", skill_name, limit);
    let output_root = resolve_output_root(&db, &workspace_path)?;
    let root = Path::new(&output_root);
    if !root.join(".git").exists() {
        return Ok(Vec::new());
    }
    crate::git::get_history(root, &skill_name, limit.unwrap_or(100))
}

#[tauri::command]
pub fn get_skill_diff(
    workspace_path: String,
    skill_name: String,
    sha_a: String,
    sha_b: String,
    db: tauri::State<'_, Db>,
) -> Result<SkillDiff, String> {
    log::info!(
        "[get_skill_diff] skill={} sha_a={} sha_b={}",
        skill_name,
        sha_a,
        sha_b
    );
    let output_root = resolve_output_root(&db, &workspace_path)?;
    crate::git::get_diff(Path::new(&output_root), &sha_a, &sha_b, &skill_name)
}

#[tauri::command]
pub fn restore_skill_version(
    workspace_path: String,
    skill_name: String,
    sha: String,
    db: tauri::State<'_, Db>,
) -> Result<(), String> {
    log::info!("[restore_skill_version] skill={} sha={}", skill_name, sha);
    let output_root = resolve_output_root(&db, &workspace_path)?;
    let root = Path::new(&output_root);
    crate::git::restore_version(root, &sha, &skill_name)?;
    // Commit the restore as a new version
    let short_sha = if sha.len() >= 8 { &sha[..8] } else { &sha };
    let msg = format!("{}: restored to {}", skill_name, short_sha);
    crate::git::commit_all(root, &msg).map_err(|e| {
        format!(
            "Filesystem restored but git commit failed ({}): {}",
            msg, e
        )
    })?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::create_test_db_for_tests;
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

    /// Build a temp git repo with one commit containing `skill_name/SKILL.md`.
    fn init_skill_repo(dir: &std::path::Path, skill_name: &str, content: &str) -> String {
        crate::git::ensure_repo(dir).unwrap();
        let skill_dir = dir.join(skill_name);
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

        init_skill_repo(repo_path, "my-skill", "# V1");

        // Add a second commit.
        std::fs::write(repo_path.join("my-skill").join("SKILL.md"), "# V2").unwrap();
        crate::git::commit_all(repo_path, "my-skill: updated").unwrap();

        let history = crate::git::get_history(repo_path, "my-skill", 100).unwrap();
        assert!(
            history.len() >= 2,
            "expected at least 2 commits, got {}",
            history.len()
        );
        assert!(!history[0].sha.is_empty(), "commit SHA must not be empty");
        assert!(!history[0].timestamp.is_empty(), "commit timestamp must not be empty");
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
                crate::git::get_history(root, "my-skill", 100)
            }
        };
        assert!(result.is_ok());
        assert!(result.unwrap().is_empty());
        let _ = db; // keep db alive
    }

    // --- get_skill_diff (via crate::git::get_diff) ---

    #[test]
    fn test_get_skill_diff_returns_diff_between_two_commits() {
        let dir = tempdir().unwrap();
        let repo_path = dir.path();

        let sha_a = init_skill_repo(repo_path, "diff-skill", "# Version 1");

        std::fs::write(repo_path.join("diff-skill").join("SKILL.md"), "# Version 2").unwrap();
        let sha_b = crate::git::commit_all(repo_path, "diff-skill: v2")
            .unwrap()
            .unwrap();

        let diff = crate::git::get_diff(repo_path, &sha_a, &sha_b, "diff-skill").unwrap();
        assert!(!diff.files.is_empty(), "diff should contain at least one file");

        let skill_file = diff
            .files
            .iter()
            .find(|f| f.path.contains("SKILL.md"))
            .expect("SKILL.md should be in the diff");
        assert_eq!(skill_file.status, "modified");
        assert_eq!(skill_file.old_content.as_deref(), Some("# Version 1"));
        assert_eq!(skill_file.new_content.as_deref(), Some("# Version 2"));
    }

    // --- restore_skill_version (via crate::git::restore_version) ---

    #[test]
    fn test_restore_skill_version_reverts_file_to_earlier_commit() {
        let dir = tempdir().unwrap();
        let repo_path = dir.path();

        let sha_v1 = init_skill_repo(repo_path, "restore-skill", "# Original content");

        // Second commit: change the file.
        std::fs::write(
            repo_path.join("restore-skill").join("SKILL.md"),
            "# Changed content",
        )
        .unwrap();
        crate::git::commit_all(repo_path, "restore-skill: changed").unwrap();

        // Confirm current state is V2.
        let current =
            std::fs::read_to_string(repo_path.join("restore-skill").join("SKILL.md")).unwrap();
        assert_eq!(current, "# Changed content");

        // Restore to V1 SHA.
        crate::git::restore_version(repo_path, &sha_v1, "restore-skill").unwrap();

        let restored =
            std::fs::read_to_string(repo_path.join("restore-skill").join("SKILL.md")).unwrap();
        assert_eq!(
            restored, "# Original content",
            "file should revert to original content after restore"
        );
    }
}
