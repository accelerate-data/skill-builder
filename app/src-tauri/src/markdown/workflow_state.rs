use regex::Regex;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct WorkflowState {
    pub skill_name: Option<String>,
    pub domain: Option<String>,
    pub current_step: Option<String>,
    pub status: Option<String>,
    pub completed_steps: Option<String>,
    pub timestamp: Option<String>,
    pub notes: Option<String>,
}

pub fn parse_workflow_state(content: &str) -> WorkflowState {
    let mut state = WorkflowState::default();

    let re = Regex::new(r"\*\*([^*]+)\*\*:\s*(.+)").unwrap();

    for cap in re.captures_iter(content) {
        let key = cap[1].trim().to_lowercase();
        let value = cap[2].trim().to_string();

        match key.as_str() {
            "skill name" => state.skill_name = Some(value),
            "domain" => state.domain = Some(value),
            "current step" => state.current_step = Some(value),
            "status" => state.status = Some(value),
            "completed steps" => state.completed_steps = Some(value),
            "timestamp" => state.timestamp = Some(value),
            "notes" => state.notes = Some(value),
            _ => {}
        }
    }

    state
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_valid_state() {
        let content = r#"## Workflow State
- **Skill name**: sales-pipeline
- **Domain**: sales pipeline analysis
- **Current step**: Step 3: Research Patterns & Data Modeling
- **Status**: in_progress
- **Completed steps**: Initialization, Step 1, Step 2
- **Timestamp**: 2025-05-01 14:30:00
- **Notes**: Waiting for parallel agents to complete
"#;
        let state = parse_workflow_state(content);
        assert_eq!(state.skill_name.as_deref(), Some("sales-pipeline"));
        assert_eq!(state.domain.as_deref(), Some("sales pipeline analysis"));
        assert_eq!(
            state.current_step.as_deref(),
            Some("Step 3: Research Patterns & Data Modeling")
        );
        assert_eq!(state.status.as_deref(), Some("in_progress"));
        assert_eq!(
            state.completed_steps.as_deref(),
            Some("Initialization, Step 1, Step 2")
        );
        assert_eq!(state.timestamp.as_deref(), Some("2025-05-01 14:30:00"));
        assert_eq!(
            state.notes.as_deref(),
            Some("Waiting for parallel agents to complete")
        );
    }

    #[test]
    fn test_parse_empty_content() {
        let state = parse_workflow_state("");
        assert!(state.skill_name.is_none());
        assert!(state.domain.is_none());
        assert!(state.current_step.is_none());
        assert!(state.status.is_none());
        assert!(state.completed_steps.is_none());
        assert!(state.timestamp.is_none());
        assert!(state.notes.is_none());
    }

    #[test]
    fn test_parse_missing_keys() {
        let content = r#"## Workflow State
- **Skill name**: hr-analytics
- **Domain**: HR analytics
"#;
        let state = parse_workflow_state(content);
        assert_eq!(state.skill_name.as_deref(), Some("hr-analytics"));
        assert_eq!(state.domain.as_deref(), Some("HR analytics"));
        assert!(state.current_step.is_none());
        assert!(state.status.is_none());
        assert!(state.completed_steps.is_none());
        assert!(state.timestamp.is_none());
        assert!(state.notes.is_none());
    }

    #[test]
    fn test_parse_extra_whitespace() {
        let content = r#"## Workflow State
- **Skill name**:   extra-spaces-skill
- **Domain**:   financial planning
- **Status**:   completed
"#;
        let state = parse_workflow_state(content);
        assert_eq!(state.skill_name.as_deref(), Some("extra-spaces-skill"));
        assert_eq!(state.domain.as_deref(), Some("financial planning"));
        assert_eq!(state.status.as_deref(), Some("completed"));
    }
}
