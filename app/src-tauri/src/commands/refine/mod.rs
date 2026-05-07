pub mod content;
pub mod diff;
pub mod output;
pub(crate) mod protocol;

use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;
use std::time::Duration;

use crate::agents::openhands_server::client::OpenHandsServerClient;
use crate::agents::openhands_server::process::ensure_agent_server;
use crate::agents::sidecar::{build_openhands_one_shot_config, OpenHandsOneShotConfigParams};
use crate::commands::imported_skills::validate_skill_name;
use crate::db::{self, Db};
use crate::skill_paths::resolve_skill_dir;
use crate::types::{ConversationMessage, RefineSessionInfo};

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

/// Resolve the directory that contains SKILL.md for the given skill.
pub(super) fn resolve_skill_output_dir(
    plugin_slug: &str,
    skill_name: &str,
    skills_path: &str,
) -> Result<std::path::PathBuf, String> {
    Ok(resolve_skill_dir(
        std::path::Path::new(skills_path),
        plugin_slug,
        skill_name,
    ))
}

fn event_class(raw: &serde_json::Value) -> Option<&str> {
    raw.get("event_class")
        .or_else(|| raw.get("eventClass"))
        .or_else(|| raw.get("kind"))
        .or_else(|| raw.get("type"))
        .and_then(|value| value.as_str())
}

fn first_string<'a>(values: impl IntoIterator<Item = Option<&'a serde_json::Value>>) -> Option<&'a str> {
    values
        .into_iter()
        .flatten()
        .find_map(|value| value.as_str())
        .filter(|text| !text.trim().is_empty())
}

fn extract_message_text(raw: &serde_json::Value) -> Option<String> {
    let llm_message = raw.get("llm_message");
    first_string([
        raw.get("message"),
        raw.get("text"),
        raw.pointer("/content/0/text"),
        raw.pointer("/content/0/content"),
        llm_message.and_then(|value| value.get("message")),
        llm_message.and_then(|value| value.get("text")),
        llm_message.and_then(|value| value.pointer("/content/0/text")),
    ])
    .map(str::to_string)
}

fn extract_conversation_messages(events: &[serde_json::Value]) -> Vec<ConversationMessage> {
    events
        .iter()
        .filter(|raw| event_class(raw) == Some("MessageEvent"))
        .filter_map(|raw| {
            let role = match raw.get("source").and_then(|value| value.as_str()) {
                Some("user") => "user",
                Some("agent") | Some("assistant") => "agent",
                _ => return None,
            };
            let content = extract_message_text(raw)?;
            Some(ConversationMessage {
                role: role.to_string(),
                content,
            })
        })
        .collect()
}

async fn load_saved_refine_conversation(
    workspace_path: &str,
    plugin_slug: &str,
    skill_name: &str,
    conversation_id: &str,
) -> Result<Option<(serde_json::Value, Vec<ConversationMessage>)>, String> {
    let workspace_skill_dir = crate::skill_paths::workspace_skill_dir(
        Path::new(workspace_path),
        plugin_slug,
        skill_name,
    );
    let server = ensure_agent_server(Duration::from_secs(60), &workspace_skill_dir).await?;
    let client = OpenHandsServerClient::new(
        server
            .base_url()
            .parse()
            .map_err(|e| format!("Invalid OpenHands Agent Server base URL: {e}"))?,
        Some(server.session_api_key),
    );
    let Some(conversation) = client
        .get_conversation(conversation_id)
        .await
        .map_err(|e| format!("Failed to load OpenHands conversation: {e}"))?
    else {
        return Ok(None);
    };
    let events = client
        .list_all_events(conversation_id)
        .await
        .map_err(|e| format!("Failed to list OpenHands conversation events: {e}"))?;
    Ok(Some((conversation, extract_conversation_messages(&events))))
}

fn refine_conversation_matches_request(
    conversation: &serde_json::Value,
    expected_system_suffix: Option<&str>,
    expected_user_suffix: Option<&str>,
) -> bool {
    let persisted_system_suffix = conversation
        .pointer("/agent/agent_context/system_message_suffix")
        .and_then(|value| value.as_str());
    let persisted_user_suffix = conversation
        .pointer("/agent/agent_context/user_message_suffix")
        .and_then(|value| value.as_str());
    persisted_system_suffix == expected_system_suffix
        && persisted_user_suffix == expected_user_suffix
}

