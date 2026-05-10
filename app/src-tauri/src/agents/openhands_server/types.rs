use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::agents::runtime_config::OpenHandsRuntimeConfig;

#[derive(Debug, Clone)]
pub struct OpenHandsRuntimeRequest {
    pub prompt: String,
    pub llm: crate::types::WorkflowLlmConfig,
    pub workspace_root_dir: String,
    pub workspace_skill_dir: String,
    pub allowed_tools: Vec<String>,
    pub max_turns: u32,
    pub user_message_suffix: Option<String>,
    pub system_message_suffix: Option<String>,
    #[allow(dead_code)]
    pub task_kind: Option<String>,
    pub plugin_slug: String,
    pub skill_name: Option<String>,
    pub step_id: Option<i32>,
    pub run_source: Option<String>,
    pub workflow_session_id: Option<String>,
    pub usage_session_id: Option<String>,
}

impl OpenHandsRuntimeRequest {
    pub fn try_from_runtime_config(config: &OpenHandsRuntimeConfig) -> Result<Self, String> {
        let llm = config
            .llm
            .clone()
            .ok_or_else(|| "OpenHands Agent Server request requires llm config".to_string())?;

        Ok(Self {
            prompt: config.prompt.clone(),
            llm,
            workspace_root_dir: config.workspace_root_dir.clone(),
            workspace_skill_dir: config.workspace_skill_dir.clone(),
            allowed_tools: config.allowed_tools.clone().unwrap_or_default(),
            max_turns: config.max_turns.unwrap_or(50),
            user_message_suffix: config.user_message_suffix.clone(),
            system_message_suffix: config.system_message_suffix.clone(),
            task_kind: config.task_kind.clone(),
            plugin_slug: config.plugin_slug.clone(),
            skill_name: config.skill_name.clone(),
            step_id: config.step_id,
            run_source: config.run_source.clone(),
            workflow_session_id: config.workflow_session_id.clone(),
            usage_session_id: config.usage_session_id.clone(),
        })
    }

