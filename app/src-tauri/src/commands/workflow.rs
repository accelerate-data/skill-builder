use std::collections::HashSet;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use crate::agents::sidecar::{self, SidecarConfig};
use crate::agents::sidecar_pool::SidecarPool;
use crate::db::Db;
use crate::types::{
    PackageResult, StepConfig, StepStatusUpdate,
    WorkflowStateResponse,
};

const FULL_TOOLS: &[&str] = &["Read", "Write", "Edit", "Glob", "Grep", "Bash", "Task"];

/// Resolve a model shorthand ("sonnet", "haiku", "opus") to a full model ID.
/// If the input is already a full ID, pass it through unchanged.
pub fn resolve_model_id(shorthand: &str) -> String {
    match shorthand {
        "sonnet" => "claude-sonnet-4-5-20250929".to_string(),
        "haiku" => "claude-haiku-4-5-20251001".to_string(),
        "opus" => "claude-opus-4-6".to_string(),
        other => other.to_string(), // passthrough for full IDs
    }
}

fn get_step_config(step_id: u32) -> Result<StepConfig, String> {
    match step_id {
        0 => Ok(StepConfig {
            step_id: 0,
            name: "Research Concepts".to_string(),
            prompt_template: "research-concepts.md".to_string(),
            output_file: "context/clarifications-concepts.md".to_string(),
            allowed_tools: FULL_TOOLS.iter().map(|s| s.to_string()).collect(),
            max_turns: 50,
        }),
        2 => Ok(StepConfig {
            step_id: 2,
            name: "Perform Research".to_string(),
            prompt_template: "research-patterns-and-merge.md".to_string(),
            output_file: "context/clarifications.md".to_string(),
            allowed_tools: FULL_TOOLS.iter().map(|s| s.to_string()).collect(),
            max_turns: 50,
        }),
        4 => Ok(StepConfig {
            step_id: 4,
            name: "Reasoning".to_string(),
            prompt_template: "reasoning.md".to_string(),
            output_file: "context/decisions.md".to_string(),
            allowed_tools: FULL_TOOLS.iter().map(|s| s.to_string()).collect(),
            max_turns: 100,
        }),
        5 => Ok(StepConfig {
            step_id: 5,
            name: "Build Skill".to_string(),
            prompt_template: "build.md".to_string(),
            output_file: "skill/SKILL.md".to_string(),
            allowed_tools: FULL_TOOLS.iter().map(|s| s.to_string()).collect(),
            max_turns: 120,
        }),
        6 => Ok(StepConfig {
            step_id: 6,
            name: "Validate".to_string(),
            prompt_template: "validate-and-test.md".to_string(),
            output_file: "context/agent-validation-log.md".to_string(),
            allowed_tools: FULL_TOOLS.iter().map(|s| s.to_string()).collect(),
            max_turns: 120,
        }),
        _ => Err(format!(
            "Unknown step_id {}. Steps 1 and 3 are human review steps; step 7 is the refinement step (client-side only).",
            step_id
        )),
    }
}

/// Session-scoped set of workspaces whose prompts have already been copied.
/// Prompts are bundled with the app and don't change during a session,
/// so we only need to copy once per workspace.
///
/// **Dev-mode caveat:** In development, prompts are read from the repo root.
/// Edits to `agents/` or `references/` while the app is running won't be
/// picked up until the app is restarted.
static COPIED_WORKSPACES: Mutex<Option<HashSet<String>>> = Mutex::new(None);

/// Resolve source directories for agents and references from the app handle.
/// Returns `(agents_dir, refs_dir)` as owned PathBufs. Either may be empty
/// if not found (caller should check `.is_dir()` before using).
fn resolve_prompt_source_dirs(app_handle: &tauri::AppHandle) -> (PathBuf, PathBuf) {
    use tauri::Manager;

    let repo_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|p| p.parent())
        .map(|p| p.to_path_buf());

    let agents_src = repo_root.as_ref().map(|r| r.join("agents"));
    let refs_src = repo_root.as_ref().map(|r| r.join("references"));

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

    let refs_dir = match refs_src {
        Some(ref p) if p.is_dir() => p.clone(),
        _ => {
            let resource = app_handle
                .path()
                .resource_dir()
                .map(|r| r.join("references"))
                .unwrap_or_default();
            if resource.is_dir() {
                resource
            } else {
                PathBuf::new()
            }
        }
    };

    (agents_dir, refs_dir)
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

/// Copy bundled agent .md files and references into workspace.
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
    let (agents_dir, refs_dir) = resolve_prompt_source_dirs(app_handle);

    if !agents_dir.is_dir() && !refs_dir.is_dir() {
        return Ok(()); // No sources found anywhere — skip silently
    }

    let workspace = workspace_path.to_string();
    let agents = agents_dir.clone();
    let refs = refs_dir.clone();

    tokio::task::spawn_blocking(move || {
        copy_prompts_sync(&agents, &refs, &workspace)
    })
    .await
    .map_err(|e| format!("Prompt copy task failed: {}", e))??;

    mark_workspace_copied(workspace_path);
    Ok(())
}

