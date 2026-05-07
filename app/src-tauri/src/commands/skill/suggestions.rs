use crate::agents::openhands_server::{self, OpenHandsOneShotRunParams};
use crate::agents::sidecar::{OpenHandsOneShotConfigParams, SidecarConfig};
use crate::db::Db;
use serde::Serialize;

const SUGGESTIONS_TEMPLATE: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../agent-sources/prompts/skill-suggestions.txt"
));

const SKILL_CREATOR_USER_SUFFIX: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../agent-sources/prompts/skill-creator-user-suffix.txt"
));

const ALL_FIELDS: [&str; 8] = [
    "description",
    "domain",
    "scope",
    "audience",
    "challenges",
    "unique_setup",
    "agent_mistakes",
    "context_questions",
];

#[derive(Debug, Serialize)]
pub struct FieldSuggestions {
    pub description: String,
    pub domain: String,
    pub audience: String,
    pub challenges: String,
    pub scope: String,
    pub unique_setup: String,
    pub agent_mistakes: String,
    pub context_questions: String,
}

pub(crate) struct SuggestionsRuntimeConfigParams<'a> {
    pub skill_name: &'a str,
    pub prompt: &'a str,
    pub workspace_path: &'a str,
    pub llm: crate::types::WorkflowLlmConfig,
    pub requested_fields: Vec<String>,
}

/// Generate field suggestions through the app-owned OpenHands one-shot path.
/// The `fields` param controls which fields to generate; context params provide
/// prior field values so each group builds on the last.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn generate_suggestions(
    app: tauri::AppHandle,
    skill_name: String,
    purpose: String,
    industry: Option<String>,
    function_role: Option<String>,
    domain: Option<String>,
    scope: Option<String>,
    audience: Option<String>,
    challenges: Option<String>,
    fields: Option<Vec<String>>,
    db: tauri::State<'_, Db>,
) -> Result<FieldSuggestions, String> {
    log::info!(
        "[generate_suggestions] skill={} purpose={} fields={:?}",
        skill_name,
        purpose,
        fields
    );

    let runtime_context = crate::commands::workflow::read_initialized_runtime_context(&db)
        .inspect_err(|e| {
            log::error!("[generate_suggestions] Runtime context unavailable: {}", e)
        })?;

    let requested_fields = requested_fields(fields.as_deref())?;
    let prompt = render_suggestions_prompt(
        &skill_name,
        &purpose,
        industry.as_deref(),
        function_role.as_deref(),
        domain.as_deref(),
        scope.as_deref(),
        audience.as_deref(),
        challenges.as_deref(),
        &requested_fields,
    );

    log::debug!("[generate_suggestions] prompt length={}", prompt.len());

    let config = build_suggestions_runtime_config(SuggestionsRuntimeConfigParams {
        skill_name: &skill_name,
        prompt: &prompt,
        workspace_path: &runtime_context.workspace_path,
        llm: runtime_context.llm,
        requested_fields: requested_fields.clone(),
    })?;

    let run = openhands_server::run_openhands_one_shot(
        &app,
        OpenHandsOneShotRunParams {
            agent_id_prefix: format!("{}-suggestions", skill_name),
            agent_id: None,
            config,
            timeout: std::time::Duration::from_secs(90),
        },
    )
    .await
    .inspect_err(|e| log::error!("[generate_suggestions] OpenHands request failed: {}", e))?;

    parse_suggestions_from_conversation_state(&run.conversation_state, &requested_fields)
}

fn requested_fields(fields: Option<&[String]>) -> Result<Vec<String>, String> {
    fields.map_or_else(
        || {
            Ok(ALL_FIELDS
                .iter()
                .map(|field| (*field).to_string())
                .collect())
        },
        validate_requested_fields,
    )
}

