use crate::agents::sidecar::{self, SidecarConfig};
use crate::agents::sidecar_pool::SidecarPool;
use crate::db::Db;

/// Suppress `fallback_model` when it equals `model` to avoid the SDK error
/// "Fallback model cannot be the same as the main model".
///
/// Only applies when an explicit `model` is set (i.e. no `agent_name`).
/// When `model` is `None` (agent frontmatter is authoritative) we leave
/// `fallback_model` as-is — the agent's frontmatter model may differ.
fn suppress_same_fallback_model(
    model: Option<&str>,
    fallback_model: Option<String>,
) -> Option<String> {
    match model {
        Some(m) if fallback_model.as_deref() == Some(m) => None,
        _ => fallback_model,
    }
}

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
                    "test_results_markdown"
                ],
                "properties": {
                    "status": { "type": "string", "const": "validation_complete" },
                    "validation_log_markdown": { "type": "string", "minLength": 1 },
                    "test_results_markdown": { "type": "string", "minLength": 1 }
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
    step_id: Option<i32>,
    workflow_session_id: Option<String>,
    usage_session_id: Option<String>,
    run_source: Option<String>,
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

        (
            key,
            settings.extended_thinking,
            settings.interleaved_thinking_beta,
            settings.sdk_effort.clone(),
            settings.fallback_model.clone(),
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

    // The SDK rejects a config where fallbackModel == the explicit main model.
    // Suppress fallback_model when it would equal model_for_config (e.g. user's
    // preferred model is haiku and the evaluator is also invoked with haiku).
    if fallback_model.as_deref() == model_for_config.as_deref() && model_for_config.is_some() {
        log::debug!(
            "[start_agent] suppressing fallback_model '{}' — equals main model",
            model_for_config.as_deref().unwrap_or("")
        );
    }
    let fallback_model = suppress_same_fallback_model(model_for_config.as_deref(), fallback_model);

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
        required_plugins: None,
        conversation_history: None,
        skill_name: Some(skill_name.clone()),
        step_id: Some(step_id.unwrap_or(-1)),
        workflow_session_id,
        usage_session_id,
        run_source,
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
    use super::{output_format_for_agent, suppress_same_fallback_model};

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

    #[test]
    fn test_suppress_same_fallback_model_clears_when_equal() {
        // Evaluator scenario: preferred_model = haiku, model = haiku → suppress
        let result = suppress_same_fallback_model(
            Some("claude-haiku-4-5-20251001"),
            Some("claude-haiku-4-5-20251001".to_string()),
        );
        assert!(result.is_none(), "fallback must be suppressed when equal to main model");
    }

    #[test]
    fn test_suppress_same_fallback_model_keeps_when_different() {
        // Typical scenario: preferred_model = sonnet, fallback = sonnet, main = opus
        let result = suppress_same_fallback_model(
            Some("claude-opus-4-6"),
            Some("claude-sonnet-4-6".to_string()),
        );
        assert_eq!(result.as_deref(), Some("claude-sonnet-4-6"));
    }

    #[test]
    fn test_suppress_same_fallback_model_keeps_when_no_explicit_model() {
        // agent_name is set → model_for_config = None; fallback is preserved
        let result = suppress_same_fallback_model(
            None,
            Some("claude-haiku-4-5-20251001".to_string()),
        );
        assert_eq!(result.as_deref(), Some("claude-haiku-4-5-20251001"));
    }

    #[test]
    fn test_suppress_same_fallback_model_noop_when_no_fallback() {
        let result = suppress_same_fallback_model(Some("claude-sonnet-4-6"), None);
        assert!(result.is_none());
    }
}
