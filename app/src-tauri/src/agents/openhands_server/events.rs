pub fn normalize_server_event(
    agent_id: &str,
    conversation_id: &str,
    raw: &serde_json::Value,
) -> serde_json::Value {
    if let Some(status) = terminal_status(raw) {
        return normalize_terminal_state(agent_id, conversation_id, status, raw);
    }

    serde_json::json!({
        "type": "conversation_event",
        "runtime": "openhands",
        "agent_id": agent_id,
        "conversation_id": conversation_id,
        "event_class": raw
            .get("event_class")
            .or_else(|| raw.get("eventClass"))
            .or_else(|| raw.get("kind"))
            .and_then(|value| value.as_str())
            .unwrap_or_else(|| raw.get("type").and_then(|value| value.as_str()).unwrap_or("event")),
        "event": raw,
        "timestamp": chrono::Utc::now().timestamp_millis(),
    })
}

fn normalize_terminal_state(
    agent_id: &str,
    conversation_id: &str,
    status: &str,
    raw: &serde_json::Value,
) -> serde_json::Value {
    serde_json::json!({
        "type": "conversation_state",
        "runtime": "openhands",
        "agent_id": agent_id,
        "conversation_id": conversation_id,
        "status": status,
        "timestamp": chrono::Utc::now().timestamp_millis(),
        "result_text": result_text(raw),
        "structured_output": structured_output(raw),
        "error_detail": error_detail(raw),
        "raw_event": raw,
    })
}

fn terminal_status(raw: &serde_json::Value) -> Option<&'static str> {
    let status = raw
        .get("status")
        .or_else(|| raw.pointer("/state/status"))
        .or_else(|| raw.pointer("/conversation/status"))
        .and_then(|value| value.as_str());
    if let Some(status) = normalize_execution_status(status) {
        return Some(status);
    }

    if is_conversation_state_update(raw)
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
        Some(
            "run_cancelled"
            | "run_canceled"
            | "run_paused"
            | "conversation_paused"
            | "PauseEvent"
            | "pause_event",
        ) => Some("cancelled"),
        _ => None,
    }
}

fn normalize_execution_status(status: Option<&str>) -> Option<&'static str> {
    match status {
        Some("completed" | "complete" | "success" | "succeeded" | "finished") => Some("completed"),
        Some("error" | "failed" | "failure" | "stuck") => Some("error"),
        Some("cancelled" | "canceled" | "paused" | "pause" | "stopped") => Some("cancelled"),
        _ => None,
    }
}

fn is_conversation_state_update(raw: &serde_json::Value) -> bool {
    matches!(
        raw.get("event_class")
            .or_else(|| raw.get("eventClass"))
            .or_else(|| raw.get("kind"))
            .or_else(|| raw.get("type"))
            .and_then(|value| value.as_str()),
        Some("ConversationStateUpdateEvent" | "conversation_state_update")
    )
}

fn result_text(raw: &serde_json::Value) -> Option<String> {
    raw.get("result_text")
        .or_else(|| raw.get("resultText"))
        .or_else(|| raw.pointer("/result/text"))
        .or_else(|| raw.get("message"))
        .and_then(|value| value.as_str())
        .map(str::to_string)
}

fn structured_output(raw: &serde_json::Value) -> Option<serde_json::Value> {
    raw.get("structured_output")
        .or_else(|| raw.get("structuredOutput"))
        .or_else(|| raw.pointer("/result/structured_output"))
        .or_else(|| raw.pointer("/result/structuredOutput"))
        .cloned()
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

        assert_eq!(normalized["type"], "conversation_event");
        assert_eq!(normalized["agent_id"], "agent-1");
        assert_eq!(normalized["conversation_id"], "conversation-1");
        assert_eq!(normalized["event_class"], "MessageEvent");
        assert_eq!(normalized["event"], raw);
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

        assert_eq!(normalized["event_class"], "ActionEvent");
    }

    #[test]
    fn normalizes_completed_raw_state_as_terminal_conversation_state() {
        let raw = serde_json::json!({
            "type": "run_completed",
            "status": "completed",
            "result": {"text": "done", "structured_output": {"ok": true}}
        });

        let normalized = normalize_server_event("agent-1", "conversation-1", &raw);

        assert_eq!(normalized["type"], "conversation_state");
        assert_eq!(normalized["status"], "completed");
        assert_eq!(normalized["result_text"], "done");
        assert_eq!(
            normalized["structured_output"],
            serde_json::json!({"ok": true})
        );
        assert_eq!(normalized["raw_event"], raw);
    }

    #[test]
    fn normalizes_error_and_cancelled_terminal_states() {
        let error = normalize_server_event(
            "agent-1",
            "conversation-1",
            &serde_json::json!({
                "type": "run_failed",
                "status": "error",
                "error": {"message": "boom"}
            }),
        );
        assert_eq!(error["type"], "conversation_state");
        assert_eq!(error["status"], "error");
        assert_eq!(error["error_detail"], "boom");

        let cancelled = normalize_server_event(
            "agent-1",
            "conversation-1",
            &serde_json::json!({
                "type": "run_paused",
                "status": "paused",
                "reason": "user requested pause"
            }),
        );
        assert_eq!(cancelled["type"], "conversation_state");
        assert_eq!(cancelled["status"], "cancelled");
        assert_eq!(cancelled["error_detail"], "user requested pause");

        // PauseEvent is the SDK's real user action event; must be treated as terminal cancelled.
        let pause_event = normalize_server_event(
            "agent-1",
            "conversation-1",
            &serde_json::json!({
                "type": "PauseEvent",
                "event_class": "PauseEvent",
                "source": "user"
            }),
        );
        assert_eq!(pause_event["type"], "conversation_state");
        assert_eq!(pause_event["status"], "cancelled");
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
        assert_eq!(finished["type"], "conversation_state");
        assert_eq!(finished["status"], "completed");

        let stuck = normalize_server_event(
            "agent-1",
            "conversation-1",
            &serde_json::json!({
                "kind": "ConversationStateUpdateEvent",
                "key": "execution_status",
                "value": "stuck"
            }),
        );
        assert_eq!(stuck["type"], "conversation_state");
        assert_eq!(stuck["status"], "error");
    }
}