fn select_saved_refine_conversation(
    saved_conversation_id: Option<String>,
    conversation: Option<&serde_json::Value>,
    restored_messages: Vec<ConversationMessage>,
    expected_system_suffix: Option<&str>,
    expected_user_suffix: Option<&str>,
) -> (Option<String>, Vec<ConversationMessage>) {
    match (saved_conversation_id, conversation) {
        (Some(conversation_id), Some(conversation))
            if refine_conversation_matches_request(
                conversation,
                expected_system_suffix,
                expected_user_suffix,
            ) =>
        {
            (Some(conversation_id), restored_messages)
        }
        _ => (None, Vec::new()),
    }
}

fn build_refine_openhands_config(
    skill_name: &str,
    plugin_slug: &str,
    prompt: &str,
    workspace_path: &str,
    llm: crate::types::WorkflowLlmConfig,
) -> crate::agents::sidecar::SidecarConfig {
    let workspace_skill_dir = crate::skill_paths::workspace_skill_dir(
        Path::new(workspace_path),
        plugin_slug,
        skill_name,
    )
    .to_string_lossy()
    .replace('\\', "/");

    build_openhands_one_shot_config(OpenHandsOneShotConfigParams {
        prompt: prompt.to_string(),
        llm,
        workspace_root_dir: workspace_path.replace('\\', "/"),
        workspace_run_dir: workspace_skill_dir,
        agent_name: "skill-creator".to_string(),
        task_kind: Some("refine".to_string()),
        user_message_suffix: Some(SKILL_CREATOR_USER_SUFFIX.trim().to_string()),
        allowed_tools: vec!["file_editor".to_string(), "terminal".to_string()],
        max_turns: REFINE_MAX_TURNS_PER_TURN,
        output_format: None,
        skill_name: Some(skill_name.to_string()),
        step_id: Some(-10),
        run_source: Some("refine".to_string()),
        plugin_slug: plugin_slug.to_string(),
    })
}

// ─── Session management ──────────────────────────────────────────────────────

/// In-memory state for a single refine session.
///
/// Created by `start_refine_session`, used by `send_refine_message`.
/// The OpenHands conversation is hydrated from the DB when available and
/// otherwise created on the first message, then reused for every subsequent
/// turn so the agent retains full edit history.
pub struct RefineSession {
    pub skill_name: String,
    pub plugin_slug: String,
    #[allow(dead_code)]
    pub usage_session_id: String,
    /// OpenHands conversation id for this session. Loaded from the DB on
    /// session start when a prior conversation exists; otherwise populated by
    /// the first `send_refine_message` call and reused for every subsequent
    /// turn so the agent retains full edit history.
    pub conversation_id: Option<String>,
    /// agent_id of the most recently dispatched turn. Set every time
    /// `send_refine_message` runs; `pause_refine_session` and
    /// `close_refine_session` use it to signal the active OpenHands run.
    /// The cancel registry itself ignores stale agent_ids, so the backend
    /// does not actively clear this field — the frontend tracks live turn
    /// status via the `agent-message` and `agent-exit` event stream.
    pub current_agent_id: Option<String>,
    /// HEAD SHA of the skills repo when the session started.
    /// Used by `finalize_refine_run` to detect whether the agent actually committed.
    pub head_sha_at_start: Option<String>,
}

