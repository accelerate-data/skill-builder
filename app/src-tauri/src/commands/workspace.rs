use crate::db::Db;
use std::fs;
use std::path::Path;

#[allow(dead_code)]
const OPENHANDS_SUBDIR: &str = "openhands";

/// Resolve the app-local OpenHands conversations directory.
/// Shape: `{app_data_root}/openhands/conversations/`
#[allow(dead_code)]
pub fn resolve_openhands_conversations_dir(app_data_root: &Path) -> std::path::PathBuf {
    app_data_root.join(OPENHANDS_SUBDIR).join("conversations")
}

/// Iterate over immediate subdirectories of `dir`, skipping hidden (dotfile)
/// entries. Returns an empty iterator if `dir` cannot be read.
#[allow(dead_code)]
fn non_hidden_subdirs(dir: &Path) -> impl Iterator<Item = std::path::PathBuf> {
    fs::read_dir(dir)
        .ok()
        .into_iter()
        .flatten()
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            path.is_dir()
                && path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .is_some_and(|s| !s.starts_with('.'))
        })
}

/// Migrate stale workspace layout artifacts after reorganization.
/// Safe to call on every startup — only removes files that exist.
fn migrate_workspace_layout(workspace_path: &str) {
    let base = Path::new(workspace_path);
    let claude_md = base.join("CLAUDE.md");
    if claude_md.is_file() {
        let _ = fs::remove_file(&claude_md);
    }
    let legacy_claude_dir = base.join(".claude");
    if legacy_claude_dir.is_dir() {
        let _ = fs::remove_dir_all(&legacy_claude_dir);
    }
    // Remove stale root-level infrastructure from pre-reorganization layout
    for name in &["agents", "references"] {
        let path = base.join(name);
        if path.is_dir() {
            let _ = fs::remove_dir_all(&path);
        }
    }
    // Remove dead database artifact
    let db_file = base.join("vibedata.db");
    if db_file.is_file() {
        let _ = fs::remove_file(&db_file);
    }

    // VU-1157 aftermath: remove stale per-skill JSON artifacts that were
    // written before context data moved to SQLite, and clean up the dead
    // logs/ dirs created by the removed create_openhands_persistence_dir
    // function (per-run dirs were never written to).
    // Walk legacy and canonical workspace layouts:
    // - legacy plugin layout: {workspace}/{plugin}/{skill}/
    // - canonical layout:     {workspace}/{plugin}/skills/{skill}/
    let Ok(plugin_entries) = fs::read_dir(base) else {
        return;
    };
    for plugin_entry in plugin_entries.flatten() {
        let plugin_path = plugin_entry.path();
        if !plugin_path.is_dir() {
            continue;
        }
        let mut candidate_roots = vec![plugin_path.clone()];
        let canonical_skills_dir = plugin_path.join("skills");
        if canonical_skills_dir.is_dir() {
            candidate_roots.push(canonical_skills_dir);
        }
        for candidate_root in candidate_roots {
            let Ok(skill_entries) = fs::read_dir(&candidate_root) else {
                continue;
            };
            for skill_entry in skill_entries.flatten() {
                let skill_dir = skill_entry.path();
                if !skill_dir.is_dir() {
                    continue;
                }
                // Skip the canonical container dir itself when walking the legacy root.
                if skill_dir.file_name().and_then(|n| n.to_str()) == Some("skills") {
                    continue;
                }
                // Remove stale VU-1157 context files.
                for name in &[
                    "context/clarifications.json",
                    "context/decisions.json",
                    "context/benchmark-meta.json",
                    "user-context.md",
                    "gate-result.json",
                ] {
                    let _ = fs::remove_file(skill_dir.join(name));
                }
                // Remove context/ dir only if now empty.
                let _ = fs::remove_dir(skill_dir.join("context"));
                // Remove empty per-run dirs under logs/, then logs/ itself.
                let logs_dir = skill_dir.join("logs");
                if logs_dir.is_dir() {
                    if let Ok(run_entries) = fs::read_dir(&logs_dir) {
                        for run_entry in run_entries.flatten() {
                            let _ = fs::remove_dir(run_entry.path());
                        }
                    }
                    let _ = fs::remove_dir(&logs_dir);
                }
            }
        }
    }
}

