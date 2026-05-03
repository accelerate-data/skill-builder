use crate::skill_paths::DEFAULT_PLUGIN_SLUG;
use std::path::{Path, PathBuf};

use super::deploy::{
    copy_agents_to_claude_dir, copy_directory_recursive, copy_managed_plugins_to_claude_dir,
    copy_prompts_sync, invalidate_workspace_cache, mark_workspace_copied, workspace_already_copied,
};
use super::evaluation::get_step_output_files;
use super::guards::{
    make_agent_id, parse_decisions_guard, parse_scope_recommendation,
    validate_decisions_exist_inner, workflow_step_runtime_label,
};
use super::output_format::{
    answer_evaluator_output_format, extract_research_json_from_conversation_state,
    materialize_answer_evaluation_output_value, materialize_workflow_step_output_value,
    publish_commit_and_tag_generated_skill,
};
use super::prompt::{
    build_prompt, build_step0_prompt, build_step1_prompt, build_step2_prompt, PromptParams,
};
use super::runtime::{
    build_answer_evaluator_sidecar_config, build_workflow_confirm_decisions_sidecar_config,
    build_workflow_detailed_research_sidecar_config, build_workflow_research_sidecar_config,
    workflow_one_shot_runtime_provider, workflow_step_uses_native_openhands_dispatch,
};
use super::step_config::{
    build_betas, confirm_decisions_workflow_tools, get_step_config, research_workflow_tools,
    thinking_budget_for_step, tools_for_agent, workflow_output_format_for_step,
};
use super::user_context::{format_user_context, write_user_context_file};

fn valid_clarifications_value() -> serde_json::Value {
    serde_json::json!({
        "version": "1",
        "metadata": {
            "title": "Test",
            "question_count": 1,
            "section_count": 1,
            "refinement_count": 0,
            "must_answer_count": 0,
            "priority_questions": []
        },
        "sections": [
            {
                "id": 1,
                "title": "Section",
                "questions": [
                    {
                        "id": "Q1",
                        "title": "Question",
                        "must_answer": false,
                        "text": "Question text",
                        "choices": [
                            {"id":"A","text":"Choice","is_other":false}
                        ],
                        "refinements": []
                    }
                ]
            }
        ],
        "notes": []
    })
}

fn test_workflow_llm_config() -> crate::types::WorkflowLlmConfig {
    crate::types::WorkflowLlmConfig {
        model: "gpt-4.1".to_string(),
        api_key: Some(crate::types::SecretString::new("test-key".to_string())),
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
fn test_get_step_config_valid_steps() {
    let valid_steps = [0, 1, 2, 3];
    for step_id in valid_steps {
        let config = get_step_config(step_id);
        assert!(config.is_ok(), "Step {} should be valid", step_id);
        let config = config.unwrap();
        assert_eq!(config.step_id, step_id);
        assert!(!config.prompt_template.is_empty());
    }
}

#[test]
fn test_get_step_config_invalid_step() {
    assert!(get_step_config(4).is_err()); // Beyond last step
    assert!(get_step_config(5).is_err()); // Beyond last step
    assert!(get_step_config(6).is_err()); // Beyond last step
    assert!(get_step_config(7).is_err()); // Beyond last step
    assert!(get_step_config(99).is_err());
}

#[test]
fn test_get_step_config_step7_error_message() {
    let err = get_step_config(7).unwrap_err();
    assert!(
        err.contains("Unknown step_id 7"),
        "Error should mention unknown step: {}",
        err
    );
}

#[test]
fn test_get_step_output_files_unknown_step() {
    // Unknown steps should return empty vec
    let files = get_step_output_files(7);
    assert!(files.is_empty());
    let files = get_step_output_files(8);
    assert!(files.is_empty());
    let files = get_step_output_files(99);
    assert!(files.is_empty());
}

#[test]
fn test_step_config_canonical_agent_names() {
    assert_eq!(get_step_config(0).unwrap().agent_name, "skill-creator");
    assert_eq!(get_step_config(1).unwrap().agent_name, "skill-creator");
    assert_eq!(get_step_config(2).unwrap().agent_name, "skill-creator");
    assert_eq!(get_step_config(3).unwrap().agent_name, "skill-writer-agent");
}

#[test]
fn test_step_config_canonical_output_files() {
    assert_eq!(
        get_step_config(0).unwrap().output_file,
        "context/clarifications.json"
    );
    assert_eq!(
        get_step_config(1).unwrap().output_file,
        "context/clarifications.json"
    );
    assert_eq!(
        get_step_config(2).unwrap().output_file,
        "context/decisions.json"
    );
    assert_eq!(get_step_config(3).unwrap().output_file, "skill/SKILL.md");
}

#[test]
fn test_step_config_canonical_required_plugins() {
    assert_eq!(
        get_step_config(0).unwrap().required_plugins,
        vec!["skill-content-researcher"]
    );
    assert_eq!(
        get_step_config(1).unwrap().required_plugins,
        vec!["skill-content-researcher"]
    );
    assert_eq!(
        get_step_config(2).unwrap().required_plugins,
        vec!["skill-content-researcher"]
    );
    assert_eq!(
        get_step_config(3).unwrap().required_plugins,
        vec!["skill-content-researcher", "skill-creator"]
    );
}

#[test]
fn test_workflow_step_tools_are_one_shot_safe() {
    let forbidden_tools = ["AskUserQuestion", "Agent", "Skill"];
    for step_id in 0..=3 {
        let config = get_step_config(step_id).unwrap();
        let expected_tools = match step_id {
            0 | 1 => research_workflow_tools(),
            2 => confirm_decisions_workflow_tools(),
            _ => ["file_editor", "terminal"]
                .iter()
                .map(|s| s.to_string())
                .collect(),
        };
        assert_eq!(
            config.allowed_tools, expected_tools,
            "workflow step {step_id} must use the expected OpenHands tools"
        );
        assert!(
            !config
                .allowed_tools
                .iter()
                .any(|tool| forbidden_tools.contains(&tool.as_str())),
            "workflow step {step_id} must not allow Claude Code routing or interrupt tools"
        );
    }
}

#[test]
fn test_workflow_step_config_uses_openhands_runtime_provider() {
    assert_eq!(
        workflow_one_shot_runtime_provider().as_deref(),
        Some("openhands")
    );
}

#[test]
fn skill_creator_agent_carries_full_skill_building_overview() {
    let agent = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../agent-sources/workspace/agents/skill-creator.md"
    ));

    assert!(agent.contains("A skill is needed when generic model knowledge is not enough"));
    assert!(agent.contains("A skill is a reference guide for reusable techniques"));
    assert!(agent.contains("Do not create a skill for a one-off solution"));
    assert!(agent.contains("Common skill types include"));
    assert!(agent.contains("Technique: concrete steps"));
    assert!(agent.contains("Pattern: a way of reasoning"));
    assert!(agent.contains("Reference: syntax, API, domain"));
    assert!(agent.contains("Workflow: multi-step operational guidance"));
    assert!(agent.contains("Skill descriptions and frontmatter are trigger surfaces"));
    assert!(agent.contains("Descriptions should describe when to use the skill"));
    assert!(agent.contains("Step 0 Research"));
    assert!(agent.contains("Step 1 Detailed Research"));
    assert!(agent.contains("Step 2 Confirm Decisions"));
    assert!(agent.contains("Step 3 Generate Skill"));
    assert!(agent.contains("Each step produces a specific"));
}

#[test]
fn test_research_steps_use_native_openhands_dispatch() {
    assert!(workflow_step_uses_native_openhands_dispatch(0));
    assert!(workflow_step_uses_native_openhands_dispatch(1));
    assert!(workflow_step_uses_native_openhands_dispatch(2));
    assert!(!workflow_step_uses_native_openhands_dispatch(3));
}

#[test]
fn research_prompt_renders_app_owned_openhands_task_context() {
    let prompt = build_step0_prompt("lead-conversion", "/tmp/workspace", DEFAULT_PLUGIN_SLUG, 4);

    assert!(prompt.contains("You are in Step 0: Research"));
    assert!(prompt.contains("Goal: discover the minimum decisions"));
    assert!(prompt.contains("Reasoning focus: do not answer user-owned decisions yourself"));
    assert!(prompt.contains("## Capture Intent"));
    assert!(prompt.contains("What should this skill enable Claude to do?"));
    assert!(prompt.contains("When should this skill trigger?"));
    assert!(prompt.contains("What is the expected output format?"));
    assert!(prompt.contains("Should we set up test cases to verify the skill works?"));
    assert!(prompt.contains("objectively verifiable outputs"));
    assert!(prompt.contains("Suggest the appropriate default based on the skill type"));
    assert!(prompt.contains("## Interview And Research"));
    assert!(prompt.contains("edge cases, input and output formats"));
    assert!(prompt.contains("Wait to write test prompts"));
    assert!(prompt.contains("Check available MCPs"));
    assert!(prompt.contains("Use parallel research via"));
    assert!(prompt.contains("otherwise research inline"));
    assert!(prompt.contains("We are writing the skill lead-conversion."));
    assert!(prompt.contains("/tmp/workspace/skills/lead-conversion"));
    assert!(
        prompt.contains("User context file: /tmp/workspace/skills/lead-conversion/user-context.md")
    );
    assert!(prompt.contains("Context directory: /tmp/workspace/skills/lead-conversion/context"));
    assert!(prompt.contains("Maximum research dimensions before scope warning: 4"));
    assert!(prompt.contains("\"research_output\": {"));
    assert!(prompt.contains("\"sections\": []"));
    assert!(prompt.contains("\"notes\": []"));
    assert!(prompt.contains("\"answer_evaluator_notes\": []"));
    assert!(prompt.contains("Every choice must have"));
    assert!(prompt.contains("Do not use alternate field names"));
    assert!(prompt.contains("`options`, `label`, `required`, or"));
    assert!(prompt.contains("Question objects must be nested directly"));
    assert!(prompt.contains("top-level `research_output.questions`"));
    assert!(prompt.contains("do not return note strings"));
    assert!(prompt.contains("The initial research pass must not add refinement questions"));
    assert!(prompt.contains("Refinements are created"));
    assert!(prompt.contains("only by the detailed-research workflow"));
    assert!(prompt.contains("All initial research questions must be single-select"));
    assert!(prompt.contains("choose exactly one option"));
    assert!(prompt.contains("Do not ask \"select all that apply\""));
    assert!(prompt.contains("Do not inspect old logs or previous run transcripts"));
    assert!(
        !prompt.to_ascii_lowercase().contains("conversation history"),
        "step 0 prompt should not imply access to prior chat history"
    );
    assert!(prompt.contains(".agents/skills/shared/output-schemas/step-0-research.json"));
    assert!(prompt.contains(".agents/skills/shared/schemas.md"));
    assert!(
        !prompt.contains("research-agent"),
        "step 0 prompt should route through skill-creator, not research-agent"
    );
}

#[test]
fn research_sidecar_config_uses_skill_creator_openhands_contract() {
    let config = build_workflow_research_sidecar_config(
        "lead-conversion",
        "prompt",
        "/tmp/workspace",
        DEFAULT_PLUGIN_SLUG,
        test_workflow_llm_config(),
        Some("session-1".to_string()),
    );

    assert_eq!(config.runtime_provider.as_deref(), Some("openhands"));
    assert_eq!(config.agent_name.as_deref(), Some("skill-creator"));
    assert_eq!(config.task_kind.as_deref(), Some("workflow.research"));
    assert_eq!(config.mode.as_deref(), Some("one-shot"));
    assert_eq!(
        config.allowed_tools,
        Some(vec![
            "file_editor".to_string(),
            "terminal".to_string(),
            "browser_tool_set".to_string()
        ])
    );
    assert_eq!(config.skill_name.as_deref(), Some("lead-conversion"));
    assert_eq!(config.step_id, Some(0));
    assert_eq!(config.run_source.as_deref(), Some("workflow"));
    assert_eq!(
        config.workspace_root_dir, "/tmp/workspace",
        "workspace_root_dir must stay the initialized workspace root"
    );
    assert_eq!(
        config.workspace_skill_dir, "/tmp/workspace/skills/lead-conversion",
        "workspace run dir must be the skill-scoped workspace"
    );
    assert!(
        config.output_format.is_some(),
        "step 0 must carry app-side output schema metadata"
    );
    assert!(
        config.required_plugins.is_none(),
        "OpenHands one-shot config should rely on workspace .agents layout"
    );
    assert_eq!(config.workflow_session_id.as_deref(), Some("session-1"));
}

#[test]
fn detailed_research_prompt_renders_clean_break_task_context() {
    let prompt = build_step1_prompt("pipeline-value", "/tmp/workspace", DEFAULT_PLUGIN_SLUG);

    assert!(prompt.contains("You are in Step 1: Detailed Research"));
    assert!(prompt.contains("Goal: repair the clarification set"));
    assert!(prompt.contains("Reasoning focus: use answer-evaluation.json"));
    assert!(prompt.contains("missing, vague"));
    assert!(prompt.contains("Do not reopen settled areas"));
    assert!(prompt.contains("## Capture Intent"));
    assert!(prompt.contains("What should this skill enable Claude to do?"));
    assert!(prompt.contains("When should this skill trigger?"));
    assert!(prompt.contains("What is the expected output format?"));
    assert!(prompt.contains("Should we set up test cases to verify the skill works?"));
    assert!(prompt.contains("objectively verifiable outputs"));
    assert!(prompt.contains("Suggest the appropriate default based on the skill type"));
    assert!(prompt.contains("## Interview And Research"));
    assert!(prompt.contains("edge cases, input and output formats"));
    assert!(prompt.contains("Wait to write test prompts"));
    assert!(prompt.contains("Check available MCPs"));
    assert!(prompt.contains("Use parallel research via"));
    assert!(prompt.contains("otherwise research inline"));
    assert!(prompt.contains("We are writing the skill pipeline-value."));
    assert!(prompt.contains("/tmp/workspace/skills/pipeline-value"));
    assert!(
        prompt.contains("User context file: /tmp/workspace/skills/pipeline-value/user-context.md")
    );
    assert!(prompt.contains(
        "Answer evaluation file: /tmp/workspace/skills/pipeline-value/answer-evaluation.json"
    ));
    assert!(prompt.contains(
        "Clarifications file: /tmp/workspace/skills/pipeline-value/context/clarifications.json"
    ));
    assert!(prompt.contains("detailed-research output"));
    assert!(prompt.contains("DetailedResearchOutput"));
    assert!(prompt.contains(".agents/skills/shared/output-schemas/step-1-detailed-research.json"));
    assert!(prompt.contains(".agents/skills/shared/schemas.md"));
    assert!(prompt.contains("Preserve every existing section"));
    assert!(prompt.contains("Append only"));
    assert!(
        !prompt.to_ascii_lowercase().contains("conversation history"),
        "step 1 prompt should not imply access to prior chat history"
    );
    assert!(
        !prompt.contains("research-agent"),
        "step 1 prompt should route through skill-creator, not research-agent"
    );
}

