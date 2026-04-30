use crate::agents::sidecar::{self, SidecarConfig};
use crate::agents::sidecar_pool::SidecarPool;
use crate::db::Db;

/// Derive `setting_sources` for a given agent name.
///
/// The evaluate-skill agent must only see skills from its parent plugin
/// (skill-creator). Workspace-level skills (e.g. `skill-test`) are loaded
/// via `settingSources: ['project']` and must be suppressed for this agent.
/// Passing `Some(vec![])` prevents workspace skill loading while the plugin
/// itself is still loaded via the `plugins` SDK option.
///
/// All other agents receive `None`, which causes the sidecar to fall back to
/// its default of `['project']`.
fn derive_setting_sources(agent_name: Option<&str>) -> Option<Vec<String>> {
    match agent_name {
        Some(n) if n == "evaluate-skill"
            || n.ends_with(":evaluate-skill") => Some(vec![]),
        _ => None,
    }
}

/// Derive required plugins from the agent name.
///
/// Plugin-scoped agents use the format `plugin-name:agent-name`. The plugin
/// must be in `required_plugins` so the sidecar discovers and loads it,
/// allowing the SDK to resolve the agent's .md spec and sibling agents.
fn derive_required_plugins(agent_name: Option<&str>) -> Vec<String> {
    // evaluate-skill needs both plugins: skill-creator (grader) + vd-agent (executor)
    if matches!(agent_name, Some(n) if n == "evaluate-skill" || n.ends_with(":evaluate-skill")) {
        return vec!["skill-creator".to_string(), "vd-agent".to_string()];
    }
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

/// Suppress `fallback_model` when it equals `model` to avoid the SDK error
/// "Fallback model cannot be the same as the main model".
///
/// Only applies when an explicit `model` is set (i.e. no `agent_name`).
/// When `model` is `None` (agent frontmatter is authoritative) we leave
/// `fallback_model` as-is — the agent's frontmatter model may differ.
pub(crate) fn suppress_same_fallback_model(
    model: Option<&str>,
    fallback_model: Option<String>,
) -> Option<String> {
    match model {
        Some(m) if fallback_model.as_deref() == Some(m) => None,
        _ => fallback_model,
    }
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

    if matches!(_agent_name, Some("evaluate-skill")) {
        return Some(serde_json::json!({
            "type": "json_schema",
            "schema": {
                "type": "object",
                "required": ["status", "iteration", "results"],
                "properties": {
                    "status": { "type": "string", "enum": ["complete"] },
                    "iteration": { "type": "integer" },
                    "results": {
                        "type": "array",
                        "items": { "type": "string" }
                    }
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
    let (api_key, extended_thinking, interleaved_thinking_beta, sdk_effort, fallback_model) = {
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

    // Explicit model always passed — overrides agent frontmatter default.
    let model_for_config = Some(model.clone());

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

    let setting_sources = derive_setting_sources(agent_name.as_deref());

    let config = SidecarConfig {
        mode: Some("one-shot".to_string()),
        prompt,
        system_prompt,
        model: model_for_config,
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
        fallback_model,
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
    use super::{derive_required_plugins, derive_setting_sources, output_format_for_agent, suppress_same_fallback_model};

    #[test]
    fn plugin_scoped_agent_derives_plugin_name() {
        assert_eq!(
            derive_required_plugins(Some("skill-creator:evaluate-skill")),
            vec!["skill-creator", "vd-agent"]
        );
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
    fn evaluate_skill_agent_has_empty_setting_sources() {
        // evaluate-skill must never load workspace skills (skill-test contaminates runs)
        // Both standalone and plugin-scoped forms must match.
        assert_eq!(
            derive_setting_sources(Some("evaluate-skill")),
            Some(vec![]),
            "standalone evaluate-skill must have empty settingSources"
        );
        assert_eq!(
            derive_setting_sources(Some("skill-creator:evaluate-skill")),
            Some(vec![]),
            "plugin-scoped evaluate-skill must have empty settingSources"
        );
    }

    #[test]
    fn other_agents_get_default_setting_sources() {
        assert_eq!(derive_setting_sources(None), None);
        assert_eq!(derive_setting_sources(Some("generate-skill")), None);
        assert_eq!(derive_setting_sources(Some("skill-creator:generate-skill")), None);
        assert_eq!(derive_setting_sources(Some("skill-creator:analyze-skill")), None);
    }

    #[test]
    fn evaluate_skill_setting_sources_cannot_be_made_non_empty() {
        let sources = derive_setting_sources(Some("evaluate-skill")).unwrap();
        assert!(
            sources.is_empty(),
            "settingSources for evaluate-skill must be an empty vec, not {:?}",
            sources
        );
    }

    #[test]
    fn evaluate_skill_derives_both_plugins() {
        assert_eq!(
            derive_required_plugins(Some("evaluate-skill")),
            vec!["skill-creator", "vd-agent"],
            "standalone evaluate-skill must load skill-creator and vd-agent plugins"
        );
        assert_eq!(
            derive_required_plugins(Some("skill-creator:evaluate-skill")),
            vec!["skill-creator", "vd-agent"],
            "plugin-scoped evaluate-skill must load skill-creator and vd-agent plugins"
        );
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
        assert!(output_format_for_agent("my-skill", Some("skill-creator:generate-skill-description-evals")).is_none());
    }

    #[test]
    fn test_suppress_same_fallback_model_clears_when_equal() {
        // Evaluator scenario: preferred_model = haiku, model = haiku → suppress
        let result = suppress_same_fallback_model(
            Some("claude-haiku-4-5-20251001"),
            Some("claude-haiku-4-5-20251001".to_string()),
        );
        assert!(
            result.is_none(),
            "fallback must be suppressed when equal to main model"
        );
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
        let result =
            suppress_same_fallback_model(None, Some("claude-haiku-4-5-20251001".to_string()));
        assert_eq!(result.as_deref(), Some("claude-haiku-4-5-20251001"));
    }

    #[test]
    fn test_suppress_same_fallback_model_noop_when_no_fallback() {
        let result = suppress_same_fallback_model(Some("claude-sonnet-4-6"), None);
        assert!(result.is_none());
    }

}
