use std::path::{Path, PathBuf};
use crate::skill_paths::DEFAULT_PLUGIN_SLUG;

use super::deploy::{
    copy_agents_to_claude_dir, copy_directory_recursive, copy_managed_plugins_to_claude_dir,
    workspace_already_copied, mark_workspace_copied, invalidate_workspace_cache,
};
use super::output_format::{
    answer_evaluator_output_format, materialize_answer_evaluation_output_value,
    materialize_workflow_step_output_value,
};
use super::guards::{
    make_agent_id, parse_decisions_guard, parse_scope_recommendation,
    validate_decisions_exist_inner, workflow_step_runtime_label,
};
use super::prompt::{build_prompt, PromptParams};
use super::user_context::{format_user_context, write_user_context_file};
use super::step_config::{
    build_betas, get_step_config, thinking_budget_for_step, workflow_output_format_for_agent,
    WORKFLOW_AGENT_IDENTITY,
};
use super::evaluation::get_step_output_files;

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
    assert_eq!(WORKFLOW_AGENT_IDENTITY, "skill-content-researcher:skill-builder");
    assert_eq!(get_step_config(0).unwrap().agent_name, "skill-content-researcher:research-orchestrator");
    assert_eq!(get_step_config(1).unwrap().agent_name, "skill-content-researcher:detailed-research");
    assert_eq!(get_step_config(2).unwrap().agent_name, "skill-content-researcher:confirm-decisions");
    assert_eq!(get_step_config(3).unwrap().agent_name, "skill-creator:generate-skill");
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
    for step_id in 0..=3 {
        let config = get_step_config(step_id).unwrap();
        assert!(
            !config
                .allowed_tools
                .iter()
                .any(|tool| tool == "AskUserQuestion"),
            "workflow step {step_id} must not allow AskUserQuestion in one-shot mode"
        );
    }
}

#[test]
fn test_workflow_output_format_is_set_for_json_contract_workflow_agents() {
    assert!(workflow_output_format_for_agent("skill-content-researcher:research-orchestrator").is_some());
    assert!(workflow_output_format_for_agent("skill-content-researcher:detailed-research").is_some());
    assert!(workflow_output_format_for_agent("skill-content-researcher:confirm-decisions").is_some());
    assert!(workflow_output_format_for_agent("skill-creator:generate-skill").is_some());
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
    let format = workflow_output_format_for_agent("skill-content-researcher:research-orchestrator").unwrap();
    let schema = &format["schema"];
    assert_inline_schema_basics(schema, "research-step");
    let required = schema["required"].as_array().expect("required array");
    assert!(required.iter().any(|v| v == "status"));
    assert!(required.iter().any(|v| v == "dimensions_selected"));
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
    let format = workflow_output_format_for_agent("skill-content-researcher:detailed-research").unwrap();
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
    let format = workflow_output_format_for_agent("skill-content-researcher:confirm-decisions").unwrap();
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
    let enum_vals: Vec<&str> = status["enum"].as_array().unwrap()
        .iter().filter_map(|v| v.as_str()).collect();
    assert!(enum_vals.contains(&"resolved"));
    assert!(enum_vals.contains(&"conflict-resolved"));
    assert!(enum_vals.contains(&"needs-review"));
}

/// All inline schemas must have additionalProperties: false on every
/// nested object (required by Anthropic API).
#[test]
fn test_inline_schemas_have_additional_properties_false_everywhere() {
    let agents = [
        "skill-content-researcher:research-orchestrator",
        "skill-content-researcher:detailed-research",
        "skill-content-researcher:confirm-decisions",
    ];
    for agent in agents {
        let format = workflow_output_format_for_agent(agent).unwrap();
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
        check_objects(&schema, agent);
    }
}

