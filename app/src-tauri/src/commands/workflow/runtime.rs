use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;

use crate::agents::sidecar::{self, SidecarConfig};
use crate::agents::sidecar_pool::SidecarPool;
use crate::db::Db;

use super::deploy::ensure_workspace_prompts;
use super::evaluation::workflow_step_log_name;
use super::guards::{
    make_agent_id, parse_decisions_guard, parse_scope_recommendation,
    workflow_step_runtime_label,
};
use super::output_format::answer_evaluator_output_format;
use super::prompt::{build_evaluator_prompt, build_prompt, build_step0_prompt};
use super::settings::{read_workflow_settings, WorkflowSettings};
use super::step_config::{
    build_betas, get_step_config, resolve_model_id, thinking_budget_for_step,
    tools_for_agent, workflow_output_format_for_agent,
};
use super::user_context::write_user_context_file;

// ─── Session management ──────────────────────────────────────────────────────

/// In-memory state for a single workflow step streaming session.
/// Keyed by agent_id in WorkflowStepSessionManager.
pub struct WorkflowStepSession {
    pub skill_name: String,
    pub session_id: String,
}

/// Manages active workflow step streaming sessions. Registered as Tauri managed state.
/// Allows `answer_workflow_step_question` to look up the session for a given agent.
pub struct WorkflowStepSessionManager(pub Mutex<HashMap<String, WorkflowStepSession>>);

impl WorkflowStepSessionManager {
    pub fn new() -> Self {
        Self(Mutex::new(HashMap::new()))
    }
}

// ─── run_workflow_step_inner ─────────────────────────────────────────────────

