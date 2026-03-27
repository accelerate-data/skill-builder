use super::content::get_skill_content_inner;
use super::diff::{get_refine_diff_inner};
use super::output::{cleanup_skill_snapshot, finalize_refine_run_inner};
use super::protocol::*;
use super::*;
use crate::commands::imported_skills::validate_skill_name;
use tempfile::tempdir;

// ===== get_skill_content_inner tests =====

#[test]
fn test_get_skill_content_reads_skill_md() {
    let dir = tempdir().unwrap();
    let skill_dir = dir.path().join("my-skill");
    std::fs::create_dir_all(&skill_dir).unwrap();
    std::fs::write(skill_dir.join("SKILL.md"), "# My Skill\n\nContent here").unwrap();

    let files = get_skill_content_inner("my-skill", dir.path().to_str().unwrap()).unwrap();
    assert_eq!(files.len(), 1);
    assert_eq!(files[0].path, "SKILL.md");
    assert_eq!(files[0].content, "# My Skill\n\nContent here");
}

#[test]
fn test_get_skill_content_includes_references() {
    let dir = tempdir().unwrap();
    let skill_dir = dir.path().join("my-skill");
    let refs_dir = skill_dir.join("references");
    std::fs::create_dir_all(&refs_dir).unwrap();
    std::fs::write(skill_dir.join("SKILL.md"), "# Skill").unwrap();
    std::fs::write(refs_dir.join("api-guide.md"), "API guide").unwrap();
    std::fs::write(refs_dir.join("best-practices.md"), "Best practices").unwrap();
    // Non-md file should be excluded
    std::fs::write(refs_dir.join("data.json"), "{}").unwrap();

    let files = get_skill_content_inner("my-skill", dir.path().to_str().unwrap()).unwrap();
    assert_eq!(files.len(), 3);
    assert_eq!(files[0].path, "SKILL.md");
    // References should be sorted alphabetically
    assert_eq!(files[1].path, "references/api-guide.md");
    assert_eq!(files[2].path, "references/best-practices.md");
}

#[test]
fn test_get_skill_content_includes_txt_references() {
    let dir = tempdir().unwrap();
    let skill_dir = dir.path().join("my-skill");
    let refs_dir = skill_dir.join("references");
    std::fs::create_dir_all(&refs_dir).unwrap();
    std::fs::write(skill_dir.join("SKILL.md"), "# Skill").unwrap();
    std::fs::write(refs_dir.join("notes.txt"), "Text notes").unwrap();

    let files = get_skill_content_inner("my-skill", dir.path().to_str().unwrap()).unwrap();
    assert_eq!(files.len(), 2);
    assert_eq!(files[1].path, "references/notes.txt");
}

#[test]
fn test_get_skill_content_includes_nested_reference_files() {
    let dir = tempdir().unwrap();
    let skill_dir = dir.path().join("my-skill");
    let nested_dir = skill_dir.join("references").join("patterns");
    std::fs::create_dir_all(&nested_dir).unwrap();
    std::fs::write(skill_dir.join("SKILL.md"), "# Skill").unwrap();
    std::fs::write(nested_dir.join("advanced.md"), "Advanced patterns").unwrap();

    let files = get_skill_content_inner("my-skill", dir.path().to_str().unwrap()).unwrap();
    let paths: Vec<_> = files.iter().map(|f| f.path.as_str()).collect();
    assert_eq!(paths, vec!["SKILL.md", "references/patterns/advanced.md"]);
}

#[test]
fn test_get_skill_content_missing_skill_errors() {
    let dir = tempdir().unwrap();
    let result = get_skill_content_inner("nonexistent", dir.path().to_str().unwrap());
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("not found"));
}

#[test]
fn test_get_skill_content_no_references_dir() {
    let dir = tempdir().unwrap();
    let skill_dir = dir.path().join("my-skill");
    std::fs::create_dir_all(&skill_dir).unwrap();
    std::fs::write(skill_dir.join("SKILL.md"), "# Skill").unwrap();
    // No references/ directory

    let files = get_skill_content_inner("my-skill", dir.path().to_str().unwrap()).unwrap();
    assert_eq!(files.len(), 1);
    assert_eq!(files[0].path, "SKILL.md");
}

// ===== get_refine_diff_inner tests =====

#[test]
fn test_get_refine_diff_no_git_repo_returns_empty() {
    let dir = tempdir().unwrap();
    let result = get_refine_diff_inner("my-skill", dir.path().to_str().unwrap()).unwrap();
    assert_eq!(result.stat, "no git repository");
    assert!(result.files.is_empty());
}

