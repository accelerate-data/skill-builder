use std::collections::HashSet;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use crate::agents::sidecar::{self, SidecarConfig};
use crate::agents::sidecar_pool::SidecarPool;
use crate::db::Db;
use serde_json;
use crate::types::{
    PackageResult, StepConfig, StepStatusUpdate,
    WorkflowStateResponse,
};

const FULL_TOOLS: &[&str] = &["Read", "Write", "Edit", "Glob", "Grep", "Bash", "Task", "Skill"];

pub fn resolve_model_id(shorthand: &str) -> String {
    match shorthand {
        "sonnet" => "claude-sonnet-4-6".to_string(),
        "haiku"  => "claude-haiku-4-5".to_string(),
        "opus"   => "claude-opus-4-6".to_string(),
        other    => other.to_string(),
    }
}

fn get_step_config(step_id: u32) -> Result<StepConfig, String> {
    match step_id {
        0 => Ok(StepConfig {
            step_id: 0,
            name: "Research".to_string(),
            prompt_template: "research-orchestrator.md".to_string(),
            output_file: "context/clarifications.json".to_string(),
            allowed_tools: FULL_TOOLS.iter().map(|s| s.to_string()).collect(),
            max_turns: 50,
        }),
        1 => Ok(StepConfig {
            step_id: 1,
            name: "Detailed Research".to_string(),
            prompt_template: "detailed-research.md".to_string(),
            output_file: "context/clarifications.json".to_string(),
            allowed_tools: FULL_TOOLS.iter().map(|s| s.to_string()).collect(),
            max_turns: 50,
        }),
        2 => Ok(StepConfig {
            step_id: 2,
            name: "Confirm Decisions".to_string(),
            prompt_template: "confirm-decisions.md".to_string(),
            output_file: "context/decisions.md".to_string(),
            allowed_tools: FULL_TOOLS.iter().map(|s| s.to_string()).collect(),
            max_turns: 100,
        }),
        3 => Ok(StepConfig {
            step_id: 3,
            name: "Generate Skill".to_string(),
            prompt_template: "generate-skill.md".to_string(),
            output_file: "skill/SKILL.md".to_string(),
            allowed_tools: FULL_TOOLS.iter().map(|s| s.to_string()).collect(),
            max_turns: 120,
        }),
        _ => Err(format!(
            "Unknown step_id {}. Valid steps are 0-3.",
            step_id
        )),
    }
}

/// Session-scoped set of workspaces whose prompts have already been copied.
/// Prompts are bundled with the app and don't change during a session,
/// so we only need to copy once per workspace.
///
/// **Dev-mode caveat:** In development, prompts are read from the repo root.
/// Edits to `agents/` or `workspace/` while the app is running won't be
/// picked up until the app is restarted.
static COPIED_WORKSPACES: Mutex<Option<HashSet<String>>> = Mutex::new(None);

/// Public wrapper for `resolve_prompt_source_dirs` — used by `workspace.rs`
/// to pass the bundled CLAUDE.md path into `rebuild_claude_md`.
pub fn resolve_prompt_source_dirs_public(app_handle: &tauri::AppHandle) -> (PathBuf, PathBuf) {
    resolve_prompt_source_dirs(app_handle)
}

/// Resolve the path to the bundled skills directory.
/// Derived from the workspace source path (skills live alongside CLAUDE.md).
/// In dev mode: `{CARGO_MANIFEST_DIR}/../../agent-sources/workspace/skills/`.
/// In production: Tauri resource directory `workspace/skills/`.
pub fn resolve_bundled_skills_dir(app_handle: &tauri::AppHandle) -> PathBuf {
    use tauri::Manager;

    let repo_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|p| p.parent())
        .map(|p| p.to_path_buf());

    let dev_path = repo_root
        .as_ref()
        .map(|r| r.join("agent-sources").join("workspace").join("skills"));

    match dev_path {
        Some(ref p) if p.is_dir() => p.clone(),
        _ => app_handle
            .path()
            .resource_dir()
            .map(|r| r.join("workspace").join("skills"))
            .unwrap_or_default(),
    }
}

/// Deploy a single skill into the workspace `.claude/skills/` directory.
///
/// Resolution order:
/// 1. If `purpose` is non-empty and an active workspace skill with that purpose exists in DB:
///    use `workspace_skill.disk_path` (copy from there).
/// 2. Otherwise: copy from `bundled_skills_dir / skill_name`.
///
/// This is called before running workflow steps so that purpose-overridden skills
/// (research, validate, skill-building) replace their bundled counterparts.
fn deploy_skill_for_workflow(
    conn: &rusqlite::Connection,
    workspace_path: &str,
    bundled_skills_dir: &std::path::Path,
    skill_name: &str,
    purpose: &str,
) {
    let dest_skills_dir = std::path::Path::new(workspace_path)
        .join(".claude")
        .join("skills");

    // Try purpose-based resolution first
    let source_dir: std::path::PathBuf = match crate::db::get_workspace_skill_by_purpose(conn, purpose) {
        Ok(Some(ws)) => {
            log::debug!(
                "[deploy_skill_for_workflow] purpose='{}' → using workspace skill '{}' from {}",
                purpose, ws.skill_name, ws.disk_path
            );
            std::path::PathBuf::from(&ws.disk_path)
        }
        Ok(None) => {
            log::debug!(
                "[deploy_skill_for_workflow] purpose='{}' → no workspace skill found, using bundled '{}'",
                purpose, skill_name
            );
            bundled_skills_dir.join(skill_name)
        }
        Err(e) => {
            log::warn!(
                "[deploy_skill_for_workflow] DB error looking up purpose '{}': {}; falling back to bundled",
                purpose, e
            );
            bundled_skills_dir.join(skill_name)
        }
    };

    if !source_dir.is_dir() {
        log::debug!(
            "[deploy_skill_for_workflow] source dir not found for '{}' ({}), skipping",
            skill_name, source_dir.display()
        );
        return;
    }

    let dest = dest_skills_dir.join(skill_name);
    // Remove existing copy so we always get a fresh deployment
    if dest.exists() {
        let _ = std::fs::remove_dir_all(&dest);
    }
    if let Err(e) = std::fs::create_dir_all(&dest) {
        log::warn!("[deploy_skill_for_workflow] failed to create dest dir for '{}': {}", skill_name, e);
        return;
    }
    if let Err(e) = super::imported_skills::copy_dir_recursive(&source_dir, &dest) {
        log::warn!("[deploy_skill_for_workflow] failed to copy '{}': {}", skill_name, e);
    }
}

/// Resolve source paths for agents and workspace CLAUDE.md from the app handle.
/// Returns `(agents_dir, claude_md)` as owned PathBufs. Either may be empty
/// if not found (caller should check `.is_dir()` / `.is_file()` before using).
fn resolve_prompt_source_dirs(app_handle: &tauri::AppHandle) -> (PathBuf, PathBuf) {
    use tauri::Manager;

    let repo_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|p| p.parent())
        .map(|p| p.to_path_buf());

    let agents_src = repo_root.as_ref().map(|r| r.join("agents"));
    let claude_md_src = repo_root.as_ref().map(|r| r.join("agent-sources").join("workspace").join("CLAUDE.md"));

    let agents_dir = match agents_src {
        Some(ref p) if p.is_dir() => p.clone(),
        _ => {
            let resource = app_handle
                .path()
                .resource_dir()
                .map(|r| r.join("agents"))
                .unwrap_or_default();
            if resource.is_dir() {
                resource
            } else {
                PathBuf::new()
            }
        }
    };

    let claude_md = match claude_md_src {
        Some(ref p) if p.is_file() => p.clone(),
        _ => {
            let resource = app_handle
                .path()
                .resource_dir()
                .map(|r| r.join("workspace").join("CLAUDE.md"))
                .unwrap_or_default();
            if resource.is_file() {
                resource
            } else {
                PathBuf::new()
            }
        }
    };

    (agents_dir, claude_md)
}

/// Returns true if this workspace has already been initialized this session.
fn workspace_already_copied(workspace_path: &str) -> bool {
    let cache = COPIED_WORKSPACES.lock().unwrap_or_else(|e| e.into_inner());
    cache.as_ref().is_some_and(|set| set.contains(workspace_path))
}

/// Mark a workspace as initialized for this session.
fn mark_workspace_copied(workspace_path: &str) {
    let mut cache = COPIED_WORKSPACES.lock().unwrap_or_else(|e| e.into_inner());
    cache.get_or_insert_with(HashSet::new).insert(workspace_path.to_string());
}

/// Remove a workspace from the session cache so the next
/// `ensure_workspace_prompts*` call will re-deploy agents and CLAUDE.md.
/// Used by `clear_workspace` after deleting `.claude/`.
pub fn invalidate_workspace_cache(workspace_path: &str) {
    let mut cache = COPIED_WORKSPACES.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(set) = cache.as_mut() {
        set.remove(workspace_path);
    }
}

/// Copy bundled agent .md files and workspace CLAUDE.md into workspace.
/// Creates the directories if they don't exist. Overwrites existing files
/// to keep them in sync with the app version.
///
/// Copies once per workspace per session — prompts are bundled with the app
/// and don't change at runtime.
///
/// File I/O is offloaded to `spawn_blocking` to avoid blocking the tokio runtime.
///
/// Resolution order:
/// 1. Dev mode: repo root from `CARGO_MANIFEST_DIR` (compile-time path)
/// 2. Production: Tauri resource directory (bundled in the app)
pub async fn ensure_workspace_prompts(
    app_handle: &tauri::AppHandle,
    workspace_path: &str,
) -> Result<(), String> {
    if workspace_already_copied(workspace_path) {
        return Ok(());
    }

    // Extract paths from AppHandle before moving into the blocking closure
    // (AppHandle is !Send so it cannot cross the spawn_blocking boundary)
    let (agents_dir, claude_md) = resolve_prompt_source_dirs(app_handle);

    if !agents_dir.is_dir() && !claude_md.is_file() {
        return Ok(()); // No sources found anywhere — skip silently
    }

    let workspace = workspace_path.to_string();
    let agents = agents_dir.clone();
    let cmd = claude_md.clone();

    tokio::task::spawn_blocking(move || {
        copy_prompts_sync(&agents, &cmd, &workspace)
    })
    .await
    .map_err(|e| format!("Prompt copy task failed: {}", e))??;

    mark_workspace_copied(workspace_path);
    Ok(())
}

/// Synchronous inner copy logic shared by async and sync entry points.
/// Only copies agents — CLAUDE.md is rebuilt separately via `rebuild_claude_md`.
fn copy_prompts_sync(agents_dir: &Path, _claude_md: &Path, workspace_path: &str) -> Result<(), String> {
    if agents_dir.is_dir() {
        copy_agents_to_claude_dir(agents_dir, workspace_path)?;
    }
    Ok(())
}

/// Synchronous variant of `ensure_workspace_prompts` for callers that cannot be async
/// (e.g. `init_workspace` called from Tauri's synchronous `setup` hook).
/// Uses the same session-scoped cache to skip redundant copies.
pub fn ensure_workspace_prompts_sync(
    app_handle: &tauri::AppHandle,
    workspace_path: &str,
) -> Result<(), String> {
    if workspace_already_copied(workspace_path) {
        return Ok(());
    }

    let (agents_dir, claude_md) = resolve_prompt_source_dirs(app_handle);

    if !agents_dir.is_dir() && !claude_md.is_file() {
        return Ok(());
    }

    copy_prompts_sync(&agents_dir, &claude_md, workspace_path)?;
    mark_workspace_copied(workspace_path);
    Ok(())
}

/// Re-deploy only the bundled agents to `.claude/agents/`, preserving
/// other contents of the `.claude/` directory (skills, CLAUDE.md, etc.).
pub fn redeploy_agents(app_handle: &tauri::AppHandle, workspace_path: &str) -> Result<(), String> {
    let (agents_dir, _) = resolve_prompt_source_dirs(app_handle);
    if agents_dir.is_dir() {
        copy_agents_to_claude_dir(&agents_dir, workspace_path)?;
    }
    Ok(())
}

/// Extract the user's customization content from an existing CLAUDE.md.
/// Returns everything starting from `## Customization\n` (without leading newlines),
/// or empty string if the marker is not found.
fn extract_customization_section(content: &str) -> String {
    if let Some(pos) = content.find("\n## Customization\n") {
        // Skip the leading newline — caller adds consistent spacing
        content[pos + 1..].to_string()
    } else {
        String::new()
    }
}

/// Generate the "## Custom Skills" section from DB, or empty string if none.
/// All active workspace skills are treated identically regardless of is_bundled.
fn generate_skills_section(conn: &rusqlite::Connection) -> Result<String, String> {
    let skills = crate::db::list_active_workspace_skills(conn)?;
    if skills.is_empty() {
        return Ok(String::new());
    }

    let mut section = String::from("\n\n## Custom Skills\n");
    for skill in &skills {
        section.push_str(&format!("\n### /{}\n", skill.skill_name));
        if let Some(desc) = skill.description.as_deref().filter(|d| !d.is_empty()) {
            section.push_str(desc);
            section.push('\n');
        }
    }

    Ok(section)
}

const DEFAULT_CUSTOMIZATION_SECTION: &str =
    "## Customization\n\nAdd your workspace-specific instructions below. This section is preserved across app updates and skill changes.\n";

/// Merge base + skills + customization and write to workspace CLAUDE.md.
fn write_claude_md(
    base: &str,
    workspace_path: &str,
    conn: &rusqlite::Connection,
) -> Result<(), String> {
    let claude_md_path = Path::new(workspace_path).join(".claude").join("CLAUDE.md");

    let skills_section = generate_skills_section(conn)?;

    let customization = if claude_md_path.is_file() {
        let existing = std::fs::read_to_string(&claude_md_path)
            .map_err(|e| format!("Failed to read existing CLAUDE.md: {}", e))?;
        let section = extract_customization_section(&existing);
        if section.is_empty() {
            DEFAULT_CUSTOMIZATION_SECTION.to_string()
        } else {
            section
        }
    } else {
        DEFAULT_CUSTOMIZATION_SECTION.to_string()
    };

    let mut final_content = base.to_string();
    final_content.push_str(&skills_section);
    final_content.push_str("\n\n");
    final_content.push_str(&customization);

    let claude_dir = Path::new(workspace_path).join(".claude");
    std::fs::create_dir_all(&claude_dir)
        .map_err(|e| format!("Failed to create .claude dir: {}", e))?;
    std::fs::write(&claude_md_path, final_content)
        .map_err(|e| format!("Failed to write CLAUDE.md: {}", e))?;
    Ok(())
}

