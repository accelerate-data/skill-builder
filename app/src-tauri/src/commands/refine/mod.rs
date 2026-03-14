pub mod content;
pub mod diff;
pub mod output;
pub(crate) mod protocol;

use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;

use crate::agents::sidecar;
use crate::agents::sidecar_pool::SidecarPool;
use crate::commands::imported_skills::validate_skill_name;
use crate::db::{self, Db};
use crate::types::RefineSessionInfo;

use protocol::*;

// ─── Shared helper ───────────────────────────────────────────────────────────

fn resolve_skills_path(db: &Db, workspace_path: &str) -> Result<String, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let settings = db::read_settings(&conn)?;
    Ok(settings
        .skills_path
        .unwrap_or_else(|| workspace_path.to_string()))
}

// ─── Session management ──────────────────────────────────────────────────────

/// In-memory state for a single refine session.
///
/// Created by `start_refine_session`, used by `send_refine_message`.
/// The streaming session is started on the first message and maintained
/// across subsequent messages — the SDK preserves full conversation state.
pub struct RefineSession {
    pub skill_name: String,
    pub usage_session_id: String,
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

// ─── start_refine_session ────────────────────────────────────────────────────

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
        log::error!(
            "[start_refine_session] Failed to resolve skills path: {}",
            e
        );
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
        log::error!(
            "[start_refine_session] Failed to acquire session lock: {}",
            e
        );
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
        "[start_refine_session] creating session [REDACTED] for skill '{}'",
        skill_name
    );

    map.insert(
        session_id.clone(),
        RefineSession {
            skill_name: skill_name.clone(),
            usage_session_id: new_refine_usage_session_id(&skill_name),
            stream_started: false,
        },
    );

    Ok(RefineSessionInfo {
        session_id,
        skill_name,
        created_at,
    })
}

// ─── send_refine_message ─────────────────────────────────────────────────────

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
    let dispatch = dispatch_for_refine_command(command.as_deref(), target_files.as_deref());

    // 1. Look up session and check stream state
    let (skill_name, usage_session_id, stream_started) = {
        let map = sessions.0.lock().map_err(|e| {
            log::error!(
                "[send_refine_message] Failed to acquire session lock: {}",
                e
            );
            e.to_string()
        })?;
        let session = match map.get(&session_id) {
            Some(s) => s,
            None => {
                let active: Vec<String> = map.values().map(|s| s.skill_name.clone()).collect();
                let msg = format!(
                    "No refine session found. Active sessions ({}): [{}]",
                    map.len(),
                    active.join(", ")
                );
                log::error!("[send_refine_message] {}", msg);
                return Err(msg);
            }
        };
        (
            session.skill_name.clone(),
            session.usage_session_id.clone(),
            session.stream_started,
        )
    };
    log::info!(
        "[send_refine_message] skill={} stream_started={}",
        skill_name,
        stream_started
    );

    let runtime = load_refine_runtime_settings(&db, &workspace_path, &skill_name)?;
    ensure_skill_workspace_dir(&workspace_path, &skill_name);

    if matches!(
        dispatch,
        RefineDispatch::DirectValidate | RefineDispatch::DirectRewrite
    ) {
        let direct_agent_name = match dispatch {
            RefineDispatch::DirectValidate => VALIDATE_AGENT_NAME,
            RefineDispatch::DirectRewrite => GENERATE_AGENT_NAME,
            RefineDispatch::Stream => unreachable!(),
        };
        let prompt = build_direct_agent_prompt(
            direct_agent_name,
            &skill_name,
            &workspace_path,
            &runtime.skills_path,
            &user_message,
        );
        log::debug!(
            "[send_refine_message] direct prompt ({} chars) for skill '{}' command={:?}",
            prompt.len(),
            skill_name,
            command
        );
        let (mut config, agent_id) = build_direct_refine_config(
            prompt,
            &skill_name,
            &usage_session_id,
            &workspace_path,
            runtime.api_key,
            runtime.model,
            runtime.extended_thinking,
            runtime.interleaved_thinking_beta,
            runtime.sdk_effort,
            runtime.fallback_model,
            direct_agent_name,
        );

        if config.path_to_claude_code_executable.is_none() {
            if let Ok(cli_path) = sidecar::resolve_sdk_cli_path_public(&app) {
                config.path_to_claude_code_executable = Some(cli_path);
            }
        }

        pool.send_request(&skill_name, &agent_id, config, &app, None)
            .await
            .map_err(|e| {
                log::error!("[send_refine_message] Failed to send direct request: {}", e);
                e
            })?;

        return Ok(agent_id);
    }

    if !stream_started {
        // ─── First message: start streaming session ───────────────────────
        let prompt = build_refine_prompt(
            &skill_name,
            &workspace_path,
            &runtime.skills_path,
            &user_message,
            target_files.as_deref(),
            command.as_deref(),
        );
        log::debug!(
            "[send_refine_message] first message prompt ({} chars) for skill '{}' command={:?}",
            prompt.len(),
            skill_name,
            command
        );

        log::info!(
            "[send_refine_message] skill={} model={}",
            skill_name,
            runtime.model
        );
        let (mut config, agent_id) = build_refine_config(
            prompt,
            &skill_name,
            &usage_session_id,
            &workspace_path,
            runtime.api_key,
            runtime.model,
            runtime.extended_thinking,
            runtime.interleaved_thinking_beta,
            runtime.sdk_effort,
            runtime.fallback_model,
            runtime.refine_prompt_suggestions,
        );

        // Resolve SDK cli.js path
        if config.path_to_claude_code_executable.is_none() {
            if let Ok(cli_path) = sidecar::resolve_sdk_cli_path_public(&app) {
                config.path_to_claude_code_executable = Some(cli_path);
            }
        }

        log::debug!(
            "[send_refine_message] starting stream agent={} cwd={}",
            agent_id,
            config.cwd,
        );

        pool.send_stream_start(&skill_name, &session_id, &agent_id, config, &app)
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
        let prompt = build_followup_prompt(
            &user_message,
            &runtime.skills_path,
            &skill_name,
            target_files.as_deref(),
            command.as_deref(),
        );
        log::debug!(
            "[send_refine_message] follow-up prompt ({} chars) for skill '{}' command={:?}:\n{}",
            prompt.len(),
            skill_name,
            command,
            prompt
        );

        let agent_id = format!(
            "refine-{}-{}",
            skill_name,
            chrono::Utc::now().timestamp_millis()
        );

        pool.send_stream_message(&skill_name, &session_id, &agent_id, &prompt, &app)
            .await
            .map_err(|e| {
                log::error!("[send_refine_message] Failed to send stream message: {}", e);
                e
            })?;

        Ok(agent_id)
    }
}

// ─── close_refine_session ────────────────────────────────────────────────────

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
            log::error!(
                "[close_refine_session] Failed to acquire session lock: {}",
                e
            );
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
            if let Err(e) = pool.send_stream_end(&session.skill_name, &session_id).await {
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

#[cfg(test)]
mod tests;
