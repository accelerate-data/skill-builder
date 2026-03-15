use std::path::{Path, PathBuf};

use super::deploy::{
    copy_agents_to_claude_dir, copy_directory_recursive, copy_managed_plugins_to_claude_dir,
    workspace_already_copied, mark_workspace_copied, invalidate_workspace_cache,
};
use super::evaluation::{
    read_skills_path, read_workspace_path, workflow_step_log_name,
};
use super::output_format::{
    answer_evaluator_output_format, materialize_answer_evaluation_output_value,
    materialize_workflow_step_output_value,
};
use super::packaging::create_skill_zip;
use super::guards::{
    derive_agent_name, make_agent_id, parse_decisions_guard, parse_scope_recommendation,
    validate_decisions_exist_inner, workflow_step_runtime_label,
};
use super::prompt::build_prompt;
use super::user_context::{format_user_context, write_user_context_file};
use super::step_config::{
    build_betas, get_step_config, required_plugins_for_workflow_step,
    thinking_budget_for_step, workflow_output_format_for_agent,
};
use super::evaluation::get_step_output_files;
use super::claude_md::{generate_skills_section};

fn valid_clarifications_value() -> serde_json::Value {
    serde_json::json!({
        "version": "1",
        "metadata": {
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
fn test_required_plugins_for_workflow_step_matches_policy() {
    assert_eq!(
        required_plugins_for_workflow_step(0),
        Some(vec!["skill-content-researcher".to_string()])
    );
    assert_eq!(
        required_plugins_for_workflow_step(1),
        Some(vec!["skill-content-researcher".to_string()])
    );
    assert_eq!(required_plugins_for_workflow_step(2), Some(vec![]));
    assert_eq!(
        required_plugins_for_workflow_step(3),
        Some(vec!["skill-creator".to_string()])
    );
    assert_eq!(required_plugins_for_workflow_step(99), None);
}

#[test]
fn test_workflow_output_format_is_set_for_json_contract_workflow_agents() {
    assert!(workflow_output_format_for_agent("research-orchestrator").is_some());
    assert!(workflow_output_format_for_agent("detailed-research").is_some());
    assert!(workflow_output_format_for_agent("confirm-decisions").is_some());
    assert!(workflow_output_format_for_agent("generate-skill").is_some());
}

#[test]
fn test_research_output_format_requires_artifact_fields() {
    let format = workflow_output_format_for_agent("research-orchestrator").unwrap();
    let required = format["schema"]["required"]
        .as_array()
        .expect("required array");
    assert!(required.iter().any(|v| v == "research_output"));
    assert!(!required.iter().any(|v| v == "research_plan_markdown"));
    assert!(!required.iter().any(|v| v == "clarifications_json"));
}

#[test]
fn test_detailed_research_output_format_requires_clarifications_payload() {
    let format = workflow_output_format_for_agent("detailed-research").unwrap();
    let required = format["schema"]["required"]
        .as_array()
        .expect("required array");
    assert!(required.iter().any(|v| v == "clarifications_json"));
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
    assert_eq!(
        schema["properties"]["verdict"]["enum"],
        serde_json::json!(["sufficient", "mixed", "insufficient"])
    );
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
fn test_materialize_answer_evaluation_rejects_missing_per_question_array() {
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
    let err = materialize_answer_evaluation_output_value(&workspace_dir, &payload)
        .unwrap_err();
    assert!(err.contains("invalid answer evaluation output"));
    assert!(err.contains("per_question"));
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
fn test_materialize_step0_validation_failure_keeps_existing_files() {
    let tmp = tempfile::tempdir().unwrap();
    let skill_root = tmp.path().join("my-skill");
    let context_dir = skill_root.join("context");
    std::fs::create_dir_all(&context_dir).unwrap();
    std::fs::write(context_dir.join("clarifications.json"), "{\"old\":true}").unwrap();

    let invalid_payload = serde_json::json!({
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

    let err = materialize_workflow_step_output_value(&skill_root, 0, &invalid_payload)
        .unwrap_err();
    assert!(err.contains("Invalid research_output"));
    assert_eq!(
        std::fs::read_to_string(context_dir.join("clarifications.json")).unwrap(),
        "{\"old\":true}"
    );
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
fn test_materialize_step0_rejects_missing_or_invalid_numeric_fields() {
    let tmp = tempfile::tempdir().unwrap();
    let skill_root = tmp.path().join("my-skill");

    let missing_dimensions = serde_json::json!({
        "status": "research_complete",
        "question_count": 1,
        "research_output": valid_clarifications_value()
    });
    let err_missing_dimensions =
        materialize_workflow_step_output_value(&skill_root, 0, &missing_dimensions)
            .unwrap_err();
    assert!(err_missing_dimensions.contains("invalid research step output"));
    assert!(err_missing_dimensions.contains("dimensions_selected"));

    let non_integer_question_count = serde_json::json!({
        "status": "research_complete",
        "dimensions_selected": 1,
        "question_count": "one",
        "research_output": valid_clarifications_value()
    });
    let err_non_integer_question_count = materialize_workflow_step_output_value(
        &skill_root,
        0,
        &non_integer_question_count,
    )
    .unwrap_err();
    assert!(err_non_integer_question_count.contains("invalid research step output"));
}

#[test]
fn test_materialize_step0_rejects_missing_or_invalid_research_output() {
    let tmp = tempfile::tempdir().unwrap();
    let skill_root = tmp.path().join("my-skill");

    let missing = serde_json::json!({
        "status": "research_complete",
        "dimensions_selected": 1,
        "question_count": 1
    });
    let err_missing =
        materialize_workflow_step_output_value(&skill_root, 0, &missing).unwrap_err();
    assert!(err_missing.contains("invalid research step output"));
    assert!(err_missing.contains("research_output"));

    let invalid_nested = serde_json::json!({
        "status": "research_complete",
        "dimensions_selected": 1,
        "question_count": 1,
        "research_output": {
            "version": "1",
            "metadata": {
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
    assert!(err_invalid_nested.contains("Invalid research_output"));
    assert!(err_invalid_nested.contains("is_other must be a boolean"));
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
fn test_materialize_step1_rejects_missing_or_invalid_numeric_fields() {
    let tmp = tempfile::tempdir().unwrap();
    let skill_root = tmp.path().join("my-skill");

    let missing_refinement_count = serde_json::json!({
        "status": "detailed_research_complete",
        "section_count": 1,
        "clarifications_json": valid_clarifications_value()
    });
    let err_missing_refinement_count = materialize_workflow_step_output_value(
        &skill_root,
        1,
        &missing_refinement_count,
    )
    .unwrap_err();
    assert!(err_missing_refinement_count.contains("invalid detailed research output"));
    assert!(err_missing_refinement_count.contains("refinement_count"));

    let non_integer_section_count = serde_json::json!({
        "status": "detailed_research_complete",
        "refinement_count": 1,
        "section_count": "one",
        "clarifications_json": valid_clarifications_value()
    });
    let err_non_integer_section_count = materialize_workflow_step_output_value(
        &skill_root,
        1,
        &non_integer_section_count,
    )
    .unwrap_err();
    assert!(err_non_integer_section_count.contains("invalid detailed research output"));
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
    let err =
        materialize_workflow_step_output_value(&skill_root, 1, &payload).unwrap_err();
    assert!(err.contains("invalid detailed research output"));
    assert!(err.contains("clarifications_json"));
}

#[test]
fn test_materialize_step1_validation_failure_keeps_existing_clarifications() {
    let tmp = tempfile::tempdir().unwrap();
    let skill_root = tmp.path().join("my-skill");
    let context_dir = skill_root.join("context");
    std::fs::create_dir_all(&context_dir).unwrap();
    std::fs::write(context_dir.join("clarifications.json"), "{\"old\":true}").unwrap();

    let invalid_payload = serde_json::json!({
        "status": "detailed_research_complete",
        "refinement_count": 1,
        "section_count": 1,
        "clarifications_json": {
            "version": "1",
            "metadata": {
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
    assert!(err.contains("Invalid clarifications_json"));
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
    assert!(err.contains("answer_evaluator_notes must be an array when present"));
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
    assert!(
        err.contains("sections[0].id must be a number"),
        "unexpected error: {err}"
    );
}

#[test]
fn test_validate_clarifications_rejects_null_section_id() {
    let mut v = valid_clarifications_value();
    v["sections"][0]["id"] = serde_json::json!(null);
    let err = super::step_config::validate_clarifications_json(&v).unwrap_err();
    assert!(
        err.contains("sections[0].id must be a number"),
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
        "decisions": [{ "id": "D1", "title": "Capability", "decision": "A" }]
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
        "metadata": { "scope_recommendation": true, "decision_count": 0 },
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
        "metadata": { "decision_count": 2, "contradictory_inputs": true },
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
        "metadata": { "decision_count": 2, "contradictory_inputs": false },
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
fn test_materialize_step3_writes_evaluations() {
    let tmp = tempfile::tempdir().unwrap();
    let skill_root = tmp.path().join("my-skill");
    let payload = serde_json::json!({
        "status": "generated",
        "evaluations_markdown": "## Scenario 1\n- input\n- expected output\n"
    });
    materialize_workflow_step_output_value(&skill_root, 3, &payload).unwrap();
    assert!(skill_root.join("context/evaluations.md").exists());
}

#[test]
fn test_materialize_step3_rejects_wrong_status() {
    let tmp = tempfile::tempdir().unwrap();
    let skill_root = tmp.path().join("my-skill");
    let payload = serde_json::json!({
        "status": "decisions_complete",
        "evaluations_markdown": "## Scenario 1\n- input\n- expected output\n"
    });
    let err =
        materialize_workflow_step_output_value(&skill_root, 3, &payload).unwrap_err();
    assert!(err.contains("structured_output.status must be 'generated'"));
}

#[test]
fn test_materialize_step3_rejects_missing_or_invalid_evaluations_markdown() {
    let tmp = tempfile::tempdir().unwrap();
    let skill_root = tmp.path().join("my-skill");

    let missing = serde_json::json!({
        "status": "generated"
    });
    let err_missing =
        materialize_workflow_step_output_value(&skill_root, 3, &missing).unwrap_err();
    assert!(err_missing.contains("invalid generate skill output"));
    assert!(err_missing.contains("evaluations_markdown"));

    let non_string = serde_json::json!({
        "status": "generated",
        "evaluations_markdown": ["not", "markdown"]
    });
    let err_non_string =
        materialize_workflow_step_output_value(&skill_root, 3, &non_string).unwrap_err();
    assert!(err_non_string.contains("invalid generate skill output"));

    let empty = serde_json::json!({
        "status": "generated",
        "evaluations_markdown": ""
    });
    let err_empty =
        materialize_workflow_step_output_value(&skill_root, 3, &empty).unwrap_err();
    assert!(err_empty.contains("structured_output.evaluations_markdown must not be empty"));
}

#[test]
fn test_build_prompt_all_three_paths() {
    let prompt = build_prompt(
        "my-skill",
        "/home/user/.vibedata/skill-builder",
        "/home/user/my-skills",
        None,
        None,
        5,
    );
    assert!(prompt.contains("my-skill"));
    assert!(prompt
        .contains("The workspace directory is: /home/user/.vibedata/skill-builder/my-skill"));
    assert!(prompt.contains("The skill output directory (SKILL.md and references/) is: /home/user/my-skills/my-skill"));
    assert!(prompt.contains("Read user-context.md from the workspace directory"));
    assert!(prompt.contains("Derive context_dir as workspace_dir/context"));
}

#[test]
fn test_build_prompt_with_skill_type() {
    let prompt = build_prompt(
        "my-skill",
        "/home/user/.vibedata/skill-builder",
        "/home/user/my-skills",
        None,
        None,
        5,
    );
    // Purpose is now in user-context.md, read by the agent
    assert!(prompt.contains("user-context.md"));
}

#[test]
fn test_build_prompt_with_author_info() {
    let prompt = build_prompt(
        "my-skill",
        "/home/user/.vibedata/skill-builder",
        "/home/user/my-skills",
        Some("octocat"),
        Some("2025-06-15T12:00:00Z"),
        5,
    );
    assert!(prompt.contains("The author of this skill is: octocat."));
    assert!(prompt.contains("The skill was created on: 2025-06-15."));
    assert!(prompt.contains("Today's date (for the modified timestamp) is:"));
}

#[test]
fn test_build_prompt_without_author_info() {
    let prompt = build_prompt(
        "my-skill",
        "/home/user/.vibedata/skill-builder",
        "/home/user/my-skills",
        None,
        None,
        5,
    );
    assert!(!prompt.contains("The author of this skill is:"));
    assert!(!prompt.contains("The skill was created on:"));
}

#[test]
fn test_answer_evaluator_prompt_uses_standard_paths() {
    let workspace_path = "/home/user/.vibedata/skill-builder";
    let skill_name = "my-skill";
    let skills_path = "/home/user/my-skills";
    let workspace_dir = std::path::Path::new(workspace_path).join(skill_name);
    let workspace_str = workspace_dir.to_string_lossy().replace('\\', "/");
    let skill_output_str = std::path::Path::new(skills_path)
        .join(skill_name)
        .to_string_lossy()
        .replace('\\', "/");

    let prompt = format!(
        "The skill name is: {}. The workspace directory is: {}. \
         The skill output directory (SKILL.md and references/) is: {}. \
         Read user-context.md from the workspace directory. \
         Derive context_dir as workspace_dir/context. \
         All directories already exist — do not create any directories.",
        skill_name, workspace_str, skill_output_str,
    );

    assert!(prompt.contains("The skill name is: my-skill"));
    assert!(prompt
        .contains("The workspace directory is: /home/user/.vibedata/skill-builder/my-skill"));
    assert!(prompt.contains("The skill output directory (SKILL.md and references/) is: /home/user/my-skills/my-skill"));
    assert!(prompt.contains("Read user-context.md from the workspace directory"));
    assert!(prompt.contains("Derive context_dir as workspace_dir/context"));
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

#[test]
fn test_package_skill_creates_zip() {
    let tmp = tempfile::tempdir().unwrap();
    // source_dir now has SKILL.md and references/ directly (no skill/ subdir)
    let source_dir = tmp.path().join("my-skill");
    std::fs::create_dir_all(source_dir.join("references")).unwrap();

    std::fs::write(source_dir.join("SKILL.md"), "# My Skill").unwrap();
    std::fs::write(
        source_dir.join("references").join("deep-dive.md"),
        "# Deep Dive",
    )
    .unwrap();

    // Extra files that should NOT be included in the zip
    std::fs::create_dir_all(source_dir.join("context")).unwrap();
    std::fs::write(source_dir.join("context").join("decisions.json"), "{}").unwrap();
    std::fs::write(source_dir.join("workflow.md"), "# Workflow").unwrap();

    let output_path = source_dir.join("my-skill.skill");
    let result = create_skill_zip(&source_dir, &output_path).unwrap();

    assert!(Path::new(&result.file_path).exists());
    assert!(result.size_bytes > 0);

    let file = std::fs::File::open(&result.file_path).unwrap();
    let mut archive = zip::ZipArchive::new(file).unwrap();

    let names: Vec<String> = (0..archive.len())
        .map(|i| archive.by_index(i).unwrap().name().to_string())
        .collect();

    assert!(names.contains(&"SKILL.md".to_string()));
    assert!(names.contains(&"references/deep-dive.md".to_string()));
    assert!(!names.iter().any(|n| n.starts_with("context/")));
    assert!(!names.contains(&"workflow.md".to_string()));
}

#[test]
fn test_package_skill_nested_references() {
    let tmp = tempfile::tempdir().unwrap();
    // source_dir has SKILL.md and references/ directly
    let source_dir = tmp.path().join("nested-skill");
    std::fs::create_dir_all(source_dir.join("references").join("sub")).unwrap();

    std::fs::write(source_dir.join("SKILL.md"), "# Nested").unwrap();
    std::fs::write(source_dir.join("references").join("top.md"), "top level").unwrap();
    std::fs::write(
        source_dir.join("references").join("sub").join("nested.md"),
        "nested ref",
    )
    .unwrap();

    let output_path = source_dir.join("nested-skill.skill");
    let result = create_skill_zip(&source_dir, &output_path).unwrap();

    let file = std::fs::File::open(&result.file_path).unwrap();
    let mut archive = zip::ZipArchive::new(file).unwrap();

    let names: Vec<String> = (0..archive.len())
        .map(|i| archive.by_index(i).unwrap().name().to_string())
        .collect();

    assert!(names.contains(&"SKILL.md".to_string()));
    assert!(names.contains(&"references/top.md".to_string()));
    assert!(names.contains(&"references/sub/nested.md".to_string()));
}

#[test]
fn test_package_skill_missing_dir() {
    let result = create_skill_zip(
        Path::new("/nonexistent/path"),
        Path::new("/nonexistent/output.skill"),
    );
    assert!(result.is_err());
}

// Tests for copy_directory_to removed — function no longer exists
// (agents tree is no longer deployed to workspace root)

#[test]
fn test_resolve_prompts_dir_dev_mode() {
    // In dev/test mode, CARGO_MANIFEST_DIR is set and the repo root has agent-sources/agents/
    let dev_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|p| p.parent())
        .map(|p| p.join("agent-sources").join("agents"));
    assert!(dev_path.is_some());
    let agents_dir = dev_path.unwrap();
    assert!(
        agents_dir.is_dir(),
        "Repo root agent-sources/agents/ should exist"
    );
    // Verify flat agent files exist (no subdirectories)
    assert!(
        agents_dir.join("research-orchestrator.md").exists(),
        "agent-sources/agents/research-orchestrator.md should exist"
    );
    assert!(
        agents_dir.join("validate-skill.md").exists(),
        "agent-sources/agents/validate-skill.md should exist"
    );
}

#[test]
fn test_delete_step_output_files_from_step_onwards() {
    let workspace_tmp = tempfile::tempdir().unwrap();
    let skills_tmp = tempfile::tempdir().unwrap();
    let workspace = workspace_tmp.path().to_str().unwrap();
    let skills_path = skills_tmp.path().to_str().unwrap();
    // Context files live in workspace_path/skill_name/context/
    let skill_dir = skills_tmp.path().join("my-skill");
    let workspace_skill_dir = workspace_tmp.path().join("my-skill");
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
    crate::cleanup::delete_step_output_files(workspace, "my-skill", 2, skills_path);

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
    crate::cleanup::clean_step_output_thorough(workspace, "my-skill", 1, skills_path);

    assert!(skill_dir.join("context/clarifications.json").exists());
    assert!(skill_dir.join("context/decisions.json").exists());
}

#[test]
fn test_delete_step_output_files_nonexistent_dir_is_ok() {
    // Should not panic on nonexistent directory
    let tmp = tempfile::tempdir().unwrap();
    let skills_path = tmp.path().to_str().unwrap();
    crate::cleanup::delete_step_output_files("/tmp/nonexistent", "no-skill", 0, skills_path);
}

#[test]
fn test_delete_step_output_files_cleans_last_steps() {
    let workspace_tmp = tempfile::tempdir().unwrap();
    let skills_tmp = tempfile::tempdir().unwrap();
    let workspace = workspace_tmp.path().to_str().unwrap();
    let skills_path = skills_tmp.path().to_str().unwrap();
    let _skill_dir = skills_tmp.path().join("my-skill");
    let workspace_skill_dir = workspace_tmp.path().join("my-skill");
    std::fs::create_dir_all(workspace_skill_dir.join("context")).unwrap();

    // Create files for step 2 (decisions) in workspace context
    std::fs::write(workspace_skill_dir.join("context/decisions.json"), "{}").unwrap();

    // Reset from step 2 onwards should clean up step 2+3
    crate::cleanup::delete_step_output_files(workspace, "my-skill", 2, skills_path);

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
    crate::cleanup::delete_step_output_files(workspace, "my-skill", 3, skills_path);
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
fn test_derive_agent_name_fallback() {
    // Without deployed agent files, falls back to phase name
    let tmp = tempfile::tempdir().unwrap();
    let ws = tmp.path().to_str().unwrap();
    assert_eq!(
        derive_agent_name(ws, "domain", "research-orchestrator.md"),
        "research-orchestrator"
    );
    assert_eq!(
        derive_agent_name(ws, "platform", "generate-skill.md"),
        "generate-skill"
    );
}

#[test]
fn test_derive_agent_name_reads_frontmatter() {
    let tmp = tempfile::tempdir().unwrap();
    let ws = tmp.path().to_str().unwrap();
    let agents_dir = tmp.path().join(".claude").join("agents");
    std::fs::create_dir_all(&agents_dir).unwrap();

    std::fs::write(
        agents_dir.join("research-orchestrator.md"),
        "---\nname: research-orchestrator\nmodel: sonnet\n---\n# Agent\n",
    )
    .unwrap();

    assert_eq!(
        derive_agent_name(ws, "data-engineering", "research-orchestrator.md"),
        "research-orchestrator"
    );
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

// --- Task 5: create_skill_zip excludes context/ ---

#[test]
fn test_create_skill_zip_excludes_context_directory() {
    let tmp = tempfile::tempdir().unwrap();
    let source_dir = tmp.path().join("my-skill");
    std::fs::create_dir_all(source_dir.join("references")).unwrap();
    std::fs::create_dir_all(source_dir.join("context")).unwrap();

    std::fs::write(source_dir.join("SKILL.md"), "# My Skill").unwrap();
    std::fs::write(source_dir.join("references").join("ref.md"), "# Ref").unwrap();
    // These context files should be EXCLUDED from the zip
    std::fs::write(source_dir.join("context").join("clarifications.json"), "{}").unwrap();
    std::fs::write(source_dir.join("context").join("decisions.json"), "{}").unwrap();

    let output_path = source_dir.join("my-skill.skill");
    let result = create_skill_zip(&source_dir, &output_path).unwrap();

    let file = std::fs::File::open(&result.file_path).unwrap();
    let mut archive = zip::ZipArchive::new(file).unwrap();

    let names: Vec<String> = (0..archive.len())
        .map(|i| archive.by_index(i).unwrap().name().to_string())
        .collect();

    // Should include SKILL.md and references
    assert!(names.contains(&"SKILL.md".to_string()));
    assert!(names.contains(&"references/ref.md".to_string()));
    // Should NOT include any context files
    assert!(!names.iter().any(|n| n.starts_with("context/")));
    assert!(!names.iter().any(|n| n.contains("clarifications")));
    assert!(!names.iter().any(|n| n.contains("decisions")));
}

// --- VD-403: validate_decisions_exist_inner tests ---

#[test]
fn test_validate_decisions_missing() {
    let tmp = tempfile::tempdir().unwrap();
    let workspace = tmp.path().join("workspace");
    std::fs::create_dir_all(workspace.join("my-skill").join("context")).unwrap();

    let result =
        validate_decisions_exist_inner("my-skill", workspace.to_str().unwrap(), "/unused");
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("decisions.json was not found"));
}

#[test]
fn test_validate_decisions_found_in_workspace_context() {
    let tmp = tempfile::tempdir().unwrap();
    let workspace = tmp.path().join("workspace");
    std::fs::create_dir_all(workspace.join("my-skill").join("context")).unwrap();
    std::fs::write(
        workspace
            .join("my-skill")
            .join("context")
            .join("decisions.json"),
        r#"{"metadata":{"decision_count":1}}"#,
    )
    .unwrap();

    let result =
        validate_decisions_exist_inner("my-skill", workspace.to_str().unwrap(), "/unused");
    assert!(result.is_ok());
}

#[test]
fn test_validate_decisions_rejects_empty_file() {
    let tmp = tempfile::tempdir().unwrap();
    let workspace = tmp.path().join("workspace");
    std::fs::create_dir_all(workspace.join("my-skill").join("context")).unwrap();
    // Write an empty decisions file
    std::fs::write(
        workspace
            .join("my-skill")
            .join("context")
            .join("decisions.json"),
        "   \n\n  ",
    )
    .unwrap();

    let result =
        validate_decisions_exist_inner("my-skill", workspace.to_str().unwrap(), "/unused");
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
        (3, 120), // generate skill
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
    let steps_with_expected_turns = [(0, 50), (1, 50), (2, 100), (3, 120)];
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
    let workspace_dir = tmp.path().join("my-skill");
    // Directory doesn't need to pre-exist — create_dir_all handles it

    let intake = r#"{"audience":"Data engineers","challenges":"Legacy systems","scope":"ETL pipelines"}"#;
    write_user_context_file(
        workspace_path,
        "my-skill",
        &[],
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
    let workspace_dir = tmp.path().join("my-skill");

    write_user_context_file(
        workspace_path,
        "my-skill",
        &[],
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
    let workspace_dir = tmp.path().join("my-skill");

    write_user_context_file(
        workspace_path,
        "my-skill",
        &[],
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
    let workspace_dir = tmp.path().join("my-skill");

    write_user_context_file(
        workspace_path,
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
    );

    // Skill name alone is enough to produce a file
    let content = std::fs::read_to_string(workspace_dir.join("user-context.md")).unwrap();
    assert!(content.contains("**Name**: my-skill"));
}

#[test]
fn test_write_user_context_file_creates_missing_dir() {
    let tmp = tempfile::tempdir().unwrap();
    let workspace_path = tmp.path().to_str().unwrap();
    let workspace_dir = tmp.path().join("new-skill");
    // Directory does NOT exist yet
    assert!(!workspace_dir.exists());

    write_user_context_file(
        workspace_path,
        "new-skill",
        &[],
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
    let path = format!("/tmp/test-workspace-unknown-{}", std::process::id());
    assert!(!workspace_already_copied(&path));
}

#[test]
fn test_mark_workspace_copied_then_already_copied() {
    let path = format!("/tmp/test-workspace-mark-{}", std::process::id());
    assert!(!workspace_already_copied(&path));
    mark_workspace_copied(&path);
    assert!(workspace_already_copied(&path));
}

#[test]
fn test_workspace_copy_cache_is_per_workspace() {
    let path_a = format!("/tmp/test-ws-a-{}", std::process::id());
    let path_b = format!("/tmp/test-ws-b-{}", std::process::id());
    mark_workspace_copied(&path_a);
    assert!(workspace_already_copied(&path_a));
    assert!(!workspace_already_copied(&path_b));
}

#[test]
fn test_invalidate_workspace_cache() {
    let path = format!("/tmp/test-ws-invalidate-{}", std::process::id());
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

    // 2-3. Create workspace/my-skill/context/ with all context files
    let context_dir = workspace_tmp.path().join("my-skill").join("context");
    std::fs::create_dir_all(&context_dir).unwrap();

    let context_files = ["clarifications.json", "decisions.json"];
    for file in &context_files {
        std::fs::write(context_dir.join(file), "test content").unwrap();
    }

    // 4. Working dir must exist in workspace
    std::fs::create_dir_all(workspace_tmp.path().join("my-skill")).unwrap();

    // 5. Call delete_step_output_files from step 0
    crate::cleanup::delete_step_output_files(workspace, "my-skill", 0, skills_path);

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
    );
    assert!(result.is_none());
}

#[test]
fn test_format_user_context_invalid_json_ignored() {
    let result = format_user_context(
        None,
        &[],
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
        Some(intake),
        None,
        None,
        None,
        None,
        None,
        None,
        None,
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
    let prompt = build_prompt("test-skill", "/tmp/ws", "/tmp/skills", None, None, 5);
    assert!(prompt.contains("user-context.md"));
    assert!(prompt.contains("test-skill"));
}

#[test]
fn test_build_prompt_without_user_context() {
    let prompt = build_prompt("test-skill", "/tmp/ws", "/tmp/skills", None, None, 5);
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
    assert!(!parse_decisions_guard(Path::new(
        "/tmp/nonexistent-vd801-decisions.json"
    )));
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

    super::evaluation::save_clarifications_content("my-skill".to_string(), workspace_str, payload).unwrap();
    let saved = std::fs::read_to_string(
        workspace_path
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

    let err = super::evaluation::save_clarifications_content(
        "my-skill".to_string(),
        workspace_str,
        "{not-valid-json}".to_string(),
    )
    .unwrap_err();
    assert!(err.contains("Invalid clarifications JSON"));
}

#[test]
fn test_save_clarifications_content_rejects_invalid_schema() {
    let tmp = tempfile::tempdir().unwrap();
    let workspace_path = tmp.path().join("workspace");
    let workspace_str = workspace_path.to_string_lossy().to_string();
    let invalid = serde_json::json!({
        "version": "1",
        "metadata": {
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
        super::evaluation::save_clarifications_content("my-skill".to_string(), workspace_str, invalid.to_string())
            .unwrap_err();
    assert!(err.contains("priority_questions must be an array"));
}

// --- generate_skills_section tests ---

/// Helper: create a skill directory with a SKILL.md containing frontmatter.
fn create_skill_on_disk(
    base: &std::path::Path,
    name: &str,
    trigger: Option<&str>,
    description: Option<&str>,
) -> String {
    let skill_dir = base.join(name);
    std::fs::create_dir_all(&skill_dir).unwrap();
    let mut fm = String::from("---\n");
    fm.push_str(&format!("name: {}\n", name));
    if let Some(desc) = description {
        fm.push_str(&format!("description: {}\n", desc));
    }
    if let Some(trig) = trigger {
        fm.push_str(&format!("trigger: {}\n", trig));
    }
    fm.push_str("---\n# Skill\n");
    std::fs::write(skill_dir.join("SKILL.md"), &fm).unwrap();
    skill_dir.to_string_lossy().to_string()
}

#[test]
fn test_generate_skills_section_single_active_skill() {
    let conn = super::super::test_utils::create_test_db();
    let skill_tmp = tempfile::tempdir().unwrap();
    let disk_path = create_skill_on_disk(
        skill_tmp.path(),
        "test-practices",
        Some("Read the skill at .claude/skills/test-practices/SKILL.md."),
        Some("Skill structure rules."),
    );

    let skill = crate::types::ImportedSkill {
        skill_id: "bundled-test-practices".to_string(),
        skill_name: "test-practices".to_string(),
        is_active: true,
        disk_path,
        imported_at: "2000-01-01T00:00:00Z".to_string(),
        is_bundled: true,
        description: Some("Skill structure rules.".to_string()),
        purpose: None,
        version: None,
        model: None,
        argument_hint: None,
        user_invocable: None,
        disable_model_invocation: None,
        marketplace_source_url: None,
    };
    crate::db::insert_imported_skill(&conn, &skill).unwrap();

    let section = generate_skills_section(&conn).unwrap();

    assert!(
        section.contains("## Custom Skills"),
        "should use unified heading"
    );
    assert!(
        section.contains("### /test-practices"),
        "should list skill by name"
    );
    assert!(
        section.contains("Skill structure rules."),
        "should include description"
    );
    assert!(
        !section.contains("Read and follow the skill at"),
        "should not include path line"
    );
    assert!(
        !section.contains("## Skill Generation Guidance"),
        "old bundled heading must not appear"
    );
    assert!(
        !section.contains("## Imported Skills"),
        "old imported heading must not appear"
    );
}

#[test]
fn test_generate_skills_section_inactive_skill_excluded() {
    let conn = super::super::test_utils::create_test_db();
    let skill = crate::types::ImportedSkill {
        skill_id: "bundled-test-practices".to_string(),
        skill_name: "test-practices".to_string(),
        is_active: false,
        disk_path: "/tmp/skills/test-practices".to_string(),
        imported_at: "2000-01-01T00:00:00Z".to_string(),
        is_bundled: true,
        description: None,
        purpose: None,
        version: None,
        model: None,
        argument_hint: None,
        user_invocable: None,
        disable_model_invocation: None,
        marketplace_source_url: None,
    };
    crate::db::insert_imported_skill(&conn, &skill).unwrap();

    let section = generate_skills_section(&conn).unwrap();
    assert!(
        section.is_empty(),
        "inactive skill should produce empty section"
    );
}

#[test]
fn test_generate_skills_section_multiple_skills_same_format() {
    let conn = super::super::test_utils::create_test_db();
    let skill_tmp = tempfile::tempdir().unwrap();
    let disk_path1 = create_skill_on_disk(
        skill_tmp.path(),
        "test-practices",
        Some("Use for skill generation."),
        Some("Skill structure rules."),
    );
    let disk_path2 = create_skill_on_disk(
        skill_tmp.path(),
        "data-analytics",
        Some("Use for analytics queries."),
        Some("Analytics patterns."),
    );

    let bundled = crate::types::ImportedSkill {
        skill_id: "bundled-test-practices".to_string(),
        skill_name: "test-practices".to_string(),
        is_active: true,
        disk_path: disk_path1,
        imported_at: "2000-01-01T00:00:00Z".to_string(),
        is_bundled: true,
        description: Some("Skill structure rules.".to_string()),
        purpose: None,
        version: None,
        model: None,
        argument_hint: None,
        user_invocable: None,
        disable_model_invocation: None,
        marketplace_source_url: None,
    };
    let imported = crate::types::ImportedSkill {
        skill_id: "imp-data-analytics-123".to_string(),
        skill_name: "data-analytics".to_string(),
        is_active: true,
        disk_path: disk_path2,
        imported_at: "2025-01-15T10:00:00Z".to_string(),
        is_bundled: false,
        description: Some("Analytics patterns.".to_string()),
        purpose: None,
        version: None,
        model: None,
        argument_hint: None,
        user_invocable: None,
        disable_model_invocation: None,
        marketplace_source_url: None,
    };
    crate::db::insert_imported_skill(&conn, &bundled).unwrap();
    crate::db::insert_imported_skill(&conn, &imported).unwrap();

    let section = generate_skills_section(&conn).unwrap();

    assert!(section.contains("## Custom Skills"), "unified heading");
    assert!(
        section.contains("### /test-practices"),
        "bundled skill listed"
    );
    assert!(
        section.contains("### /data-analytics"),
        "imported skill listed"
    );
    assert!(
        section.contains("Skill structure rules."),
        "bundled description"
    );
    assert!(
        section.contains("Analytics patterns."),
        "imported description"
    );
    // Alphabetical order: data-analytics < test-practices
    let da_pos = section.find("### /data-analytics").unwrap();
    let tp_pos = section.find("### /test-practices").unwrap();
    assert!(da_pos < tp_pos, "skills sorted alphabetically");
}

#[test]
fn test_generate_skills_section_no_skills() {
    let conn = super::super::test_utils::create_test_db();
    let section = generate_skills_section(&conn).unwrap();
    assert!(section.is_empty(), "no skills should produce empty section");
}

#[test]
fn test_generate_skills_section_no_trigger_no_path() {
    // Regression test: section must never contain "Read and follow" path line or trigger text
    let conn = super::super::test_utils::create_test_db();
    let skill_tmp = tempfile::tempdir().unwrap();
    let disk_path = create_skill_on_disk(
        skill_tmp.path(),
        "my-skill",
        Some("When user asks about X, use this skill."),
        Some("Skill description here."),
    );

    let skill = crate::types::ImportedSkill {
        skill_id: "imp-my-skill-1".to_string(),
        skill_name: "my-skill".to_string(),
        is_active: true,
        disk_path,
        imported_at: "2025-01-01T00:00:00Z".to_string(),
        is_bundled: false,
        description: Some("Skill description here.".to_string()),
        purpose: None,
        version: None,
        model: None,
        argument_hint: None,
        user_invocable: None,
        disable_model_invocation: None,
        marketplace_source_url: None,
    };
    crate::db::insert_imported_skill(&conn, &skill).unwrap();

    let section = generate_skills_section(&conn).unwrap();

    // Must NOT contain trigger text or path directive
    assert!(
        !section.contains("Read and follow"),
        "section must not contain 'Read and follow'"
    );
    assert!(
        !section.contains("When user asks about X"),
        "section must not contain trigger text"
    );
    assert!(
        !section.contains("SKILL.md"),
        "section must not contain skill path"
    );

    // MUST contain description
    assert!(
        section.contains("Skill description here."),
        "section must include description"
    );
    assert!(
        section.contains("### /my-skill"),
        "section must include skill heading"
    );
}

#[test]
fn test_deploy_skill_for_workflow_uses_bundled_source_for_bundled_rows() {
    let conn = super::super::test_utils::create_test_db();
    let workspace_tmp = tempfile::tempdir().unwrap();
    let bundled_tmp = tempfile::tempdir().unwrap();

    let workspace_path = workspace_tmp.path().to_string_lossy().to_string();
    let bundled_skills_dir = bundled_tmp.path();

    let bundled_research_dir = bundled_skills_dir.join("research");
    std::fs::create_dir_all(&bundled_research_dir).unwrap();
    std::fs::write(
        bundled_research_dir.join("SKILL.md"),
        "---\nname: research\ndescription: bundled\n---\n# Bundled Research",
    )
    .unwrap();

    let deployed_research_dir = workspace_tmp
        .path()
        .join(".claude")
        .join("skills")
        .join("research");
    std::fs::create_dir_all(&deployed_research_dir).unwrap();
    std::fs::write(
        deployed_research_dir.join("SKILL.md"),
        "---\nname: research\ndescription: stale\n---\n# Stale Research",
    )
    .unwrap();

    let ws = crate::types::ImportedSkill {
        skill_id: "bundled-research".to_string(),
        skill_name: "research".to_string(),
        is_active: true,
        disk_path: deployed_research_dir.to_string_lossy().to_string(),
        imported_at: "2000-01-01T00:00:00Z".to_string(),
        is_bundled: true,
        description: Some("research".to_string()),
        version: Some("1.0.0".to_string()),
        model: None,
        argument_hint: None,
        user_invocable: None,
        disable_model_invocation: None,
        purpose: Some("research".to_string()),
        marketplace_source_url: None,
    };
    crate::db::insert_imported_skill(&conn, &ws).unwrap();

    super::deploy::deploy_skill_for_workflow(
        &conn,
        &workspace_path,
        bundled_skills_dir,
        "research",
        "research",
    );

    let content = std::fs::read_to_string(deployed_research_dir.join("SKILL.md")).unwrap();
    assert!(content.contains("Bundled Research"));
    assert!(!content.contains("Stale Research"));
}

// =============================================================================
// CG-R1: format_user_context (workflow/runtime.rs)
// =============================================================================

#[test]
fn test_format_user_context_returns_none_when_all_empty() {
    let result = format_user_context(None, &[], None, None, None, None, None, None, None, None, None, None);
    assert!(result.is_none(), "should return None when no fields are provided");
}

#[test]
fn test_format_user_context_includes_name_and_tags() {
    let tags = vec!["finance".to_string(), "analytics".to_string()];
    let result = format_user_context(
        Some("my-skill"), &tags, None, None, None, None, None, None, None, None, None, None,
    );
    let text = result.unwrap();
    assert!(text.contains("## User Context"), "should have heading");
    assert!(text.contains("**Name**: my-skill"), "should include name");
    assert!(text.contains("**Tags**: finance, analytics"), "should include tags");
}

#[test]
fn test_format_user_context_includes_purpose_label_mapping() {
    let result = format_user_context(
        None, &[], None, None, None, None, Some("domain"), None, None, None, None, None,
    );
    let text = result.unwrap();
    assert!(text.contains("Business process knowledge"), "domain purpose should map to label");
}

#[test]
fn test_format_user_context_includes_profile_section() {
    let result = format_user_context(
        None, &[], Some("Healthcare"), Some("Data Engineer"), None, None, None, None, None, None, None, None,
    );
    let text = result.unwrap();
    assert!(text.contains("### About You"), "should have profile heading");
    assert!(text.contains("**Industry**: Healthcare"), "should include industry");
    assert!(text.contains("**Function**: Data Engineer"), "should include function");
}

#[test]
fn test_format_user_context_includes_configuration() {
    let result = format_user_context(
        None, &[], None, None, None, None, None, Some("1.0"), Some("claude-sonnet-4-6"), Some("/ask"), Some(true), Some(false),
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
        None, &[], None, None, None, None, None, None, Some("inherit"), None, None, None,
    );
    // "inherit" model should be filtered out — if nothing else is set, result is None
    assert!(result.is_none(), "inherit model alone should produce None");
}

#[test]
fn test_format_user_context_includes_intake_json_context() {
    let intake = r#"{"context": "We use Snowflake and dbt for data pipelines."}"#;
    let result = format_user_context(
        None, &[], None, None, Some(intake), None, None, None, None, None, None, None,
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
        workspace_path, skill_name, &tags, Some("Tech"), None, None, Some("A test skill"), Some("domain"), None, None, None, None, None,
    );

    let ctx_path = tmp.path().join(skill_name).join("user-context.md");
    assert!(ctx_path.exists(), "user-context.md should be created");
    let content = std::fs::read_to_string(&ctx_path).unwrap();
    assert!(content.contains("# User Context"), "should contain user context heading");
    assert!(content.contains("A test skill"), "should contain description");
}

// =============================================================================
// CG-R2: extract_customization_section (workflow/claude_md.rs)
// =============================================================================

use super::claude_md::extract_customization_section;

#[test]
fn test_extract_customization_section_returns_content_after_marker() {
    let content = "# Base\nSome base content.\n\n## Customization\n\nMy custom instructions.\n";
    let result = extract_customization_section(content);
    assert!(result.starts_with("## Customization"), "should start with the heading");
    assert!(result.contains("My custom instructions."), "should include user content");
}

#[test]
fn test_extract_customization_section_returns_empty_when_missing() {
    let content = "# Base\nSome content without customization section.\n";
    let result = extract_customization_section(content);
    assert!(result.is_empty(), "should return empty when marker not found");
}
