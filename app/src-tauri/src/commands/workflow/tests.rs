use crate::agents::skill_creator::{
    build_skill_creator_config, SkillCreatorIntent, SkillCreatorRuntimeContext, WorkflowStepKind,
};
use crate::skill_paths::DEFAULT_PLUGIN_SLUG;
use std::path::Path;

use super::deploy::copy_directory_recursive;
use super::evaluation::get_step_output_files;
use super::guards::{make_agent_id, workflow_step_runtime_label};
use super::output_format::{
    answer_evaluator_output_format, extract_research_json_from_conversation_state,
    extract_workflow_json_from_conversation_state, materialize_answer_evaluation_output_value,
    materialize_workflow_step_output_value, publish_commit_and_tag_generated_skill,
};
use super::prompt::format_user_context;
use super::prompt::{
    build_step0_prompt, build_step1_prompt, build_step2_prompt, build_step3_prompt,
};
use super::runtime::{
    dispatch_persistent_skill_turn_with_runtime,
};
use super::step_config::{
    confirm_decisions_workflow_tools, get_step_config, research_workflow_tools,
    workflow_output_format_for_step,
};
use std::sync::{Arc, Mutex};

fn test_workflow_step_config(
    app_data_root: &str,
    skill_name: &str,
    prompt: &str,
    skills_root: &str,
    plugin_slug: &str,
    llm: crate::types::WorkflowLlmConfig,
    step: WorkflowStepKind,
) -> crate::agents::runtime_config::OpenHandsRuntimeConfig {
    build_skill_creator_config(SkillCreatorRuntimeContext {
        app_data_root: app_data_root.to_string(),
        skills_root: skills_root.to_string(),
        skill_name: skill_name.to_string(),
        plugin_slug: plugin_slug.to_string(),
        prompt: prompt.to_string(),
        llm,
        intent: SkillCreatorIntent::WorkflowStep { step },
        skill_dir_override: None,
    })
}

