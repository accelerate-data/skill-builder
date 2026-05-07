use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{Emitter, Listener, Manager};

use crate::agents::openhands_server;
use crate::agents::sidecar::{OpenHandsRuntimeConfigParams, SidecarConfig};
use crate::db::Db;
use crate::skill_paths::resolve_workspace_skill_dir;

use super::deploy::ensure_workspace_prompts;
use super::evaluation::workflow_step_log_name;
use super::guards::{
    check_decisions_guard_db, check_scope_recommendation_db, make_agent_id,
    workflow_step_runtime_label,
};
use super::output_format::{
    answer_evaluator_output_format, extract_research_json_from_conversation_state,
    materialize_workflow_step_output_value,
};
use super::prompt::{
    build_evaluator_prompt, build_step0_prompt, build_step1_prompt, build_step2_prompt,
    build_step3_prompt, format_user_context,
};
use super::settings::{read_workflow_settings, WorkflowSettings};
use super::step_config::{
    confirm_decisions_workflow_tools, get_step_config, research_workflow_tools,
    skill_generation_workflow_tools, workflow_output_format_for_step,
};

// ─── Session management ──────────────────────────────────────────────────────

/// In-memory state for a single workflow turn.
/// Keyed by agent_id in WorkflowStepRunManager.
pub struct WorkflowStepRun {
    pub skill_name: String,
}

/// Manages active workflow step runs. Registered as Tauri managed state.
/// Allows `cancel_workflow_step` to look up the skill key for a given agent.
pub struct WorkflowStepRunManager(pub Arc<Mutex<HashMap<String, WorkflowStepRun>>>);

impl WorkflowStepRunManager {
    pub fn new() -> Self {
        Self(Arc::new(Mutex::new(HashMap::new())))
    }
}

#[derive(Debug, Clone, Serialize)]
struct WorkflowStepMaterializedPayload {
    agent_id: String,
    skill_name: String,
    step_id: u32,
    success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error_detail: Option<String>,
}

pub(crate) fn build_workflow_research_sidecar_config(
    skill_name: &str,
    prompt: &str,
    workspace_path: &str,
    plugin_slug: &str,
    llm: crate::types::WorkflowLlmConfig,
    workflow_session_id: Option<String>,
) -> SidecarConfig {
    build_skill_creator_workflow_sidecar_config(SkillCreatorWorkflowConfigParams {
        skill_name,
        prompt,
        workspace_path,
        plugin_slug,
        llm,
        workflow_session_id,
        step_id: 0,
        task_kind: "workflow.research",
        allowed_tools: research_workflow_tools(),
        max_turns: 50,
    })
}

pub(crate) fn build_workflow_detailed_research_sidecar_config(
    skill_name: &str,
    prompt: &str,
    workspace_path: &str,
    plugin_slug: &str,
    llm: crate::types::WorkflowLlmConfig,
    workflow_session_id: Option<String>,
) -> SidecarConfig {
    build_skill_creator_workflow_sidecar_config(SkillCreatorWorkflowConfigParams {
        skill_name,
        prompt,
        workspace_path,
        plugin_slug,
        llm,
        workflow_session_id,
        step_id: 1,
        task_kind: "workflow.detailed_research",
        allowed_tools: research_workflow_tools(),
        max_turns: 50,
    })
}

pub(crate) fn build_workflow_confirm_decisions_sidecar_config(
    skill_name: &str,
    prompt: &str,
    workspace_path: &str,
    plugin_slug: &str,
    llm: crate::types::WorkflowLlmConfig,
    workflow_session_id: Option<String>,
) -> SidecarConfig {
    build_skill_creator_workflow_sidecar_config(SkillCreatorWorkflowConfigParams {
        skill_name,
        prompt,
        workspace_path,
        plugin_slug,
        llm,
        workflow_session_id,
        step_id: 2,
        task_kind: "workflow.confirm_decisions",
        allowed_tools: confirm_decisions_workflow_tools(),
        max_turns: 100,
    })
}

