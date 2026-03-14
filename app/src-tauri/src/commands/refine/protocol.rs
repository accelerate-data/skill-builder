use std::path::Path;

use crate::agents::sidecar::SidecarConfig;
use crate::commands::agent::output_format_for_agent;
use crate::commands::workflow::resolve_model_id;
use crate::db::{self, Db};

pub(super) const REFINE_TOOLS: &[&str] = &[
    "Read", "Edit", "Write", "Glob", "Grep", "Bash", "Task", "Skill",
];
pub(super) const VALIDATE_DIRECT_TOOLS: &[&str] = &["Read", "Glob", "Grep", "Bash", "Task"];
pub(super) const GENERATE_DIRECT_TOOLS: &[&str] = &[
    "Read", "Write", "Edit", "Glob", "Grep", "Bash", "Task", "Skill",
];

pub(super) const REFINE_AGENT_NAME: &str = "refine-skill";
pub(super) const VALIDATE_AGENT_NAME: &str = "validate-skill";
pub(super) const GENERATE_AGENT_NAME: &str = "generate-skill";

/// Max agentic turns for the entire streaming session. Each user message may
/// use multiple turns internally (tool calls, etc.). 400 covers ~20 messages
/// × 20 turns each. When exhausted, the sidecar emits session_exhausted and
/// the frontend shows a "session limit reached" notice.
pub(super) const REFINE_STREAM_MAX_TURNS: u32 = 400;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum RefineDispatch {
    Stream,
    DirectValidate,
    DirectRewrite,
}

pub(super) struct RefineRuntimeSettings {
    pub api_key: String,
    pub extended_thinking: bool,
    pub interleaved_thinking_beta: bool,
    pub sdk_effort: Option<String>,
    pub fallback_model: Option<String>,
    pub refine_prompt_suggestions: bool,
    pub model: String,
    pub skills_path: String,
}

pub(super) fn dispatch_for_refine_command(
    command: Option<&str>,
    target_files: Option<&[String]>,
) -> RefineDispatch {
    match command {
        Some("validate") => RefineDispatch::DirectValidate,
        Some("rewrite") if target_files.is_none_or(|files| files.is_empty()) => {
            RefineDispatch::DirectRewrite
        }
        _ => RefineDispatch::Stream,
    }
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
    let settings = db::read_settings_hydrated(&conn).map_err(|e| {
        log::error!("[send_refine_message] Failed to read settings: {}", e);
        e
    })?;
    let api_key = settings
        .anthropic_api_key
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
#[allow(clippy::too_many_arguments)]
pub(super) fn build_refine_config(
    prompt: String,
    skill_name: &str,
    usage_session_id: &str,
    workspace_path: &str,
    api_key: String,
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
        allowed_tools: Some(REFINE_TOOLS.iter().map(|s| s.to_string()).collect()),
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
        agent_name: Some(REFINE_AGENT_NAME.to_string()),
        required_plugins: Some(vec!["skill-creator".to_string()]),
        conversation_history: None,
        skill_name: Some(skill_name.to_string()),
        step_id: Some(-10),
        workflow_session_id: None,
        usage_session_id: Some(usage_session_id.to_string()),
        run_source: Some("refine".to_string()),
    };

    (config, agent_id)
}

#[allow(clippy::too_many_arguments)]
pub(super) fn build_direct_refine_config(
    prompt: String,
    skill_name: &str,
    usage_session_id: &str,
    workspace_path: &str,
    api_key: String,
    model: String,
    extended_thinking: bool,
    interleaved_thinking_beta: bool,
    sdk_effort: Option<String>,
    fallback_model: Option<String>,
    agent_name: &'static str,
) -> (SidecarConfig, String) {
    let thinking_budget = extended_thinking.then_some(16_000u32);
    let agent_id = format!(
        "refine-{}-{}",
        skill_name,
        chrono::Utc::now().timestamp_millis()
    );
    let allowed_tools = match agent_name {
        VALIDATE_AGENT_NAME => VALIDATE_DIRECT_TOOLS,
        GENERATE_AGENT_NAME => GENERATE_DIRECT_TOOLS,
        _ => REFINE_TOOLS,
    };
    let max_turns = match agent_name {
        VALIDATE_AGENT_NAME => 50,
        GENERATE_AGENT_NAME => 80,
        _ => REFINE_STREAM_MAX_TURNS,
    };

    let config = SidecarConfig {
        prompt,
        betas: crate::commands::workflow::build_betas(
            thinking_budget,
            &model,
            interleaved_thinking_beta,
        ),
        model: None,
        api_key,
        cwd: workspace_path.to_string(),
        allowed_tools: Some(allowed_tools.iter().map(|s| s.to_string()).collect()),
        max_turns: Some(max_turns),
        permission_mode: None,
        thinking: thinking_budget.map(|budget| {
            serde_json::json!({
                "type": "enabled",
                "budgetTokens": budget
            })
        }),
        fallback_model,
        effort: sdk_effort,
        output_format: output_format_for_agent(skill_name, Some(agent_name)),
        prompt_suggestions: Some(false),
        path_to_claude_code_executable: None,
        agent_name: Some(agent_name.to_string()),
        required_plugins: Some(vec!["skill-creator".to_string()]),
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

/// Build the refine agent prompt with all runtime fields.
pub(super) fn build_refine_prompt(
    skill_name: &str,
    workspace_path: &str,
    skills_path: &str,
    user_message: &str,
    target_files: Option<&[String]>,
    command: Option<&str>,
) -> String {
    let workspace_dir = Path::new(workspace_path).join(skill_name);
    let workspace_str = workspace_dir.to_string_lossy().replace('\\', "/");
    let skill_output_dir = Path::new(skills_path).join(skill_name);
    let skill_output_str = skill_output_dir.to_string_lossy().replace('\\', "/");

    let effective_command = command.unwrap_or("refine");

    let mut prompt = format!(
        "The skill name is: {}. The command is: {}. The workspace directory is: {}. \
         The skill output directory (SKILL.md and references/) is: {}. \
         Read user-context.md from the workspace directory. \
         Derive context_dir as workspace_dir/context. \
         All directories already exist — never create directories with mkdir or any other method.",
        skill_name, effective_command, workspace_str, skill_output_str,
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

pub(super) fn build_direct_agent_prompt(
    agent_name: &'static str,
    skill_name: &str,
    workspace_path: &str,
    skills_path: &str,
    user_message: &str,
) -> String {
    let workspace_dir = Path::new(workspace_path).join(skill_name);
    let workspace_str = workspace_dir.to_string_lossy().replace('\\', "/");
    let skill_output_dir = Path::new(skills_path).join(skill_name);
    let skill_output_str = skill_output_dir.to_string_lossy().replace('\\', "/");

    let mut prompt = format!(
        "The skill name is: {}. The workspace directory is: {}. \
         The skill output directory (SKILL.md and references/) is: {}. \
         Read user-context.md from the workspace directory. \
         Derive context_dir as workspace_dir/context. \
         All directories already exist — never create directories with mkdir or any other method. \
         Treat Current request as an additional focus area for coverage, but do not ignore the agent's full workflow.",
        skill_name, workspace_str, skill_output_str,
    );

    if agent_name == GENERATE_AGENT_NAME {
        prompt.push_str("\n\nRun in /rewrite mode for this request.");
    }

    prompt.push_str(&format!("\n\nCurrent request: {}", user_message));
    prompt
}
