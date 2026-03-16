use std::path::Path;

use crate::commands::imported_skills::validate_skill_name;
use crate::db::Db;
use crate::types::{RefineDiff, RefineFinalizeResult};

use super::content::get_skill_content_inner;
use super::diff::get_refine_diff_for_commit_range_inner;
use super::resolve_skills_path;

// ─── Output materialization ──────────────────────────────────────────────────

pub(crate) fn materialize_refine_validation_output_value(
    workspace_skill_root: &Path,
    structured_output: &serde_json::Value,
) -> Result<(), String> {
    let payload = structured_output
        .as_object()
        .ok_or_else(|| "structured_output must be a JSON object".to_string())?;

    let status = payload
        .get("status")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "structured_output.status must be a string".to_string())?;
    if status != "validation_complete" {
        return Err(format!(
            "structured_output.status must be 'validation_complete' but got '{}'",
            status
        ));
    }

    let require_markdown = |field: &str| -> Result<&str, String> {
        let value = payload
            .get(field)
            .and_then(|v| v.as_str())
            .ok_or_else(|| format!("structured_output.{} must be a string", field))?;
        if value.trim().is_empty() {
            return Err(format!("structured_output.{} must not be empty", field));
        }
        Ok(value)
    };

    let validation_log = require_markdown("validation_log_markdown")?;
    let test_results = require_markdown("test_results_markdown")?;

    let context_dir = workspace_skill_root.join("context");
    std::fs::create_dir_all(&context_dir).map_err(|e| {
        format!(
            "Failed to create context directory '{}': {}",
            context_dir.display(),
            e
        )
    })?;

    let validation_path = context_dir.join("agent-validation-log.md");
    std::fs::write(&validation_path, validation_log).map_err(|e| {
        format!(
            "Failed to write validation log '{}': {}",
            validation_path.display(),
            e
        )
    })?;

    let test_path = context_dir.join("test-skill.md");
    std::fs::write(&test_path, test_results).map_err(|e| {
        format!(
            "Failed to write test results '{}': {}",
            test_path.display(),
            e
        )
    })?;

    Ok(())
}

pub(crate) fn finalize_refine_run_inner(
    skill_name: &str,
    skills_path: &str,
    workspace_path: &str,
    structured_output: Option<&serde_json::Value>,
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

    if let Some(payload) = structured_output {
        let is_validation_output = payload
            .get("status")
            .and_then(|v| v.as_str())
            .map(|s| s == "validation_complete")
            .unwrap_or(false);
        if is_validation_output {
            materialize_refine_validation_output_value(&workspace_skill_root, payload)?;
        }
    }

    let commit_msg = format!("{}: refine", skill_name);
    let commit_sha = crate::git::commit_all(Path::new(skills_path), &commit_msg)?;

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
pub fn materialize_refine_validation_output(
    skill_name: String,
    workspace_path: String,
    structured_output: serde_json::Value,
) -> Result<(), String> {
    log::info!(
        "[materialize_refine_validation_output] skill={}",
        skill_name
    );
    let workspace_skill_root = Path::new(&workspace_path).join(&skill_name);
    materialize_refine_validation_output_value(&workspace_skill_root, &structured_output)
        .map_err(|e| {
            log::error!("[materialize_refine_validation_output] skill={} error={}", skill_name, e);
            e
        })
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
