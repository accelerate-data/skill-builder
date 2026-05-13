fn event_class(raw: &serde_json::Value) -> Option<&str> {
    raw.get("event_class")
        .or_else(|| raw.get("eventClass"))
        .or_else(|| raw.get("kind"))
        .or_else(|| raw.get("type"))
        .and_then(|value| value.as_str())
}

fn first_string<'a>(
    values: impl IntoIterator<Item = Option<&'a serde_json::Value>>,
) -> Option<&'a str> {
    values
        .into_iter()
        .flatten()
        .find_map(|value| value.as_str())
        .filter(|text| !text.trim().is_empty())
}

fn extract_message_text(raw: &serde_json::Value) -> Option<String> {
    let llm_message = raw.get("llm_message");
    first_string([
        raw.get("message"),
        raw.get("text"),
        raw.pointer("/content/0/text"),
        raw.pointer("/content/0/content"),
        llm_message.and_then(|value| value.get("message")),
        llm_message.and_then(|value| value.get("text")),
        llm_message.and_then(|value| value.pointer("/content/0/text")),
    ])
    .map(str::to_string)
}

fn extract_tool_call_id(raw: &serde_json::Value) -> Option<String> {
    first_string([
        raw.get("tool_call_id"),
        raw.get("toolCallId"),
        raw.pointer("/action/tool_call_id"),
        raw.pointer("/action/toolCallId"),
        raw.pointer("/observation/tool_call_id"),
        raw.pointer("/observation/toolCallId"),
        raw.pointer("/tool_calls/0/id"),
        raw.pointer("/tool_calls/0/tool_call_id"),
    ])
    .map(str::to_string)
}

fn extract_parent_tool_call_id(raw: &serde_json::Value) -> Option<String> {
    first_string([
        raw.get("parent_tool_call_id"),
        raw.get("parentToolCallId"),
        raw.pointer("/action/parent_tool_call_id"),
        raw.pointer("/action/parentToolCallId"),
        raw.pointer("/observation/parent_tool_call_id"),
        raw.pointer("/observation/parentToolCallId"),
    ])
    .map(str::to_string)
}

fn extract_timestamp_ms(raw: &serde_json::Value) -> i64 {
    if let Some(timestamp) = raw.get("timestamp") {
        if let Some(value) = timestamp.as_i64() {
            return value;
        }
        if let Some(value) = timestamp.as_u64() {
            return value.min(i64::MAX as u64) as i64;
        }
        if let Some(value) = timestamp.as_str() {
            if let Ok(parsed) = chrono::DateTime::parse_from_rfc3339(value) {
                return parsed.timestamp_millis();
            }
        }
    }
    chrono::Utc::now().timestamp_millis()
}

pub(crate) fn extract_conversation_messages(
    events: &[serde_json::Value],
) -> Vec<crate::types::ConversationMessage> {
    events
        .iter()
        .filter(|raw| event_class(raw) == Some("MessageEvent"))
        .filter_map(|raw| {
            let role = match raw.get("source").and_then(|value| value.as_str()) {
                Some("user") => "user",
                Some("agent") | Some("assistant") => "agent",
                _ => return None,
            };
            let content = extract_message_text(raw)?;
            Some(crate::types::ConversationMessage {
                role: role.to_string(),
                content,
            })
        })
        .collect()
}

pub(crate) fn extract_restored_conversation_events(
    events: &[serde_json::Value],
) -> Vec<crate::types::RestoredConversationEvent> {
    events
        .iter()
        .filter_map(|raw| {
            let event_class = event_class(raw)?;
            Some(crate::types::RestoredConversationEvent {
                event_class: event_class.to_string(),
                event: raw.clone(),
                timestamp: extract_timestamp_ms(raw),
                tool_call_id: extract_tool_call_id(raw),
                parent_tool_call_id: extract_parent_tool_call_id(raw),
            })
        })
        .collect()
}

