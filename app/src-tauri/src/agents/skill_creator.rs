#![allow(dead_code)]

use std::path::Path;

use crate::agents::runtime_config::{
    build_openhands_runtime_config, BuildOpenHandsRuntimeConfigParams, OpenHandsRuntimeConfig,
    OpenHandsRuntimeMode,
};
use crate::generated::schemas;
use crate::skill_paths::resolve_skill_dir;
use crate::types::WorkflowLlmConfig;

pub const SKILL_CREATOR_USER_SUFFIX: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../agent-sources/prompts/skill-creator-user-suffix.txt"
));

// ─── WorkflowStepKind ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy)]
pub enum WorkflowStepKind {
    Research,
    DetailedResearch,
    ConfirmDecisions,
    GenerateSkill,
}

// ─── SkillCreatorIntent ──────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub enum SkillCreatorIntent {
    Refine,
    SelectedSkillSession,
    WorkflowStep { step: WorkflowStepKind },
    AnswerEvaluator,
    Eval,
    ScopeReview,
    ModelValidation,
}

// ─── SkillCreatorRuntimeContext ──────────────────────────────────────────────

pub struct SkillCreatorRuntimeContext {
    pub app_data_root: String,
    pub skills_root: String,
    pub skill_name: String,
    pub plugin_slug: String,
    pub prompt: String,
    pub llm: WorkflowLlmConfig,
    pub intent: SkillCreatorIntent,
    /// Override the resolved skill_dir. Used by throwaway surfaces (scope review,
    /// model validation, eval workbench) that need a custom runtime directory.
    pub skill_dir_override: Option<String>,
}

// ─── Intent-derived policy helpers ───────────────────────────────────────────

fn intent_task_kind(intent: &SkillCreatorIntent) -> &'static str {
    match intent {
        SkillCreatorIntent::Refine => "refine",
        SkillCreatorIntent::SelectedSkillSession => "selected_skill_session",
        SkillCreatorIntent::WorkflowStep { step } => match step {
            WorkflowStepKind::Research => "workflow.research",
            WorkflowStepKind::DetailedResearch => "workflow.detailed_research",
            WorkflowStepKind::ConfirmDecisions => "workflow.confirm_decisions",
            WorkflowStepKind::GenerateSkill => "workflow.skill_generation",
        },
        SkillCreatorIntent::AnswerEvaluator => "workflow.answer_evaluator",
        SkillCreatorIntent::Eval => "scenario-suggest",
        SkillCreatorIntent::ScopeReview => "scope_review",
        SkillCreatorIntent::ModelValidation => "settings.model_connection_test",
    }
}

fn intent_run_source(intent: &SkillCreatorIntent) -> Option<&'static str> {
    match intent {
        SkillCreatorIntent::Refine => Some("refine"),
        SkillCreatorIntent::SelectedSkillSession => Some("selected-skill-session"),
        SkillCreatorIntent::WorkflowStep { .. } => Some("workflow"),
        SkillCreatorIntent::AnswerEvaluator => Some("gate-eval"),
        SkillCreatorIntent::Eval => Some("scenario-suggest"),
        SkillCreatorIntent::ScopeReview => None,
        SkillCreatorIntent::ModelValidation => Some("test"),
    }
}

fn intent_allowed_tools(intent: &SkillCreatorIntent) -> Vec<String> {
    match intent {
        SkillCreatorIntent::Refine => {
            vec!["file_editor".to_string(), "terminal".to_string()]
        }
        SkillCreatorIntent::SelectedSkillSession => {
            vec!["file_editor".to_string(), "terminal".to_string()]
        }
        SkillCreatorIntent::WorkflowStep { step } => match step {
            WorkflowStepKind::Research | WorkflowStepKind::DetailedResearch => {
                ["file_editor", "terminal", "browser_tool_set"]
                    .iter()
                    .map(|s| s.to_string())
                    .collect()
            }
            WorkflowStepKind::ConfirmDecisions => {
                vec!["file_editor".to_string()]
            }
            WorkflowStepKind::GenerateSkill => {
                vec!["file_editor".to_string(), "terminal".to_string()]
            }
        },
        SkillCreatorIntent::AnswerEvaluator => {
            vec!["file_editor".to_string()]
        }
        SkillCreatorIntent::Eval => {
            vec!["file_editor".to_string(), "terminal".to_string()]
        }
        SkillCreatorIntent::ScopeReview => {
            vec!["file_editor".to_string()]
        }
        SkillCreatorIntent::ModelValidation => {
            vec![]
        }
    }
}

