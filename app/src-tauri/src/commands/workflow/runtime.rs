use std::path::Path;

use crate::agents::sidecar::{self, SidecarConfig};
use crate::agents::sidecar_pool::SidecarPool;
use crate::db::Db;

use super::deploy::{
    deploy_skill_for_workflow, ensure_workspace_prompts, resolve_bundled_skills_dir,
};
use super::evaluation::workflow_step_log_name;
use super::guards::{
    derive_agent_name, make_agent_id, parse_decisions_guard, parse_scope_recommendation,
    workflow_step_runtime_label,
};
use super::output_format::answer_evaluator_output_format;
use super::prompt::{build_evaluator_prompt, build_prompt};
use super::settings::{read_workflow_settings, WorkflowSettings};
use super::step_config::{
    build_betas, get_step_config, required_plugins_for_workflow_step, resolve_model_id,
    thinking_budget_for_step, workflow_output_format_for_agent,
};
use super::user_context::write_user_context_file;

/// Core logic for launching a single workflow step. Builds the prompt,
/// constructs the sidecar config, and spawns the agent. Returns the agent_id.
///
/// Used by `run_workflow_step` to avoid duplicating step logic.
async fn run_workflow_step_inner(
    app: &tauri::AppHandle,
    pool: &SidecarPool,
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
        skill_name,
        &settings.tags,
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
    );

    let prompt = build_prompt(
        skill_name,
        workspace_path,
        &settings.skills_path,
        settings.author_login.as_deref(),
        settings.created_at.as_deref(),
        settings.max_dimensions,
    );
    log::debug!(
        "[run_workflow_step] prompt for step={} step_id={}: {}",
        workflow_step_log_name(step_id as i32),
        step_id,
        prompt
    );

    let agent_name = derive_agent_name(workspace_path, &settings.purpose, &step.prompt_template);
    let agent_id = make_agent_id(skill_name, &workflow_step_runtime_label(&step));
    log::info!(
        "run_workflow_step: skill={} step={} step_id={} model={}",
        skill_name,
        workflow_step_log_name(step_id as i32),
        step_id,
        settings.preferred_model
    );

    let required_plugins = required_plugins_for_workflow_step(step_id);

    let config = SidecarConfig {
        prompt,
        model: None,
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
        fallback_model: settings.fallback_model.clone(),
        effort: settings.sdk_effort.clone(),
        output_format: workflow_output_format_for_agent(&agent_name),
        prompt_suggestions: None,
        path_to_claude_code_executable: None,
        agent_name: Some(agent_name),
        required_plugins,
        conversation_history: None,
        skill_name: Some(skill_name.to_string()),
        step_id: Some(step_id as i32),
        workflow_session_id,
        usage_session_id: None,
        run_source: Some("workflow".to_string()),
    };

    sidecar::spawn_sidecar(
        agent_id.clone(),
        config,
        pool.clone(),
        app.clone(),
        skill_name.to_string(),
        None,
    )
    .await?;

    Ok(agent_id)
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn run_workflow_step(
    app: tauri::AppHandle,
    pool: tauri::State<'_, SidecarPool>,
    db: tauri::State<'_, Db>,
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
    // Ensure prompt files exist in workspace before running
    ensure_workspace_prompts(&app, &workspace_path).await?;

    // Deploy purpose-resolved bundled skills.
    // Research is plugin-owned; validate-skill is agent-only (no SKILL.md to deploy).
    {
        let bundled_skills_dir = resolve_bundled_skills_dir(&app);
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        deploy_skill_for_workflow(
            &conn,
            &workspace_path,
            &bundled_skills_dir,
            "skill-creator",
            "skill-building",
        );
    }

    let settings = read_workflow_settings(&db, &skill_name, step_id, &workspace_path)?;
    log::info!(
        "[run_workflow_step] settings: skills_path={} purpose={} intake={} industry={:?} function={:?}",
        settings.skills_path, settings.purpose,
        settings.intake_json.is_some(),
        settings.industry, settings.function_role,
    );

    // Gate: reject disabled steps when guard conditions are active
    let context_dir = Path::new(&workspace_path).join(&skill_name).join("context");

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

    // Step 0 fresh start — wipe the context directory and all artifacts so
    // the agent doesn't see stale files from a previous workflow run.
    // Context lives in workspace_path.
    if step_id == 0 && context_dir.is_dir() {
        log::debug!(
            "[run_workflow_step] step={} step_id=0 wiping context dir {}",
            workflow_step_log_name(0),
            context_dir.display()
        );
        let _ = std::fs::remove_dir_all(&context_dir);
        let _ = std::fs::create_dir_all(&context_dir);
    }

    run_workflow_step_inner(
        &app,
        pool.inner(),
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
    let (api_key, skills_path, industry, function_role, intake_json, preferred_model) = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let settings = crate::db::read_settings_hydrated(&conn).map_err(|e| {
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
        // Answer evaluator is a lightweight gate — always use Haiku for cost efficiency.
        let model = resolve_model_id("haiku");
        (
            key,
            sp,
            settings.industry,
            settings.function_role,
            ij,
            model,
        )
    };

    // Write user-context.md so the agent can read it (same as workflow steps)
    write_user_context_file(
        &workspace_path,
        &skill_name,
        &[], // answer evaluator doesn't need full metadata
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
    );

    let prompt = build_evaluator_prompt(&skill_name, &workspace_path, &skills_path);

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
        allowed_tools: Some(vec!["Read".to_string()]),
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
    };

    sidecar::spawn_sidecar(
        agent_id.clone(),
        config,
        pool.inner().clone(),
        app.clone(),
        skill_name,
        None,
    )
    .await?;

    Ok(agent_id)
}

/// Log the user's gate decision so it appears in the backend log stream.
#[tauri::command]
pub fn log_gate_decision(skill_name: String, verdict: String, decision: String) {
    log::info!(
        "gate_decision: skill={} verdict={} decision={}",
        skill_name,
        verdict,
        decision
    );
}
