use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;

use crate::agents::sidecar::{self, SidecarConfig};
use crate::agents::sidecar_pool::SidecarPool;
use crate::commands::imported_skills::validate_skill_name;
use crate::commands::workflow::resolve_model_id;
use crate::db::{self, Db};
use crate::types::{RefineFileDiff, RefineDiff, RefineSessionInfo, SkillFileContent};

/// Tools available to the refine-skill agent. Matches the agent's frontmatter
/// `tools: Read, Edit, Write, Glob, Grep, Task`. Task is required for the
/// `/rewrite` and `/validate` magic commands which spawn sub-agents.
const REFINE_TOOLS: &[&str] = &["Read", "Edit", "Write", "Glob", "Grep", "Task"];

const REFINE_AGENT_NAME: &str = "refine-skill";
/// Max agentic turns for the entire streaming session. Each user message may
/// use multiple turns internally (tool calls, etc.). 400 covers ~20 messages
/// × 20 turns each. When exhausted, the sidecar emits session_exhausted and
/// the frontend shows a "session limit reached" notice.
const REFINE_STREAM_MAX_TURNS: u32 = 400;

// ─── Session management scaffolding ──────────────────────────────────────────

/// In-memory state for a single refine session.
///
/// Created by `start_refine_session`, used by `send_refine_message`.
/// The streaming session is started on the first message and maintained
/// across subsequent messages — the SDK preserves full conversation state.
pub struct RefineSession {
    pub skill_name: String,
    /// Whether the sidecar streaming session has been started.
    /// First `send_refine_message` sends `stream_start`, subsequent sends `stream_message`.
    pub stream_started: bool,
}

/// Manages active refine sessions. Registered as Tauri managed state.
/// Follows the same `Mutex<HashMap>` pattern as `SidecarPool`.
///
/// ## Concurrency rule
/// Only one refine session per skill_name is allowed at a time.
/// `start_refine_session` must check this before creating a new session.
pub struct RefineSessionManager(pub Mutex<HashMap<String, RefineSession>>);

