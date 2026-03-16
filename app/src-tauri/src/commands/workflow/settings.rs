use crate::db::Db;

use super::guards::validate_decisions_exist_inner;
use super::step_config::resolve_model_id;

/// Shared settings extracted from the DB, used by `run_workflow_step`.
pub(crate) struct WorkflowSettings {
    pub skills_path: String,
    pub api_key: crate::types::SecretString,
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
        Some(k) => crate::types::SecretString::new(k),
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
    // Metadata fields are read exclusively from the `skills` master table.
    // This is the canonical source since migration 24 moved these columns
    // from `workflow_runs` to `skills`, and migration 35 dropped them from
    // `workflow_runs` entirely. Never read metadata from `workflow_runs` or
    // from frontend-supplied payload — always call `get_skill_master` here.
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
