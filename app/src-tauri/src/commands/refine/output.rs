use std::path::Path;

use crate::commands::imported_skills::validate_skill_name;
use crate::db::Db;
use crate::skill_paths::{resolve_skill_dir, resolve_workspace_skill_dir, DEFAULT_PLUGIN_SLUG};
use crate::types::{RefineDiff, RefineFileDiff, RefineFinalizeResult, SkillFileContent};

use super::content::get_skill_content_inner_for_plugin;
use super::diff::get_refine_diff_for_commit_range_inner;
use super::{resolve_skill_plugin_slug, resolve_skills_path};

fn is_mock_agents_enabled() -> bool {
    matches!(std::env::var("MOCK_AGENTS").as_deref(), Ok("true"))
}

fn build_mock_refine_patch(skill_name: &str, file: &SkillFileContent) -> String {
    let repo_relative_path = format!("{}/{}", skill_name, file.path);
    let line_count = file.content.lines().count();
    let header = format!(
        "diff --git a/{path} b/{path}\n--- a/{path}\n+++ b/{path}\n@@ -0,0 +1,{line_count} @@\n",
        path = repo_relative_path
    );
    let body = file
        .content
        .lines()
        .map(|line| format!("+{}\n", line))
        .collect::<String>();
    format!("{}{}", header, body)
}

fn build_mock_refine_diff(skill_name: &str, files: &[SkillFileContent]) -> RefineDiff {
    let diff_files = files
        .iter()
        .map(|file| RefineFileDiff {
            path: format!("{}/{}", skill_name, file.path),
            status: "modified".to_string(),
            diff: build_mock_refine_patch(skill_name, file),
        })
        .collect::<Vec<_>>();

    let insertions = files.iter().map(|file| file.content.lines().count()).sum::<usize>();

    RefineDiff {
        stat: format!(
            "{} file(s) changed, {} insertion(s)(+), 0 deletion(s)(-)",
            diff_files.len(),
            insertions
        ),
        files: diff_files,
    }
}

// ─── Snapshot cleanup ────────────────────────────────────────────────────────

/// Remove the `skill-snapshot` directory from a skill's workspace if it exists.
///
/// Called after benchmark/rewrite finalization and on error/cancellation to
/// prevent stale snapshots from accumulating on disk.
pub(crate) fn cleanup_skill_snapshot(workspace_skill_root: &Path) {
    let snapshot_dir = workspace_skill_root.join("skill-snapshot");
    if snapshot_dir.exists() {
        if let Err(e) = std::fs::remove_dir_all(&snapshot_dir) {
            log::warn!(
                "[cleanup_skill_snapshot] failed to clean up skill-snapshot at {}: {}",
                snapshot_dir.display(),
                e
            );
        } else {
            log::debug!(
                "[cleanup_skill_snapshot] cleaned up skill-snapshot at {}",
                snapshot_dir.display()
            );
        }
    }
}

// ─── Output finalization ────────────────────────────────────────────────────

#[cfg_attr(not(test), allow(dead_code))]
pub(crate) fn finalize_refine_run_inner(
    skill_name: &str,
    skills_path: &str,
    workspace_path: &str,
    _structured_output: Option<&serde_json::Value>,
    pre_run_sha: Option<&str>,
) -> Result<RefineFinalizeResult, String> {
    finalize_refine_run_inner_for_plugin(
        skill_name,
        skills_path,
        workspace_path,
        DEFAULT_PLUGIN_SLUG,
        _structured_output,
        pre_run_sha,
    )
}

