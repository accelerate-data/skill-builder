use crate::agents::sidecar::{self, SidecarConfig};
use crate::agents::sidecar_pool::SidecarPool;
use crate::db::Db;

fn derive_setting_sources(agent_name: Option<&str>) -> Option<Vec<String>> {
    let _ = agent_name;
    None
}

/// Derive required plugins from the agent name.
///
/// Plugin-scoped agents use the format `plugin-name:agent-name`. The plugin
/// must be in `required_plugins` so the sidecar discovers and loads it,
/// allowing the SDK to resolve the agent's .md spec and sibling agents.
fn derive_required_plugins(agent_name: Option<&str>) -> Vec<String> {
    // Plugin-scoped agents (e.g. "skill-creator:generate-skill") derive their plugin name.
    if let Some(plugins) = agent_name
        .and_then(|n| n.split_once(':'))
        .map(|(plugin, _)| vec![plugin.to_string()])
    {
        return plugins;
    }
    // Standalone agents that need explicit plugin access:
    vec![]
}

/// Output format schemas for non-workflow agents (feedback).
/// Workflow agent schemas live in `workflow/step_config.rs`.
pub(crate) fn output_format_for_agent(
    skill_name: &str,
    _agent_name: Option<&str>,
) -> Option<serde_json::Value> {
    if skill_name == "_feedback" {
        return Some(serde_json::json!({
            "type": "json_schema",
            "schema": {
                "type": "object",
                "required": ["type", "title", "body", "labels"],
                "properties": {
                    "type": { "type": "string", "enum": ["bug", "feature"] },
                    "title": { "type": "string" },
                    "body": { "type": "string" },
                    "labels": {
                        "oneOf": [
                            { "type": "string" },
                            { "type": "array", "items": { "type": "string" } }
                        ]
                    }
                },
                "additionalProperties": true
            }
        }));
    }

    None
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn start_agent(
    app: tauri::AppHandle,
    pool: tauri::State<'_, SidecarPool>,
    db: tauri::State<'_, Db>,
    agent_id: String,
    prompt: String,
    system_prompt: Option<String>,
    model: String,
    cwd: String,
    allowed_tools: Option<Vec<String>>,
    max_turns: Option<u32>,
    permission_mode: Option<String>,
    skill_name: String,
    _step_label: String,
    agent_name: Option<String>,
    transcript_log_dir: Option<String>,
    step_id: Option<i32>,
    workflow_session_id: Option<String>,
    usage_session_id: Option<String>,
    run_source: Option<String>,
    plugin_slug: String,
) -> Result<String, String> {
    log::info!(
        "[start_agent] agent_id={} model={} skill_name={} agent_name={:?} step_id={:?} run_source={:?}",
        agent_id, model, skill_name, agent_name, step_id, run_source
    );
    log::debug!(
        "[start_agent] cwd={} transcript_log_dir={:?} prompt_prefix={:?}",
        cwd,
        transcript_log_dir,
        prompt.chars().take(120).collect::<String>()
    );
    let (api_key, extended_thinking, interleaved_thinking_beta, sdk_effort) = {
        let conn = db.0.lock().map_err(|e| {
            log::error!("[start_agent] Failed to acquire DB lock: {}", e);
            e.to_string()
        })?;
        let settings = crate::db::read_settings(&conn)?;
        let key = match settings.anthropic_api_key {
            Some(k) => crate::types::SecretString::new(k),
            None => return Err("Anthropic API key not configured".to_string()),
        };

        (
            key,
            settings.extended_thinking,
            settings.interleaved_thinking_beta,
            settings.sdk_effort.clone(),
        )
    };

    let thinking_budget: Option<u32> = if extended_thinking {
        Some(16_000)
    } else {
        None
    };

    let thinking = thinking_budget.map(|budget| {
        serde_json::json!({
            "type": "enabled",
            "budgetTokens": budget
        })
    });

    // Apply outputFormat only where agents are expected to return strict JSON.
    let output_format = output_format_for_agent(&skill_name, agent_name.as_deref());

    // Explicit model always passed — overrides agent frontmatter default.
    let model_for_config = Some(model.clone());

    let setting_sources = derive_setting_sources(agent_name.as_deref());

    let config = SidecarConfig {
        mode: Some("one-shot".to_string()),
        prompt,
        system_prompt,
        model: model_for_config,
        llm: None,
        model_base_url: None,
        api_key,
        workspace_root_dir: cwd.clone(),
        workspace_skill_dir: cwd,
        allowed_tools,
        max_turns,
        permission_mode,
        betas: crate::commands::workflow::build_betas(
            thinking_budget,
            &model,
            interleaved_thinking_beta,
        ),
        thinking,
        fallback_model: None,
        effort: sdk_effort,
        output_format,
        prompt_suggestions: None,
        path_to_claude_code_executable: None,
        required_plugins: Some(derive_required_plugins(agent_name.as_deref())),
        agent_name,
        setting_sources,
        conversation_history: None,
        skill_name: Some(skill_name.clone()),
        step_id: Some(step_id.unwrap_or(-1)),
        workflow_session_id,
        usage_session_id,
        run_source,
        plugin_slug,
        transcript_log_dir: None,
        persistence_dir: None,
        runtime_provider: None,
        task_kind: None,
        user_message_suffix: None,
    };

    sidecar::spawn_sidecar(
        agent_id.clone(),
        config,
        pool.inner().clone(),
        app,
        skill_name,
        transcript_log_dir,
    )
    .await?;

    Ok(agent_id)
}

#[cfg(test)]
mod tests {
    use super::{derive_required_plugins, derive_setting_sources, output_format_for_agent};

    #[test]
    fn plugin_scoped_agent_derives_plugin_name() {
        assert_eq!(
            derive_required_plugins(Some("skill-creator:generate-skill")),
            vec!["skill-creator"]
        );
    }

    #[test]
    fn non_plugin_agent_derives_no_plugins() {
        let empty: Vec<String> = vec![];
        assert_eq!(derive_required_plugins(None), empty);
        assert_eq!(derive_required_plugins(Some("generate-skill")), empty);
    }

    #[test]
    fn other_agents_get_default_setting_sources() {
        assert_eq!(derive_setting_sources(None), None);
        assert_eq!(derive_setting_sources(Some("generate-skill")), None);
        assert_eq!(
            derive_setting_sources(Some("skill-creator:generate-skill")),
            None
        );
        assert_eq!(derive_setting_sources(Some("skill-creator:analyze-skill")), None);
    }

    #[test]
    fn test_output_format_for_feedback() {
        assert!(output_format_for_agent("_feedback", None).is_some());
    }

    #[test]
    fn test_output_format_is_unset_for_non_contract_agent_names() {
        assert!(output_format_for_agent("my-skill", Some("validate-skill")).is_none());
        assert!(output_format_for_agent("my-skill", Some("confirm-decisions")).is_none());
        assert!(output_format_for_agent("my-skill", Some("test-plan-with")).is_none());
        assert!(output_format_for_agent("my-skill", Some("test-plan-without")).is_none());
        assert!(output_format_for_agent("my-skill", Some("test-evaluator")).is_none());
        assert!(output_format_for_agent("my-skill", Some("skill-creator:generate-skill")).is_none());
    }
}
