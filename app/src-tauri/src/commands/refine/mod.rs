pub mod content;
pub mod diff;
pub mod output;
#[allow(dead_code)]
pub(crate) mod protocol;

use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;

use crate::agents::sidecar::{build_openhands_one_shot_config, OpenHandsOneShotConfigParams};
use crate::commands::imported_skills::validate_skill_name;
use crate::db::{self, Db};
use crate::skill_paths::{resolve_skill_dir, DEFAULT_PLUGIN_SLUG};
use crate::types::RefineSessionInfo;

use protocol::*;

const SKILL_CREATOR_USER_SUFFIX: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../agent-sources/prompts/skill-creator-user-suffix.txt"
));

/// Maximum agentic turns per refine turn. Matches workflow step 3
/// (skill_generation) since refine has the same shape: edit skill files,
/// run optional tools, summarize.
const REFINE_MAX_TURNS_PER_TURN: u32 = 500;

// ─── Shared helper ───────────────────────────────────────────────────────────

pub(crate) fn resolve_skills_path(db: &Db) -> Result<String, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let settings = db::read_settings(&conn)?;
    settings
        .skills_path
        .ok_or_else(|| "Skills path not configured in settings".to_string())
}

pub(super) fn resolve_skill_plugin_slug(db: &Db, skill_name: &str) -> Result<String, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    Ok(crate::db::get_skill_master_any_plugin(&conn, skill_name)?
        .map(|skill| skill.plugin_slug)
        .unwrap_or_else(|| DEFAULT_PLUGIN_SLUG.to_string()))
}

/// Resolve the directory that contains SKILL.md for the given skill.
/// Uses the correct plugin slug (cross-plugin lookup) so imported skills
/// resolve to `skills_path/{plugin_slug}/{skill_name}/`.
pub(super) fn resolve_skill_output_dir(
    db: &Db,
    skill_name: &str,
    skills_path: &str,
) -> Result<std::path::PathBuf, String> {
    let plugin_slug = resolve_skill_plugin_slug(db, skill_name)?;
    Ok(resolve_skill_dir(
        std::path::Path::new(skills_path),
        &plugin_slug,
        skill_name,
    ))
}

// ─── Session management ──────────────────────────────────────────────────────