#[test]
fn test_get_refine_diff_no_changes_returns_empty() {
    let dir = tempdir().unwrap();
    crate::git::ensure_repo(dir.path()).unwrap();

    // Create and commit a skill
    let skill_dir = dir.path().join("my-skill");
    std::fs::create_dir_all(&skill_dir).unwrap();
    std::fs::write(skill_dir.join("SKILL.md"), "# Skill").unwrap();
    crate::git::commit_all(dir.path(), "initial").unwrap();

    let result = get_refine_diff_inner("my-skill", dir.path().to_str().unwrap()).unwrap();
    assert_eq!(result.stat, "no changes");
    assert!(result.files.is_empty());
}

#[test]
fn test_get_refine_diff_modified_file_shows_diff() {
    let dir = tempdir().unwrap();
    crate::git::ensure_repo(dir.path()).unwrap();

    let skill_dir = dir.path().join("my-skill");
    std::fs::create_dir_all(&skill_dir).unwrap();
    std::fs::write(skill_dir.join("SKILL.md"), "# V1").unwrap();
    crate::git::commit_all(dir.path(), "v1").unwrap();

    // Modify the file (unstaged)
    std::fs::write(skill_dir.join("SKILL.md"), "# V2\n\nNew content").unwrap();

    let result = get_refine_diff_inner("my-skill", dir.path().to_str().unwrap()).unwrap();
    assert!(!result.files.is_empty());

    let skill_file = result
        .files
        .iter()
        .find(|f| f.path.contains("SKILL.md"))
        .unwrap();
    assert_eq!(skill_file.status, "modified");
    assert!(!skill_file.diff.is_empty());
    assert!(
        skill_file.diff.contains("@@"),
        "diff should include hunk headers"
    );
}

#[test]
fn test_get_refine_diff_filters_to_skill_prefix() {
    let dir = tempdir().unwrap();
    crate::git::ensure_repo(dir.path()).unwrap();

    let skill_a = dir.path().join("skill-a");
    let skill_b = dir.path().join("skill-b");
    std::fs::create_dir_all(&skill_a).unwrap();
    std::fs::create_dir_all(&skill_b).unwrap();
    std::fs::write(skill_a.join("SKILL.md"), "# A").unwrap();
    std::fs::write(skill_b.join("SKILL.md"), "# B").unwrap();
    crate::git::commit_all(dir.path(), "both skills").unwrap();

    std::fs::write(skill_a.join("SKILL.md"), "# A v2").unwrap();
    std::fs::write(skill_b.join("SKILL.md"), "# B v2").unwrap();

    let result = get_refine_diff_inner("skill-a", dir.path().to_str().unwrap()).unwrap();
    assert_eq!(result.files.len(), 1);
    assert!(result.files[0].path.starts_with("skill-a/"));

    let result = get_refine_diff_inner("skill-b", dir.path().to_str().unwrap()).unwrap();
    assert_eq!(result.files.len(), 1);
    assert!(result.files[0].path.starts_with("skill-b/"));
}

#[test]
fn test_get_refine_diff_added_file() {
    let dir = tempdir().unwrap();
    crate::git::ensure_repo(dir.path()).unwrap();

    let skill_dir = dir.path().join("my-skill");
    std::fs::create_dir_all(&skill_dir).unwrap();
    std::fs::write(skill_dir.join("SKILL.md"), "# Skill").unwrap();
    crate::git::commit_all(dir.path(), "initial").unwrap();

    std::fs::create_dir_all(skill_dir.join("references")).unwrap();
    std::fs::write(
        skill_dir.join("references").join("new-ref.md"),
        "New reference",
    )
    .unwrap();

    let result = get_refine_diff_inner("my-skill", dir.path().to_str().unwrap()).unwrap();
    assert!(result.stat != "no git repository");
}

#[test]
fn test_session_manager_new() {
    let manager = RefineSessionManager::new();
    let sessions = manager.0.lock().unwrap();
    assert!(sessions.is_empty());
}

// ===== session lifecycle tests =====

#[test]
fn test_session_create_and_lookup() {
    let manager = RefineSessionManager::new();
    let session_id = "test-session-1".to_string();

    {
        let mut map = manager.0.lock().unwrap();
        map.insert(
            session_id.clone(),
            RefineSession {
                skill_name: "my-skill".to_string(),
                usage_session_id: "usage-session-1".to_string(),
                stream_started: false,
                head_sha_at_start: None,
            },
        );
    }

    let map = manager.0.lock().unwrap();
    let session = map.get(&session_id).unwrap();
    assert_eq!(session.skill_name, "my-skill");
    assert_eq!(session.usage_session_id, "usage-session-1");
}

