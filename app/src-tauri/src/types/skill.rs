use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillSummary {
    pub id: i64,
    pub name: String,
    #[serde(default)]
    pub library_key: Option<String>,
    pub current_step: Option<String>,
    pub status: Option<String>,
    pub last_modified: Option<String>,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    pub purpose: Option<String>,
    #[serde(default)]
    pub author_login: Option<String>,
    #[serde(default)]
    pub author_avatar: Option<String>,
    #[serde(default)]
    pub display_name: Option<String>,
    #[serde(default)]
    pub intake_json: Option<String>,
    #[serde(default)]
    pub source: Option<String>,
    /// The skill_source from the skills master table (skill-builder, marketplace, imported).
    #[serde(default)]
    pub skill_source: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default, rename = "userInvocable")]
    pub user_invocable: Option<bool>,
    #[serde(default, rename = "disableModelInvocation")]
    pub disable_model_invocation: Option<bool>,
    #[serde(default)]
    pub plugin_slug: Option<String>,
    #[serde(default)]
    pub plugin_display_name: Option<String>,
    #[serde(default)]
    pub is_default_plugin: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillFileEntry {
    pub name: String,
    pub relative_path: String,
    pub absolute_path: String,
    pub is_directory: bool,
    pub is_readonly: bool,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportedSkill {
    pub skill_id: i64,
    pub skill_name: String,
    #[serde(default)]
    pub library_key: Option<String>,
    pub is_active: bool,
    pub disk_path: String,
    pub imported_at: String,
    #[serde(default)]
    pub is_bundled: bool,
    // Populated from SKILL.md frontmatter on disk, not from DB
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default)]
    pub purpose: Option<String>,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub user_invocable: Option<bool>,
    #[serde(default)]
    pub disable_model_invocation: Option<bool>,
    /// Source registry URL this skill was imported from. NULL for bundled/manually uploaded skills.
    #[serde(default)]
    pub marketplace_source_url: Option<String>,
    #[serde(default)]
    pub plugin_slug: Option<String>,
    #[serde(default)]
    pub plugin_display_name: Option<String>,
    #[serde(default)]
    pub is_default_plugin: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LibraryPlugin {
    pub id: i64,
    pub slug: String,
    pub display_name: String,
    #[serde(default)]
    pub version: Option<String>,
    pub source_type: String,
    #[serde(default)]
    pub source_url: Option<String>,
    pub is_default: bool,
    #[serde(default)]
    pub upgrade_locked: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillFileMeta {
    pub name: Option<String>,
    pub description: Option<String>,
    pub version: Option<String>,
    pub user_invocable: Option<bool>,
    pub disable_model_invocation: Option<bool>,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct SkillLock {
    pub skill_id: i64,
    pub skill_name: String,
    pub instance_id: String,
    pub pid: u32,
    pub acquired_at: String,
}

impl std::fmt::Debug for SkillLock {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SkillLock")
            .field("skill_name", &self.skill_name)
            .field("instance_id", &self.instance_id)
            .field("pid", &"[REDACTED]")
            .field("acquired_at", &self.acquired_at)
            .finish()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AvailableSkill {
    pub path: String,
    pub name: String,
    /// Name of the plugin that contains this skill, from `{plugin_path}/.claude-plugin/plugin.json`.
    /// Present when listing marketplace skills so the UI can display `{plugin_name}:{name}`.
    /// `None` for root-level plugins whose `plugin.json` is absent or has no `name` field.
    /// Not stored locally — the skill is always saved under its plain `name`.
    #[serde(default)]
    pub plugin_name: Option<String>,
    pub description: Option<String>,
    #[serde(default)]
    pub purpose: Option<String>,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub user_invocable: Option<bool>,
    #[serde(default)]
    pub disable_model_invocation: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AvailablePlugin {
    pub path: String,
    pub name: String,
    pub description: Option<String>,
    pub version: Option<String>,
    pub skill_count: usize,
    pub skill_names: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SkillMetadataOverride {
    pub name: Option<String>,
    pub description: Option<String>,
    pub purpose: Option<String>,
    pub version: Option<String>,
    pub user_invocable: Option<bool>,
    pub disable_model_invocation: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillCommit {
    pub sha: String,
    pub message: String,
    pub timestamp: String,
    /// Semver version (e.g. "1.0.0") if this commit is tagged, None otherwise.
    pub version: Option<String>,
}
