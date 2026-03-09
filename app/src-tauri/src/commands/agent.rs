use crate::agents::sidecar::{self, SidecarConfig};
use crate::agents::sidecar_pool::SidecarPool;
use crate::db::Db;

fn output_format_for_agent(
    skill_name: &str,
    agent_name: Option<&str>,
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

    if agent_name == Some("validate-skill") {
        return Some(serde_json::json!({
            "type": "json_schema",
            "schema": {
                "type": "object",
                "required": [
                    "status",
                    "validation_log_markdown",
                    "test_results_markdown",
                    "companion_skills_markdown"
                ],
                "properties": {
                    "status": { "type": "string", "const": "validation_complete" },
                    "validation_log_markdown": { "type": "string", "minLength": 1 },
                    "test_results_markdown": { "type": "string", "minLength": 1 },
                    "companion_skills_markdown": { "type": "string", "minLength": 1 }
                },
                "additionalProperties": false
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
    model: String,
    cwd: String,
    allowed_tools: Option<Vec<String>>,
    max_turns: Option<u32>,
    permission_mode: Option<String>,
    skill_name: String,
    _step_label: String,
    agent_name: Option<String>,
    transcript_log_dir: Option<String>,
) -> Result<String, String> {
    log::info!(
        "[start_agent] agent_id={} model={} skill_name={} agent_name={:?}",
        agent_id, model, skill_name, agent_name
    );
    let (api_key, extended_thinking, interleaved_thinking_beta, sdk_effort, fallback_model) = {
        let conn = db.0.lock().map_err(|e| {
            log::error!("[start_agent] Failed to acquire DB lock: {}", e);
            e.to_string()
        })?;
        let settings = crate::db::read_settings_hydrated(&conn)?;
        let key = match settings.anthropic_api_key {
            Some(k) => k,
            None => return Err("Anthropic API key not configured".to_string()),
        };

        let preferred_model = settings
            .preferred_model
            .clone()
            .unwrap_or_else(|| "sonnet".to_string());
        (
            key,
            settings.extended_thinking,
            settings.interleaved_thinking_beta,
            settings.sdk_effort.clone(),
            Some(preferred_model),
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

    // Agent frontmatter model is authoritative when agent_name is provided.
    let model_for_config = if agent_name.is_some() {
        None
    } else {
        Some(model.clone())
    };

    let config = SidecarConfig {
        prompt,
        model: model_for_config,
        api_key,
        cwd,
        allowed_tools,
        max_turns,
        permission_mode,
        betas: crate::commands::workflow::build_betas(
            thinking_budget,
            &model,
            interleaved_thinking_beta,
        ),
        thinking,
        fallback_model,
        effort: sdk_effort,
        output_format,
        prompt_suggestions: None,
        path_to_claude_code_executable: None,
        agent_name,
        conversation_history: None,
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
    use super::output_format_for_agent;

    #[test]
    fn test_output_format_for_feedback() {
        assert!(output_format_for_agent("_feedback", None).is_some());
    }

    #[test]
    fn test_output_format_for_validate_skill_agent() {
        let fmt = output_format_for_agent("my-skill", Some("validate-skill"));
        assert!(fmt.is_some());
        let schema = fmt.expect("schema");
        assert_eq!(schema["schema"]["properties"]["status"]["const"], "validation_complete");
    }

    #[test]
    fn test_output_format_is_unset_for_non_contract_agent_names() {
        assert!(output_format_for_agent("my-skill", Some("confirm-decisions")).is_none());
        assert!(output_format_for_agent("my-skill", Some("test-plan-with")).is_none());
        assert!(output_format_for_agent("my-skill", Some("test-plan-without")).is_none());
        assert!(output_format_for_agent("my-skill", Some("test-evaluator")).is_none());
    }
}
