use crate::agents::sidecar::SidecarConfig;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone)]
pub struct OpenHandsOneShotRequest {
    pub prompt: String,
    pub llm: serde_json::Value,
    pub workspace_root_dir: String,
    pub workspace_skill_dir: String,
    pub allowed_tools: Vec<String>,
    pub max_turns: u32,
    pub agent_name: Option<String>,
    pub task_kind: Option<String>,
    pub output_format: Option<serde_json::Value>,
    pub user_message_suffix: Option<String>,
    pub plugin_slug: String,
    pub skill_name: Option<String>,
    pub step_id: Option<i32>,
    pub run_source: Option<String>,
    pub workflow_session_id: Option<String>,
}

impl OpenHandsOneShotRequest {
    pub fn try_from_sidecar_config(config: &SidecarConfig) -> Result<Self, String> {
        let llm = config
            .llm
            .as_ref()
            .ok_or_else(|| "OpenHands Agent Server request requires llm config".to_string())
            .and_then(|llm| {
                serde_json::to_value(llm)
                    .map_err(|e| format!("Failed to serialize OpenHands llm config: {e}"))
            })?;

        Ok(Self {
            prompt: config.prompt.clone(),
            llm,
            workspace_root_dir: config.workspace_root_dir.clone(),
            workspace_skill_dir: config.workspace_skill_dir.clone(),
            allowed_tools: config.allowed_tools.clone().unwrap_or_default(),
            max_turns: config.max_turns.unwrap_or(50),
            agent_name: config.agent_name.clone(),
            task_kind: config.task_kind.clone(),
            output_format: config.output_format.clone(),
            user_message_suffix: config.user_message_suffix.clone(),
            plugin_slug: config.plugin_slug.clone(),
            skill_name: config.skill_name.clone(),
            step_id: config.step_id,
            run_source: config.run_source.clone(),
            workflow_session_id: config.workflow_session_id.clone(),
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LocalWorkspace {
    #[serde(rename = "type")]
    pub workspace_type: String,
    pub working_dir: String,
}

impl LocalWorkspace {
    pub fn new(working_dir: impl Into<String>) -> Self {
        Self {
            workspace_type: "LocalWorkspace".to_string(),
            working_dir: working_dir.into(),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct ConversationMetadata {
    #[serde(rename = "pluginSlug", skip_serializing_if = "Option::is_none")]
    pub plugin_slug: Option<String>,
    #[serde(rename = "skillName", skip_serializing_if = "Option::is_none")]
    pub skill_name: Option<String>,
    #[serde(rename = "stepId", skip_serializing_if = "Option::is_none")]
    pub step_id: Option<i32>,
    #[serde(rename = "runSource", skip_serializing_if = "Option::is_none")]
    pub run_source: Option<String>,
    #[serde(rename = "workflowSessionId", skip_serializing_if = "Option::is_none")]
    pub workflow_session_id: Option<String>,
    #[serde(rename = "workspaceRootDir", skip_serializing_if = "Option::is_none")]
    pub workspace_root_dir: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StartConversationRequest {
    pub prompt: String,
    pub llm: serde_json::Value,
    pub workspace: LocalWorkspace,
    #[serde(rename = "allowedTools")]
    pub allowed_tools: Vec<String>,
    #[serde(rename = "maxTurns")]
    pub max_turns: u32,
    #[serde(rename = "agentName", skip_serializing_if = "Option::is_none")]
    pub agent_name: Option<String>,
    #[serde(rename = "taskKind", skip_serializing_if = "Option::is_none")]
    pub task_kind: Option<String>,
    #[serde(rename = "outputFormat", skip_serializing_if = "Option::is_none")]
    pub output_format: Option<serde_json::Value>,
    #[serde(rename = "userMessageSuffix", skip_serializing_if = "Option::is_none")]
    pub user_message_suffix: Option<String>,
    pub metadata: ConversationMetadata,
}

impl StartConversationRequest {
    pub fn from_one_shot(request: &OpenHandsOneShotRequest) -> Self {
        Self {
            prompt: request.prompt.clone(),
            llm: request.llm.clone(),
            workspace: LocalWorkspace::new(request.workspace_skill_dir.clone()),
            allowed_tools: request.allowed_tools.clone(),
            max_turns: request.max_turns,
            agent_name: request.agent_name.clone(),
            task_kind: request.task_kind.clone(),
            output_format: request.output_format.clone(),
            user_message_suffix: request.user_message_suffix.clone(),
            metadata: ConversationMetadata {
                plugin_slug: Some(request.plugin_slug.clone()),
                skill_name: request.skill_name.clone(),
                step_id: request.step_id,
                run_source: request.run_source.clone(),
                workflow_session_id: request.workflow_session_id.clone(),
                workspace_root_dir: Some(request.workspace_root_dir.clone()),
            },
        }
    }
}
