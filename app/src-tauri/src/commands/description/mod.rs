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

const DESC_EVALS_PROMPT_TEMPLATE: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../agent-sources/workspace/prompts/skill-description-evals-generator.md"
));

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
    pool: tauri::State<'_, SidecarPool>,
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
        let raw_key = settings
            .anthropic_api_key
            .ok_or_else(|| "Anthropic API key not configured".to_string())?;
        crate::types::SecretString::new(raw_key)
    };

    // Resolve skill path
    let skills_path = super::refine::resolve_skills_path(&db)?;
    let skill_path =
        crate::skill_paths::resolve_skill_dir(Path::new(&skills_path), &plugin_slug, &skill_name);

    // Create cancel flag and store in managed state
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut guard = process_state.0.lock().map_err(|e| e.to_string())?;
        *guard = Some(cancel.clone());
    }

    let resolved_model = if model.trim().is_empty() {
        return Err(
            "Model not configured. Select a model in Settings before optimizing descriptions."
                .to_string(),
        );
    } else {
        model
    };

    // Build log directory for file-based logging
    let log_dir = crate::skill_paths::workspace_skill_dir(
        Path::new(&workspace_path),
        &plugin_slug,
        &skill_name,
    )
    .join("description-optimization")
    .join("logs");

    // Run the optimization loop in Rust (sidecar-based eval)
    let result = loop_runner::run_loop(
        eval_queries,
        &skill_path,
        Path::new(&workspace_path),
        &plugin_slug,
        &skill_name,
        &resolved_model,
        &api_key,
        cancel,
        &app,
        pool.inner().clone(),
        &log_dir,
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
pub(crate) fn write_eval_queries_to_file(path: &Path, queries: &[EvalQuery]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| {
            format!(
                "Failed to create directory for description-evals.json: {}",
                e
            )
        })?;
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
        skill_name,
        plugin_slug,
        eval_queries.len()
    );
    let path = crate::skill_paths::workspace_skill_dir(
        Path::new(&workspace_path),
        &plugin_slug,
        &skill_name,
    )
    .join("description-optimization")
    .join("description-evals.json");
    write_eval_queries_to_file(&path, &eval_queries)
}

/// Read eval queries from `path`. Returns an empty list if the file does not exist.
/// Pure function — no DB access. Callers resolve the target path.
pub(crate) fn read_eval_queries_from_file(path: &Path) -> Result<Vec<EvalQuery>, String> {
    if !path.is_file() {
        return Ok(vec![]);
    }
    let content = std::fs::read_to_string(path)
        .map_err(|e| format!("Failed to read description-evals.json: {}", e))?;
    serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse description-evals.json: {}", e))
}

#[tauri::command]
pub fn load_eval_queries(
    skill_name: String,
    plugin_slug: String,
    workspace_path: String,
) -> Result<Vec<EvalQuery>, String> {
    log::info!(
        "[load_eval_queries] skill={} plugin={}",
        skill_name,
        plugin_slug
    );
    let path = crate::skill_paths::workspace_skill_dir(
        Path::new(&workspace_path),
        &plugin_slug,
        &skill_name,
    )
    .join("description-optimization")
    .join("description-evals.json");
    read_eval_queries_from_file(&path)
}

/// Returns the new semver tag (e.g. "1.0.3") so the frontend can update
/// the skill store and trigger a git history refresh in the Overview tab.
#[tauri::command]
pub async fn apply_description(
    skill_name: String,
    plugin_slug: String,
    _workspace_path: String,
    description: String,
    db: tauri::State<'_, crate::db::Db>,
) -> Result<String, String> {
    log::info!(
        "[apply_description] skill={} plugin={}",
        skill_name,
        plugin_slug
    );

    let skills_path = super::refine::resolve_skills_path(&db)?;
    apply_description_inner(&skill_name, &plugin_slug, &skills_path, &description)
}

