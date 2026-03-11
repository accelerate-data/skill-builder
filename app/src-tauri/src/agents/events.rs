use serde::{Deserialize, Serialize};
use tauri::Emitter;

use super::sidecar_pool::SidecarStartupError;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentEvent {
    pub agent_id: String,
    pub message: serde_json::Value,
}

/// Payload for early initialization progress events (`init_start`, `sdk_ready`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentInitProgress {
    pub agent_id: String,
    pub subtype: String,
    pub timestamp: u64,
}

/// Payload for sidecar startup error events sent to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentInitError {
    pub error_type: String,
    pub message: String,
    pub fix_hint: String,
}

/// Payload for agent-metadata events (forwarded from sidecar to frontend).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentMetadataEvent {
    pub agent_id: String,
    pub data: serde_json::Value,
    pub timestamp: u64,
}

/// Per-model usage entry from sidecar run_summary.
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

/// Self-contained run summary from the sidecar.
#[derive(Debug, Clone, Deserialize)]
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
}

/// Persist a run summary directly to SQLite (fire-and-forget from the caller's perspective).
pub fn persist_run_summary(app_handle: &tauri::AppHandle, agent_id: &str, summary: &SidecarRunSummary) {
    use tauri::Manager;

    let db = match app_handle.try_state::<crate::db::Db>() {
        Some(db) => db,
        None => {
            log::error!("[persist_run_summary] DB state not available for agent={}", agent_id);
            return;
        }
    };

    let conn = match db.0.lock() {
        Ok(c) => c,
        Err(e) => {
            log::error!("[persist_run_summary] Failed to acquire DB lock for agent={}: {}", agent_id, e);
            return;
        }
    };

    // Determine the effective workflow_session_id (prefer workflowSessionId, fallback to usageSessionId)
    let effective_session_id = summary.workflow_session_id.as_deref()
        .or(summary.usage_session_id.as_deref());

    // Persist one row per model entry or one aggregate row
    if !summary.model_usage_breakdown.is_empty() {
        for entry in &summary.model_usage_breakdown {
            log::info!(
                "[persist_run_summary] agent={} skill={} step={} model={} status={} cost={:.4}",
                agent_id, summary.skill_name, summary.step_id, entry.model, summary.status, entry.cost
            );
            if let Err(e) = crate::db::persist_agent_run(
                &conn,
                agent_id,
                &summary.skill_name,
                summary.step_id,
                &entry.model,
                &summary.status,
                entry.input_tokens,
                entry.output_tokens,
                entry.cache_read_tokens,
                entry.cache_write_tokens,
                entry.cost,
                summary.duration_ms,
                summary.num_turns,
                summary.stop_reason.as_deref(),
                summary.duration_api_ms,
                summary.tool_use_count,
                summary.compaction_count,
                summary.session_id.as_deref(),
                effective_session_id,
            ) {
                log::error!(
                    "[persist_run_summary] Failed to persist for agent={} model={}: {}",
                    agent_id, entry.model, e
                );
            }
        }
    } else {
        // Single aggregate row
        log::info!(
            "[persist_run_summary] agent={} skill={} step={} model={} status={} cost={:.4}",
            agent_id, summary.skill_name, summary.step_id, summary.model, summary.status, summary.total_cost_usd
        );
        if let Err(e) = crate::db::persist_agent_run(
            &conn,
            agent_id,
            &summary.skill_name,
            summary.step_id,
            &summary.model,
            &summary.status,
            summary.input_tokens,
            summary.output_tokens,
            summary.cache_read_tokens,
            summary.cache_write_tokens,
            summary.total_cost_usd,
            summary.duration_ms,
            summary.num_turns,
            summary.stop_reason.as_deref(),
            summary.duration_api_ms,
            summary.tool_use_count,
            summary.compaction_count,
            summary.session_id.as_deref(),
            effective_session_id,
        ) {
            log::error!(
                "[persist_run_summary] Failed to persist aggregate for agent={}: {}",
                agent_id, e
            );
        }
    }
}

