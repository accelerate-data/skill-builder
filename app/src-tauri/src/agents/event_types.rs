use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentEvent {
    pub agent_id: String,
    pub message: serde_json::Value,
}

/// Payload emitted as the `agent-exit` Tauri event when a sidecar process terminates.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentExitPayload {
    pub agent_id: String,
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_detail: Option<String>,
}

/// Payload emitted as the `agent-shutdown` Tauri event when an agent is shut down.
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentShutdownPayload {
    pub agent_id: String,
}

/// Payload for sidecar startup error events sent to the frontend.
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentInitError {
    pub error_type: String,
    pub message: String,
    pub fix_hint: String,
}

/// Per-model usage entry from sidecar run_result.
#[derive(Debug, Clone, Deserialize)]
pub struct SidecarModelUsageEntry {
    pub model: String,
    #[serde(rename = "inputTokens")]
    pub input_tokens: i32,
    #[serde(rename = "outputTokens")]
    pub output_tokens: i32,
    #[serde(rename = "cacheReadTokens")]
    pub cache_read_tokens: i32,
    #[serde(rename = "cacheWriteTokens")]
    pub cache_write_tokens: i32,
    pub cost: f64,
}

/// Self-contained run_result from the sidecar.
/// Some fields are deserialized for protocol completeness but not yet
/// persisted to DB — suppress dead_code until the insert is wired up.
#[derive(Debug, Clone, Deserialize)]
#[allow(dead_code)]
pub struct SidecarRunSummary {
    #[serde(rename = "skillName")]
    pub skill_name: String,
    #[serde(rename = "stepId")]
    pub step_id: i32,
    #[serde(rename = "workflowSessionId")]
    pub workflow_session_id: Option<String>,
    #[serde(rename = "usageSessionId")]
    pub usage_session_id: Option<String>,
    #[serde(rename = "runSource")]
    pub run_source: Option<String>,
    #[serde(rename = "sessionId")]
    pub session_id: Option<String>,
    pub model: String,
    #[serde(rename = "inputTokens")]
    pub input_tokens: i32,
    #[serde(rename = "outputTokens")]
    pub output_tokens: i32,
    #[serde(rename = "cacheReadTokens")]
    pub cache_read_tokens: i32,
    #[serde(rename = "cacheWriteTokens")]
    pub cache_write_tokens: i32,
    #[serde(rename = "totalCostUsd")]
    pub total_cost_usd: f64,
    #[serde(rename = "modelUsageBreakdown")]
    pub model_usage_breakdown: Vec<SidecarModelUsageEntry>,
    #[serde(rename = "contextWindow")]
    pub context_window: i64,
    #[serde(rename = "resultSubtype")]
    pub result_subtype: Option<String>,
    #[serde(rename = "resultErrors")]
    pub result_errors: Option<Vec<String>>,
    #[serde(rename = "stopReason")]
    pub stop_reason: Option<String>,
    #[serde(rename = "numTurns")]
    pub num_turns: i32,
    #[serde(rename = "durationMs")]
    pub duration_ms: i64,
    #[serde(rename = "durationApiMs")]
    pub duration_api_ms: Option<i64>,
    #[serde(rename = "toolUseCount")]
    pub tool_use_count: i32,
    #[serde(rename = "compactionCount")]
    pub compaction_count: i32,
    pub status: String,
    #[serde(rename = "resultText")]
    pub result_text: Option<String>,
    #[serde(rename = "workspacePath")]
    pub workspace_path: Option<String>,
    #[serde(rename = "pluginSlug")]
    pub plugin_slug: String,
}
