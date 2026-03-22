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

    // If a stale session already exists for this skill (e.g. due to an
    // unmount/remount race), silently remove it so the new session can start.
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

    if !stream_started {
        // ─── First message: start streaming session ───────────────────────
        // All commands go through the same streaming config. No agent is
        // specified — Claude decides which agent to invoke based on the
        // prompt and the agents discovered from plugins.
        let (baseline_mode_owned, snapshot_dir) = if command.as_deref() == Some("benchmark") {
            let skills_dir = std::path::Path::new(&runtime.skills_path);
            let workspace_dir = std::path::Path::new(&workspace_path).join(&skill_name);
            let baseline = crate::git::resolve_benchmark_baseline(skills_dir, &skill_name, &workspace_dir);
            (Some(baseline.mode), baseline.snapshot_dir)
        } else {
            (None, None)
        };

        let prompt = build_refine_prompt(
            &skill_name,
            &workspace_path,
            &runtime.skills_path,
            &user_message,
            target_files.as_deref(),
            command.as_deref(),
            baseline_mode_owned.as_deref(),
            snapshot_dir.as_deref(),
        );
        let (mut config, agent_id) = build_refine_config(
            prompt.clone(),
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

        log::info!(
            "[send_refine_message] skill={} model={}",
            skill_name,
            config.model.as_deref().unwrap_or("default"),
        );
        log::debug!(
            "[send_refine_message] first message prompt ({} chars) for skill '{}' command={:?}",
            prompt.len(),
            skill_name,
            command
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

#[tauri::command]
pub async fn cancel_refine_turn(
    session_id: String,
    sessions: tauri::State<'_, RefineSessionManager>,
    pool: tauri::State<'_, SidecarPool>,
) -> Result<(), String> {
    let skill_name = {
        let map = sessions.0.lock().map_err(|e| e.to_string())?;
        let session = map
            .get(&session_id)
            .ok_or_else(|| format!("Session not found: {}", session_id))?;

        if !session.stream_started {
            return Ok(());
        }

        // Do NOT reset stream_started — the session stays alive.
        // The sidecar will abort the current turn via AbortController
        // and resume on the next stream_message.
        session.skill_name.clone()
    };

    log::info!(
        "[cancel_refine_turn] Interrupting current turn for skill '{}'",
        skill_name
    );

    if let Err(err) = pool.send_stream_cancel(&skill_name, &session_id).await {
        log::warn!(
            "[cancel_refine_turn] Failed to send stream_cancel for skill '{}': {}",
            skill_name,
            err
        );
    }
    Ok(())
}

#[tauri::command]
pub async fn answer_refine_question(
    session_id: String,
    agent_id: String,
    tool_use_id: String,
    questions: serde_json::Value,
    answers: serde_json::Value,
    sessions: tauri::State<'_, RefineSessionManager>,
    pool: tauri::State<'_, SidecarPool>,
) -> Result<(), String> {
    log::info!(
        "[answer_refine_question] session=[REDACTED] agent={} tool={}",
        agent_id,
        tool_use_id
    );

    let skill_name = {
        let map = sessions.0.lock().map_err(|e| {
            log::error!(
                "[answer_refine_question] Failed to acquire session lock: {}",
                e
            );
            e.to_string()
        })?;
        let session = map.get(&session_id).ok_or_else(|| {
            let msg = "No refine session found for answer_refine_question".to_string();
            log::error!("[answer_refine_question] {}", msg);
            msg
        })?;

        if !session.stream_started {
            let msg = "Refine stream has not started yet".to_string();
            log::error!("[answer_refine_question] {}", msg);
            return Err(msg);
        }

        session.skill_name.clone()
    };

    pool.send_stream_question_answer(
        &skill_name,
        &session_id,
        &agent_id,
        &tool_use_id,
        questions,
        answers,
    )
    .await
    .map_err(|e| {
        log::error!("[answer_refine_question] Failed to send answer: {}", e);
        e
    })
}

#[cfg(test)]
mod tests;
