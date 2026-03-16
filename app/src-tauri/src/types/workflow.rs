use serde::{Deserialize, Serialize};

fn default_purpose() -> String {
    "domain".to_string()
}

fn default_source() -> String {
    "created".to_string()
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
pub struct WorkflowRunRow {
    pub skill_name: String,
    pub current_step: i32,
    pub status: String,
    #[serde(default = "default_purpose")]
    pub purpose: String,
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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillMasterRow {
    pub id: i64,
    pub name: String,
    pub skill_source: String,
    pub purpose: Option<String>,
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
pub struct StepResetPreview {
    pub step_id: u32,
    pub step_name: String,
    pub files: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrphanSkill {
    pub skill_name: String,
    pub purpose: String,
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
