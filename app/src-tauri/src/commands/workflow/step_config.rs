use crate::types::StepConfig;

/// Canonical allowed-tools lookup keyed by agent name.
/// Values must match the `tools:` frontmatter in the corresponding agent `.md` file.
pub fn tools_for_agent(agent_name: &str) -> Vec<String> {
    let tools: &[&str] = match agent_name {
        "skill-content-researcher:research-orchestrator" => &["Read", "Skill", "AskUserQuestion"],
        "skill-content-researcher:detailed-research" => &["Read", "Agent", "AskUserQuestion"],
        "skill-content-researcher:confirm-decisions" => &["Read", "AskUserQuestion"],
        "answer-evaluator" => &["Read", "Skill"],
        "skill-creator:generate-skill" => &["Read", "Write", "Edit", "Glob", "Grep", "Bash", "Skill", "AskUserQuestion"],
        "skill-creator:rewrite-skill" => &["Read", "Write", "Edit", "Glob", "Grep", "Bash", "Agent", "Skill", "AskUserQuestion"],
        "skill-creator:generate-skill-description-evals" => &["Read", "Skill"],
        _ => &["Read", "Glob", "Grep", "Agent", "Skill"],
    };
    tools.iter().map(|s| s.to_string()).collect()
}

pub fn resolve_model_id(shorthand: &str) -> String {
    match shorthand {
        "sonnet" => "claude-sonnet-4-6".to_string(),
        "haiku" => "claude-haiku-4-5".to_string(),
        "opus" => "claude-opus-4-6".to_string(),
        other => other.to_string(),
    }
}

/// Canonical step configuration table.
///
/// | Step | Agent | Plugins | Source |
/// |------|-------|---------|--------|
/// | 0 | skill-content-researcher:research-orchestrator | skill-content-researcher | plugin agents/ |
/// | 1 | skill-content-researcher:detailed-research | skill-content-researcher | plugin agents/ |
/// | 2 | skill-content-researcher:confirm-decisions | skill-content-researcher | plugin agents/ |
/// | 3 | skill-creator:generate-skill | skill-creator | plugin agents/ |
pub(crate) fn get_step_config(step_id: u32) -> Result<StepConfig, String> {
    match step_id {
        0 => {
            let agent = "skill-content-researcher:research-orchestrator";
            Ok(StepConfig {
                step_id: 0,
                name: "Research".to_string(),
                prompt_template: "research-orchestrator.md".to_string(),
                output_file: "context/clarifications.json".to_string(),
                allowed_tools: tools_for_agent(agent),
                max_turns: 50,
                agent_name: agent.to_string(),
                required_plugins: vec!["skill-content-researcher".to_string()],
            })
        }
        1 => {
            let agent = "skill-content-researcher:detailed-research";
            Ok(StepConfig {
                step_id: 1,
                name: "Detailed Research".to_string(),
                prompt_template: "detailed-research.md".to_string(),
                output_file: "context/clarifications.json".to_string(),
                allowed_tools: tools_for_agent(agent),
                max_turns: 50,
                agent_name: agent.to_string(),
                required_plugins: vec!["skill-content-researcher".to_string()],
            })
        }
        2 => {
            let agent = "skill-content-researcher:confirm-decisions";
            Ok(StepConfig {
                step_id: 2,
                name: "Confirm Decisions".to_string(),
                prompt_template: "confirm-decisions.md".to_string(),
                output_file: "context/decisions.json".to_string(),
                allowed_tools: tools_for_agent(agent),
                max_turns: 100,
                agent_name: agent.to_string(),
                required_plugins: vec!["skill-content-researcher".to_string()],
            })
        }
        3 => {
            let agent = "skill-creator:generate-skill";
            Ok(StepConfig {
                step_id: 3,
                name: "Generate Skill".to_string(),
                prompt_template: "generate-skill.md".to_string(),
                output_file: "skill/SKILL.md".to_string(),
                allowed_tools: tools_for_agent(agent),
                max_turns: 500,
                agent_name: agent.to_string(),
                required_plugins: vec!["skill-creator".to_string()],
            })
        }
        _ => Err(format!("Unknown step_id {}. Valid steps are 0-3.", step_id)),
    }
}