fn test_answer_evaluator_config(
    app_data_root: &str,
    skill_name: &str,
    prompt: &str,
    skills_root: &str,
    plugin_slug: &str,
    llm: crate::types::WorkflowLlmConfig,
) -> crate::agents::runtime_config::OpenHandsRuntimeConfig {
    build_skill_creator_config(SkillCreatorRuntimeContext {
        app_data_root: app_data_root.to_string(),
        skills_root: skills_root.to_string(),
        skill_name: skill_name.to_string(),
        plugin_slug: plugin_slug.to_string(),
        prompt: prompt.to_string(),
        llm,
        intent: SkillCreatorIntent::AnswerEvaluator,
        skill_dir_override: None,
    })
}

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
/// Returns `(Db, skill_db_id_string)`.
fn db_with_seeded_skill(name: &str) -> (crate::db::Db, String) {
    let conn = crate::db::create_test_db_for_tests();
    conn.execute(
        "INSERT INTO skills (name, skill_source, plugin_id) \
         VALUES (?1, 'skill-builder', (SELECT id FROM plugins WHERE slug = ?2))",
        rusqlite::params![name, DEFAULT_PLUGIN_SLUG],
    )
    .unwrap();
    let id: i64 = conn
        .query_row(
            "SELECT id FROM skills WHERE name = ?1 AND skill_source = 'skill-builder'",
            rusqlite::params![name],
            |row| row.get(0),
        )
        .unwrap();
    (
        crate::db::Db(std::sync::Arc::new(std::sync::Mutex::new(conn))),
        id.to_string(),
    )
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
fn workflow_persistent_turn_dispatch_uses_existing_conversation_and_send_only() {
    let config = test_workflow_step_config(
        "/tmp/app-data",
        "lead-conversion",
        "prompt",
        "/tmp/skills",
        DEFAULT_PLUGIN_SLUG,
        test_workflow_llm_config(),
        WorkflowStepKind::Research,
    );
    let events = Arc::new(Mutex::new(Vec::<String>::new()));
    let send_events = Arc::clone(&events);
    let expected_prompt = config.prompt.clone();
    let expected_prompt_for_send = expected_prompt;
    let existing_conversation_id = "conversation-123".to_string();

    let conversation_id = tokio::runtime::Runtime::new()
        .unwrap()
        .block_on(dispatch_persistent_skill_turn_with_runtime(
            "agent-1",
            config.clone(),
            existing_conversation_id.clone(),
            move |agent_id, send_config, conversation_id| {
                let send_events = Arc::clone(&send_events);
                let expected_prompt = expected_prompt_for_send.clone();
                let agent_id = agent_id.to_string();
                async move {
                    send_events
                        .lock()
                        .unwrap()
                        .push(format!("send:{agent_id}:{conversation_id}"));
                    assert_eq!(send_config.prompt, expected_prompt);
                    Ok(())
                }
            },
        ))
        .unwrap();

    assert_eq!(conversation_id, "conversation-123");
    assert_eq!(
        events.lock().unwrap().as_slice(),
        ["send:agent-1:conversation-123"]
    );
}

#[test]
fn research_prompt_renders_app_owned_openhands_task_context() {
    let prompt = build_step0_prompt(
        "lead-conversion",
        "/tmp/skills",
        DEFAULT_PLUGIN_SLUG,
        4,
        "",
    );

    assert!(!prompt.contains("What should this skill enable Claude to do?"));
    assert!(!prompt.contains("Claude Code"));
    assert!(prompt.contains("We are writing the skill lead-conversion."));
    // Workspace dir removed from step 0 prompt — user context is inlined, agent does not write
    assert!(
        !prompt.contains("Workspace directory:"),
        "step 0 prompt must not expose workspace dir since context is inlined"
    );
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
    assert!(prompt.contains("Do not use alternate field names"));
    assert!(prompt.contains("`options`, `label`, `required`, or"));
    assert!(prompt.contains("Question objects must be nested directly"));
    assert!(prompt.contains("top-level `research_output.questions`"));
    assert!(prompt.contains("answer_evaluator_notes` must always be exactly `[]`"));
    assert!(prompt.contains("do not return note strings"));
    assert!(prompt.contains("The initial research pass must not add refinement questions"));
    assert!(prompt.contains("Refinements are created"));
    assert!(prompt.contains("only by the detailed-research workflow"));
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
        "/tmp/skills",
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
fn research_runtime_config_uses_skill_creator_openhands_contract() {
    let config = test_workflow_step_config(
        "/tmp/app-data",
        "lead-conversion",
        "prompt",
        "/tmp/skills",
        DEFAULT_PLUGIN_SLUG,
        test_workflow_llm_config(),
        WorkflowStepKind::Research,
    );

    assert_eq!(config.agent_name.as_deref(), Some("skill-creator"));
    assert_eq!(config.task_kind.as_deref(), Some("workflow.research"));
    assert!(config.mode.is_none());
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
        config.skills_root, "/tmp/skills",
        "workspace_root_dir must be the skills root"
    );
    assert_eq!(
        config.skill_dir, "/tmp/skills/default/skills/lead-conversion",
        "workspace run dir must be the skill-scoped workspace"
    );
    assert!(
        config.output_format.is_some(),
        "step 0 must carry app-side output schema metadata"
    );
    assert!(
        config.required_plugins.is_none(),
        "OpenHands runtime config should rely on workspace .agents layout"
    );
}

#[test]
fn detailed_research_prompt_renders_clean_break_task_context() {
    let prompt = build_step1_prompt(
        "pipeline-value",
        "/tmp/skills",
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
    assert!(prompt.contains("What should this skill enable the assistant to do?"));
    assert!(prompt.contains("When should this skill trigger?"));
    assert!(!prompt.contains("What should this skill enable Claude to do?"));
    assert!(prompt.contains(
        "What workflow decisions, defaults, exclusions, and domain constraints are still materially unclear?"
    ));
    assert!(prompt.contains("## Interview And Research"));
    assert!(prompt.contains("edge cases, examples, workflow decisions, success criteria"));
    assert!(prompt
        .contains("Do not turn detailed research into output-format negotiation or eval design."));
    assert!(prompt.contains("Check available MCPs"));
    assert!(prompt.contains("Use parallel research via"));
    assert!(prompt.contains("otherwise research inline"));
    assert!(prompt.contains("We are writing the skill pipeline-value."));
    // Workspace dir removed from step 1 prompt — all context is inlined, agent does not write
    assert!(
        !prompt.contains("Workspace directory:"),
        "step 1 prompt must not expose workspace dir since context is inlined"
    );
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
fn detailed_research_runtime_config_uses_skill_creator_openhands_contract() {
    let config = test_workflow_step_config(
        "/tmp/app-data",
        "pipeline-value",
        "prompt",
        "/tmp/skills",
        DEFAULT_PLUGIN_SLUG,
        test_workflow_llm_config(),
        WorkflowStepKind::DetailedResearch,
    );

    assert_eq!(config.agent_name.as_deref(), Some("skill-creator"));
    assert_eq!(
        config.task_kind.as_deref(),
        Some("workflow.detailed_research")
    );
    assert!(config.mode.is_none());
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
    assert_eq!(config.skills_root, "/tmp/skills");
    assert_eq!(
        config.skill_dir, "/tmp/skills/default/skills/pipeline-value",
        "workspace run dir must be the canonical skill directory"
    );
    assert_eq!(config.output_format, workflow_output_format_for_step(1));
    assert!(
        config.required_plugins.is_none(),
        "OpenHands runtime config should rely on workspace .agents layout"
    );
}

#[test]
fn answer_evaluator_prompt_renders_clean_break_skill_routing() {
    let prompt = super::prompt::build_evaluator_prompt(
        "sales-analytics",
        "/tmp/skills",
        DEFAULT_PLUGIN_SLUG,
        "## User Context\n### Skill\n**Name**: sales-analytics",
        "{\n  \"sections\": []\n}",
    );

    assert!(prompt.contains("answer-evaluator workflow gate"));
    assert!(prompt.contains("Do not invoke"));
    assert!(prompt.contains("answer-evaluator skill"));
    assert!(prompt.contains("We are writing the skill sales-analytics."));
    assert!(prompt.contains("/tmp/skills"));
    assert!(prompt.contains("User context:"));
    assert!(prompt.contains("Clarifications JSON:"));
    assert!(prompt
        .to_ascii_lowercase()
        .contains("return only a raw json object"));
    assert!(!prompt.contains("You are answer-evaluator"));
}

#[test]
fn answer_evaluator_runtime_config_uses_skill_creator_openhands_contract() {
    let config = test_answer_evaluator_config(
        "/tmp/app-data",
        "sales-analytics",
        "prompt",
        "/tmp/skills",
        DEFAULT_PLUGIN_SLUG,
        test_workflow_llm_config(),
    );

    assert_eq!(config.agent_name.as_deref(), Some("skill-creator"));
    assert_eq!(config.run_source.as_deref(), Some("gate-eval"));
    assert_eq!(config.output_format, Some(answer_evaluator_output_format()));
    assert_eq!(
        config.user_message_suffix.as_deref(),
        Some(crate::agents::skill_creator::SKILL_CREATOR_USER_SUFFIX.trim())
    );
    assert_eq!(
        config.task_kind.as_deref(),
        Some("workflow.answer_evaluator")
    );
    assert_eq!(config.allowed_tools, Some(vec!["file_editor".to_string()]));
    assert_eq!(config.skill_name.as_deref(), Some("sales-analytics"));
    assert!(
        config.required_plugins.is_none(),
        "OpenHands answer evaluation should rely on workspace .agents skills"
    );
    assert_eq!(config.step_id, Some(-1));
}

#[test]
fn answer_evaluator_shares_the_persistent_skill_session_key_with_step3_workflow() {
    let workflow_config = test_workflow_step_config(
        "/tmp/app-data",
        "sales-analytics",
        "generate the skill",
        "/tmp/skills",
        DEFAULT_PLUGIN_SLUG,
        test_workflow_llm_config(),
        WorkflowStepKind::GenerateSkill,
    );
    let answer_evaluator_config = test_answer_evaluator_config(
        "/tmp/app-data",
        "sales-analytics",
        "evaluate the answers",
        "/tmp/skills",
        DEFAULT_PLUGIN_SLUG,
        test_workflow_llm_config(),
    );

    let workflow_request =
        crate::agents::openhands_server::OpenHandsRuntimeRequest::try_from_runtime_config(
            &workflow_config,
        )
        .unwrap();
    let answer_evaluator_request =
        crate::agents::openhands_server::OpenHandsRuntimeRequest::try_from_runtime_config(
            &answer_evaluator_config,
        )
        .unwrap();

    assert_eq!(
        answer_evaluator_request.plugin_slug,
        workflow_request.plugin_slug
    );
    assert_eq!(
        answer_evaluator_request.skill_name,
        workflow_request.skill_name
    );
    assert_eq!(
        answer_evaluator_request.skills_root,
        workflow_request.skills_root
    );
    assert_eq!(
        answer_evaluator_request.skill_dir,
        workflow_request.skill_dir
    );
    assert_eq!(
        answer_evaluator_request.system_message_suffix,
        workflow_request.system_message_suffix
    );
    assert_eq!(
        answer_evaluator_request.user_message_suffix,
        workflow_request.user_message_suffix
    );
    assert_ne!(
        answer_evaluator_request.task_kind,
        workflow_request.task_kind
    );
    assert_ne!(
        answer_evaluator_request.run_source,
        workflow_request.run_source
    );
    assert_ne!(answer_evaluator_request.step_id, workflow_request.step_id);
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
fn research_json_extraction_repairs_missing_section_closers_before_notes() {
    let state = serde_json::json!({
        "type": "conversation_state",
        "status": "completed",
        "result_text": r#"{"status":"research_complete","question_count":1,"research_output":{"version":"1","metadata":{"question_count":1,"section_count":1,"refinement_count":0,"must_answer_count":1,"priority_questions":["Q1"],"scope_recommendation":false,"scope_reason":null,"warning":null,"error":null},"sections":[{"id":1,"title":"Pipeline Scope","questions":[{"id":"Q1","title":"Pipeline type","text":"What type of pipeline does pipeline value refer to?","must_answer":true,"choices":[{"id":"C1","text":"Sales pipeline","is_other":false},{"id":"C2","text":"Other (please specify)","is_other":true}],"refinements":[]}],"notes":[{"type":"critical_gap","title":"Pipeline type ambiguous","body":"Need pipeline type before continuing."}],"answer_evaluator_notes":[]}}"#
    });

    let parsed = extract_research_json_from_conversation_state(&state).unwrap();

    assert_eq!(parsed["status"], "research_complete");
    assert_eq!(
        parsed["research_output"]["sections"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        parsed["research_output"]["notes"].as_array().unwrap().len(),
        1
    );
}

#[test]
fn workflow_json_extraction_repairs_missing_section_closers_before_next_section() {
    let state = serde_json::json!({
        "type": "conversation_state",
        "status": "completed",
        "result_text": r#"{"status":"detailed_research_complete","refinement_count":3,"section_count":5,"clarifications_json":{"version":"1","metadata":{"question_count":7,"section_count":5,"refinement_count":3,"must_answer_count":5,"priority_questions":["Q1","Q2","Q3","Q5","R4.1"],"scope_recommendation":false,"scope_reason":null,"scope_next_action":null,"duplicates_removed":0,"warning":null,"error":null},"notes":[],"answer_evaluator_notes":[],"sections":[{"id":1,"title":"Pipeline Scope and Definition","questions":[{"id":"Q1","title":"Pipeline type","text":"What type?","must_answer":true,"choices":[{"id":"C1","text":"Sales","is_other":false}],"answer_choice":"C1","answer_text":"Sales","refinements":[]},{"id":"Q2","title":"Pipeline stages","text":"What stages?","must_answer":true,"choices":[{"id":"C1","text":"Standard","is_other":false}],"answer_choice":"C1","answer_text":"Standard","refinements":[]}]},{"id":2,"title":"Value Metrics and Calculation Logic","questions":[{"id":"Q3","title":"Value measures","text":"Which measures?","must_answer":true,"choices":[{"id":"C1","text":"All","is_other":false}],"answer_choice":"C1","answer_text":"All","refinements":[]},{"id":"Q4","title":"Probability weighting method","text":"How weighted?","must_answer":false,"choices":[{"id":"C1","text":"Fixed","is_other":false}],"answer_choice":"C1","answer_text":"Fixed","refinements":[{"id":"R4.1","title":"Stage probability values","text":"What fixed percentages?","must_answer":true,"choices":[{"id":"C1","text":"10/25/50/75/100","is_other":false}],"refinements":[]}]},{"id":4,"title":"Business Rules and Edge Cases","questions":[{"id":"Q6","title":"Material business rules","text":"Which rules?","must_answer":false,"choices":[{"id":"C1","text":"All of the above","is_other":false}],"answer_choice":"C1","answer_text":"All of the above","refinements":[{"id":"R6.1","title":"Value allocation method","text":"How allocate?","must_answer":false,"choices":[{"id":"C1","text":"Proportional split","is_other":false}],"refinements":[]},{"id":"R6.2","title":"Aging threshold and write-off","text":"What aging threshold?","must_answer":false,"choices":[{"id":"C1","text":"90 days excluded","is_other":false}],"refinements":[]}]},{"id":5,"title":"Reconciliation and Validation","questions":[{"id":"Q7","title":"Reconciliation expectations","text":"What reconcile?","must_answer":false,"choices":[{"id":"C1","text":"All of the above","is_other":false}],"answer_choice":"C1","answer_text":"All of the above","refinements":[]}]},{"id":3,"title":"Grain and Dimensional Hierarchy","questions":[{"id":"Q5","title":"Measurement grain","text":"At what grain?","must_answer":true,"choices":[{"id":"C1","text":"Nested hierarchy","is_other":false}],"answer_choice":"C1","answer_text":"Nested hierarchy","refinements":[]}]}]}}"#
    });

    let parsed =
        extract_workflow_json_from_conversation_state(&state, "detailed research").unwrap();

    assert_eq!(parsed["status"], "detailed_research_complete");
    assert_eq!(
        parsed["clarifications_json"]["sections"]
            .as_array()
            .unwrap()
            .len(),
        5
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
        let config = test_workflow_step_config(
            "/tmp/app-data",
            "lead-conversion",
            "prompt",
            "/tmp/skills",
            DEFAULT_PLUGIN_SLUG,
            test_workflow_llm_config(),
            WorkflowStepKind::Research,
        );
        assert_eq!(config.agent_name.as_deref(), Some("skill-creator"));
        assert_eq!(config.task_kind.as_deref(), Some("workflow.research"));

        let (db, skill_id) = db_with_seeded_skill("my-skill");
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
        materialize_workflow_step_output_value(&db, &skill_id, 0, &parsed).unwrap();
        let conn = db.0.lock().unwrap();
        assert!(
            crate::db::workflow_artifacts::read_clarifications(&conn, &skill_id)
                .unwrap()
                .is_some()
        );
    }
}

mod backend_materialization {
    use super::*;

    #[test]
    fn detailed_research_terminal_materialization_smoke() {
        let payload = serde_json::json!({
            "status": "detailed_research_complete",
            "refinement_count": 1,
            "section_count": 1,
            "clarifications_json": valid_clarifications_value()
        });
        let state = serde_json::json!({
            "type": "conversation_state",
            "status": "completed",
            "result_text": serde_json::to_string(&payload).unwrap()
        });

        let parsed = extract_research_json_from_conversation_state(&state).unwrap();
        let (db, skill_id) = db_with_seeded_skill("rt-step1-materialization");
        materialize_workflow_step_output_value(&db, &skill_id, 1, &parsed).unwrap();

        let conn = db.0.lock().unwrap();
        let clarifications = crate::db::workflow_artifacts::read_clarifications(&conn, &skill_id)
            .unwrap()
            .unwrap();
        assert_eq!(clarifications.refinement_count, 1);
    }

    #[test]
    fn confirm_decisions_terminal_materialization_smoke() {
        let payload = serde_json::json!({
            "version": "1",
            "metadata": {
                "decision_count": 1,
                "conflicts_resolved": 0,
                "round": 1
            },
            "decisions": [{
                "id": "D1",
                "title": "Use weighted pipeline value",
                "original_question": "How should pipeline value be measured?",
                "decision": "Use weighted pipeline value",
                "implication": "Downstream calculations use stage probability weighting.",
                "status": "resolved"
            }]
        });
        let state = serde_json::json!({
            "type": "conversation_state",
            "status": "completed",
            "result_text": serde_json::to_string(&payload).unwrap()
        });

        let parsed = extract_research_json_from_conversation_state(&state).unwrap();
        let (db, skill_id) = db_with_seeded_skill("rt-step2-materialization");
        materialize_workflow_step_output_value(&db, &skill_id, 2, &parsed).unwrap();

        let conn = db.0.lock().unwrap();
        let decisions = crate::db::workflow_artifacts::read_decisions(&conn, &skill_id).unwrap();
        assert!(decisions.is_some());
    }

    #[test]
    fn generate_skill_terminal_materialization_smoke() {
        let skills_tmp = tempfile::tempdir().unwrap();
        let workspace_tmp = tempfile::tempdir().unwrap();
        let conn = crate::db::create_test_db_for_tests();
        conn.execute(
            "INSERT INTO skills (name, skill_source, plugin_id) \
             VALUES (?1, 'skill-builder', (SELECT id FROM plugins WHERE slug = ?2))",
            rusqlite::params!["rt-step3-materialization", DEFAULT_PLUGIN_SLUG],
        )
        .unwrap();
        crate::db::write_settings(
            &conn,
            &crate::types::AppSettings {
                skills_path: Some(skills_tmp.path().to_string_lossy().into_owned()),
                ..Default::default()
            },
        )
        .unwrap();
        let db = crate::db::Db(std::sync::Arc::new(std::sync::Mutex::new(conn)));

        let skill_dir = crate::skill_paths::resolve_skill_dir(
            workspace_tmp.path(),
            DEFAULT_PLUGIN_SLUG,
            "rt-step3-materialization",
        );
        std::fs::create_dir_all(skill_dir.join("skill")).unwrap();
        std::fs::write(
            skill_dir.join("skill").join("SKILL.md"),
            r#"---
name: measuring-pipeline-value
description: Use when measuring weighted pipeline value.
---

# Measuring Pipeline Value
"#,
        )
        .unwrap();

        let payload = serde_json::json!({
            "status": "generated",
            "benchmark_path": null,
            "skipped": false,
            "commit_summary": "Create skill package with SKILL.md",
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
        let state = serde_json::json!({
            "type": "conversation_state",
            "status": "completed",
            "result_text": serde_json::to_string(&payload).unwrap()
        });

        let parsed =
            extract_workflow_json_from_conversation_state(&state, "generate-skill").unwrap();
        materialize_workflow_step_output_value(&db, "rt-step3-materialization", 3, &parsed)
            .unwrap();

        let published_skill = crate::skill_paths::resolve_skill_dir(
            skills_tmp.path(),
            DEFAULT_PLUGIN_SLUG,
            "rt-step3-materialization",
        )
        .join("SKILL.md");
        assert!(
            !published_skill.exists(),
            "step 3 generate materialization validates output but does not publish files"
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
    let prompt = build_step2_prompt(
        "lead-conversion",
        "/tmp/skills",
        DEFAULT_PLUGIN_SLUG,
        "",
        "{}",
    );

    assert!(prompt.contains("You are in Step 2: Confirm Decisions"));
    assert!(prompt.contains("Goal: convert clarified user intent"));
    assert!(prompt.contains("Reasoning focus: identify commitments"));
    assert!(prompt.contains("actionable by the skill-writing step"));
    assert!(prompt.contains("We are writing the skill lead-conversion."));
    assert!(prompt.contains("Task kind: workflow.confirm_decisions"));
    // Workspace dir removed from step 2 prompt — all context is inlined, agent does not write
    assert!(
        !prompt.contains("Workspace directory:"),
        "step 2 prompt must not expose workspace dir since context is inlined"
    );
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
    assert!(prompt.contains("What should this skill enable the assistant to do?"));
    assert!(!prompt.contains("What should this skill enable Claude to do?"));
    assert!(prompt.contains("When should this skill trigger?"));
}

#[test]
fn confirm_decisions_runtime_config_uses_skill_creator_openhands_contract() {
    let config = test_workflow_step_config(
        "/tmp/app-data",
        "lead-conversion",
        "prompt",
        "/tmp/skills",
        DEFAULT_PLUGIN_SLUG,
        test_workflow_llm_config(),
        WorkflowStepKind::ConfirmDecisions,
    );

    assert_eq!(config.agent_name.as_deref(), Some("skill-creator"));
    assert_eq!(
        config.task_kind.as_deref(),
        Some("workflow.confirm_decisions")
    );
    assert!(config.mode.is_none());
    assert_eq!(
        config.allowed_tools,
        Some(vec!["file_editor".to_string()])
    );
    assert_eq!(config.max_turns, Some(100));
    assert_eq!(config.skill_name.as_deref(), Some("lead-conversion"));
    assert_eq!(config.step_id, Some(2));
    assert_eq!(config.run_source.as_deref(), Some("workflow"));
    assert_eq!(config.skills_root, "/tmp/skills");
    assert_eq!(
        config.skill_dir, "/tmp/skills/default/skills/lead-conversion",
        "workspace run dir must be the canonical skill directory"
    );
    assert_eq!(config.output_format, workflow_output_format_for_step(2));
    assert!(
        config.required_plugins.is_none(),
        "OpenHands runtime config should rely on workspace .agents layout"
    );
}

#[test]
fn skill_generation_prompt_renders_app_owned_openhands_task_context() {
    let prompt = build_step3_prompt(
        "pipeline-value",
        "/tmp/skills",
        DEFAULT_PLUGIN_SLUG,
        Some("octocat"),
        Some("2026-05-01T12:00:00Z"),
        "",
        "{}",
        "{}",
    );

    assert!(prompt.contains("workflow.skill_generation"));
    assert!(prompt.contains("We are writing the skill named `pipeline-value`."));
    assert!(prompt.contains("Skill directory: `/tmp/skills/default/skills/pipeline-value`"));
    assert!(prompt.contains("Skill output directory: `/tmp/skills/default/skills/pipeline-value`"));
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
    assert!(prompt.contains("Use the `invoke_skill` tool to load the `creating-skills` skill"));
    assert!(prompt.contains("synthesize a generation"));
    assert!(prompt.contains("brief from the confirmed decisions"));
    assert!(prompt.contains("Pass this brief to the `creating-skills` skill"));
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
    assert!(
        !prompt.contains("metadata:\n  version: \"1.0.0\""),
        "step 3 prompt must not require metadata.version in generated frontmatter"
    );
    assert!(prompt.contains("decisions.json"));
    assert!(prompt.contains("clarifications.json"));
    assert!(prompt.contains("fresh-context"));
    assert!(prompt.contains("launch"));
    assert!(prompt.contains("named `skill-verifier` subagent"));
    assert!(prompt.contains("via the `task` tool"));
    assert!(prompt.contains("run exactly one re-verification"));
    assert!(prompt.contains("Do not invoke a separate validator skill"));
    assert!(prompt.contains("Do not invoke a legacy writer agent"));
    assert!(
        prompt.contains("The app Eval Workbench owns durable prompt cases, assertions, runs, and")
    );
    assert!(
        !prompt.contains("\"version_bump\":"),
        "step 3 prompt must not require version_bump in generated output"
    );
    assert!(prompt.contains("synthesize-generation-brief"));
    assert!(prompt.contains("fresh-context-verifier-review"));
    assert!(prompt.contains("`call_trace` must be an array of string values"));
    assert!(prompt.contains("Do not\nreturn objects inside `call_trace`."));
}

#[test]
fn skill_generation_runtime_config_uses_skill_creator_openhands_contract() {
    let config = test_workflow_step_config(
        "/tmp/app-data",
        "pipeline-value",
        "prompt",
        "/tmp/skills",
        DEFAULT_PLUGIN_SLUG,
        test_workflow_llm_config(),
        WorkflowStepKind::GenerateSkill,
    );

    assert_eq!(config.agent_name.as_deref(), Some("skill-creator"));
    assert_eq!(
        config.task_kind.as_deref(),
        Some("workflow.skill_generation")
    );
    assert!(config.mode.is_none());
    assert_eq!(
        config.allowed_tools,
        Some(vec!["file_editor".to_string(), "terminal".to_string()])
    );
    assert_eq!(config.max_turns, Some(500));
    assert_eq!(config.skill_name.as_deref(), Some("pipeline-value"));
    assert_eq!(config.step_id, Some(3));
    assert_eq!(config.run_source.as_deref(), Some("workflow"));
    assert_eq!(config.skills_root, "/tmp/skills");
    assert_eq!(
        config.skill_dir,
        "/tmp/skills/default/skills/pipeline-value"
    );
    assert_eq!(config.output_format, workflow_output_format_for_step(3));
    let expected_suffix = crate::agents::runtime_config::skill_creator_system_message_suffix();
    assert_eq!(
        config.system_message_suffix.as_deref(),
        Some(expected_suffix.as_str())
    );
    assert!(
        config.required_plugins.is_none(),
        "OpenHands runtime config should rely on workspace .agents layout"
    );
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
    let (db, skill_id) = db_with_seeded_skill("my-skill");
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

    materialize_workflow_step_output_value(&db, &skill_id, 0, &payload).unwrap();
    let conn = db.0.lock().unwrap();
    let record = crate::db::workflow_artifacts::read_clarifications(&conn, &skill_id)
        .unwrap()
        .expect("clarifications row should exist");
    assert_eq!(record.title, "Test");
    assert_eq!(record.refinement_count, 0);
}

#[test]
fn test_materialize_step0_drops_legacy_research_metadata() {
    let (db, skill_id) = db_with_seeded_skill("my-skill");
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

    materialize_workflow_step_output_value(&db, &skill_id, 0, &payload).unwrap();
    let conn = db.0.lock().unwrap();
    let record = crate::db::workflow_artifacts::read_clarifications(&conn, &skill_id)
        .unwrap()
        .unwrap();
    // No DB column exists for priority_questions or duplicates_removed,
    // so they are silently dropped at the unpack boundary.
    assert_eq!(record.title, "Test");
}

#[test]
fn test_materialize_step0_empty_metadata_defaults_to_zeros() {
    let (db, skill_id) = db_with_seeded_skill("my-skill");
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

    materialize_workflow_step_output_value(&db, &skill_id, 0, &payload)
        .expect("empty metadata should default fields");
}

#[test]
fn test_materialize_step1_writes_clarifications_only() {
    let (db, skill_id) = db_with_seeded_skill("my-skill");
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

    materialize_workflow_step_output_value(&db, &skill_id, 1, &payload).unwrap();
    let conn = db.0.lock().unwrap();
    let record = crate::db::workflow_artifacts::read_clarifications(&conn, &skill_id)
        .unwrap()
        .unwrap();
    assert_eq!(record.refinement_count, 1);
    assert_eq!(record.questions.len(), 1);
}

#[test]
fn test_materialize_step1_writes_additive_detailed_research_output() {
    let (db, skill_id) = db_with_seeded_skill("my-skill");
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

    materialize_workflow_step_output_value(&db, &skill_id, 1, &output).unwrap();
    let conn = db.0.lock().unwrap();
    let record = crate::db::workflow_artifacts::read_clarifications(&conn, &skill_id)
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
    let (db, skill_id) = db_with_seeded_skill("my-skill");
    let err = materialize_workflow_step_output_value(&db, &skill_id, 0, &serde_json::json!(null))
        .unwrap_err();
    assert!(err.contains("workflow result payload must be a JSON object"));
}

#[test]
fn test_materialize_step0_rejects_wrong_status() {
    let (db, skill_id) = db_with_seeded_skill("my-skill");
    let payload = serde_json::json!({
        "status": "detailed_research_complete",
        "question_count": 1,
        "research_output": valid_clarifications_value()
    });
    let err = materialize_workflow_step_output_value(&db, &skill_id, 0, &payload).unwrap_err();
    assert!(err.contains("workflow result payload status must be 'research_complete'"));
}

#[test]
fn test_materialize_step0_rejects_missing_required_fields() {
    let (db, skill_id) = db_with_seeded_skill("my-skill");

    let missing_research_output = serde_json::json!({
        "status": "research_complete",
        "question_count": 1
    });
    let err = materialize_workflow_step_output_value(&db, &skill_id, 0, &missing_research_output)
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
        materialize_workflow_step_output_value(&db, &skill_id, 0, &non_integer_question_count)
            .unwrap_err();
    assert!(err.contains("invalid research step output"));
}

#[test]
fn test_materialize_step0_rejects_missing_research_output() {
    let (db, skill_id) = db_with_seeded_skill("my-skill");

    let missing = serde_json::json!({
        "status": "research_complete",
        "question_count": 1
    });
    let err = materialize_workflow_step_output_value(&db, &skill_id, 0, &missing).unwrap_err();
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
        materialize_workflow_step_output_value(&db, &skill_id, 0, &invalid_nested).unwrap_err();
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
    let (db, skill_id) = db_with_seeded_skill("my-skill");
    let payload = serde_json::json!({
        "status": "research_complete",
        "refinement_count": 1,
        "section_count": 1,
        "clarifications_json": valid_clarifications_value()
    });
    let err = materialize_workflow_step_output_value(&db, &skill_id, 1, &payload).unwrap_err();
    assert!(err.contains("workflow result payload status must be 'detailed_research_complete'"));
}

#[test]
fn test_materialize_step1_rejects_missing_required_fields() {
    let (db, skill_id) = db_with_seeded_skill("my-skill");

    // Missing refinement_count → hard fail (required per SKILL.md)
    let missing_refinement_count = serde_json::json!({
        "status": "detailed_research_complete",
        "section_count": 1,
        "clarifications_json": valid_clarifications_value()
    });
    let err = materialize_workflow_step_output_value(&db, &skill_id, 1, &missing_refinement_count)
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
    let err = materialize_workflow_step_output_value(&db, &skill_id, 1, &non_integer_section_count)
        .unwrap_err();
    assert!(err.contains("invalid detailed research output"));
}

#[test]
fn test_materialize_step1_rejects_missing_clarifications_json() {
    let (db, skill_id) = db_with_seeded_skill("my-skill");
    let payload = serde_json::json!({
        "status": "detailed_research_complete",
        "refinement_count": 1,
        "section_count": 1
    });
    let err = materialize_workflow_step_output_value(&db, &skill_id, 1, &payload).unwrap_err();
    assert!(err.contains("invalid detailed research output"));
}

#[test]
fn test_materialize_step1_validation_failure_preserves_existing_db_state() {
    let (db, skill_id) = db_with_seeded_skill("my-skill");
    // Seed an initial valid clarifications row so we can verify it is not
    // overwritten when a subsequent invalid payload is rejected.
    let valid = serde_json::json!({
        "status": "detailed_research_complete",
        "refinement_count": 0,
        "section_count": 1,
        "clarifications_json": valid_clarifications_value()
    });
    materialize_workflow_step_output_value(&db, &skill_id, 1, &valid).unwrap();

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
    let err =
        materialize_workflow_step_output_value(&db, &skill_id, 1, &invalid_payload).unwrap_err();
    assert!(
        err.contains("invalid detailed research output"),
        "unexpected error: {err}"
    );
    // Existing record untouched: refinement_count still 0 from the valid run.
    let conn = db.0.lock().unwrap();
    let record = crate::db::workflow_artifacts::read_clarifications(&conn, &skill_id)
        .unwrap()
        .unwrap();
    assert_eq!(record.refinement_count, 0);
}

#[test]
fn test_materialize_step1_rejects_invalid_answer_evaluator_notes_shape() {
    let (db, skill_id) = db_with_seeded_skill("my-skill");
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

    let err = materialize_workflow_step_output_value(&db, &skill_id, 1, &payload).unwrap_err();
    // Typed deserialization rejects non-array answer_evaluator_notes
    assert!(
        err.contains("invalid detailed research output"),
        "unexpected error: {err}"
    );
}

#[test]
fn test_materialize_step0_scope_recommendation_persists_to_db() {
    let (db, skill_id) = db_with_seeded_skill("my-skill");
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

    materialize_workflow_step_output_value(&db, &skill_id, 0, &payload).unwrap();
    let conn = db.0.lock().unwrap();
    let record = crate::db::workflow_artifacts::read_clarifications(&conn, &skill_id)
        .unwrap()
        .unwrap();
    assert_eq!(record.scope_recommendation, Some(true));
}

#[test]
fn test_materialize_step2_writes_decisions() {
    let (db, skill_id) = db_with_seeded_skill("my-skill");
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
    materialize_workflow_step_output_value(&db, &skill_id, 2, &payload).unwrap();
    let conn = db.0.lock().unwrap();
    let record = crate::db::workflow_artifacts::read_decisions(&conn, &skill_id)
        .unwrap()
        .unwrap();
    assert_eq!(record.items.len(), 1);
    assert_eq!(record.items[0].decision_id, "D1");
    assert_eq!(record.items[0].status, "resolved");
}

#[test]
fn test_materialize_step2_repairs_missing_statuses_to_resolved() {
    let (db, skill_id) = db_with_seeded_skill("my-skill");
    let payload = serde_json::json!({
        "version": "1",
        "metadata": { "decision_count": 3, "conflicts_resolved": 0, "round": 1 },
        "decisions": [
            {
                "id": "D1",
                "title": "Capability",
                "original_question": "What should this skill enable the assistant to do?",
                "decision": "Guide weighted pipeline logic.",
                "implication": "Needs direct user review before skill generation.",
                "status": "needs-review"
            },
            {
                "id": "D2",
                "title": "Pipeline Scope",
                "original_question": "What type of pipeline applies?",
                "decision": "Sales opportunity pipeline only.",
                "implication": "Ignore service delivery and revenue forecast pipelines."
            },
            {
                "id": "D3",
                "title": "Probability Weighting",
                "original_question": "How should win probability be determined?",
                "decision": "Use stage-based percentages.",
                "implication": "Treat percentages as organization-configurable defaults."
            }
        ]
    });

    materialize_workflow_step_output_value(&db, &skill_id, 2, &payload).unwrap();

    let conn = db.0.lock().unwrap();
    let record = crate::db::workflow_artifacts::read_decisions(&conn, &skill_id)
        .unwrap()
        .unwrap();
    assert_eq!(record.items.len(), 3);
    assert_eq!(record.items[0].status, "needs-review");
    assert_eq!(record.items[1].status, "resolved");
    assert_eq!(record.items[2].status, "resolved");
}

#[test]
fn test_materialize_step2_writes_scope_guard_stub_decisions() {
    let (db, skill_id) = db_with_seeded_skill("my-skill");
    let payload = serde_json::json!({
        "version": "1",
        "metadata": { "scope_recommendation": true, "decision_count": 0, "conflicts_resolved": 0, "round": 1 },
        "decisions": []
    });
    materialize_workflow_step_output_value(&db, &skill_id, 2, &payload).unwrap();
    let conn = db.0.lock().unwrap();
    let record = crate::db::workflow_artifacts::read_decisions(&conn, &skill_id)
        .unwrap()
        .unwrap();
    assert_eq!(record.scope_recommendation, Some(true));
    assert_eq!(record.decision_count, 0);
}

#[test]
fn test_materialize_step2_contradictory_inputs_active_persists_state() {
    let (db, skill_id) = db_with_seeded_skill("my-skill");
    let payload = serde_json::json!({
        "version": "1",
        "metadata": { "decision_count": 2, "conflicts_resolved": 0, "round": 1, "contradictory_inputs": true },
        "decisions": []
    });
    materialize_workflow_step_output_value(&db, &skill_id, 2, &payload).unwrap();
    let conn = db.0.lock().unwrap();
    let record = crate::db::workflow_artifacts::read_decisions(&conn, &skill_id)
        .unwrap()
        .unwrap();
    assert_eq!(record.contradictory_inputs_state.as_deref(), Some("active"));
}

#[test]
fn test_materialize_step2_contradictory_inputs_false_persists_inactive() {
    let (db, skill_id) = db_with_seeded_skill("my-skill");
    let payload = serde_json::json!({
        "version": "1",
        "metadata": { "decision_count": 2, "conflicts_resolved": 0, "round": 1, "contradictory_inputs": false },
        "decisions": []
    });
    materialize_workflow_step_output_value(&db, &skill_id, 2, &payload).unwrap();
    let conn = db.0.lock().unwrap();
    let record = crate::db::workflow_artifacts::read_decisions(&conn, &skill_id)
        .unwrap()
        .unwrap();
    assert_eq!(
        record.contradictory_inputs_state.as_deref(),
        Some("inactive")
    );
}

#[test]
fn test_materialize_step2_rejects_null_payload() {
    let (db, skill_id) = db_with_seeded_skill("my-skill");
    let err = materialize_workflow_step_output_value(&db, &skill_id, 2, &serde_json::json!(null))
        .unwrap_err();
    assert!(err.contains("workflow result payload must be a JSON object"));
}

#[test]
fn test_materialize_step3_generate_validates_payload() {
    // VU-1157: benchmark-meta.json writer was removed entirely. Step 3 only
    // validates the agent's GenerateSkillOutput shape; no DB persistence.
    let (db, skill_id) = db_with_seeded_skill("my-skill");
    let payload = serde_json::json!({
        "status": "generated",
        "benchmark_path": null,
        "skipped": false,
        "commit_summary": "Create skill package with SKILL.md and references",
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
    materialize_workflow_step_output_value(&db, &skill_id, 3, &payload).unwrap();
}

#[test]
fn test_materialize_step3_generate_skipped_validates_payload() {
    let (db, skill_id) = db_with_seeded_skill("my-skill");
    let payload = serde_json::json!({
        "status": "generated",
        "benchmark_path": null,
        "skipped": true,
        "commit_summary": "Skipped because verifier found unresolved material findings",
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
    materialize_workflow_step_output_value(&db, &skill_id, 3, &payload).unwrap();
}

#[test]
fn test_materialize_step3_generate_rejects_missing_call_trace() {
    let (db, skill_id) = db_with_seeded_skill("my-skill");
    let payload = serde_json::json!({
        "status": "generated",
        "commit_summary": "Create skill package with required files"
    });
    let err = materialize_workflow_step_output_value(&db, &skill_id, 3, &payload).unwrap_err();
    assert!(err.contains("call_trace must be a non-empty string array"));
}

#[test]
fn test_materialize_step3_generate_rejects_object_call_trace_entries() {
    let (db, skill_id) = db_with_seeded_skill("my-skill");
    let payload = serde_json::json!({
        "status": "generated",
        "commit_summary": "Create skill package with required files",
        "call_trace": [{"step": "read-user-context"}]
    });
    let err = materialize_workflow_step_output_value(&db, &skill_id, 3, &payload).unwrap_err();
    assert!(err.contains("invalid generate-skill output"));
}

#[test]
fn test_materialize_step3_generate_rejects_missing_required_trace_entry() {
    let payload = serde_json::json!({
        "status": "generated",
        "commit_summary": "Create skill package with required files",
        "call_trace": [
            "read-user-context",
            "read-decisions",
            "synthesize-generation-brief",
            "use-creating-skills",
            "write-skill",
            "fresh-context-verifier-review"
        ]
    });
    let (db, skill_id) = db_with_seeded_skill("my-skill");
    let err = materialize_workflow_step_output_value(&db, &skill_id, 3, &payload).unwrap_err();
    assert!(err.contains("call_trace missing required entry 'read-clarifications'"));
}

#[test]
fn publish_commit_and_tag_generated_skill_creates_initial_version_tag() {
    let workspace = tempfile::tempdir().unwrap();
    let skills = tempfile::tempdir().unwrap();
    let skill_dir = workspace.path().join("skills").join("tagged-skill");
    let generated_refs = skill_dir.join("skill").join("references");
    std::fs::create_dir_all(&generated_refs).unwrap();
    std::fs::write(
        skill_dir.join("skill").join("SKILL.md"),
        "---\nname: tagged-skill\n---\n# Tagged Skill\n",
    )
    .unwrap();
    std::fs::write(generated_refs.join("terms.md"), "# Terms\n").unwrap();

    publish_commit_and_tag_generated_skill(&skill_dir, skills.path(), "skills", "tagged-skill")
        .unwrap();

    let skill_dir = crate::skill_paths::resolve_skill_dir(skills.path(), "skills", "tagged-skill");
    assert!(
        crate::git::skill_version_tag_exists(&skill_dir, "skills", "tagged-skill", "1.0.0")
            .unwrap()
    );
}

#[test]
fn publish_commit_and_tag_generated_skill_accepts_skill_without_metadata_version() {
    let workspace = tempfile::tempdir().unwrap();
    let skills = tempfile::tempdir().unwrap();
    let skill_dir = workspace.path().join("skills").join("tagged-skill");
    let generated_dir = skill_dir.join("skill");
    std::fs::create_dir_all(&generated_dir).unwrap();
    std::fs::write(
        generated_dir.join("SKILL.md"),
        "---\nname: tagged-skill\nversion: 1.0.0\n---\n# Tagged Skill\n",
    )
    .unwrap();

    publish_commit_and_tag_generated_skill(&skill_dir, skills.path(), "skills", "tagged-skill")
        .unwrap();
}

#[test]
fn publish_commit_and_tag_generated_skill_accepts_non_initial_metadata_version_in_frontmatter() {
    let workspace = tempfile::tempdir().unwrap();
    let skills = tempfile::tempdir().unwrap();
    let skill_dir = workspace.path().join("skills").join("tagged-skill");
    let generated_dir = skill_dir.join("skill");
    std::fs::create_dir_all(&generated_dir).unwrap();
    std::fs::write(
        generated_dir.join("SKILL.md"),
        "---\nname: tagged-skill\nmetadata:\n  version: 2.0.0\n---\n# Tagged Skill\n",
    )
    .unwrap();

    publish_commit_and_tag_generated_skill(&skill_dir, skills.path(), "skills", "tagged-skill")
        .unwrap();
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
    crate::git::ensure_repo(&published_dir).unwrap();
    std::fs::write(
        published_dir.join("SKILL.md"),
        "---\nname: tagged-skill\nmetadata:\n  version: 1.0.0\n---\n# Existing\n",
    )
    .unwrap();
    crate::git::commit_all(&published_dir, "existing").unwrap();
    crate::git::create_skill_version_tag(&published_dir, plugin_slug, skill_name, "1.0.0").unwrap();

    let skill_dir = workspace.path().join("skills").join(skill_name);
    let generated_dir = skill_dir.join("skill");
    std::fs::create_dir_all(&generated_dir).unwrap();
    std::fs::write(
        generated_dir.join("SKILL.md"),
        "---\nname: tagged-skill\nmetadata:\n  version: 1.0.0\n---\n# Updated\n",
    )
    .unwrap();

    let err =
        publish_commit_and_tag_generated_skill(&skill_dir, skills.path(), plugin_slug, skill_name)
            .unwrap_err();

    assert!(
        err.contains("Generated skill version tag failed"),
        "unexpected error: {err}"
    );
}

#[test]
fn step3_reset_and_rerun_does_not_collide_on_version_tag() {
    // Regression: resetting step 3 and re-running previously failed with
    // "tag already exists" because all skills shared one git repo. With
    // per-skill repos, reset deletes only this skill's tag and re-tagging
    // succeeds.
    let workspace = tempfile::tempdir().unwrap();
    let skills = tempfile::tempdir().unwrap();
    let plugin = "skills";
    let skill_name = "my-skill";
    let workspace_skill_path = workspace.path().join(plugin).join(skill_name);
    let skill_dir = crate::skill_paths::resolve_skill_dir(skills.path(), plugin, skill_name);

    let write_generated = |content: &str| {
        let generated_dir = workspace_skill_path.join("skill");
        std::fs::create_dir_all(&generated_dir).unwrap();
        std::fs::write(
            generated_dir.join("SKILL.md"),
            format!("---\nname: {skill_name}\nmetadata:\n  version: 1.0.0\n---\n{content}\n"),
        )
        .unwrap();
    };

    // Step 3 completes for the first time.
    write_generated("# v1");
    publish_commit_and_tag_generated_skill(
        &workspace_skill_path,
        skills.path(),
        plugin,
        skill_name,
    )
    .expect("first step 3 completion must succeed");
    assert!(
        crate::git::skill_version_tag_exists(&skill_dir, plugin, skill_name, "1.0.0").unwrap(),
        "v1.0.0 tag must exist after first completion"
    );

    // User resets step 3 — cleanup deletes version tags in the per-skill repo.
    crate::git::delete_skill_version_tags(&skill_dir, plugin, skill_name)
        .expect("tag deletion must succeed");
    assert!(
        !crate::git::skill_version_tag_exists(&skill_dir, plugin, skill_name, "1.0.0").unwrap(),
        "v1.0.0 tag must be gone after reset"
    );

    // Step 3 re-runs and produces new output.
    write_generated("# v1 regenerated");
    publish_commit_and_tag_generated_skill(
        &workspace_skill_path,
        skills.path(),
        plugin,
        skill_name,
    )
    .expect("step 3 re-run must not fail with 'tag already exists'");
    assert!(
        crate::git::skill_version_tag_exists(&skill_dir, plugin, skill_name, "1.0.0").unwrap(),
        "v1.0.0 tag must exist after re-run"
    );
}

#[test]
fn test_materialize_step3_benchmark_complete_validates() {
    // VU-1157: benchmark-meta.json writer was removed; the partial→complete
    // upgrade logic that probed for benchmark.json on disk no longer exists
    // (eval/benchmark redo). The validate-only path accepts any of the
    // benchmark-skill statuses.
    let (db, skill_id) = db_with_seeded_skill("my-skill");
    let payload = serde_json::json!({
        "status": "complete",
        "benchmark_path": "evals/iterations/iteration-1"
    });
    materialize_workflow_step_output_value(&db, &skill_id, 3, &payload).unwrap();
}

#[test]
fn test_materialize_step3_partial_validates() {
    let (db, skill_id) = db_with_seeded_skill("my-skill");
    let payload = serde_json::json!({
        "status": "partial",
        "benchmark_path": "evals/iterations/iteration-1"
    });
    materialize_workflow_step_output_value(&db, &skill_id, 3, &payload).unwrap();
}

#[test]
fn test_materialize_step3_skipped_validates() {
    let (db, skill_id) = db_with_seeded_skill("my-skill");
    let payload = serde_json::json!({
        "status": "skipped",
        "benchmark_path": null
    });
    materialize_workflow_step_output_value(&db, &skill_id, 3, &payload).unwrap();
}

#[test]
fn test_materialize_step3_rejects_wrong_status() {
    let (db, skill_id) = db_with_seeded_skill("my-skill");
    let payload = serde_json::json!({
        "status": "decisions_complete"
    });
    let err = materialize_workflow_step_output_value(&db, &skill_id, 3, &payload).unwrap_err();
    assert!(err.contains(
        "workflow result payload status must be 'generated', 'rewritten', or 'complete'|'partial'|'skipped'"
    ));
}

#[test]
fn test_evaluator_prompt_does_not_contain_stale_routing_tokens() {
    let prompt = super::prompt::build_evaluator_prompt(
        "s",
        "/sk",
        DEFAULT_PLUGIN_SLUG,
        "context",
        "{}",
    );
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
            "evaluator prompt must not contain stale routing token: {forbidden}"
        );
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
    let skill_name = "my-skill";
    let skills_path = "/home/user/my-skills";

    let prompt = super::prompt::build_evaluator_prompt(
        skill_name,
        skills_path,
        DEFAULT_PLUGIN_SLUG,
        "## User Context\n### Skill\n**Name**: my-skill",
        "{\n  \"sections\": []\n}",
    );

    assert!(prompt.contains("We are writing the skill my-skill."));
    assert!(prompt
        .contains("Skill directory: /home/user/my-skills/default/skills/my-skill"));
    assert!(prompt.contains("Skill output directory: /home/user/my-skills/default/skills/my-skill"));
    assert!(prompt.contains("User context:\n## User Context"));
    assert!(prompt.contains("Clarifications JSON:\n{\n  \"sections\": []\n}"));
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
    let skills_tmp = tempfile::tempdir().unwrap();
    let skills_path = skills_tmp.path().to_str().unwrap();
    let skill_dir = skills_tmp.path().join(DEFAULT_PLUGIN_SLUG).join("my-skill");
    std::fs::create_dir_all(&skill_dir).unwrap();

    // Create SKILL.md in skills_path (step 3 output)
    std::fs::write(skill_dir.join("SKILL.md"), "# Skill").unwrap();

    // Reset from step 2 onwards should clean up SKILL.md
    crate::cleanup::delete_step_output_files(
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
    let skills_tmp = tempfile::tempdir().unwrap();
    let skills_path = skills_tmp.path().to_str().unwrap();
    crate::cleanup::delete_step_output_files(
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

    std::fs::write(
        workspace_agents_src.path().join("skill-creator.md"),
        "# Skill Creator Agent",
    )
    .unwrap();
    std::fs::write(
        workspace_agents_src.path().join("skill-verifier.md"),
        "# Skill Verifier Agent",
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

    // Agents deployed to workspace root .agents/
    assert!(workspace
        .path()
        .join(".agents/agents/skill-creator.md")
        .is_file());
    assert!(workspace
        .path()
        .join(".agents/agents/skill-verifier.md")
        .is_file());
    assert!(!workspace.path().join(".agents/agents/README.txt").exists());
    // Skills deployed to workspace root .agents/skills/
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
    // Steps 0-2 are DB-authoritative. Resetting from step 0 removes SKILL.md (step 3).
    let skills_path_tmp = tempfile::tempdir().unwrap();
    let skills_path = skills_path_tmp.path().to_str().unwrap();

    // Step 3 output
    let output_dir = skills_path_tmp
        .path()
        .join(DEFAULT_PLUGIN_SLUG)
        .join("my-skill");
    std::fs::create_dir_all(&output_dir).unwrap();
    std::fs::write(output_dir.join("SKILL.md"), "# Skill").unwrap();

    // Call delete_step_output_files from step 0
    crate::cleanup::delete_step_output_files(
        "my-skill",
        DEFAULT_PLUGIN_SLUG,
        0,
        skills_path,
    );

    // SKILL.md should be gone
    assert!(!output_dir.join("SKILL.md").exists());
}

// VD-664: parse_scope_recommendation was file-based; replaced by
// check_scope_recommendation_db in guards.rs (VU-1157). Tests live in guards.rs.

// --- format_user_context tests ---

#[test]
fn test_format_user_context_all_fields() {
    let intake = r#"{"audience":"Data engineers","challenges":"Legacy systems","scope":"ETL pipelines","unique_setup":"Multi-cloud","agent_mistakes":"Assumes AWS"}"#;
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
    assert!(ctx.contains("### What the Agent Gets Wrong"));
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
        &[],
    );
    let ctx = result.unwrap();
    assert!(ctx.contains("### Target Audience"));
    assert!(ctx.contains("Engineers"));
    assert!(ctx.contains("### Scope"));
    assert!(ctx.contains("APIs"));
    assert!(!ctx.contains("### Key Challenges"));
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
        &[],
    );
    let text = result.unwrap();
    assert!(
        text.contains("### What the Agent Needs to Know"),
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
        let (db, skill_id) = db_with_seeded_skill("rt-step0");
        let json = serde_json::json!({
            "status": "research_complete",
            "question_count": 4,
            "research_output": clarifications_fixture()
        });

        materialize_workflow_step_output_value(&db, &skill_id, 0, &json).unwrap();

        let conn = db.0.lock().unwrap();
        let record = crate::db::workflow_artifacts::read_clarifications(&conn, &skill_id)
            .unwrap()
            .unwrap();
        assert_eq!(record.refinement_count, 0);
        assert_eq!(record.sections[0].title, "Intent and Trigger");
        let ids: Vec<&str> = record
            .questions
            .iter()
            .map(|q| q.question_id.as_str())
            .collect();
        assert!(ids.contains(&"Q1"));
        assert!(ids.contains(&"Q2"));
        assert!(ids.contains(&"Q3"));
        assert!(ids.contains(&"Q4"));
    }

    #[test]
    fn step1_with_refinement_count() {
        let (db, skill_id) = db_with_seeded_skill("rt-step1");
        let json = serde_json::json!({
            "status": "detailed_research_complete",
            "refinement_count": 2,
            "section_count": 2,
            "clarifications_json": clarifications_fixture()
        });

        materialize_workflow_step_output_value(&db, &skill_id, 1, &json).unwrap();

        let conn = db.0.lock().unwrap();
        let record = crate::db::workflow_artifacts::read_clarifications(&conn, &skill_id)
            .unwrap()
            .unwrap();
        assert_eq!(record.refinement_count, 2);
    }

    #[test]
    fn step0_then_step1_overwrites() {
        let (db, skill_id) = db_with_seeded_skill("rt-overwrite");

        let step0 = serde_json::json!({
            "status": "research_complete",
            "question_count": 4,
            "research_output": clarifications_fixture()
        });
        materialize_workflow_step_output_value(&db, &skill_id, 0, &step0).unwrap();

        let step1 = serde_json::json!({
            "status": "detailed_research_complete",
            "refinement_count": 3,
            "section_count": 2,
            "clarifications_json": clarifications_fixture()
        });
        materialize_workflow_step_output_value(&db, &skill_id, 1, &step1).unwrap();

        let conn = db.0.lock().unwrap();
        let record = crate::db::workflow_artifacts::read_clarifications(&conn, &skill_id)
            .unwrap()
            .unwrap();
        assert_eq!(record.refinement_count, 3);
    }

    #[test]
    fn step2_full_roundtrip() {
        let (db, skill_id) = db_with_seeded_skill("rt-step2");
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

        materialize_workflow_step_output_value(&db, &skill_id, 2, &json).unwrap();

        let conn = db.0.lock().unwrap();
        let record = crate::db::workflow_artifacts::read_decisions(&conn, &skill_id)
            .unwrap()
            .unwrap();
        assert_eq!(record.version, "1");
        assert!(record.items.iter().any(|i| i.status == "needs-review"));
        let resolved = record.items.iter().find(|i| i.decision_id == "D1").unwrap();
        assert_eq!(resolved.title, "Primary integration method");
    }

    #[test]
    fn step2_contradictory_inputs_active_true() {
        let (db, skill_id) = db_with_seeded_skill("rt-ci-true");
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

        materialize_workflow_step_output_value(&db, &skill_id, 2, &json).unwrap();

        let conn = db.0.lock().unwrap();
        let record = crate::db::workflow_artifacts::read_decisions(&conn, &skill_id)
            .unwrap()
            .unwrap();
        assert_eq!(record.contradictory_inputs_state.as_deref(), Some("active"));
    }

    #[test]
    fn step2_contradictory_inputs_active_false() {
        let (db, skill_id) = db_with_seeded_skill("rt-ci-false");
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

        materialize_workflow_step_output_value(&db, &skill_id, 2, &json).unwrap();

        let conn = db.0.lock().unwrap();
        let record = crate::db::workflow_artifacts::read_decisions(&conn, &skill_id)
            .unwrap()
            .unwrap();
        assert_eq!(
            record.contradictory_inputs_state.as_deref(),
            Some("inactive")
        );
    }

    #[test]
    fn step2_contradictory_inputs_revised_string() {
        // The agent emits "revised" as the Revised string variant. The DB
        // validator accepts only "inactive", "active", or "revised" — a free-form
        // sentence would be rejected by validate_contradictory_inputs_state.
        let (db, skill_id) = db_with_seeded_skill("rt-ci-revised");
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

        materialize_workflow_step_output_value(&db, &skill_id, 2, &json).unwrap();

        let conn = db.0.lock().unwrap();
        let record = crate::db::workflow_artifacts::read_decisions(&conn, &skill_id)
            .unwrap()
            .unwrap();
        assert_eq!(
            record.contradictory_inputs_state.as_deref(),
            Some("revised")
        );
    }

    #[test]
    fn scope_recommendation_guard_reads_db() {
        let (db, skill_id) = db_with_seeded_skill("rt-scope-guard");
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

        materialize_workflow_step_output_value(&db, &skill_id, 0, &json).unwrap();

        let conn = db.0.lock().unwrap();
        assert!(guards::check_scope_recommendation_db(&conn, &skill_id));
    }

    #[test]
    fn decisions_needs_review_guard_reads_db() {
        let (db, skill_id) = db_with_seeded_skill("rt-dec-guard");
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

        materialize_workflow_step_output_value(&db, &skill_id, 2, &json).unwrap();

        let conn = db.0.lock().unwrap();
        assert!(guards::check_decisions_guard_db(&conn, &skill_id));
    }

    #[test]
    fn step3_guard_fails_when_no_decisions_in_db() {
        // Verifies that the step-3 DB guard correctly detects missing decisions.
        // The guard in read_workflow_settings queries DB for decisions before
        // allowing step 3 to proceed.
        let (db, skill_id) = db_with_seeded_skill("guard-test-skill");
        let conn = db.0.lock().unwrap();
        // No decisions seeded — read_decisions should return None
        let decisions = crate::db::workflow_artifacts::read_decisions(&conn, &skill_id).unwrap();
        assert!(
            decisions.is_none(),
            "guard-test-skill has no decisions — step 3 guard should block"
        );
    }

    #[test]
    fn dropped_fields_not_stored() {
        let (db, skill_id) = db_with_seeded_skill("rt-dropped");
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

        materialize_workflow_step_output_value(&db, &skill_id, 0, &json).unwrap();

        let conn = db.0.lock().unwrap();
        let record = crate::db::workflow_artifacts::read_clarifications(&conn, &skill_id)
            .unwrap()
            .unwrap();
        // priority_questions listed only Q1 and Q4 — all four must be stored to confirm
        // the field was ignored rather than used as a filter.
        assert_eq!(record.question_count, 4);
        let ids: Vec<&str> = record
            .questions
            .iter()
            .map(|q| q.question_id.as_str())
            .collect();
        assert!(
            ids.contains(&"Q2"),
            "Q2 not in priority_questions but must still be stored"
        );
        assert!(
            ids.contains(&"Q3"),
            "Q3 not in priority_questions but must still be stored"
        );
        // duplicates_removed == 2, but section_count must reflect the fixture (2), not the
        // noise value.
        assert_eq!(record.sections.len(), 2);
        assert_eq!(record.refinement_count, 0);
    }
}
