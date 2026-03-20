use tauri::Emitter;

use super::event_types::{
    AgentEvent, AgentExitPayload, AgentInitError, AgentShutdownPayload, SidecarRunSummary,
};
use super::run_persist::persist_run_summary;
use super::sidecar_pool::SidecarStartupError;

#[derive(Debug)]
pub(super) enum SidecarMessageAction {
    PersistRunSummary(Box<SidecarRunSummary>),
    EmitFrontendEvent {
        event_name: &'static str,
        payload: serde_json::Value,
    },
    ForwardAgentMessage(AgentEvent),
}

fn build_frontend_event_payload(
    agent_id: &str,
    timestamp: u64,
    event: &serde_json::Value,
) -> serde_json::Value {
    let mut payload = serde_json::Map::new();
    payload.insert(
        "agent_id".to_string(),
        serde_json::Value::String(agent_id.to_string()),
    );
    payload.insert(
        "timestamp".to_string(),
        serde_json::Value::Number(timestamp.into()),
    );
    if let Some(obj) = event.as_object() {
        for (key, value) in obj {
            payload.insert(key.clone(), value.clone());
        }
    }
    serde_json::Value::Object(payload)
}

pub(super) fn route_sidecar_message(
    agent_id: &str,
    message: serde_json::Value,
) -> Option<SidecarMessageAction> {
    let msg_type = message
        .get("type")
        .and_then(|t| t.as_str())
        .unwrap_or("unknown");

    if msg_type == "agent_event" {
        let timestamp = message
            .get("timestamp")
            .and_then(|t| t.as_u64())
            .unwrap_or(0);
        let event_subtype = message
            .get("event")
            .and_then(|e| e.get("type"))
            .and_then(|t| t.as_str())
            .unwrap_or("unknown");
        log::debug!(
            "[event:agent_event:{}] routing subtype={}",
            agent_id,
            event_subtype
        );
        return match message.get("event") {
            Some(event) => match event.get("type").and_then(|t| t.as_str()) {
                Some("run_result") => match serde_json::from_value::<SidecarRunSummary>(event.clone()) {
                    Ok(summary) => Some(SidecarMessageAction::PersistRunSummary(Box::new(summary))),
                    Err(e) => {
                        log::error!(
                            "[event:agent_event.run_result:{}] Failed to deserialize: {}",
                            agent_id,
                            e
                        );
                        None
                    }
                },
                Some("run_config") => Some(SidecarMessageAction::EmitFrontendEvent {
                    event_name: "agent-run-config",
                    payload: build_frontend_event_payload(agent_id, timestamp, event),
                }),
                Some("run_init") => Some(SidecarMessageAction::EmitFrontendEvent {
                    event_name: "agent-run-init",
                    payload: build_frontend_event_payload(agent_id, timestamp, event),
                }),
                Some("turn_usage") => Some(SidecarMessageAction::EmitFrontendEvent {
                    event_name: "agent-turn-usage",
                    payload: build_frontend_event_payload(agent_id, timestamp, event),
                }),
                Some("compaction") => Some(SidecarMessageAction::EmitFrontendEvent {
                    event_name: "agent-compaction",
                    payload: build_frontend_event_payload(agent_id, timestamp, event),
                }),
                Some("context_window") => Some(SidecarMessageAction::EmitFrontendEvent {
                    event_name: "agent-context-window",
                    payload: build_frontend_event_payload(agent_id, timestamp, event),
                }),
                Some("session_exhausted") => Some(SidecarMessageAction::EmitFrontendEvent {
                    event_name: "agent-session-exhausted",
                    payload: build_frontend_event_payload(agent_id, timestamp, event),
                }),
                Some("init_progress") => Some(SidecarMessageAction::EmitFrontendEvent {
                    event_name: "agent-init-progress",
                    payload: build_frontend_event_payload(agent_id, timestamp, event),
                }),
                Some("turn_complete") => Some(SidecarMessageAction::EmitFrontendEvent {
                    event_name: "agent-turn-complete",
                    payload: build_frontend_event_payload(agent_id, timestamp, event),
                }),
                Some(other) => {
                    log::warn!(
                        "[event:agent_event:{}] Unsupported event type '{}' — skipping",
                        agent_id,
                        other
                    );
                    None
                }
                None => {
                    log::warn!(
                        "[event:agent_event:{}] Missing 'event.type' field — skipping",
                        agent_id
                    );
                    None
                }
            },
            None => {
                log::error!("[event:agent_event:{}] Missing 'event' field", agent_id);
                None
            }
        };
    }

    Some(SidecarMessageAction::ForwardAgentMessage(AgentEvent {
        agent_id: agent_id.to_string(),
        message,
    }))
}