fn validate_requested_fields(fields: &[String]) -> Result<Vec<String>, String> {
    if fields.is_empty() {
        return Err("Requested suggestion fields must include at least one field".to_string());
    }

    if fields.iter().any(|field| field.trim().is_empty()) {
        return Err("Requested suggestion fields must not be blank".to_string());
    }

    let mut normalized = Vec::new();
    let mut invalid = Vec::new();

    for field in fields {
        let trimmed = field.trim();
        if !ALL_FIELDS.contains(&trimmed) {
            invalid.push(trimmed.to_string());
            continue;
        }
        if !normalized.iter().any(|value| value == trimmed) {
            normalized.push(trimmed.to_string());
        }
    }

    if !invalid.is_empty() {
        return Err(format!("Invalid suggestion fields: {}", invalid.join(", ")));
    }

    if normalized.is_empty() {
        return Err(
            "Requested suggestion fields must include at least one valid field".to_string(),
        );
    }

    Ok(normalized)
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn render_suggestions_prompt(
    skill_name: &str,
    purpose: &str,
    industry: Option<&str>,
    function_role: Option<&str>,
    domain: Option<&str>,
    scope: Option<&str>,
    audience: Option<&str>,
    challenges: Option<&str>,
    requested_fields: &[String],
) -> String {
    let readable_name = skill_name.replace('-', " ");

    let context_parts: Vec<String> = [
        industry
            .filter(|value| !value.is_empty())
            .map(|value| format!("Industry: {}", value)),
        function_role
            .filter(|value| !value.is_empty())
            .map(|value| format!("Role: {}", value)),
    ]
    .into_iter()
    .flatten()
    .collect();

    let context = if context_parts.is_empty() {
        String::new()
    } else {
        format!(" User context: {}.", context_parts.join(", "))
    };

    let detail_parts: Vec<String> = [
        domain
            .filter(|value| !value.is_empty())
            .map(|value| format!("Domain: {}", value)),
        scope
            .filter(|value| !value.is_empty())
            .map(|value| format!("Scope: {}", value)),
        audience
            .filter(|value| !value.is_empty())
            .map(|value| format!("Target audience: {}", value)),
        challenges
            .filter(|value| !value.is_empty())
            .map(|value| format!("Key challenges: {}", value)),
    ]
    .into_iter()
    .flatten()
    .collect();

    let detail_context = if detail_parts.is_empty() {
        String::new()
    } else {
        format!(" Skill details: {}.", detail_parts.join("; "))
    };

    let framing = match purpose {
        "data-engineering" | "source" | "platform" => {
            "Skills are loaded into the app's agent runtime to help engineers build data pipelines. \
             The runtime already knows standard methodologies from its training data. \
             A skill must encode the delta -- the customer-specific and domain-specific knowledge \
             that the assistant misses or misapplies when working without the skill."
        }
        _ => {
            "Skills are loaded into the app's agent runtime to help users work effectively in their specific domain. \
             The runtime already has broad general knowledge from its training data. \
             A skill must encode the delta -- the customer-specific and domain-specific knowledge \
             that the assistant misses or misapplies when working without the skill."
        }
    };

    let json_schema = format!(
        "{{{}}}",
        requested_fields
            .iter()
            .filter_map(|field| field_prompt_schema(field, purpose, &readable_name))
            .collect::<Vec<_>>()
            .join(", ")
    );

    SUGGESTIONS_TEMPLATE
        .trim_end_matches('\n')
        .replace("{{framing}}", framing)
        .replace("{{readable_name}}", &readable_name)
        .replace("{{purpose}}", purpose)
        .replace("{{context}}", &context)
        .replace("{{detail_context}}", &detail_context)
        .replace("{{json_schema}}", &json_schema)
}

fn field_prompt_schema(field: &str, purpose: &str, readable_name: &str) -> Option<String> {
    match field {
        "description" => Some(format!(
            "\"description\": \"<Third person. Nouns must be specific (e.g. 'churned customers', 'purchase orders' — not 'data' or 'metrics'). \
Any number of nouns is fine as long as they all serve ONE overarching process (the process named by the skill). \
Do NOT combine nouns from two distinct processes or different business functions — those belong in separate skills. \
Format: '[Verb]s [specific noun(s)] [context]. Use when [one trigger].' \
Example: 'Forecasts which customers are at risk of churning based on health scores. Use when the CS team needs a prioritised list of at-risk accounts.' \
Max 2 sentences. Topic: {}.>\"",
            readable_name
        )),
        "domain" => Some(
            "\"domain\": \"<2-5 word domain name, e.g. Sales operations or Revenue recognition>\""
                .to_string(),
        ),
        "scope" => Some(
            "\"scope\": \"<short phrase, e.g. Focus on revenue analytics and reporting>\""
                .to_string(),
        ),
        "audience" => Some(
            "\"audience\": \"<2-3 short bullet points starting with • on separate lines, e.g. • Senior data engineers\\n• Analytics leads owning pipeline architecture>\"".to_string(),
        ),
        "challenges" => Some(
            "\"challenges\": \"<2-3 short bullet points starting with • on separate lines, e.g. • Late-arriving dimensions\\n• Schema drift across environments>\"".to_string(),
        ),
        "unique_setup" => Some(format!(
            "\"unique_setup\": \"<2-3 short bullet points starting with • on separate lines describing what makes a typical {} setup for {} different from standard implementations>\"",
            purpose, readable_name
        )),
        "agent_mistakes" => Some(format!(
            "\"agent_mistakes\": \"<2-3 short bullet points starting with • on separate lines describing what the assistant gets wrong when working with {} in the {} domain>\"",
            readable_name, purpose
        )),
        "context_questions" => {
            let purpose_label = match purpose {
                "domain" => "Business process knowledge",
                "source" => "Source system semantics",
                "data-engineering" => "Organization specific data engineering standards",
                "platform" => "Organization specific Azure or Fabric standards",
                _ => purpose,
            };
            Some(format!(
                "\"context_questions\": \"<exactly 2 bullets starting with \u{2022} on separate lines, 2-4 words each. Bullet 1: what is unique about this {} setup. Bullet 2: what does the assistant usually miss. Be specific to {}.>\"",
                purpose_label, readable_name
            ))
        }
        _ => None,
    }
}

fn suggestions_output_format(requested_fields: &[String]) -> Result<serde_json::Value, String> {
    let requested_fields = validate_requested_fields(requested_fields)?;
    let properties = requested_fields
        .iter()
        .map(|field| (field.clone(), serde_json::json!({ "type": "string" })))
        .collect::<serde_json::Map<String, serde_json::Value>>();

    let required = properties.keys().cloned().collect::<Vec<_>>();

    Ok(serde_json::json!({
        "type": "json_schema",
        "schema": {
            "type": "object",
            "required": required,
            "properties": properties,
            "additionalProperties": false
        }
    }))
}

pub(crate) fn build_suggestions_runtime_config(
    params: SuggestionsRuntimeConfigParams<'_>,
) -> Result<SidecarConfig, String> {
    let workspace_dir = params.workspace_path.replace('\\', "/");

    Ok(crate::agents::sidecar::build_openhands_one_shot_config(
        OpenHandsOneShotConfigParams {
            prompt: params.prompt.to_string(),
            llm: params.llm,
            workspace_root_dir: workspace_dir.clone(),
            workspace_run_dir: workspace_dir,
            agent_name: "skill-creator".to_string(),
            task_kind: Some("skill_suggestions".to_string()),
            user_message_suffix: Some(SKILL_CREATOR_USER_SUFFIX.trim().to_string()),
            allowed_tools: vec!["file_editor".to_string()],
            max_turns: 4,
            output_format: Some(suggestions_output_format(&params.requested_fields)?),
            skill_name: Some(params.skill_name.to_string()),
            step_id: Some(-31),
            run_source: None,
            plugin_slug: crate::skill_paths::DEFAULT_PLUGIN_SLUG.to_string(),
        },
    ))
}

fn parse_suggestions_from_conversation_state(
    state: &serde_json::Value,
    requested_fields: &[String],
) -> Result<FieldSuggestions, String> {
    if state.get("type").and_then(|value| value.as_str()) != Some("conversation_state") {
        return Err("Suggestions result was not an OpenHands conversation_state".to_string());
    }

    match state.get("status").and_then(|value| value.as_str()) {
        Some("completed") => parse_completed_suggestions_output(state, requested_fields),
        Some("error") | Some("cancelled") => Err(state
            .get("error_detail")
            .or_else(|| state.get("errorDetail"))
            .and_then(|value| value.as_str())
            .filter(|value| !value.trim().is_empty())
            .unwrap_or("Suggestions generation failed")
            .to_string()),
        Some(status) => Err(format!(
            "Suggestions generation did not reach terminal status: {}",
            status
        )),
        None => Err("Suggestions conversation_state missing status".to_string()),
    }
}

fn parse_completed_suggestions_output(
    state: &serde_json::Value,
    requested_fields: &[String],
) -> Result<FieldSuggestions, String> {
    if let Some(structured_output) = state
        .get("structured_output")
        .or_else(|| state.get("structuredOutput"))
        .filter(|value| value.is_object())
    {
        return parse_suggestions_value(structured_output, requested_fields);
    }

    let Some(result_text) = state
        .get("result_text")
        .or_else(|| state.get("resultText"))
        .and_then(|value| value.as_str())
        .filter(|value| !value.trim().is_empty())
    else {
        return Err("Suggestions completed without parseable output".to_string());
    };

    parse_suggestions_result_text(result_text, requested_fields)
        .map_err(|e| format!("Suggestions completed without parseable output: {}", e))
}

fn parse_suggestions_result_text(
    text: &str,
    requested_fields: &[String],
) -> Result<FieldSuggestions, String> {
    let cleaned = text.trim();
    let cleaned = cleaned
        .strip_prefix("```json")
        .or_else(|| cleaned.strip_prefix("```"))
        .unwrap_or(cleaned);
    let cleaned = cleaned.strip_suffix("```").unwrap_or(cleaned).trim();

    let parsed: serde_json::Value = serde_json::from_str(cleaned).map_err(|e| {
        log::error!(
            "[generate_suggestions] Failed to parse result: raw text={}",
            text
        );
        format!("Failed to parse result: {}", e)
    })?;

    parse_suggestions_value(&parsed, requested_fields)
}

fn parse_suggestions_value(
    parsed: &serde_json::Value,
    requested_fields: &[String],
) -> Result<FieldSuggestions, String> {
    let object = parsed
        .as_object()
        .ok_or_else(|| "Suggestions output must be a JSON object".to_string())?;
    let requested_fields = validate_requested_fields(requested_fields)?;

    let mut saw_known_field = false;
    let mut saw_non_empty_value = false;

    for (key, value) in object {
        if !ALL_FIELDS.contains(&key.as_str()) {
            return Err(format!(
                "Suggestions output contained unknown suggestion field '{}'",
                key
            ));
        }
        if !requested_fields.iter().any(|field| field == key) {
            return Err(format!(
                "Suggestions output contained field '{}' that was not requested",
                key
            ));
        }
        let string_value = value
            .as_str()
            .ok_or_else(|| format!("Suggestions field '{}' must be a string", key))?;
        saw_known_field = true;
        if !string_value.trim().is_empty() {
            saw_non_empty_value = true;
        }
    }

    let missing_requested_fields = requested_fields
        .iter()
        .filter(|field| !object.contains_key(field.as_str()))
        .cloned()
        .collect::<Vec<_>>();

    if !saw_known_field {
        return Err("Suggestions output contained no recognized suggestion fields".to_string());
    }
    if !saw_non_empty_value {
        return Err("Suggestions output contained no non-empty suggestion fields".to_string());
    }
    if !missing_requested_fields.is_empty() {
        return Err(format!(
            "Suggestions output missing requested field(s): {}",
            missing_requested_fields.join(", ")
        ));
    }

    let field = |key: &str| -> String {
        object
            .get(key)
            .and_then(|value| value.as_str())
            .unwrap_or("")
            .to_string()
    };

    Ok(FieldSuggestions {
        description: field("description"),
        domain: field("domain"),
        audience: field("audience"),
        challenges: field("challenges"),
        scope: field("scope"),
        unique_setup: field("unique_setup"),
        agent_mistakes: field("agent_mistakes"),
        context_questions: field("context_questions"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_suggestions_prompt_without_claude_wording() {
        let prompt = render_suggestions_prompt(
            "forecasting-churned-customers",
            "data-engineering",
            Some("B2B SaaS"),
            Some("Analytics engineering"),
            Some("Customer success"),
            Some("Renewal forecasting"),
            Some("Data engineers"),
            Some("Fragmented health signals"),
            &[
                "description".to_string(),
                "agent_mistakes".to_string(),
                "context_questions".to_string(),
            ],
        );

        assert!(prompt.contains("forecasting churned customers"));
        assert!(!prompt.contains("Claude"));
        assert!(!prompt.contains("Claude Code"));
        assert!(prompt.contains("\"agent_mistakes\""));
        assert!(prompt.contains("assistant gets wrong"));
        assert!(prompt.contains("assistant usually miss"));
    }

    #[test]
    fn suggestions_openhands_config_uses_clean_break_runner_contract() {
        let config = build_suggestions_runtime_config(SuggestionsRuntimeConfigParams {
            skill_name: "forecasting-churned-customers",
            prompt: "rendered prompt",
            workspace_path: "/tmp/skill-builder/workspace",
            llm: crate::types::WorkflowLlmConfig {
                model: "gpt-4.1".to_string(),
                api_key: Some(crate::types::SecretString::new("sk-test".to_string())),
                base_url: None,
                api_version: None,
                temperature: None,
                max_output_tokens: None,
                timeout_seconds: None,
                num_retries: None,
                reasoning_effort: None,
                extra_headers: None,
                input_cost_per_token: None,
                output_cost_per_token: None,
                usage_id: Some("workflow".to_string()),
            },
            requested_fields: vec!["description".to_string(), "agent_mistakes".to_string()],
        })
        .unwrap();

        let json = serde_json::to_value(&config).unwrap();
        assert_eq!(json["mode"], "one-shot");
        assert_eq!(json["agentName"], "skill-creator");
        assert_eq!(json["taskKind"], "skill_suggestions");
        assert_eq!(
            json["userMessageSuffix"],
            "Follow the current user message exactly. Do not infer a different task than the one stated in the message."
        );
        let expected_suffix = crate::agents::sidecar::skill_creator_system_message_suffix();
        assert_eq!(
            json["systemMessageSuffix"],
            serde_json::Value::String(expected_suffix)
        );
        assert_eq!(json["llm"]["model"], "gpt-4.1");
        assert!(json.get("model").is_none());
        assert_eq!(json["apiKey"], "openhands-llm-config");
        assert_eq!(json["allowedTools"], serde_json::json!(["file_editor"]));
        assert_eq!(json["maxTurns"], 4);
        assert!(json["outputFormat"]["schema"]["required"]
            .as_array()
            .unwrap()
            .contains(&serde_json::json!("agent_mistakes")));
    }

    #[test]
    fn parses_completed_suggestions_from_structured_output() {
        let state = serde_json::json!({
            "type": "conversation_state",
            "status": "completed",
            "structured_output": {
                "description": "Forecasts churn risk for customer success teams.",
                "agent_mistakes": "• Misses company-specific health score cutoffs",
                "context_questions": "• Health score logic\n• Renewal risk triggers"
            }
        });

        let result = parse_suggestions_from_conversation_state(
            &state,
            &[
                "description".to_string(),
                "agent_mistakes".to_string(),
                "context_questions".to_string(),
            ],
        )
        .unwrap();

        assert_eq!(
            result.description,
            "Forecasts churn risk for customer success teams."
        );
        assert_eq!(
            result.agent_mistakes,
            "• Misses company-specific health score cutoffs"
        );
        assert_eq!(
            result.context_questions,
            "• Health score logic\n• Renewal risk triggers"
        );
        assert!(result.domain.is_empty());
    }

    #[test]
    fn parses_completed_suggestions_from_result_text() {
        let state = serde_json::json!({
            "type": "conversation_state",
            "status": "completed",
            "result_text": r#"{"description":"Forecasts churn risk.","agent_mistakes":"• Misses company standards"}"#
        });

        let result = parse_suggestions_from_conversation_state(
            &state,
            &["description".to_string(), "agent_mistakes".to_string()],
        )
        .unwrap();

        assert_eq!(result.description, "Forecasts churn risk.");
        assert_eq!(result.agent_mistakes, "• Misses company standards");
    }

    #[test]
    fn rejects_empty_requested_fields_input() {
        let error = requested_fields(Some(&[])).unwrap_err();
        assert!(error.contains("at least one"));
    }

    #[test]
    fn rejects_unknown_requested_fields_input() {
        let error = requested_fields(Some(&["unknown".to_string()])).unwrap_err();
        assert!(error.contains("unknown"));
    }

    #[test]
    fn rejects_blank_requested_fields_input() {
        let error = requested_fields(Some(&["   ".to_string()])).unwrap_err();
        assert!(error.contains("must not be blank"));
    }

    #[test]
    fn rejects_output_format_without_valid_fields() {
        let error = suggestions_output_format(&[]).unwrap_err();
        assert!(error.contains("at least one"));
    }

    #[test]
    fn rejects_completed_suggestions_with_unknown_structured_output_fields() {
        let state = serde_json::json!({
            "type": "conversation_state",
            "status": "completed",
            "structured_output": {
                "unexpected": "value"
            }
        });

        let error = parse_suggestions_from_conversation_state(
            &state,
            &ALL_FIELDS
                .iter()
                .map(|field| (*field).to_string())
                .collect::<Vec<_>>(),
        )
        .unwrap_err();
        assert!(error.contains("unknown suggestion field"));
    }

    #[test]
    fn rejects_completed_suggestions_with_non_string_structured_output_fields() {
        let state = serde_json::json!({
            "type": "conversation_state",
            "status": "completed",
            "structured_output": {
                "description": 42
            }
        });

        let error = parse_suggestions_from_conversation_state(
            &state,
            &ALL_FIELDS
                .iter()
                .map(|field| (*field).to_string())
                .collect::<Vec<_>>(),
        )
        .unwrap_err();
        assert!(error.contains("must be a string"));
    }

    #[test]
    fn rejects_completed_suggestions_with_empty_structured_output() {
        let state = serde_json::json!({
            "type": "conversation_state",
            "status": "completed",
            "structured_output": {}
        });

        let error = parse_suggestions_from_conversation_state(
            &state,
            &ALL_FIELDS
                .iter()
                .map(|field| (*field).to_string())
                .collect::<Vec<_>>(),
        )
        .unwrap_err();
        assert!(error.contains("no recognized suggestion fields"));
    }

    #[test]
    fn rejects_completed_suggestions_with_malformed_result_text() {
        let state = serde_json::json!({
            "type": "conversation_state",
            "status": "completed",
            "result_text": r#"{"description":42}"#
        });

        let error = parse_suggestions_from_conversation_state(
            &state,
            &ALL_FIELDS
                .iter()
                .map(|field| (*field).to_string())
                .collect::<Vec<_>>(),
        )
        .unwrap_err();
        assert!(error.contains("must be a string"));
    }

    #[test]
    fn rejects_result_text_fields_outside_requested_subset() {
        let state = serde_json::json!({
            "type": "conversation_state",
            "status": "completed",
            "result_text": r#"{"domain":"Revenue ops"}"#
        });

        let error = parse_suggestions_from_conversation_state(&state, &["description".to_string()])
            .unwrap_err();
        assert!(error.contains("not requested"));
    }

    #[test]
    fn rejects_missing_requested_fields_from_result_text() {
        let state = serde_json::json!({
            "type": "conversation_state",
            "status": "completed",
            "result_text": r#"{"description":"Forecasts churn risk."}"#
        });

        let error = parse_suggestions_from_conversation_state(
            &state,
            &["description".to_string(), "domain".to_string()],
        )
        .unwrap_err();
        assert!(error.contains("missing requested field"));
    }
}