#[test]
fn detailed_research_sidecar_config_uses_skill_creator_openhands_contract() {
    let config = build_workflow_detailed_research_sidecar_config(
        "pipeline-value",
        "prompt",
        "/tmp/workspace",
        DEFAULT_PLUGIN_SLUG,
        test_workflow_llm_config(),
        Some("session-1".to_string()),
    );

    assert_eq!(config.runtime_provider.as_deref(), Some("openhands"));
    assert_eq!(config.agent_name.as_deref(), Some("skill-creator"));
    assert_eq!(
        config.task_kind.as_deref(),
        Some("workflow.detailed_research")
    );
    assert_eq!(config.mode.as_deref(), Some("one-shot"));
    assert_eq!(
        config.allowed_tools,
        Some(vec![
            "file_editor".to_string(),
            "terminal".to_string(),
            "browser_tool_set".to_string()
        ])
    );
    assert_eq!(config.skill_name.as_deref(), Some("pipeline-value"));
    assert_eq!(config.step_id, Some(1));
    assert_eq!(config.run_source.as_deref(), Some("workflow"));
    assert_eq!(config.workspace_root_dir, "/tmp/workspace");
    assert_eq!(
        config.workspace_skill_dir, "/tmp/workspace/skills/pipeline-value",
        "workspace run dir must be the skill-scoped workspace"
    );
    assert_eq!(config.output_format, workflow_output_format_for_step(1));
    assert!(
        config.required_plugins.is_none(),
        "OpenHands one-shot config should rely on workspace .agents layout"
    );
    assert_eq!(config.workflow_session_id.as_deref(), Some("session-1"));
    assert!(config.path_to_claude_code_executable.is_none());
}

#[test]
fn answer_evaluator_prompt_renders_clean_break_skill_routing() {
    let prompt = super::prompt::build_evaluator_prompt(
        "sales-analytics",
        "/tmp/workspace",
        DEFAULT_PLUGIN_SLUG,
        "/tmp/skills",
    );

    assert!(prompt.contains("Use the answer-evaluator skill"));
    assert!(prompt.contains("We are writing the skill sales-analytics."));
    assert!(prompt.contains("/tmp/workspace"));
    assert!(prompt.contains("/user-context.md"));
    assert!(prompt.contains("/context"));
    assert!(prompt
        .to_ascii_lowercase()
        .contains("return only a raw json object"));
    assert!(!prompt.contains("You are answer-evaluator"));
}

#[test]
fn answer_evaluator_sidecar_config_uses_skill_creator_openhands_contract() {
    let config = build_answer_evaluator_sidecar_config(
        "sales-analytics",
        "prompt",
        "/tmp/workspace",
        DEFAULT_PLUGIN_SLUG,
        test_workflow_llm_config(),
    );

    assert_eq!(config.agent_name.as_deref(), Some("skill-creator"));
    assert_eq!(config.runtime_provider.as_deref(), Some("openhands"));
    assert_eq!(config.run_source.as_deref(), Some("gate-eval"));
    assert_eq!(config.output_format, Some(answer_evaluator_output_format()));
    assert_eq!(
        config.task_kind.as_deref(),
        Some("workflow.answer_evaluator")
    );
    assert!(config.path_to_claude_code_executable.is_none());
    assert_eq!(
        config.allowed_tools,
        Some(tools_for_agent("answer-evaluator"))
    );
    assert!(
        config.required_plugins.is_none(),
        "OpenHands answer evaluation should rely on workspace .agents skills"
    );
}

#[test]
fn research_json_extraction_parses_raw_completed_result_text() {
    let state = serde_json::json!({
        "type": "conversation_state",
        "status": "completed",
        "result_text": r#"{"status":"research_complete","question_count":0,"research_output":{"version":"1","metadata":{},"sections":[],"notes":[]}}"#
    });

    let parsed = extract_research_json_from_conversation_state(&state).unwrap();
    assert_eq!(parsed["status"], "research_complete");
}

#[test]
fn research_json_extraction_parses_one_markdown_json_fence() {
    let state = serde_json::json!({
        "type": "conversation_state",
        "status": "completed",
        "resultText": "```json\n{\"status\":\"research_complete\"}\n```"
    });

    let parsed = extract_research_json_from_conversation_state(&state).unwrap();
    assert_eq!(parsed["status"], "research_complete");
}

#[test]
fn research_json_extraction_parses_json_after_visible_dimension_table() {
    let state = serde_json::json!({
        "type": "conversation_state",
        "status": "completed",
        "result_text": r#"
| Dimension | Score | Reason |
| --------- | ----- | ------ |
| `entities` | N/A | Insufficient context to score |

{
  "status": "research_complete",
  "question_count": 0,
  "research_output": {
    "version": "1",
    "metadata": {},
    "sections": [],
    "notes": [],
    "answer_evaluator_notes": []
  }
}
"#
    });

    let parsed = extract_research_json_from_conversation_state(&state).unwrap();

    assert_eq!(parsed["status"], "research_complete");
    assert!(parsed.get("dimensions_selected").is_none());
}

#[test]
fn research_json_extraction_rejects_missing_empty_non_object_error_and_invalid_json() {
    let missing = serde_json::json!({
        "type": "conversation_state",
        "status": "completed"
    });
    assert!(extract_research_json_from_conversation_state(&missing)
        .unwrap_err()
        .contains("missing result_text"));

    let empty = serde_json::json!({
        "type": "conversation_state",
        "status": "completed",
        "result_text": "   "
    });
    assert!(extract_research_json_from_conversation_state(&empty)
        .unwrap_err()
        .contains("empty result_text"));

    let non_object = serde_json::json!({
        "type": "conversation_state",
        "status": "completed",
        "result_text": "[]"
    });
    assert!(extract_research_json_from_conversation_state(&non_object)
        .unwrap_err()
        .contains("must be a JSON object"));

    let terminal_error = serde_json::json!({
        "type": "conversation_state",
        "status": "error",
        "error_detail": "research failed"
    });
    assert_eq!(
        extract_research_json_from_conversation_state(&terminal_error).unwrap_err(),
        "OpenHands research conversation_state failed: research failed"
    );

    let invalid = serde_json::json!({
        "type": "conversation_state",
        "status": "completed",
        "result_text": "{not json}"
    });
    assert!(extract_research_json_from_conversation_state(&invalid)
        .unwrap_err()
        .contains("invalid JSON"));
}

#[test]
fn research_materialization_from_conversation_state_writes_clarifications() {
    let tmp = tempfile::tempdir().unwrap();
    let skill_root = tmp.path().join("my-skill");
    let payload = serde_json::json!({
        "status": "research_complete",
        "question_count": 0,
        "research_output": valid_clarifications_value()
    });
    let state = serde_json::json!({
        "type": "conversation_state",
        "status": "completed",
        "result_text": serde_json::to_string(&payload).unwrap()
    });

    let parsed = extract_research_json_from_conversation_state(&state).unwrap();
    materialize_workflow_step_output_value(&skill_root, 0, &parsed).unwrap();

    assert!(skill_root.join("context/clarifications.json").exists());
}

mod research {
    use super::*;

    #[test]
    fn openhands_contract_and_terminal_materialization_smoke() {
        let config = build_workflow_research_sidecar_config(
            "lead-conversion",
            "prompt",
            "/tmp/workspace",
            DEFAULT_PLUGIN_SLUG,
            test_workflow_llm_config(),
            None,
        );
        assert_eq!(config.agent_name.as_deref(), Some("skill-creator"));
        assert_eq!(config.task_kind.as_deref(), Some("workflow.research"));

        let tmp = tempfile::tempdir().unwrap();
        let skill_root = tmp.path().join("my-skill");
        let payload = serde_json::json!({
            "status": "research_complete",
            "question_count": 0,
            "research_output": valid_clarifications_value()
        });
        let state = serde_json::json!({
            "type": "conversation_state",
            "status": "completed",
            "result_text": serde_json::to_string(&payload).unwrap()
        });

        let parsed = extract_research_json_from_conversation_state(&state).unwrap();
        materialize_workflow_step_output_value(&skill_root, 0, &parsed).unwrap();
        assert!(skill_root.join("context/clarifications.json").exists());
    }
}

#[test]
fn test_answer_evaluator_uses_openhands_file_editor_only() {
    assert_eq!(tools_for_agent("answer-evaluator"), vec!["file_editor"]);
}

#[test]
fn test_workflow_output_format_is_set_for_json_contract_workflow_steps() {
    for step_id in 0..=3 {
        assert!(
            workflow_output_format_for_step(step_id).is_some(),
            "workflow step {step_id} must have an output format"
        );
    }
    assert_ne!(
        workflow_output_format_for_step(0).unwrap()["schema"],
        workflow_output_format_for_step(1).unwrap()["schema"],
        "research and detailed-research steps must still use step-specific schemas"
    );
    assert_ne!(
        workflow_output_format_for_step(2).unwrap()["schema"],
        workflow_output_format_for_step(3).unwrap()["schema"],
        "confirm-decisions and generate-skill steps must still use step-specific schemas"
    );
}

#[test]
fn confirm_decisions_prompt_renders_app_owned_openhands_task_context() {
    let prompt = build_step2_prompt("lead-conversion", "/tmp/workspace", DEFAULT_PLUGIN_SLUG);

    assert!(prompt.contains("You are in Step 2: Confirm Decisions"));
    assert!(prompt.contains("Goal: convert clarified user intent"));
    assert!(prompt.contains("Reasoning focus: identify commitments"));
    assert!(prompt.contains("actionable by the skill-writing step"));
    assert!(prompt.contains("We are writing the skill lead-conversion."));
    assert!(prompt.contains("Task kind: workflow.confirm_decisions"));
    assert!(prompt.contains("/tmp/workspace/skills/lead-conversion"));
    assert!(
        prompt.contains("User context file: /tmp/workspace/skills/lead-conversion/user-context.md")
    );
    assert!(prompt.contains("Context directory: /tmp/workspace/skills/lead-conversion/context"));
    assert!(prompt.contains("The user has already answered clarification questions"));
    assert!(prompt.contains("canonical set of decisions"));
    assert!(prompt.contains("downstream skill-writing implications"));
    assert!(prompt.contains("Do not write any files"));
    assert!(prompt.contains("Return only this structured JSON"));
    assert!(prompt.contains("\"version\": \"1\""));
    assert!(prompt.contains("\"decisions\": []"));
    assert!(prompt.contains("What should this skill enable Claude to do?"));
    assert!(prompt.contains("When should this skill trigger?"));
}

#[test]
fn confirm_decisions_sidecar_config_uses_skill_creator_openhands_contract() {
    let config = build_workflow_confirm_decisions_sidecar_config(
        "lead-conversion",
        "prompt",
        "/tmp/workspace",
        DEFAULT_PLUGIN_SLUG,
        test_workflow_llm_config(),
        Some("session-1".to_string()),
    );

    assert_eq!(config.runtime_provider.as_deref(), Some("openhands"));
    assert_eq!(config.agent_name.as_deref(), Some("skill-creator"));
    assert_eq!(
        config.task_kind.as_deref(),
        Some("workflow.confirm_decisions")
    );
    assert_eq!(config.mode.as_deref(), Some("one-shot"));
    assert_eq!(
        config.allowed_tools,
        Some(confirm_decisions_workflow_tools())
    );
    assert_eq!(config.max_turns, Some(100));
    assert_eq!(config.skill_name.as_deref(), Some("lead-conversion"));
    assert_eq!(config.step_id, Some(2));
    assert_eq!(config.run_source.as_deref(), Some("workflow"));
    assert_eq!(config.workspace_root_dir, "/tmp/workspace");
    assert_eq!(
        config.workspace_skill_dir, "/tmp/workspace/skills/lead-conversion",
        "workspace run dir must be the skill-scoped workspace"
    );
    assert_eq!(config.output_format, workflow_output_format_for_step(2));
    assert!(
        config.required_plugins.is_none(),
        "OpenHands one-shot config should rely on workspace .agents layout"
    );
    assert_eq!(config.workflow_session_id.as_deref(), Some("session-1"));
    assert!(config.path_to_claude_code_executable.is_none());
}

/// Steps 0–2 use inline schemas: all $ref resolved, no definitions block,
/// additionalProperties: false on all objects, no $schema field.
/// These are SDK-compatible (the SDK silently ignores $ref/definitions).
fn assert_inline_schema_basics(schema: &serde_json::Value, label: &str) {
    // No $schema (stripped for SDK compatibility)
    assert!(
        schema.get("$schema").is_none(),
        "{label}: inline schema must not have $schema"
    );
    // No definitions block (all inlined)
    assert!(
        schema.get("definitions").is_none(),
        "{label}: inline schema must not have definitions"
    );
    // No $ref anywhere
    let schema_str = serde_json::to_string(schema).unwrap();
    assert!(
        !schema_str.contains("\"$ref\""),
        "{label}: inline schema must not contain $ref"
    );
    // Root has additionalProperties: false
    assert_eq!(
        schema["additionalProperties"], false,
        "{label}: root must have additionalProperties: false"
    );
    // Must be type: object
    assert_eq!(
        schema["type"], "object",
        "{label}: root type must be object"
    );
}

#[test]
fn test_research_step_schema_is_inline_with_all_required() {
    let format = workflow_output_format_for_step(0).unwrap();
    let schema = &format["schema"];
    assert_inline_schema_basics(schema, "research-step");
    let required = schema["required"].as_array().expect("required array");
    assert!(required.iter().any(|v| v == "status"));
    assert!(!required.iter().any(|v| v == "dimensions_selected"));
    assert!(required.iter().any(|v| v == "question_count"));
    assert!(required.iter().any(|v| v == "research_output"));
    // Nested ClarificationsFile is inlined as an object with properties
    let ro = &schema["properties"]["research_output"];
    assert!(
        ro.get("properties").is_some() || ro["type"] == "object",
        "research_output must be an inlined object"
    );
}

