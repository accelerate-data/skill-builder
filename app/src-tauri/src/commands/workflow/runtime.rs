use std::path::Path;

use crate::agents::sidecar::{self, SidecarConfig};
use crate::agents::sidecar_pool::SidecarPool;
use crate::db::Db;

use super::deploy::{
    deploy_skill_for_workflow, ensure_workspace_prompts, resolve_bundled_skills_dir,
};
use super::evaluation::workflow_step_log_name;
use super::output_format::answer_evaluator_output_format;
use super::step_config::{
    build_betas, get_step_config, required_plugins_for_workflow_step, resolve_model_id,
    thinking_budget_for_step, workflow_output_format_for_agent,
};

/// Write `user-context.md` to the workspace so sub-agents can read it from disk.
/// Captures purpose, description, user context, industry, function/role,
/// and behaviour settings provided by the user.
/// Non-fatal: logs a warning on failure rather than blocking the workflow.
#[allow(clippy::too_many_arguments)]
pub fn write_user_context_file(
    workspace_path: &str,
    skill_name: &str,
    tags: &[String],
    industry: Option<&str>,
    function_role: Option<&str>,
    intake_json: Option<&str>,
    description: Option<&str>,
    purpose: Option<&str>,
    version: Option<&str>,
    skill_model: Option<&str>,
    argument_hint: Option<&str>,
    user_invocable: Option<bool>,
    disable_model_invocation: Option<bool>,
) {
    let Some(ctx) = format_user_context(
        Some(skill_name),
        tags,
        industry,
        function_role,
        intake_json,
        description,
        purpose,
        version,
        skill_model,
        argument_hint,
        user_invocable,
        disable_model_invocation,
    ) else {
        return;
    };

    let workspace_dir = Path::new(workspace_path).join(skill_name);
    // Safety net: create directory if missing
    if let Err(e) = std::fs::create_dir_all(&workspace_dir) {
        log::warn!(
            "[write_user_context_file] Failed to create dir {}: {}",
            workspace_dir.display(),
            e
        );
        return;
    }
    let file_path = workspace_dir.join("user-context.md");
    let content = format!(
        "# User Context\n\n{}\n",
        ctx.strip_prefix("## User Context\n\n").unwrap_or(&ctx)
    );

    match std::fs::write(&file_path, &content) {
        Ok(()) => {
            log::info!(
                "[write_user_context_file] Wrote user-context.md ({} bytes) to {}",
                content.len(),
                file_path.display()
            );
        }
        Err(e) => {
            log::warn!(
                "[write_user_context_file] Failed to write {}: {}",
                file_path.display(),
                e
            );
        }
    }
}

