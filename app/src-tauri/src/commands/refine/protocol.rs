use std::path::Path;

use crate::agents::sidecar::SidecarConfig;
use crate::commands::agent::output_format_for_agent;
use crate::commands::workflow::{resolve_model_id, tools_for_agent};
use crate::db::{self, Db};
use crate::types::SecretString;

pub(super) const VALIDATE_AGENT_NAME: &str = "validate-skill";
pub(super) const REWRITE_AGENT_NAME: &str = "skill-creator:rewrite-skill";
pub(super) const BENCHMARK_AGENT_NAME: &str = "skill-creator:benchmark-skill";

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
    DirectBenchmark,
}

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

pub(super) fn dispatch_for_refine_command(
    command: Option<&str>,
    _target_files: Option<&[String]>,
) -> RefineDispatch {
    match command {
        Some("validate") => RefineDispatch::DirectValidate,
        Some("rewrite") => RefineDispatch::DirectRewrite,
        Some("benchmark") => RefineDispatch::DirectBenchmark,
        _ => RefineDispatch::Stream,
    }
}

pub(super) fn new_refine_usage_session_id(skill_name: &str) -> String {
    format!("synthetic:refine:{}:{}", skill_name, uuid::Uuid::new_v4())
}

/// Snapshot the current skill directory to `{workspace_dir}/skill-snapshot/`
/// so the benchmark agent can use it as the prior version baseline.
/// Returns the snapshot directory path, or None if the skill doesn't exist.
pub(super) fn snapshot_skill_for_benchmark(
    skills_path: &str,
    workspace_path: &str,
    skill_name: &str,
) -> Option<String> {
    let src = Path::new(skills_path).join(skill_name);
    if !src.join("SKILL.md").exists() {
        log::debug!(
            "[snapshot_skill] no SKILL.md at {} — skipping snapshot",
            src.display()
        );
        return None;
    }
    let workspace_dir = Path::new(workspace_path).join(skill_name);
    let dest = workspace_dir.join("skill-snapshot");

    // Remove stale snapshot
    if dest.exists() {
        if let Err(e) = std::fs::remove_dir_all(&dest) {
            log::warn!(
                "[snapshot_skill] failed to remove stale snapshot at {}: {}",
                dest.display(),
                e
            );
        }
    }

    // Copy skill directory tree
    if let Err(e) = copy_dir_recursive(&src, &dest) {
        log::warn!(
            "[snapshot_skill] failed to snapshot {} to {}: {}",
            src.display(),
            dest.display(),
            e
        );
        return None;
    }

    let snapshot_str = dest.to_string_lossy().replace('\\', "/");
    log::info!(
        "[snapshot_skill] created snapshot for skill={} at {}",
        skill_name,
        snapshot_str
    );
    Some(snapshot_str)
}

/// Recursively copy a directory. Delegates to the shared fs_utils implementation
/// which skips symlinks to prevent infinite cycles.
fn copy_dir_recursive(src: &Path, dest: &Path) -> Result<(), String> {
    crate::fs_utils::copy_dir_recursive(src, dest)
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

#[allow(clippy::too_many_arguments)]
pub(super) fn build_direct_refine_config(
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
    agent_name: &'static str,
) -> (SidecarConfig, String) {
    let thinking_budget = extended_thinking.then_some(16_000u32);
    let agent_id = format!(
        "refine-{}-{}",
        skill_name,
        chrono::Utc::now().timestamp_millis()
    );
    let allowed_tools = tools_for_agent(agent_name);
    let max_turns = match agent_name {
        VALIDATE_AGENT_NAME => 50,
        REWRITE_AGENT_NAME => 80,
        BENCHMARK_AGENT_NAME => 200,
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
        allowed_tools: Some(allowed_tools),
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
    target_files: Option<&[String]>,
    baseline_mode: Option<&str>,
    prior_skill_snapshot_dir: Option<&str>,
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

    if agent_name == REWRITE_AGENT_NAME {
        if let Some(files) = target_files {
            if !files.is_empty() {
                prompt.push_str(&format!(
                    "\n\nFocus the rewrite on these files: {}.",
                    files.join(", ")
                ));
            }
        }
    }

    if agent_name == BENCHMARK_AGENT_NAME {
        let mode = baseline_mode.unwrap_or("no_skill");
        prompt.push_str(&format!("\n\nbaseline_mode: {}", mode));
        if let Some(snapshot_dir) = prior_skill_snapshot_dir {
            prompt.push_str(&format!(
                "\nprior_skill_snapshot_dir: {}",
                snapshot_dir.replace('\\', "/")
            ));
        }
    }

    prompt.push_str(&format!("\n\nCurrent request: {}", user_message));
    prompt
}
