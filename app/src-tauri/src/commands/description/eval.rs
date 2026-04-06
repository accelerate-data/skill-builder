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

/// Root of the eval sandbox:
/// `{workspace}/description-optimization/eval-sandbox/`
pub(super) fn eval_sandbox_root(workspace_path: &Path) -> PathBuf {
    workspace_path
        .join("description-optimization")
        .join("eval-sandbox")
}

/// Plugin directory inside the eval sandbox (sidecar discovers here):
/// `{sandbox}/.claude/plugins/{plugin_slug}/`
fn sandbox_plugin_dir(sandbox_root: &Path, plugin_slug: &str) -> PathBuf {
    sandbox_root
        .join(".claude")
        .join("plugins")
        .join(plugin_slug)
}

/// Write the candidate description into the sandboxed SKILL.md for a skill.
///
/// `original_content` is the full SKILL.md content; only the `description:`
/// frontmatter field is replaced. Directory is created if absent.
pub fn write_sandbox_skill_md(
    sandbox_root: &Path,
    plugin_slug: &str,
    skill_name: &str,
    original_content: &str,
    description: &str,
) -> Result<(), String> {
    let skill_dir = sandbox_plugin_dir(sandbox_root, plugin_slug).join(skill_name);
    std::fs::create_dir_all(&skill_dir)
        .map_err(|e| format!("Failed to create eval sandbox dir: {}", e))?;
    let updated =
        crate::commands::description::update_skill_description(original_content, description)?;
    std::fs::write(skill_dir.join("SKILL.md"), &updated)
        .map_err(|e| format!("Failed to write sandboxed SKILL.md: {}", e))?;
    log::debug!(
        "[eval] Wrote sandbox SKILL.md: plugin={} skill={} desc_len={}",
        plugin_slug,
        skill_name,
        description.len()
    );
    Ok(())
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
) -> bool {
    let agent_id = format!("eval-{}-{}", plugin_slug, uuid::Uuid::new_v4());

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
    let sandbox_root = eval_sandbox_root(workspace_path);
    // Forward-slash paths required by the Node.js sidecar on Windows
    let sandbox_root_str = sandbox_root.to_string_lossy().replace('\\', "/");

    // SDK cwd: use a stable eval-workspace subdirectory (not the sandbox itself)
    let eval_ws_dir = workspace_path
        .join("description-optimization")
        .join("eval-workspace");
    let _ = std::fs::create_dir_all(&eval_ws_dir);
    let eval_ws_dir_str = eval_ws_dir.to_string_lossy().replace('\\', "/");

    let transcript_dir_str = transcript_log_dir.to_string_lossy().into_owned();

    let config = SidecarConfig {
        prompt: query.clone(),
        system_prompt: None,
        model: Some(model.to_string()),
        api_key,
        workspace_root_dir: sandbox_root_str,
        workspace_skill_dir: eval_ws_dir_str,
        allowed_tools: None,
        max_turns: Some(3),
        permission_mode: Some("bypassPermissions".to_string()),
        betas: None,
        thinking: None,
        fallback_model: None,
        effort: None,
        output_format: None,
        prompt_suggestions: None,
        path_to_claude_code_executable: None,
        agent_name: None,
        required_plugins: Some(vec![plugin_slug.to_string()]),
        // Empty settingSources: suppress workspace project skills so only the
        // sandboxed plugin is loaded.
        setting_sources: Some(vec![]),
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
        return false;
    }

    // ── Wait for trigger or completion, with timeout ─────────────────────
    let result = tokio::time::timeout(std::time::Duration::from_secs(timeout_secs), rx).await;

    app.unlisten(message_listener);
    app.unlisten(exit_listener);

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
    fn test_write_sandbox_skill_md_creates_file() {
        let tmp = tempfile::tempdir().unwrap();
        let sandbox = tmp.path();
        let original = "---\nname: My Skill\ndescription: old\nauthor: dev\n---\n# Body\n";
        write_sandbox_skill_md(sandbox, "my-plugin", "my-skill", original, "new description")
            .unwrap();
        let skill_md = sandbox
            .join(".claude")
            .join("plugins")
            .join("my-plugin")
            .join("my-skill")
            .join("SKILL.md");
        assert!(skill_md.exists(), "SKILL.md should be created in sandbox");
        let content = std::fs::read_to_string(&skill_md).unwrap();
        assert!(
            content.contains("new description"),
            "Sandbox SKILL.md should contain new description"
        );
        assert!(
            !content.contains("description: old"),
            "Old description should be replaced"
        );
    }

    #[test]
    fn test_eval_worker_key_format() {
        let key = eval_worker_key("vd-agent", 3);
        assert_eq!(key, "eval-vd-agent-worker-3");
    }
}
