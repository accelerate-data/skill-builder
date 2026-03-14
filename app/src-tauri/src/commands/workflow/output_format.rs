use std::path::Path;

use super::step_config::validate_clarifications_json;

pub(crate) fn materialize_workflow_step_output_value(
    skill_root: &Path,
    step_id: u32,
    structured_output: &serde_json::Value,
) -> Result<(), String> {
    let payload = structured_output
        .as_object()
        .ok_or_else(|| "structured_output must be a JSON object".to_string())?;

    let require_int = |field: &str| -> Result<i64, String> {
        payload
            .get(field)
            .and_then(|v| v.as_i64())
            .ok_or_else(|| format!("structured_output.{} must be an integer", field))
    };

    let require_const_status = |expected: &str| -> Result<(), String> {
        let actual = payload
            .get("status")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "structured_output.status must be a string".to_string())?;
        if actual != expected {
            return Err(format!(
                "structured_output.status must be '{}' but got '{}'",
                expected, actual
            ));
        }
        Ok(())
    };

    let context_dir = skill_root.join("context");
    std::fs::create_dir_all(&context_dir).map_err(|e| {
        format!(
            "Failed to create context directory '{}': {}",
            context_dir.display(),
            e
        )
    })?;

    match step_id {
        0 => {
            require_const_status("research_complete")?;
            let _ = require_int("dimensions_selected")?;
            let _ = require_int("question_count")?;
            let clarifications = payload
                .get("research_output")
                .ok_or_else(|| "structured_output.research_output is required".to_string())?;
            validate_clarifications_json(clarifications)
                .map_err(|e| format!("Invalid research_output: {}", e))?;
            let clarifications_pretty = serde_json::to_string_pretty(clarifications)
                .map_err(|e| format!("Failed to serialize research_output: {}", e))?;

            let clarifications_path = context_dir.join("clarifications.json");
            std::fs::write(&clarifications_path, clarifications_pretty).map_err(|e| {
                format!(
                    "Failed to write clarifications '{}': {}",
                    clarifications_path.display(),
                    e
                )
            })?;
            Ok(())
        }
        1 => {
            require_const_status("detailed_research_complete")?;
            let _ = require_int("refinement_count")?;
            let _ = require_int("section_count")?;
            let clarifications = payload
                .get("clarifications_json")
                .ok_or_else(|| "structured_output.clarifications_json is required".to_string())?;
            validate_clarifications_json(clarifications)
                .map_err(|e| format!("Invalid clarifications_json: {}", e))?;
            let clarifications_pretty = serde_json::to_string_pretty(clarifications)
                .map_err(|e| format!("Failed to serialize clarifications_json: {}", e))?;

            let clarifications_path = context_dir.join("clarifications.json");
            std::fs::write(&clarifications_path, clarifications_pretty).map_err(|e| {
                format!(
                    "Failed to write clarifications '{}': {}",
                    clarifications_path.display(),
                    e
                )
            })?;
            Ok(())
        }
        2 => {
            let decisions_pretty =
                serde_json::to_string_pretty(&serde_json::Value::Object(payload.clone()))
                    .map_err(|e| format!("Failed to serialize decisions: {}", e))?;
            let decisions_path = context_dir.join("decisions.json");
            std::fs::write(&decisions_path, decisions_pretty).map_err(|e| {
                format!(
                    "Failed to write decisions '{}': {}",
                    decisions_path.display(),
                    e
                )
            })?;
            Ok(())
        }
        3 => {
            require_const_status("generated")?;
            let evaluations_markdown = payload
                .get("evaluations_markdown")
                .and_then(|v| v.as_str())
                .ok_or_else(|| {
                    "structured_output.evaluations_markdown must be a string".to_string()
                })?;
            if evaluations_markdown.trim().is_empty() {
                return Err("structured_output.evaluations_markdown must not be empty".to_string());
            }
            let evaluations_path = context_dir.join("evaluations.md");
            std::fs::write(&evaluations_path, evaluations_markdown).map_err(|e| {
                format!(
                    "Failed to write evaluations '{}': {}",
                    evaluations_path.display(),
                    e
                )
            })?;
            Ok(())
        }
        _ => Err(format!(
            "materialize_workflow_step_output supports only steps 0-3; got {}",
            step_id
        )),
    }
}

