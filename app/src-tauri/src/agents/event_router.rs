use tauri::Emitter;

use super::event_types::{AgentEvent, AgentExitPayload, RuntimeRunSummary};
use super::run_persist::persist_run_summary;
#[derive(Debug)]
pub(super) enum RuntimeMessageAction {
    PersistRunSummary(Box<RuntimeRunSummary>),
    EmitFrontendEvent {
        event_name: &'static str,
        payload: serde_json::Value,
    },
    ForwardAgentMessage(AgentEvent),
}

fn build_frontend_event_payload(
    conversation_id: &str,
    timestamp: u64,
    event: &serde_json::Value,
) -> serde_json::Value {
    let mut payload = serde_json::Map::new();
    payload.insert(
        "conversation_id".to_string(),
        serde_json::Value::String(conversation_id.to_string()),
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

fn build_run_result_payload(
    conversation_id: &str,
    summary: &RuntimeRunSummary,
) -> serde_json::Value {
    serde_json::json!({
        "conversation_id": conversation_id,
        "timestamp": chrono::Utc::now().timestamp_millis(),
        "type": "run_result",
        "status": summary.status,
        "resultText": summary.result_text,
        "resultErrors": summary.result_errors,
    })
}

pub(super) fn route_runtime_message(
    conversation_id: &str,
    message: serde_json::Value,
) -> Option<RuntimeMessageAction> {
    let msg_type = message
        .get("type")
        .and_then(|t| t.as_str())
        .unwrap_or("unknown");

    if msg_type == "system" && message.get("subtype").and_then(|s| s.as_str()) == Some("sdk_stderr")
    {
        log::debug!(
            "[event:agent-message:{}] skipping sdk_stderr diagnostic",
            conversation_id
        );
        return None;
    }

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
            conversation_id,
            event_subtype
        );
        return match message.get("event") {
            Some(event) => match event.get("type").and_then(|t| t.as_str()) {
                Some("run_result") => {
                    match serde_json::from_value::<RuntimeRunSummary>(event.clone()) {
                        Ok(summary) => {
                            Some(RuntimeMessageAction::PersistRunSummary(Box::new(summary)))
                        }
                        Err(e) => {
                            log::error!(
                                "[event:agent_event.run_result:{}] Failed to deserialize: {}",
                                conversation_id,
                                e
                            );
                            None
                        }
                    }
                }
                Some("run_config") => Some(RuntimeMessageAction::EmitFrontendEvent {
                    event_name: "agent-run-config",
                    payload: build_frontend_event_payload(conversation_id, timestamp, event),
                }),
                Some("run_init") => Some(RuntimeMessageAction::EmitFrontendEvent {
                    event_name: "agent-run-init",
                    payload: build_frontend_event_payload(conversation_id, timestamp, event),
                }),
                Some("turn_usage") => Some(RuntimeMessageAction::EmitFrontendEvent {
                    event_name: "agent-turn-usage",
                    payload: build_frontend_event_payload(conversation_id, timestamp, event),
                }),
                Some("compaction") => Some(RuntimeMessageAction::EmitFrontendEvent {
                    event_name: "agent-compaction",
                    payload: build_frontend_event_payload(conversation_id, timestamp, event),
                }),
                Some("context_window") => Some(RuntimeMessageAction::EmitFrontendEvent {
                    event_name: "agent-context-window",
                    payload: build_frontend_event_payload(conversation_id, timestamp, event),
                }),
                Some("session_exhausted") => Some(RuntimeMessageAction::EmitFrontendEvent {
                    event_name: "agent-session-exhausted",
                    payload: build_frontend_event_payload(conversation_id, timestamp, event),
                }),
                Some("init_progress") => Some(RuntimeMessageAction::EmitFrontendEvent {
                    event_name: "agent-init-progress",
                    payload: build_frontend_event_payload(conversation_id, timestamp, event),
                }),
                Some("turn_complete") => Some(RuntimeMessageAction::EmitFrontendEvent {
                    event_name: "agent-turn-complete",
                    payload: build_frontend_event_payload(conversation_id, timestamp, event),
                }),
                Some(other) => {
                    log::warn!(
                        "[event:agent_event:{}] Unsupported event type '{}' — skipping",
                        conversation_id,
                        other
                    );
                    None
                }
                None => {
                    log::warn!(
                        "[event:agent_event:{}] Missing 'event.type' field — skipping",
                        conversation_id
                    );
                    None
                }
            },
            None => {
                log::error!(
                    "[event:agent_event:{}] Missing 'event' field",
                    conversation_id
                );
                None
            }
        };
    }

    Some(RuntimeMessageAction::ForwardAgentMessage(AgentEvent {
        conversation_id: conversation_id.to_string(),
        message,
    }))
}