#[test]
fn test_detailed_research_schema_is_inline_with_all_required() {
    let format = workflow_output_format_for_step(1).unwrap();
    let schema = &format["schema"];
    assert_inline_schema_basics(schema, "detailed-research");
    let required = schema["required"].as_array().expect("required array");
    assert!(required.iter().any(|v| v == "status"));
    assert!(required.iter().any(|v| v == "refinement_count"));
    assert!(required.iter().any(|v| v == "section_count"));
    assert!(required.iter().any(|v| v == "clarifications_json"));
    // Nested ClarificationsFile is inlined
    let cj = &schema["properties"]["clarifications_json"];
    assert!(
        cj.get("properties").is_some() || cj["type"] == "object",
        "clarifications_json must be an inlined object"
    );
}

#[test]
fn test_decisions_schema_is_inline_with_all_required() {
    let format = workflow_output_format_for_step(2).unwrap();
    let schema = &format["schema"];
    assert_inline_schema_basics(schema, "decisions");
    let required = schema["required"].as_array().expect("required array");
    assert!(required.iter().any(|v| v == "version"));
    assert!(required.iter().any(|v| v == "metadata"));
    assert!(required.iter().any(|v| v == "decisions"));
    // Nested Decision is inlined inside items
    let items = &schema["properties"]["decisions"]["items"];
    assert!(
        items.get("properties").is_some(),
        "decisions items must have inlined Decision properties"
    );
    // DecisionStatus enum is inlined
    let status = &items["properties"]["status"];
    assert!(
        status.get("enum").is_some(),
        "Decision.status must have inlined enum values"
    );
    let enum_vals: Vec<&str> = status["enum"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|v: &serde_json::Value| v.as_str())
        .collect();
    assert!(enum_vals.contains(&"resolved"));
    assert!(enum_vals.contains(&"conflict-resolved"));
    assert!(enum_vals.contains(&"needs-review"));
}

/// All inline schemas must have additionalProperties: false on every
/// nested object (required by Anthropic API).
#[test]
fn test_inline_schemas_have_additional_properties_false_everywhere() {
    for step_id in 0..=2 {
        let format = workflow_output_format_for_step(step_id).unwrap();
        let schema_str = serde_json::to_string(&format["schema"]).unwrap();
        let schema: serde_json::Value = serde_json::from_str(&schema_str).unwrap();
        fn check_objects(val: &serde_json::Value, path: &str) {
            if let Some(obj) = val.as_object() {
                // If this is an object type with properties, it must have additionalProperties: false
                if obj.get("type") == Some(&serde_json::json!("object"))
                    && obj.contains_key("properties")
                {
                    assert_eq!(
                        obj.get("additionalProperties"),
                        Some(&serde_json::json!(false)),
                        "missing additionalProperties:false at {path}"
                    );
                }
                for (k, v) in obj {
                    check_objects(v, &format!("{path}.{k}"));
                }
            } else if let Some(arr) = val.as_array() {
                for (i, v) in arr.iter().enumerate() {
                    check_objects(v, &format!("{path}[{i}]"));
                }
            }
        }
        check_objects(&schema, &format!("step {step_id}"));
    }
}

/// Step 3 uses a flat schema (all primitives, no nested types).
#[test]
fn test_generated_schemas_are_sdk_compatible() {
    let format = workflow_output_format_for_step(3).unwrap();
    let schema = &format["schema"];

    // Must be draft-07
    assert_eq!(
        schema["$schema"], "http://json-schema.org/draft-07/schema#",
        "step 3: schema must be draft-07"
    );

    // Root object must have additionalProperties: false
    assert_eq!(
        schema["additionalProperties"], false,
        "step 3: root must have additionalProperties: false"
    );

    // Must be flat — no definitions block
    assert!(
        schema.get("definitions").is_none(),
        "step 3: schema must not have definitions (must be flat)"
    );

    // Must have no $ref anywhere
    let schema_str = serde_json::to_string(schema).unwrap();
    assert!(
        !schema_str.contains("$ref"),
        "step 3: schema must not contain $ref (must be flat)"
    );
}

/// Verify the answer evaluator schema is also SDK-compatible.
#[test]
fn test_answer_evaluator_schema_is_sdk_compatible() {
    let format = answer_evaluator_output_format();
    let schema = &format["schema"];
    assert_eq!(schema["$schema"], "http://json-schema.org/draft-07/schema#");
    assert_eq!(schema["additionalProperties"], false);
}

#[test]
fn test_workflow_output_format_is_unset_for_unknown_steps() {
    assert!(workflow_output_format_for_step(99).is_none());
}

#[test]
fn test_answer_evaluator_output_format_has_required_contract_keys() {
    let format = answer_evaluator_output_format();
    let schema = &format["schema"];
    let required = schema["required"].as_array().expect("required array");
    assert!(required.iter().any(|v| v == "per_question"));
    assert!(required.iter().any(|v| v == "verdict"));
    assert_eq!(schema["properties"]["verdict"]["type"], "string");
}

#[test]
fn test_materialize_answer_evaluation_writes_file() {
    let tmp = tempfile::tempdir().unwrap();
    let workspace_dir = tmp.path().join("workspace").join("my-skill");
    let payload = serde_json::json!({
        "verdict": "mixed",
        "answered_count": 3,
        "empty_count": 1,
        "vague_count": 1,
        "contradictory_count": 0,
        "total_count": 5,
        "reasoning": "Most answers are good, with a few gaps.",
        "per_question": [
            {"question_id": "Q1", "verdict": "clear"},
            {"question_id": "Q2", "verdict": "vague", "reason": "Too generic."}
        ]
    });

    materialize_answer_evaluation_output_value(&workspace_dir, &payload).unwrap();
    assert!(workspace_dir.join("answer-evaluation.json").exists());
}

#[test]
fn test_materialize_answer_evaluation_rejects_invalid_payload() {
    let tmp = tempfile::tempdir().unwrap();
    let workspace_dir = tmp.path().join("workspace").join("my-skill");
    let invalid_payload = serde_json::json!({
        "verdict": "mixed",
        "answered_count": 1,
        "empty_count": 0,
        "vague_count": 0,
        "contradictory_count": 1,
        "total_count": 1,
        "reasoning": "Contradiction found.",
        "per_question": [
            {"question_id": "Q1", "verdict": "contradictory"}
        ]
    });

    let err =
        materialize_answer_evaluation_output_value(&workspace_dir, &invalid_payload).unwrap_err();
    assert!(err.contains("Invalid answer evaluation output"));
    assert!(!workspace_dir.join("answer-evaluation.json").exists());
}

#[test]
fn test_materialize_answer_evaluation_defaults_missing_per_question_array() {
    let tmp = tempfile::tempdir().unwrap();
    let workspace_dir = tmp.path().join("workspace").join("my-skill");
    let payload = serde_json::json!({
        "verdict": "mixed",
        "answered_count": 1,
        "empty_count": 0,
        "vague_count": 0,
        "contradictory_count": 0,
        "total_count": 1,
        "reasoning": "One answer provided."
    });
    // Missing per_question now defaults to empty vec instead of erroring
    materialize_answer_evaluation_output_value(&workspace_dir, &payload)
        .expect("should accept missing per_question with default");
}

#[test]
fn test_materialize_answer_evaluation_rejects_vague_without_reason() {
    let tmp = tempfile::tempdir().unwrap();
    let workspace_dir = tmp.path().join("workspace").join("my-skill");
    let payload = serde_json::json!({
        "verdict": "mixed",
        "answered_count": 0,
        "empty_count": 0,
        "vague_count": 1,
        "contradictory_count": 0,
        "total_count": 1,
        "reasoning": "Answer was vague.",
        "per_question": [
            {"question_id": "Q1", "verdict": "vague"}
        ]
    });
    let err = materialize_answer_evaluation_output_value(&workspace_dir, &payload).unwrap_err();
    assert!(err.contains("reason is required for vague verdict"));
}

#[test]
fn test_materialize_step0_writes_research_and_clarifications() {
    let tmp = tempfile::tempdir().unwrap();
    let skill_root = tmp.path().join("my-skill");
    let payload = serde_json::json!({
        "status": "research_complete",
        "question_count": 5,
        "research_output": {
            "version": "1",
            "metadata": {
                "title": "Test",
                "question_count": 0,
                "section_count": 0,
                "refinement_count": 0,
                "must_answer_count": 0,
                "priority_questions": []
            },
            "sections": [],
            "notes": []
        }
    });

    materialize_workflow_step_output_value(&skill_root, 0, &payload).unwrap();
    assert!(skill_root.join("context/clarifications.json").exists());
    assert!(!skill_root.join("context/research-plan.md").exists());
}

#[test]
fn test_materialize_step0_drops_legacy_research_metadata() {
    let tmp = tempfile::tempdir().unwrap();
    let skill_root = tmp.path().join("my-skill");
    let payload = serde_json::json!({
        "status": "research_complete",
        "question_count": 0,
        "research_output": {
            "version": "1",
            "metadata": {
                "title": "Test",
                "question_count": 0,
                "section_count": 0,
                "refinement_count": 0,
                "must_answer_count": 0,
                "priority_questions": [],
                "research_plan": {
                    "purpose": "Analyze leads",
                    "domain": "Cloud services",
                    "topic_relevance": "High",
                    "dimensions_evaluated": 2,
                    "dimension_scores": [
                        {
                            "name": "entities",
                            "score": 5.0,
                            "reason": "Critical custom relationships.",
                            "focus": "Lead to opportunity conversion"
                        },
                        {
                            "name": "modeling-patterns",
                            "score": 3.0,
                            "reason": "Mostly standard.",
                            "focus": null
                        }
                    ],
                    "selected_dimensions": [
                        {
                            "name": "entities",
                            "focus": "Lead to opportunity conversion"
                        }
                    ]
                }
            },
            "sections": [],
            "notes": []
        }
    });

    materialize_workflow_step_output_value(&skill_root, 0, &payload).unwrap();
    let written = std::fs::read_to_string(skill_root.join("context/clarifications.json")).unwrap();
    assert!(!written.contains("research_plan"));
    assert!(!written.contains("dimension_scores"));
    assert!(!written.contains("selected_dimensions"));
    assert!(!written.contains("modeling-patterns"));
}

#[test]
fn test_materialize_step0_empty_metadata_defaults_to_zeros() {
    let tmp = tempfile::tempdir().unwrap();
    let skill_root = tmp.path().join("my-skill");

    // Empty metadata now defaults all fields to 0/"" instead of erroring
    let payload = serde_json::json!({
        "status": "research_complete",
        "question_count": 5,
        "research_output": {
            "version": "1",
            "metadata": {},
            "sections": [],
            "notes": []
        }
    });

    materialize_workflow_step_output_value(&skill_root, 0, &payload)
        .expect("empty metadata should default fields");
}

#[test]
fn test_materialize_step1_writes_clarifications_only() {
    let tmp = tempfile::tempdir().unwrap();
    let skill_root = tmp.path().join("my-skill");
    let payload = serde_json::json!({
        "status": "detailed_research_complete",
        "refinement_count": 1,
        "section_count": 1,
        "clarifications_json": {
            "version": "1",
            "metadata": {
                "title": "Step 1",
                "question_count": 1,
                "section_count": 1,
                "refinement_count": 1,
                "must_answer_count": 0,
                "priority_questions": []
            },
            "sections": [
                {
                    "id": 1,
                    "title": "Section",
                    "questions": [
                        {
                            "id": "Q1",
                            "title": "Question",
                            "must_answer": false,
                            "text": "Question text",
                            "choices": [
                                {"id":"A","text":"Choice","is_other":false}
                            ],
                            "refinements": []
                        }
                    ]
                }
            ],
            "notes": []
        }
    });

    materialize_workflow_step_output_value(&skill_root, 1, &payload).unwrap();
    assert!(skill_root.join("context/clarifications.json").exists());
}

#[test]
fn test_materialize_step1_writes_additive_detailed_research_output() {
    let tmp = tempfile::tempdir().unwrap();
    let skill_root = tmp.path().join("my-skill");
    let output = serde_json::json!({
        "status": "detailed_research_complete",
        "refinement_count": 1,
        "section_count": 2,
        "clarifications_json": {
            "version": "1",
            "metadata": {
                "question_count": 5,
                "section_count": 2,
                "refinement_count": 1,
                "must_answer_count": 4,
                "priority_questions": ["Q1", "Q3", "R3.1", "Q5"],
                "duplicates_removed": 0,
                "scope_recommendation": false,
                "scope_reason": null,
                "warning": null,
                "error": null
            },
            "sections": [
                {
                    "id": 1,
                    "title": "Existing section",
                    "questions": [
                        {
                            "id": "Q1",
                            "title": "Existing clear question",
                            "text": "Which layers are in scope?",
                            "must_answer": true,
                            "choices": [],
                            "answer_text": "Bronze, silver, gold",
                            "refinements": []
                        },
                        {
                            "id": "Q2",
                            "title": "Existing clear question",
                            "text": "What is the incremental policy?",
                            "must_answer": false,
                            "choices": [],
                            "answer_text": "Merge on natural key and updated_at",
                            "refinements": []
                        },
                        {
                            "id": "Q3",
                            "title": "Existing vague question",
                            "text": "Who uses this skill?",
                            "must_answer": true,
                            "choices": [],
                            "answer_text": "TBD",
                            "refinements": [
                                {
                                    "id": "R3.1",
                                    "title": "Primary user persona",
                                    "text": "Which primary role should this skill optimize for?",
                                    "must_answer": true,
                                    "choices": [],
                                    "refinements": []
                                }
                            ]
                        },
                        {
                            "id": "Q4",
                            "title": "New section-level question",
                            "text": "What naming convention should generated models follow?",
                            "must_answer": false,
                            "choices": [],
                            "refinements": []
                        }
                    ]
                },
                {
                    "id": 2,
                    "title": "New governance section",
                    "questions": [
                        {
                            "id": "Q5",
                            "title": "Approval process",
                            "text": "Who approves changes to shared modeling standards?",
                            "must_answer": true,
                            "choices": [],
                            "refinements": []
                        }
                    ]
                }
            ],
            "notes": [],
            "answer_evaluator_notes": []
        }
    });

    materialize_workflow_step_output_value(&skill_root, 1, &output).unwrap();
    let written: serde_json::Value = serde_json::from_slice(
        &std::fs::read(skill_root.join("context/clarifications.json")).unwrap(),
    )
    .unwrap();
    let sections = written["sections"].as_array().unwrap();
    assert_eq!(sections.len(), 2);
    assert_eq!(sections[0]["id"], 1);
    assert_eq!(sections[1]["id"], 2);
    let s1_questions = sections[0]["questions"].as_array().unwrap();
    assert_eq!(s1_questions[0]["id"], "Q1");
    assert!(s1_questions.iter().any(|q| q["id"] == "Q4"));
    let q3 = s1_questions.iter().find(|q| q["id"] == "Q3").unwrap();
    assert_eq!(q3["refinements"][0]["id"], "R3.1");
}

