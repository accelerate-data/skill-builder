use std::collections::HashMap;
use std::path::Path;

use crate::commands::imported_skills::validate_skill_name;
use crate::db::Db;
use crate::types::{RefineDiff, RefineFileDiff};

use super::resolve_skills_path;

// ─── get_refine_diff ─────────────────────────────────────────────────────────

/// Returns the git diff for a skill's directory — both staged and unstaged changes.
/// Used by the preview panel to show what the refine agent changed.
///
/// Also supports per-file diffs via the `files` array in the response.
/// The frontend can use `git checkout -- <file>` (via a separate command) to undo
/// individual file changes.
#[tauri::command]
pub fn get_refine_diff(
    skill_name: String,
    workspace_path: String,
    db: tauri::State<'_, Db>,
) -> Result<RefineDiff, String> {
    log::info!("[get_refine_diff] skill={}", skill_name);
    validate_skill_name(&skill_name)?;
    let skills_path = resolve_skills_path(&db, &workspace_path).map_err(|e| {
        log::error!("[get_refine_diff] Failed to resolve skills path: {}", e);
        e
    })?;
    get_refine_diff_inner(&skill_name, &skills_path).map_err(|e| {
        log::error!("[get_refine_diff] {}", e);
        e
    })
}

pub(crate) fn get_refine_diff_inner(skill_name: &str, skills_path: &str) -> Result<RefineDiff, String> {
    use git2::{Delta, DiffFormat, DiffOptions, Repository};

    let repo_path = Path::new(skills_path);
    if !repo_path.join(".git").exists() {
        log::debug!(
            "[get_refine_diff] no .git at {}, returning empty",
            repo_path.display()
        );
        return Ok(RefineDiff {
            stat: "no git repository".to_string(),
            files: vec![],
        });
    }

    let repo = Repository::open(repo_path).map_err(|e| format!("Failed to open repo: {}", e))?;

    let prefix = format!("{}/", skill_name);
    log::debug!("[get_refine_diff] computing diff for prefix '{}'", prefix);
    let mut opts = DiffOptions::new();
    opts.pathspec(&prefix);

    // Get HEAD tree (may not exist in a fresh repo)
    let head_tree = repo.head().ok().and_then(|h| h.peel_to_tree().ok());

    // Combined HEAD→workdir diff (staged + unstaged in one pass, no double-counting)
    let diff = repo
        .diff_tree_to_workdir_with_index(head_tree.as_ref(), Some(&mut opts))
        .map_err(|e| format!("Failed to compute diff: {}", e))?;

    // Collect per-file diffs using print() which provides a single mutable callback
    let mut file_map: HashMap<String, RefineFileDiff> = HashMap::new();
    let mut insertions = 0usize;
    let mut deletions = 0usize;

    diff.print(DiffFormat::Patch, |delta, _hunk, line| {
        // git2 delta paths come from the git index/tree, which always uses forward slashes
        // regardless of OS. No backslash normalization needed on Windows.
        let path = delta
            .new_file()
            .path()
            .or_else(|| delta.old_file().path())
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();

        let status = match delta.status() {
            Delta::Added => "added",
            Delta::Deleted => "deleted",
            _ => "modified",
        };
        let entry = file_map
            .entry(path.clone())
            .or_insert_with(|| RefineFileDiff {
                path,
                status: status.to_string(),
                diff: build_refine_patch_metadata(delta),
            });

        // Append diff content: hunk headers, context, additions, deletions
        let origin = line.origin();
        if let Ok(s) = std::str::from_utf8(line.content()) {
            // Exclude file header lines ("+++ b/path", "--- a/path") from stats.
            // They can be emitted as '+'/'-' lines in patch format but are metadata.
            let is_file_header_line =
                (origin == '+' && s.starts_with("++ ")) || (origin == '-' && s.starts_with("-- "));
            if origin == '+' && !is_file_header_line {
                insertions += 1;
            } else if origin == '-' && !is_file_header_line {
                deletions += 1;
            }

            match origin {
                '+' | '-' | ' ' => {
                    entry.diff.push(origin);
                    entry.diff.push_str(s);
                }
                'H' => {
                    // Hunk header (@@) — content already includes the @@ prefix
                    entry.diff.push_str(s);
                }
                _ => {}
            }
        }

        true
    })
    .map_err(|e| format!("Failed to print diff: {}", e))?;

    if file_map.is_empty() {
        log::debug!("[get_refine_diff] no changes for '{}'", skill_name);
        return Ok(RefineDiff {
            stat: "no changes".to_string(),
            files: vec![],
        });
    }

    // Build stat summary from line counts (single pass per file)
    let total_files = file_map.len();

    let stat = format!(
        "{} file(s) changed, {} insertion(s)(+), {} deletion(s)(-)",
        total_files, insertions, deletions
    );

    let mut files: Vec<RefineFileDiff> = file_map.into_values().collect();
    files.sort_by(|a, b| a.path.cmp(&b.path));

    Ok(RefineDiff { stat, files })
}