pub fn handle_runtime_message(app_handle: &tauri::AppHandle, conversation_id: &str, line: &str) {
    match serde_json::from_str::<serde_json::Value>(line) {
        Ok(message) => match route_runtime_message(conversation_id, message) {
            Some(RuntimeMessageAction::PersistRunSummary(summary)) => {
                persist_run_summary(app_handle, conversation_id, &summary);
                let payload = build_run_result_payload(conversation_id, &summary);
                if let Err(e) = app_handle.emit("agent-run-result", &payload) {
                    log::warn!(
                        "Failed to emit agent-run-result for {}: {}",
                        conversation_id,
                        e
                    );
                }
            }
            Some(RuntimeMessageAction::EmitFrontendEvent {
                event_name,
                payload,
            }) => {
                if let Err(e) = app_handle.emit(event_name, &payload) {
                    log::warn!(
                        "Failed to emit {} for {}: {}",
                        event_name,
                        conversation_id,
                        e
                    );
                }
            }
            Some(RuntimeMessageAction::ForwardAgentMessage(event)) => {
                let msg_type = event
                    .message
                    .get("type")
                    .and_then(|t| t.as_str())
                    .unwrap_or("unknown");
                log::debug!(
                    "[event:agent-message:{}] pass_through type={}",
                    conversation_id,
                    msg_type
                );

                if let Err(e) = app_handle.emit("agent-message", &event) {
                    log::warn!(
                        "Failed to emit agent-message for {}: {}",
                        conversation_id,
                        e
                    );
                }
            }
            None => {}
        },
        Err(e) => {
            log::warn!("Failed to parse runtime output: {}", e);
        }
    }
}