/// In-memory state for a single refine session.
///
/// Created by `start_refine_session`, used by `send_refine_message`.
/// The OpenHands conversation is created on the first message and reused
/// for every subsequent turn so the agent retains full edit history.
pub struct RefineSession {
    pub skill_name: String,
    #[allow(dead_code)]
    pub usage_session_id: String,
    /// OpenHands conversation id for this session. `None` until the first
    /// `send_refine_message` creates the conversation; reused for every
    /// subsequent turn so the agent retains full edit history.
    pub conversation_id: Option<String>,
    /// agent_id of the most recently dispatched turn. Set every time
    /// `send_refine_message` runs; `cancel_refine_turn` and
    /// `close_refine_session` use it to signal `cancel_openhands_one_shot`.
    /// The cancel registry itself ignores stale agent_ids, so the backend
    /// does not actively clear this field — the frontend tracks live turn
    /// status via the `agent-message` and `agent-exit` event stream.
    pub current_agent_id: Option<String>,
    /// HEAD SHA of the skills repo when the session started.
    /// Used by `finalize_refine_run` to detect whether the agent actually committed.
    pub head_sha_at_start: Option<String>,
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

// ─── start_refine_session ────────────────────────────────────────────────────

/// Initialize a refine session for a skill.
///
/// No agent is spawned here — the agent is dispatched per-message in
/// `send_refine_message`.
#[tauri::command]
pub async fn start_refine_session(
    skill_name: String,
    plugin_slug: String,
    workspace_path: String,
    sessions: tauri::State<'_, RefineSessionManager>,
    db: tauri::State<'_, Db>,
) -> Result<RefineSessionInfo, String> {
    let _ = workspace_path;
    log::info!(
        "[start_refine_session] skill={} plugin={}",
        skill_name,
        plugin_slug
    );
    validate_skill_name(&skill_name)?;

    let skills_path = resolve_skills_path(&db).map_err(|e| {
        log::error!("[start_refine_session] failed to resolve skills path: {}", e);
        e
    })?;

    let skill_md = resolve_skill_output_dir(&db, &skill_name, &skills_path)?.join("SKILL.md");
    if !skill_md.exists() {
        let msg = format!("SKILL.md not found at {}", skill_md.display());
        log::error!("[start_refine_session] {}", msg);
        return Err(msg);
    }

    let mut map = sessions.0.lock().map_err(|e| {
        log::error!("[start_refine_session] failed to acquire session lock: {}", e);
        e.to_string()
    })?;

    if let Some(stale_id) = map
        .iter()
        .find(|(_, s)| s.skill_name == skill_name)
        .map(|(id, _)| id.clone())
    {
        log::info!(
            "[start_refine_session] removing stale session for skill '{}' before restart",
            skill_name
        );
        map.remove(&stale_id);
    }

    let session_id = uuid::Uuid::new_v4().to_string();
    let created_at = chrono::Utc::now().to_rfc3339();
    log::debug!(
        "[start_refine_session] creating session [REDACTED] for skill '{}'",
        skill_name
    );

    let head_sha_at_start = git2::Repository::open(Path::new(&skills_path))
        .ok()
        .and_then(|repo| {
            let head = repo.head().ok()?;
            let commit = head.peel_to_commit().ok()?;
            Some(commit.id().to_string())
        });

    map.insert(
        session_id.clone(),
        RefineSession {
            skill_name: skill_name.clone(),
            usage_session_id: new_refine_usage_session_id(&skill_name),
            conversation_id: None,
            current_agent_id: None,
            head_sha_at_start,
        },
    );

    Ok(RefineSessionInfo {
        session_id,
        skill_name,
        created_at,
        available_agents: vec!["skill-creator".to_string()],
    })
}

// ─── send_refine_message ─────────────────────────────────────────────────────

/// Send a user message to the refine agent and stream responses back.
///
/// Turn 1 (session has no conversation_id): writes user-context.md, creates a
/// new OpenHands conversation seeded with the full refine prompt, runs it,
/// and stores the conversation_id on the session.
///
/// Turn N (session has a conversation_id): appends the user message as a
/// follow-up event and re-runs the existing conversation.
///
/// Returns the `agent_id` so the frontend can listen for `agent-message` and
/// `agent-exit` events scoped to this turn.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn send_refine_message(
    session_id: String,
    user_message: String,
    plugin_slug: String,
    workspace_path: String,
    target_files: Option<Vec<String>>,
    sessions: tauri::State<'_, RefineSessionManager>,
    db: tauri::State<'_, Db>,
    app: tauri::AppHandle,
) -> Result<String, String> {
    // workspace_path and plugin_slug come from the frontend invocation but
    // we resolve both server-side: workspace_path from
    // read_initialized_runtime_context, plugin_slug from
    // resolve_skill_plugin_slug. Kept on the IPC signature for
    // backward compatibility with the existing tauri.ts wrapper.
    let _ = (workspace_path, plugin_slug);

    let (skill_name, conversation_id) = {
        let map = sessions.0.lock().map_err(|e| {
            log::error!("[send_refine_message] failed to acquire session lock: {}", e);
            e.to_string()
        })?;
        let session = map.get(&session_id).ok_or_else(|| {
            let active: Vec<String> = map.values().map(|s| s.skill_name.clone()).collect();
            let msg = format!(
                "No refine session found. Active sessions ({}): [{}]",
                map.len(),
                active.join(", ")
            );
            log::error!("[send_refine_message] {}", msg);
            msg
        })?;
        (session.skill_name.clone(), session.conversation_id.clone())
    };

    log::info!(
        "[send_refine_message] skill={} conversation_present={}",
        skill_name,
        conversation_id.is_some()
    );

    let runtime_ctx = crate::commands::workflow::read_initialized_runtime_context(&db)?;
    let resolved_plugin_slug = resolve_skill_plugin_slug(&db, &skill_name)?;
    let skills_path = resolve_skills_path(&db)?;
    let skill_output_dir =
        resolve_skill_dir(Path::new(&skills_path), &resolved_plugin_slug, &skill_name);

    // Deploy bundled OpenHands agents and AgentSkills into the workspace so the
    // Agent Server can resolve the skill-creator agent and its skills. Workflow
    // runs do this on every dispatch; refine must too — the call is cached
    // per-session so repeated turns are cheap.
    crate::commands::workflow::ensure_workspace_prompts(&app, &runtime_ctx.workspace_path).await?;

    ensure_skill_workspace_dir(&runtime_ctx.workspace_path, &resolved_plugin_slug, &skill_name);

    if conversation_id.is_none() {
        write_refine_user_context(
            &db,
            &runtime_ctx.workspace_path,
            &resolved_plugin_slug,
            &skill_name,
            &skill_output_dir,
        )?;
    }

    let target_files_slice = target_files.as_deref();
    let prompt = if conversation_id.is_some() {
        build_followup_prompt_with_output_dir(&user_message, &skill_output_dir, target_files_slice)
    } else {
        build_refine_prompt_with_output_dir(
            &skill_name,
            &runtime_ctx.workspace_path,
            &resolved_plugin_slug,
            &skill_output_dir,
            &user_message,
            target_files_slice,
        )
    };

    let workspace_skill_dir_str = crate::skill_paths::workspace_skill_dir(
        Path::new(&runtime_ctx.workspace_path),
        &resolved_plugin_slug,
        &skill_name,
    )
    .to_string_lossy()
    .replace('\\', "/");

    let mut config = build_openhands_one_shot_config(OpenHandsOneShotConfigParams {
        prompt,
        llm: runtime_ctx.llm.clone(),
        workspace_root_dir: runtime_ctx.workspace_path.replace('\\', "/"),
        workspace_run_dir: workspace_skill_dir_str.clone(),
        agent_name: "skill-creator".to_string(),
        task_kind: Some("refine".to_string()),
        user_message_suffix: Some(SKILL_CREATOR_USER_SUFFIX.trim().to_string()),
        allowed_tools: vec!["file_editor".to_string(), "terminal".to_string()],
        max_turns: REFINE_MAX_TURNS_PER_TURN,
        output_format: None,
        skill_name: Some(skill_name.clone()),
        step_id: Some(-10),
        run_source: Some("refine".to_string()),
        plugin_slug: resolved_plugin_slug.clone(),
    });
    let log_dir = format!("{workspace_skill_dir_str}/logs");
    config.transcript_log_dir = Some(log_dir.clone());

    let agent_id = format!(
        "refine-{}-{}",
        skill_name,
        chrono::Utc::now().timestamp_millis()
    );

    let returned_conversation_id = crate::agents::openhands_server::dispatch_openhands_refine_turn(
        &app,
        &agent_id,
        config,
        conversation_id,
        Some(&log_dir),
    )
    .await?;

    {
        let mut map = sessions.0.lock().map_err(|e| e.to_string())?;
        if let Some(session) = map.get_mut(&session_id) {
            session.conversation_id = Some(returned_conversation_id);
            session.current_agent_id = Some(agent_id.clone());
        }
    }

    Ok(agent_id)
}

