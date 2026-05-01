use crate::types::StepConfig;

/// Canonical allowed-tools lookup keyed by agent name.
/// Values must match the `tools:` frontmatter in the corresponding agent `.md` file.
pub fn tools_for_agent(agent_name: &str) -> Vec<String> {
    let tools: &[&str] = match agent_name {
        "research-agent" | "skill-writer-agent" => &["file_editor", "terminal"],
        "answer-evaluator" => &["file_editor"],
        _ => &["file_editor", "terminal"],
    };
    tools.iter().map(|s| s.to_string()).collect()
}

fn one_shot_tools_for_agent(agent_name: &str) -> Vec<String> {
    tools_for_agent(agent_name)
}

/// Canonical step configuration table.
///
/// `agent_name` identifies the step capability used for tools, output schema,
/// and logging.
///
/// | Step | Capability | Plugins |
/// |------|------------|---------|
/// | 0 | research-agent | skill-content-researcher |
/// | 1 | research-agent | skill-content-researcher |
/// | 2 | skill-writer-agent | skill-content-researcher |
/// | 3 | skill-writer-agent | skill-content-researcher, skill-creator |
pub(crate) fn get_step_config(step_id: u32) -> Result<StepConfig, String> {
    match step_id {
        0 => {
            let agent = "research-agent";
            Ok(StepConfig {
                step_id: 0,
                name: "Research".to_string(),
                prompt_template: "research-agent.md".to_string(),
                output_file: "context/clarifications.json".to_string(),
                allowed_tools: one_shot_tools_for_agent(agent),
                max_turns: 50,
                agent_name: agent.to_string(),
                required_plugins: vec!["skill-content-researcher".to_string()],
            })
        }
        1 => {
            let agent = "research-agent";
            Ok(StepConfig {
                step_id: 1,
                name: "Detailed Research".to_string(),
                prompt_template: "research-agent.md".to_string(),
                output_file: "context/clarifications.json".to_string(),
                allowed_tools: one_shot_tools_for_agent(agent),
                max_turns: 50,
                agent_name: agent.to_string(),
                required_plugins: vec!["skill-content-researcher".to_string()],
            })
        }
        2 => {
            let agent = "skill-writer-agent";
            Ok(StepConfig {
                step_id: 2,
                name: "Confirm Decisions".to_string(),
                prompt_template: "skill-writer-agent.md".to_string(),
                output_file: "context/decisions.json".to_string(),
                allowed_tools: one_shot_tools_for_agent(agent),
                max_turns: 100,
                agent_name: agent.to_string(),
                required_plugins: vec!["skill-content-researcher".to_string()],
            })
        }
        3 => {
            let agent = "skill-writer-agent";
            Ok(StepConfig {
                step_id: 3,
                name: "Generate Skill".to_string(),
                prompt_template: "skill-writer-agent.md".to_string(),
                output_file: "skill/SKILL.md".to_string(),
                allowed_tools: one_shot_tools_for_agent(agent),
                max_turns: 500,
                agent_name: agent.to_string(),
                required_plugins: vec![
                    "skill-content-researcher".to_string(),
                    "skill-creator".to_string(),
                ],
            })
        }
        _ => Err(format!("Unknown step_id {}. Valid steps are 0-3.", step_id)),
    }
}

pub(crate) fn workflow_output_format_for_step(step_id: u32) -> Option<serde_json::Value> {
    use crate::generated::schemas;

    let schema_str = match step_id {
        // Deep schema — all fields required per SKILL.md, nested ClarificationsFile enforced.
        0 => Some(schemas::RESEARCH_STEP_INLINE_SCHEMA),
        // Step 1 reuses research-agent with the detailed research schema.
        1 => Some(schemas::DETAILED_RESEARCH_INLINE_SCHEMA),
        // Step 2 reuses skill-writer-agent with the decisions schema.
        2 => Some(schemas::DECISIONS_INLINE_SCHEMA),
        3 => Some(schemas::GENERATE_SKILL_SCHEMA),
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
        1 => Some(8_000),  // research-agent detailed research
        2 => Some(32_000), // skill-writer-agent decisions pass
        3 => Some(16_000), // skill-writer-agent skill generation
        _ => None,
    }
}

pub fn build_betas(
    thinking_budget: Option<u32>,
    model: &str,
    interleaved_thinking_beta: bool,
) -> Option<Vec<String>> {
    let mut betas = Vec::new();
    let _ = model;
    if interleaved_thinking_beta && thinking_budget.is_some() {
        betas.push("interleaved-thinking-2025-05-14".to_string());
    }
    if betas.is_empty() { None } else { Some(betas) }
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