pub(crate) fn workflow_output_format_for_agent(agent_name: &str) -> Option<serde_json::Value> {
    match agent_name {
        "skill-creator:generate-skill" => Some(serde_json::json!({
            "type": "json_schema",
            "schema": {
                "type": "object",
                "required": ["status"],
                "properties": {
                    "status": { "type": "string", "const": "generated" },
                    "skipped": { "type": "boolean" },
                    "commit_summary": { "type": "string" },
                    "version_bump": { "type": "string", "enum": ["major", "minor", "patch"] }
                },
                "additionalProperties": true
            }
        })),
        "skill-creator:rewrite-skill" => Some(serde_json::json!({
            "type": "json_schema",
            "schema": {
                "type": "object",
                "required": ["status"],
                "properties": {
                    "status": { "type": "string", "const": "rewritten" },
                    "skipped": { "type": "boolean" },
                    "commit_summary": { "type": "string" },
                    "version_bump": { "type": "string", "enum": ["major", "minor", "patch"] }
                },
                "additionalProperties": true
            }
        })),
        "skill-content-researcher:research-orchestrator" => Some(serde_json::json!({
            "type": "json_schema",
            "schema": {
                "type": "object",
                "required": [
                    "status",
                    "dimensions_selected",
                    "question_count",
                    "research_output"
                ],
                "properties": {
                    "status": { "type": "string", "const": "research_complete" },
                    "dimensions_selected": { "type": "integer", "minimum": 0 },
                    "question_count": { "type": "integer", "minimum": 0 },
                    "research_output": { "type": "object" }
                },
                "additionalProperties": true
            }
        })),
        "skill-content-researcher:detailed-research" => Some(serde_json::json!({
            "type": "json_schema",
            "schema": {
                "type": "object",
                "required": [
                    "status",
                    "refinement_count",
                    "section_count",
                    "clarifications_json"
                ],
                "properties": {
                    "status": { "type": "string", "const": "detailed_research_complete" },
                    "refinement_count": { "type": "integer", "minimum": 0 },
                    "section_count": { "type": "integer", "minimum": 0 },
                    "clarifications_json": { "type": "object" }
                },
                "additionalProperties": true
            }
        })),
        "skill-content-researcher:confirm-decisions" => Some(serde_json::json!({
            "type": "json_schema",
            "schema": {
                "type": "object",
                "required": ["version", "metadata", "decisions"],
                "properties": {
                    "version": { "type": "string" },
                    "metadata": { "type": "object" },
                    "decisions": { "type": "array" }
                },
                "additionalProperties": false
            }
        })),
        "skill-creator:generate-skill-description-evals" => Some(serde_json::json!({
            "type": "json_schema",
            "schema": {
                "type": "object",
                "required": ["status", "queries"],
                "properties": {
                    "status": { "type": "string", "const": "generated" },
                    "queries": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "required": ["query", "should_trigger"],
                            "properties": {
                                "query": { "type": "string" },
                                "should_trigger": { "type": "boolean" }
                            },
                            "additionalProperties": false
                        }
                    }
                },
                "additionalProperties": false
            }
        })),
        _ => None,
    }
}

pub(crate) fn thinking_budget_for_step(step_id: u32) -> Option<u32> {
    match step_id {
        0 => Some(8_000),  // research
        1 => Some(8_000),  // detailed-research
        2 => Some(32_000), // confirm-decisions — highest priority
        3 => Some(16_000), // generate-skill — complex synthesis
        _ => None,
    }
}

pub fn build_betas(
    thinking_budget: Option<u32>,
    model: &str,
    interleaved_thinking_beta: bool,
) -> Option<Vec<String>> {
    let mut betas = Vec::new();
    if interleaved_thinking_beta && thinking_budget.is_some() && !model.contains("opus") {
        betas.push("interleaved-thinking-2025-05-14".to_string());
    }
    if betas.is_empty() {
        None
    } else {
        Some(betas)
    }
}