pub fn handle_sidecar_message(app_handle: &tauri::AppHandle, agent_id: &str, line: &str) {
    match serde_json::from_str::<serde_json::Value>(line) {
        Ok(message) => match route_sidecar_message(agent_id, message) {
            Some(SidecarMessageAction::PersistRunSummary(summary)) => {
                persist_run_summary(app_handle, agent_id, &summary);
            }
            Some(SidecarMessageAction::EmitFrontendEvent {
                event_name,
                payload,
            }) => {
                if let Err(e) = app_handle.emit(event_name, &payload) {
                    log::warn!(
                        "Failed to emit {} for {}: {}",
                        event_name,
                        agent_id,
                        e
                    );
                }
            }
            Some(SidecarMessageAction::ForwardAgentMessage(event)) => {
                let msg_type = event
                    .message
                    .get("type")
                    .and_then(|t| t.as_str())
                    .unwrap_or("unknown");
                if msg_type == "display_item" {
                    let item_type = event
                        .message
                        .get("item")
                        .and_then(|i| i.get("type"))
                        .and_then(|t| t.as_str())
                        .unwrap_or("unknown");
                    let item_id = event
                        .message
                        .get("item")
                        .and_then(|i| i.get("id"))
                        .and_then(|t| t.as_str())
                        .unwrap_or("unknown");
                    log::debug!(
                        "[event:agent-message:{}] display_item type={} id={}",
                        agent_id,
                        item_type,
                        item_id
                    );
                } else {
                    log::debug!(
                        "[event:agent-message:{}] pass_through type={}",
                        agent_id,
                        msg_type
                    );
                }

                if let Err(e) = app_handle.emit("agent-message", &event) {
                    log::warn!("Failed to emit agent-message for {}: {}", agent_id, e);
                }
            }
            None => {}
        },
        Err(e) => {
            log::warn!("Failed to parse sidecar output: {}", e);
        }
    }
}

pub fn handle_sidecar_exit(app_handle: &tauri::AppHandle, agent_id: &str, success: bool) {
    log::info!("[event:agent-exit:{}] success={}", agent_id, success);
    let payload = AgentExitPayload {
        agent_id: agent_id.to_string(),
        success,
    };
    if let Err(e) = app_handle.emit("agent-exit", &payload) {
        log::warn!(
            "Failed to emit agent-exit for {} (success={}): {}",
            agent_id,
            success,
            e
        );
    }
}

pub fn handle_agent_shutdown(app_handle: &tauri::AppHandle, agent_id: &str) {
    log::info!("[event:agent-shutdown:{}]", agent_id);
    let payload = AgentShutdownPayload {
        agent_id: agent_id.to_string(),
    };
    if let Err(e) = app_handle.emit("agent-shutdown", &payload) {
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
            payload.error_type,
            e
        );
    }
}

/// Emit a structured runtime error event (e.g. authentication failure detected
/// from agent output). Reuses the `agent-init-error` channel so the frontend's
/// `RuntimeErrorDialog` shows an actionable fix hint.
pub fn emit_runtime_error(
    app_handle: &tauri::AppHandle,
    error_type: &str,
    message: &str,
    fix_hint: &str,
) {
    let payload = AgentInitError {
        error_type: error_type.to_string(),
        message: message.to_string(),
        fix_hint: fix_hint.to_string(),
    };
    log::error!(
        "Agent runtime error [{}]: {} | Fix: {}",
        payload.error_type,
        payload.message,
        payload.fix_hint
    );
    if let Err(e) = app_handle.emit("agent-init-error", &payload) {
        log::error!(
            "Failed to emit agent-init-error [{}]: {}",
            payload.error_type,
            e
        );
    }
}

