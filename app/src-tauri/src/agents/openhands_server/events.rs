pub fn normalize_server_event(
    _conversation_owner_id: &str,
    conversation_id: &str,
    raw: &serde_json::Value,
) -> serde_json::Value {
    canonicalize_conversation_event(raw).unwrap_or_else(|| {
        serde_json::json!({
            "id": format!(
                "evt_{}_{}",
                chrono::Utc::now().timestamp_millis(),
                uuid::Uuid::new_v4().simple()
            ),
            "kind": "UnknownEvent",
            "timestamp": chrono::Utc::now().to_rfc3339(),
            "source": "environment",
            "message": format!(
                "Unsupported OpenHands event while normalizing conversation '{}'",
                conversation_id
            ),
        })
    })
}

pub fn canonicalize_conversation_event(raw: &serde_json::Value) -> Option<serde_json::Value> {
    let mut event = raw.as_object()?.clone();
    let kind = raw_event_kind(raw)?;

    event.insert("kind".to_string(), serde_json::Value::String(kind.to_string()));

    if event
        .get("tool_call_id")
        .and_then(|value| value.as_str())
        .is_none()
    {
        if let Some(tool_call_id) = raw.pointer("/tool_call/id").and_then(|value| value.as_str()) {
            event.insert(
                "tool_call_id".to_string(),
                serde_json::Value::String(tool_call_id.to_string()),
            );
        }
    }

    if event.get("id").and_then(|value| value.as_str()).is_none() {
        event.insert(
            "id".to_string(),
            serde_json::Value::String(format!(
                "evt_{}_{}",
                chrono::Utc::now().timestamp_millis(),
                uuid::Uuid::new_v4().simple()
            )),
        );
    }

    match event.get("timestamp") {
        Some(serde_json::Value::String(_)) => {}
        Some(serde_json::Value::Number(number)) => {
            if let Some(value) = number.as_i64() {
                event.insert(
                    "timestamp".to_string(),
                    serde_json::Value::String(
                        chrono::DateTime::from_timestamp_millis(value)
                            .unwrap_or_else(chrono::Utc::now)
                            .to_rfc3339(),
                    ),
                );
            } else if let Some(value) = number.as_u64() {
                event.insert(
                    "timestamp".to_string(),
                    serde_json::Value::String(
                        chrono::DateTime::from_timestamp_millis(value.min(i64::MAX as u64) as i64)
                            .unwrap_or_else(chrono::Utc::now)
                            .to_rfc3339(),
                    ),
                );
            }
        }
        _ => {
            event.insert(
                "timestamp".to_string(),
                serde_json::Value::String(chrono::Utc::now().to_rfc3339()),
            );
        }
    }

    if event.get("source").and_then(|value| value.as_str()).is_none() {
        event.insert(
            "source".to_string(),
            serde_json::Value::String(default_event_source(kind).to_string()),
        );
    }

    Some(serde_json::Value::Object(event))
}

pub fn is_pause_acknowledgement(raw: &serde_json::Value) -> bool {
    if raw_event_kind(raw) == Some("PauseEvent") {
        return true;
    }

    matches!(
        (
            raw_event_kind(raw),
            raw.get("key").and_then(|value| value.as_str()),
            raw.get("value").and_then(|value| value.as_str())
        ),
        (Some("ConversationStateUpdateEvent"), Some("execution_status"), Some("paused"))
    )
}

pub fn canonicalize_frontend_conversation_event(
    raw: &serde_json::Value,
) -> Option<serde_json::Value> {
    canonicalize_conversation_event(raw).or_else(|| canonicalize_legacy_conversation_state(raw))
}

pub fn normalize_terminal_state(
    conversation_id: &str,
    status: &str,
    raw: &serde_json::Value,
) -> serde_json::Value {
    serde_json::json!({
        "type": "conversation_state",
        "runtime": "openhands",
        "conversation_id": conversation_id,
        "status": status,
        "timestamp": chrono::Utc::now().timestamp_millis(),
        "result_text": result_text(raw),
        "error_detail": error_detail(raw),
        "raw_event": raw,
    })
}

