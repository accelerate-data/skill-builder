use crate::skill_paths::DEFAULT_PLUGIN_SLUG;
use std::path::{Path, PathBuf};

use super::deploy::{
    copy_directory_recursive, invalidate_workspace_cache,
};
use super::evaluation::get_step_output_files;
use super::guards::{
    make_agent_id, workflow_step_runtime_label,
};
use super::output_format::{
    answer_evaluator_output_format, extract_research_json_from_conversation_state,
    materialize_answer_evaluation_output_value, materialize_workflow_step_output_value,
    publish_commit_and_tag_generated_skill,
};
use super::prompt::{
    build_prompt, build_step0_prompt, build_step1_prompt, build_step2_prompt, build_step3_prompt,
    PromptParams,
};
use super::runtime::{
    build_answer_evaluator_sidecar_config, build_workflow_confirm_decisions_sidecar_config,
    build_workflow_detailed_research_sidecar_config, build_workflow_generate_skill_sidecar_config,
    build_workflow_research_sidecar_config,
};
use super::step_config::{
    confirm_decisions_workflow_tools, get_step_config, research_workflow_tools,
    skill_generation_workflow_tools, workflow_output_format_for_step,
};
use super::prompt::format_user_context;

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

/// Build an in-memory `Db` with the named skill seeded under the default
/// plugin so workflow-artifact upserts can resolve `skill_id`.
fn db_with_seeded_skill(name: &str) -> crate::db::Db {
    let conn = crate::db::create_test_db_for_tests();
    conn.execute(
        "INSERT INTO skills (name, skill_source, plugin_id) \
         VALUES (?1, 'skill-builder', (SELECT id FROM plugins WHERE slug = 'skills'))",
        rusqlite::params![name],
    )
    .unwrap();
    crate::db::Db(std::sync::Mutex::new(conn))
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
    assert_eq!(get_step_config(3).unwrap().agent_name, "skill-creator");
}