#[test]
fn test_session_conflict_detection() {
    let manager = RefineSessionManager::new();

    {
        let mut map = manager.0.lock().unwrap();
        map.insert(
            "session-1".to_string(),
            RefineSession {
                skill_name: "my-skill".to_string(),
                usage_session_id: "usage-session-1".to_string(),
                stream_started: false,
                head_sha_at_start: None,
            },
        );
    }

    let map = manager.0.lock().unwrap();
    let has_conflict = map.values().any(|s| s.skill_name == "my-skill");
    assert!(has_conflict);

    let no_conflict = map.values().any(|s| s.skill_name == "other-skill");
    assert!(!no_conflict);
}

#[test]
fn test_session_not_found_returns_none() {
    let manager = RefineSessionManager::new();
    let map = manager.0.lock().unwrap();
    assert!(map.get("nonexistent").is_none());
}

// ===== build_refine_config tests =====

fn test_workspace_path() -> String {
    std::env::temp_dir().join("vibedata").join("skill-builder").to_string_lossy().to_string()
}

fn base_refine_config(prompt: &str) -> (crate::agents::sidecar::SidecarConfig, String) {
    build_refine_config(
        prompt.to_string(),
        "my-skill",
        "usage-session-123",
        &test_workspace_path(),
        crate::types::SecretString::new("sk-test-key".to_string()),
        "sonnet".to_string(),
        false,
        true,
        None,
        None,
        true,
    )
}


#[test]
fn test_refine_config_has_no_agent() {
    let (config, _) = base_refine_config("improve metrics");
    assert!(config.agent_name.is_none());
    assert!(config.model.is_some());
}

#[test]
fn test_refine_config_includes_task_tool_for_streaming_edits() {
    let (config, _) = base_refine_config("test prompt");
    let tools = config.allowed_tools.unwrap();
    assert!(
        tools.contains(&"Agent".to_string()),
        "Agent tool required for scoped rewrite delegation and installed skills"
    );
}

#[test]
fn test_refine_config_includes_all_file_tools() {
    let (config, _) = base_refine_config("edit SKILL.md");
    let tools = config.allowed_tools.unwrap();
    for tool in &["Read", "Edit", "Write", "Glob", "Grep"] {
        assert!(
            tools.contains(&tool.to_string()),
            "Missing expected tool: {}",
            tool
        );
    }
}

#[test]
fn test_refine_config_cwd_points_to_workspace_root() {
    let ws = test_workspace_path();
    let (config, _) = build_refine_config(
        "test".to_string(),
        "data-engineering",
        "usage-session-123",
        &ws,
        crate::types::SecretString::new("sk-key".to_string()),
        "sonnet".to_string(),
        false,
        true,
        None,
        None,
        true,
    );
    assert_eq!(config.cwd, ws);
}

#[test]
fn test_refine_config_no_conversation_history() {
    let (config, _) = base_refine_config("first message");
    assert!(config.conversation_history.is_none());
}

#[test]
fn test_refine_config_agent_id_format() {
    let (_, agent_id) = base_refine_config("test");
    assert!(agent_id.starts_with("refine-my-skill-"));
}

#[test]
fn test_refine_config_sets_model_directly() {
    let (config, _) = base_refine_config("test");
    assert!(config.model.is_some());
    assert!(config.agent_name.is_none());
}

#[test]
fn test_refine_config_uses_stream_max_turns() {
    let (config, _) = base_refine_config("test");
    assert_eq!(config.max_turns, Some(REFINE_STREAM_MAX_TURNS));
}

#[test]
fn test_refine_config_extended_thinking_sets_budget() {
    let (config, _) = build_refine_config(
        "test".to_string(),
        "my-skill",
        "session-123",
        "/skills",
        crate::types::SecretString::new("sk-key".to_string()),
        "sonnet".to_string(),
        true, // extended_thinking enabled
        true,
        None,
        None,
        true,
    );
    assert_eq!(
        config.thinking,
        Some(serde_json::json!({
            "type": "enabled",
            "budgetTokens": 16_000
        }))
    );
}

#[test]
fn test_refine_config_no_thinking_when_disabled() {
    let (config, _) = base_refine_config("test");
    assert!(config.thinking.is_none());
}

#[test]
fn test_refine_config_output_format_is_intentionally_unset_for_chat_flow() {
    let (config, _) = base_refine_config("test");
    assert!(config.output_format.is_none());
}