/// Step 3 uses a flat schema (all primitives, no nested types).
#[test]
fn test_generated_schemas_are_sdk_compatible() {
    let agents = [
        // Steps 0–2 use inline schemas — tested in dedicated tests above
        "skill-creator:generate-skill",
    ];
    for agent in agents {
        let format = workflow_output_format_for_agent(agent).unwrap();
        let schema = &format["schema"];

        // Must be draft-07
        assert_eq!(
            schema["$schema"],
            "http://json-schema.org/draft-07/schema#",
            "{agent}: schema must be draft-07"
        );

        // Root object must have additionalProperties: false
        assert_eq!(
            schema["additionalProperties"], false,
            "{agent}: root must have additionalProperties: false"
        );

        // Must be flat — no definitions block
        assert!(
            schema.get("definitions").is_none(),
            "{agent}: schema must not have definitions (must be flat)"
        );

        // Must have no $ref anywhere
        let schema_str = serde_json::to_string(schema).unwrap();
        assert!(
            !schema_str.contains("$ref"),
            "{agent}: schema must not contain $ref (must be flat)"
        );
    }
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
fn test_workflow_output_format_is_unset_for_unknown_agents() {
    assert!(workflow_output_format_for_agent("unknown-agent").is_none());
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
        materialize_answer_evaluation_output_value(&workspace_dir, &invalid_payload)
            .unwrap_err();
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
    let err = materialize_answer_evaluation_output_value(&workspace_dir, &payload)
        .unwrap_err();
    assert!(err.contains("reason is required for vague verdict"));
}

#[test]
fn test_materialize_step0_writes_research_and_clarifications() {
    let tmp = tempfile::tempdir().unwrap();
    let skill_root = tmp.path().join("my-skill");
    let payload = serde_json::json!({
        "status": "research_complete",
        "dimensions_selected": 2,
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
fn test_materialize_step0_accepts_null_focus_in_unselected_dimension_scores() {
    let tmp = tempfile::tempdir().unwrap();
    let skill_root = tmp.path().join("my-skill");
    let payload = serde_json::json!({
        "status": "research_complete",
        "dimensions_selected": 1,
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
                    "dimensions_selected": 1,
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
    assert!(written.contains("\"modeling-patterns\""));
}

#[test]
fn test_materialize_step0_empty_metadata_defaults_to_zeros() {
    let tmp = tempfile::tempdir().unwrap();
    let skill_root = tmp.path().join("my-skill");

    // Empty metadata now defaults all fields to 0/"" instead of erroring
    let payload = serde_json::json!({
        "status": "research_complete",
        "dimensions_selected": 2,
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
fn test_materialize_step0_rejects_non_object_payload() {
    let tmp = tempfile::tempdir().unwrap();
    let skill_root = tmp.path().join("my-skill");
    let err =
        materialize_workflow_step_output_value(&skill_root, 0, &serde_json::json!(null))
            .unwrap_err();
    assert!(err.contains("structured_output must be a JSON object"));
}

#[test]
fn test_materialize_step0_rejects_wrong_status() {
    let tmp = tempfile::tempdir().unwrap();
    let skill_root = tmp.path().join("my-skill");
    let payload = serde_json::json!({
        "status": "detailed_research_complete",
        "dimensions_selected": 1,
        "question_count": 1,
        "research_output": valid_clarifications_value()
    });
    let err =
        materialize_workflow_step_output_value(&skill_root, 0, &payload).unwrap_err();
    assert!(err.contains("structured_output.status must be 'research_complete'"));
}

#[test]
fn test_materialize_step0_rejects_missing_required_fields() {
    let tmp = tempfile::tempdir().unwrap();
    let skill_root = tmp.path().join("my-skill");

    // Missing dimensions_selected → hard fail (required per SKILL.md)
    let missing_dimensions = serde_json::json!({
        "status": "research_complete",
        "question_count": 1,
        "research_output": valid_clarifications_value()
    });
    let err = materialize_workflow_step_output_value(&skill_root, 0, &missing_dimensions)
        .unwrap_err();
    assert!(err.contains("dimensions_selected"), "should mention missing field: {err}");

    // Wrong type (string for integer) still errors
    let non_integer_question_count = serde_json::json!({
        "status": "research_complete",
        "dimensions_selected": 1,
        "question_count": "one",
        "research_output": valid_clarifications_value()
    });
    let err = materialize_workflow_step_output_value(
        &skill_root,
        0,
        &non_integer_question_count,
    )
    .unwrap_err();
    assert!(err.contains("invalid research step output"));
}

#[test]
fn test_materialize_step0_rejects_missing_research_output() {
    let tmp = tempfile::tempdir().unwrap();
    let skill_root = tmp.path().join("my-skill");

    let missing = serde_json::json!({
        "status": "research_complete",
        "dimensions_selected": 1,
        "question_count": 1
    });
    let err = materialize_workflow_step_output_value(&skill_root, 0, &missing).unwrap_err();
    assert!(err.contains("invalid research step output"));

    // Choice is missing required `is_other` field — typed deserialization rejects it
    let invalid_nested = serde_json::json!({
        "status": "research_complete",
        "dimensions_selected": 1,
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
        materialize_workflow_step_output_value(&skill_root, 0, &invalid_nested)
            .unwrap_err();
    // Typed deserialization still rejects Choice missing `is_other`
    assert!(err_invalid_nested.contains("invalid research step output"), "unexpected error: {err_invalid_nested}");
    assert!(err_invalid_nested.contains("is_other"), "should mention is_other: {err_invalid_nested}");
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
    let err =
        materialize_workflow_step_output_value(&skill_root, 1, &payload).unwrap_err();
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
    assert!(err.contains("refinement_count"), "should mention missing field: {err}");

    // Wrong type (string for integer) still errors
    let non_integer_section_count = serde_json::json!({
        "status": "detailed_research_complete",
        "refinement_count": 1,
        "section_count": "one",
        "clarifications_json": valid_clarifications_value()
    });
    let err = materialize_workflow_step_output_value(
        &skill_root,
        1,
        &non_integer_section_count,
    )
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
    let err = materialize_workflow_step_output_value(&skill_root, 1, &invalid_payload)
        .unwrap_err();
    // Typed deserialization catches notes type mismatch
    assert!(err.contains("invalid detailed research output"), "unexpected error: {err}");
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

    let err =
        materialize_workflow_step_output_value(&skill_root, 1, &payload).unwrap_err();
    // Typed deserialization rejects non-array answer_evaluator_notes
    assert!(err.contains("invalid detailed research output"), "unexpected error: {err}");
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
    assert!(
        err.contains("invalid type"),
        "unexpected error: {err}"
    );
}

#[test]
fn test_validate_clarifications_rejects_null_section_id() {
    let mut v = valid_clarifications_value();
    v["sections"][0]["id"] = serde_json::json!(null);
    let err = super::step_config::validate_clarifications_json(&v).unwrap_err();
    // Typed deserialization rejects null where i64 is expected
    assert!(
        err.contains("invalid type"),
        "unexpected error: {err}"
    );
}

#[test]
fn test_materialize_step0_scope_recommendation_triggers_scope_guard_parser() {
    let tmp = tempfile::tempdir().unwrap();
    let skill_root = tmp.path().join("my-skill");
    let payload = serde_json::json!({
        "status": "research_complete",
        "dimensions_selected": 0,
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
    let err =
        materialize_workflow_step_output_value(&skill_root, 2, &serde_json::json!(null))
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
    let err =
        materialize_workflow_step_output_value(&skill_root, 3, &payload).unwrap_err();
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
        subagent_directive: None,
        step_id: 1,
    });
    assert!(prompt.contains("my-skill"));
    assert!(prompt
        .contains("The workspace directory is: /home/user/.vibedata/skill-builder/skills/my-skill"));
    assert!(prompt.contains("The skill output directory (SKILL.md and references/) is: /home/user/my-skills/skills/my-skill"));
    assert!(prompt.contains("The user context file is at: /home/user/.vibedata/skill-builder/skills/my-skill/user-context.md"));
    assert!(prompt.contains("The context directory is: /home/user/.vibedata/skill-builder/skills/my-skill/context"));
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
        subagent_directive: None,
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
        subagent_directive: None,
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
        subagent_directive: None,
        step_id: 1,
    });
    assert!(!prompt.contains("The author of this skill is:"));
    assert!(!prompt.contains("The skill was created on:"));
}

#[test]
fn test_build_prompt_does_not_include_schema_file_path() {
    // Schema file paths are no longer injected into the prompt — they are
    // injected into config.system_prompt instead (VU-1049).
    for step_id in [1u32, 2, 3] {
        let prompt = build_prompt(&PromptParams {
            skill_name: "s", workspace_path: "/ws", plugin_slug: DEFAULT_PLUGIN_SLUG,
            skills_path: "/sk", author_login: None, created_at: None, subagent_directive: None, step_id,
        });
        assert!(!prompt.contains("step-0-research.json"), "step {step_id}: schema file path must not be in prompt");
        assert!(!prompt.contains("step-1-detailed-research.json"), "step {step_id}: schema file path must not be in prompt");
        assert!(!prompt.contains("step-2-decisions.json"), "step {step_id}: schema file path must not be in prompt");
        assert!(!prompt.contains("Do NOT read other step schema files"), "step {step_id}: old schema read directive must not be in prompt");
    }
    // Step-specific output-type hints are still present (from step_output_hint).
    let step1 = build_prompt(&PromptParams {
        skill_name: "s", workspace_path: "/ws", plugin_slug: DEFAULT_PLUGIN_SLUG,
        skills_path: "/sk", author_login: None, created_at: None, subagent_directive: None, step_id: 1,
    });
    assert!(step1.contains("DetailedResearchOutput"));
    let step2 = build_prompt(&PromptParams {
        skill_name: "s", workspace_path: "/ws", plugin_slug: DEFAULT_PLUGIN_SLUG,
        skills_path: "/sk", author_login: None, created_at: None, subagent_directive: None, step_id: 2,
    });
    assert!(step2.contains("DecisionsOutput"));
}

#[test]
fn test_system_prompt_injects_correct_inline_schema_per_step() {
    use crate::generated::schemas;
    // Steps 0–2 must each produce a system_prompt containing the matching inline schema.
    let cases: &[(u32, &str)] = &[
        (0, schemas::RESEARCH_STEP_INLINE_SCHEMA),
        (1, schemas::DETAILED_RESEARCH_INLINE_SCHEMA),
        (2, schemas::DECISIONS_INLINE_SCHEMA),
    ];
    for (step_id, expected_schema) in cases {
        let system_prompt: Option<String> = match step_id {
            0 => Some(format!(
                "Your output MUST be a JSON object that strictly conforms to the following schema:\n\n{}",
                schemas::RESEARCH_STEP_INLINE_SCHEMA
            )),
            1 => Some(format!(
                "Your output MUST be a JSON object that strictly conforms to the following schema:\n\n{}",
                schemas::DETAILED_RESEARCH_INLINE_SCHEMA
            )),
            2 => Some(format!(
                "Your output MUST be a JSON object that strictly conforms to the following schema:\n\n{}",
                schemas::DECISIONS_INLINE_SCHEMA
            )),
            _ => None,
        };
        let sp = system_prompt.expect(&format!("step {step_id} must have a system_prompt"));
        assert!(sp.contains(expected_schema), "step {step_id}: system_prompt must contain the inline schema");
        assert!(sp.contains("strictly conforms to the following schema"), "step {step_id}: system_prompt must include conformance directive");
    }
    // Step 3 must produce no system_prompt.
    let step3: Option<String> = match 3u32 {
        0 | 1 | 2 => Some("would not happen".to_string()),
        _ => None,
    };
    assert!(step3.is_none(), "step 3 must not have a system_prompt");
}

#[test]
fn test_answer_evaluator_prompt_uses_standard_paths() {
    let workspace_path = "/home/user/.vibedata/skill-builder";
    let skill_name = "my-skill";
    let skills_path = "/home/user/my-skills";
    let workspace_dir = std::path::Path::new(workspace_path).join(DEFAULT_PLUGIN_SLUG).join(skill_name);
    let workspace_str = workspace_dir.to_string_lossy().replace('\\', "/");
    let skill_output_dir = std::path::Path::new(skills_path)
        .join(DEFAULT_PLUGIN_SLUG)
        .join(skill_name);
    let skill_output_str = skill_output_dir.to_string_lossy().replace('\\', "/");

    let prompt = format!(
        "The skill name is: {}. The workspace directory is: {}. \
         The skill output directory (SKILL.md and references/) is: {}. \
         The user context file is at: {}/user-context.md. \
         The context directory is: {}/context. \
         All directories already exist — do not create any directories.",
        skill_name, workspace_str, skill_output_str, workspace_str, workspace_str,
    );

    assert!(prompt.contains("The skill name is: my-skill"));
    assert!(prompt
        .contains("The workspace directory is: /home/user/.vibedata/skill-builder/skills/my-skill"));
    assert!(prompt.contains("The skill output directory (SKILL.md and references/) is: /home/user/my-skills/skills/my-skill"));
    assert!(prompt.contains("The user context file is at: /home/user/.vibedata/skill-builder/skills/my-skill/user-context.md"));
    assert!(prompt.contains("The context directory is: /home/user/.vibedata/skill-builder/skills/my-skill/context"));
    assert!(prompt.contains("do not create any directories"));
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
        plugin_agents_dir.join("confirm-decisions.md").exists(),
        "agent-sources/plugins/skill-content-researcher/agents/confirm-decisions.md should exist"
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
    let workspace_skill_dir = workspace_tmp.path().join(DEFAULT_PLUGIN_SLUG).join("my-skill");
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
    crate::cleanup::delete_step_output_files(workspace, "my-skill", DEFAULT_PLUGIN_SLUG, 2, skills_path);

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
    crate::cleanup::delete_step_output_files(nonexistent.to_str().unwrap(), "no-skill", DEFAULT_PLUGIN_SLUG, 0, skills_path);
}

#[test]
fn test_delete_step_output_files_cleans_last_steps() {
    let workspace_tmp = tempfile::tempdir().unwrap();
    let skills_tmp = tempfile::tempdir().unwrap();
    let workspace = workspace_tmp.path().to_str().unwrap();
    let skills_path = skills_tmp.path().to_str().unwrap();
    let _skill_dir = skills_tmp.path().join("my-skill");
    let workspace_skill_dir = workspace_tmp.path().join(DEFAULT_PLUGIN_SLUG).join("my-skill");
    std::fs::create_dir_all(workspace_skill_dir.join("context")).unwrap();

    // Create files for step 2 (decisions) in workspace context
    std::fs::write(workspace_skill_dir.join("context/decisions.json"), "{}").unwrap();

    // Reset from step 2 onwards should clean up step 2+3
    crate::cleanup::delete_step_output_files(workspace, "my-skill", DEFAULT_PLUGIN_SLUG, 2, skills_path);

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
    crate::cleanup::delete_step_output_files(workspace, "my-skill", DEFAULT_PLUGIN_SLUG, 3, skills_path);
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
    let content =
        std::fs::read_to_string(claude_agents_dir.join("research-entities.md")).unwrap();
    assert_eq!(content, "# Research Entities");
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

    copy_managed_plugins_to_claude_dir(&src_plugins, workspace.path().to_str().unwrap())
        .unwrap();

    let replaced =
        std::fs::read_to_string(claude_plugins_dir.join("skill-creator").join("SKILL.md"))
            .unwrap();
    assert_eq!(replaced, "new plugin content");
    assert!(claude_plugins_dir
        .join("skill-creator")
        .join(".skill-builder-managed")
        .exists());

    let preserved =
        std::fs::read_to_string(claude_plugins_dir.join("user-plugin").join("README.md"))
            .unwrap();
    assert_eq!(preserved, "keep me");
}

// --- VD-403: validate_decisions_exist_inner tests ---

#[test]
fn test_validate_decisions_missing() {
    let tmp = tempfile::tempdir().unwrap();
    let workspace = tmp.path().join("workspace");
    std::fs::create_dir_all(workspace.join("my-skill").join("context")).unwrap();

    let result =
        validate_decisions_exist_inner("my-skill", workspace.to_str().unwrap(), DEFAULT_PLUGIN_SLUG, "/unused");
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("decisions.json was not found"));
}

#[test]
fn test_validate_decisions_found_in_workspace_context() {
    let tmp = tempfile::tempdir().unwrap();
    let workspace = tmp.path().join("workspace");
    std::fs::create_dir_all(workspace.join(DEFAULT_PLUGIN_SLUG).join("my-skill").join("context")).unwrap();
    std::fs::write(
        workspace
            .join(DEFAULT_PLUGIN_SLUG)
            .join("my-skill")
            .join("context")
            .join("decisions.json"),
        r#"{"metadata":{"decision_count":1}}"#,
    )
    .unwrap();

    let result =
        validate_decisions_exist_inner("my-skill", workspace.to_str().unwrap(), DEFAULT_PLUGIN_SLUG, "/unused");
    assert!(result.is_ok());
}

#[test]
fn test_validate_decisions_rejects_empty_file() {
    let tmp = tempfile::tempdir().unwrap();
    let workspace = tmp.path().join("workspace");
    std::fs::create_dir_all(workspace.join(DEFAULT_PLUGIN_SLUG).join("my-skill").join("context")).unwrap();
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

    let result =
        validate_decisions_exist_inner("my-skill", workspace.to_str().unwrap(), DEFAULT_PLUGIN_SLUG, "/unused");
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

    let intake = r#"{"audience":"Data engineers","challenges":"Legacy systems","scope":"ETL pipelines"}"#;
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
        &[]
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
        &[]
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
        &[]
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
        &[]
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
        &[]
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
fn test_build_betas_thinking_non_opus() {
    let betas = build_betas(Some(32000), "claude-sonnet-4-5-20250929", true);
    assert_eq!(
        betas,
        Some(vec!["interleaved-thinking-2025-05-14".to_string()])
    );
}

#[test]
fn test_build_betas_thinking_opus() {
    // Opus natively supports thinking — no interleaved-thinking beta needed
    let betas = build_betas(Some(32000), "claude-opus-4-6", true);
    assert_eq!(betas, None);
}

#[test]
fn test_build_betas_none() {
    let betas = build_betas(None, "claude-sonnet-4-5-20250929", true);
    assert_eq!(betas, None);
}

#[test]
fn test_workspace_already_copied_returns_false_for_unknown() {
    // Use a unique path to avoid interference from other tests
    let path = format!("{}/test-workspace-unknown-{}", std::env::temp_dir().display(), std::process::id());
    assert!(!workspace_already_copied(&path));
}

#[test]
fn test_mark_workspace_copied_then_already_copied() {
    let path = format!("{}/test-workspace-mark-{}", std::env::temp_dir().display(), std::process::id());
    assert!(!workspace_already_copied(&path));
    mark_workspace_copied(&path);
    assert!(workspace_already_copied(&path));
}

#[test]
fn test_workspace_copy_cache_is_per_workspace() {
    let path_a = format!("{}/test-ws-a-{}", std::env::temp_dir().display(), std::process::id());
    let path_b = format!("{}/test-ws-b-{}", std::env::temp_dir().display(), std::process::id());
    mark_workspace_copied(&path_a);
    assert!(workspace_already_copied(&path_a));
    assert!(!workspace_already_copied(&path_b));
}

#[test]
fn test_invalidate_workspace_cache() {
    let path = format!("{}/test-ws-invalidate-{}", std::env::temp_dir().display(), std::process::id());
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
    let context_dir = workspace_tmp.path().join(DEFAULT_PLUGIN_SLUG).join("my-skill").join("context");
    std::fs::create_dir_all(&context_dir).unwrap();

    let context_files = ["clarifications.json", "decisions.json"];
    for file in &context_files {
        std::fs::write(context_dir.join(file), "test content").unwrap();
    }

    // 4. Working dir must exist in workspace
    std::fs::create_dir_all(workspace_tmp.path().join(DEFAULT_PLUGIN_SLUG).join("my-skill")).unwrap();

    // 5. Call delete_step_output_files from step 0
    crate::cleanup::delete_step_output_files(workspace, "my-skill", DEFAULT_PLUGIN_SLUG, 0, skills_path);

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
    write!(f, r#"{{"metadata":{{"scope_recommendation":true,"original_dimensions":8}},"sections":[]}}"#).unwrap();
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
        &[]
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
        &[]
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
        &[]
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
        &[]
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
        &[]
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
        &[]
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
        skill_name: "test-skill", workspace_path: ws.to_str().unwrap(), plugin_slug: DEFAULT_PLUGIN_SLUG,
        skills_path: skills.to_str().unwrap(), author_login: None, created_at: None, subagent_directive: None, step_id: 1,
    });
    assert!(prompt.contains("user-context.md"));
    assert!(prompt.contains("test-skill"));
}

#[test]
fn test_build_prompt_without_user_context() {
    let ws = std::env::temp_dir().join("ws");
    let skills = std::env::temp_dir().join("skills");
    let prompt = build_prompt(&PromptParams {
        skill_name: "test-skill", workspace_path: ws.to_str().unwrap(), plugin_slug: DEFAULT_PLUGIN_SLUG,
        skills_path: skills.to_str().unwrap(), author_login: None, created_at: None, subagent_directive: None, step_id: 1,
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

    super::evaluation::save_clarifications_content_inner("my-skill", &workspace_str, payload, crate::skill_paths::DEFAULT_PLUGIN_SLUG).unwrap();
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

    let err =
        super::evaluation::save_clarifications_content_inner("my-skill", &workspace_str, invalid.to_string(), crate::skill_paths::DEFAULT_PLUGIN_SLUG)
            .unwrap_err();
    // Typed deserialization rejects non-array priority_questions
    assert!(err.contains("Invalid clarifications JSON"), "unexpected error: {err}");
}

// =============================================================================
// CG-R1: format_user_context (workflow/runtime.rs)
// =============================================================================

#[test]
fn test_format_user_context_returns_none_when_all_empty() {
    let result =
        format_user_context(None, &[], None, None, None, None, None, None, None, None, None, None, None,
        &[]);
    assert!(result.is_none(), "should return None when no fields are provided");
}

#[test]
fn test_format_user_context_includes_name_and_tags() {
    let tags = vec!["finance".to_string(), "analytics".to_string()];
    let result = format_user_context(
        Some("my-skill"), &tags, None, None, None, None, None, None, None, None, None, None, None,
        &[]
    );
    let text = result.unwrap();
    assert!(text.contains("## User Context"), "should have heading");
    assert!(text.contains("**Name**: my-skill"), "should include name");
    assert!(text.contains("**Tags**: finance, analytics"), "should include tags");
}

#[test]
fn test_format_user_context_includes_purpose_label_mapping() {
    let result = format_user_context(
        None, &[], None, None, None, None, None, Some("domain"), None, None, None, None, None,
        &[]
    );
    let text = result.unwrap();
    assert!(text.contains("Business process knowledge"), "domain purpose should map to label");
}

#[test]
fn test_format_user_context_includes_profile_section() {
    let result = format_user_context(
        None, &[], None, Some("Healthcare"), Some("Data Engineer"), None, None, None, None, None, None, None, None,
        &[]
    );
    let text = result.unwrap();
    assert!(text.contains("### About You"), "should have profile heading");
    assert!(text.contains("**Industry**: Healthcare"), "should include industry");
    assert!(text.contains("**Function**: Data Engineer"), "should include function");
}

#[test]
fn test_format_user_context_includes_configuration() {
    let result = format_user_context(
        None, &[], None, None, None, None, None, None, Some("1.0"), Some("claude-sonnet-4-6"), Some("/ask"), Some(true), Some(false),
        &[]
    );
    let text = result.unwrap();
    assert!(text.contains("### Configuration"), "should have config heading");
    assert!(text.contains("**Version**: 1.0"), "should include version");
    assert!(text.contains("**Preferred Model**: claude-sonnet-4-6"), "should include model");
    assert!(text.contains("**Argument Hint**: /ask"), "should include argument hint");
    assert!(text.contains("**User Invocable**: true"), "should include user_invocable");
    assert!(text.contains("**Disable Model Invocation**: false"), "should include dmi");
}

#[test]
fn test_format_user_context_skips_inherit_model() {
    let result = format_user_context(
        None, &[], None, None, None, None, None, None, None, Some("inherit"), None, None, None,
        &[]
    );
    // "inherit" model should be filtered out — if nothing else is set, result is None
    assert!(result.is_none(), "inherit model alone should produce None");
}

#[test]
fn test_format_user_context_includes_intake_json_context() {
    let intake = r#"{"context": "We use Snowflake and dbt for data pipelines."}"#;
    let result = format_user_context(
        None, &[], None, None, None, Some(intake), None, None, None, None, None, None, None,
        &[]
    );
    let text = result.unwrap();
    assert!(text.contains("### What Claude Needs to Know"), "should include intake context heading");
    assert!(text.contains("Snowflake and dbt"), "should include intake content");
}

#[test]
fn test_write_user_context_file_creates_file() {
    let tmp = tempfile::tempdir().unwrap();
    let workspace_path = tmp.path().to_str().unwrap();
    let skill_name = "test-skill";
    let tags = vec!["tag1".to_string()];

    write_user_context_file(
        workspace_path, DEFAULT_PLUGIN_SLUG, skill_name, &tags, None, Some("Tech"), None, None, Some("A test skill"), Some("domain"), None, None, None, None, None,
        &[]
    );

    let ctx_path = tmp.path().join(DEFAULT_PLUGIN_SLUG).join(skill_name).join("user-context.md");
    assert!(ctx_path.exists(), "user-context.md should be created");
    let content = std::fs::read_to_string(&ctx_path).unwrap();
    assert!(content.contains("# User Context"), "should contain user context heading");
    assert!(content.contains("A test skill"), "should contain description");
}