fn apply_description_inner(
    skill_name: &str,
    plugin_slug: &str,
    skills_path: &str,
    description: &str,
) -> Result<String, String> {
    let skills_root = Path::new(skills_path);
    let skill_md_path = crate::skill_paths::resolve_skill_dir(skills_root, plugin_slug, skill_name)
        .join("SKILL.md");

    let content = std::fs::read_to_string(&skill_md_path).map_err(|e| {
        log::error!("[apply_description] failed to read SKILL.md: {}", e);
        format!("Failed to read SKILL.md: {}", e)
    })?;

    let current_version = crate::git::latest_skill_semver(skills_root, plugin_slug, skill_name)
        .unwrap_or_else(|_| "0.0.0".to_string());
    let current_description =
        crate::commands::imported_skills::parse_frontmatter_full(&content).description;
    if current_description.as_deref() == Some(description) {
        log::info!(
            "[apply_description] description unchanged for skill={}",
            skill_name
        );
        return Ok(current_version);
    }

    let updated = update_skill_description(&content, description)?;

    std::fs::write(&skill_md_path, updated).map_err(|e| {
        log::error!("[apply_description] failed to write SKILL.md: {}", e);
        format!("Failed to write SKILL.md: {}", e)
    })?;

    // Commit the description change so it appears in the git version history.
    let commit_msg = format!("Update {} description via optimization", skill_name);
    let relative_skill_path = Path::new(plugin_slug).join(skill_name);
    match crate::git::commit_path(skills_root, &relative_skill_path, &commit_msg) {
        Ok(Some(sha)) => {
            log::info!(
                "[apply_description] committed skill={} sha={}",
                skill_name,
                &sha[..8.min(sha.len())]
            );
        }
        Ok(None) => {
            log::info!(
                "[apply_description] nothing to commit for skill={}",
                skill_name
            );
            return Ok(current_version);
        }
        Err(e) => {
            log::error!(
                "[apply_description] commit failed skill={} error={}",
                skill_name,
                e
            );
            return Err(format!("Failed to commit description update: {}", e));
        }
    }

    // Tag the new commit with the next patch version.
    let new_version = crate::git::bump_patch(&current_version);
    match crate::git::create_skill_version_tag(skills_root, plugin_slug, skill_name, &new_version) {
        Ok(tag) => log::info!(
            "[apply_description] tagged skill={} tag={}",
            skill_name,
            tag
        ),
        Err(e) => {
            log::error!(
                "[apply_description] tag failed skill={} error={}",
                skill_name,
                e
            );
            return Err(format!("Failed to tag description update: {}", e));
        }
    }

    Ok(new_version)
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
pub(crate) fn update_skill_description(content: &str, description: &str) -> Result<String, String> {
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
        agent_id,
        skill_name,
        plugin_slug,
        num_eval_queries
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
    let desc_opt_log_dir = ws_skill_dir
        .join("description-optimization")
        .join("logs")
        .to_string_lossy()
        .into_owned();
    let system_prompt = DESC_EVALS_PROMPT_TEMPLATE
        .replace("{{skill_name}}", &skill_name)
        .replace("{{skill_path}}", &skill_path_fwd)
        .replace("{{workspace_skill_dir}}", &ws_skill_dir_fwd)
        .replace("{{num_queries}}", &num_eval_queries.to_string());
    let user_prompt = format!(
        "Generate {} trigger eval queries for skill \"{}\".",
        num_eval_queries, skill_name
    );

    let (api_key, extended_thinking, interleaved_thinking_beta, sdk_effort) = {
        let conn = db.0.lock().map_err(|e| {
            log::error!(
                "[start_generate_desc_evals] Failed to acquire DB lock: {}",
                e
            );
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
        )
    };

    let thinking_budget: Option<u32> = if extended_thinking {
        Some(16_000)
    } else {
        None
    };
    let thinking =
        thinking_budget.map(|b| serde_json::json!({ "type": "enabled", "budgetTokens": b }));
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
        mode: Some("one-shot".to_string()),
        prompt: user_prompt,
        system_prompt: Some(system_prompt),
        model: Some(model.clone()),
        llm: None,
        model_base_url: None,
        api_key,
        workspace_root_dir: workspace_skill_dir.clone(),
        workspace_skill_dir,
        allowed_tools: Some(vec!["Read".to_string(), "Skill".to_string()]),
        max_turns: Some(50),
        permission_mode: None,
        betas: crate::commands::workflow::build_betas(
            thinking_budget,
            &model,
            interleaved_thinking_beta,
        ),
        thinking,
        fallback_model: None,
        effort: sdk_effort,
        output_format,
        prompt_suggestions: None,
        path_to_claude_code_executable: None,
        path_to_openhands_runner: None,
        required_plugins: Some(vec!["skill-creator".to_string()]),
        agent_name: None,
        setting_sources: Some(vec![]),
        conversation_history: None,
        skill_name: Some(skill_name.clone()),
        step_id: Some(-12),
        workflow_session_id: None,
        usage_session_id: None,
        run_source: Some("workflow".to_string()),
        plugin_slug,
        transcript_log_dir: Some(desc_opt_log_dir.clone()),
        runtime_provider: None,
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

/// Append a frontend log message to `desc-opt-frontend-{date}.log`.
/// Called from the frontend to capture UI-side events alongside backend logs.
#[tauri::command]
pub fn write_desc_opt_log(
    skill_name: String,
    plugin_slug: String,
    workspace_path: String,
    message: String,
) -> Result<(), String> {
    let log_dir = crate::skill_paths::workspace_skill_dir(
        Path::new(&workspace_path),
        &plugin_slug,
        &skill_name,
    )
    .join("description-optimization")
    .join("logs");

    let _ = std::fs::create_dir_all(&log_dir);
    let date = chrono::Local::now().format("%Y-%m-%d");
    let log_file = log_dir.join(format!("desc-opt-frontend-{}.log", date));
    let timestamp = chrono::Local::now().format("%Y-%m-%dT%H:%M:%S%.3f");

    use std::io::Write;
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_file)
    {
        let _ = writeln!(f, "[{}] {}", timestamp, message);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    // ── eval query persistence (VU-924) ──────────────────────────────────

    #[test]
    fn eval_queries_round_trip() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("description-evals.json");
        let queries = vec![
            EvalQuery {
                query: "help me with X".to_string(),
                should_trigger: true,
            },
            EvalQuery {
                query: "do something unrelated".to_string(),
                should_trigger: false,
            },
        ];
        write_eval_queries_to_file(&path, &queries).unwrap();
        let loaded = read_eval_queries_from_file(&path).unwrap();
        assert_eq!(loaded.len(), 2);
        assert_eq!(loaded[0].query, "help me with X");
        assert!(loaded[0].should_trigger);
        assert_eq!(loaded[1].query, "do something unrelated");
        assert!(!loaded[1].should_trigger);
    }

    #[test]
    fn load_returns_empty_when_file_missing() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("nonexistent.json");
        let result = read_eval_queries_from_file(&path).unwrap();
        assert!(
            result.is_empty(),
            "Expected empty vec for missing file, got {:?}",
            result
        );
    }

    #[test]
    fn save_overwrites_previous_queries() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("description-evals.json");
        let first = vec![EvalQuery {
            query: "first".to_string(),
            should_trigger: true,
        }];
        let second = vec![
            EvalQuery {
                query: "second-a".to_string(),
                should_trigger: false,
            },
            EvalQuery {
                query: "second-b".to_string(),
                should_trigger: true,
            },
        ];
        write_eval_queries_to_file(&path, &first).unwrap();
        write_eval_queries_to_file(&path, &second).unwrap();
        let loaded = read_eval_queries_from_file(&path).unwrap();
        assert_eq!(
            loaded.len(),
            2,
            "Expected exactly 2 queries after overwrite"
        );
        assert_eq!(loaded[0].query, "second-a");
        assert!(
            !loaded.iter().any(|q| q.query == "first"),
            "Original query should not appear after overwrite"
        );
    }

    #[test]
    fn atomic_write_preserves_original_on_failure() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("description-evals.json");

        // Write initial valid data
        let original = vec![EvalQuery {
            query: "original".to_string(),
            should_trigger: true,
        }];
        write_eval_queries_to_file(&path, &original).unwrap();

        // Block the .tmp path by creating a directory with that name so the write fails
        let tmp_path = path.with_extension("json.tmp");
        std::fs::create_dir(&tmp_path).unwrap();

        // Attempt a new write — must fail because .tmp is a directory
        let replacement = vec![EvalQuery {
            query: "replacement".to_string(),
            should_trigger: false,
        }];
        let result = write_eval_queries_to_file(&path, &replacement);
        assert!(
            result.is_err(),
            "Expected write to fail when .tmp path is a directory"
        );

        // Original file must be intact
        let loaded = read_eval_queries_from_file(&path).unwrap();
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].query, "original");
    }

    // ── update_skill_description (existing) ──────────────────────────────

    #[test]
    fn update_skill_description_replaces_existing() {
        let content =
            "---\nname: My Skill\ndescription: old description\nauthor: dev\n---\n# Body\n";
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

    #[test]
    fn apply_description_commits_skill_path_and_tags_new_version() {
        let dir = TempDir::new().unwrap();
        let plugin = crate::skill_paths::DEFAULT_PLUGIN_SLUG;
        crate::git::ensure_repo(dir.path()).unwrap();

        let skill_dir = dir.path().join(plugin).join("desc-skill");
        std::fs::create_dir_all(&skill_dir).unwrap();
        std::fs::write(
            skill_dir.join("SKILL.md"),
            "---\nname: desc-skill\ndescription: old\n---\n# Body\n",
        )
        .unwrap();
        crate::git::commit_all(dir.path(), "desc-skill: initial").unwrap();
        crate::git::create_skill_version_tag(dir.path(), plugin, "desc-skill", "1.0.0").unwrap();

        let new_version = apply_description_inner(
            "desc-skill",
            plugin,
            dir.path().to_str().unwrap(),
            "new optimized description",
        )
        .unwrap();

        assert_eq!(new_version, "1.0.1");
        let content = std::fs::read_to_string(skill_dir.join("SKILL.md")).unwrap();
        assert!(content.contains("description: \"new optimized description\""));
        assert_eq!(
            crate::git::latest_skill_semver(dir.path(), plugin, "desc-skill").unwrap(),
            "1.0.1"
        );

        let history = crate::git::get_history(dir.path(), "desc-skill", plugin, 10).unwrap();
        assert_eq!(history[0].version.as_deref(), Some("1.0.1"));
        assert_eq!(
            history[0].message,
            "Update desc-skill description via optimization"
        );
    }

    #[test]
    fn apply_description_does_not_tag_when_description_is_unchanged() {
        let dir = TempDir::new().unwrap();
        let plugin = crate::skill_paths::DEFAULT_PLUGIN_SLUG;
        crate::git::ensure_repo(dir.path()).unwrap();

        let skill_dir = dir.path().join(plugin).join("same-desc");
        std::fs::create_dir_all(&skill_dir).unwrap();
        std::fs::write(
            skill_dir.join("SKILL.md"),
            "---\nname: same-desc\ndescription: same\n---\n# Body\n",
        )
        .unwrap();
        crate::git::commit_all(dir.path(), "same-desc: initial").unwrap();
        crate::git::create_skill_version_tag(dir.path(), plugin, "same-desc", "1.0.0").unwrap();

        let new_version =
            apply_description_inner("same-desc", plugin, dir.path().to_str().unwrap(), "same")
                .unwrap();

        assert_eq!(new_version, "1.0.0");
        let history = crate::git::get_history(dir.path(), "same-desc", plugin, 10).unwrap();
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].version.as_deref(), Some("1.0.0"));
    }
}