#[test]
fn test_materialize_step0_rejects_non_object_payload() {
    let tmp = tempfile::tempdir().unwrap();
    let skill_root = tmp.path().join("my-skill");
    let err = materialize_workflow_step_output_value(&skill_root, 0, &serde_json::json!(null))
        .unwrap_err();
    assert!(err.contains("structured_output must be a JSON object"));
}

#[test]
fn test_materialize_step0_rejects_wrong_status() {
    let tmp = tempfile::tempdir().unwrap();
    let skill_root = tmp.path().join("my-skill");
    let payload = serde_json::json!({
        "status": "detailed_research_complete",
        "question_count": 1,
        "research_output": valid_clarifications_value()
    });
    let err = materialize_workflow_step_output_value(&skill_root, 0, &payload).unwrap_err();
    assert!(err.contains("structured_output.status must be 'research_complete'"));
}

#[test]
fn test_materialize_step0_rejects_missing_required_fields() {
    let tmp = tempfile::tempdir().unwrap();
    let skill_root = tmp.path().join("my-skill");

    let missing_research_output = serde_json::json!({
        "status": "research_complete",
        "question_count": 1
    });
    let err = materialize_workflow_step_output_value(&skill_root, 0, &missing_research_output)
        .unwrap_err();
    assert!(
        err.contains("research_output"),
        "should mention missing field: {err}"
    );

    // Wrong type (string for integer) still errors
    let non_integer_question_count = serde_json::json!({
        "status": "research_complete",
        "question_count": "one",
        "research_output": valid_clarifications_value()
    });
    let err = materialize_workflow_step_output_value(&skill_root, 0, &non_integer_question_count)
        .unwrap_err();
    assert!(err.contains("invalid research step output"));
}

#[test]
fn test_materialize_step0_rejects_missing_research_output() {
    let tmp = tempfile::tempdir().unwrap();
    let skill_root = tmp.path().join("my-skill");

    let missing = serde_json::json!({
        "status": "research_complete",
        "question_count": 1
    });
    let err = materialize_workflow_step_output_value(&skill_root, 0, &missing).unwrap_err();
    assert!(err.contains("invalid research step output"));

    // Choice is missing required `is_other` field — typed deserialization rejects it
    let invalid_nested = serde_json::json!({
        "status": "research_complete",
        "question_count": 1,
        "research_output": {
            "version": "1",
            "metadata": {
                "title": "Test",
                "question_count": 1,
                "section_count": 1,
                "refinement_count": 0,
                "must_answer_count": 0,
                "priority_questions": []
            },
            "sections": [
                {
                    "id": 1,
                    "title": "Section",
                    "questions": [
                        {
                            "id": "Q1",
                            "title": "Question",
                            "must_answer": false,
                            "text": "Question text",
                            "choices": [{"id":"A","text":"Choice"}],
                            "refinements": []
                        }
                    ]
                }
            ],
            "notes": []
        }
    });
    let err_invalid_nested =
        materialize_workflow_step_output_value(&skill_root, 0, &invalid_nested).unwrap_err();
    // Typed deserialization still rejects Choice missing `is_other`
    assert!(
        err_invalid_nested.contains("invalid research step output"),
        "unexpected error: {err_invalid_nested}"
    );
    assert!(
        err_invalid_nested.contains("is_other"),
        "should mention is_other: {err_invalid_nested}"
    );
}

#[test]
fn test_materialize_step1_rejects_wrong_status() {
    let tmp = tempfile::tempdir().unwrap();
    let skill_root = tmp.path().join("my-skill");
    let payload = serde_json::json!({
        "status": "research_complete",
        "refinement_count": 1,
        "section_count": 1,
        "clarifications_json": valid_clarifications_value()
    });
    let err = materialize_workflow_step_output_value(&skill_root, 1, &payload).unwrap_err();
    assert!(err.contains("structured_output.status must be 'detailed_research_complete'"));
}

#[test]
fn test_materialize_step1_rejects_missing_required_fields() {
    let tmp = tempfile::tempdir().unwrap();
    let skill_root = tmp.path().join("my-skill");

    // Missing refinement_count → hard fail (required per SKILL.md)
    let missing_refinement_count = serde_json::json!({
        "status": "detailed_research_complete",
        "section_count": 1,
        "clarifications_json": valid_clarifications_value()
    });
    let err = materialize_workflow_step_output_value(&skill_root, 1, &missing_refinement_count)
        .unwrap_err();
    assert!(
        err.contains("refinement_count"),
        "should mention missing field: {err}"
    );

    // Wrong type (string for integer) still errors
    let non_integer_section_count = serde_json::json!({
        "status": "detailed_research_complete",
        "refinement_count": 1,
        "section_count": "one",
        "clarifications_json": valid_clarifications_value()
    });
    let err = materialize_workflow_step_output_value(&skill_root, 1, &non_integer_section_count)
        .unwrap_err();
    assert!(err.contains("invalid detailed research output"));
}

#[test]
fn test_materialize_step1_rejects_missing_clarifications_json() {
    let tmp = tempfile::tempdir().unwrap();
    let skill_root = tmp.path().join("my-skill");
    let payload = serde_json::json!({
        "status": "detailed_research_complete",
        "refinement_count": 1,
        "section_count": 1
    });
    let err = materialize_workflow_step_output_value(&skill_root, 1, &payload).unwrap_err();
    assert!(err.contains("invalid detailed research output"));
}

#[test]
fn test_materialize_step1_validation_failure_keeps_existing_clarifications() {
    let tmp = tempfile::tempdir().unwrap();
    let skill_root = tmp.path().join("my-skill");
    let context_dir = skill_root.join("context");
    std::fs::create_dir_all(&context_dir).unwrap();
    std::fs::write(context_dir.join("clarifications.json"), "{\"old\":true}").unwrap();

    // notes is a string instead of an array — typed deserialization rejects it
    let invalid_payload = serde_json::json!({
        "status": "detailed_research_complete",
        "refinement_count": 1,
        "section_count": 1,
        "clarifications_json": {
            "version": "1",
            "metadata": {
                "title": "Bad",
                "question_count": 1,
                "section_count": 1,
                "refinement_count": 0,
                "must_answer_count": 0,
                "priority_questions": []
            },
            "sections": [],
            "notes": "not-an-array"
        }
    });
    let err = materialize_workflow_step_output_value(&skill_root, 1, &invalid_payload).unwrap_err();
    // Typed deserialization catches notes type mismatch
    assert!(
        err.contains("invalid detailed research output"),
        "unexpected error: {err}"
    );
    assert_eq!(
        std::fs::read_to_string(context_dir.join("clarifications.json")).unwrap(),
        "{\"old\":true}"
    );
}

#[test]
fn test_materialize_step1_rejects_invalid_answer_evaluator_notes_shape() {
    let tmp = tempfile::tempdir().unwrap();
    let skill_root = tmp.path().join("my-skill");
    let payload = serde_json::json!({
        "status": "detailed_research_complete",
        "refinement_count": 1,
        "section_count": 1,
        "clarifications_json": {
            "version": "1",
            "metadata": {
                "title": "Bad Notes",
                "question_count": 1,
                "section_count": 1,
                "refinement_count": 0,
                "must_answer_count": 0,
                "priority_questions": []
            },
            "sections": [],
            "notes": [],
            "answer_evaluator_notes": "invalid"
        }
    });

    let err = materialize_workflow_step_output_value(&skill_root, 1, &payload).unwrap_err();
    // Typed deserialization rejects non-array answer_evaluator_notes
    assert!(
        err.contains("invalid detailed research output"),
        "unexpected error: {err}"
    );
}

#[test]
fn test_validate_clarifications_accepts_numeric_section_id() {
    let v = valid_clarifications_value();
    // numeric id (canonical agent output)
    assert!(
        super::step_config::validate_clarifications_json(&v).is_ok(),
        "numeric section id should be accepted"
    );
}

#[test]
fn test_validate_clarifications_rejects_string_section_id() {
    let mut v = valid_clarifications_value();
    v["sections"][0]["id"] = serde_json::json!("S1");
    let err = super::step_config::validate_clarifications_json(&v).unwrap_err();
    // Typed deserialization rejects string where i64 is expected
    assert!(err.contains("invalid type"), "unexpected error: {err}");
}

#[test]
fn test_validate_clarifications_rejects_null_section_id() {
    let mut v = valid_clarifications_value();
    v["sections"][0]["id"] = serde_json::json!(null);
    let err = super::step_config::validate_clarifications_json(&v).unwrap_err();
    // Typed deserialization rejects null where i64 is expected
    assert!(err.contains("invalid type"), "unexpected error: {err}");
}

#[test]
fn test_materialize_step0_scope_recommendation_triggers_scope_guard_parser() {
    let tmp = tempfile::tempdir().unwrap();
    let skill_root = tmp.path().join("my-skill");
    let payload = serde_json::json!({
        "status": "research_complete",
        "question_count": 0,
        "research_output": {
            "version": "1",
            "metadata": {
                "title": "Scoped",
                "question_count": 0,
                "section_count": 0,
                "refinement_count": 0,
                "must_answer_count": 0,
                "priority_questions": [],
                "scope_recommendation": true
            },
            "sections": [],
            "notes": []
        }
    });

    materialize_workflow_step_output_value(&skill_root, 0, &payload).unwrap();
    assert!(parse_scope_recommendation(
        &skill_root.join("context/clarifications.json")
    ));
}

#[test]
fn test_materialize_step2_writes_decisions() {
    let tmp = tempfile::tempdir().unwrap();
    let skill_root = tmp.path().join("my-skill");
    let payload = serde_json::json!({
        "version": "1",
        "metadata": { "decision_count": 1, "conflicts_resolved": 0, "round": 1 },
        "decisions": [{
            "id": "D1",
            "title": "Capability",
            "original_question": "Which capability?",
            "decision": "A",
            "implication": "None",
            "status": "resolved"
        }]
    });
    materialize_workflow_step_output_value(&skill_root, 2, &payload).unwrap();
    assert!(skill_root.join("context/decisions.json").exists());
}

#[test]
fn test_materialize_step2_writes_scope_guard_stub_decisions() {
    let tmp = tempfile::tempdir().unwrap();
    let skill_root = tmp.path().join("my-skill");
    let payload = serde_json::json!({
        "version": "1",
        "metadata": { "scope_recommendation": true, "decision_count": 0, "conflicts_resolved": 0, "round": 1 },
        "decisions": []
    });
    materialize_workflow_step_output_value(&skill_root, 2, &payload).unwrap();
    let content = std::fs::read_to_string(skill_root.join("context/decisions.json")).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&content).unwrap();
    assert_eq!(parsed["metadata"]["scope_recommendation"], true);
    assert_eq!(parsed["metadata"]["decision_count"], 0);
}

#[test]
fn test_materialize_step2_conflict_decisions_trigger_conflict_guard() {
    let tmp = tempfile::tempdir().unwrap();
    let skill_root = tmp.path().join("my-skill");
    let payload = serde_json::json!({
        "version": "1",
        "metadata": { "decision_count": 2, "conflicts_resolved": 0, "round": 1, "contradictory_inputs": true },
        "decisions": []
    });
    materialize_workflow_step_output_value(&skill_root, 2, &payload).unwrap();
    assert!(parse_decisions_guard(
        &skill_root.join("context/decisions.json")
    ));
}

#[test]
fn test_materialize_step2_revised_conflict_decisions_do_not_trigger_guard() {
    let tmp = tempfile::tempdir().unwrap();
    let skill_root = tmp.path().join("my-skill");
    let payload = serde_json::json!({
        "version": "1",
        "metadata": { "decision_count": 2, "conflicts_resolved": 0, "round": 1, "contradictory_inputs": false },
        "decisions": []
    });
    materialize_workflow_step_output_value(&skill_root, 2, &payload).unwrap();
    assert!(!parse_decisions_guard(
        &skill_root.join("context/decisions.json")
    ));
}

#[test]
fn test_materialize_step2_rejects_null_payload() {
    let tmp = tempfile::tempdir().unwrap();
    let skill_root = tmp.path().join("my-skill");
    let err = materialize_workflow_step_output_value(&skill_root, 2, &serde_json::json!(null))
        .unwrap_err();
    assert!(err.contains("structured_output must be a JSON object"));
}

#[test]
fn test_materialize_step3_generate_writes_pending_benchmark() {
    let tmp = tempfile::tempdir().unwrap();
    let skill_root = tmp.path().join("my-skill");
    let payload = serde_json::json!({
        "status": "generated",
        "call_trace": ["read-user-context", "write-skill"]
    });
    materialize_workflow_step_output_value(&skill_root, 3, &payload).unwrap();

    // Verify benchmark-meta.json was written with pending status
    let meta_path = skill_root.join("context/benchmark-meta.json");
    assert!(meta_path.exists(), "benchmark-meta.json should be written");
    let meta: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&meta_path).unwrap()).unwrap();
    assert_eq!(meta["benchmark_status"], "pending");
    assert!(meta["benchmark_path"].is_null());
}

#[test]
fn test_materialize_step3_generate_skipped_writes_skipped_benchmark() {
    let tmp = tempfile::tempdir().unwrap();
    let skill_root = tmp.path().join("my-skill");
    let payload = serde_json::json!({
        "status": "generated",
        "skipped": true
    });
    materialize_workflow_step_output_value(&skill_root, 3, &payload).unwrap();

    let meta_path = skill_root.join("context/benchmark-meta.json");
    let meta: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&meta_path).unwrap()).unwrap();
    assert_eq!(meta["benchmark_status"], "skipped");
}