// migrate_context_from_skills_path and move_context_files were removed in VU-1157.
// Context files (clarifications, decisions, user-context) now live in SQLite.
// The workspace is runtime scratch only: .agents/, logs/, tmp/.

/// Migrate from a shared root git repo to per-skill git repositories.
///
/// If `{skills_path}/.git/` exists (legacy shared repo), this function:
/// 1. Enumerates all skill directories in legacy or canonical plugin layouts.
/// 2. Inits a per-skill repo for each that doesn't already have one.
/// 3. Commits current files as `"initial commit"` in each new per-skill repo.
/// 4. Removes `{skills_path}/.git/`.
///
/// Non-fatal: logs warnings on failure, never crashes.
#[allow(dead_code)]
pub(super) fn migrate_to_per_skill_repos(skills_path: &Path) {
    if !skills_path.join(".git").exists() {
        return;
    }
    log::info!(
        "[migrate_to_per_skill_repos] shared repo detected at {}; migrating to per-skill repos",
        skills_path.display()
    );

    for plugin_dir in non_hidden_subdirs(skills_path) {
        let canonical_skills_dir = plugin_dir.join("skills");
        let skill_roots = if canonical_skills_dir.is_dir() {
            vec![canonical_skills_dir]
        } else {
            vec![plugin_dir.clone()]
        };
        for skill_root in skill_roots {
            for skill_dir in non_hidden_subdirs(&skill_root) {
                if skill_dir.join(".git").exists() {
                    log::debug!(
                        "[migrate_to_per_skill_repos] {} already has .git, skipping",
                        skill_dir.display()
                    );
                    continue;
                }
                if let Err(e) = crate::git::ensure_repo(&skill_dir) {
                    log::warn!(
                        "[migrate_to_per_skill_repos] failed to init repo at {}: {}",
                        skill_dir.display(),
                        e
                    );
                    continue;
                }
                match crate::git::commit_all(&skill_dir, "initial commit") {
                    Ok(_) => log::info!(
                        "[migrate_to_per_skill_repos] initialized repo at {}",
                        skill_dir.display()
                    ),
                    Err(e) => log::warn!(
                        "[migrate_to_per_skill_repos] commit failed at {}: {}",
                        skill_dir.display(),
                        e
                    ),
                }
            }
        }
    }

    let shared_git = skills_path.join(".git");
    if let Err(e) = std::fs::remove_dir_all(&shared_git) {
        log::warn!(
            "[migrate_to_per_skill_repos] failed to remove shared .git: {}",
            e
        );
    } else {
        log::info!("[migrate_to_per_skill_repos] removed shared root .git/");
    }
}