/// Check whether a run_result error subtype indicates an authentication failure.
pub fn is_authentication_error(msg: &serde_json::Value) -> bool {
    if let Some(event) = msg.get("event") {
        // Check resultSubtype field (set by message-processor)
        if let Some(subtype) = event.get("resultSubtype").and_then(|s| s.as_str()) {
            if subtype == "error_authentication" {
                return true;
            }
        }
        // Check resultErrors array for auth-related strings
        if let Some(errors) = event.get("resultErrors").and_then(|e| e.as_array()) {
            for err in errors {
                if let Some(s) = err.as_str() {
                    let lower = s.to_lowercase();
                    if lower.contains("authentication failed")
                        || lower.contains("invalid api key")
                        || lower.contains("401 unauthorized")
                        || lower.contains("status 401")
                    {
                        return true;
                    }
                }
            }
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn route_sidecar_message_maps_all_agent_events_to_expected_frontend_channels() {
        let cases = vec![
            (
                serde_json::json!({
                    "type": "run_config",
                    "thinkingEnabled": true,
                    "agentName": "researcher"
                }),
                "agent-run-config",
                42_u64,
                "thinkingEnabled",
                serde_json::json!(true),
            ),
            (
                serde_json::json!({
                    "type": "run_init",
                    "sessionId": "sess-123",
                    "model": "claude-sonnet-4-6"
                }),
                "agent-run-init",
                42_u64,
                "sessionId",
                serde_json::json!("sess-123"),
            ),
            (
                serde_json::json!({
                    "type": "turn_usage",
                    "turn": 2,
                    "inputTokens": 1200,
                    "outputTokens": 130
                }),
                "agent-turn-usage",
                42_u64,
                "turn",
                serde_json::json!(2),
            ),
            (
                serde_json::json!({
                    "type": "compaction",
                    "turn": 3,
                    "preTokens": 8000,
                    "timestamp": 55_u64
                }),
                "agent-compaction",
                55_u64,
                "preTokens",
                serde_json::json!(8000),
            ),
            (
                serde_json::json!({
                    "type": "context_window",
                    "contextWindow": 200000
                }),
                "agent-context-window",
                42_u64,
                "contextWindow",
                serde_json::json!(200000),
            ),
            (
                serde_json::json!({
                    "type": "session_exhausted",
                    "sessionId": "sess-99"
                }),
                "agent-session-exhausted",
                42_u64,
                "sessionId",
                serde_json::json!("sess-99"),
            ),
            (
                serde_json::json!({
                    "type": "init_progress",
                    "stage": "init_start"
                }),
                "agent-init-progress",
                42_u64,
                "stage",
                serde_json::json!("init_start"),
            ),
            (
                serde_json::json!({
                    "type": "turn_complete"
                }),
                "agent-turn-complete",
                42_u64,
                "type",
                serde_json::json!("turn_complete"),
            ),
        ];

        for (event, expected_name, expected_timestamp, expected_field, expected_value) in cases {
            let message = serde_json::json!({
                "type": "agent_event",
                "event": event,
                "timestamp": 42_u64
            });

            let action = route_sidecar_message("agent-1", message);

            match action {
                Some(SidecarMessageAction::EmitFrontendEvent { event_name, payload }) => {
                    assert_eq!(event_name, expected_name);
                    assert_eq!(payload["agent_id"], "agent-1");
                    assert_eq!(payload["timestamp"], expected_timestamp);
                    assert_eq!(payload[expected_field], expected_value);
                }
                other => panic!("expected frontend event action, got {:?}", other),
            }
        }
    }

    #[test]
    fn route_sidecar_message_returns_run_init_frontend_event() {
        let message = serde_json::json!({
            "type": "agent_event",
            "event": {
                "type": "run_init",
                "sessionId": "sess-123",
                "model": "claude-sonnet-4-6"
            },
            "timestamp": 42_u64
        });

        let action = route_sidecar_message("agent-1", message);

        match action {
            Some(SidecarMessageAction::EmitFrontendEvent { event_name, payload }) => {
                assert_eq!(event_name, "agent-run-init");
                assert_eq!(payload["agent_id"], "agent-1");
                assert_eq!(payload["timestamp"], 42);
                assert_eq!(payload["sessionId"], "sess-123");
            }
            other => panic!("expected frontend event action, got {:?}", other),
        }
    }

    #[test]
    fn route_sidecar_message_returns_init_progress_event() {
        let message = serde_json::json!({
            "type": "agent_event",
            "event": {
                "type": "init_progress",
                "stage": "sdk_ready"
            },
            "timestamp": 99_u64
        });

        let action = route_sidecar_message("agent-2", message);

        match action {
            Some(SidecarMessageAction::EmitFrontendEvent { event_name, payload }) => {
                assert_eq!(event_name, "agent-init-progress");
                assert_eq!(payload["agent_id"], "agent-2");
                assert_eq!(payload["timestamp"], 99);
                assert_eq!(payload["stage"], "sdk_ready");
            }
            other => panic!("expected frontend event action, got {:?}", other),
        }
    }

    #[test]
    fn route_sidecar_message_returns_session_exhausted_event() {
        let message = serde_json::json!({
            "type": "agent_event",
            "event": {
                "type": "session_exhausted",
                "sessionId": "sess-456"
            },
            "timestamp": 100_u64
        });

        let action = route_sidecar_message("agent-5", message);

        match action {
            Some(SidecarMessageAction::EmitFrontendEvent { event_name, payload }) => {
                assert_eq!(event_name, "agent-session-exhausted");
                assert_eq!(payload["agent_id"], "agent-5");
                assert_eq!(payload["sessionId"], "sess-456");
            }
            other => panic!("expected frontend event action, got {:?}", other),
        }
    }

    #[test]
    fn route_sidecar_message_returns_turn_complete_event() {
        let message = serde_json::json!({
            "type": "agent_event",
            "event": {
                "type": "turn_complete"
            },
            "timestamp": 101_u64
        });

        let action = route_sidecar_message("agent-6", message);

        match action {
            Some(SidecarMessageAction::EmitFrontendEvent { event_name, payload }) => {
                assert_eq!(event_name, "agent-turn-complete");
                assert_eq!(payload["agent_id"], "agent-6");
            }
            other => panic!("expected frontend event action, got {:?}", other),
        }
    }

    #[test]
    fn route_sidecar_message_intercepts_run_result() {
        let message = serde_json::json!({
            "type": "agent_event",
            "event": {
                "type": "run_result",
                "skillName": "demo-skill",
                "stepId": 2,
                "workflowSessionId": "wf-123",
                "usageSessionId": null,
                "runSource": "workflow",
                "sessionId": "sdk-session",
                "model": "claude-sonnet-4-6",
                "inputTokens": 120,
                "outputTokens": 45,
                "cacheReadTokens": 6,
                "cacheWriteTokens": 2,
                "totalCostUsd": 0.12,
                "modelUsageBreakdown": [],
                "contextWindow": 200000,
                "resultSubtype": null,
                "resultErrors": null,
                "stopReason": "end_turn",
                "numTurns": 3,
                "durationMs": 4000,
                "durationApiMs": 3500,
                "toolUseCount": 2,
                "compactionCount": 1,
                "status": "completed"
            }
        });

        let action = route_sidecar_message("agent-3", message);

        match action {
            Some(SidecarMessageAction::PersistRunSummary(summary)) => {
                assert_eq!(summary.skill_name, "demo-skill");
                assert_eq!(summary.step_id, 2);
                assert_eq!(summary.workflow_session_id.as_deref(), Some("wf-123"));
            }
            other => panic!("expected run summary action, got {:?}", other),
        }
    }

    #[test]
    fn route_sidecar_message_skips_agent_event_without_event() {
        let message = serde_json::json!({
            "type": "agent_event",
            "timestamp": 7_u64
        });

        assert!(route_sidecar_message("agent-4", message).is_none());
    }

    // =========================================================================
    // is_authentication_error (VU-531)
    // =========================================================================

    #[test]
    fn is_authentication_error_detects_error_authentication_subtype() {
        let msg = serde_json::json!({
            "type": "agent_event",
            "event": {
                "type": "run_result",
                "status": "error",
                "resultSubtype": "error_authentication",
                "resultErrors": ["Authentication failed — check your API key in Settings."]
            }
        });
        assert!(is_authentication_error(&msg));
    }

    #[test]
    fn is_authentication_error_detects_auth_string_in_errors() {
        let msg = serde_json::json!({
            "type": "agent_event",
            "event": {
                "type": "run_result",
                "status": "error",
                "resultSubtype": "error_during_execution",
                "resultErrors": ["401 Unauthorized: invalid api key"]
            }
        });
        assert!(is_authentication_error(&msg));
    }

    #[test]
    fn is_authentication_error_returns_false_for_non_auth_errors() {
        let msg = serde_json::json!({
            "type": "agent_event",
            "event": {
                "type": "run_result",
                "status": "error",
                "resultSubtype": "error_max_turns",
                "resultErrors": ["Agent reached max turns"]
            }
        });
        assert!(!is_authentication_error(&msg));
    }

    #[test]
    fn is_authentication_error_returns_false_for_success() {
        let msg = serde_json::json!({
            "type": "agent_event",
            "event": {
                "type": "run_result",
                "status": "completed",
                "resultSubtype": "success"
            }
        });
        assert!(!is_authentication_error(&msg));
    }
}
