mod eval;
mod improve;
mod loop_runner;

use crate::agents::sidecar::{self, SidecarConfig};
use crate::agents::sidecar_pool::SidecarPool;
use crate::db::Db;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

const DESC_EVALS_PROMPT_TEMPLATE: &str = include_str!(
    "../../../../../agent-sources/workspace/prompts/skill-description-evals-generator.md"
);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvalQuery {
    pub query: String,
    pub should_trigger: bool,
}

/// Tracks the running optimization cancel flag.
/// Only one optimization runs at a time.
pub struct DescriptionProcessState(pub Mutex<Option<Arc<AtomicBool>>>);

impl DescriptionProcessState {
    pub fn new() -> Self {
        Self(Mutex::new(None))
    }
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn run_optimization_loop(
    skill_name: String,
    plugin_slug: String,
    workspace_path: String,
    model: String,
    eval_queries: Vec<EvalQuery>,
    process_state: tauri::State<'_, DescriptionProcessState>,
    db: tauri::State<'_, crate::db::Db>,
    app: tauri::AppHandle,
) -> Result<serde_json::Value, String> {
    log::info!(
        "[run_optimization_loop] skill={} plugin={} queries={}",
        skill_name,
        plugin_slug,
        eval_queries.len()
    );

    // Read API key from settings
    let api_key = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let settings = crate::db::read_settings(&conn)?;
        settings
            .anthropic_api_key
            .ok_or_else(|| "Anthropic API key not configured".to_string())?
    };

    // Resolve skill path
    let skills_path = super::refine::resolve_skills_path(&db)?;
    let skill_path = crate::skill_paths::resolve_skill_dir(
        Path::new(&skills_path),
        &plugin_slug,
        &skill_name,
    );

    // Create cancel flag and store in managed state
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut guard = process_state.0.lock().map_err(|e| e.to_string())?;
        *guard = Some(cancel.clone());
    }

    // Run the optimization loop in Rust (no Python subprocess)
    let result = loop_runner::run_loop(
        eval_queries,
        &skill_path,
        Path::new(&workspace_path),
        &model,
        &api_key,
        cancel,
        &app,
    )
    .await;

    // Clear state regardless of outcome
    {
        let mut guard = process_state.0.lock().map_err(|e| e.to_string())?;
        *guard = None;
    }

    result
}