/// Rebuild workspace CLAUDE.md with a three-section merge:
///   1. Base (from bundled template — always overwritten)
///   2. Custom Skills (from DB — regenerated)
///   3. Customization (from existing file — preserved)
///
/// Used by `init_workspace` and `clear_workspace` which have access to
/// the bundled template path via AppHandle.
pub fn rebuild_claude_md(
    bundled_base_path: &Path,
    workspace_path: &str,
    conn: &rusqlite::Connection,
) -> Result<(), String> {
    let raw_base = std::fs::read_to_string(bundled_base_path)
        .map_err(|e| format!("Failed to read bundled CLAUDE.md: {}", e))?;
    let base = if let Some(pos) = raw_base.find("\n## Customization\n") {
        raw_base[..pos].trim_end().to_string()
    } else {
        raw_base.trim_end().to_string()
    };
    write_claude_md(&base, workspace_path, conn)
}

/// Update only the Custom Skills zone in an existing workspace CLAUDE.md,
/// preserving both the base section above and customization section below.
///
/// Used by skill mutation callers (import, activate, delete, trigger edit)
/// which don't have access to the bundled template path.
pub fn update_skills_section(
    workspace_path: &str,
    conn: &rusqlite::Connection,
) -> Result<(), String> {
    let claude_md_path = Path::new(workspace_path).join(".claude").join("CLAUDE.md");
    let content = if claude_md_path.is_file() {
        std::fs::read_to_string(&claude_md_path)
            .map_err(|e| format!("Failed to read CLAUDE.md: {}", e))?
    } else {
        return Err("CLAUDE.md does not exist; run init_workspace first".to_string());
    };

    let base_end = content
        .find("\n## Custom Skills\n")
        .or_else(|| content.find("\n## Skill Generation Guidance\n"))
        .or_else(|| content.find("\n## Imported Skills\n"))
        .or_else(|| content.find("\n## Customization\n"))
        .unwrap_or(content.len());
    let base = content[..base_end].trim_end().to_string();

    write_claude_md(&base, workspace_path, conn)
}

/// Copy agent .md files from flat agents/ directory to <workspace>/.claude/agents/.
/// agents/{name}.md → .claude/agents/{name}.md
fn copy_agents_to_claude_dir(agents_src: &Path, workspace_path: &str) -> Result<(), String> {
    let claude_agents_dir = Path::new(workspace_path).join(".claude").join("agents");
    std::fs::create_dir_all(&claude_agents_dir)
        .map_err(|e| format!("Failed to create .claude/agents dir: {}", e))?;

    let entries = std::fs::read_dir(agents_src)
        .map_err(|e| format!("Failed to read agents dir: {}", e))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("md") {
            let dest = claude_agents_dir.join(entry.file_name());
            std::fs::copy(&path, &dest)
                .map_err(|e| format!("Failed to copy {} to .claude/agents: {}", path.display(), e))?;
        }
    }
    Ok(())
}

// copy_directory_to and copy_md_files_recursive removed — no longer deploying
// agents tree to workspace root (only .claude/agents/ is used).

/// Read the `name:` field from an agent file's YAML frontmatter.
/// Agent files live at `{workspace}/.claude/agents/{phase}.md`.
/// Returns `None` if the file doesn't exist or has no `name:` field.
fn read_agent_frontmatter_name(workspace_path: &str, phase: &str) -> Option<String> {
    let agent_file = Path::new(workspace_path)
        .join(".claude")
        .join("agents")
        .join(format!("{}.md", phase));
    let content = std::fs::read_to_string(&agent_file).ok()?;
    if !content.starts_with("---") {
        return None;
    }
    let after_start = &content[3..];
    let end = after_start.find("---")?;
    let frontmatter = &after_start[..end];
    for line in frontmatter.lines() {
        let trimmed = line.trim();
        if let Some(name) = trimmed.strip_prefix("name:") {
            let name = name.trim();
            if !name.is_empty() {
                return Some(name.to_string());
            }
        }
    }
    None
}

/// Check if clarifications.json has `metadata.scope_recommendation == true`.
fn parse_scope_recommendation(clarifications_path: &Path) -> bool {
    let content = match std::fs::read_to_string(clarifications_path) {
        Ok(c) => c,
        Err(_) => return false,
    };
    let value: serde_json::Value = match serde_json::from_str(&content) {
        Ok(v) => v,
        Err(_) => return false,
    };
    value["metadata"]["scope_recommendation"] == true
}

/// Check decisions.md for guard conditions:
/// - decision_count: 0  → no decisions were derivable
/// - contradictory_inputs: true → unresolvable contradictions detected
///
/// `contradictory_inputs: revised` is NOT a block — the user has reviewed
/// and edited the flagged decisions; treat decisions.md as authoritative.
///
/// Returns true if steps 5-6 should be disabled.
fn parse_decisions_guard(decisions_path: &Path) -> bool {
    let content = match std::fs::read_to_string(decisions_path) {
        Ok(c) => c,
        Err(_) => return false,
    };
    if !content.starts_with("---") {
        return false;
    }
    let after_start = &content[3..];
    let end = match after_start.find("---") {
        Some(pos) => pos,
        None => return false,
    };
    let frontmatter = &after_start[..end];
    frontmatter
        .lines()
        .any(|line| line.trim() == "contradictory_inputs: true")
}

/// Derive agent name from prompt template.
/// Reads the deployed agent file's frontmatter `name:` field (the SDK uses
/// this to register the agent). Falls back to the phase name if the
/// file is missing or has no name field.
fn derive_agent_name(workspace_path: &str, _purpose: &str, prompt_template: &str) -> String {
    let phase = prompt_template.trim_end_matches(".md");
    if let Some(name) = read_agent_frontmatter_name(workspace_path, phase) {
        return name;
    }
    phase.to_string()
}

/// Write `user-context.md` to the context directory so that sub-agents
/// Format user context fields into a `## User Context` markdown block.
///
/// Shared by `write_user_context_file` (for file-based agents) and
/// `build_prompt` / refine's `send_refine_message` (for inline embedding).
/// Returns `None` when all fields are empty.
#[allow(clippy::too_many_arguments)]
pub fn format_user_context(
    name: Option<&str>,
    tags: &[String],
    industry: Option<&str>,
    function_role: Option<&str>,
    intake_json: Option<&str>,
    description: Option<&str>,
    purpose: Option<&str>,
    version: Option<&str>,
    skill_model: Option<&str>,
    argument_hint: Option<&str>,
    user_invocable: Option<bool>,
    disable_model_invocation: Option<bool>,
) -> Option<String> {
    /// Push `**label**: value` to `parts` when `opt` is non-empty.
    fn push_field(parts: &mut Vec<String>, label: &str, opt: Option<&str>) {
        if let Some(v) = opt.filter(|s| !s.is_empty()) {
            parts.push(format!("**{}**: {}", label, v));
        }
    }

    /// Build a markdown subsection from `parts`, or return None if empty.
    fn build_subsection(heading: &str, parts: Vec<String>) -> Option<String> {
        if parts.is_empty() {
            None
        } else {
            Some(format!("### {}\n{}", heading, parts.join("\n")))
        }
    }

    let mut sections: Vec<String> = Vec::new();

    // --- Skill identity ---
    let mut skill_parts: Vec<String> = Vec::new();
    push_field(&mut skill_parts, "Name", name);
    if let Some(p) = purpose.filter(|s| !s.is_empty()) {
        let label = match p {
            "domain" => "Business process knowledge",
            "source" => "Source system customizations",
            "data-engineering" => "Organization specific data engineering standards",
            "platform" => "Organization specific Azure or Fabric standards",
            other => other,
        };
        skill_parts.push(format!("**Purpose**: {}", label));
    }
    push_field(&mut skill_parts, "Description", description);
    if !tags.is_empty() {
        skill_parts.push(format!("**Tags**: {}", tags.join(", ")));
    }
    sections.extend(build_subsection("Skill", skill_parts));

    // --- User profile ---
    let mut profile_parts: Vec<String> = Vec::new();
    push_field(&mut profile_parts, "Industry", industry);
    push_field(&mut profile_parts, "Function", function_role);
    sections.extend(build_subsection("About You", profile_parts));

    // --- Intake: What Claude needs to know ---
    if let Some(ij) = intake_json {
        if let Ok(intake) = serde_json::from_str::<serde_json::Value>(ij) {
            // New unified field
            if let Some(v) = intake.get("context").and_then(|v| v.as_str()).filter(|v| !v.is_empty()) {
                sections.push(format!("### What Claude Needs to Know\n{}", v));
            }
            // Legacy fields (backwards compat for existing skills)
            for (key, label) in [
                ("unique_setup", "What Makes This Setup Unique"),
                ("claude_mistakes", "What Claude Gets Wrong"),
                ("scope", "Scope"),
                ("challenges", "Key Challenges"),
                ("audience", "Target Audience"),
            ] {
                if let Some(v) = intake.get(key).and_then(|v| v.as_str()).filter(|v| !v.is_empty()) {
                    sections.push(format!("### {}\n{}", label, v));
                }
            }
        }
    }

    // --- Configuration ---
    let mut config_parts: Vec<String> = Vec::new();
    push_field(&mut config_parts, "Version", version);
    if let Some(m) = skill_model.filter(|s| !s.is_empty() && *s != "inherit") {
        config_parts.push(format!("**Preferred Model**: {}", m));
    }
    push_field(&mut config_parts, "Argument Hint", argument_hint);
    if let Some(inv) = user_invocable {
        config_parts.push(format!("**User Invocable**: {}", inv));
    }
    if let Some(dmi) = disable_model_invocation {
        config_parts.push(format!("**Disable Model Invocation**: {}", dmi));
    }
    sections.extend(build_subsection("Configuration", config_parts));

    if sections.is_empty() {
        None
    } else {
        Some(format!("## User Context\n\n{}", sections.join("\n\n")))
    }
}

/// Write `user-context.md` to the workspace so sub-agents can read it from disk.
/// Captures purpose, description, user context, industry, function/role,
/// and behaviour settings provided by the user.
/// Non-fatal: logs a warning on failure rather than blocking the workflow.
#[allow(clippy::too_many_arguments)]
pub fn write_user_context_file(
    workspace_path: &str,
    skill_name: &str,
    tags: &[String],
    industry: Option<&str>,
    function_role: Option<&str>,
    intake_json: Option<&str>,
    description: Option<&str>,
    purpose: Option<&str>,
    version: Option<&str>,
    skill_model: Option<&str>,
    argument_hint: Option<&str>,
    user_invocable: Option<bool>,
    disable_model_invocation: Option<bool>,
) {
    let Some(ctx) = format_user_context(Some(skill_name), tags, industry, function_role, intake_json, description, purpose, version, skill_model, argument_hint, user_invocable, disable_model_invocation) else {
        return;
    };

    let workspace_dir = Path::new(workspace_path).join(skill_name);
    // Safety net: create directory if missing
    if let Err(e) = std::fs::create_dir_all(&workspace_dir) {
        log::warn!(
            "[write_user_context_file] Failed to create dir {}: {}",
            workspace_dir.display(),
            e
        );
        return;
    }
    let file_path = workspace_dir.join("user-context.md");
    let content = format!(
        "# User Context\n\n{}\n",
        ctx.strip_prefix("## User Context\n\n").unwrap_or(&ctx)
    );

    match std::fs::write(&file_path, &content) {
        Ok(()) => {
            log::info!(
                "[write_user_context_file] Wrote user-context.md ({} bytes) to {}",
                content.len(),
                file_path.display()
            );
        }
        Err(e) => {
            log::warn!(
                "[write_user_context_file] Failed to write {}: {}",
                file_path.display(),
                e
            );
        }
    }
}

fn build_prompt(
    skill_name: &str,
    workspace_path: &str,
    skills_path: &str,
    author_login: Option<&str>,
    created_at: Option<&str>,
    max_dimensions: u32,
) -> String {
    let workspace_dir = Path::new(workspace_path).join(skill_name);
    let context_dir = Path::new(skills_path).join(skill_name).join("context");
    let skill_output_dir = Path::new(skills_path).join(skill_name);
    let mut prompt = format!(
        "The skill name is: {}. \
         The workspace directory is: {}. \
         The context directory is: {}. \
         The skill output directory (SKILL.md and references/) is: {}. \
         All directories already exist — never create directories with mkdir or any other method. Never list directories with ls. Read only the specific files named in your instructions and write files directly.",
        skill_name,
        workspace_dir.display(),
        context_dir.display(),
        skill_output_dir.display(),
    );

    if let Some(author) = author_login {
        prompt.push_str(&format!(" The author of this skill is: {}.", author));
        if let Some(created) = created_at {
            let created_date = &created[..10.min(created.len())];
            let today = chrono::Utc::now().format("%Y-%m-%d").to_string();
            prompt.push_str(&format!(
                " The skill was created on: {}. Today's date (for the modified timestamp) is: {}.",
                created_date, today
            ));
        }
    }

    prompt.push_str(&format!(" The maximum research dimensions before scope warning is: {}.", max_dimensions));

    prompt.push_str(" Read user-context.md from the workspace directory for purpose, description, and all user context. The workspace directory only contains user-context.md — ignore everything else (logs/, etc.).");

    prompt
}

fn read_skills_path(db: &tauri::State<'_, Db>) -> Option<String> {
    let conn = db.0.lock().ok()?;
    crate::db::read_settings(&conn).ok()?.skills_path
}

fn thinking_budget_for_step(step_id: u32) -> Option<u32> {
    match step_id {
        0 => Some(8_000),   // research
        1 => Some(8_000),   // detailed-research
        2 => Some(32_000),  // confirm-decisions — highest priority
        3 => Some(16_000),  // generate-skill — complex synthesis
        _ => None,
    }
}

pub fn build_betas(thinking_budget: Option<u32>, model: &str) -> Option<Vec<String>> {
    let mut betas = Vec::new();
    if thinking_budget.is_some() && !model.contains("opus") {
        betas.push("interleaved-thinking-2025-05-14".to_string());
    }
    if betas.is_empty() { None } else { Some(betas) }
}

/// Generate a unique agent ID from skill name, label, and timestamp.
fn make_agent_id(skill_name: &str, label: &str) -> String {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!("{}-{}-{}", skill_name, label, ts)
}

/// Core logic for validating decisions.md existence — testable without tauri::State.
/// Checks in order: skill output dir (skillsPath), workspace dir.
/// Returns Ok(()) if found, Err with a clear message if missing.
fn validate_decisions_exist_inner(
    skill_name: &str,
    _workspace_path: &str,
    skills_path: &str,
) -> Result<(), String> {
    // skills_path is required — no workspace fallback
    let path = Path::new(skills_path).join(skill_name).join("context").join("decisions.md");
    if path.exists() {
        let content = std::fs::read_to_string(&path).unwrap_or_default();
        if !content.trim().is_empty() {
            return Ok(());
        }
    }

    Err(
        "Cannot start Generate Skill step: decisions.md was not found on the filesystem. \
         The Confirm Decisions step (step 2) must create a decisions file before the Generate Skill step can run. \
         Please re-run the Confirm Decisions step first."
            .to_string(),
    )
}

