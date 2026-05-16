use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{Emitter, Listener, Manager};

use crate::agents::openhands_server;
use crate::agents::runtime_config::OpenHandsRuntimeConfig;
use crate::agents::skill_creator::{
    build_skill_creator_config, SkillCreatorIntent, SkillCreatorRuntimeContext, WorkflowStepKind,
};
use crate::db::Db;
use crate::skill_paths::validate_skill_content_exists;

use super::deploy::ensure_workspace_prompts;
use super::evaluation::workflow_step_log_name;
use super::guards::{
    check_decisions_guard_db, check_scope_recommendation_db, workflow_step_runtime_label,
};
use super::output_format::{
    extract_workflow_json_from_conversation_state, materialize_workflow_step_output_value,
};
use super::prompt::{
    build_evaluator_prompt, build_step0_prompt, build_step1_prompt, build_step2_prompt,
    build_step3_prompt, format_user_context,
};
use super::settings::{read_workflow_settings_by_skill_id, WorkflowSettings};
use super::step_config::{get_step_config, workflow_output_format_for_step};

// ─── Session management ──────────────────────────────────────────────────────

/// In-memory state for a single workflow turn.
/// Keyed by conversation_id in WorkflowStepRunManager.
pub struct WorkflowStepRun {
    pub skill_name: String,
    pub plugin_slug: String,
    pub conversation_id: String,
}

/// Manages active workflow step runs. Registered as Tauri managed state.
/// Allows runtime cleanup to look up the skill key for a given conversation.
pub struct WorkflowStepRunManager(pub Arc<Mutex<HashMap<String, WorkflowStepRun>>>);

impl WorkflowStepRunManager {
    pub fn new() -> Self {
        Self(Arc::new(Mutex::new(HashMap::new())))
    }
}

#[derive(Debug, Clone, Serialize)]
struct WorkflowStepMaterializedPayload {
    conversation_id: String,
    skill_name: String,
    step_id: u32,
    success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error_detail: Option<String>,
}

struct WorkflowMaterializationListeners {
    listener_ids: Vec<tauri::EventId>,
}

async fn dispatch_persistent_skill_turn(
    app: &tauri::AppHandle,
    config: OpenHandsRuntimeConfig,
    conversation_id: String,
) -> Result<String, String> {
    dispatch_persistent_skill_turn_with_runtime(
        config,
        conversation_id,
        |config, conversation_id| {
            Box::pin(async move {
                crate::agents::tracked_openhands::send_tracked_openhands_message(
                    app,
                    config,
                    conversation_id,
                )
                .await
                .map(|_| ())
            })
        },
    )
    .await
}

pub(crate) async fn dispatch_persistent_skill_turn_with_runtime<Send, SendFuture>(
    config: OpenHandsRuntimeConfig,
    conversation_id: String,
    send: Send,
) -> Result<String, String>
where
    Send: FnOnce(OpenHandsRuntimeConfig, String) -> SendFuture,
    SendFuture: std::future::Future<Output = Result<(), String>>,
{
    send(config, conversation_id.clone()).await?;
    Ok(conversation_id)
}