#[tauri::command]
pub fn materialize_workflow_step_output(
    skill_name: String,
    step_id: u32,
    structured_output: serde_json::Value,
    db: tauri::State<'_, crate::db::Db>,
) -> Result<(), String> {
    log::info!(
        "[materialize_workflow_step_output] skill={} step={} step_id={}",
        skill_name,
        super::evaluation::workflow_step_log_name(step_id as i32),
        step_id
    );
    let workspace_path = super::evaluation::read_workspace_path(&db)
        .ok_or_else(|| "Workspace path not configured. Please set it in Settings.".to_string())?;
    let skill_root = Path::new(&workspace_path).join(&skill_name);
    materialize_workflow_step_output_value(&skill_root, step_id, &structured_output).map_err(|e| {
        log::error!(
            "[materialize_workflow_step_output] skill={} step={} step_id={} failed: {}",
            skill_name,
            super::evaluation::workflow_step_log_name(step_id as i32),
            step_id,
            e
        );
        e
    })
}

pub(crate) fn answer_evaluator_output_format() -> serde_json::Value {
    serde_json::json!({
        "type": "json_schema",
        "schema": {
            "type": "object",
            "required": [
                "verdict",
                "answered_count",
                "empty_count",
                "vague_count",
                "contradictory_count",
                "total_count",
                "reasoning",
                "per_question"
            ],
            "properties": {
                "verdict": {
                    "type": "string",
                    "enum": ["sufficient", "mixed", "insufficient"]
                },
                "answered_count": { "type": "integer", "minimum": 0 },
                "empty_count": { "type": "integer", "minimum": 0 },
                "vague_count": { "type": "integer", "minimum": 0 },
                "contradictory_count": { "type": "integer", "minimum": 0 },
                "total_count": { "type": "integer", "minimum": 0 },
                "reasoning": { "type": "string", "minLength": 1 },
                "per_question": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "required": ["question_id", "verdict"],
                        "properties": {
                            "question_id": { "type": "string", "minLength": 1 },
                            "verdict": {
                                "type": "string",
                                "enum": ["clear", "needs_refinement", "not_answered", "vague", "contradictory"]
                            },
                            "reason": { "type": "string" },
                            "contradicts": { "type": "string" }
                        },
                        "additionalProperties": false,
                        "allOf": [
                            {
                                "if": {
                                    "properties": { "verdict": { "const": "contradictory" } },
                                    "required": ["verdict"]
                                },
                                "then": { "required": ["contradicts"] }
                            }
                        ]
                    }
                }
            },
            "additionalProperties": false
        }
    })
}

