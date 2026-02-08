use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use crate::agents::sidecar::{self, AgentRegistry, SidecarConfig};
use crate::db::Db;
use crate::types::{
    PackageResult, ParallelAgentResult, StepConfig, StepStatusUpdate, WorkflowStateResponse,
};

const DEFAULT_TOOLS: &[&str] = &["Read", "Write", "Edit", "Glob", "Grep", "Bash", "Task"];

fn get_step_config(step_id: u32) -> Result<StepConfig, String> {
    match step_id {
        0 => Ok(StepConfig {
            step_id: 0,
            name: "Research Domain Concepts".to_string(),
            model: "sonnet".to_string(),
            prompt_template: "01-research-domain-concepts.md".to_string(),
            output_file: "context/clarifications-concepts.md".to_string(),
            allowed_tools: DEFAULT_TOOLS.iter().map(|s| s.to_string()).collect(),
            max_turns: 50,
        }),
        3 => Ok(StepConfig {
            step_id: 3,
            name: "Merge Clarifications".to_string(),
            model: "haiku".to_string(),
            prompt_template: "04-merge-clarifications.md".to_string(),
            output_file: "context/clarifications.md".to_string(),
            allowed_tools: DEFAULT_TOOLS.iter().map(|s| s.to_string()).collect(),
            max_turns: 30,
        }),
        5 => Ok(StepConfig {
            step_id: 5,
            name: "Reasoning".to_string(),
            model: "opus".to_string(),
            prompt_template: "06-reasoning-agent.md".to_string(),
            output_file: "context/decisions.md".to_string(),
            allowed_tools: DEFAULT_TOOLS.iter().map(|s| s.to_string()).collect(),
            max_turns: 100,
        }),
        6 => Ok(StepConfig {
            step_id: 6,
            name: "Build".to_string(),
            model: "sonnet".to_string(),
            prompt_template: "07-build-agent.md".to_string(),
            output_file: "SKILL.md".to_string(),
            allowed_tools: DEFAULT_TOOLS.iter().map(|s| s.to_string()).collect(),
            max_turns: 80,
        }),
        7 => Ok(StepConfig {
            step_id: 7,
            name: "Validate".to_string(),
            model: "sonnet".to_string(),
            prompt_template: "08-validate-agent.md".to_string(),
            output_file: "context/agent-validation-log.md".to_string(),
            allowed_tools: DEFAULT_TOOLS.iter().map(|s| s.to_string()).collect(),
            max_turns: 50,
        }),
        8 => Ok(StepConfig {
            step_id: 8,
            name: "Test".to_string(),
            model: "sonnet".to_string(),
            prompt_template: "09-test-agent.md".to_string(),
            output_file: "context/test-skill.md".to_string(),
            allowed_tools: DEFAULT_TOOLS.iter().map(|s| s.to_string()).collect(),
            max_turns: 50,
        }),
        _ => Err(format!(
            "Unknown step_id {}. Use run_parallel_agents for step 2.",
            step_id
        )),
    }
}

