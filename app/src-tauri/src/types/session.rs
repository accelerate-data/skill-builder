use serde::{Deserialize, Serialize};

/// A single message in a skill conversation history.
/// Typed struct ensures Tauri IPC rejects malformed payloads at the boundary
/// rather than silently forwarding broken JSON to the runtime.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ConversationMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RestoredConversationEvent {
    pub event_class: String,
    pub event: serde_json::Value,
    pub timestamp: i64,
    pub tool_call_id: Option<String>,
    pub parent_tool_call_id: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct SkillSessionInfo {
    pub conversation_id: String,
    pub skill_name: String,
    pub created_at: String,
    /// Agent names discovered from the allowed plugins.
    pub available_agents: Vec<String>,
    /// Restored user/agent messages from the persisted skill conversation.
    pub restored_messages: Vec<ConversationMessage>,
    /// Restored OpenHands event transcript for resume hydration.
    pub restored_transcript_events: Vec<RestoredConversationEvent>,
}

impl std::fmt::Debug for SkillSessionInfo {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SkillSessionInfo")
            .field("conversation_id", &"[REDACTED]")
            .field("skill_name", &self.skill_name)
            .field("created_at", &self.created_at)
            .finish()
    }
}