/// Format user context fields into a `## User Context` markdown block.
///
/// Shared by `write_user_context_file` (for file-based agents) and
/// `build_prompt` / refine's `send_refine_message` (for inline embedding).
/// Returns `None` when all fields are empty.
#[allow(clippy::too_many_arguments)]
pub fn format_user_context(
    name: Option<&str>,
    tags: &[String],
    industry: Option<&str>,
    function_role: Option<&str>,
    intake_json: Option<&str>,
    description: Option<&str>,
    purpose: Option<&str>,
    version: Option<&str>,
    skill_model: Option<&str>,
    argument_hint: Option<&str>,
    user_invocable: Option<bool>,
    disable_model_invocation: Option<bool>,
) -> Option<String> {
    /// Push `**label**: value` to `parts` when `opt` is non-empty.
    fn push_field(parts: &mut Vec<String>, label: &str, opt: Option<&str>) {
        if let Some(v) = opt.filter(|s| !s.is_empty()) {
            parts.push(format!("**{}**: {}", label, v));
        }
    }

    /// Build a markdown subsection from `parts`, or return None if empty.
    fn build_subsection(heading: &str, parts: Vec<String>) -> Option<String> {
        if parts.is_empty() {
            None
        } else {
            Some(format!("### {}\n{}", heading, parts.join("\n")))
        }
    }

    let mut sections: Vec<String> = Vec::new();

    // --- Skill identity ---
    let mut skill_parts: Vec<String> = Vec::new();
    push_field(&mut skill_parts, "Name", name);
    if let Some(p) = purpose.filter(|s| !s.is_empty()) {
        let label = match p {
            "domain" => "Business process knowledge",
            "source" => "Source system customizations",
            "data-engineering" => "Organization specific data engineering standards",
            "platform" => "Organization specific Azure or Fabric standards",
            other => other,
        };
        skill_parts.push(format!("**Purpose**: {}", label));
    }
    push_field(&mut skill_parts, "Description", description);
    if !tags.is_empty() {
        skill_parts.push(format!("**Tags**: {}", tags.join(", ")));
    }
    sections.extend(build_subsection("Skill", skill_parts));

    // --- User profile ---
    let mut profile_parts: Vec<String> = Vec::new();
    push_field(&mut profile_parts, "Industry", industry);
    push_field(&mut profile_parts, "Function", function_role);
    sections.extend(build_subsection("About You", profile_parts));

    // --- Intake: What Claude needs to know ---
    if let Some(ij) = intake_json {
        if let Ok(intake) = serde_json::from_str::<serde_json::Value>(ij) {
            // New unified field
            if let Some(v) = intake
                .get("context")
                .and_then(|v| v.as_str())
                .filter(|v| !v.is_empty())
            {
                sections.push(format!("### What Claude Needs to Know\n{}", v));
            }
            // Legacy fields (backwards compat for existing skills)
            for (key, label) in [
                ("unique_setup", "What Makes This Setup Unique"),
                ("claude_mistakes", "What Claude Gets Wrong"),
                ("scope", "Scope"),
                ("challenges", "Key Challenges"),
                ("audience", "Target Audience"),
            ] {
                if let Some(v) = intake
                    .get(key)
                    .and_then(|v| v.as_str())
                    .filter(|v| !v.is_empty())
                {
                    sections.push(format!("### {}\n{}", label, v));
                }
            }
        }
    }

    // --- Configuration ---
    let mut config_parts: Vec<String> = Vec::new();
    push_field(&mut config_parts, "Version", version);
    if let Some(m) = skill_model.filter(|s| !s.is_empty() && *s != "inherit") {
        config_parts.push(format!("**Preferred Model**: {}", m));
    }
    push_field(&mut config_parts, "Argument Hint", argument_hint);
    if let Some(inv) = user_invocable {
        config_parts.push(format!("**User Invocable**: {}", inv));
    }
    if let Some(dmi) = disable_model_invocation {
        config_parts.push(format!("**Disable Model Invocation**: {}", dmi));
    }
    sections.extend(build_subsection("Configuration", config_parts));

    if sections.is_empty() {
        None
    } else {
        Some(format!("## User Context\n\n{}", sections.join("\n\n")))
    }
}

pub(crate) fn build_prompt(
    skill_name: &str,
    workspace_path: &str,
    skills_path: &str,
    author_login: Option<&str>,
    created_at: Option<&str>,
    max_dimensions: u32,
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
         All directories already exist — never create directories with mkdir or any other method. Never list directories with ls. Read only the specific files named in your instructions and write files directly.",
        skill_name,
        workspace_str,
        skill_output_str,
    );

    if let Some(author) = author_login {
        prompt.push_str(&format!(" The author of this skill is: {}.", author));
        if let Some(created) = created_at {
            let created_date = &created[..10.min(created.len())];
            let today = chrono::Utc::now().format("%Y-%m-%d").to_string();
            prompt.push_str(&format!(
                " The skill was created on: {}. Today's date (for the modified timestamp) is: {}.",
                created_date, today
            ));
        }
    }

    prompt.push_str(&format!(
        " The maximum research dimensions before scope warning is: {}.",
        max_dimensions
    ));

    prompt.push_str(" The workspace directory may contain other files written by the workflow (such as answer-evaluation.json) — read only the files explicitly named in your agent instructions. Do not read the logs/ directory or any file not named in your instructions.");

    prompt
}