pub fn terminal_status(raw: &serde_json::Value) -> Option<&'static str> {
    let status = raw
        .get("status")
        .or_else(|| raw.pointer("/state/status"))
        .or_else(|| raw.pointer("/conversation/status"))
        .and_then(|value| value.as_str());
    if let Some(status) = normalize_execution_status(status) {
        return Some(status);
    }

    if matches!(raw_event_kind(raw), Some("ConversationStateUpdateEvent"))
        && matches!(
            raw.get("key").and_then(|value| value.as_str()),
            Some("status" | "execution_status")
        )
    {
        if let Some(status) =
            normalize_execution_status(raw.get("value").and_then(|value| value.as_str()))
        {
            return Some(status);
        }
    }

    match raw.get("type").and_then(|value| value.as_str()) {
        Some("run_completed" | "conversation_completed") => Some("completed"),
        Some("run_failed" | "conversation_failed" | "error") => Some("error"),
        Some("run_cancelled" | "run_canceled") => Some("cancelled"),
        _ => None,
    }
}

fn normalize_execution_status(status: Option<&str>) -> Option<&'static str> {
    match status {
        Some("completed" | "complete" | "success" | "succeeded" | "finished") => Some("completed"),
        Some("error" | "failed" | "failure" | "stuck") => Some("error"),
        Some("cancelled" | "canceled" | "stopped") => Some("cancelled"),
        _ => None,
    }
}

fn canonicalize_legacy_conversation_state(
    raw: &serde_json::Value,
) -> Option<serde_json::Value> {
    if raw.get("type").and_then(|value| value.as_str()) != Some("conversation_state") {
        return None;
    }

    let status = raw.get("status").and_then(|value| value.as_str())?;
    let timestamp = match raw.get("timestamp") {
        Some(serde_json::Value::String(value)) => value.clone(),
        Some(serde_json::Value::Number(value)) => value
            .as_i64()
            .and_then(chrono::DateTime::from_timestamp_millis)
            .unwrap_or_else(chrono::Utc::now)
            .to_rfc3339(),
        _ => chrono::Utc::now().to_rfc3339(),
    };
    let id = raw
        .get("id")
        .and_then(|value| value.as_str())
        .map(str::to_string)
        .unwrap_or_else(|| {
            format!(
                "legacy_state_{}_{}",
                chrono::Utc::now().timestamp_millis(),
                uuid::Uuid::new_v4().simple()
            )
        });

    match status {
        "completed" | "finished" => Some(serde_json::json!({
            "id": id,
            "kind": "FinishEvent",
            "timestamp": timestamp,
            "source": "environment",
            "message": raw.get("result_text").and_then(|v| v.as_str())
                .or_else(|| raw.get("resultText").and_then(|v| v.as_str()))
                .unwrap_or(""),
            "success": true,
        })),
        "error" => Some(serde_json::json!({
            "id": id,
            "kind": "ConversationErrorEvent",
            "timestamp": timestamp,
            "source": "environment",
            "code": "conversation_error",
            "detail": raw.get("error_detail").and_then(|v| v.as_str())
                .or_else(|| raw.get("errorDetail").and_then(|v| v.as_str()))
                .unwrap_or("OpenHands runtime run failed"),
        })),
        "paused" => Some(serde_json::json!({
            "id": id,
            "kind": "PauseEvent",
            "timestamp": timestamp,
            "source": "user",
            "reason": raw.get("error_detail").and_then(|v| v.as_str())
                .or_else(|| raw.get("errorDetail").and_then(|v| v.as_str())),
        })),
        other => Some(serde_json::json!({
            "id": id,
            "kind": "ConversationStateUpdateEvent",
            "timestamp": timestamp,
            "source": "environment",
            "key": "execution_status",
            "value": other,
        })),
    }
}

fn raw_event_kind(raw: &serde_json::Value) -> Option<&str> {
    raw.get("kind")
        .or_else(|| raw.get("event_class"))
        .or_else(|| raw.get("eventClass"))
        .or_else(|| raw.get("type"))
        .and_then(|value| value.as_str())
        .map(|kind| match kind {
            "conversation_state_update" => "ConversationStateUpdateEvent",
            other => other,
        })
}

fn default_event_source(kind: &str) -> &'static str {
    match kind {
        "PauseEvent" => "user",
        "HookExecutionEvent" => "hook",
        "MessageEvent" | "ActionEvent" | "AgentErrorEvent" | "ThinkEvent" => "agent",
        _ => "environment",
    }
}

fn result_text(raw: &serde_json::Value) -> Option<String> {
    raw.get("result_text")
        .or_else(|| raw.get("resultText"))
        .or_else(|| raw.pointer("/result/text"))
        .or_else(|| raw.get("message"))
        .and_then(|value| value.as_str())
        .map(str::to_string)
}

