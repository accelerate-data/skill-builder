use std::path::Path;

use crate::agents::sidecar::SidecarConfig;
use crate::commands::workflow::resolve_model_id;
use crate::db::{self, Db};
use crate::skill_paths::resolve_skill_dir;
use crate::types::SecretString;

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

pub(super) fn ensure_skill_workspace_dir(workspace_path: &str, plugin_slug: &str, skill_name: &str) {
    let skill_workspace_dir = resolve_skill_dir(Path::new(workspace_path), plugin_slug, skill_name);
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
    let plugin_slug = super::resolve_skill_plugin_slug(db, skill_name)?;
    let settings_author = settings
        .github_user_email
        .clone()
        .or(settings.github_user_login.clone());

    let run_row = db::get_workflow_run(&conn, skill_name).ok().flatten();
    let purpose = run_row
        .as_ref()
        .map(|r| r.purpose.clone())
        .unwrap_or_else(|| "domain".to_string());
    let intake_json = run_row.as_ref().and_then(|r| r.intake_json.clone());
    let skill_md_path = resolve_skill_dir(Path::new(&skills_path), &plugin_slug, skill_name).join("SKILL.md");
    let frontmatter = std::fs::read_to_string(&skill_md_path)
        .ok()
        .map(|content| crate::commands::imported_skills::parse_frontmatter_full(&content))
        .unwrap_or_default();
    let author_for_context = frontmatter
        .author
        .or_else(|| run_row.as_ref().and_then(|r| r.author_login.clone()))
        .or(settings_author);

    crate::commands::workflow::write_user_context_file(
        workspace_path,
        skill_name,
        &[],
        author_for_context.as_deref(),
        settings.industry.as_deref(),
        settings.function_role.as_deref(),
        intake_json.as_deref(),
        None,
        Some(purpose.as_str()),
        frontmatter.version.as_deref(),
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

    // cwd must stay at workspace root so the SDK finds .claude/ (project
    // settings, agents, CLAUDE.md). Agents resolve skill-specific paths
    // from the absolute workspace_dir in the prompt.
    let cwd = workspace_path.to_string();
    let agent_id = format!(
        "refine-{}-{}",
        skill_name,
        chrono::Utc::now().timestamp_millis()
    );

    // When model is set explicitly (no agent), fallbackModel must differ.
    let effective_fallback = fallback_model.filter(|fm| fm != &model);

    let config = SidecarConfig {
        prompt,
        betas: crate::commands::workflow::build_betas(
            thinking_budget,
            &model,
            interleaved_thinking_beta,
        ),
        model: Some(model),
        api_key,
        cwd,
        allowed_tools: Some(vec![
            "Read".into(), "Write".into(), "Edit".into(),
            "Glob".into(), "Grep".into(), "Bash".into(),
            "Agent".into(), "Skill".into(), "Task".into(),
            "AskUserQuestion".into(),
        ]),
        max_turns: Some(REFINE_STREAM_MAX_TURNS),
        permission_mode: None,
        thinking: thinking_budget.map(|budget| {
            serde_json::json!({
                "type": "enabled",
                "budgetTokens": budget
            })
        }),
        fallback_model: effective_fallback,
        effort: sdk_effort,
        output_format: None,
        prompt_suggestions: Some(refine_prompt_suggestions),
        path_to_claude_code_executable: None,
        agent_name: None,
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

/// Build a follow-up prompt for subsequent messages in the streaming session.
/// Just the user's message + optional file targeting. No command prefix —
/// Claude already has the full context from the initial prompt.
#[cfg_attr(not(test), allow(dead_code))]
pub(super) fn build_followup_prompt(
    user_message: &str,
    skills_path: &str,
    skill_name: &str,
    target_files: Option<&[String]>,
) -> String {
    build_followup_prompt_for_plugin(
        user_message,
        skills_path,
        "no-plugin",
        skill_name,
        target_files,
    )
}

pub(super) fn build_followup_prompt_for_plugin(
    user_message: &str,
    skills_path: &str,
    plugin_slug: &str,
    skill_name: &str,
    target_files: Option<&[String]>,
) -> String {
    let mut prompt = String::new();

    if let Some(files) = target_files {
        if !files.is_empty() {
            let skill_dir = resolve_skill_dir(Path::new(skills_path), plugin_slug, skill_name);
            let skill_dir_str = skill_dir.to_string_lossy().replace('\\', "/");
            let abs_files: Vec<String> = files
                .iter()
                .map(|f| format!("{}/{}", skill_dir_str, f))
                .collect();
            prompt.push_str(&format!(
                "IMPORTANT: Only edit these files: {}. Do not modify any other files.\n\n",
                abs_files.join(", ")
            ));
        }
    }

    prompt.push_str(user_message);
    prompt
}

/// Build the refine prompt. Sends workspace context + the user's message.
/// Claude decides which agent to invoke based on the message content.
#[cfg_attr(not(test), allow(dead_code))]
pub(super) fn build_refine_prompt(
    skill_name: &str,
    workspace_path: &str,
    skills_path: &str,
    user_message: &str,
    target_files: Option<&[String]>,
) -> String {
    build_refine_prompt_for_plugin(
        skill_name,
        workspace_path,
        skills_path,
        "no-plugin",
        user_message,
        target_files,
    )
}

pub(super) fn build_refine_prompt_for_plugin(
    skill_name: &str,
    workspace_path: &str,
    skills_path: &str,
    plugin_slug: &str,
    user_message: &str,
    target_files: Option<&[String]>,
) -> String {
    let workspace_dir = resolve_skill_dir(Path::new(workspace_path), plugin_slug, skill_name);
    let workspace_str = workspace_dir.to_string_lossy().replace('\\', "/");
    let skill_output_dir = resolve_skill_dir(Path::new(skills_path), plugin_slug, skill_name);
    let skill_output_str = skill_output_dir.to_string_lossy().replace('\\', "/");

    let mut prompt = format!(
        "The skill name is: {skill_name}. \
         The workspace directory is: \"{workspace_str}\". \
         The skill output directory (SKILL.md and references/) is: \"{skill_output_str}\". \
         Derive context_dir as \"{workspace_str}/context\". \
         Derive eval_dir as \"{workspace_str}/evals\". \
         Derive eval_results_dir as \"{workspace_str}/evals/workspace\". \
         All directories already exist — never create directories with mkdir or any other method.\n\n\
         ROUTING:\n\
         - For modifying the existing skill, launch the skill-creator:rewrite-skill subagent via the Agent tool.\n\
         - CONSTRAINT: You may only refine, evaluate, benchmark, or validate the existing skill '{skill_name}'. Do NOT create new skills. \
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