/// Manages active refine sessions. Registered as Tauri managed state.
/// Keyed by agent_id, using a `Mutex<HashMap>`.
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
/// This selects the persistent OpenHands conversation to reuse for the refine
/// session and restores message history when possible. The actual refine turn
/// is still dispatched per-message in `send_refine_message`.
#[tauri::command]
pub async fn start_refine_session(
    skill_name: String,
    plugin_slug: String,
    workspace_path: String,
    sessions: tauri::State<'_, RefineSessionManager>,
    db: tauri::State<'_, Db>,
) -> Result<RefineSessionInfo, String> {
    log::info!(
        "[start_refine_session] skill={} plugin={}",
        skill_name,
        plugin_slug
    );
    validate_skill_name(&skill_name)?;

    let skills_path = resolve_skills_path(&db).map_err(|e| {
        log::error!(
            "[start_refine_session] failed to resolve skills path: {}",
            e
        );
        e
    })?;

    let skill_md = resolve_skill_output_dir(&plugin_slug, &skill_name, &skills_path)?.join("SKILL.md");
    if !skill_md.exists() {
        let msg = format!("SKILL.md not found at {}", skill_md.display());
        log::error!("[start_refine_session] {}", msg);
        return Err(msg);
    }

    let mut saved_conversation_id = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        crate::db::get_skill_conversation_id(&conn, &plugin_slug, &skill_name)?
    };
    let expected_system_suffix = crate::agents::sidecar::skill_creator_system_message_suffix();
    let expected_user_suffix = SKILL_CREATOR_USER_SUFFIX.trim();
    let mut restored_messages = Vec::new();
    let mut clear_saved_conversation = false;
    if let Some(conversation_id) = saved_conversation_id.clone() {
        match load_saved_refine_conversation(
            &workspace_path,
            &plugin_slug,
            &skill_name,
            &conversation_id,
        )
        .await
        {
            Ok(Some((conversation, messages))) => {
                let (active_conversation_id, active_messages) = select_saved_refine_conversation(
                    Some(conversation_id.clone()),
                    Some(&conversation),
                    messages,
                    Some(expected_system_suffix.as_str()),
                    Some(expected_user_suffix),
                );
                if active_conversation_id.is_some() {
                    restored_messages = active_messages;
                } else {
                    log::info!(
                        "[start_refine_session] saved conversation for skill={} plugin={} no longer matches the refine runtime contract; starting a fresh session",
                        skill_name,
                        plugin_slug
                    );
                    saved_conversation_id = None;
                    clear_saved_conversation = true;
                }
            }
            Ok(None) => {
                log::info!(
                    "[start_refine_session] saved conversation for skill={} plugin={} was not found; starting a fresh session",
                    skill_name,
                    plugin_slug
                );
                saved_conversation_id = None;
                clear_saved_conversation = true;
            }
            Err(error) => {
                log::warn!(
                    "[start_refine_session] failed to restore conversation history for skill={} plugin={}: {}",
                    skill_name,
                    plugin_slug,
                    error
                );
                saved_conversation_id = None;
                clear_saved_conversation = true;
            }
        }
    }
    if clear_saved_conversation {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        crate::db::clear_skill_conversation_id(&conn, &plugin_slug, &skill_name)?;
    }

    let mut map = sessions.0.lock().map_err(|e| {
        log::error!(
            "[start_refine_session] failed to acquire session lock: {}",
            e
        );
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
            plugin_slug: plugin_slug.clone(),
            usage_session_id: new_refine_usage_session_id(&skill_name),
            conversation_id: saved_conversation_id,
            current_agent_id: None,
            head_sha_at_start,
        },
    );

    Ok(RefineSessionInfo {
        session_id,
        skill_name,
        created_at,
        available_agents: vec!["skill-creator".to_string()],
        restored_messages,
    })
}

// ─── send_refine_message ─────────────────────────────────────────────────────