pub(crate) fn get_refine_diff_for_commit_range_inner(
    skill_name: &str,
    skills_path: &str,
    from_sha: &str,
    to_sha: &str,
) -> Result<RefineDiff, String> {
    use git2::{DiffFormat, DiffOptions, Oid, Repository};

    let repo_path = Path::new(skills_path);
    let repo = Repository::open(repo_path).map_err(|e| format!("Failed to open repo: {}", e))?;

    let from_commit = repo
        .find_commit(
            Oid::from_str(from_sha).map_err(|e| format!("Invalid SHA {}: {}", from_sha, e))?,
        )
        .map_err(|e| format!("Commit {} not found: {}", from_sha, e))?;
    let to_commit = repo
        .find_commit(Oid::from_str(to_sha).map_err(|e| format!("Invalid SHA {}: {}", to_sha, e))?)
        .map_err(|e| format!("Commit {} not found: {}", to_sha, e))?;

    let from_tree = from_commit
        .tree()
        .map_err(|e| format!("Failed to get tree for {}: {}", from_sha, e))?;
    let to_tree = to_commit
        .tree()
        .map_err(|e| format!("Failed to get tree for {}: {}", to_sha, e))?;

    let prefix = format!("{}/", skill_name);
    let mut opts = DiffOptions::new();
    opts.pathspec(&prefix);

    let diff = repo
        .diff_tree_to_tree(Some(&from_tree), Some(&to_tree), Some(&mut opts))
        .map_err(|e| format!("Failed to compute diff: {}", e))?;

    let mut file_map: HashMap<String, RefineFileDiff> = HashMap::new();
    let mut insertions = 0usize;
    let mut deletions = 0usize;

    diff.print(DiffFormat::Patch, |delta, _hunk, line| {
        // git2 delta paths come from the git index/tree — always forward slashes, even on Windows.
        let path = delta
            .new_file()
            .path()
            .or_else(|| delta.old_file().path())
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();

        let status = match delta.status() {
            git2::Delta::Added => "added",
            git2::Delta::Deleted => "deleted",
            git2::Delta::Modified => "modified",
            git2::Delta::Renamed => "modified",
            _ => "modified",
        };

        let entry = file_map
            .entry(path.clone())
            .or_insert_with(|| RefineFileDiff {
                path,
                status: status.to_string(),
                diff: build_refine_patch_metadata(delta),
            });

        let origin = line.origin();
        if let Ok(s) = std::str::from_utf8(line.content()) {
            let is_file_header_line =
                (origin == '+' && s.starts_with("++ ")) || (origin == '-' && s.starts_with("-- "));
            if origin == '+' && !is_file_header_line {
                insertions += 1;
            } else if origin == '-' && !is_file_header_line {
                deletions += 1;
            }

            match origin {
                '+' | '-' | ' ' => {
                    entry.diff.push(origin);
                    entry.diff.push_str(s);
                }
                'H' => entry.diff.push_str(s),
                _ => {}
            }
        }

        true
    })
    .map_err(|e| format!("Failed to print diff: {}", e))?;

    if file_map.is_empty() {
        return Ok(RefineDiff {
            stat: "no changes".to_string(),
            files: vec![],
        });
    }

    let stat = format!(
        "{} file(s) changed, {} insertion(s)(+), {} deletion(s)(-)",
        file_map.len(),
        insertions,
        deletions
    );

    let mut files: Vec<RefineFileDiff> = file_map.into_values().collect();
    files.sort_by(|a, b| a.path.cmp(&b.path));

    Ok(RefineDiff { stat, files })
}

fn build_refine_patch_metadata(delta: git2::DiffDelta<'_>) -> String {
    let old_path = delta
        .old_file()
        .path()
        .map(|p| p.to_string_lossy().to_string());
    let new_path = delta
        .new_file()
        .path()
        .map(|p| p.to_string_lossy().to_string());

    let old_raw = old_path.clone();
    let new_raw = new_path.clone();

    let old_display = if delta.status() == git2::Delta::Added {
        "/dev/null".to_string()
    } else {
        format!(
            "a/{}",
            old_path
                .clone()
                .unwrap_or_else(|| "/dev/null".to_string())
        )
    };
    let new_display = if delta.status() == git2::Delta::Deleted {
        "/dev/null".to_string()
    } else {
        format!(
            "b/{}",
            new_path
                .clone()
                .unwrap_or_else(|| "/dev/null".to_string())
        )
    };

    let diff_old = old_raw
        .clone()
        .or_else(|| new_raw.clone())
        .unwrap_or_default();
    let diff_new = new_raw.or(old_raw).unwrap_or_default();

    format!("diff --git a/{diff_old} b/{diff_new}\n--- {old_display}\n+++ {new_display}\n")
}