pub(crate) fn read_agent_frontmatter_name(workspace_path: &str, phase: &str) -> Option<String> {
    let agent_file = Path::new(workspace_path)
        .join(".claude")
        .join("agents")
        .join(format!("{}.md", phase));
    let content = std::fs::read_to_string(&agent_file).ok()?;
    if !content.starts_with("---") {
        return None;
    }
    let after_start = &content[3..];
    let end = after_start.find("---")?;
    let frontmatter = &after_start[..end];
    for line in frontmatter.lines() {
        let trimmed = line.trim();
        if let Some(name) = trimmed.strip_prefix("name:") {
            let name = name.trim();
            if !name.is_empty() {
                return Some(name.to_string());
            }
        }
    }
    None
}

/// Check if clarifications.json has `metadata.scope_recommendation == true`.
pub(crate) fn parse_scope_recommendation(clarifications_path: &Path) -> bool {
    let content = match std::fs::read_to_string(clarifications_path) {
        Ok(c) => c,
        Err(_) => return false,
    };
    let value: serde_json::Value = match serde_json::from_str(&content) {
        Ok(v) => v,
        Err(_) => return false,
    };
    value["metadata"]["scope_recommendation"] == true
}

/// Check decisions.json for guard conditions:
/// - metadata.decision_count == 0  → no decisions were derivable
/// - metadata.contradictory_inputs: true → unresolvable contradictions detected
///
/// `contradictory_inputs: revised` is NOT a block — the user has reviewed
/// and edited the flagged decisions; treat decisions.json as authoritative.
///
/// Returns true if step 3 should be disabled.
pub(crate) fn parse_decisions_guard(decisions_path: &Path) -> bool {
    let content = match std::fs::read_to_string(decisions_path) {
        Ok(c) => c,
        Err(_) => return false,
    };
    let data: serde_json::Value = match serde_json::from_str(&content) {
        Ok(v) => v,
        Err(_) => return false,
    };
    let metadata = &data["metadata"];
    if metadata["decision_count"].as_i64() == Some(0) {
        return true;
    }
    if metadata["contradictory_inputs"].as_bool() == Some(true) {
        return true;
    }
    false
}

/// Derive agent name from prompt template.
/// Reads the deployed agent file's frontmatter `name:` field (the SDK uses
/// this to register the agent). Falls back to the phase name if the
/// file is missing or has no name field.
pub(crate) fn derive_agent_name(workspace_path: &str, _purpose: &str, prompt_template: &str) -> String {
    let phase = prompt_template.trim_end_matches(".md");
    if let Some(name) = read_agent_frontmatter_name(workspace_path, phase) {
        return name;
    }
    phase.to_string()
}

/// Generate a unique agent ID from skill name, label, and timestamp.
pub(crate) fn make_agent_id(skill_name: &str, label: &str) -> String {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!("{}-{}-{}", skill_name, label, ts)
}

pub(crate) fn workflow_step_runtime_label(step: &crate::types::StepConfig) -> String {
    step.name.to_ascii_lowercase().replace(' ', "-")
}

/// Core logic for validating decisions.json existence — testable without tauri::State.
/// Checks in order: skill output dir (skillsPath), workspace dir.
/// Returns Ok(()) if found, Err with a clear message if missing.
pub(crate) fn validate_decisions_exist_inner(
    skill_name: &str,
    workspace_path: &str,
    _skills_path: &str,
) -> Result<(), String> {
    let path = Path::new(workspace_path)
        .join(skill_name)
        .join("context")
        .join("decisions.json");
    if path.exists() {
        let content = std::fs::read_to_string(&path).unwrap_or_default();
        if !content.trim().is_empty() {
            return Ok(());
        }
    }

    Err(
        "Cannot start Generate Skill step: decisions.json was not found on the filesystem. \
         The Confirm Decisions step (step 2) must create a decisions file before the Generate Skill step can run. \
         Please re-run the Confirm Decisions step first."
            .to_string(),
    )
}

/// Shared settings extracted from the DB, used by `run_workflow_step`.
pub(crate) struct WorkflowSettings {
    pub skills_path: String,
    pub api_key: String,
    pub preferred_model: String,
    pub extended_thinking: bool,
    pub interleaved_thinking_beta: bool,
    pub sdk_effort: Option<String>,
    pub fallback_model: Option<String>,
    pub purpose: String,
    pub tags: Vec<String>,
    pub author_login: Option<String>,
    pub created_at: Option<String>,
    pub max_dimensions: u32,
    pub industry: Option<String>,
    pub function_role: Option<String>,
    pub intake_json: Option<String>,
    pub description: Option<String>,
    pub version: Option<String>,
    pub skill_model: Option<String>,
    pub argument_hint: Option<String>,
    pub user_invocable: Option<bool>,
    pub disable_model_invocation: Option<bool>,
}

