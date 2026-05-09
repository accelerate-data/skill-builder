use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillFileContent {
    /// Relative path from the skill root (e.g. "SKILL.md", "references/guide.md")
    pub path: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RefineFileDiff {
    pub path: String,
    /// One of "added", "modified", "deleted"
    pub status: String,
    /// Unified diff text for this file
    pub diff: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RefineDiff {
    /// Human-readable change summary (e.g. "1 file(s) changed, 3 insertion(s)(+)")
    pub stat: String,
    pub files: Vec<RefineFileDiff>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RefineFinalizeResult {
    pub files: Vec<SkillFileContent>,
    pub diff: RefineDiff,
    pub commit_sha: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RefineDispatchResult {
    pub agent_id: String,
    pub conversation_id: String,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct RefineSessionInfo {
    pub conversation_id: String,
    pub skill_name: String,
    pub created_at: String,
    /// Agent names discovered from the allowed refine plugins.
    pub available_agents: Vec<String>,
    /// Restored user/agent messages from the persisted skill conversation.
    pub restored_messages: Vec<ConversationMessage>,
    /// Restored OpenHands event transcript for resume hydration.
    pub restored_transcript_events: Vec<RestoredConversationEvent>,
}

impl std::fmt::Debug for RefineSessionInfo {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("RefineSessionInfo")
            .field("conversation_id", &"[REDACTED]")
            .field("skill_name", &self.skill_name)
            .field("created_at", &self.created_at)
            .finish()
    }
}

/// A single message in a refine conversation history.
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