/// Shared settings extracted from the DB, used by `run_workflow_step`.
struct WorkflowSettings {
    skills_path: String,
    api_key: String,
    preferred_model: String,
    extended_thinking: bool,
    purpose: String,
    tags: Vec<String>,
    author_login: Option<String>,
    created_at: Option<String>,
    max_dimensions: u32,
    industry: Option<String>,
    function_role: Option<String>,
    intake_json: Option<String>,
    description: Option<String>,
    version: Option<String>,
    skill_model: Option<String>,
    argument_hint: Option<String>,
    user_invocable: Option<bool>,
    disable_model_invocation: Option<bool>,
}

/// Read all workflow settings from the DB in a single lock acquisition.
fn read_workflow_settings(
    db: &Db,
    skill_name: &str,
    step_id: u32,
    workspace_path: &str,
) -> Result<WorkflowSettings, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    // Read all settings in one pass
    let settings = crate::db::read_settings_hydrated(&conn)?;
    let skills_path = settings.skills_path
        .ok_or_else(|| "Skills path not configured. Please set it in Settings before running workflow steps.".to_string())?;
    let api_key = settings.anthropic_api_key
        .ok_or_else(|| "Anthropic API key not configured".to_string())?;
    let preferred_model = resolve_model_id(
        settings.preferred_model.as_deref().unwrap_or("sonnet")
    );
    let extended_thinking = settings.extended_thinking;
    let max_dimensions = settings.max_dimensions;
    let industry = settings.industry;
    let function_role = settings.function_role;

    // Validate prerequisites (step 3 requires decisions.md)
    if step_id == 3 {
        validate_decisions_exist_inner(skill_name, workspace_path, &skills_path)?;
    }

    // Get skill purpose
    let purpose = crate::db::get_purpose(&conn, skill_name)?;

    // Read author info and intake data from workflow run
    let run_row = crate::db::get_workflow_run(&conn, skill_name)
        .ok()
        .flatten();
    let author_login = run_row.as_ref().and_then(|r| r.author_login.clone());
    let created_at = run_row.as_ref().map(|r| r.created_at.clone());
    let intake_json = run_row.as_ref().and_then(|r| r.intake_json.clone());
    let description = run_row.as_ref().and_then(|r| r.description.clone());
    let version = run_row.as_ref().and_then(|r| r.version.clone());
    let skill_model = run_row.as_ref().and_then(|r| r.model.clone());
    let argument_hint = run_row.as_ref().and_then(|r| r.argument_hint.clone());
    let user_invocable = run_row.as_ref().and_then(|r| r.user_invocable);
    let disable_model_invocation = run_row.as_ref().and_then(|r| r.disable_model_invocation);
    let tags = crate::db::get_tags_for_skills(&conn, &[skill_name.to_string()])
        .unwrap_or_default()
        .remove(skill_name)
        .unwrap_or_default();

    Ok(WorkflowSettings {
        skills_path,
        api_key,
        preferred_model,
        extended_thinking,
        purpose,
        tags,
        author_login,
        created_at,
        max_dimensions,
        industry,
        function_role,
        intake_json,
        description,
        version,
        skill_model,
        argument_hint,
        user_invocable,
        disable_model_invocation,
    })
}

/// Core logic for launching a single workflow step. Builds the prompt,
/// constructs the sidecar config, and spawns the agent. Returns the agent_id.
///
/// Used by `run_workflow_step` to avoid duplicating step logic.
async fn run_workflow_step_inner(
    app: &tauri::AppHandle,
    pool: &SidecarPool,
    skill_name: &str,
    step_id: u32,
    workspace_path: &str,
    settings: &WorkflowSettings,
) -> Result<String, String> {
    let step = get_step_config(step_id)?;
    let thinking_budget = if settings.extended_thinking {
        thinking_budget_for_step(step_id)
    } else {
        None
    };
    // Write user-context.md to workspace directory so sub-agents can read it.
    // Refreshed before every step to pick up mid-workflow settings edits.
    write_user_context_file(
        workspace_path,
        skill_name,
        &settings.tags,
        settings.industry.as_deref(),
        settings.function_role.as_deref(),
        settings.intake_json.as_deref(),
        settings.description.as_deref(),
        Some(settings.purpose.as_str()),
        settings.version.as_deref(),
        settings.skill_model.as_deref(),
        settings.argument_hint.as_deref(),
        settings.user_invocable,
        settings.disable_model_invocation,
    );

    let prompt = build_prompt(
        skill_name,
        workspace_path,
        &settings.skills_path,
        settings.author_login.as_deref(),
        settings.created_at.as_deref(),
        settings.max_dimensions,
    );
    log::debug!("[run_workflow_step] prompt for step {}: {}", step_id, prompt);

    let agent_name = derive_agent_name(workspace_path, &settings.purpose, &step.prompt_template);
    let agent_id = make_agent_id(skill_name, &format!("step{}", step_id));
    log::info!("run_workflow_step: skill={} step={} model={}", skill_name, step_id, settings.preferred_model);

    let config = SidecarConfig {
        prompt,
        model: Some(settings.preferred_model.clone()),
        api_key: settings.api_key.clone(),
        cwd: workspace_path.to_string(),
        allowed_tools: Some(step.allowed_tools),
        max_turns: Some(step.max_turns),
        permission_mode: Some("bypassPermissions".to_string()),
        session_id: None,
        betas: build_betas(thinking_budget, &settings.preferred_model),
        max_thinking_tokens: thinking_budget,
        path_to_claude_code_executable: None,
        agent_name: Some(agent_name),
        conversation_history: None,
    };

    sidecar::spawn_sidecar(
        agent_id.clone(),
        config,
        pool.clone(),
        app.clone(),
        skill_name.to_string(),
        None,
    )
    .await?;

    Ok(agent_id)
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn run_workflow_step(
    app: tauri::AppHandle,
    pool: tauri::State<'_, SidecarPool>,
    db: tauri::State<'_, Db>,
    skill_name: String,
    step_id: u32,
    workspace_path: String,
) -> Result<String, String> {
    log::info!("[run_workflow_step] skill={} step={}", skill_name, step_id);
    // Ensure prompt files exist in workspace before running
    ensure_workspace_prompts(&app, &workspace_path).await?;

    // Deploy purpose-resolved skills for research, validate, and skill-building.
    // This overwrites the bundled copies if a workspace skill with a matching purpose is active.
    {
        let bundled_skills_dir = resolve_bundled_skills_dir(&app);
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        deploy_skill_for_workflow(&conn, &workspace_path, &bundled_skills_dir, "research", "research");
        deploy_skill_for_workflow(&conn, &workspace_path, &bundled_skills_dir, "validate-skill", "validate");
        deploy_skill_for_workflow(&conn, &workspace_path, &bundled_skills_dir, "skill-builder-practices", "skill-building");
    }

    let settings = read_workflow_settings(&db, &skill_name, step_id, &workspace_path)?;
    log::info!(
        "[run_workflow_step] settings: skills_path={} purpose={} intake={} industry={:?} function={:?}",
        settings.skills_path, settings.purpose,
        settings.intake_json.is_some(),
        settings.industry, settings.function_role,
    );

    // Gate: reject disabled steps when guard conditions are active
    let context_dir = Path::new(&settings.skills_path)
        .join(&skill_name)
        .join("context");

    if step_id >= 1 {
        let clarifications_path = context_dir.join("clarifications.json");
        if parse_scope_recommendation(&clarifications_path) {
            return Err(format!(
                "Step {} is disabled: the research phase determined the skill scope is too broad. \
                 Review the scope recommendations in clarifications.json, then reset to step 0 \
                 and start with a narrower focus.",
                step_id
            ));
        }
    }

    if step_id >= 3 {
        let decisions_path = context_dir.join("decisions.md");
        if parse_decisions_guard(&decisions_path) {
            return Err(format!(
                "Step {} is disabled: the reasoning agent found unresolvable \
                 contradictions in decisions.md. Reset to step 2 and revise \
                 your answers before retrying.",
                step_id
            ));
        }
    }

    // Step 0 fresh start — wipe the context directory and all artifacts so
    // the agent doesn't see stale files from a previous workflow run.
    // Context lives in skills_path (not workspace_path).
    if step_id == 0 && context_dir.is_dir() {
        log::debug!("[run_workflow_step] step 0: wiping context dir {}", context_dir.display());
        let _ = std::fs::remove_dir_all(&context_dir);
        let _ = std::fs::create_dir_all(&context_dir);
    }

    run_workflow_step_inner(
        &app,
        pool.inner(),
        &skill_name,
        step_id,
        &workspace_path,
        &settings,
    )
    .await
}

#[tauri::command]
pub async fn package_skill(
    skill_name: String,
    _workspace_path: String,
    db: tauri::State<'_, Db>,
) -> Result<PackageResult, String> {
    log::info!("[package_skill] skill={}", skill_name);
    let skills_path = read_skills_path(&db)
        .ok_or_else(|| "Skills path not configured. Please set it in Settings.".to_string())?;

    // skills_path is required — no workspace fallback
    let source_dir = Path::new(&skills_path).join(&skill_name);

    if !source_dir.exists() {
        log::error!("package_skill: skill directory not found: {}", source_dir.display());
        return Err(format!(
            "Skill directory not found: {}",
            source_dir.display()
        ));
    }

    let output_path = source_dir.join(format!("{}.skill", skill_name));

    let result = tokio::task::spawn_blocking(move || {
        create_skill_zip(&source_dir, &output_path)
    })
    .await
    .map_err(|e| {
        let msg = format!("Packaging task failed: {}", e);
        log::error!("package_skill: {}", msg);
        msg
    })??;

    Ok(result)
}

/// Recursively copy a directory and all its contents.
#[allow(dead_code)]
fn copy_directory_recursive(src: &Path, dest: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dest)
        .map_err(|e| format!("Failed to create dir {}: {}", dest.display(), e))?;

    let entries = std::fs::read_dir(src)
        .map_err(|e| format!("Failed to read dir {}: {}", src.display(), e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read dir entry: {}", e))?;
        let src_path = entry.path();
        let dest_path = dest.join(entry.file_name());

        if src_path.is_dir() {
            copy_directory_recursive(&src_path, &dest_path)?;
        } else {
            std::fs::copy(&src_path, &dest_path)
                .map_err(|e| format!("Failed to copy {}: {}", src_path.display(), e))?;
        }
    }

    Ok(())
}

fn create_skill_zip(
    source_dir: &Path,
    output_path: &Path,
) -> Result<PackageResult, String> {
    let file = std::fs::File::create(output_path)
        .map_err(|e| format!("Failed to create zip file: {}", e))?;
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    // SKILL.md and references/ are directly in source_dir
    let skill_md = source_dir.join("SKILL.md");
    if skill_md.exists() {
        add_file_to_zip(&mut zip, &skill_md, "SKILL.md", options)?;
    }

    let references_dir = source_dir.join("references");
    if references_dir.exists() && references_dir.is_dir() {
        add_dir_to_zip(&mut zip, &references_dir, "references", options)?;
    }

    zip.finish()
        .map_err(|e| format!("Failed to finalize zip: {}", e))?;

    let metadata = std::fs::metadata(output_path)
        .map_err(|e| format!("Failed to read zip metadata: {}", e))?;

    Ok(PackageResult {
        file_path: output_path.to_string_lossy().to_string(),
        size_bytes: metadata.len(),
    })
}

fn add_file_to_zip(
    zip: &mut zip::ZipWriter<std::fs::File>,
    file_path: &Path,
    archive_name: &str,
    options: zip::write::SimpleFileOptions,
) -> Result<(), String> {
    let mut f = std::fs::File::open(file_path)
        .map_err(|e| format!("Failed to open {}: {}", file_path.display(), e))?;
    let mut buffer = Vec::new();
    f.read_to_end(&mut buffer)
        .map_err(|e| format!("Failed to read {}: {}", file_path.display(), e))?;
    zip.start_file(archive_name, options)
        .map_err(|e| format!("Failed to add {} to zip: {}", archive_name, e))?;
    zip.write_all(&buffer)
        .map_err(|e| format!("Failed to write {} to zip: {}", archive_name, e))?;
    Ok(())
}

fn add_dir_to_zip(
    zip: &mut zip::ZipWriter<std::fs::File>,
    dir: &Path,
    prefix: &str,
    options: zip::write::SimpleFileOptions,
) -> Result<(), String> {
    let entries = std::fs::read_dir(dir)
        .map_err(|e| format!("Failed to read directory {}: {}", dir.display(), e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read dir entry: {}", e))?;
        let path = entry.path();
        let name = format!(
            "{}/{}",
            prefix,
            entry.file_name().to_string_lossy()
        );

        if path.is_dir() {
            add_dir_to_zip(zip, &path, &name, options)?;
        } else {
            add_file_to_zip(zip, &path, &name, options)?;
        }
    }

    Ok(())
}

// --- Workflow state persistence (SQLite-backed) ---

#[tauri::command]
pub fn get_workflow_state(
    skill_name: String,
    db: tauri::State<'_, Db>,
) -> Result<WorkflowStateResponse, String> {
    log::info!("[get_workflow_state] skill={}", skill_name);
    let conn = db.0.lock().map_err(|e| {
        log::error!("[get_workflow_state] Failed to acquire DB lock: {}", e);
        e.to_string()
    })?;
    let run = crate::db::get_workflow_run(&conn, &skill_name)?;
    let steps = crate::db::get_workflow_steps(&conn, &skill_name)?;
    Ok(WorkflowStateResponse { run, steps })
}

#[tauri::command]
pub fn save_workflow_state(
    skill_name: String,
    current_step: i32,
    status: String,
    purpose: String,
    step_statuses: Vec<StepStatusUpdate>,
    db: tauri::State<'_, Db>,
) -> Result<(), String> {
    log::info!("[save_workflow_state] skill={} step={} status={}", skill_name, current_step, status);
    let conn = db.0.lock().map_err(|e| {
        log::error!("[save_workflow_state] Failed to acquire DB lock: {}", e);
        e.to_string()
    })?;

    // Backend-authoritative status: if all submitted steps are completed,
    // override the run status to "completed" regardless of what the frontend sent.
    // This prevents a race where the debounced frontend save fires before the
    // final step status is computed.
    let effective_status = if !step_statuses.is_empty()
        && step_statuses.iter().all(|s| s.status == "completed")
    {
        if status != "completed" {
            log::info!(
                "[save_workflow_state] All {} steps completed for '{}', overriding status '{}' → 'completed'",
                step_statuses.len(),
                skill_name,
                status
            );
        }
        "completed".to_string()
    } else {
        status
    };

    crate::db::save_workflow_run(&conn, &skill_name, current_step, &effective_status, &purpose)?;
    for step in &step_statuses {
        crate::db::save_workflow_step(&conn, &skill_name, step.step_id, &step.status)?;
    }

    // Auto-commit when a step is completed.
    // Called on every debounced save (~300ms) but commit_all is a no-op when
    // nothing changed on disk, so redundant calls are cheap.
    let has_completed_step = step_statuses.iter().any(|s| s.status == "completed");
    if has_completed_step {
        log::info!("[save_workflow_state] Step completed for '{}', checking git auto-commit", skill_name);
        match crate::db::read_settings(&conn) {
            Ok(settings) => {
                let skills_path = settings.skills_path
                    .ok_or_else(|| "Skills path not configured".to_string())?;
                let completed_steps: Vec<i32> = step_statuses
                    .iter()
                    .filter(|s| s.status == "completed")
                    .map(|s| s.step_id)
                    .collect();
                let msg = format!(
                    "{}: step {} completed",
                    skill_name,
                    completed_steps
                        .iter()
                        .map(|id| id.to_string())
                        .collect::<Vec<_>>()
                        .join(", ")
                );
                if let Err(e) = crate::git::commit_all(std::path::Path::new(&skills_path), &msg) {
                    log::warn!("Git auto-commit failed ({}): {}", msg, e);
                }
            }
            Err(e) => {
                log::warn!("[save_workflow_state] Failed to read settings — skipping git auto-commit: {}", e);
            }
        }
    }

    Ok(())
}

/// Output files produced by each step, relative to the skill directory.
pub fn get_step_output_files(step_id: u32) -> Vec<&'static str> {
    match step_id {
        0 => vec![
            "context/research-plan.md",
            "context/clarifications.json",
        ],
        1 => vec![],  // Step 1 edits clarifications.json in-place (no unique artifact)
        2 => vec!["context/decisions.md"],
        3 => vec!["SKILL.md"], // Also has references/ dir; path is relative to skill output dir
        _ => vec![],
    }
}

/// Check if at least one expected output file exists for a completed step.
/// Returns `true` if the step produced output, `false` if no files were written.
/// Step 1 (Detailed Research) always returns `true` because it edits
/// clarifications.json in-place and has no unique output file to check.
#[tauri::command]
pub fn verify_step_output(
    _workspace_path: String,
    skill_name: String,
    step_id: u32,
    db: tauri::State<'_, Db>,
) -> Result<bool, String> {
    log::info!("[verify_step_output] skill={} step={}", skill_name, step_id);
    let files = get_step_output_files(step_id);
    // Steps with no expected output files are always valid
    if files.is_empty() {
        return Ok(true);
    }

    let skills_path = read_skills_path(&db)
        .ok_or_else(|| "Skills path not configured. Please set it in Settings.".to_string())?;

    // skills_path is required — single code path, no workspace fallback
    let target_dir = Path::new(&skills_path).join(&skill_name);
    let has_output = if step_id == 3 {
        target_dir.join("SKILL.md").exists()
    } else {
        files.iter().any(|f| target_dir.join(f).exists())
    };

    Ok(has_output)
}

#[tauri::command]
pub fn get_disabled_steps(
    skill_name: String,
    db: tauri::State<'_, Db>,
) -> Result<Vec<u32>, String> {
    log::info!("[get_disabled_steps] skill={}", skill_name);
    let skills_path = read_skills_path(&db)
        .ok_or_else(|| "Skills path not configured".to_string())?;
    let context_dir = Path::new(&skills_path)
        .join(&skill_name)
        .join("context");
    let clarifications_path = context_dir.join("clarifications.json");
    let decisions_path = context_dir.join("decisions.md");

    if parse_scope_recommendation(&clarifications_path) {
        Ok(vec![1, 2, 3])
    } else if parse_decisions_guard(&decisions_path) {
        Ok(vec![3])
    } else {
        Ok(vec![])
    }
}

/// Run the answer-evaluator agent (Haiku) to assess clarification answer quality.
/// Returns the agent ID for the frontend to subscribe to completion events.
#[tauri::command]
pub async fn run_answer_evaluator(
    app: tauri::AppHandle,
    pool: tauri::State<'_, SidecarPool>,
    db: tauri::State<'_, Db>,
    skill_name: String,
    workspace_path: String,
) -> Result<String, String> {
    log::info!("run_answer_evaluator: skill={}", skill_name);

    // Ensure agent files are deployed to workspace
    ensure_workspace_prompts(&app, &workspace_path).await?;

    // Read settings from DB — same pattern as read_workflow_settings but without
    // step-specific validation (this is a gate, not a workflow step).
    let (api_key, skills_path, industry, function_role, intake_json, preferred_model) = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let settings = crate::db::read_settings_hydrated(&conn).map_err(|e| {
            log::error!("run_answer_evaluator: failed to read settings: {}", e);
            e.to_string()
        })?;
        let key = settings.anthropic_api_key.ok_or_else(|| {
            log::error!("run_answer_evaluator: API key not configured");
            "Anthropic API key not configured".to_string()
        })?;
        let sp = settings.skills_path.ok_or_else(|| {
            log::error!("run_answer_evaluator: skills_path not configured");
            "Skills path not configured".to_string()
        })?;
        let run_row = crate::db::get_workflow_run(&conn, &skill_name)
            .ok()
            .flatten();
        let ij = run_row.as_ref().and_then(|r| r.intake_json.clone());
        // Answer evaluator is a lightweight gate — always use Haiku for cost efficiency.
        let model = resolve_model_id("haiku");
        (key, sp, settings.industry, settings.function_role, ij, model)
    };

    // Write user-context.md so the agent can read it (same as workflow steps)
    write_user_context_file(
        &workspace_path,
        &skill_name,
        &[], // answer evaluator doesn't need full metadata
        industry.as_deref(),
        function_role.as_deref(),
        intake_json.as_deref(),
        None, None, None, None, None, None, None,
    );

    let context_dir = std::path::Path::new(&skills_path)
        .join(&skill_name)
        .join("context");
    let workspace_dir = std::path::Path::new(&workspace_path).join(&skill_name);

    // Point agent at workspace and context dirs; user-context.md is already written.
    let prompt = format!(
        "The workspace directory is: {workspace}. \
         The context directory is: {context}. \
         All directories already exist — do not create any directories. \
         Read {workspace}/user-context.md for purpose, description, and all user context. Use it to evaluate answers in the user's specific domain.",
        workspace = workspace_dir.display(),
        context = context_dir.display(),
    );

    log::debug!("run_answer_evaluator: prompt={}", prompt);
    log::info!("run_answer_evaluator: skill={} model={}", skill_name, preferred_model);

    let agent_id = make_agent_id(&skill_name, "gate-eval");

    let config = SidecarConfig {
        prompt,
        model: Some(preferred_model),
        api_key,
        cwd: workspace_path.clone(),
        allowed_tools: Some(vec!["Read".to_string(), "Write".to_string()]),
        max_turns: Some(20),
        permission_mode: Some("bypassPermissions".to_string()),
        session_id: None,
        betas: None,
        max_thinking_tokens: None,
        path_to_claude_code_executable: None,
        agent_name: Some("answer-evaluator".to_string()),
        conversation_history: None,
    };

    sidecar::spawn_sidecar(
        agent_id.clone(),
        config,
        pool.inner().clone(),
        app.clone(),
        skill_name,
        None,
    )
    .await?;

    Ok(agent_id)
}