fn parse_target_conversation_state(
    payload: &str,
    target_conversation_id: &str,
) -> Option<serde_json::Value> {
    let value = serde_json::from_str::<serde_json::Value>(payload).ok()?;
    if value.get("conversation_id").and_then(|v| v.as_str()) != Some(target_conversation_id) {
        return None;
    }

    if let Some(message) = value.get("message") {
        if message.get("type").and_then(|v| v.as_str()) != Some("conversation_state") {
            return None;
        }

        let status = message.get("status").and_then(|v| v.as_str());
        if status == Some("completed") {
            let has_result_text = message
                .get("result_text")
                .or_else(|| message.get("resultText"))
                .and_then(|value| value.as_str())
                .map(|value| !value.trim().is_empty())
                .unwrap_or(false);
            if !has_result_text {
                return None;
            }
        }

        return match status {
            Some("completed" | "error" | "cancelled" | "canceled") => Some(message.clone()),
            _ => None,
        };
    }

    if value.get("type").and_then(|v| v.as_str()) != Some("run_result") {
        return None;
    }

    let status = value.get("status").and_then(|v| v.as_str())?;
    match status {
        "completed" | "error" | "cancelled" | "canceled" => {}
        _ => return None,
    }

    let error_detail = value
        .get("resultErrors")
        .and_then(|value| value.as_array())
        .map(|errors| {
            errors
                .iter()
                .filter_map(|error| error.as_str())
                .filter(|error| !error.trim().is_empty())
                .collect::<Vec<_>>()
                .join("\n")
        })
        .filter(|detail| !detail.is_empty());

    Some(serde_json::json!({
        "type": "conversation_state",
        "status": status,
        "result_text": value.get("resultText").cloned().unwrap_or(serde_json::Value::Null),
        "error_detail": error_detail,
    }))
}

fn listen_for_terminal_workflow_state(
    app: &tauri::AppHandle,
    tx: tokio::sync::mpsc::UnboundedSender<serde_json::Value>,
    conversation_id: &str,
    event_name: &'static str,
) -> tauri::EventId {
    let target_conversation_id = conversation_id.to_string();
    app.listen(event_name, move |event| {
        if let Some(state) =
            parse_target_conversation_state(event.payload(), &target_conversation_id)
        {
            let _ = tx.send(state);
        }
    })
}

fn install_workflow_step_materialization_listener(
    app: &tauri::AppHandle,
    runs: &WorkflowStepRunManager,
    conversation_id: &str,
    skill_id: i64,
    skill_name: &str,
    step_id: u32,
) -> WorkflowMaterializationListeners {
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<serde_json::Value>();
    let listener_ids = vec![
        listen_for_terminal_workflow_state(app, tx.clone(), conversation_id, "agent-message"),
        listen_for_terminal_workflow_state(app, tx.clone(), conversation_id, "agent-run-result"),
    ];

    let app_handle = app.clone();
    let runs_map = runs.0.clone();
    let conversation_id = conversation_id.to_string();
    let skill_name = skill_name.to_string();
    let skill_id_for_db = skill_id.to_string();
    let listener_ids_to_remove = listener_ids.clone();
    tokio::spawn(async move {
        let result = match rx.recv().await {
            Some(state) => {
                let db = app_handle.state::<Db>();
                let workflow_label = workflow_step_log_name(step_id as i32);
                extract_workflow_json_from_conversation_state(&state, &workflow_label)
                    .and_then(|payload| {
                        materialize_workflow_step_output_value(
                            db.inner(),
                            &skill_id_for_db,
                            step_id,
                            &payload,
                        )
                    })
                    .map_err(|err| {
                        format!(
                            "{} materialization failed: {}",
                            workflow_step_log_name(step_id as i32),
                            err
                        )
                    })
            }
            None => Err(format!(
                "{} materialization listener closed",
                workflow_step_log_name(step_id as i32)
            )),
        };

        for listener_id in listener_ids_to_remove {
            app_handle.unlisten(listener_id);
        }
        if let Ok(mut map) = runs_map.lock() {
            map.remove(&conversation_id);
        }

        let payload = WorkflowStepMaterializedPayload {
            conversation_id: conversation_id.clone(),
            skill_name,
            step_id,
            success: result.is_ok(),
            error_detail: result.err(),
        };
        if let Err(e) = app_handle.emit("workflow-step-materialized", &payload) {
            log::warn!(
                "[workflow_materialize] failed to emit event for conversation={} step_id={}: {}",
                conversation_id,
                step_id,
                e
            );
        }
    });

    WorkflowMaterializationListeners { listener_ids }
}

// ─── run_workflow_step_inner ─────────────────────────────────────────────────