/// Read all workflow settings from the DB in a single lock acquisition.
pub(crate) fn read_workflow_settings(
    db: &Db,
    skill_name: &str,
    step_id: u32,
    workspace_path: &str,
) -> Result<WorkflowSettings, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    // Read all settings in one pass
    let settings = crate::db::read_settings_hydrated(&conn)?;
    let skills_path = settings.skills_path.ok_or_else(|| {
        "Skills path not configured. Please set it in Settings before running workflow steps."
            .to_string()
    })?;
    let api_key = match settings.anthropic_api_key {
        Some(k) => k,
        None => return Err("Anthropic API key not configured".to_string()),
    };
    let preferred_model = resolve_model_id(settings.preferred_model.as_deref().unwrap_or("sonnet"));
    let extended_thinking = settings.extended_thinking;
    let interleaved_thinking_beta = settings.interleaved_thinking_beta;
    let sdk_effort = settings.sdk_effort.clone();
    let fallback_model = Some(preferred_model.clone());
    let max_dimensions = settings.max_dimensions;
    let industry = settings.industry;
    let function_role = settings.function_role;

    // Validate prerequisites (step 3 requires decisions.json)
    if step_id == 3 {
        validate_decisions_exist_inner(skill_name, workspace_path, &skills_path)?;
    }

    // Get skill purpose
    let purpose = crate::db::get_purpose(&conn, skill_name)?;

    // Read author info and intake data from workflow run
    let run_row = crate::db::get_workflow_run(&conn, skill_name)
        .ok()
        .flatten();
    let author_login = run_row.as_ref().and_then(|r| r.author_login.clone());
    let created_at = run_row.as_ref().map(|r| r.created_at.clone());
    let intake_json = run_row.as_ref().and_then(|r| r.intake_json.clone());
    // Metadata fields come from the skills master table (canonical since migration 24/35)
    let master_row = crate::db::get_skill_master(&conn, skill_name).ok().flatten();
    let description = master_row.as_ref().and_then(|m| m.description.clone());
    let version = master_row.as_ref().and_then(|m| m.version.clone());
    let skill_model = master_row.as_ref().and_then(|m| m.model.clone());
    let argument_hint = master_row.as_ref().and_then(|m| m.argument_hint.clone());
    let user_invocable = master_row.as_ref().and_then(|m| m.user_invocable);
    let disable_model_invocation = master_row.as_ref().and_then(|m| m.disable_model_invocation);
    let tags = crate::db::get_tags_for_skills(&conn, &[skill_name.to_string()])
        .unwrap_or_default()
        .remove(skill_name)
        .unwrap_or_default();

    Ok(WorkflowSettings {
        skills_path,
        api_key,
        preferred_model,
        extended_thinking,
        interleaved_thinking_beta,
        sdk_effort,
        fallback_model,
        purpose,
        tags,
        author_login,
        created_at,
        max_dimensions,
        industry,
        function_role,
        intake_json,
        description,
        version,
        skill_model,
        argument_hint,
        user_invocable,
        disable_model_invocation,
    })
}

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
            Some(k) => k,
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

    let workspace_dir = Path::new(&workspace_path).join(&skill_name);
    let workspace_str = workspace_dir.to_string_lossy().replace('\\', "/");
    let skill_output_str = Path::new(&skills_path)
        .join(&skill_name)
        .to_string_lossy()
        .replace('\\', "/");

    let prompt = format!(
        "The skill name is: {}. The workspace directory is: {}. \
         The skill output directory (SKILL.md and references/) is: {}. \
         Read user-context.md from the workspace directory. \
         Derive context_dir as workspace_dir/context. \
         All directories already exist — do not create any directories. \
         Use user-context.md to evaluate answers in the user's specific domain.",
        skill_name, workspace_str, skill_output_str,
    );

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