#[test]
fn test_step_config_canonical_output_files() {
    // VU-1157: steps 0/1/2 no longer materialize a workspace JSON file (the
    // canonical artifact is the DB row), so `output_file` is empty. Step 3
    // still produces `skill/SKILL.md` to skills_path.
    assert_eq!(get_step_config(0).unwrap().output_file, "");
    assert_eq!(get_step_config(1).unwrap().output_file, "");
    assert_eq!(get_step_config(2).unwrap().output_file, "");
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
        vec!["skill-creator"]
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
fn research_prompt_renders_app_owned_openhands_task_context() {
    let prompt = build_step0_prompt(
        "lead-conversion",
        "/tmp/workspace",
        DEFAULT_PLUGIN_SLUG,
        4,
        "",
    );

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
    // VU-1157: workspace-relative file path lines are no longer in the prompt; context is inlined
    assert!(
        !prompt.contains("User context file:"),
        "step 0 prompt must not have 'User context file:' instruction"
    );
    assert!(
        !prompt.contains("Context directory:"),
        "step 0 prompt must not have 'Context directory:' instruction"
    );
    assert!(prompt.contains("Maximum research dimensions before scope warning: 4"));
    assert!(prompt.contains("\"research_output\": {"));
    assert!(prompt.contains("\"sections\": []"));
    assert!(prompt.contains("\"notes\": []"));
    assert!(prompt.contains("\"answer_evaluator_notes\": []"));
    assert!(prompt.contains("Question IDs must be"));
    assert!(prompt.contains("Every question must have 2-4 mutually exclusive concrete choices"));
    assert!(prompt.contains("Do not omit the final Other choice"));
    assert!(prompt.contains("Do not use alternate field names"));
    assert!(prompt.contains("`options`, `label`, `required`, or"));
    assert!(prompt.contains("Question objects must be nested directly"));
    assert!(prompt.contains("top-level `research_output.questions`"));
    assert!(prompt.contains("answer_evaluator_notes` must always be exactly `[]`"));
    assert!(prompt.contains("do not return note strings"));
    assert!(prompt.contains("The initial research pass must not add refinement questions"));
    assert!(prompt.contains("Refinements are created"));
    assert!(prompt.contains("only by the detailed-research workflow"));
    assert!(prompt.contains("All initial research questions must be single-select"));
    assert!(prompt.contains("choose exactly one option"));
    assert!(prompt.contains("select all"));
    assert!(prompt.contains("choose all"));
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
fn research_prompt_includes_user_context_block_when_provided() {
    let user_ctx = "## User Context\n\n### Skill\n**Name**: lead-conversion\n**Author**: octocat";
    let prompt = build_step0_prompt(
        "lead-conversion",
        "/tmp/workspace",
        DEFAULT_PLUGIN_SLUG,
        4,
        user_ctx,
    );
    assert!(
        prompt.contains("## User Context"),
        "step 0 prompt should include injected user context block"
    );
    assert!(prompt.contains("**Name**: lead-conversion"));
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
    let prompt = build_step1_prompt(
        "pipeline-value",
        "/tmp/workspace",
        DEFAULT_PLUGIN_SLUG,
        "",
        "{}",
        "No evaluation verdicts available. Treat all answers as unevaluated.",
    );

    assert!(prompt.contains("You are in Step 1: Detailed Research"));
    assert!(prompt.contains("Goal: repair the clarification set"));
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
    // VU-1157: workspace-relative file path lines are no longer in the prompt; context is inlined
    assert!(
        !prompt.contains("User context file:"),
        "step 1 prompt must not have 'User context file:' instruction"
    );
    assert!(
        !prompt.contains("Answer evaluation file:"),
        "step 1 prompt must not have 'Answer evaluation file:' instruction"
    );
    assert!(
        !prompt.contains("Clarifications file:"),
        "step 1 prompt must not have 'Clarifications file:' instruction"
    );
    assert!(
        !prompt.contains("Context directory:"),
        "step 1 prompt must not have 'Context directory:' instruction"
    );
    // Inline context placeholders are resolved
    assert!(prompt.contains("## Current Clarifications"));
    assert!(prompt.contains("## Answer Evaluation Verdicts"));
    assert!(prompt.contains("No evaluation verdicts available"));
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
}

#[test]
fn answer_evaluator_prompt_renders_clean_break_skill_routing() {
    let prompt = super::prompt::build_evaluator_prompt(
        "sales-analytics",
        "/tmp/workspace",
        DEFAULT_PLUGIN_SLUG,
        "/tmp/skills",
    );

    assert!(prompt.contains("answer-evaluator workflow gate"));
    assert!(prompt.contains("Do not invoke"));
    assert!(prompt.contains("answer-evaluator skill"));
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
    assert_eq!(config.allowed_tools, Some(vec!["file_editor".to_string()]));
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
fn research_json_extraction_repairs_missing_commas_between_array_objects() {
    let state = serde_json::json!({
        "type": "conversation_state",
        "status": "completed",
        "result_text": r#"{
  "status": "research_complete",
  "question_count": 2,
  "research_output": {
    "version": "1",
    "metadata": {},
    "sections": [
      {"id":1,"title":"Inputs","questions":[]}
      {"id":2,"title":"Outputs","questions":[]}
    ],
    "notes": []
  }
}"#
    });

    let parsed = extract_research_json_from_conversation_state(&state).unwrap();

    assert_eq!(parsed["status"], "research_complete");
    assert_eq!(
        parsed["research_output"]["sections"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
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

        let db = db_with_seeded_skill("my-skill");
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
        materialize_workflow_step_output_value(&db, "my-skill", 0, &parsed).unwrap();
        let conn = db.0.lock().unwrap();
        assert!(
            crate::db::workflow_artifacts::read_clarifications(&conn, "my-skill")
                .unwrap()
                .is_some()
        );
    }
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
    let prompt =
        build_step2_prompt("lead-conversion", "/tmp/workspace", DEFAULT_PLUGIN_SLUG, "", "{}");

    assert!(prompt.contains("You are in Step 2: Confirm Decisions"));
    assert!(prompt.contains("Goal: convert clarified user intent"));
    assert!(prompt.contains("Reasoning focus: identify commitments"));
    assert!(prompt.contains("actionable by the skill-writing step"));
    assert!(prompt.contains("We are writing the skill lead-conversion."));
    assert!(prompt.contains("Task kind: workflow.confirm_decisions"));
    assert!(prompt.contains("/tmp/workspace/skills/lead-conversion"));
    // VU-1157: workspace-relative file path lines are no longer in prompt; context is inlined
    assert!(
        !prompt.contains("User context file:"),
        "step 2 prompt must not have 'User context file:' instruction"
    );
    assert!(
        !prompt.contains("Clarifications file:"),
        "step 2 prompt must not have 'Clarifications file:' instruction"
    );
    assert!(
        !prompt.contains("Context directory:"),
        "step 2 prompt must not have 'Context directory:' instruction"
    );
    // Inline context section must be present
    assert!(prompt.contains("## Clarifications Record"));
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
}

#[test]
fn skill_generation_prompt_renders_app_owned_openhands_task_context() {
    let prompt = build_step3_prompt(
        "pipeline-value",
        "/tmp/workspace",
        DEFAULT_PLUGIN_SLUG,
        "/tmp/skills",
        Some("octocat"),
        Some("2026-05-01T12:00:00Z"),
        "",
        "{}",
        "{}",
    );

    assert!(prompt.contains("workflow.skill_generation"));
    assert!(prompt.contains("We are writing the skill named `pipeline-value`."));
    assert!(prompt.contains("Workspace directory: `/tmp/workspace/skills/pipeline-value`"));
    assert!(prompt.contains("Skill output directory: `/tmp/skills/skills/pipeline-value`"));
    assert!(!prompt.contains("evals/evals.json"));
    assert!(!prompt.contains("pending-eval.json"));
    assert!(!prompt.contains("write-evals"));
    assert!(!prompt.contains("eval ideas"));
    assert!(!prompt.contains("suggest-eval-ideas"));
    assert!(!prompt.contains("description optimization"));
    assert!(
        !prompt.contains("Eval definitions file:"),
        "step 3 prompt must not have 'Eval definitions file:' named-path instruction"
    );
    assert!(prompt.contains("Use the `creating-skills` skill"));
    assert!(prompt.contains("synthesize a generation brief"));
    assert!(prompt.contains("Pass this brief to `creating-skills`"));
    // VU-1157: user-context.md file read instruction removed; context inlined
    assert!(
        !prompt.contains("Read these workspace files as source material:"),
        "step 3 prompt must not have 'Read these workspace files' instruction"
    );
    // Inline context sections are present
    assert!(prompt.contains("## Decisions Record"));
    assert!(prompt.contains("## Clarifications Record (supporting detail)"));
    assert!(prompt.contains("Do not reduce the"));
    assert!(prompt.contains("handoff to only the summary brief"));
    assert!(prompt.contains("metadata:"));
    assert!(prompt.contains("  version: \"1.0.0\""));
    assert!(prompt.contains("decisions.json"));
    assert!(prompt.contains("clarifications.json"));
    assert!(prompt.contains("fresh-context verification"));
    assert!(prompt.contains("run exactly one re-verification"));
    assert!(prompt.contains("Do not invoke a separate validator skill"));
    assert!(prompt.contains("Do not invoke a legacy writer agent"));
    assert!(prompt.contains("The app Eval Workbench owns durable prompt cases, assertions, runs, and"));
    assert!(prompt.contains("\"version_bump\": \"1.0.0\""));
    assert!(prompt.contains("synthesize-generation-brief"));
    assert!(prompt.contains("fresh-context-verifier-review"));
    assert!(prompt.contains("`call_trace` must be an array of string values"));
    assert!(prompt.contains("Do not\nreturn objects inside `call_trace`."));
}

#[test]
fn skill_generation_sidecar_config_uses_skill_creator_openhands_contract() {
    let config = build_workflow_generate_skill_sidecar_config(
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
        Some("workflow.skill_generation")
    );
    assert_eq!(config.mode.as_deref(), Some("one-shot"));
    assert_eq!(
        config.allowed_tools,
        Some(skill_generation_workflow_tools())
    );
    assert_eq!(config.max_turns, Some(500));
    assert_eq!(config.skill_name.as_deref(), Some("pipeline-value"));
    assert_eq!(config.step_id, Some(3));
    assert_eq!(config.run_source.as_deref(), Some("workflow"));
    assert_eq!(config.workspace_root_dir, "/tmp/workspace");
    assert_eq!(
        config.workspace_skill_dir,
        "/tmp/workspace/skills/pipeline-value"
    );
    assert_eq!(config.output_format, workflow_output_format_for_step(3));
    assert!(
        config.required_plugins.is_none(),
        "OpenHands one-shot config should rely on workspace .agents layout"
    );
    assert_eq!(config.workflow_session_id.as_deref(), Some("session-1"));
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
fn test_materialize_answer_evaluation_validates_payload() {
    // VU-1157: file write removed; validate-only path. A valid payload returns Ok(()).
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
    materialize_answer_evaluation_output_value(&payload).unwrap();
}

#[test]
fn test_materialize_answer_evaluation_rejects_invalid_payload() {
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

    let err = materialize_answer_evaluation_output_value(&invalid_payload).unwrap_err();
    assert!(err.contains("Invalid answer evaluation output"));
}

#[test]
fn test_materialize_answer_evaluation_defaults_missing_per_question_array() {
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
    materialize_answer_evaluation_output_value(&payload)
        .expect("should accept missing per_question with default");
}

#[test]
fn test_materialize_answer_evaluation_rejects_vague_without_reason() {
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
    let err = materialize_answer_evaluation_output_value(&payload).unwrap_err();
    assert!(err.contains("reason is required for vague verdict"));
}

#[test]
fn test_materialize_step0_writes_research_and_clarifications() {
    let db = db_with_seeded_skill("my-skill");
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

    materialize_workflow_step_output_value(&db, "my-skill", 0, &payload).unwrap();
    let conn = db.0.lock().unwrap();
    let record = crate::db::workflow_artifacts::read_clarifications(&conn, "my-skill")
        .unwrap()
        .expect("clarifications row should exist");
    assert_eq!(record.title, "Test");
    assert_eq!(record.refinement_count, 0);
}

#[test]
fn test_materialize_step0_drops_legacy_research_metadata() {
    let db = db_with_seeded_skill("my-skill");
    // Per VU-1157, fields like priority_questions, duplicates_removed, and
    // consolidated_from are silently dropped. The legacy research_plan block
    // is not part of any known schema and is also tolerated/ignored.
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
                "priority_questions": ["dropped-Q1"],
                "duplicates_removed": 7
            },
            "sections": [],
            "notes": []
        }
    });

    materialize_workflow_step_output_value(&db, "my-skill", 0, &payload).unwrap();
    let conn = db.0.lock().unwrap();
    let record = crate::db::workflow_artifacts::read_clarifications(&conn, "my-skill")
        .unwrap()
        .unwrap();
    // No DB column exists for priority_questions or duplicates_removed,
    // so they are silently dropped at the unpack boundary.
    assert_eq!(record.title, "Test");
}

