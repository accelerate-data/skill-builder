use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;

use crate::agents::sidecar::{self, SidecarConfig};
use crate::agents::sidecar_pool::SidecarPool;
use crate::db::Db;
use crate::skill_paths::resolve_workspace_skill_dir;

use super::deploy::ensure_workspace_prompts;
use super::evaluation::workflow_step_log_name;
use super::guards::{
    make_agent_id, parse_decisions_guard, parse_scope_recommendation, workflow_step_runtime_label,
};
use super::output_format::answer_evaluator_output_format;
use super::prompt::{build_evaluator_prompt, build_prompt, build_step0_prompt};
use super::settings::{read_workflow_settings, WorkflowSettings};
use super::step_config::{
    build_betas, get_step_config, thinking_budget_for_step, tools_for_agent,
    workflow_output_format_for_agent, WORKFLOW_AGENT_IDENTITY,
};
use super::user_context::write_user_context_file;

// ─── Session management ──────────────────────────────────────────────────────

/// In-memory state for a single workflow one-shot run.
/// Keyed by agent_id in WorkflowStepRunManager.
pub struct WorkflowStepRun {
    pub skill_name: String,
}

/// Manages active workflow step one-shot runs. Registered as Tauri managed state.
/// Allows `cancel_workflow_step` to look up the skill sidecar for a given agent.
pub struct WorkflowStepRunManager(pub Mutex<HashMap<String, WorkflowStepRun>>);

impl WorkflowStepRunManager {
    pub fn new() -> Self {
        Self(Mutex::new(HashMap::new()))
    }
}

// ─── run_workflow_step_inner ─────────────────────────────────────────────────

