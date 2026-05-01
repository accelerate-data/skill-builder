use std::path::{Path, PathBuf};

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

    log::info!(
        "[materialize_step] step_id={} skill_root={} output_keys={:?}",
        step_id,
        skill_root.display(),
        structured_output
            .as_object()
            .map(|o| o.keys().collect::<Vec<_>>())
    );

    match step_id {
        0 => {
            let parsed = serde_json::from_value::<ResearchStepOutput>(structured_output.clone())
                .map_err(|e| format!("invalid research step output: {}", e))?;

            if parsed.status != "research_complete" {
                return Err(format!(
                    "structured_output.status must be 'research_complete' but got '{}'",
                    parsed.status
                ));
            }

            log::info!(
                "[materialize_step] step=0 research_output version={}",
                parsed.research_output.version
            );

            // Typed deserialization into ClarificationsFile already validated structure.

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

            log::info!(
                "[materialize_step] step=1 clarifications_json version={}",
                parsed.clarifications_json.version
            );

            // Typed deserialization into ClarificationsFile already validated structure.

            let clarifications_pretty =
                serde_json::to_string_pretty(&parsed.clarifications_json)
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

pub(crate) fn publish_generated_skill_output(
    workspace_skill_root: &Path,
    skills_path: &Path,
    plugin_slug: &str,
    skill_name: &str,
) -> Result<PathBuf, String> {
    let generated_dir = workspace_skill_root.join("skill");
    let generated_skill_md = generated_dir.join("SKILL.md");
    let published_dir = crate::skill_paths::resolve_skill_dir(skills_path, plugin_slug, skill_name);
    let published_skill_md = published_dir.join("SKILL.md");

    if !generated_skill_md.is_file() {
        if published_skill_md.is_file() {
            log::info!(
                "[publish_generated_skill_output] skill={} plugin={} already published at {}",
                skill_name,
                plugin_slug,
                published_skill_md.display()
            );
            return Ok(published_dir);
        }

        return Err(format!(
            "Generated skill output missing: expected '{}' or '{}'",
            generated_skill_md.display(),
            published_skill_md.display()
        ));
    }

    if let Some(parent) = published_dir.parent() {
        std::fs::create_dir_all(parent).map_err(|e| {
            format!(
                "Failed to create plugin directory '{}': {}",
                parent.display(),
                e
            )
        })?;
    }

    crate::fs_utils::copy_dir_recursive(&generated_dir, &published_dir)?;
    log::info!(
        "[publish_generated_skill_output] skill={} plugin={} source={} target={}",
        skill_name,
        plugin_slug,
        generated_dir.display(),
        published_dir.display()
    );
    Ok(published_dir)
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
    let plugin_slug = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        super::evaluation::lookup_plugin_slug(&conn, &skill_name)
    };
    let skill_root = crate::skill_paths::workspace_skill_dir(
        Path::new(&workspace_path),
        &plugin_slug,
        &skill_name,
    );
    materialize_workflow_step_output_value(&skill_root, step_id, &structured_output).map_err(
        |e| {
            log::error!(
                "[materialize_workflow_step_output] skill={} step={} step_id={} failed: {}",
                skill_name,
                super::evaluation::workflow_step_log_name(step_id as i32),
                step_id,
                e
            );
            e
        },
    )?;

    // After successful generate materialization, publish and commit the skill.
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

            let skills_dir = Path::new(&skills_path);
            publish_generated_skill_output(&skill_root, skills_dir, &plugin_slug, &skill_name)?;

            let commit_message = format!("{}: generated skill", skill_name);
            match crate::git::commit_all(skills_dir, &commit_message) {
                Ok(Some(sha)) => log::info!(
                    "[materialize_workflow_step_output] committed generated skill={} sha={}",
                    skill_name,
                    &sha[..8.min(sha.len())]
                ),
                Ok(None) => log::info!(
                    "[materialize_workflow_step_output] no generated skill changes to commit skill={}",
                    skill_name
                ),
                Err(e) => log::warn!(
                    "[materialize_workflow_step_output] generated skill publish commit failed skill={}: {}",
                    skill_name,
                    e
                ),
            }

            match git2::Repository::open(skills_dir) {
                Ok(repo) => {
                    if let Some(sha) = repo
                        .head()
                        .ok()
                        .and_then(|h| h.peel_to_commit().ok())
                        .map(|c| c.id().to_string())
                    {
                        log::info!(
                            "[materialize_workflow_step_output] generated skill repo head skill={} sha={}",
                            skill_name, &sha[..8.min(sha.len())]
                        );
                    }
                }
                Err(e) => {
                    log::warn!(
                        "[materialize_workflow_step_output] could not open repo for skill={}: {}",
                        skill_name,
                        e
                    );
                }
            }
        }
    }

    Ok(())
}

/// Returns the JSON Schema for the answer-evaluator structured output.
///
/// Uses the generated schema from `contracts::workflow_outputs::AnswerEvaluationOutput`.
pub(crate) fn answer_evaluator_output_format() -> serde_json::Value {
    let schema: serde_json::Value =
        serde_json::from_str(crate::generated::schemas::ANSWER_EVALUATION_SCHEMA)
            .expect("generated ANSWER_EVALUATION_SCHEMA must be valid JSON");
    serde_json::json!({
        "type": "json_schema",
        "schema": schema
    })
}

