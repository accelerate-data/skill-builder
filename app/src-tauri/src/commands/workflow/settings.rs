use crate::db::Db;

/// Shared settings extracted from the DB, used by `run_workflow_step`.
pub(crate) struct WorkflowSettings {
    pub plugin_slug: String,
    pub skills_path: String,
    pub llm: crate::types::WorkflowLlmConfig,
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
    pub user_invocable: Option<bool>,
    pub disable_model_invocation: Option<bool>,
    /// Applicable reference documents for this skill (scope=all or skill-specific).
    pub documents: Vec<crate::db::DocumentContent>,
}

/// Backend-owned runtime context shared by OpenHands callers.
///
/// Runtime paths should read the initialized skills root and selected LLM
/// through this API instead of re-projecting raw settings fields.
#[derive(Debug)]
pub(crate) struct InitializedRuntimeContext {
    pub workspace_path: String,
    pub llm: crate::types::WorkflowLlmConfig,
}

pub(crate) fn read_initialized_runtime_context(
    db: &Db,
) -> Result<InitializedRuntimeContext, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let settings = crate::db::read_settings(&conn)?;
    let workspace_path = settings
        .skills_path
        .clone()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "Skills path not configured".to_string())?;
    if !std::path::Path::new(&workspace_path).is_dir() {
        return Err(format!(
            "Skills path is not initialized: {}. Update Settings -> Skills Path to a valid directory.",
            workspace_path
        ));
    }
    let llm = crate::db::selected_workflow_llm(&settings)?;

    Ok(InitializedRuntimeContext {
        workspace_path,
        llm,
    })
}

/// Read all workflow settings from the DB in a single lock acquisition.
pub(crate) fn read_workflow_settings_by_skill_id(
    db: &Db,
    skill_id: i64,
    skill_name: &str,
    step_id: u32,
    _workspace_path: &str,
) -> Result<WorkflowSettings, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    // Read all settings in one pass
    let settings = crate::db::read_settings(&conn)?;
    let skills_path = settings.skills_path.clone().ok_or_else(|| {
        "Skills path not configured. Please set it in Settings before running workflow steps."
            .to_string()
    })?;
    let llm = crate::db::selected_workflow_llm(&settings)?;
    let max_dimensions = settings.max_dimensions;
    let industry = settings.industry;
    let function_role = settings.function_role;

    // Metadata fields are read exclusively from the `skills` master table.
    // This is the canonical source since migration 24 moved these columns
    // from `workflow_runs` to `skills`, and migration 35 dropped them from
    // `workflow_runs` entirely. Never read metadata from `workflow_runs` or
    // from frontend-supplied payload — always call `get_skill_master_any_plugin` here.
    // Use any-plugin lookup so non-default-plugin skills are found correctly.
    let master_row = crate::db::get_skill_master_by_id(&conn, skill_id)
        .ok()
        .flatten();
    let plugin_slug = master_row
        .as_ref()
        .map(|m| m.plugin_slug.clone())
        .unwrap_or_else(|| crate::skill_paths::DEFAULT_PLUGIN_SLUG.to_string());

    // Validate prerequisites (step 3 requires decisions from DB)
    if step_id == 3 {
        let decisions = crate::db::workflow_artifacts::read_decisions(&conn, &skill_id.to_string())
            .map_err(|e| e.to_string())?;
        if decisions.is_none_or(|d| d.items.is_empty()) {
            return Err(
                "Cannot start Generate Skill step: no decisions found in the database. \
                 The Confirm Decisions step (step 2) must complete before the Generate Skill \
                 step can run. Please re-run the Confirm Decisions step first."
                    .to_string(),
            );
        }
    }

    // Get skill purpose
    let purpose = crate::db::get_purpose_by_skill_id(&conn, skill_id)?;

    // Read author info and intake data from workflow run
    let run_row = crate::db::get_workflow_run_by_skill_id(&conn, skill_id)
        .ok()
        .flatten();
    let author_login = settings
        .github_user_email
        .clone()
        .or(settings.github_user_login.clone())
        .or_else(|| run_row.as_ref().and_then(|r| r.author_login.clone()));
    let created_at = run_row.as_ref().map(|r| r.created_at.clone());
    let intake_json = run_row.as_ref().and_then(|r| r.intake_json.clone());
    let description = master_row.as_ref().and_then(|m| m.description.clone());
    let version = master_row.as_ref().and_then(|m| m.version.clone());
    let user_invocable = master_row.as_ref().and_then(|m| m.user_invocable);
    let disable_model_invocation = master_row.as_ref().and_then(|m| m.disable_model_invocation);
    let tags = crate::db::get_tags_for_skills(&conn, &[skill_name.to_string()])
        .unwrap_or_default()
        .remove(skill_name)
        .unwrap_or_default();

    let documents = master_row
        .as_ref()
        .map(|m| m.id)
        .map(|sid| {
            crate::db::db_documents_for_skill(&conn, sid).unwrap_or_else(|e| {
                log::warn!(
                    "read_workflow_settings: failed to load documents for skill {}: {}",
                    skill_name,
                    e
                );
                vec![]
            })
        })
        .unwrap_or_default();

    Ok(WorkflowSettings {
        plugin_slug,
        skills_path,
        llm,
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
        user_invocable,
        disable_model_invocation,
        documents,
    })
}

