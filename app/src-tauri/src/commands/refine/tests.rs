use super::content::get_skill_content_inner;
use super::diff::get_refine_diff_inner;
use super::output::{
    cleanup_skill_snapshot, finalize_refine_run_inner, finalize_refine_run_inner_for_plugin,
};
use super::protocol::*;
use super::*;
use crate::commands::imported_skills::validate_skill_name;
use crate::skill_paths::{resolve_skill_dir, resolve_workspace_skill_dir, DEFAULT_PLUGIN_SLUG};
use tempfile::tempdir;

fn default_skill_dir(root: &std::path::Path, skill_name: &str) -> std::path::PathBuf {
    resolve_skill_dir(root, DEFAULT_PLUGIN_SLUG, skill_name)
}

fn default_workspace_skill_dir(root: &std::path::Path, skill_name: &str) -> std::path::PathBuf {
    resolve_workspace_skill_dir(root, DEFAULT_PLUGIN_SLUG, skill_name)
}

// ===== get_skill_content_inner tests =====

#[test]
fn test_get_skill_content_reads_skill_md() {
    let dir = tempdir().unwrap();
    let skill_dir = default_skill_dir(dir.path(), "my-skill");
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
    let skill_dir = default_skill_dir(dir.path(), "my-skill");
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
    let skill_dir = default_skill_dir(dir.path(), "my-skill");
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
    let skill_dir = default_skill_dir(dir.path(), "my-skill");
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
    let skill_dir = default_skill_dir(dir.path(), "my-skill");
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
                plugin_slug: DEFAULT_PLUGIN_SLUG.to_string(),
                usage_session_id: "usage-session-1".to_string(),
                conversation_id: None,
                current_agent_id: None,
                has_dispatched_turn: false,
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
                plugin_slug: DEFAULT_PLUGIN_SLUG.to_string(),
                usage_session_id: "usage-session-1".to_string(),
                conversation_id: None,
                current_agent_id: None,
                has_dispatched_turn: false,
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

#[test]
fn test_new_refine_usage_session_id_is_opaque_and_scoped_to_skill() {
    let usage_session_id = new_refine_usage_session_id("my-skill");

    assert!(usage_session_id.starts_with("synthetic:refine:my-skill:"));
    assert_ne!(usage_session_id, new_refine_usage_session_id("my-skill"));
}

fn test_workflow_llm_config() -> crate::types::WorkflowLlmConfig {
    crate::types::WorkflowLlmConfig {
        model: "anthropic/claude-sonnet-4-5".to_string(),
        api_key: Some(crate::types::SecretString::new("sk-test".to_string())),
        base_url: None,
        api_version: None,
        temperature: None,
        max_output_tokens: None,
        timeout_seconds: None,
        num_retries: None,
        reasoning_effort: None,
        extra_headers: None,
        input_cost_per_token: None,
        output_cost_per_token: None,
        usage_id: None,
    }
}

#[test]
fn test_extract_conversation_messages_keeps_user_and_agent_message_events_only() {
    let events = vec![
        serde_json::json!({
            "event_class": "SystemPromptEvent",
            "message": "ignored"
        }),
        serde_json::json!({
            "event_class": "MessageEvent",
            "source": "user",
            "message": "Tighten the summary"
        }),
        serde_json::json!({
            "event_class": "MessageEvent",
            "source": "agent",
            "message": "Updated the summary section."
        }),
        serde_json::json!({
            "kind": "MessageEvent",
            "source": "assistant",
            "text": "Also adjusted the glossary."
        }),
    ];

    assert_eq!(
        extract_conversation_messages(&events),
        vec![
            ConversationMessage {
                role: "user".to_string(),
                content: "Tighten the summary".to_string(),
            },
            ConversationMessage {
                role: "agent".to_string(),
                content: "Updated the summary section.".to_string(),
            },
            ConversationMessage {
                role: "agent".to_string(),
                content: "Also adjusted the glossary.".to_string(),
            },
        ]
    );
}

#[test]
fn test_extract_restored_conversation_events_preserves_tool_activity_and_dispatch_state() {
    let events = vec![
        serde_json::json!({
            "event_class": "SystemPromptEvent",
            "timestamp": "2026-05-07T10:00:00Z",
            "message": "system"
        }),
        serde_json::json!({
            "event_class": "MessageEvent",
            "timestamp": "2026-05-07T10:00:01Z",
            "source": "user",
            "message": "Tighten the intro"
        }),
        serde_json::json!({
            "event_class": "ActionEvent",
            "timestamp": "2026-05-07T10:00:02Z",
            "action": {
                "tool": "terminal",
                "tool_call_id": "tool-1",
                "arguments": { "command": "npm test" }
            }
        }),
        serde_json::json!({
            "event_class": "ObservationEvent",
            "timestamp": "2026-05-07T10:00:03Z",
            "observation": {
                "content": "Tests passed",
                "tool_call_id": "tool-1"
            }
        }),
        serde_json::json!({
            "event_class": "MessageEvent",
            "timestamp": "2026-05-07T10:00:04Z",
            "source": "agent",
            "message": "Updated the intro and verified it."
        }),
    ];

    let restored = extract_restored_conversation_events(&events);

    assert_eq!(restored.len(), 5);
    assert_eq!(restored[2].event_class, "ActionEvent");
    assert_eq!(restored[2].tool_call_id.as_deref(), Some("tool-1"));
    assert_eq!(restored[3].tool_call_id.as_deref(), Some("tool-1"));
    assert!(restored_conversation_has_dispatched_turn(&restored));

    let prepared_only = extract_restored_conversation_events(&events[..1]);
    assert!(
        !restored_conversation_has_dispatched_turn(&prepared_only),
        "prepared sessions with only setup events must not be treated as already dispatched"
    );
}

#[test]
fn test_saved_refine_conversation_matches_runtime_contract() {
    let request = crate::agents::openhands_server::OpenHandsRuntimeRequest {
        prompt: String::new(),
        llm: test_workflow_llm_config(),
        workspace_root_dir: "/tmp/workspace".to_string(),
        workspace_skill_dir: "/tmp/workspace/default/skills/my-skill".to_string(),
        allowed_tools: vec![],
        max_turns: 20,
        user_message_suffix: Some(SKILL_CREATOR_USER_SUFFIX.trim().to_string()),
        system_message_suffix: Some(crate::agents::sidecar::skill_creator_system_message_suffix()),
        task_kind: Some("refine".to_string()),
        plugin_slug: DEFAULT_PLUGIN_SLUG.to_string(),
        skill_name: Some("my-skill".to_string()),
        step_id: Some(-10),
        run_source: Some("refine".to_string()),
        workflow_session_id: None,
        usage_session_id: None,
    };
    let compatible = serde_json::json!({
        "agent": {
            "agent_context": {
                "system_message_suffix": request.system_message_suffix,
                "user_message_suffix": request.user_message_suffix,
            }
        }
    });
    let incompatible = serde_json::json!({
        "agent": {
            "agent_context": {
                "system_message_suffix": request.system_message_suffix,
                "user_message_suffix": "use a different refine contract",
            }
        }
    });

    assert!(crate::agents::openhands_server::conversation_matches_request(&compatible, &request,));
    assert!(
        !crate::agents::openhands_server::conversation_matches_request(&incompatible, &request,)
    );
}

#[test]
fn test_prepared_refine_session_starts_without_dispatch_history() {
    let session = RefineSession {
        skill_name: "my-skill".to_string(),
        plugin_slug: DEFAULT_PLUGIN_SLUG.to_string(),
        usage_session_id: "usage-1".to_string(),
        conversation_id: Some("conv-123".to_string()),
        current_agent_id: None,
        has_dispatched_turn: false,
        head_sha_at_start: None,
    };

    assert_eq!(session.conversation_id.as_deref(), Some("conv-123"));
    assert!(session.current_agent_id.is_none());
    assert!(
        !session.has_dispatched_turn,
        "prepared refine sessions should keep the conversation id before the first dispatched turn"
    );
}

#[test]
fn test_finalize_refine_run_reads_agent_commit_and_returns_diff() {
    let dir = tempdir().unwrap();
    let workspace_dir = tempdir().unwrap();

    let skill_dir = default_skill_dir(dir.path(), "my-skill");
    std::fs::create_dir_all(&skill_dir).unwrap();
    crate::git::ensure_repo(&skill_dir).unwrap();
    std::fs::write(skill_dir.join("SKILL.md"), "# Skill\n").unwrap();
    crate::git::commit_all(&skill_dir, "initial").unwrap();

    // Simulate agent adding a new file and committing
    let refs_dir = skill_dir.join("references");
    std::fs::create_dir_all(&refs_dir).unwrap();
    std::fs::write(refs_dir.join("glossary.md"), "# Glossary\n").unwrap();
    crate::git::commit_all(&skill_dir, "my-skill: add glossary").unwrap();

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
    assert_eq!(result.diff.files[0].path, "references/glossary.md");
    assert_eq!(result.diff.files[0].status, "added");
    assert!(result.diff.files[0].diff.contains("+# Glossary"));
}

#[test]
fn test_finalize_refine_run_returns_head_sha_even_when_no_new_changes() {
    let dir = tempdir().unwrap();
    let workspace_dir = tempdir().unwrap();

    let skill_dir = default_skill_dir(dir.path(), "my-skill");
    std::fs::create_dir_all(&skill_dir).unwrap();
    crate::git::ensure_repo(&skill_dir).unwrap();
    std::fs::write(skill_dir.join("SKILL.md"), "# Skill\n").unwrap();
    crate::git::commit_all(&skill_dir, "initial").unwrap();

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
    let skill_dir = default_skill_dir(dir.path(), "my-skill");
    std::fs::create_dir_all(skill_dir.join("references")).unwrap();
    std::fs::create_dir_all(skill_dir.join("context")).unwrap();
    std::fs::write(skill_dir.join("SKILL.md"), "# Skill\n").unwrap();
    std::fs::write(skill_dir.join("references/glossary.md"), "# Glossary\n").unwrap();
    std::fs::write(
        skill_dir.join("context/agent-validation-log.md"),
        "# Validation\n",
    )
    .unwrap();

    let files = get_skill_content_inner("my-skill", dir.path().to_str().unwrap()).unwrap();
    let paths: Vec<_> = files.iter().map(|file| file.path.as_str()).collect();

    assert_eq!(paths, vec!["SKILL.md", "references/glossary.md"]);
}

#[test]
fn test_finalize_refine_run_ignores_structured_output() {
    let skills_dir = tempdir().unwrap();
    let workspace_dir = tempdir().unwrap();

    let skill_dir = default_skill_dir(skills_dir.path(), "my-skill");
    std::fs::create_dir_all(&skill_dir).unwrap();
    crate::git::ensure_repo(&skill_dir).unwrap();
    std::fs::write(skill_dir.join("SKILL.md"), "# Skill\n").unwrap();
    crate::git::commit_all(&skill_dir, "generate skill").unwrap();

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

    let skill_dir = default_skill_dir(skills_dir.path(), "my-skill");
    std::fs::create_dir_all(skill_dir.join("references")).unwrap();
    crate::git::ensure_repo(&skill_dir).unwrap();
    std::fs::write(
        skill_dir.join("SKILL.md"),
        "# Skill\n\nMock rewrite output\n",
    )
    .unwrap();
    std::fs::write(
        skill_dir.join("references/checklist.md"),
        "# Checklist\n\n- Verify modified files UI\n",
    )
    .unwrap();
    // Simulate agent committing skill content (agent runs, HEAD advances)
    crate::git::commit_all(&skill_dir, "agent: mock refine output").unwrap();

    // No pre_run_sha — finalize reads parent diff showing the agent's commit vs its parent
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
    // With MOCK_AGENTS=true and real diff non-empty, result should still show all skill files
    assert_eq!(result.diff.files.len(), 2);
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
    let ws = std::env::temp_dir()
        .join("vibedata")
        .join("skill-builder")
        .to_string_lossy()
        .to_string();
    let skills = std::env::temp_dir()
        .join("skills")
        .to_string_lossy()
        .to_string();
    let system_prompt = build_refine_prompt("my-skill", &ws, &skills, "Add metrics section", None);
    // build_refine_prompt normalises backslashes to forward slashes
    let ws_fwd = ws.replace('\\', "/");
    let skills_fwd = skills.replace('\\', "/");
    assert!(system_prompt.contains(&format!(
        "The workspace directory is: {}/{}/skills/my-skill",
        ws_fwd,
        crate::skill_paths::DEFAULT_PLUGIN_SLUG
    )));
    assert!(system_prompt.contains(&format!(
        "The skill directory is: {}/{}/skills/my-skill",
        skills_fwd,
        crate::skill_paths::DEFAULT_PLUGIN_SLUG
    )));
    assert!(system_prompt.contains("The context directory is:"));
}

#[test]
fn test_refine_prompt_includes_metadata() {
    let system_prompt = build_refine_prompt("my-skill", "/ws", "/skills", "Fix overview", None);
    assert!(system_prompt.contains("We are refining the skill my-skill"));
    assert!(system_prompt.contains("The workspace directory is:"));
    assert!(system_prompt.contains("The skill directory is:"));
}

#[test]
fn test_refine_prompt_file_targeting() {
    let files = vec!["SKILL.md".to_string(), "references/metrics.md".to_string()];
    let system_prompt =
        build_refine_prompt("my-skill", "/ws", "/skills", "update these", Some(&files));
    assert!(system_prompt
        .contains("IMPORTANT: Only edit these files (relative to skill output directory):"));
    assert!(system_prompt.contains("SKILL.md"));
    assert!(system_prompt.contains("references/metrics.md"));
}

#[test]
fn test_refine_prompt_no_file_constraint_when_empty() {
    let system_prompt = build_refine_prompt("s", "/ws", "/sk", "edit freely", None);
    assert!(!system_prompt.contains("Only edit these files"));
}

#[test]
fn test_refine_prompt_includes_user_message() {
    let prompt = build_refine_prompt("s", "/ws", "/sk", "Add SLA metrics to the overview", None);
    assert!(prompt.contains("Add SLA metrics to the overview"));
}

#[test]
fn test_refine_prompt_includes_derived_paths() {
    let system_prompt = build_refine_prompt("s", "/ws", "/sk", "edit", None);
    assert!(system_prompt.contains("The context directory is:"));
    assert!(system_prompt.contains("The workspace directory is:"));
}

#[test]
fn test_refine_prompt_no_inline_user_context() {
    let system_prompt = build_refine_prompt("s", "/ws", "/sk", "edit", None);
    assert!(!system_prompt.contains("**Industry**:"));
    assert!(!system_prompt.contains("**Target Audience**:"));
    assert!(!system_prompt.contains("**Function**:"));
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
                plugin_slug: DEFAULT_PLUGIN_SLUG.to_string(),
                usage_session_id: "usage-session-close".to_string(),
                conversation_id: None,
                current_agent_id: None,
                has_dispatched_turn: false,
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
    assert!(prompt.contains("/default/skills/my-skill/SKILL.md"));
    assert!(prompt.contains("/default/skills/my-skill/references/api.md"));
    assert!(prompt.contains("update"));
}

#[test]
fn test_followup_prompt_no_file_constraint_when_empty() {
    let prompt = build_followup_prompt("edit freely", "/sk", "s", None);
    assert!(!prompt.contains("Only edit these files"));
}

#[test]
fn test_prepared_refine_session_uses_initial_prompt_until_first_send_persists_state() {
    let skill_output_dir = default_skill_dir(std::path::Path::new("/skills"), "my-skill");
    let mut session = RefineSession {
        skill_name: "my-skill".to_string(),
        plugin_slug: DEFAULT_PLUGIN_SLUG.to_string(),
        usage_session_id: "usage-1".to_string(),
        conversation_id: Some("conv-123".to_string()),
        current_agent_id: None,
        has_dispatched_turn: false,
        head_sha_at_start: None,
    };

    let first_prompt = if session.has_dispatched_turn {
        build_followup_prompt_with_output_dir("Add SLA metrics", &skill_output_dir, None)
    } else {
        build_refine_prompt_with_output_dir(
            &session.skill_name,
            "/workspace",
            &session.plugin_slug,
            &skill_output_dir,
            "Add SLA metrics",
            None,
        )
    };
    assert!(
        first_prompt.contains("We are refining the skill my-skill"),
        "prepared sessions should still use the full initial prompt before first send"
    );

    session.conversation_id = Some("conv-456".to_string());
    session.current_agent_id = Some("agent-456".to_string());
    session.has_dispatched_turn = true;

    let followup_prompt = if session.has_dispatched_turn {
        build_followup_prompt_with_output_dir("Tighten the overview", &skill_output_dir, None)
    } else {
        build_refine_prompt_with_output_dir(
            &session.skill_name,
            "/workspace",
            &session.plugin_slug,
            &skill_output_dir,
            "Tighten the overview",
            None,
        )
    };

    assert_eq!(session.conversation_id.as_deref(), Some("conv-456"));
    assert_eq!(session.current_agent_id.as_deref(), Some("agent-456"));
    assert!(session.has_dispatched_turn);
    assert_eq!(followup_prompt, "Tighten the overview");
}

#[test]
fn test_prepared_refine_session_routes_by_dispatch_flag_not_conversation_id() {
    let skill_output_dir = default_skill_dir(std::path::Path::new("/skills"), "my-skill");
    let session = RefineSession {
        skill_name: "my-skill".to_string(),
        plugin_slug: DEFAULT_PLUGIN_SLUG.to_string(),
        usage_session_id: "usage-1".to_string(),
        conversation_id: Some("prepared-conversation".to_string()),
        current_agent_id: Some("prepared-agent".to_string()),
        has_dispatched_turn: false,
        head_sha_at_start: None,
    };

    let prompt = if session.has_dispatched_turn {
        build_followup_prompt_with_output_dir("Tighten the overview", &skill_output_dir, None)
    } else {
        build_refine_prompt_with_output_dir(
            &session.skill_name,
            "/workspace",
            &session.plugin_slug,
            &skill_output_dir,
            "Tighten the overview",
            None,
        )
    };

    assert_eq!(
        session.conversation_id.as_deref(),
        Some("prepared-conversation")
    );
    assert_eq!(session.current_agent_id.as_deref(), Some("prepared-agent"));
    assert!(
        prompt.contains("We are refining the skill my-skill"),
        "prepared conversation ids must not switch refine into followup mode before the first dispatched turn"
    );
    assert_ne!(prompt, "Tighten the overview");
}

#[test]
fn test_skill_name_validation_rejects_traversal() {
    assert!(validate_skill_name("good-name").is_ok());
    assert!(validate_skill_name("../bad").is_err());
    assert!(validate_skill_name("bad/name").is_err());
    assert!(validate_skill_name("").is_err());
}

// ===== user context tests =====
//
// VU-1157 moved `format_user_context` from `commands::workflow::user_context`
// to `commands::workflow::prompt`. The helper still produces the same
// inline-only markdown block; the file-based `write_user_context_file` was
// removed entirely.

#[test]
fn test_user_context_inline_block_built_from_fields() {
    let ctx = crate::commands::workflow::prompt::format_user_context(
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
        &[],
    );
    assert!(ctx.is_some());
    let ctx = ctx.unwrap();
    assert!(ctx.contains("## User Context"));
    assert!(ctx.contains("**Industry**: Healthcare"));
    assert!(ctx.contains("### Target Audience"));
    assert!(ctx.contains("Data engineers"));
}

#[test]
fn test_user_context_inline_block_empty_when_fields_empty() {
    let ctx = crate::commands::workflow::prompt::format_user_context(
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
        &[],
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

    let skill_dir = default_skill_dir(dir.path(), "my-skill");
    std::fs::create_dir_all(&skill_dir).unwrap();
    crate::git::ensure_repo(&skill_dir).unwrap();
    std::fs::write(skill_dir.join("SKILL.md"), "# Skill\n").unwrap();
    crate::git::commit_all(&skill_dir, "initial").unwrap();

    // Create a stale snapshot in the workspace (under default plugin slug)
    let snapshot_dir =
        default_workspace_skill_dir(workspace_dir.path(), "my-skill").join("skill-snapshot");
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

    assert!(
        !snapshot_dir.exists(),
        "skill-snapshot should be removed after finalize"
    );
}

// ===== finalize_refine_run version tagging tests =====

#[test]
fn test_finalize_refine_tags_new_version_after_commit() {
    let dir = tempdir().unwrap();
    let workspace_dir = tempdir().unwrap();
    let plugin = crate::skill_paths::DEFAULT_PLUGIN_SLUG;

    // Create skill at plugin-aware path and tag v1.0.0
    let skill_dir = resolve_skill_dir(dir.path(), plugin, "tag-skill");
    std::fs::create_dir_all(&skill_dir).unwrap();
    crate::git::ensure_repo(&skill_dir).unwrap();
    std::fs::write(skill_dir.join("SKILL.md"), "# V1\n").unwrap();
    let initial_sha = crate::git::commit_all(&skill_dir, "tag-skill: initial")
        .unwrap()
        .unwrap();
    crate::git::create_skill_version_tag(&skill_dir, plugin, "tag-skill", "1.0.0").unwrap();

    // Simulate agent commit (refine edit)
    std::fs::write(skill_dir.join("SKILL.md"), "# V1 refined\n").unwrap();
    crate::git::commit_all(&skill_dir, "tag-skill: refine content").unwrap();

    let result = finalize_refine_run_inner_for_plugin(
        "tag-skill",
        dir.path().to_str().unwrap(),
        workspace_dir.path().to_str().unwrap(),
        plugin,
        None,
        Some(&initial_sha),
    )
    .unwrap();

    assert!(result.commit_sha.is_some());
    let version = crate::git::latest_skill_semver(&skill_dir, plugin, "tag-skill").unwrap();
    assert_eq!(version, "1.0.1", "refine should bump patch version");
}

#[test]
fn test_finalize_refine_tags_v0_0_1_when_no_prior_tags() {
    let dir = tempdir().unwrap();
    let workspace_dir = tempdir().unwrap();
    let plugin = crate::skill_paths::DEFAULT_PLUGIN_SLUG;

    // Create skill without any tags
    let skill_dir = resolve_skill_dir(dir.path(), plugin, "notag-skill");
    std::fs::create_dir_all(&skill_dir).unwrap();
    crate::git::ensure_repo(&skill_dir).unwrap();
    std::fs::write(skill_dir.join("SKILL.md"), "# V1\n").unwrap();
    let initial_sha = crate::git::commit_all(&skill_dir, "notag-skill: initial")
        .unwrap()
        .unwrap();

    // Simulate agent commit
    std::fs::write(skill_dir.join("SKILL.md"), "# V1 refined\n").unwrap();
    crate::git::commit_all(&skill_dir, "notag-skill: refine").unwrap();

    let result = finalize_refine_run_inner_for_plugin(
        "notag-skill",
        dir.path().to_str().unwrap(),
        workspace_dir.path().to_str().unwrap(),
        plugin,
        None,
        Some(&initial_sha),
    )
    .unwrap();

    assert!(result.commit_sha.is_some());
    let version = crate::git::latest_skill_semver(&skill_dir, plugin, "notag-skill").unwrap();
    assert_eq!(
        version, "0.0.1",
        "first refine with no prior tags should create v0.0.1"
    );
}

#[test]
fn test_finalize_refine_no_tag_when_head_unchanged() {
    let dir = tempdir().unwrap();
    let workspace_dir = tempdir().unwrap();
    let plugin = crate::skill_paths::DEFAULT_PLUGIN_SLUG;

    // Create skill and tag v1.0.0
    let skill_dir = resolve_skill_dir(dir.path(), plugin, "noop-skill");
    std::fs::create_dir_all(&skill_dir).unwrap();
    crate::git::ensure_repo(&skill_dir).unwrap();
    std::fs::write(skill_dir.join("SKILL.md"), "# V1\n").unwrap();
    let sha = crate::git::commit_all(&skill_dir, "noop-skill: initial")
        .unwrap()
        .unwrap();
    crate::git::create_skill_version_tag(&skill_dir, plugin, "noop-skill", "1.0.0").unwrap();

    // Call finalize with pre_run_sha == current HEAD (no agent commit)
    let result = finalize_refine_run_inner_for_plugin(
        "noop-skill",
        dir.path().to_str().unwrap(),
        workspace_dir.path().to_str().unwrap(),
        plugin,
        None,
        Some(&sha),
    )
    .unwrap();

    assert!(result.commit_sha.is_some());
    let version = crate::git::latest_skill_semver(&skill_dir, plugin, "noop-skill").unwrap();
    assert_eq!(version, "1.0.0", "no-op refine should not create a new tag");
}

#[test]
fn test_finalize_refine_commits_dirty_skill_path_and_tags() {
    let dir = tempdir().unwrap();
    let workspace_dir = tempdir().unwrap();
    let plugin = crate::skill_paths::DEFAULT_PLUGIN_SLUG;

    let skill_dir = resolve_skill_dir(dir.path(), plugin, "dirty-skill");
    std::fs::create_dir_all(&skill_dir).unwrap();
    crate::git::ensure_repo(&skill_dir).unwrap();
    std::fs::write(skill_dir.join("SKILL.md"), "# V1\n").unwrap();
    let initial_sha = crate::git::commit_all(&skill_dir, "dirty-skill: initial")
        .unwrap()
        .unwrap();
    crate::git::create_skill_version_tag(&skill_dir, plugin, "dirty-skill", "1.0.0").unwrap();

    // Simulate rewrite-skill editing the configured skill directory but failing to commit.
    std::fs::write(skill_dir.join("SKILL.md"), "# V1 refined\n").unwrap();

    let result = finalize_refine_run_inner_for_plugin(
        "dirty-skill",
        dir.path().to_str().unwrap(),
        workspace_dir.path().to_str().unwrap(),
        plugin,
        None,
        Some(&initial_sha),
    )
    .unwrap();

    let new_sha = result
        .commit_sha
        .expect("finalize should commit dirty skill changes");
    assert_ne!(new_sha, initial_sha);
    let version = crate::git::latest_skill_semver(&skill_dir, plugin, "dirty-skill").unwrap();
    assert_eq!(
        version, "1.0.1",
        "backend refine commit should bump patch version"
    );
    assert!(
        result.diff.files.iter().any(|file| file.path == "SKILL.md"),
        "refine diff should include the backend-committed skill file"
    );
}

// ===== Protected frontmatter field tests =====

use super::output::update_skill_name;

#[test]
fn test_update_skill_name_replaces_existing() {
    let content = "---\nname: old-name\ndescription: A skill\n---\n# Body\n";
    let result = update_skill_name(content, "new-name").unwrap();
    assert!(result.contains("name: \"new-name\""), "got: {}", result);
    assert!(!result.contains("name: old-name"));
    assert!(result.contains("description: A skill"));
    assert!(result.contains("# Body"));
}

#[test]
fn test_update_skill_name_inserts_when_missing() {
    let content = "---\ndescription: A skill\n---\n# Body\n";
    let result = update_skill_name(content, "inserted-name").unwrap();
    assert!(
        result.contains("name: \"inserted-name\""),
        "got: {}",
        result
    );
    assert!(result.contains("description: A skill"));
}

#[test]
fn test_finalize_restores_name_changed_by_agent() {
    let dir = tempdir().unwrap();
    let workspace_dir = tempdir().unwrap();

    let skill_dir = default_skill_dir(dir.path(), "guard-skill");
    std::fs::create_dir_all(&skill_dir).unwrap();
    crate::git::ensure_repo(&skill_dir).unwrap();
    std::fs::write(
        skill_dir.join("SKILL.md"),
        "---\nname: guard-skill\ndescription: Original description\n---\n# Content\n",
    )
    .unwrap();
    crate::git::commit_all(&skill_dir, "initial").unwrap();

    // Capture pre-run SHA
    let pre_sha = {
        let repo = git2::Repository::open(&skill_dir).unwrap();
        let sha = repo
            .head()
            .unwrap()
            .peel_to_commit()
            .unwrap()
            .id()
            .to_string();
        sha
    };

    // Simulate agent changing the name
    std::fs::write(
        skill_dir.join("SKILL.md"),
        "---\nname: renamed-skill\ndescription: Original description\n---\n# Content\n",
    )
    .unwrap();
    crate::git::commit_all(&skill_dir, "agent rename").unwrap();

    let result = finalize_refine_run_inner(
        "guard-skill",
        dir.path().to_str().unwrap(),
        workspace_dir.path().to_str().unwrap(),
        None,
        Some(&pre_sha),
    )
    .unwrap();

    // Name should be restored in the file on disk (yaml_quote_scalar wraps in double quotes)
    let final_content = std::fs::read_to_string(skill_dir.join("SKILL.md")).unwrap();
    assert!(
        final_content.contains("name: \"guard-skill\""),
        "name should be restored to original, got: {}",
        final_content
    );
    assert!(!final_content.contains("renamed-skill"));
    assert!(result.commit_sha.is_some());
}

#[test]
fn test_finalize_restores_description_changed_by_agent() {
    let dir = tempdir().unwrap();
    let workspace_dir = tempdir().unwrap();

    let skill_dir = default_skill_dir(dir.path(), "desc-skill");
    std::fs::create_dir_all(&skill_dir).unwrap();
    crate::git::ensure_repo(&skill_dir).unwrap();
    std::fs::write(
        skill_dir.join("SKILL.md"),
        "---\nname: desc-skill\ndescription: Original description\n---\n# Content\n",
    )
    .unwrap();
    crate::git::commit_all(&skill_dir, "initial").unwrap();

    let pre_sha = {
        let repo = git2::Repository::open(&skill_dir).unwrap();
        let sha = repo
            .head()
            .unwrap()
            .peel_to_commit()
            .unwrap()
            .id()
            .to_string();
        sha
    };

    // Simulate agent changing the description
    std::fs::write(
        skill_dir.join("SKILL.md"),
        "---\nname: desc-skill\ndescription: Agent rewrote this\n---\n# Content\n",
    )
    .unwrap();
    crate::git::commit_all(&skill_dir, "agent rewrite desc").unwrap();

    let result = finalize_refine_run_inner(
        "desc-skill",
        dir.path().to_str().unwrap(),
        workspace_dir.path().to_str().unwrap(),
        None,
        Some(&pre_sha),
    )
    .unwrap();

    let final_content = std::fs::read_to_string(skill_dir.join("SKILL.md")).unwrap();
    assert!(
        final_content.contains("description: \"Original description\""),
        "description should be restored to original, got: {}",
        final_content
    );
    assert!(!final_content.contains("Agent rewrote this"));
    assert!(result.commit_sha.is_some());
}

#[test]
fn test_finalize_restores_both_name_and_description_changed_by_agent() {
    let dir = tempdir().unwrap();
    let workspace_dir = tempdir().unwrap();

    let skill_dir = default_skill_dir(dir.path(), "both-skill");
    std::fs::create_dir_all(&skill_dir).unwrap();
    crate::git::ensure_repo(&skill_dir).unwrap();
    std::fs::write(
        skill_dir.join("SKILL.md"),
        "---\nname: both-skill\ndescription: Keep me\n---\n# Content\n",
    )
    .unwrap();
    crate::git::commit_all(&skill_dir, "initial").unwrap();

    let pre_sha = {
        let repo = git2::Repository::open(&skill_dir).unwrap();
        let sha = repo
            .head()
            .unwrap()
            .peel_to_commit()
            .unwrap()
            .id()
            .to_string();
        sha
    };

    // Simulate agent changing both fields
    std::fs::write(
        skill_dir.join("SKILL.md"),
        "---\nname: changed-name\ndescription: Changed desc\n---\n# Content\n",
    )
    .unwrap();
    crate::git::commit_all(&skill_dir, "agent changes both").unwrap();

    let result = finalize_refine_run_inner(
        "both-skill",
        dir.path().to_str().unwrap(),
        workspace_dir.path().to_str().unwrap(),
        None,
        Some(&pre_sha),
    )
    .unwrap();

    let final_content = std::fs::read_to_string(skill_dir.join("SKILL.md")).unwrap();
    assert!(
        final_content.contains("name: \"both-skill\""),
        "name should be restored, got: {}",
        final_content
    );
    assert!(
        final_content.contains("description: \"Keep me\""),
        "description should be restored, got: {}",
        final_content
    );
    assert!(result.commit_sha.is_some());
}

#[test]
fn test_finalize_no_fixup_when_frontmatter_unchanged() {
    let dir = tempdir().unwrap();
    let workspace_dir = tempdir().unwrap();

    let skill_dir = default_skill_dir(dir.path(), "no-fix-skill");
    std::fs::create_dir_all(&skill_dir).unwrap();
    crate::git::ensure_repo(&skill_dir).unwrap();
    std::fs::write(
        skill_dir.join("SKILL.md"),
        "---\nname: no-fix-skill\ndescription: Stay the same\n---\n# Content\n",
    )
    .unwrap();
    crate::git::commit_all(&skill_dir, "initial").unwrap();

    let pre_sha = {
        let repo = git2::Repository::open(&skill_dir).unwrap();
        let sha = repo
            .head()
            .unwrap()
            .peel_to_commit()
            .unwrap()
            .id()
            .to_string();
        sha
    };

    // Simulate agent changing only body content, not frontmatter
    std::fs::write(
        skill_dir.join("SKILL.md"),
        "---\nname: no-fix-skill\ndescription: Stay the same\n---\n# Updated Content\n",
    )
    .unwrap();
    crate::git::commit_all(&skill_dir, "agent edits body only").unwrap();

    let agent_sha = {
        let repo = git2::Repository::open(&skill_dir).unwrap();
        let sha = repo
            .head()
            .unwrap()
            .peel_to_commit()
            .unwrap()
            .id()
            .to_string();
        sha
    };

    let result = finalize_refine_run_inner(
        "no-fix-skill",
        dir.path().to_str().unwrap(),
        workspace_dir.path().to_str().unwrap(),
        None,
        Some(&pre_sha),
    )
    .unwrap();

    // HEAD should be the tagged version of the agent commit, not a fixup
    // The commit_sha from result should exist and there should be no extra fixup commit
    let final_sha = {
        let repo = git2::Repository::open(&skill_dir).unwrap();
        let sha = repo
            .head()
            .unwrap()
            .peel_to_commit()
            .unwrap()
            .id()
            .to_string();
        sha
    };

    // The final SHA equals the agent SHA because no fixup was needed
    // (version tagging doesn't create a new commit, just a tag)
    assert_eq!(
        final_sha, agent_sha,
        "no fixup commit should be created when frontmatter unchanged"
    );
    assert!(result.commit_sha.is_some());
}

#[test]
fn test_finalize_diff_shows_full_changes_when_fixup_created() {
    let dir = tempdir().unwrap();
    let workspace_dir = tempdir().unwrap();

    let skill_dir = default_skill_dir(dir.path(), "diff-skill");
    std::fs::create_dir_all(&skill_dir).unwrap();
    crate::git::ensure_repo(&skill_dir).unwrap();
    std::fs::write(
        skill_dir.join("SKILL.md"),
        "---\nname: diff-skill\ndescription: Original desc\n---\n# Old Content\n",
    )
    .unwrap();
    crate::git::commit_all(&skill_dir, "initial").unwrap();

    let pre_sha = {
        let repo = git2::Repository::open(&skill_dir).unwrap();
        let sha = repo
            .head()
            .unwrap()
            .peel_to_commit()
            .unwrap()
            .id()
            .to_string();
        sha
    };

    // Simulate agent changing name AND body content in a single commit
    std::fs::write(
        skill_dir.join("SKILL.md"),
        "---\nname: agent-renamed\ndescription: Original desc\n---\n# New Content from agent\n",
    )
    .unwrap();
    crate::git::commit_all(&skill_dir, "agent refine").unwrap();

    let result = finalize_refine_run_inner(
        "diff-skill",
        dir.path().to_str().unwrap(),
        workspace_dir.path().to_str().unwrap(),
        None,
        Some(&pre_sha),
    )
    .unwrap();

    // Diff should show the full change (pre-run → final), not just the fixup
    assert!(
        !result.diff.files.is_empty(),
        "diff should not be empty — agent made real content changes"
    );
    let skill_diff = result
        .diff
        .files
        .iter()
        .find(|f| f.path.ends_with("SKILL.md"));
    assert!(skill_diff.is_some(), "SKILL.md should appear in diff");
    let patch = &skill_diff.unwrap().diff;
    // Body change should be visible (the actual refine work)
    assert!(
        patch.contains("New Content from agent"),
        "diff should include the agent's body changes, got: {}",
        patch
    );
    // Name should show as restored (original, not agent-renamed)
    assert!(
        !patch.contains("agent-renamed"),
        "diff should not show the agent's renamed name"
    );
}

#[test]
fn test_finalize_creates_exactly_one_tag_after_fixup() {
    let dir = tempdir().unwrap();
    let workspace_dir = tempdir().unwrap();
    let plugin = crate::skill_paths::DEFAULT_PLUGIN_SLUG;

    let skill_dir = resolve_skill_dir(dir.path(), plugin, "tag-fix-skill");
    std::fs::create_dir_all(&skill_dir).unwrap();
    crate::git::ensure_repo(&skill_dir).unwrap();
    std::fs::write(
        skill_dir.join("SKILL.md"),
        "---\nname: tag-fix-skill\ndescription: Keep this\n---\n# V1\n",
    )
    .unwrap();
    crate::git::commit_all(&skill_dir, "initial").unwrap();
    crate::git::create_skill_version_tag(&skill_dir, plugin, "tag-fix-skill", "1.0.0").unwrap();

    let pre_sha = {
        let repo = git2::Repository::open(&skill_dir).unwrap();
        let sha = repo
            .head()
            .unwrap()
            .peel_to_commit()
            .unwrap()
            .id()
            .to_string();
        sha
    };

    // Agent changes name (triggers fixup) and body
    std::fs::write(
        skill_dir.join("SKILL.md"),
        "---\nname: agent-renamed\ndescription: Keep this\n---\n# V1 refined\n",
    )
    .unwrap();
    crate::git::commit_all(&skill_dir, "agent refine").unwrap();

    let _result = finalize_refine_run_inner_for_plugin(
        "tag-fix-skill",
        dir.path().to_str().unwrap(),
        workspace_dir.path().to_str().unwrap(),
        plugin,
        None,
        Some(&pre_sha),
    )
    .unwrap();

    // Count tags for this skill — should be exactly 2 (the pre-existing 1.0.0 + one new tag)
    let repo = git2::Repository::open(&skill_dir).unwrap();
    let glob = crate::skill_paths::skill_tag_glob(plugin, "tag-fix-skill");
    let tags = repo.tag_names(Some(&glob)).unwrap();
    let tag_count = tags.iter().flatten().count();
    assert_eq!(
        tag_count, 2,
        "should have exactly 2 tags (1.0.0 + 1.0.1), got {}",
        tag_count
    );

    let version = crate::git::latest_skill_semver(&skill_dir, plugin, "tag-fix-skill").unwrap();
    assert_eq!(version, "1.0.1", "fixup should not cause double-bump");
}

// ===== OpenHands refine tests =====

#[test]
fn test_refine_openhands_config_uses_skill_creator_system_message_suffix() {
    let config = build_refine_openhands_config(
        "my-skill",
        DEFAULT_PLUGIN_SLUG,
        "Refine the skill",
        "/tmp/workspace",
        crate::types::WorkflowLlmConfig {
            model: "anthropic/claude-sonnet-4-5".to_string(),
            api_key: Some(crate::types::SecretString::new("sk-test".to_string())),
            base_url: None,
            api_version: None,
            temperature: None,
            max_output_tokens: None,
            timeout_seconds: None,
            num_retries: None,
            reasoning_effort: None,
            extra_headers: None,
            input_cost_per_token: None,
            output_cost_per_token: None,
            usage_id: Some("workflow".to_string()),
        },
    );

    let expected_suffix = crate::agents::sidecar::skill_creator_system_message_suffix();
    assert_eq!(config.agent_name.as_deref(), Some("skill-creator"));
    assert_eq!(config.task_kind.as_deref(), Some("refine"));
    assert_eq!(
        config.system_message_suffix.as_deref(),
        Some(expected_suffix.as_str())
    );
}

#[test]
fn test_refine_session_holds_conversation_and_agent_ids() {
    let session = RefineSession {
        skill_name: "my-skill".to_string(),
        plugin_slug: DEFAULT_PLUGIN_SLUG.to_string(),
        usage_session_id: "usage-1".to_string(),
        conversation_id: Some("conv-123".to_string()),
        current_agent_id: Some("agent-456".to_string()),
        has_dispatched_turn: true,
        head_sha_at_start: None,
    };
    assert_eq!(session.conversation_id.as_deref(), Some("conv-123"));
    assert_eq!(session.current_agent_id.as_deref(), Some("agent-456"));
}

#[test]
fn test_refine_initial_prompt_has_no_claude_code_routing() {
    let prompt = build_refine_prompt("my-skill", "/ws", "/sk", "edit", None);
    assert!(
        !prompt.contains("AskUserQuestion"),
        "OpenHands prompt must not reference AskUserQuestion: {}",
        prompt
    );
    assert!(
        !prompt.contains("rewrite-skill"),
        "OpenHands prompt must not direct to skill-creator:rewrite-skill agent: {}",
        prompt
    );
    assert!(
        !prompt.contains("via the Agent tool"),
        "OpenHands prompt must not reference the Agent tool: {}",
        prompt
    );
}

#[test]
fn test_refine_initial_prompt_includes_eval_feedback_guidance() {
    let prompt = build_refine_prompt("my-skill", "/ws", "/sk", "edit", None);
    assert!(
        prompt.contains("eval failure feedback"),
        "OpenHands prompt should describe how to handle eval feedback: {}",
        prompt
    );
    assert!(
        prompt.contains("plain text"),
        "OpenHands prompt should instruct plain-text response (no tool interrupt): {}",
        prompt
    );
}
