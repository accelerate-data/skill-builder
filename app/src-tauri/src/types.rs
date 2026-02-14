use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    pub anthropic_api_key: Option<String>,
    pub workspace_path: Option<String>,
    #[serde(default)]
    pub skills_path: Option<String>,
    pub preferred_model: Option<String>,
    #[serde(default)]
    pub debug_mode: bool,
    /// One of "error", "warn", "info", "debug". Defaults to "info".
    #[serde(default = "default_log_level")]
    pub log_level: String,
    #[serde(default)]
    pub extended_context: bool,
    #[serde(default)]
    pub extended_thinking: bool,
    #[serde(default)]
    pub splash_shown: bool,
    #[serde(default)]
    pub github_oauth_token: Option<String>,
    #[serde(default)]
    pub github_user_login: Option<String>,
    #[serde(default)]
    pub github_user_avatar: Option<String>,
    #[serde(default)]
    pub github_user_email: Option<String>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            anthropic_api_key: None,
            workspace_path: None,
            skills_path: None,
            preferred_model: None,
            debug_mode: false,
            log_level: "info".to_string(),
            extended_context: false,
            extended_thinking: false,
            splash_shown: false,
            github_oauth_token: None,
            github_user_login: None,
            github_user_avatar: None,
            github_user_email: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeStatus {
    pub available: bool,
    pub version: Option<String>,
    pub meets_minimum: bool,
    pub error: Option<String>,
    /// Where the Node.js binary was found: "bundled", "system", or "" on failure.
    #[serde(default)]
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DepStatus {
    pub name: String,
    pub ok: bool,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StartupDeps {
    pub all_ok: bool,
    pub checks: Vec<DepStatus>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillSummary {
    pub name: String,
    pub domain: Option<String>,
    pub current_step: Option<String>,
    pub status: Option<String>,
    pub last_modified: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    pub skill_type: Option<String>,
    #[serde(default)]
    pub author_login: Option<String>,
    #[serde(default)]
    pub author_avatar: Option<String>,
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

fn default_log_level() -> String {
    "info".to_string()
}

fn default_skill_type() -> String {
    "domain".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowRunRow {
    pub skill_name: String,
    pub domain: String,
    pub current_step: i32,
    pub status: String,
    #[serde(default = "default_skill_type")]
    pub skill_type: String,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default)]
    pub author_login: Option<String>,
    #[serde(default)]
    pub author_avatar: Option<String>,
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
pub struct ImportedSkill {
    pub skill_id: String,
    pub skill_name: String,
    pub domain: Option<String>,
    pub description: Option<String>,
    pub is_active: bool,
    pub disk_path: String,
    pub imported_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrphanSkill {
    pub skill_name: String,
    pub domain: String,
    pub skill_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillLock {
    pub skill_name: String,
    pub instance_id: String,
    pub pid: u32,
    pub acquired_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReconciliationResult {
    pub orphans: Vec<OrphanSkill>,
    pub notifications: Vec<String>,
    pub auto_cleaned: u32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DeviceFlowResponse {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub expires_in: u64,
    pub interval: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GitHubUser {
    pub login: String,
    pub avatar_url: String,
    pub email: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "status")]
pub enum GitHubAuthResult {
    #[serde(rename = "pending")]
    Pending,
    #[serde(rename = "slow_down")]
    SlowDown,
    #[serde(rename = "success")]
    Success { user: GitHubUser },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StepResetPreview {
    pub step_id: u32,
    pub step_name: String,
    pub files: Vec<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_app_settings_default() {
        let settings = AppSettings::default();
        assert!(settings.anthropic_api_key.is_none());
        assert!(settings.workspace_path.is_none());
        assert!(settings.skills_path.is_none());
        assert!(settings.preferred_model.is_none());
        assert!(!settings.debug_mode);
        assert_eq!(settings.log_level, "info");
        assert!(!settings.extended_context);
        assert!(!settings.extended_thinking);
        assert!(!settings.splash_shown);
        assert!(settings.github_oauth_token.is_none());
        assert!(settings.github_user_login.is_none());
        assert!(settings.github_user_avatar.is_none());
        assert!(settings.github_user_email.is_none());
    }

    #[test]
    fn test_app_settings_serde_roundtrip() {
        let settings = AppSettings {
            anthropic_api_key: Some("sk-ant-test-key".to_string()),
            workspace_path: Some("/home/user/skills".to_string()),
            skills_path: Some("/home/user/output".to_string()),
            preferred_model: Some("sonnet".to_string()),
            debug_mode: false,
            log_level: "info".to_string(),
            extended_context: false,
            extended_thinking: true,
            splash_shown: false,
            github_oauth_token: Some("gho_testtoken123".to_string()),
            github_user_login: Some("testuser".to_string()),
            github_user_avatar: Some("https://avatars.githubusercontent.com/u/12345".to_string()),
            github_user_email: Some("test@example.com".to_string()),
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
            deserialized.skills_path.as_deref(),
            Some("/home/user/output")
        );
        assert_eq!(
            deserialized.preferred_model.as_deref(),
            Some("sonnet")
        );
    }

    #[test]
    fn test_app_settings_deserialize_without_optional_fields() {
        // Simulates loading settings saved before new OAuth fields existed
        let json = r#"{"anthropic_api_key":"sk-test","workspace_path":"/w","preferred_model":"sonnet","extended_context":false,"splash_shown":false}"#;
        let settings: AppSettings = serde_json::from_str(json).unwrap();
        assert!(settings.skills_path.is_none());
        assert!(!settings.debug_mode);
        assert_eq!(settings.log_level, "info");
        assert!(!settings.extended_thinking);
        assert!(settings.github_oauth_token.is_none());
        assert!(settings.github_user_login.is_none());
        assert!(settings.github_user_avatar.is_none());
        assert!(settings.github_user_email.is_none());

        // Simulates loading settings that still have the old verbose_logging boolean field
        let json_old = r#"{"anthropic_api_key":"sk-test","workspace_path":"/w","preferred_model":"sonnet","verbose_logging":true,"extended_context":false,"splash_shown":false}"#;
        let settings_old: AppSettings = serde_json::from_str(json_old).unwrap();
        // Old verbose_logging is ignored; log_level defaults to "info"
        assert_eq!(settings_old.log_level, "info");
    }

    #[test]
    fn test_sidecar_config_serde() {
        let config = crate::agents::sidecar::SidecarConfig {
            prompt: "test prompt".to_string(),
            model: Some("sonnet".to_string()),
            api_key: "sk-test".to_string(),
            cwd: "/tmp".to_string(),
            allowed_tools: Some(vec!["Read".to_string(), "Write".to_string()]),
            max_turns: Some(10),
            permission_mode: Some("bypassPermissions".to_string()),
            session_id: None,
            betas: None,
            max_thinking_tokens: None,
            path_to_claude_code_executable: None,
            agent_name: Some("domain-research-concepts".to_string()),
        };
        let json = serde_json::to_string(&config).unwrap();
        assert!(json.contains("\"apiKey\""));
        assert!(json.contains("\"allowedTools\""));
        assert!(json.contains("\"maxTurns\""));
        assert!(json.contains("\"permissionMode\""));
        assert!(json.contains("\"agentName\""));
        assert!(json.contains("\"model\""));
        // session_id is None with skip_serializing_if, so should not appear
        assert!(!json.contains("\"sessionId\""));
        // betas is None with skip_serializing_if, so should not appear
        assert!(!json.contains("\"betas\""));
        // max_thinking_tokens is None with skip_serializing_if, so should not appear
        assert!(!json.contains("\"maxThinkingTokens\""));
    }
}
