use std::path::Path;

use crate::agents::sidecar::SidecarConfig;
use crate::commands::workflow::{resolve_model_id, tools_for_agent};
use crate::db::{self, Db};
use crate::types::SecretString;

pub(super) const VALIDATE_AGENT_NAME: &str = "skill-creator:validate-skill";
pub(super) const REWRITE_AGENT_NAME: &str = "skill-creator:rewrite-skill";
pub(super) const BENCHMARK_AGENT_NAME: &str = "skill-creator:benchmark-skill";

/// Max agentic turns for the entire streaming session. Each user message may
/// use multiple turns internally (tool calls, etc.). 400 covers ~20 messages
/// × 20 turns each. When exhausted, the sidecar emits session_exhausted and
/// the frontend shows a "session limit reached" notice.
pub(super) const REFINE_STREAM_MAX_TURNS: u32 = 400;

pub(super) struct RefineRuntimeSettings {
    pub api_key: SecretString,
    pub extended_thinking: bool,
    pub interleaved_thinking_beta: bool,
    pub sdk_effort: Option<String>,
    pub fallback_model: Option<String>,
    pub refine_prompt_suggestions: bool,
    pub model: String,
    pub skills_path: String,
}


pub(super) fn new_refine_usage_session_id(skill_name: &str) -> String {
    format!("synthetic:refine:{}:{}", skill_name, uuid::Uuid::new_v4())
}

pub(super) fn ensure_skill_workspace_dir(workspace_path: &str, skill_name: &str) {
    let skill_workspace_dir = Path::new(workspace_path).join(skill_name);
    if !skill_workspace_dir.exists() {
        if let Err(e) = std::fs::create_dir_all(&skill_workspace_dir) {
            log::warn!(
                "[send_refine_message] failed to create skill workspace dir '{}': {}",
                skill_workspace_dir.display(),
                e
            );
        } else {
            log::debug!(
                "[send_refine_message] created skill workspace dir '{}'",
                skill_workspace_dir.display()
            );
        }
    }
}

pub(super) fn load_refine_runtime_settings(
    db: &Db,
    workspace_path: &str,
    skill_name: &str,
) -> Result<RefineRuntimeSettings, String> {
    let conn = db.0.lock().map_err(|e| {
        log::error!("[send_refine_message] Failed to acquire DB lock: {}", e);
        e.to_string()
    })?;
    let settings = db::read_settings(&conn).map_err(|e| {
        log::error!("[send_refine_message] Failed to read settings: {}", e);
        e
    })?;
    let api_key = settings
        .anthropic_api_key
        .map(SecretString::new)
        .ok_or_else(|| "Anthropic API key not configured".to_string())?;
    let model = resolve_model_id(settings.preferred_model.as_deref().unwrap_or("sonnet"));
    let skills_path = settings
        .skills_path
        .unwrap_or_else(|| workspace_path.to_string());

    let run_row = db::get_workflow_run(&conn, skill_name).ok().flatten();
    let purpose = run_row
        .as_ref()
        .map(|r| r.purpose.clone())
        .unwrap_or_else(|| "domain".to_string());
    let intake_json = run_row.as_ref().and_then(|r| r.intake_json.clone());

    crate::commands::workflow::write_user_context_file(
        workspace_path,
        skill_name,
        &[],
        settings.industry.as_deref(),
        settings.function_role.as_deref(),
        intake_json.as_deref(),
        None,
        Some(purpose.as_str()),
        None,
        None,
        None,
        None,
        None,
    );

    Ok(RefineRuntimeSettings {
        api_key,
        extended_thinking: settings.extended_thinking,
        interleaved_thinking_beta: settings.interleaved_thinking_beta,
        sdk_effort: settings.sdk_effort.clone(),
        fallback_model: Some(model.clone()),
        refine_prompt_suggestions: settings.refine_prompt_suggestions,
        model,
        skills_path,
    })
}