/// Synchronous inner copy logic shared by async and sync entry points.
fn copy_prompts_sync(agents_dir: &Path, refs_dir: &Path, workspace_path: &str) -> Result<(), String> {
    if agents_dir.is_dir() {
        copy_directory_to(agents_dir, workspace_path, "agents")?;
        copy_agents_to_claude_dir(agents_dir, workspace_path)?;
    }
    if refs_dir.is_dir() {
        copy_directory_to(refs_dir, workspace_path, "references")?;
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

    let (agents_dir, refs_dir) = resolve_prompt_source_dirs(app_handle);

    if !agents_dir.is_dir() && !refs_dir.is_dir() {
        return Ok(());
    }

    copy_prompts_sync(&agents_dir, &refs_dir, workspace_path)?;
    mark_workspace_copied(workspace_path);
    Ok(())
}

/// Copy agent .md files to <workspace>/.claude/agents/ with flattened names.
/// For skill type directories: agents/{type}/{file}.md → .claude/agents/{type}-{file}.md
/// For shared directory: agents/shared/{file}.md → .claude/agents/shared-{file}.md
fn copy_agents_to_claude_dir(agents_src: &Path, workspace_path: &str) -> Result<(), String> {
    let claude_agents_dir = Path::new(workspace_path).join(".claude").join("agents");
    std::fs::create_dir_all(&claude_agents_dir)
        .map_err(|e| format!("Failed to create .claude/agents dir: {}", e))?;

    // Skill type directories
    for skill_type in &["domain", "platform", "source", "data-engineering"] {
        let type_dir = agents_src.join(skill_type);
        if type_dir.is_dir() {
            let entries = std::fs::read_dir(&type_dir)
                .map_err(|e| format!("Failed to read {} dir: {}", skill_type, e))?;
            for entry in entries {
                let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
                let path = entry.path();
                if path.extension().and_then(|e| e.to_str()) == Some("md") {
                    let file_name = entry.file_name().to_string_lossy().to_string();
                    let flattened_name = format!("{}-{}", skill_type, file_name);
                    let dest = claude_agents_dir.join(&flattened_name);
                    std::fs::copy(&path, &dest)
                        .map_err(|e| format!("Failed to copy {} to .claude/agents: {}", path.display(), e))?;
                }
            }
        }
    }

    // Shared directory
    let shared_dir = agents_src.join("shared");
    if shared_dir.is_dir() {
        let entries = std::fs::read_dir(&shared_dir)
            .map_err(|e| format!("Failed to read shared dir: {}", e))?;
        for entry in entries {
            let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("md") {
                let file_name = entry.file_name().to_string_lossy().to_string();
                let flattened_name = format!("shared-{}", file_name);
                let dest = claude_agents_dir.join(&flattened_name);
                std::fs::copy(&path, &dest)
                    .map_err(|e| format!("Failed to copy {} to .claude/agents: {}", path.display(), e))?;
            }
        }
    }

    Ok(())
}

/// Copy .md files from `src_dir` into `<workspace_path>/<dest_name>/`,
/// recursing into subdirectories to preserve the directory structure.
fn copy_directory_to(src_dir: &Path, workspace_path: &str, dest_name: &str) -> Result<(), String> {
    let dest_dir = Path::new(workspace_path).join(dest_name);
    copy_md_files_recursive(src_dir, &dest_dir, dest_name)
}

fn copy_md_files_recursive(src_dir: &Path, dest_dir: &Path, label: &str) -> Result<(), String> {
    std::fs::create_dir_all(dest_dir)
        .map_err(|e| format!("Failed to create {} directory: {}", label, e))?;

    let entries = std::fs::read_dir(src_dir)
        .map_err(|e| format!("Failed to read {} source dir: {}", label, e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read dir entry: {}", e))?;
        let path = entry.path();
        if path.is_dir() {
            let sub_dest = dest_dir.join(entry.file_name());
            copy_md_files_recursive(&path, &sub_dest, label)?;
        } else if path.extension().and_then(|e| e.to_str()) == Some("md") {
            let dest = dest_dir.join(entry.file_name());
            std::fs::copy(&path, &dest).map_err(|e| {
                format!("Failed to copy {}: {}", path.display(), e)
            })?;
        }
    }

    Ok(())
}

/// Read the `name:` field from an agent file's YAML frontmatter.
/// Agent files live at `{workspace}/.claude/agents/{skill_type}-{phase}.md`.
/// Returns `None` if the file doesn't exist or has no `name:` field.
fn read_agent_frontmatter_name(workspace_path: &str, skill_type: &str, phase: &str) -> Option<String> {
    let agent_file = Path::new(workspace_path)
        .join(".claude")
        .join("agents")
        .join(format!("{}-{}.md", skill_type, phase));
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

/// Derive agent name from skill type and prompt template.
/// Reads the deployed agent file's frontmatter `name:` field (the SDK uses
/// this to register the agent). Falls back to `{skill_type}-{phase}` if the
/// file is missing or has no name field.
fn derive_agent_name(workspace_path: &str, skill_type: &str, prompt_template: &str) -> String {
    let phase = prompt_template.trim_end_matches(".md");
    if let Some(name) = read_agent_frontmatter_name(workspace_path, skill_type, phase) {
        return name;
    }
    format!("{}-{}", skill_type, phase)
}

#[allow(clippy::too_many_arguments)]
fn build_prompt(
    _prompt_file: &str,
    output_file: &str,
    skill_name: &str,
    domain: &str,
    workspace_path: &str,
    skills_path: Option<&str>,
    _skill_type: &str,
    author_login: Option<&str>,
    created_at: Option<&str>,
) -> String {
    let base = Path::new(workspace_path);
    let skill_dir = base.join(skill_name);
    let context_dir = if let Some(sp) = skills_path {
        Path::new(sp).join(skill_name).join("context")
    } else {
        skill_dir.join("context")
    };
    let skill_output_dir = if let Some(sp) = skills_path {
        Path::new(sp).join(skill_name)
    } else {
        skill_dir.clone() // fallback: workspace_path/skill_name
    };
    let skill_output_context_dir = skill_output_dir.join("context");
    let shared_context = base.join("references").join("shared-context.md");
    // For build step (output_file starts with "skill/"), use skill_output_dir
    let output_path = if output_file.starts_with("skill/") {
        skill_output_dir.join(output_file.trim_start_matches("skill/"))
    } else {
        // For context files, resolve relative to context_dir's parent (the skill target dir)
        if output_file.starts_with("context/") {
            context_dir.join(output_file.trim_start_matches("context/"))
        } else {
            skill_dir.join(output_file)
        }
    };

    let mut prompt = format!(
        "The domain is: {}. The skill name is: {}. \
         The shared context file is: {}. \
         The skill directory is: {}. \
         The context directory (for reading and writing intermediate files) is: {}. \
         The skill output directory (SKILL.md and references/) is: {}. \
         The skill output context directory (persisted clarifications and decisions) is: {}. \
         Write output to {}.",
        domain,
        skill_name,
        shared_context.display(),
        skill_dir.display(),
        context_dir.display(),
        skill_output_dir.display(),
        skill_output_context_dir.display(),
        output_path.display(),
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

    prompt
}

const VALID_SKILL_TYPES: &[&str] = &["platform", "domain", "source", "data-engineering"];
const VALID_PHASES: &[&str] = &[
    "research-concepts",
    "research-patterns-and-merge",
    "reasoning",
    "build",
    "validate",
    "test",
    "validate-and-test",
    "merge",
    "research-patterns",
    "research-data",
];

#[tauri::command]
pub fn get_agent_prompt(skill_type: String, phase: String) -> Result<String, String> {
    // Validate inputs against allowlists to prevent path traversal
    if !VALID_SKILL_TYPES.contains(&skill_type.as_str()) {
        return Err(format!("Invalid skill type: '{}'", skill_type));
    }
    if !VALID_PHASES.contains(&phase.as_str()) {
        return Err(format!("Invalid phase: '{}'", phase));
    }

    let repo_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|p| p.parent())
        .ok_or("Could not resolve repo root")?
        .to_path_buf();

    let primary = repo_root
        .join("agents")
        .join(&skill_type)
        .join(format!("{}.md", phase));
    let fallback = repo_root
        .join("agents")
        .join("shared")
        .join(format!("{}.md", phase));

    if primary.exists() {
        std::fs::read_to_string(&primary).map_err(|e| e.to_string())
    } else if fallback.exists() {
        std::fs::read_to_string(&fallback).map_err(|e| e.to_string())
    } else {
        Err(format!(
            "Prompt not found for type '{}', phase '{}'",
            skill_type, phase
        ))
    }
}

fn read_api_key(db: &tauri::State<'_, Db>) -> Result<String, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let settings = crate::db::read_settings(&conn)?;
    settings
        .anthropic_api_key
        .ok_or_else(|| "Anthropic API key not configured".to_string())
}

fn read_extended_context(db: &tauri::State<'_, Db>) -> bool {
    let conn = db.0.lock().ok();
    conn.and_then(|c| crate::db::read_settings(&c).ok())
        .map(|s| s.extended_context)
        .unwrap_or(false)
}

fn read_skills_path(db: &tauri::State<'_, Db>) -> Option<String> {
    let conn = db.0.lock().ok()?;
    crate::db::read_settings(&conn).ok()?.skills_path
}

fn thinking_budget_for_step(step_id: u32) -> Option<u32> {
    match step_id {
        0 => Some(8_000),   // research-concepts orchestrator
        2 => Some(8_000),   // research-patterns-and-merge orchestrator
        4 => Some(32_000),  // reasoning — highest priority
        5 => Some(16_000),  // build — complex synthesis
        6 => Some(8_000),   // validate
        _ => None,
    }
}

pub fn build_betas(extended_context: bool, thinking_budget: Option<u32>, model: &str) -> Option<Vec<String>> {
    let mut betas = Vec::new();
    if extended_context {
        betas.push("context-1m-2025-08-07".to_string());
    }
    if thinking_budget.is_some() && !model.contains("opus") {
        betas.push("interleaved-thinking-2025-05-14".to_string());
    }
    if betas.is_empty() { None } else { Some(betas) }
}

/// Return the default model for a given step (from agent front matter).
/// Step 4 (reasoning) uses opus; all other agent steps use sonnet.
fn default_model_for_step(step_id: u32) -> &'static str {
    match step_id {
        4 => "opus",
        _ => "sonnet",
    }
}

fn make_agent_id(skill_name: &str, label: &str) -> String {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!("{}-{}-{}", skill_name, label, ts)
}

#[tauri::command]
pub async fn run_review_step(
    app: tauri::AppHandle,
    pool: tauri::State<'_, SidecarPool>,
    db: tauri::State<'_, Db>,
    skill_name: String,
    step_id: u32,
    domain: String,
    workspace_path: String,
) -> Result<String, String> {
    ensure_workspace_prompts(&app, &workspace_path).await?;

    let step = get_step_config(step_id)?;
    let api_key = read_api_key(&db)?;
    let extended_context = read_extended_context(&db);
    let agent_id = make_agent_id(&skill_name, &format!("review-step{}", step_id));

    let output_path = format!("{}/{}", skill_name, step.output_file);

    let prompt = format!(
        "You are a quality reviewer for a skill-building workflow. \
         Read the file at '{}' and evaluate whether the output is satisfactory. \
         \n\nEvaluate based on:\n\
         1. The file exists and is non-empty\n\
         2. The content is well-structured markdown\n\
         3. The content meaningfully addresses the domain: '{}'\n\
         4. The content follows the expected format (check references/shared-context.md for format guidelines)\n\
         5. The content is substantive (not placeholder or minimal)\n\
         \n\nRespond with EXACTLY one line:\n\
         - If satisfactory: PASS\n\
         - If needs regeneration: RETRY: <brief reason>\n\
         \nDo not write any files. Only read and evaluate.",
        output_path, domain
    );

    let config = SidecarConfig {
        prompt,
        model: Some(resolve_model_id("haiku")),
        api_key,
        cwd: workspace_path,
        allowed_tools: Some(vec!["Read".to_string(), "Glob".to_string()]),
        max_turns: Some(10),
        permission_mode: Some("bypassPermissions".to_string()),
        session_id: None,
        betas: build_betas(extended_context, None, "haiku"),
        max_thinking_tokens: None,
        path_to_claude_code_executable: None,
        agent_name: None,
    };

    sidecar::spawn_sidecar(
        agent_id.clone(),
        config,
        pool.inner().clone(),
        app,
        skill_name,
    )
    .await?;

    Ok(agent_id)
}

/// Core logic for validating decisions.md existence — testable without tauri::State.
/// Checks in order: skill output dir (skillsPath), workspace dir.
/// Returns Ok(()) if found, Err with a clear message if missing.
fn validate_decisions_exist_inner(
    skill_name: &str,
    workspace_path: &str,
    skills_path: Option<&str>,
) -> Result<(), String> {
    // 1. Check skill output directory (primary per VD-405)
    if let Some(sp) = skills_path {
        let path = Path::new(sp).join(skill_name).join("context").join("decisions.md");
        if path.exists() {
            let content = std::fs::read_to_string(&path).unwrap_or_default();
            if !content.trim().is_empty() {
                return Ok(());
            }
        }
    }

    // 2. Check workspace directory (fallback)
    let workspace_decisions = Path::new(workspace_path)
        .join(skill_name)
        .join("context")
        .join("decisions.md");
    if workspace_decisions.exists() {
        let content = std::fs::read_to_string(&workspace_decisions).unwrap_or_default();
        if !content.trim().is_empty() {
            return Ok(());
        }
    }

    Err(
        "Cannot start Build step: decisions.md was not found on the filesystem. \
         The Reasoning step (step 4) must create a decisions file before the Build step can run. \
         Please re-run the Reasoning step first."
            .to_string(),
    )
}

/// Shared settings extracted from the DB, used by `run_workflow_step`.
struct WorkflowSettings {
    skills_path: Option<String>,
    api_key: String,
    extended_context: bool,
    debug_mode: bool,
    extended_thinking: bool,
    skill_type: String,
    author_login: Option<String>,
    created_at: Option<String>,
}

/// Read all workflow settings from the DB in a single lock acquisition.
fn read_workflow_settings(
    db: &Db,
    skill_name: &str,
    step_id: u32,
    workspace_path: &str,
    _resume: bool,
    _rerun: bool,
) -> Result<WorkflowSettings, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    // Read all settings in one pass
    let settings = crate::db::read_settings(&conn)?;
    let skills_path = settings.skills_path;
    let api_key = settings.anthropic_api_key
        .ok_or_else(|| "Anthropic API key not configured".to_string())?;
    let extended_context = settings.extended_context;
    let debug_mode = settings.debug_mode;
    let extended_thinking = settings.extended_thinking;

    // Validate prerequisites (step 5 requires decisions.md)
    if step_id == 5 {
        validate_decisions_exist_inner(skill_name, workspace_path, skills_path.as_deref())?;
    }

    // Get skill type
    let skill_type = crate::db::get_skill_type(&conn, skill_name)?;

    // Read author info from workflow run
    let run_row = crate::db::get_workflow_run(&conn, skill_name)
        .ok()
        .flatten();
    let author_login = run_row.as_ref().and_then(|r| r.author_login.clone());
    let created_at = run_row.as_ref().map(|r| r.created_at.clone());

    Ok(WorkflowSettings {
        skills_path,
        api_key,
        extended_context,
        debug_mode,
        extended_thinking,
        skill_type,
        author_login,
        created_at,
    })
}

/// Core logic for launching a single workflow step. Builds the prompt,
/// constructs the sidecar config, and spawns the agent. Returns the agent_id.
///
/// Used by `run_workflow_step` to avoid duplicating step logic.
#[allow(clippy::too_many_arguments)]
async fn run_workflow_step_inner(
    app: &tauri::AppHandle,
    pool: &SidecarPool,
    skill_name: &str,
    step_id: u32,
    domain: &str,
    workspace_path: &str,
    rerun: bool,
    settings: &WorkflowSettings,
) -> Result<String, String> {
    let step = get_step_config(step_id)?;
    let thinking_budget = if settings.extended_thinking {
        thinking_budget_for_step(step_id)
    } else {
        None
    };
    let mut prompt = build_prompt(
        &step.prompt_template,
        &step.output_file,
        skill_name,
        domain,
        workspace_path,
        settings.skills_path.as_deref(),
        &settings.skill_type,
        settings.author_login.as_deref(),
        settings.created_at.as_deref(),
    );

    // In rerun mode, prepend a marker so the agent knows to summarize
    // existing output before regenerating.
    if rerun {
        prompt = format!("[RERUN MODE]\n\n{}", prompt);
    }

    let agent_name = derive_agent_name(workspace_path, &settings.skill_type, &step.prompt_template);
    let agent_id = make_agent_id(skill_name, &format!("step{}", step_id));

    // Determine the effective model for betas: debug_mode forces sonnet,
    // otherwise use the agent front-matter default for this step.
    let model = if settings.debug_mode {
        resolve_model_id("sonnet")
    } else {
        resolve_model_id(default_model_for_step(step_id))
    };

    let config = SidecarConfig {
        prompt,
        model: if settings.debug_mode { Some(model.clone()) } else { None },
        api_key: settings.api_key.clone(),
        cwd: workspace_path.to_string(),
        allowed_tools: Some(step.allowed_tools),
        max_turns: Some(step.max_turns),
        permission_mode: Some("bypassPermissions".to_string()),
        session_id: None,
        betas: build_betas(settings.extended_context, thinking_budget, &model),
        max_thinking_tokens: thinking_budget,
        path_to_claude_code_executable: None,
        agent_name: Some(agent_name),
    };

    sidecar::spawn_sidecar(
        agent_id.clone(),
        config,
        pool.clone(),
        app.clone(),
        skill_name.to_string(),
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
    domain: String,
    workspace_path: String,
    resume: bool,
    rerun: bool,
) -> Result<String, String> {
    // Ensure prompt files exist in workspace before running
    ensure_workspace_prompts(&app, &workspace_path).await?;

    // Step 0 fresh start — wipe the context directory and all artifacts so
    // the agent doesn't see stale files from a previous workflow run.
    // Skip this when resuming a paused step to preserve partial progress.
    // Also skip when rerunning — we want to keep existing output files intact.
    if step_id == 0 && !resume && !rerun {
        let context_dir = Path::new(&workspace_path).join(&skill_name).join("context");
        if context_dir.is_dir() {
            let _ = std::fs::remove_dir_all(&context_dir);
        }
    }

    let settings = read_workflow_settings(&db, &skill_name, step_id, &workspace_path, resume, rerun)?;

    run_workflow_step_inner(
        &app,
        pool.inner(),
        &skill_name,
        step_id,
        &domain,
        &workspace_path,
        rerun,
        &settings,
    )
    .await
}


#[tauri::command]
pub async fn package_skill(
    skill_name: String,
    workspace_path: String,
    db: tauri::State<'_, Db>,
) -> Result<PackageResult, String> {
    let skills_path = read_skills_path(&db);

    // Determine where the skill files (SKILL.md, references/) live:
    // - If skills_path is set, the build agent wrote directly there
    // - Otherwise, they're in workspace_path/skill_name/
    let source_dir = if let Some(ref sp) = skills_path {
        Path::new(sp).join(&skill_name)
    } else {
        Path::new(&workspace_path).join(&skill_name)
    };

    if !source_dir.exists() {
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
    .map_err(|e| format!("Packaging task failed: {}", e))??;

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
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let run = crate::db::get_workflow_run(&conn, &skill_name)?;
    let steps = crate::db::get_workflow_steps(&conn, &skill_name)?;
    Ok(WorkflowStateResponse { run, steps })
}

#[tauri::command]
pub fn save_workflow_state(
    skill_name: String,
    domain: String,
    current_step: i32,
    status: String,
    skill_type: String,
    step_statuses: Vec<StepStatusUpdate>,
    db: tauri::State<'_, Db>,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    crate::db::save_workflow_run(&conn, &skill_name, &domain, current_step, &status, &skill_type)?;
    for step in &step_statuses {
        crate::db::save_workflow_step(&conn, &skill_name, step.step_id, &step.status)?;
    }
    Ok(())
}

/// Output files produced by each step, relative to the skill directory.
pub fn get_step_output_files(step_id: u32) -> Vec<&'static str> {
    match step_id {
        0 => vec![
            "context/research-entities.md",
            "context/research-metrics.md",
            "context/clarifications-concepts.md",
        ],
        1 => vec![],  // Human review
        2 => vec![
            "context/clarifications-patterns.md",
            "context/clarifications-data.md",
            "context/clarifications.md",
        ],
        3 => vec![],  // Human review
        4 => vec!["context/decisions.md"],
        5 => vec!["SKILL.md"], // Also has references/ dir; path is relative to skill output dir
        6 => vec!["context/agent-validation-log.md", "context/test-skill.md"],
        _ => vec![],
    }
}

/// Check if at least one expected output file exists for a completed step.
/// Returns `true` if the step produced output, `false` if no files were written.
/// Human review steps (1, 3) and refinement (7) always return `true` since they
/// produce no files by design.
#[tauri::command]
pub fn verify_step_output(
    workspace_path: String,
    skill_name: String,
    step_id: u32,
    db: tauri::State<'_, Db>,
) -> Result<bool, String> {
    let files = get_step_output_files(step_id);
    // Steps with no expected output files are always valid
    if files.is_empty() {
        return Ok(true);
    }

    let skills_path = read_skills_path(&db);
    let skill_dir = Path::new(&workspace_path).join(&skill_name);

    let has_output = if step_id == 5 {
        let output_dir = if let Some(ref sp) = skills_path {
            Path::new(sp).join(&skill_name)
        } else {
            skill_dir.clone()
        };
        output_dir.join("SKILL.md").exists() || output_dir.join("references").is_dir()
    } else if skills_path.is_some() && matches!(step_id, 0 | 2 | 4 | 6) {
        let target_dir = Path::new(skills_path.as_ref().unwrap()).join(&skill_name);
        files.iter().any(|f| target_dir.join(f).exists())
    } else {
        files.iter().any(|f| skill_dir.join(f).exists())
    };

    Ok(has_output)
}

/// Delete output files for a single step.
/// For step 5 (build), files are in `skill_output_dir` (skills_path/skill_name or
/// workspace_path/skill_name). For other steps, files are in workspace_path/skill_name.
fn clean_step_output(workspace_path: &str, skill_name: &str, step_id: u32, skills_path: Option<&str>) {
    let skill_dir = Path::new(workspace_path).join(skill_name);

    if step_id == 5 {
        // Step 5 output lives in skill_output_dir
        let skill_output_dir = if let Some(sp) = skills_path {
            Path::new(sp).join(skill_name)
        } else {
            skill_dir.clone()
        };
        if skill_output_dir.exists() {
            for file in get_step_output_files(5) {
                let path = skill_output_dir.join(file);
                if path.exists() {
                    let _ = std::fs::remove_file(&path);
                }
            }
            let refs_dir = skill_output_dir.join("references");
            if refs_dir.is_dir() {
                let _ = std::fs::remove_dir_all(&refs_dir);
            }
            // Clean up .skill zip from skill output dir
            let skill_file = skill_output_dir.join(format!("{}.skill", skill_name));
            if skill_file.exists() {
                let _ = std::fs::remove_file(&skill_file);
            }
        }
        return;
    }

    if !skill_dir.exists() {
        return;
    }

    for file in get_step_output_files(step_id) {
        let path = skill_dir.join(file);
        if path.exists() {
            let _ = std::fs::remove_file(&path);
        }
    }

    // Step 4 (reasoning): also delete the chat session file so reset starts fresh,
    // and remove decisions.md from the skill output directory (skills_path) if it exists.
    if step_id == 4 {
        let session = skill_dir.join("logs").join("reasoning-chat.json");
        if session.exists() {
            let _ = std::fs::remove_file(&session);
        }
        if let Some(sp) = skills_path {
            let skill_output_decisions = Path::new(sp)
                .join(skill_name)
                .join("context")
                .join("decisions.md");
            if skill_output_decisions.exists() {
                let _ = std::fs::remove_file(&skill_output_decisions);
            }
        }
    }
}

/// Delete output files for the given step and all subsequent steps.
fn delete_step_output_files(workspace_path: &str, skill_name: &str, from_step_id: u32, skills_path: Option<&str>) {
    for step_id in from_step_id..=7 {
        clean_step_output(workspace_path, skill_name, step_id, skills_path);
    }
}

#[tauri::command]
pub fn reset_workflow_step(
    workspace_path: String,
    skill_name: String,
    from_step_id: u32,
    db: tauri::State<'_, Db>,
) -> Result<(), String> {
    let skills_path = read_skills_path(&db);
    delete_step_output_files(&workspace_path, &skill_name, from_step_id, skills_path.as_deref());

    // Reset steps in SQLite
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    crate::db::reset_workflow_steps_from(&conn, &skill_name, from_step_id as i32)?;

    // Update the workflow run's current step
    if let Some(run) = crate::db::get_workflow_run(&conn, &skill_name)? {
        crate::db::save_workflow_run(
            &conn,
            &skill_name,
            &run.domain,
            from_step_id as i32,
            "pending",
            &run.skill_type,
        )?;
    }

    Ok(())
}

#[tauri::command]
pub fn preview_step_reset(
    workspace_path: String,
    skill_name: String,
    from_step_id: u32,
    db: tauri::State<'_, Db>,
) -> Result<Vec<crate::types::StepResetPreview>, String> {
    let skills_path = read_skills_path(&db);
    let skill_dir = Path::new(&workspace_path).join(&skill_name);
    let skill_output_dir = if let Some(ref sp) = skills_path {
        Path::new(sp).join(&skill_name)
    } else {
        skill_dir.clone()
    };

    let step_names = [
        "Research Concepts",
        "Concepts Review",
        "Perform Research",
        "Human Review",
        "Reasoning",
        "Build Skill",
        "Validate",
        "Refine",
    ];

    let mut result = Vec::new();
    for step_id in from_step_id..=7 {
        let base_dir = if step_id == 5 { &skill_output_dir } else { &skill_dir };
        let mut existing_files: Vec<String> = Vec::new();

        for file in get_step_output_files(step_id) {
            let path = base_dir.join(file);
            if path.exists() {
                existing_files.push(file.to_string());
            }
        }

        // Step 5: also check references/ directory
        if step_id == 5 {
            let refs_dir = base_dir.join("references");
            if refs_dir.is_dir() {
                existing_files.push("references/".to_string());
            }
        }

        // Step 4: also check reasoning chat session
        if step_id == 4 {
            let session = skill_dir.join("logs").join("reasoning-chat.json");
            if session.exists() {
                existing_files.push("logs/reasoning-chat.json".to_string());
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
        let valid_steps = [0, 2, 4, 5, 6];
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
        assert!(get_step_config(1).is_err());  // Human review
        assert!(get_step_config(3).is_err());  // Human review
        assert!(get_step_config(7).is_err());  // Refinement step (client-side only)
        assert!(get_step_config(8).is_err());  // Beyond last step
        assert!(get_step_config(9).is_err());
        assert!(get_step_config(99).is_err());
    }

    #[test]
    fn test_get_step_config_step7_error_message() {
        let err = get_step_config(7).unwrap_err();
        assert!(err.contains("refinement step"), "Error should mention refinement: {}", err);
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
    fn test_resolve_model_id() {
        assert_eq!(resolve_model_id("sonnet"), "claude-sonnet-4-5-20250929");
        assert_eq!(resolve_model_id("haiku"), "claude-haiku-4-5-20251001");
        assert_eq!(resolve_model_id("opus"), "claude-opus-4-6");
        assert_eq!(resolve_model_id("claude-sonnet-4-5-20250929"), "claude-sonnet-4-5-20250929");
    }

    #[test]
    fn test_build_prompt_without_skills_path() {
        // When skills_path is None, skill_output_dir falls back to workspace_path/skill_name
        let prompt = build_prompt(
            "research-concepts.md",
            "context/clarifications-concepts.md",
            "my-skill",
            "e-commerce",
            "/home/user/.vibedata",
            None,
            "domain",
            None,
            None,
        );
        // Should NOT contain "Read X and Y and follow the instructions"
        assert!(!prompt.contains("Read"));
        assert!(!prompt.contains("follow the instructions"));
        assert!(prompt.contains("e-commerce"));
        assert!(prompt.contains("my-skill"));
        assert!(prompt.contains("The shared context file is: /home/user/.vibedata/references/shared-context.md"));
        assert!(prompt.contains("/home/user/.vibedata/my-skill/context/clarifications-concepts.md"));
        assert!(prompt.contains("The context directory (for reading and writing intermediate files) is: /home/user/.vibedata/my-skill/context"));
        assert!(prompt.contains("The skill directory is: /home/user/.vibedata/my-skill"));
        // Without skills_path, skill output dir is workspace_path/skill_name (no /skill/ subdir)
        assert!(prompt.contains("The skill output directory (SKILL.md and references/) is: /home/user/.vibedata/my-skill"));
    }

    #[test]
    fn test_build_prompt_with_skills_path() {
        // When skills_path is set, skill_output_dir uses skills_path/skill_name
        let prompt = build_prompt(
            "build.md",
            "skill/SKILL.md",
            "my-skill",
            "e-commerce",
            "/home/user/.vibedata",
            Some("/home/user/my-skills"),
            "domain",
            None,
            None,
        );
        // Should NOT contain "Read X and Y and follow the instructions"
        assert!(!prompt.contains("Read"));
        assert!(!prompt.contains("follow the instructions"));
        // skill output directory should use skills_path
        assert!(prompt.contains("The skill output directory (SKILL.md and references/) is: /home/user/my-skills/my-skill"));
        // output path for build step (skill/SKILL.md) should resolve to skills_path/skill_name/SKILL.md
        assert!(prompt.contains("Write output to /home/user/my-skills/my-skill/SKILL.md"));
        // context dir should now point to skills_path when configured
        assert!(prompt.contains("The context directory (for reading and writing intermediate files) is: /home/user/my-skills/my-skill/context"));
        // skill directory should still be workspace-based
        assert!(prompt.contains("The skill directory is: /home/user/.vibedata/my-skill"));
    }

    #[test]
    fn test_build_prompt_with_skills_path_non_build_step() {
        // For non-build steps, output_file doesn't start with "skill/" so output_path
        // should still be in workspace even when skills_path is set
        let prompt = build_prompt(
            "reasoning.md",
            "context/decisions.md",
            "my-skill",
            "e-commerce",
            "/home/user/.vibedata",
            Some("/home/user/my-skills"),
            "domain",
            None,
            None,
        );
        // Should NOT contain "Read X and Y and follow the instructions"
        assert!(!prompt.contains("Read"));
        assert!(!prompt.contains("follow the instructions"));
        // output path should be in skills_path for context files when skills_path is set
        assert!(prompt.contains("Write output to /home/user/my-skills/my-skill/context/decisions.md"));
        // skill output directory should still use skills_path
        assert!(prompt.contains("The skill output directory (SKILL.md and references/) is: /home/user/my-skills/my-skill"));
    }

    #[test]
    fn test_build_prompt_with_skill_type() {
        // Simplified prompt no longer references agents path
        let prompt = build_prompt(
            "research-concepts.md",
            "context/clarifications-concepts.md",
            "my-skill",
            "e-commerce",
            "/home/user/.vibedata",
            None,
            "platform",
            None,
            None,
        );
        // Should NOT contain "Read X and Y and follow the instructions"
        assert!(!prompt.contains("Read"));
        assert!(!prompt.contains("follow the instructions"));
        assert!(prompt.contains("e-commerce"));
        assert!(prompt.contains("my-skill"));
    }

    #[test]
    fn test_build_prompt_with_author_info() {
        let prompt = build_prompt(
            "build.md",
            "skill/SKILL.md",
            "my-skill",
            "e-commerce",
            "/home/user/.vibedata",
            Some("/home/user/my-skills"),
            "domain",
            Some("octocat"),
            Some("2025-06-15T12:00:00Z"),
        );
        assert!(prompt.contains("The author of this skill is: octocat."));
        assert!(prompt.contains("The skill was created on: 2025-06-15."));
        assert!(prompt.contains("Today's date (for the modified timestamp) is:"));
    }

    #[test]
    fn test_build_prompt_without_author_info() {
        let prompt = build_prompt(
            "build.md",
            "skill/SKILL.md",
            "my-skill",
            "e-commerce",
            "/home/user/.vibedata",
            Some("/home/user/my-skills"),
            "domain",
            None,
            None,
        );
        assert!(!prompt.contains("The author of this skill is:"));
        assert!(!prompt.contains("The skill was created on:"));
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

    #[test]
    fn test_copy_directory_to_copies_md_files() {
        let src = tempfile::tempdir().unwrap();
        let dest = tempfile::tempdir().unwrap();

        // Create source .md files at root and in subdirectory
        std::fs::write(src.path().join("shared-context.md"), "# Shared").unwrap();
        std::fs::create_dir_all(src.path().join("domain")).unwrap();
        std::fs::write(src.path().join("domain").join("research-concepts.md"), "# Research").unwrap();
        // Non-.md file should be ignored
        std::fs::write(src.path().join("README.txt"), "ignore me").unwrap();

        let workspace = dest.path().to_str().unwrap();
        copy_directory_to(src.path(), workspace, "agents").unwrap();

        let agents_dir = dest.path().join("agents");
        assert!(agents_dir.is_dir());
        assert!(agents_dir.join("shared-context.md").exists());
        assert!(agents_dir.join("domain").join("research-concepts.md").exists());
        assert!(!agents_dir.join("README.txt").exists());

        // Verify content
        let content = std::fs::read_to_string(agents_dir.join("shared-context.md")).unwrap();
        assert_eq!(content, "# Shared");
    }

    #[test]
    fn test_copy_directory_to_is_idempotent() {
        let src = tempfile::tempdir().unwrap();
        let dest = tempfile::tempdir().unwrap();

        std::fs::write(src.path().join("test.md"), "v1").unwrap();

        let workspace = dest.path().to_str().unwrap();
        copy_directory_to(src.path(), workspace, "agents").unwrap();

        // Update source and copy again — should overwrite
        std::fs::write(src.path().join("test.md"), "v2").unwrap();
        copy_directory_to(src.path(), workspace, "agents").unwrap();

        let content =
            std::fs::read_to_string(dest.path().join("agents").join("test.md")).unwrap();
        assert_eq!(content, "v2");
    }

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
        // Verify subdirectories exist
        assert!(agents_dir.join("domain").is_dir(), "agents/domain/ should exist");
        assert!(agents_dir.join("platform").is_dir(), "agents/platform/ should exist");
        assert!(agents_dir.join("source").is_dir(), "agents/source/ should exist");
        assert!(agents_dir.join("data-engineering").is_dir(), "agents/data-engineering/ should exist");
        assert!(agents_dir.join("shared").is_dir(), "agents/shared/ should exist");
    }

    #[test]
    fn test_delete_step_output_files_from_step_onwards() {
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        let skill_dir = tmp.path().join("my-skill");
        std::fs::create_dir_all(skill_dir.join("context")).unwrap();
        // Step 5 output is now directly in skill_dir (no skill/ subdir)
        std::fs::create_dir_all(skill_dir.join("references")).unwrap();

        // Create output files for steps 0, 2, 4, 5
        std::fs::write(
            skill_dir.join("context/clarifications-concepts.md"),
            "step0",
        )
        .unwrap();
        std::fs::write(
            skill_dir.join("context/clarifications-patterns.md"),
            "step2",
        )
        .unwrap();
        std::fs::write(
            skill_dir.join("context/clarifications-data.md"),
            "step2",
        )
        .unwrap();
        std::fs::write(skill_dir.join("context/clarifications.md"), "step2").unwrap();
        std::fs::write(skill_dir.join("context/decisions.md"), "step4").unwrap();
        std::fs::write(skill_dir.join("SKILL.md"), "step5").unwrap();
        std::fs::write(skill_dir.join("references/ref.md"), "ref").unwrap();

        // Reset from step 4 onwards — steps 0, 2 should be preserved
        // No skills_path set, so step 5 files are in workspace_path/skill_name/
        delete_step_output_files(workspace, "my-skill", 4, None);

        // Steps 0, 2 outputs should still exist
        assert!(skill_dir.join("context/clarifications-concepts.md").exists());
        assert!(skill_dir.join("context/clarifications.md").exists());

        // Steps 4+ outputs should be deleted
        assert!(!skill_dir.join("context/decisions.md").exists());
        assert!(!skill_dir.join("SKILL.md").exists());
        assert!(!skill_dir.join("references").exists());
    }

    #[test]
    fn test_clean_step_output_step2_removes_merged_clarifications() {
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        let skill_dir = tmp.path().join("my-skill");
        std::fs::create_dir_all(skill_dir.join("context")).unwrap();

        // Step 2 output is only the merged clarifications (temp files
        // are cleaned up by the agent, not tracked as step outputs)
        std::fs::write(skill_dir.join("context/clarifications.md"), "m").unwrap();
        std::fs::write(skill_dir.join("context/decisions.md"), "step4").unwrap();

        // Clean only step 2 — step 4 should be untouched
        clean_step_output(workspace, "my-skill", 2, None);

        assert!(!skill_dir.join("context/clarifications.md").exists());
        assert!(skill_dir.join("context/decisions.md").exists());
    }

    #[test]
    fn test_delete_step_output_files_nonexistent_dir_is_ok() {
        // Should not panic on nonexistent directory
        delete_step_output_files("/tmp/nonexistent", "no-skill", 0, None);
    }

    #[test]
    fn test_delete_step_output_files_cleans_last_steps() {
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        let skill_dir = tmp.path().join("my-skill");
        std::fs::create_dir_all(skill_dir.join("context")).unwrap();

        // Create files for step 6 (validate)
        std::fs::write(skill_dir.join("context/agent-validation-log.md"), "step6").unwrap();
        std::fs::write(skill_dir.join("context/test-skill.md"), "step6").unwrap();

        // Reset from step 6 onwards should clean up through step 7
        delete_step_output_files(workspace, "my-skill", 6, None);

        // Step 6 outputs should be deleted
        assert!(!skill_dir.join("context/agent-validation-log.md").exists());
        assert!(!skill_dir.join("context/test-skill.md").exists());
    }

    #[test]
    fn test_delete_step_output_files_includes_step7() {
        // Verify the loop range extends to step 7 (refine step)
        // by confirming delete_step_output_files(from=7) doesn't panic
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        std::fs::create_dir_all(tmp.path().join("my-skill")).unwrap();
        delete_step_output_files(workspace, "my-skill", 7, None);
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
        // Without deployed agent files, falls back to {skill_type}-{phase}
        let tmp = tempfile::tempdir().unwrap();
        let ws = tmp.path().to_str().unwrap();
        assert_eq!(
            derive_agent_name(ws, "domain", "research-concepts.md"),
            "domain-research-concepts"
        );
        assert_eq!(
            derive_agent_name(ws, "platform", "build.md"),
            "platform-build"
        );
    }

    #[test]
    fn test_derive_agent_name_reads_frontmatter() {
        let tmp = tempfile::tempdir().unwrap();
        let ws = tmp.path().to_str().unwrap();
        let agents_dir = tmp.path().join(".claude").join("agents");
        std::fs::create_dir_all(&agents_dir).unwrap();

        // Write an agent file with a frontmatter name that differs from the filename
        std::fs::write(
            agents_dir.join("data-engineering-research-patterns-and-merge.md"),
            "---\nname: de-research-patterns-and-merge\nmodel: sonnet\n---\n# Agent\n",
        ).unwrap();

        assert_eq!(
            derive_agent_name(ws, "data-engineering", "research-patterns-and-merge.md"),
            "de-research-patterns-and-merge"
        );
    }

    #[test]
    fn test_copy_agents_to_claude_dir() {
        let src = tempfile::tempdir().unwrap();
        let workspace = tempfile::tempdir().unwrap();

        // Create skill type directories with agent files
        std::fs::create_dir_all(src.path().join("domain")).unwrap();
        std::fs::create_dir_all(src.path().join("platform")).unwrap();
        std::fs::create_dir_all(src.path().join("shared")).unwrap();

        std::fs::write(
            src.path().join("domain").join("research-concepts.md"),
            "# Domain Research",
        )
        .unwrap();
        std::fs::write(
            src.path().join("platform").join("build.md"),
            "# Platform Build",
        )
        .unwrap();
        std::fs::write(
            src.path().join("shared").join("merge.md"),
            "# Shared Merge",
        )
        .unwrap();

        // Non-.md file should be ignored
        std::fs::write(
            src.path().join("domain").join("README.txt"),
            "ignore me",
        )
        .unwrap();

        let workspace_path = workspace.path().to_str().unwrap();
        copy_agents_to_claude_dir(src.path(), workspace_path).unwrap();

        let claude_agents_dir = workspace.path().join(".claude").join("agents");
        assert!(claude_agents_dir.is_dir());

        // Verify flattened names
        assert!(claude_agents_dir.join("domain-research-concepts.md").exists());
        assert!(claude_agents_dir.join("platform-build.md").exists());
        assert!(claude_agents_dir.join("shared-merge.md").exists());

        // Non-.md file should NOT be copied
        assert!(!claude_agents_dir.join("domain-README.txt").exists());

        // Verify content
        let content = std::fs::read_to_string(
            claude_agents_dir.join("domain-research-concepts.md"),
        )
        .unwrap();
        assert_eq!(content, "# Domain Research");
    }

    // --- build_prompt skill output context path tests ---

    #[test]
    fn test_build_prompt_contains_skill_output_context_path() {
        let prompt = build_prompt(
            "research-concepts.md",
            "context/clarifications-concepts.md",
            "my-skill",
            "e-commerce",
            "/home/user/.vibedata",
            Some("/home/user/my-skills"),
            "domain",
            None,
            None,
        );
        assert!(prompt.contains(
            "The skill output context directory (persisted clarifications and decisions) is: /home/user/my-skills/my-skill/context"
        ));
    }

    #[test]
    fn test_build_prompt_context_path_without_skills_path() {
        // When skills_path is None, skill output context dir falls back to workspace-based path
        let prompt = build_prompt(
            "reasoning.md",
            "context/decisions.md",
            "my-skill",
            "analytics",
            "/workspace",
            None,
            "domain",
            None,
            None,
        );
        assert!(prompt.contains(
            "The skill output context directory (persisted clarifications and decisions) is: /workspace/my-skill/context"
        ));
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
            source_dir.join("context").join("clarifications-concepts.md"),
            "# Concepts",
        ).unwrap();
        std::fs::write(
            source_dir.join("context").join("clarifications.md"),
            "# Merged",
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
    fn test_validate_decisions_missing_everywhere() {
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().join("workspace");
        std::fs::create_dir_all(workspace.join("my-skill").join("context")).unwrap();

        let result = validate_decisions_exist_inner(
            "my-skill",
            workspace.to_str().unwrap(),
            None,
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("decisions.md was not found"));
    }

    #[test]
    fn test_validate_decisions_found_in_skills_path() {
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().join("workspace");
        let skills = tmp.path().join("skills");
        std::fs::create_dir_all(workspace.join("my-skill").join("context")).unwrap();
        std::fs::create_dir_all(skills.join("my-skill").join("context")).unwrap();
        std::fs::write(
            skills.join("my-skill").join("context").join("decisions.md"),
            "# Decisions\n\nD1: Use periodic recognition",
        ).unwrap();

        let result = validate_decisions_exist_inner(
            "my-skill",
            workspace.to_str().unwrap(),
            Some(skills.to_str().unwrap()),
        );
        assert!(result.is_ok());
    }

    #[test]
    fn test_validate_decisions_found_in_workspace() {
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().join("workspace");
        std::fs::create_dir_all(workspace.join("my-skill").join("context")).unwrap();
        std::fs::write(
            workspace.join("my-skill").join("context").join("decisions.md"),
            "# Decisions\n\nD1: Use periodic recognition",
        ).unwrap();

        let result = validate_decisions_exist_inner(
            "my-skill",
            workspace.to_str().unwrap(),
            None,
        );
        assert!(result.is_ok());
    }

    #[test]
    fn test_validate_decisions_rejects_empty_file() {
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().join("workspace");
        std::fs::create_dir_all(workspace.join("my-skill").join("context")).unwrap();
        // Write an empty decisions file
        std::fs::write(
            workspace.join("my-skill").join("context").join("decisions.md"),
            "   \n\n  ",
        ).unwrap();

        let result = validate_decisions_exist_inner(
            "my-skill",
            workspace.to_str().unwrap(),
            None,
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("decisions.md was not found"));
    }

    #[test]
    fn test_validate_decisions_priority_order() {
        // skills_path takes priority over workspace
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().join("workspace");
        let skills = tmp.path().join("skills");
        std::fs::create_dir_all(workspace.join("my-skill").join("context")).unwrap();
        std::fs::create_dir_all(skills.join("my-skill").join("context")).unwrap();

        // Only write to skills_path (primary)
        std::fs::write(
            skills.join("my-skill").join("context").join("decisions.md"),
            "# Decisions from skills path",
        ).unwrap();
        // workspace has no decisions.md

        let result = validate_decisions_exist_inner(
            "my-skill",
            workspace.to_str().unwrap(),
            Some(skills.to_str().unwrap()),
        );
        assert!(result.is_ok());
    }

    // --- debug mode: no reduced turns, sonnet model override ---

    #[test]
    fn test_debug_max_turns_removed() {
        // debug_max_turns no longer exists as a function. This test verifies
        // that get_step_config returns the *normal* turn limits for every step,
        // which is what run_workflow_step now uses unconditionally.
        let expected: Vec<(u32, u32)> = vec![
            (0, 50),   // research concepts
            (2, 50),   // research patterns
            (4, 100),  // reasoning
            (5, 120),  // build
            (6, 120),  // validate
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
    fn test_resolve_model_id_sonnet_returns_full_id() {
        // The sonnet shorthand is used for debug mode model override
        let sonnet_id = resolve_model_id("sonnet");
        assert_eq!(sonnet_id, "claude-sonnet-4-5-20250929");
        assert!(sonnet_id.contains("sonnet"), "Sonnet model ID should contain 'sonnet'");
    }

    #[test]
    fn test_debug_mode_model_override_logic() {
        // Verify the model selection logic used in run_workflow_step:
        // debug_mode=true  → Some(resolve_model_id("sonnet"))
        // debug_mode=false → None (agent front matter model is used)

        let debug_mode = true;
        let model: Option<String> = if debug_mode { Some(resolve_model_id("sonnet")) } else { None };
        assert_eq!(model, Some("claude-sonnet-4-5-20250929".to_string()));

        let debug_mode = false;
        let model: Option<String> = if debug_mode { Some(resolve_model_id("sonnet")) } else { None };
        assert_eq!(model, None);
    }

    #[test]
    fn test_step_max_turns_unchanged_regardless_of_debug() {
        // Ensure every agent step has the same max_turns value
        // regardless of any debug flag — debug mode no longer reduces turns.
        let steps_with_expected_turns = [
            (0, 50),
            (2, 50),
            (4, 100),
            (5, 120),
            (6, 120),
        ];
        for (step_id, normal_turns) in steps_with_expected_turns {
            let config = get_step_config(step_id).unwrap();
            // In the old code, debug mode would have reduced these values.
            // Now they should always be the normal values.
            assert_eq!(
                config.max_turns, normal_turns,
                "Step {} max_turns should always be {} (not reduced for debug)",
                step_id, normal_turns
            );
        }
    }

    // --- VD-407: rerun mode tests ---

    #[test]
    fn test_rerun_prompt_prepending() {
        // When rerun is true, the prompt should be prepended with [RERUN MODE]
        let base_prompt = build_prompt(
            "research-concepts.md",
            "context/clarifications-concepts.md",
            "my-skill",
            "e-commerce",
            "/home/user/.vibedata",
            None,
            "domain",
            None,
            None,
        );

        // Simulate the rerun logic from run_workflow_step
        let rerun_prompt = format!("[RERUN MODE]\n\n{}", &base_prompt);

        assert!(rerun_prompt.starts_with("[RERUN MODE]\n\n"));
        assert!(rerun_prompt.contains("e-commerce"));
        assert!(rerun_prompt.contains("my-skill"));
        // The original prompt content should follow the rerun marker
        assert!(rerun_prompt.contains("The domain is: e-commerce"));
    }

    #[test]
    fn test_rerun_prompt_not_prepended_when_false() {
        // When rerun is false, the prompt should NOT have [RERUN MODE]
        let prompt = build_prompt(
            "build.md",
            "skill/SKILL.md",
            "my-skill",
            "analytics",
            "/workspace",
            None,
            "domain",
            None,
            None,
        );
        assert!(!prompt.contains("[RERUN MODE]"));
    }

    #[test]
    fn test_rerun_mode_preserves_step0_context() {
        // In rerun mode, step 0 should NOT wipe the context directory.
        // We verify this by checking the condition: step_id == 0 && !resume && !rerun
        // When rerun=true, the condition is false, so context is preserved.
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        let skill_dir = tmp.path().join("my-skill");
        std::fs::create_dir_all(skill_dir.join("context")).unwrap();

        // Write a context file that should survive rerun
        std::fs::write(
            skill_dir.join("context/clarifications-concepts.md"),
            "# Existing concepts from previous run",
        ).unwrap();

        // Simulate the rerun guard: when rerun=true, we skip the wipe
        let step_id: u32 = 0;
        let resume = false;
        let rerun = true;
        if step_id == 0 && !resume && !rerun {
            let context_dir = Path::new(workspace).join("my-skill").join("context");
            if context_dir.is_dir() {
                let _ = std::fs::remove_dir_all(&context_dir);
            }
        }

        // Context file should still exist
        assert!(skill_dir.join("context/clarifications-concepts.md").exists());
        let content = std::fs::read_to_string(
            skill_dir.join("context/clarifications-concepts.md"),
        ).unwrap();
        assert_eq!(content, "# Existing concepts from previous run");
    }

    #[test]
    fn test_normal_mode_wipes_step0_context() {
        // Confirm that without rerun, step 0 context IS wiped (baseline behavior)
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        let skill_dir = tmp.path().join("my-skill");
        std::fs::create_dir_all(skill_dir.join("context")).unwrap();

        std::fs::write(
            skill_dir.join("context/clarifications-concepts.md"),
            "# Will be wiped",
        ).unwrap();

        let step_id: u32 = 0;
        let resume = false;
        let rerun = false;
        if step_id == 0 && !resume && !rerun {
            let context_dir = Path::new(workspace).join("my-skill").join("context");
            if context_dir.is_dir() {
                let _ = std::fs::remove_dir_all(&context_dir);
            }
        }

        // Context directory should have been wiped
        assert!(!skill_dir.join("context/clarifications-concepts.md").exists());
    }

    #[test]
    fn test_rerun_prompt_for_all_agent_steps() {
        // Verify rerun prompt works correctly for every agent step
        let agent_steps: Vec<(u32, &str, &str)> = vec![
            (0, "research-concepts.md", "context/clarifications-concepts.md"),
            (2, "research-patterns-and-merge.md", "context/clarifications.md"),
            (4, "reasoning.md", "context/decisions.md"),
            (5, "build.md", "skill/SKILL.md"),
            (6, "validate-and-test.md", "context/agent-validation-log.md"),
        ];

        for (step_id, prompt_template, output_file) in agent_steps {
            let base_prompt = build_prompt(
                prompt_template,
                output_file,
                "test-skill",
                "test-domain",
                "/workspace",
                None,
                "domain",
                None,
                None,
            );
            let rerun_prompt = format!("[RERUN MODE]\n\n{}", &base_prompt);

            assert!(
                rerun_prompt.starts_with("[RERUN MODE]\n\n"),
                "Step {} rerun prompt should start with [RERUN MODE]",
                step_id,
            );
            assert!(
                rerun_prompt.contains("test-domain"),
                "Step {} rerun prompt should contain domain",
                step_id,
            );
        }
    }

    #[test]
    fn test_thinking_budget_for_step() {
        assert_eq!(thinking_budget_for_step(0), Some(8_000));
        assert_eq!(thinking_budget_for_step(2), Some(8_000));
        assert_eq!(thinking_budget_for_step(4), Some(32_000));
        assert_eq!(thinking_budget_for_step(5), Some(16_000));
        assert_eq!(thinking_budget_for_step(6), Some(8_000));
        // Human review steps and beyond return None
        assert_eq!(thinking_budget_for_step(1), None);
        assert_eq!(thinking_budget_for_step(3), None);
        assert_eq!(thinking_budget_for_step(7), None);
    }

    #[test]
    fn test_build_betas_context_only() {
        let betas = build_betas(true, None, "claude-sonnet-4-5-20250929");
        assert_eq!(betas, Some(vec!["context-1m-2025-08-07".to_string()]));
    }

    #[test]
    fn test_build_betas_thinking_non_opus() {
        let betas = build_betas(false, Some(32000), "claude-sonnet-4-5-20250929");
        assert_eq!(betas, Some(vec!["interleaved-thinking-2025-05-14".to_string()]));
    }

    #[test]
    fn test_build_betas_thinking_opus() {
        // Opus natively supports thinking — no interleaved-thinking beta needed
        let betas = build_betas(false, Some(32000), "claude-opus-4-6");
        assert_eq!(betas, None);
    }

    #[test]
    fn test_build_betas_both() {
        let betas = build_betas(true, Some(32000), "claude-sonnet-4-5-20250929");
        assert_eq!(betas, Some(vec![
            "context-1m-2025-08-07".to_string(),
            "interleaved-thinking-2025-05-14".to_string(),
        ]));
    }

    #[test]
    fn test_build_betas_none() {
        let betas = build_betas(false, None, "claude-sonnet-4-5-20250929");
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

}
