use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use crate::agents::sidecar::{self, AgentRegistry, SidecarConfig};
use crate::db::Db;
use crate::types::{
    ArtifactRow, PackageResult, StepConfig, StepStatusUpdate,
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
            "Unknown step_id {}. Steps 1, 3, 8 are human/package steps.",
            step_id
        )),
    }
}

/// Copy bundled agent .md files and references into workspace.
/// Creates the directories if they don't exist. Overwrites existing files
/// to keep them in sync with the app version.
pub fn ensure_workspace_prompts(
    _app_handle: &tauri::AppHandle,
    workspace_path: &str,
) -> Result<(), String> {
    let repo_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent() // app/
        .and_then(|p| p.parent()) // repo root
        .ok_or("Could not resolve repo root")?
        .to_path_buf();

    // Copy agents/ directory
    let agents_src = repo_root.join("agents");
    if agents_src.is_dir() {
        copy_directory_to(&agents_src, workspace_path, "agents")?;
        // Also copy to .claude/agents/ with flattened names for SDK loading
        copy_agents_to_claude_dir(&agents_src, workspace_path)?;
    }

    // Copy references/ directory
    let refs_src = repo_root.join("references");
    if refs_src.is_dir() {
        copy_directory_to(&refs_src, workspace_path, "references")?;
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
         Write output to {}.",
        domain,
        skill_name,
        shared_context.display(),
        skill_dir.display(),
        context_dir.display(),
        skill_output_dir.display(),
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

/// Per-step turn limits for debug mode. Orchestrator steps (0, 2, 5) that
/// spawn sub-agents need more headroom; simple agent steps can stay low.
fn debug_max_turns(step_id: u32) -> u32 {
    match step_id {
        0 | 2 => 15, // research orchestrators: spawn + merge
        5 => 30,     // build: reads 4 files + plan + write SKILL.md + spawn writers + reviewer
        4 => 10,     // reasoning: single agent, reads + writes
        6 | 7 => 15, // validate/test: spawn parallel checkers
        _ => 5,
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
fn stage_artifacts(
    conn: &rusqlite::Connection,
    skill_name: &str,
    workspace_path: &str,
) -> Result<(), String> {
    let artifacts = crate::db::get_skill_artifacts(conn, skill_name)?;
    let skill_dir = Path::new(workspace_path).join(skill_name);

    // Ensure context/ directory exists
    std::fs::create_dir_all(skill_dir.join("context"))
        .map_err(|e| format!("Failed to create context dir: {}", e))?;

    for artifact in &artifacts {
        let file_path = skill_dir.join(&artifact.relative_path);

        // Skip if file already exists with same size (content unchanged)
        if let Ok(meta) = std::fs::metadata(&file_path) {
            if meta.len() == artifact.content.len() as u64 {
                continue;
            }
        }

        if let Some(parent) = file_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create dir {}: {}", parent.display(), e))?;
        }
        std::fs::write(&file_path, &artifact.content)
            .map_err(|e| format!("Failed to write {}: {}", file_path.display(), e))?;
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
    state: tauri::State<'_, AgentRegistry>,
    db: tauri::State<'_, Db>,
    skill_name: String,
    step_id: u32,
    domain: String,
    workspace_path: String,
) -> Result<String, String> {
    ensure_workspace_prompts(&app, &workspace_path)?;

    // Stage DB artifacts to filesystem before running agent
    {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        stage_artifacts(&conn, &skill_name, &workspace_path)?;
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

    let debug_mode = read_debug_mode(&db);

    let config = SidecarConfig {
        prompt,
        model: Some(resolve_model_id("haiku")),
        api_key,
        cwd: workspace_path,
        allowed_tools: Some(vec!["Read".to_string(), "Glob".to_string()]),
        max_turns: Some(if debug_mode { 3 } else { 10 }),
        permission_mode: Some("bypassPermissions".to_string()),
        session_id: None,
        betas: if extended_context {
            Some(vec!["context-1m-2025-08-07".to_string()])
        } else {
            None
        },
        path_to_claude_code_executable: None,
        agent_name: None,
    };

    sidecar::spawn_sidecar(agent_id.clone(), config, state.inner().clone(), app).await?;
    Ok(agent_id)
}

#[tauri::command]
pub async fn run_workflow_step(
    app: tauri::AppHandle,
    state: tauri::State<'_, AgentRegistry>,
    db: tauri::State<'_, Db>,
    skill_name: String,
    step_id: u32,
    domain: String,
    workspace_path: String,
    resume: bool,
) -> Result<String, String> {
    // Ensure prompt files exist in workspace before running
    ensure_workspace_prompts(&app, &workspace_path)?;

    // Step 0 fresh start — wipe the context directory and all artifacts so
    // the agent doesn't see stale files from a previous workflow run.
    // Skip this when resuming a paused step to preserve partial progress.
    if step_id == 0 && !resume {
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
    {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        reconcile_disk_artifacts(&conn, &skill_name, &workspace_path)?;
        stage_artifacts(&conn, &skill_name, &workspace_path)?;
    }

    let step = get_step_config(step_id)?;
    let api_key = read_api_key(&db)?;
    let extended_context = read_extended_context(&db);
    let debug_mode = read_debug_mode(&db);
    let skills_path = read_skills_path(&db);
    let skill_type = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        crate::db::get_skill_type(&conn, &skill_name)?
    };
    let prompt = build_prompt(&step.prompt_template, &step.output_file, &skill_name, &domain, &workspace_path, skills_path.as_deref(), &skill_type);
    let agent_name = derive_agent_name(&skill_type, &step.prompt_template);
    let agent_id = make_agent_id(&skill_name, &format!("step{}", step_id));

    let config = SidecarConfig {
        prompt,
        model: None,
        api_key,
        cwd: workspace_path,
        allowed_tools: Some(step.allowed_tools),
        max_turns: Some(if debug_mode { debug_max_turns(step_id) } else { step.max_turns }),
        permission_mode: Some("bypassPermissions".to_string()),
        session_id: None,
        betas: if extended_context {
            Some(vec!["context-1m-2025-08-07".to_string()])
        } else {
            None
        },
        path_to_claude_code_executable: None,
        agent_name: Some(agent_name),
    };

    sidecar::spawn_sidecar(agent_id.clone(), config, state.inner().clone(), app).await?;
    Ok(agent_id)
}


#[tauri::command]
pub async fn package_skill(
    skill_name: String,
    workspace_path: String,
    db: tauri::State<'_, Db>,
) -> Result<PackageResult, String> {
    // Stage DB artifacts to filesystem before packaging
    {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        stage_artifacts(&conn, &skill_name, &workspace_path)?;
    }

    // Determine where the skill files (SKILL.md, references/) live:
    // - If skills_path is set, the build agent wrote directly there
    // - Otherwise, they're in workspace_path/skill_name/
    let skills_path = read_skills_path(&db);
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
fn get_step_output_files(step_id: u32) -> Vec<&'static str> {
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
        8 => vec![], // Package step — .skill file
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

    // Step 8 produces a .skill zip
    if step_id == 8 {
        let skill_file = skill_dir.join(format!("{}.skill", skill_name));
        if skill_file.exists() {
            let _ = std::fs::remove_file(&skill_file);
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
        // For build step output (skill/SKILL.md), resolve from skill_output_dir
        let path = if step_id == 5 && file.starts_with("skill/") {
            if let Some(ref sod) = skill_output_dir {
                sod.join(file.trim_start_matches("skill/"))
            } else {
                skill_dir.join(file.trim_start_matches("skill/"))
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

    Ok(captured)
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
        assert!(get_step_config(8).is_err());  // Package step
        assert!(get_step_config(99).is_err());
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

        // SKILL.md lives in workspace_path/skill_name/ (no "skill/" prefix)
        let skill_dir = workspace.join("my-skill");
        std::fs::create_dir_all(&skill_dir).unwrap();
        std::fs::write(skill_dir.join("SKILL.md"), "# My Skill").unwrap();

        // references/ live in skills_path/skill_name/ (resolved via "skill/" prefix)
        let skill_output = skills.join("my-skill");
        std::fs::create_dir_all(skill_output.join("references")).unwrap();
        std::fs::write(skill_output.join("references").join("ref.md"), "# Ref").unwrap();

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
}
