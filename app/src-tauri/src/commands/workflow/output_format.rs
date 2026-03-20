use std::path::Path;

use super::step_config::validate_clarifications_json;
use crate::commands::workflow_artifacts::{
    AnswerEvaluationOutput, DecisionsOutput, DetailedResearchOutput, GenerateSkillOutput,
    ResearchStepOutput,
};

pub(crate) fn materialize_workflow_step_output_value(
    skill_root: &Path,
    step_id: u32,
    structured_output: &serde_json::Value,
) -> Result<(), String> {
    // Require a top-level object so error messages remain identical to the original contract.
    if !structured_output.is_object() {
        return Err("structured_output must be a JSON object".to_string());
    }

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
            let parsed =
                serde_json::from_value::<ResearchStepOutput>(structured_output.clone())
                    .map_err(|e| format!("invalid research step output: {}", e))?;

            if parsed.status != "research_complete" {
                return Err(format!(
                    "structured_output.status must be 'research_complete' but got '{}'",
                    parsed.status
                ));
            }

            validate_clarifications_json(&parsed.research_output)
                .map_err(|e| format!("Invalid research_output: {}", e))?;

            let clarifications_pretty = serde_json::to_string_pretty(&parsed.research_output)
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
            let parsed =
                serde_json::from_value::<DetailedResearchOutput>(structured_output.clone())
                    .map_err(|e| format!("invalid detailed research output: {}", e))?;

            if parsed.status != "detailed_research_complete" {
                return Err(format!(
                    "structured_output.status must be 'detailed_research_complete' but got '{}'",
                    parsed.status
                ));
            }

            validate_clarifications_json(&parsed.clarifications_json)
                .map_err(|e| format!("Invalid clarifications_json: {}", e))?;

            let clarifications_pretty = serde_json::to_string_pretty(&parsed.clarifications_json)
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
            let parsed = serde_json::from_value::<DecisionsOutput>(structured_output.clone())
                .map_err(|e| format!("invalid decisions output: {}", e))?;

            let decisions_pretty = serde_json::to_string_pretty(&parsed)
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
            // Step 3 can receive output from either generate-skill or benchmark-skill.
            // generate-skill: { status: "generated", skipped?: true, call_trace: [...] }
            // benchmark-skill: { status: "complete"|"partial"|"skipped", benchmark_path?, call_trace }
            let status = structured_output
                .get("status")
                .and_then(|s| s.as_str())
                .unwrap_or("");

            match status {
                "generated" => {
                    // generate-skill output — write a pending benchmark-meta
                    log::info!("generate-skill completed for skill={}, skipped={}", skill_root.display(),
                        structured_output.get("skipped").and_then(|s| s.as_bool()).unwrap_or(false));
                    let skipped = structured_output
                        .get("skipped")
                        .and_then(|s| s.as_bool())
                        .unwrap_or(false);
                    let benchmark_status = if skipped { "skipped" } else { "pending" };
                    let meta = serde_json::json!({
                        "benchmark_status": benchmark_status,
                        "benchmark_path": null,
                    });
                    let meta_path = context_dir.join("benchmark-meta.json");
                    std::fs::write(&meta_path, serde_json::to_string_pretty(&meta).unwrap_or_default())
                        .map_err(|e| {
                            format!(
                                "Failed to write benchmark-meta '{}': {}",
                                meta_path.display(),
                                e
                            )
                        })?;
                    Ok(())
                }
                "rewritten" => {
                    // rewrite-skill output — same handling as generate
                    log::info!("rewrite-skill completed for skill={}, skipped={}", skill_root.display(),
                        structured_output.get("skipped").and_then(|s| s.as_bool()).unwrap_or(false));
                    let skipped = structured_output
                        .get("skipped")
                        .and_then(|s| s.as_bool())
                        .unwrap_or(false);
                    let benchmark_status = if skipped { "skipped" } else { "pending" };
                    let meta = serde_json::json!({
                        "benchmark_status": benchmark_status,
                        "benchmark_path": null,
                    });
                    let meta_path = context_dir.join("benchmark-meta.json");
                    std::fs::write(&meta_path, serde_json::to_string_pretty(&meta).unwrap_or_default())
                        .map_err(|e| {
                            format!(
                                "Failed to write benchmark-meta '{}': {}",
                                meta_path.display(),
                                e
                            )
                        })?;
                    Ok(())
                }
                "complete" | "partial" | "skipped" => {
                    // benchmark-skill output — status carries the outcome directly
                    log::info!(
                        "event=benchmark_skill_complete operation=materialize_output status=processing skill={}",
                        skill_root.display()
                    );
                    let parsed =
                        serde_json::from_value::<GenerateSkillOutput>(structured_output.clone())
                            .map_err(|e| format!("invalid benchmark skill output: {}", e))?;

                    // If the agent emitted an intermediate "partial" StructuredOutput but the
                    // run completed successfully, check whether benchmark.json actually landed
                    // on disk. If it did, the benchmark finished — upgrade to "complete" so the
                    // frontend doesn't treat the premature partial signal as a failure.
                    let effective_status = if parsed.status == "partial" {
                        if let Some(ref bench_path) = parsed.benchmark_path {
                            let benchmark_json = skill_root.join(bench_path).join("benchmark.json");
                            if benchmark_json.exists() {
                                log::info!(
                                    "event=benchmark_partial_upgrade operation=materialize_output status=upgraded skill={} path={}",
                                    skill_root.display(),
                                    benchmark_json.display()
                                );
                                "complete".to_string()
                            } else {
                                log::info!(
                                    "event=benchmark_partial_kept operation=materialize_output status=partial skill={} path={}",
                                    skill_root.display(),
                                    benchmark_json.display()
                                );
                                parsed.status.clone()
                            }
                        } else {
                            parsed.status.clone()
                        }
                    } else {
                        if let Some(ref bench_path) = parsed.benchmark_path {
                            let benchmark_json = skill_root.join(bench_path).join("benchmark.json");
                            if !benchmark_json.exists() {
                                log::warn!(
                                    "event=benchmark_file_missing operation=materialize_output status=warning skill={} status={} path={}",
                                    skill_root.display(),
                                    parsed.status,
                                    benchmark_json.display()
                                );
                            }
                        }
                        parsed.status.clone()
                    };

                    let meta = serde_json::json!({
                        "benchmark_status": effective_status,
                        "benchmark_path": parsed.benchmark_path,
                    });
                    let meta_path = context_dir.join("benchmark-meta.json");
                    std::fs::write(&meta_path, serde_json::to_string_pretty(&meta).unwrap_or_default())
                        .map_err(|e| {
                            format!(
                                "Failed to write benchmark-meta '{}': {}",
                                meta_path.display(),
                                e
                            )
                        })?;

                    Ok(())
                }
                _ => Err(format!(
                    "structured_output.status must be 'generated', 'rewritten', or 'complete'|'partial'|'skipped' but got '{}'",
                    status
                )),
            }
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
    })?;

    // After successful generate materialization, commit and tag the skill.
    // Benchmark output does not trigger a commit (benchmark data is in workspace, not git).
    // Rewrite/refine commit+tag is handled by finalize_refine_run.
    if step_id == 3 {
        let status = structured_output
            .get("status")
            .and_then(|s| s.as_str())
            .unwrap_or("");
        let skipped = structured_output
            .get("skipped")
            .and_then(|s| s.as_bool())
            .unwrap_or(false);

        if status == "generated" && !skipped {
            let conn = db.0.lock().map_err(|e| e.to_string())?;
            let settings = crate::db::read_settings(&conn)?;
            let skills_path = settings
                .skills_path
                .unwrap_or_else(|| workspace_path.clone());
            drop(conn);

            // Agent now handles commit+tag via shell git; read HEAD for logging
            let skills_dir = Path::new(&skills_path);
            match git2::Repository::open(skills_dir) {
                Ok(repo) => {
                    if let Some(sha) = repo.head().ok()
                        .and_then(|h| h.peel_to_commit().ok())
                        .map(|c| c.id().to_string())
                    {
                        log::info!(
                            "[materialize_workflow_step_output] agent committed skill={} sha={}",
                            skill_name, &sha[..8.min(sha.len())]
                        );
                    }
                }
                Err(e) => {
                    log::warn!(
                        "[materialize_workflow_step_output] could not open repo for skill={}: {}",
                        skill_name, e
                    );
                }
            }
        }
    }

    Ok(())
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
    // Parse into typed struct first — deserialization failure is the boundary check.
    let parsed = serde_json::from_value::<AnswerEvaluationOutput>(structured_output.clone())
        .map_err(|e| format!("invalid answer evaluation output: {}", e))?;

    // Run the existing semantic validation on top (verdict enum, vague/contradictory rules).
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
    let content = serde_json::to_string_pretty(&parsed)
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