#[test]
fn test_refine_config_serialization_matches_sidecar_schema() {
    let (config, _) = base_refine_config("full prompt here");
    let expected_usage_session_id = "usage-session-123";

    let json = serde_json::to_string(&config).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

    assert_eq!(parsed["prompt"], "full prompt here");
    assert!(parsed.get("agentName").is_none());
    assert!(parsed.get("model").is_some());
    assert_eq!(parsed["maxTurns"], REFINE_STREAM_MAX_TURNS);
    assert!(parsed["allowedTools"]
        .as_array()
        .unwrap()
        .contains(&serde_json::json!("Task")));
    assert_eq!(parsed["skillName"], "my-skill");
    assert_eq!(parsed["usageSessionId"], expected_usage_session_id);
    assert!(parsed.get("conversationHistory").is_none());
    assert!(parsed.get("sessionId").is_none());
}

#[test]
fn test_refine_config_includes_persistence_identity_for_run_summary() {
    let (config, _) = base_refine_config("improve metrics");
    assert_eq!(config.skill_name.as_deref(), Some("my-skill"));
    assert_eq!(
        config.usage_session_id.as_deref(),
        Some("usage-session-123")
    );
    assert_eq!(config.run_source.as_deref(), Some("refine"));
}

#[test]
fn test_refine_config_requires_skill_creator_plugin() {
    let (config, _) = base_refine_config("improve metrics");
    assert_eq!(
        config.required_plugins,
        Some(vec![
            "skill-content-researcher".to_string(),
            "skill-creator".to_string(),
        ])
    );
}

#[test]
fn test_new_refine_usage_session_id_is_opaque_and_scoped_to_skill() {
    let usage_session_id = new_refine_usage_session_id("my-skill");

    assert!(usage_session_id.starts_with("synthetic:refine:my-skill:"));
    assert_ne!(usage_session_id, new_refine_usage_session_id("my-skill"));
}

#[test]
fn test_refine_config_serialization_omits_none_fields() {
    let (config, _) = base_refine_config("test");
    let json = serde_json::to_string(&config).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

    assert!(parsed.get("conversationHistory").is_none());
    assert!(parsed.get("maxThinkingTokens").is_none());
    assert!(parsed.get("permissionMode").is_none());
}



#[test]
fn test_finalize_refine_run_reads_agent_commit_and_returns_diff() {
    let dir = tempdir().unwrap();
    let workspace_dir = tempdir().unwrap();
    crate::git::ensure_repo(dir.path()).unwrap();

    let skill_dir = dir.path().join("my-skill");
    std::fs::create_dir_all(&skill_dir).unwrap();
    std::fs::write(skill_dir.join("SKILL.md"), "# Skill\n").unwrap();
    crate::git::commit_all(dir.path(), "initial").unwrap();

    // Simulate agent adding a new file and committing
    let refs_dir = skill_dir.join("references");
    std::fs::create_dir_all(&refs_dir).unwrap();
    std::fs::write(refs_dir.join("glossary.md"), "# Glossary\n").unwrap();
    crate::git::commit_all(dir.path(), "my-skill: add glossary").unwrap();

    let result = finalize_refine_run_inner(
        "my-skill",
        dir.path().to_str().unwrap(),
        workspace_dir.path().to_str().unwrap(),
        None,
        None,
    )
    .unwrap();

    assert!(result.commit_sha.is_some());
    assert_eq!(result.files.len(), 2);
    assert_eq!(result.diff.files.len(), 1);
    assert_eq!(result.diff.files[0].path, "my-skill/references/glossary.md");
    assert_eq!(result.diff.files[0].status, "added");
    assert!(result.diff.files[0].diff.contains("+# Glossary"));
}

#[test]
fn test_finalize_refine_run_returns_head_sha_even_when_no_new_changes() {
    let dir = tempdir().unwrap();
    let workspace_dir = tempdir().unwrap();
    crate::git::ensure_repo(dir.path()).unwrap();

    let skill_dir = dir.path().join("my-skill");
    std::fs::create_dir_all(&skill_dir).unwrap();
    std::fs::write(skill_dir.join("SKILL.md"), "# Skill\n").unwrap();
    crate::git::commit_all(dir.path(), "initial").unwrap();

    let result = finalize_refine_run_inner(
        "my-skill",
        dir.path().to_str().unwrap(),
        workspace_dir.path().to_str().unwrap(),
        None,
        None,
    )
    .unwrap();

    // HEAD always exists, so commit_sha is always Some
    assert!(result.commit_sha.is_some());
}

#[test]
fn test_get_skill_content_excludes_context_artifacts() {
    let dir = tempdir().unwrap();
    let skill_dir = dir.path().join("my-skill");
    std::fs::create_dir_all(skill_dir.join("references")).unwrap();
    std::fs::create_dir_all(skill_dir.join("context")).unwrap();
    std::fs::write(skill_dir.join("SKILL.md"), "# Skill\n").unwrap();
    std::fs::write(skill_dir.join("references/glossary.md"), "# Glossary\n").unwrap();
    std::fs::write(skill_dir.join("context/agent-validation-log.md"), "# Validation\n").unwrap();

    let files = get_skill_content_inner("my-skill", dir.path().to_str().unwrap()).unwrap();
    let paths: Vec<_> = files.iter().map(|file| file.path.as_str()).collect();

    assert_eq!(paths, vec!["SKILL.md", "references/glossary.md"]);
}

