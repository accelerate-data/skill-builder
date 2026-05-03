use serde::{Deserialize, Serialize};

use crate::agents::sidecar::SidecarConfig;

#[derive(Debug, Clone)]
pub struct OpenHandsOneShotRequest {
    pub prompt: String,
    pub llm: crate::types::WorkflowLlmConfig,
    pub workspace_root_dir: String,
    pub workspace_skill_dir: String,
    pub allowed_tools: Vec<String>,
    pub max_turns: u32,
    pub _agent_name: Option<String>,
    pub _task_kind: Option<String>,
    pub _output_format: Option<serde_json::Value>,
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
            .clone()
            .ok_or_else(|| "OpenHands Agent Server request requires llm config".to_string())?;

        Ok(Self {
            prompt: config.prompt.clone(),
            llm,
            workspace_root_dir: config.workspace_root_dir.clone(),
            workspace_skill_dir: config.workspace_skill_dir.clone(),
            allowed_tools: config.allowed_tools.clone().unwrap_or_default(),
            max_turns: config.max_turns.unwrap_or(50),
            _agent_name: config.agent_name.clone(),
            _task_kind: config.task_kind.clone(),
            _output_format: config.output_format.clone(),
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
    pub working_dir: String,
    pub kind: String,
}

impl LocalWorkspace {
    pub fn new(working_dir: impl Into<String>) -> Self {
        Self {
            working_dir: working_dir.into(),
            kind: "LocalWorkspace".to_string(),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct ConversationMetadata {
    #[serde(rename = "plugin", skip_serializing_if = "Option::is_none")]
    pub plugin_slug: Option<String>,
    #[serde(rename = "skill", skip_serializing_if = "Option::is_none")]
    pub skill_name: Option<String>,
    #[serde(rename = "step", skip_serializing_if = "Option::is_none")]
    pub step_id: Option<i32>,
    #[serde(rename = "source", skip_serializing_if = "Option::is_none")]
    pub run_source: Option<String>,
    #[serde(rename = "session", skip_serializing_if = "Option::is_none")]
    pub workflow_session_id: Option<String>,
    #[serde(rename = "workspace", skip_serializing_if = "Option::is_none")]
    pub workspace_root_dir: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TextContent {
    #[serde(rename = "type")]
    pub content_type: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SendMessageRequest {
    pub role: String,
    pub content: Vec<TextContent>,
    pub run: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NeverConfirmPolicy {
    pub kind: String,
}

impl Default for NeverConfirmPolicy {
    fn default() -> Self {
        Self {
            kind: "NeverConfirm".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenHandsTool {
    pub name: String,
    pub params: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenHandsAgentContext {
    #[serde(
        rename = "user_message_suffix",
        skip_serializing_if = "Option::is_none"
    )]
    pub user_message_suffix: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenHandsAgent {
    pub kind: String,
    pub llm: serde_json::Value,
    pub tools: Vec<OpenHandsTool>,
    #[serde(rename = "include_default_tools")]
    pub include_default_tools: Vec<String>,
    #[serde(rename = "agent_context")]
    pub agent_context: OpenHandsAgentContext,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StartConversationRequest {
    pub workspace: LocalWorkspace,
    #[serde(rename = "initial_message")]
    pub initial_message: SendMessageRequest,
    #[serde(rename = "max_iterations")]
    pub max_iterations: u32,
    #[serde(rename = "stuck_detection")]
    pub stuck_detection: bool,
    #[serde(rename = "confirmation_policy")]
    pub confirmation_policy: NeverConfirmPolicy,
    pub tags: ConversationMetadata,
    pub agent: OpenHandsAgent,
}

impl StartConversationRequest {
    pub fn from_one_shot(request: &OpenHandsOneShotRequest) -> Self {
        Self {
            workspace: LocalWorkspace::new(request.workspace_skill_dir.clone()),
            initial_message: SendMessageRequest {
                role: "user".to_string(),
                content: vec![TextContent {
                    content_type: "text".to_string(),
                    text: request.prompt.clone(),
                }],
                run: false,
            },
            max_iterations: request.max_turns,
            stuck_detection: true,
            confirmation_policy: NeverConfirmPolicy::default(),
            tags: ConversationMetadata {
                plugin_slug: Some(request.plugin_slug.clone()),
                skill_name: request.skill_name.clone(),
                step_id: request.step_id,
                run_source: request.run_source.clone(),
                workflow_session_id: request.workflow_session_id.clone(),
                workspace_root_dir: Some(request.workspace_root_dir.clone()),
            },
            agent: OpenHandsAgent {
                kind: "Agent".to_string(),
                llm: openhands_llm_json(&request.llm),
                tools: openhands_tools(&request.workspace_skill_dir, &request.allowed_tools),
                include_default_tools: vec!["FinishTool".to_string(), "ThinkTool".to_string()],
                agent_context: OpenHandsAgentContext {
                    user_message_suffix: request.user_message_suffix.clone(),
                },
            },
        }
    }
}

fn openhands_llm_json(llm: &crate::types::WorkflowLlmConfig) -> serde_json::Value {
    let mut value = serde_json::json!({
        "model": llm.model,
    });
    if let Some(obj) = value.as_object_mut() {
        if let Some(api_key) = &llm.api_key {
            obj.insert(
                "api_key".to_string(),
                serde_json::Value::String(api_key.expose().to_string()),
            );
        }
        if let Some(base_url) = &llm.base_url {
            obj.insert(
                "base_url".to_string(),
                serde_json::Value::String(base_url.clone()),
            );
        }
        if let Some(api_version) = &llm.api_version {
            obj.insert(
                "api_version".to_string(),
                serde_json::Value::String(api_version.clone()),
            );
        }
        if let Some(temperature) = llm.temperature {
            obj.insert("temperature".to_string(), serde_json::json!(temperature));
        }
        if let Some(max_output_tokens) = llm.max_output_tokens {
            obj.insert(
                "max_output_tokens".to_string(),
                serde_json::json!(max_output_tokens),
            );
        }
        if let Some(timeout_seconds) = llm.timeout_seconds {
            obj.insert("timeout".to_string(), serde_json::json!(timeout_seconds));
        }
        if let Some(num_retries) = llm.num_retries {
            obj.insert("num_retries".to_string(), serde_json::json!(num_retries));
        }
        if let Some(reasoning_effort) = &llm.reasoning_effort {
            obj.insert(
                "reasoning_effort".to_string(),
                serde_json::Value::String(reasoning_effort.clone()),
            );
        }
        if let Some(extra_headers) = &llm.extra_headers {
            obj.insert(
                "extra_headers".to_string(),
                serde_json::json!(extra_headers),
            );
        }
        if let Some(input_cost_per_token) = llm.input_cost_per_token {
            obj.insert(
                "input_cost_per_token".to_string(),
                serde_json::json!(input_cost_per_token),
            );
        }
        if let Some(output_cost_per_token) = llm.output_cost_per_token {
            obj.insert(
                "output_cost_per_token".to_string(),
                serde_json::json!(output_cost_per_token),
            );
        }
        if let Some(usage_id) = &llm.usage_id {
            obj.insert(
                "usage_id".to_string(),
                serde_json::Value::String(usage_id.clone()),
            );
        }
    }
    value
}

fn openhands_tools(working_dir: &str, allowed_tools: &[String]) -> Vec<OpenHandsTool> {
    let normalized = |tool: &str| match tool {
        "terminal" | "bash" | "Bash" | "TerminalTool" => Some("TerminalTool"),
        "file_editor" | "FileEditor" | "FileEditorTool" | "Edit" | "Read" | "Write" => {
            Some("FileEditorTool")
        }
        "task_tracker" | "TaskTrackerTool" => Some("TaskTrackerTool"),
        _ => None,
    };
    let mut names: Vec<&str> = allowed_tools
        .iter()
        .filter_map(|tool| normalized(tool))
        .collect();
    if names.is_empty() {
        names = vec!["TerminalTool", "FileEditorTool", "TaskTrackerTool"];
    }
    names.sort_unstable();
    names.dedup();

    names
        .into_iter()
        .map(|name| OpenHandsTool {
            name: name.to_string(),
            params: if name == "TerminalTool" || name == "FileEditorTool" {
                serde_json::json!({ "working_dir": working_dir })
            } else {
                serde_json::json!({})
            },
        })
        .collect()
}