    /// Returns the canonical skill directory — the OpenHands working directory.
    pub fn runtime_run_dir(&self) -> &Path {
        Path::new(&self.workspace_skill_dir)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LocalWorkspace {
    pub working_dir: String,
    pub kind: String,
}

impl LocalWorkspace {
    pub fn new(working_dir: impl Into<String>) -> Self {
        Self {
            working_dir: working_dir.into(),
            kind: "LocalWorkspace".to_string(),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct ConversationMetadata {
    #[serde(rename = "plugin", skip_serializing_if = "Option::is_none")]
    pub plugin_slug: Option<String>,
    #[serde(rename = "skill", skip_serializing_if = "Option::is_none")]
    pub skill_name: Option<String>,
    #[serde(rename = "step", skip_serializing_if = "Option::is_none")]
    pub step_id: Option<String>,
    #[serde(rename = "source", skip_serializing_if = "Option::is_none")]
    pub run_source: Option<String>,
    #[serde(rename = "session", skip_serializing_if = "Option::is_none")]
    pub workflow_session_id: Option<String>,
    #[serde(rename = "workspace", skip_serializing_if = "Option::is_none")]
    pub workspace_root_dir: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TextContent {
    #[serde(rename = "type")]
    pub content_type: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SendMessageRequest {
    pub role: String,
    pub content: Vec<TextContent>,
    pub run: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NeverConfirmPolicy {
    pub kind: String,
}

impl Default for NeverConfirmPolicy {
    fn default() -> Self {
        Self {
            kind: "NeverConfirm".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenHandsTool {
    pub name: String,
    pub params: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SkillResources {
    pub skill_root: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub scripts: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub references: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub assets: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenHandsSkill {
    pub name: String,
    pub content: String,
    pub is_agentskills_format: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resources: Option<SkillResources>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct OpenHandsAgentContext {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub skills: Vec<OpenHandsSkill>,
    #[serde(
        rename = "system_message_suffix",
        skip_serializing_if = "Option::is_none"
    )]
    pub system_message_suffix: Option<String>,
    #[serde(
        rename = "user_message_suffix",
        skip_serializing_if = "Option::is_none"
    )]
    pub user_message_suffix: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenHandsAgent {
    pub kind: String,
    pub llm: serde_json::Value,
    pub tools: Vec<OpenHandsTool>,
    #[serde(rename = "include_default_tools")]
    pub include_default_tools: Vec<String>,
    #[serde(rename = "agent_context")]
    pub agent_context: OpenHandsAgentContext,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StartConversationRequest {
    pub workspace: LocalWorkspace,
    #[serde(rename = "initial_message", skip_serializing_if = "Option::is_none")]
    pub initial_message: Option<SendMessageRequest>,
    #[serde(rename = "max_iterations")]
    pub max_iterations: u32,
    #[serde(rename = "stuck_detection")]
    pub stuck_detection: bool,
    #[serde(rename = "confirmation_policy")]
    pub confirmation_policy: NeverConfirmPolicy,
    pub tags: ConversationMetadata,
    pub agent: OpenHandsAgent,
}

impl StartConversationRequest {
    #[cfg_attr(not(test), allow(dead_code))]
    pub fn from_runtime_request(request: &OpenHandsRuntimeRequest) -> Self {
        Self::from_runtime_request_with_initial_message(request, true)
    }

    pub fn from_runtime_request_with_initial_message(
        request: &OpenHandsRuntimeRequest,
        include_initial_message: bool,
    ) -> Self {
        Self::from_runtime_run_dir(request, request.runtime_run_dir(), include_initial_message)
    }

    pub fn from_runtime_run_dir(
        request: &OpenHandsRuntimeRequest,
        runtime_run_dir: &Path,
        include_initial_message: bool,
    ) -> Self {
        Self {
            workspace: LocalWorkspace::new(runtime_run_dir.to_string_lossy().into_owned()),
            initial_message: include_initial_message.then(|| SendMessageRequest {
                role: "user".to_string(),
                content: vec![TextContent {
                    content_type: "text".to_string(),
                    text: request.prompt.clone(),
                }],
                run: false,
            }),
            max_iterations: request.max_turns,
            stuck_detection: true,
            confirmation_policy: NeverConfirmPolicy::default(),
            tags: ConversationMetadata {
                plugin_slug: Some(openhands_tag_value(&request.plugin_slug)),
                skill_name: request.skill_name.as_deref().map(openhands_tag_value),
                step_id: request.step_id.map(|step_id| step_id.to_string()),
                run_source: request.run_source.as_deref().map(openhands_tag_value),
                workflow_session_id: request
                    .workflow_session_id
                    .as_deref()
                    .map(openhands_tag_value),
                workspace_root_dir: Some(openhands_tag_value(&request.workspace_root_dir)),
            },
            agent: OpenHandsAgent {
                kind: "Agent".to_string(),
                llm: openhands_llm_json(&request.llm),
                tools: openhands_tools(&request.workspace_skill_dir, &request.allowed_tools),
                // `include_default_tools` only resolves names in the SDK's
                // BUILT_IN_TOOL_CLASSES map: FinishTool, ThinkTool,
                // InvokeSkillTool. InvokeSkillTool is auto-attached by the
                // agent when an AgentSkills-format skill is present in
                // agent_context.skills, so it doesn't need to be listed here.
                include_default_tools: vec!["FinishTool".to_string(), "ThinkTool".to_string()],
                agent_context: {
                    let skills = discover_agentskills(runtime_run_dir);
                    if skills.is_empty() {
                        log::warn!(
                            "[openhands-agent-server] no AgentSkills found under {}/.agents/skills/ \
                             — InvokeSkillTool will not auto-attach",
                            runtime_run_dir.display()
                        );
                    } else {
                        log::debug!(
                            "[openhands-agent-server] attaching {} AgentSkill(s) from {}/.agents/skills/: {}",
                            skills.len(),
                            runtime_run_dir.display(),
                            skills
                                .iter()
                                .map(|s| s.name.as_str())
                                .collect::<Vec<_>>()
                                .join(", ")
                        );
                    }
                    OpenHandsAgentContext {
                        skills,
                        system_message_suffix: request.system_message_suffix.clone(),
                        user_message_suffix: request.user_message_suffix.clone(),
                    }
                },
            },
        }
    }
}

fn openhands_tag_value(value: &str) -> String {
    const OPENHANDS_TAG_VALUE_MAX_LENGTH: usize = 256;
    value.chars().take(OPENHANDS_TAG_VALUE_MAX_LENGTH).collect()
}

fn openhands_llm_json(llm: &crate::types::WorkflowLlmConfig) -> serde_json::Value {
    let mut value = serde_json::json!({
        "model": openhands_litellm_model(&llm.model, llm.base_url.as_deref()),
    });
    if let Some(obj) = value.as_object_mut() {
        if let Some(api_key) = &llm.api_key {
            obj.insert(
                "api_key".to_string(),
                serde_json::Value::String(api_key.expose().to_string()),
            );
        }
        if let Some(base_url) = &llm.base_url {
            obj.insert(
                "base_url".to_string(),
                serde_json::Value::String(base_url.clone()),
            );
        }
        if let Some(api_version) = &llm.api_version {
            obj.insert(
                "api_version".to_string(),
                serde_json::Value::String(api_version.clone()),
            );
        }
        if let Some(temperature) = llm.temperature {
            obj.insert("temperature".to_string(), serde_json::json!(temperature));
        }
        if let Some(max_output_tokens) = llm.max_output_tokens {
            obj.insert(
                "max_output_tokens".to_string(),
                serde_json::json!(max_output_tokens),
            );
        }
        if let Some(timeout_seconds) = llm.timeout_seconds {
            obj.insert("timeout".to_string(), serde_json::json!(timeout_seconds));
        }
        if let Some(num_retries) = llm.num_retries {
            obj.insert("num_retries".to_string(), serde_json::json!(num_retries));
        }
        if let Some(reasoning_effort) = &llm.reasoning_effort {
            obj.insert(
                "reasoning_effort".to_string(),
                serde_json::Value::String(reasoning_effort.clone()),
            );
        }
        if let Some(extra_headers) = &llm.extra_headers {
            obj.insert(
                "extra_headers".to_string(),
                serde_json::json!(extra_headers),
            );
        }
        if let Some(input_cost_per_token) = llm.input_cost_per_token {
            obj.insert(
                "input_cost_per_token".to_string(),
                serde_json::json!(input_cost_per_token),
            );
        }
        if let Some(output_cost_per_token) = llm.output_cost_per_token {
            obj.insert(
                "output_cost_per_token".to_string(),
                serde_json::json!(output_cost_per_token),
            );
        }
        if let Some(usage_id) = &llm.usage_id {
            obj.insert(
                "usage_id".to_string(),
                serde_json::Value::String(usage_id.clone()),
            );
        }
    }
    value
}

fn openhands_litellm_model(model: &str, base_url: Option<&str>) -> String {
    if base_url.is_some() {
        if let Some(model_name) = model
            .strip_prefix("opencode-go/")
            .or_else(|| model.strip_prefix("opencode/"))
        {
            return format!("openai/{model_name}");
        }
    }

    model.to_string()
}

/// Discover deployed AgentSkills under the conversation working directory.
///
/// Looks at `<workspace_skill_dir>/.agents/skills/<skill-name>/SKILL.md`,
/// the canonical location our deploy step writes to. Each match becomes an
/// `OpenHandsSkill` with `is_agentskills_format: true` so the SDK lists it in
/// `<available_skills>` (progressive disclosure) and `Agent._initialize`
/// auto-attaches `InvokeSkillTool`.
///
/// The agent server itself only auto-loads user / public / org skills via the
/// model_validator on `AgentContext` — project skills under `.agents/skills/`
/// are *not* auto-loaded into a conversation, so we have to surface them in
/// the request payload.
pub(crate) fn discover_agentskills(workspace_skill_dir: &Path) -> Vec<OpenHandsSkill> {
    let skills_root = workspace_skill_dir.join(".agents").join("skills");
    let entries = match std::fs::read_dir(&skills_root) {
        Ok(entries) => entries,
        Err(_) => return Vec::new(),
    };

    let mut skills = Vec::new();
    for entry in entries.flatten() {
        let dir = entry.path();
        if !dir.is_dir() {
            continue;
        }
        let skill_md = match find_skill_md_case_insensitive(&dir) {
            Some(path) => path,
            None => {
                log::warn!(
                    "[openhands-agent-server] skipping AgentSkill dir without SKILL.md: {}",
                    dir.display()
                );
                continue;
            }
        };
        let raw = match std::fs::read_to_string(&skill_md) {
            Ok(content) => content,
            Err(e) => {
                log::warn!(
                    "[openhands-agent-server] failed to read SKILL.md at {}: {e}",
                    skill_md.display()
                );
                continue;
            }
        };
        let parsed = parse_skill_md(&raw);
        let folder_name = dir
            .file_name()
            .and_then(|name| name.to_str())
            .map(str::to_string);
        if parsed.name.is_none() {
            log::warn!(
                "[openhands-agent-server] AgentSkill at {} missing frontmatter name; falling back to folder name",
                skill_md.display()
            );
        }
        let Some(name) = parsed.name.or(folder_name) else {
            continue;
        };
        skills.push(OpenHandsSkill {
            name,
            content: parsed.body,
            is_agentskills_format: true,
            source: Some(skill_md.to_string_lossy().into_owned()),
            description: parsed.description,
            version: parsed.version,
            resources: Some(SkillResources {
                skill_root: dir.to_string_lossy().into_owned(),
                scripts: list_relative_files(&dir.join("scripts")),
                references: list_relative_files(&dir.join("references")),
                assets: list_relative_files(&dir.join("assets")),
            }),
        });
    }
    skills.sort_by(|a, b| a.name.cmp(&b.name));
    skills
}

fn find_skill_md_case_insensitive(dir: &Path) -> Option<PathBuf> {
    std::fs::read_dir(dir).ok()?.flatten().find_map(|entry| {
        let path = entry.path();
        let name = path.file_name()?.to_str()?;
        if name.eq_ignore_ascii_case("SKILL.md") || name.eq_ignore_ascii_case("skill.md") {
            Some(path)
        } else {
            None
        }
    })
}

fn list_relative_files(dir: &Path) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut files: Vec<String> = entries
        .flatten()
        .filter(|entry| entry.path().is_file())
        .filter_map(|entry| entry.file_name().to_str().map(str::to_string))
        .collect();
    files.sort();
    files
}

#[derive(Default)]
struct ParsedSkillMd {
    name: Option<String>,
    description: Option<String>,
    version: Option<String>,
    body: String,
}

/// Minimal SKILL.md frontmatter parser.
///
/// Only extracts the three fields we need (`name`, `description`, `version`)
/// from a `---`-delimited YAML block at the top of the file. The full body
/// (including frontmatter when no block is present) becomes `content` on the
/// emitted `OpenHandsSkill`. Tolerates CRLF and missing closing delimiter.
fn parse_skill_md(raw: &str) -> ParsedSkillMd {
    let normalized = raw.replace("\r\n", "\n");
    let mut parsed = ParsedSkillMd::default();

    let Some(rest) = normalized.strip_prefix("---\n") else {
        parsed.body = normalized;
        return parsed;
    };
    let close = rest.find("\n---\n");
    let (frontmatter, body) = match close {
        Some(idx) => (&rest[..idx], &rest[idx + "\n---\n".len()..]),
        None => (rest, ""),
    };
    parsed.body = body.to_string();

    for line in frontmatter.lines() {
        if let Some(value) = line.strip_prefix("name:") {
            parsed.name = clean_scalar(value);
        } else if let Some(value) = line.strip_prefix("description:") {
            parsed.description = clean_scalar(value);
        } else if let Some(value) = line.strip_prefix("version:") {
            parsed.version = clean_scalar(value);
        }
    }
    parsed
}

fn clean_scalar(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    let unquoted = if (trimmed.starts_with('"') && trimmed.ends_with('"'))
        || (trimmed.starts_with('\'') && trimmed.ends_with('\''))
    {
        &trimmed[1..trimmed.len().saturating_sub(1)]
    } else {
        trimmed
    };
    if unquoted.is_empty() {
        None
    } else {
        Some(unquoted.to_string())
    }
}

fn openhands_tools(_working_dir: &str, allowed_tools: &[String]) -> Vec<OpenHandsTool> {
    // Map runtime `allowed_tools` (a Claude-Code-era concept) onto the
    // OpenHands tool registry. Names match `register_tool` in the SDK's
    // openhands.tools.* packages: snake-cased class name minus `_tool`.
    //
    // Only tools the agent server actually registers at boot are listed here.
    // `tool_router.py` registers: default (terminal, file_editor, task_tracker,
    // browser_tool_set), planning (glob, grep, planning_file_editor), and the
    // transitive openhands.tools import that pulls in delegate, task, and
    // task_tool_set. `apply_patch` and `tom_consult` are *not* registered, so
    // sending them would raise KeyError from resolve_tool. `delegate` is
    // deprecated (replaced by task_tool_set).
    let normalized = |tool: &str| match tool {
        "terminal" | "bash" | "Bash" | "TerminalTool" => Some("terminal"),
        "file_editor" | "FileEditor" | "FileEditorTool" | "Edit" | "Read" | "Write" => {
            Some("file_editor")
        }
        "task_tracker" | "TaskTrackerTool" => Some("task_tracker"),
        "grep" | "Grep" | "GrepTool" => Some("grep"),
        "glob" | "Glob" | "GlobTool" => Some("glob"),
        "task_tool_set" | "TaskToolSet" => Some("task_tool_set"),
        "browser_tool_set" | "BrowserToolSet" | "browser" | "Browser" => Some("browser_tool_set"),
        "planning_file_editor" | "PlanningFileEditorTool" | "planning" => {
            Some("planning_file_editor")
        }
        _ => None,
    };
    let mut names: Vec<&str> = allowed_tools
        .iter()
        .filter_map(|tool| normalized(tool))
        .collect();
    if names.is_empty() {
        // Default workspace toolkit:
        //   terminal, file_editor, task_tracker — core "hands"
        //   grep, glob                          — read-only code search
        //   task_tool_set                       — sub-agent spawn (modern
        //                                          replacement for the
        //                                          deprecated DelegateTool)
        //
        // browser_tool_set and planning_file_editor are intentionally NOT in
        // the default. The browser tool was misfiring on local file:// paths
        // (the model tried to "navigate" to the workspace dir and the SDK's
        // SecurityWatchdog blocked it), and planning_file_editor is
        // PLAN.md-specific. Both stay opt-in via `allowed_tools` for surfaces
        // that genuinely need them.
        names = vec![
            "terminal",
            "file_editor",
            "task_tracker",
            "grep",
            "glob",
            "task_tool_set",
        ];
    } else if !names.contains(&"task_tool_set") {
        // Sub-agent delegation is part of the default OpenHands contract for
        // this app, even when a surface provides an explicit allowlist.
        names.push("task_tool_set");
    }
    names.sort_unstable();
    names.dedup();

    names
        .into_iter()
        .map(|name| OpenHandsTool {
            name: name.to_string(),
            params: serde_json::json!({}),
        })
        .collect()
}

#[cfg(test)]
mod skill_discovery_tests {
    use super::*;
    use std::fs;

    #[test]
    fn discovers_agentskills_from_dot_agents_skills_layout() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let workspace_skill_dir = tmp.path();
        let skills_root = workspace_skill_dir.join(".agents").join("skills");
        let skill_dir = skills_root.join("researching-skill-requirements");
        fs::create_dir_all(&skill_dir).unwrap();
        fs::write(
            skill_dir.join("SKILL.md"),
            "---\nname: researching-skill-requirements\n\
             description: Use when deciding what to research.\nversion: 1.2.0\n\
             user_invocable: false\n---\n\n# Researching Skill Requirements\nBody.\n",
        )
        .unwrap();
        let refs = skill_dir.join("references");
        fs::create_dir_all(&refs).unwrap();
        fs::write(refs.join("template.md"), "ref body").unwrap();

        // A second helper skill alongside it.
        let other = skills_root.join("creating-skills");
        fs::create_dir_all(&other).unwrap();
        fs::write(
            other.join("SKILL.md"),
            "---\nname: creating-skills\ndescription: Author skills.\n---\nBody\n",
        )
        .unwrap();

        // A directory without SKILL.md is ignored (no false positives).
        fs::create_dir_all(skills_root.join("shared")).unwrap();
        fs::write(skills_root.join("shared").join("schemas.md"), "not a skill").unwrap();

        let skills = discover_agentskills(workspace_skill_dir);

        let names: Vec<_> = skills.iter().map(|s| s.name.as_str()).collect();
        assert_eq!(
            names,
            vec!["creating-skills", "researching-skill-requirements"]
        );

        let researching = skills
            .iter()
            .find(|s| s.name == "researching-skill-requirements")
            .unwrap();
        assert!(researching.is_agentskills_format);
        assert_eq!(
            researching.description.as_deref(),
            Some("Use when deciding what to research.")
        );
        assert_eq!(researching.version.as_deref(), Some("1.2.0"));
        assert!(researching.content.contains("Body."));
        assert!(
            !researching.content.contains("---"),
            "frontmatter should be stripped"
        );
        let resources = researching.resources.as_ref().unwrap();
        assert_eq!(resources.references, vec!["template.md".to_string()]);
        assert!(resources.scripts.is_empty());
        assert!(resources.assets.is_empty());
    }

    #[test]
    fn missing_dot_agents_skills_dir_yields_empty_list() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let skills = discover_agentskills(tmp.path());
        assert!(skills.is_empty());
    }

    #[test]
    fn parse_skill_md_handles_crlf_and_quoted_scalars() {
        let raw = "---\r\nname: \"my-skill\"\r\ndescription: 'A skill'\r\n---\r\nBody\r\n";
        let parsed = parse_skill_md(raw);
        assert_eq!(parsed.name.as_deref(), Some("my-skill"));
        assert_eq!(parsed.description.as_deref(), Some("A skill"));
        assert!(parsed.body.contains("Body"));
    }

    #[test]
    fn missing_frontmatter_name_falls_back_to_folder_name() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let workspace_skill_dir = tmp.path();
        let skills_root = workspace_skill_dir.join(".agents").join("skills");
        let skill_dir = skills_root.join("fallback-name-skill");
        fs::create_dir_all(&skill_dir).unwrap();
        fs::write(
            skill_dir.join("SKILL.md"),
            "---\ndescription: Missing explicit name\n---\n\nBody\n",
        )
        .unwrap();

        let skills = discover_agentskills(workspace_skill_dir);

        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].name, "fallback-name-skill");
        assert_eq!(
            skills[0].description.as_deref(),
            Some("Missing explicit name")
        );
    }
}