#[test]
fn test_finalize_refine_run_ignores_structured_output() {
    let skills_dir = tempdir().unwrap();
    let workspace_dir = tempdir().unwrap();
    crate::git::ensure_repo(skills_dir.path()).unwrap();

    let skill_dir = skills_dir.path().join("my-skill");
    std::fs::create_dir_all(&skill_dir).unwrap();
    std::fs::write(skill_dir.join("SKILL.md"), "# Skill\n").unwrap();
    crate::git::commit_all(skills_dir.path(), "generate skill").unwrap();

    let payload = serde_json::json!({
        "status": "validation_complete",
        "validation_log_markdown": "## Validation\nok"
    });

    let result = finalize_refine_run_inner(
        "my-skill",
        skills_dir.path().to_str().unwrap(),
        workspace_dir.path().to_str().unwrap(),
        Some(&payload),
        None,
    )
    .unwrap();

    assert!(result.commit_sha.is_some());
    assert_eq!(result.files.len(), 1);
    assert_eq!(result.files[0].path, "SKILL.md");
    // No materialization — context files should not exist
    assert!(!workspace_dir
        .path()
        .join("my-skill/context/agent-validation-log.md")
        .exists());
}

#[test]
fn test_finalize_refine_run_generates_mock_diff_when_mock_agents_enabled() {
    let prev_mock_agents = std::env::var("MOCK_AGENTS").ok();
    std::env::set_var("MOCK_AGENTS", "true");

    let skills_dir = tempdir().unwrap();
    let workspace_dir = tempdir().unwrap();
    crate::git::ensure_repo(skills_dir.path()).unwrap();

    let skill_dir = skills_dir.path().join("my-skill");
    std::fs::create_dir_all(skill_dir.join("references")).unwrap();
    std::fs::write(skill_dir.join("SKILL.md"), "# Skill\n\nMock rewrite output\n").unwrap();
    std::fs::write(
        skill_dir.join("references/checklist.md"),
        "# Checklist\n\n- Verify modified files UI\n",
    )
    .unwrap();
    crate::git::commit_all(skills_dir.path(), "initial").unwrap();
    std::fs::write(skills_dir.path().join("README.md"), "top-level docs").unwrap();
    crate::git::commit_all(skills_dir.path(), "unrelated repo change").unwrap();

    let result = finalize_refine_run_inner(
        "my-skill",
        skills_dir.path().to_str().unwrap(),
        workspace_dir.path().to_str().unwrap(),
        None,
        None,
    )
    .unwrap();

    assert!(result.commit_sha.is_some());
    assert_eq!(result.files.len(), 2);
    assert_eq!(result.diff.files.len(), 2);
    assert!(result
        .diff
        .files
        .iter()
        .all(|file| file.status == "modified"));
    assert!(result.diff.files[0].path.starts_with("my-skill/"));
    assert!(result.diff.files[0].diff.contains("diff --git"));
    assert!(result.diff.stat.contains("2 file(s) changed"));

    match prev_mock_agents {
        Some(value) => std::env::set_var("MOCK_AGENTS", value),
        None => std::env::remove_var("MOCK_AGENTS"),
    }
}

// ===== build_refine_prompt tests =====

#[test]
fn test_refine_prompt_includes_all_three_paths() {
    let ws = test_workspace_path();
    let skills = std::env::temp_dir().join("skills").to_string_lossy().to_string();
    let prompt = build_refine_prompt(
        "my-skill",
        &ws,
        &skills,
        "Add metrics section",
        None,
    );
    // build_refine_prompt normalises backslashes to forward slashes
    let ws_fwd = ws.replace('\\', "/");
    let skills_fwd = skills.replace('\\', "/");
    assert!(prompt
        .contains(&format!("The workspace directory is: \"{}/my-skill\"", ws_fwd)));
    assert!(prompt.contains(
        &format!("The skill output directory (SKILL.md and references/) is: \"{}/my-skill\"", skills_fwd)
    ));
    assert!(prompt.contains("context_dir"));
    assert!(prompt.contains("eval_dir"));
}

#[test]
fn test_refine_prompt_includes_metadata() {
    let prompt = build_refine_prompt("my-skill", "/ws", "/skills", "Fix overview", None);
    assert!(prompt.contains("The skill name is: my-skill"));
    assert!(prompt.contains("The workspace directory is:"));
    assert!(prompt.contains("The skill output directory"));
}