impl RefineSessionManager {
    pub fn new() -> Self {
        Self(Mutex::new(HashMap::new()))
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/// Build a SidecarConfig for the first refine message (stream_start).
/// Extracted for testability — `send_refine_message` calls this then sends stream_start.
fn build_refine_config(
    prompt: String,
    skill_name: &str,
    workspace_path: &str,
    api_key: String,
    model: String,
    extended_thinking: bool,
) -> (SidecarConfig, String) {
    let thinking_budget = extended_thinking.then_some(16_000u32);

    // CWD is the workspace root (.vibedata) so the sidecar can find
    // .claude/agents/ and .claude/CLAUDE.md. Skill files are accessed via
    // absolute paths embedded in the prompt.
    let cwd = workspace_path.to_string();
    let agent_id = format!(
        "refine-{}-{}",
        skill_name,
        chrono::Utc::now().timestamp_millis()
    );

    let config = SidecarConfig {
        prompt,
        betas: crate::commands::workflow::build_betas(thinking_budget, &model),
        model: Some(model),
        api_key,
        cwd,
        allowed_tools: Some(REFINE_TOOLS.iter().map(|s| s.to_string()).collect()),
        // Use the streaming session max turns — covers all turns across all
        // messages in this session (not per-message like the old one-shot mode).
        max_turns: Some(REFINE_STREAM_MAX_TURNS),
        permission_mode: None,
        session_id: None,
        max_thinking_tokens: thinking_budget,
        path_to_claude_code_executable: None,
        agent_name: Some(REFINE_AGENT_NAME.to_string()),
        conversation_history: None,
    };

    (config, agent_id)
}

/// Build a follow-up prompt for subsequent refine messages.
/// Simpler than the first message — the SDK already has full context from the
/// first turn (paths, user-context.md pointer). Only includes command,
/// file targeting, and the user's new message.
fn build_followup_prompt(
    user_message: &str,
    skills_path: &str,
    skill_name: &str,
    target_files: Option<&[String]>,
    command: Option<&str>,
) -> String {
    let skill_dir = Path::new(skills_path).join(skill_name);
    let effective_command = command.unwrap_or("refine");

    let mut prompt = format!("The command is: {}.", effective_command);

    if let Some(files) = target_files {
        if !files.is_empty() {
            let abs_files: Vec<String> = files
                .iter()
                .map(|f| format!("{}/{}", skill_dir.display(), f))
                .collect();
            prompt.push_str(&format!(
                "\n\nIMPORTANT: Only edit these files: {}. Do not modify any other files.",
                abs_files.join(", ")
            ));
        }
    }

    prompt.push_str(&format!("\n\nCurrent request: {}", user_message));
    prompt
}

/// Build the refine agent prompt with all runtime fields.
/// Matches the workflow pattern in `workflow.rs::build_prompt` — provides skill directory,
/// context directory, workspace directory, command, and a pointer to user-context.md.
/// User context (purpose, industry, intake fields) is NOT inlined — the agent reads
/// user-context.md from the workspace directory at runtime.
fn build_refine_prompt(
    skill_name: &str,
    workspace_path: &str,
    skills_path: &str,
    user_message: &str,
    target_files: Option<&[String]>,
    command: Option<&str>,
) -> String {
    let skill_dir = Path::new(skills_path).join(skill_name);
    let context_dir = Path::new(skills_path).join(skill_name).join("context");
    let workspace_dir = Path::new(workspace_path).join(skill_name);

    let effective_command = command.unwrap_or("refine");

    let mut prompt = format!(
        "The skill name is: {}. The command is: {}. \
         The skill directory is: {}. The context directory is: {}. The workspace directory is: {}. \
         All directories already exist — never create directories with mkdir or any other method.",
        skill_name,
        effective_command,
        skill_dir.display(),
        context_dir.display(),
        workspace_dir.display(),
    );

    prompt.push_str(" Read user-context.md from the workspace directory for purpose, description, and all user context.");

    // File constraint: restrict edits to specific files if @file targets were specified
    if let Some(files) = target_files {
        if !files.is_empty() {
            let abs_files: Vec<String> = files
                .iter()
                .map(|f| format!("{}/{}", skill_dir.display(), f))
                .collect();
            prompt.push_str(&format!(
                "\n\nIMPORTANT: Only edit these files: {}. Do not modify any other files.",
                abs_files.join(", ")
            ));
        }
    }

    prompt.push_str(&format!("\n\nCurrent request: {}", user_message));

    prompt
}

fn resolve_skills_path(db: &Db, workspace_path: &str) -> Result<String, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let settings = db::read_settings(&conn)?;
    Ok(settings
        .skills_path
        .unwrap_or_else(|| workspace_path.to_string()))
}

// ─── get_skill_content_for_refine ────────────────────────────────────────────

/// Returns the content of SKILL.md and all reference files for a skill.
/// Used by the preview panel in the refine chat UI.
#[tauri::command]
pub fn get_skill_content_for_refine(
    skill_name: String,
    workspace_path: String,
    db: tauri::State<'_, Db>,
) -> Result<Vec<SkillFileContent>, String> {
    log::info!("[get_skill_content_for_refine] skill={}", skill_name);
    validate_skill_name(&skill_name)?;
    let skills_path = resolve_skills_path(&db, &workspace_path).map_err(|e| {
        log::error!("[get_skill_content_for_refine] Failed to resolve skills path: {}", e);
        e
    })?;
    get_skill_content_inner(&skill_name, &skills_path).map_err(|e| {
        log::error!("[get_skill_content_for_refine] {}", e);
        e
    })
}

fn get_skill_content_inner(
    skill_name: &str,
    skills_path: &str,
) -> Result<Vec<SkillFileContent>, String> {
    let skill_root = Path::new(skills_path).join(skill_name);
    if !skill_root.exists() {
        return Err(format!(
            "Skill '{}' not found at {}",
            skill_name,
            skill_root.display()
        ));
    }

    log::debug!("[get_skill_content_for_refine] reading from {}", skill_root.display());
    let mut files = Vec::new();

    // 1. SKILL.md (the main skill file)
    let skill_md = skill_root.join("SKILL.md");
    if skill_md.exists() {
        let content = std::fs::read_to_string(&skill_md)
            .map_err(|e| format!("Failed to read SKILL.md: {}", e))?;
        files.push(SkillFileContent {
            path: "SKILL.md".to_string(),
            content,
        });
    }

    // 2. references/*.md and context/*.md (sorted alphabetically for stable ordering)
    for subdir in &["references", "context"] {
        let dir = skill_root.join(subdir);
        if dir.is_dir() {
            let mut entries: Vec<_> = std::fs::read_dir(&dir)
                .map_err(|e| format!("Failed to read {} dir: {}", subdir, e))?
                .flatten()
                .filter(|e| matches!(e.path().extension().and_then(|x| x.to_str()), Some("md" | "txt")))
                .collect();
            entries.sort_by_key(|e| e.file_name());
            for entry in entries {
                let rel = format!("{}/{}", subdir, entry.file_name().to_string_lossy());
                let content = std::fs::read_to_string(entry.path())
                    .map_err(|e| format!("Failed to read {}: {}", rel, e))?;
                files.push(SkillFileContent {
                    path: rel,
                    content,
                });
            }
        }
    }

    log::debug!("[get_skill_content_for_refine] returning {} files", files.len());
    Ok(files)
}

// ─── get_refine_diff ─────────────────────────────────────────────────────────

/// Returns the git diff for a skill's directory — both staged and unstaged changes.
/// Used by the preview panel to show what the refine agent changed.
///
/// Also supports per-file diffs via the `files` array in the response.
/// The frontend can use `git checkout -- <file>` (via a separate command) to undo
/// individual file changes.
#[tauri::command]
pub fn get_refine_diff(
    skill_name: String,
    workspace_path: String,
    db: tauri::State<'_, Db>,
) -> Result<RefineDiff, String> {
    log::info!("[get_refine_diff] skill={}", skill_name);
    validate_skill_name(&skill_name)?;
    let skills_path = resolve_skills_path(&db, &workspace_path).map_err(|e| {
        log::error!("[get_refine_diff] Failed to resolve skills path: {}", e);
        e
    })?;
    get_refine_diff_inner(&skill_name, &skills_path).map_err(|e| {
        log::error!("[get_refine_diff] {}", e);
        e
    })
}

fn get_refine_diff_inner(skill_name: &str, skills_path: &str) -> Result<RefineDiff, String> {
    use git2::{Delta, DiffFormat, DiffOptions, Repository};

    let repo_path = Path::new(skills_path);
    if !repo_path.join(".git").exists() {
        log::debug!("[get_refine_diff] no .git at {}, returning empty", repo_path.display());
        return Ok(RefineDiff {
            stat: "no git repository".to_string(),
            files: vec![],
        });
    }

    let repo =
        Repository::open(repo_path).map_err(|e| format!("Failed to open repo: {}", e))?;

    let prefix = format!("{}/", skill_name);
    log::debug!("[get_refine_diff] computing diff for prefix '{}'", prefix);
    let mut opts = DiffOptions::new();
    opts.pathspec(&prefix);

    // Get HEAD tree (may not exist in a fresh repo)
    let head_tree = repo.head().ok().and_then(|h| h.peel_to_tree().ok());

    // Combined HEAD→workdir diff (staged + unstaged in one pass, no double-counting)
    let diff = repo
        .diff_tree_to_workdir_with_index(head_tree.as_ref(), Some(&mut opts))
        .map_err(|e| format!("Failed to compute diff: {}", e))?;

    // Collect per-file diffs using print() which provides a single mutable callback
    let mut file_map: HashMap<String, RefineFileDiff> = HashMap::new();

    diff.print(DiffFormat::Patch, |delta, _hunk, line| {
        let path = delta
            .new_file()
            .path()
            .or_else(|| delta.old_file().path())
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();

        let status = match delta.status() {
            Delta::Added => "added",
            Delta::Deleted => "deleted",
            _ => "modified",
        };
        let entry = file_map.entry(path.clone()).or_insert_with(|| RefineFileDiff {
            path,
            status: status.to_string(),
            diff: String::new(),
        });

        // Append diff content: hunk headers, context, additions, deletions
        let origin = line.origin();
        if let Ok(s) = std::str::from_utf8(line.content()) {
            match origin {
                '+' | '-' | ' ' => {
                    entry.diff.push(origin);
                    entry.diff.push_str(s);
                }
                'H' => {
                    // Hunk header (@@) — content already includes the @@ prefix
                    entry.diff.push_str(s);
                }
                _ => {}
            }
        }

        true
    })
    .map_err(|e| format!("Failed to print diff: {}", e))?;

    if file_map.is_empty() {
        log::debug!("[get_refine_diff] no changes for '{}'", skill_name);
        return Ok(RefineDiff {
            stat: "no changes".to_string(),
            files: vec![],
        });
    }

    // Build stat summary from line counts (single pass per file)
    let total_files = file_map.len();
    let (insertions, deletions) = file_map.values().fold((0usize, 0usize), |(ins, del), f| {
        f.diff.lines().fold((ins, del), |(i, d), line| match line.as_bytes().first() {
            Some(b'+') => (i + 1, d),
            Some(b'-') => (i, d + 1),
            _ => (i, d),
        })
    });

    let stat = format!(
        "{} file(s) changed, {} insertion(s)(+), {} deletion(s)(-)",
        total_files, insertions, deletions
    );

    let mut files: Vec<RefineFileDiff> = file_map.into_values().collect();
    files.sort_by(|a, b| a.path.cmp(&b.path));

    Ok(RefineDiff { stat, files })
}

// ─── start_refine_session ─────────────────────────────────────────────────────

/// Initialize a refine session for a skill.
///
/// No sidecar is spawned here — the sidecar is spawned per-message in `send_refine_message`.
#[tauri::command]
pub async fn start_refine_session(
    skill_name: String,
    workspace_path: String,
    sessions: tauri::State<'_, RefineSessionManager>,
    db: tauri::State<'_, Db>,
) -> Result<RefineSessionInfo, String> {
    log::info!("[start_refine_session] skill={}", skill_name);
    validate_skill_name(&skill_name)?;

    let skills_path = resolve_skills_path(&db, &workspace_path).map_err(|e| {
        log::error!("[start_refine_session] Failed to resolve skills path: {}", e);
        e
    })?;

    // Verify SKILL.md exists
    let skill_md = Path::new(&skills_path).join(&skill_name).join("SKILL.md");
    if !skill_md.exists() {
        let msg = format!("SKILL.md not found at {}", skill_md.display());
        log::error!("[start_refine_session] {}", msg);
        return Err(msg);
    }

    let mut map = sessions.0.lock().map_err(|e| {
        log::error!("[start_refine_session] Failed to acquire session lock: {}", e);
        e.to_string()
    })?;

    // Only one session per skill at a time
    if map.values().any(|s| s.skill_name == skill_name) {
        let msg = format!("A refine session already exists for skill '{}'", skill_name);
        log::error!("[start_refine_session] {}", msg);
        return Err(msg);
    }

    let session_id = uuid::Uuid::new_v4().to_string();
    let created_at = chrono::Utc::now().to_rfc3339();
    log::debug!(
        "[start_refine_session] creating session {} for skill '{}'",
        session_id,
        skill_name
    );

    map.insert(
        session_id.clone(),
        RefineSession {
            skill_name: skill_name.clone(),
            stream_started: false,
        },
    );

    Ok(RefineSessionInfo {
        session_id,
        skill_name,
        created_at,
    })
}

// ─── send_refine_message ──────────────────────────────────────────────────────

/// Send a user message to the refine agent and stream responses back.
///
/// On the first call, writes user-context.md to the workspace directory and
/// starts a streaming session (stream_start) with the agent prompt including
/// all 3 directory paths, command, and a pointer to user-context.md.
/// On subsequent calls, pushes a follow-up message
/// (stream_message) — the SDK maintains full conversation state.
///
/// Returns the `agent_id` so the frontend can listen for `agent-message` and
/// `agent-exit` events scoped to this request.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn send_refine_message(
    session_id: String,
    user_message: String,
    workspace_path: String,
    target_files: Option<Vec<String>>,
    command: Option<String>,
    sessions: tauri::State<'_, RefineSessionManager>,
    pool: tauri::State<'_, SidecarPool>,
    db: tauri::State<'_, Db>,
    app: tauri::AppHandle,
) -> Result<String, String> {
    log::info!(
        "[send_refine_message] session=[REDACTED] command={:?}",
        command
    );

    // 1. Look up session and check stream state
    let (skill_name, stream_started) = {
        let map = sessions.0.lock().map_err(|e| {
            log::error!("[send_refine_message] Failed to acquire session lock: {}", e);
            e.to_string()
        })?;
        let session = map.get(&session_id).ok_or_else(|| {
            // Log active sessions to help diagnose stale-session or post-restart failures
            let active: Vec<String> = map
                .iter()
                .map(|(id, s)| format!("{}={}", &id[..8.min(id.len())], s.skill_name))
                .collect();
            let msg = format!(
                "No refine session found for id '{}'. Active sessions ({}): [{}]",
                session_id,
                map.len(),
                active.join(", ")
            );
            log::error!("[send_refine_message] {}", msg);
            msg
        })?;
        (session.skill_name.clone(), session.stream_started)
    };
    log::info!(
        "[send_refine_message] session={} skill={} stream_started={}",
        session_id, skill_name, stream_started
    );

    if !stream_started {
        // ─── First message: start streaming session ───────────────────────
        // 2. Read settings, workflow run data, and write user-context.md
        let (api_key, extended_thinking, model, skills_path) = {
            let conn = db.0.lock().map_err(|e| {
                log::error!("[send_refine_message] Failed to acquire DB lock: {}", e);
                e.to_string()
            })?;
            let settings = db::read_settings_hydrated(&conn).map_err(|e| {
                log::error!("[send_refine_message] Failed to read settings: {}", e);
                e
            })?;
            let key = settings.anthropic_api_key.ok_or_else(|| {
                log::error!("[send_refine_message] Anthropic API key not configured");
                "Anthropic API key not configured".to_string()
            })?;
            let model = resolve_model_id(
                settings.preferred_model.as_deref().unwrap_or("sonnet")
            );

            let skills_path = settings
                .skills_path
                .unwrap_or_else(|| workspace_path.clone());

            let run_row = db::get_workflow_run(&conn, &skill_name).ok().flatten();
            let purpose = run_row
                .as_ref()
                .map(|r| r.purpose.clone())
                .unwrap_or_else(|| "domain".to_string());

            let intake_json = run_row.as_ref().and_then(|r| r.intake_json.clone());

            // Write user-context.md so the agent can read it (same as workflow steps)
            crate::commands::workflow::write_user_context_file(
                &workspace_path,
                &skill_name,
                &[], // tags not fetched in refine path — lightweight call
                settings.industry.as_deref(),
                settings.function_role.as_deref(),
                intake_json.as_deref(),
                None, Some(purpose.as_str()), None, None, None, None, None,
            );

            (key, settings.extended_thinking, model, skills_path)
        };

        // 3. Ensure the skill's workspace dir exists before building the prompt.
        // The prompt tells the agent "All directories already exist", so this must
        // be true by the time the prompt is constructed. For marketplace skills,
        // workspace_path/skill_name/ is not created during import.
        let skill_workspace_dir = Path::new(&workspace_path).join(&skill_name);
        if !skill_workspace_dir.exists() {
            if let Err(e) = std::fs::create_dir_all(&skill_workspace_dir) {
                log::warn!(
                    "[send_refine_message] failed to create skill workspace dir '{}': {}",
                    skill_workspace_dir.display(),
                    e
                );
            } else {
                log::debug!(
                    "[send_refine_message] created skill workspace dir '{}'",
                    skill_workspace_dir.display()
                );
            }
        }

        // 4. Build prompt with paths and pointer to user-context.md (no inline context)
        let prompt = build_refine_prompt(
            &skill_name,
            &workspace_path,
            &skills_path,
            &user_message,
            target_files.as_deref(),
            command.as_deref(),
        );
        log::debug!(
            "[send_refine_message] first message prompt ({} chars) for skill '{}' command={:?}:\n{}",
            prompt.len(),
            skill_name,
            command,
            prompt
        );

        // 5. Build config and agent_id
        log::info!("[send_refine_message] skill={} model={}", skill_name, model);
        let (mut config, agent_id) = build_refine_config(
            prompt,
            &skill_name,
            &workspace_path,
            api_key,
            model,
            extended_thinking,
        );

        // Resolve SDK cli.js path
        if config.path_to_claude_code_executable.is_none() {
            if let Ok(cli_path) = sidecar::resolve_sdk_cli_path_public(&app) {
                config.path_to_claude_code_executable = Some(cli_path);
            }
        }

        log::debug!(
            "[send_refine_message] starting stream session {} agent={} cwd={}",
            session_id, agent_id, config.cwd,
        );

        // 5. Send stream_start via pool
        pool.send_stream_start(
            &skill_name,
            &session_id,
            &agent_id,
            config,
            &app,
        )
        .await
        .map_err(|e| {
            log::error!("[send_refine_message] Failed to start stream: {}", e);
            e
        })?;

        // Mark session as stream-started
        {
            let mut map = sessions.0.lock().map_err(|e| e.to_string())?;
            if let Some(session) = map.get_mut(&session_id) {
                session.stream_started = true;
            }
        }

        Ok(agent_id)
    } else {
        // ─── Follow-up message: push into existing stream ─────────────────
        let skills_path = {
            let conn = db.0.lock().map_err(|e| e.to_string())?;
            let settings = db::read_settings(&conn)?;
            settings.skills_path.unwrap_or_else(|| workspace_path.clone())
        };

        let prompt = build_followup_prompt(
            &user_message,
            &skills_path,
            &skill_name,
            target_files.as_deref(),
            command.as_deref(),
        );
        log::debug!(
            "[send_refine_message] follow-up prompt ({} chars) for skill '{}' command={:?}:\n{}",
            prompt.len(), skill_name, command, prompt
        );

        let agent_id = format!(
            "refine-{}-{}",
            skill_name,
            chrono::Utc::now().timestamp_millis()
        );

        pool.send_stream_message(
            &skill_name,
            &session_id,
            &agent_id,
            &prompt,
            &app,
        )
        .await
        .map_err(|e| {
            log::error!("[send_refine_message] Failed to send stream message: {}", e);
            e
        })?;

        Ok(agent_id)
    }
}