pub(crate) fn restored_conversation_user_turn_count(
    events: &[crate::types::RestoredConversationEvent],
) -> usize {
    events
        .iter()
        .filter(|event| {
            event.event_class == "MessageEvent"
                && event
                    .event
                    .get("source")
                    .and_then(|value| value.as_str())
                    .map(|source| source == "user")
                    .unwrap_or(false)
        })
        .count()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_event_class_prefers_event_class_over_eventclass_kind_type() {
        let raw = serde_json::json!({
            "event_class": "MessageEvent",
            "eventClass": "OtherEvent",
            "kind": "KindEvent",
            "type": "TypeEvent"
        });
        assert_eq!(event_class(&raw), Some("MessageEvent"));
    }

    #[test]
    fn test_event_class_falls_back_to_eventclass() {
        let raw = serde_json::json!({
            "eventClass": "MessageEvent"
        });
        assert_eq!(event_class(&raw), Some("MessageEvent"));
    }

    #[test]
    fn test_event_class_falls_back_to_kind() {
        let raw = serde_json::json!({
            "kind": "ActionEvent"
        });
        assert_eq!(event_class(&raw), Some("ActionEvent"));
    }

    #[test]
    fn test_event_class_falls_back_to_type() {
        let raw = serde_json::json!({
            "type": "ObservationEvent"
        });
        assert_eq!(event_class(&raw), Some("ObservationEvent"));
    }

    #[test]
    fn test_event_class_returns_none_when_all_missing() {
        let raw = serde_json::json!({
            "source": "user",
            "message": "hello"
        });
        assert_eq!(event_class(&raw), None);
    }

    #[test]
    fn test_first_string_returns_first_non_empty_string() {
        let v1 = serde_json::json!("hello");
        let v2 = serde_json::json!("world");
        assert_eq!(first_string([Some(&v1), Some(&v2)]), Some("hello"));
    }

    #[test]
    fn test_first_string_skips_null_values() {
        let v = serde_json::json!("found");
        assert_eq!(first_string([None, Some(&v), None]), Some("found"));
    }

    #[test]
    fn test_first_string_skips_empty_strings() {
        let empty = serde_json::json!("");
        let v = serde_json::json!("not-empty");
        // find_map returns the first as_str() match, then filter rejects empty strings,
        // so an empty string as the first value results in None
        assert_eq!(first_string([Some(&empty), Some(&v)]), None);
    }

    #[test]
    fn test_first_string_skips_whitespace_only_strings() {
        let ws = serde_json::json!("   ");
        let v = serde_json::json!("real");
        // find_map returns the first as_str() match, then filter rejects whitespace-only,
        // so a whitespace string as the first value results in None
        assert_eq!(first_string([Some(&ws), Some(&v)]), None);
    }

    #[test]
    fn test_first_string_returns_none_when_all_empty() {
        let empty = serde_json::json!("");
        assert_eq!(first_string([Some(&empty), None]), None);
    }

    #[test]
    fn test_first_string_returns_none_when_all_null() {
        assert_eq!(first_string([None, None]), None);
    }

    #[test]
    fn test_extract_message_text_from_top_level_message() {
        let raw = serde_json::json!({
            "message": "Hello world"
        });
        assert_eq!(extract_message_text(&raw), Some("Hello world".to_string()));
    }

    #[test]
    fn test_extract_message_text_from_top_level_text() {
        let raw = serde_json::json!({
            "text": "Some text"
        });
        assert_eq!(extract_message_text(&raw), Some("Some text".to_string()));
    }

    #[test]
    fn test_extract_message_text_from_content_array() {
        let raw = serde_json::json!({
            "content": [{"type": "text", "text": "Content text"}]
        });
        assert_eq!(extract_message_text(&raw), Some("Content text".to_string()));
    }

    #[test]
    fn test_extract_message_text_from_llm_message() {
        let raw = serde_json::json!({
            "llm_message": {"message": "LLM says hi"}
        });
        assert_eq!(extract_message_text(&raw), Some("LLM says hi".to_string()));
    }

    #[test]
    fn test_extract_message_text_from_llm_message_text() {
        let raw = serde_json::json!({
            "llm_message": {"text": "LLM text field"}
        });
        assert_eq!(
            extract_message_text(&raw),
            Some("LLM text field".to_string())
        );
    }

    #[test]
    fn test_extract_message_text_from_llm_content_array() {
        let raw = serde_json::json!({
            "llm_message": {"content": [{"type": "text", "text": "LLM content"}]}
        });
        assert_eq!(extract_message_text(&raw), Some("LLM content".to_string()));
    }

    #[test]
    fn test_extract_message_text_returns_none_for_empty_payload() {
        let raw = serde_json::json!({});
        assert_eq!(extract_message_text(&raw), None);
    }

    #[test]
    fn test_extract_message_text_prefers_message_over_text() {
        let raw = serde_json::json!({
            "message": "primary",
            "text": "secondary"
        });
        assert_eq!(extract_message_text(&raw), Some("primary".to_string()));
    }

    #[test]
    fn test_extract_tool_call_id_from_top_level() {
        let raw = serde_json::json!({
            "tool_call_id": "tc-123"
        });
        assert_eq!(extract_tool_call_id(&raw), Some("tc-123".to_string()));
    }

    #[test]
    fn test_extract_tool_call_id_from_camelcase() {
        let raw = serde_json::json!({
            "toolCallId": "tc-456"
        });
        assert_eq!(extract_tool_call_id(&raw), Some("tc-456".to_string()));
    }

    #[test]
    fn test_extract_tool_call_id_from_action_nested() {
        let raw = serde_json::json!({
            "action": {"tool_call_id": "tc-789"}
        });
        assert_eq!(extract_tool_call_id(&raw), Some("tc-789".to_string()));
    }

    #[test]
    fn test_extract_tool_call_id_from_observation_nested() {
        let raw = serde_json::json!({
            "observation": {"toolCallId": "tc-obs"}
        });
        assert_eq!(extract_tool_call_id(&raw), Some("tc-obs".to_string()));
    }

    #[test]
    fn test_extract_tool_call_id_from_tool_calls_array() {
        let raw = serde_json::json!({
            "tool_calls": [{"id": "tc-array"}]
        });
        assert_eq!(extract_tool_call_id(&raw), Some("tc-array".to_string()));
    }

    #[test]
    fn test_extract_tool_call_id_returns_none_when_missing() {
        let raw = serde_json::json!({
            "event_class": "ActionEvent"
        });
        assert_eq!(extract_tool_call_id(&raw), None);
    }

    #[test]
    fn test_extract_parent_tool_call_id_from_top_level() {
        let raw = serde_json::json!({
            "parent_tool_call_id": "parent-1"
        });
        assert_eq!(
            extract_parent_tool_call_id(&raw),
            Some("parent-1".to_string())
        );
    }

    #[test]
    fn test_extract_parent_tool_call_id_from_camelcase() {
        let raw = serde_json::json!({
            "parentToolCallId": "parent-2"
        });
        assert_eq!(
            extract_parent_tool_call_id(&raw),
            Some("parent-2".to_string())
        );
    }

    #[test]
    fn test_extract_parent_tool_call_id_from_action_nested() {
        let raw = serde_json::json!({
            "action": {"parent_tool_call_id": "parent-3"}
        });
        assert_eq!(
            extract_parent_tool_call_id(&raw),
            Some("parent-3".to_string())
        );
    }

    #[test]
    fn test_extract_parent_tool_call_id_from_observation_nested() {
        let raw = serde_json::json!({
            "observation": {"parentToolCallId": "parent-4"}
        });
        assert_eq!(
            extract_parent_tool_call_id(&raw),
            Some("parent-4".to_string())
        );
    }

    #[test]
    fn test_extract_parent_tool_call_id_returns_none_when_missing() {
        let raw = serde_json::json!({
            "event_class": "ActionEvent"
        });
        assert_eq!(extract_parent_tool_call_id(&raw), None);
    }

    #[test]
    fn test_extract_timestamp_ms_from_i64() {
        let raw = serde_json::json!({
            "timestamp": 1715000000000i64
        });
        assert_eq!(extract_timestamp_ms(&raw), 1715000000000);
    }

    #[test]
    fn test_extract_timestamp_ms_from_u64_large_value() {
        let raw = serde_json::json!({
            "timestamp": 1715000000000u64
        });
        assert_eq!(extract_timestamp_ms(&raw), 1715000000000);
    }

    #[test]
    fn test_extract_timestamp_ms_from_rfc3339_string() {
        let raw = serde_json::json!({
            "timestamp": "2026-05-07T10:00:00Z"
        });
        let result = extract_timestamp_ms(&raw);
        assert!(result > 0, "should parse to a positive timestamp");
    }

    #[test]
    fn test_extract_timestamp_ms_falls_back_to_now_when_missing() {
        let raw = serde_json::json!({});
        let before = chrono::Utc::now().timestamp_millis();
        let result = extract_timestamp_ms(&raw);
        let after = chrono::Utc::now().timestamp_millis();
        assert!(
            result >= before && result <= after,
            "fallback timestamp should be close to now"
        );
    }

    #[test]
    fn test_extract_timestamp_ms_falls_back_to_now_for_invalid_string() {
        let raw = serde_json::json!({
            "timestamp": "not-a-date"
        });
        let before = chrono::Utc::now().timestamp_millis();
        let result = extract_timestamp_ms(&raw);
        let after = chrono::Utc::now().timestamp_millis();
        assert!(
            result >= before && result <= after,
            "invalid string should fall back to now"
        );
    }
}