#[tauri::command]
pub fn clear_workspace(app: tauri::AppHandle, db: tauri::State<'_, Db>) -> Result<(), String> {
    log::info!("[clear_workspace]");
    let conn = db.0.lock().map_err(|e| {
        log::error!("[clear_workspace] Failed to acquire DB lock: {}", e);
        e.to_string()
    })?;
    let settings = crate::db::read_settings(&conn)?;
    let skills_path = settings
        .skills_path
        .ok_or_else(|| "Skills path not initialized".to_string())?;
    drop(conn);

    // Remove legacy workspace artifacts if they still exist.
    migrate_workspace_layout(&skills_path);

    // Invalidate the session cache so next workflow start re-checks
    super::workflow::invalidate_workspace_cache(&skills_path);

    // Re-deploy only bundled OpenHands agents/skills under `.agents/`.
    super::workflow::redeploy_agents(&app, &skills_path)?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- migrate_workspace_layout stale-artifact cleanup tests ---

    #[test]
    fn test_migrate_workspace_layout_cleans_stale_files() {
        let workspace = tempfile::tempdir().unwrap();
        let skill_dir = workspace
            .path()
            .join("some-plugin")
            .join("skills")
            .join("some-skill");

        // Write stale VU-1157 context files.
        fs::create_dir_all(skill_dir.join("context")).unwrap();
        fs::write(skill_dir.join("context/clarifications.json"), "{}").unwrap();
        fs::write(skill_dir.join("context/decisions.json"), "{}").unwrap();
        fs::write(skill_dir.join("user-context.md"), "# ctx").unwrap();
        fs::write(skill_dir.join("gate-result.json"), "{}").unwrap();

        // Write an unrelated file inside context/ — should survive.
        fs::write(skill_dir.join("context/something-else.txt"), "keep me").unwrap();

        // Create an empty logs/ dir (simulating dead persistence dirs).
        fs::create_dir_all(skill_dir.join("logs")).unwrap();

        migrate_workspace_layout(workspace.path().to_str().unwrap());

        // Stale files must be gone.
        assert!(
            !skill_dir.join("context/clarifications.json").exists(),
            "clarifications.json should be removed"
        );
        assert!(
            !skill_dir.join("context/decisions.json").exists(),
            "decisions.json should be removed"
        );
        assert!(
            !skill_dir.join("user-context.md").exists(),
            "user-context.md should be removed"
        );
        assert!(
            !skill_dir.join("gate-result.json").exists(),
            "gate-result.json should be removed"
        );

        // context/ dir must survive because something-else.txt is still inside.
        assert!(
            skill_dir.join("context").is_dir(),
            "context/ must survive when it still has other content"
        );
        assert!(
            skill_dir.join("context/something-else.txt").exists(),
            "unrelated file in context/ must survive"
        );

        // Empty logs/ dir must be removed.
        assert!(
            !skill_dir.join("logs").exists(),
            "empty logs/ dir should be removed"
        );
    }

    #[test]
    fn test_migrate_workspace_layout_removes_context_dir_when_empty() {
        let workspace = tempfile::tempdir().unwrap();
        let skill_dir = workspace
            .path()
            .join("some-plugin")
            .join("skills")
            .join("some-skill");

        fs::create_dir_all(skill_dir.join("context")).unwrap();
        fs::write(skill_dir.join("context/clarifications.json"), "{}").unwrap();

        migrate_workspace_layout(workspace.path().to_str().unwrap());

        assert!(
            !skill_dir.join("context").exists(),
            "context/ dir should be removed when empty after stale file deletion"
        );
    }

    #[test]
    fn test_migrate_workspace_layout_removes_empty_log_run_dirs() {
        let workspace = tempfile::tempdir().unwrap();
        let skill_dir = workspace
            .path()
            .join("some-plugin")
            .join("skills")
            .join("some-skill");

        // Simulate dead per-run log dirs.
        fs::create_dir_all(skill_dir.join("logs/agent-xyz-2024-01-01T00-00-00")).unwrap();
        fs::create_dir_all(skill_dir.join("logs/agent-abc-2024-01-02T00-00-00")).unwrap();

        migrate_workspace_layout(workspace.path().to_str().unwrap());

        assert!(
            !skill_dir.join("logs").exists(),
            "logs/ dir should be removed after emptying per-run subdirs"
        );
    }

    #[test]
    fn test_migrate_workspace_layout_preserves_nonempty_log_run_dirs() {
        let workspace = tempfile::tempdir().unwrap();
        let skill_dir = workspace
            .path()
            .join("some-plugin")
            .join("skills")
            .join("some-skill");

        // A per-run dir with content should survive — remove_dir is non-recursive.
        let run_dir = skill_dir.join("logs/agent-xyz-2024-01-01T00-00-00");
        fs::create_dir_all(&run_dir).unwrap();
        fs::write(run_dir.join("run.jsonl"), "{}").unwrap();

        migrate_workspace_layout(workspace.path().to_str().unwrap());

        assert!(
            run_dir.exists(),
            "non-empty per-run log dir should survive migration"
        );
        assert!(
            skill_dir.join("logs").exists(),
            "logs/ parent should survive when a run dir has content"
        );
    }

    #[test]
    fn test_migrate_workspace_layout_removes_claude_workspace_artifacts() {
        let workspace = tempfile::tempdir().unwrap();

        fs::write(workspace.path().join("CLAUDE.md"), "# legacy").unwrap();
        fs::create_dir_all(workspace.path().join(".claude/skills/legacy-skill")).unwrap();
        fs::write(
            workspace
                .path()
                .join(".claude/skills/legacy-skill/SKILL.md"),
            "# legacy skill",
        )
        .unwrap();
        fs::create_dir_all(workspace.path().join(".claude/agents")).unwrap();
        fs::write(
            workspace.path().join(".claude/agents/skill-creator.md"),
            "# legacy agent",
        )
        .unwrap();
        fs::create_dir_all(workspace.path().join(".agents/agents")).unwrap();
        fs::write(
            workspace.path().join(".agents/agents/skill-creator.md"),
            "# current agent",
        )
        .unwrap();

        migrate_workspace_layout(workspace.path().to_str().unwrap());

        assert!(
            !workspace.path().join("CLAUDE.md").exists(),
            "workspace CLAUDE.md should be removed during migration"
        );
        assert!(
            !workspace.path().join(".claude").exists(),
            "legacy workspace .claude directory should be removed during migration"
        );
        assert!(
            workspace
                .path()
                .join(".agents/agents/skill-creator.md")
                .is_file(),
            "OpenHands .agents layout must be preserved"
        );
    }
}

