use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use crate::agents::sidecar::{self, SidecarConfig};
use crate::agents::sidecar_pool::SidecarPool;
use crate::db::Db;
use crate::types::{
    ArtifactRow, PackageResult, StepConfig, StepStatusUpdate,
    WorkflowStateResponse,
};

const FULL_TOOLS: &[&str] = &["Read", "Write", "Edit", "Glob", "Grep", "Bash", "Task", "Skill"];

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
            prompt_template: "validate.md".to_string(),
            output_file: "context/agent-validation-log.md".to_string(),
            allowed_tools: FULL_TOOLS.iter().map(|s| s.to_string()).collect(),
            max_turns: 80,
        }),
        7 => Ok(StepConfig {
            step_id: 7,
            name: "Test".to_string(),
            prompt_template: "test.md".to_string(),
            output_file: "context/test-skill.md".to_string(),
            allowed_tools: FULL_TOOLS.iter().map(|s| s.to_string()).collect(),
            max_turns: 80,
        }),
        _ => Err(format!(
            "Unknown step_id {}. Steps 1 and 3 are human review steps; step 8 is the refinement step (client-side only).",
            step_id
        )),
    }
}

/// Copy bundled agent .md files and references into workspace.
/// Creates the directories if they don't exist. Overwrites existing files
/// to keep them in sync with the app version.
///
/// Resolution order:
/// 1. Dev mode: repo root from `CARGO_MANIFEST_DIR` (compile-time path)
/// 2. Production: Tauri resource directory (bundled in the app)
pub fn ensure_workspace_prompts(
    app_handle: &tauri::AppHandle,
    workspace_path: &str,
) -> Result<(), String> {
    use tauri::Manager;

    // Try dev mode first: resolve from CARGO_MANIFEST_DIR (only works during development)
    let repo_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent() // app/
        .and_then(|p| p.parent()) // repo root
        .map(|p| p.to_path_buf());

    let agents_src = repo_root.as_ref().map(|r| r.join("agents"));
    let refs_src = repo_root.as_ref().map(|r| r.join("references"));

    // Fall back to Tauri resource directory for production builds
    let resource_agents;
    let resource_refs;
    let agents_dir = match agents_src {
        Some(ref p) if p.is_dir() => p.as_path(),
        _ => {
            resource_agents = app_handle
                .path()
                .resource_dir()
                .map(|r| r.join("agents"))
                .unwrap_or_default();
            if resource_agents.is_dir() {
                resource_agents.as_path()
            } else {
                return Ok(()); // No agents found anywhere — skip silently
            }
        }
    };

    let refs_dir = match refs_src {
        Some(ref p) if p.is_dir() => p.as_path(),
        _ => {
            resource_refs = app_handle
                .path()
                .resource_dir()
                .map(|r| r.join("references"))
                .unwrap_or_default();
            if resource_refs.is_dir() {
                resource_refs.as_path()
            } else {
                Path::new("") // Will fail is_dir check below
            }
        }
    };

    // Copy agents/ directory
    if agents_dir.is_dir() {
        copy_directory_to(agents_dir, workspace_path, "agents")?;
        // Also copy to .claude/agents/ with flattened names for SDK loading
        copy_agents_to_claude_dir(agents_dir, workspace_path)?;
    }

    // Copy references/ directory
    if refs_dir.is_dir() {
        copy_directory_to(refs_dir, workspace_path, "references")?;
    }

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

/// Derive agent name from skill type and prompt template.
/// Example: skill_type="domain", prompt_template="research-concepts.md" → "domain-research-concepts"
fn derive_agent_name(skill_type: &str, prompt_template: &str) -> String {
    let phase = prompt_template.trim_end_matches(".md");
    format!("{}-{}", skill_type, phase)
}

fn build_prompt(
    _prompt_file: &str,
    output_file: &str,
    skill_name: &str,
    domain: &str,
    workspace_path: &str,
    skills_path: Option<&str>,
    _skill_type: &str,
) -> String {
    let base = Path::new(workspace_path);
    let skill_dir = base.join(skill_name);
    let context_dir = skill_dir.join("context");
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
        skill_dir.join(output_file)
    };

    format!(
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
    )
}