/// Reproduce the user-context bundle that `load_refine_runtime_settings`
/// previously assembled. Reads workflow run row, SKILL.md frontmatter, and
/// settings, then writes `{workspace}/{plugin}/{skill}/user-context.md`.
fn write_refine_user_context(
    db: &Db,
    workspace_path: &str,
    plugin_slug: &str,
    skill_name: &str,
    skill_output_dir: &Path,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let settings = db::read_settings(&conn)?;
    let settings_author = settings
        .github_user_email
        .clone()
        .or(settings.github_user_login.clone());
    let run_row = db::get_workflow_run(&conn, skill_name).ok().flatten();
    let intake_json = run_row.as_ref().and_then(|r| r.intake_json.clone());
    let frontmatter = std::fs::read_to_string(skill_output_dir.join("SKILL.md"))
        .ok()
        .map(|content| crate::commands::imported_skills::parse_frontmatter_full(&content))
        .unwrap_or_default();
    let is_imported = run_row.is_none();
    let purpose = if is_imported {
        frontmatter.description.clone()
    } else {
        run_row.as_ref().map(|r| r.purpose.clone())
    };
    let author_for_context = if is_imported {
        frontmatter.author.clone()
    } else {
        frontmatter
            .author
            .or_else(|| run_row.as_ref().and_then(|r| r.author_login.clone()))
            .or(settings_author)
    };

    drop(conn);

    crate::commands::workflow::write_user_context_file(
        workspace_path,
        plugin_slug,
        skill_name,
        &[],
        author_for_context.as_deref(),
        settings.industry.as_deref(),
        settings.function_role.as_deref(),
        intake_json.as_deref(),
        None,
        purpose.as_deref(),
        frontmatter.version.as_deref(),
        None,
        None,
        None,
        None,
        &[],
    );
    Ok(())
}