fn intent_max_turns(intent: &SkillCreatorIntent) -> u32 {
    match intent {
        SkillCreatorIntent::Refine => 500,
        SkillCreatorIntent::SelectedSkillSession => 500,
        SkillCreatorIntent::WorkflowStep { step } => match step {
            WorkflowStepKind::Research => 50,
            WorkflowStepKind::DetailedResearch => 50,
            WorkflowStepKind::ConfirmDecisions => 100,
            WorkflowStepKind::GenerateSkill => 500,
        },
        SkillCreatorIntent::AnswerEvaluator => 20,
        SkillCreatorIntent::Eval => 10,
        SkillCreatorIntent::ScopeReview => 4,
        SkillCreatorIntent::ModelValidation => 1,
    }
}

fn intent_step_id(intent: &SkillCreatorIntent) -> i32 {
    match intent {
        SkillCreatorIntent::Refine => -10,
        SkillCreatorIntent::SelectedSkillSession => -12,
        SkillCreatorIntent::WorkflowStep { step } => match step {
            WorkflowStepKind::Research => 0,
            WorkflowStepKind::DetailedResearch => 1,
            WorkflowStepKind::ConfirmDecisions => 2,
            WorkflowStepKind::GenerateSkill => 3,
        },
        SkillCreatorIntent::AnswerEvaluator => -1,
        SkillCreatorIntent::Eval => -11,
        SkillCreatorIntent::ScopeReview => -30,
        SkillCreatorIntent::ModelValidation => -40,
    }
}

fn intent_output_format(intent: &SkillCreatorIntent) -> Option<serde_json::Value> {
    match intent {
        SkillCreatorIntent::Refine => None,
        SkillCreatorIntent::SelectedSkillSession => None,
        SkillCreatorIntent::WorkflowStep { step } => match step {
            WorkflowStepKind::Research => Some(wrap_schema(schemas::RESEARCH_STEP_INLINE_SCHEMA)),
            WorkflowStepKind::DetailedResearch => {
                Some(wrap_schema(schemas::DETAILED_RESEARCH_INLINE_SCHEMA))
            }
            WorkflowStepKind::ConfirmDecisions => {
                Some(wrap_schema(schemas::DECISIONS_INLINE_SCHEMA))
            }
            WorkflowStepKind::GenerateSkill => Some(wrap_schema(schemas::GENERATE_SKILL_SCHEMA)),
        },
        SkillCreatorIntent::AnswerEvaluator => Some(answer_evaluator_output_format()),
        SkillCreatorIntent::Eval => Some(suggested_scenario_output_format()),
        SkillCreatorIntent::ScopeReview => Some(scope_review_output_format()),
        SkillCreatorIntent::ModelValidation => None,
    }
}

fn intent_mode(intent: &SkillCreatorIntent) -> Option<OpenHandsRuntimeMode> {
    match intent {
        SkillCreatorIntent::Refine => None,
        SkillCreatorIntent::SelectedSkillSession => None,
        SkillCreatorIntent::WorkflowStep { .. } => None,
        SkillCreatorIntent::AnswerEvaluator => None,
        SkillCreatorIntent::Eval => Some(OpenHandsRuntimeMode::Throwaway),
        SkillCreatorIntent::ScopeReview => Some(OpenHandsRuntimeMode::Throwaway),
        SkillCreatorIntent::ModelValidation => Some(OpenHandsRuntimeMode::Throwaway),
    }
}

