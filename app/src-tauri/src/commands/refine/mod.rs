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
use crate::skill_paths::{resolve_skill_dir, DEFAULT_PLUGIN_SLUG};
use crate::types::RefineSessionInfo;

use protocol::*;

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

/// Plugins allowed for refine sessions. Must match `required_plugins` in
/// `build_refine_config` so the picker shows exactly the agents the SDK loads.
const REFINE_ALLOWED_PLUGINS: &[&str] = &["skill-content-researcher", "skill-creator"];

/// Scan `{workspace}/.claude/plugins/{plugin}/agents/` for agent `.md` files.
/// Returns agent names as `{plugin}:{agent}` qualified identifiers.
fn discover_plugin_agents(workspace_path: &str) -> Vec<String> {
    let plugins_dir = Path::new(workspace_path).join(".claude").join("plugins");
    let mut agents = Vec::new();
    for plugin in REFINE_ALLOWED_PLUGINS {
        let agents_dir = plugins_dir.join(plugin).join("agents");
        if let Ok(entries) = std::fs::read_dir(&agents_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().and_then(|e| e.to_str()) == Some("md") {
                    if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                        agents.push(format!("{}:{}", plugin, stem));
                    }
                }
            }
        }
    }
    agents.sort();
    agents
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
/// No sidecar is spawned here — the sidecar is spawned per-message in `send_refine_message`.
#[tauri::command]
pub async fn start_refine_session(
    skill_name: String,
    plugin_slug: String,
    workspace_path: String,
    sessions: tauri::State<'_, RefineSessionManager>,
    db: tauri::State<'_, Db>,
) -> Result<RefineSessionInfo, String> {
    log::info!("[start_refine_session] skill={} plugin={}", skill_name, plugin_slug);
    validate_skill_name(&skill_name)?;

    let skills_path = resolve_skills_path(&db).map_err(|e| {
        log::error!(
            "[start_refine_session] Failed to resolve skills path: {}",
            e
        );
        e
    })?;

    // Verify SKILL.md exists
    let skill_md = resolve_skill_output_dir(&db, &skill_name, &skills_path)?.join("SKILL.md");
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

    // Capture HEAD SHA so finalize_refine_run can detect whether the agent committed.
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
            stream_started: false,
            head_sha_at_start,
        },
    );

    // Discover agents from allowed refine plugins deployed in workspace.
    let available_agents = discover_plugin_agents(&workspace_path);

    Ok(RefineSessionInfo {
        session_id,
        skill_name,
        created_at,
        available_agents,
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
    plugin_slug: String,
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

    let runtime = load_refine_runtime_settings(&db, &workspace_path, &skill_name, &plugin_slug)?;
    ensure_skill_workspace_dir(&workspace_path, &runtime.plugin_slug, &skill_name);
    let skill_output_dir = resolve_skill_output_dir(&db, &skill_name, &runtime.skills_path)?;

    if !stream_started {
        // ─── First message: start streaming session ───────────────────────
        // All commands go through the same streaming config. No agent is
        // specified — Claude decides which agent to invoke based on the
        // user's message and the agents discovered from plugins.
        let prompt = build_refine_prompt_with_output_dir(
            &skill_name,
            &workspace_path,
            &runtime.plugin_slug,
            &skill_output_dir,
            &user_message,
            target_files.as_deref(),
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
            &runtime.plugin_slug,
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
            "[send_refine_message] starting stream agent={} workspace_skill_dir={}",
            agent_id,
            config.workspace_skill_dir,
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
        let prompt = build_followup_prompt_with_output_dir(
            &user_message,
            &skill_output_dir,
            &skill_name,
            target_files.as_deref(),
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

/// Cancel a one-shot workflow step agent by agent_id (= request_id in the sidecar).
/// Uses the `cancel` message type which matches `currentRequestId` and calls
/// `currentAbort.abort()` on the running AbortController.
#[tauri::command]
pub async fn cancel_agent_run(
    skill_name: String,
    agent_id: String,
    pool: tauri::State<'_, SidecarPool>,
) -> Result<(), String> {
    log::info!("[cancel_agent_run] skill='{}'", skill_name);
    if let Err(err) = pool.send_cancel(&skill_name, &agent_id).await {
        log::warn!(
            "[cancel_agent_run] Failed to send cancel for skill '{}': {}",
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
