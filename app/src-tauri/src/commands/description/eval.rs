use crate::agents::sidecar::SidecarConfig;
use crate::agents::sidecar_pool::SidecarPool;
use crate::types::SecretString;
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use tauri::Listener;
use tokio::sync::Semaphore;
use tokio::task::JoinSet;

// ─── Types ──────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct EvalResult {
    pub query: String,
    pub should_trigger: bool,
    pub trigger_rate: f64,
    pub triggers: u32,
    pub runs: u32,
    pub pass: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct EvalSummary {
    pub total: usize,
    pub passed: usize,
    pub failed: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct EvalResults {
    pub results: Vec<EvalResult>,
    pub summary: EvalSummary,
}

// ─── Eval sandbox helpers ───────────────────────────────────────────────────

/// Root for eval command files:
/// `{workspace}/description-optimization/eval-commands/`
pub(super) fn eval_commands_root(workspace_path: &Path) -> PathBuf {
    workspace_path
        .join("description-optimization")
        .join("eval-commands")
}

/// Write a temporary slash command file for a single eval run.
///
/// Creates `{eval_commands_root}/.claude/commands/{temp_cmd_name}.md` with the
/// candidate description in the YAML frontmatter. Returns the path so the
/// caller can delete it after the run completes.
fn write_eval_command_file(
    eval_cmds_root: &Path,
    temp_cmd_name: &str,
    skill_name: &str,
    description: &str,
) -> Result<PathBuf, String> {
    let cmd_dir = eval_cmds_root.join(".claude").join("commands");
    std::fs::create_dir_all(&cmd_dir)
        .map_err(|e| format!("Failed to create eval commands dir: {}", e))?;

    // Indent each line for YAML block scalar
    let indented = description
        .lines()
        .map(|line| format!("  {}", line))
        .collect::<Vec<_>>()
        .join("\n");

    let content = format!("---\ndescription: |\n{}\n---\n\n# {}\n", indented, skill_name);

    let cmd_file = cmd_dir.join(format!("{}.md", temp_cmd_name));
    std::fs::write(&cmd_file, &content)
        .map_err(|e| format!("Failed to write eval command file: {}", e))?;

    log::debug!(
        "[eval] Wrote eval command file: {} desc_len={}",
        cmd_file.display(),
        description.len()
    );
    Ok(cmd_file)
}

// ─── Trigger detection ───────────────────────────────────────────────────────

/// Detect whether an `agent-message` event payload contains a `Skill` tool_use
/// from the given `agent_id`.
///
/// Expected payload shape:
/// ```json
/// {
///   "agent_id": "eval-...",
///   "message": {
///     "type": "display_item",
///     "item": { "type": "tool_call", "toolName": "Skill", ... }
///   }
/// }
/// ```
fn is_skill_triggered_for_agent(payload: &str, agent_id: &str) -> bool {
    // Fast-path: skip JSON parse if agent_id not in payload at all
    if !payload.contains(agent_id) {
        return false;
    }
    let Ok(outer) = serde_json::from_str::<serde_json::Value>(payload) else {
        return false;
    };
    if outer.get("agent_id").and_then(|v| v.as_str()) != Some(agent_id) {
        return false;
    }
    let Some(msg) = outer.get("message") else {
        return false;
    };
    if msg.get("type").and_then(|t| t.as_str()) != Some("display_item") {
        return false;
    }
    let Some(item) = msg.get("item") else {
        return false;
    };
    if item.get("type").and_then(|t| t.as_str()) != Some("tool_call") {
        return false;
    }
    item.get("toolName").and_then(|t| t.as_str()) == Some("Skill")
}

// ─── Worker key ─────────────────────────────────────────────────────────────

/// Persistent sidecar key for eval worker `i`.
/// Each key maps to one Node.js process in the sidecar pool.
fn eval_worker_key(plugin_slug: &str, worker_idx: usize) -> String {
    format!("eval-{}-worker-{}", plugin_slug, worker_idx)
}

/// Global counter for round-robin worker assignment across concurrent tasks.
static EVAL_WORKER_COUNTER: AtomicUsize = AtomicUsize::new(0);

// ─── Single query via sidecar pool ─────────────────────────────────────────

/// Run a single eval query using the sidecar pool.
/// Returns `true` if the Skill tool was invoked (i.e., the skill was triggered).
///
/// Uses Tauri event listeners to detect trigger (`agent-message`) and
/// completion (`agent-exit`) without blocking the sidecar pool.
#[allow(clippy::too_many_arguments)]
async fn run_single_eval_query(
    query: String,
    plugin_slug: &str,
    skill_name: &str,
    workspace_path: &Path,
    model: &str,
    api_key: SecretString,
    app: &tauri::AppHandle,
    pool: &SidecarPool,
    worker_idx: usize,
    timeout_secs: u64,
    transcript_log_dir: &Path,
    description: &str,
) -> bool {
    let agent_id = format!("eval-{}-{}", plugin_slug, uuid::Uuid::new_v4());

    // Write a unique temp command file so the CLI routing engine presents the
    // candidate description to Claude exactly as production routing does.
    let eval_cmds_root = eval_commands_root(workspace_path);
    let short_id = &uuid::Uuid::new_v4().to_string().replace('-', "")[..8];
    let temp_cmd_name = format!("{}-{}", skill_name, short_id);
    let cmd_file_path = match write_eval_command_file(
        &eval_cmds_root,
        &temp_cmd_name,
        skill_name,
        description,
    ) {
        Ok(p) => p,
        Err(e) => {
            log::warn!("[eval] failed to write command file: {}", e);
            return false;
        }
    };

    // One-shot channel: delivers `true` on Skill trigger or `false` on exit/timeout.
    let (tx, rx) = tokio::sync::oneshot::channel::<bool>();
    let tx = Arc::new(Mutex::new(Some(tx)));

    // ── agent-message listener ───────────────────────────────────────────
    let target_id_msg = agent_id.clone();
    let tx_msg = tx.clone();
    let message_listener = app.listen("agent-message", move |event| {
        let payload = event.payload();
        if is_skill_triggered_for_agent(payload, &target_id_msg) {
            if let Ok(mut guard) = tx_msg.lock() {
                if let Some(sender) = guard.take() {
                    let _ = sender.send(true);
                }
            }
        }
    });

    // ── agent-exit listener ──────────────────────────────────────────────
    let target_id_exit = agent_id.clone();
    let tx_exit = tx.clone();
    let exit_listener = app.listen("agent-exit", move |event| {
        let payload = event.payload();
        // Fast-path before JSON parse
        if !payload.contains(target_id_exit.as_str()) {
            return;
        }
        let Ok(exit_val) = serde_json::from_str::<serde_json::Value>(payload) else {
            return;
        };
        if exit_val.get("agent_id").and_then(|v| v.as_str()) != Some(target_id_exit.as_str()) {
            return;
        }
        if let Ok(mut guard) = tx_exit.lock() {
            if let Some(sender) = guard.take() {
                let _ = sender.send(false); // exited without triggering the skill
            }
        }
    });

    // ── Build sidecar config ─────────────────────────────────────────────
    // Forward-slash paths required by the Node.js sidecar on Windows.
    // The SDK uses workspaceSkillDir as the cwd — it auto-discovers .claude/commands/
    // from there. Both workspace_root_dir and workspace_skill_dir must point to
    // eval_commands_root so the SDK finds the temp command file.
    let eval_cmds_root_str = eval_cmds_root.to_string_lossy().replace('\\', "/");
    let _ = std::fs::create_dir_all(&eval_cmds_root);

    // Resolve SDK cli.js so the sidecar can spawn Claude Code agents.
    // Must be done here (not in spawn_sidecar) because we call pool.send_request directly.
    let sdk_cli_path = crate::agents::sidecar::resolve_sdk_cli_path_public(app).ok();

    let transcript_dir_str = transcript_log_dir.to_string_lossy().into_owned();

    let config = SidecarConfig {
        prompt: query.clone(),
        system_prompt: None,
        model: Some(model.to_string()),
        api_key,
        workspace_root_dir: eval_cmds_root_str.clone(),
        // workspace_skill_dir is the cwd the SDK passes to the Claude Code CLI.
        // The CLI reads .claude/commands/ from this directory.
        workspace_skill_dir: eval_cmds_root_str,
        allowed_tools: None,
        max_turns: Some(3),
        permission_mode: Some("bypassPermissions".to_string()),
        betas: None,
        thinking: None,
        fallback_model: None,
        effort: None,
        output_format: None,
        prompt_suggestions: None,
        path_to_claude_code_executable: sdk_cli_path,
        agent_name: None,
        required_plugins: None,
        // Use 'project' setting source so the SDK reads .claude/commands/ from
        // the eval-commands cwd. That dir is isolated — only our temp command
        // file lives there, so no production skills are accidentally loaded.
        setting_sources: Some(vec!["project".to_string()]),
        conversation_history: None,
        skill_name: Some(skill_name.to_string()),
        step_id: Some(-20),
        workflow_session_id: None,
        usage_session_id: None,
        run_source: Some("gate-eval".to_string()),
        plugin_slug: Some(plugin_slug.to_string()),
        transcript_log_dir: Some(transcript_dir_str.clone()),
    };

    let worker_key = eval_worker_key(plugin_slug, worker_idx);
    log::debug!(
        "[eval] query='{}' agent_id={} worker={}",
        &query[..query.len().min(60)],
        agent_id,
        worker_key
    );

    if let Err(e) = pool
        .send_request(&worker_key, &agent_id, config, app, Some(&transcript_dir_str))
        .await
    {
        log::warn!("[eval] send_request failed for '{}': {}", agent_id, e);
        app.unlisten(message_listener);
        app.unlisten(exit_listener);
        let _ = std::fs::remove_file(&cmd_file_path);
        return false;
    }

    // ── Wait for trigger or completion, with timeout ─────────────────────
    let result = tokio::time::timeout(std::time::Duration::from_secs(timeout_secs), rx).await;

    app.unlisten(message_listener);
    app.unlisten(exit_listener);

    // Always clean up the temp command file regardless of outcome
    let _ = std::fs::remove_file(&cmd_file_path);

    match result {
        Ok(Ok(triggered)) => triggered,
        Ok(Err(_)) => false, // channel dropped unexpectedly
        Err(_) => {
            log::debug!(
                "[eval] query timed out after {}s: '{}'",
                timeout_secs,
                &query[..query.len().min(60)]
            );
            false
        }
    }
}

// ─── Parallel eval driver ───────────────────────────────────────────────────

#[allow(clippy::too_many_arguments)]
pub async fn run_eval(
    eval_set: &[super::EvalQuery],
    skill_name: &str,
    plugin_slug: &str,
    description: &str,
    workspace_path: &Path,
    model: &str,
    api_key: &SecretString,
    app: &tauri::AppHandle,
    pool: &SidecarPool,
    num_workers: usize,
    timeout_secs: u64,
    runs_per_query: u32,
    trigger_threshold: f64,
    cancel: &Arc<AtomicBool>,
    transcript_log_dir: &Path,
) -> Result<EvalResults, String> {
    if num_workers == 0 {
        return Err("num_workers must be > 0".to_string());
    }

    log::info!(
        "[run_eval] skill={} plugin={} queries={} workers={} runs={} desc_len={}",
        skill_name,
        plugin_slug,
        eval_set.len(),
        num_workers,
        runs_per_query,
        description.len()
    );

    let semaphore = Arc::new(Semaphore::new(num_workers));
    let mut set: JoinSet<(String, bool)> = JoinSet::new();

    for item in eval_set {
        for _run_idx in 0..runs_per_query {
            if cancel.load(Ordering::SeqCst) {
                set.abort_all();
                return Err("Optimization cancelled".to_string());
            }

            let permit = semaphore
                .clone()
                .acquire_owned()
                .await
                .map_err(|e| format!("Semaphore error: {}", e))?;

            let worker_idx = EVAL_WORKER_COUNTER.fetch_add(1, Ordering::Relaxed) % num_workers;
            let query = item.query.clone();
            let sn = skill_name.to_string();
            let ps = plugin_slug.to_string();
            let wp = workspace_path.to_path_buf();
            let m = model.to_string();
            let key = api_key.clone();
            let app_clone = app.clone();
            let pool_clone = pool.clone();
            let tld = transcript_log_dir.to_path_buf();
            let cancel_flag = cancel.clone();
            let desc = description.to_string();

            set.spawn(async move {
                let _permit = permit;
                if cancel_flag.load(Ordering::SeqCst) {
                    return (query, false);
                }
                let triggered = run_single_eval_query(
                    query.clone(),
                    &ps,
                    &sn,
                    &wp,
                    &m,
                    key,
                    &app_clone,
                    &pool_clone,
                    worker_idx,
                    timeout_secs,
                    &tld,
                    &desc,
                )
                .await;
                (query, triggered)
            });
        }
    }

    // Collect results
    let mut query_triggers: HashMap<String, Vec<bool>> = HashMap::new();

    while let Some(join_result) = set.join_next().await {
        if cancel.load(Ordering::SeqCst) {
            set.abort_all();
            return Err("Optimization cancelled".to_string());
        }
        match join_result {
            Ok((query, triggered)) => {
                query_triggers.entry(query).or_default().push(triggered);
            }
            Err(e) => {
                log::warn!("[run_eval] task join error: {}", e);
            }
        }
    }

    // Build lookup for should_trigger
    let should_trigger_map: HashMap<&str, bool> = eval_set
        .iter()
        .map(|item| (item.query.as_str(), item.should_trigger))
        .collect();

    // Aggregate per-query results
    let mut results = Vec::new();
    for (query, triggers) in &query_triggers {
        let should_trigger = *should_trigger_map.get(query.as_str()).unwrap_or(&true);
        let trigger_count = triggers.iter().filter(|&&t| t).count() as u32;
        let total_runs = triggers.len() as u32;
        let trigger_rate = if total_runs > 0 {
            trigger_count as f64 / total_runs as f64
        } else {
            0.0
        };
        let pass = if should_trigger {
            trigger_rate >= trigger_threshold
        } else {
            trigger_rate < trigger_threshold
        };
        results.push(EvalResult {
            query: query.clone(),
            should_trigger,
            trigger_rate,
            triggers: trigger_count,
            runs: total_runs,
            pass,
        });
    }

    let passed = results.iter().filter(|r| r.pass).count();
    let total = results.len();

    log::info!(
        "[run_eval] done: total={} passed={} failed={}",
        total,
        passed,
        total - passed
    );

    Ok(EvalResults {
        results,
        summary: EvalSummary {
            total,
            passed,
            failed: total - passed,
        },
    })
}

// ─── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_skill_triggered_for_agent_match() {
        let agent_id = "eval-vd-agent-abc12345";
        let payload = serde_json::json!({
            "agent_id": agent_id,
            "message": {
                "type": "display_item",
                "item": {
                    "type": "tool_call",
                    "toolName": "Skill",
                    "toolSummary": "Skill: data-product-builder"
                }
            }
        })
        .to_string();
        assert!(is_skill_triggered_for_agent(&payload, agent_id));
    }

    #[test]
    fn test_is_skill_triggered_for_agent_wrong_agent() {
        let payload = serde_json::json!({
            "agent_id": "eval-other-agent",
            "message": {
                "type": "display_item",
                "item": { "type": "tool_call", "toolName": "Skill" }
            }
        })
        .to_string();
        assert!(!is_skill_triggered_for_agent(&payload, "eval-my-agent"));
    }

    #[test]
    fn test_is_skill_triggered_for_agent_wrong_tool() {
        let agent_id = "eval-vd-agent-abc12345";
        let payload = serde_json::json!({
            "agent_id": agent_id,
            "message": {
                "type": "display_item",
                "item": { "type": "tool_call", "toolName": "Read" }
            }
        })
        .to_string();
        assert!(!is_skill_triggered_for_agent(&payload, agent_id));
    }

    #[test]
    fn test_is_skill_triggered_for_agent_non_display_item() {
        let agent_id = "eval-vd-agent-abc12345";
        let payload = serde_json::json!({
            "agent_id": agent_id,
            "message": {
                "type": "agent_event",
                "event": { "type": "turn_complete" }
            }
        })
        .to_string();
        assert!(!is_skill_triggered_for_agent(&payload, agent_id));
    }

    #[test]
    fn test_write_eval_command_file_creates_file() {
        let tmp = tempfile::tempdir().unwrap();
        let eval_cmds_root = tmp.path();
        let cmd_file = write_eval_command_file(
            eval_cmds_root,
            "my-skill-abc12345",
            "My Skill",
            "Use when working on my skill tasks",
        )
        .unwrap();
        assert!(cmd_file.exists(), "Command file should be created");
        let content = std::fs::read_to_string(&cmd_file).unwrap();
        assert!(
            content.contains("Use when working on my skill tasks"),
            "Command file should contain description"
        );
        assert!(
            content.contains("description: |"),
            "Description should use block scalar"
        );
        assert!(
            content.contains("# My Skill"),
            "Command file should contain skill name heading"
        );
    }

    #[test]
    fn test_eval_worker_key_format() {
        let key = eval_worker_key("vd-agent", 3);
        assert_eq!(key, "eval-vd-agent-worker-3");
    }
}