/// Validate an answer evaluation JSON payload via typed deserialization and
/// apply semantic business rules (verdict enum, vague/contradictory reason requirement).
///
/// The typed deserialization into `AnswerEvaluationOutput` handles structural
/// validation. The semantic checks below enforce business rules that go beyond
/// the JSON schema (e.g. "reason is required when verdict is vague").
pub(crate) fn validate_answer_evaluation_json(
    evaluation: &serde_json::Value,
) -> Result<AnswerEvaluationOutput, String> {
    let parsed = serde_json::from_value::<AnswerEvaluationOutput>(evaluation.clone())
        .map_err(|e| format!("invalid answer evaluation output: {}", e))?;

    // Semantic validation: verdict enum
    if !["sufficient", "mixed", "insufficient"].contains(&parsed.verdict.as_str()) {
        return Err(
            "answer_evaluation.verdict must be one of sufficient|mixed|insufficient".to_string(),
        );
    }

    // Semantic validation: reasoning must not be empty
    if parsed.reasoning.trim().is_empty() {
        return Err("answer_evaluation.reasoning must not be empty".to_string());
    }

    // Semantic validation: vague/contradictory entries must have a reason
    for (idx, entry) in parsed.per_question.iter().enumerate() {
        if ![
            "clear",
            "needs_refinement",
            "not_answered",
            "vague",
            "contradictory",
        ]
        .contains(&entry.verdict.as_str())
        {
            return Err(format!(
                "answer_evaluation.per_question[{}].verdict is invalid",
                idx
            ));
        }
        if entry.verdict == "vague" || entry.verdict == "contradictory" {
            match &entry.reason {
                Some(r) if !r.trim().is_empty() => {}
                _ => {
                    return Err(format!(
                        "answer_evaluation.per_question[{}].reason is required for {} verdict",
                        idx, entry.verdict
                    ));
                }
            }
        }
    }

    // Semantic validation: gate_decision enum
    if let Some(ref gd) = parsed.gate_decision {
        if !["run_research", "revise"].contains(&gd.as_str()) {
            return Err(format!(
                "answer_evaluation.gate_decision must be one of run_research|revise (got '{}')",
                gd
            ));
        }
    }

    Ok(parsed)
}

pub(crate) fn materialize_answer_evaluation_output_value(
    workspace_dir: &Path,
    structured_output: &serde_json::Value,
) -> Result<(), String> {
    // Typed deserialization + semantic validation in one step.
    let parsed = validate_answer_evaluation_json(structured_output)
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
    db: tauri::State<'_, crate::db::Db>,
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
    let plugin_slug = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        super::evaluation::lookup_plugin_slug(&conn, &skill_name)
    };
    let workspace_dir = crate::skill_paths::workspace_skill_dir(
        Path::new(&workspace_path),
        &plugin_slug,
        &skill_name,
    );
    materialize_answer_evaluation_output_value(&workspace_dir, &structured_output).map_err(|e| {
        log::error!(
            "[materialize_answer_evaluation_output] skill={} failed: {}",
            skill_name,
            e
        );
        e
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn publish_generated_skill_output_copies_workspace_skill_to_library_layout() {
        let workspace = tempfile::tempdir().unwrap();
        let skills = tempfile::tempdir().unwrap();
        let workspace_skill_root = workspace.path().join("skills").join("lead-routing");
        let generated_refs = workspace_skill_root.join("skill").join("references");
        fs::create_dir_all(&generated_refs).unwrap();
        fs::write(
            workspace_skill_root.join("skill").join("SKILL.md"),
            "---\nname: lead-routing\n---\n# Lead Routing\n",
        )
        .unwrap();
        fs::write(generated_refs.join("terms.md"), "# Terms\n").unwrap();

        let published_dir = publish_generated_skill_output(
            &workspace_skill_root,
            skills.path(),
            "skills",
            "lead-routing",
        )
        .unwrap();

        assert_eq!(
            published_dir,
            crate::skill_paths::resolve_skill_dir(skills.path(), "skills", "lead-routing")
        );
        assert_eq!(
            fs::read_to_string(published_dir.join("SKILL.md")).unwrap(),
            "---\nname: lead-routing\n---\n# Lead Routing\n"
        );
        assert_eq!(
            fs::read_to_string(published_dir.join("references").join("terms.md")).unwrap(),
            "# Terms\n"
        );
    }

    #[test]
    fn publish_generated_skill_output_errors_when_neither_workspace_nor_library_has_skill_md() {
        let workspace = tempfile::tempdir().unwrap();
        let skills = tempfile::tempdir().unwrap();
        let workspace_skill_root = workspace.path().join("skills").join("missing-skill");

        let err = publish_generated_skill_output(
            &workspace_skill_root,
            skills.path(),
            "skills",
            "missing-skill",
        )
        .unwrap_err();

        assert!(
            err.contains("Generated skill output missing"),
            "unexpected error: {err}"
        );
    }

    #[test]
    fn publish_generated_skill_output_accepts_directly_published_skill() {
        let workspace = tempfile::tempdir().unwrap();
        let skills = tempfile::tempdir().unwrap();
        let workspace_skill_root = workspace.path().join("skills").join("direct-skill");
        let published_dir =
            crate::skill_paths::resolve_skill_dir(skills.path(), "skills", "direct-skill");
        fs::create_dir_all(&published_dir).unwrap();
        fs::write(published_dir.join("SKILL.md"), "# Direct\n").unwrap();

        let result = publish_generated_skill_output(
            &workspace_skill_root,
            skills.path(),
            "skills",
            "direct-skill",
        )
        .unwrap();

        assert_eq!(result, published_dir);
        assert_eq!(
            fs::read_to_string(result.join("SKILL.md")).unwrap(),
            "# Direct\n"
        );
    }
}