/// Locate the bundled prompts directory. In production this is in the
/// Tauri resource dir; in dev mode we resolve relative to CARGO_MANIFEST_DIR.
fn resolve_prompts_dir(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;

    // Production: Tauri resource directory
    if let Ok(resource_dir) = app_handle.path().resource_dir() {
        let prompts = resource_dir.join("prompts");
        if prompts.is_dir() {
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
         Write output to {}/{}.",
        prompt_file, domain, skill_name, skill_name, output_file
    )
}

fn read_api_key(db: &tauri::State<'_, Db>) -> Result<String, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let settings = crate::db::read_settings(&conn)?;
    settings
        .anthropic_api_key
        .ok_or_else(|| "Anthropic API key not configured".to_string())
}

fn make_agent_id(skill_name: &str, label: &str) -> String {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!("{}-{}-{}", skill_name, label, ts)
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

    let step = get_step_config(step_id)?;
    let api_key = read_api_key(&db)?;
    let prompt = build_prompt(&step.prompt_template, &step.output_file, &skill_name, &domain);
    let agent_id = make_agent_id(&skill_name, &format!("step{}", step_id));

    let config = SidecarConfig {
        prompt,
        model: step.model,
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
pub async fn run_parallel_agents(
    app: tauri::AppHandle,
    state: tauri::State<'_, AgentRegistry>,
    db: tauri::State<'_, Db>,
    skill_name: String,
    domain: String,
    workspace_path: String,
) -> Result<ParallelAgentResult, String> {
    ensure_workspace_prompts(&app, &workspace_path)?;

    let api_key = read_api_key(&db)?;
    let tools: Vec<String> = DEFAULT_TOOLS.iter().map(|s| s.to_string()).collect();

    let agent_id_a = make_agent_id(&skill_name, "step2a");
    let agent_id_b = make_agent_id(&skill_name, "step2b");

    let config_a = SidecarConfig {
        prompt: build_prompt(
            "03a-research-business-patterns.md",
            "context/clarifications-patterns.md",
            &skill_name,
            &domain,
        ),
        model: "sonnet".to_string(),
        api_key: api_key.clone(),
        cwd: workspace_path.clone(),
        allowed_tools: Some(tools.clone()),
        max_turns: Some(50),
        permission_mode: Some("bypassPermissions".to_string()),
        session_id: None,
    };

    let config_b = SidecarConfig {
        prompt: build_prompt(
            "03b-research-data-modeling.md",
            "context/clarifications-data.md",
            &skill_name,
            &domain,
        ),
        model: "sonnet".to_string(),
        api_key,
        cwd: workspace_path,
        allowed_tools: Some(tools),
        max_turns: Some(50),
        permission_mode: Some("bypassPermissions".to_string()),
        session_id: None,
    };

    let registry = state.inner().clone();
    let app_a = app.clone();

    let id_a = agent_id_a.clone();
    let id_b = agent_id_b.clone();
    let reg_a = registry.clone();
    let reg_b = registry.clone();

    let (res_a, res_b) = tokio::join!(
        sidecar::spawn_sidecar(id_a, config_a, reg_a, app_a),
        sidecar::spawn_sidecar(id_b, config_b, reg_b, app),
    );

    res_a?;
    res_b?;

    Ok(ParallelAgentResult {
        agent_id_a,
        agent_id_b,
    })
}

#[tauri::command]
pub async fn package_skill(
    skill_name: String,
    workspace_path: String,
) -> Result<PackageResult, String> {
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

    let skill_md = skill_dir.join("SKILL.md");
    if skill_md.exists() {
        add_file_to_zip(&mut zip, &skill_md, "SKILL.md", options)?;
    }

    let references_dir = skill_dir.join("references");
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
        1 => vec![], // Human review — no output files to delete
        2 => vec![
            "context/clarifications-patterns.md",
            "context/clarifications-data.md",
        ],
        3 => vec!["context/clarifications.md"],
        4 => vec![], // Human review
        5 => vec!["context/decisions.md"],
        6 => vec!["SKILL.md"], // Also has references/ dir
        7 => vec!["context/agent-validation-log.md"],
        8 => vec!["context/test-skill.md"],
        9 => vec![], // Package step — .skill file
        _ => vec![],
    }
}

/// Delete output files for the given step and all subsequent steps.
/// Extracted as a helper so it can be tested without `tauri::State`.
fn delete_step_output_files(workspace_path: &str, skill_name: &str, from_step_id: u32) {
    let skill_dir = Path::new(workspace_path).join(skill_name);
    if !skill_dir.exists() {
        return;
    }

    for step_id in from_step_id..=9 {
        for file in get_step_output_files(step_id) {
            let path = skill_dir.join(file);
            if path.exists() {
                let _ = std::fs::remove_file(&path);
            }
        }

        // Step 6 also produces a references/ directory
        if step_id == 6 {
            let refs_dir = skill_dir.join("references");
            if refs_dir.is_dir() {
                let _ = std::fs::remove_dir_all(&refs_dir);
            }
        }

        // Step 9 produces a .skill zip
        if step_id == 9 {
            let skill_file = skill_dir.join(format!("{}.skill", skill_name));
            if skill_file.exists() {
                let _ = std::fs::remove_file(&skill_file);
            }
        }
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
        )?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_step_config_valid_steps() {
        let valid_steps = [0, 3, 5, 6, 7, 8];
        for step_id in valid_steps {
            let config = get_step_config(step_id);
            assert!(config.is_ok(), "Step {} should be valid", step_id);
            let config = config.unwrap();
            assert_eq!(config.step_id, step_id);
            assert!(!config.prompt_template.is_empty());
            assert!(!config.model.is_empty());
        }
    }

    #[test]
    fn test_get_step_config_invalid_step() {
        assert!(get_step_config(1).is_err());
        assert!(get_step_config(2).is_err());
        assert!(get_step_config(4).is_err());
        assert!(get_step_config(99).is_err());
    }

    #[test]
    fn test_get_step_config_models() {
        assert_eq!(get_step_config(0).unwrap().model, "sonnet");
        assert_eq!(get_step_config(3).unwrap().model, "haiku");
        assert_eq!(get_step_config(5).unwrap().model, "opus");
        assert_eq!(get_step_config(6).unwrap().model, "sonnet");
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
        std::fs::create_dir_all(skill_dir.join("references")).unwrap();
        std::fs::create_dir_all(skill_dir.join("context")).unwrap();

        std::fs::write(skill_dir.join("SKILL.md"), "# My Skill").unwrap();
        std::fs::write(
            skill_dir.join("references").join("deep-dive.md"),
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

        assert!(names.contains(&"SKILL.md".to_string()));
        assert!(names.contains(&"references/deep-dive.md".to_string()));
        assert!(!names.iter().any(|n| n.starts_with("context/")));
        assert!(!names.contains(&"workflow.md".to_string()));
    }

    #[test]
    fn test_package_skill_nested_references() {
        let tmp = tempfile::tempdir().unwrap();
        let skill_dir = tmp.path().join("nested-skill");
        std::fs::create_dir_all(skill_dir.join("references").join("sub")).unwrap();

        std::fs::write(skill_dir.join("SKILL.md"), "# Nested").unwrap();
        std::fs::write(
            skill_dir.join("references").join("top.md"),
            "top level",
        )
        .unwrap();
        std::fs::write(
            skill_dir.join("references").join("sub").join("nested.md"),
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
        std::fs::create_dir_all(skill_dir.join("references")).unwrap();

        // Create output files for steps 0, 2, 3, 5, 6
        std::fs::write(
            skill_dir.join("context/clarifications-concepts.md"),
            "step0",
        )
        .unwrap();
        std::fs::write(
            skill_dir.join("context/clarifications-patterns.md"),
            "step2a",
        )
        .unwrap();
        std::fs::write(skill_dir.join("context/clarifications.md"), "step3").unwrap();
        std::fs::write(skill_dir.join("context/decisions.md"), "step5").unwrap();
        std::fs::write(skill_dir.join("SKILL.md"), "step6").unwrap();
        std::fs::write(skill_dir.join("references/ref.md"), "ref").unwrap();

        // Reset from step 3 onwards — steps 0, 2 should be preserved
        delete_step_output_files(workspace, "my-skill", 3);

        // Steps 0 and 2 outputs should still exist
        assert!(skill_dir.join("context/clarifications-concepts.md").exists());
        assert!(skill_dir
            .join("context/clarifications-patterns.md")
            .exists());

        // Steps 3+ outputs should be deleted
        assert!(!skill_dir.join("context/clarifications.md").exists());
        assert!(!skill_dir.join("context/decisions.md").exists());
        assert!(!skill_dir.join("SKILL.md").exists());
        assert!(!skill_dir.join("references").exists());
    }

    #[test]
    fn test_delete_step_output_files_nonexistent_dir_is_ok() {
        // Should not panic on nonexistent directory
        delete_step_output_files("/tmp/nonexistent", "no-skill", 0);
    }
}
