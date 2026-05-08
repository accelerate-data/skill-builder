use crate::agents::openhands_server::{self, OpenHandsThrowawayRunParams};
use crate::agents::sidecar::{OpenHandsRuntimeConfigParams, OpenHandsRuntimeMode, SidecarConfig};
use crate::db::Db;
use serde::{Deserialize, Serialize};

const SCOPE_REVIEW_PROMPT: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../agent-sources/prompts/scope-review.txt"
));

const SKILL_CREATOR_USER_SUFFIX: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../agent-sources/prompts/skill-creator-user-suffix.txt"
));

#[derive(Debug, Serialize, Deserialize)]
pub struct ScopeReviewSuggestion {
    pub name: String,
    pub description: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ScopeReviewResult {
    pub status: String,
    pub reason: String,
    pub suggested_skills: Vec<ScopeReviewSuggestion>,
}

pub(crate) struct ScopeReviewPromptParams<'a> {
    pub skill_name: &'a str,
    pub description: &'a str,
    pub purpose: &'a str,
    pub context_questions: Option<&'a str>,
    pub industry: Option<&'a str>,
    pub reference_documents: &'a [(String, String)],
}

pub(crate) struct ScopeReviewSidecarConfigParams<'a> {
    pub skill_name: &'a str,
    pub prompt: &'a str,
    pub workspace_path: &'a str,
    pub workspace_run_dir: &'a str,
    pub llm: crate::types::WorkflowLlmConfig,
}

pub(crate) fn render_scope_review_prompt(params: ScopeReviewPromptParams<'_>) -> String {
    let context_questions = params
        .context_questions
        .filter(|value| !value.trim().is_empty())
        .map(|value| format!("\n- Additional context: {}", value.trim()))
        .unwrap_or_default();
    let industry = params
        .industry
        .filter(|value| !value.trim().is_empty())
        .map(|value| format!("\nIndustry context: {}", value.trim()))
        .unwrap_or_default();
    let reference_documents = render_reference_documents(params.reference_documents);

    SCOPE_REVIEW_PROMPT
        .replace("{{skill_name}}", params.skill_name)
        .replace("{{description}}", params.description)
        .replace("{{purpose}}", params.purpose)
        .replace("{{context_questions}}", &context_questions)
        .replace("{{industry}}", &industry)
        .replace("{{reference_documents}}", &reference_documents)
}

fn render_reference_documents(documents: &[(String, String)]) -> String {
    if documents.is_empty() {
        return String::new();
    }

    let parts = documents
        .iter()
        .map(|(name, content)| {
            let end = content.floor_char_boundary(2000);
            let snippet = &content[..end];
            format!("### {}\n{}", name, snippet)
        })
        .collect::<Vec<_>>();

    format!(
        "\n\n## Reference Documents\n\n{}",
        parts.join("\n\n---\n\n")
    )
}

fn scope_review_output_format() -> serde_json::Value {
    serde_json::json!({
        "type": "json_schema",
        "schema": {
            "type": "object",
            "required": ["status", "reason", "suggested_skills"],
            "properties": {
                "status": {
                    "type": "string",
                    "enum": [
                        "focused",
                        "too-broad",
                        "name-needs-improvement",
                        "description-needs-improvement",
                        "both-need-improvement"
                    ]
                },
                "reason": { "type": "string" },
                "suggested_skills": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "required": ["name", "description"],
                        "properties": {
                            "name": { "type": "string" },
                            "description": { "type": "string" }
                        },
                        "additionalProperties": false
                    }
                }
            },
            "additionalProperties": false
        }
    })
}