pub(crate) fn validate_answer_evaluation_json(evaluation: &serde_json::Value) -> Result<(), String> {
    let root = evaluation
        .as_object()
        .ok_or_else(|| "answer_evaluation must be a JSON object".to_string())?;

    let verdict = root
        .get("verdict")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "answer_evaluation.verdict must be a string".to_string())?;
    if !["sufficient", "mixed", "insufficient"].contains(&verdict) {
        return Err(
            "answer_evaluation.verdict must be one of sufficient|mixed|insufficient".to_string(),
        );
    }

    for field in [
        "answered_count",
        "empty_count",
        "vague_count",
        "contradictory_count",
        "total_count",
    ] {
        if root.get(field).and_then(|v| v.as_i64()).is_none() {
            return Err(format!("answer_evaluation.{} must be an integer", field));
        }
    }

    let reasoning = root
        .get("reasoning")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "answer_evaluation.reasoning must be a string".to_string())?;
    if reasoning.trim().is_empty() {
        return Err("answer_evaluation.reasoning must not be empty".to_string());
    }

    let per_question = root
        .get("per_question")
        .and_then(|v| v.as_array())
        .ok_or_else(|| "answer_evaluation.per_question must be an array".to_string())?;
    for (idx, entry) in per_question.iter().enumerate() {
        let obj = entry
            .as_object()
            .ok_or_else(|| format!("answer_evaluation.per_question[{}] must be an object", idx))?;
        if obj.get("question_id").and_then(|v| v.as_str()).is_none() {
            return Err(format!(
                "answer_evaluation.per_question[{}].question_id must be a string",
                idx
            ));
        }
        let pq_verdict = obj.get("verdict").and_then(|v| v.as_str()).ok_or_else(|| {
            format!(
                "answer_evaluation.per_question[{}].verdict must be a string",
                idx
            )
        })?;
        if ![
            "clear",
            "needs_refinement",
            "not_answered",
            "vague",
            "contradictory",
        ]
        .contains(&pq_verdict)
        {
            return Err(format!(
                "answer_evaluation.per_question[{}].verdict is invalid",
                idx
            ));
        }
        if pq_verdict == "vague" {
            let reason = obj.get("reason").and_then(|v| v.as_str()).ok_or_else(|| {
                format!(
                    "answer_evaluation.per_question[{}].reason is required for vague verdict",
                    idx
                )
            })?;
            if reason.trim().is_empty() {
                return Err(format!(
                    "answer_evaluation.per_question[{}].reason must not be empty",
                    idx
                ));
            }
        }
        if pq_verdict == "contradictory" {
            let reason = obj
                .get("reason")
                .and_then(|v| v.as_str())
                .ok_or_else(|| format!("answer_evaluation.per_question[{}].reason is required for contradictory verdict", idx))?;
            if reason.trim().is_empty() {
                return Err(format!(
                    "answer_evaluation.per_question[{}].reason must not be empty",
                    idx
                ));
            }
            let contradicts = obj
                .get("contradicts")
                .and_then(|v| v.as_str())
                .ok_or_else(|| format!("answer_evaluation.per_question[{}].contradicts is required for contradictory verdict", idx))?;
            if contradicts.trim().is_empty() {
                return Err(format!(
                    "answer_evaluation.per_question[{}].contradicts must not be empty",
                    idx
                ));
            }
        }
    }

    Ok(())
}

pub(crate) fn materialize_answer_evaluation_output_value(
    workspace_dir: &Path,
    structured_output: &serde_json::Value,
) -> Result<(), String> {
    validate_answer_evaluation_json(structured_output)
        .map_err(|e| format!("Invalid answer evaluation output: {}", e))?;
    std::fs::create_dir_all(workspace_dir).map_err(|e| {
        format!(
            "Failed to create workspace directory '{}': {}",
            workspace_dir.display(),
            e
        )
    })?;
    let output_path = workspace_dir.join("answer-evaluation.json");
    let content = serde_json::to_string_pretty(structured_output)
        .map_err(|e| format!("Failed to serialize answer evaluation output: {}", e))?;
    std::fs::write(&output_path, content).map_err(|e| {
        format!(
            "Failed to write answer evaluation output '{}': {}",
            output_path.display(),
            e
        )
    })?;
    Ok(())
}

#[tauri::command]
pub fn materialize_answer_evaluation_output(
    skill_name: String,
    workspace_path: String,
    structured_output: serde_json::Value,
) -> Result<(), String> {
    log::info!(
        "[materialize_answer_evaluation_output] skill={}",
        skill_name
    );
    log::debug!(
        "[materialize_answer_evaluation_output] skill={} structured_output={}",
        skill_name,
        structured_output
    );
    let workspace_dir = Path::new(&workspace_path).join(&skill_name);
    materialize_answer_evaluation_output_value(&workspace_dir, &structured_output).map_err(|e| {
        log::error!(
            "[materialize_answer_evaluation_output] skill={} failed: {}",
            skill_name,
            e
        );
        e
    })
}