const VALID_SKILL_TYPES: &[&str] = &["platform", "domain", "source", "data-engineering"];
const VALID_PHASES: &[&str] = &[
    "research-concepts",
    "research-patterns-and-merge",
    "reasoning",
    "build",
    "validate",
    "test",
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

fn read_debug_mode(db: &tauri::State<'_, Db>) -> bool {
    let conn = db.0.lock().ok();
    conn.and_then(|c| crate::db::read_settings(&c).ok())
        .map(|s| s.debug_mode)
        .unwrap_or(false)
}

fn read_skills_path(db: &tauri::State<'_, Db>) -> Option<String> {
    let conn = db.0.lock().ok()?;
    crate::db::read_settings(&conn).ok()?.skills_path
}

fn read_extended_thinking(db: &tauri::State<'_, Db>) -> bool {
    let conn = db.0.lock().ok();
    conn.and_then(|c| crate::db::read_settings(&c).ok())
        .map(|s| s.extended_thinking)
        .unwrap_or(false)
}

fn thinking_budget_for_step(step_id: u32) -> Option<u32> {
    match step_id {
        0 => Some(8_000),   // research-concepts orchestrator
        2 => Some(8_000),   // research-patterns-and-merge orchestrator
        4 => Some(32_000),  // reasoning — highest priority
        5 => Some(16_000),  // build — complex synthesis
        6 => Some(8_000),   // validate
        7 => Some(8_000),   // test
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

/// Write all DB artifacts for a skill to the workspace filesystem.
/// This stages files so agents can read them during execution.
/// Skips files that already exist on disk with the same byte length.
/// Context files (clarifications, decisions) are also written to the
/// skill output directory (`skills_path/skill_name/context/`) when `skills_path` is set.
fn stage_artifacts(
    conn: &rusqlite::Connection,
    skill_name: &str,
    workspace_path: &str,
    skills_path: Option<&str>,
) -> Result<(), String> {
    let artifacts = crate::db::get_skill_artifacts(conn, skill_name)?;
    let skill_dir = Path::new(workspace_path).join(skill_name);

    // Ensure context/ directory exists
    std::fs::create_dir_all(skill_dir.join("context"))
        .map_err(|e| format!("Failed to create context dir: {}", e))?;

    // Context files that should also be written to skill output dir
    let context_files: &[&str] = &[
        "context/clarifications-concepts.md",
        "context/clarifications.md",
        "context/decisions.md",
    ];

    // Create skill output context dir if skills_path is set
    let skill_output_context_dir = skills_path.map(|sp| {
        let dir = Path::new(sp).join(skill_name).join("context");
        let _ = std::fs::create_dir_all(&dir);
        dir
    });

    for artifact in &artifacts {
        let file_path = skill_dir.join(&artifact.relative_path);

        // Skip if file already exists with same size (content unchanged)
        let needs_write = match std::fs::metadata(&file_path) {
            Ok(meta) => meta.len() != artifact.content.len() as u64,
            Err(_) => true,
        };

        if needs_write {
            if let Some(parent) = file_path.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("Failed to create dir {}: {}", parent.display(), e))?;
            }
            std::fs::write(&file_path, &artifact.content)
                .map_err(|e| format!("Failed to write {}: {}", file_path.display(), e))?;
        }

        // Also write context files to skill output dir
        if let Some(ref ctx_dir) = skill_output_context_dir {
            if context_files.contains(&artifact.relative_path.as_str()) {
                let filename = Path::new(&artifact.relative_path)
                    .file_name()
                    .ok_or_else(|| format!("No filename in {}", artifact.relative_path))?;
                let dest = ctx_dir.join(filename);

                // Skip if already up to date
                let output_needs_write = match std::fs::metadata(&dest) {
                    Ok(meta) => meta.len() != artifact.content.len() as u64,
                    Err(_) => true,
                };
                if output_needs_write {
                    std::fs::write(&dest, &artifact.content)
                        .map_err(|e| format!("Failed to write {}: {}", dest.display(), e))?;
                }
            }
        }
    }

    Ok(())
}

/// Reconcile disk → SQLite: scan the workspace for existing step artifacts
/// and capture any that aren't already in the DB (or differ in size).
/// This handles the case where the app was shut down mid-agent and files
/// were written to disk but never captured.
fn reconcile_disk_artifacts(
    conn: &rusqlite::Connection,
    skill_name: &str,
    workspace_path: &str,
) -> Result<(), String> {
    let skill_dir = Path::new(workspace_path).join(skill_name);
    if !skill_dir.exists() {
        return Ok(());
    }

    // Walk all steps that produce output files
    for step_id in [0u32, 2, 4, 5, 6, 7] {
        for file in get_step_output_files(step_id) {
            reconcile_single_file(conn, skill_name, step_id, &skill_dir, file)?;
        }

        // Step 5 also has references/ directory in skill output dir
        if step_id == 5 {
            let refs_dir = skill_dir.join("references");
            if refs_dir.is_dir() {
                for entry in walk_md_paths(&refs_dir, "references")? {
                    reconcile_single_file(
                        conn,
                        skill_name,
                        step_id,
                        &skill_dir,
                        &entry,
                    )?;
                }
            }
        }
    }

    Ok(())
}

/// Reconcile a single file: skip if DB already has it with the same size.
fn reconcile_single_file(
    conn: &rusqlite::Connection,
    skill_name: &str,
    step_id: u32,
    skill_dir: &Path,
    relative_path: &str,
) -> Result<(), String> {
    let path = skill_dir.join(relative_path);
    if !path.exists() {
        return Ok(());
    }

    let disk_size = std::fs::metadata(&path)
        .map(|m| m.len())
        .unwrap_or(0);

    // Skip if DB already has this artifact with the same size
    if let Ok(Some(existing)) = crate::db::get_artifact_by_path(conn, skill_name, relative_path) {
        if existing.size_bytes as u64 == disk_size {
            return Ok(());
        }
    }

    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read {}: {}", path.display(), e))?;
    crate::db::save_artifact(conn, skill_name, step_id as i32, relative_path, &content)?;
    Ok(())
}

/// Recursively collect .md file relative paths from a directory.
fn walk_md_paths(dir: &Path, prefix: &str) -> Result<Vec<String>, String> {
    let mut results = Vec::new();
    let entries = std::fs::read_dir(dir)
        .map_err(|e| format!("Failed to read dir {}: {}", dir.display(), e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read dir entry: {}", e))?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        let relative = if prefix.is_empty() {
            name.clone()
        } else {
            format!("{}/{}", prefix, name)
        };

        if path.is_dir() {
            results.extend(walk_md_paths(&path, &relative)?);
        } else if path.extension().and_then(|e| e.to_str()) == Some("md") {
            results.push(relative);
        }
    }

    Ok(results)
}

/// Recursively collect .md files from a directory, returning relative paths and content.
fn walk_md_files(dir: &Path, prefix: &str) -> Result<Vec<(String, String)>, String> {
    let mut results = Vec::new();
    let entries = std::fs::read_dir(dir)
        .map_err(|e| format!("Failed to read dir {}: {}", dir.display(), e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read dir entry: {}", e))?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        let relative = if prefix.is_empty() {
            name.clone()
        } else {
            format!("{}/{}", prefix, name)
        };

        if path.is_dir() {
            results.extend(walk_md_files(&path, &relative)?);
        } else if path.extension().and_then(|e| e.to_str()) == Some("md") {
            let content = std::fs::read_to_string(&path)
                .map_err(|e| format!("Failed to read {}: {}", path.display(), e))?;
            results.push((relative, content));
        }
    }

    Ok(results)
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
    ensure_workspace_prompts(&app, &workspace_path)?;

    // Stage DB artifacts to filesystem before running agent
    let skills_path = read_skills_path(&db);
    {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        stage_artifacts(&conn, &skill_name, &workspace_path, skills_path.as_deref())?;
    }

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
/// Checks in order: skill output dir (skillsPath), workspace dir, SQLite artifact.
/// Returns Ok(()) if found, Err with a clear message if missing.
fn validate_decisions_exist_inner(
    skill_name: &str,
    workspace_path: &str,
    skills_path: Option<&str>,
    conn: &rusqlite::Connection,
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

    // 3. Check SQLite artifact (last resort)
    if let Ok(Some(artifact)) = crate::db::get_artifact_by_path(conn, skill_name, "context/decisions.md") {
        if !artifact.content.trim().is_empty() {
            return Ok(());
        }
    }

    Err(
        "Cannot start Build step: decisions.md was not found. \
         The Reasoning step (step 5) must create a decisions file before the Build step can run. \
         Please re-run the Reasoning step first."
            .to_string(),
    )
}

/// Tauri command wrapper for decisions validation.
fn validate_decisions_exist(
    skill_name: &str,
    workspace_path: &str,
    skills_path: Option<&str>,
    db: &tauri::State<'_, Db>,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    validate_decisions_exist_inner(skill_name, workspace_path, skills_path, &conn)
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
    ensure_workspace_prompts(&app, &workspace_path)?;

    // Step 0 fresh start — wipe the context directory and all artifacts so
    // the agent doesn't see stale files from a previous workflow run.
    // Skip this when resuming a paused step to preserve partial progress.
    // Also skip when rerunning — we want to keep existing output files intact.
    if step_id == 0 && !resume && !rerun {
        let context_dir = Path::new(&workspace_path).join(&skill_name).join("context");
        if context_dir.is_dir() {
            let _ = std::fs::remove_dir_all(&context_dir);
        }
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        crate::db::delete_artifacts_from(&conn, &skill_name, 0)?;
    }

    // Reconcile disk → DB (captures partial output from paused/interrupted runs),
    // then stage all DB artifacts → disk so the agent sees prerequisites and
    // any previously written partial output.
    let skills_path = read_skills_path(&db);
    {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        reconcile_disk_artifacts(&conn, &skill_name, &workspace_path)?;
        stage_artifacts(&conn, &skill_name, &workspace_path, skills_path.as_deref())?;
    }

    // Validate that prerequisite files exist before starting certain steps.
    // Step 5 (Build) requires decisions.md from step 4 (Reasoning).
    if step_id == 5 {
        validate_decisions_exist(&skill_name, &workspace_path, skills_path.as_deref(), &db)?;
    }

    let step = get_step_config(step_id)?;
    let api_key = read_api_key(&db)?;
    let extended_context = read_extended_context(&db);
    let debug_mode = read_debug_mode(&db);
    let extended_thinking = read_extended_thinking(&db);
    let thinking_budget = if extended_thinking {
        thinking_budget_for_step(step_id)
    } else {
        None
    };
    let skill_type = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        crate::db::get_skill_type(&conn, &skill_name)?
    };
    let mut prompt = build_prompt(&step.prompt_template, &step.output_file, &skill_name, &domain, &workspace_path, skills_path.as_deref(), &skill_type);

    // In rerun mode, prepend a marker so the agent knows to summarize
    // existing output before regenerating.
    if rerun {
        prompt = format!("[RERUN MODE]\n\n{}", prompt);
    }

    let agent_name = derive_agent_name(&skill_type, &step.prompt_template);
    let agent_id = make_agent_id(&skill_name, &format!("step{}", step_id));

    // Determine the effective model for betas: debug_mode forces sonnet,
    // otherwise use the agent front-matter default for this step.
    let model = if debug_mode {
        resolve_model_id("sonnet")
    } else {
        resolve_model_id(default_model_for_step(step_id))
    };

    let config = SidecarConfig {
        prompt,
        model: if debug_mode { Some(model.clone()) } else { None },
        api_key,
        cwd: workspace_path,
        allowed_tools: Some(step.allowed_tools),
        max_turns: Some(step.max_turns),
        permission_mode: Some("bypassPermissions".to_string()),
        session_id: None,
        betas: build_betas(extended_context, thinking_budget, &model),
        max_thinking_tokens: thinking_budget,
        path_to_claude_code_executable: None,
        agent_name: Some(agent_name),
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


#[tauri::command]
pub async fn package_skill(
    skill_name: String,
    workspace_path: String,
    db: tauri::State<'_, Db>,
) -> Result<PackageResult, String> {
    // Stage DB artifacts to filesystem before packaging
    let skills_path = read_skills_path(&db);
    {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        stage_artifacts(&conn, &skill_name, &workspace_path, skills_path.as_deref())?;
    }

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
        6 => vec!["context/agent-validation-log.md"],
        7 => vec!["context/test-skill.md"],
        _ => vec![],
    }
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

    // Step 4 (reasoning): also delete the chat session file so reset starts fresh
    if step_id == 4 {
        let session = skill_dir.join("logs").join("reasoning-chat.json");
        if session.exists() {
            let _ = std::fs::remove_file(&session);
        }
    }
}

/// Delete output files for the given step and all subsequent steps.
fn delete_step_output_files(workspace_path: &str, skill_name: &str, from_step_id: u32, skills_path: Option<&str>) {
    for step_id in from_step_id..=8 {
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

    // Reset steps and artifacts in SQLite
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    crate::db::reset_workflow_steps_from(&conn, &skill_name, from_step_id as i32)?;
    crate::db::delete_artifacts_from(&conn, &skill_name, from_step_id as i32)?;

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

// --- Artifact commands ---

/// Parse agent_id (format: "{skill_name}-step{step_id}-{timestamp}") to extract skill_name and step_id.
/// Returns None if the format doesn't match the expected pattern.
fn parse_agent_id(agent_id: &str) -> Option<(String, u32)> {
    // agent_id format: {skill_name}-step{step_id}-{timestamp}
    // We need to extract skill_name and step_id
    // Example: "my-skill-step5-123456789"

    // Find the last occurrence of "-step" to handle skill names with hyphens
    if let Some(step_idx) = agent_id.rfind("-step") {
        let skill_name = &agent_id[..step_idx];
        let rest = &agent_id[step_idx + 5..]; // +5 to skip "-step"

        // Find the next hyphen to separate step_id from timestamp
        if let Some(hyphen_idx) = rest.find('-') {
            let step_id_str = &rest[..hyphen_idx];
            if let Ok(step_id) = step_id_str.parse::<u32>() {
                return Some((skill_name.to_string(), step_id));
            }
        }
    }
    None
}

/// Configuration for retry with backoff.
pub struct RetryConfig {
    /// Maximum number of attempts (including the first try).
    pub max_attempts: u32,
    /// Delay schedule in milliseconds for each retry (index 0 = delay before attempt 2, etc.).
    pub delays_ms: Vec<u64>,
}

impl Default for RetryConfig {
    fn default() -> Self {
        Self {
            max_attempts: 3,
            delays_ms: vec![100, 200, 300],
        }
    }
}

/// Retry a fallible closure with backoff delays between attempts.
/// Returns `Ok(T)` on the first successful attempt, or the last `Err` after all retries.
/// Calls `on_retry(attempt, max_attempts, &error, delay_ms)` before each retry sleep.
pub fn retry_with_backoff<T, E, F, R>(
    config: &RetryConfig,
    mut operation: F,
    mut on_retry: R,
) -> Result<T, E>
where
    E: std::fmt::Display,
    F: FnMut() -> Result<T, E>,
    R: FnMut(u32, u32, &E, u64),
{
    let mut last_err = None;
    for attempt in 1..=config.max_attempts {
        match operation() {
            Ok(val) => return Ok(val),
            Err(e) => {
                if attempt < config.max_attempts {
                    let delay_idx = (attempt - 1) as usize;
                    let delay_ms = config
                        .delays_ms
                        .get(delay_idx)
                        .copied()
                        .unwrap_or(300);
                    on_retry(attempt, config.max_attempts, &e, delay_ms);
                    std::thread::sleep(std::time::Duration::from_millis(delay_ms));
                }
                last_err = Some(e);
            }
        }
    }
    Err(last_err.expect("max_attempts >= 1 so last_err is always set"))
}

/// Capture artifacts on error — called from sidecar_pool when an agent fails.
/// This is best-effort: logs errors but doesn't propagate them to avoid interfering
/// with error event emission. Retries up to 3 times with backoff to handle transient
/// DB lock contention or temporary I/O failures.
pub fn capture_artifacts_on_error(
    app_handle: &tauri::AppHandle,
    agent_id: &str,
) {
    use tauri::Manager;

    // Parse agent_id to extract skill_name and step_id
    let (skill_name, step_id) = match parse_agent_id(agent_id) {
        Some(parsed) => parsed,
        None => {
            log::warn!(
                "Failed to parse agent_id '{}' for artifact capture on error",
                agent_id
            );
            return;
        }
    };

    log::debug!(
        "Capturing artifacts on error for skill '{}', step {}",
        skill_name,
        step_id
    );

    // Get DB state
    let db = match app_handle.try_state::<Db>() {
        Some(db) => db,
        None => {
            log::error!("DB state not available for artifact capture on error");
            return;
        }
    };

    // Get workspace_path and skills_path from settings
    let (workspace_path, skills_path) = {
        let conn = match db.0.lock() {
            Ok(conn) => conn,
            Err(e) => {
                log::error!("Failed to lock DB for artifact capture on error: {}", e);
                return;
            }
        };

        let settings = match crate::db::read_settings(&conn) {
            Ok(s) => s,
            Err(e) => {
                log::error!("Failed to read settings for artifact capture on error: {}", e);
                return;
            }
        };

        let workspace_path = match settings.workspace_path {
            Some(wp) => wp,
            None => {
                log::warn!("Workspace path not set for artifact capture on error");
                return;
            }
        };

        (workspace_path, settings.skills_path)
    };

    // Capture artifacts with retry (best-effort)
    let config = RetryConfig::default();
    let skill_name_ref = &skill_name;
    let result = retry_with_backoff(
        &config,
        || {
            let conn = db.0.lock().map_err(|e| format!("DB lock failed: {}", e))?;
            capture_artifacts_inner(
                &conn,
                skill_name_ref,
                step_id,
                &workspace_path,
                skills_path.as_deref(),
            )
        },
        |attempt, max, error, delay_ms| {
            log::debug!(
                "Retry {attempt}/{max} for artifact capture (skill: {skill_name_ref}, step: {step_id}): {error} — retrying in {delay_ms}ms"
            );
        },
    );

    match result {
        Ok(artifacts) => {
            log::debug!(
                "Captured {} artifact(s) on error for skill '{}', step {}",
                artifacts.len(),
                skill_name,
                step_id
            );
        }
        Err(e) => {
            log::warn!(
                "Failed to capture artifacts after {} attempts for skill '{}', step {}: {}",
                config.max_attempts,
                skill_name,
                step_id,
                e
            );
        }
    }
}

/// Core logic for capturing step artifacts — takes `&Connection` directly so
/// it cannot re-lock the Db mutex (prevents deadlock by construction).
fn capture_artifacts_inner(
    conn: &rusqlite::Connection,
    skill_name: &str,
    step_id: u32,
    workspace_path: &str,
    skills_path: Option<&str>,
) -> Result<Vec<ArtifactRow>, String> {
    let skill_dir = Path::new(workspace_path).join(skill_name);
    let mut captured = Vec::new();

    // For step 5, determine the source directory for skill output files
    let skill_output_dir = skills_path.map(|sp| Path::new(sp).join(skill_name));

    // Read known output files for this step
    for file in get_step_output_files(step_id) {
        // For build step (5), ALL files should resolve from skill_output_dir.
        // Strip "skill/" prefix when present for backward compatibility.
        let path = if step_id == 5 {
            let clean_file = file.strip_prefix("skill/").unwrap_or(file);
            if let Some(ref sod) = skill_output_dir {
                sod.join(clean_file)
            } else {
                skill_dir.join(clean_file)
            }
        } else {
            skill_dir.join(file)
        };
        if path.exists() {
            let content = std::fs::read_to_string(&path)
                .map_err(|e| format!("Failed to read {}: {}", path.display(), e))?;
            crate::db::save_artifact(conn, skill_name, step_id as i32, file, &content)?;
            captured.push(ArtifactRow {
                skill_name: skill_name.to_string(),
                step_id: step_id as i32,
                relative_path: file.to_string(),
                size_bytes: content.len() as i64,
                content,
                created_at: String::new(),
                updated_at: String::new(),
            });
        }
    }

    // Step 5 (Build): also walk references/ directory from skill output location
    if step_id == 5 {
        let refs_dir = if let Some(ref sod) = skill_output_dir {
            sod.join("references")
        } else {
            skill_dir.join("references")
        };
        // Use relative paths with "skill/" prefix to keep DB artifact paths consistent
        if refs_dir.is_dir() {
            for (relative, content) in walk_md_files(&refs_dir, "skill/references")? {
                crate::db::save_artifact(
                    conn,
                    skill_name,
                    step_id as i32,
                    &relative,
                    &content,
                )?;
                captured.push(ArtifactRow {
                    skill_name: skill_name.to_string(),
                    step_id: step_id as i32,
                    relative_path: relative,
                    size_bytes: content.len() as i64,
                    content,
                    created_at: String::new(),
                    updated_at: String::new(),
                });
            }
        }
    }

    // Copy context files to skill output directory for steps 0, 2, 4
    if let Some(sp) = skills_path {
        copy_context_to_skill_output(step_id, &skill_dir, sp, skill_name)?;
    }

    Ok(captured)
}

/// After steps 0, 2, and 4, copy the relevant clarification/decision files
/// from `{workspace_path}/{skill_name}/context/` to `{skills_path}/{skill_name}/context/`.
/// Creates the destination directory if it doesn't exist.
fn copy_context_to_skill_output(
    step_id: u32,
    skill_dir: &Path,
    skills_path: &str,
    skill_name: &str,
) -> Result<(), String> {
    let context_files: &[&str] = match step_id {
        0 => &["context/clarifications-concepts.md"],
        2 => &["context/clarifications.md"],
        4 => &["context/decisions.md"],
        _ => return Ok(()),
    };

    let dest_context_dir = Path::new(skills_path).join(skill_name).join("context");
    std::fs::create_dir_all(&dest_context_dir)
        .map_err(|e| format!("Failed to create skill output context dir: {}", e))?;

    for file in context_files {
        let src = skill_dir.join(file);
        if src.exists() {
            let dest = Path::new(skills_path).join(skill_name).join(file);
            std::fs::copy(&src, &dest)
                .map_err(|e| format!("Failed to copy {} to skill output: {}", file, e))?;
        }
    }

    Ok(())
}

#[tauri::command]
pub fn capture_step_artifacts(
    skill_name: String,
    step_id: u32,
    workspace_path: String,
    db: tauri::State<'_, Db>,
) -> Result<Vec<ArtifactRow>, String> {
    // Read skills_path before acquiring the DB lock (read_skills_path locks internally)
    let skills_path = read_skills_path(&db);
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    capture_artifacts_inner(&conn, &skill_name, step_id, &workspace_path, skills_path.as_deref())
}

#[tauri::command]
pub fn get_artifact_content(
    skill_name: String,
    relative_path: String,
    db: tauri::State<'_, Db>,
) -> Result<Option<ArtifactRow>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    crate::db::get_artifact_by_path(&conn, &skill_name, &relative_path)
}

#[tauri::command]
pub fn save_artifact_content(
    skill_name: String,
    step_id: i32,
    relative_path: String,
    content: String,
    db: tauri::State<'_, Db>,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    crate::db::save_artifact(&conn, &skill_name, step_id, &relative_path, &content)
}

#[tauri::command]
pub fn has_step_artifacts(
    skill_name: String,
    step_id: u32,
    db: tauri::State<'_, Db>,
) -> Result<bool, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    crate::db::has_artifacts(&conn, &skill_name, step_id as i32)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_step_config_valid_steps() {
        let valid_steps = [0, 2, 4, 5, 6, 7];
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
        assert!(get_step_config(8).is_err());  // Refinement step (client-side only)
        assert!(get_step_config(9).is_err());  // Beyond last step
        assert!(get_step_config(99).is_err());
    }

    #[test]
    fn test_get_step_config_step8_error_message() {
        let err = get_step_config(8).unwrap_err();
        assert!(err.contains("refinement step"), "Error should mention refinement: {}", err);
    }

    #[test]
    fn test_get_step_output_files_unknown_step() {
        // Unknown steps should return empty vec
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
        );
        // Should NOT contain "Read X and Y and follow the instructions"
        assert!(!prompt.contains("Read"));
        assert!(!prompt.contains("follow the instructions"));
        // skill output directory should use skills_path
        assert!(prompt.contains("The skill output directory (SKILL.md and references/) is: /home/user/my-skills/my-skill"));
        // output path for build step (skill/SKILL.md) should resolve to skills_path/skill_name/SKILL.md
        assert!(prompt.contains("Write output to /home/user/my-skills/my-skill/SKILL.md"));
        // context dir should still be in workspace
        assert!(prompt.contains("The context directory (for reading and writing intermediate files) is: /home/user/.vibedata/my-skill/context"));
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
        );
        // Should NOT contain "Read X and Y and follow the instructions"
        assert!(!prompt.contains("Read"));
        assert!(!prompt.contains("follow the instructions"));
        // output path should be in workspace for non-build steps
        assert!(prompt.contains("Write output to /home/user/.vibedata/my-skill/context/decisions.md"));
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
        );
        // Should NOT contain "Read X and Y and follow the instructions"
        assert!(!prompt.contains("Read"));
        assert!(!prompt.contains("follow the instructions"));
        assert!(prompt.contains("e-commerce"));
        assert!(prompt.contains("my-skill"));
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

        // Create file for step 7
        std::fs::write(skill_dir.join("context/test-skill.md"), "step7").unwrap();

        // Reset from step 7 onwards should clean up through step 8
        delete_step_output_files(workspace, "my-skill", 7, None);

        // Step 7 output should be deleted
        assert!(!skill_dir.join("context/test-skill.md").exists());
    }

    #[test]
    fn test_delete_step_output_files_includes_step8() {
        // Verify the loop range extends to step 8 (refine step)
        // by confirming delete_step_output_files(from=8) doesn't panic
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        std::fs::create_dir_all(tmp.path().join("my-skill")).unwrap();
        delete_step_output_files(workspace, "my-skill", 8, None);
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
    fn test_derive_agent_name() {
        assert_eq!(
            derive_agent_name("domain", "research-concepts.md"),
            "domain-research-concepts"
        );
        assert_eq!(
            derive_agent_name("platform", "build.md"),
            "platform-build"
        );
        assert_eq!(
            derive_agent_name("source", "validate.md"),
            "source-validate"
        );
        assert_eq!(
            derive_agent_name("data-engineering", "research-patterns-and-merge.md"),
            "data-engineering-research-patterns-and-merge"
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

    // --- capture_artifacts_inner tests ---

    fn create_test_conn() -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS workflow_artifacts (
                skill_name TEXT NOT NULL,
                step_id INTEGER NOT NULL,
                relative_path TEXT NOT NULL,
                content TEXT NOT NULL,
                size_bytes INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                PRIMARY KEY (skill_name, step_id, relative_path)
            );",
        )
        .unwrap();
        conn
    }

    #[test]
    fn test_capture_artifacts_step0() {
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        let skill_dir = tmp.path().join("my-skill").join("context");
        std::fs::create_dir_all(&skill_dir).unwrap();

        std::fs::write(skill_dir.join("research-entities.md"), "# Entities").unwrap();
        std::fs::write(skill_dir.join("research-metrics.md"), "# Metrics").unwrap();
        std::fs::write(skill_dir.join("clarifications-concepts.md"), "# Clarifications").unwrap();

        let conn = create_test_conn();
        let captured = capture_artifacts_inner(&conn, "my-skill", 0, workspace, None).unwrap();

        assert_eq!(captured.len(), 3);
        assert!(captured.iter().any(|a| a.relative_path == "context/research-entities.md"));
        assert!(captured.iter().any(|a| a.relative_path == "context/clarifications-concepts.md"));

        // Verify artifacts were persisted to DB
        let db_artifacts = crate::db::get_skill_artifacts(&conn, "my-skill").unwrap();
        assert_eq!(db_artifacts.len(), 3);
    }

    #[test]
    fn test_capture_artifacts_skips_missing_files() {
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        let skill_dir = tmp.path().join("my-skill").join("context");
        std::fs::create_dir_all(&skill_dir).unwrap();

        // Only create one of the three expected step 0 output files
        std::fs::write(skill_dir.join("clarifications-concepts.md"), "# Concepts").unwrap();

        let conn = create_test_conn();
        let captured = capture_artifacts_inner(&conn, "my-skill", 0, workspace, None).unwrap();

        assert_eq!(captured.len(), 1);
        assert_eq!(captured[0].relative_path, "context/clarifications-concepts.md");
    }

    #[test]
    fn test_capture_artifacts_step5_with_skills_path() {
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().join("workspace");
        let skills = tmp.path().join("skills");

        // When skills_path is set, ALL step 5 files (SKILL.md and references/)
        // should be resolved from skills_path/skill_name/, not workspace.
        let skill_output = skills.join("my-skill");
        std::fs::create_dir_all(skill_output.join("references")).unwrap();
        std::fs::write(skill_output.join("SKILL.md"), "# My Skill").unwrap();
        std::fs::write(skill_output.join("references").join("ref.md"), "# Ref").unwrap();

        // Ensure workspace skill dir exists (but has no SKILL.md — verifies we
        // read from skills_path, not workspace)
        let skill_dir = workspace.join("my-skill");
        std::fs::create_dir_all(&skill_dir).unwrap();

        let conn = create_test_conn();
        let captured = capture_artifacts_inner(
            &conn,
            "my-skill",
            5,
            workspace.to_str().unwrap(),
            Some(skills.to_str().unwrap()),
        )
        .unwrap();

        assert!(captured.iter().any(|a| a.relative_path == "SKILL.md"));
        assert!(captured.iter().any(|a| a.relative_path == "skill/references/ref.md"));
    }

    #[test]
    fn test_capture_artifacts_empty_step() {
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        std::fs::create_dir_all(tmp.path().join("my-skill")).unwrap();

        let conn = create_test_conn();
        // Human review steps have no output files
        let captured = capture_artifacts_inner(&conn, "my-skill", 1, workspace, None).unwrap();
        assert!(captured.is_empty());
    }

    // --- Task 1: copy_context_to_skill_output tests ---

    #[test]
    fn test_copy_context_step0_copies_clarifications_concepts() {
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().join("workspace");
        let skills = tmp.path().join("skills");
        let skill_dir = workspace.join("my-skill");
        std::fs::create_dir_all(skill_dir.join("context")).unwrap();
        std::fs::write(
            skill_dir.join("context/clarifications-concepts.md"),
            "# Concepts",
        )
        .unwrap();

        copy_context_to_skill_output(0, &skill_dir, skills.to_str().unwrap(), "my-skill").unwrap();

        let dest = skills.join("my-skill").join("context").join("clarifications-concepts.md");
        assert!(dest.exists());
        assert_eq!(std::fs::read_to_string(&dest).unwrap(), "# Concepts");
    }

    #[test]
    fn test_copy_context_step2_copies_merged_clarifications() {
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().join("workspace");
        let skills = tmp.path().join("skills");
        let skill_dir = workspace.join("my-skill");
        std::fs::create_dir_all(skill_dir.join("context")).unwrap();
        std::fs::write(
            skill_dir.join("context/clarifications.md"),
            "# Merged",
        )
        .unwrap();

        copy_context_to_skill_output(2, &skill_dir, skills.to_str().unwrap(), "my-skill").unwrap();

        let dest = skills.join("my-skill").join("context").join("clarifications.md");
        assert!(dest.exists());
        assert_eq!(std::fs::read_to_string(&dest).unwrap(), "# Merged");
    }

    #[test]
    fn test_copy_context_step4_copies_decisions() {
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().join("workspace");
        let skills = tmp.path().join("skills");
        let skill_dir = workspace.join("my-skill");
        std::fs::create_dir_all(skill_dir.join("context")).unwrap();
        std::fs::write(
            skill_dir.join("context/decisions.md"),
            "# Decisions",
        )
        .unwrap();

        copy_context_to_skill_output(4, &skill_dir, skills.to_str().unwrap(), "my-skill").unwrap();

        let dest = skills.join("my-skill").join("context").join("decisions.md");
        assert!(dest.exists());
        assert_eq!(std::fs::read_to_string(&dest).unwrap(), "# Decisions");
    }

    #[test]
    fn test_copy_context_step5_is_noop() {
        let tmp = tempfile::tempdir().unwrap();
        let skills = tmp.path().join("skills");
        let skill_dir = tmp.path().join("workspace").join("my-skill");
        std::fs::create_dir_all(skill_dir.join("context")).unwrap();

        // Step 5 (build) should not copy context files
        copy_context_to_skill_output(5, &skill_dir, skills.to_str().unwrap(), "my-skill").unwrap();

        // No context dir should be created in skills output
        assert!(!skills.join("my-skill").join("context").exists());
    }

    #[test]
    fn test_copy_context_skips_missing_source_files() {
        let tmp = tempfile::tempdir().unwrap();
        let skills = tmp.path().join("skills");
        let skill_dir = tmp.path().join("workspace").join("my-skill");
        // Create context dir but NOT the expected file
        std::fs::create_dir_all(skill_dir.join("context")).unwrap();

        // Should not error even though the source file doesn't exist
        copy_context_to_skill_output(0, &skill_dir, skills.to_str().unwrap(), "my-skill").unwrap();

        // Context dir is created but file doesn't exist
        assert!(skills.join("my-skill").join("context").exists());
        assert!(!skills.join("my-skill").join("context").join("clarifications-concepts.md").exists());
    }

    #[test]
    fn test_capture_artifacts_copies_context_to_skill_output() {
        // Integration test: capture_artifacts_inner should copy context files
        // to skills_path when skills_path is set
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().join("workspace");
        let skills = tmp.path().join("skills");
        let skill_dir = workspace.join("my-skill").join("context");
        std::fs::create_dir_all(&skill_dir).unwrap();

        std::fs::write(skill_dir.join("research-entities.md"), "# Entities").unwrap();
        std::fs::write(skill_dir.join("research-metrics.md"), "# Metrics").unwrap();
        std::fs::write(skill_dir.join("clarifications-concepts.md"), "# Concepts").unwrap();

        let conn = create_test_conn();
        let _captured = capture_artifacts_inner(
            &conn,
            "my-skill",
            0,
            workspace.to_str().unwrap(),
            Some(skills.to_str().unwrap()),
        )
        .unwrap();

        // Context file should have been copied to skill output dir
        let dest = skills.join("my-skill").join("context").join("clarifications-concepts.md");
        assert!(dest.exists());
        assert_eq!(std::fs::read_to_string(&dest).unwrap(), "# Concepts");
    }

    #[test]
    fn test_capture_artifacts_no_copy_without_skills_path() {
        // When skills_path is None, no context copy should happen
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        let skill_dir = tmp.path().join("my-skill").join("context");
        std::fs::create_dir_all(&skill_dir).unwrap();
        std::fs::write(skill_dir.join("clarifications-concepts.md"), "# C").unwrap();

        let conn = create_test_conn();
        let _captured = capture_artifacts_inner(&conn, "my-skill", 0, workspace, None).unwrap();

        // No skills output dir should exist — only workspace dir exists
        // (There's no separate skills dir to check)
    }

    // --- Task 2: stage_artifacts with skills_path tests ---

    #[test]
    fn test_stage_artifacts_writes_context_to_skill_output() {
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().join("workspace");
        let skills = tmp.path().join("skills");

        let conn = create_test_conn();
        crate::db::save_artifact(
            &conn, "my-skill", 0,
            "context/clarifications-concepts.md", "# Concepts from DB",
        ).unwrap();
        crate::db::save_artifact(
            &conn, "my-skill", 2,
            "context/clarifications.md", "# Merged from DB",
        ).unwrap();
        crate::db::save_artifact(
            &conn, "my-skill", 4,
            "context/decisions.md", "# Decisions from DB",
        ).unwrap();

        stage_artifacts(
            &conn, "my-skill",
            workspace.to_str().unwrap(),
            Some(skills.to_str().unwrap()),
        ).unwrap();

        // Verify workspace files
        assert!(workspace.join("my-skill/context/clarifications-concepts.md").exists());
        assert!(workspace.join("my-skill/context/clarifications.md").exists());
        assert!(workspace.join("my-skill/context/decisions.md").exists());

        // Verify skill output files
        let ctx = skills.join("my-skill").join("context");
        assert!(ctx.join("clarifications-concepts.md").exists());
        assert!(ctx.join("clarifications.md").exists());
        assert!(ctx.join("decisions.md").exists());

        // Verify content matches
        assert_eq!(
            std::fs::read_to_string(ctx.join("decisions.md")).unwrap(),
            "# Decisions from DB"
        );
    }

    #[test]
    fn test_stage_artifacts_without_skills_path_no_output_copy() {
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().join("workspace");

        let conn = create_test_conn();
        crate::db::save_artifact(
            &conn, "my-skill", 0,
            "context/clarifications-concepts.md", "# Concepts",
        ).unwrap();

        stage_artifacts(
            &conn, "my-skill",
            workspace.to_str().unwrap(),
            None,
        ).unwrap();

        // Workspace file should exist
        assert!(workspace.join("my-skill/context/clarifications-concepts.md").exists());
        // No separate skills output dir (there's no skills_path)
    }

    #[test]
    fn test_stage_artifacts_skips_non_context_files() {
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().join("workspace");
        let skills = tmp.path().join("skills");

        let conn = create_test_conn();
        // Validation log should NOT be copied to skill output context
        crate::db::save_artifact(
            &conn, "my-skill", 6,
            "context/agent-validation-log.md", "# Validation",
        ).unwrap();

        stage_artifacts(
            &conn, "my-skill",
            workspace.to_str().unwrap(),
            Some(skills.to_str().unwrap()),
        ).unwrap();

        // Workspace file should exist
        assert!(workspace.join("my-skill/context/agent-validation-log.md").exists());
        // But it should NOT be in skill output context (not one of the 3 context files)
        assert!(!skills.join("my-skill/context/agent-validation-log.md").exists());
    }

    // --- Task 3: build_prompt skill output context path tests ---

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

        let conn = create_test_conn();
        let result = validate_decisions_exist_inner(
            "my-skill",
            workspace.to_str().unwrap(),
            None,
            &conn,
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

        let conn = create_test_conn();
        let result = validate_decisions_exist_inner(
            "my-skill",
            workspace.to_str().unwrap(),
            Some(skills.to_str().unwrap()),
            &conn,
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

        let conn = create_test_conn();
        let result = validate_decisions_exist_inner(
            "my-skill",
            workspace.to_str().unwrap(),
            None,
            &conn,
        );
        assert!(result.is_ok());
    }

    #[test]
    fn test_validate_decisions_found_in_sqlite() {
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().join("workspace");
        std::fs::create_dir_all(workspace.join("my-skill").join("context")).unwrap();

        let conn = create_test_conn();
        crate::db::save_artifact(
            &conn, "my-skill", 4,
            "context/decisions.md", "# Decisions\n\nD1: Use periodic recognition",
        ).unwrap();

        let result = validate_decisions_exist_inner(
            "my-skill",
            workspace.to_str().unwrap(),
            None,
            &conn,
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

        let conn = create_test_conn();
        let result = validate_decisions_exist_inner(
            "my-skill",
            workspace.to_str().unwrap(),
            None,
            &conn,
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("decisions.md was not found"));
    }

    #[test]
    fn test_validate_decisions_rejects_empty_sqlite_artifact() {
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().join("workspace");
        std::fs::create_dir_all(workspace.join("my-skill").join("context")).unwrap();

        let conn = create_test_conn();
        crate::db::save_artifact(
            &conn, "my-skill", 4,
            "context/decisions.md", "  \n  ",
        ).unwrap();

        let result = validate_decisions_exist_inner(
            "my-skill",
            workspace.to_str().unwrap(),
            None,
            &conn,
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_decisions_priority_order() {
        // skills_path takes priority over workspace, which takes priority over SQLite
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
        // workspace has no decisions.md, SQLite has no artifact

        let conn = create_test_conn();
        let result = validate_decisions_exist_inner(
            "my-skill",
            workspace.to_str().unwrap(),
            Some(skills.to_str().unwrap()),
            &conn,
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
            (6, 80),   // validate
            (7, 80),   // test
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
            (6, 80),
            (7, 80),
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
            (6, "validate.md", "context/agent-validation-log.md"),
            (7, "test.md", "context/test-skill.md"),
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
    fn test_save_artifact_upsert_behavior() {
        // Verify that save_artifact uses INSERT ... ON CONFLICT UPDATE
        // (upsert), so calling it multiple times for the same artifact
        // updates rather than fails. This is critical for rerun mode where
        // captureStepArtifacts is called after each agent turn.
        let conn = create_test_conn();

        // First insert
        crate::db::save_artifact(
            &conn, "my-skill", 5,
            "SKILL.md", "# Initial version",
        ).unwrap();

        let artifact = crate::db::get_artifact_by_path(&conn, "my-skill", "SKILL.md")
            .unwrap().unwrap();
        assert_eq!(artifact.content, "# Initial version");
        assert_eq!(artifact.size_bytes, "# Initial version".len() as i64);

        // Second call (upsert) — should update, not error
        crate::db::save_artifact(
            &conn, "my-skill", 5,
            "SKILL.md", "# Updated version with more content",
        ).unwrap();

        let artifact = crate::db::get_artifact_by_path(&conn, "my-skill", "SKILL.md")
            .unwrap().unwrap();
        assert_eq!(artifact.content, "# Updated version with more content");
        assert_eq!(artifact.size_bytes, "# Updated version with more content".len() as i64);

        // Third call — still fine
        crate::db::save_artifact(
            &conn, "my-skill", 5,
            "SKILL.md", "# Final version",
        ).unwrap();

        let artifact = crate::db::get_artifact_by_path(&conn, "my-skill", "SKILL.md")
            .unwrap().unwrap();
        assert_eq!(artifact.content, "# Final version");
    }

    #[test]
    fn test_thinking_budget_for_step() {
        assert_eq!(thinking_budget_for_step(0), Some(8_000));
        assert_eq!(thinking_budget_for_step(2), Some(8_000));
        assert_eq!(thinking_budget_for_step(4), Some(32_000));
        assert_eq!(thinking_budget_for_step(5), Some(16_000));
        assert_eq!(thinking_budget_for_step(6), Some(8_000));
        assert_eq!(thinking_budget_for_step(7), Some(8_000));
        // Human review steps and beyond return None
        assert_eq!(thinking_budget_for_step(1), None);
        assert_eq!(thinking_budget_for_step(3), None);
        assert_eq!(thinking_budget_for_step(8), None);
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
    fn test_parse_agent_id_valid() {
        // Standard format
        let (skill_name, step_id) = parse_agent_id("my-skill-step5-123456789").unwrap();
        assert_eq!(skill_name, "my-skill");
        assert_eq!(step_id, 5);

        // Skill name with hyphens
        let (skill_name, step_id) = parse_agent_id("my-cool-skill-step0-987654321").unwrap();
        assert_eq!(skill_name, "my-cool-skill");
        assert_eq!(step_id, 0);

        // Different step IDs
        let (skill_name, step_id) = parse_agent_id("test-step2-111111111").unwrap();
        assert_eq!(skill_name, "test");
        assert_eq!(step_id, 2);

        let (skill_name, step_id) = parse_agent_id("test-step7-222222222").unwrap();
        assert_eq!(skill_name, "test");
        assert_eq!(step_id, 7);
    }

    #[test]
    fn test_parse_agent_id_invalid() {
        // Missing step marker
        assert!(parse_agent_id("my-skill-123456789").is_none());

        // Invalid step ID (not a number)
        assert!(parse_agent_id("my-skill-stepX-123456789").is_none());

        // Missing timestamp
        assert!(parse_agent_id("my-skill-step5").is_none());

        // Empty string
        assert!(parse_agent_id("").is_none());

        // Wrong format
        assert!(parse_agent_id("invalid-format").is_none());
    }

    #[test]
    fn test_has_step_artifacts_integration() {
        // Create a temporary database
        let conn = rusqlite::Connection::open_in_memory().unwrap();

        // Create the workflow_artifacts table
        conn.execute(
            "CREATE TABLE workflow_artifacts (
                skill_name TEXT NOT NULL,
                step_id INTEGER NOT NULL,
                relative_path TEXT NOT NULL,
                content TEXT NOT NULL,
                size_bytes INTEGER NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                PRIMARY KEY (skill_name, step_id, relative_path)
            )",
            [],
        )
        .unwrap();

        // Initially, no artifacts exist
        assert_eq!(crate::db::has_artifacts(&conn, "test-skill", 0).unwrap(), false);

        // Insert an artifact
        crate::db::save_artifact(
            &conn,
            "test-skill",
            0,
            "context/clarifications-concepts.md",
            "# Test content",
        )
        .unwrap();

        // Now has_artifacts should return true
        assert_eq!(crate::db::has_artifacts(&conn, "test-skill", 0).unwrap(), true);

        // Different step should still return false
        assert_eq!(crate::db::has_artifacts(&conn, "test-skill", 1).unwrap(), false);

        // Different skill should return false
        assert_eq!(crate::db::has_artifacts(&conn, "other-skill", 0).unwrap(), false);

        // Add another artifact to the same step
        crate::db::save_artifact(
            &conn,
            "test-skill",
            0,
            "context/another-file.md",
            "# More content",
        )
        .unwrap();

        // Should still return true
        assert_eq!(crate::db::has_artifacts(&conn, "test-skill", 0).unwrap(), true);
    }

    #[test]
    fn test_capture_artifacts_on_error_with_invalid_agent_id() {
        // This test verifies that capture_artifacts_on_error handles invalid agent_ids gracefully
        // We can't easily create a full Tauri app handle in a unit test, so we just test
        // the parse_agent_id function which is the first thing capture_artifacts_on_error does
        assert!(parse_agent_id("invalid-agent-id").is_none());
        assert!(parse_agent_id("").is_none());
    }

    // --- retry_with_backoff tests ---

    #[test]
    fn test_retry_succeeds_on_first_attempt() {
        let config = RetryConfig { max_attempts: 3, delays_ms: vec![100, 200, 300] };
        let mut retries = Vec::new();
        let result: Result<&str, String> = retry_with_backoff(
            &config,
            || Ok("success"),
            |attempt, max, _err, delay| { retries.push((attempt, max, delay)); },
        );
        assert_eq!(result.unwrap(), "success");
        assert!(retries.is_empty(), "No retries should occur on first success");
    }

    #[test]
    fn test_retry_succeeds_on_second_attempt() {
        let config = RetryConfig { max_attempts: 3, delays_ms: vec![10, 20, 30] }; // short delays for test speed
        let call_count = std::cell::Cell::new(0u32);
        let mut retries = Vec::new();
        let result: Result<&str, String> = retry_with_backoff(
            &config,
            || {
                let count = call_count.get() + 1;
                call_count.set(count);
                if count < 2 {
                    Err("transient error".to_string())
                } else {
                    Ok("recovered")
                }
            },
            |attempt, max, err, delay| { retries.push((attempt, max, err.clone(), delay)); },
        );
        assert_eq!(result.unwrap(), "recovered");
        assert_eq!(call_count.get(), 2);
        assert_eq!(retries.len(), 1);
        assert_eq!(retries[0].0, 1); // attempt 1 failed
        assert_eq!(retries[0].1, 3); // max 3
        assert_eq!(retries[0].3, 10); // first delay
    }

    #[test]
    fn test_retry_exhausts_all_attempts() {
        let config = RetryConfig { max_attempts: 3, delays_ms: vec![10, 20, 30] };
        let call_count = std::cell::Cell::new(0u32);
        let mut retries = Vec::new();
        let result: Result<(), String> = retry_with_backoff(
            &config,
            || {
                call_count.set(call_count.get() + 1);
                Err(format!("fail #{}", call_count.get()))
            },
            |attempt, max, err, delay| { retries.push((attempt, max, err.clone(), delay)); },
        );
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "fail #3"); // last error returned
        assert_eq!(call_count.get(), 3);
        // on_retry called for attempts 1 and 2 (before retries), not for the final failure
        assert_eq!(retries.len(), 2);
        assert_eq!(retries[0].3, 10);  // first delay
        assert_eq!(retries[1].3, 20);  // second delay
    }

    #[test]
    fn test_retry_single_attempt_no_retry() {
        let config = RetryConfig { max_attempts: 1, delays_ms: vec![] };
        let mut retries = Vec::new();
        let result: Result<(), String> = retry_with_backoff(
            &config,
            || Err("only one try".to_string()),
            |attempt, max, err, delay| { retries.push((attempt, max, err.clone(), delay)); },
        );
        assert_eq!(result.unwrap_err(), "only one try");
        assert!(retries.is_empty(), "No retry callback for single-attempt config");
    }

    #[test]
    fn test_retry_default_config() {
        let config = RetryConfig::default();
        assert_eq!(config.max_attempts, 3);
        assert_eq!(config.delays_ms, vec![100, 200, 300]);
    }
}