#[test]
fn test_refine_prompt_file_targeting() {
    let files = vec!["SKILL.md".to_string(), "references/metrics.md".to_string()];
    let prompt = build_refine_prompt(
        "my-skill",
        "/ws",
        "/skills",
        "update these",
        Some(&files),
    );
    assert!(prompt
        .contains("IMPORTANT: Only edit these files (relative to skill output directory):"));
    assert!(prompt.contains("SKILL.md"));
    assert!(prompt.contains("references/metrics.md"));
}

#[test]
fn test_refine_prompt_no_file_constraint_when_empty() {
    let prompt = build_refine_prompt("s", "/ws", "/sk", "edit freely", None);
    assert!(!prompt.contains("Only edit these files"));
}

#[test]
fn test_refine_prompt_includes_user_message() {
    let prompt = build_refine_prompt(
        "s",
        "/ws",
        "/sk",
        "Add SLA metrics to the overview",
        None,
    );
    assert!(prompt.contains("Current request: Add SLA metrics to the overview"));
}

#[test]
fn test_refine_prompt_includes_derived_paths() {
    let prompt = build_refine_prompt("s", "/ws", "/sk", "edit", None);
    assert!(prompt.contains("context_dir"));
    assert!(prompt.contains("eval_dir"));
    assert!(prompt.contains("eval_results_dir"));
}

#[test]
fn test_refine_prompt_no_inline_user_context() {
    let prompt = build_refine_prompt("s", "/ws", "/sk", "edit", None);
    assert!(!prompt.contains("**Industry**:"));
    assert!(!prompt.contains("**Target Audience**:"));
    assert!(!prompt.contains("**Function**:"));
}

#[test]
fn test_refine_prompt_includes_eval_failure_feedback_routing() {
    let prompt = build_refine_prompt("s", "/ws", "/sk", "edit", None);
    assert!(
        prompt.contains("EVAL FAILURE FEEDBACK"),
        "prompt must contain EVAL FAILURE FEEDBACK routing"
    );
    assert!(
        prompt.contains("AskUserQuestion"),
        "prompt must instruct agent to call AskUserQuestion"
    );
    assert!(
        prompt.contains("skill-creator:rewrite-skill"),
        "prompt must direct agent to rewrite-skill after selection"
    );
}

#[test]
fn test_close_session_removes_entry() {
    let manager = RefineSessionManager::new();
    let session_id = "to-close".to_string();

    {
        let mut map = manager.0.lock().unwrap();
        map.insert(
            session_id.clone(),
            RefineSession {
                skill_name: "my-skill".to_string(),
                usage_session_id: "usage-session-close".to_string(),
                stream_started: false,
                head_sha_at_start: None,
            },
        );
        assert_eq!(map.len(), 1);
    }

    {
        let mut map = manager.0.lock().unwrap();
        assert!(map.remove(&session_id).is_some());
    }

    let map = manager.0.lock().unwrap();
    assert!(map.is_empty());
}

#[test]
fn test_close_nonexistent_session_is_noop() {
    let manager = RefineSessionManager::new();
    let mut map = manager.0.lock().unwrap();
    assert!(map.remove("nonexistent").is_none());
}

#[test]
fn test_get_refine_diff_produces_valid_unified_diff() {
    let dir = tempdir().unwrap();
    crate::git::ensure_repo(dir.path()).unwrap();

    let skill_dir = dir.path().join("my-skill");
    std::fs::create_dir_all(&skill_dir).unwrap();
    std::fs::write(skill_dir.join("SKILL.md"), "line1\nline2\nline3\n").unwrap();
    crate::git::commit_all(dir.path(), "initial").unwrap();

    std::fs::write(skill_dir.join("SKILL.md"), "line1\nchanged\nline3\n").unwrap();

    let result = get_refine_diff_inner("my-skill", dir.path().to_str().unwrap()).unwrap();
    let diff = &result.files[0].diff;

    assert!(diff.contains("diff --git"), "missing diff header");
    assert!(diff.contains("--- a/"), "missing old file header");
    assert!(diff.contains("+++ b/"), "missing new file header");
    assert!(diff.contains("@@"), "missing hunk header");
    assert!(diff.contains("-line2"), "missing deletion");
    assert!(diff.contains("+changed"), "missing addition");
    assert!(diff.contains(" line1"), "missing context line");
}