#[test]
fn test_materialize_step0_empty_metadata_defaults_to_zeros() {
    let db = db_with_seeded_skill("my-skill");
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

    materialize_workflow_step_output_value(&db, "my-skill", 0, &payload)
        .expect("empty metadata should default fields");
}

#[test]
fn test_materialize_step1_writes_clarifications_only() {
    let db = db_with_seeded_skill("my-skill");
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

    materialize_workflow_step_output_value(&db, "my-skill", 1, &payload).unwrap();
    let conn = db.0.lock().unwrap();
    let record = crate::db::workflow_artifacts::read_clarifications(&conn, "my-skill")
        .unwrap()
        .unwrap();
    assert_eq!(record.refinement_count, 1);
    assert_eq!(record.questions.len(), 1);
}

#[test]
fn test_materialize_step1_writes_additive_detailed_research_output() {
    let db = db_with_seeded_skill("my-skill");
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

    materialize_workflow_step_output_value(&db, "my-skill", 1, &output).unwrap();
    let conn = db.0.lock().unwrap();
    let record = crate::db::workflow_artifacts::read_clarifications(&conn, "my-skill")
        .unwrap()
        .unwrap();
    assert_eq!(record.sections.len(), 2);
    assert_eq!(record.sections[0].section_id, 1);
    assert_eq!(record.sections[1].section_id, 2);
    let q3 = record
        .questions
        .iter()
        .find(|q| q.question_id == "Q3")
        .expect("Q3 should be present");
    assert_eq!(q3.refinements.len(), 1);
    assert_eq!(q3.refinements[0].question_id, "R3.1");
    assert!(record.questions.iter().any(|q| q.question_id == "Q4"));
}

#[test]
fn test_materialize_step0_rejects_non_object_payload() {
    let db = db_with_seeded_skill("my-skill");
    let err = materialize_workflow_step_output_value(&db, "my-skill", 0, &serde_json::json!(null))
        .unwrap_err();
    assert!(err.contains("structured_output must be a JSON object"));
}

#[test]
fn test_materialize_step0_rejects_wrong_status() {
    let db = db_with_seeded_skill("my-skill");
    let payload = serde_json::json!({
        "status": "detailed_research_complete",
        "question_count": 1,
        "research_output": valid_clarifications_value()
    });
    let err = materialize_workflow_step_output_value(&db, "my-skill", 0, &payload).unwrap_err();
    assert!(err.contains("structured_output.status must be 'research_complete'"));
}

#[test]
fn test_materialize_step0_rejects_missing_required_fields() {
    let db = db_with_seeded_skill("my-skill");

    let missing_research_output = serde_json::json!({
        "status": "research_complete",
        "question_count": 1
    });
    let err =
        materialize_workflow_step_output_value(&db, "my-skill", 0, &missing_research_output)
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
    let err =
        materialize_workflow_step_output_value(&db, "my-skill", 0, &non_integer_question_count)
            .unwrap_err();
    assert!(err.contains("invalid research step output"));
}

#[test]
fn test_materialize_step0_rejects_missing_research_output() {
    let db = db_with_seeded_skill("my-skill");

    let missing = serde_json::json!({
        "status": "research_complete",
        "question_count": 1
    });
    let err = materialize_workflow_step_output_value(&db, "my-skill", 0, &missing).unwrap_err();
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
        materialize_workflow_step_output_value(&db, "my-skill", 0, &invalid_nested).unwrap_err();
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
    let db = db_with_seeded_skill("my-skill");
    let payload = serde_json::json!({
        "status": "research_complete",
        "refinement_count": 1,
        "section_count": 1,
        "clarifications_json": valid_clarifications_value()
    });
    let err = materialize_workflow_step_output_value(&db, "my-skill", 1, &payload).unwrap_err();
    assert!(err.contains("structured_output.status must be 'detailed_research_complete'"));
}

#[test]
fn test_materialize_step1_rejects_missing_required_fields() {
    let db = db_with_seeded_skill("my-skill");

    // Missing refinement_count → hard fail (required per SKILL.md)
    let missing_refinement_count = serde_json::json!({
        "status": "detailed_research_complete",
        "section_count": 1,
        "clarifications_json": valid_clarifications_value()
    });
    let err =
        materialize_workflow_step_output_value(&db, "my-skill", 1, &missing_refinement_count)
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
    let err =
        materialize_workflow_step_output_value(&db, "my-skill", 1, &non_integer_section_count)
            .unwrap_err();
    assert!(err.contains("invalid detailed research output"));
}

#[test]
fn test_materialize_step1_rejects_missing_clarifications_json() {
    let db = db_with_seeded_skill("my-skill");
    let payload = serde_json::json!({
        "status": "detailed_research_complete",
        "refinement_count": 1,
        "section_count": 1
    });
    let err = materialize_workflow_step_output_value(&db, "my-skill", 1, &payload).unwrap_err();
    assert!(err.contains("invalid detailed research output"));
}

