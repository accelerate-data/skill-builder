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
            name: "Research Domain Concepts".to_string(),
            prompt_template: "01-research-domain-concepts.md".to_string(),
            output_file: "context/clarifications-concepts.md".to_string(),
            allowed_tools: FULL_TOOLS.iter().map(|s| s.to_string()).collect(),
            max_turns: 50,
        }),
        2 => Ok(StepConfig {
            step_id: 2,
            name: "Research Domain".to_string(),
            prompt_template: "02-research-patterns-and-merge.md".to_string(),
            output_file: "context/clarifications.md".to_string(),
            allowed_tools: FULL_TOOLS.iter().map(|s| s.to_string()).collect(),
            max_turns: 50,
        }),
        4 => Ok(StepConfig {
            step_id: 4,
            name: "Reasoning".to_string(),
            prompt_template: "06-reasoning-agent.md".to_string(),
            output_file: "context/decisions.md".to_string(),
            allowed_tools: FULL_TOOLS.iter().map(|s| s.to_string()).collect(),
            max_turns: 100,
        }),
        5 => Ok(StepConfig {
            step_id: 5,
            name: "Build Skill".to_string(),
            prompt_template: "07-build-agent.md".to_string(),
            output_file: "skill/SKILL.md".to_string(),
            allowed_tools: FULL_TOOLS.iter().map(|s| s.to_string()).collect(),
            max_turns: 120,
        }),
        6 => Ok(StepConfig {
            step_id: 6,
            name: "Validate".to_string(),
            prompt_template: "08-validate-agent.md".to_string(),
            output_file: "context/agent-validation-log.md".to_string(),
            allowed_tools: FULL_TOOLS.iter().map(|s| s.to_string()).collect(),
            max_turns: 80,
        }),
        7 => Ok(StepConfig {
            step_id: 7,
            name: "Test".to_string(),
            prompt_template: "09-test-agent.md".to_string(),
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

/// Locate the bundled prompts directory. In production this is in the
/// Tauri resource dir; in dev mode we resolve relative to CARGO_MANIFEST_DIR.
fn resolve_prompts_dir(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;

    // Production: Tauri resource directory
    // Check for shared-context.md to distinguish real prompts from placeholder dirs
    if let Ok(resource_dir) = app_handle.path().resource_dir() {
        let prompts = resource_dir.join("prompts");
        if prompts.join("shared-context.md").is_file() {
            return Ok(prompts);
        }
    }

    // Dev mode: repo root relative to CARGO_MANIFEST_DIR (src-tauri/../../prompts)
    let dev_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent() // app/
        .and_then(|p| p.parent()) // repo root
        .map(|p| p.join("prompts"));
    if let Some(path) = dev_path {
        if path.is_dir() {
            return Ok(path);
        }
    }

    Err("Could not find bundled prompts directory".to_string())
}

/// Copy bundled prompt .md files into `<workspace_path>/prompts/`.
/// Creates the directory if it doesn't exist. Overwrites existing files
/// to keep them in sync with the app version.
pub fn ensure_workspace_prompts(
    app_handle: &tauri::AppHandle,
    workspace_path: &str,
) -> Result<(), String> {
    let src_dir = resolve_prompts_dir(app_handle)?;
    copy_prompts_from(&src_dir, workspace_path)
}

/// Copy .md files from `src_dir` into `<workspace_path>/prompts/`.
fn copy_prompts_from(src_dir: &Path, workspace_path: &str) -> Result<(), String> {
    let dest_dir = Path::new(workspace_path).join("prompts");

    std::fs::create_dir_all(&dest_dir)
        .map_err(|e| format!("Failed to create prompts directory: {}", e))?;

    let entries = std::fs::read_dir(src_dir)
        .map_err(|e| format!("Failed to read prompts source dir: {}", e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read dir entry: {}", e))?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("md") {
            let dest = dest_dir.join(entry.file_name());
            std::fs::copy(&path, &dest).map_err(|e| {
                format!("Failed to copy {}: {}", path.display(), e)
            })?;
        }
    }

    Ok(())
}

fn build_prompt(
    prompt_file: &str,
    output_file: &str,
    skill_name: &str,
    domain: &str,
) -> String {
    format!(
        "Read prompts/shared-context.md and prompts/{} and follow the instructions. \
         The domain is: {}. The skill name is: {}. \
         The skill directory is: {}/. \
         The context directory (for reading and writing intermediate files) is: {}/context/. \
         The skill output directory (SKILL.md and references/) is: {}/skill/. \
         Write output to {}/{}.",
        prompt_file, domain, skill_name, skill_name, skill_name, skill_name, skill_name, output_file
    )
}

fn read_api_key(db: &tauri::State<'_, Db>) -> Result<String, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let settings = crate::db::read_settings(&conn)?;
    settings
        .anthropic_api_key
        .ok_or_else(|| "Anthropic API key not configured".to_string())
}

fn read_preferred_model(db: &tauri::State<'_, Db>) -> String {
    let conn = db.0.lock().ok();
    let model_shorthand = conn
        .and_then(|c| crate::db::read_settings(&c).ok())
        .and_then(|s| s.preferred_model)
        .unwrap_or_else(|| "sonnet".to_string());
    resolve_model_id(&model_shorthand)
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

        // Step 5 also has skill/references/ directory
        if step_id == 5 {
            let refs_dir = skill_dir.join("skill").join("references");
            if refs_dir.is_dir() {
                for entry in walk_md_paths(&refs_dir, "skill/references")? {
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
    let agent_id = make_agent_id(&skill_name, &format!("review-step{}", step_id));

    let output_path = format!("{}/{}", skill_name, step.output_file);

    let prompt = format!(
        "You are a quality reviewer for a skill-building workflow. \
         Read the file at '{}' and evaluate whether the output is satisfactory. \
         \n\nEvaluate based on:\n\
         1. The file exists and is non-empty\n\
         2. The content is well-structured markdown\n\
         3. The content meaningfully addresses the domain: '{}'\n\
         4. The content follows the expected format (check prompts/shared-context.md for format guidelines)\n\
         5. The content is substantive (not placeholder or minimal)\n\
         \n\nRespond with EXACTLY one line:\n\
         - If satisfactory: PASS\n\
         - If needs regeneration: RETRY: <brief reason>\n\
         \nDo not write any files. Only read and evaluate.",
        output_path, domain
    );

    let config = SidecarConfig {
        prompt,
        model: resolve_model_id("haiku"),
        api_key,
        cwd: workspace_path,
        allowed_tools: Some(vec!["Read".to_string(), "Glob".to_string()]),
        max_turns: Some(10),
        permission_mode: Some("bypassPermissions".to_string()),
        session_id: None,
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
) -> Result<String, String> {
    // Ensure prompt files exist in workspace before running
    ensure_workspace_prompts(&app, &workspace_path)?;

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
    let model = read_preferred_model(&db);
    let prompt = build_prompt(&step.prompt_template, &step.output_file, &skill_name, &domain);
    let agent_id = make_agent_id(&skill_name, &format!("step{}", step_id));

    let config = SidecarConfig {
        prompt,
        model,
        api_key,
        cwd: workspace_path,
        allowed_tools: Some(step.allowed_tools),
        max_turns: Some(step.max_turns),
        permission_mode: Some("bypassPermissions".to_string()),
        session_id: None,
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

    let skill_dir = Path::new(&workspace_path).join(&skill_name);
    if !skill_dir.exists() {
        return Err(format!(
            "Skill directory not found: {}",
            skill_dir.display()
        ));
    }

    let output_path = skill_dir.join(format!("{}.skill", skill_name));

    let result = tokio::task::spawn_blocking(move || {
        create_skill_zip(&skill_dir, &output_path)
    })
    .await
    .map_err(|e| format!("Packaging task failed: {}", e))??;

    Ok(result)
}

fn create_skill_zip(
    skill_dir: &Path,
    output_path: &Path,
) -> Result<PackageResult, String> {
    let file = std::fs::File::create(output_path)
        .map_err(|e| format!("Failed to create zip file: {}", e))?;
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    let skill_out = skill_dir.join("skill");
    let skill_md = skill_out.join("SKILL.md");
    if skill_md.exists() {
        add_file_to_zip(&mut zip, &skill_md, "SKILL.md", options)?;
    }

    let references_dir = skill_out.join("references");
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
    step_statuses: Vec<StepStatusUpdate>,
    db: tauri::State<'_, Db>,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    crate::db::save_workflow_run(&conn, &skill_name, &domain, current_step, &status)?;
    for step in &step_statuses {
        crate::db::save_workflow_step(&conn, &skill_name, step.step_id, &step.status)?;
    }
    Ok(())
}

/// Output files produced by each step, relative to the skill directory.
fn get_step_output_files(step_id: u32) -> Vec<&'static str> {
    match step_id {
        0 => vec!["context/clarifications-concepts.md"],
        1 => vec![],  // Human review
        2 => vec!["context/clarifications.md"],
        3 => vec![],  // Human review
        4 => vec!["context/decisions.md"],
        5 => vec!["skill/SKILL.md"], // Also has skill/references/ dir
        6 => vec!["context/agent-validation-log.md"],
        7 => vec!["context/test-skill.md"],
        8 => vec![], // Package step — .skill file
        _ => vec![],
    }
}

/// Delete output files for a single step.
fn clean_step_output(workspace_path: &str, skill_name: &str, step_id: u32) {
    let skill_dir = Path::new(workspace_path).join(skill_name);
    if !skill_dir.exists() {
        return;
    }

    for file in get_step_output_files(step_id) {
        let path = skill_dir.join(file);
        if path.exists() {
            let _ = std::fs::remove_file(&path);
        }
    }

    // Step 5 also produces a skill/references/ directory
    if step_id == 5 {
        let skill_out = skill_dir.join("skill");
        let refs_dir = skill_out.join("references");
        if refs_dir.is_dir() {
            let _ = std::fs::remove_dir_all(&refs_dir);
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
fn delete_step_output_files(workspace_path: &str, skill_name: &str, from_step_id: u32) {
    for step_id in from_step_id..=8 {
        clean_step_output(workspace_path, skill_name, step_id);
    }
}

#[tauri::command]
pub fn reset_workflow_step(
    workspace_path: String,
    skill_name: String,
    from_step_id: u32,
    db: tauri::State<'_, Db>,
) -> Result<(), String> {
    delete_step_output_files(&workspace_path, &skill_name, from_step_id);

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
        )?;
    }

    Ok(())
}

// --- Artifact commands ---

#[tauri::command]
pub fn capture_step_artifacts(
    skill_name: String,
    step_id: u32,
    workspace_path: String,
    db: tauri::State<'_, Db>,
) -> Result<Vec<ArtifactRow>, String> {
    let skill_dir = Path::new(&workspace_path).join(&skill_name);
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut captured = Vec::new();

    // Read known output files for this step
    for file in get_step_output_files(step_id) {
        let path = skill_dir.join(file);
        if path.exists() {
            let content = std::fs::read_to_string(&path)
                .map_err(|e| format!("Failed to read {}: {}", path.display(), e))?;
            crate::db::save_artifact(&conn, &skill_name, step_id as i32, file, &content)?;
            captured.push(ArtifactRow {
                skill_name: skill_name.clone(),
                step_id: step_id as i32,
                relative_path: file.to_string(),
                size_bytes: content.len() as i64,
                content,
                created_at: String::new(),
                updated_at: String::new(),
            });
        }
    }

    // Step 5 (Build): also walk skill/references/ directory
    if step_id == 5 {
        let refs_dir = skill_dir.join("skill").join("references");
        if refs_dir.is_dir() {
            for (relative, content) in walk_md_files(&refs_dir, "skill/references")? {
                crate::db::save_artifact(
                    &conn,
                    &skill_name,
                    step_id as i32,
                    &relative,
                    &content,
                )?;
                captured.push(ArtifactRow {
                    skill_name: skill_name.clone(),
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
    fn test_build_prompt() {
        let prompt = build_prompt(
            "01-research-domain-concepts.md",
            "context/clarifications-concepts.md",
            "my-skill",
            "e-commerce",
        );
        assert!(prompt.contains("prompts/shared-context.md"));
        assert!(prompt.contains("prompts/01-research-domain-concepts.md"));
        assert!(prompt.contains("e-commerce"));
        assert!(prompt.contains("my-skill"));
        assert!(prompt.contains("my-skill/context/clarifications-concepts.md"));
        assert!(prompt.contains("The context directory (for reading and writing intermediate files) is: my-skill/context/"));
        assert!(prompt.contains("The skill directory is: my-skill/"));
        assert!(prompt.contains("The skill output directory (SKILL.md and references/) is: my-skill/skill/"));
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
        let skill_dir = tmp.path().join("my-skill");
        std::fs::create_dir_all(skill_dir.join("skill").join("references")).unwrap();
        std::fs::create_dir_all(skill_dir.join("context")).unwrap();

        std::fs::write(skill_dir.join("skill").join("SKILL.md"), "# My Skill").unwrap();
        std::fs::write(
            skill_dir.join("skill").join("references").join("deep-dive.md"),
            "# Deep Dive",
        )
        .unwrap();

        std::fs::write(
            skill_dir.join("context").join("decisions.md"),
            "# Decisions",
        )
        .unwrap();
        std::fs::write(skill_dir.join("workflow.md"), "# Workflow").unwrap();

        let output_path = skill_dir.join("my-skill.skill");
        let result = create_skill_zip(&skill_dir, &output_path).unwrap();

        assert!(Path::new(&result.file_path).exists());
        assert!(result.size_bytes > 0);

        let file = std::fs::File::open(&result.file_path).unwrap();
        let mut archive = zip::ZipArchive::new(file).unwrap();

        let names: Vec<String> = (0..archive.len())
            .map(|i| archive.by_index(i).unwrap().name().to_string())
            .collect();

        // Zip entries are flat (SKILL.md, references/) even though disk is under skill/
        assert!(names.contains(&"SKILL.md".to_string()));
        assert!(names.contains(&"references/deep-dive.md".to_string()));
        assert!(!names.iter().any(|n| n.starts_with("context/")));
        assert!(!names.contains(&"workflow.md".to_string()));
    }

    #[test]
    fn test_package_skill_nested_references() {
        let tmp = tempfile::tempdir().unwrap();
        let skill_dir = tmp.path().join("nested-skill");
        std::fs::create_dir_all(skill_dir.join("skill").join("references").join("sub")).unwrap();

        std::fs::write(skill_dir.join("skill").join("SKILL.md"), "# Nested").unwrap();
        std::fs::write(
            skill_dir.join("skill").join("references").join("top.md"),
            "top level",
        )
        .unwrap();
        std::fs::write(
            skill_dir.join("skill").join("references").join("sub").join("nested.md"),
            "nested ref",
        )
        .unwrap();

        let output_path = skill_dir.join("nested-skill.skill");
        let result = create_skill_zip(&skill_dir, &output_path).unwrap();

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
    fn test_copy_prompts_creates_dir_and_copies_md_files() {
        let src = tempfile::tempdir().unwrap();
        let dest = tempfile::tempdir().unwrap();

        // Create source .md files
        std::fs::write(src.path().join("shared-context.md"), "# Shared").unwrap();
        std::fs::write(src.path().join("01-research.md"), "# Research").unwrap();
        // Non-.md file should be ignored
        std::fs::write(src.path().join("README.txt"), "ignore me").unwrap();

        let workspace = dest.path().to_str().unwrap();
        copy_prompts_from(src.path(), workspace).unwrap();

        let prompts_dir = dest.path().join("prompts");
        assert!(prompts_dir.is_dir());
        assert!(prompts_dir.join("shared-context.md").exists());
        assert!(prompts_dir.join("01-research.md").exists());
        assert!(!prompts_dir.join("README.txt").exists());

        // Verify content
        let content = std::fs::read_to_string(prompts_dir.join("shared-context.md")).unwrap();
        assert_eq!(content, "# Shared");
    }

    #[test]
    fn test_copy_prompts_is_idempotent() {
        let src = tempfile::tempdir().unwrap();
        let dest = tempfile::tempdir().unwrap();

        std::fs::write(src.path().join("test.md"), "v1").unwrap();

        let workspace = dest.path().to_str().unwrap();
        copy_prompts_from(src.path(), workspace).unwrap();

        // Update source and copy again — should overwrite
        std::fs::write(src.path().join("test.md"), "v2").unwrap();
        copy_prompts_from(src.path(), workspace).unwrap();

        let content =
            std::fs::read_to_string(dest.path().join("prompts").join("test.md")).unwrap();
        assert_eq!(content, "v2");
    }

    #[test]
    fn test_resolve_prompts_dir_dev_mode() {
        // In dev/test mode, CARGO_MANIFEST_DIR is set and the repo root has prompts/
        let dev_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .and_then(|p| p.parent())
            .map(|p| p.join("prompts"));
        assert!(dev_path.is_some());
        let prompts_dir = dev_path.unwrap();
        assert!(prompts_dir.is_dir(), "Repo root prompts/ should exist");
        assert!(
            prompts_dir.join("shared-context.md").exists(),
            "shared-context.md should exist in repo prompts/"
        );
    }

    #[test]
    fn test_delete_step_output_files_from_step_onwards() {
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        let skill_dir = tmp.path().join("my-skill");
        std::fs::create_dir_all(skill_dir.join("context")).unwrap();
        std::fs::create_dir_all(skill_dir.join("skill").join("references")).unwrap();

        // Create output files for steps 0, 2, 4, 5
        // Step 2 now produces all three research+merge files
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
        std::fs::write(skill_dir.join("skill/SKILL.md"), "step5").unwrap();
        std::fs::write(skill_dir.join("skill/references/ref.md"), "ref").unwrap();

        // Reset from step 4 onwards — steps 0, 2 should be preserved
        delete_step_output_files(workspace, "my-skill", 4);

        // Steps 0, 2 outputs should still exist
        assert!(skill_dir.join("context/clarifications-concepts.md").exists());
        assert!(skill_dir.join("context/clarifications.md").exists());

        // Steps 4+ outputs should be deleted
        assert!(!skill_dir.join("context/decisions.md").exists());
        assert!(!skill_dir.join("skill/SKILL.md").exists());
        assert!(!skill_dir.join("skill/references").exists());
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
        clean_step_output(workspace, "my-skill", 2);

        assert!(!skill_dir.join("context/clarifications.md").exists());
        assert!(skill_dir.join("context/decisions.md").exists());
    }

    #[test]
    fn test_delete_step_output_files_nonexistent_dir_is_ok() {
        // Should not panic on nonexistent directory
        delete_step_output_files("/tmp/nonexistent", "no-skill", 0);
    }
}