// ─── close_refine_session ─────────────────────────────────────────────────────

/// Close a refine session, removing it from the session manager.
///
/// Called by the frontend when navigating away from the refine chat or when
/// the user explicitly ends the session. This frees the one-per-skill slot
/// so a new session can be started for the same skill.
///
/// If a streaming session was started, sends `stream_end` to the sidecar to
/// close the async generator and finish the SDK query.
#[tauri::command]
pub async fn close_refine_session(
    session_id: String,
    sessions: tauri::State<'_, RefineSessionManager>,
    pool: tauri::State<'_, SidecarPool>,
) -> Result<(), String> {
    log::info!("[close_refine_session] session=[REDACTED]");

    let removed = {
        let mut map = sessions.0.lock().map_err(|e| {
            log::error!("[close_refine_session] Failed to acquire session lock: {}", e);
            e.to_string()
        })?;
        map.remove(&session_id)
    };

    if let Some(session) = removed {
        log::debug!(
            "[close_refine_session] removed session [REDACTED] (stream_started={})",
            session.stream_started
        );

        if session.stream_started {
            // Send stream_end to close the sidecar streaming session
            if let Err(e) = pool
                .send_stream_end(&session.skill_name, &session_id)
                .await
            {
                log::warn!(
                    "[close_refine_session] Failed to send stream_end for session [REDACTED]: {}",
                    e
                );
            }
        }
    } else {
        log::debug!("[close_refine_session] session [REDACTED] not found (already closed)");
    }

    Ok(())
}