/// Send a user message to the refine agent and stream responses back.
///
/// The session already carries the selected persistent conversation from
/// `start_refine_session`. This command only dispatches the next message
/// turn using that session state.
///
/// Returns the `agent_id` so the frontend can listen for `agent-message` and
/// `agent-exit` events scoped to this turn.
#[tauri::command]
pub async fn send_refine_message(
    session_id: String,
    user_message: String,
    target_files: Option<Vec<String>>,
    sessions: tauri::State<'_, RefineSessionManager>,
    db: tauri::State<'_, Db>,
    app: tauri::AppHandle,
) -> Result<String, String> {
    let (skill_name, plugin_slug, conversation_id) = {
        let map = sessions.0.lock().map_err(|e| {
            log::error!(
                "[send_refine_message] failed to acquire session lock: {}",
                e
            );
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
        (
            session.skill_name.clone(),
            session.plugin_slug.clone(),
            session.conversation_id.clone(),
        )
    };

    log::info!(
        "[send_refine_message] skill={} plugin={} conversation_present={}",
        skill_name,
        plugin_slug,
        conversation_id.is_some()
    );

    let runtime_ctx = crate::commands::workflow::read_initialized_runtime_context(&db)?;
    let skills_path = resolve_skills_path(&db)?;
    let skill_output_dir = resolve_skill_dir(Path::new(&skills_path), &plugin_slug, &skill_name);

    // Deploy bundled OpenHands agents and AgentSkills into the workspace so the
    // Agent Server can resolve the skill-creator agent and its skills. Workflow
    // runs do this on every dispatch; refine must too — the call is cached
    // per-session so repeated turns are cheap.
    crate::commands::workflow::ensure_workspace_prompts(&app, &runtime_ctx.workspace_path).await?;

    ensure_skill_workspace_dir(
        &runtime_ctx.workspace_path,
        &plugin_slug,
        &skill_name,
    );

    let target_files_slice = target_files.as_deref();
    let prompt = if conversation_id.is_some() {
        build_followup_prompt_with_output_dir(&user_message, &skill_output_dir, target_files_slice)
    } else {
        build_refine_prompt_with_output_dir(
            &skill_name,
            &runtime_ctx.workspace_path,
            &plugin_slug,
            &skill_output_dir,
            &user_message,
            target_files_slice,
        )
    };

    let config = build_refine_openhands_config(
        &skill_name,
        &plugin_slug,
        &prompt,
        &runtime_ctx.workspace_path,
        runtime_ctx.llm.clone(),
    );
    let agent_id = format!(
        "refine-{}-{}",
        skill_name,
        chrono::Utc::now().timestamp_millis()
    );

    let returned_conversation_id = if let Some(existing_conversation_id) = conversation_id {
        crate::agents::openhands_server::openhands_send_message(
            &app,
            &agent_id,
            config,
            existing_conversation_id,
        )
        .await?
    } else {
        crate::agents::openhands_server::start_openhands_session(&app, &agent_id, config, None)
            .await?
    };

    {
        let mut map = sessions.0.lock().map_err(|e| e.to_string())?;
        if let Some(session) = map.get_mut(&session_id) {
            session.conversation_id = Some(returned_conversation_id);
            session.current_agent_id = Some(agent_id.clone());
        }
    }

    Ok(agent_id)
}

// ─── close_refine_session ────────────────────────────────────────────────────

/// Close a refine session: cancel any in-flight turn, then remove the
/// in-memory session wrapper. The persisted OpenHands conversation remains
/// available for resume.
#[tauri::command]
pub async fn close_refine_session(
    session_id: String,
    sessions: tauri::State<'_, RefineSessionManager>,
) -> Result<(), String> {
    log::info!("[close_refine_session] session=[REDACTED]");

    let removed = {
        let mut map = sessions.0.lock().map_err(|e| {
            log::error!(
                "[close_refine_session] failed to acquire session lock: {}",
                e
            );
            e.to_string()
        })?;
        map.remove(&session_id)
    };

    let Some(session) = removed else {
        log::debug!("[close_refine_session] session [REDACTED] not found (already closed)");
        return Ok(());
    };

    if let Some(agent_id) = session.current_agent_id.as_ref() {
        let cancelled = crate::agents::openhands_server::pause_openhands_session(agent_id);
        log::debug!(
            "[close_refine_session] pause_openhands_session agent={} result={}",
            agent_id,
            cancelled
        );
    }

    Ok(())
}

// ─── pause_refine_session ───────────────────────────────────────────────────

/// Pause the in-flight refine turn (if any). The session and conversation
/// stay alive — the next `send_refine_message` resumes on the same conversation.
#[tauri::command]
pub async fn pause_refine_session(
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
        log::debug!("[pause_refine_session] no active turn — noop");
        return Ok(());
    };

    log::info!("[pause_refine_session] pausing agent_id={}", agent_id);
    let cancelled = crate::agents::openhands_server::pause_openhands_session(&agent_id);
    if !cancelled {
        log::warn!(
            "[pause_refine_session] no cancel handle registered for agent_id={}",
            agent_id
        );
    }
    Ok(())
}

/// Cancel a one-shot agent run by agent_id via the OpenHands native runner.
#[tauri::command]
pub async fn cancel_agent_run(skill_name: String, agent_id: String) -> Result<(), String> {
    log::info!(
        "[cancel_agent_run] skill='{}' agent='{}'",
        skill_name,
        agent_id
    );
    if !crate::agents::openhands_server::pause_openhands_session(&agent_id) {
        log::warn!(
            "[cancel_agent_run] No active OpenHands run found for agent='{}'",
            agent_id
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests;