/// Auto-fill empty top-level question answers in clarifications.json.
/// For each question with no answer_choice and no answer_text, picks the
/// first non-other choice. Returns the number of fields auto-filled.
#[tauri::command]
pub fn autofill_clarifications(
    skill_name: String,
    db: tauri::State<'_, Db>,
) -> Result<u32, String> {
    log::info!("autofill_clarifications: skill={}", skill_name);

    let skills_path = read_skills_path(&db)
        .ok_or_else(|| "Skills path not configured".to_string())?;

    let clarifications_path = Path::new(&skills_path)
        .join(&skill_name)
        .join("context")
        .join("clarifications.json");

    let content = std::fs::read_to_string(&clarifications_path).map_err(|e| {
        log::error!(
            "autofill_clarifications: failed to read {}: {}",
            clarifications_path.display(),
            e
        );
        format!("Failed to read clarifications.json: {}", e)
    })?;

    let (updated, count) = autofill_answers(&content);

    if count > 0 {
        std::fs::write(&clarifications_path, &updated).map_err(|e| {
            log::error!(
                "autofill_clarifications: failed to write {}: {}",
                clarifications_path.display(),
                e
            );
            format!("Failed to write clarifications.json: {}", e)
        })?;
        log::info!(
            "autofill_clarifications: auto-filled {} answers in {}",
            count,
            clarifications_path.display()
        );
    } else {
        log::info!("autofill_clarifications: no empty answers found");
    }

    Ok(count)
}

/// Log the user's gate decision so it appears in the backend log stream.
#[tauri::command]
pub fn log_gate_decision(skill_name: String, verdict: String, decision: String) {
    log::info!(
        "gate_decision: skill={} verdict={} decision={}",
        skill_name,
        verdict,
        decision
    );
}

/// Auto-fill empty refinement answers in clarifications.json.
/// Top-level Q-level answers are left untouched. Returns the number of fields auto-filled.
#[tauri::command]
pub fn autofill_refinements(
    skill_name: String,
    db: tauri::State<'_, Db>,
) -> Result<u32, String> {
    log::info!("autofill_refinements: skill={}", skill_name);

    let skills_path = read_skills_path(&db)
        .ok_or_else(|| "Skills path not configured".to_string())?;

    let clarifications_path = Path::new(&skills_path)
        .join(&skill_name)
        .join("context")
        .join("clarifications.json");

    let content = std::fs::read_to_string(&clarifications_path).map_err(|e| {
        log::error!(
            "autofill_refinements: failed to read {}: {}",
            clarifications_path.display(),
            e
        );
        format!("Failed to read clarifications.json: {}", e)
    })?;

    let (updated, count) = autofill_refinement_answers(&content);

    if count > 0 {
        std::fs::write(&clarifications_path, &updated).map_err(|e| {
            log::error!(
                "autofill_refinements: failed to write {}: {}",
                clarifications_path.display(),
                e
            );
            format!("Failed to write clarifications.json: {}", e)
        })?;
        log::info!(
            "autofill_refinements: auto-filled {} refinement answers in {}",
            count,
            clarifications_path.display()
        );
    } else {
        log::info!("autofill_refinements: no empty refinement answers found");
    }

    Ok(count)
}