#[test]
fn test_materialize_step1_validation_failure_preserves_existing_db_state() {
    let db = db_with_seeded_skill("my-skill");
    // Seed an initial valid clarifications row so we can verify it is not
    // overwritten when a subsequent invalid payload is rejected.
    let valid = serde_json::json!({
        "status": "detailed_research_complete",
        "refinement_count": 0,
        "section_count": 1,
        "clarifications_json": valid_clarifications_value()
    });
    materialize_workflow_step_output_value(&db, "my-skill", 1, &valid).unwrap();

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
    let err = materialize_workflow_step_output_value(&db, "my-skill", 1, &invalid_payload)
        .unwrap_err();
    assert!(
        err.contains("invalid detailed research output"),
        "unexpected error: {err}"
    );
    // Existing record untouched: refinement_count still 0 from the valid run.
    let conn = db.0.lock().unwrap();
    let record = crate::db::workflow_artifacts::read_clarifications(&conn, "my-skill")
        .unwrap()
        .unwrap();
    assert_eq!(record.refinement_count, 0);
}

#[test]
fn test_materialize_step1_rejects_invalid_answer_evaluator_notes_shape() {
    let db = db_with_seeded_skill("my-skill");
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

    let err = materialize_workflow_step_output_value(&db, "my-skill", 1, &payload).unwrap_err();
    // Typed deserialization rejects non-array answer_evaluator_notes
    assert!(
        err.contains("invalid detailed research output"),
        "unexpected error: {err}"
    );
}

#[test]
fn test_materialize_step0_scope_recommendation_persists_to_db() {
    let db = db_with_seeded_skill("my-skill");
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

    materialize_workflow_step_output_value(&db, "my-skill", 0, &payload).unwrap();
    let conn = db.0.lock().unwrap();
    let record = crate::db::workflow_artifacts::read_clarifications(&conn, "my-skill")
        .unwrap()
        .unwrap();
    assert_eq!(record.scope_recommendation, Some(true));
}

#[test]
fn test_materialize_step2_writes_decisions() {
    let db = db_with_seeded_skill("my-skill");
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
    materialize_workflow_step_output_value(&db, "my-skill", 2, &payload).unwrap();
    let conn = db.0.lock().unwrap();
    let record = crate::db::workflow_artifacts::read_decisions(&conn, "my-skill")
        .unwrap()
        .unwrap();
    assert_eq!(record.items.len(), 1);
    assert_eq!(record.items[0].decision_id, "D1");
    assert_eq!(record.items[0].status, "resolved");
}

#[test]
fn test_materialize_step2_writes_scope_guard_stub_decisions() {
    let db = db_with_seeded_skill("my-skill");
    let payload = serde_json::json!({
        "version": "1",
        "metadata": { "scope_recommendation": true, "decision_count": 0, "conflicts_resolved": 0, "round": 1 },
        "decisions": []
    });
    materialize_workflow_step_output_value(&db, "my-skill", 2, &payload).unwrap();
    let conn = db.0.lock().unwrap();
    let record = crate::db::workflow_artifacts::read_decisions(&conn, "my-skill")
        .unwrap()
        .unwrap();
    assert_eq!(record.scope_recommendation, Some(true));
    assert_eq!(record.decision_count, 0);
}

#[test]
fn test_materialize_step2_contradictory_inputs_active_persists_state() {
    let db = db_with_seeded_skill("my-skill");
    let payload = serde_json::json!({
        "version": "1",
        "metadata": { "decision_count": 2, "conflicts_resolved": 0, "round": 1, "contradictory_inputs": true },
        "decisions": []
    });
    materialize_workflow_step_output_value(&db, "my-skill", 2, &payload).unwrap();
    let conn = db.0.lock().unwrap();
    let record = crate::db::workflow_artifacts::read_decisions(&conn, "my-skill")
        .unwrap()
        .unwrap();
    assert_eq!(record.contradictory_inputs_state.as_deref(), Some("active"));
}

#[test]
fn test_materialize_step2_contradictory_inputs_false_persists_inactive() {
    let db = db_with_seeded_skill("my-skill");
    let payload = serde_json::json!({
        "version": "1",
        "metadata": { "decision_count": 2, "conflicts_resolved": 0, "round": 1, "contradictory_inputs": false },
        "decisions": []
    });
    materialize_workflow_step_output_value(&db, "my-skill", 2, &payload).unwrap();
    let conn = db.0.lock().unwrap();
    let record = crate::db::workflow_artifacts::read_decisions(&conn, "my-skill")
        .unwrap()
        .unwrap();
    assert_eq!(record.contradictory_inputs_state.as_deref(), Some("inactive"));
}

#[test]
fn test_materialize_step2_rejects_null_payload() {
    let db = db_with_seeded_skill("my-skill");
    let err = materialize_workflow_step_output_value(&db, "my-skill", 2, &serde_json::json!(null))
        .unwrap_err();
    assert!(err.contains("structured_output must be a JSON object"));
}

#[test]
fn test_materialize_step3_generate_validates_payload() {
    // VU-1157: benchmark-meta.json writer was removed entirely. Step 3 only
    // validates the agent's GenerateSkillOutput shape; no DB persistence.
    let db = db_with_seeded_skill("my-skill");
    let payload = serde_json::json!({
        "status": "generated",
        "benchmark_path": null,
        "skipped": false,
        "commit_summary": "Create skill package with SKILL.md and references",
        "version_bump": "1.0.0",
        "call_trace": [
            "read-user-context",
            "read-decisions",
            "read-clarifications",
            "synthesize-generation-brief",
            "use-creating-skills",
            "write-skill",
            "write-references",
            "fresh-context-verifier-review"
        ]
    });
    materialize_workflow_step_output_value(&db, "my-skill", 3, &payload).unwrap();
}

#[test]
fn test_materialize_step3_generate_skipped_validates_payload() {
    let db = db_with_seeded_skill("my-skill");
    let payload = serde_json::json!({
        "status": "generated",
        "benchmark_path": null,
        "skipped": true,
        "commit_summary": "Skipped because verifier found unresolved material findings",
        "version_bump": "1.0.0",
        "call_trace": [
            "read-user-context",
            "read-decisions",
            "read-clarifications",
            "synthesize-generation-brief",
            "use-creating-skills",
            "write-skill",
            "fresh-context-verifier-review"
        ]
    });
    materialize_workflow_step_output_value(&db, "my-skill", 3, &payload).unwrap();
}

#[test]
fn test_materialize_step3_generate_rejects_missing_version_bump() {
    let db = db_with_seeded_skill("my-skill");
    let payload = serde_json::json!({
        "status": "generated",
        "commit_summary": "Create skill package with required files",
        "call_trace": ["read-user-context", "write-skill"]
    });
    let err = materialize_workflow_step_output_value(&db, "my-skill", 3, &payload).unwrap_err();
    assert!(err.contains("version_bump must be '1.0.0'"));
}