#[test]
fn test_get_refine_diff_stat_counts_insertions_deletions() {
    let dir = tempdir().unwrap();
    crate::git::ensure_repo(dir.path()).unwrap();

    let skill_dir = dir.path().join("my-skill");
    std::fs::create_dir_all(&skill_dir).unwrap();
    std::fs::write(skill_dir.join("SKILL.md"), "old\n").unwrap();
    crate::git::commit_all(dir.path(), "initial").unwrap();

    std::fs::write(skill_dir.join("SKILL.md"), "new\nextra\n").unwrap();

    let result = get_refine_diff_inner("my-skill", dir.path().to_str().unwrap()).unwrap();
    assert!(result.stat.contains("1 file(s) changed"));
    assert!(result.stat.contains("2 insertion(s)(+)"));
    assert!(result.stat.contains("1 deletion(s)(-)"));
}

#[test]
fn test_get_refine_diff_stat_counts_added_and_deleted_files() {
    let dir = tempdir().unwrap();
    crate::git::ensure_repo(dir.path()).unwrap();

    let skill_dir = dir.path().join("my-skill");
    std::fs::create_dir_all(&skill_dir).unwrap();
    std::fs::write(skill_dir.join("remove.md"), "gone-1\ngone-2\n").unwrap();
    crate::git::commit_all(dir.path(), "initial").unwrap();

    std::fs::remove_file(skill_dir.join("remove.md")).unwrap();
    std::fs::write(skill_dir.join("add.md"), "new-1\nnew-2\nnew-3\n").unwrap();
    let repo = git2::Repository::open(dir.path()).unwrap();
    let mut index = repo.index().unwrap();
    index
        .add_path(std::path::Path::new("my-skill/add.md"))
        .unwrap();
    index
        .remove_path(std::path::Path::new("my-skill/remove.md"))
        .unwrap();
    index.write().unwrap();

    let result = get_refine_diff_inner("my-skill", dir.path().to_str().unwrap()).unwrap();
    assert!(result.stat.contains("2 file(s) changed"));
    assert!(result.stat.contains("3 insertion(s)(+)"));
    assert!(result.stat.contains("2 deletion(s)(-)"));
}

#[test]
fn test_get_refine_diff_stat_ignores_patch_file_header_lines() {
    let dir = tempdir().unwrap();
    crate::git::ensure_repo(dir.path()).unwrap();

    let skill_dir = dir.path().join("my-skill");
    std::fs::create_dir_all(&skill_dir).unwrap();
    std::fs::write(skill_dir.join("old.md"), "line-a\n").unwrap();
    crate::git::commit_all(dir.path(), "initial").unwrap();

    std::fs::remove_file(skill_dir.join("old.md")).unwrap();
    std::fs::write(skill_dir.join("new.md"), "line-b\n").unwrap();
    let repo = git2::Repository::open(dir.path()).unwrap();
    let mut index = repo.index().unwrap();
    index
        .add_path(std::path::Path::new("my-skill/new.md"))
        .unwrap();
    index
        .remove_path(std::path::Path::new("my-skill/old.md"))
        .unwrap();
    index.write().unwrap();

    let result = get_refine_diff_inner("my-skill", dir.path().to_str().unwrap()).unwrap();
    assert!(result.stat.contains("2 file(s) changed"));
    assert!(result.stat.contains("1 insertion(s)(+)"));
    assert!(result.stat.contains("1 deletion(s)(-)"));
}

// ===== build_followup_prompt tests =====

#[test]
fn test_followup_prompt_is_just_user_message() {
    let prompt = build_followup_prompt("Add SLA metrics", "/skills", "my-skill", None);
    assert_eq!(prompt, "Add SLA metrics");
    assert!(!prompt.contains("command"));
}

#[test]
fn test_followup_prompt_file_targeting() {
    let files = vec!["SKILL.md".to_string(), "references/api.md".to_string()];
    let prompt = build_followup_prompt("update", "/skills", "my-skill", Some(&files));
    assert!(prompt.contains("IMPORTANT: Only edit these files:"));
    assert!(prompt.contains("/skills/my-skill/SKILL.md"));
    assert!(prompt.contains("/skills/my-skill/references/api.md"));
    assert!(prompt.contains("update"));
}

#[test]
fn test_followup_prompt_no_file_constraint_when_empty() {
    let prompt = build_followup_prompt("edit freely", "/sk", "s", None);
    assert!(!prompt.contains("Only edit these files"));
}

// ===== session stream_started tests =====

#[test]
fn test_session_stream_started_defaults_to_false() {
    let manager = RefineSessionManager::new();
    {
        let mut map = manager.0.lock().unwrap();
        map.insert(
            "s1".to_string(),
            RefineSession {
                skill_name: "my-skill".to_string(),
                usage_session_id: "usage-session-stream".to_string(),
                stream_started: false,
                head_sha_at_start: None,
            },
        );
    }
    let map = manager.0.lock().unwrap();
    assert!(!map.get("s1").unwrap().stream_started);
}

