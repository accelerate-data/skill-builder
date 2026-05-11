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