// ─── close_refine_session ────────────────────────────────────────────────────

/// Close a refine session: cancel any in-flight turn, then DELETE the
/// OpenHands conversation, then remove the session from the manager.
#[tauri::command]
pub async fn close_refine_session(
    session_id: String,
    sessions: tauri::State<'_, RefineSessionManager>,
) -> Result<(), String> {
    log::info!("[close_refine_session] session=[REDACTED]");

    let removed = {
        let mut map = sessions.0.lock().map_err(|e| {
            log::error!("[close_refine_session] failed to acquire session lock: {}", e);
            e.to_string()
        })?;
        map.remove(&session_id)
    };

    let Some(session) = removed else {
        log::debug!("[close_refine_session] session [REDACTED] not found (already closed)");
        return Ok(());
    };

    if let Some(agent_id) = session.current_agent_id.as_ref() {
        let cancelled = crate::agents::openhands_server::cancel_openhands_one_shot(agent_id);
        log::debug!(
            "[close_refine_session] cancel_openhands_one_shot agent={} result={}",
            agent_id,
            cancelled
        );
    }

    if let Some(conversation_id) = session.conversation_id.as_ref() {
        log::info!(
            "[close_refine_session] deleting conversation_id={}",
            conversation_id
        );
        if let Err(e) =
            crate::agents::openhands_server::close_openhands_refine_session(conversation_id).await
        {
            log::warn!(
                "[close_refine_session] non-fatal: delete conversation failed: {}",
                e
            );
        }
    }

    Ok(())
}

// ─── cancel_refine_turn ──────────────────────────────────────────────────────

/// Cancel the in-flight refine turn (if any). The session and conversation
/// stay alive — the next `send_refine_message` resumes on the same conversation.
#[tauri::command]
pub async fn cancel_refine_turn(
    session_id: String,
    sessions: tauri::State<'_, RefineSessionManager>,
) -> Result<(), String> {
    let agent_id = {
        let map = sessions.0.lock().map_err(|e| e.to_string())?;
        let session = map
            .get(&session_id)
            .ok_or_else(|| format!("Session not found: {}", session_id))?;
        session.current_agent_id.clone()
    };

    let Some(agent_id) = agent_id else {
        log::debug!("[cancel_refine_turn] no active turn — noop");
        return Ok(());
    };

    log::info!("[cancel_refine_turn] cancelling agent_id={}", agent_id);
    let cancelled = crate::agents::openhands_server::cancel_openhands_one_shot(&agent_id);
    if !cancelled {
        log::warn!(
            "[cancel_refine_turn] no cancel handle registered for agent_id={}",
            agent_id
        );
    }
    Ok(())
}

/// Cancel a one-shot agent run by agent_id via the OpenHands native runner.
#[tauri::command]
pub async fn cancel_agent_run(
    skill_name: String,
    agent_id: String,
) -> Result<(), String> {
    log::info!("[cancel_agent_run] skill='{}' agent='{}'", skill_name, agent_id);
    if !crate::agents::openhands_server::cancel_openhands_one_shot(&agent_id) {
        log::warn!(
            "[cancel_agent_run] No active OpenHands run found for agent='{}'",
            agent_id
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests;