#[test]
fn test_session_stream_started_can_be_set() {
    let manager = RefineSessionManager::new();
    {
        let mut map = manager.0.lock().unwrap();
        map.insert(
            "s1".to_string(),
            RefineSession {
                skill_name: "my-skill".to_string(),
                usage_session_id: "usage-session-stream".to_string(),
                stream_started: false,
                head_sha_at_start: None,
            },
        );
    }
    {
        let mut map = manager.0.lock().unwrap();
        if let Some(session) = map.get_mut("s1") {
            session.stream_started = true;
        }
    }
    let map = manager.0.lock().unwrap();
    assert!(map.get("s1").unwrap().stream_started);
}

#[test]
fn test_completed_turn_does_not_close_or_reset_stream_started_session() {
    let manager = RefineSessionManager::new();
    {
        let mut map = manager.0.lock().unwrap();
        map.insert(
            "s1".to_string(),
            RefineSession {
                skill_name: "my-skill".to_string(),
                usage_session_id: "usage-session-stream".to_string(),
                stream_started: true,
                head_sha_at_start: None,
            },
        );
    }

    let map = manager.0.lock().unwrap();
    let session = map
        .get("s1")
        .expect("session should remain open after a turn completes");
    assert_eq!(session.skill_name, "my-skill");
    assert!(session.stream_started);
}

#[test]
fn test_skill_name_validation_rejects_traversal() {
    assert!(validate_skill_name("good-name").is_ok());
    assert!(validate_skill_name("../bad").is_err());
    assert!(validate_skill_name("bad/name").is_err());
    assert!(validate_skill_name("").is_err());
}

// ===== user context file tests =====

#[test]
fn test_user_context_written_to_file() {
    let ctx = crate::commands::workflow::user_context::format_user_context(
        None,
        &[],
        None,
        Some("Healthcare"),
        Some("Analytics Lead"),
        Some(r#"{"audience":"Data engineers","challenges":"Legacy ETL"}"#),
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        &[]
    );
    assert!(ctx.is_some());
    let ctx = ctx.unwrap();
    assert!(ctx.contains("## User Context"));
    assert!(ctx.contains("**Industry**: Healthcare"));
    assert!(ctx.contains("### Target Audience"));
    assert!(ctx.contains("Data engineers"));
}

#[test]
fn test_no_user_context_when_fields_empty() {
    let ctx = crate::commands::workflow::user_context::format_user_context(
        None,
        &[],
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        &[]
    );
    assert!(ctx.is_none());
}

// ===== cleanup_skill_snapshot tests =====

#[test]
fn test_cleanup_skill_snapshot_removes_existing_snapshot_dir() {
    let workspace_skill_root = tempdir().unwrap();
    let snapshot_dir = workspace_skill_root.path().join("skill-snapshot");
    std::fs::create_dir_all(snapshot_dir.join("some-skill")).unwrap();
    std::fs::write(snapshot_dir.join("some-skill/SKILL.md"), "# Old\n").unwrap();

    assert!(snapshot_dir.exists());
    cleanup_skill_snapshot(workspace_skill_root.path());
    assert!(!snapshot_dir.exists());
}

#[test]
fn test_cleanup_skill_snapshot_noop_when_no_snapshot() {
    let workspace_skill_root = tempdir().unwrap();
    let snapshot_dir = workspace_skill_root.path().join("skill-snapshot");
    assert!(!snapshot_dir.exists());

    // Should not panic or error
    cleanup_skill_snapshot(workspace_skill_root.path());
    assert!(!snapshot_dir.exists());
}

#[test]
fn test_finalize_refine_run_cleans_up_snapshot_dir() {
    let dir = tempdir().unwrap();
    let workspace_dir = tempdir().unwrap();
    crate::git::ensure_repo(dir.path()).unwrap();

    let skill_dir = dir.path().join("my-skill");
    std::fs::create_dir_all(&skill_dir).unwrap();
    std::fs::write(skill_dir.join("SKILL.md"), "# Skill\n").unwrap();
    crate::git::commit_all(dir.path(), "initial").unwrap();

    // Create a stale snapshot in the workspace
    let snapshot_dir = workspace_dir.path().join("my-skill").join("skill-snapshot");
    std::fs::create_dir_all(&snapshot_dir).unwrap();
    std::fs::write(snapshot_dir.join("SKILL.md"), "# Old version\n").unwrap();
    assert!(snapshot_dir.exists());

    let _result = finalize_refine_run_inner(
        "my-skill",
        dir.path().to_str().unwrap(),
        workspace_dir.path().to_str().unwrap(),
        None,
        None,
    )
    .unwrap();

    assert!(!snapshot_dir.exists(), "skill-snapshot should be removed after finalize");
}