/// Core logic for launching a single workflow step via one-shot execution. Builds
/// the prompt, constructs the sidecar config, and sends an agent_request. Returns
/// the agent_id, which is also the one-shot request_id.
#[allow(clippy::too_many_arguments)]
async fn run_workflow_step_inner(
    app: &tauri::AppHandle,
    pool: &SidecarPool,
    runs: &WorkflowStepRunManager,
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

    const JSON_ONLY: &str = "Your final response MUST be ONLY a raw JSON object — no markdown, no explanation, no wrapping.";

    // The SDK always runs the generic skill-builder agent identity. Step prompts
    // still carry the existing workflow-specific instructions and, when needed,
    // tell the agent which capability to invoke before returning structured JSON.
    let subagent_directive: Option<String> = match step_id {
        1 => Some(format!(
            "Invoke the `skill-content-researcher:detailed-research` agent to perform detailed research. \
             Then return that payload as your own final response. {JSON_ONLY}"
        )),
        2 => Some(format!(
            "Invoke the `skill-content-researcher:confirm-decisions` agent to confirm decisions. \
             Then return that payload as your own final response. {JSON_ONLY}"
        )),
        3 => Some(format!(
            "Launch the `skill-creator:generate-skill` subagent to generate the skill. \
             {JSON_ONLY} Required fields: \
             {{\"status\": \"generated\"}}"
        )),
        _ => None,
    };

    let prompt = if step_id == 0 {
        build_step0_prompt(
            skill_name,
            workspace_path,
            &settings.plugin_slug,
            settings.max_dimensions,
        )
    } else {
        build_prompt(&super::prompt::PromptParams {
            skill_name,
            workspace_path,
            plugin_slug: &settings.plugin_slug,
            skills_path: &settings.skills_path,
            author_login: settings.author_login.as_deref(),
            created_at: settings.created_at.as_deref(),
            subagent_directive: subagent_directive.as_deref(),
            step_id,
        })
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

    let sdk_agent_identity = WORKFLOW_AGENT_IDENTITY.to_string();

    log::debug!(
        "[run_workflow_step] sdk_agent_identity={} output_format_configured={} step_id={}",
        sdk_agent_identity,
        workflow_output_format_for_agent(&agent_name).is_some(),
        step_id
    );

    let mut config = SidecarConfig {
        mode: Some("one-shot".to_string()),
        prompt,
        // Do not set a string systemPrompt for workflow steps. The SDK treats
        // that as a custom system prompt, which can replace the configured
        // agent identity's instructions. Structured contracts are enforced via
        // output_format below.
        system_prompt: None,
        model: Some(settings.preferred_model.clone()),
        model_base_url: None,
        api_key: settings.api_key.clone(),
        workspace_root_dir: workspace_path.replace('\\', "/"),
        workspace_skill_dir: resolve_workspace_skill_dir(
            Path::new(workspace_path),
            &settings.plugin_slug,
            skill_name,
        )
        .to_string_lossy()
        .replace('\\', "/"),
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
        // model is always set explicitly; suppress fallback_model to avoid SDK errors.
        fallback_model: None,
        effort: settings.sdk_effort.clone(),
        output_format: workflow_output_format_for_agent(&agent_name),
        prompt_suggestions: None,
        path_to_claude_code_executable: None,
        agent_name: Some(sdk_agent_identity),
        required_plugins: Some(required_plugins),
        setting_sources: None,
        conversation_history: None,
        skill_name: Some(skill_name.to_string()),
        step_id: Some(step_id as i32),
        workflow_session_id,
        usage_session_id: None,
        run_source: Some("workflow".to_string()),
        plugin_slug: settings.plugin_slug.clone(),
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
        runtime_provider: None,
    };

    // Resolve SDK cli.js path (same as spawn_sidecar does internally)
    if config.path_to_claude_code_executable.is_none() {
        if let Ok(cli_path) = sidecar::resolve_sdk_cli_path_public(app) {
            config.path_to_claude_code_executable = Some(cli_path);
        }
    }

    log::debug!(
        "[run_workflow_step] starting one-shot request agent={} workspace_skill_dir={}",
        agent_id,
        config.workspace_skill_dir,
    );

    let transcript_log_dir = config.transcript_log_dir.clone();
    pool.send_request(
        skill_name,
        &agent_id,
        config,
        app,
        transcript_log_dir.as_deref(),
    )
    .await
    .map_err(|e| {
        log::error!(
            "[run_workflow_step] Failed to start one-shot request for agent={}: {}",
            agent_id,
            e
        );
        e
    })?;

    // Register active one-shot run so cancel_workflow_step can route cancel.
    {
        let mut map = runs.0.lock().map_err(|e| e.to_string())?;
        map.insert(
            agent_id.clone(),
            WorkflowStepRun {
                skill_name: skill_name.to_string(),
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
    runs: tauri::State<'_, WorkflowStepRunManager>,
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
        if workflow_session_id.is_some() {
            "[present]"
        } else {
            "[none]"
        }
    );
    crate::commands::workflow_lifecycle::validate_run_request(
        &skill_name,
        step_id,
        &workspace_path,
    )?;

    // Cancel any stale one-shot workflow requests for this skill before starting
    // a new step. The sidecar treats agent_id as request_id for agent_request.
    let stale_runs: Vec<String> = {
        let map = runs.0.lock().map_err(|e| e.to_string())?;
        map.iter()
            .filter(|(_, s)| s.skill_name == skill_name)
            .map(|(agent_id, _)| agent_id.clone())
            .collect()
    };
    for stale_agent_id in &stale_runs {
        log::info!(
            "[run_workflow_step] canceling stale one-shot run agent={} before starting step_id={}",
            stale_agent_id,
            step_id,
        );
        let _ = pool.send_cancel(&skill_name, stale_agent_id).await;
    }
    if !stale_runs.is_empty() {
        let mut map = runs.0.lock().map_err(|e| e.to_string())?;
        for stale_agent_id in &stale_runs {
            map.remove(stale_agent_id);
        }
    }

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
        runs.inner(),
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

/// Workflow steps are one-shot runs. They do not support AskUserQuestion.
#[tauri::command]
pub async fn answer_workflow_step_question(
    agent_id: String,
    tool_use_id: String,
    questions: serde_json::Value,
    answers: serde_json::Value,
    runs: tauri::State<'_, WorkflowStepRunManager>,
    pool: tauri::State<'_, SidecarPool>,
) -> Result<(), String> {
    let _ = (tool_use_id, questions, answers, runs, pool);
    log::warn!(
        "[answer_workflow_step_question] rejected for one-shot workflow agent={}",
        agent_id
    );
    Err("Workflow steps run in one-shot mode and cannot ask user questions".to_string())
}

// ─── run_answer_evaluator ────────────────────────────────────────────────────

/// Run the answer-evaluator agent as a one-shot request.
///
/// Returns the agent ID for the frontend to subscribe to completion events.
#[tauri::command]
pub async fn run_answer_evaluator(
    app: tauri::AppHandle,
    pool: tauri::State<'_, SidecarPool>,
    db: tauri::State<'_, Db>,
    runs: tauri::State<'_, WorkflowStepRunManager>,
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
        (
            key,
            sp,
            slug,
            settings.industry,
            settings.function_role,
            ij,
            settings
                .preferred_model
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| "Model not configured. Select a model in Settings before running the answer evaluator.".to_string())?,
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
        "run_answer_evaluator: skill={} agent=answer-evaluator",
        skill_name
    );

    let agent_id = make_agent_id(&skill_name, "gate-eval");

    let mut config = SidecarConfig {
        mode: Some("one-shot".to_string()),
        prompt,
        system_prompt: None,
        model: Some(preferred_model),
        model_base_url: None,
        api_key,
        workspace_root_dir: workspace_path.replace('\\', "/"),
        workspace_skill_dir: resolve_workspace_skill_dir(
            Path::new(&workspace_path),
            &plugin_slug,
            &skill_name,
        )
        .to_string_lossy()
        .replace('\\', "/"),
        allowed_tools: Some(tools_for_agent("answer-evaluator")),
        max_turns: Some(20),
        permission_mode: Some("bypassPermissions".to_string()),
        betas: None,
        thinking: None,
        // When model is set explicitly, fallback_model must differ — suppress it.
        fallback_model: None,
        effort: None,
        output_format: Some(answer_evaluator_output_format()),
        prompt_suggestions: None,
        path_to_claude_code_executable: None,
        agent_name: None,
        required_plugins: Some(vec!["skill-content-researcher".to_string()]),
        setting_sources: None,
        conversation_history: None,
        skill_name: None,
        step_id: None,
        workflow_session_id: None,
        usage_session_id: None,
        run_source: Some("gate-eval".to_string()),
        plugin_slug: plugin_slug.clone(),
        transcript_log_dir: Some(
            crate::skill_paths::workspace_skill_dir(
                Path::new(&workspace_path),
                &plugin_slug,
                &skill_name,
            )
            .join("logs")
            .to_string_lossy()
            .into_owned(),
        ),
        runtime_provider: None,
    };

    // Resolve SDK cli.js path (same as run_workflow_step_inner does)
    if config.path_to_claude_code_executable.is_none() {
        if let Ok(cli_path) = sidecar::resolve_sdk_cli_path_public(&app) {
            config.path_to_claude_code_executable = Some(cli_path);
        }
    }

    log::debug!(
        "[run_answer_evaluator] starting one-shot request agent={} workspace_skill_dir={}",
        agent_id,
        config.workspace_skill_dir,
    );

    let transcript_log_dir = config.transcript_log_dir.clone();
    pool.send_request(
        &skill_name,
        &agent_id,
        config,
        &app,
        transcript_log_dir.as_deref(),
    )
    .await
    .map_err(|e| {
        log::error!(
            "[run_answer_evaluator] Failed to start one-shot request for agent={}: {}",
            agent_id,
            e
        );
        e
    })?;

    // Register active one-shot run so cancel_workflow_step can route cancel.
    {
        let mut map = runs.0.lock().map_err(|e| e.to_string())?;
        map.insert(agent_id.clone(), WorkflowStepRun { skill_name });
    }

    Ok(agent_id)
}

/// Cancel a running workflow step one-shot request by agent_id.
///
/// Looks up the sidecar skill key and sends a cancel message to the sidecar so
/// the current one-shot request AbortController fires.
#[tauri::command]
pub async fn cancel_workflow_step(
    agent_id: String,
    runs: tauri::State<'_, WorkflowStepRunManager>,
    pool: tauri::State<'_, SidecarPool>,
) -> Result<(), String> {
    log::info!("[cancel_workflow_step] agent={}", agent_id);
    let skill_name = {
        let map = runs.0.lock().map_err(|e| {
            log::error!(
                "[cancel_workflow_step] Failed to acquire session lock: {}",
                e
            );
            e.to_string()
        })?;
        let session = map.get(&agent_id).ok_or_else(|| {
            let msg = format!("No workflow step session found for agent_id={}", agent_id);
            log::warn!("[cancel_workflow_step] {}", msg);
            msg
        })?;
        session.skill_name.clone()
    };
    pool.send_cancel(&skill_name, &agent_id).await.map_err(|e| {
        log::warn!(
            "[cancel_workflow_step] Failed to send cancel for agent={}: {}",
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