#[test]
fn publish_commit_and_tag_generated_skill_creates_initial_version_tag() {
    let workspace = tempfile::tempdir().unwrap();
    let skills = tempfile::tempdir().unwrap();
    let workspace_skill_root = workspace.path().join("skills").join("tagged-skill");
    let generated_refs = workspace_skill_root.join("skill").join("references");
    std::fs::create_dir_all(&generated_refs).unwrap();
    std::fs::write(
        workspace_skill_root.join("skill").join("SKILL.md"),
        "---\nname: tagged-skill\nmetadata:\n  version: 1.0.0\n---\n# Tagged Skill\n",
    )
    .unwrap();
    std::fs::write(generated_refs.join("terms.md"), "# Terms\n").unwrap();

    publish_commit_and_tag_generated_skill(
        &workspace_skill_root,
        skills.path(),
        "skills",
        "tagged-skill",
    )
    .unwrap();

    assert!(
        crate::git::skill_version_tag_exists(skills.path(), "skills", "tagged-skill", "1.0.0")
            .unwrap()
    );
}

#[test]
fn publish_commit_and_tag_generated_skill_surfaces_duplicate_tag_error() {
    let workspace = tempfile::tempdir().unwrap();
    let skills = tempfile::tempdir().unwrap();
    let plugin_slug = "skills";
    let skill_name = "tagged-skill";
    let published_dir =
        crate::skill_paths::resolve_skill_dir(skills.path(), plugin_slug, skill_name);
    std::fs::create_dir_all(&published_dir).unwrap();
    std::fs::write(
        published_dir.join("SKILL.md"),
        "---\nname: tagged-skill\nmetadata:\n  version: 1.0.0\n---\n# Existing\n",
    )
    .unwrap();
    crate::git::commit_all(skills.path(), "tagged-skill: existing").unwrap();
    crate::git::create_skill_version_tag(skills.path(), plugin_slug, skill_name, "1.0.0").unwrap();

    let workspace_skill_root = workspace.path().join("skills").join(skill_name);
    let generated_dir = workspace_skill_root.join("skill");
    std::fs::create_dir_all(&generated_dir).unwrap();
    std::fs::write(
        generated_dir.join("SKILL.md"),
        "---\nname: tagged-skill\nmetadata:\n  version: 1.0.0\n---\n# Updated\n",
    )
    .unwrap();

    let err = publish_commit_and_tag_generated_skill(
        &workspace_skill_root,
        skills.path(),
        plugin_slug,
        skill_name,
    )
    .unwrap_err();

    assert!(
        err.contains("Generated skill version tag failed"),
        "unexpected error: {err}"
    );
}

#[test]
fn test_materialize_step3_benchmark_complete() {
    let tmp = tempfile::tempdir().unwrap();
    let skill_root = tmp.path().join("my-skill");
    let bench_dir = skill_root.join("evals/iterations/iteration-1");
    std::fs::create_dir_all(&bench_dir).unwrap();
    std::fs::write(bench_dir.join("benchmark.json"), "{}").unwrap();

    let payload = serde_json::json!({
        "status": "complete",
        "benchmark_path": "evals/iterations/iteration-1"
    });
    materialize_workflow_step_output_value(&skill_root, 3, &payload).unwrap();

    let meta_path = skill_root.join("context/benchmark-meta.json");
    assert!(meta_path.exists(), "benchmark-meta.json should be written");
    let meta: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&meta_path).unwrap()).unwrap();
    assert_eq!(meta["benchmark_status"], "complete");
    assert_eq!(meta["benchmark_path"], "evals/iterations/iteration-1");
}

#[test]
fn test_materialize_step3_partial_with_benchmark_json_upgrades_to_complete() {
    let tmp = tempfile::tempdir().unwrap();
    let skill_root = tmp.path().join("my-skill");
    let bench_dir = skill_root.join("evals/iterations/iteration-1");
    std::fs::create_dir_all(&bench_dir).unwrap();
    std::fs::write(bench_dir.join("benchmark.json"), "{}").unwrap();

    let payload = serde_json::json!({
        "status": "partial",
        "benchmark_path": "evals/iterations/iteration-1"
    });
    materialize_workflow_step_output_value(&skill_root, 3, &payload).unwrap();

    let meta: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(skill_root.join("context/benchmark-meta.json")).unwrap(),
    )
    .unwrap();
    // benchmark.json exists on disk — should be upgraded to "complete"
    assert_eq!(meta["benchmark_status"], "complete");
    assert_eq!(meta["benchmark_path"], "evals/iterations/iteration-1");
}