/// Core logic for launching a single workflow step via streaming. Builds the prompt,
/// constructs the sidecar config, and starts a streaming session. Returns the agent_id.
///
/// Each step gets its own streaming session so AskUserQuestion callbacks can be
/// routed back to the correct sidecar via send_stream_question_answer.
async fn run_workflow_step_inner(
    app: &tauri::AppHandle,
    pool: &SidecarPool,
    sessions: &WorkflowStepSessionManager,
    skill_name: &str,
    step_id: u32,
    workspace_path: &str,
    settings: &WorkflowSettings,
    workflow_session_id: Option<String>,
) -> Result<String, String> {
    let step = get_step_config(step_id)?;
    let thinking_budget = if settings.extended_thinking {
        thinking_budget_for_step(step_id)
    } else {
        None
    };
    // Write user-context.md to workspace directory so sub-agents can read it.
    // Refreshed before every step to pick up mid-workflow settings edits.
    write_user_context_file(
        workspace_path,
        &settings.plugin_slug,
        skill_name,
        &settings.tags,
        settings.author_login.as_deref(),
        settings.industry.as_deref(),
        settings.function_role.as_deref(),
        settings.intake_json.as_deref(),
        settings.description.as_deref(),
        Some(settings.purpose.as_str()),
        settings.version.as_deref(),
        settings.skill_model.as_deref(),
        settings.argument_hint.as_deref(),
        settings.user_invocable,
        settings.disable_model_invocation,
        &settings.documents,
    );

    let prompt = if step_id == 0 {
        build_step0_prompt(
            skill_name,
            workspace_path,
            &settings.plugin_slug,
            settings.max_dimensions,
        )
    } else {
        build_prompt(
            skill_name,
            workspace_path,
            &settings.plugin_slug,
            &settings.skills_path,
            settings.author_login.as_deref(),
            settings.created_at.as_deref(),
            settings.max_dimensions,
        )
    };
    log::debug!(
        "[run_workflow_step] prompt for step={} step_id={}: {}",
        workflow_step_log_name(step_id as i32),
        step_id,
        prompt
    );

    let agent_name = step.agent_name.clone();
    let required_plugins: Vec<String> = step.required_plugins.clone();
    let agent_id = make_agent_id(skill_name, &workflow_step_runtime_label(&step));
    log::info!(
        "run_workflow_step: skill={} step={} step_id={} agent={} plugins={:?}",
        skill_name,
        workflow_step_log_name(step_id as i32),
        step_id,
        agent_name,
        required_plugins,
    );

    let mut config = SidecarConfig {
        prompt,
        model: if use_agent_system_prompt {
            None
        } else {
            Some(settings.preferred_model.clone())
        },
        api_key: settings.api_key.clone(),
        cwd: workspace_path.to_string(),
        allowed_tools: Some(step.allowed_tools),
        max_turns: Some(step.max_turns),
        permission_mode: Some("bypassPermissions".to_string()),
        betas: build_betas(
            thinking_budget,
            &settings.preferred_model,
            settings.interleaved_thinking_beta,
        ),
        thinking: thinking_budget.map(|budget| {
            serde_json::json!({
                "type": "enabled",
                "budgetTokens": budget
            })
        }),
        // When model is set explicitly, fallback_model must differ or the SDK errors.
        // For step 0 (no agent system prompt), suppress fallback_model entirely.
        fallback_model: if use_agent_system_prompt {
            settings.fallback_model.clone()
        } else {
            None
        },
        effort: settings.sdk_effort.clone(),
        output_format: workflow_output_format_for_agent(&agent_name),
        prompt_suggestions: None,
        path_to_claude_code_executable: None,
        agent_name: if use_agent_system_prompt {
            Some(agent_name)
        } else {
            None
        },
        required_plugins: Some(required_plugins),
        conversation_history: None,
        skill_name: Some(skill_name.to_string()),
        step_id: Some(step_id as i32),
        workflow_session_id,
        usage_session_id: None,
        run_source: Some("workflow".to_string()),
        transcript_log_dir: Some(
            crate::skill_paths::workspace_skill_dir(
                Path::new(workspace_path),
                &settings.plugin_slug,
                skill_name,
            )
            .join("logs")
            .to_string_lossy()
            .into_owned(),
        ),
    };

    // Resolve SDK cli.js path (same as spawn_sidecar does internally)
    if config.path_to_claude_code_executable.is_none() {
        if let Ok(cli_path) = sidecar::resolve_sdk_cli_path_public(app) {
            config.path_to_claude_code_executable = Some(cli_path);
        }
    }

    let session_id = uuid::Uuid::new_v4().to_string();
    log::debug!(
        "[run_workflow_step] starting stream session=[REDACTED] agent={} cwd={}",
        agent_id,
        config.cwd,
    );

    pool.send_stream_start(skill_name, &session_id, &agent_id, config, app)
        .await
        .map_err(|e| {
            log::error!(
                "[run_workflow_step] Failed to start stream for agent={}: {}",
                agent_id,
                e
            );
            e
        })?;

    // Register session so answer_workflow_step_question can route answers
    {
        let mut map = sessions.0.lock().map_err(|e| e.to_string())?;
        map.insert(
            agent_id.clone(),
            WorkflowStepSession {
                skill_name: skill_name.to_string(),
                session_id,
            },
        );
    }

    Ok(agent_id)
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn run_workflow_step(
    app: tauri::AppHandle,
    pool: tauri::State<'_, SidecarPool>,
    db: tauri::State<'_, Db>,
    sessions: tauri::State<'_, WorkflowStepSessionManager>,
    skill_name: String,
    step_id: u32,
    workspace_path: String,
    workflow_session_id: Option<String>,
) -> Result<String, String> {
    log::info!(
        "[run_workflow_step] skill={} step={} step_id={} session={}",
        skill_name,
        workflow_step_log_name(step_id as i32),
        step_id,
        if workflow_session_id.is_some() { "[present]" } else { "[none]" }
    );
    crate::commands::workflow_lifecycle::validate_run_request(
        &skill_name,
        step_id,
        &workspace_path,
    )?;
    // Ensure prompt files exist in workspace before running.
    // This deploys agents to .claude/agents/ and plugins to .claude/plugins/.
    ensure_workspace_prompts(&app, &workspace_path).await?;

    let settings = read_workflow_settings(&db, &skill_name, step_id, &workspace_path)?;
    log::info!(
        "[run_workflow_step] settings: skills_path={} purpose={} intake={} industry={:?} function={:?}",
        settings.skills_path, settings.purpose,
        settings.intake_json.is_some(),
        settings.industry, settings.function_role,
    );

    // Gate: reject disabled steps when guard conditions are active
    let context_dir = crate::skill_paths::workspace_skill_dir(
        Path::new(&workspace_path),
        &settings.plugin_slug,
        &skill_name,
    )
    .join("context");

    if step_id >= 1 {
        let clarifications_path = context_dir.join("clarifications.json");
        if parse_scope_recommendation(&clarifications_path) {
            return Err(format!(
                "{} is disabled: the research phase determined the skill scope is too broad. \
                 Review the scope recommendations in clarifications.json, then reset to step 0 \
                 and start with a narrower focus.",
                workflow_step_log_name(step_id as i32)
            ));
        }
    }

    if step_id >= 3 {
        let decisions_path = context_dir.join("decisions.json");
        if parse_decisions_guard(&decisions_path) {
            return Err(format!(
                "{} is disabled: the reasoning agent found unresolvable \
                 contradictions in decisions.json. Reset to step 2 and revise \
                 your answers before retrying.",
                workflow_step_log_name(step_id as i32)
            ));
        }
    }

    // Clean stale artifacts before the agent runs so it starts from a
    // known-clean state. Crash or re-run scenarios can leave partial output.
    // Step 0 is a full reset — wipe context dir and all downstream artifacts
    // (same scope as reset_workflow_step to step 0).
    // Steps 1-3 clean only their own output.
    // Rewrite mode goes through the refine command, not this path.
    if step_id == 0 {
        log::debug!(
            "[run_workflow_step] step=0 full cleanup for skill={}",
            skill_name
        );
        if context_dir.is_dir() {
            if let Err(e) = std::fs::remove_dir_all(&context_dir) {
                log::warn!(
                    "[run_workflow_step] step=0 failed to remove context dir {}: {}",
                    context_dir.display(),
                    e
                );
            }
        }
        // Always ensure context dir exists (covers first run and old skills with wrong path).
        if let Err(e) = std::fs::create_dir_all(&context_dir) {
            log::warn!(
                "[run_workflow_step] step=0 failed to create context dir {}: {}",
                context_dir.display(),
                e
            );
        }
        crate::cleanup::delete_step_output_files(
            &workspace_path,
            &skill_name,
            &settings.plugin_slug,
            0,
            &settings.skills_path,
        );
    } else {
        log::debug!(
            "[run_workflow_step] step={} cleaning previous artifacts for skill={}",
            step_id,
            skill_name
        );
        crate::cleanup::clean_step_output(
            &workspace_path,
            &skill_name,
            &settings.plugin_slug,
            step_id,
            &settings.skills_path,
        );
    }

    run_workflow_step_inner(
        &app,
        pool.inner(),
        sessions.inner(),
        &skill_name,
        step_id,
        &workspace_path,
        &settings,
        workflow_session_id,
    )
    .await
    .map_err(|e| {
        log::error!(
            "[run_workflow_step] skill={} step={} step_id={} failed: {}",
            skill_name,
            workflow_step_log_name(step_id as i32),
            step_id,
            e
        );
        e
    })
}

// ─── answer_workflow_step_question ───────────────────────────────────────────

/// Route an AskUserQuestion answer back to the active workflow step streaming session.
///
/// The frontend calls this when the user submits an answer to a question posed
/// by a workflow step agent (step 0–3). The session is looked up by agent_id
/// and the answer is forwarded to the sidecar via send_stream_question_answer.
#[tauri::command]
pub async fn answer_workflow_step_question(
    agent_id: String,
    tool_use_id: String,
    questions: serde_json::Value,
    answers: serde_json::Value,
    sessions: tauri::State<'_, WorkflowStepSessionManager>,
    pool: tauri::State<'_, SidecarPool>,
) -> Result<(), String> {
    log::info!(
        "[answer_workflow_step_question] agent={} tool={}",
        agent_id,
        tool_use_id
    );

    let (skill_name, session_id) = {
        let map = sessions.0.lock().map_err(|e| {
            log::error!(
                "[answer_workflow_step_question] Failed to acquire session lock: {}",
                e
            );
            e.to_string()
        })?;
        let session = map.get(&agent_id).ok_or_else(|| {
            let msg = format!(
                "No workflow step session found for agent_id={}",
                agent_id
            );
            log::error!("[answer_workflow_step_question] {}", msg);
            msg
        })?;
        (session.skill_name.clone(), session.session_id.clone())
    };

    pool.send_stream_question_answer(
        &skill_name,
        &session_id,
        &agent_id,
        &tool_use_id,
        questions,
        answers,
    )
    .await
    .map_err(|e| {
        log::error!(
            "[answer_workflow_step_question] Failed to send answer for agent={}: {}",
            agent_id,
            e
        );
        e
    })
}

// ─── run_answer_evaluator ────────────────────────────────────────────────────

/// Run the answer-evaluator agent (Haiku) to assess clarification answer quality.
/// Returns the agent ID for the frontend to subscribe to completion events.
#[tauri::command]
pub async fn run_answer_evaluator(
    app: tauri::AppHandle,
    pool: tauri::State<'_, SidecarPool>,
    db: tauri::State<'_, Db>,
    skill_name: String,
    workspace_path: String,
) -> Result<String, String> {
    log::info!("run_answer_evaluator: skill={}", skill_name);

    // Ensure agent files are deployed to workspace
    ensure_workspace_prompts(&app, &workspace_path).await?;

    // Read settings from DB — same pattern as read_workflow_settings but without
    // step-specific validation (this is a gate, not a workflow step).
    let (api_key, skills_path, plugin_slug, industry, function_role, intake_json, preferred_model) = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let settings = crate::db::read_settings(&conn).map_err(|e| {
            log::error!("run_answer_evaluator: failed to read settings: {}", e);
            e.to_string()
        })?;
        let key = match settings.anthropic_api_key {
            Some(k) => crate::types::SecretString::new(k),
            None => {
                log::error!("run_answer_evaluator: API key not configured");
                return Err("Anthropic API key not configured".to_string());
            }
        };
        let _wp = settings.workspace_path.ok_or_else(|| {
            log::error!("run_answer_evaluator: workspace_path not configured");
            "Workspace path not configured".to_string()
        })?;
        let sp = settings
            .skills_path
            .unwrap_or_else(|| workspace_path.clone());
        let run_row = crate::db::get_workflow_run(&conn, &skill_name)
            .ok()
            .flatten();
        let ij = run_row.as_ref().and_then(|r| r.intake_json.clone());
        // Look up plugin slug for this skill so workspace path resolves correctly.
        let slug = crate::db::get_skill_master_any_plugin(&conn, &skill_name)
            .ok()
            .flatten()
            .map(|m| m.plugin_slug)
            .unwrap_or_else(|| crate::skill_paths::DEFAULT_PLUGIN_SLUG.to_string());
        // Answer evaluator is a lightweight gate — always use Haiku for cost efficiency.
        let model = resolve_model_id("haiku");
        (
            key,
            sp,
            slug,
            settings.industry,
            settings.function_role,
            ij,
            model,
        )
    };

    // Write user-context.md so the agent can read it (same as workflow steps)
    write_user_context_file(
        &workspace_path,
        &plugin_slug,
        &skill_name,
        &[], // answer evaluator doesn't need full metadata
        None,
        industry.as_deref(),
        function_role.as_deref(),
        intake_json.as_deref(),
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        &[], // answer evaluator doesn't inject documents
    );

    let prompt = build_evaluator_prompt(&skill_name, &workspace_path, &plugin_slug, &skills_path);

    log::debug!("run_answer_evaluator: prompt={}", prompt);
    log::info!(
        "run_answer_evaluator: skill={} model={}",
        skill_name,
        preferred_model
    );

    let agent_id = make_agent_id(&skill_name, "gate-eval");

    let config = SidecarConfig {
        prompt,
        model: None,
        api_key,
        cwd: workspace_path.clone(),
        allowed_tools: Some(tools_for_agent("answer-evaluator")),
        max_turns: Some(20),
        permission_mode: Some("bypassPermissions".to_string()),
        betas: None,
        thinking: None,
        fallback_model: None,
        effort: None,
        output_format: Some(answer_evaluator_output_format()),
        prompt_suggestions: None,
        path_to_claude_code_executable: None,
        agent_name: Some("answer-evaluator".to_string()),
        required_plugins: None,
        conversation_history: None,
        skill_name: None,
        step_id: None,
        workflow_session_id: None,
        usage_session_id: None,
        run_source: None,
        transcript_log_dir: None,
    };

    let log_dir = crate::skill_paths::workspace_skill_dir(
        Path::new(&workspace_path),
        &plugin_slug,
        &skill_name,
    )
    .join("logs")
    .to_string_lossy()
    .into_owned();

    sidecar::spawn_sidecar(
        agent_id.clone(),
        config,
        pool.inner().clone(),
        app.clone(),
        skill_name,
        Some(log_dir),
    )
    .await?;

    Ok(agent_id)
}