/// Atomically write eval queries to `path` (tmp + rename).
/// Pure function — no DB access. Callers resolve the target path.
pub(crate) fn write_eval_queries_to_file(
    path: &Path,
    queries: &[EvalQuery],
) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directory for description-evals.json: {}", e))?;
    }
    let json = serde_json::to_string_pretty(queries)
        .map_err(|e| format!("Failed to serialize eval queries: {}", e))?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, &json)
        .map_err(|e| format!("Failed to write description-evals.json: {}", e))?;
    std::fs::rename(&tmp, path)
        .map_err(|e| format!("Failed to finalize description-evals.json: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn save_eval_queries(
    skill_name: String,
    plugin_slug: String,
    workspace_path: String,
    eval_queries: Vec<EvalQuery>,
) -> Result<(), String> {
    log::info!(
        "[save_eval_queries] skill={} plugin={} count={}",
        skill_name, plugin_slug,
        eval_queries.len()
    );
    let path = crate::skill_paths::workspace_skill_dir(
        Path::new(&workspace_path), &plugin_slug, &skill_name,
    ).join("description-optimization").join("description-evals.json");
    write_eval_queries_to_file(&path, &eval_queries)
}

#[tauri::command]
pub fn load_eval_queries(
    skill_name: String,
    plugin_slug: String,
    workspace_path: String,
) -> Result<Vec<EvalQuery>, String> {
    log::info!("[load_eval_queries] skill={} plugin={}", skill_name, plugin_slug);
    let path = crate::skill_paths::workspace_skill_dir(
        Path::new(&workspace_path), &plugin_slug, &skill_name,
    ).join("description-optimization").join("description-evals.json");
    if !path.is_file() {
        return Ok(vec![]);
    }
    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read description-evals.json: {}", e))?;
    serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse description-evals.json: {}", e))
}

#[tauri::command]
pub async fn apply_description(
    skill_name: String,
    plugin_slug: String,
    _workspace_path: String,
    description: String,
    db: tauri::State<'_, crate::db::Db>,
) -> Result<(), String> {
    log::info!("[apply_description] skill={} plugin={}", skill_name, plugin_slug);

    let skills_path = super::refine::resolve_skills_path(&db)?;
    let skill_md_path = crate::skill_paths::resolve_skill_dir(
        Path::new(&skills_path), &plugin_slug, &skill_name,
    ).join("SKILL.md");

    let content = std::fs::read_to_string(&skill_md_path).map_err(|e| {
        log::error!("[apply_description] failed to read SKILL.md: {}", e);
        format!("Failed to read SKILL.md: {}", e)
    })?;

    let updated = update_skill_description(&content, &description)?;

    std::fs::write(&skill_md_path, updated).map_err(|e| {
        log::error!("[apply_description] failed to write SKILL.md: {}", e);
        format!("Failed to write SKILL.md: {}", e)
    })?;

    Ok(())
}

#[tauri::command]
pub async fn cancel_description_optimization(
    process_state: tauri::State<'_, DescriptionProcessState>,
) -> Result<(), String> {
    log::info!("[cancel_description_optimization] cancelling running optimization");
    let mut guard = process_state.0.lock().map_err(|e| e.to_string())?;
    if let Some(flag) = guard.take() {
        flag.store(true, Ordering::SeqCst);
        log::info!("[cancel_description_optimization] cancel flag set");
    } else {
        log::debug!("[cancel_description_optimization] no running optimization to cancel");
    }
    Ok(())
}

/// Replace or insert the `description:` field in SKILL.md YAML frontmatter.
fn update_skill_description(content: &str, description: &str) -> Result<String, String> {
    // Normalize CRLF
    let content = content.replace("\r\n", "\n");

    if !content.starts_with("---") {
        return Err("SKILL.md is missing YAML frontmatter (does not start with ---)".to_string());
    }

    // Find the closing \n---
    let after_first = &content[3..];
    let end_pos = after_first
        .find("\n---")
        .ok_or_else(|| "SKILL.md has an unclosed YAML frontmatter block".to_string())?;

    let yaml_block = &after_first[..end_pos];
    // body_part is everything from closing --- onwards (including the \n--- itself)
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

        // Skip continuation lines of a folded scalar description
        if skip_continuation {
            if is_indented && !trimmed.is_empty() {
                continue;
            }
            skip_continuation = false;
        }

        if !is_indented && trimmed.starts_with("description:") {
            // Check if folded scalar (description: > or description: |)
            let val = trimmed["description:".len()..].trim();
            if val == ">" || val == "|" || val == ">-" || val == "|-" {
                skip_continuation = true;
            }
            new_yaml.push(new_description_line.clone());
            found_description = true;
            continue;
        }

        new_yaml.push(line.to_string());

        // If this is the name: line and we haven't found description yet,
        // note the position to insert after (we'll insert at end if name found)
        if !is_indented && trimmed.starts_with("name:") {
            found_name = true;
        }
    }

    if !found_description {
        // Insert after name: line if present, otherwise at beginning of yaml block
        if found_name {
            // Find position of name: line in new_yaml and insert after it
            let pos = new_yaml
                .iter()
                .position(|l| l.trim().starts_with("name:"))
                .map(|i| i + 1)
                .unwrap_or(0);
            new_yaml.insert(pos, new_description_line);
        } else {
            new_yaml.insert(0, new_description_line);
        }
    }

    Ok(format!("---\n{}{}", new_yaml.join("\n"), body_part))
}