#[test]
fn test_materialize_step3_partial_without_benchmark_json_stays_partial() {
    let tmp = tempfile::tempdir().unwrap();
    let skill_root = tmp.path().join("my-skill");
    // No benchmark.json on disk — partial stays partial
    let payload = serde_json::json!({
        "status": "partial",
        "benchmark_path": "evals/iterations/iteration-1"
    });
    materialize_workflow_step_output_value(&skill_root, 3, &payload).unwrap();

    let meta: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(skill_root.join("context/benchmark-meta.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(meta["benchmark_status"], "partial");
}

#[test]
fn test_materialize_step3_rejects_wrong_status() {
    let tmp = tempfile::tempdir().unwrap();
    let skill_root = tmp.path().join("my-skill");
    let payload = serde_json::json!({
        "status": "decisions_complete"
    });
    let err = materialize_workflow_step_output_value(&skill_root, 3, &payload).unwrap_err();
    assert!(err.contains("must be 'generated', 'rewritten', or 'complete'|'partial'|'skipped'"));
}

#[test]
fn test_build_prompt_all_three_paths() {
    let prompt = build_prompt(&PromptParams {
        skill_name: "my-skill",
        workspace_path: "/home/user/.vibedata/skill-builder",
        plugin_slug: DEFAULT_PLUGIN_SLUG,
        skills_path: "/home/user/my-skills",
        author_login: None,
        created_at: None,
        step_id: 1,
    });
    assert!(prompt.contains("my-skill"));
    assert!(prompt.contains(
        "The workspace directory is: /home/user/.vibedata/skill-builder/skills/my-skill"
    ));
    assert!(prompt.contains("The skill output directory (SKILL.md and references/) is: /home/user/my-skills/skills/my-skill"));
    assert!(prompt.contains("This skill output directory is the configured Settings Skills Folder target for the shipped skill"));
    assert!(prompt.contains("shipped skill files must be written only to the skill output directory, never to the workspace directory or a workspace skill/ subdirectory"));
    assert!(prompt.contains("The user context file is at: /home/user/.vibedata/skill-builder/skills/my-skill/user-context.md"));
    assert!(prompt.contains(
        "The context directory is: /home/user/.vibedata/skill-builder/skills/my-skill/context"
    ));
}

#[test]
fn test_build_prompt_with_skill_type() {
    let prompt = build_prompt(&PromptParams {
        skill_name: "my-skill",
        workspace_path: "/home/user/.vibedata/skill-builder",
        plugin_slug: DEFAULT_PLUGIN_SLUG,
        skills_path: "/home/user/my-skills",
        author_login: None,
        created_at: None,
        step_id: 1,
    });
    // Purpose is now in user-context.md, read by the agent
    assert!(prompt.contains("user-context.md"));
}

#[test]
fn test_build_prompt_with_author_info() {
    let prompt = build_prompt(&PromptParams {
        skill_name: "my-skill",
        workspace_path: "/home/user/.vibedata/skill-builder",
        plugin_slug: DEFAULT_PLUGIN_SLUG,
        skills_path: "/home/user/my-skills",
        author_login: Some("octocat"),
        created_at: Some("2025-06-15T12:00:00Z"),
        step_id: 1,
    });
    assert!(prompt.contains("The author of this skill is: octocat."));
    assert!(prompt.contains("The skill was created on: 2025-06-15."));
    assert!(prompt.contains("Today's date (for the modified timestamp) is:"));
}

#[test]
fn test_build_prompt_without_author_info() {
    let prompt = build_prompt(&PromptParams {
        skill_name: "my-skill",
        workspace_path: "/home/user/.vibedata/skill-builder",
        plugin_slug: DEFAULT_PLUGIN_SLUG,
        skills_path: "/home/user/my-skills",
        author_login: None,
        created_at: None,
        step_id: 1,
    });
    assert!(!prompt.contains("The author of this skill is:"));
    assert!(!prompt.contains("The skill was created on:"));
}

#[test]
fn test_build_prompt_does_not_include_schema_file_path() {
    // Schema file paths are no longer injected into the prompt. Workflow steps
    // use app-side outputFormat contracts and Rust validation.
    for step_id in [1u32, 2, 3] {
        let prompt = build_prompt(&PromptParams {
            skill_name: "s",
            workspace_path: "/ws",
            plugin_slug: DEFAULT_PLUGIN_SLUG,
            skills_path: "/sk",
            author_login: None,
            created_at: None,
            step_id,
        });
        assert!(
            !prompt.contains("step-0-research.json"),
            "step {step_id}: schema file path must not be in prompt"
        );
        assert!(
            !prompt.contains("step-1-detailed-research.json"),
            "step {step_id}: schema file path must not be in prompt"
        );
        assert!(
            !prompt.contains("step-2-decisions.json"),
            "step {step_id}: schema file path must not be in prompt"
        );
        assert!(
            !prompt.contains("Do NOT read other step schema files"),
            "step {step_id}: old schema read directive must not be in prompt"
        );
    }
    // Step-specific output-type hints are still present (from step_output_hint).
    let step1 = build_prompt(&PromptParams {
        skill_name: "s",
        workspace_path: "/ws",
        plugin_slug: DEFAULT_PLUGIN_SLUG,
        skills_path: "/sk",
        author_login: None,
        created_at: None,
        step_id: 1,
    });
    assert!(step1.contains("DetailedResearchOutput"));
    let step2 = build_prompt(&PromptParams {
        skill_name: "s",
        workspace_path: "/ws",
        plugin_slug: DEFAULT_PLUGIN_SLUG,
        skills_path: "/sk",
        author_login: None,
        created_at: None,
        step_id: 2,
    });
    assert!(step2.contains("DecisionsOutput"));
}

#[test]
fn test_active_workflow_prompts_do_not_reintroduce_claude_routing() {
    let workflow_prompt = build_prompt(&PromptParams {
        skill_name: "s",
        workspace_path: "/ws",
        plugin_slug: DEFAULT_PLUGIN_SLUG,
        skills_path: "/sk",
        author_login: None,
        created_at: None,
        step_id: 2,
    });
    let evaluator_prompt =
        super::prompt::build_evaluator_prompt("s", "/ws", DEFAULT_PLUGIN_SLUG, "/sk");
    let prompts = [
        ("workflow", workflow_prompt),
        ("answer evaluator", evaluator_prompt),
    ];

    for (label, prompt) in prompts {
        for forbidden in [
            ".claude/plugins",
            "skill-content-researcher:",
            "skill-creator:",
            "AskUserQuestion",
            "Agent tool",
            "Skill tool",
            "subagent_directive",
            "pathToClaudeCodeExecutable",
            "permissionMode",
        ] {
            assert!(
                !prompt.contains(forbidden),
                "{label} prompt must not contain stale routing token: {forbidden}"
            );
        }
    }
}

#[test]
fn test_build_step0_prompt_uses_openhands_native_research_routing() {
    let prompt = build_step0_prompt(
        "my-skill",
        "/home/user/.vibedata/skill-builder",
        DEFAULT_PLUGIN_SLUG,
        4,
    );

    assert!(prompt.contains("We are writing the skill my-skill."));
    assert!(prompt.contains("Maximum research dimensions before scope warning: 4"));
    assert!(prompt.contains("research_output"));
    assert!(prompt.contains("Use parallel research via"));
    assert!(prompt.contains("subagents if that capability is available"));

    for forbidden in [
        "research-agent",
        "delegate",
        "ResearchStepOutput",
        "AskUserQuestion",
        ".claude/plugins",
        "skill-content-researcher:research",
    ] {
        assert!(
            !prompt.contains(forbidden),
            "step 0 prompt must not contain Claude routing term: {forbidden}"
        );
    }
}

#[test]
fn test_output_format_contains_correct_inline_schema_per_workflow_step() {
    use crate::generated::schemas;
    let cases: &[(u32, &str)] = &[
        (0, schemas::RESEARCH_STEP_INLINE_SCHEMA),
        (1, schemas::DETAILED_RESEARCH_INLINE_SCHEMA),
        (2, schemas::DECISIONS_INLINE_SCHEMA),
    ];
    for (step_id, expected_schema) in cases {
        let format = workflow_output_format_for_step(*step_id)
            .unwrap_or_else(|| panic!("step {step_id} must have workflow outputFormat"));
        let actual_schema = format
            .get("schema")
            .expect("outputFormat must contain schema");
        let expected_schema: serde_json::Value =
            serde_json::from_str(expected_schema).expect("generated schema must parse");
        assert_eq!(
            *actual_schema, expected_schema,
            "step {step_id}: outputFormat must use the inline schema"
        );
    }
}

#[test]
fn test_answer_evaluator_prompt_uses_standard_paths() {
    let workspace_path = "/home/user/.vibedata/skill-builder";
    let skill_name = "my-skill";
    let skills_path = "/home/user/my-skills";

    let prompt = super::prompt::build_evaluator_prompt(
        skill_name,
        workspace_path,
        DEFAULT_PLUGIN_SLUG,
        skills_path,
    );

    assert!(prompt.contains("We are writing the skill my-skill."));
    assert!(
        prompt.contains("Workspace directory: /home/user/.vibedata/skill-builder/skills/my-skill")
    );
    assert!(prompt.contains("Skill output directory: /home/user/my-skills/skills/my-skill"));
    assert!(prompt.contains(
        "User context file: /home/user/.vibedata/skill-builder/skills/my-skill/user-context.md"
    ));
    assert!(prompt
        .contains("Context directory: /home/user/.vibedata/skill-builder/skills/my-skill/context"));
    assert!(prompt.contains("Do not create directories with mkdir"));
}

#[test]
fn test_make_agent_id() {
    let id = make_agent_id("test-skill", "research");
    assert!(id.starts_with("test-skill-research-"));
    let parts: Vec<&str> = id.rsplitn(2, '-').collect();
    assert!(parts[0].parse::<u128>().is_ok());
}

#[test]
fn test_workflow_step_runtime_label_uses_step_name_slug() {
    let step = get_step_config(2).expect("step config");
    assert_eq!(workflow_step_runtime_label(&step), "confirm-decisions");
}

// Tests for copy_directory_to removed — function no longer exists
// (agents tree is no longer deployed to workspace root)

#[test]
fn test_resolve_prompts_dir_dev_mode() {
    // In dev/test mode, CARGO_MANIFEST_DIR is set and the repo root has bundled agents/plugins.
    let dev_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|p| p.parent())
        .map(|p| p.join("agent-sources"));
    assert!(dev_path.is_some());
    let agent_sources_dir = dev_path.unwrap();
    let plugin_agents_dir = agent_sources_dir
        .join("plugins")
        .join("skill-content-researcher")
        .join("agents");
    // Verify flat agent files exist (no subdirectories)
    assert!(
        plugin_agents_dir.join("research-agent.md").exists(),
        "agent-sources/plugins/skill-content-researcher/agents/research-agent.md should exist"
    );
}

#[test]
fn test_delete_step_output_files_from_step_onwards() {
    let workspace_tmp = tempfile::tempdir().unwrap();
    let skills_tmp = tempfile::tempdir().unwrap();
    let workspace = workspace_tmp.path().to_str().unwrap();
    let skills_path = skills_tmp.path().to_str().unwrap();
    // Context files live in workspace_path/{plugin_slug}/skill_name/context/
    let skill_dir = skills_tmp.path().join(DEFAULT_PLUGIN_SLUG).join("my-skill");
    let workspace_skill_dir = workspace_tmp
        .path()
        .join(DEFAULT_PLUGIN_SLUG)
        .join("my-skill");
    std::fs::create_dir_all(workspace_skill_dir.join("context")).unwrap();
    std::fs::create_dir_all(skill_dir.join("references")).unwrap();

    // Create output files for steps 0, 1, 2, 3
    // Steps 0 and 1 both use clarifications.json (unified artifact)
    std::fs::write(
        workspace_skill_dir.join("context/clarifications.json"),
        "step0+step1",
    )
    .unwrap();
    std::fs::write(workspace_skill_dir.join("context/decisions.json"), "{}").unwrap();
    std::fs::write(skill_dir.join("SKILL.md"), "step3").unwrap();
    std::fs::write(skill_dir.join("references/ref.md"), "ref").unwrap();

    // Reset from step 2 onwards — steps 0, 1 should be preserved
    crate::cleanup::delete_step_output_files(
        workspace,
        "my-skill",
        DEFAULT_PLUGIN_SLUG,
        2,
        skills_path,
    );

    // Steps 0, 1 output (unified clarifications.json) should still exist
    assert!(workspace_skill_dir
        .join("context/clarifications.json")
        .exists());

    // Steps 2+ outputs should be deleted
    assert!(!workspace_skill_dir.join("context/decisions.json").exists());
    assert!(!skill_dir.join("SKILL.md").exists());
    assert!(!skill_dir.join("references").exists());
}

#[test]
fn test_clean_step_output_step1_is_noop() {
    // Step 1 edits clarifications.json in-place (no unique artifact),
    // so cleaning step 1 has no files to delete.
    let workspace_tmp = tempfile::tempdir().unwrap();
    let skills_tmp = tempfile::tempdir().unwrap();
    let workspace = workspace_tmp.path().to_str().unwrap();
    let skills_path = skills_tmp.path().to_str().unwrap();
    let skill_dir = skills_tmp.path().join("my-skill");
    std::fs::create_dir_all(skill_dir.join("context")).unwrap();

    std::fs::write(skill_dir.join("context/clarifications.json"), "refined").unwrap();
    std::fs::write(skill_dir.join("context/decisions.json"), "{}").unwrap();

    // Clean only step 1 — both files should be untouched (step 1 has no unique output)
    crate::cleanup::clean_step_output(workspace, "my-skill", DEFAULT_PLUGIN_SLUG, 1, skills_path);

    assert!(skill_dir.join("context/clarifications.json").exists());
    assert!(skill_dir.join("context/decisions.json").exists());
}

#[test]
fn test_delete_step_output_files_nonexistent_dir_is_ok() {
    // Should not panic on nonexistent directory
    let tmp = tempfile::tempdir().unwrap();
    let skills_path = tmp.path().to_str().unwrap();
    let nonexistent = std::env::temp_dir().join("nonexistent");
    crate::cleanup::delete_step_output_files(
        nonexistent.to_str().unwrap(),
        "no-skill",
        DEFAULT_PLUGIN_SLUG,
        0,
        skills_path,
    );
}

#[test]
fn test_delete_step_output_files_cleans_last_steps() {
    let workspace_tmp = tempfile::tempdir().unwrap();
    let skills_tmp = tempfile::tempdir().unwrap();
    let workspace = workspace_tmp.path().to_str().unwrap();
    let skills_path = skills_tmp.path().to_str().unwrap();
    let _skill_dir = skills_tmp.path().join("my-skill");
    let workspace_skill_dir = workspace_tmp
        .path()
        .join(DEFAULT_PLUGIN_SLUG)
        .join("my-skill");
    std::fs::create_dir_all(workspace_skill_dir.join("context")).unwrap();

    // Create files for step 2 (decisions) in workspace context
    std::fs::write(workspace_skill_dir.join("context/decisions.json"), "{}").unwrap();

    // Reset from step 2 onwards should clean up step 2+3
    crate::cleanup::delete_step_output_files(
        workspace,
        "my-skill",
        DEFAULT_PLUGIN_SLUG,
        2,
        skills_path,
    );

    // Step 2 outputs should be deleted
    assert!(!workspace_skill_dir.join("context/decisions.json").exists());
}

#[test]
fn test_delete_step_output_files_last_step() {
    // Verify delete_step_output_files(from=3) doesn't panic
    let workspace_tmp = tempfile::tempdir().unwrap();
    let skills_tmp = tempfile::tempdir().unwrap();
    let workspace = workspace_tmp.path().to_str().unwrap();
    let skills_path = skills_tmp.path().to_str().unwrap();
    std::fs::create_dir_all(workspace_tmp.path().join("my-skill")).unwrap();
    crate::cleanup::delete_step_output_files(
        workspace,
        "my-skill",
        DEFAULT_PLUGIN_SLUG,
        3,
        skills_path,
    );
}

#[test]
fn test_copy_directory_recursive_copies_all_file_types() {
    let src = tempfile::tempdir().unwrap();
    let dest = tempfile::tempdir().unwrap();

    // Create source files of various types (not just .md)
    std::fs::write(src.path().join("SKILL.md"), "# Skill").unwrap();
    std::fs::write(src.path().join("data.csv"), "col1,col2\na,b").unwrap();
    std::fs::write(src.path().join("config.json"), "{}").unwrap();

    let dest_path = dest.path().join("output");
    copy_directory_recursive(src.path(), &dest_path).unwrap();

    assert!(dest_path.join("SKILL.md").exists());
    assert!(dest_path.join("data.csv").exists());
    assert!(dest_path.join("config.json").exists());

    // Verify content is preserved
    let csv_content = std::fs::read_to_string(dest_path.join("data.csv")).unwrap();
    assert_eq!(csv_content, "col1,col2\na,b");
}

#[test]
fn test_copy_directory_recursive_handles_nested_dirs() {
    let src = tempfile::tempdir().unwrap();
    let dest = tempfile::tempdir().unwrap();

    // Create nested structure
    std::fs::create_dir_all(src.path().join("sub").join("deep")).unwrap();
    std::fs::write(src.path().join("top.md"), "top").unwrap();
    std::fs::write(src.path().join("sub").join("middle.txt"), "middle").unwrap();
    std::fs::write(
        src.path().join("sub").join("deep").join("bottom.md"),
        "bottom",
    )
    .unwrap();

    let dest_path = dest.path().join("copied");
    copy_directory_recursive(src.path(), &dest_path).unwrap();

    assert!(dest_path.join("top.md").exists());
    assert!(dest_path.join("sub").join("middle.txt").exists());
    assert!(dest_path
        .join("sub")
        .join("deep")
        .join("bottom.md")
        .exists());

    let bottom =
        std::fs::read_to_string(dest_path.join("sub").join("deep").join("bottom.md")).unwrap();
    assert_eq!(bottom, "bottom");
}

#[test]
fn test_copy_directory_recursive_creates_dest_dir() {
    let src = tempfile::tempdir().unwrap();
    let dest = tempfile::tempdir().unwrap();

    std::fs::write(src.path().join("file.txt"), "hello").unwrap();

    // Destination doesn't exist yet — copy_directory_recursive should create it
    let dest_path = dest.path().join("new").join("nested").join("dir");
    assert!(!dest_path.exists());

    copy_directory_recursive(src.path(), &dest_path).unwrap();

    assert!(dest_path.join("file.txt").exists());
}

#[test]
fn test_copy_directory_recursive_empty_dir() {
    let src = tempfile::tempdir().unwrap();
    let dest = tempfile::tempdir().unwrap();

    // Source is empty
    let dest_path = dest.path().join("empty_copy");
    copy_directory_recursive(src.path(), &dest_path).unwrap();

    assert!(dest_path.exists());
    assert!(dest_path.is_dir());
    // No files should be created
    let count = std::fs::read_dir(&dest_path).unwrap().count();
    assert_eq!(count, 0);
}

#[test]
fn test_copy_directory_recursive_nonexistent_source_fails() {
    let dest = tempfile::tempdir().unwrap();
    let result =
        copy_directory_recursive(Path::new("/nonexistent/source"), &dest.path().join("dest"));
    assert!(result.is_err());
}

#[test]
fn test_copy_agents_to_claude_dir() {
    let src = tempfile::tempdir().unwrap();
    let workspace = tempfile::tempdir().unwrap();

    // Create flat agent files
    std::fs::write(
        src.path().join("research-entities.md"),
        "# Research Entities",
    )
    .unwrap();
    std::fs::write(
        src.path().join("consolidate-research.md"),
        "# Consolidate Research",
    )
    .unwrap();

    // Non-.md file should be ignored
    std::fs::write(src.path().join("README.txt"), "ignore me").unwrap();

    let workspace_path = workspace.path().to_str().unwrap();
    copy_agents_to_claude_dir(src.path(), workspace_path).unwrap();

    let claude_agents_dir = workspace.path().join(".claude").join("agents");
    assert!(claude_agents_dir.is_dir());

    // Verify flat names (no prefix)
    assert!(claude_agents_dir.join("research-entities.md").exists());
    assert!(claude_agents_dir.join("consolidate-research.md").exists());

    // Non-.md file should NOT be copied
    assert!(!claude_agents_dir.join("README.txt").exists());

    // Verify content
    let content = std::fs::read_to_string(claude_agents_dir.join("research-entities.md")).unwrap();
    assert_eq!(content, "# Research Entities");
}

#[test]
fn test_copy_prompts_sync_deploys_workflow_agents_to_openhands_layout() {
    let workspace_agents_src = tempfile::tempdir().unwrap();
    let workspace_skills_src = tempfile::tempdir().unwrap();
    let workspace = tempfile::tempdir().unwrap();
    let workspace_skill_dir = crate::skill_paths::workspace_skill_dir(
        workspace.path(),
        DEFAULT_PLUGIN_SLUG,
        "test-skill",
    );
    std::fs::create_dir_all(&workspace_skill_dir).unwrap();

    std::fs::write(
        workspace_agents_src.path().join("skill-creator.md"),
        "# Skill Creator Agent",
    )
    .unwrap();
    std::fs::write(workspace_agents_src.path().join("README.txt"), "skip me").unwrap();
    std::fs::create_dir_all(
        workspace_skills_src
            .path()
            .join("researching-skill-requirements"),
    )
    .unwrap();
    std::fs::write(
        workspace_skills_src
            .path()
            .join("researching-skill-requirements")
            .join("SKILL.md"),
        "# Researching Skill Requirements",
    )
    .unwrap();
    std::fs::create_dir_all(workspace_skills_src.path().join("answer-evaluator")).unwrap();
    std::fs::write(
        workspace_skills_src
            .path()
            .join("answer-evaluator")
            .join("SKILL.md"),
        "# Answer Evaluator",
    )
    .unwrap();
    std::fs::create_dir_all(workspace_skills_src.path().join("skill-creator")).unwrap();
    std::fs::write(
        workspace_skills_src
            .path()
            .join("skill-creator")
            .join("SKILL.md"),
        "# Skill Creator",
    )
    .unwrap();

    let claude_template = tempfile::NamedTempFile::new().unwrap();
    std::fs::write(claude_template.path(), "# Claude").unwrap();

    copy_prompts_sync(
        workspace_agents_src.path(),
        workspace_skills_src.path(),
        claude_template.path(),
        workspace.path().to_str().unwrap(),
    )
    .unwrap();

    assert!(workspace_skill_dir
        .join(".agents/agents/skill-creator.md")
        .is_file());
    assert!(!workspace_skill_dir
        .join(".agents/agents/README.txt")
        .exists());
    assert!(workspace_skill_dir
        .join(".agents/skills/researching-skill-requirements/SKILL.md")
        .is_file());
    assert!(workspace_skill_dir
        .join(".agents/skills/answer-evaluator/SKILL.md")
        .is_file());
    assert!(workspace_skill_dir
        .join(".agents/skills/skill-creator/SKILL.md")
        .is_file());
    assert!(workspace
        .path()
        .join(".agents/agents/skill-creator.md")
        .is_file());
    assert!(workspace
        .path()
        .join(".agents/skills/researching-skill-requirements/SKILL.md")
        .is_file());
    assert!(workspace
        .path()
        .join(".agents/skills/answer-evaluator/SKILL.md")
        .is_file());
    assert!(!workspace_skill_dir.join("CLAUDE.md").exists());
    assert!(!workspace.path().join("CLAUDE.md").exists());
}

#[test]
fn test_copy_managed_plugins_replaces_managed_and_preserves_unmanaged() {
    let src = tempfile::tempdir().unwrap();
    let workspace = tempfile::tempdir().unwrap();
    let src_plugins = src.path().join("plugins");
    std::fs::create_dir_all(&src_plugins).unwrap();

    // Source plugin with current content
    let source_plugin = src_plugins.join("skill-creator");
    std::fs::create_dir_all(&source_plugin).unwrap();
    std::fs::write(source_plugin.join("SKILL.md"), "new plugin content").unwrap();

    let claude_plugins_dir = workspace.path().join(".claude").join("plugins");
    std::fs::create_dir_all(&claude_plugins_dir).unwrap();

    // Existing managed plugin should be replaced
    let managed_existing = claude_plugins_dir.join("skill-creator");
    std::fs::create_dir_all(&managed_existing).unwrap();
    std::fs::write(managed_existing.join("SKILL.md"), "old plugin content").unwrap();
    std::fs::write(
        managed_existing.join(".skill-builder-managed"),
        "managed by skill-builder startup\n",
    )
    .unwrap();

    // Unmanaged plugin should be preserved
    let unmanaged = claude_plugins_dir.join("user-plugin");
    std::fs::create_dir_all(&unmanaged).unwrap();
    std::fs::write(unmanaged.join("README.md"), "keep me").unwrap();

    copy_managed_plugins_to_claude_dir(&src_plugins, workspace.path().to_str().unwrap()).unwrap();

    let replaced =
        std::fs::read_to_string(claude_plugins_dir.join("skill-creator").join("SKILL.md")).unwrap();
    assert_eq!(replaced, "new plugin content");
    assert!(claude_plugins_dir
        .join("skill-creator")
        .join(".skill-builder-managed")
        .exists());

    let preserved =
        std::fs::read_to_string(claude_plugins_dir.join("user-plugin").join("README.md")).unwrap();
    assert_eq!(preserved, "keep me");
}

// --- VD-403: validate_decisions_exist_inner tests ---

#[test]
fn test_validate_decisions_missing() {
    let tmp = tempfile::tempdir().unwrap();
    let workspace = tmp.path().join("workspace");
    std::fs::create_dir_all(workspace.join("my-skill").join("context")).unwrap();

    let result = validate_decisions_exist_inner(
        "my-skill",
        workspace.to_str().unwrap(),
        DEFAULT_PLUGIN_SLUG,
        "/unused",
    );
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("decisions.json was not found"));
}

