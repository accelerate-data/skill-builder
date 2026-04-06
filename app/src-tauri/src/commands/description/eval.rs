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
/// `{workspace}/skills/{plugin_slug}/{skill_name}/description-optimization/eval-commands/`
pub(super) fn eval_commands_root(workspace_path: &Path, plugin_slug: &str, skill_name: &str) -> PathBuf {
    crate::skill_paths::workspace_skill_dir(workspace_path, plugin_slug, skill_name)
        .join("description-optimization")
        .join("eval-commands")
}

/// Create an isolated per-run eval workspace and write the command file into it.
///
/// Each run gets its own subdirectory:
///   `{workspace}/skills/{plugin_slug}/{skill_name}/description-optimization/eval-commands/{run_uuid}/.claude/commands/{skill_name}.md`
///
/// This ensures each agent sees exactly one `.claude/` project with exactly
/// one command file — no bleed from concurrent runs. Returns the run directory
/// so the caller can delete the entire tree after the run completes.
fn create_eval_run_workspace(
    eval_cmds_root: &Path,
    skill_name: &str,
    description: &str,
) -> Result<PathBuf, String> {
    let run_uuid = uuid::Uuid::new_v4().to_string();
    let run_dir = eval_cmds_root.join(&run_uuid);
    let cmd_dir = run_dir.join(".claude").join("commands");
    std::fs::create_dir_all(&cmd_dir)
        .map_err(|e| format!("Failed to create eval run dir: {}", e))?;

    // Indent each line for YAML block scalar
    let indented = description
        .lines()
        .map(|line| format!("  {}", line))
        .collect::<Vec<_>>()
        .join("\n");

    let content = format!("---\ndescription: |\n{}\n---\n\n# {}\n", indented, skill_name);

    let cmd_file = cmd_dir.join(format!("{}.md", skill_name));
    std::fs::write(&cmd_file, &content)
        .map_err(|e| format!("Failed to write eval command file: {}", e))?;

    log::debug!(
        "[eval] Created eval run workspace: {} desc_len={}",
        run_dir.display(),
        description.len()
    );
    Ok(run_dir)
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

    // Create an isolated per-run workspace: eval-commands/{uuid}/.claude/commands/{skill}.md
    // Each agent sees exactly one .claude/ project with exactly one command file.
    let eval_cmds_root = eval_commands_root(workspace_path, plugin_slug, skill_name);
    let run_dir = match create_eval_run_workspace(&eval_cmds_root, skill_name, description) {
        Ok(d) => d,
        Err(e) => {
            log::warn!("[eval] failed to create eval run workspace: {}", e);
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
    //
    // workspace_root_dir  = base workspace (sidecar scans .claude/plugins/ here
    //                       for plugin discovery — filtered by required_plugins)
    // workspace_skill_dir = per-run isolated dir (SDK cwd; reads .claude/commands/
    //                       from here — only the one command file for this run)
    let workspace_root_str = workspace_path.to_string_lossy().replace('\\', "/");
    let run_dir_str = run_dir.to_string_lossy().replace('\\', "/");

    // Resolve SDK cli.js so the sidecar can spawn Claude Code agents.
    // Must be done here (not in spawn_sidecar) because we call pool.send_request directly.
    let sdk_cli_path = crate::agents::sidecar::resolve_sdk_cli_path_public(app).ok();

    let transcript_dir_str = transcript_log_dir.to_string_lossy().into_owned();

    let config = SidecarConfig {
        prompt: query.clone(),
        system_prompt: None,
        model: Some(model.to_string()),
        api_key,
        // Base workspace: sidecar finds .claude/plugins/vd-agent/ here
        workspace_root_dir: workspace_root_str,
        // Per-run isolated dir: SDK reads .claude/commands/ from here (one file only)
        workspace_skill_dir: run_dir_str,
        // Only allow Skill tool: forces an immediate routing decision rather than
        // letting the agent use Read/Write/etc. This makes eval fast and focused —
        // we're testing the description's routing signal, not general agent capability.
        allowed_tools: Some(vec!["Skill".to_string()]),
        max_turns: Some(3),
        permission_mode: Some("bypassPermissions".to_string()),
        betas: None,
        thinking: None,
        fallback_model: None,
        effort: None,
        output_format: None,
        prompt_suggestions: None,
        path_to_claude_code_executable: sdk_cli_path,
        // Use the production agent so eval reflects real routing behaviour.
        // required_plugins loads the vd-agent plugin (agent spec + sibling agents).
        agent_name: Some("vd-agent:data-product-builder".to_string()),
        required_plugins: Some(vec!["vd-agent".to_string()]),
        // 'project' reads .claude/commands/ from the per-run cwd (one file only).
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
        let _ = std::fs::remove_dir_all(&run_dir);
        return false;
    }

    // ── Wait for trigger or completion, with timeout ─────────────────────
    let result = tokio::time::timeout(std::time::Duration::from_secs(timeout_secs), rx).await;

    app.unlisten(message_listener);
    app.unlisten(exit_listener);

    // Always clean up the entire per-run workspace regardless of outcome
    let _ = std::fs::remove_dir_all(&run_dir);

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

    let results = aggregate_trigger_results(&query_triggers, eval_set, trigger_threshold);
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

// ─── Pure calculation helpers ───────────────────────────────────────────────

/// Aggregate raw per-run trigger booleans into per-query EvalResults.
///
/// Pure function — no I/O, no sidecar. Extracted so it can be unit-tested
/// without a live AppHandle or SidecarPool.
pub fn aggregate_trigger_results(
    query_triggers: &HashMap<String, Vec<bool>>,
    eval_set: &[super::EvalQuery],
    trigger_threshold: f64,
) -> Vec<EvalResult> {
    let should_trigger_map: HashMap<&str, bool> = eval_set
        .iter()
        .map(|item| (item.query.as_str(), item.should_trigger))
        .collect();

    let mut results = Vec::new();
    for (query, triggers) in query_triggers {
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
    results
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
    fn test_create_eval_run_workspace() {
        let tmp = tempfile::tempdir().unwrap();
        let eval_cmds_root = tmp.path();
        let run_dir = create_eval_run_workspace(
            eval_cmds_root,
            "my-skill",
            "Use when working on my skill tasks",
        )
        .unwrap();
        // run_dir is a UUID subdirectory of eval_cmds_root
        assert!(run_dir.starts_with(eval_cmds_root));
        assert_ne!(run_dir, eval_cmds_root);
        // command file is at run_dir/.claude/commands/my-skill.md
        let cmd_file = run_dir.join(".claude").join("commands").join("my-skill.md");
        assert!(cmd_file.exists(), "Command file should be created");
        let content = std::fs::read_to_string(&cmd_file).unwrap();
        assert!(content.contains("Use when working on my skill tasks"));
        assert!(content.contains("description: |"));
        assert!(content.contains("# my-skill"));
        // cleanup removes the entire run dir
        std::fs::remove_dir_all(&run_dir).unwrap();
        assert!(!run_dir.exists());
    }

    #[test]
    fn test_concurrent_runs_are_isolated() {
        let tmp = tempfile::tempdir().unwrap();
        let eval_cmds_root = tmp.path();
        let dir1 = create_eval_run_workspace(eval_cmds_root, "my-skill", "desc A").unwrap();
        let dir2 = create_eval_run_workspace(eval_cmds_root, "my-skill", "desc B").unwrap();
        assert_ne!(dir1, dir2, "each run gets a unique subdirectory");
        // Each dir has exactly one command file
        let cmds1: Vec<_> = std::fs::read_dir(dir1.join(".claude").join("commands")).unwrap().collect();
        let cmds2: Vec<_> = std::fs::read_dir(dir2.join(".claude").join("commands")).unwrap().collect();
        assert_eq!(cmds1.len(), 1);
        assert_eq!(cmds2.len(), 1);
    }

    #[test]
    fn test_eval_worker_key_format() {
        let key = eval_worker_key("vd-agent", 3);
        assert_eq!(key, "eval-vd-agent-worker-3");
    }

    #[test]
    fn test_aggregate_trigger_results_should_trigger_pass() {
        use super::super::EvalQuery;
        let eval_set = vec![
            EvalQuery { query: "q1".to_string(), should_trigger: true },
            EvalQuery { query: "q2".to_string(), should_trigger: false },
        ];
        let mut query_triggers = HashMap::new();
        query_triggers.insert("q1".to_string(), vec![true, true, true]); // 3/3 → rate=1.0
        query_triggers.insert("q2".to_string(), vec![false, false, false]); // 0/3 → rate=0.0

        let results = aggregate_trigger_results(&query_triggers, &eval_set, 0.5);
        let q1 = results.iter().find(|r| r.query == "q1").unwrap();
        let q2 = results.iter().find(|r| r.query == "q2").unwrap();
        assert!(q1.pass, "should_trigger=true with rate=1.0 should pass");
        assert!(q2.pass, "should_trigger=false with rate=0.0 should pass");
    }

    #[test]
    fn test_aggregate_trigger_results_should_trigger_fail() {
        use super::super::EvalQuery;
        let eval_set = vec![
            EvalQuery { query: "q1".to_string(), should_trigger: true },
            EvalQuery { query: "q2".to_string(), should_trigger: false },
        ];
        let mut query_triggers = HashMap::new();
        query_triggers.insert("q1".to_string(), vec![false, false, false]); // 0/3 → fail
        query_triggers.insert("q2".to_string(), vec![true, true, true]);  // 3/3 → fail

        let results = aggregate_trigger_results(&query_triggers, &eval_set, 0.5);
        let q1 = results.iter().find(|r| r.query == "q1").unwrap();
        let q2 = results.iter().find(|r| r.query == "q2").unwrap();
        assert!(!q1.pass, "should_trigger=true with rate=0.0 should fail");
        assert!(!q2.pass, "should_trigger=false with rate=1.0 should fail");
    }

    #[test]
    fn test_aggregate_trigger_results_threshold_boundary() {
        use super::super::EvalQuery;
        let eval_set = vec![EvalQuery { query: "q".to_string(), should_trigger: true }];
        let mut triggers_exactly_at = HashMap::new();
        triggers_exactly_at.insert("q".to_string(), vec![true, false]); // rate=0.5
        let results = aggregate_trigger_results(&triggers_exactly_at, &eval_set, 0.5);
        assert!(results[0].pass, "rate == threshold should pass (>=)");

        let mut triggers_below = HashMap::new();
        triggers_below.insert("q".to_string(), vec![false, false, true]); // rate=0.333
        let results2 = aggregate_trigger_results(&triggers_below, &eval_set, 0.5);
        assert!(!results2[0].pass, "rate < threshold should fail");
    }

    #[test]
    fn test_eval_commands_root_includes_skill_path() {
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path();
        let root = eval_commands_root(workspace, "my-plugin", "my-skill");
        // Must be under workspace/my-plugin/my-skill/description-optimization/eval-commands/
        // (via workspace_skill_dir which joins plugin_slug/skill_name)
        assert!(
            root.starts_with(workspace),
            "root must be under workspace"
        );
        let rel = root.strip_prefix(workspace).unwrap();
        let components: Vec<_> = rel.components()
            .map(|c| c.as_os_str().to_string_lossy().into_owned())
            .collect();
        assert!(
            components.contains(&"my-plugin".to_string()),
            "path must include plugin slug: {:?}", components
        );
        assert!(
            components.contains(&"my-skill".to_string()),
            "path must include skill name: {:?}", components
        );
        assert!(
            components.contains(&"eval-commands".to_string()),
            "path must end at eval-commands: {:?}", components
        );
    }

    #[test]
    fn test_eval_commands_root_different_skills_dont_collide() {
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path();
        let root_a = eval_commands_root(workspace, "plugin", "skill-a");
        let root_b = eval_commands_root(workspace, "plugin", "skill-b");
        assert_ne!(root_a, root_b, "different skills must get different eval-commands roots");
    }
}