pub(crate) fn validate_clarifications_json(
    clarifications: &serde_json::Value,
) -> Result<(), String> {
    log::debug!(
        "[validate_clarifications_json] input keys: {:?}",
        clarifications.as_object().map(|o| o.keys().collect::<Vec<_>>())
    );
    let root = clarifications
        .as_object()
        .ok_or_else(|| "clarifications_json must be a JSON object".to_string())?;

    let version = root
        .get("version")
        .and_then(super::coerce_to_string)
        .ok_or_else(|| "clarifications_json.version must be present".to_string())?;
    if version.trim().is_empty() {
        return Err("clarifications_json.version must not be empty".to_string());
    }

    let metadata = root
        .get("metadata")
        .and_then(|v| v.as_object())
        .ok_or_else(|| "clarifications_json.metadata must be an object".to_string())?;
    for field in [
        "question_count",
        "section_count",
        "refinement_count",
        "must_answer_count",
    ] {
        if metadata.get(field).and_then(super::coerce_to_i64).is_none() {
            return Err(format!(
                "clarifications_json.metadata.{} must be an integer",
                field
            ));
        }
    }
    if metadata
        .get("priority_questions")
        .and_then(|v| v.as_array())
        .is_none()
    {
        return Err("clarifications_json.metadata.priority_questions must be an array".to_string());
    }

    let sections = root
        .get("sections")
        .and_then(|v| v.as_array())
        .ok_or_else(|| "clarifications_json.sections must be an array".to_string())?;
    for (section_idx, section) in sections.iter().enumerate() {
        let section_obj = section.as_object().ok_or_else(|| {
            format!(
                "clarifications_json.sections[{}] must be an object",
                section_idx
            )
        })?;
        if section_obj.get("id").and_then(super::coerce_to_i64).is_none() {
            return Err(format!(
                "clarifications_json.sections[{}].id must be a number",
                section_idx
            ));
        }
        if section_obj.get("title").and_then(super::coerce_to_string).is_none() {
            return Err(format!(
                "clarifications_json.sections[{}].title must be a string",
                section_idx
            ));
        }
        let default_questions = Vec::new();
        let questions = section_obj
            .get("questions")
            .and_then(|v| v.as_array())
            .unwrap_or(&default_questions);

        for (question_idx, question) in questions.iter().enumerate() {
            let question_obj = question.as_object().ok_or_else(|| {
                format!(
                    "clarifications_json.sections[{}].questions[{}] must be an object",
                    section_idx, question_idx
                )
            })?;
            for field in ["id", "title", "text"] {
                if question_obj.get(field).and_then(super::coerce_to_string).is_none() {
                    return Err(format!(
                        "clarifications_json.sections[{}].questions[{}].{} must be a string",
                        section_idx, question_idx, field
                    ));
                }
            }
            if question_obj
                .get("must_answer")
                .and_then(super::coerce_to_bool)
                .is_none()
            {
                return Err(format!(
                    "clarifications_json.sections[{}].questions[{}].must_answer must be a boolean",
                    section_idx, question_idx
                ));
            }
            let choices = question_obj
                .get("choices")
                .and_then(|v| v.as_array())
                .ok_or_else(|| {
                    format!(
                        "clarifications_json.sections[{}].questions[{}].choices must be an array",
                        section_idx, question_idx
                    )
                })?;
            for (choice_idx, choice) in choices.iter().enumerate() {
                let choice_obj = choice.as_object().ok_or_else(|| {
                    format!(
                        "clarifications_json.sections[{}].questions[{}].choices[{}] must be an object",
                        section_idx, question_idx, choice_idx
                    )
                })?;
                for field in ["id", "text"] {
                    if choice_obj.get(field).and_then(super::coerce_to_string).is_none() {
                        return Err(format!(
                            "clarifications_json.sections[{}].questions[{}].choices[{}].{} must be a string",
                            section_idx, question_idx, choice_idx, field
                        ));
                    }
                }
                if choice_obj
                    .get("is_other")
                    .and_then(super::coerce_to_bool)
                    .is_none()
                {
                    return Err(format!(
                        "clarifications_json.sections[{}].questions[{}].choices[{}].is_other must be a boolean",
                        section_idx, question_idx, choice_idx
                    ));
                }
            }
            if question_obj
                .get("refinements")
                .and_then(|v| v.as_array())
                .is_none()
            {
                return Err(format!(
                    "clarifications_json.sections[{}].questions[{}].refinements must be an array",
                    section_idx, question_idx
                ));
            }
        }
    }

    if root.get("notes").and_then(|v| v.as_array()).is_none() {
        return Err("clarifications_json.notes must be an array".to_string());
    }
    if let Some(value) = root.get("answer_evaluator_notes") {
        if value.as_array().is_none() {
            return Err(
                "clarifications_json.answer_evaluator_notes must be an array when present"
                    .to_string(),
            );
        }
    }

    Ok(())
}
