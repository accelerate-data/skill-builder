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
