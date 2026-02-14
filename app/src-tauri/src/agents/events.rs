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

pub fn handle_sidecar_message(app_handle: &tauri::AppHandle, agent_id: &str, line: &str) {
    match serde_json::from_str::<serde_json::Value>(line) {
        Ok(message) => {
            // Detect system init progress events and emit on a dedicated channel
            if message.get("type").and_then(|t| t.as_str()) == Some("system") {
                if let Some(subtype) = message.get("subtype").and_then(|s| s.as_str()) {
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

            let event = AgentEvent {
                agent_id: agent_id.to_string(),
                message,
            };
            // Agent message content is captured in per-request JSONL transcripts —
            // no need to dump it into the app log (even at DEBUG, it's enormous).
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