pub(crate) fn build_workflow_generate_skill_sidecar_config(
    skill_name: &str,
    prompt: &str,
    workspace_path: &str,
    plugin_slug: &str,
    llm: crate::types::WorkflowLlmConfig,
    workflow_session_id: Option<String>,
) -> SidecarConfig {
    build_skill_creator_workflow_sidecar_config(SkillCreatorWorkflowConfigParams {
        skill_name,
        prompt,
        workspace_path,
        plugin_slug,
        llm,
        workflow_session_id,
        step_id: 3,
        task_kind: "workflow.skill_generation",
        allowed_tools: skill_generation_workflow_tools(),
        max_turns: 500,
    })
}

struct SkillCreatorWorkflowConfigParams<'a> {
    skill_name: &'a str,
    prompt: &'a str,
    workspace_path: &'a str,
    plugin_slug: &'a str,
    llm: crate::types::WorkflowLlmConfig,
    workflow_session_id: Option<String>,
    step_id: u32,
    task_kind: &'a str,
    allowed_tools: Vec<String>,
    max_turns: u32,
}

fn build_skill_creator_workflow_sidecar_config(
    params: SkillCreatorWorkflowConfigParams<'_>,
) -> SidecarConfig {
    let SkillCreatorWorkflowConfigParams {
        skill_name,
        prompt,
        workspace_path,
        plugin_slug,
        llm,
        workflow_session_id,
        step_id,
        task_kind,
        allowed_tools,
        max_turns,
    } = params;

    let workspace_root_dir = workspace_path.replace('\\', "/");
    let workspace_run_dir =
        resolve_workspace_skill_dir(Path::new(workspace_path), plugin_slug, skill_name)
            .to_string_lossy()
            .replace('\\', "/");

    let mut config =
        crate::agents::sidecar::build_openhands_runtime_config(OpenHandsRuntimeConfigParams {
            prompt: prompt.to_string(),
            llm,
            workspace_root_dir,
            workspace_run_dir,
            agent_name: "skill-creator".to_string(),
            task_kind: Some(task_kind.to_string()),
            user_message_suffix: Some(SKILL_CREATOR_USER_SUFFIX.trim().to_string()),
            allowed_tools,
            max_turns,
            output_format: workflow_output_format_for_step(step_id),
            skill_name: Some(skill_name.to_string()),
            step_id: Some(step_id as i32),
            run_source: Some("workflow".to_string()),
            plugin_slug: plugin_slug.to_string(),
        });
    config.workflow_session_id = workflow_session_id;
    config
}

pub(crate) fn build_answer_evaluator_sidecar_config(
    skill_name: &str,
    prompt: &str,
    workspace_path: &str,
    plugin_slug: &str,
    llm: crate::types::WorkflowLlmConfig,
) -> SidecarConfig {
    let workspace_root_dir = workspace_path.replace('\\', "/");
    let workspace_run_dir =
        resolve_workspace_skill_dir(Path::new(workspace_path), plugin_slug, skill_name)
            .to_string_lossy()
            .replace('\\', "/");

    crate::agents::sidecar::build_openhands_runtime_config(OpenHandsRuntimeConfigParams {
        prompt: prompt.to_string(),
        llm,
        workspace_root_dir,
        workspace_run_dir,
        agent_name: "skill-creator".to_string(),
        task_kind: Some("workflow.answer_evaluator".to_string()),
        user_message_suffix: Some(SKILL_CREATOR_USER_SUFFIX.trim().to_string()),
        allowed_tools: crate::commands::workflow::step_config::answer_evaluator_workflow_tools(),
        max_turns: 20,
        output_format: Some(answer_evaluator_output_format()),
        skill_name: Some(skill_name.to_string()),
        step_id: None,
        run_source: Some("gate-eval".to_string()),
        plugin_slug: plugin_slug.to_string(),
    })
}

async fn dispatch_persistent_skill_turn(
    app: &tauri::AppHandle,
    agent_id: &str,
    config: SidecarConfig,
) -> Result<String, String> {
    crate::agents::openhands_server::start_openhands_session(app, agent_id, config, None).await
}