pub(crate) fn finalize_refine_run_inner_for_plugin(
    skill_name: &str,
    skills_path: &str,
    workspace_path: &str,
    plugin_slug: &str,
    _structured_output: Option<&serde_json::Value>,
    pre_run_sha: Option<&str>,
) -> Result<RefineFinalizeResult, String> {
    let skill_root = resolve_skill_dir(Path::new(skills_path), plugin_slug, skill_name);
    let workspace_skill_root = resolve_skill_dir(Path::new(workspace_path), plugin_slug, skill_name);
    if !skill_root.exists() {
        return Err(format!(
            "Skill '{}' not found at {}",
            skill_name,
            skill_root.display()
        ));
    }

    // Clean up any stale skill snapshot left by a prior rewrite→benchmark cycle
    cleanup_skill_snapshot(&workspace_skill_root);

    // Agent now handles commit+tag via shell git; read HEAD for the commit SHA
    let commit_sha = {
        let repo = git2::Repository::open(Path::new(skills_path))
            .map_err(|e| format!("Failed to open repo: {}", e))?;
        repo.head()
            .ok()
            .and_then(|h| h.peel_to_commit().ok())
            .map(|c| c.id().to_string())
    };

    // If HEAD hasn't changed since the session started, the agent made no commits.
    // Return files with an empty diff instead of diffing a stale prior commit.
    let head_unchanged = match (&commit_sha, pre_run_sha) {
        (Some(current), Some(pre)) => current == pre,
        _ => false,
    };
    if head_unchanged {
        log::info!(
            "[finalize_refine_run] HEAD unchanged skill={} — no agent commit, skipping diff",
            skill_name,
        );
        let files = get_skill_content_inner_for_plugin(skill_name, skills_path, plugin_slug)?;
        return Ok(RefineFinalizeResult {
            files,
            diff: RefineDiff {
                stat: "no changes".to_string(),
                files: vec![],
            },
            commit_sha,
        });
    }

    if let Some(ref sha) = commit_sha {
        log::info!(
            "[finalize_refine_run] agent committed skill={} sha={}",
            skill_name,
            &sha[..8.min(sha.len())]
        );
    }

    let diff = if let Some(sha) = commit_sha.as_ref() {
        let repo = git2::Repository::open(Path::new(skills_path))
            .map_err(|e| format!("Failed to open repo: {}", e))?;
        let commit = repo
            .find_commit(
                git2::Oid::from_str(sha).map_err(|e| format!("Invalid SHA {}: {}", sha, e))?,
            )
            .map_err(|e| format!("Commit {} not found: {}", sha, e))?;
        let parent_sha = commit.parent(0).ok().map(|parent| parent.id().to_string());

        if let Some(parent_sha) = parent_sha {
            get_refine_diff_for_commit_range_inner(skill_name, skills_path, &parent_sha, sha)?
        } else {
            RefineDiff {
                stat: "no changes".to_string(),
                files: vec![],
            }
        }
    } else {
        RefineDiff {
            stat: "no changes".to_string(),
            files: vec![],
        }
    };

    let files = get_skill_content_inner_for_plugin(skill_name, skills_path, plugin_slug)?;
    let diff = if is_mock_agents_enabled() && diff.files.is_empty() && !files.is_empty() {
        log::info!(
            "[finalize_refine_run] mock fallback diff generated skill={} files={}",
            skill_name,
            files.len()
        );
        build_mock_refine_diff(skill_name, &files)
    } else {
        diff
    };

    Ok(RefineFinalizeResult {
        files,
        diff,
        commit_sha,
    })
}

// ─── Tauri commands ──────────────────────────────────────────────────────────

#[tauri::command]
pub fn clean_benchmark_snapshot(
    skill_name: String,
    workspace_path: String,
    db: tauri::State<'_, Db>,
) -> Result<(), String> {
    log::info!("[clean_benchmark_snapshot] skill={}", skill_name);
    validate_skill_name(&skill_name)?;
    let plugin_slug = super::resolve_skill_plugin_slug(&db, &skill_name)
        .unwrap_or_else(|_| crate::skill_paths::DEFAULT_PLUGIN_SLUG.to_string());
    let workspace_skill_root = resolve_workspace_skill_dir(Path::new(&workspace_path), &plugin_slug, &skill_name);
    cleanup_skill_snapshot(&workspace_skill_root);
    Ok(())
}

#[tauri::command]
pub fn finalize_refine_run(
    skill_name: String,
    workspace_path: String,
    structured_output: Option<serde_json::Value>,
    db: tauri::State<'_, Db>,
    sessions: tauri::State<'_, super::RefineSessionManager>,
) -> Result<RefineFinalizeResult, String> {
    log::info!("[finalize_refine_run] skill={}", skill_name);
    validate_skill_name(&skill_name)?;
    let skills_path = resolve_skills_path(&db, &workspace_path).map_err(|e| {
        log::error!("[finalize_refine_run] Failed to resolve skills path: {}", e);
        e
    })?;
    let plugin_slug = resolve_skill_plugin_slug(&db, &skill_name).map_err(|e| {
        log::error!("[finalize_refine_run] Failed to resolve plugin slug: {}", e);
        e
    })?;

    // Look up the session's pre-run HEAD SHA to detect no-op turns.
    let pre_run_sha = sessions
        .0
        .lock()
        .ok()
        .and_then(|map| {
            map.values()
                .find(|s| s.skill_name == skill_name)
                .and_then(|s| s.head_sha_at_start.clone())
        });

    let result = finalize_refine_run_inner_for_plugin(
        &skill_name,
        &skills_path,
        &workspace_path,
        &plugin_slug,
        structured_output.as_ref(),
        pre_run_sha.as_deref(),
    )
    .map_err(|e| {
        log::error!("[finalize_refine_run] {}", e);
        e
    })?;

    // Update session's head_sha_at_start so subsequent turns diff correctly.
    if let Some(ref new_sha) = result.commit_sha {
        if let Ok(mut map) = sessions.0.lock() {
            if let Some(session) = map.values_mut().find(|s| s.skill_name == skill_name) {
                session.head_sha_at_start = Some(new_sha.clone());
            }
        }
    }

    Ok(result)
}
