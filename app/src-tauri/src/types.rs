use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    pub anthropic_api_key: Option<String>,
    pub workspace_path: Option<String>,
    pub preferred_model: Option<String>,
    #[serde(default)]
    pub debug_mode: bool,
    #[serde(default)]
    pub extended_context: bool,
    #[serde(default)]
    pub splash_shown: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            anthropic_api_key: None,
            workspace_path: None,
            preferred_model: None,
            debug_mode: false,
            extended_context: false,
            splash_shown: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeStatus {
    pub available: bool,
    pub version: Option<String>,
    pub meets_minimum: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillSummary {
    pub name: String,
    pub domain: Option<String>,
    pub current_step: Option<String>,
    pub status: Option<String>,
    pub last_modified: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StepConfig {
    pub step_id: u32,
    pub name: String,
    pub prompt_template: String,
    pub output_file: String,
    pub allowed_tools: Vec<String>,
    pub max_turns: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PackageResult {
    pub file_path: String,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillFileEntry {
    pub name: String,
    pub relative_path: String,
    pub absolute_path: String,
    pub is_directory: bool,
    pub is_readonly: bool,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowRunRow {
    pub skill_name: String,
    pub domain: String,
    pub current_step: i32,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowStepRow {
    pub skill_name: String,
    pub step_id: i32,
    pub status: String,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentRunRow {
    pub agent_id: String,
    pub skill_name: String,
    pub step_id: i32,
    pub model: String,
    pub status: String,
    pub input_tokens: Option<i64>,
    pub output_tokens: Option<i64>,
    pub total_cost: Option<f64>,
    pub session_id: Option<String>,
    pub started_at: String,
    pub completed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatSessionRow {
    pub id: String,
    pub skill_name: String,
    pub mode: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessageRow {
    pub id: String,
    pub session_id: String,
    pub role: String,
    pub content: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowStateResponse {
    pub run: Option<WorkflowRunRow>,
    pub steps: Vec<WorkflowStepRow>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StepStatusUpdate {
    pub step_id: i32,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArtifactRow {
    pub skill_name: String,
    pub step_id: i32,
    pub relative_path: String,
    pub content: String,
    pub size_bytes: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_app_settings_default() {
        let settings = AppSettings::default();
        assert!(settings.anthropic_api_key.is_none());
        assert!(settings.workspace_path.is_none());
        assert!(settings.preferred_model.is_none());
    }

    #[test]
    fn test_app_settings_serde_roundtrip() {
        let settings = AppSettings {
            anthropic_api_key: Some("sk-ant-test-key".to_string()),
            workspace_path: Some("/home/user/skills".to_string()),
            preferred_model: Some("sonnet".to_string()),
            debug_mode: false,
            extended_context: false,
            splash_shown: false,
        };
        let json = serde_json::to_string(&settings).unwrap();
        let deserialized: AppSettings = serde_json::from_str(&json).unwrap();
        assert_eq!(
            deserialized.anthropic_api_key.as_deref(),
            Some("sk-ant-test-key")
        );
        assert_eq!(
            deserialized.workspace_path.as_deref(),
            Some("/home/user/skills")
        );
        assert_eq!(
            deserialized.preferred_model.as_deref(),
            Some("sonnet")
        );
    }

    #[test]
    fn test_sidecar_config_serde() {
        let config = crate::agents::sidecar::SidecarConfig {
            prompt: "test prompt".to_string(),
            model: "sonnet".to_string(),
            api_key: "sk-test".to_string(),
            cwd: "/tmp".to_string(),
            allowed_tools: Some(vec!["Read".to_string(), "Write".to_string()]),
            max_turns: Some(10),
            permission_mode: Some("bypassPermissions".to_string()),
            session_id: None,
            betas: None,
            path_to_claude_code_executable: None,
        };
        let json = serde_json::to_string(&config).unwrap();
        assert!(json.contains("\"apiKey\""));
        assert!(json.contains("\"allowedTools\""));
        assert!(json.contains("\"maxTurns\""));
        assert!(json.contains("\"permissionMode\""));
        // session_id is None with skip_serializing_if, so should not appear
        assert!(!json.contains("\"sessionId\""));
        // betas is None with skip_serializing_if, so should not appear
        assert!(!json.contains("\"betas\""));
    }
}