#[test]
fn test_validate_decisions_found_in_workspace_context() {
    let tmp = tempfile::tempdir().unwrap();
    let workspace = tmp.path().join("workspace");
    std::fs::create_dir_all(
        workspace
            .join(DEFAULT_PLUGIN_SLUG)
            .join("my-skill")
            .join("context"),
    )
    .unwrap();
    std::fs::write(
        workspace
            .join(DEFAULT_PLUGIN_SLUG)
            .join("my-skill")
            .join("context")
            .join("decisions.json"),
        r#"{"metadata":{"decision_count":1}}"#,
    )
    .unwrap();

    let result = validate_decisions_exist_inner(
        "my-skill",
        workspace.to_str().unwrap(),
        DEFAULT_PLUGIN_SLUG,
        "/unused",
    );
    assert!(result.is_ok());
}

#[test]
fn test_validate_decisions_rejects_empty_file() {
    let tmp = tempfile::tempdir().unwrap();
    let workspace = tmp.path().join("workspace");
    std::fs::create_dir_all(
        workspace
            .join(DEFAULT_PLUGIN_SLUG)
            .join("my-skill")
            .join("context"),
    )
    .unwrap();
    // Write an empty decisions file
    std::fs::write(
        workspace
            .join(DEFAULT_PLUGIN_SLUG)
            .join("my-skill")
            .join("context")
            .join("decisions.json"),
        "   \n\n  ",
    )
    .unwrap();

    let result = validate_decisions_exist_inner(
        "my-skill",
        workspace.to_str().unwrap(),
        DEFAULT_PLUGIN_SLUG,
        "/unused",
    );
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("decisions.json was not found"));
}

// --- debug mode: no reduced turns, sonnet model override ---

#[test]
fn test_debug_max_turns_removed() {
    // debug_max_turns no longer exists as a function. This test verifies
    // that get_step_config returns the *normal* turn limits for every step,
    // which is what run_workflow_step now uses unconditionally.
    let expected: Vec<(u32, u32)> = vec![
        (0, 50),  // research
        (1, 50),  // detailed research
        (2, 100), // confirm decisions
        (3, 500), // generate skill
    ];
    for (step_id, expected_turns) in expected {
        let config = get_step_config(step_id).unwrap();
        assert_eq!(
            config.max_turns, expected_turns,
            "Step {} should have max_turns={} (normal), got {}",
            step_id, expected_turns, config.max_turns
        );
    }
}

#[test]
fn test_step_max_turns() {
    let steps_with_expected_turns = [(0, 50), (1, 50), (2, 100), (3, 500)];
    for (step_id, normal_turns) in steps_with_expected_turns {
        let config = get_step_config(step_id).unwrap();
        assert_eq!(
            config.max_turns, normal_turns,
            "Step {} max_turns should be {}",
            step_id, normal_turns
        );
    }
}

#[test]
fn test_step0_always_wipes_context() {
    // Step 0 always wipes the context directory in skills_path (not workspace)
    let tmp = tempfile::tempdir().unwrap();
    let skills_path = tmp.path().to_str().unwrap();
    let skill_dir = tmp.path().join("my-skill");
    std::fs::create_dir_all(skill_dir.join("context")).unwrap();

    std::fs::write(skill_dir.join("context/clarifications.json"), "{}").unwrap();

    let step_id: u32 = 0;
    if step_id == 0 {
        let context_dir = Path::new(skills_path).join("my-skill").join("context");
        if context_dir.is_dir() {
            let _ = std::fs::remove_dir_all(&context_dir);
            let _ = std::fs::create_dir_all(&context_dir);
        }
    }

    // Context files should have been wiped
    assert!(!skill_dir.join("context/clarifications.json").exists());
    // But context directory itself should be recreated
    assert!(skill_dir.join("context").exists());
}

#[test]
fn test_write_user_context_file_all_fields() {
    let tmp = tempfile::tempdir().unwrap();
    let workspace_path = tmp.path().to_str().unwrap();
    let workspace_dir = tmp.path().join(DEFAULT_PLUGIN_SLUG).join("my-skill");
    // Directory doesn't need to pre-exist — create_dir_all handles it

    let intake =
        r#"{"audience":"Data engineers","challenges":"Legacy systems","scope":"ETL pipelines"}"#;
    write_user_context_file(
        workspace_path,
        DEFAULT_PLUGIN_SLUG,
        "my-skill",
        &[],
        None,
        Some("Healthcare"),
        Some("Analytics Lead"),
        Some(intake),
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        &[],
    );

    let content = std::fs::read_to_string(workspace_dir.join("user-context.md")).unwrap();
    assert!(content.contains("# User Context"));
    assert!(content.contains("### About You"));
    assert!(content.contains("**Industry**: Healthcare"));
    assert!(content.contains("**Function**: Analytics Lead"));
    assert!(content.contains("### Target Audience"));
    assert!(content.contains("Data engineers"));
    assert!(content.contains("### Key Challenges"));
    assert!(content.contains("Legacy systems"));
    assert!(content.contains("### Scope"));
    assert!(content.contains("ETL pipelines"));
}

#[test]
fn test_write_user_context_file_partial_fields() {
    let tmp = tempfile::tempdir().unwrap();
    let workspace_path = tmp.path().to_str().unwrap();
    let workspace_dir = tmp.path().join(DEFAULT_PLUGIN_SLUG).join("my-skill");

    write_user_context_file(
        workspace_path,
        DEFAULT_PLUGIN_SLUG,
        "my-skill",
        &[],
        None,
        Some("Fintech"),
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        &[],
    );

    let content = std::fs::read_to_string(workspace_dir.join("user-context.md")).unwrap();
    assert!(content.contains("**Industry**: Fintech"));
    assert!(!content.contains("**Function**"));
    assert!(!content.contains("**Target Audience**"));
}

#[test]
fn test_write_user_context_file_empty_optional_fields_skipped() {
    let tmp = tempfile::tempdir().unwrap();
    let workspace_path = tmp.path().to_str().unwrap();
    let workspace_dir = tmp.path().join(DEFAULT_PLUGIN_SLUG).join("my-skill");

    write_user_context_file(
        workspace_path,
        DEFAULT_PLUGIN_SLUG,
        "my-skill",
        &[],
        None,
        Some(""),
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        &[],
    );

    // Skill name is always written; empty optional fields are omitted
    let content = std::fs::read_to_string(workspace_dir.join("user-context.md")).unwrap();
    assert!(content.contains("**Name**: my-skill"));
    assert!(!content.contains("**Industry**"));
}

#[test]
fn test_write_user_context_file_always_writes_skill_name() {
    let tmp = tempfile::tempdir().unwrap();
    let workspace_path = tmp.path().to_str().unwrap();
    let workspace_dir = tmp.path().join(DEFAULT_PLUGIN_SLUG).join("my-skill");

    write_user_context_file(
        workspace_path,
        DEFAULT_PLUGIN_SLUG,
        "my-skill",
        &[],
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        &[],
    );

    // Skill name alone is enough to produce a file
    let content = std::fs::read_to_string(workspace_dir.join("user-context.md")).unwrap();
    assert!(content.contains("**Name**: my-skill"));
}

#[test]
fn test_write_user_context_file_creates_missing_dir() {
    let tmp = tempfile::tempdir().unwrap();
    let workspace_path = tmp.path().to_str().unwrap();
    let workspace_dir = tmp.path().join(DEFAULT_PLUGIN_SLUG).join("new-skill");
    // Directory does NOT exist yet
    assert!(!workspace_dir.exists());

    write_user_context_file(
        workspace_path,
        DEFAULT_PLUGIN_SLUG,
        "new-skill",
        &[],
        None,
        Some("Retail"),
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        &[],
    );

    // Directory should have been created and file written
    assert!(workspace_dir.join("user-context.md").exists());
}

#[test]
fn test_thinking_budget_for_step() {
    assert_eq!(thinking_budget_for_step(0), Some(8_000));
    assert_eq!(thinking_budget_for_step(1), Some(8_000));
    assert_eq!(thinking_budget_for_step(2), Some(32_000));
    assert_eq!(thinking_budget_for_step(3), Some(16_000));
    // Beyond last step returns None
    assert_eq!(thinking_budget_for_step(4), None);
    assert_eq!(thinking_budget_for_step(5), None);
    assert_eq!(thinking_budget_for_step(99), None);
}

#[test]
fn test_build_betas_thinking_enabled() {
    let betas = build_betas(Some(32000), "provider-model-id", true);
    assert_eq!(
        betas,
        Some(vec!["interleaved-thinking-2025-05-14".to_string()])
    );
}

#[test]
fn test_build_betas_does_not_special_case_model_families() {
    let betas = build_betas(Some(32000), "another-provider-model-id", true);
    assert_eq!(
        betas,
        Some(vec!["interleaved-thinking-2025-05-14".to_string()])
    );
}

#[test]
fn test_build_betas_none() {
    let betas = build_betas(None, "provider-model-id", true);
    assert_eq!(betas, None);
}

#[test]
fn test_workspace_already_copied_returns_false_for_unknown() {
    // Use a unique path to avoid interference from other tests
    let path = format!(
        "{}/test-workspace-unknown-{}",
        std::env::temp_dir().display(),
        std::process::id()
    );
    assert!(!workspace_already_copied(&path));
}

#[test]
fn test_mark_workspace_copied_then_already_copied() {
    let path = format!(
        "{}/test-workspace-mark-{}",
        std::env::temp_dir().display(),
        std::process::id()
    );
    assert!(!workspace_already_copied(&path));
    mark_workspace_copied(&path);
    assert!(workspace_already_copied(&path));
}

#[test]
fn test_workspace_copy_cache_is_per_workspace() {
    let path_a = format!(
        "{}/test-ws-a-{}",
        std::env::temp_dir().display(),
        std::process::id()
    );
    let path_b = format!(
        "{}/test-ws-b-{}",
        std::env::temp_dir().display(),
        std::process::id()
    );
    mark_workspace_copied(&path_a);
    assert!(workspace_already_copied(&path_a));
    assert!(!workspace_already_copied(&path_b));
}

#[test]
fn test_invalidate_workspace_cache() {
    let path = format!(
        "{}/test-ws-invalidate-{}",
        std::env::temp_dir().display(),
        std::process::id()
    );
    mark_workspace_copied(&path);
    assert!(workspace_already_copied(&path));
    invalidate_workspace_cache(&path);
    assert!(!workspace_already_copied(&path));
}

#[test]
fn test_reset_cleans_workspace_context_files() {
    // 1. Create a temp workspace dir and a separate temp skills_path dir
    let workspace_tmp = tempfile::tempdir().unwrap();
    let skills_path_tmp = tempfile::tempdir().unwrap();
    let workspace = workspace_tmp.path().to_str().unwrap();
    let skills_path = skills_path_tmp.path().to_str().unwrap();

    // 2-3. Create workspace/{plugin_slug}/my-skill/context/ with all context files
    let context_dir = workspace_tmp
        .path()
        .join(DEFAULT_PLUGIN_SLUG)
        .join("my-skill")
        .join("context");
    std::fs::create_dir_all(&context_dir).unwrap();

    let context_files = ["clarifications.json", "decisions.json"];
    for file in &context_files {
        std::fs::write(context_dir.join(file), "test content").unwrap();
    }

    // 4. Working dir must exist in workspace
    std::fs::create_dir_all(
        workspace_tmp
            .path()
            .join(DEFAULT_PLUGIN_SLUG)
            .join("my-skill"),
    )
    .unwrap();

    // 5. Call delete_step_output_files from step 0
    crate::cleanup::delete_step_output_files(
        workspace,
        "my-skill",
        DEFAULT_PLUGIN_SLUG,
        0,
        skills_path,
    );

    // 6. Assert ALL files in workspace/my-skill/context/ are gone
    let mut remaining: Vec<String> = Vec::new();
    for file in &context_files {
        if context_dir.join(file).exists() {
            remaining.push(file.to_string());
        }
    }
    assert!(
        remaining.is_empty(),
        "Expected all workspace context files to be deleted, but these remain: {:?}",
        remaining
    );
}

// --- VD-664: parse_scope_recommendation tests ---

#[test]
fn test_scope_recommendation_true() {
    let mut f = tempfile::NamedTempFile::new().unwrap();
    use std::io::Write as _;
    write!(
        f,
        r#"{{"metadata":{{"scope_recommendation":true,"original_dimensions":8}},"sections":[]}}"#
    )
    .unwrap();
    assert!(parse_scope_recommendation(f.path()));
}

