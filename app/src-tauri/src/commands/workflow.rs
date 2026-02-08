use std::io::{Read, Write};
use std::path::Path;

use crate::agents::sidecar::{self, AgentRegistry, SidecarConfig};
use crate::types::{AppSettings, PackageResult, ParallelAgentResult, StepConfig};
use git2::{Cred, RemoteCallbacks, Repository};
use tauri_plugin_store::StoreExt;

const STORE_FILE: &str = "settings.json";
const SETTINGS_KEY: &str = "app_settings";

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

fn read_api_key(app: &tauri::AppHandle) -> Result<String, String> {
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    let settings: AppSettings = match store.get(SETTINGS_KEY) {
        Some(v) => serde_json::from_value(v.clone()).map_err(|e| e.to_string())?,
        None => AppSettings::default(),
    };
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
    skill_name: String,
    step_id: u32,
    domain: String,
    workspace_path: String,
) -> Result<String, String> {
    let step = get_step_config(step_id)?;
    let api_key = read_api_key(&app)?;
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
    skill_name: String,
    domain: String,
    workspace_path: String,
) -> Result<ParallelAgentResult, String> {
    let api_key = read_api_key(&app)?;
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

    // Run in a blocking task since zip I/O is synchronous
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

    // Add SKILL.md if it exists
    let skill_md = skill_dir.join("SKILL.md");
    if skill_md.exists() {
        add_file_to_zip(&mut zip, &skill_md, "SKILL.md", options)?;
    }

    // Add references/ directory recursively
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

#[tauri::command]
pub async fn auto_commit_step(
    app: tauri::AppHandle,
    skill_name: String,
    step_name: String,
    workspace_path: String,
) -> Result<Option<String>, String> {
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    let settings: AppSettings = match store.get(SETTINGS_KEY) {
        Some(v) => serde_json::from_value(v.clone()).map_err(|e| e.to_string())?,
        None => AppSettings::default(),
    };

    if !settings.auto_commit {
        return Ok(None);
    }

    let message = format!("skill-builder: [{}] {}", skill_name, step_name);

    let repo = Repository::open(&workspace_path)
        .map_err(|e| format!("Failed to open repo: {}", e))?;

    let mut index = repo.index().map_err(|e| e.to_string())?;
    index
        .add_all(["*"].iter(), git2::IndexAddOption::DEFAULT, None)
        .map_err(|e| e.to_string())?;
    index
        .update_all(["*"].iter(), None)
        .map_err(|e| e.to_string())?;
    index.write().map_err(|e| e.to_string())?;

    let tree_oid = index.write_tree().map_err(|e| e.to_string())?;
    let tree = repo.find_tree(tree_oid).map_err(|e| e.to_string())?;

    let sig = repo
        .signature()
        .or_else(|_| git2::Signature::now("Skill Builder", "noreply@skill-builder.app"))
        .map_err(|e| e.to_string())?;

    let parent = repo
        .head()
        .ok()
        .and_then(|h| h.peel_to_commit().ok());

    // No changes to commit
    if let Some(ref p) = parent {
        if p.tree_id() == tree_oid {
            return Ok(None);
        }
    }

    let parents: Vec<&git2::Commit> = parent.iter().collect();

    repo.commit(Some("HEAD"), &sig, &sig, &message, &tree, &parents)
        .map_err(|e| e.to_string())?;

    // Auto-push if enabled and token available
    if settings.auto_push {
        if let Some(token) = settings.github_token {
            let mut callbacks = RemoteCallbacks::new();
            callbacks.credentials(move |_url, _username, _allowed| {
                Cred::userpass_plaintext("x-access-token", &token)
            });

            let mut push_opts = git2::PushOptions::new();
            push_opts.remote_callbacks(callbacks);

            let mut remote = repo
                .find_remote("origin")
                .map_err(|e| e.to_string())?;

            let head = repo.head().map_err(|e| e.to_string())?;
            let branch = head.shorthand().unwrap_or("main");
            let refspec = format!("refs/heads/{}:refs/heads/{}", branch, branch);

            remote
                .push(&[&refspec], Some(&mut push_opts))
                .map_err(|e| format!("Push failed: {}", e))?;

            return Ok(Some(format!("Committed and pushed: {}", message)));
        }
    }

    Ok(Some(format!("Committed: {}", message)))
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
        // Should have a timestamp suffix
        let parts: Vec<&str> = id.rsplitn(2, '-').collect();
        assert!(parts[0].parse::<u128>().is_ok());
    }

    #[test]
    fn test_package_skill_creates_zip() {
        let tmp = tempfile::tempdir().unwrap();
        let skill_dir = tmp.path().join("my-skill");
        std::fs::create_dir_all(skill_dir.join("references")).unwrap();
        std::fs::create_dir_all(skill_dir.join("context")).unwrap();

        // Create files that should be included
        std::fs::write(skill_dir.join("SKILL.md"), "# My Skill").unwrap();
        std::fs::write(
            skill_dir.join("references").join("deep-dive.md"),
            "# Deep Dive",
        )
        .unwrap();

        // Create files that should NOT be included
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

        // Verify zip contents
        let file = std::fs::File::open(&result.file_path).unwrap();
        let mut archive = zip::ZipArchive::new(file).unwrap();

        let names: Vec<String> = (0..archive.len())
            .map(|i| archive.by_index(i).unwrap().name().to_string())
            .collect();

        assert!(names.contains(&"SKILL.md".to_string()));
        assert!(names.contains(&"references/deep-dive.md".to_string()));
        // context/ and workflow.md should not be in the zip
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
}