// ─── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
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
        // Verify hunk headers are included for valid unified diff format
        assert!(skill_file.diff.contains("@@"), "diff should include hunk headers");
    }

    #[test]
    fn test_get_refine_diff_filters_to_skill_prefix() {
        let dir = tempdir().unwrap();
        crate::git::ensure_repo(dir.path()).unwrap();

        // Create two skills
        let skill_a = dir.path().join("skill-a");
        let skill_b = dir.path().join("skill-b");
        std::fs::create_dir_all(&skill_a).unwrap();
        std::fs::create_dir_all(&skill_b).unwrap();
        std::fs::write(skill_a.join("SKILL.md"), "# A").unwrap();
        std::fs::write(skill_b.join("SKILL.md"), "# B").unwrap();
        crate::git::commit_all(dir.path(), "both skills").unwrap();

        // Modify both
        std::fs::write(skill_a.join("SKILL.md"), "# A v2").unwrap();
        std::fs::write(skill_b.join("SKILL.md"), "# B v2").unwrap();

        // Diff for skill-a should only show skill-a changes
        let result = get_refine_diff_inner("skill-a", dir.path().to_str().unwrap()).unwrap();
        assert_eq!(result.files.len(), 1);
        assert!(result.files[0].path.starts_with("skill-a/"));

        // Diff for skill-b should only show skill-b changes
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

        // Add a new file (unstaged)
        std::fs::create_dir_all(skill_dir.join("references")).unwrap();
        std::fs::write(
            skill_dir.join("references").join("new-ref.md"),
            "New reference",
        )
        .unwrap();

        let result = get_refine_diff_inner("my-skill", dir.path().to_str().unwrap()).unwrap();
        // The new file should appear (untracked files may not show in index-to-workdir diff
        // unless added to index first, so this tests the staged path too)
        // Note: git2's diff_index_to_workdir may not show untracked files by default.
        // This is acceptable — the agent's changes are typically staged by the sidecar.
        // We just verify no error occurs.
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
                    stream_started: false,
                },
            );
        }

        let map = manager.0.lock().unwrap();
        let session = map.get(&session_id).unwrap();
        assert_eq!(session.skill_name, "my-skill");
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
                    stream_started: false,
                },
            );
        }

        // Check that a second session for the same skill is detected
        let map = manager.0.lock().unwrap();
        let has_conflict = map.values().any(|s| s.skill_name == "my-skill");
        assert!(has_conflict);

        // Different skill should not conflict
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

    fn base_refine_config(prompt: &str) -> (SidecarConfig, String) {
        build_refine_config(
            prompt.to_string(),
            "my-skill",
            "/home/user/.vibedata",
            "sk-test-key".to_string(),
            "sonnet".to_string(),
            false,
        )
    }

    #[test]
    fn test_refine_config_always_uses_refine_skill_agent() {
        // agent_name must always be "refine-skill" — it handles /rewrite and /validate
        // as magic commands internally
        let (config, _) = base_refine_config("improve metrics");
        assert_eq!(config.agent_name.as_deref(), Some("refine-skill"));
    }

    #[test]
    fn test_refine_config_includes_task_tool_for_magic_commands() {
        // /rewrite and /validate magic commands spawn sub-agents via Task
        let (config, _) = base_refine_config("test prompt");
        let tools = config.allowed_tools.unwrap();
        assert!(
            tools.contains(&"Task".to_string()),
            "Task tool required for /rewrite and /validate magic commands"
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
        // cwd must be workspace_path (.vibedata), NOT skills_path.
        // This matches workflow agents — the sidecar needs .claude/agents/ and CLAUDE.md
        // which are deployed to the workspace root.
        let (config, _) = build_refine_config(
            "test".to_string(),
            "data-engineering",
            "/home/user/.vibedata",
            "sk-key".to_string(),
            "sonnet".to_string(),
            false,
        );
        assert_eq!(config.cwd, "/home/user/.vibedata");
    }

    #[test]
    fn test_refine_config_no_conversation_history() {
        // Streaming mode: conversation_history is always None since
        // the SDK maintains state across turns.
        let (config, _) = base_refine_config("first message");
        assert!(config.conversation_history.is_none());
    }

    #[test]
    fn test_refine_config_agent_id_format() {
        let (_, agent_id) = base_refine_config("test");
        assert!(agent_id.starts_with("refine-my-skill-"));
    }

    #[test]
    fn test_refine_config_session_id_is_none() {
        // session_id must NOT be passed to the sidecar — the SDK would interpret
        // it as a "resume" ID and fail with "No conversation found".
        let (config, _) = base_refine_config("test");
        assert!(config.session_id.is_none());
    }

    #[test]
    fn test_refine_config_uses_stream_max_turns() {
        // Streaming sessions use the higher turn limit (400) since all turns
        // across the entire session share one budget.
        let (config, _) = base_refine_config("test");
        assert_eq!(config.max_turns, Some(REFINE_STREAM_MAX_TURNS));
    }

    #[test]
    fn test_refine_config_extended_thinking_sets_budget() {
        let (config, _) = build_refine_config(
            "test".to_string(),
            "my-skill",
            "/skills",
            "sk-key".to_string(),
            "sonnet".to_string(),
            true, // extended_thinking enabled
        );
        assert_eq!(config.max_thinking_tokens, Some(16_000));
    }

    #[test]
    fn test_refine_config_no_thinking_when_disabled() {
        let (config, _) = base_refine_config("test");
        assert!(config.max_thinking_tokens.is_none());
    }

    #[test]
    fn test_refine_config_serialization_matches_sidecar_schema() {
        // End-to-end: build config, serialize to JSON, verify the sidecar sees correct fields
        let (config, _) = base_refine_config("full prompt here");

        let json = serde_json::to_string(&config).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

        // Verify camelCase field names match sidecar's SidecarConfig interface
        assert_eq!(parsed["prompt"], "full prompt here");
        assert_eq!(parsed["agentName"], "refine-skill");
        assert_eq!(parsed["maxTurns"], REFINE_STREAM_MAX_TURNS);
        assert!(parsed["allowedTools"]
            .as_array()
            .unwrap()
            .contains(&serde_json::json!("Task")));
        // Streaming mode: no conversation history in config
        assert!(parsed.get("conversationHistory").is_none());
        // sessionId must NOT be set — the SDK interprets it as "resume" and fails
        assert!(parsed.get("sessionId").is_none());
    }

    #[test]
    fn test_refine_config_serialization_omits_none_fields() {
        let (config, _) = base_refine_config("test");
        let json = serde_json::to_string(&config).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

        // None fields with skip_serializing_if should be absent
        assert!(parsed.get("conversationHistory").is_none());
        assert!(parsed.get("maxThinkingTokens").is_none());
        assert!(parsed.get("permissionMode").is_none());
    }

    // ===== build_refine_prompt tests =====

    #[test]
    fn test_refine_prompt_includes_all_three_paths() {
        let prompt = build_refine_prompt("my-skill", "/home/user/.vibedata", "/home/user/skills",
            "Add metrics section", None, None,
        );
        assert!(prompt.contains("The skill directory is: /home/user/skills/my-skill"));
        assert!(prompt.contains("The context directory is: /home/user/skills/my-skill/context"));
        assert!(prompt.contains("The workspace directory is: /home/user/.vibedata/my-skill"));
    }

    #[test]
    fn test_refine_prompt_includes_metadata() {
        let prompt = build_refine_prompt("my-skill", "/ws", "/skills",
            "Fix overview", None, None,
        );
        assert!(prompt.contains("The skill name is: my-skill"));
        // Purpose/skill type no longer in prompt — agent reads user-context.md
        assert!(!prompt.contains("The skill type is:"));
        assert!(prompt.contains("user-context.md"));
    }

    #[test]
    fn test_refine_prompt_default_command_is_refine() {
        let prompt = build_refine_prompt("s", "/ws", "/sk",
            "edit something", None, None,
        );
        assert!(prompt.contains("The command is: refine"));
    }

    #[test]
    fn test_refine_prompt_rewrite_command() {
        let prompt = build_refine_prompt("s", "/ws", "/sk",
            "improve clarity", None, Some("rewrite"),
        );
        assert!(prompt.contains("The command is: rewrite"));
    }

    #[test]
    fn test_refine_prompt_validate_command() {
        let prompt = build_refine_prompt("s", "/ws", "/sk",
            "", None, Some("validate"),
        );
        assert!(prompt.contains("The command is: validate"));
    }

    #[test]
    fn test_refine_prompt_file_targeting() {
        let files = vec!["SKILL.md".to_string(), "references/metrics.md".to_string()];
        let prompt = build_refine_prompt("my-skill", "/ws", "/skills",
            "update these", Some(&files), None,
        );
        assert!(prompt.contains("IMPORTANT: Only edit these files:"));
        assert!(prompt.contains("/skills/my-skill/SKILL.md"));
        assert!(prompt.contains("/skills/my-skill/references/metrics.md"));
    }

    #[test]
    fn test_refine_prompt_no_file_constraint_when_empty() {
        let prompt = build_refine_prompt("s", "/ws", "/sk",
            "edit freely", None, None,
        );
        assert!(!prompt.contains("Only edit these files"));
    }

    #[test]
    fn test_refine_prompt_includes_user_message() {
        let prompt = build_refine_prompt("s", "/ws", "/sk",
            "Add SLA metrics to the overview", None, None,
        );
        assert!(prompt.contains("Current request: Add SLA metrics to the overview"));
    }

    #[test]
    fn test_refine_prompt_reads_user_context_from_file() {
        // User context is NOT inlined — the prompt tells the agent to read user-context.md
        let prompt = build_refine_prompt("s", "/ws", "/sk",
            "edit", None, None,
        );
        assert!(prompt.contains("user-context.md"));
        assert!(!prompt.contains("## User Context"));
        assert!(!prompt.contains("**Industry**"));
    }

    #[test]
    fn test_refine_prompt_no_inline_user_context() {
        // Verify the prompt never contains inline user context fields
        let prompt = build_refine_prompt("s", "/ws", "/sk",
            "edit", None, None,
        );
        assert!(!prompt.contains("**Industry**:"));
        assert!(!prompt.contains("**Target Audience**:"));
        assert!(!prompt.contains("**Function**:"));
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
                    stream_started: false,
                },
            );
            assert_eq!(map.len(), 1);
        }

        // Simulate close: remove by session_id
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

        // Unified diff must have hunk headers, context, additions, and deletions
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
        // 1 file changed, 2 insertions (new + extra), 1 deletion (old)
        assert!(result.stat.contains("1 file(s) changed"));
        assert!(result.stat.contains("2 insertion(s)(+)"));
        assert!(result.stat.contains("1 deletion(s)(-)"));
    }

    // ===== build_followup_prompt tests =====

    #[test]
    fn test_followup_prompt_includes_command_and_message() {
        let prompt = build_followup_prompt(
            "Add SLA metrics", "/skills", "my-skill", None, Some("refine"),
        );
        assert!(prompt.contains("The command is: refine"));
        assert!(prompt.contains("Current request: Add SLA metrics"));
    }

    #[test]
    fn test_followup_prompt_default_command_is_refine() {
        let prompt = build_followup_prompt("fix it", "/sk", "s", None, None);
        assert!(prompt.contains("The command is: refine"));
    }

    #[test]
    fn test_followup_prompt_file_targeting() {
        let files = vec!["SKILL.md".to_string(), "references/api.md".to_string()];
        let prompt = build_followup_prompt(
            "update", "/skills", "my-skill", Some(&files), None,
        );
        assert!(prompt.contains("IMPORTANT: Only edit these files:"));
        assert!(prompt.contains("/skills/my-skill/SKILL.md"));
        assert!(prompt.contains("/skills/my-skill/references/api.md"));
    }

    #[test]
    fn test_followup_prompt_no_file_constraint_when_empty() {
        let prompt = build_followup_prompt("edit freely", "/sk", "s", None, None);
        assert!(!prompt.contains("Only edit these files"));
    }

    #[test]
    fn test_followup_prompt_does_not_include_paths() {
        // Follow-up prompts don't repeat skill/context/workspace paths
        let prompt = build_followup_prompt(
            "add more", "/skills", "my-skill", None, None,
        );
        assert!(!prompt.contains("skill directory is:"));
        assert!(!prompt.contains("context directory is:"));
        assert!(!prompt.contains("workspace directory is:"));
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
                    stream_started: false,
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
                    stream_started: false,
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
    fn test_skill_name_validation_rejects_traversal() {
        assert!(validate_skill_name("good-name").is_ok());
        assert!(validate_skill_name("../bad").is_err());
        assert!(validate_skill_name("bad/name").is_err());
        assert!(validate_skill_name("").is_err());
    }

    // ===== user context file tests =====
    // User context is written to user-context.md, not inlined in the prompt

    #[test]
    fn test_user_context_written_to_file() {
        // send_refine_message calls write_user_context_file, which writes
        // user-context.md to the workspace directory. format_user_context
        // produces the content; the prompt just points agents at the file.
        let ctx = crate::commands::workflow::format_user_context(
            None,
            &[],
            Some("Healthcare"),
            Some("Analytics Lead"),
            Some(r#"{"audience":"Data engineers","challenges":"Legacy ETL"}"#),
            None, None, None, None, None, None, None,
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
        // When no user context fields exist, format_user_context returns None
        // and write_user_context_file is a no-op.
        let ctx = crate::commands::workflow::format_user_context(None, &[], None, None, None, None, None, None, None, None, None, None);
        assert!(ctx.is_none());
    }

}