pub fn handle_runtime_exit_with_detail(
    app_handle: &tauri::AppHandle,
    conversation_id: &str,
    success: bool,
    error_detail: Option<String>,
) {
    log::info!("[event:agent-exit:{}] success={}", conversation_id, success);
    let payload = AgentExitPayload {
        conversation_id: conversation_id.to_string(),
        success,
        error_detail,
    };
    if let Err(e) = app_handle.emit("agent-exit", &payload) {
        log::warn!(
            "Failed to emit agent-exit for {} (success={}): {}",
            conversation_id,
            success,
            e
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn route_runtime_message_maps_all_agent_events_to_expected_frontend_channels() {
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

            let action = route_runtime_message("agent-1", message);

            match action {
                Some(RuntimeMessageAction::EmitFrontendEvent {
                    event_name,
                    payload,
                }) => {
                    assert_eq!(event_name, expected_name);
                    assert_eq!(payload["conversation_id"], "agent-1");
                    assert_eq!(payload["timestamp"], expected_timestamp);
                    assert_eq!(payload[expected_field], expected_value);
                }
                other => panic!("expected frontend event action, got {:?}", other),
            }
        }
    }

    #[test]
    fn route_runtime_message_returns_run_init_frontend_event() {
        let message = serde_json::json!({
            "type": "agent_event",
            "event": {
                "type": "run_init",
                "sessionId": "sess-123",
                "model": "claude-sonnet-4-6"
            },
            "timestamp": 42_u64
        });

        let action = route_runtime_message("agent-1", message);

        match action {
            Some(RuntimeMessageAction::EmitFrontendEvent {
                event_name,
                payload,
            }) => {
                assert_eq!(event_name, "agent-run-init");
                assert_eq!(payload["conversation_id"], "agent-1");
                assert_eq!(payload["timestamp"], 42);
                assert_eq!(payload["sessionId"], "sess-123");
            }
            other => panic!("expected frontend event action, got {:?}", other),
        }
    }

    #[test]
    fn route_runtime_message_returns_init_progress_event() {
        let message = serde_json::json!({
            "type": "agent_event",
            "event": {
                "type": "init_progress",
                "stage": "runtime_ready"
            },
            "timestamp": 99_u64
        });

        let action = route_runtime_message("agent-2", message);

        match action {
            Some(RuntimeMessageAction::EmitFrontendEvent {
                event_name,
                payload,
            }) => {
                assert_eq!(event_name, "agent-init-progress");
                assert_eq!(payload["conversation_id"], "agent-2");
                assert_eq!(payload["timestamp"], 99);
                assert_eq!(payload["stage"], "runtime_ready");
            }
            other => panic!("expected frontend event action, got {:?}", other),
        }
    }

    #[test]
    fn route_runtime_message_returns_session_exhausted_event() {
        let message = serde_json::json!({
            "type": "agent_event",
            "event": {
                "type": "session_exhausted",
                "sessionId": "sess-456"
            },
            "timestamp": 100_u64
        });

        let action = route_runtime_message("agent-5", message);

        match action {
            Some(RuntimeMessageAction::EmitFrontendEvent {
                event_name,
                payload,
            }) => {
                assert_eq!(event_name, "agent-session-exhausted");
                assert_eq!(payload["conversation_id"], "agent-5");
                assert_eq!(payload["sessionId"], "sess-456");
            }
            other => panic!("expected frontend event action, got {:?}", other),
        }
    }

    #[test]
    fn route_runtime_message_returns_turn_complete_event() {
        let message = serde_json::json!({
            "type": "agent_event",
            "event": {
                "type": "turn_complete"
            },
            "timestamp": 101_u64
        });

        let action = route_runtime_message("agent-6", message);

        match action {
            Some(RuntimeMessageAction::EmitFrontendEvent {
                event_name,
                payload,
            }) => {
                assert_eq!(event_name, "agent-turn-complete");
                assert_eq!(payload["conversation_id"], "agent-6");
            }
            other => panic!("expected frontend event action, got {:?}", other),
        }
    }

    #[test]
    fn route_runtime_message_forwards_openhands_conversation_event() {
        let message = serde_json::json!({
            "type": "conversation_event",
            "runtime": "openhands",
            "conversation_id": "scope-review-1",
            "event": {
                "event_class": "MessageEvent",
                "message": "Checking scope"
            }
        });

        let action = route_runtime_message("agent-6", message.clone());

        match action {
            Some(RuntimeMessageAction::ForwardAgentMessage(event)) => {
                assert_eq!(event.conversation_id, "agent-6");
                assert_eq!(event.message, message);
            }
            other => panic!(
                "expected conversation_event to be forwarded, got {:?}",
                other
            ),
        }
    }

    #[test]
    fn route_runtime_message_forwards_openhands_conversation_state() {
        let message = serde_json::json!({
            "type": "conversation_state",
            "runtime": "openhands",
            "conversation_id": "scope-review-1",
            "status": "completed",
            "error_detail": null
        });

        let action = route_runtime_message("agent-6", message.clone());

        match action {
            Some(RuntimeMessageAction::ForwardAgentMessage(event)) => {
                assert_eq!(event.conversation_id, "agent-6");
                assert_eq!(event.message, message);
            }
            other => panic!(
                "expected conversation_state to be forwarded, got {:?}",
                other
            ),
        }
    }

    #[test]
    fn route_runtime_message_skips_sdk_stderr_diagnostics() {
        let message = serde_json::json!({
            "type": "system",
            "subtype": "sdk_stderr",
            "data": "diagnostic stderr line"
        });

        assert!(route_runtime_message("agent-6", message).is_none());
    }

    #[test]
    fn route_runtime_message_intercepts_run_result() {
        let message = serde_json::json!({
            "type": "agent_event",
            "event": {
                "type": "run_result",
                "skillName": "demo-skill",
                "stepId": 2,
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
                "status": "completed",
                "pluginSlug": "skills"
            }
        });

        let action = route_runtime_message("agent-3", message);

        match action {
            Some(RuntimeMessageAction::PersistRunSummary(summary)) => {
                assert_eq!(summary.skill_name, "demo-skill");
                assert_eq!(summary.step_id, 2);
                assert_eq!(summary.plugin_slug, "skills");
            }
            other => panic!("expected run summary action, got {:?}", other),
        }
    }

    #[test]
    fn route_runtime_message_skips_agent_event_without_event() {
        let message = serde_json::json!({
            "type": "agent_event",
            "timestamp": 7_u64
        });

        assert!(route_runtime_message("agent-4", message).is_none());
    }
}