#[cfg(test)]
mod migration_tests {
    use tempfile::tempdir;

    fn setup_shared_repo(skills_path: &std::path::Path) {
        crate::git::ensure_repo(skills_path).unwrap();
        let skill_dir = skills_path.join("default").join("skills").join("my-skill");
        std::fs::create_dir_all(&skill_dir).unwrap();
        std::fs::write(skill_dir.join("SKILL.md"), "# My skill").unwrap();
        crate::git::commit_all(skills_path, "my-skill: initial").unwrap();
    }

    #[test]
    fn test_migrate_to_per_skill_repos_removes_shared_git() {
        let dir = tempdir().unwrap();
        let skills_path = dir.path();
        setup_shared_repo(skills_path);

        assert!(
            skills_path.join(".git").exists(),
            "pre: shared .git must exist"
        );

        super::migrate_to_per_skill_repos(skills_path);

        assert!(
            !skills_path.join(".git").exists(),
            "shared .git must be removed after migration"
        );
    }

    #[test]
    fn test_migrate_to_per_skill_repos_inits_per_skill_git() {
        let dir = tempdir().unwrap();
        let skills_path = dir.path();
        setup_shared_repo(skills_path);

        super::migrate_to_per_skill_repos(skills_path);

        let skill_dir = skills_path.join("default").join("skills").join("my-skill");
        assert!(
            skill_dir.join(".git").exists(),
            "per-skill .git must exist after migration"
        );
    }

    #[test]
    fn test_migrate_to_per_skill_repos_is_noop_without_shared_git() {
        let dir = tempdir().unwrap();
        let skills_path = dir.path();
        std::fs::create_dir_all(skills_path.join("default").join("skills").join("my-skill"))
            .unwrap();

        // No .git at root — should be a no-op, no panic
        super::migrate_to_per_skill_repos(skills_path);

        assert!(!skills_path.join(".git").exists());
    }

    #[test]
    fn test_migrate_to_per_skill_repos_skips_already_migrated_skill_dir() {
        // A skill_dir that already has .git/ must not be re-initialized or disturbed.
        let dir = tempdir().unwrap();
        let skills_path = dir.path();
        // Shared root .git exists (triggers migration)
        crate::git::ensure_repo(skills_path).unwrap();
        let skill_dir = skills_path.join("default").join("skills").join("my-skill");
        std::fs::create_dir_all(&skill_dir).unwrap();
        // Pre-create a per-skill repo with one commit
        crate::git::ensure_repo(&skill_dir).unwrap();
        std::fs::write(skill_dir.join("SKILL.md"), "# Pre-existing").unwrap();
        let original_sha = crate::git::commit_all(&skill_dir, "pre-existing")
            .unwrap()
            .unwrap();

        super::migrate_to_per_skill_repos(skills_path);

        // Per-skill repo must still have exactly the same HEAD commit (not reinit'd)
        let repo = git2::Repository::open(&skill_dir).unwrap();
        let head_sha = repo
            .head()
            .unwrap()
            .peel_to_commit()
            .unwrap()
            .id()
            .to_string();
        assert_eq!(
            head_sha, original_sha,
            "existing per-skill repo must not be disturbed by migration"
        );
        assert!(
            !skills_path.join(".git").exists(),
            "shared .git must still be removed"
        );
    }
}
