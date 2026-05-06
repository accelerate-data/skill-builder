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

fn build_mock_refine_patch(plugin_slug: &str, skill_name: &str, file: &SkillFileContent) -> String {
    let repo_relative_path = format!("{}/{}/{}", plugin_slug, skill_name, file.path);
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

fn build_mock_refine_diff(
    plugin_slug: &str,
    skill_name: &str,
    files: &[SkillFileContent],
) -> RefineDiff {
    let diff_files = files
        .iter()
        .map(|file| RefineFileDiff {
            path: format!("{}/{}/{}", plugin_slug, skill_name, file.path),
            status: "modified".to_string(),
            diff: build_mock_refine_patch(plugin_slug, skill_name, file),
        })
        .collect::<Vec<_>>();

    let insertions = files
        .iter()
        .map(|file| file.content.lines().count())
        .sum::<usize>();

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

// ─── Protected frontmatter fields ───────────────────────────────────────────

/// Replace the `name:` field in SKILL.md YAML frontmatter.
#[cfg_attr(not(test), allow(dead_code))]
pub(crate) fn update_skill_name(content: &str, name: &str) -> Result<String, String> {
    let content = content.replace("\r\n", "\n");

    if !content.starts_with("---") {
        return Err("SKILL.md is missing YAML frontmatter (does not start with ---)".to_string());
    }

    let after_first = &content[3..];
    let end_pos = after_first
        .find("\n---")
        .ok_or_else(|| "SKILL.md has an unclosed YAML frontmatter block".to_string())?;

    let yaml_block = &after_first[..end_pos];
    let body_part = &after_first[end_pos..];

    let quoted = crate::commands::imported_skills::frontmatter::yaml_quote_scalar(name);
    let new_name_line = format!("name: {}", quoted);

    let mut new_yaml: Vec<String> = Vec::new();
    let mut found_name = false;

    for line in yaml_block.lines() {
        let trimmed = line.trim();
        let is_indented = line.starts_with(' ') || line.starts_with('\t');

        if !is_indented && trimmed.starts_with("name:") {
            new_yaml.push(new_name_line.clone());
            found_name = true;
            continue;
        }

        new_yaml.push(line.to_string());
    }

    if !found_name {
        new_yaml.insert(0, new_name_line);
    }

    Ok(format!("---\n{}{}", new_yaml.join("\n"), body_part))
}

/// Replace or insert the `description:` field in SKILL.md YAML frontmatter.
pub(crate) fn update_skill_description(content: &str, description: &str) -> Result<String, String> {
    let content = content.replace("\r\n", "\n");

    if !content.starts_with("---") {
        return Err("SKILL.md is missing YAML frontmatter (does not start with ---)".to_string());
    }

    let after_first = &content[3..];
    let end_pos = after_first
        .find("\n---")
        .ok_or_else(|| "SKILL.md has an unclosed YAML frontmatter block".to_string())?;

    let yaml_block = &after_first[..end_pos];
    let body_part = &after_first[end_pos..];

    let quoted = crate::commands::imported_skills::frontmatter::yaml_quote_scalar(description);
    let new_description_line = format!("description: {}", quoted);

    let mut new_yaml: Vec<String> = Vec::new();
    let mut found_description = false;
    let mut skip_continuation = false;
    let mut found_name = false;

    for line in yaml_block.lines() {
        let trimmed = line.trim();
        let is_indented = line.starts_with(' ') || line.starts_with('\t');

        if skip_continuation {
            if is_indented && !trimmed.is_empty() {
                continue;
            }
            skip_continuation = false;
        }

        if !is_indented && trimmed.starts_with("description:") {
            let value = trimmed["description:".len()..].trim();
            if matches!(value, ">" | "|" | ">-" | "|-") {
                skip_continuation = true;
            }
            new_yaml.push(new_description_line.clone());
            found_description = true;
            continue;
        }

        new_yaml.push(line.to_string());

        if !is_indented && trimmed.starts_with("name:") {
            found_name = true;
        }
    }

    if !found_description {
        if found_name {
            let pos = new_yaml
                .iter()
                .position(|line| line.trim().starts_with("name:"))
                .map(|index| index + 1)
                .unwrap_or(0);
            new_yaml.insert(pos, new_description_line);
        } else {
            new_yaml.insert(0, new_description_line);
        }
    }

    Ok(format!("---\n{}{}", new_yaml.join("\n"), body_part))
}

/// Read a file's content from a specific git commit via its tree.
fn read_file_at_commit(
    repo: &git2::Repository,
    commit_sha: &str,
    file_path: &str,
) -> Result<String, String> {
    let oid = git2::Oid::from_str(commit_sha)
        .map_err(|e| format!("Invalid SHA '{}': {}", commit_sha, e))?;
    let commit = repo
        .find_commit(oid)
        .map_err(|e| format!("Commit '{}' not found: {}", commit_sha, e))?;
    let tree = commit
        .tree()
        .map_err(|e| format!("Failed to get tree for '{}': {}", commit_sha, e))?;
    let entry = tree.get_path(Path::new(file_path)).map_err(|e| {
        format!(
            "File '{}' not in commit '{}': {}",
            file_path,
            &commit_sha[..8.min(commit_sha.len())],
            e
        )
    })?;
    let blob = entry
        .to_object(repo)
        .and_then(|o| o.peel_to_blob())
        .map_err(|e| format!("Failed to read blob for '{}': {}", file_path, e))?;
    String::from_utf8(blob.content().to_vec())
        .map_err(|e| format!("File '{}' is not valid UTF-8: {}", file_path, e))
}

/// Restore `name` and `description` frontmatter fields if the refine agent changed them.
///
/// Reads the pre-run SKILL.md from git history, compares with the current on-disk
/// version, and rewrites + commits if either protected field was modified.
/// Returns `true` if a fixup commit was created.
fn restore_protected_frontmatter(
    skill_md_path: &Path,
    skills_path: &str,
    plugin_slug: &str,
    skill_name: &str,
    pre_run_sha: &str,
) -> Result<bool, String> {
    let skill_dir = resolve_skill_dir(Path::new(skills_path), plugin_slug, skill_name);
    let repo =
        git2::Repository::open(&skill_dir).map_err(|e| format!("Failed to open repo: {}", e))?;

    let relative_path = "SKILL.md";
    let original_content = match read_file_at_commit(&repo, pre_run_sha, relative_path) {
        Ok(content) => content,
        Err(e) => {
            log::warn!(
                "[restore_protected_frontmatter] could not read pre-run SKILL.md: {}",
                e
            );
            return Ok(false);
        }
    };

    let original_fm =
        crate::commands::imported_skills::frontmatter::parse_frontmatter_full(&original_content);

    let current_content = std::fs::read_to_string(skill_md_path)
        .map_err(|e| format!("Failed to read current SKILL.md: {}", e))?;
    let current_fm =
        crate::commands::imported_skills::frontmatter::parse_frontmatter_full(&current_content);

    let name_changed = original_fm.name != current_fm.name;
    let desc_changed = original_fm.description != current_fm.description;

    if !name_changed && !desc_changed {
        return Ok(false);
    }

    let mut content = current_content;

    if desc_changed {
        if let Some(ref original_desc) = original_fm.description {
            content = update_skill_description(&content, original_desc)?;
        }
    }

    if name_changed {
        if let Some(ref original_name) = original_fm.name {
            content = update_skill_name(&content, original_name)?;
        }
    }

    std::fs::write(skill_md_path, &content)
        .map_err(|e| format!("Failed to write SKILL.md: {}", e))?;

    crate::git::commit_all(
        &skill_dir,
        &format!("{}: restore protected frontmatter fields", skill_name),
    )?;

    let mut restored = Vec::new();
    if name_changed {
        restored.push("name");
    }
    if desc_changed {
        restored.push("description");
    }
    log::info!(
        "[restore_protected_frontmatter] restored {} for skill={}",
        restored.join(", "),
        skill_name
    );

    Ok(true)
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
    let workspace_skill_root =
        resolve_workspace_skill_dir(Path::new(workspace_path), plugin_slug, skill_name);
    if !skill_root.exists() {
        return Err(format!(
            "Skill '{}' not found at {}",
            skill_name,
            skill_root.display()
        ));
    }

    // Clean up any stale skill snapshot left by a prior rewrite→benchmark cycle
    cleanup_skill_snapshot(&workspace_skill_root);

    // Read HEAD for the commit SHA. The rewrite agent is instructed to commit,
    // but finalize also commits scoped skill changes if the agent only edited files.
    let mut commit_sha = {
        let repo = git2::Repository::open(&skill_root)
            .map_err(|e| format!("Failed to open repo: {}", e))?;
        repo.head()
            .ok()
            .and_then(|h| h.peel_to_commit().ok())
            .map(|c| c.id().to_string())
    };

    // If HEAD hasn't changed since the session started, the agent made no commits.
    // Return files with an empty diff instead of diffing a stale prior commit.
    let mut head_unchanged = match (&commit_sha, pre_run_sha) {
        (Some(current), Some(pre)) => current == pre,
        _ => false,
    };
    if head_unchanged {
        match crate::git::commit_all(&skill_root, &format!("{}: refine update", skill_name)) {
            Ok(Some(new_sha)) => {
                log::info!(
                    "[finalize_refine_run] backend committed refine changes skill={} sha={}",
                    skill_name,
                    &new_sha[..8.min(new_sha.len())]
                );
                commit_sha = Some(new_sha);
                head_unchanged = false;
            }
            Ok(None) => {}
            Err(e) => {
                log::warn!(
                    "[finalize_refine_run] backend scoped commit failed skill={}: {}",
                    skill_name,
                    e
                );
            }
        }
    }
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

    // Protect name & description frontmatter from agent modifications.
    // If the agent changed these fields, restore them and create a fixup commit
    // so downstream tagging/diffing sees the corrected content.
    let commit_sha = if let Some(pre_sha) = pre_run_sha {
        let skill_md_path = skill_root.join("SKILL.md");
        if skill_md_path.exists() {
            match restore_protected_frontmatter(
                &skill_md_path,
                skills_path,
                plugin_slug,
                skill_name,
                pre_sha,
            ) {
                Ok(true) => {
                    // Re-read HEAD after fixup commit
                    git2::Repository::open(&skill_root).ok().and_then(|repo| {
                        repo.head()
                            .ok()?
                            .peel_to_commit()
                            .ok()
                            .map(|c| c.id().to_string())
                    })
                }
                Ok(false) => commit_sha,
                Err(e) => {
                    log::warn!(
                        "[finalize_refine_run] frontmatter protection failed skill={}: {}",
                        skill_name,
                        e
                    );
                    commit_sha
                }
            }
        } else {
            commit_sha
        }
    } else {
        commit_sha
    };

    // Tag the new commit with the next patch version.
    {
        let current_version = crate::git::latest_skill_semver(&skill_root, plugin_slug, skill_name)
            .unwrap_or_else(|_| "0.0.0".to_string());
        let new_version = crate::git::bump_patch(&current_version);
        match crate::git::create_skill_version_tag(
            &skill_root,
            plugin_slug,
            skill_name,
            &new_version,
        ) {
            Ok(tag_name) => log::info!(
                "[finalize_refine_run] tagged skill={} plugin={} tag={}",
                skill_name,
                plugin_slug,
                tag_name
            ),
            Err(e) => {
                log::warn!(
                "[finalize_refine_run] version tag failed skill={} plugin={} version={} error={}",
                skill_name, plugin_slug, new_version, e
            )
            }
        }
    }

    let diff = if let Some(sha) = commit_sha.as_ref() {
        // Use pre_run_sha as diff base when available — this is correct even when
        // a frontmatter fixup commit was created (otherwise commit.parent(0) would
        // point to the agent commit, showing only the fixup diff, not the full changes).
        let base_sha = if let Some(pre) = pre_run_sha {
            Some(pre.to_string())
        } else {
            let repo = git2::Repository::open(&skill_root)
                .map_err(|e| format!("Failed to open repo: {}", e))?;
            let commit = repo
                .find_commit(
                    git2::Oid::from_str(sha).map_err(|e| format!("Invalid SHA {}: {}", sha, e))?,
                )
                .map_err(|e| format!("Commit {} not found: {}", sha, e))?;
            commit.parent(0).ok().map(|parent| parent.id().to_string())
        };

        if let Some(base_sha) = base_sha {
            get_refine_diff_for_commit_range_inner(
                skill_name,
                skill_root.to_str().unwrap_or(skills_path),
                plugin_slug,
                &base_sha,
                sha,
            )?
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
        build_mock_refine_diff(plugin_slug, skill_name, &files)
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
    plugin_slug: String,
    workspace_path: String,
    db: tauri::State<'_, Db>,
) -> Result<(), String> {
    log::info!(
        "[clean_benchmark_snapshot] skill={} plugin={}",
        skill_name,
        plugin_slug
    );
    validate_skill_name(&skill_name)?;
    let plugin_slug = super::resolve_skill_plugin_slug(&db, &skill_name)
        .unwrap_or_else(|_| crate::skill_paths::DEFAULT_PLUGIN_SLUG.to_string());
    let workspace_skill_root =
        resolve_workspace_skill_dir(Path::new(&workspace_path), &plugin_slug, &skill_name);
    cleanup_skill_snapshot(&workspace_skill_root);
    Ok(())
}

#[tauri::command]
pub fn finalize_refine_run(
    skill_name: String,
    plugin_slug: String,
    workspace_path: String,
    structured_output: Option<serde_json::Value>,
    db: tauri::State<'_, Db>,
    sessions: tauri::State<'_, super::RefineSessionManager>,
) -> Result<RefineFinalizeResult, String> {
    log::info!(
        "[finalize_refine_run] skill={} plugin={}",
        skill_name,
        plugin_slug
    );
    validate_skill_name(&skill_name)?;
    let skills_path = resolve_skills_path(&db).map_err(|e| {
        log::error!("[finalize_refine_run] Failed to resolve skills path: {}", e);
        e
    })?;
    let plugin_slug = resolve_skill_plugin_slug(&db, &skill_name).map_err(|e| {
        log::error!("[finalize_refine_run] Failed to resolve plugin slug: {}", e);
        e
    })?;

    // Look up the session's pre-run HEAD SHA to detect no-op turns.
    let pre_run_sha = sessions.0.lock().ok().and_then(|map| {
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