pub(crate) fn build_scope_review_sidecar_config(
    params: ScopeReviewSidecarConfigParams<'_>,
) -> SidecarConfig {
    let workspace_root_dir = params.workspace_path.replace('\\', "/");
    let workspace_run_dir = params.workspace_run_dir.replace('\\', "/");

    crate::agents::sidecar::build_openhands_runtime_config(OpenHandsRuntimeConfigParams {
        prompt: params.prompt.to_string(),
        llm: params.llm,
        workspace_root_dir,
        workspace_run_dir,
        mode: Some(OpenHandsRuntimeMode::Throwaway),
        agent_name: "skill-creator".to_string(),
        task_kind: Some("scope_review".to_string()),
        user_message_suffix: Some(SKILL_CREATOR_USER_SUFFIX.trim().to_string()),
        allowed_tools: vec!["file_editor".to_string()],
        max_turns: 4,
        output_format: Some(scope_review_output_format()),
        skill_name: Some(params.skill_name.to_string()),
        step_id: Some(-30),
        run_source: None,
        plugin_slug: crate::skill_paths::DEFAULT_PLUGIN_SLUG.to_string(),
    })
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn review_skill_scope(
    app: tauri::AppHandle,
    skill_name: String,
    description: String,
    purpose: String,
    context_questions: Option<String>,
    industry: Option<String>,
    db: tauri::State<'_, Db>,
) -> Result<ScopeReviewResult, String> {
    log::info!(
        "[review_skill_scope] skill={} purpose={}",
        skill_name,
        purpose
    );

    let runtime_context = crate::commands::workflow::read_initialized_runtime_context(&db)
        .inspect_err(|e| log::error!("[review_skill_scope] Runtime context unavailable: {}", e))?;
    let document_paths = {
        let conn = db.0.lock().map_err(|e| {
            log::error!("[review_skill_scope] Failed to acquire DB lock: {}", e);
            e.to_string()
        })?;
        crate::db::db_list_documents(&conn)
            .unwrap_or_default()
            .into_iter()
            .filter(|d| d.scope == "all")
            .map(|d| (d.name, d.file_path))
            .collect::<Vec<_>>()
    };

    let documents = document_paths
        .into_iter()
        .filter_map(|(name, file_path)| {
            std::fs::read_to_string(&file_path)
                .ok()
                .map(|content| (name, content))
        })
        .collect::<Vec<_>>();

    let prompt = render_scope_review_prompt(ScopeReviewPromptParams {
        skill_name: &skill_name,
        description: &description,
        purpose: &purpose,
        context_questions: context_questions.as_deref(),
        industry: industry.as_deref(),
        reference_documents: &documents,
    });

    log::debug!("[review_skill_scope] prompt length={}", prompt.len());

    let run_id = uuid::Uuid::new_v4().to_string();
    let runtime_run_dir = crate::skill_paths::throwaway_runtime_dir(
        std::path::Path::new(&runtime_context.workspace_path),
        "scope-review",
        &run_id,
    );
    std::fs::create_dir_all(crate::skill_paths::throwaway_conversations_dir(
        &runtime_run_dir,
    ))
    .map_err(|e| format!("Failed to create throwaway conversations dir: {e}"))?;
    std::fs::create_dir_all(crate::skill_paths::throwaway_logs_dir(&runtime_run_dir))
        .map_err(|e| format!("Failed to create throwaway logs dir: {e}"))?;
    crate::commands::workflow::deploy::ensure_openhands_runtime_dir(&app, &runtime_run_dir).await?;

    let config = build_scope_review_sidecar_config(ScopeReviewSidecarConfigParams {
        skill_name: &skill_name,
        prompt: &prompt,
        workspace_path: &runtime_context.workspace_path,
        workspace_run_dir: &runtime_run_dir.to_string_lossy(),
        llm: runtime_context.llm,
    });

    let run = openhands_server::run_throwaway_openhands_session(
        &app,
        OpenHandsThrowawayRunParams {
            agent_id: format!("{}-scope-review-{}", skill_name, uuid::Uuid::new_v4()),
            config,
            timeout: std::time::Duration::from_secs(90),
        },
    )
    .await
    .inspect_err(|e| log::error!("[review_skill_scope] sidecar request failed: {}", e))?;

    let result = parse_scope_review_result_from_conversation_state(&run.conversation_state)?;

    log::info!(
        "[review_skill_scope] result: status={} suggestions={}",
        result.status,
        result.suggested_skills.len()
    );
    Ok(result)
}

fn parse_scope_review_result_from_conversation_state(
    state: &serde_json::Value,
) -> Result<ScopeReviewResult, String> {
    if state.get("type").and_then(|v| v.as_str()) != Some("conversation_state") {
        return Err("Scope review result was not an OpenHands conversation_state".to_string());
    }

    match state.get("status").and_then(|v| v.as_str()) {
        Some("completed") => parse_completed_scope_review_output(state),
        Some("error") | Some("cancelled") => Err(state
            .get("error_detail")
            .or_else(|| state.get("errorDetail"))
            .and_then(|v| v.as_str())
            .filter(|value| !value.trim().is_empty())
            .unwrap_or("Scope review failed")
            .to_string()),
        Some(status) => Err(format!(
            "Scope review did not reach terminal status: {}",
            status
        )),
        None => Err("Scope review conversation_state missing status".to_string()),
    }
}

fn parse_completed_scope_review_output(
    state: &serde_json::Value,
) -> Result<ScopeReviewResult, String> {
    if let Some(structured_output) = state
        .get("structured_output")
        .or_else(|| state.get("structuredOutput"))
        .filter(|value| value.is_object())
    {
        return parse_scope_review_result_value(structured_output)
            .map_err(|e| format!("Failed to parse structured scope review output: {}", e));
    }

    let Some(result_text) = state
        .get("result_text")
        .or_else(|| state.get("resultText"))
        .and_then(|value| value.as_str())
        .filter(|value| !value.trim().is_empty())
    else {
        return Err("Scope review completed without parseable output".to_string());
    };

    parse_scope_review_result_text(result_text)
        .map_err(|e| format!("Scope review completed without parseable output: {}", e))
}

fn parse_scope_review_result_value(
    parsed: &serde_json::Value,
) -> Result<ScopeReviewResult, String> {
    let valid_statuses = [
        "focused",
        "too-broad",
        "name-needs-improvement",
        "description-needs-improvement",
        "both-need-improvement",
    ];
    let status = parsed["status"]
        .as_str()
        .filter(|s| valid_statuses.contains(s))
        .ok_or_else(|| "Scope review result missing valid status".to_string())?
        .to_string();
    let reason = parsed["reason"]
        .as_str()
        .ok_or_else(|| "Scope review result missing reason".to_string())?
        .to_string();
    let suggested_skills = parsed["suggested_skills"]
        .as_array()
        .ok_or_else(|| "Scope review result missing suggested_skills".to_string())?
        .iter()
        .map(|s| {
            let name = s["name"]
                .as_str()
                .ok_or_else(|| "Scope review suggestion missing name".to_string())?
                .to_string();
            let description = s["description"]
                .as_str()
                .ok_or_else(|| "Scope review suggestion missing description".to_string())?
                .to_string();
            Ok(ScopeReviewSuggestion { name, description })
        })
        .collect::<Result<Vec<_>, String>>()?;

    Ok(ScopeReviewResult {
        status,
        reason,
        suggested_skills,
    })
}

fn parse_scope_review_result_text(text: &str) -> Result<ScopeReviewResult, String> {
    let cleaned = text.trim();
    let cleaned = cleaned
        .strip_prefix("```json")
        .or_else(|| cleaned.strip_prefix("```"))
        .unwrap_or(cleaned);
    let cleaned = cleaned.strip_suffix("```").unwrap_or(cleaned).trim();

    let parsed: serde_json::Value = serde_json::from_str(cleaned).map_err(|e| {
        log::error!(
            "[review_skill_scope] Failed to parse result: raw text={}",
            text
        );
        format!("Failed to parse result: {}", e)
    })?;

    parse_scope_review_result_value(&parsed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_scope_review_prompt_from_template_with_submitted_values() {
        let prompt = render_scope_review_prompt(ScopeReviewPromptParams {
            skill_name: "forecasting-churned-customers",
            description: "Forecasts customer churn from CRM health scores.",
            purpose: "Guide analytics engineers building customer success marts.",
            context_questions: Some("Use renewal dates and account owner context."),
            industry: Some("B2B SaaS"),
            reference_documents: &[(
                "Customer Health Playbook".to_string(),
                "Renewal risk is a single company-specific workflow.".to_string(),
            )],
        });

        assert!(prompt.contains("forecasting-churned-customers"));
        assert!(prompt.contains("Forecasts customer churn from CRM health scores."));
        assert!(prompt.contains("Guide analytics engineers building customer success marts."));
        assert!(prompt.contains("Use renewal dates and account owner context."));
        assert!(prompt.contains("B2B SaaS"));
        assert!(prompt.contains("Customer Health Playbook"));
        assert!(prompt.contains("\"status\": string"));
        assert!(prompt.contains("\"suggested_skills\""));
    }

    #[test]
    fn scope_review_openhands_config_uses_clean_break_runner_contract() {
        let config = build_scope_review_sidecar_config(ScopeReviewSidecarConfigParams {
            skill_name: "forecasting-churned-customers",
            prompt: "rendered prompt",
            workspace_path: "/tmp/skill-builder/workspace",
            workspace_run_dir:
                "/tmp/skill-builder/workspace/.openhands/throwaway/scope-review/run-1",
            llm: crate::types::WorkflowLlmConfig {
                model: "anthropic/claude-sonnet-4-5".to_string(),
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
        });

        let json = serde_json::to_value(&config).unwrap();
        assert_eq!(json["mode"], "throwaway");
        assert_eq!(json["agentName"], "skill-creator");
        assert_eq!(json["taskKind"], "scope_review");
        assert_eq!(
            json["userMessageSuffix"],
            "Follow the current user message exactly. Do not infer a different task than the one stated in the message."
        );
        let expected_suffix = crate::agents::sidecar::skill_creator_system_message_suffix();
        assert_eq!(
            json["systemMessageSuffix"],
            serde_json::Value::String(expected_suffix)
        );
        assert_eq!(json["llm"]["model"], "anthropic/claude-sonnet-4-5");
        assert!(json.get("model").is_none());
        assert_eq!(json["apiKey"], "openhands-llm-config");
        assert!(json["workspaceRootDir"]
            .as_str()
            .unwrap()
            .ends_with("/workspace"));
        assert!(json["workspaceSkillDir"]
            .as_str()
            .unwrap()
            .ends_with("/workspace/.openhands/throwaway/scope-review/run-1"));
        assert_eq!(json["allowedTools"], serde_json::json!(["file_editor"]));
        assert_eq!(json["maxTurns"], 4);
        assert!(json["outputFormat"]["schema"]["required"]
            .as_array()
            .unwrap()
            .contains(&serde_json::json!("suggested_skills")));
    }

    #[test]
    fn parses_valid_scope_review_result_text() {
        let result = parse_scope_review_result_text(
            r#"{"status":"too-broad","reason":"Covers multiple workflows.","suggested_skills":[{"name":"renewal-risk","description":"Focuses on renewal risk."}]}"#,
        )
        .unwrap();

        assert_eq!(result.status, "too-broad");
        assert_eq!(result.reason, "Covers multiple workflows.");
        assert_eq!(result.suggested_skills.len(), 1);
        assert_eq!(result.suggested_skills[0].name, "renewal-risk");
    }

    #[test]
    fn parses_completed_scope_review_from_result_text() {
        let state = serde_json::json!({
            "type": "conversation_state",
            "status": "completed",
            "result_text": r#"{"status":"too-broad","reason":"Covers multiple workflows.","suggested_skills":[{"name":"renewal-risk","description":"Focuses on renewal risk."}]}"#
        });

        let result = parse_scope_review_result_from_conversation_state(&state).unwrap();

        assert_eq!(result.status, "too-broad");
        assert_eq!(result.reason, "Covers multiple workflows.");
        assert_eq!(result.suggested_skills[0].name, "renewal-risk");
    }

    #[test]
    fn prefers_structured_output_over_result_text() {
        let state = serde_json::json!({
            "type": "conversation_state",
            "status": "completed",
            "structured_output": {
                "status": "focused",
                "reason": "Single workflow.",
                "suggested_skills": []
            },
            "result_text": r#"{"status":"too-broad","reason":"Fallback text.","suggested_skills":[]}"#
        });

        let result = parse_scope_review_result_from_conversation_state(&state).unwrap();

        assert_eq!(result.status, "focused");
        assert_eq!(result.reason, "Single workflow.");
    }

    #[test]
    fn rejects_completed_scope_review_without_parseable_output() {
        let state = serde_json::json!({
            "type": "conversation_state",
            "status": "completed"
        });

        let error = parse_scope_review_result_from_conversation_state(&state).unwrap_err();

        assert!(error.contains("Scope review completed without parseable output"));
    }

    #[test]
    fn surfaces_terminal_error_detail() {
        let state = serde_json::json!({
            "type": "conversation_state",
            "status": "error",
            "error_detail": "schema validation failed"
        });

        let error = parse_scope_review_result_from_conversation_state(&state).unwrap_err();

        assert_eq!(error, "schema validation failed");
    }

    #[test]
    fn rejects_scope_review_result_with_invalid_status() {
        let error = parse_scope_review_result_text(
            r#"{"status":"ok","reason":"Looks fine.","suggested_skills":[]}"#,
        )
        .unwrap_err();

        assert_eq!(error, "Scope review result missing valid status");
    }

    #[test]
    fn rejects_scope_review_result_without_suggestions_array() {
        let error =
            parse_scope_review_result_text(r#"{"status":"focused","reason":"Looks fine."}"#)
                .unwrap_err();

        assert_eq!(error, "Scope review result missing suggested_skills");
    }
}
