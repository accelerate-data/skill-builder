use serde::{Deserialize, Serialize};

// ─── marketplace.json deserialization types ──────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct MarketplaceJson {
    pub plugins: Vec<MarketplacePlugin>,
}

#[derive(Debug, Deserialize)]
pub struct MarketplacePlugin {
    pub name: String,
    pub source: MarketplacePluginSource,
    pub description: Option<String>,
    pub version: Option<String>,
    pub author: Option<MarketplaceAuthor>,
    pub category: Option<String>,
    pub tags: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
pub struct MarketplaceAuthor {
    pub name: Option<String>,
    pub email: Option<String>,
}

/// The `source` field in a marketplace plugin entry can be a plain string
/// (relative path such as `"./analytics-skill"`) or an object (e.g. npm, pip,
/// url). Only string sources are supported for listing; object sources are
/// skipped with a warning.
#[derive(Debug, Deserialize)]
#[serde(untagged)]
pub enum MarketplacePluginSource {
    Path(String),
    External {
        source: String,
        #[serde(flatten)]
        extra: serde_json::Value,
    },
}

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
    #[serde(default)]
    pub marketplace_url: Option<String>,
    #[serde(default = "default_max_dimensions")]
    pub max_dimensions: u32,
    #[serde(default)]
    pub industry: Option<String>,
    #[serde(default)]
    pub function_role: Option<String>,
    /// Dashboard view mode: "grid" | "list" | None (auto-select based on skill count)
    #[serde(default)]
    pub dashboard_view_mode: Option<String>,
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
            marketplace_url: None,
            max_dimensions: 5,
            industry: None,
            function_role: None,
            dashboard_view_mode: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PushResult {
    pub pr_url: String,
    pub pr_number: u64,
    pub branch: String,
    pub version: u32,
    pub is_new_pr: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitHubRepo {
    pub full_name: String,
    pub owner: String,
    pub name: String,
    pub description: Option<String>,
    pub is_private: bool,
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
    #[serde(default)]
    pub display_name: Option<String>,
    #[serde(default)]
    pub intake_json: Option<String>,
    #[serde(default)]
    pub source: Option<String>,
    /// The skill_source from the skills master table (skill-builder, marketplace, imported).
    #[serde(default)]
    pub skill_source: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default, rename = "argumentHint")]
    pub argument_hint: Option<String>,
    #[serde(default, rename = "userInvocable")]
    pub user_invocable: Option<bool>,
    #[serde(default, rename = "disableModelInvocation")]
    pub disable_model_invocation: Option<bool>,
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

fn default_max_dimensions() -> u32 {
    5
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
    #[serde(default)]
    pub display_name: Option<String>,
    #[serde(default)]
    pub intake_json: Option<String>,
    #[serde(default = "default_source")]
    pub source: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub argument_hint: Option<String>,
    #[serde(default)]
    pub user_invocable: Option<bool>,
    #[serde(default)]
    pub disable_model_invocation: Option<bool>,
}

fn default_source() -> String {
    "created".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillMasterRow {
    pub id: i64,
    pub name: String,
    pub skill_source: String,
    pub domain: Option<String>,
    pub skill_type: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    // SKILL.md frontmatter fields — canonical store for all skill sources
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub argument_hint: Option<String>,
    #[serde(default)]
    pub user_invocable: Option<bool>,
    #[serde(default)]
    pub disable_model_invocation: Option<bool>,
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
    pub is_active: bool,
    pub disk_path: String,
    pub imported_at: String,
    #[serde(default)]
    pub is_bundled: bool,
    // Populated from SKILL.md frontmatter on disk, not from DB
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default)]
    pub skill_type: Option<String>,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub argument_hint: Option<String>,
    #[serde(default)]
    pub user_invocable: Option<bool>,
    #[serde(default)]
    pub disable_model_invocation: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceSkill {
    pub skill_id: String,
    pub skill_name: String,
    pub domain: Option<String>,
    pub description: Option<String>,
    pub is_active: bool,
    pub is_bundled: bool,
    pub disk_path: String,
    pub imported_at: String,
    pub skill_type: Option<String>,
    pub version: Option<String>,
    pub model: Option<String>,
    pub argument_hint: Option<String>,
    pub user_invocable: Option<bool>,
    pub disable_model_invocation: Option<bool>,
    #[serde(default)]
    pub purpose: Option<String>,
}

impl From<ImportedSkill> for WorkspaceSkill {
    fn from(s: ImportedSkill) -> Self {
        Self {
            skill_id: s.skill_id,
            skill_name: s.skill_name,
            domain: s.domain,
            description: s.description,
            is_active: s.is_active,
            is_bundled: s.is_bundled,
            disk_path: s.disk_path,
            imported_at: s.imported_at,
            skill_type: s.skill_type,
            version: s.version,
            model: s.model,
            argument_hint: s.argument_hint,
            user_invocable: s.user_invocable,
            disable_model_invocation: s.disable_model_invocation,
            purpose: None,
        }
    }
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
pub struct DiscoveredSkill {
    pub name: String,
    pub detected_step: i32,
    pub scenario: String, // "9a", "9b", "9c"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReconciliationResult {
    pub orphans: Vec<OrphanSkill>,
    pub notifications: Vec<String>,
    pub auto_cleaned: u32,
    pub discovered_skills: Vec<DiscoveredSkill>,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentRunRecord {
    pub agent_id: String,
    pub skill_name: String,
    pub step_id: i32,
    pub model: String,
    pub status: String,
    pub input_tokens: i32,
    pub output_tokens: i32,
    pub cache_read_tokens: i32,
    pub cache_write_tokens: i32,
    pub total_cost: f64,
    pub duration_ms: i64,
    pub num_turns: i32,
    pub stop_reason: Option<String>,
    pub duration_api_ms: Option<i64>,
    pub tool_use_count: i32,
    pub compaction_count: i32,
    pub session_id: Option<String>,
    pub started_at: String,
    pub completed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowSessionRecord {
    pub session_id: String,
    pub skill_name: String,
    pub min_step: i32,
    pub max_step: i32,
    pub steps_csv: String,
    pub agent_count: i32,
    pub total_cost: f64,
    pub total_input_tokens: i64,
    pub total_output_tokens: i64,
    pub total_cache_read: i64,
    pub total_cache_write: i64,
    pub total_duration_ms: i64,
    pub started_at: String,
    pub completed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageSummary {
    pub total_cost: f64,
    pub total_runs: i32,
    pub avg_cost_per_run: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageByStep {
    pub step_id: i32,
    pub step_name: String,
    pub total_cost: f64,
    pub run_count: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageByModel {
    pub model: String,
    pub total_cost: f64,
    pub run_count: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitHubRepoInfo {
    pub owner: String,
    pub repo: String,
    pub branch: String,
    #[serde(default)]
    pub subpath: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AvailableSkill {
    pub path: String,
    pub name: String,
    pub domain: Option<String>,
    pub description: Option<String>,
    #[serde(default)]
    pub skill_type: Option<String>,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub argument_hint: Option<String>,
    #[serde(default)]
    pub user_invocable: Option<bool>,
    #[serde(default)]
    pub disable_model_invocation: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SkillMetadataOverride {
    pub name: Option<String>,
    pub description: Option<String>,
    pub domain: Option<String>,
    pub skill_type: Option<String>,
    pub version: Option<String>,
    pub model: Option<String>,
    pub argument_hint: Option<String>,
    pub user_invocable: Option<bool>,
    pub disable_model_invocation: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillCommit {
    pub sha: String,
    pub message: String,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillDiff {
    pub files: Vec<FileDiff>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileDiff {
    pub path: String,
    /// One of "added", "modified", "deleted"
    pub status: String,
    pub old_content: Option<String>,
    pub new_content: Option<String>,
}

// ─── Refine session types (VD-702) ──────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillFileContent {
    /// Relative path from the skill root (e.g. "SKILL.md", "references/guide.md")
    pub path: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RefineFileDiff {
    pub path: String,
    /// One of "added", "modified", "deleted"
    pub status: String,
    /// Unified diff text for this file
    pub diff: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RefineDiff {
    /// Human-readable change summary (e.g. "1 file(s) changed, 3 insertion(s)(+)")
    pub stat: String,
    pub files: Vec<RefineFileDiff>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RefineSessionInfo {
    pub session_id: String,
    pub skill_name: String,
    pub created_at: String,
}

/// A single message in a refine conversation history.
/// Typed struct ensures Tauri IPC rejects malformed payloads at the boundary
/// rather than silently forwarding broken JSON to the sidecar.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationMessage {
    pub role: String,
    pub content: String,
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
        assert_eq!(settings.log_level, "info");
        assert!(!settings.extended_context);
        assert!(!settings.extended_thinking);
        assert!(!settings.splash_shown);
        assert!(settings.github_oauth_token.is_none());
        assert!(settings.github_user_login.is_none());
        assert!(settings.github_user_avatar.is_none());
        assert!(settings.github_user_email.is_none());
        assert!(settings.marketplace_url.is_none());
        assert!(settings.industry.is_none());
        assert!(settings.function_role.is_none());
        assert!(settings.dashboard_view_mode.is_none());
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
            marketplace_url: Some("https://github.com/my-org/skills".to_string()),
            max_dimensions: 5,
            industry: Some("Financial Services".to_string()),
            function_role: Some("Analytics Engineer".to_string()),
            dashboard_view_mode: Some("grid".to_string()),
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
        assert_eq!(
            deserialized.marketplace_url.as_deref(),
            Some("https://github.com/my-org/skills")
        );
        assert_eq!(
            deserialized.industry.as_deref(),
            Some("Financial Services")
        );
        assert_eq!(
            deserialized.function_role.as_deref(),
            Some("Analytics Engineer")
        );
    }

    #[test]
    fn test_app_settings_deserialize_without_optional_fields() {
        // Simulates loading settings saved before new OAuth fields existed
        let json = r#"{"anthropic_api_key":"sk-test","workspace_path":"/w","preferred_model":"sonnet","extended_context":false,"splash_shown":false}"#;
        let settings: AppSettings = serde_json::from_str(json).unwrap();
        assert!(settings.skills_path.is_none());
        assert_eq!(settings.log_level, "info");
        assert!(!settings.extended_thinking);
        assert!(settings.github_oauth_token.is_none());
        assert!(settings.github_user_login.is_none());
        assert!(settings.github_user_avatar.is_none());
        assert!(settings.github_user_email.is_none());
        assert!(settings.marketplace_url.is_none());

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
            agent_name: Some("research-entities".to_string()),
            conversation_history: None,
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