/// Spawn the description-evals generator agent.
/// Builds the system prompt from the compiled template — system prompt never surfaces to the frontend.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn start_generate_desc_evals(
    app: tauri::AppHandle,
    pool: tauri::State<'_, SidecarPool>,
    db: tauri::State<'_, Db>,
    agent_id: String,
    skill_name: String,
    plugin_slug: String,
    workspace_skill_dir: String,
    model: String,
    num_eval_queries: u32,
) -> Result<String, String> {
    log::info!(
        "[start_generate_desc_evals] agent_id={} skill={} plugin={} num_queries={}",
        agent_id, skill_name, plugin_slug, num_eval_queries
    );

    let skills_path = super::refine::resolve_skills_path(&db)?;
    let skill_path_fwd = crate::skill_paths::resolve_skill_dir(
        std::path::Path::new(&skills_path),
        &plugin_slug,
        &skill_name,
    )
    .to_string_lossy()
    .replace('\\', "/");
    // user-context.md lives in the workspace skill dir (AppData), not the skills_path dir
    let ws_skill_dir = crate::skill_paths::workspace_skill_dir(
        std::path::Path::new(&workspace_skill_dir),
        &plugin_slug,
        &skill_name,
    );
    let ws_skill_dir_fwd = ws_skill_dir.to_string_lossy().replace('\\', "/");
    // Transcript logs go into description-optimization/logs/ for easy investigation
    let desc_opt_log_dir = ws_skill_dir.join("description-optimization").join("logs").to_string_lossy().into_owned();
    let system_prompt = DESC_EVALS_PROMPT_TEMPLATE
        .replace("{{skill_name}}", &skill_name)
        .replace("{{skill_path}}", &skill_path_fwd)
        .replace("{{workspace_skill_dir}}", &ws_skill_dir_fwd)
        .replace("{{num_queries}}", &num_eval_queries.to_string());
    let user_prompt = format!(
        "Generate {} trigger eval queries for skill \"{}\".",
        num_eval_queries, skill_name
    );

    let (api_key, extended_thinking, interleaved_thinking_beta, sdk_effort, fallback_model) = {
        let conn = db.0.lock().map_err(|e| {
            log::error!("[start_generate_desc_evals] Failed to acquire DB lock: {}", e);
            e.to_string()
        })?;
        let settings = crate::db::read_settings(&conn)?;
        let key = match settings.anthropic_api_key {
            Some(k) => crate::types::SecretString::new(k),
            None => return Err("Anthropic API key not configured".to_string()),
        };
        (
            key,
            settings.extended_thinking,
            settings.interleaved_thinking_beta,
            settings.sdk_effort.clone(),
            settings.fallback_model.clone(),
        )
    };

    let thinking_budget: Option<u32> = if extended_thinking { Some(16_000) } else { None };
    let thinking = thinking_budget.map(|b| serde_json::json!({ "type": "enabled", "budgetTokens": b }));
    let fallback_model =
        crate::commands::agent::suppress_same_fallback_model(Some(&model), fallback_model);

    let output_format = Some(serde_json::json!({
        "type": "json_schema",
        "schema": {
            "type": "object",
            "required": ["status", "queries"],
            "properties": {
                "status": { "type": "string", "enum": ["generated"] },
                "queries": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "required": ["query", "should_trigger"],
                        "properties": {
                            "query": { "type": "string" },
                            "should_trigger": { "type": "boolean" }
                        },
                        "additionalProperties": false
                    }
                }
            },
            "additionalProperties": false
        }
    }));

    let config = SidecarConfig {
        prompt: user_prompt,
        system_prompt: Some(system_prompt),
        model: Some(model.clone()),
        api_key,
        workspace_root_dir: workspace_skill_dir.clone(),
        workspace_skill_dir,
        allowed_tools: Some(vec!["Read".to_string(), "Skill".to_string()]),
        max_turns: Some(50),
        permission_mode: None,
        betas: crate::commands::workflow::build_betas(thinking_budget, &model, interleaved_thinking_beta),
        thinking,
        fallback_model,
        effort: sdk_effort,
        output_format,
        prompt_suggestions: None,
        path_to_claude_code_executable: None,
        required_plugins: Some(vec!["skill-creator".to_string()]),
        agent_name: None,
        setting_sources: Some(vec![]),
        conversation_history: None,
        skill_name: Some(skill_name.clone()),
        step_id: Some(-12),
        workflow_session_id: None,
        usage_session_id: None,
        run_source: Some("workflow".to_string()),
        plugin_slug: Some(plugin_slug),
        transcript_log_dir: Some(desc_opt_log_dir.clone()),
    };

    sidecar::spawn_sidecar(
        agent_id.clone(),
        config,
        pool.inner().clone(),
        app,
        skill_name,
        Some(desc_opt_log_dir),
    )
    .await?;
    Ok(agent_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn update_skill_description_replaces_existing() {
        let content = "---\nname: My Skill\ndescription: old description\nauthor: dev\n---\n# Body\n";
        let result = update_skill_description(content, "new description").unwrap();
        assert!(
            result.contains("description: \"new description\""),
            "Expected updated description, got: {}",
            result
        );
        assert!(
            !result.contains("old description"),
            "Old description should be removed"
        );
        assert!(result.contains("name: My Skill"), "name field preserved");
        assert!(result.contains("author: dev"), "author field preserved");
        assert!(result.contains("# Body"), "body preserved");
    }

    #[test]
    fn update_skill_description_handles_folded_scalar() {
        let content =
            "---\nname: Folded\ndescription: >\n  This is a long\n  multi-line description.\nauthor: dev\n---\n# Body\n";
        let result = update_skill_description(content, "compact replacement").unwrap();
        assert!(
            result.contains("description: \"compact replacement\""),
            "Expected replacement, got: {}",
            result
        );
        assert!(
            !result.contains("This is a long"),
            "Old folded content should be removed"
        );
        assert!(result.contains("author: dev"), "author field preserved");
    }

    #[test]
    fn update_skill_description_inserts_when_missing() {
        let content = "---\nname: No Desc\nauthor: dev\n---\n# Body\n";
        let result = update_skill_description(content, "inserted description").unwrap();
        assert!(
            result.contains("description: \"inserted description\""),
            "Expected inserted description, got: {}",
            result
        );
        // description should come after name:
        let name_pos = result.find("name:").unwrap();
        let desc_pos = result.find("description:").unwrap();
        assert!(
            desc_pos > name_pos,
            "description should be inserted after name"
        );
        assert!(result.contains("author: dev"), "author field preserved");
    }
}
