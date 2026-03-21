use std::path::Path;

use crate::commands::imported_skills::validate_skill_name;
use crate::db::Db;
use crate::types::{RefineDiff, RefineFinalizeResult};

use super::content::get_skill_content_inner;
use super::diff::get_refine_diff_for_commit_range_inner;
use super::resolve_skills_path;

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

pub(crate) fn finalize_refine_run_inner(
    skill_name: &str,
    skills_path: &str,
    workspace_path: &str,
    _structured_output: Option<&serde_json::Value>,
) -> Result<RefineFinalizeResult, String> {
    let skill_root = Path::new(skills_path).join(skill_name);
    let workspace_skill_root = Path::new(workspace_path).join(skill_name);
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

    let files = get_skill_content_inner(skill_name, skills_path)?;

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
) -> Result<(), String> {
    log::info!("[clean_benchmark_snapshot] skill={}", skill_name);
    validate_skill_name(&skill_name)?;
    let workspace_skill_root = Path::new(&workspace_path).join(&skill_name);
    cleanup_skill_snapshot(&workspace_skill_root);
    Ok(())
}

#[tauri::command]
pub fn finalize_refine_run(
    skill_name: String,
    workspace_path: String,
    structured_output: Option<serde_json::Value>,
    db: tauri::State<'_, Db>,
) -> Result<RefineFinalizeResult, String> {
    log::info!("[finalize_refine_run] skill={}", skill_name);
    validate_skill_name(&skill_name)?;
    let skills_path = resolve_skills_path(&db, &workspace_path).map_err(|e| {
        log::error!("[finalize_refine_run] Failed to resolve skills path: {}", e);
        e
    })?;

    finalize_refine_run_inner(
        &skill_name,
        &skills_path,
        &workspace_path,
        structured_output.as_ref(),
    )
    .map_err(|e| {
        log::error!("[finalize_refine_run] {}", e);
        e
    })
}