/// Core logic for launching a single workflow step via a persistent skill turn.
/// Builds the prompt, constructs the runtime config, and starts the request.
/// Returns the conversation_id for the started workflow step run.
async fn run_workflow_step_inner(
    app: &tauri::AppHandle,
    runs: &WorkflowStepRunManager,
    skill_id: i64,
    skill_name: &str,
    step_id: u32,
    settings: &WorkflowSettings,
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
        settings.user_invocable,
        settings.disable_model_invocation,
        &settings.documents,
    )
    .unwrap_or_default();

    let skill_id_str = skill_id.to_string();
    let prompt = match step_id {
        0 => build_step0_prompt(
            skill_name,
            &settings.skills_path,
            &settings.plugin_slug,
            settings.max_dimensions,
            &user_context_block,
        ),
        1 => {
            let (clarifications_json, answer_verdicts_block) = {
                let conn = db.0.lock().map_err(|e| e.to_string())?;
                match crate::db::workflow_artifacts::read_clarifications(&conn, &skill_id_str) {
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
                &settings.skills_path,
                &settings.plugin_slug,
                &user_context_block,
                &clarifications_json,
                &answer_verdicts_block,
            )
        }
        2 => {
            let clarifications_json = {
                let conn = db.0.lock().map_err(|e| e.to_string())?;
                let clarifications =
                    crate::db::workflow_artifacts::read_clarifications(&conn, &skill_id_str)
                        .ok()
                        .flatten();
                let refinements =
                    crate::db::workflow_artifacts::read_refinements(&conn, &skill_id_str)
                        .ok()
                        .flatten();
                match clarifications {
                    Some(rec) => {
                        super::prompt::workflow_prompt_input_json_string(&rec, refinements.as_ref())
                    }
                    None => "{}".to_string(),
                }
            };
            build_step2_prompt(
                skill_name,
                &settings.skills_path,
                &settings.plugin_slug,
                &user_context_block,
                &clarifications_json,
            )
        }
        3 => {
            let (clarifications_json, decisions_json) = {
                let conn = db.0.lock().map_err(|e| e.to_string())?;
                let clar = match crate::db::workflow_artifacts::read_clarifications(
                    &conn,
                    &skill_id_str,
                ) {
                    Ok(Some(rec)) => super::prompt::clarifications_record_to_json_string(&rec),
                    _ => "{}".to_string(),
                };
                let dec = match crate::db::workflow_artifacts::read_decisions(&conn, &skill_id_str)
                {
                    Ok(Some(rec)) => super::prompt::decisions_record_to_json_string(&rec),
                    _ => "{}".to_string(),
                };
                (clar, dec)
            };
            build_step3_prompt(
                skill_name,
                &settings.skills_path,
                &settings.plugin_slug,
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
    log::info!(
        "run_workflow_step: skill={} step={} step_id={} runtime_label={} agent={} plugins={:?}",
        skill_name,
        workflow_step_log_name(step_id as i32),
        step_id,
        workflow_step_runtime_label(&step),
        agent_name,
        required_plugins,
    );

    log::debug!(
        "[run_workflow_step] output_format_configured={} step_id={}",
        workflow_output_format_for_step(step_id).is_some(),
        step_id
    );

    let app_data_root = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("failed to resolve app data dir: {e}"))?
        .to_string_lossy()
        .replace('\\', "/");

    let config = match step_id {
        0 => build_skill_creator_config(SkillCreatorRuntimeContext {
            app_data_root: app_data_root.clone(),
            skills_root: settings.skills_path.clone(),
            skill_name: skill_name.to_string(),
            plugin_slug: settings.plugin_slug.clone(),
            prompt,
            llm: settings.llm.clone(),
            intent: SkillCreatorIntent::WorkflowStep {
                step: WorkflowStepKind::Research,
            },
            skill_dir_override: None,
        }),
        1 => build_skill_creator_config(SkillCreatorRuntimeContext {
            app_data_root: app_data_root.clone(),
            skills_root: settings.skills_path.clone(),
            skill_name: skill_name.to_string(),
            plugin_slug: settings.plugin_slug.clone(),
            prompt,
            llm: settings.llm.clone(),
            intent: SkillCreatorIntent::WorkflowStep {
                step: WorkflowStepKind::DetailedResearch,
            },
            skill_dir_override: None,
        }),
        2 => build_skill_creator_config(SkillCreatorRuntimeContext {
            app_data_root: app_data_root.clone(),
            skills_root: settings.skills_path.clone(),
            skill_name: skill_name.to_string(),
            plugin_slug: settings.plugin_slug.clone(),
            prompt,
            llm: settings.llm.clone(),
            intent: SkillCreatorIntent::WorkflowStep {
                step: WorkflowStepKind::ConfirmDecisions,
            },
            skill_dir_override: None,
        }),
        3 => build_skill_creator_config(SkillCreatorRuntimeContext {
            app_data_root: app_data_root.clone(),
            skills_root: settings.skills_path.clone(),
            skill_name: skill_name.to_string(),
            plugin_slug: settings.plugin_slug.clone(),
            prompt,
            llm: settings.llm.clone(),
            intent: SkillCreatorIntent::WorkflowStep {
                step: WorkflowStepKind::GenerateSkill,
            },
            skill_dir_override: None,
        }),
        _ => {
            return Err(format!(
                "Invalid workflow step_id={step_id}: only steps 0-3 are valid"
            ));
        }
    };

    log::debug!(
        "[run_workflow_step] preparing persistent request skill_dir={}",
        config.skill_dir,
    );

    let session =
        crate::agents::skill_creator::ensure_skill_session(app, config.clone(), None).await?;
    let conversation_id = session.conversation_id;

    let materialization_listeners = Some(install_workflow_step_materialization_listener(
        app,
        runs,
        &conversation_id,
        skill_id,
        skill_name,
        step_id,
    ));

    // Register before dispatch so a fast terminal conversation_state can clean
    // up the active run entry through the backend materialization listener.
    {
        let mut map = runs.0.lock().map_err(|e| e.to_string())?;
        map.insert(
            conversation_id.clone(),
            WorkflowStepRun {
                skill_name: skill_name.to_string(),
                plugin_slug: settings.plugin_slug.clone(),
                conversation_id: conversation_id.clone(),
            },
        );
    }

    let start_result = dispatch_persistent_skill_turn(app, config, conversation_id.clone()).await;

    let conversation_id = start_result.map_err(|e| {
        log::error!(
            "[run_workflow_step] Failed to start persistent request for conversation={}: {}",
            conversation_id,
            e
        );
        if let Some(listeners) = materialization_listeners {
            for listener_id in listeners.listener_ids {
                app.unlisten(listener_id);
            }
        }
        if let Ok(mut map) = runs.0.lock() {
            map.remove(&conversation_id);
        }
        e
    })?;

    Ok(conversation_id)
}

#[tauri::command]
pub async fn run_workflow_step(
    app: tauri::AppHandle,
    db: tauri::State<'_, Db>,
    runs: tauri::State<'_, WorkflowStepRunManager>,
    skill_id: i64,
    skill_name: String,
    step_id: u32,
) -> Result<String, String> {
    log::info!(
        "[run_workflow_step] skill={} step={} step_id={}",
        skill_name,
        workflow_step_log_name(step_id as i32),
        step_id,
    );
    crate::commands::workflow_lifecycle::validate_run_request(&skill_name, step_id)?;

    let settings = read_workflow_settings_by_skill_id(&db, skill_id, &skill_name, step_id)?;
    log::info!(
        "[run_workflow_step] settings: skills_path={} purpose={} intake={} industry={:?} function={:?}",
        settings.skills_path,
        settings.purpose,
        settings.intake_json.is_some(),
        settings.industry,
        settings.function_role,
    );

    // Pause any stale workflow runs for this skill before starting a new step.
    let stale_runs: Vec<(String, String)> = {
        let map = runs.0.lock().map_err(|e| e.to_string())?;
        map.iter()
            .filter(|(_, s)| s.skill_name == skill_name && s.plugin_slug == settings.plugin_slug)
            .map(|(conversation_id, s)| (conversation_id.clone(), s.plugin_slug.clone()))
            .collect()
    };
    for (stale_conversation_id, stale_plugin_slug) in &stale_runs {
        log::info!(
            "[run_workflow_step] pausing stale workflow run conversation={} before starting step_id={}",
            stale_conversation_id,
            step_id,
        );
        let pause_result = crate::commands::skill_session::build_pause_runtime_config(
            &app,
            &db,
            &skill_name,
            stale_plugin_slug,
        );
        if let Ok(config) = pause_result {
            let _ = crate::agents::tracked_openhands::pause_tracked_openhands_conversation(
                config,
                stale_conversation_id,
            )
            .await;
        }
        openhands_server::close_local_openhands_run(stale_conversation_id);
    }
    if !stale_runs.is_empty() {
        let mut map = runs.0.lock().map_err(|e| e.to_string())?;
        for (stale_conversation_id, _) in &stale_runs {
            map.remove(stale_conversation_id);
        }
    }

    let skill_dir = crate::skill_paths::ensure_nested_skill_dir(
        Path::new(&settings.skills_path),
        &settings.plugin_slug,
        &skill_name,
    )
    .map_err(|e| format!("Failed to create skill dir: {}", e))?;
    std::fs::create_dir_all(&skill_dir)
        .map_err(|e| format!("Failed to create skill dir: {}", e))?;

    // Ensure OpenHands agent files exist after the skill directory is present;
    // deployment discovers skill directories before copying `.agents`.
    ensure_workspace_prompts(&app, &settings.skills_path).await?;

    // Gate: reject disabled steps when guard conditions are active.
    {
        let conn_guard = db.0.lock().map_err(|e| e.to_string())?;
        let skill_id_text = skill_id.to_string();
        if step_id >= 1 && check_scope_recommendation_db(&conn_guard, &skill_id_text) {
            return Err(format!(
                "{} is disabled: the research phase determined the skill scope is too broad.",
                workflow_step_log_name(step_id as i32)
            ));
        }
        if step_id >= 3 && check_decisions_guard_db(&conn_guard, &skill_id_text) {
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
            &skill_name,
            &settings.plugin_slug,
            step_id,
            &settings.skills_path,
        );
    }

    run_workflow_step_inner(
        &app,
        runs.inner(),
        skill_id,
        &skill_name,
        step_id,
        &settings,
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
/// Returns the conversation ID for the frontend to subscribe to completion events.
#[tauri::command]
pub async fn run_answer_evaluator(
    app: tauri::AppHandle,
    db: tauri::State<'_, Db>,
    runs: tauri::State<'_, WorkflowStepRunManager>,
    skill_id: i64,
    skill_name: String,
) -> Result<String, String> {
    log::info!("run_answer_evaluator: skill={}", skill_name);

    let settings = read_workflow_settings_by_skill_id(&db, skill_id, &skill_name, 0)?;

    // Validate that the skill has published content before running the evaluator.
    validate_skill_content_exists(
        Path::new(&settings.skills_path),
        &settings.plugin_slug,
        &skill_name,
    )?;

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
        settings.user_invocable,
        settings.disable_model_invocation,
        &settings.documents,
    )
    .unwrap_or_default();

    let clarifications_json = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let skill_id_str = skill_id.to_string();
        let clarifications =
            crate::db::workflow_artifacts::read_clarifications(&conn, &skill_id_str)
                .ok()
                .flatten();
        let refinements = crate::db::workflow_artifacts::read_refinements(&conn, &skill_id_str)
            .ok()
            .flatten();
        match clarifications {
            Some(rec) => {
                super::prompt::workflow_prompt_input_json_string(&rec, refinements.as_ref())
            }
            None => "{}".to_string(),
        }
    };

    let prompt = build_evaluator_prompt(
        &skill_name,
        &settings.skills_path,
        &settings.plugin_slug,
        &user_context_block,
        &clarifications_json,
    );

    log::debug!("run_answer_evaluator: prompt={}", prompt);
    log::info!(
        "run_answer_evaluator: skill={} agent=skill-creator task=workflow.answer_evaluator",
        skill_name
    );

    let app_data_root = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("failed to resolve app data dir: {e}"))?
        .to_string_lossy()
        .replace('\\', "/");

    let config = build_skill_creator_config(SkillCreatorRuntimeContext {
        app_data_root,
        skills_root: settings.skills_path.clone(),
        skill_name: skill_name.clone(),
        plugin_slug: settings.plugin_slug.clone(),
        prompt,
        llm: settings.llm,
        intent: SkillCreatorIntent::AnswerEvaluator,
        skill_dir_override: None,
    });

    log::debug!(
        "[run_answer_evaluator] preparing persistent request skill_dir={}",
        config.skill_dir,
    );

    let session =
        crate::agents::skill_creator::ensure_skill_session(&app, config.clone(), None).await?;
    let conversation_id = session.conversation_id;

    {
        let mut map = runs.0.lock().map_err(|e| e.to_string())?;
        map.insert(
            conversation_id.clone(),
            WorkflowStepRun {
                skill_name: skill_name.clone(),
                plugin_slug: settings.plugin_slug.clone(),
                conversation_id: conversation_id.clone(),
            },
        );
    }

    let conversation_id = dispatch_persistent_skill_turn(&app, config, conversation_id.clone())
        .await
        .map_err(|e| {
            log::error!(
                "[run_answer_evaluator] Failed to start persistent request for conversation={}: {}",
                conversation_id,
                e
            );
            if let Ok(mut map) = runs.0.lock() {
                map.remove(&conversation_id);
            }
            e
        })?;

    Ok(conversation_id)
}

/// Cancel a running workflow step request by agent_id.
///
/// Cancels an active workflow request. OpenHands requests are killed
/// through the direct Rust runner registry.
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

#[cfg(test)]
mod tests {
    use super::parse_target_conversation_state;

    #[test]
    fn parse_target_conversation_state_accepts_completed_agent_message() {
        let payload = serde_json::json!({
            "conversation_id": "conv-1",
            "message": {
                "type": "conversation_state",
                "status": "completed",
                "result_text": "{\"status\":\"research_complete\",\"research_output\":{\"sections\":[]}}"
            }
        })
        .to_string();

        let state = parse_target_conversation_state(&payload, "conv-1")
            .expect("completed conversation_state should be accepted");

        assert_eq!(
            state.get("type").and_then(|value| value.as_str()),
            Some("conversation_state")
        );
        assert_eq!(
            state.get("status").and_then(|value| value.as_str()),
            Some("completed")
        );
    }

    #[test]
    fn parse_target_conversation_state_skips_completed_agent_message_without_result_text() {
        let payload = serde_json::json!({
            "conversation_id": "conv-1",
            "message": {
                "type": "conversation_state",
                "status": "completed",
                "result_text": null
            }
        })
        .to_string();

        let state = parse_target_conversation_state(&payload, "conv-1");

        assert!(state.is_none());
    }

    #[test]
    fn parse_target_conversation_state_accepts_completed_run_result() {
        let payload = serde_json::json!({
            "conversation_id": "conv-1",
            "timestamp": 123_u64,
            "type": "run_result",
            "status": "completed",
            "resultText": "{\"status\":\"research_complete\",\"research_output\":{\"sections\":[]}}",
            "resultErrors": null
        })
        .to_string();

        let state = parse_target_conversation_state(&payload, "conv-1")
            .expect("completed run_result should be accepted");

        assert_eq!(
            state.get("type").and_then(|value| value.as_str()),
            Some("conversation_state")
        );
        assert_eq!(
            state.get("status").and_then(|value| value.as_str()),
            Some("completed")
        );
        assert_eq!(
            state.get("result_text").and_then(|value| value.as_str()),
            Some("{\"status\":\"research_complete\",\"research_output\":{\"sections\":[]}}")
        );
    }
}