const SKILL_CREATOR_USER_SUFFIX: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../agent-sources/prompts/skill-creator-user-suffix.txt"
));

fn parse_target_conversation_state(
    payload: &str,
    target_agent_id: &str,
) -> Option<serde_json::Value> {
    let value = serde_json::from_str::<serde_json::Value>(payload).ok()?;
    if value.get("agent_id").and_then(|v| v.as_str()) != Some(target_agent_id) {
        return None;
    }

    let message = value.get("message")?;
    if message.get("type").and_then(|v| v.as_str()) != Some("conversation_state") {
        return None;
    }

    match message.get("status").and_then(|v| v.as_str()) {
        Some("completed" | "error" | "cancelled" | "canceled") => Some(message.clone()),
        _ => None,
    }
}

fn install_research_materialization_listener(
    app: &tauri::AppHandle,
    runs: &WorkflowStepRunManager,
    agent_id: &str,
    skill_name: &str,
) -> tauri::EventId {
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<serde_json::Value>();
    let target_agent_id = agent_id.to_string();
    let tx_message = tx.clone();
    let listener_id = app.listen("agent-message", move |event| {
        if let Some(state) = parse_target_conversation_state(event.payload(), &target_agent_id) {
            let _ = tx_message.send(state);
        }
    });

    let app_handle = app.clone();
    let runs_map = runs.0.clone();
    let listener_to_remove = listener_id;
    let agent_id = agent_id.to_string();
    let skill_name = skill_name.to_string();
    let skill_id_for_db = skill_name.clone();
    tokio::spawn(async move {
        let result = match rx.recv().await {
            Some(state) => {
                let db = app_handle.state::<Db>();
                extract_research_json_from_conversation_state(&state).and_then(|payload| {
                    materialize_workflow_step_output_value(
                        db.inner(),
                        &skill_id_for_db,
                        0,
                        &payload,
                    )
                })
            }
            None => Err("Workflow research materialization listener closed".to_string()),
        };

        app_handle.unlisten(listener_to_remove);
        if let Ok(mut map) = runs_map.lock() {
            map.remove(&agent_id);
        }

        let payload = WorkflowStepMaterializedPayload {
            agent_id: agent_id.clone(),
            skill_name,
            step_id: 0,
            success: result.is_ok(),
            error_detail: result.err(),
        };
        if let Err(e) = app_handle.emit("workflow-step-materialized", &payload) {
            log::warn!(
                "[workflow_research_materialize] failed to emit event for agent={}: {}",
                agent_id,
                e
            );
        }
    });

    listener_id
}

// ─── run_workflow_step_inner ─────────────────────────────────────────────────