pub fn handle_sidecar_message(app_handle: &tauri::AppHandle, agent_id: &str, line: &str) {
    match serde_json::from_str::<serde_json::Value>(line) {
        Ok(message) => {
            let msg_type = message.get("type").and_then(|t| t.as_str()).unwrap_or("unknown");

            // --- run_summary: persist to DB, do NOT forward to frontend ---
            if msg_type == "run_summary" {
                log::debug!("[event:run_summary:{}] intercepted", agent_id);
                if let Some(data) = message.get("data") {
                    match serde_json::from_value::<SidecarRunSummary>(data.clone()) {
                        Ok(summary) => persist_run_summary(app_handle, agent_id, &summary),
                        Err(e) => log::error!(
                            "[event:run_summary:{}] Failed to deserialize: {}",
                            agent_id, e
                        ),
                    }
                } else {
                    log::error!("[event:run_summary:{}] Missing 'data' field", agent_id);
                }
                return; // Do NOT forward to frontend
            }

            // --- metadata: forward as agent-metadata event ---
            if msg_type == "metadata" {
                log::debug!("[event:agent-metadata:{}] forwarding metadata", agent_id);
                if let Some(data) = message.get("data") {
                    let timestamp = message.get("timestamp").and_then(|t| t.as_u64()).unwrap_or(0);
                    let event = AgentMetadataEvent {
                        agent_id: agent_id.to_string(),
                        data: data.clone(),
                        timestamp,
                    };
                    if let Err(e) = app_handle.emit("agent-metadata", &event) {
                        log::warn!(
                            "Failed to emit agent-metadata for {}: {}",
                            agent_id, e
                        );
                    }
                } else {
                    log::warn!("[event:metadata:{}] Missing 'data' field — skipping", agent_id);
                }
                return; // Do NOT forward as agent-message
            }

            // Detect system init progress events and emit on a dedicated channel.
            // Only intercept specific init subtypes — other system messages
            // (e.g. compact_boundary) must fall through to agent-message.
            if msg_type == "system" {
                if let Some(subtype) = message.get("subtype").and_then(|s| s.as_str()) {
                    if matches!(subtype, "init_start" | "sdk_ready" | "init") {
                        let timestamp = message
                            .get("timestamp")
                            .and_then(|t| t.as_u64())
                            .unwrap_or(0);
                        let progress = AgentInitProgress {
                            agent_id: agent_id.to_string(),
                            subtype: subtype.to_string(),
                            timestamp,
                        };
                        log::debug!("[event:agent-init-progress:{}] {}", agent_id, subtype);
                        if let Err(e) = app_handle.emit("agent-init-progress", &progress) {
                            log::warn!(
                                "Failed to emit agent-init-progress for {}: {}",
                                agent_id, e
                            );
                        }
                        return;
                    }
                }
            }

            // Log display_item routing at debug level for troubleshooting
            if msg_type == "display_item" {
                let item_type = message
                    .get("item")
                    .and_then(|i| i.get("type"))
                    .and_then(|t| t.as_str())
                    .unwrap_or("unknown");
                let item_id = message
                    .get("item")
                    .and_then(|i| i.get("id"))
                    .and_then(|t| t.as_str())
                    .unwrap_or("unknown");
                log::debug!(
                    "[event:agent-message:{}] display_item type={} id={}",
                    agent_id, item_type, item_id
                );
            } else {
                log::debug!(
                    "[event:agent-message:{}] pass_through type={}",
                    agent_id, msg_type
                );
            }

            let event = AgentEvent {
                agent_id: agent_id.to_string(),
                message,
            };
            if let Err(e) = app_handle.emit("agent-message", &event) {
                log::warn!("Failed to emit agent-message for {}: {}", agent_id, e);
            }
        }
        Err(e) => {
            log::warn!("Failed to parse sidecar output: {}", e);
        }
    }
}

pub fn handle_sidecar_exit(app_handle: &tauri::AppHandle, agent_id: &str, success: bool) {
    log::info!("[event:agent-exit:{}] success={}", agent_id, success);
    if let Err(e) = app_handle.emit(
        "agent-exit",
        serde_json::json!({
            "agent_id": agent_id,
            "success": success,
        }),
    ) {
        log::warn!(
            "Failed to emit agent-exit for {} (success={}): {}",
            agent_id, success, e
        );
    }
}

pub fn handle_agent_shutdown(app_handle: &tauri::AppHandle, agent_id: &str) {
    log::info!("[event:agent-shutdown:{}]", agent_id);
    if let Err(e) = app_handle.emit(
        "agent-shutdown",
        serde_json::json!({
            "agent_id": agent_id,
        }),
    ) {
        log::warn!("Failed to emit agent-shutdown for {}: {}", agent_id, e);
    }
}

/// Emit a structured error event when sidecar startup fails.
/// The frontend listens for `agent-init-error` to show an actionable dialog.
pub fn emit_init_error(app_handle: &tauri::AppHandle, error: &SidecarStartupError) {
    let payload = AgentInitError {
        error_type: error.error_type().to_string(),
        message: error.message(),
        fix_hint: error.fix_hint(),
    };
    log::error!(
        "Sidecar startup error [{}]: {} | Fix: {}",
        payload.error_type,
        payload.message,
        payload.fix_hint
    );
    if let Err(e) = app_handle.emit("agent-init-error", &payload) {
        log::error!(
            "Failed to emit agent-init-error [{}]: {}",
            payload.error_type, e
        );
    }
}