#[test]
fn test_materialize_step3_generate_rejects_minor_version_bump() {
    let db = db_with_seeded_skill("my-skill");
    let payload = serde_json::json!({
        "status": "generated",
        "commit_summary": "Create skill package with required files",
        "version_bump": "minor",
        "call_trace": [
            "read-user-context",
            "read-decisions",
            "read-clarifications",
            "synthesize-generation-brief",
            "use-creating-skills",
            "write-skill",
            "fresh-context-verifier-review"
        ]
    });
    let err = materialize_workflow_step_output_value(&db, "my-skill", 3, &payload).unwrap_err();
    assert!(err.contains("version_bump must be '1.0.0'"));
}

#[test]
fn test_materialize_step3_generate_rejects_missing_call_trace() {
    let db = db_with_seeded_skill("my-skill");
    let payload = serde_json::json!({
        "status": "generated",
        "commit_summary": "Create skill package with required files",
        "version_bump": "1.0.0"
    });
    let err = materialize_workflow_step_output_value(&db, "my-skill", 3, &payload).unwrap_err();
    assert!(err.contains("call_trace must be a non-empty string array"));
}

#[test]
fn test_materialize_step3_generate_rejects_object_call_trace_entries() {
    let db = db_with_seeded_skill("my-skill");
    let payload = serde_json::json!({
        "status": "generated",
        "commit_summary": "Create skill package with required files",
        "version_bump": "1.0.0",
        "call_trace": [{"step": "read-user-context"}]
    });
    let err = materialize_workflow_step_output_value(&db, "my-skill", 3, &payload).unwrap_err();
    assert!(err.contains("invalid generate-skill output"));
}

