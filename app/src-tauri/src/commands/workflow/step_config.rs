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
    use crate::generated::schemas;

    let schema_str = match agent_name {
        // Deep schema — all fields required per SKILL.md, nested ClarificationsFile enforced.
        "skill-content-researcher:research-orchestrator" => Some(schemas::RESEARCH_STEP_INLINE_SCHEMA),
        // Step 1 runs the agent directly (no subagent relay) — use the full
        // nested schema so the SDK enforces the complete structure.
        "skill-content-researcher:detailed-research" => Some(schemas::DETAILED_RESEARCH_INLINE_SCHEMA),
        // Step 2 runs the agent directly (no subagent relay) — use the full
        // nested schema so the SDK enforces Decision fields and DecisionStatus enum.
        "skill-content-researcher:confirm-decisions" => Some(schemas::DECISIONS_INLINE_SCHEMA),
        "skill-creator:generate-skill" | "skill-creator:rewrite-skill" => {
            Some(schemas::GENERATE_SKILL_SCHEMA)
        }
        // No generated contract type — keep hand-crafted schema
        "skill-creator:generate-skill-description-evals" => {
            return Some(serde_json::json!({
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
            }));
        }
        _ => None,
    };
    schema_str.map(|s| {
        let schema: serde_json::Value =
            serde_json::from_str(s).expect("generated schema must be valid JSON");
        serde_json::json!({
            "type": "json_schema",
            "schema": schema
        })
    })
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

/// Validate a clarifications JSON payload by deserializing into the typed contract.
///
/// This replaces the old imperative field-by-field validator with typed serde
/// deserialization via `ClarificationsFile`. The typed struct enforces all required
/// fields, correct types, and nested structure at deserialization time.
pub(crate) fn validate_clarifications_json(
    clarifications: &serde_json::Value,
) -> Result<(), String> {
    log::debug!(
        "[validate_clarifications_json] input keys: {:?}",
        clarifications
            .as_object()
            .map(|o| o.keys().collect::<Vec<_>>())
    );
    serde_json::from_value::<crate::contracts::clarifications::ClarificationsFile>(
        clarifications.clone(),
    )
    .map_err(|e| format!("{}", e))?;
    Ok(())
}
