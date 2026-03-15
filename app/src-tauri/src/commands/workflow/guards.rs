use std::path::Path;

/// Read a deployed agent `.md` file from `.claude/agents/` and extract
/// the `name:` field from its YAML frontmatter.
pub(crate) fn read_agent_frontmatter_name(workspace_path: &str, phase: &str) -> Option<String> {
    let agent_file = Path::new(workspace_path)
        .join(".claude")
        .join("agents")
        .join(format!("{}.md", phase));
    let content = std::fs::read_to_string(&agent_file).ok()?;
    if !content.starts_with("---") {
        return None;
    }
    let after_start = &content[3..];
    let end = after_start.find("---")?;
    let frontmatter = &after_start[..end];
    for line in frontmatter.lines() {
        let trimmed = line.trim();
        if let Some(name) = trimmed.strip_prefix("name:") {
            let name = name.trim();
            if !name.is_empty() {
                return Some(name.to_string());
            }
        }
    }
    None
}

/// Check if clarifications.json has `metadata.scope_recommendation == true`.
pub(crate) fn parse_scope_recommendation(clarifications_path: &Path) -> bool {
    let content = match std::fs::read_to_string(clarifications_path) {
        Ok(c) => c,
        Err(_) => return false,
    };
    let value: serde_json::Value = match serde_json::from_str(&content) {
        Ok(v) => v,
        Err(_) => return false,
    };
    value["metadata"]["scope_recommendation"] == true
}

/// Check decisions.json for guard conditions:
/// - metadata.decision_count == 0  → no decisions were derivable
/// - metadata.contradictory_inputs: true → unresolvable contradictions detected
///
/// `contradictory_inputs: revised` is NOT a block — the user has reviewed
/// and edited the flagged decisions; treat decisions.json as authoritative.
///
/// Returns true if step 3 should be disabled.
pub(crate) fn parse_decisions_guard(decisions_path: &Path) -> bool {
    let content = match std::fs::read_to_string(decisions_path) {
        Ok(c) => c,
        Err(_) => return false,
    };
    let data: serde_json::Value = match serde_json::from_str(&content) {
        Ok(v) => v,
        Err(_) => return false,
    };
    let metadata = &data["metadata"];
    if metadata["decision_count"].as_i64() == Some(0) {
        return true;
    }
    if metadata["contradictory_inputs"].as_bool() == Some(true) {
        return true;
    }
    false
}

/// Derive agent name from prompt template.
/// Reads the deployed agent file's frontmatter `name:` field (the SDK uses
/// this to register the agent). Falls back to the phase name if the
/// file is missing or has no name field.
pub(crate) fn derive_agent_name(workspace_path: &str, _purpose: &str, prompt_template: &str) -> String {
    let phase = prompt_template.trim_end_matches(".md");
    if let Some(name) = read_agent_frontmatter_name(workspace_path, phase) {
        return name;
    }
    phase.to_string()
}

/// Generate a unique agent ID from skill name, label, and timestamp.
pub(crate) fn make_agent_id(skill_name: &str, label: &str) -> String {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!("{}-{}-{}", skill_name, label, ts)
}

/// Convert a step config name to a lowercase-hyphenated runtime label.
pub(crate) fn workflow_step_runtime_label(step: &crate::types::StepConfig) -> String {
    step.name.to_ascii_lowercase().replace(' ', "-")
}

/// Core logic for validating decisions.json existence — testable without tauri::State.
/// Checks in order: skill output dir (skillsPath), workspace dir.
/// Returns Ok(()) if found, Err with a clear message if missing.
pub(crate) fn validate_decisions_exist_inner(
    skill_name: &str,
    workspace_path: &str,
    _skills_path: &str,
) -> Result<(), String> {
    let path = Path::new(workspace_path)
        .join(skill_name)
        .join("context")
        .join("decisions.json");
    if path.exists() {
        let content = std::fs::read_to_string(&path).unwrap_or_default();
        if !content.trim().is_empty() {
            return Ok(());
        }
    }

    Err(
        "Cannot start Generate Skill step: decisions.json was not found on the filesystem. \
         The Confirm Decisions step (step 2) must create a decisions file before the Generate Skill step can run. \
         Please re-run the Confirm Decisions step first."
            .to_string(),
    )
}