#[test]
fn test_materialize_step3_generate_rejects_missing_required_trace_entry() {
    let payload = serde_json::json!({
        "status": "generated",
        "commit_summary": "Create skill package with required files",
        "version_bump": "1.0.0",
        "call_trace": [
            "read-user-context",
            "read-decisions",
            "synthesize-generation-brief",
            "use-creating-skills",
            "write-skill",
            "fresh-context-verifier-review"
        ]
    });
    let db = db_with_seeded_skill("my-skill");
    let err = materialize_workflow_step_output_value(&db, "my-skill", 3, &payload).unwrap_err();
    assert!(err.contains("call_trace missing required entry 'read-clarifications'"));
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
fn publish_commit_and_tag_generated_skill_rejects_legacy_top_level_version() {
    let workspace = tempfile::tempdir().unwrap();
    let skills = tempfile::tempdir().unwrap();
    let workspace_skill_root = workspace.path().join("skills").join("tagged-skill");
    let generated_dir = workspace_skill_root.join("skill");
    std::fs::create_dir_all(&generated_dir).unwrap();
    std::fs::write(
        generated_dir.join("SKILL.md"),
        "---\nname: tagged-skill\nversion: 1.0.0\n---\n# Tagged Skill\n",
    )
    .unwrap();

    let err = publish_commit_and_tag_generated_skill(
        &workspace_skill_root,
        skills.path(),
        "skills",
        "tagged-skill",
    )
    .unwrap_err();

    assert!(
        err.contains("missing metadata.version"),
        "unexpected error: {err}"
    );
}

#[test]
fn publish_commit_and_tag_generated_skill_rejects_non_initial_metadata_version() {
    let workspace = tempfile::tempdir().unwrap();
    let skills = tempfile::tempdir().unwrap();
    let workspace_skill_root = workspace.path().join("skills").join("tagged-skill");
    let generated_dir = workspace_skill_root.join("skill");
    std::fs::create_dir_all(&generated_dir).unwrap();
    std::fs::write(
        generated_dir.join("SKILL.md"),
        "---\nname: tagged-skill\nmetadata:\n  version: 2.0.0\n---\n# Tagged Skill\n",
    )
    .unwrap();

    let err = publish_commit_and_tag_generated_skill(
        &workspace_skill_root,
        skills.path(),
        "skills",
        "tagged-skill",
    )
    .unwrap_err();

    assert!(
        err.contains("must use metadata.version 1.0.0"),
        "unexpected error: {err}"
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
fn test_materialize_step3_benchmark_complete_validates() {
    // VU-1157: benchmark-meta.json writer was removed; the partial→complete
    // upgrade logic that probed for benchmark.json on disk no longer exists
    // (eval/benchmark redo). The validate-only path accepts any of the
    // benchmark-skill statuses.
    let db = db_with_seeded_skill("my-skill");
    let payload = serde_json::json!({
        "status": "complete",
        "benchmark_path": "evals/iterations/iteration-1"
    });
    materialize_workflow_step_output_value(&db, "my-skill", 3, &payload).unwrap();
}

#[test]
fn test_materialize_step3_partial_validates() {
    let db = db_with_seeded_skill("my-skill");
    let payload = serde_json::json!({
        "status": "partial",
        "benchmark_path": "evals/iterations/iteration-1"
    });
    materialize_workflow_step_output_value(&db, "my-skill", 3, &payload).unwrap();
}

#[test]
fn test_materialize_step3_skipped_validates() {
    let db = db_with_seeded_skill("my-skill");
    let payload = serde_json::json!({
        "status": "skipped",
        "benchmark_path": null
    });
    materialize_workflow_step_output_value(&db, "my-skill", 3, &payload).unwrap();
}

#[test]
fn test_materialize_step3_rejects_wrong_status() {
    let db = db_with_seeded_skill("my-skill");
    let payload = serde_json::json!({
        "status": "decisions_complete"
    });
    let err = materialize_workflow_step_output_value(&db, "my-skill", 3, &payload).unwrap_err();
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
        "",
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
    // Steps 0-2 are DB-authoritative with no filesystem outputs.
    // Deleting from step 2 onwards should clean only step 3 (SKILL.md).
    let workspace_tmp = tempfile::tempdir().unwrap();
    let skills_tmp = tempfile::tempdir().unwrap();
    let workspace = workspace_tmp.path().to_str().unwrap();
    let skills_path = skills_tmp.path().to_str().unwrap();
    let skill_dir = skills_tmp.path().join(DEFAULT_PLUGIN_SLUG).join("my-skill");
    std::fs::create_dir_all(skill_dir.join("references")).unwrap();

    // Create step 3 output (SKILL.md)
    std::fs::write(skill_dir.join("SKILL.md"), "step3").unwrap();
    std::fs::write(skill_dir.join("references/ref.md"), "ref").unwrap();

    // Reset from step 2 onwards
    crate::cleanup::delete_step_output_files(
        workspace,
        "my-skill",
        DEFAULT_PLUGIN_SLUG,
        2,
        skills_path,
    );

    // Step 3 outputs should be deleted
    assert!(!skill_dir.join("SKILL.md").exists());
    assert!(!skill_dir.join("references").exists());
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
    // Steps 0-2 are DB-authoritative with no filesystem outputs.
    // Deleting from step 2 onwards should clean step 3 (SKILL.md) in skills_path.
    let workspace_tmp = tempfile::tempdir().unwrap();
    let skills_tmp = tempfile::tempdir().unwrap();
    let workspace = workspace_tmp.path().to_str().unwrap();
    let skills_path = skills_tmp.path().to_str().unwrap();
    let skill_dir = skills_tmp.path().join(DEFAULT_PLUGIN_SLUG).join("my-skill");
    std::fs::create_dir_all(&skill_dir).unwrap();

    // Create SKILL.md in skills_path (step 3 output)
    std::fs::write(skill_dir.join("SKILL.md"), "# Skill").unwrap();

    // Reset from step 2 onwards should clean up SKILL.md
    crate::cleanup::delete_step_output_files(
        workspace,
        "my-skill",
        DEFAULT_PLUGIN_SLUG,
        2,
        skills_path,
    );

    // SKILL.md should be deleted
    assert!(!skill_dir.join("SKILL.md").exists());
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
fn test_ensure_workspace_prompts_inner_deploys_workflow_agents_to_openhands_layout() {
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
    std::fs::create_dir_all(workspace_skills_src.path().join("creating-skills")).unwrap();
    std::fs::write(
        workspace_skills_src
            .path()
            .join("creating-skills")
            .join("SKILL.md"),
        "# Creating Skills",
    )
    .unwrap();

    let workspace_str = workspace.path().to_str().unwrap();
    super::deploy::invalidate_workspace_cache(workspace_str);
    super::deploy::ensure_workspace_prompts_inner(
        workspace_agents_src.path(),
        workspace_skills_src.path(),
        workspace_str,
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
    assert!(!workspace_skill_dir
        .join(".agents/skills/answer-evaluator/SKILL.md")
        .exists());
    assert!(workspace_skill_dir
        .join(".agents/skills/creating-skills/SKILL.md")
        .is_file());
    assert!(workspace
        .path()
        .join(".agents/agents/skill-creator.md")
        .is_file());
    assert!(workspace
        .path()
        .join(".agents/skills/researching-skill-requirements/SKILL.md")
        .is_file());
    assert!(!workspace
        .path()
        .join(".agents/skills/answer-evaluator/SKILL.md")
        .exists());
    assert!(workspace
        .path()
        .join(".agents/skills/creating-skills/SKILL.md")
        .is_file());
    assert!(!workspace_skill_dir.join("CLAUDE.md").exists());
    assert!(!workspace.path().join("CLAUDE.md").exists());
    super::deploy::invalidate_workspace_cache(workspace_str);
}

// --- debug mode: no reduced turns, sonnet model override ---

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
fn test_reset_cleans_workspace_context_files() {
    // Steps 0-2 are DB-authoritative. Resetting from step 0 removes gate and
    // evaluation files (step 0 filesystem outputs) and SKILL.md (step 3).
    let workspace_tmp = tempfile::tempdir().unwrap();
    let skills_path_tmp = tempfile::tempdir().unwrap();
    let workspace = workspace_tmp.path().to_str().unwrap();
    let skills_path = skills_path_tmp.path().to_str().unwrap();

    // Step 0 workflow-level files
    let skill_dir = workspace_tmp
        .path()
        .join(DEFAULT_PLUGIN_SLUG)
        .join("my-skill");
    std::fs::create_dir_all(&skill_dir).unwrap();
    std::fs::write(skill_dir.join("gate-result.json"), "{}").unwrap();
    std::fs::write(skill_dir.join("answer-evaluation.json"), "{}").unwrap();

    // Step 3 output
    let output_dir = skills_path_tmp
        .path()
        .join(DEFAULT_PLUGIN_SLUG)
        .join("my-skill");
    std::fs::create_dir_all(&output_dir).unwrap();
    std::fs::write(output_dir.join("SKILL.md"), "# Skill").unwrap();

    // Call delete_step_output_files from step 0
    crate::cleanup::delete_step_output_files(
        workspace,
        "my-skill",
        DEFAULT_PLUGIN_SLUG,
        0,
        skills_path,
    );

    // Gate/eval files and SKILL.md should be gone
    assert!(!skill_dir.join("gate-result.json").exists());
    assert!(!skill_dir.join("answer-evaluation.json").exists());
    assert!(!output_dir.join("SKILL.md").exists());
}

// VD-664: parse_scope_recommendation was file-based; replaced by
// check_scope_recommendation_db in guards.rs (VU-1157). Tests live in guards.rs.

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

// VD-801: parse_decisions_guard was file-based; replaced by
// check_decisions_guard_db in guards.rs (VU-1157). Tests live in guards.rs.

// save_clarifications_content_inner was file-based and removed in VU-1157.
// Clarifications persistence is now handled via upsert_clarifications in db/workflow_artifacts.rs.

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

// VU-1157: write_user_context_file deleted; the formatter is exercised by
// the format_user_context tests above.

// ---------------------------------------------------------------------------
// Materialization round-trip tests (VU-1157 Task 10)
// ---------------------------------------------------------------------------

mod materialization {
    use super::*;
    use crate::commands::workflow::guards;

    fn clarifications_fixture() -> serde_json::Value {
        serde_json::json!({
            "version": "1",
            "metadata": {
                "title": "Lead Conversion Skill",
                "question_count": 4,
                "section_count": 2,
                "refinement_count": 0,
                "must_answer_count": 2,
                "priority_questions": []
            },
            "sections": [
                {
                    "id": 1,
                    "title": "Intent and Trigger",
                    "questions": [
                        {
                            "id": "Q1",
                            "title": "Primary use case",
                            "text": "What is the primary use case for this skill?",
                            "must_answer": true,
                            "recommendation": "A",
                            "choices": [
                                {"id": "A", "text": "Lead scoring and routing", "is_other": false},
                                {"id": "B", "text": "Pipeline forecasting", "is_other": false},
                                {"id": "C", "text": "Other", "is_other": true}
                            ],
                            "refinements": []
                        },
                        {
                            "id": "Q2",
                            "title": "Trigger conditions",
                            "text": "When should this skill activate?",
                            "must_answer": true,
                            "choices": [
                                {"id": "A", "text": "On inbound lead arrival", "is_other": false},
                                {"id": "B", "text": "On CRM status change", "is_other": false},
                                {"id": "C", "text": "Other", "is_other": true}
                            ],
                            "refinements": []
                        }
                    ]
                },
                {
                    "id": 2,
                    "title": "Output Format",
                    "questions": [
                        {
                            "id": "Q3",
                            "title": "Output format",
                            "text": "What output format is expected?",
                            "must_answer": false,
                            "choices": [
                                {"id": "A", "text": "Structured JSON", "is_other": false},
                                {"id": "B", "text": "Free text summary", "is_other": false},
                                {"id": "C", "text": "Other", "is_other": true}
                            ],
                            "refinements": []
                        },
                        {
                            "id": "Q4",
                            "title": "Target audience",
                            "text": "Who consumes this skill output?",
                            "must_answer": false,
                            "choices": [
                                {"id": "A", "text": "Sales reps", "is_other": false},
                                {"id": "B", "text": "Marketing ops", "is_other": false},
                                {"id": "C", "text": "Other", "is_other": true}
                            ],
                            "refinements": []
                        }
                    ]
                }
            ],
            "notes": []
        })
    }

    #[test]
    fn step0_full_roundtrip() {
        let db = db_with_seeded_skill("rt-step0");
        let json = serde_json::json!({
            "status": "research_complete",
            "question_count": 4,
            "research_output": clarifications_fixture()
        });

        materialize_workflow_step_output_value(&db, "rt-step0", 0, &json).unwrap();

        let conn = db.0.lock().unwrap();
        let record = crate::db::workflow_artifacts::read_clarifications(&conn, "rt-step0")
            .unwrap()
            .unwrap();
        assert_eq!(record.refinement_count, 0);
        assert_eq!(record.sections[0].title, "Intent and Trigger");
        let ids: Vec<&str> = record.questions.iter().map(|q| q.question_id.as_str()).collect();
        assert!(ids.contains(&"Q1"));
        assert!(ids.contains(&"Q2"));
        assert!(ids.contains(&"Q3"));
        assert!(ids.contains(&"Q4"));
    }

    #[test]
    fn step1_with_refinement_count() {
        let db = db_with_seeded_skill("rt-step1");
        let json = serde_json::json!({
            "status": "detailed_research_complete",
            "refinement_count": 2,
            "section_count": 2,
            "clarifications_json": clarifications_fixture()
        });

        materialize_workflow_step_output_value(&db, "rt-step1", 1, &json).unwrap();

        let conn = db.0.lock().unwrap();
        let record = crate::db::workflow_artifacts::read_clarifications(&conn, "rt-step1")
            .unwrap()
            .unwrap();
        assert_eq!(record.refinement_count, 2);
    }

    #[test]
    fn step0_then_step1_overwrites() {
        let db = db_with_seeded_skill("rt-overwrite");

        let step0 = serde_json::json!({
            "status": "research_complete",
            "question_count": 4,
            "research_output": clarifications_fixture()
        });
        materialize_workflow_step_output_value(&db, "rt-overwrite", 0, &step0).unwrap();

        let step1 = serde_json::json!({
            "status": "detailed_research_complete",
            "refinement_count": 3,
            "section_count": 2,
            "clarifications_json": clarifications_fixture()
        });
        materialize_workflow_step_output_value(&db, "rt-overwrite", 1, &step1).unwrap();

        let conn = db.0.lock().unwrap();
        let record = crate::db::workflow_artifacts::read_clarifications(&conn, "rt-overwrite")
            .unwrap()
            .unwrap();
        assert_eq!(record.refinement_count, 3);
    }

    #[test]
    fn step2_full_roundtrip() {
        let db = db_with_seeded_skill("rt-step2");
        let json = serde_json::json!({
            "version": "1",
            "metadata": {
                "decision_count": 3,
                "conflicts_resolved": 1,
                "round": 1
            },
            "decisions": [
                {
                    "id": "D1",
                    "title": "Primary integration method",
                    "original_question": "How should the skill integrate with the CRM?",
                    "decision": "Use REST API with OAuth",
                    "implication": "Requires OAuth credentials in config",
                    "status": "resolved"
                },
                {
                    "id": "D2",
                    "title": "Output format",
                    "original_question": "What format should responses use?",
                    "decision": "Return structured JSON",
                    "implication": "Consumers must parse JSON",
                    "status": "needs-review"
                },
                {
                    "id": "D3",
                    "title": "Fallback behavior",
                    "original_question": "What happens on API failure?",
                    "decision": "Return cached result if available",
                    "implication": "Cache TTL must be configured",
                    "status": "resolved"
                }
            ]
        });

        materialize_workflow_step_output_value(&db, "rt-step2", 2, &json).unwrap();

        let conn = db.0.lock().unwrap();
        let record = crate::db::workflow_artifacts::read_decisions(&conn, "rt-step2")
            .unwrap()
            .unwrap();
        assert_eq!(record.version, "1");
        assert!(record.items.iter().any(|i| i.status == "needs-review"));
        let resolved = record.items.iter().find(|i| i.decision_id == "D1").unwrap();
        assert_eq!(resolved.title, "Primary integration method");
    }

    #[test]
    fn step2_contradictory_inputs_active_true() {
        let db = db_with_seeded_skill("rt-ci-true");
        let json = serde_json::json!({
            "version": "1",
            "metadata": {
                "decision_count": 1,
                "conflicts_resolved": 0,
                "round": 1,
                "contradictory_inputs": true
            },
            "decisions": [{
                "id": "D1",
                "title": "Approach",
                "original_question": "Which approach?",
                "decision": "Use A",
                "implication": "Requires A",
                "status": "resolved"
            }]
        });

        materialize_workflow_step_output_value(&db, "rt-ci-true", 2, &json).unwrap();

        let conn = db.0.lock().unwrap();
        let record = crate::db::workflow_artifacts::read_decisions(&conn, "rt-ci-true")
            .unwrap()
            .unwrap();
        assert_eq!(record.contradictory_inputs_state.as_deref(), Some("active"));
    }

    #[test]
    fn step2_contradictory_inputs_active_false() {
        let db = db_with_seeded_skill("rt-ci-false");
        let json = serde_json::json!({
            "version": "1",
            "metadata": {
                "decision_count": 1,
                "conflicts_resolved": 0,
                "round": 1,
                "contradictory_inputs": false
            },
            "decisions": [{
                "id": "D1",
                "title": "Approach",
                "original_question": "Which approach?",
                "decision": "Use B",
                "implication": "Requires B",
                "status": "resolved"
            }]
        });

        materialize_workflow_step_output_value(&db, "rt-ci-false", 2, &json).unwrap();

        let conn = db.0.lock().unwrap();
        let record = crate::db::workflow_artifacts::read_decisions(&conn, "rt-ci-false")
            .unwrap()
            .unwrap();
        assert_eq!(record.contradictory_inputs_state.as_deref(), Some("inactive"));
    }

    #[test]
    fn step2_contradictory_inputs_revised_string() {
        // The agent emits "revised" as the Revised string variant. The DB
        // validator accepts only "inactive", "active", or "revised" — a free-form
        // sentence would be rejected by validate_contradictory_inputs_state.
        let db = db_with_seeded_skill("rt-ci-revised");
        let json = serde_json::json!({
            "version": "1",
            "metadata": {
                "decision_count": 1,
                "conflicts_resolved": 1,
                "round": 2,
                "contradictory_inputs": "revised"
            },
            "decisions": [{
                "id": "D1",
                "title": "Approach",
                "original_question": "Which approach?",
                "decision": "Use approach X",
                "implication": "Team aligned on X",
                "status": "conflict-resolved"
            }]
        });

        materialize_workflow_step_output_value(&db, "rt-ci-revised", 2, &json).unwrap();

        let conn = db.0.lock().unwrap();
        let record = crate::db::workflow_artifacts::read_decisions(&conn, "rt-ci-revised")
            .unwrap()
            .unwrap();
        assert_eq!(
            record.contradictory_inputs_state.as_deref(),
            Some("revised")
        );
    }

    #[test]
    fn scope_recommendation_guard_reads_db() {
        let db = db_with_seeded_skill("rt-scope-guard");
        // scope_recommendation is Option<bool>; true = scope guard should fire
        let json = serde_json::json!({
            "status": "research_complete",
            "question_count": 4,
            "research_output": {
                "version": "1",
                "metadata": {
                    "title": "Scope Test",
                    "question_count": 4,
                    "section_count": 2,
                    "refinement_count": 0,
                    "must_answer_count": 2,
                    "priority_questions": [],
                    "scope_recommendation": true
                },
                "sections": [],
                "notes": []
            }
        });

        materialize_workflow_step_output_value(&db, "rt-scope-guard", 0, &json).unwrap();

        let conn = db.0.lock().unwrap();
        assert!(guards::check_scope_recommendation_db(&conn, "rt-scope-guard"));
    }

    #[test]
    fn decisions_needs_review_guard_reads_db() {
        let db = db_with_seeded_skill("rt-dec-guard");
        let json = serde_json::json!({
            "version": "1",
            "metadata": {
                "decision_count": 2,
                "conflicts_resolved": 0,
                "round": 1
            },
            "decisions": [
                {
                    "id": "D1",
                    "title": "Contested direction",
                    "original_question": "Should we use REST or GraphQL?",
                    "decision": "Unclear — both options raised",
                    "implication": "Must resolve before implementation",
                    "status": "needs-review"
                },
                {
                    "id": "D2",
                    "title": "Auth method",
                    "original_question": "Which auth method?",
                    "decision": "OAuth 2.0",
                    "implication": "Requires token rotation setup",
                    "status": "resolved"
                }
            ]
        });

        materialize_workflow_step_output_value(&db, "rt-dec-guard", 2, &json).unwrap();

        let conn = db.0.lock().unwrap();
        assert!(guards::check_decisions_guard_db(&conn, "rt-dec-guard"));
    }

    #[test]
    fn step3_guard_fails_when_no_decisions_in_db() {
        // Verifies that the step-3 DB guard correctly detects missing decisions.
        // The guard in read_workflow_settings queries DB for decisions before
        // allowing step 3 to proceed.
        let db = db_with_seeded_skill("guard-test-skill");
        let conn = db.0.lock().unwrap();
        // No decisions seeded — read_decisions should return None
        let decisions = crate::db::workflow_artifacts::read_decisions(&conn, "guard-test-skill").unwrap();
        assert!(
            decisions.is_none(),
            "guard-test-skill has no decisions — step 3 guard should block"
        );
    }

    #[test]
    fn dropped_fields_not_stored() {
        let db = db_with_seeded_skill("rt-dropped");
        let json = serde_json::json!({
            "status": "research_complete",
            "question_count": 4,
            "research_output": {
                "version": "1",
                "metadata": {
                    "title": "Dropped Fields Test",
                    "question_count": 4,
                    "section_count": 2,
                    "refinement_count": 0,
                    "must_answer_count": 2,
                    "priority_questions": ["Q1", "Q4"],
                    "duplicates_removed": 2
                },
                "sections": [
                    {
                        "id": 1,
                        "title": "Section One",
                        "questions": [
                            {
                                "id": "Q1",
                                "title": "First question",
                                "text": "What is the primary intent?",
                                "must_answer": true,
                                "recommendation": "A",
                                "choices": [
                                    {"id": "A", "text": "Intent A", "is_other": false},
                                    {"id": "B", "text": "Other", "is_other": true}
                                ],
                                "refinements": []
                            },
                            {
                                "id": "Q2",
                                "title": "Second question",
                                "text": "What is the trigger?",
                                "must_answer": true,
                                "choices": [
                                    {"id": "A", "text": "On event", "is_other": false},
                                    {"id": "B", "text": "Other", "is_other": true}
                                ],
                                "refinements": []
                            }
                        ]
                    },
                    {
                        "id": 2,
                        "title": "Section Two",
                        "questions": [
                            {
                                "id": "Q3",
                                "title": "Third question",
                                "text": "What output format?",
                                "must_answer": false,
                                "choices": [
                                    {"id": "A", "text": "JSON", "is_other": false},
                                    {"id": "B", "text": "Other", "is_other": true}
                                ],
                                "refinements": []
                            },
                            {
                                "id": "Q4",
                                "title": "Fourth question",
                                "text": "Who is the audience?",
                                "must_answer": false,
                                "choices": [
                                    {"id": "A", "text": "Engineers", "is_other": false},
                                    {"id": "B", "text": "Other", "is_other": true}
                                ],
                                "refinements": []
                            }
                        ]
                    }
                ],
                "notes": []
            }
        });

        materialize_workflow_step_output_value(&db, "rt-dropped", 0, &json).unwrap();

        let conn = db.0.lock().unwrap();
        let record = crate::db::workflow_artifacts::read_clarifications(&conn, "rt-dropped")
            .unwrap()
            .unwrap();
        // priority_questions listed only Q1 and Q4 — all four must be stored to confirm
        // the field was ignored rather than used as a filter.
        assert_eq!(record.question_count, 4);
        let ids: Vec<&str> = record.questions.iter().map(|q| q.question_id.as_str()).collect();
        assert!(ids.contains(&"Q2"), "Q2 not in priority_questions but must still be stored");
        assert!(ids.contains(&"Q3"), "Q3 not in priority_questions but must still be stored");
        // duplicates_removed == 2, but section_count must reflect the fixture (2), not the
        // noise value.
        assert_eq!(record.sections.len(), 2);
        assert_eq!(record.refinement_count, 0);
    }
}
