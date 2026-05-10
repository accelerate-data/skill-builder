use std::path::Path;

use crate::agents::runtime_config::{
    build_openhands_runtime_config, BuildOpenHandsRuntimeConfigParams, OpenHandsRuntimeConfig,
};
use crate::skill_paths::workspace_skill_dir;
use crate::types::WorkflowLlmConfig;

pub const SKILL_CREATOR_USER_SUFFIX: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../agent-sources/prompts/skill-creator-user-suffix.txt"
));

pub struct SkillCreatorConfigParams<'a> {
    pub skill_name: &'a str,
    pub prompt: &'a str,
    pub workspace_path: &'a str,
    pub plugin_slug: &'a str,
    pub llm: WorkflowLlmConfig,
    pub task_kind: &'a str,
    pub run_source: &'a str,
    pub allowed_tools: Vec<String>,
    pub max_turns: u32,
    pub step_id: i32,
    pub output_format: Option<serde_json::Value>,
}

pub fn build_skill_creator_config(params: SkillCreatorConfigParams<'_>) -> OpenHandsRuntimeConfig {
    let workspace_run_dir = workspace_skill_dir(
        Path::new(params.workspace_path),
        params.plugin_slug,
        params.skill_name,
    )
    .to_string_lossy()
    .replace('\\', "/");

    build_openhands_runtime_config(BuildOpenHandsRuntimeConfigParams {
        prompt: params.prompt.to_string(),
        llm: params.llm,
        workspace_root_dir: params.workspace_path.replace('\\', "/"),
        workspace_run_dir,
        mode: None,
        agent_name: "skill-creator".to_string(),
        task_kind: Some(params.task_kind.to_string()),
        user_message_suffix: Some(SKILL_CREATOR_USER_SUFFIX.trim().to_string()),
        allowed_tools: params.allowed_tools,
        max_turns: params.max_turns,
        output_format: params.output_format,
        skill_name: Some(params.skill_name.to_string()),
        step_id: Some(params.step_id),
        run_source: Some(params.run_source.to_string()),
        plugin_slug: params.plugin_slug.to_string(),
    })
}

pub async fn ensure_skill_session(
    app: &tauri::AppHandle,
    config: OpenHandsRuntimeConfig,
    saved_conversation_id: Option<String>,
) -> Result<String, String> {
    crate::agents::openhands_server::ensure_openhands_server(&config).await?;
    crate::agents::openhands_server::start_openhands_session(
        app,
        config,
        saved_conversation_id,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

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
    fn test_build_skill_creator_config_sets_correct_fields() {
        let config = build_skill_creator_config(SkillCreatorConfigParams {
            skill_name: "test-skill",
            prompt: "do something",
            workspace_path: "/tmp/workspace",
            plugin_slug: "default",
            llm: test_llm_config(),
            task_kind: "refine",
            run_source: "refine",
            allowed_tools: vec!["file_editor".to_string(), "terminal".to_string()],
            max_turns: 500,
            step_id: -10,
            output_format: None,
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
        assert!(config.workspace_skill_dir.contains("default"));
        assert!(config.workspace_skill_dir.contains("test-skill"));
    }

    #[test]
    fn test_build_skill_creator_config_workflow_step() {
        let config = build_skill_creator_config(SkillCreatorConfigParams {
            skill_name: "my-skill",
            prompt: "research",
            workspace_path: "/tmp/ws",
            plugin_slug: "plugins",
            llm: test_llm_config(),
            task_kind: "workflow.research",
            run_source: "workflow",
            allowed_tools: vec!["terminal".to_string()],
            max_turns: 50,
            step_id: 0,
            output_format: None,
        });

        assert_eq!(config.task_kind, Some("workflow.research".to_string()));
        assert_eq!(config.step_id, Some(0));
        assert_eq!(config.run_source, Some("workflow".to_string()));
    }

    #[test]
    fn test_build_skill_creator_config_answer_evaluator() {
        let config = build_skill_creator_config(SkillCreatorConfigParams {
            skill_name: "my-skill",
            prompt: "evaluate",
            workspace_path: "/tmp/ws",
            plugin_slug: "default",
            llm: test_llm_config(),
            task_kind: "workflow.answer_evaluator",
            run_source: "gate-eval",
            allowed_tools: vec!["file_editor".to_string()],
            max_turns: 20,
            step_id: -1,
            output_format: Some(serde_json::json!({})),
        });

        assert_eq!(config.task_kind, Some("workflow.answer_evaluator".to_string()));
        assert_eq!(config.step_id, Some(-1));
        assert_eq!(config.run_source, Some("gate-eval".to_string()));
        assert!(config.output_format.is_some());
    }

    #[test]
    fn test_skill_creator_user_suffix_is_non_empty() {
        assert!(!SKILL_CREATOR_USER_SUFFIX.trim().is_empty());
    }
}