/// Cancel a running workflow step streaming session by agent_id.
///
/// Looks up the session_id from WorkflowStepSessionManager and sends
/// a stream_cancel message to the sidecar so the AbortController fires.
/// This is the correct cancel path for streaming workflow steps (VU-729+).
#[tauri::command]
pub async fn cancel_workflow_step(
    agent_id: String,
    sessions: tauri::State<'_, WorkflowStepSessionManager>,
    pool: tauri::State<'_, SidecarPool>,
) -> Result<(), String> {
    log::info!("[cancel_workflow_step] agent={}", agent_id);
    let (skill_name, session_id) = {
        let map = sessions.0.lock().map_err(|e| {
            log::error!("[cancel_workflow_step] Failed to acquire session lock: {}", e);
            e.to_string()
        })?;
        let session = map.get(&agent_id).ok_or_else(|| {
            let msg = format!("No workflow step session found for agent_id={}", agent_id);
            log::warn!("[cancel_workflow_step] {}", msg);
            msg
        })?;
        (session.skill_name.clone(), session.session_id.clone())
    };
    pool.send_stream_end(&skill_name, &session_id)
        .await
        .map_err(|e| {
            log::warn!(
                "[cancel_workflow_step] Failed to send stream_end for agent={}: {}",
                agent_id,
                e
            );
            e
        })
}

/// Log the user's gate decision so it appears in the backend log stream.
#[tauri::command]
pub fn log_gate_decision(skill_name: String, verdict: String, decision: String) {
    let sanitize = |s: &str| s.replace('\n', "\\n").replace('\r', "\\r");
    log::info!(
        "gate_decision: skill={} verdict={} decision={}",
        sanitize(&skill_name),
        sanitize(&verdict),
        sanitize(&decision)
    );
}