/// Parse clarifications.json and auto-fill empty refinement answers.
/// For each refinement where answer_choice is null AND answer_text is null/empty,
/// sets answer_choice to the first non-other choice's id and answer_text to its text.
/// Top-level question answers are left untouched. Returns (updated_json_string, count_filled).
fn autofill_refinement_answers(content: &str) -> (String, u32) {
    let mut value: serde_json::Value = match serde_json::from_str(content) {
        Ok(v) => v,
        Err(_) => return (content.to_string(), 0),
    };
    let mut count: u32 = 0;

    if let Some(sections) = value.get_mut("sections").and_then(|s| s.as_array_mut()) {
        for section in sections.iter_mut() {
            if let Some(questions) = section.get_mut("questions").and_then(|q| q.as_array_mut()) {
                for question in questions.iter_mut() {
                    if let Some(refinements) = question.get_mut("refinements").and_then(|r| r.as_array_mut()) {
                        for refinement in refinements.iter_mut() {
                            let answer_choice_empty = refinement.get("answer_choice").is_none_or(|v| v.is_null());
                            let answer_text_empty = refinement.get("answer_text").is_none_or(|v| {
                                v.is_null() || v.as_str().is_some_and(|s| s.is_empty())
                            });

                            if answer_choice_empty && answer_text_empty {
                                if let Some(choices) = refinement.get("choices").and_then(|c| c.as_array()) {
                                    if let Some(first_non_other) = choices.iter().find(|c| {
                                        c.get("is_other").and_then(|v| v.as_bool()) != Some(true)
                                    }) {
                                        if let (Some(id), Some(text)) = (
                                            first_non_other.get("id").cloned(),
                                            first_non_other.get("text").cloned(),
                                        ) {
                                            refinement["answer_choice"] = id;
                                            refinement["answer_text"] = text;
                                            count += 1;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    let updated = serde_json::to_string_pretty(&value).unwrap_or_else(|_| content.to_string());
    (updated, count)
}

/// Parse clarifications.json and auto-fill empty top-level question answers.
/// For each question where answer_choice is null AND answer_text is null/empty,
/// sets answer_choice to the first non-other choice's id and answer_text to its text.
/// Does NOT touch refinements (that's autofill_refinement_answers).
/// Returns (updated_json_string, count_filled).
fn autofill_answers(content: &str) -> (String, u32) {
    let mut value: serde_json::Value = match serde_json::from_str(content) {
        Ok(v) => v,
        Err(_) => return (content.to_string(), 0),
    };
    let mut count: u32 = 0;

    if let Some(sections) = value.get_mut("sections").and_then(|s| s.as_array_mut()) {
        for section in sections.iter_mut() {
            if let Some(questions) = section.get_mut("questions").and_then(|q| q.as_array_mut()) {
                for question in questions.iter_mut() {
                    let answer_choice_empty = question.get("answer_choice").is_none_or(|v| v.is_null());
                    let answer_text_empty = question.get("answer_text").is_none_or(|v| {
                        v.is_null() || v.as_str().is_some_and(|s| s.is_empty())
                    });

                    if answer_choice_empty && answer_text_empty {
                        if let Some(choices) = question.get("choices").and_then(|c| c.as_array()) {
                            if let Some(first_non_other) = choices.iter().find(|c| {
                                c.get("is_other").and_then(|v| v.as_bool()) != Some(true)
                            }) {
                                if let (Some(id), Some(text)) = (
                                    first_non_other.get("id").cloned(),
                                    first_non_other.get("text").cloned(),
                                ) {
                                    question["answer_choice"] = id;
                                    question["answer_text"] = text;
                                    count += 1;
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    let updated = serde_json::to_string_pretty(&value).unwrap_or_else(|_| content.to_string());
    (updated, count)
}

#[tauri::command]
pub fn reset_workflow_step(
    workspace_path: String,
    skill_name: String,
    from_step_id: u32,
    db: tauri::State<'_, Db>,
) -> Result<(), String> {
    log::info!(
        "[reset_workflow_step] CALLED skill={} from_step={} workspace={}",
        skill_name, from_step_id, workspace_path
    );
    let skills_path = read_skills_path(&db)
        .ok_or_else(|| "Skills path not configured. Please set it in Settings.".to_string())?;
    log::debug!("[reset_workflow_step] skills_path={}", skills_path);

    // Auto-commit: checkpoint before artifacts are deleted
    let msg = format!("{}: checkpoint before reset to step {}", skill_name, from_step_id);
    if let Err(e) = crate::git::commit_all(std::path::Path::new(&skills_path), &msg) {
        log::warn!("Git auto-commit failed ({}): {}", msg, e);
    }

    crate::cleanup::delete_step_output_files(&workspace_path, &skill_name, from_step_id, &skills_path);

    // Reset steps in SQLite
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    crate::db::reset_workflow_steps_from(&conn, &skill_name, from_step_id as i32)?;

    // Update the workflow run's current step
    if let Some(run) = crate::db::get_workflow_run(&conn, &skill_name)? {
        crate::db::save_workflow_run(&conn, &skill_name, from_step_id as i32,
            "pending",
            &run.purpose,
        )?;
    }

    Ok(())
}

#[tauri::command]
pub fn scan_legacy_clarifications(
    db: tauri::State<'_, Db>,
) -> Result<Vec<String>, String> {
    log::info!("scan_legacy_clarifications: checking for legacy clarifications.md files");

    let skills_path = match read_skills_path(&db) {
        Some(p) => p,
        None => return Ok(vec![]),
    };

    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT name FROM skills")
        .map_err(|e| e.to_string())?;
    let skill_names: Vec<String> = stmt
        .query_map([], |row| row.get(0))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    let mut legacy_skills = Vec::new();
    for name in &skill_names {
        let md_path = Path::new(&skills_path)
            .join(name)
            .join("context")
            .join("clarifications.md");
        if md_path.exists() {
            legacy_skills.push(name.clone());
        }
    }

    log::info!(
        "scan_legacy_clarifications: found {} skills with legacy clarifications.md",
        legacy_skills.len()
    );
    Ok(legacy_skills)
}

#[tauri::command]
pub fn reset_legacy_skills(
    skill_names: Vec<String>,
    db: tauri::State<'_, Db>,
) -> Result<(), String> {
    log::info!("reset_legacy_skills: resetting {} skills", skill_names.len());

    let skills_path = read_skills_path(&db)
        .ok_or_else(|| "Skills path not configured".to_string())?;

    let conn = db.0.lock().map_err(|e| e.to_string())?;

    for name in &skill_names {
        let skill_root = Path::new(&skills_path).join(name);

        // Delete context/ contents
        let context_dir = skill_root.join("context");
        if context_dir.is_dir() {
            if let Err(e) = std::fs::remove_dir_all(&context_dir) {
                log::warn!("reset_legacy_skills: failed to remove context/ for {}: {}", name, e);
            }
            let _ = std::fs::create_dir_all(&context_dir);
        }

        // Delete SKILL.md
        let skill_md = skill_root.join("SKILL.md");
        if skill_md.exists() {
            let _ = std::fs::remove_file(&skill_md);
        }

        // Delete references/ contents
        let refs_dir = skill_root.join("references");
        if refs_dir.is_dir() {
            if let Err(e) = std::fs::remove_dir_all(&refs_dir) {
                log::warn!("reset_legacy_skills: failed to remove references/ for {}: {}", name, e);
            }
            let _ = std::fs::create_dir_all(&refs_dir);
        }

        // Reset workflow to step 0 in DB
        conn.execute(
            "UPDATE workflow_steps SET status = 'pending' WHERE skill_name = ?1",
            rusqlite::params![name],
        ).map_err(|e| e.to_string())?;

        log::info!("reset_legacy_skills: reset {}", name);
    }

    Ok(())
}

#[tauri::command]
pub fn preview_step_reset(
    _workspace_path: String,
    skill_name: String,
    from_step_id: u32,
    db: tauri::State<'_, Db>,
) -> Result<Vec<crate::types::StepResetPreview>, String> {
    log::info!("[preview_step_reset] skill={} from_step={}", skill_name, from_step_id);
    let skills_path = read_skills_path(&db)
        .ok_or_else(|| "Skills path not configured. Please set it in Settings.".to_string())?;
    let skill_output_dir = Path::new(&skills_path).join(&skill_name);

    let step_names = [
        "Research",
        "Detailed Research",
        "Confirm Decisions",
        "Generate Skill",
    ];

    let mut result = Vec::new();
    for step_id in from_step_id..=3 {
        // skills_path is required — single code path, no workspace fallback
        let mut existing_files: Vec<String> = Vec::new();

        for file in get_step_output_files(step_id) {
            if skill_output_dir.join(file).exists() {
                existing_files.push(file.to_string());
            }
        }

        // Step 3: also list individual files in references/ directory
        if step_id == 3 {
            let refs_dir = skill_output_dir.join("references");
            if refs_dir.is_dir() {
                if let Ok(entries) = std::fs::read_dir(&refs_dir) {
                    for entry in entries.flatten() {
                        let path = entry.path();
                        if path.is_file() {
                            if let Some(name) = path.file_name() {
                                existing_files.push(format!("references/{}", name.to_string_lossy()));
                            }
                        }
                    }
                }
            }
        }

        if !existing_files.is_empty() {
            let name = step_names.get(step_id as usize).unwrap_or(&"Unknown").to_string();
            result.push(crate::types::StepResetPreview {
                step_id,
                step_name: name,
                files: existing_files,
            });
        }
    }

    Ok(result)
}



#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_step_config_valid_steps() {
        let valid_steps = [0, 1, 2, 3];
        for step_id in valid_steps {
            let config = get_step_config(step_id);
            assert!(config.is_ok(), "Step {} should be valid", step_id);
            let config = config.unwrap();
            assert_eq!(config.step_id, step_id);
            assert!(!config.prompt_template.is_empty());
        }
    }

    #[test]
    fn test_get_step_config_invalid_step() {
        assert!(get_step_config(4).is_err());  // Beyond last step
        assert!(get_step_config(5).is_err());  // Beyond last step
        assert!(get_step_config(6).is_err());  // Beyond last step
        assert!(get_step_config(7).is_err());  // Beyond last step
        assert!(get_step_config(99).is_err());
    }

    #[test]
    fn test_get_step_config_step7_error_message() {
        let err = get_step_config(7).unwrap_err();
        assert!(err.contains("Unknown step_id 7"), "Error should mention unknown step: {}", err);
    }

    #[test]
    fn test_get_step_output_files_unknown_step() {
        // Unknown steps should return empty vec
        let files = get_step_output_files(7);
        assert!(files.is_empty());
        let files = get_step_output_files(8);
        assert!(files.is_empty());
        let files = get_step_output_files(99);
        assert!(files.is_empty());
    }

    #[test]
    fn test_build_prompt_all_three_paths() {
        let prompt = build_prompt(
            "my-skill",
            "/home/user/.vibedata",
            "/home/user/my-skills",
            None,
            None,
            5,
        );
        assert!(prompt.contains("my-skill"));
        // 3 distinct paths in prompt
        assert!(prompt.contains("The workspace directory is: /home/user/.vibedata/my-skill"));
        assert!(prompt.contains("The context directory is: /home/user/my-skills/my-skill/context"));
        assert!(prompt.contains("The skill output directory (SKILL.md and references/) is: /home/user/my-skills/my-skill"));
    }

    #[test]
    fn test_build_prompt_with_skill_type() {
        let prompt = build_prompt(
            "my-skill",
            "/home/user/.vibedata",
            "/home/user/my-skills",
            None,
            None,
            5,
        );
        // Purpose is now in user-context.md, read by the agent
        assert!(prompt.contains("user-context.md"));
    }

    #[test]
    fn test_build_prompt_with_author_info() {
        let prompt = build_prompt(
            "my-skill",
            "/home/user/.vibedata",
            "/home/user/my-skills",
            Some("octocat"),
            Some("2025-06-15T12:00:00Z"),
            5,
        );
        assert!(prompt.contains("The author of this skill is: octocat."));
        assert!(prompt.contains("The skill was created on: 2025-06-15."));
        assert!(prompt.contains("Today's date (for the modified timestamp) is:"));
    }

    #[test]
    fn test_build_prompt_without_author_info() {
        let prompt = build_prompt(
            "my-skill",
            "/home/user/.vibedata",
            "/home/user/my-skills",
            None,
            None,
            5,
        );
        assert!(!prompt.contains("The author of this skill is:"));
        assert!(!prompt.contains("The skill was created on:"));
    }

    #[test]
    fn test_answer_evaluator_prompt_uses_standard_paths() {
        // The answer-evaluator prompt must follow the same "workspace directory" /
        // "context directory" pattern as build_prompt so the mock agent and real
        // agent can parse paths consistently.
        let workspace_path = "/home/user/.vibedata";
        let skills_path = "/home/user/my-skills";
        let skill_name = "my-skill";

        let context_dir = std::path::Path::new(skills_path)
            .join(skill_name)
            .join("context");
        let workspace_dir = std::path::Path::new(workspace_path).join(skill_name);

        let prompt = format!(
            "The workspace directory is: {workspace}. \
             The context directory is: {context}. \
             All directories already exist — do not create any directories.",
            workspace = workspace_dir.display(),
            context = context_dir.display(),
        );

        // Verify standard path markers that mock agent and agent prompts rely on
        assert!(prompt.contains("The workspace directory is: /home/user/.vibedata/my-skill."));
        assert!(prompt.contains("The context directory is: /home/user/my-skills/my-skill/context."));
        assert!(prompt.contains("do not create any directories"));
        // Workspace dir is NOT context dir (answer-evaluation.json goes to workspace)
        assert_ne!(
            workspace_dir.to_str().unwrap(),
            context_dir.to_str().unwrap(),
        );
    }

    #[test]
    fn test_make_agent_id() {
        let id = make_agent_id("test-skill", "step0");
        assert!(id.starts_with("test-skill-step0-"));
        let parts: Vec<&str> = id.rsplitn(2, '-').collect();
        assert!(parts[0].parse::<u128>().is_ok());
    }

    #[test]
    fn test_package_skill_creates_zip() {
        let tmp = tempfile::tempdir().unwrap();
        // source_dir now has SKILL.md and references/ directly (no skill/ subdir)
        let source_dir = tmp.path().join("my-skill");
        std::fs::create_dir_all(source_dir.join("references")).unwrap();

        std::fs::write(source_dir.join("SKILL.md"), "# My Skill").unwrap();
        std::fs::write(
            source_dir.join("references").join("deep-dive.md"),
            "# Deep Dive",
        )
        .unwrap();

        // Extra files that should NOT be included in the zip
        std::fs::create_dir_all(source_dir.join("context")).unwrap();
        std::fs::write(
            source_dir.join("context").join("decisions.md"),
            "# Decisions",
        )
        .unwrap();
        std::fs::write(source_dir.join("workflow.md"), "# Workflow").unwrap();

        let output_path = source_dir.join("my-skill.skill");
        let result = create_skill_zip(&source_dir, &output_path).unwrap();

        assert!(Path::new(&result.file_path).exists());
        assert!(result.size_bytes > 0);

        let file = std::fs::File::open(&result.file_path).unwrap();
        let mut archive = zip::ZipArchive::new(file).unwrap();

        let names: Vec<String> = (0..archive.len())
            .map(|i| archive.by_index(i).unwrap().name().to_string())
            .collect();

        assert!(names.contains(&"SKILL.md".to_string()));
        assert!(names.contains(&"references/deep-dive.md".to_string()));
        assert!(!names.iter().any(|n| n.starts_with("context/")));
        assert!(!names.contains(&"workflow.md".to_string()));
    }

    #[test]
    fn test_package_skill_nested_references() {
        let tmp = tempfile::tempdir().unwrap();
        // source_dir has SKILL.md and references/ directly
        let source_dir = tmp.path().join("nested-skill");
        std::fs::create_dir_all(source_dir.join("references").join("sub")).unwrap();

        std::fs::write(source_dir.join("SKILL.md"), "# Nested").unwrap();
        std::fs::write(
            source_dir.join("references").join("top.md"),
            "top level",
        )
        .unwrap();
        std::fs::write(
            source_dir.join("references").join("sub").join("nested.md"),
            "nested ref",
        )
        .unwrap();

        let output_path = source_dir.join("nested-skill.skill");
        let result = create_skill_zip(&source_dir, &output_path).unwrap();

        let file = std::fs::File::open(&result.file_path).unwrap();
        let mut archive = zip::ZipArchive::new(file).unwrap();

        let names: Vec<String> = (0..archive.len())
            .map(|i| archive.by_index(i).unwrap().name().to_string())
            .collect();

        assert!(names.contains(&"SKILL.md".to_string()));
        assert!(names.contains(&"references/top.md".to_string()));
        assert!(names.contains(&"references/sub/nested.md".to_string()));
    }

    #[test]
    fn test_package_skill_missing_dir() {
        let result = create_skill_zip(
            Path::new("/nonexistent/path"),
            Path::new("/nonexistent/output.skill"),
        );
        assert!(result.is_err());
    }

    // Tests for copy_directory_to removed — function no longer exists
    // (agents tree is no longer deployed to workspace root)

    #[test]
    fn test_resolve_prompts_dir_dev_mode() {
        // In dev/test mode, CARGO_MANIFEST_DIR is set and the repo root has agents/
        let dev_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .and_then(|p| p.parent())
            .map(|p| p.join("agents"));
        assert!(dev_path.is_some());
        let agents_dir = dev_path.unwrap();
        assert!(agents_dir.is_dir(), "Repo root agents/ should exist");
        // Verify flat agent files exist (no subdirectories)
        assert!(agents_dir.join("research-orchestrator.md").exists(), "agents/research-orchestrator.md should exist");
        assert!(agents_dir.join("validate-skill.md").exists(), "agents/validate-skill.md should exist");
    }

    #[test]
    fn test_delete_step_output_files_from_step_onwards() {
        let workspace_tmp = tempfile::tempdir().unwrap();
        let skills_tmp = tempfile::tempdir().unwrap();
        let workspace = workspace_tmp.path().to_str().unwrap();
        let skills_path = skills_tmp.path().to_str().unwrap();
        // Context files live in skills_path/skill_name/
        let skill_dir = skills_tmp.path().join("my-skill");
        std::fs::create_dir_all(skill_dir.join("context")).unwrap();
        std::fs::create_dir_all(skill_dir.join("references")).unwrap();

        // Create output files for steps 0, 1, 2, 3 in skills_path/my-skill/
        // Steps 0 and 1 both use clarifications.json (unified artifact)
        std::fs::write(
            skill_dir.join("context/clarifications.json"),
            "step0+step1",
        )
        .unwrap();
        std::fs::write(skill_dir.join("context/decisions.md"), "step2").unwrap();
        std::fs::write(skill_dir.join("SKILL.md"), "step3").unwrap();
        std::fs::write(skill_dir.join("references/ref.md"), "ref").unwrap();

        // Reset from step 2 onwards — steps 0, 1 should be preserved
        crate::cleanup::delete_step_output_files(workspace, "my-skill", 2, skills_path);

        // Steps 0, 1 output (unified clarifications.json) should still exist
        assert!(skill_dir.join("context/clarifications.json").exists());

        // Steps 2+ outputs should be deleted
        assert!(!skill_dir.join("context/decisions.md").exists());
        assert!(!skill_dir.join("SKILL.md").exists());
        assert!(!skill_dir.join("references").exists());
    }

    #[test]
    fn test_clean_step_output_step1_is_noop() {
        // Step 1 edits clarifications.json in-place (no unique artifact),
        // so cleaning step 1 has no files to delete.
        let workspace_tmp = tempfile::tempdir().unwrap();
        let skills_tmp = tempfile::tempdir().unwrap();
        let workspace = workspace_tmp.path().to_str().unwrap();
        let skills_path = skills_tmp.path().to_str().unwrap();
        let skill_dir = skills_tmp.path().join("my-skill");
        std::fs::create_dir_all(skill_dir.join("context")).unwrap();

        std::fs::write(skill_dir.join("context/clarifications.json"), "refined").unwrap();
        std::fs::write(skill_dir.join("context/decisions.md"), "step2").unwrap();

        // Clean only step 1 — both files should be untouched (step 1 has no unique output)
        crate::cleanup::clean_step_output_thorough(workspace, "my-skill", 1, skills_path);

        assert!(skill_dir.join("context/clarifications.json").exists());
        assert!(skill_dir.join("context/decisions.md").exists());
    }

    #[test]
    fn test_delete_step_output_files_nonexistent_dir_is_ok() {
        // Should not panic on nonexistent directory
        let tmp = tempfile::tempdir().unwrap();
        let skills_path = tmp.path().to_str().unwrap();
        crate::cleanup::delete_step_output_files("/tmp/nonexistent", "no-skill", 0, skills_path);
    }

    #[test]
    fn test_delete_step_output_files_cleans_last_steps() {
        let workspace_tmp = tempfile::tempdir().unwrap();
        let skills_tmp = tempfile::tempdir().unwrap();
        let workspace = workspace_tmp.path().to_str().unwrap();
        let skills_path = skills_tmp.path().to_str().unwrap();
        let skill_dir = skills_tmp.path().join("my-skill");
        std::fs::create_dir_all(skill_dir.join("context")).unwrap();

        // Create files for step 2 (decisions) in skills_path
        std::fs::write(skill_dir.join("context/decisions.md"), "step2").unwrap();

        // Reset from step 2 onwards should clean up step 2+3
        crate::cleanup::delete_step_output_files(workspace, "my-skill", 2, skills_path);

        // Step 2 outputs should be deleted
        assert!(!skill_dir.join("context/decisions.md").exists());
    }

    #[test]
    fn test_delete_step_output_files_last_step() {
        // Verify delete_step_output_files(from=3) doesn't panic
        let workspace_tmp = tempfile::tempdir().unwrap();
        let skills_tmp = tempfile::tempdir().unwrap();
        let workspace = workspace_tmp.path().to_str().unwrap();
        let skills_path = skills_tmp.path().to_str().unwrap();
        std::fs::create_dir_all(workspace_tmp.path().join("my-skill")).unwrap();
        crate::cleanup::delete_step_output_files(workspace, "my-skill", 3, skills_path);
    }

    #[test]
    fn test_copy_directory_recursive_copies_all_file_types() {
        let src = tempfile::tempdir().unwrap();
        let dest = tempfile::tempdir().unwrap();

        // Create source files of various types (not just .md)
        std::fs::write(src.path().join("SKILL.md"), "# Skill").unwrap();
        std::fs::write(src.path().join("data.csv"), "col1,col2\na,b").unwrap();
        std::fs::write(src.path().join("config.json"), "{}").unwrap();

        let dest_path = dest.path().join("output");
        copy_directory_recursive(src.path(), &dest_path).unwrap();

        assert!(dest_path.join("SKILL.md").exists());
        assert!(dest_path.join("data.csv").exists());
        assert!(dest_path.join("config.json").exists());

        // Verify content is preserved
        let csv_content = std::fs::read_to_string(dest_path.join("data.csv")).unwrap();
        assert_eq!(csv_content, "col1,col2\na,b");
    }

    #[test]
    fn test_copy_directory_recursive_handles_nested_dirs() {
        let src = tempfile::tempdir().unwrap();
        let dest = tempfile::tempdir().unwrap();

        // Create nested structure
        std::fs::create_dir_all(src.path().join("sub").join("deep")).unwrap();
        std::fs::write(src.path().join("top.md"), "top").unwrap();
        std::fs::write(src.path().join("sub").join("middle.txt"), "middle").unwrap();
        std::fs::write(src.path().join("sub").join("deep").join("bottom.md"), "bottom").unwrap();

        let dest_path = dest.path().join("copied");
        copy_directory_recursive(src.path(), &dest_path).unwrap();

        assert!(dest_path.join("top.md").exists());
        assert!(dest_path.join("sub").join("middle.txt").exists());
        assert!(dest_path.join("sub").join("deep").join("bottom.md").exists());

        let bottom = std::fs::read_to_string(dest_path.join("sub").join("deep").join("bottom.md")).unwrap();
        assert_eq!(bottom, "bottom");
    }

    #[test]
    fn test_copy_directory_recursive_creates_dest_dir() {
        let src = tempfile::tempdir().unwrap();
        let dest = tempfile::tempdir().unwrap();

        std::fs::write(src.path().join("file.txt"), "hello").unwrap();

        // Destination doesn't exist yet — copy_directory_recursive should create it
        let dest_path = dest.path().join("new").join("nested").join("dir");
        assert!(!dest_path.exists());

        copy_directory_recursive(src.path(), &dest_path).unwrap();

        assert!(dest_path.join("file.txt").exists());
    }

    #[test]
    fn test_copy_directory_recursive_empty_dir() {
        let src = tempfile::tempdir().unwrap();
        let dest = tempfile::tempdir().unwrap();

        // Source is empty
        let dest_path = dest.path().join("empty_copy");
        copy_directory_recursive(src.path(), &dest_path).unwrap();

        assert!(dest_path.exists());
        assert!(dest_path.is_dir());
        // No files should be created
        let count = std::fs::read_dir(&dest_path).unwrap().count();
        assert_eq!(count, 0);
    }

    #[test]
    fn test_copy_directory_recursive_nonexistent_source_fails() {
        let dest = tempfile::tempdir().unwrap();
        let result = copy_directory_recursive(
            Path::new("/nonexistent/source"),
            &dest.path().join("dest"),
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_derive_agent_name_fallback() {
        // Without deployed agent files, falls back to phase name
        let tmp = tempfile::tempdir().unwrap();
        let ws = tmp.path().to_str().unwrap();
        assert_eq!(
            derive_agent_name(ws, "domain", "research-orchestrator.md"),
            "research-orchestrator"
        );
        assert_eq!(
            derive_agent_name(ws, "platform", "generate-skill.md"),
            "generate-skill"
        );
    }

    #[test]
    fn test_derive_agent_name_reads_frontmatter() {
        let tmp = tempfile::tempdir().unwrap();
        let ws = tmp.path().to_str().unwrap();
        let agents_dir = tmp.path().join(".claude").join("agents");
        std::fs::create_dir_all(&agents_dir).unwrap();

        std::fs::write(
            agents_dir.join("research-orchestrator.md"),
            "---\nname: research-orchestrator\nmodel: sonnet\n---\n# Agent\n",
        ).unwrap();

        assert_eq!(
            derive_agent_name(ws, "data-engineering", "research-orchestrator.md"),
            "research-orchestrator"
        );
    }

    #[test]
    fn test_copy_agents_to_claude_dir() {
        let src = tempfile::tempdir().unwrap();
        let workspace = tempfile::tempdir().unwrap();

        // Create flat agent files
        std::fs::write(
            src.path().join("research-entities.md"),
            "# Research Entities",
        )
        .unwrap();
        std::fs::write(
            src.path().join("consolidate-research.md"),
            "# Consolidate Research",
        )
        .unwrap();

        // Non-.md file should be ignored
        std::fs::write(
            src.path().join("README.txt"),
            "ignore me",
        )
        .unwrap();

        let workspace_path = workspace.path().to_str().unwrap();
        copy_agents_to_claude_dir(src.path(), workspace_path).unwrap();

        let claude_agents_dir = workspace.path().join(".claude").join("agents");
        assert!(claude_agents_dir.is_dir());

        // Verify flat names (no prefix)
        assert!(claude_agents_dir.join("research-entities.md").exists());
        assert!(claude_agents_dir.join("consolidate-research.md").exists());

        // Non-.md file should NOT be copied
        assert!(!claude_agents_dir.join("README.txt").exists());

        // Verify content
        let content = std::fs::read_to_string(
            claude_agents_dir.join("research-entities.md"),
        )
        .unwrap();
        assert_eq!(content, "# Research Entities");
    }

    // --- Task 5: create_skill_zip excludes context/ ---

    #[test]
    fn test_create_skill_zip_excludes_context_directory() {
        let tmp = tempfile::tempdir().unwrap();
        let source_dir = tmp.path().join("my-skill");
        std::fs::create_dir_all(source_dir.join("references")).unwrap();
        std::fs::create_dir_all(source_dir.join("context")).unwrap();

        std::fs::write(source_dir.join("SKILL.md"), "# My Skill").unwrap();
        std::fs::write(
            source_dir.join("references").join("ref.md"),
            "# Ref",
        ).unwrap();
        // These context files should be EXCLUDED from the zip
        std::fs::write(
            source_dir.join("context").join("clarifications.json"),
            "{}",
        ).unwrap();
        std::fs::write(
            source_dir.join("context").join("decisions.md"),
            "# Decisions",
        ).unwrap();

        let output_path = source_dir.join("my-skill.skill");
        let result = create_skill_zip(&source_dir, &output_path).unwrap();

        let file = std::fs::File::open(&result.file_path).unwrap();
        let mut archive = zip::ZipArchive::new(file).unwrap();

        let names: Vec<String> = (0..archive.len())
            .map(|i| archive.by_index(i).unwrap().name().to_string())
            .collect();

        // Should include SKILL.md and references
        assert!(names.contains(&"SKILL.md".to_string()));
        assert!(names.contains(&"references/ref.md".to_string()));
        // Should NOT include any context files
        assert!(!names.iter().any(|n| n.starts_with("context/")));
        assert!(!names.iter().any(|n| n.contains("clarifications")));
        assert!(!names.iter().any(|n| n.contains("decisions")));
    }

    // --- VD-403: validate_decisions_exist_inner tests ---

    #[test]
    fn test_validate_decisions_missing() {
        let tmp = tempfile::tempdir().unwrap();
        let skills = tmp.path().join("skills");
        std::fs::create_dir_all(skills.join("my-skill").join("context")).unwrap();

        let result = validate_decisions_exist_inner(
            "my-skill",
            "/unused",
            skills.to_str().unwrap(),
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("decisions.md was not found"));
    }

    #[test]
    fn test_validate_decisions_found_in_skills_path() {
        let tmp = tempfile::tempdir().unwrap();
        let skills = tmp.path().join("skills");
        std::fs::create_dir_all(skills.join("my-skill").join("context")).unwrap();
        std::fs::write(
            skills.join("my-skill").join("context").join("decisions.md"),
            "# Decisions\n\nD1: Use periodic recognition",
        ).unwrap();

        let result = validate_decisions_exist_inner(
            "my-skill",
            "/unused",
            skills.to_str().unwrap(),
        );
        assert!(result.is_ok());
    }

    #[test]
    fn test_validate_decisions_rejects_empty_file() {
        let tmp = tempfile::tempdir().unwrap();
        let skills = tmp.path().join("skills");
        std::fs::create_dir_all(skills.join("my-skill").join("context")).unwrap();
        // Write an empty decisions file
        std::fs::write(
            skills.join("my-skill").join("context").join("decisions.md"),
            "   \n\n  ",
        ).unwrap();

        let result = validate_decisions_exist_inner(
            "my-skill",
            "/unused",
            skills.to_str().unwrap(),
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("decisions.md was not found"));
    }

    // --- debug mode: no reduced turns, sonnet model override ---

    #[test]
    fn test_debug_max_turns_removed() {
        // debug_max_turns no longer exists as a function. This test verifies
        // that get_step_config returns the *normal* turn limits for every step,
        // which is what run_workflow_step now uses unconditionally.
        let expected: Vec<(u32, u32)> = vec![
            (0, 50),   // research
            (1, 50),   // detailed research
            (2, 100),  // confirm decisions
            (3, 120),  // generate skill
        ];
        for (step_id, expected_turns) in expected {
            let config = get_step_config(step_id).unwrap();
            assert_eq!(
                config.max_turns, expected_turns,
                "Step {} should have max_turns={} (normal), got {}",
                step_id, expected_turns, config.max_turns
            );
        }
    }

    #[test]
    fn test_step_max_turns() {
        let steps_with_expected_turns = [
            (0, 50),
            (1, 50),
            (2, 100),
            (3, 120),
        ];
        for (step_id, normal_turns) in steps_with_expected_turns {
            let config = get_step_config(step_id).unwrap();
            assert_eq!(
                config.max_turns, normal_turns,
                "Step {} max_turns should be {}",
                step_id, normal_turns
            );
        }
    }

    #[test]
    fn test_step0_always_wipes_context() {
        // Step 0 always wipes the context directory in skills_path (not workspace)
        let tmp = tempfile::tempdir().unwrap();
        let skills_path = tmp.path().to_str().unwrap();
        let skill_dir = tmp.path().join("my-skill");
        std::fs::create_dir_all(skill_dir.join("context")).unwrap();

        std::fs::write(
            skill_dir.join("context/clarifications.json"),
            "{}",
        ).unwrap();

        let step_id: u32 = 0;
        if step_id == 0 {
            let context_dir = Path::new(skills_path).join("my-skill").join("context");
            if context_dir.is_dir() {
                let _ = std::fs::remove_dir_all(&context_dir);
                let _ = std::fs::create_dir_all(&context_dir);
            }
        }

        // Context files should have been wiped
        assert!(!skill_dir.join("context/clarifications.json").exists());
        // But context directory itself should be recreated
        assert!(skill_dir.join("context").exists());
    }

    #[test]
    fn test_write_user_context_file_all_fields() {
        let tmp = tempfile::tempdir().unwrap();
        let workspace_path = tmp.path().to_str().unwrap();
        let workspace_dir = tmp.path().join("my-skill");
        // Directory doesn't need to pre-exist — create_dir_all handles it

        let intake = r#"{"audience":"Data engineers","challenges":"Legacy systems","scope":"ETL pipelines"}"#;
        write_user_context_file(workspace_path, "my-skill", &[], Some("Healthcare"), Some("Analytics Lead"), Some(intake), None, None, None, None, None, None, None);

        let content = std::fs::read_to_string(workspace_dir.join("user-context.md")).unwrap();
        assert!(content.contains("# User Context"));
        assert!(content.contains("### About You"));
        assert!(content.contains("**Industry**: Healthcare"));
        assert!(content.contains("**Function**: Analytics Lead"));
        assert!(content.contains("### Target Audience"));
        assert!(content.contains("Data engineers"));
        assert!(content.contains("### Key Challenges"));
        assert!(content.contains("Legacy systems"));
        assert!(content.contains("### Scope"));
        assert!(content.contains("ETL pipelines"));
    }

    #[test]
    fn test_write_user_context_file_partial_fields() {
        let tmp = tempfile::tempdir().unwrap();
        let workspace_path = tmp.path().to_str().unwrap();
        let workspace_dir = tmp.path().join("my-skill");

        write_user_context_file(workspace_path, "my-skill", &[], Some("Fintech"), None, None, None, None, None, None, None, None, None);

        let content = std::fs::read_to_string(workspace_dir.join("user-context.md")).unwrap();
        assert!(content.contains("**Industry**: Fintech"));
        assert!(!content.contains("**Function**"));
        assert!(!content.contains("**Target Audience**"));
    }

    #[test]
    fn test_write_user_context_file_empty_optional_fields_skipped() {
        let tmp = tempfile::tempdir().unwrap();
        let workspace_path = tmp.path().to_str().unwrap();
        let workspace_dir = tmp.path().join("my-skill");

        write_user_context_file(workspace_path, "my-skill", &[], Some(""), None, None, None, None, None, None, None, None, None);

        // Skill name is always written; empty optional fields are omitted
        let content = std::fs::read_to_string(workspace_dir.join("user-context.md")).unwrap();
        assert!(content.contains("**Name**: my-skill"));
        assert!(!content.contains("**Industry**"));
    }

    #[test]
    fn test_write_user_context_file_always_writes_skill_name() {
        let tmp = tempfile::tempdir().unwrap();
        let workspace_path = tmp.path().to_str().unwrap();
        let workspace_dir = tmp.path().join("my-skill");

        write_user_context_file(workspace_path, "my-skill", &[], None, None, None, None, None, None, None, None, None, None);

        // Skill name alone is enough to produce a file
        let content = std::fs::read_to_string(workspace_dir.join("user-context.md")).unwrap();
        assert!(content.contains("**Name**: my-skill"));
    }

    #[test]
    fn test_write_user_context_file_creates_missing_dir() {
        let tmp = tempfile::tempdir().unwrap();
        let workspace_path = tmp.path().to_str().unwrap();
        let workspace_dir = tmp.path().join("new-skill");
        // Directory does NOT exist yet
        assert!(!workspace_dir.exists());

        write_user_context_file(workspace_path, "new-skill", &[], Some("Retail"), None, None, None, None, None, None, None, None, None);

        // Directory should have been created and file written
        assert!(workspace_dir.join("user-context.md").exists());
    }

    #[test]
    fn test_thinking_budget_for_step() {
        assert_eq!(thinking_budget_for_step(0), Some(8_000));
        assert_eq!(thinking_budget_for_step(1), Some(8_000));
        assert_eq!(thinking_budget_for_step(2), Some(32_000));
        assert_eq!(thinking_budget_for_step(3), Some(16_000));
        // Beyond last step returns None
        assert_eq!(thinking_budget_for_step(4), None);
        assert_eq!(thinking_budget_for_step(5), None);
        assert_eq!(thinking_budget_for_step(99), None);
    }

    #[test]
    fn test_build_betas_thinking_non_opus() {
        let betas = build_betas(Some(32000), "claude-sonnet-4-5-20250929");
        assert_eq!(betas, Some(vec!["interleaved-thinking-2025-05-14".to_string()]));
    }

    #[test]
    fn test_build_betas_thinking_opus() {
        // Opus natively supports thinking — no interleaved-thinking beta needed
        let betas = build_betas(Some(32000), "claude-opus-4-6");
        assert_eq!(betas, None);
    }

    #[test]
    fn test_build_betas_none() {
        let betas = build_betas(None, "claude-sonnet-4-5-20250929");
        assert_eq!(betas, None);
    }


    #[test]
    fn test_workspace_already_copied_returns_false_for_unknown() {
        // Use a unique path to avoid interference from other tests
        let path = format!("/tmp/test-workspace-unknown-{}", std::process::id());
        assert!(!super::workspace_already_copied(&path));
    }

    #[test]
    fn test_mark_workspace_copied_then_already_copied() {
        let path = format!("/tmp/test-workspace-mark-{}", std::process::id());
        assert!(!super::workspace_already_copied(&path));
        super::mark_workspace_copied(&path);
        assert!(super::workspace_already_copied(&path));
    }

    #[test]
    fn test_workspace_copy_cache_is_per_workspace() {
        let path_a = format!("/tmp/test-ws-a-{}", std::process::id());
        let path_b = format!("/tmp/test-ws-b-{}", std::process::id());
        super::mark_workspace_copied(&path_a);
        assert!(super::workspace_already_copied(&path_a));
        assert!(!super::workspace_already_copied(&path_b));
    }

    #[test]
    fn test_invalidate_workspace_cache() {
        let path = format!("/tmp/test-ws-invalidate-{}", std::process::id());
        super::mark_workspace_copied(&path);
        assert!(super::workspace_already_copied(&path));
        super::invalidate_workspace_cache(&path);
        assert!(!super::workspace_already_copied(&path));
    }

    #[test]
    fn test_reset_cleans_skills_path_context_files() {
        // 1. Create a temp workspace dir and a separate temp skills_path dir
        let workspace_tmp = tempfile::tempdir().unwrap();
        let skills_path_tmp = tempfile::tempdir().unwrap();
        let workspace = workspace_tmp.path().to_str().unwrap();
        let skills_path = skills_path_tmp.path().to_str().unwrap();

        // 2-3. Create skills_path/my-skill/context/ with all context files
        let context_dir = skills_path_tmp.path().join("my-skill").join("context");
        std::fs::create_dir_all(&context_dir).unwrap();

        let context_files = [
            "clarifications.json",
            "decisions.md",
        ];
        for file in &context_files {
            std::fs::write(context_dir.join(file), "test content").unwrap();
        }

        // 4. Working dir must exist in workspace
        std::fs::create_dir_all(workspace_tmp.path().join("my-skill")).unwrap();

        // 5. Call delete_step_output_files from step 0 with skills_path
        crate::cleanup::delete_step_output_files(workspace, "my-skill", 0, skills_path);

        // 6. Assert ALL files in skills_path/my-skill/context/ are gone
        let mut remaining: Vec<String> = Vec::new();
        for file in &context_files {
            if context_dir.join(file).exists() {
                remaining.push(file.to_string());
            }
        }
        assert!(
            remaining.is_empty(),
            "Expected all context files in skills_path to be deleted, but these remain: {:?}",
            remaining
        );
    }

    // --- VD-664: parse_scope_recommendation tests ---

    #[test]
    fn test_scope_recommendation_true() {
        let mut f = tempfile::NamedTempFile::new().unwrap();
        use std::io::Write as _;
        write!(f, r#"{{"metadata":{{"scope_recommendation":true,"original_dimensions":8}},"sections":[]}}"#).unwrap();
        assert!(parse_scope_recommendation(f.path()));
    }

    #[test]
    fn test_scope_recommendation_false() {
        let mut f = tempfile::NamedTempFile::new().unwrap();
        use std::io::Write as _;
        write!(f, r#"{{"metadata":{{"scope_recommendation":false}},"sections":[]}}"#).unwrap();
        assert!(!parse_scope_recommendation(f.path()));
    }

    #[test]
    fn test_scope_recommendation_absent() {
        let mut f = tempfile::NamedTempFile::new().unwrap();
        use std::io::Write as _;
        write!(f, r#"{{"metadata":{{}},"sections":[]}}"#).unwrap();
        assert!(!parse_scope_recommendation(f.path()));
    }

    #[test]
    fn test_scope_recommendation_missing_file() {
        assert!(!parse_scope_recommendation(Path::new("/nonexistent/file.json")));
    }

    #[test]
    fn test_scope_recommendation_invalid_json() {
        let mut f = tempfile::NamedTempFile::new().unwrap();
        use std::io::Write as _;
        write!(f, "not valid json at all").unwrap();
        assert!(!parse_scope_recommendation(f.path()));
    }

    // --- format_user_context tests ---

    #[test]
    fn test_format_user_context_all_fields() {
        let intake = r#"{"audience":"Data engineers","challenges":"Legacy systems","scope":"ETL pipelines","unique_setup":"Multi-cloud","claude_mistakes":"Assumes AWS"}"#;
        let tags = vec!["analytics".to_string(), "salesforce".to_string()];
        let result = format_user_context(Some("my-skill"), &tags, Some("Healthcare"), Some("Analytics Lead"), Some(intake), None, None, None, None, None, None, None);
        let ctx = result.unwrap();
        assert!(ctx.starts_with("## User Context\n"));
        assert!(ctx.contains("**Name**: my-skill"));
        assert!(ctx.contains("**Tags**: analytics, salesforce"));
        assert!(ctx.contains("**Industry**: Healthcare"));
        assert!(ctx.contains("**Function**: Analytics Lead"));
        assert!(ctx.contains("### Target Audience"));
        assert!(ctx.contains("Data engineers"));
        assert!(ctx.contains("### Key Challenges"));
        assert!(ctx.contains("Legacy systems"));
        assert!(ctx.contains("### Scope"));
        assert!(ctx.contains("ETL pipelines"));
        assert!(ctx.contains("### What Makes This Setup Unique"));
        assert!(ctx.contains("Multi-cloud"));
        assert!(ctx.contains("### What Claude Gets Wrong"));
        assert!(ctx.contains("Assumes AWS"));
    }

    #[test]
    fn test_format_user_context_partial_fields() {
        let result = format_user_context(None, &[], Some("Fintech"), None, None, None, None, None, None, None, None, None);
        let ctx = result.unwrap();
        assert!(ctx.contains("**Industry**: Fintech"));
        assert!(!ctx.contains("**Function**"));
    }

    #[test]
    fn test_format_user_context_empty_strings_skipped() {
        let result = format_user_context(None, &[], Some(""), Some(""), None, None, None, None, None, None, None, None);
        assert!(result.is_none());
    }

    #[test]
    fn test_format_user_context_all_none() {
        let result = format_user_context(None, &[], None, None, None, None, None, None, None, None, None, None);
        assert!(result.is_none());
    }

    #[test]
    fn test_format_user_context_invalid_json_ignored() {
        let result = format_user_context(None, &[], Some("Tech"), None, Some("not json"), None, None, None, None, None, None, None);
        let ctx = result.unwrap();
        assert!(ctx.contains("**Industry**: Tech"));
        assert!(!ctx.contains("Target Audience"));
    }

    #[test]
    fn test_format_user_context_partial_intake() {
        let intake = r#"{"audience":"Engineers","scope":"APIs"}"#;
        let result = format_user_context(None, &[], None, None, Some(intake), None, None, None, None, None, None, None);
        let ctx = result.unwrap();
        assert!(ctx.contains("### Target Audience"));
        assert!(ctx.contains("Engineers"));
        assert!(ctx.contains("### Scope"));
        assert!(ctx.contains("APIs"));
        assert!(!ctx.contains("### Key Challenges"));
    }

    // --- build_prompt user context integration tests ---
    // User context fields (industry, intake, behaviour) are now in user-context.md,
    // not inlined in the prompt. These tests verify the prompt references the file.

    #[test]
    fn test_build_prompt_includes_user_context_md_instruction() {
        let prompt = build_prompt("test-skill", "/tmp/ws", "/tmp/skills", None, None, 5);
        assert!(prompt.contains("user-context.md"));
        assert!(prompt.contains("test-skill"));
    }

    #[test]
    fn test_build_prompt_without_user_context() {
        let prompt = build_prompt("test-skill", "/tmp/ws", "/tmp/skills", None, None, 5);
        assert!(prompt.contains("user-context.md"));
        assert!(prompt.contains("test-skill"));
    }

    // --- VD-801: parse_decisions_guard tests ---

    #[test]
    fn test_parse_decisions_guard_zero_count_no_trigger() {
        // decision_count: 0 is only used in scope recommendation path,
        // which is already caught by checkpoint 1 — not a checkpoint 2 trigger
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("decisions.md");
        std::fs::write(&path, "---\ndecision_count: 0\nround: 1\n---\n## No decisions").unwrap();
        assert!(!parse_decisions_guard(&path));
    }

    #[test]
    fn test_parse_decisions_guard_contradictory() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("decisions.md");
        std::fs::write(&path, "---\ndecision_count: 3\ncontradictory_inputs: true\n---\n").unwrap();
        assert!(parse_decisions_guard(&path));
    }

    #[test]
    fn test_parse_decisions_guard_normal() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("decisions.md");
        std::fs::write(&path, "---\ndecision_count: 5\nround: 1\n---\n### D1: ...").unwrap();
        assert!(!parse_decisions_guard(&path));
    }

    #[test]
    fn test_parse_decisions_guard_missing_file() {
        assert!(!parse_decisions_guard(Path::new("/tmp/nonexistent-vd801-decisions.md")));
    }

    #[test]
    fn test_parse_decisions_guard_no_frontmatter() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("decisions.md");
        std::fs::write(&path, "## Decisions\n### D1: something").unwrap();
        assert!(!parse_decisions_guard(&path));
    }

    #[test]
    fn test_parse_decisions_guard_revised_not_blocked() {
        // contradictory_inputs: revised means user has reviewed — must NOT block
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("decisions.md");
        std::fs::write(&path, "---\ndecision_count: 3\ncontradictory_inputs: revised\n---\n").unwrap();
        assert!(!parse_decisions_guard(&path));
    }

    // --- autofill_answers tests (JSON) ---

    /// Helper: build a minimal clarifications JSON with given questions.
    fn make_clarifications_json(questions: Vec<serde_json::Value>) -> String {
        serde_json::json!({
            "metadata": {},
            "sections": [{
                "id": "s1",
                "title": "Section 1",
                "questions": questions
            }]
        }).to_string()
    }

    /// Helper: build a question JSON object.
    fn make_question(id: &str, choices: Vec<serde_json::Value>, answer_choice: Option<&str>, answer_text: Option<&str>, refinements: Option<Vec<serde_json::Value>>) -> serde_json::Value {
        let mut q = serde_json::json!({
            "id": id,
            "text": format!("Question {}", id),
            "choices": choices,
            "answer_choice": answer_choice,
            "answer_text": answer_text,
        });
        if let Some(refs) = refinements {
            q["refinements"] = serde_json::json!(refs);
        }
        q
    }

    /// Helper: build a choice JSON object.
    fn make_choice(id: &str, text: &str, is_other: bool) -> serde_json::Value {
        serde_json::json!({
            "id": id,
            "text": text,
            "is_other": is_other
        })
    }

    #[test]
    fn test_autofill_copies_first_non_other_choice_to_empty_answer() {
        let input = make_clarifications_json(vec![
            make_question("q1", vec![
                make_choice("c1", "Use X", false),
                make_choice("c2", "Other", true),
            ], None, None, None),
        ]);
        let (out, count) = super::autofill_answers(&input);
        assert_eq!(count, 1);
        let v: serde_json::Value = serde_json::from_str(&out).unwrap();
        let q = &v["sections"][0]["questions"][0];
        assert_eq!(q["answer_choice"], "c1");
        assert_eq!(q["answer_text"], "Use X");
    }

    #[test]
    fn test_autofill_skips_already_answered() {
        let input = make_clarifications_json(vec![
            make_question("q1", vec![
                make_choice("c1", "Use X", false),
            ], Some("c1"), Some("Use X"), None),
        ]);
        let (_, count) = super::autofill_answers(&input);
        assert_eq!(count, 0);
    }

    #[test]
    fn test_autofill_handles_multiple_questions() {
        let choices = vec![make_choice("c1", "Rec", false)];
        let input = make_clarifications_json(vec![
            make_question("q1", choices.clone(), None, None, None),
            make_question("q2", choices.clone(), Some("c1"), Some("already"), None),
            make_question("q3", choices.clone(), None, None, None),
        ]);
        let (out, count) = super::autofill_answers(&input);
        assert_eq!(count, 2);
        let v: serde_json::Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["sections"][0]["questions"][0]["answer_choice"], "c1");
        assert_eq!(v["sections"][0]["questions"][1]["answer_text"], "already");
        assert_eq!(v["sections"][0]["questions"][2]["answer_choice"], "c1");
    }

    #[test]
    fn test_autofill_skips_other_only_choices() {
        let input = make_clarifications_json(vec![
            make_question("q1", vec![
                make_choice("c1", "Other option", true),
            ], None, None, None),
        ]);
        let (_, count) = super::autofill_answers(&input);
        assert_eq!(count, 0, "Should not fill when only 'other' choices available");
    }

    #[test]
    fn test_autofill_picks_first_non_other_choice() {
        let input = make_clarifications_json(vec![
            make_question("q1", vec![
                make_choice("c1", "Other", true),
                make_choice("c2", "Second Choice", false),
                make_choice("c3", "Third Choice", false),
            ], None, None, None),
        ]);
        let (out, count) = super::autofill_answers(&input);
        assert_eq!(count, 1);
        let v: serde_json::Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["sections"][0]["questions"][0]["answer_choice"], "c2");
        assert_eq!(v["sections"][0]["questions"][0]["answer_text"], "Second Choice");
    }

    #[test]
    fn test_autofill_does_not_touch_refinements() {
        let input = make_clarifications_json(vec![
            make_question("q1", vec![
                make_choice("c1", "Use X", false),
            ], Some("c1"), Some("Use X"), Some(vec![
                make_question("r1", vec![
                    make_choice("rc1", "Refine Y", false),
                ], None, None, None),
            ])),
        ]);
        let (out, count) = super::autofill_answers(&input);
        assert_eq!(count, 0, "autofill_answers should not touch refinements");
        let v: serde_json::Value = serde_json::from_str(&out).unwrap();
        assert!(v["sections"][0]["questions"][0]["refinements"][0]["answer_choice"].is_null());
    }

    #[test]
    fn test_autofill_invalid_json_returns_unchanged() {
        let input = "not valid json";
        let (out, count) = super::autofill_answers(input);
        assert_eq!(count, 0);
        assert_eq!(out, input);
    }

    #[test]
    fn test_autofill_empty_answer_text_treated_as_empty() {
        let input = make_clarifications_json(vec![
            make_question("q1", vec![
                make_choice("c1", "Use X", false),
            ], None, Some(""), None),
        ]);
        let (out, count) = super::autofill_answers(&input);
        assert_eq!(count, 1);
        let v: serde_json::Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["sections"][0]["questions"][0]["answer_choice"], "c1");
    }

    // --- autofill_refinement_answers tests (JSON) ---

    #[test]
    fn test_autofill_refinement_fills_empty_refinement_answer() {
        let input = make_clarifications_json(vec![
            make_question("q1", vec![
                make_choice("c1", "Q answer", false),
            ], Some("c1"), Some("Q answer"), Some(vec![
                make_question("r1", vec![
                    make_choice("rc1", "Refine Y", false),
                ], None, None, None),
            ])),
        ]);
        let (out, count) = super::autofill_refinement_answers(&input);
        assert_eq!(count, 1);
        let v: serde_json::Value = serde_json::from_str(&out).unwrap();
        let r = &v["sections"][0]["questions"][0]["refinements"][0];
        assert_eq!(r["answer_choice"], "rc1");
        assert_eq!(r["answer_text"], "Refine Y");
        // Q-level answer should be unchanged
        assert_eq!(v["sections"][0]["questions"][0]["answer_choice"], "c1");
    }

    #[test]
    fn test_autofill_refinement_skips_answered() {
        let input = make_clarifications_json(vec![
            make_question("q1", vec![
                make_choice("c1", "Q answer", false),
            ], Some("c1"), Some("Q answer"), Some(vec![
                make_question("r1", vec![
                    make_choice("rc1", "Refine Y", false),
                ], Some("rc1"), Some("Refine Y"), None),
            ])),
        ]);
        let (_, count) = super::autofill_refinement_answers(&input);
        assert_eq!(count, 0);
    }

    #[test]
    fn test_autofill_refinement_handles_multiple() {
        let input = make_clarifications_json(vec![
            make_question("q1", vec![
                make_choice("c1", "Q1 answer", false),
            ], Some("c1"), Some("Q1 answer"), Some(vec![
                make_question("r1", vec![
                    make_choice("rc1", "R1 rec", false),
                ], None, None, None),
                make_question("r2", vec![
                    make_choice("rc2", "R2 rec", false),
                ], Some("rc2"), Some("Already"), None),
            ])),
        ]);
        let (out, count) = super::autofill_refinement_answers(&input);
        assert_eq!(count, 1, "Only r1 should be filled");
        let v: serde_json::Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["sections"][0]["questions"][0]["refinements"][0]["answer_choice"], "rc1");
        assert_eq!(v["sections"][0]["questions"][0]["refinements"][1]["answer_text"], "Already");
    }

    #[test]
    fn test_autofill_refinement_skips_other_only() {
        let input = make_clarifications_json(vec![
            make_question("q1", vec![
                make_choice("c1", "Q answer", false),
            ], Some("c1"), Some("Q answer"), Some(vec![
                make_question("r1", vec![
                    make_choice("rc1", "Other option", true),
                ], None, None, None),
            ])),
        ]);
        let (_, count) = super::autofill_refinement_answers(&input);
        assert_eq!(count, 0, "Should not fill when only 'other' choices available");
    }

    #[test]
    fn test_autofill_refinement_does_not_touch_q_level() {
        let input = make_clarifications_json(vec![
            make_question("q1", vec![
                make_choice("c1", "Q rec", false),
            ], None, None, Some(vec![
                make_question("r1", vec![
                    make_choice("rc1", "R rec", false),
                ], None, None, None),
            ])),
        ]);
        let (out, count) = super::autofill_refinement_answers(&input);
        assert_eq!(count, 1);
        let v: serde_json::Value = serde_json::from_str(&out).unwrap();
        // Q-level should still be null (untouched by refinement autofill)
        assert!(v["sections"][0]["questions"][0]["answer_choice"].is_null());
        // R-level should be filled
        assert_eq!(v["sections"][0]["questions"][0]["refinements"][0]["answer_choice"], "rc1");
    }

    #[test]
    fn test_autofill_refinement_invalid_json_returns_unchanged() {
        let input = "not valid json";
        let (out, count) = super::autofill_refinement_answers(input);
        assert_eq!(count, 0);
        assert_eq!(out, input);
    }

    // --- generate_skills_section tests ---

    /// Helper: create a skill directory with a SKILL.md containing frontmatter.
    fn create_skill_on_disk(
        base: &std::path::Path,
        name: &str,
        trigger: Option<&str>,
        description: Option<&str>,
    ) -> String {
        let skill_dir = base.join(name);
        std::fs::create_dir_all(&skill_dir).unwrap();
        let mut fm = String::from("---\n");
        fm.push_str(&format!("name: {}\n", name));
        if let Some(desc) = description {
            fm.push_str(&format!("description: {}\n", desc));
        }
        if let Some(trig) = trigger {
            fm.push_str(&format!("trigger: {}\n", trig));
        }
        fm.push_str("---\n# Skill\n");
        std::fs::write(skill_dir.join("SKILL.md"), &fm).unwrap();
        skill_dir.to_string_lossy().to_string()
    }

    #[test]
    fn test_generate_skills_section_single_active_skill() {
        let conn = super::super::test_utils::create_test_db();
        let skill_tmp = tempfile::tempdir().unwrap();
        let disk_path = create_skill_on_disk(
            skill_tmp.path(),
            "test-practices",
            Some("Read the skill at .claude/skills/test-practices/SKILL.md."),
            Some("Skill structure rules."),
        );

        let skill = crate::types::WorkspaceSkill {
            skill_id: "bundled-test-practices".to_string(),
            skill_name: "test-practices".to_string(),
            is_active: true,
            disk_path,
            imported_at: "2000-01-01T00:00:00Z".to_string(),
            is_bundled: true,
            description: Some("Skill structure rules.".to_string()),
            purpose: None,
            version: None,
            model: None,
            argument_hint: None,
            user_invocable: None,
            disable_model_invocation: None,
            marketplace_source_url: None,
        };
        crate::db::insert_workspace_skill(&conn, &skill).unwrap();

        let section = generate_skills_section(&conn).unwrap();

        assert!(section.contains("## Custom Skills"), "should use unified heading");
        assert!(section.contains("### /test-practices"), "should list skill by name");
        assert!(section.contains("Skill structure rules."), "should include description");
        assert!(!section.contains("Read and follow the skill at"), "should not include path line");
        assert!(!section.contains("## Skill Generation Guidance"), "old bundled heading must not appear");
        assert!(!section.contains("## Imported Skills"), "old imported heading must not appear");
    }

    #[test]
    fn test_generate_skills_section_inactive_skill_excluded() {
        let conn = super::super::test_utils::create_test_db();
        let skill = crate::types::WorkspaceSkill {
            skill_id: "bundled-test-practices".to_string(),
            skill_name: "test-practices".to_string(),
            is_active: false,
            disk_path: "/tmp/skills/test-practices".to_string(),
            imported_at: "2000-01-01T00:00:00Z".to_string(),
            is_bundled: true,
            description: None,
            purpose: None,
            version: None,
            model: None,
            argument_hint: None,
            user_invocable: None,
            disable_model_invocation: None,
            marketplace_source_url: None,
        };
        crate::db::insert_workspace_skill(&conn, &skill).unwrap();

        let section = generate_skills_section(&conn).unwrap();
        assert!(section.is_empty(), "inactive skill should produce empty section");
    }

    #[test]
    fn test_generate_skills_section_multiple_skills_same_format() {
        let conn = super::super::test_utils::create_test_db();
        let skill_tmp = tempfile::tempdir().unwrap();
        let disk_path1 = create_skill_on_disk(
            skill_tmp.path(),
            "test-practices",
            Some("Use for skill generation."),
            Some("Skill structure rules."),
        );
        let disk_path2 = create_skill_on_disk(
            skill_tmp.path(),
            "data-analytics",
            Some("Use for analytics queries."),
            Some("Analytics patterns."),
        );

        let bundled = crate::types::WorkspaceSkill {
            skill_id: "bundled-test-practices".to_string(),
            skill_name: "test-practices".to_string(),
            is_active: true,
            disk_path: disk_path1,
            imported_at: "2000-01-01T00:00:00Z".to_string(),
            is_bundled: true,
            description: Some("Skill structure rules.".to_string()),
            purpose: None,
            version: None,
            model: None,
            argument_hint: None,
            user_invocable: None,
            disable_model_invocation: None,
            marketplace_source_url: None,
        };
        let imported = crate::types::WorkspaceSkill {
            skill_id: "imp-data-analytics-123".to_string(),
            skill_name: "data-analytics".to_string(),
            is_active: true,
            disk_path: disk_path2,
            imported_at: "2025-01-15T10:00:00Z".to_string(),
            is_bundled: false,
            description: Some("Analytics patterns.".to_string()),
            purpose: None,
            version: None,
            model: None,
            argument_hint: None,
            user_invocable: None,
            disable_model_invocation: None,
            marketplace_source_url: None,
        };
        crate::db::insert_workspace_skill(&conn, &bundled).unwrap();
        crate::db::insert_workspace_skill(&conn, &imported).unwrap();

        let section = generate_skills_section(&conn).unwrap();

        assert!(section.contains("## Custom Skills"), "unified heading");
        assert!(section.contains("### /test-practices"), "bundled skill listed");
        assert!(section.contains("### /data-analytics"), "imported skill listed");
        assert!(section.contains("Skill structure rules."), "bundled description");
        assert!(section.contains("Analytics patterns."), "imported description");
        // Alphabetical order: data-analytics < test-practices
        let da_pos = section.find("### /data-analytics").unwrap();
        let tp_pos = section.find("### /test-practices").unwrap();
        assert!(da_pos < tp_pos, "skills sorted alphabetically");
    }

    #[test]
    fn test_generate_skills_section_no_skills() {
        let conn = super::super::test_utils::create_test_db();
        let section = generate_skills_section(&conn).unwrap();
        assert!(section.is_empty(), "no skills should produce empty section");
    }

    #[test]
    fn test_generate_skills_section_no_trigger_no_path() {
        // Regression test: section must never contain "Read and follow" path line or trigger text
        let conn = super::super::test_utils::create_test_db();
        let skill_tmp = tempfile::tempdir().unwrap();
        let disk_path = create_skill_on_disk(
            skill_tmp.path(),
            "my-skill",
            Some("When user asks about X, use this skill."),
            Some("Skill description here."),
        );

        let skill = crate::types::WorkspaceSkill {
            skill_id: "imp-my-skill-1".to_string(),
            skill_name: "my-skill".to_string(),
            is_active: true,
            disk_path,
            imported_at: "2025-01-01T00:00:00Z".to_string(),
            is_bundled: false,
            description: Some("Skill description here.".to_string()),
            purpose: None,
            version: None,
            model: None,
            argument_hint: None,
            user_invocable: None,
            disable_model_invocation: None,
            marketplace_source_url: None,
        };
        crate::db::insert_workspace_skill(&conn, &skill).unwrap();

        let section = generate_skills_section(&conn).unwrap();

        // Must NOT contain trigger text or path directive
        assert!(!section.contains("Read and follow"), "section must not contain 'Read and follow'");
        assert!(!section.contains("When user asks about X"), "section must not contain trigger text");
        assert!(!section.contains("SKILL.md"), "section must not contain skill path");

        // MUST contain description
        assert!(section.contains("Skill description here."), "section must include description");
        assert!(section.contains("### /my-skill"), "section must include skill heading");
    }

}