/// Core logic for launching a single workflow step via a persistent skill turn.
/// Builds the prompt, constructs the runtime config, and starts the request.
/// Returns the agent_id, which is also the OpenHands request_id.
#[allow(clippy::too_many_arguments)]
async fn run_workflow_step_inner(
    app: &tauri::AppHandle,
    runs: &WorkflowStepRunManager,
    skill_name: &str,
    step_id: u32,
    workspace_path: &str,
    settings: &WorkflowSettings,
    workflow_session_id: Option<String>,
    db: &Db,
) -> Result<String, String> {
    let step = get_step_config(step_id)?;

    // Build user context block — inline skill metadata injects into all steps.
    let user_context_block = super::prompt::format_user_context(
        Some(skill_name),
        &settings.tags,
        settings.author_login.as_deref(),
        settings.industry.as_deref(),
        settings.function_role.as_deref(),
        settings.intake_json.as_deref(),
        settings.description.as_deref(),
        Some(&settings.purpose),
        settings.version.as_deref(),
        settings.skill_model.as_deref(),
        settings.argument_hint.as_deref(),
        settings.user_invocable,
        settings.disable_model_invocation,
        &settings.documents,
    )
    .unwrap_or_default();

    let prompt = match step_id {
        0 => build_step0_prompt(
            skill_name,
            workspace_path,
            &settings.plugin_slug,
            settings.max_dimensions,
            &user_context_block,
        ),
        1 => {
            let (clarifications_json, answer_verdicts_block) = {
                let conn = db.0.lock().map_err(|e| e.to_string())?;
                match crate::db::workflow_artifacts::read_clarifications(&conn, skill_name) {
                    Ok(Some(rec)) => {
                        let json_str = super::prompt::clarifications_record_to_json_string(&rec);
                        let verdicts = super::prompt::render_answer_verdicts(&rec);
                        (json_str, verdicts)
                    }
                    _ => (
                        "{}".to_string(),
                        "No evaluation verdicts available. Treat all answers as unevaluated."
                            .to_string(),
                    ),
                }
            };
            build_step1_prompt(
                skill_name,
                workspace_path,
                &settings.plugin_slug,
                &user_context_block,
                &clarifications_json,
                &answer_verdicts_block,
            )
        }
        2 => {
            let clarifications_json = {
                let conn = db.0.lock().map_err(|e| e.to_string())?;
                match crate::db::workflow_artifacts::read_clarifications(&conn, skill_name) {
                    Ok(Some(rec)) => super::prompt::clarifications_record_to_json_string(&rec),
                    _ => "{}".to_string(),
                }
            };
            build_step2_prompt(
                skill_name,
                workspace_path,
                &settings.plugin_slug,
                &user_context_block,
                &clarifications_json,
            )
        }
        3 => {
            let (clarifications_json, decisions_json) = {
                let conn = db.0.lock().map_err(|e| e.to_string())?;
                let clar =
                    match crate::db::workflow_artifacts::read_clarifications(&conn, skill_name) {
                        Ok(Some(rec)) => super::prompt::clarifications_record_to_json_string(&rec),
                        _ => "{}".to_string(),
                    };
                let dec = match crate::db::workflow_artifacts::read_decisions(&conn, skill_name) {
                    Ok(Some(rec)) => super::prompt::decisions_record_to_json_string(&rec),
                    _ => "{}".to_string(),
                };
                (clar, dec)
            };
            build_step3_prompt(
                skill_name,
                workspace_path,
                &settings.plugin_slug,
                &settings.skills_path,
                settings.author_login.as_deref(),
                settings.created_at.as_deref(),
                &user_context_block,
                &clarifications_json,
                &decisions_json,
            )
        }
        _ => return Err(format!("unknown step_id: {step_id}")),
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

    log::debug!(
        "[run_workflow_step] output_format_configured={} step_id={}",
        workflow_output_format_for_step(step_id).is_some(),
        step_id
    );

    let config = match step_id {
        0 => build_workflow_research_sidecar_config(
            skill_name,
            &prompt,
            workspace_path,
            &settings.plugin_slug,
            settings.llm.clone(),
            workflow_session_id,
        ),
        1 => build_workflow_detailed_research_sidecar_config(
            skill_name,
            &prompt,
            workspace_path,
            &settings.plugin_slug,
            settings.llm.clone(),
            workflow_session_id,
        ),
        2 => build_workflow_confirm_decisions_sidecar_config(
            skill_name,
            &prompt,
            workspace_path,
            &settings.plugin_slug,
            settings.llm.clone(),
            workflow_session_id,
        ),
        3 => build_workflow_generate_skill_sidecar_config(
            skill_name,
            &prompt,
            workspace_path,
            &settings.plugin_slug,
            settings.llm.clone(),
            workflow_session_id,
        ),
        _ => {
            return Err(format!(
                "Invalid workflow step_id={step_id}: only steps 0-3 are valid"
            ));
        }
    };

    log::debug!(
        "[run_workflow_step] starting persistent request agent={} workspace_skill_dir={}",
        agent_id,
        config.workspace_skill_dir,
    );

    let materialization_listener = if step_id == 0 {
        Some(install_research_materialization_listener(
            app, runs, &agent_id, skill_name,
        ))
    } else {
        None
    };

    // Register before dispatch so a fast terminal conversation_state can clean
    // up the active run entry through the backend materialization listener.
    {
        let mut map = runs.0.lock().map_err(|e| e.to_string())?;
        map.insert(
            agent_id.clone(),
            WorkflowStepRun {
                skill_name: skill_name.to_string(),
            },
        );
    }

    let start_result = dispatch_persistent_skill_turn(app, &agent_id, config).await;

    start_result.map_err(|e| {
        log::error!(
            "[run_workflow_step] Failed to start persistent request for agent={}: {}",
            agent_id,
            e
        );
        if let Some(listener_id) = materialization_listener {
            app.unlisten(listener_id);
        }
        if let Ok(mut map) = runs.0.lock() {
            map.remove(&agent_id);
        }
        e
    })?;

    Ok(agent_id)
}

#[tauri::command]
pub async fn run_workflow_step(
    app: tauri::AppHandle,
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

    // Cancel any stale workflow requests for this skill before starting a new step.
    let stale_runs: Vec<String> = {
        let map = runs.0.lock().map_err(|e| e.to_string())?;
        map.iter()
            .filter(|(_, s)| s.skill_name == skill_name)
            .map(|(agent_id, _)| agent_id.clone())
            .collect()
    };
    for stale_agent_id in &stale_runs {
        log::info!(
            "[run_workflow_step] canceling stale workflow run agent={} before starting step_id={}",
            stale_agent_id,
            step_id,
        );
        openhands_server::pause_openhands_session(stale_agent_id);
    }
    if !stale_runs.is_empty() {
        let mut map = runs.0.lock().map_err(|e| e.to_string())?;
        for stale_agent_id in &stale_runs {
            map.remove(stale_agent_id);
        }
    }

    let settings = read_workflow_settings(&db, &skill_name, step_id, &workspace_path)?;
    log::info!(
        "[run_workflow_step] settings: skills_path={} purpose={} intake={} industry={:?} function={:?}",
        settings.skills_path,
        settings.purpose,
        settings.intake_json.is_some(),
        settings.industry,
        settings.function_role,
    );

    let workspace_skill_dir = crate::skill_paths::workspace_skill_dir(
        Path::new(&workspace_path),
        &settings.plugin_slug,
        &skill_name,
    );
    std::fs::create_dir_all(&workspace_skill_dir)
        .map_err(|e| format!("Failed to create workspace skill dir: {}", e))?;

    // Ensure OpenHands agent files exist after the skill directory is present;
    // deployment discovers workspace skill directories before copying `.agents`.
    ensure_workspace_prompts(&app, &workspace_path).await?;

    // Gate: reject disabled steps when guard conditions are active.
    {
        let conn_guard = db.0.lock().map_err(|e| e.to_string())?;
        if step_id >= 1 && check_scope_recommendation_db(&conn_guard, &skill_name) {
            return Err(format!(
                "{} is disabled: the research phase determined the skill scope is too broad.",
                workflow_step_log_name(step_id as i32)
            ));
        }
        if step_id >= 3 && check_decisions_guard_db(&conn_guard, &skill_name) {
            return Err(format!(
                "{} is disabled: the decisions agent found unresolvable contradictions.",
                workflow_step_log_name(step_id as i32)
            ));
        }
    }

    // Clean stale artifacts before the agent runs so it starts from a
    // known-clean state. VU-1157 dropped the workspace-side `context/` reset
    // (clarifications/decisions are DB-backed and overwritten transactionally
    // on each step boundary). Step 0 still calls `delete_step_output_files`
    // for any other downstream output (e.g. SKILL.md). Steps 1-3 clean only
    // their own output. Rewrite mode goes through the refine command.
    if step_id == 0 {
        log::debug!(
            "[run_workflow_step] step=0 full cleanup for skill={}",
            skill_name
        );
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
        runs.inner(),
        &skill_name,
        step_id,
        &workspace_path,
        &settings,
        workflow_session_id,
        db.inner(),
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

// ─── run_answer_evaluator ────────────────────────────────────────────────────

/// Run the answer-evaluator agent as a persistent skill turn.
///
/// Returns the agent ID for the frontend to subscribe to completion events.
#[tauri::command]
pub async fn run_answer_evaluator(
    app: tauri::AppHandle,
    db: tauri::State<'_, Db>,
    runs: tauri::State<'_, WorkflowStepRunManager>,
    skill_name: String,
    workspace_path: String,
) -> Result<String, String> {
    log::info!("run_answer_evaluator: skill={}", skill_name);

    // Ensure agent files are deployed to workspace
    ensure_workspace_prompts(&app, &workspace_path).await?;

    let settings = read_workflow_settings(&db, &skill_name, 0, &workspace_path)?;

    let user_context_block = format_user_context(
        Some(&skill_name),
        &settings.tags,
        settings.author_login.as_deref(),
        settings.industry.as_deref(),
        settings.function_role.as_deref(),
        settings.intake_json.as_deref(),
        settings.description.as_deref(),
        Some(&settings.purpose),
        settings.version.as_deref(),
        settings.skill_model.as_deref(),
        settings.argument_hint.as_deref(),
        settings.user_invocable,
        settings.disable_model_invocation,
        &settings.documents,
    )
    .unwrap_or_default();

    let clarifications_json = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        match crate::db::workflow_artifacts::read_clarifications(&conn, &skill_name) {
            Ok(Some(rec)) => super::prompt::clarifications_record_to_json_string(&rec),
            _ => "{}".to_string(),
        }
    };

    let prompt = build_evaluator_prompt(
        &skill_name,
        &workspace_path,
        &settings.plugin_slug,
        &settings.skills_path,
        &user_context_block,
        &clarifications_json,
    );

    log::debug!("run_answer_evaluator: prompt={}", prompt);
    log::info!(
        "run_answer_evaluator: skill={} agent=skill-creator task=workflow.answer_evaluator",
        skill_name
    );

    let agent_id = make_agent_id(&skill_name, "gate-eval");

    let config = build_answer_evaluator_sidecar_config(
        &skill_name,
        &prompt,
        &workspace_path,
        &settings.plugin_slug,
        settings.llm,
    );

    log::debug!(
        "[run_answer_evaluator] starting persistent request agent={} workspace_skill_dir={}",
        agent_id,
        config.workspace_skill_dir,
    );

    // Register before dispatch so cancellation can route to the native OpenHands
    // runner even if the user cancels immediately after the command returns.
    {
        let mut map = runs.0.lock().map_err(|e| e.to_string())?;
        map.insert(
            agent_id.clone(),
            WorkflowStepRun {
                skill_name: skill_name.clone(),
            },
        );
    }

    dispatch_persistent_skill_turn(&app, &agent_id, config)
        .await
        .map_err(|e| {
            log::error!(
                "[run_answer_evaluator] Failed to start persistent request for agent={}: {}",
                agent_id,
                e
            );
            if let Ok(mut map) = runs.0.lock() {
                map.remove(&agent_id);
            }
            e
        })?;

    Ok(agent_id)
}

/// Cancel a running workflow step request by agent_id.
///
/// Cancels an active workflow request. OpenHands requests are killed
/// through the direct Rust runner registry.
#[tauri::command]
pub async fn cancel_workflow_step(
    agent_id: String,
    runs: tauri::State<'_, WorkflowStepRunManager>,
) -> Result<(), String> {
    log::info!("[cancel_workflow_step] agent={}", agent_id);
    {
        let map = runs.0.lock().map_err(|e| {
            log::error!(
                "[cancel_workflow_step] Failed to acquire session lock: {}",
                e
            );
            e.to_string()
        })?;
        if map.get(&agent_id).is_none() {
            let msg = format!("No workflow step session found for agent_id={}", agent_id);
            log::warn!("[cancel_workflow_step] {}", msg);
            return Err(msg);
        }
    }
    openhands_server::pause_openhands_session(&agent_id);
    Ok(())
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