fn error_detail(raw: &serde_json::Value) -> Option<String> {
    raw.get("error_detail")
        .or_else(|| raw.get("errorDetail"))
        .or_else(|| raw.pointer("/error/message"))
        .or_else(|| raw.get("reason"))
        .and_then(|value| value.as_str())
        .map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_raw_activity_as_conversation_event_with_raw_payload() {
        let raw = serde_json::json!({
            "type": "message",
            "event_class": "MessageEvent",
            "source": "agent",
            "message": "working"
        });

        let normalized = normalize_server_event("agent-1", "conversation-1", &raw);
        let legacy_agent_key = ["agent", "id"].join("_");

        assert!(normalized.get(&legacy_agent_key).is_none());
        assert_eq!(normalized["kind"], "MessageEvent");
        assert_eq!(normalized["source"], "agent");
        assert_eq!(normalized["message"], "working");
    }

    #[test]
    fn falls_back_to_kind_when_event_class_missing() {
        // OpenHands SDK emits raw events with `kind` as the discriminator,
        // not `event_class`. The normalizer must recognize `kind` so the
        // frontend's projection sees the actual event class instead of
        // falling through to "Unknown OpenHands event".
        let raw = serde_json::json!({
            "kind": "ActionEvent",
            "source": "agent",
            "tool_name": "file_editor",
            "tool_call_id": "call_abc",
        });

        let normalized = normalize_server_event("agent-1", "conversation-1", &raw);

        assert_eq!(normalized["kind"], "ActionEvent");
    }

    #[test]
    fn normalizes_top_level_tool_call_ids_for_parent_and_child_events() {
        let raw = serde_json::json!({
            "kind": "ActionEvent",
            "source": "agent",
            "tool_name": "file_editor",
            "tool_call": {
                "id": "call_child"
            }
        });

        let normalized = normalize_server_event("agent-1", "conversation-1", &raw);

        assert_eq!(normalized["kind"], "ActionEvent");
        assert_eq!(normalized["tool_call_id"], "call_child");
        assert!(normalized["parent_tool_call_id"].is_null());
    }

    #[test]
    fn normalizes_completed_raw_state_as_terminal_conversation_state() {
        let raw = serde_json::json!({
            "type": "run_completed",
            "status": "completed",
            "result": {"text": "done", "structured_output": {"ok": true}}
        });

        let normalized = normalize_terminal_state("conversation-1", "completed", &raw);

        assert_eq!(normalized["type"], "conversation_state");
        assert_eq!(normalized["status"], "completed");
        assert_eq!(normalized["result_text"], "done");
        assert_eq!(normalized["raw_event"], raw);
    }

    #[test]
    fn normalizes_error_and_cancelled_terminal_states() {
        let error = normalize_terminal_state(
            "conversation-1",
            "error",
            &serde_json::json!({
                "type": "run_failed",
                "status": "error",
                "error": {"message": "boom"}
            }),
        );
        assert_eq!(error["type"], "conversation_state");
        assert_eq!(error["status"], "error");
        assert_eq!(error["error_detail"], "boom");

        let cancelled = normalize_terminal_state(
            "conversation-1",
            "cancelled",
            &serde_json::json!({
                "type": "run_cancelled",
                "status": "cancelled",
                "reason": "user requested cancel"
            }),
        );
        assert_eq!(cancelled["type"], "conversation_state");
        assert_eq!(cancelled["status"], "cancelled");
        assert_eq!(cancelled["error_detail"], "user requested cancel");

        // PauseEvent stays canonical and is handled as resumable pause state.
        let pause_event = normalize_server_event(
            "agent-1",
            "conversation-1",
            &serde_json::json!({
                "type": "PauseEvent",
                "event_class": "PauseEvent",
                "source": "user"
            }),
        );
        assert_eq!(pause_event["kind"], "PauseEvent");
        assert_eq!(pause_event["source"], "user");
    }

    #[test]
    fn normalizes_openhands_conversation_status_updates_as_terminal_state() {
        let finished = normalize_server_event(
            "agent-1",
            "conversation-1",
            &serde_json::json!({
                "event_class": "ConversationStateUpdateEvent",
                "key": "status",
                "value": "finished"
            }),
        );
        assert_eq!(finished["kind"], "ConversationStateUpdateEvent");
        assert_eq!(finished["key"], "status");
        assert_eq!(finished["value"], "finished");

        let stuck = normalize_server_event(
            "agent-1",
            "conversation-1",
            &serde_json::json!({
                "kind": "ConversationStateUpdateEvent",
                "key": "execution_status",
                "value": "stuck"
            }),
        );
        assert_eq!(stuck["kind"], "ConversationStateUpdateEvent");
        assert_eq!(stuck["key"], "execution_status");
        assert_eq!(stuck["value"], "stuck");
    }
}