pub(crate) fn read_workflow_settings(
    db: &Db,
    skill_name: &str,
    step_id: u32,
    workspace_path: &str,
) -> Result<WorkflowSettings, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let skill_id = crate::db::get_skill_master_id_any_plugin(&conn, skill_name)?
        .ok_or_else(|| format!("Skill '{}' not found", skill_name))?;
    drop(conn);
    read_workflow_settings_by_skill_id(db, skill_id, skill_name, step_id, workspace_path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{create_test_db_for_tests, upsert_skill, write_settings, Db};
    use crate::types::{AppSettings, ModelSettings, SecretString};
    use std::sync::Mutex;

    fn workflow_settings_for(app_settings: AppSettings) -> Result<WorkflowSettings, String> {
        let conn = create_test_db_for_tests();
        upsert_skill(&conn, "test-skill", "skill-builder", "domain").unwrap();
        write_settings(&conn, &app_settings).unwrap();
        let db = Db(std::sync::Arc::new(Mutex::new(conn)));
        read_workflow_settings(&db, "test-skill", 0, "/tmp/workspace")
    }

    fn configured_settings(model: &str, api_key: Option<&str>) -> AppSettings {
        AppSettings {
            skills_path: Some("/tmp/skills".to_string()),
            model_settings: ModelSettings {
                model: Some(model.to_string()),
                api_key: api_key.map(|key| SecretString::new(key.to_string())),
                ..ModelSettings::default()
            },
            ..AppSettings::default()
        }
    }

    fn initialized_skills_root(root: &std::path::Path) -> String {
        let skills_root = root.join("skills-root");
        std::fs::create_dir_all(&skills_root).unwrap();
        skills_root.to_string_lossy().into_owned()
    }

    #[test]
    fn read_initialized_runtime_context_returns_skills_root_and_llm() {
        let tmp = tempfile::tempdir().unwrap();
        let workspace_path = initialized_skills_root(tmp.path());
        let conn = create_test_db_for_tests();
        let mut settings = configured_settings("anthropic/claude-sonnet-4-5", Some("sk-test"));
        settings.skills_path = Some(workspace_path.clone());
        write_settings(&conn, &settings).unwrap();
        let db = Db(std::sync::Arc::new(Mutex::new(conn)));

        let context = read_initialized_runtime_context(&db).unwrap();

        assert_eq!(context.workspace_path, workspace_path);
        assert_eq!(context.llm.model, "anthropic/claude-sonnet-4-5");
        assert_eq!(context.llm.api_key.as_ref().unwrap().expose(), "sk-test");
    }

    #[test]
    fn read_initialized_runtime_context_rejects_missing_skills_root() {
        let tmp = tempfile::tempdir().unwrap();
        let conn = create_test_db_for_tests();
        let mut settings = configured_settings("anthropic/claude-sonnet-4-5", Some("sk-test"));
        settings.skills_path = Some(
            tmp.path()
                .join("missing-skills-root")
                .to_string_lossy()
                .into_owned(),
        );
        write_settings(&conn, &settings).unwrap();
        let db = Db(std::sync::Arc::new(Mutex::new(conn)));

        let error = read_initialized_runtime_context(&db).unwrap_err();

        assert!(error.contains("Skills path is not initialized"));
    }

    #[test]
    fn read_workflow_settings_uses_canonical_model_id_as_runtime_authority() {
        let settings =
            workflow_settings_for(configured_settings("claude-sonnet-4-5", Some("sk-test")))
                .unwrap();
        assert_eq!(settings.llm.model, "claude-sonnet-4-5");
        assert_eq!(settings.llm.api_key.as_ref().unwrap().expose(), "sk-test");
    }

    #[test]
    fn read_workflow_settings_preserves_openhands_prefixed_model_ids() {
        let settings =
            workflow_settings_for(configured_settings("openai/gpt-4.1", Some("sk-openai")))
                .unwrap();
        assert_eq!(settings.llm.model, "openai/gpt-4.1");
    }

    #[test]
    fn read_workflow_settings_allows_model_without_api_key_and_keeps_base_url() {
        let mut app_settings = configured_settings("ollama/llama3.1", None);
        app_settings.model_settings.base_url = Some("http://localhost:11434".to_string());

        let settings = workflow_settings_for(app_settings).unwrap();

        assert_eq!(settings.llm.model, "ollama/llama3.1");
        assert!(settings.llm.api_key.is_none());
        assert_eq!(
            settings.llm.base_url.as_deref(),
            Some("http://localhost:11434")
        );
    }
}