/// Build a SidecarConfig for the first refine message (stream_start).
/// No agent is specified — Claude decides which agent to invoke based on
/// the prompt content and the agents discovered from plugins.
#[allow(clippy::too_many_arguments)]
pub(super) fn build_refine_config(
    prompt: String,
    skill_name: &str,
    usage_session_id: &str,
    workspace_path: &str,
    api_key: SecretString,
    model: String,
    extended_thinking: bool,
    interleaved_thinking_beta: bool,
    sdk_effort: Option<String>,
    fallback_model: Option<String>,
    refine_prompt_suggestions: bool,
) -> (SidecarConfig, String) {
    let thinking_budget = extended_thinking.then_some(16_000u32);

    let cwd = workspace_path.to_string();
    let agent_id = format!(
        "refine-{}-{}",
        skill_name,
        chrono::Utc::now().timestamp_millis()
    );

    let config = SidecarConfig {
        prompt,
        betas: crate::commands::workflow::build_betas(
            thinking_budget,
            &model,
            interleaved_thinking_beta,
        ),
        model: None,
        api_key,
        cwd,
        allowed_tools: Some(tools_for_agent(REWRITE_AGENT_NAME)),
        max_turns: Some(REFINE_STREAM_MAX_TURNS),
        permission_mode: None,
        thinking: thinking_budget.map(|budget| {
            serde_json::json!({
                "type": "enabled",
                "budgetTokens": budget
            })
        }),
        fallback_model,
        effort: sdk_effort,
        output_format: None,
        prompt_suggestions: Some(refine_prompt_suggestions),
        path_to_claude_code_executable: None,
        agent_name: Some(REWRITE_AGENT_NAME.to_string()),
        required_plugins: Some(vec![
            "skill-content-researcher".to_string(),
            "skill-creator".to_string(),
        ]),
        conversation_history: None,
        skill_name: Some(skill_name.to_string()),
        step_id: Some(-10),
        workflow_session_id: None,
        usage_session_id: Some(usage_session_id.to_string()),
        run_source: Some("refine".to_string()),
    };

    (config, agent_id)
}

/// Build a follow-up prompt for subsequent refine messages.
pub(super) fn build_followup_prompt(
    user_message: &str,
    skills_path: &str,
    skill_name: &str,
    target_files: Option<&[String]>,
    command: Option<&str>,
) -> String {
    let skill_dir = Path::new(skills_path).join(skill_name);
    let skill_dir_str = skill_dir.to_string_lossy().replace('\\', "/");
    let effective_command = command.unwrap_or("refine");

    let mut prompt = format!("The command is: {}.", effective_command);

    if let Some(files) = target_files {
        if !files.is_empty() {
            let abs_files: Vec<String> = files
                .iter()
                .map(|f| format!("{}/{}", skill_dir_str, f))
                .collect();
            prompt.push_str(&format!(
                "\n\nIMPORTANT: Only edit these files: {}. Do not modify any other files.",
                abs_files.join(", ")
            ));
        }
    }

    prompt.push_str(&format!("\n\nCurrent request: {}", user_message));
    prompt
}

/// Build the refine prompt. Sends workspace context + the user's message.
/// Claude decides which agent to invoke based on the message content.
pub(super) fn build_refine_prompt(
    skill_name: &str,
    workspace_path: &str,
    skills_path: &str,
    user_message: &str,
    target_files: Option<&[String]>,
) -> String {
    let workspace_dir = Path::new(workspace_path).join(skill_name);
    let workspace_str = workspace_dir.to_string_lossy().replace('\\', "/");
    let skill_output_dir = Path::new(skills_path).join(skill_name);
    let skill_output_str = skill_output_dir.to_string_lossy().replace('\\', "/");

    let mut prompt = format!(
        "The skill name is: {skill_name}. \
         The workspace directory is: {workspace_str}. \
         The skill output directory (SKILL.md and references/) is: {skill_output_str}. \
         Derive context_dir as {workspace_str}/context. \
         Derive eval_dir as {workspace_str}/evals. \
         Derive eval_results_dir as {workspace_str}/evals/workspace. \
         All directories already exist — never create directories with mkdir or any other method. \
         CONSTRAINT: You may only refine the existing skill '{skill_name}'. Do NOT create new skills. \
         If the user asks to create a new skill, decline and direct them to the dashboard.",
    );

    if let Some(files) = target_files {
        if !files.is_empty() {
            prompt.push_str(&format!(
                "\n\nIMPORTANT: Only edit these files (relative to skill output directory): {}. Do not modify any other files.",
                files.join(", ")
            ));
        }
    }

    prompt.push_str(&format!("\n\nCurrent request: {}", user_message));

    prompt
}