fn intent_user_message_suffix(intent: &SkillCreatorIntent) -> Option<String> {
    match intent {
        SkillCreatorIntent::Refine
        | SkillCreatorIntent::SelectedSkillSession
        | SkillCreatorIntent::WorkflowStep { .. }
        | SkillCreatorIntent::AnswerEvaluator => {
            Some(SKILL_CREATOR_USER_SUFFIX.trim().to_string())
        }
        SkillCreatorIntent::ScopeReview => Some(
            "Follow the current user message exactly. Do not infer a different task than the one stated in the message.".to_string(),
        ),
        _ => None,
    }
}

fn wrap_schema(schema_str: &str) -> serde_json::Value {
    let schema: serde_json::Value =
        serde_json::from_str(schema_str).expect("generated schema must be valid JSON");
    serde_json::json!({
        "type": "json_schema",
        "schema": schema
    })
}

fn answer_evaluator_output_format() -> serde_json::Value {
    let schema: serde_json::Value =
        serde_json::from_str(crate::generated::schemas::ANSWER_EVALUATION_SCHEMA)
            .expect("generated ANSWER_EVALUATION_SCHEMA must be valid JSON");
    serde_json::json!({
        "type": "json_schema",
        "schema": schema
    })
}

fn suggested_scenario_output_format() -> serde_json::Value {
    serde_json::json!({
        "type": "object",
        "properties": {
            "name": { "type": "string" },
            "prompt": { "type": "string" },
            "expectations": {
                "type": "array",
                "items": { "type": "string" }
            }
        },
        "required": ["name", "prompt", "expectations"]
    })
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

// ─── Canonical builder ───────────────────────────────────────────────────────

pub fn build_skill_creator_config(
    context: SkillCreatorRuntimeContext,
) -> OpenHandsRuntimeConfig {
    let skill_dir = context.skill_dir_override.unwrap_or_else(|| {
        resolve_skill_dir(
            Path::new(&context.skills_root),
            &context.plugin_slug,
            &context.skill_name,
        )
        .to_string_lossy()
        .replace('\\', "/")
    });

    build_openhands_runtime_config(BuildOpenHandsRuntimeConfigParams {
        prompt: context.prompt,
        llm: context.llm,
        app_data_root: context.app_data_root,
        skills_root: context.skills_root.replace('\\', "/"),
        skill_dir,
        mode: intent_mode(&context.intent),
        agent_name: "skill-creator".to_string(),
        task_kind: Some(intent_task_kind(&context.intent).to_string()),
        user_message_suffix: intent_user_message_suffix(&context.intent),
        allowed_tools: intent_allowed_tools(&context.intent),
        max_turns: intent_max_turns(&context.intent),
        output_format: intent_output_format(&context.intent),
        skill_name: Some(context.skill_name),
        step_id: Some(intent_step_id(&context.intent)),
        run_source: intent_run_source(&context.intent).map(|s| s.to_string()),
        plugin_slug: context.plugin_slug,
    })
}

// ─── Session helper ──────────────────────────────────────────────────────────

pub async fn ensure_skill_session(
    app: &tauri::AppHandle,
    config: OpenHandsRuntimeConfig,
    saved_conversation_id: Option<String>,
) -> Result<crate::agents::openhands_server::StartedOpenHandsSession, String> {
    crate::agents::openhands_server::ensure_openhands_server(&config).await?;
    crate::agents::openhands_server::start_openhands_session(app, config, saved_conversation_id)
        .await
}

// ─── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::skill_paths::DEFAULT_PLUGIN_SLUG;

    fn test_llm_config() -> WorkflowLlmConfig {
        WorkflowLlmConfig {
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
            usage_id: None,
        }
    }

    #[test]
    fn test_build_skill_creator_config_refine_intent() {
        let config = build_skill_creator_config(SkillCreatorRuntimeContext {
            app_data_root: "/tmp/app-data".to_string(),
            skills_root: "/tmp/skills".to_string(),
            skill_name: "test-skill".to_string(),
            plugin_slug: "default".to_string(),
            prompt: "do something".to_string(),
            llm: test_llm_config(),
            intent: SkillCreatorIntent::Refine,
            skill_dir_override: None,
        });

        assert_eq!(config.agent_name, Some("skill-creator".to_string()));
        assert_eq!(config.task_kind, Some("refine".to_string()));
        assert_eq!(config.run_source, Some("refine".to_string()));
        assert_eq!(config.step_id, Some(-10));
        assert_eq!(config.skill_name, Some("test-skill".to_string()));
        assert_eq!(config.plugin_slug, "default");
        assert_eq!(config.max_turns, Some(500));
        assert_eq!(
            config.allowed_tools,
            Some(vec!["file_editor".to_string(), "terminal".to_string()])
        );
        assert!(config.user_message_suffix.is_some());
        assert!(config.skill_dir.contains("default"));
        assert!(config.skill_dir.contains("skills"));
        assert!(config.skill_dir.contains("test-skill"));
    }

    #[test]
    fn test_build_skill_creator_config_selected_skill_session_intent() {
        let config = build_skill_creator_config(SkillCreatorRuntimeContext {
            app_data_root: "/tmp/app-data".to_string(),
            skills_root: "/tmp/skills".to_string(),
            skill_name: "selected-skill".to_string(),
            plugin_slug: "default".to_string(),
            prompt: "continue the active session".to_string(),
            llm: test_llm_config(),
            intent: SkillCreatorIntent::SelectedSkillSession,
            skill_dir_override: None,
        });

        assert_eq!(config.agent_name, Some("skill-creator".to_string()));
        assert_eq!(config.task_kind, Some("selected_skill_session".to_string()));
        assert_eq!(config.run_source, Some("selected-skill-session".to_string()));
        assert_eq!(config.step_id, Some(-12));
        assert_eq!(config.skill_name, Some("selected-skill".to_string()));
        assert_eq!(config.plugin_slug, "default");
        assert_eq!(config.max_turns, Some(500));
        assert_eq!(
            config.allowed_tools,
            Some(vec!["file_editor".to_string(), "terminal".to_string()])
        );
        assert!(config.user_message_suffix.is_some());
    }

    #[test]
    fn test_build_skill_creator_config_workflow_step_research() {
        let config = build_skill_creator_config(SkillCreatorRuntimeContext {
            app_data_root: "/tmp/app-data".to_string(),
            skills_root: "/tmp/skills".to_string(),
            skill_name: "my-skill".to_string(),
            plugin_slug: "plugins".to_string(),
            prompt: "research".to_string(),
            llm: test_llm_config(),
            intent: SkillCreatorIntent::WorkflowStep {
                step: WorkflowStepKind::Research,
            },
            skill_dir_override: None,
        });

        assert_eq!(config.task_kind, Some("workflow.research".to_string()));
        assert_eq!(config.step_id, Some(0));
        assert_eq!(config.run_source, Some("workflow".to_string()));
        assert_eq!(config.max_turns, Some(50));
    }

    #[test]
    fn test_build_skill_creator_config_workflow_step_generate_skill() {
        let config = build_skill_creator_config(SkillCreatorRuntimeContext {
            app_data_root: "/tmp/app-data".to_string(),
            skills_root: "/tmp/skills".to_string(),
            skill_name: "my-skill".to_string(),
            plugin_slug: "plugins".to_string(),
            prompt: "generate".to_string(),
            llm: test_llm_config(),
            intent: SkillCreatorIntent::WorkflowStep {
                step: WorkflowStepKind::GenerateSkill,
            },
            skill_dir_override: None,
        });

        assert_eq!(
            config.task_kind,
            Some("workflow.skill_generation".to_string())
        );
        assert_eq!(config.step_id, Some(3));
        assert_eq!(config.max_turns, Some(500));
        assert_eq!(
            config.allowed_tools,
            Some(vec!["file_editor".to_string(), "terminal".to_string()])
        );
    }

    #[test]
    fn test_build_skill_creator_config_answer_evaluator() {
        let config = build_skill_creator_config(SkillCreatorRuntimeContext {
            app_data_root: "/tmp/app-data".to_string(),
            skills_root: "/tmp/skills".to_string(),
            skill_name: "my-skill".to_string(),
            plugin_slug: "default".to_string(),
            prompt: "evaluate".to_string(),
            llm: test_llm_config(),
            intent: SkillCreatorIntent::AnswerEvaluator,
            skill_dir_override: None,
        });

        assert_eq!(
            config.task_kind,
            Some("workflow.answer_evaluator".to_string())
        );
        assert_eq!(config.step_id, Some(-1));
        assert_eq!(config.run_source, Some("gate-eval".to_string()));
        assert!(config.output_format.is_some());
        assert_eq!(config.max_turns, Some(20));
    }

    #[test]
    fn test_build_skill_creator_config_scope_review() {
        let config = build_skill_creator_config(SkillCreatorRuntimeContext {
            app_data_root: "/tmp/app-data".to_string(),
            skills_root: "/tmp/skills".to_string(),
            skill_name: "my-skill".to_string(),
            plugin_slug: DEFAULT_PLUGIN_SLUG.to_string(),
            prompt: "review scope".to_string(),
            llm: test_llm_config(),
            intent: SkillCreatorIntent::ScopeReview,
            skill_dir_override: Some("/tmp/skill-builder/throwaway/scope-review/run-1".to_string()),
        });

        assert_eq!(config.task_kind, Some("scope_review".to_string()));
        assert_eq!(config.step_id, Some(-30));
        assert_eq!(config.run_source, None);
        assert_eq!(config.mode.as_deref(), Some("throwaway"));
        assert_eq!(config.max_turns, Some(4));
        assert_eq!(
            config.allowed_tools,
            Some(vec!["file_editor".to_string()])
        );
        assert!(config.output_format.is_some());
        assert!(config.user_message_suffix.is_some());
    }

    #[test]
    fn test_build_skill_creator_config_model_validation() {
        let config = build_skill_creator_config(SkillCreatorRuntimeContext {
            app_data_root: "/tmp/app-data".to_string(),
            skills_root: "/tmp/skills".to_string(),
            skill_name: String::new(),
            plugin_slug: DEFAULT_PLUGIN_SLUG.to_string(),
            prompt: "Reply with exactly OK and nothing else.".to_string(),
            llm: test_llm_config(),
            intent: SkillCreatorIntent::ModelValidation,
            skill_dir_override: Some("/tmp/skill-builder/throwaway/model-connection-test/run-1".to_string()),
        });

        assert_eq!(
            config.task_kind,
            Some("settings.model_connection_test".to_string())
        );
        assert_eq!(config.step_id, Some(-40));
        assert_eq!(config.run_source, Some("test".to_string()));
        assert_eq!(config.mode.as_deref(), Some("throwaway"));
        assert_eq!(config.max_turns, Some(1));
        assert_eq!(config.allowed_tools, Some(vec![]));
        assert!(config.output_format.is_none());
    }

    #[test]
    fn test_build_skill_creator_config_eval_intent() {
        let config = build_skill_creator_config(SkillCreatorRuntimeContext {
            app_data_root: "/tmp/app-data".to_string(),
            skills_root: "/tmp/skills".to_string(),
            skill_name: "my-skill".to_string(),
            plugin_slug: "default".to_string(),
            prompt: "suggest scenario".to_string(),
            llm: test_llm_config(),
            intent: SkillCreatorIntent::Eval,
            skill_dir_override: Some(
                "/tmp/skill-builder/throwaway/eval-workbench/run-1".to_string(),
            ),
        });

        assert_eq!(config.task_kind, Some("scenario-suggest".to_string()));
        assert_eq!(config.step_id, Some(-11));
        assert_eq!(config.run_source, Some("scenario-suggest".to_string()));
        assert_eq!(config.mode.as_deref(), Some("throwaway"));
        assert_eq!(config.max_turns, Some(10));
        assert!(config.output_format.is_some());
    }

    #[test]
    fn test_skill_creator_user_suffix_is_non_empty() {
        assert!(!SKILL_CREATOR_USER_SUFFIX.trim().is_empty());
    }

    #[test]
    fn test_throwaway_runtime_dir_override_uses_system_temp_shape() {
        let dir = crate::skill_paths::throwaway_runtime_dir("model-connection-test", "run-xyz");
        assert!(
            dir.to_string_lossy()
                .contains("skill-builder/throwaway/model-connection-test/run-xyz")
        );
    }
}