#[test]
fn test_scope_recommendation_true_with_reason_fields() {
    let mut f = tempfile::NamedTempFile::new().unwrap();
    use std::io::Write as _;
    write!(
        f,
        r#"{{"metadata":{{"scope_recommendation":true,"scope_reason":"Throwaway intent detected","scope_next_action":"Provide concrete domain"}},"sections":[],"notes":[{{"type":"blocked","title":"Scope Recommendation","body":"Narrow the scope"}}]}}"#
    )
    .unwrap();
    assert!(parse_scope_recommendation(f.path()));
}

#[test]
fn test_scope_recommendation_false() {
    let mut f = tempfile::NamedTempFile::new().unwrap();
    use std::io::Write as _;
    write!(
        f,
        r#"{{"metadata":{{"scope_recommendation":false}},"sections":[]}}"#
    )
    .unwrap();
    assert!(!parse_scope_recommendation(f.path()));
}

#[test]
fn test_scope_recommendation_absent() {
    let mut f = tempfile::NamedTempFile::new().unwrap();
    use std::io::Write as _;
    write!(f, r#"{{"metadata":{{}},"sections":[]}}"#).unwrap();
    assert!(!parse_scope_recommendation(f.path()));
}

#[test]
fn test_scope_recommendation_missing_file() {
    assert!(!parse_scope_recommendation(Path::new(
        "/nonexistent/file.json"
    )));
}

#[test]
fn test_scope_recommendation_invalid_json() {
    let mut f = tempfile::NamedTempFile::new().unwrap();
    use std::io::Write as _;
    write!(f, "not valid json at all").unwrap();
    assert!(!parse_scope_recommendation(f.path()));
}

// --- format_user_context tests ---

#[test]
fn test_format_user_context_all_fields() {
    let intake = r#"{"audience":"Data engineers","challenges":"Legacy systems","scope":"ETL pipelines","unique_setup":"Multi-cloud","claude_mistakes":"Assumes AWS"}"#;
    let tags = vec!["analytics".to_string(), "salesforce".to_string()];
    let result = format_user_context(
        Some("my-skill"),
        &tags,
        None,
        Some("Healthcare"),
        Some("Analytics Lead"),
        Some(intake),
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        &[],
    );
    let ctx = result.unwrap();
    assert!(ctx.starts_with("## User Context\n"));
    assert!(ctx.contains("**Name**: my-skill"));
    assert!(ctx.contains("**Tags**: analytics, salesforce"));
    assert!(ctx.contains("**Industry**: Healthcare"));
    assert!(ctx.contains("**Function**: Analytics Lead"));
    assert!(ctx.contains("### Target Audience"));
    assert!(ctx.contains("Data engineers"));
    assert!(ctx.contains("### Key Challenges"));
    assert!(ctx.contains("Legacy systems"));
    assert!(ctx.contains("### Scope"));
    assert!(ctx.contains("ETL pipelines"));
    assert!(ctx.contains("### What Makes This Setup Unique"));
    assert!(ctx.contains("Multi-cloud"));
    assert!(ctx.contains("### What Claude Gets Wrong"));
    assert!(ctx.contains("Assumes AWS"));
}

#[test]
fn test_format_user_context_partial_fields() {
    let result = format_user_context(
        None,
        &[],
        None,
        Some("Fintech"),
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        &[],
    );
    let ctx = result.unwrap();
    assert!(ctx.contains("**Industry**: Fintech"));
    assert!(!ctx.contains("**Function**"));
}

#[test]
fn test_format_user_context_empty_strings_skipped() {
    let result = format_user_context(
        None,
        &[],
        None,
        Some(""),
        Some(""),
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        &[],
    );
    assert!(result.is_none());
}

#[test]
fn test_format_user_context_all_none() {
    let result = format_user_context(
        None,
        &[],
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        &[],
    );
    assert!(result.is_none());
}

#[test]
fn test_format_user_context_invalid_json_ignored() {
    let result = format_user_context(
        None,
        &[],
        None,
        Some("Tech"),
        None,
        Some("not json"),
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        &[],
    );
    let ctx = result.unwrap();
    assert!(ctx.contains("**Industry**: Tech"));
    assert!(!ctx.contains("Target Audience"));
}

#[test]
fn test_format_user_context_partial_intake() {
    let intake = r#"{"audience":"Engineers","scope":"APIs"}"#;
    let result = format_user_context(
        None,
        &[],
        None,
        None,
        None,
        Some(intake),
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        &[],
    );
    let ctx = result.unwrap();
    assert!(ctx.contains("### Target Audience"));
    assert!(ctx.contains("Engineers"));
    assert!(ctx.contains("### Scope"));
    assert!(ctx.contains("APIs"));
    assert!(!ctx.contains("### Key Challenges"));
}

// --- build_prompt user context integration tests ---
// User context fields (industry, intake, behaviour) are now in user-context.md,
// not inlined in the prompt. These tests verify the prompt references the file.

#[test]
fn test_build_prompt_includes_user_context_md_instruction() {
    let ws = std::env::temp_dir().join("ws");
    let skills = std::env::temp_dir().join("skills");
    let prompt = build_prompt(&PromptParams {
        skill_name: "test-skill",
        workspace_path: ws.to_str().unwrap(),
        plugin_slug: DEFAULT_PLUGIN_SLUG,
        skills_path: skills.to_str().unwrap(),
        author_login: None,
        created_at: None,
        step_id: 1,
    });
    assert!(prompt.contains("user-context.md"));
    assert!(prompt.contains("test-skill"));
}

#[test]
fn test_build_prompt_without_user_context() {
    let ws = std::env::temp_dir().join("ws");
    let skills = std::env::temp_dir().join("skills");
    let prompt = build_prompt(&PromptParams {
        skill_name: "test-skill",
        workspace_path: ws.to_str().unwrap(),
        plugin_slug: DEFAULT_PLUGIN_SLUG,
        skills_path: skills.to_str().unwrap(),
        author_login: None,
        created_at: None,
        step_id: 1,
    });
    assert!(prompt.contains("user-context.md"));
    assert!(prompt.contains("test-skill"));
}

// --- VD-801: parse_decisions_guard tests ---

#[test]
fn test_parse_decisions_guard_zero_count_triggers_guard() {
    // decision_count: 0 in decisions.json means no decisions were produced — block step 3
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("decisions.json");
    std::fs::write(&path, r#"{"metadata":{"decision_count":0,"round":1}}"#).unwrap();
    assert!(parse_decisions_guard(&path));
}

#[test]
fn test_parse_decisions_guard_contradictory() {
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("decisions.json");
    std::fs::write(
        &path,
        r#"{"metadata":{"decision_count":3,"contradictory_inputs":true}}"#,
    )
    .unwrap();
    assert!(parse_decisions_guard(&path));
}

#[test]
fn test_parse_decisions_guard_normal() {
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("decisions.json");
    std::fs::write(&path, r#"{"metadata":{"decision_count":5,"round":1}}"#).unwrap();
    assert!(!parse_decisions_guard(&path));
}

#[test]
fn test_parse_decisions_guard_missing_file() {
    let nonexistent_path = std::env::temp_dir().join("nonexistent-vd801-decisions.json");
    assert!(!parse_decisions_guard(&nonexistent_path));
}

#[test]
fn test_parse_decisions_guard_invalid_json() {
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("decisions.json");
    std::fs::write(&path, "not valid json").unwrap();
    assert!(!parse_decisions_guard(&path));
}

#[test]
fn test_parse_decisions_guard_contradictory_inputs_false() {
    // contradictory_inputs: false must NOT block
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("decisions.json");
    std::fs::write(
        &path,
        r#"{"metadata":{"decision_count":3,"contradictory_inputs":false}}"#,
    )
    .unwrap();
    assert!(!parse_decisions_guard(&path));
}

#[test]
fn test_save_clarifications_content_writes_pretty_json() {
    let tmp = tempfile::tempdir().unwrap();
    let workspace_path = tmp.path().join("workspace");
    let workspace_str = workspace_path.to_string_lossy().to_string();
    let payload = valid_clarifications_value().to_string();

    super::evaluation::save_clarifications_content_inner(
        "my-skill",
        &workspace_str,
        payload,
        crate::skill_paths::DEFAULT_PLUGIN_SLUG,
    )
    .unwrap();
    let saved = std::fs::read_to_string(
        workspace_path
            .join(crate::skill_paths::DEFAULT_PLUGIN_SLUG)
            .join("my-skill")
            .join("context")
            .join("clarifications.json"),
    )
    .unwrap();
    assert!(saved.contains("\n  \"metadata\""));
}

#[test]
fn test_save_clarifications_content_rejects_invalid_json() {
    let tmp = tempfile::tempdir().unwrap();
    let workspace_path = tmp.path().join("workspace");
    let workspace_str = workspace_path.to_string_lossy().to_string();

    let err = super::evaluation::save_clarifications_content_inner(
        "my-skill",
        &workspace_str,
        "{not-valid-json}".to_string(),
        crate::skill_paths::DEFAULT_PLUGIN_SLUG,
    )
    .unwrap_err();
    assert!(err.contains("Invalid clarifications JSON"));
}

#[test]
fn test_save_clarifications_content_rejects_invalid_schema() {
    let tmp = tempfile::tempdir().unwrap();
    let workspace_path = tmp.path().join("workspace");
    let workspace_str = workspace_path.to_string_lossy().to_string();
    // priority_questions is a string instead of an array — typed deserialization rejects it
    let invalid = serde_json::json!({
        "version": "1",
        "metadata": {
            "title": "Bad",
            "question_count": 1,
            "section_count": 1,
            "refinement_count": 0,
            "must_answer_count": 0,
            "priority_questions": "Q1"
        },
        "sections": [],
        "notes": []
    });

    let err = super::evaluation::save_clarifications_content_inner(
        "my-skill",
        &workspace_str,
        invalid.to_string(),
        crate::skill_paths::DEFAULT_PLUGIN_SLUG,
    )
    .unwrap_err();
    // Typed deserialization rejects non-array priority_questions
    assert!(
        err.contains("Invalid clarifications JSON"),
        "unexpected error: {err}"
    );
}

// =============================================================================
// CG-R1: format_user_context (workflow/runtime.rs)
// =============================================================================

#[test]
fn test_format_user_context_returns_none_when_all_empty() {
    let result = format_user_context(
        None,
        &[],
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        &[],
    );
    assert!(
        result.is_none(),
        "should return None when no fields are provided"
    );
}

#[test]
fn test_format_user_context_includes_name_and_tags() {
    let tags = vec!["finance".to_string(), "analytics".to_string()];
    let result = format_user_context(
        Some("my-skill"),
        &tags,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        &[],
    );
    let text = result.unwrap();
    assert!(text.contains("## User Context"), "should have heading");
    assert!(text.contains("**Name**: my-skill"), "should include name");
    assert!(
        text.contains("**Tags**: finance, analytics"),
        "should include tags"
    );
}

#[test]
fn test_format_user_context_includes_purpose_label_mapping() {
    let result = format_user_context(
        None,
        &[],
        None,
        None,
        None,
        None,
        None,
        Some("domain"),
        None,
        None,
        None,
        None,
        None,
        &[],
    );
    let text = result.unwrap();
    assert!(
        text.contains("Business process knowledge"),
        "domain purpose should map to label"
    );
}

#[test]
fn test_format_user_context_includes_profile_section() {
    let result = format_user_context(
        None,
        &[],
        None,
        Some("Healthcare"),
        Some("Data Engineer"),
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        &[],
    );
    let text = result.unwrap();
    assert!(
        text.contains("### About You"),
        "should have profile heading"
    );
    assert!(
        text.contains("**Industry**: Healthcare"),
        "should include industry"
    );
    assert!(
        text.contains("**Function**: Data Engineer"),
        "should include function"
    );
}

#[test]
fn test_format_user_context_includes_configuration() {
    let result = format_user_context(
        None,
        &[],
        None,
        None,
        None,
        None,
        None,
        None,
        Some("1.0"),
        Some("claude-sonnet-4-6"),
        Some("/ask"),
        Some(true),
        Some(false),
        &[],
    );
    let text = result.unwrap();
    assert!(
        text.contains("### Configuration"),
        "should have config heading"
    );
    assert!(text.contains("**Version**: 1.0"), "should include version");
    assert!(
        text.contains("**Preferred Model**: claude-sonnet-4-6"),
        "should include model"
    );
    assert!(
        text.contains("**Argument Hint**: /ask"),
        "should include argument hint"
    );
    assert!(
        text.contains("**User Invocable**: true"),
        "should include user_invocable"
    );
    assert!(
        text.contains("**Disable Model Invocation**: false"),
        "should include dmi"
    );
}

#[test]
fn test_format_user_context_skips_inherit_model() {
    let result = format_user_context(
        None,
        &[],
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        Some("inherit"),
        None,
        None,
        None,
        &[],
    );
    // "inherit" model should be filtered out — if nothing else is set, result is None
    assert!(result.is_none(), "inherit model alone should produce None");
}

#[test]
fn test_format_user_context_includes_intake_json_context() {
    let intake = r#"{"context": "We use Snowflake and dbt for data pipelines."}"#;
    let result = format_user_context(
        None,
        &[],
        None,
        None,
        None,
        Some(intake),
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        &[],
    );
    let text = result.unwrap();
    assert!(
        text.contains("### What Claude Needs to Know"),
        "should include intake context heading"
    );
    assert!(
        text.contains("Snowflake and dbt"),
        "should include intake content"
    );
}

#[test]
fn test_write_user_context_file_creates_file() {
    let tmp = tempfile::tempdir().unwrap();
    let workspace_path = tmp.path().to_str().unwrap();
    let skill_name = "test-skill";
    let tags = vec!["tag1".to_string()];

    write_user_context_file(
        workspace_path,
        DEFAULT_PLUGIN_SLUG,
        skill_name,
        &tags,
        None,
        Some("Tech"),
        None,
        None,
        Some("A test skill"),
        Some("domain"),
        None,
        None,
        None,
        None,
        None,
        &[],
    );

    let ctx_path = tmp
        .path()
        .join(DEFAULT_PLUGIN_SLUG)
        .join(skill_name)
        .join("user-context.md");
    assert!(ctx_path.exists(), "user-context.md should be created");
    let content = std::fs::read_to_string(&ctx_path).unwrap();
    assert!(
        content.contains("# User Context"),
        "should contain user context heading"
    );
    assert!(
        content.contains("A test skill"),
        "should contain description"
    );
}
