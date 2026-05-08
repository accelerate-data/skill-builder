pub mod client;
pub mod events;
pub mod process;
pub mod types;

use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::time::{Duration, Instant};

use dashmap::DashMap;
use futures::{SinkExt, StreamExt};
use tauri::{Listener, Manager};
use thiserror::Error;
use tokio_tungstenite::tungstenite::Message;

pub use types::{OpenHandsRuntimeRequest, StartConversationRequest};

use self::client::OpenHandsServerClient;
use self::events::normalize_server_event;
use self::process::{
    ensure_agent_server as ensure_agent_server_process, extract_terminal_error_from_stderr,
    stderr_tail_snapshot,
};
use crate::agents::sidecar::SidecarConfig;
use crate::db::Db;
use std::collections::{HashMap, HashSet};
use std::fs;

pub struct OpenHandsThrowawayRunParams {
    pub agent_id: String,
    pub config: SidecarConfig,
    pub timeout: Duration,
}

pub struct OpenHandsThrowawayRun {
    pub conversation_state: serde_json::Value,
}

#[derive(Debug, Clone, PartialEq, Eq, Error)]
enum OpenHandsRuntimeError {
    #[error("OpenHands send-message requires an existing conversation id")]
    MissingExistingConversation,
    #[error("OpenHands conversation {id} was not found and cannot be resumed")]
    ConversationNotFound { id: String },
    #[error("OpenHands conversation {id} does not match the current request")]
    ConversationMismatch { id: String },
    #[error("{operation}: {detail}")]
    Operation {
        operation: &'static str,
        detail: String,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum OpenHandsSessionCreateReason {
    New,
    NotFound,
    Mismatch,
}

impl OpenHandsSessionCreateReason {
    fn as_str(self) -> &'static str {
        match self {
            Self::New => "new",
            Self::NotFound => "not_found",
            Self::Mismatch => "mismatch",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SavedConversationStatus {
    Compatible,
    Incompatible,
    Missing,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum OpenHandsConversationResolution {
    Reuse {
        conversation_id: String,
    },
    Create {
        reason: OpenHandsSessionCreateReason,
    },
    Error(OpenHandsRuntimeError),
}

fn load_saved_skill_conversation_id(
    app: &tauri::AppHandle,
    request: &OpenHandsRuntimeRequest,
) -> Result<Option<String>, String> {
    let Some(skill_name) = request.skill_name.as_deref() else {
        return Ok(None);
    };
    let db = app.state::<Db>();
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    crate::db::get_skill_conversation_id(&conn, &request.plugin_slug, skill_name)
}

fn save_skill_conversation_id(
    app: &tauri::AppHandle,
    request: &OpenHandsRuntimeRequest,
    conversation_id: &str,
) -> Result<(), String> {
    let Some(skill_name) = request.skill_name.as_deref() else {
        return Ok(());
    };
    let db = app.state::<Db>();
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    crate::db::save_skill_conversation_id(&conn, &request.plugin_slug, skill_name, conversation_id)
}

async fn send_user_message(
    client: &OpenHandsServerClient,
    conversation_id: &str,
    prompt: &str,
) -> Result<(), String> {
    let event = serde_json::to_value(types::SendMessageRequest {
        role: "user".to_string(),
        content: vec![types::TextContent {
            content_type: "text".to_string(),
            text: prompt.to_string(),
        }],
        run: false,
    })
    .map_err(|e| format!("Failed to serialize OpenHands conversation event: {e}"))?;
    client
        .send_event(conversation_id, event)
        .await
        .map_err(|e| format!("Failed to send event to OpenHands conversation: {e}"))
}

pub(crate) fn conversation_matches_request(
    conversation: &serde_json::Value,
    request: &OpenHandsRuntimeRequest,
) -> bool {
    let persisted_system_suffix = conversation
        .pointer("/agent/agent_context/system_message_suffix")
        .and_then(|value| value.as_str());
    let persisted_user_suffix = conversation
        .pointer("/agent/agent_context/user_message_suffix")
        .and_then(|value| value.as_str());
    persisted_system_suffix == request.system_message_suffix.as_deref()
        && persisted_user_suffix == request.user_message_suffix.as_deref()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum OpenHandsConversationSelection {
    ResumeOrCreate,
    SendExistingOnly,
    CreateFresh,
}

enum OpenHandsRuntimeEvent {
    TerminalState(Result<serde_json::Value, String>),
    Lifecycle(Result<(), String>),
}

#[derive(Clone)]
struct OpenHandsRunSummaryContext {
    skill_name: String,
    step_id: i32,
    workflow_session_id: Option<String>,
    usage_session_id: Option<String>,
    run_source: Option<String>,
    session_id: String,
    model: String,
    plugin_slug: String,
    workspace_path: String,
    started_at: Instant,
}

impl OpenHandsRunSummaryContext {
    fn new(request: &OpenHandsRuntimeRequest, conversation_id: &str) -> Self {
        Self {
            skill_name: request
                .skill_name
                .clone()
                .unwrap_or_else(|| "unknown".to_string()),
            step_id: request.step_id.unwrap_or(-1),
            workflow_session_id: request.workflow_session_id.clone(),
            usage_session_id: request.usage_session_id.clone(),
            run_source: request.run_source.clone(),
            session_id: conversation_id.to_string(),
            model: request.llm.model.clone(),
            plugin_slug: request.plugin_slug.clone(),
            workspace_path: request.workspace_skill_dir.clone(),
            started_at: Instant::now(),
        }
    }
}

struct OpenHandsConversationTask {
    app: tauri::AppHandle,
    agent_id: String,
    client: OpenHandsServerClient,
    conversation_id: String,
    prompt: String,
    prompt_delivery: PromptDelivery,
    websocket_url: String,
    session_api_key: String,
    summary_context: OpenHandsRunSummaryContext,
    stderr_tail: Arc<tokio::sync::Mutex<std::collections::VecDeque<String>>>,
    /// Event recovery mode for frames that may be persisted before the
    /// WebSocket subscriber starts consuming. Some turns need full history
    /// backfill (prepared blank sends), while others need only the delta after
    /// a pre-send watermark (non-empty SendExistingOnly turns such as Refine).
    event_recovery: EventRecoveryMode,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PromptDelivery {
    ViaSendEvent,
    IncludedInConversationCreate,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum EventRecoveryMode {
    None,
    FullHistory,
    Delta,
}

#[derive(Clone)]
struct PendingSubagentLaunch {
    tool_call_id: String,
    prompt: String,
    started_at_ms: i64,
}

struct PersistedSubagentConversation {
    conversation_id: String,
    first_prompt: String,
    first_event_timestamp_ms: i64,
    events: Vec<PersistedSubagentEvent>,
}

struct PersistedSubagentEvent {
    dedupe_key: String,
    raw: serde_json::Value,
}

#[derive(Default)]
struct LiveSubagentStreamState {
    parent_tool_call_by_child_conversation: HashMap<String, String>,
    emitted_child_event_keys: HashSet<String>,
}

fn maybe_record_subagent_launch(
    raw: &serde_json::Value,
    launches: &mut HashMap<String, PendingSubagentLaunch>,
) {
    let kind = raw
        .get("kind")
        .or_else(|| raw.get("event_class"))
        .or_else(|| raw.get("eventClass"))
        .or_else(|| raw.get("type"))
        .and_then(|value| value.as_str());
    if kind != Some("ActionEvent") {
        return;
    }
    let tool_name = raw
        .get("tool_name")
        .or_else(|| raw.get("toolName"))
        .and_then(|value| value.as_str());
    if !matches!(tool_name, Some("task" | "task_tool_set")) {
        return;
    }
    let tool_call_id = raw
        .get("tool_call_id")
        .or_else(|| raw.get("toolCallId"))
        .or_else(|| raw.pointer("/tool_call/id"))
        .and_then(|value| value.as_str());
    let prompt = raw
        .pointer("/action/prompt")
        .and_then(|value| value.as_str());
    let started_at_ms = raw
        .get("timestamp")
        .and_then(|value| value.as_str())
        .and_then(parse_timestamp_ms)
        .unwrap_or_default();
    if let (Some(tool_call_id), Some(prompt)) = (tool_call_id, prompt) {
        launches.insert(
            tool_call_id.to_string(),
            PendingSubagentLaunch {
                tool_call_id: tool_call_id.to_string(),
                prompt: prompt.to_string(),
                started_at_ms,
            },
        );
    }
}

fn persisted_subagents_root(workspace_path: &str, conversation_id: &str) -> PathBuf {
    let storage_dir = conversation_id.replace('-', "");
    Path::new(workspace_path)
        .join("conversations")
        .join(storage_dir)
        .join("subagents")
}

fn list_persisted_subagent_conversations(
    root: &Path,
) -> Result<Vec<PersistedSubagentConversation>, String> {
    if !root.exists() {
        return Ok(vec![]);
    }
    let mut conversations = Vec::new();
    let entries = fs::read_dir(root)
        .map_err(|e| format!("Failed to read subagent directory {}: {e}", root.display()))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read subagent entry: {e}"))?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let conversation_id = entry.file_name().to_string_lossy().to_string();
        let events_dir = path.join("events");
        if !events_dir.exists() {
            continue;
        }
        let mut event_paths = fs::read_dir(&events_dir)
            .map_err(|e| format!("Failed to read child events {}: {e}", events_dir.display()))?
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|path| {
                path.file_name()
                    .and_then(|value| value.to_str())
                    .is_some_and(|name| name.starts_with("event-") && name.ends_with(".json"))
            })
            .collect::<Vec<_>>();
        event_paths.sort();
        let mut events = Vec::new();
        let mut first_prompt = None;
        let mut first_event_timestamp_ms = None;
        for event_path in event_paths {
            let raw = fs::read_to_string(&event_path)
                .map_err(|e| format!("Failed to read child event {}: {e}", event_path.display()))?;
            let parsed: serde_json::Value = serde_json::from_str(&raw).map_err(|e| {
                format!("Failed to parse child event {}: {e}", event_path.display())
            })?;
            let dedupe_key = parsed
                .get("id")
                .and_then(|value| value.as_str())
                .map(str::to_string)
                .or_else(|| {
                    event_path
                        .file_name()
                        .and_then(|value| value.to_str())
                        .map(str::to_string)
                })
                .unwrap_or_else(|| format!("event-{}", events.len()));
            if first_prompt.is_none() {
                first_prompt = extract_user_message_text(&parsed);
            }
            if first_event_timestamp_ms.is_none() {
                first_event_timestamp_ms = parsed
                    .get("timestamp")
                    .and_then(|value| value.as_str())
                    .and_then(parse_timestamp_ms);
            }
            events.push(PersistedSubagentEvent {
                dedupe_key,
                raw: parsed,
            });
        }
        if let (Some(first_prompt), Some(first_event_timestamp_ms)) =
            (first_prompt, first_event_timestamp_ms)
        {
            conversations.push(PersistedSubagentConversation {
                conversation_id,
                first_prompt,
                first_event_timestamp_ms,
                events,
            });
        }
    }
    Ok(conversations)
}

fn parse_timestamp_ms(timestamp: &str) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(timestamp)
        .ok()
        .map(|value| value.timestamp_millis())
        .or_else(|| {
            chrono::NaiveDateTime::parse_from_str(timestamp, "%Y-%m-%dT%H:%M:%S%.f")
                .ok()
                .map(|value| value.and_utc().timestamp_millis())
        })
}

fn extract_user_message_text(raw: &serde_json::Value) -> Option<String> {
    let kind = raw
        .get("kind")
        .or_else(|| raw.get("event_class"))
        .or_else(|| raw.get("eventClass"))
        .or_else(|| raw.get("type"))
        .and_then(|value| value.as_str());
    if kind != Some("MessageEvent")
        || raw.get("source").and_then(|value| value.as_str()) != Some("user")
    {
        return None;
    }
    raw.pointer("/llm_message/content")
        .and_then(|value| value.as_array())
        .and_then(|content| {
            content.iter().find_map(|item| {
                item.get("text")
                    .and_then(|value| value.as_str())
                    .map(str::to_string)
            })
        })
        .or_else(|| {
            raw.pointer("/llm_message/content/0/text")
                .and_then(|value| value.as_str())
                .map(str::to_string)
        })
}

fn collect_live_child_subagent_events(
    root: &Path,
    agent_id: &str,
    launches: &HashMap<String, PendingSubagentLaunch>,
    state: &mut LiveSubagentStreamState,
) -> Result<Vec<serde_json::Value>, String> {
    let children = list_persisted_subagent_conversations(root)?;
    let mut emitted = Vec::new();
    log::info!(
        "[openhands-agent-server:{}] live_subagent_scan root={} launch_count={} child_count={} known_links={} emitted_keys={}",
        agent_id,
        root.display(),
        launches.len(),
        children.len(),
        state.parent_tool_call_by_child_conversation.len(),
        state.emitted_child_event_keys.len()
    );

    for child in children {
        let parent_tool_call_id = if let Some(existing) = state
            .parent_tool_call_by_child_conversation
            .get(&child.conversation_id)
            .cloned()
        {
            log::info!(
                "[openhands-agent-server:{}] live_subagent_scan reuse_link child_conversation={} parent_tool_call_id={}",
                agent_id,
                child.conversation_id,
                existing
            );
            existing
        } else {
            let matched = launches
                .values()
                .find(|launch| {
                    launch.prompt == child.first_prompt
                        && child.first_event_timestamp_ms >= launch.started_at_ms
                        && !state
                            .parent_tool_call_by_child_conversation
                            .values()
                            .any(|used| used == &launch.tool_call_id)
                })
                .map(|launch| launch.tool_call_id.clone());
            let Some(matched) = matched else {
                log::info!(
                    "[openhands-agent-server:{}] live_subagent_scan no_match child_conversation={} first_prompt_len={} child_first_event_ts={}",
                    agent_id,
                    child.conversation_id,
                    child.first_prompt.len(),
                    child.first_event_timestamp_ms
                );
                continue;
            };
            state
                .parent_tool_call_by_child_conversation
                .insert(child.conversation_id.clone(), matched.clone());
            log::info!(
                "[openhands-agent-server:{}] live_subagent_scan matched child_conversation={} parent_tool_call_id={} first_prompt_len={} event_count={}",
                agent_id,
                child.conversation_id,
                matched,
                child.first_prompt.len(),
                child.events.len()
            );
            matched
        };

        for child_event in child.events {
            let emitted_key = format!("{}:{}", child.conversation_id, child_event.dedupe_key);
            if !state.emitted_child_event_keys.insert(emitted_key) {
                continue;
            }

            let mut linked_child = child_event.raw;
            if let Some(record) = linked_child.as_object_mut() {
                record.insert(
                    "parent_tool_call_id".to_string(),
                    serde_json::Value::String(parent_tool_call_id.clone()),
                );
            }
            let normalized =
                normalize_server_event(agent_id, &child.conversation_id, &linked_child);
            if normalized.get("type").and_then(|value| value.as_str()) == Some("conversation_event")
            {
                log::info!(
                    "[openhands-agent-server:{}] live_subagent_emit child_conversation={} parent_tool_call_id={} event_class={} tool_call_id={} raw_kind={}",
                    agent_id,
                    child.conversation_id,
                    parent_tool_call_id,
                    normalized.get("event_class").and_then(|value| value.as_str()).unwrap_or("unknown"),
                    normalized.get("tool_call_id").map(|value| value.to_string()).unwrap_or_else(|| "null".to_string()),
                    linked_child.get("kind").and_then(|value| value.as_str()).unwrap_or("unknown")
                );
                emitted.push(normalized);
            }
        }
    }

    Ok(emitted)
}

#[allow(dead_code)]
pub(crate) fn load_linked_persisted_subagent_conversation_events(
    workspace_path: &str,
    conversation_id: &str,
    parent_events: &[serde_json::Value],
) -> Result<Vec<serde_json::Value>, String> {
    let mut launches = HashMap::new();
    for raw in parent_events {
        maybe_record_subagent_launch(raw, &mut launches);
    }

    let root = persisted_subagents_root(workspace_path, conversation_id);
    let mut state = LiveSubagentStreamState::default();
    collect_live_child_subagent_events(&root, "restore", &launches, &mut state)
}

async fn stream_live_child_subagent_events(
    task: &OpenHandsConversationTask,
    launches: Arc<Mutex<HashMap<String, PendingSubagentLaunch>>>,
    stop: Arc<AtomicBool>,
) {
    let root =
        persisted_subagents_root(&task.summary_context.workspace_path, &task.conversation_id);
    let mut state = LiveSubagentStreamState::default();

    loop {
        let launches_snapshot = match launches.lock() {
            Ok(guard) => guard.clone(),
            Err(error) => {
                log::warn!(
                    "[openhands-agent-server:{}] failed to lock subagent launches for live stream: {}",
                    task.agent_id,
                    error
                );
                HashMap::new()
            }
        };

        match collect_live_child_subagent_events(
            &root,
            &task.agent_id,
            &launches_snapshot,
            &mut state,
        ) {
            Ok(events) => {
                for event in events {
                    super::events::handle_sidecar_message(
                        &task.app,
                        &task.agent_id,
                        &event.to_string(),
                    );
                }
            }
            Err(error) => {
                log::warn!(
                    "[openhands-agent-server:{}] live child subagent event scan failed: {}",
                    task.agent_id,
                    error
                );
            }
        }

        if stop.load(Ordering::Relaxed) {
            break;
        }

        tokio::time::sleep(Duration::from_millis(250)).await;
    }
}

fn record_subagent_launch(
    raw: &serde_json::Value,
    launches: &Arc<Mutex<HashMap<String, PendingSubagentLaunch>>>,
) {
    let Ok(mut guard) = launches.lock() else {
        log::warn!("failed to lock subagent launches for parent conversation stream");
        return;
    };
    let before = guard.len();
    maybe_record_subagent_launch(raw, &mut guard);
    if guard.len() > before {
        if let Some(last) = guard.values().last() {
            log::info!(
                "[openhands-agent-server] recorded_subagent_launch tool_call_id={} prompt_len={} started_at_ms={} launch_count={}",
                last.tool_call_id,
                last.prompt.len(),
                last.started_at_ms,
                guard.len()
            );
        }
    }
}

fn resolve_saved_conversation_outcome(
    saved_conversation_id: Option<&str>,
    selection: OpenHandsConversationSelection,
    saved_status: Option<SavedConversationStatus>,
) -> OpenHandsConversationResolution {
    match (saved_conversation_id, selection, saved_status) {
        (
            Some(existing),
            OpenHandsConversationSelection::SendExistingOnly,
            Some(SavedConversationStatus::Compatible),
        ) => OpenHandsConversationResolution::Reuse {
            conversation_id: existing.to_string(),
        },
        (
            Some(existing),
            OpenHandsConversationSelection::SendExistingOnly,
            Some(SavedConversationStatus::Missing),
        ) => OpenHandsConversationResolution::Error(OpenHandsRuntimeError::ConversationNotFound {
            id: existing.to_string(),
        }),
        (
            Some(existing),
            OpenHandsConversationSelection::SendExistingOnly,
            Some(SavedConversationStatus::Incompatible),
        ) => OpenHandsConversationResolution::Error(OpenHandsRuntimeError::ConversationMismatch {
            id: existing.to_string(),
        }),
        (
            Some(existing),
            OpenHandsConversationSelection::ResumeOrCreate,
            Some(SavedConversationStatus::Compatible),
        ) => OpenHandsConversationResolution::Reuse {
            conversation_id: existing.to_string(),
        },
        (
            Some(_),
            OpenHandsConversationSelection::ResumeOrCreate,
            Some(SavedConversationStatus::Missing),
        ) => OpenHandsConversationResolution::Create {
            reason: OpenHandsSessionCreateReason::NotFound,
        },
        (
            Some(_),
            OpenHandsConversationSelection::ResumeOrCreate,
            Some(SavedConversationStatus::Incompatible),
        ) => OpenHandsConversationResolution::Create {
            reason: OpenHandsSessionCreateReason::Mismatch,
        },
        (None, OpenHandsConversationSelection::ResumeOrCreate, None) => {
            OpenHandsConversationResolution::Create {
                reason: OpenHandsSessionCreateReason::New,
            }
        }
        (_, OpenHandsConversationSelection::CreateFresh, _) => {
            OpenHandsConversationResolution::Create {
                reason: OpenHandsSessionCreateReason::New,
            }
        }
        (None, OpenHandsConversationSelection::SendExistingOnly, None) => {
            OpenHandsConversationResolution::Error(
                OpenHandsRuntimeError::MissingExistingConversation,
            )
        }
        _ => OpenHandsConversationResolution::Error(OpenHandsRuntimeError::Operation {
            operation: "resolve OpenHands conversation",
            detail: "invalid saved conversation state".to_string(),
        }),
    }
}

fn determine_event_recovery_mode(
    selection: OpenHandsConversationSelection,
    prompt: &str,
) -> EventRecoveryMode {
    if selection != OpenHandsConversationSelection::SendExistingOnly {
        return EventRecoveryMode::None;
    }

    if prompt.trim().is_empty() {
        EventRecoveryMode::FullHistory
    } else {
        EventRecoveryMode::Delta
    }
}

fn event_watermark_key(raw: &serde_json::Value) -> Option<String> {
    if let Some(id) = raw.get("id").and_then(|value| value.as_str()) {
        return Some(format!("id:{id}"));
    }

    serde_json::to_string(raw)
        .ok()
        .map(|serialized| format!("raw:{serialized}"))
}

fn collect_event_watermark_keys(events: &[serde_json::Value]) -> std::collections::HashSet<String> {
    events
        .iter()
        .filter_map(event_watermark_key)
        .collect::<std::collections::HashSet<_>>()
}

fn filter_events_after_watermark(
    known_event_keys: Option<&std::collections::HashSet<String>>,
    events: Vec<serde_json::Value>,
) -> Vec<serde_json::Value> {
    let Some(known_event_keys) = known_event_keys else {
        return Vec::new();
    };
    events
        .into_iter()
        .filter(|raw| event_watermark_key(raw).is_none_or(|key| !known_event_keys.contains(&key)))
        .collect()
}

fn log_session_resolution(
    request: &OpenHandsRuntimeRequest,
    selection: OpenHandsConversationSelection,
    resolution: &OpenHandsConversationResolution,
) {
    match resolution {
        OpenHandsConversationResolution::Reuse { conversation_id } => {
            log::info!(
                "[openhands-agent-server] session_resolved action=reuse selection={:?} conversation_id={} run_dir={}",
                selection,
                conversation_id,
                request.runtime_run_dir().display()
            );
        }
        OpenHandsConversationResolution::Create { reason } => {
            log::info!(
                "[openhands-agent-server] session_resolved action=create reason={} selection={:?} run_dir={}",
                reason.as_str(),
                selection,
                request.runtime_run_dir().display()
            );
        }
        OpenHandsConversationResolution::Error(error) => {
            log::warn!(
                "[openhands-agent-server] session_resolved action=error selection={:?} run_dir={} error={}",
                selection,
                request.runtime_run_dir().display(),
                error
            );
        }
    }
}

async fn create_prepared_conversation_for_request(
    client: &OpenHandsServerClient,
    request: &OpenHandsRuntimeRequest,
    include_initial_message: bool,
) -> Result<String, String> {
    let conversation = client
        .create_conversation(
            &StartConversationRequest::from_runtime_request_with_initial_message(
                request,
                include_initial_message,
            ),
        )
        .await
        .map_err(|e| {
            OpenHandsRuntimeError::Operation {
                operation: "create OpenHands Agent Server conversation",
                detail: e.to_string(),
            }
            .to_string()
        })?;
    extract_conversation_id(&conversation)
}

async fn resolve_openhands_conversation_id(
    app: &tauri::AppHandle,
    request: &OpenHandsRuntimeRequest,
    conversation_id: Option<String>,
    selection: OpenHandsConversationSelection,
    include_initial_message_on_create: bool,
) -> Result<String, String> {
    let server =
        ensure_agent_server_process(Duration::from_secs(60), request.runtime_run_dir()).await?;
    let client = OpenHandsServerClient::new(
        server.base_url().parse::<reqwest::Url>().map_err(|e| {
            OpenHandsRuntimeError::Operation {
                operation: "parse OpenHands Agent Server base URL",
                detail: e.to_string(),
            }
            .to_string()
        })?,
        Some(server.session_api_key),
    );

    let saved_conversation_id = if matches!(selection, OpenHandsConversationSelection::CreateFresh)
    {
        conversation_id
    } else if let Some(conversation_id) = conversation_id {
        Some(conversation_id)
    } else {
        load_saved_skill_conversation_id(app, request)?
    };

    let saved_status = if let Some(existing) = saved_conversation_id.as_deref() {
        match client.get_conversation(existing).await.map_err(|e| {
            OpenHandsRuntimeError::Operation {
                operation: "load OpenHands conversation",
                detail: e.to_string(),
            }
            .to_string()
        })? {
            Some(conversation) if conversation_matches_request(&conversation, request) => {
                Some(SavedConversationStatus::Compatible)
            }
            Some(_) => Some(SavedConversationStatus::Incompatible),
            None => Some(SavedConversationStatus::Missing),
        }
    } else {
        None
    };

    let resolution = resolve_saved_conversation_outcome(
        saved_conversation_id.as_deref(),
        selection,
        saved_status,
    );
    log_session_resolution(request, selection, &resolution);

    match resolution {
        OpenHandsConversationResolution::Reuse { conversation_id } => Ok(conversation_id),
        OpenHandsConversationResolution::Create { .. } => {
            create_prepared_conversation_for_request(
                &client,
                request,
                include_initial_message_on_create,
            )
            .await
        }
        OpenHandsConversationResolution::Error(error) => Err(error.to_string()),
    }
}

pub async fn ensure_openhands_server(config: &SidecarConfig) -> Result<(), String> {
    let request = OpenHandsRuntimeRequest::try_from_sidecar_config(config)?;
    ensure_agent_server_process(Duration::from_secs(60), request.runtime_run_dir())
        .await
        .map(|_| ())
}

pub async fn start_openhands_session(
    app: &tauri::AppHandle,
    config: SidecarConfig,
    conversation_id: Option<String>,
) -> Result<String, String> {
    prepare_openhands_session_internal(app, config, conversation_id).await
}

pub async fn prepare_openhands_session(
    app: &tauri::AppHandle,
    config: SidecarConfig,
    conversation_id: Option<String>,
) -> Result<String, String> {
    start_openhands_session(app, config, conversation_id).await
}

async fn prepare_openhands_session_internal(
    app: &tauri::AppHandle,
    config: SidecarConfig,
    conversation_id: Option<String>,
) -> Result<String, String> {
    let request = OpenHandsRuntimeRequest::try_from_sidecar_config(&config)?;
    let conversation_id = resolve_openhands_conversation_id(
        app,
        &request,
        conversation_id,
        OpenHandsConversationSelection::ResumeOrCreate,
        false,
    )
    .await?;
    save_skill_conversation_id(app, &request, &conversation_id)?;
    Ok(conversation_id)
}

pub async fn send_openhands_message(
    app: &tauri::AppHandle,
    agent_id: &str,
    config: SidecarConfig,
    conversation_id: String,
) -> Result<String, String> {
    let request = OpenHandsRuntimeRequest::try_from_sidecar_config(&config)?;
    dispatch_openhands_turn_with_request(
        app,
        agent_id,
        config,
        request,
        Some(conversation_id),
        OpenHandsConversationSelection::SendExistingOnly,
        PromptDelivery::ViaSendEvent,
    )
    .await
}

pub async fn openhands_send_message(
    app: &tauri::AppHandle,
    agent_id: &str,
    config: SidecarConfig,
    conversation_id: String,
) -> Result<String, String> {
    send_openhands_message(app, agent_id, config, conversation_id).await
}

pub fn pause_openhands_session(agent_id: &str) -> bool {
    let mut handle = match cancel_registry().get_mut(agent_id) {
        Some(handle) => handle,
        None => return false,
    };

    if handle.pause_requested {
        log::info!(
            "[pause_openhands_session] agent_id={} action=already-requested",
            agent_id
        );
        return true;
    }

    let Some(cancel) = handle.sender.take() else {
        handle.pause_requested = true;
        log::info!(
            "[pause_openhands_session] agent_id={} action=awaiting-terminal",
            agent_id
        );
        return true;
    };

    let sent = cancel.send(()).is_ok();
    if sent {
        handle.pause_requested = true;
        log::info!(
            "[pause_openhands_session] agent_id={} action=signal-dispatched",
            agent_id
        );
    }
    sent
}

pub async fn terminate_openhands_session(agent_id: &str, timeout: Duration) -> bool {
    let mut found = pause_openhands_session(agent_id);

    if task_registry().contains_key(agent_id) {
        found = true;
    }

    let deadline = Instant::now() + timeout;
    loop {
        let task_present = task_registry().contains_key(agent_id);
        let cancel_present = cancel_registry().contains_key(agent_id);
        if !task_present && !cancel_present {
            return found;
        }

        if Instant::now() >= deadline {
            if let Some((_, handle)) = task_registry().remove(agent_id) {
                handle.abort();
                found = true;
            }
            unregister_cancel(agent_id);
            unregister_task_handle(agent_id);
            return found;
        }

        tokio::time::sleep(Duration::from_millis(25)).await;
    }
}

pub async fn run_throwaway_openhands_session(
    app: &tauri::AppHandle,
    params: OpenHandsThrowawayRunParams,
) -> Result<OpenHandsThrowawayRun, String> {
    let config = params.config;
    let agent_id = params.agent_id.clone();
    let started_at = Instant::now();

    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<OpenHandsRuntimeEvent>();
    let target_agent_id = agent_id.clone();
    let tx_message = tx.clone();
    let message_listener = app.listen("agent-message", move |event| {
        if let Some(result) =
            parse_openhands_runtime_terminal_state(event.payload(), target_agent_id.as_str())
        {
            let _ = tx_message.send(OpenHandsRuntimeEvent::TerminalState(result));
        }
    });

    let target_agent_id = agent_id.clone();
    let tx_exit = tx.clone();
    let exit_listener = app.listen("agent-exit", move |event| {
        if let Some(result) = parse_openhands_lifecycle_state(event.payload(), &target_agent_id) {
            let _ = tx_exit.send(OpenHandsRuntimeEvent::Lifecycle(result));
        }
    });
    let target_agent_id = agent_id.clone();
    let tx_shutdown = tx.clone();
    let shutdown_listener = app.listen("agent-shutdown", move |event| {
        if event.payload().contains(target_agent_id.as_str()) {
            let _ = tx_shutdown.send(OpenHandsRuntimeEvent::Lifecycle(Err(
                "OpenHands throwaway run cancelled".to_string(),
            )));
        }
    });

    let request = OpenHandsRuntimeRequest::try_from_sidecar_config(&config)?;
    dispatch_openhands_turn_with_request(
        app,
        &agent_id,
        config,
        request,
        None,
        OpenHandsConversationSelection::CreateFresh,
        PromptDelivery::IncludedInConversationCreate,
    )
    .await
    .inspect_err(|_| {
        app.unlisten(message_listener);
        app.unlisten(exit_listener);
        app.unlisten(shutdown_listener);
    })?;

    let mut terminal_state: Option<Result<serde_json::Value, String>> = None;
    let mut lifecycle_result: Option<Result<(), String>> = None;
    let wait_result = tokio::time::timeout(params.timeout, async {
        while terminal_state.is_none() || lifecycle_result.is_none() {
            match rx.recv().await {
                Some(OpenHandsRuntimeEvent::TerminalState(result)) => {
                    terminal_state.get_or_insert(result);
                }
                Some(OpenHandsRuntimeEvent::Lifecycle(result)) => {
                    result?;
                    lifecycle_result.get_or_insert(Ok(()));
                }
                None => {
                    return Err("OpenHands runtime listener closed unexpectedly".to_string());
                }
            }
        }
        Ok(())
    })
    .await;

    app.unlisten(message_listener);
    app.unlisten(exit_listener);
    app.unlisten(shutdown_listener);

    match wait_result {
        Ok(Ok(())) => {}
        Ok(Err(error)) => return Err(error),
        Err(_) => {
            let _ = pause_openhands_session(&agent_id);
            return Err("OpenHands throwaway run timed out".to_string());
        }
    };

    let conversation_state = terminal_state.unwrap_or_else(|| {
        Err("OpenHands throwaway run completed without conversation_state".into())
    })?;
    lifecycle_result.unwrap_or_else(|| {
        Err("OpenHands throwaway lifecycle listener closed unexpectedly".to_string())
    })?;

    log::info!(
        "[openhands-agent-server] throwaway_run_completed agent_id={} duration_ms={}",
        agent_id,
        started_at.elapsed().as_millis()
    );

    Ok(OpenHandsThrowawayRun { conversation_state })
}

async fn run_conversation_task(
    task: OpenHandsConversationTask,
    mut cancel_rx: tokio::sync::oneshot::Receiver<()>,
) -> Result<(), String> {
    let result = run_conversation_task_inner(&task, &mut cancel_rx).await;

    if result.is_err() {
        let _ = task.client.pause_conversation(&task.conversation_id).await;
    }
    result
}

async fn dispatch_openhands_turn_with_request(
    app: &tauri::AppHandle,
    agent_id: &str,
    config: SidecarConfig,
    request: OpenHandsRuntimeRequest,
    conversation_id: Option<String>,
    selection: OpenHandsConversationSelection,
    prompt_delivery: PromptDelivery,
) -> Result<String, String> {
    let conversation_id = resolve_openhands_conversation_id(
        app,
        &request,
        conversation_id,
        selection,
        matches!(
            prompt_delivery,
            PromptDelivery::IncludedInConversationCreate
        ),
    )
    .await?;
    let server =
        ensure_agent_server_process(Duration::from_secs(60), request.runtime_run_dir()).await?;
    let client = OpenHandsServerClient::new(
        server
            .base_url()
            .parse::<reqwest::Url>()
            .map_err(|e| format!("Invalid OpenHands Agent Server base URL: {e}"))?,
        Some(server.session_api_key.clone()),
    );

    let config_event = redact_openhands_config_for_log(&config, server.port);
    super::events::handle_sidecar_message(app, agent_id, &config_event.to_string());

    let event_recovery = determine_event_recovery_mode(selection, request.prompt.as_str());

    let summary_context = OpenHandsRunSummaryContext::new(&request, &conversation_id);
    let websocket_url = server.websocket_url(&conversation_id);

    let (cancel_tx, cancel_rx) = tokio::sync::oneshot::channel::<()>();
    register_cancel(agent_id, cancel_tx)?;

    let app_for_task = app.clone();
    let agent_for_task = agent_id.to_string();
    let conversation_id_clone = conversation_id.clone();
    let session_api_key = server.session_api_key.clone();
    let task_handle = tokio::spawn(async move {
        let task = OpenHandsConversationTask {
            app: app_for_task.clone(),
            agent_id: agent_for_task.clone(),
            client,
            conversation_id: conversation_id_clone,
            prompt: request.prompt.clone(),
            prompt_delivery,
            websocket_url,
            session_api_key,
            summary_context,
            stderr_tail: server.stderr_tail.clone(),
            event_recovery,
        };
        let result = run_conversation_task(task, cancel_rx).await;
        unregister_cancel(&agent_for_task);
        unregister_task_handle(&agent_for_task);
        if let Err(error) = result {
            super::events::handle_sidecar_exit_with_detail(
                &app_for_task,
                &agent_for_task,
                false,
                Some(error),
            );
        }
    });
    register_task_handle(agent_id, &task_handle);

    Ok(conversation_id)
}
async fn run_conversation_task_inner(
    task: &OpenHandsConversationTask,
    cancel_rx: &mut tokio::sync::oneshot::Receiver<()>,
) -> Result<(), String> {
    let (ws_stream, _) = tokio_tungstenite::connect_async(&task.websocket_url)
        .await
        .map_err(|e| format!("Failed to connect to OpenHands Agent Server socket: {e}"))?;
    let (mut ws_write, mut ws_read) = ws_stream.split();
    ws_write
        .send(Message::Text(
            serde_json::json!({
                "type": "auth",
                "session_api_key": task.session_api_key,
            })
            .to_string()
            .into(),
        ))
        .await
        .map_err(|e| format!("Failed to authenticate OpenHands Agent Server socket: {e}"))?;

    // Attach/auth the WebSocket before dispatching the prompt so the normal
    // send path can surface the task row live. Keep a narrow recovery step for
    // frames that may still persist before this subscriber consumes them.
    let mut seen_event_ids: std::collections::HashSet<String> = std::collections::HashSet::new();
    let pending_subagent_launches: Arc<Mutex<HashMap<String, PendingSubagentLaunch>>> =
        Arc::new(Mutex::new(HashMap::new()));
    let mut terminal_state: Option<serde_json::Value> = None;
    let mut socket_error: Option<String> = None;

    let known_event_keys_before_send = if matches!(task.event_recovery, EventRecoveryMode::Delta) {
        match task.client.list_all_events(&task.conversation_id).await {
            Ok(events) => Some(collect_event_watermark_keys(&events)),
            Err(error) => {
                log::warn!(
                    "[openhands-agent-server:{}] pre-send event watermark failed (live WS only): {}",
                    task.agent_id,
                    error
                );
                None
            }
        }
    } else {
        None
    };

    if matches!(task.prompt_delivery, PromptDelivery::ViaSendEvent) {
        send_user_message(&task.client, &task.conversation_id, &task.prompt).await?;
    }

    match task.event_recovery {
        EventRecoveryMode::None => {}
        EventRecoveryMode::FullHistory => {
            match task.client.list_all_events(&task.conversation_id).await {
                Ok(events) => {
                    for raw in events {
                        if let Some(id) = raw.get("id").and_then(|value| value.as_str()) {
                            if !seen_event_ids.insert(id.to_string()) {
                                continue;
                            }
                        }
                        record_subagent_launch(&raw, &pending_subagent_launches);
                        let normalized =
                            normalize_server_event(&task.agent_id, &task.conversation_id, &raw);
                        if normalized.get("type").and_then(|value| value.as_str())
                            == Some("conversation_state")
                        {
                            terminal_state = Some(normalized);
                            continue;
                        }
                        super::events::handle_sidecar_message(
                            &task.app,
                            &task.agent_id,
                            &normalized.to_string(),
                        );
                    }
                }
                Err(e) => {
                    log::warn!(
                        "[openhands-agent-server:{}] event backfill failed (live WS only): {}",
                        task.agent_id,
                        e
                    );
                }
            }
        }
        EventRecoveryMode::Delta => {
            if let Some(known_event_keys_before_send) = known_event_keys_before_send.as_ref() {
                seen_event_ids.extend(
                    known_event_keys_before_send
                        .iter()
                        .filter_map(|key| key.strip_prefix("id:").map(str::to_string)),
                );
            }
            match task.client.list_all_events(&task.conversation_id).await {
                Ok(events) => {
                    for raw in
                        filter_events_after_watermark(known_event_keys_before_send.as_ref(), events)
                    {
                        if let Some(id) = raw.get("id").and_then(|value| value.as_str()) {
                            if !seen_event_ids.insert(id.to_string()) {
                                continue;
                            }
                        }
                        record_subagent_launch(&raw, &pending_subagent_launches);
                        let normalized =
                            normalize_server_event(&task.agent_id, &task.conversation_id, &raw);
                        if normalized.get("type").and_then(|value| value.as_str())
                            == Some("conversation_state")
                        {
                            terminal_state = Some(normalized);
                            continue;
                        }
                        super::events::handle_sidecar_message(
                            &task.app,
                            &task.agent_id,
                            &normalized.to_string(),
                        );
                    }
                }
                Err(e) => {
                    log::warn!(
                        "[openhands-agent-server:{}] delta event recovery failed (live WS only): {}",
                        task.agent_id,
                        e
                    );
                }
            }
        }
    }

    let stop_subagent_stream = Arc::new(AtomicBool::new(false));
    let subagent_stream_handle = if terminal_state.is_none() {
        let launches = Arc::clone(&pending_subagent_launches);
        let stop = Arc::clone(&stop_subagent_stream);
        let worker_task = OpenHandsConversationTask {
            app: task.app.clone(),
            agent_id: task.agent_id.clone(),
            client: task.client.clone(),
            conversation_id: task.conversation_id.clone(),
            prompt: task.prompt.clone(),
            prompt_delivery: task.prompt_delivery,
            websocket_url: task.websocket_url.clone(),
            session_api_key: task.session_api_key.clone(),
            summary_context: task.summary_context.clone(),
            stderr_tail: task.stderr_tail.clone(),
            event_recovery: EventRecoveryMode::None,
        };
        Some(tokio::spawn(async move {
            stream_live_child_subagent_events(&worker_task, launches, stop).await
        }))
    } else {
        None
    };

    let mut cancel_pending = false;
    // If REST backfill drained a terminal `conversation_state`, the
    // conversation is already finished on the server. Skip the redundant
    // /run POST and the WS read loop — fall straight through to the
    // terminal-state handling below. Without this short-circuit a
    // completed-on-disk conversation would issue a duplicate /run, and an
    // error/cancelled-on-disk conversation would re-emit lifecycle events
    // we've already projected.
    if terminal_state.is_none() {
        task.client
            .run_conversation(&task.conversation_id)
            .await
            .map_err(|e| format!("Failed to run OpenHands Agent Server conversation: {e}"))?;
    }

    while terminal_state.is_none() {
        tokio::select! {
            _ = &mut *cancel_rx, if !cancel_pending => {
                log::info!(
                    "[openhands-agent-server:{}] pause_request dispatch conversation_id={}",
                    task.agent_id,
                    task.conversation_id
                );
                task.client
                    .pause_conversation(&task.conversation_id)
                    .await
                    .map_err(|e| format!("Failed to pause OpenHands Agent Server conversation: {e}"))?;
                log::info!(
                    "[openhands-agent-server:{}] pause_request result=ok conversation_id={}",
                    task.agent_id,
                    task.conversation_id
                );
                // Continue reading the WebSocket — the server will stream back a PauseEvent
                // which normalize_server_event maps to conversation_state(status="cancelled").
                cancel_pending = true;
            }
            message = ws_read.next() => {
                let Some(message) = message else {
                    break;
                };
                let message = match message {
                    Ok(message) => message,
                    Err(e) => {
                        socket_error = Some(format!("OpenHands Agent Server socket read failed: {e}"));
                        break;
                    }
                };
                if !message.is_text() {
                    continue;
                }
                let text = message.into_text().map_err(|e| {
                    format!("OpenHands Agent Server socket message was invalid text: {e}")
                })?;
                let raw = match serde_json::from_str::<serde_json::Value>(&text) {
                    Ok(value) => value,
                    Err(e) => {
                        log::debug!(
                            "[openhands-agent-server:{}] ignored non-json socket message: {}",
                            task.agent_id,
                            e
                        );
                        continue;
                    }
                };
                if let Some(id) = raw.get("id").and_then(|value| value.as_str()) {
                    if !seen_event_ids.insert(id.to_string()) {
                        continue;
                    }
                }
                record_subagent_launch(&raw, &pending_subagent_launches);
                let normalized = normalize_server_event(&task.agent_id, &task.conversation_id, &raw);
                let is_terminal = normalized
                    .get("type")
                    .and_then(|value| value.as_str())
                    == Some("conversation_state");
                if is_terminal {
                    terminal_state = Some(normalized);
                    break;
                } else {
                    super::events::handle_sidecar_message(&task.app, &task.agent_id, &normalized.to_string());
                }
            }
        }
    }

    stop_subagent_stream.store(true, Ordering::Relaxed);
    if let Some(handle) = subagent_stream_handle {
        if let Err(error) = handle.await {
            log::warn!(
                "[openhands-agent-server:{}] subagent event stream worker join failed: {}",
                task.agent_id,
                error
            );
        }
    }

    let mut terminal_state = match terminal_state {
        Some(state) if terminal_state_needs_final_response(&state) => {
            match fetch_final_response_state(
                &task.client,
                &task.agent_id,
                &task.conversation_id,
                Some(state),
            )
            .await
            {
                Ok(final_state) => final_state,
                Err(error) => build_missing_completed_payload_state(
                    &task.agent_id,
                    &task.conversation_id,
                    &error,
                ),
            }
        }
        Some(state) => state,
        None if cancel_pending => build_cancelled_state(&task.agent_id, &task.conversation_id),
        None => recover_terminal_state_after_socket_failure(task, socket_error.as_deref()).await,
    };

    enrich_terminal_state_error_detail(&mut terminal_state, &task.stderr_tail).await;

    let terminal_error = if terminal_state
        .get("status")
        .and_then(|value| value.as_str())
        != Some("completed")
    {
        terminal_state
            .get("error_detail")
            .and_then(|value| value.as_str())
            .map(str::to_string)
            .or_else(|| Some("OpenHands runtime run failed".to_string()))
    } else {
        None
    };
    if cancel_pending {
        let terminal_status = terminal_state
            .get("status")
            .and_then(|value| value.as_str())
            .unwrap_or("unknown");
        log::info!(
            "[openhands-agent-server:{}] pause_terminal_outcome status={} conversation_id={}",
            task.agent_id,
            terminal_status,
            task.conversation_id
        );
    }
    emit_openhands_run_result(
        &task.app,
        &task.agent_id,
        &terminal_state,
        &task.summary_context,
    );
    super::events::handle_sidecar_message(&task.app, &task.agent_id, &terminal_state.to_string());
    super::events::handle_sidecar_exit_with_detail(
        &task.app,
        &task.agent_id,
        terminal_error.is_none(),
        terminal_error,
    );
    Ok(())
}

async fn enrich_terminal_state_error_detail(
    terminal_state: &mut serde_json::Value,
    stderr_tail: &Arc<tokio::sync::Mutex<std::collections::VecDeque<String>>>,
) {
    let status = terminal_state
        .get("status")
        .and_then(|value| value.as_str())
        .unwrap_or("");
    if status == "completed" || status == "cancelled" || status == "canceled" {
        return;
    }
    let existing = terminal_state
        .get("error_detail")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|detail| !detail.is_empty());
    if existing.is_some() {
        return;
    }
    let stderr_lines = stderr_tail_snapshot(stderr_tail).await;
    let Some(detail) = extract_terminal_error_from_stderr(&stderr_lines) else {
        return;
    };
    if let Some(object) = terminal_state.as_object_mut() {
        object.insert("error_detail".to_string(), serde_json::Value::String(detail));
    }
}

async fn recover_terminal_state_after_socket_failure(
    task: &OpenHandsConversationTask,
    socket_error: Option<&str>,
) -> serde_json::Value {
    match task.client.list_all_events(&task.conversation_id).await {
        Ok(events) => {
            if let Some(state) =
                recover_terminal_state_from_events(&task.agent_id, &task.conversation_id, &events)
            {
                if terminal_state_needs_final_response(&state) {
                    match fetch_final_response_state(
                        &task.client,
                        &task.agent_id,
                        &task.conversation_id,
                        Some(state.clone()),
                    )
                    .await
                    {
                        Ok(final_state) => return final_state,
                        Err(error) => {
                            return build_missing_completed_payload_state(
                                &task.agent_id,
                                &task.conversation_id,
                                &error,
                            );
                        }
                    }
                }
                return state;
            }
        }
        Err(error) => {
            log::warn!(
                "[openhands-agent-server:{}] failed to recover persisted events after socket failure: {}",
                task.agent_id,
                error
            );
        }
    }

    build_socket_closed_state(
        &task.agent_id,
        &task.conversation_id,
        socket_error
            .unwrap_or("OpenHands Agent Server socket closed before terminal conversation_state"),
    )
}

fn recover_terminal_state_from_events(
    agent_id: &str,
    conversation_id: &str,
    events: &[serde_json::Value],
) -> Option<serde_json::Value> {
    events.iter().rev().find_map(|raw| {
        let normalized = normalize_server_event(agent_id, conversation_id, raw);
        (normalized.get("type").and_then(|value| value.as_str()) == Some("conversation_state"))
            .then_some(normalized)
    })
}

fn build_socket_closed_state(
    agent_id: &str,
    conversation_id: &str,
    error_detail: &str,
) -> serde_json::Value {
    serde_json::json!({
        "type": "conversation_state",
        "runtime": "openhands",
        "agent_id": agent_id,
        "conversation_id": conversation_id,
        "status": "error",
        "timestamp": chrono::Utc::now().timestamp_millis(),
        "error_detail": error_detail,
        "result_text": null,
        "structured_output": null,
    })
}

/// Build a synthetic `cancelled` terminal state when the user cancelled and
/// the WebSocket closed without a follow-up `PauseEvent`. Without this the
/// loop falls through to `build_socket_closed_state` and surfaces the cancel
/// as `status: "error"`, which is wrong — the user explicitly cancelled.
fn build_cancelled_state(agent_id: &str, conversation_id: &str) -> serde_json::Value {
    serde_json::json!({
        "type": "conversation_state",
        "runtime": "openhands",
        "agent_id": agent_id,
        "conversation_id": conversation_id,
        "status": "cancelled",
        "timestamp": chrono::Utc::now().timestamp_millis(),
        "error_detail": "User cancelled before the server emitted a PauseEvent",
        "result_text": null,
        "structured_output": null,
    })
}

fn emit_openhands_run_result(
    app: &tauri::AppHandle,
    agent_id: &str,
    terminal_state: &serde_json::Value,
    context: &OpenHandsRunSummaryContext,
) {
    let run_result = build_openhands_run_result_event(terminal_state, context);
    super::events::handle_sidecar_message(app, agent_id, &run_result.to_string());
}

fn build_openhands_run_result_event(
    terminal_state: &serde_json::Value,
    context: &OpenHandsRunSummaryContext,
) -> serde_json::Value {
    let status = terminal_state
        .get("status")
        .and_then(|value| value.as_str())
        .unwrap_or("error");
    let result_text = terminal_state
        .get("result_text")
        .and_then(|value| value.as_str())
        .map(str::to_string);
    let result_errors = terminal_state
        .get("error_detail")
        .and_then(|value| value.as_str())
        .filter(|detail| !detail.trim().is_empty())
        .map(|detail| vec![detail.to_string()]);
    let duration_ms = context
        .started_at
        .elapsed()
        .as_millis()
        .min(i64::MAX as u128) as i64;
    serde_json::json!({
        "type": "agent_event",
        "timestamp": chrono::Utc::now().timestamp_millis(),
        "event": {
            "type": "run_result",
            "skillName": context.skill_name,
            "stepId": context.step_id,
            "workflowSessionId": context.workflow_session_id,
            "usageSessionId": context.usage_session_id,
            "runSource": context.run_source,
            "sessionId": context.session_id,
            "model": context.model,
            "inputTokens": 0,
            "outputTokens": 0,
            "cacheReadTokens": 0,
            "cacheWriteTokens": 0,
            "totalCostUsd": 0.0,
            "modelUsageBreakdown": [],
            "contextWindow": 0,
            "resultSubtype": if status == "completed" { serde_json::Value::Null } else { serde_json::Value::String("openhands_agent_server".to_string()) },
            "resultErrors": result_errors,
            "stopReason": serde_json::Value::Null,
            "numTurns": 0,
            "durationMs": duration_ms,
            "durationApiMs": serde_json::Value::Null,
            "toolUseCount": 0,
            "compactionCount": 0,
            "status": status,
            "resultText": result_text,
            "workspacePath": context.workspace_path,
            "pluginSlug": context.plugin_slug,
        }
    })
}

fn terminal_state_needs_final_response(state: &serde_json::Value) -> bool {
    state.get("status").and_then(|value| value.as_str()) == Some("completed")
        && state
            .get("result_text")
            .map(|value| value.is_null())
            .unwrap_or(true)
        && state
            .get("structured_output")
            .map(|value| value.is_null())
            .unwrap_or(true)
}

async fn fetch_final_response_state(
    client: &OpenHandsServerClient,
    agent_id: &str,
    conversation_id: &str,
    terminal_event: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    let final_response = client
        .agent_final_response(conversation_id)
        .await
        .map_err(|e| format!("Failed to fetch OpenHands final response: {e}"))?;
    let response = final_response
        .get("response")
        .and_then(|value| value.as_str())
        .unwrap_or("")
        .to_string();
    if response.trim().is_empty() {
        return Err("OpenHands completed without structured output or final response".to_string());
    }
    Ok(serde_json::json!({
        "type": "conversation_state",
        "runtime": "openhands",
        "agent_id": agent_id,
        "conversation_id": conversation_id,
        "status": "completed",
        "timestamp": chrono::Utc::now().timestamp_millis(),
        "result_text": response,
        "structured_output": null,
        "raw_event": {
            "terminal_event": terminal_event,
            "final_response": final_response,
        },
    }))
}

fn build_missing_completed_payload_state(
    agent_id: &str,
    conversation_id: &str,
    error_detail: &str,
) -> serde_json::Value {
    serde_json::json!({
        "type": "conversation_state",
        "runtime": "openhands",
        "agent_id": agent_id,
        "conversation_id": conversation_id,
        "status": "error",
        "timestamp": chrono::Utc::now().timestamp_millis(),
        "error_detail": error_detail,
        "result_text": null,
        "structured_output": null,
    })
}

fn redact_openhands_config_for_log(config: &SidecarConfig, port: u16) -> serde_json::Value {
    let mut value = serde_json::to_value(config).unwrap_or(serde_json::Value::Null);
    if let Some(obj) = value.as_object_mut() {
        if obj.contains_key("apiKey") {
            obj.insert(
                "apiKey".to_string(),
                serde_json::Value::String("[REDACTED]".to_string()),
            );
        }
        if let Some(llm) = obj.get_mut("llm").and_then(|v| v.as_object_mut()) {
            if llm.contains_key("apiKey") {
                llm.insert(
                    "apiKey".to_string(),
                    serde_json::Value::String("[REDACTED]".to_string()),
                );
            }
            if let Some(headers) = llm.get_mut("extraHeaders").and_then(|v| v.as_object_mut()) {
                for value in headers.values_mut() {
                    if value.is_string() {
                        *value = serde_json::Value::String("[REDACTED]".to_string());
                    }
                }
            }
        }
        obj.insert(
            "agentServer".to_string(),
            serde_json::json!({"host": "127.0.0.1", "port": port}),
        );
    }
    serde_json::json!({
        "type": "config",
        "config": value,
    })
}

fn extract_conversation_id(conversation: &serde_json::Value) -> Result<String, String> {
    conversation
        .get("id")
        .or_else(|| conversation.get("conversation_id"))
        .or_else(|| conversation.get("conversationId"))
        .and_then(|value| value.as_str())
        .map(str::to_string)
        .ok_or_else(|| {
            format!(
                "OpenHands Agent Server create conversation response did not include an id: {}",
                conversation
            )
        })
}

fn parse_openhands_runtime_terminal_state(
    payload: &str,
    target_agent_id: &str,
) -> Option<Result<serde_json::Value, String>> {
    let value = serde_json::from_str::<serde_json::Value>(payload).ok()?;
    if value.get("agent_id").and_then(|v| v.as_str()) != Some(target_agent_id) {
        return None;
    }

    let message = value.get("message")?;
    if message.get("type").and_then(|v| v.as_str()) != Some("conversation_state") {
        return None;
    }

    match message.get("status").and_then(|v| v.as_str())? {
        "completed" => Some(Ok(message.clone())),
        "error" => Some(Err(openhands_conversation_state_error_detail(
            message,
            "OpenHands runtime run failed",
        ))),
        "cancelled" | "canceled" => Some(Err(openhands_conversation_state_error_detail(
            message,
            "OpenHands runtime run cancelled",
        ))),
        _ => None,
    }
}

fn parse_openhands_lifecycle_state(
    payload: &str,
    target_agent_id: &str,
) -> Option<Result<(), String>> {
    let value = serde_json::from_str::<serde_json::Value>(payload).ok()?;
    if value.get("agent_id").and_then(|v| v.as_str()) != Some(target_agent_id) {
        return None;
    }
    let success = value
        .get("success")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    if success {
        Some(Ok(()))
    } else {
        Some(Err(value
            .get("error_detail")
            .and_then(|v| v.as_str())
            .unwrap_or("OpenHands runtime run failed")
            .to_string()))
    }
}

fn openhands_conversation_state_error_detail(
    message: &serde_json::Value,
    fallback: &str,
) -> String {
    message
        .get("error_detail")
        .or_else(|| message.get("errorDetail"))
        .and_then(|v| v.as_str())
        .filter(|detail| !detail.trim().is_empty())
        .unwrap_or(fallback)
        .to_string()
}

struct OpenHandsCancelHandle {
    sender: Option<tokio::sync::oneshot::Sender<()>>,
    pause_requested: bool,
}

type OpenHandsCancelRegistry = DashMap<String, OpenHandsCancelHandle>;
type OpenHandsTaskRegistry = DashMap<String, tokio::task::AbortHandle>;

fn cancel_registry() -> &'static OpenHandsCancelRegistry {
    static REGISTRY: std::sync::OnceLock<OpenHandsCancelRegistry> = std::sync::OnceLock::new();
    REGISTRY.get_or_init(OpenHandsCancelRegistry::new)
}

fn task_registry() -> &'static OpenHandsTaskRegistry {
    static REGISTRY: std::sync::OnceLock<OpenHandsTaskRegistry> = std::sync::OnceLock::new();
    REGISTRY.get_or_init(OpenHandsTaskRegistry::new)
}

fn register_cancel(agent_id: &str, cancel: tokio::sync::oneshot::Sender<()>) -> Result<(), String> {
    if let Some((_, previous)) = cancel_registry().remove(agent_id) {
        if let Some(sender) = previous.sender {
            let _ = sender.send(());
        }
    }
    cancel_registry().insert(
        agent_id.to_string(),
        OpenHandsCancelHandle {
            sender: Some(cancel),
            pause_requested: false,
        },
    );
    Ok(())
}

fn unregister_cancel(agent_id: &str) {
    cancel_registry().remove(agent_id);
}

fn register_task_handle(agent_id: &str, handle: &tokio::task::JoinHandle<()>) {
    if let Some((_, previous)) = task_registry().remove(agent_id) {
        previous.abort();
    }
    task_registry().insert(agent_id.to_string(), handle.abort_handle());
}

fn unregister_task_handle(agent_id: &str) {
    task_registry().remove(agent_id);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn terminal_state_without_payload_requires_final_response_fetch() {
        let state = serde_json::json!({
            "type": "conversation_state",
            "status": "completed",
            "result_text": null,
            "structured_output": null
        });

        assert!(terminal_state_needs_final_response(&state));
    }

    #[test]
    fn terminal_state_with_payload_does_not_require_final_response_fetch() {
        let with_text = serde_json::json!({
            "type": "conversation_state",
            "status": "completed",
            "result_text": "{\"status\":\"ok\"}",
            "structured_output": null
        });
        let with_structured = serde_json::json!({
            "type": "conversation_state",
            "status": "completed",
            "result_text": null,
            "structured_output": {"status": "ok"}
        });
        // Empty string is a valid intentional result; do not trigger a fallback fetch.
        let with_empty_string = serde_json::json!({
            "type": "conversation_state",
            "status": "completed",
            "result_text": "",
            "structured_output": null
        });

        assert!(!terminal_state_needs_final_response(&with_text));
        assert!(!terminal_state_needs_final_response(&with_structured));
        assert!(!terminal_state_needs_final_response(&with_empty_string));
    }

    #[test]
    fn empty_fetched_final_response_is_not_a_valid_completed_payload() {
        let state = build_missing_completed_payload_state(
            "agent-1",
            "conversation-1",
            "OpenHands completed without structured output or final response",
        );

        assert_eq!(state["type"], "conversation_state");
        assert_eq!(state["status"], "error");
        assert_eq!(
            state["error_detail"],
            "OpenHands completed without structured output or final response"
        );
        assert!(state["result_text"].is_null());
        assert!(state["structured_output"].is_null());
    }

    #[test]
    fn socket_close_without_terminal_state_is_error_state() {
        let state = build_socket_closed_state(
            "agent-1",
            "conversation-1",
            "OpenHands Agent Server socket closed before terminal conversation_state",
        );

        assert_eq!(
            state.get("type").and_then(|v| v.as_str()),
            Some("conversation_state")
        );
        assert_eq!(state.get("status").and_then(|v| v.as_str()), Some("error"));
        assert!(state
            .get("error_detail")
            .and_then(|v| v.as_str())
            .unwrap()
            .contains("socket closed before terminal conversation_state"));
    }

    #[test]
    fn socket_close_after_user_cancel_surfaces_as_cancelled_not_error() {
        // The cancel-after-pause race: the user cancelled, we issued
        // pause_conversation, but the WS closed without a follow-up
        // PauseEvent. Without this fallback the user would see the cancel
        // surface as `status: "error"` — which is a UX regression on a
        // user-driven cancel.
        let state = build_cancelled_state("agent-1", "conversation-1");

        assert_eq!(
            state.get("type").and_then(|v| v.as_str()),
            Some("conversation_state")
        );
        assert_eq!(
            state.get("status").and_then(|v| v.as_str()),
            Some("cancelled")
        );
        assert!(state
            .get("error_detail")
            .and_then(|v| v.as_str())
            .unwrap()
            .contains("cancelled"));
    }

    #[test]
    fn persisted_terminal_event_can_be_recovered_after_socket_failure() {
        let recovered = recover_terminal_state_from_events(
            "agent-1",
            "conversation-1",
            &[serde_json::json!({
                "event_class": "ConversationStateUpdateEvent",
                "key": "execution_status",
                "value": "finished"
            })],
        )
        .expect("expected terminal state from persisted event");

        assert_eq!(recovered["type"], "conversation_state");
        assert_eq!(recovered["status"], "completed");
        assert_eq!(recovered["agent_id"], "agent-1");
        assert_eq!(recovered["conversation_id"], "conversation-1");
    }

    #[tokio::test]
    async fn generic_terminal_error_is_enriched_from_agent_server_stderr() {
        let stderr_tail = Arc::new(tokio::sync::Mutex::new(
            std::collections::VecDeque::from(vec![
                "ConversationRunError:".to_string(),
                "Conversation run failed for id=abc123:".to_string(),
                "OpenAIException - Model".to_string(),
                "glm-5-free not supported".to_string(),
                "Conversation logs are stored at:".to_string(),
            ]),
        ));
        let mut state = serde_json::json!({
            "type": "conversation_state",
            "status": "error",
            "error_detail": null,
            "result_text": null,
            "structured_output": null
        });

        enrich_terminal_state_error_detail(&mut state, &stderr_tail).await;

        assert_eq!(
            state.get("error_detail").and_then(|v| v.as_str()),
            Some("OpenAIException - Model glm-5-free not supported")
        );
    }

    #[test]
    fn seen_event_ids_dedupe_drops_duplicate_ids_across_rest_and_ws() {
        // Cross-source dedupe is the whole point of `seen_event_ids`. Its
        // contract is small: insert returns false → drop. Pin it with a
        // direct assertion so a refactor that swaps `HashSet` for a
        // looser collection (or skips the insert!=false guard) trips the
        // build before the SystemPromptEvent / initial MessageEvent
        // re-renders twice.
        let mut seen_event_ids: std::collections::HashSet<String> =
            std::collections::HashSet::new();

        // First arrival via REST backfill — must be processed.
        assert!(seen_event_ids.insert("event-00000".to_string()));
        // Same id replayed via WS — must be dropped.
        assert!(!seen_event_ids.insert("event-00000".to_string()));
        // A different id must still be processed.
        assert!(seen_event_ids.insert("event-00001".to_string()));
    }

    #[test]
    fn delta_recovery_filters_out_pre_send_events_and_keeps_new_task_events() {
        let known_event_keys = std::collections::HashSet::from([
            "id:event-00000".to_string(),
            "id:event-00001".to_string(),
        ]);
        let events = vec![
            serde_json::json!({
                "id": "event-00000",
                "event_class": "SystemPromptEvent",
            }),
            serde_json::json!({
                "id": "event-00001",
                "event_class": "MessageEvent",
                "event": { "source": "user", "message": "older task" }
            }),
            serde_json::json!({
                "id": "event-00002",
                "event_class": "MessageEvent",
                "event": { "source": "user", "message": "refine follow-up task" }
            }),
        ];

        let recovered = filter_events_after_watermark(Some(&known_event_keys), events);

        assert_eq!(recovered.len(), 1);
        assert_eq!(recovered[0]["id"], "event-00002");
        assert_eq!(recovered[0]["event"]["message"], "refine follow-up task");
    }

    #[test]
    fn delta_recovery_skips_backfill_when_pre_send_watermark_is_unavailable() {
        let events = vec![
            serde_json::json!({
                "id": "event-00000",
                "event_class": "SystemPromptEvent",
            }),
            serde_json::json!({
                "id": "event-00001",
                "event_class": "MessageEvent",
                "event": { "source": "user", "message": "older task" }
            }),
            serde_json::json!({
                "id": "event-00002",
                "event_class": "MessageEvent",
                "event": { "source": "user", "message": "latest task" }
            }),
        ];

        let recovered = filter_events_after_watermark(None, events);

        assert!(recovered.is_empty());
    }

    #[test]
    fn delta_recovery_dedupes_pre_send_events_without_ids() {
        let watermark_events = vec![
            serde_json::json!({
                "event_class": "SystemPromptEvent",
                "timestamp": 1000,
                "event": {
                    "system_prompt": { "text": "You are the skill creator." }
                }
            }),
            serde_json::json!({
                "event_class": "MessageEvent",
                "timestamp": 1100,
                "event": {
                    "source": "user",
                    "message": "older task"
                }
            }),
        ];
        let all_events = vec![
            watermark_events[0].clone(),
            watermark_events[1].clone(),
            serde_json::json!({
                "event_class": "MessageEvent",
                "timestamp": 1200,
                "event": {
                    "source": "user",
                    "message": "latest task"
                }
            }),
        ];

        let known_event_keys = collect_event_watermark_keys(&watermark_events);
        let recovered = filter_events_after_watermark(Some(&known_event_keys), all_events);

        assert_eq!(recovered.len(), 1);
        assert_eq!(recovered[0]["event"]["message"], "latest task");
    }

    #[test]
    fn openhands_run_result_event_preserves_persistence_context() {
        let context = OpenHandsRunSummaryContext {
            skill_name: "my-skill".to_string(),
            step_id: 2,
            workflow_session_id: Some("workflow-1".to_string()),
            usage_session_id: Some("usage-1".to_string()),
            run_source: Some("workflow".to_string()),
            session_id: "conversation-1".to_string(),
            model: "anthropic/claude-sonnet-4-6".to_string(),
            plugin_slug: "skill-creator".to_string(),
            workspace_path: "/tmp/workspace/my-skill".to_string(),
            started_at: Instant::now(),
        };
        let terminal_state = serde_json::json!({
            "type": "conversation_state",
            "status": "completed",
            "result_text": "{\"status\":\"ok\"}",
        });

        let event = build_openhands_run_result_event(&terminal_state, &context);
        let run_result = event.get("event").unwrap();

        assert_eq!(
            event.get("type").and_then(|v| v.as_str()),
            Some("agent_event")
        );
        assert_eq!(
            run_result.get("type").and_then(|v| v.as_str()),
            Some("run_result")
        );
        assert_eq!(
            run_result.get("skillName").and_then(|v| v.as_str()),
            Some("my-skill")
        );
        assert_eq!(run_result.get("stepId").and_then(|v| v.as_i64()), Some(2));
        assert_eq!(
            run_result.get("workflowSessionId").and_then(|v| v.as_str()),
            Some("workflow-1")
        );
        assert_eq!(
            run_result.get("usageSessionId").and_then(|v| v.as_str()),
            Some("usage-1")
        );
        assert_eq!(
            run_result.get("sessionId").and_then(|v| v.as_str()),
            Some("conversation-1")
        );
        assert_eq!(
            run_result.get("model").and_then(|v| v.as_str()),
            Some("anthropic/claude-sonnet-4-6")
        );
        assert_eq!(
            run_result.get("status").and_then(|v| v.as_str()),
            Some("completed")
        );
        assert_eq!(
            run_result.get("resultText").and_then(|v| v.as_str()),
            Some("{\"status\":\"ok\"}")
        );
        assert_eq!(
            run_result.get("workspacePath").and_then(|v| v.as_str()),
            Some("/tmp/workspace/my-skill")
        );
        assert_eq!(
            run_result.get("pluginSlug").and_then(|v| v.as_str()),
            Some("skill-creator")
        );
    }

    #[test]
    fn existing_conversation_is_only_reused_when_compatible() {
        let conversation = serde_json::json!({
            "agent": {
                "agent_context": {
                    "system_message_suffix": "# Skill Creator Agent",
                    "user_message_suffix": "# Skill Creator User"
                }
            }
        });
        let request = OpenHandsRuntimeRequest {
            prompt: "workflow".to_string(),
            llm: crate::types::WorkflowLlmConfig {
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
            },
            workspace_root_dir: "/tmp/workspace".to_string(),
            workspace_skill_dir: "/tmp/workspace/default/skills/my-skill".to_string(),
            allowed_tools: vec![],
            max_turns: 50,
            user_message_suffix: Some("# Skill Creator User".to_string()),
            system_message_suffix: Some("# Skill Creator Agent".to_string()),
            task_kind: Some("workflow.skill_generation".to_string()),
            plugin_slug: "default".to_string(),
            skill_name: Some("my-skill".to_string()),
            step_id: Some(3),
            run_source: Some("workflow".to_string()),
            workflow_session_id: Some("workflow-session".to_string()),
            usage_session_id: None,
        };

        assert!(conversation_matches_request(&conversation, &request));
        let mut stale = conversation.clone();
        stale["agent"]["agent_context"]["system_message_suffix"] = serde_json::Value::Null;
        assert!(!conversation_matches_request(&stale, &request));
        let mut stale_user = conversation.clone();
        stale_user["agent"]["agent_context"]["user_message_suffix"] = serde_json::Value::Null;
        assert!(!conversation_matches_request(&stale_user, &request));
    }

    #[test]
    fn persistent_session_create_preserves_prompt_and_keeps_resume_contract() {
        let request = OpenHandsRuntimeRequest {
            prompt: "Generate the skill package".to_string(),
            llm: crate::types::WorkflowLlmConfig {
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
            },
            workspace_root_dir: "/tmp/workspace".to_string(),
            workspace_skill_dir: "/tmp/workspace/default/skills/my-skill".to_string(),
            allowed_tools: vec!["file_editor".to_string(), "terminal".to_string()],
            max_turns: 50,
            user_message_suffix: Some(
                "Follow the current user message exactly. Do not infer a different task than the one stated in the message."
                    .to_string(),
            ),
            system_message_suffix: Some(
                crate::agents::sidecar::skill_creator_system_message_suffix(),
            ),
            task_kind: Some("workflow.skill_generation".to_string()),
            plugin_slug: "default".to_string(),
            skill_name: Some("my-skill".to_string()),
            step_id: Some(3),
            run_source: Some("workflow".to_string()),
            workflow_session_id: Some("workflow-session".to_string()),
            usage_session_id: None,
        };

        let existing_conversation = serde_json::json!({
            "agent": {
                "agent_context": {
                    "system_message_suffix": request.system_message_suffix,
                    "user_message_suffix": request.user_message_suffix,
                }
            }
        });

        assert!(
            conversation_matches_request(&existing_conversation, &request),
            "persistent session creation must keep the suffix contract needed to resume the same persistent skill conversation"
        );
    }

    #[test]
    fn workflow_and_refine_requests_share_the_same_persistent_skill_key() {
        let llm = crate::types::WorkflowLlmConfig {
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
        };
        let workflow_request = OpenHandsRuntimeRequest {
            prompt: "workflow".to_string(),
            llm: llm.clone(),
            workspace_root_dir: "/tmp/workspace".to_string(),
            workspace_skill_dir: "/tmp/workspace/default/skills/my-skill".to_string(),
            allowed_tools: vec![],
            max_turns: 50,
            user_message_suffix: None,
            system_message_suffix: None,
            task_kind: Some("workflow.skill_generation".to_string()),
            plugin_slug: "default".to_string(),
            skill_name: Some("my-skill".to_string()),
            step_id: Some(3),
            run_source: Some("workflow".to_string()),
            workflow_session_id: Some("workflow-session".to_string()),
            usage_session_id: None,
        };
        let refine_request = OpenHandsRuntimeRequest {
            prompt: "refine".to_string(),
            llm,
            workspace_root_dir: "/tmp/workspace".to_string(),
            workspace_skill_dir: "/tmp/workspace/default/skills/my-skill".to_string(),
            allowed_tools: vec![],
            max_turns: 50,
            user_message_suffix: None,
            system_message_suffix: None,
            task_kind: Some("refine".to_string()),
            plugin_slug: "default".to_string(),
            skill_name: Some("my-skill".to_string()),
            step_id: Some(-10),
            run_source: Some("refine".to_string()),
            workflow_session_id: None,
            usage_session_id: Some("refine-session".to_string()),
        };

        assert_eq!(workflow_request.plugin_slug, refine_request.plugin_slug);
        assert_eq!(workflow_request.skill_name, refine_request.skill_name);
    }

    #[test]
    fn answer_evaluator_requests_match_existing_skill_creator_conversations() {
        let workflow_config =
            crate::commands::workflow::runtime::build_workflow_generate_skill_sidecar_config(
                "my-skill",
                "Generate the skill",
                "/tmp/workspace",
                "default",
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
                },
                Some("workflow-session".to_string()),
            );
        let answer_evaluator_config =
            crate::commands::workflow::runtime::build_answer_evaluator_sidecar_config(
                "my-skill",
                "Evaluate answers",
                "/tmp/workspace",
                "default",
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
                },
            );

        let workflow_request =
            OpenHandsRuntimeRequest::try_from_sidecar_config(&workflow_config).unwrap();
        let answer_evaluator_request =
            OpenHandsRuntimeRequest::try_from_sidecar_config(&answer_evaluator_config).unwrap();
        let existing_conversation = serde_json::json!({
            "agent": {
                "agent_context": {
                    "system_message_suffix": workflow_request.system_message_suffix,
                    "user_message_suffix": workflow_request.user_message_suffix,
                }
            }
        });

        assert_eq!(
            answer_evaluator_request.plugin_slug,
            workflow_request.plugin_slug
        );
        assert_eq!(
            answer_evaluator_request.skill_name,
            workflow_request.skill_name
        );
        assert_eq!(
            answer_evaluator_request.workspace_skill_dir,
            workflow_request.workspace_skill_dir
        );
        assert!(
            conversation_matches_request(&existing_conversation, &answer_evaluator_request),
            "answer evaluator should be able to resume the existing skill-creator conversation"
        );
    }

    #[test]
    fn terminal_state_error_uses_runtime_fallback_text() {
        let payload = serde_json::json!({
            "agent_id": "agent-1",
            "message": {
                "type": "conversation_state",
                "status": "error"
            }
        })
        .to_string();

        let result =
            parse_openhands_runtime_terminal_state(&payload, "agent-1").expect("terminal state");

        assert_eq!(result, Err("OpenHands runtime run failed".to_string()));
    }

    #[test]
    fn lifecycle_state_error_uses_runtime_fallback_text() {
        let payload = serde_json::json!({
            "agent_id": "agent-1",
            "success": false
        })
        .to_string();

        let result = parse_openhands_lifecycle_state(&payload, "agent-1").expect("lifecycle state");

        assert_eq!(result, Err("OpenHands runtime run failed".to_string()));
    }

    #[test]
    fn live_subagent_scan_emits_child_events_before_parent_observation() {
        let dir = tempdir().expect("tempdir");
        let conversation_id = "3f43be4d-c1c6-4866-a42a-c4d2a1f43040";
        let root = persisted_subagents_root(
            dir.path().to_str().expect("workspace root path"),
            conversation_id,
        );
        let child_events_dir = root.join("child-1").join("events");
        fs::create_dir_all(&child_events_dir).expect("child events dir");

        fs::write(
            child_events_dir.join("event-00001.json"),
            serde_json::json!({
                "id": "child-msg-1",
                "kind": "MessageEvent",
                "source": "user",
                "timestamp": "2026-05-06T23:40:10.000000Z",
                "llm_message": {
                    "content": [{"text": "Verify generated skill package"}]
                }
            })
            .to_string(),
        )
        .expect("write child user message");
        fs::write(
            child_events_dir.join("event-00002.json"),
            serde_json::json!({
                "id": "child-action-1",
                "kind": "ActionEvent",
                "source": "agent",
                "timestamp": "2026-05-06T23:40:11.000000Z",
                "tool_name": "file_editor",
                "tool_call_id": "child-tool-1",
                "action": {
                    "tool_call_id": "child-tool-1",
                    "path": "skill/SKILL.md"
                }
            })
            .to_string(),
        )
        .expect("write child action");

        let launches = HashMap::from([(
            "parent-task-1".to_string(),
            PendingSubagentLaunch {
                tool_call_id: "parent-task-1".to_string(),
                prompt: "Verify generated skill package".to_string(),
                started_at_ms: parse_timestamp_ms("2026-05-06T23:40:00.000000Z").unwrap(),
            },
        )]);
        let mut state = LiveSubagentStreamState::default();

        let emitted = collect_live_child_subagent_events(&root, "agent-1", &launches, &mut state)
            .expect("collect child events");

        assert_eq!(emitted.len(), 2);
        assert!(emitted.iter().all(|event| {
            event
                .get("parent_tool_call_id")
                .and_then(|value| value.as_str())
                == Some("parent-task-1")
        }));
    }

    #[test]
    fn live_subagent_scan_only_emits_new_child_events_incrementally() {
        let dir = tempdir().expect("tempdir");
        let conversation_id = "3f43be4d-c1c6-4866-a42a-c4d2a1f43040";
        let root = persisted_subagents_root(
            dir.path().to_str().expect("workspace root path"),
            conversation_id,
        );
        let child_events_dir = root.join("child-1").join("events");
        fs::create_dir_all(&child_events_dir).expect("child events dir");

        fs::write(
            child_events_dir.join("event-00001.json"),
            serde_json::json!({
                "id": "child-msg-1",
                "kind": "MessageEvent",
                "source": "user",
                "timestamp": "2026-05-06T23:40:10.000000Z",
                "llm_message": {
                    "content": [{"text": "Verify generated skill package"}]
                }
            })
            .to_string(),
        )
        .expect("write child user message");

        let launches = HashMap::from([(
            "parent-task-1".to_string(),
            PendingSubagentLaunch {
                tool_call_id: "parent-task-1".to_string(),
                prompt: "Verify generated skill package".to_string(),
                started_at_ms: parse_timestamp_ms("2026-05-06T23:40:00.000000Z").unwrap(),
            },
        )]);
        let mut state = LiveSubagentStreamState::default();

        let first = collect_live_child_subagent_events(&root, "agent-1", &launches, &mut state)
            .expect("first collect");
        assert_eq!(first.len(), 1);

        let second = collect_live_child_subagent_events(&root, "agent-1", &launches, &mut state)
            .expect("second collect");
        assert!(second.is_empty());

        fs::write(
            child_events_dir.join("event-00002.json"),
            serde_json::json!({
                "id": "child-observation-1",
                "kind": "ObservationEvent",
                "source": "agent",
                "timestamp": "2026-05-06T23:40:12.000000Z",
                "tool_name": "file_editor",
                "tool_call_id": "child-tool-1",
                "observation": "Read SKILL.md"
            })
            .to_string(),
        )
        .expect("write child observation");

        let third = collect_live_child_subagent_events(&root, "agent-1", &launches, &mut state)
            .expect("third collect");
        assert_eq!(third.len(), 1);
        assert_eq!(third[0]["tool_call_id"], "child-tool-1");
        assert_eq!(third[0]["parent_tool_call_id"], "parent-task-1");
    }

    #[test]
    fn live_subagent_scan_ignores_older_child_conversation_for_same_prompt() {
        let dir = tempdir().expect("tempdir");
        let conversation_id = "3f43be4d-c1c6-4866-a42a-c4d2a1f43040";
        let root = persisted_subagents_root(
            dir.path().to_str().expect("workspace root path"),
            conversation_id,
        );

        for (child, timestamp, tool_call) in [
            ("child-old", "2026-05-06T23:39:00.000000Z", "child-tool-old"),
            ("child-new", "2026-05-06T23:40:10.000000Z", "child-tool-new"),
        ] {
            let child_events_dir = root.join(child).join("events");
            fs::create_dir_all(&child_events_dir).expect("child events dir");
            fs::write(
                child_events_dir.join("event-00001.json"),
                serde_json::json!({
                    "id": format!("{child}-msg-1"),
                    "kind": "MessageEvent",
                    "source": "user",
                    "timestamp": timestamp,
                    "llm_message": {
                        "content": [{"text": "Verify generated skill package"}]
                    }
                })
                .to_string(),
            )
            .expect("write child user message");
            fs::write(
                child_events_dir.join("event-00002.json"),
                serde_json::json!({
                    "id": format!("{child}-action-1"),
                    "kind": "ActionEvent",
                    "source": "agent",
                    "timestamp": timestamp,
                    "tool_name": "file_editor",
                    "tool_call_id": tool_call,
                    "action": {
                        "tool_call_id": tool_call,
                        "path": "skill/SKILL.md"
                    }
                })
                .to_string(),
            )
            .expect("write child action");
        }

        let launches = HashMap::from([(
            "parent-task-1".to_string(),
            PendingSubagentLaunch {
                tool_call_id: "parent-task-1".to_string(),
                prompt: "Verify generated skill package".to_string(),
                started_at_ms: parse_timestamp_ms("2026-05-06T23:40:00.000000Z").unwrap(),
            },
        )]);
        let mut state = LiveSubagentStreamState::default();

        let emitted = collect_live_child_subagent_events(&root, "agent-1", &launches, &mut state)
            .expect("collect child events");

        assert_eq!(emitted.len(), 2);
        assert!(emitted
            .iter()
            .all(|event| event["tool_call_id"] != "child-tool-old"));
        assert!(emitted
            .iter()
            .any(|event| event["tool_call_id"] == "child-tool-new"));
    }

    #[test]
    fn live_subagent_scan_matches_children_with_timezone_less_timestamps() {
        let dir = tempdir().expect("tempdir");
        let conversation_id = "3f43be4d-c1c6-4866-a42a-c4d2a1f43040";
        let root = persisted_subagents_root(
            dir.path().to_str().expect("workspace root path"),
            conversation_id,
        );
        let child_events_dir = root.join("child-1").join("events");
        fs::create_dir_all(&child_events_dir).expect("child events dir");

        fs::write(
            child_events_dir.join("event-00000.json"),
            serde_json::json!({
                "id": "child-system-1",
                "kind": "SystemPromptEvent",
                "source": "agent",
                "timestamp": "2026-05-07T15:06:51.329624"
            })
            .to_string(),
        )
        .expect("write child system prompt");
        fs::write(
            child_events_dir.join("event-00001.json"),
            serde_json::json!({
                "id": "child-msg-1",
                "kind": "MessageEvent",
                "source": "user",
                "timestamp": "2026-05-07T15:06:51.330719",
                "llm_message": {
                    "content": [{"text": "Search through the conversations to find Q3"}]
                }
            })
            .to_string(),
        )
        .expect("write child user message");
        fs::write(
            child_events_dir.join("event-00002.json"),
            serde_json::json!({
                "id": "child-finish-1",
                "kind": "ObservationEvent",
                "source": "environment",
                "timestamp": "2026-05-07T15:10:25.000000",
                "tool_name": "finish",
                "tool_call_id": "child-finish-tool",
                "observation": {
                    "content": [{"text": "Q3 details found"}],
                    "kind": "FinishObservation"
                }
            })
            .to_string(),
        )
        .expect("write child finish observation");

        let launches = HashMap::from([(
            "parent-task-1".to_string(),
            PendingSubagentLaunch {
                tool_call_id: "parent-task-1".to_string(),
                prompt: "Search through the conversations to find Q3".to_string(),
                started_at_ms: parse_timestamp_ms("2026-05-07T15:06:50.604092").unwrap_or_default(),
            },
        )]);
        let mut state = LiveSubagentStreamState::default();

        let emitted = collect_live_child_subagent_events(&root, "agent-1", &launches, &mut state)
            .expect("collect child events");

        assert_eq!(emitted.len(), 3);
        assert!(emitted.iter().all(|event| {
            event
                .get("parent_tool_call_id")
                .and_then(|value| value.as_str())
                == Some("parent-task-1")
        }));
    }

    #[test]
    fn restore_subagent_scan_returns_linked_child_events() {
        let dir = tempdir().expect("tempdir");
        let workspace_path = dir.path().to_str().expect("workspace root path");
        let conversation_id = "3f43be4d-c1c6-4866-a42a-c4d2a1f43040";
        let root = persisted_subagents_root(workspace_path, conversation_id);
        let child_events_dir = root.join("child-1").join("events");
        fs::create_dir_all(&child_events_dir).expect("child events dir");

        fs::write(
            child_events_dir.join("event-00001.json"),
            serde_json::json!({
                "id": "child-msg-1",
                "kind": "MessageEvent",
                "source": "user",
                "timestamp": "2026-05-07T15:06:51.330719",
                "llm_message": {
                    "content": [{"text": "Search through the conversations to find Q3"}]
                }
            })
            .to_string(),
        )
        .expect("write child user message");
        fs::write(
            child_events_dir.join("event-00002.json"),
            serde_json::json!({
                "id": "child-action-1",
                "kind": "ActionEvent",
                "source": "agent",
                "timestamp": "2026-05-07T15:06:52.000000",
                "tool_name": "terminal",
                "tool_call_id": "child-tool-1",
                "action": {
                    "tool_call_id": "child-tool-1",
                    "command": "rg Q3 conversations"
                }
            })
            .to_string(),
        )
        .expect("write child action");

        let parent_events = vec![serde_json::json!({
            "id": "parent-action-1",
            "kind": "ActionEvent",
            "source": "agent",
            "timestamp": "2026-05-07T15:06:50.604092",
            "tool_name": "task",
            "tool_call_id": "parent-task-1",
            "action": {
                "prompt": "Search through the conversations to find Q3"
            }
        })];

        let restored = load_linked_persisted_subagent_conversation_events(
            workspace_path,
            conversation_id,
            &parent_events,
        )
        .expect("load linked child events");

        assert_eq!(restored.len(), 2);
        assert_eq!(restored[0]["event_class"], "MessageEvent");
        assert_eq!(restored[1]["event_class"], "ActionEvent");
        assert!(restored.iter().all(|event| {
            event
                .get("parent_tool_call_id")
                .and_then(|value| value.as_str())
                == Some("parent-task-1")
        }));
    }

    #[test]
    fn persisted_subagents_root_uses_compact_conversation_directory_name() {
        let root = persisted_subagents_root(
            "/tmp/workspace/default/skills/my-skill",
            "3f43be4d-c1c6-4866-a42a-c4d2a1f43040",
        );

        assert_eq!(
            root,
            Path::new("/tmp/workspace/default/skills/my-skill")
                .join("conversations")
                .join("3f43be4dc1c64866a42ac4d2a1f43040")
                .join("subagents")
        );
    }

    #[test]
    fn pause_registry_signals_once_and_stays_registered_until_unregistered() {
        let agent_id = format!("test-agent-{}", uuid::Uuid::new_v4());
        let (cancel_tx, mut cancel_rx) = tokio::sync::oneshot::channel::<()>();

        register_cancel(&agent_id, cancel_tx).unwrap();

        assert!(pause_openhands_session(&agent_id));
        assert!(cancel_rx.try_recv().is_ok());
        assert!(pause_openhands_session(&agent_id));

        unregister_cancel(&agent_id);
        assert!(!pause_openhands_session(&agent_id));
    }

    #[tokio::test]
    async fn terminate_openhands_session_forces_registry_cleanup_after_timeout() {
        let agent_id = format!("test-agent-{}", uuid::Uuid::new_v4());
        let (cancel_tx, mut cancel_rx) = tokio::sync::oneshot::channel::<()>();
        register_cancel(&agent_id, cancel_tx).unwrap();

        let handle = tokio::spawn(async move {
            let _ = tokio::time::sleep(Duration::from_secs(30)).await;
        });
        register_task_handle(&agent_id, &handle);

        assert!(
            terminate_openhands_session(&agent_id, Duration::from_millis(10)).await,
            "terminate should report that a live session was present"
        );
        assert!(cancel_rx.try_recv().is_ok(), "cancel signal should be sent");
        assert!(
            !cancel_registry().contains_key(&agent_id),
            "cancel registry entry should be removed"
        );
        assert!(
            !task_registry().contains_key(&agent_id),
            "task registry entry should be removed"
        );
    }

    #[test]
    fn resolve_saved_conversation_outcome_reuses_matching_saved_conversation() {
        let outcome = resolve_saved_conversation_outcome(
            Some("conversation-1"),
            OpenHandsConversationSelection::ResumeOrCreate,
            Some(SavedConversationStatus::Compatible),
        );

        assert_eq!(
            outcome,
            OpenHandsConversationResolution::Reuse {
                conversation_id: "conversation-1".to_string(),
            }
        );
    }

    #[test]
    fn resolve_saved_conversation_outcome_creates_when_saved_conversation_mismatches() {
        let outcome = resolve_saved_conversation_outcome(
            Some("conversation-1"),
            OpenHandsConversationSelection::ResumeOrCreate,
            Some(SavedConversationStatus::Incompatible),
        );

        assert_eq!(
            outcome,
            OpenHandsConversationResolution::Create {
                reason: OpenHandsSessionCreateReason::Mismatch
            }
        );
    }

    #[test]
    fn resolve_saved_conversation_outcome_creates_when_saved_conversation_is_missing() {
        let outcome = resolve_saved_conversation_outcome(
            Some("conversation-1"),
            OpenHandsConversationSelection::ResumeOrCreate,
            Some(SavedConversationStatus::Missing),
        );

        assert_eq!(
            outcome,
            OpenHandsConversationResolution::Create {
                reason: OpenHandsSessionCreateReason::NotFound
            }
        );
    }

    #[test]
    fn resolve_saved_conversation_outcome_creates_when_no_saved_conversation_exists() {
        let outcome = resolve_saved_conversation_outcome(
            None,
            OpenHandsConversationSelection::ResumeOrCreate,
            None,
        );

        assert_eq!(
            outcome,
            OpenHandsConversationResolution::Create {
                reason: OpenHandsSessionCreateReason::New
            }
        );
    }

    #[test]
    fn resolve_saved_conversation_outcome_always_creates_fresh_for_throwaway_runs() {
        let outcome = resolve_saved_conversation_outcome(
            Some("conversation-1"),
            OpenHandsConversationSelection::CreateFresh,
            Some(SavedConversationStatus::Compatible),
        );

        assert_eq!(
            outcome,
            OpenHandsConversationResolution::Create {
                reason: OpenHandsSessionCreateReason::New
            }
        );
    }

    #[test]
    fn resolve_saved_conversation_outcome_errors_when_send_requires_existing_conversation() {
        let outcome = resolve_saved_conversation_outcome(
            None,
            OpenHandsConversationSelection::SendExistingOnly,
            None,
        );

        assert_eq!(
            outcome,
            OpenHandsConversationResolution::Error(
                OpenHandsRuntimeError::MissingExistingConversation
            )
        );
    }

    #[test]
    fn resolve_saved_conversation_outcome_errors_when_send_existing_conversation_mismatches() {
        let outcome = resolve_saved_conversation_outcome(
            Some("conversation-1"),
            OpenHandsConversationSelection::SendExistingOnly,
            Some(SavedConversationStatus::Incompatible),
        );

        assert_eq!(
            outcome,
            OpenHandsConversationResolution::Error(OpenHandsRuntimeError::ConversationMismatch {
                id: "conversation-1".to_string()
            })
        );
    }

    #[test]
    fn send_existing_turn_uses_full_history_only_for_blank_prompt_and_delta_for_non_empty() {
        assert_eq!(
            determine_event_recovery_mode(OpenHandsConversationSelection::SendExistingOnly, ""),
            EventRecoveryMode::FullHistory
        );
        assert_eq!(
            determine_event_recovery_mode(OpenHandsConversationSelection::SendExistingOnly, "   "),
            EventRecoveryMode::FullHistory
        );
        assert_eq!(
            determine_event_recovery_mode(OpenHandsConversationSelection::ResumeOrCreate, ""),
            EventRecoveryMode::None
        );
        assert_eq!(
            determine_event_recovery_mode(
                OpenHandsConversationSelection::SendExistingOnly,
                "Refine this skill"
            ),
            EventRecoveryMode::Delta
        );
    }

    #[test]
    fn throwaway_runs_do_not_request_history_recovery() {
        assert_eq!(
            determine_event_recovery_mode(
                OpenHandsConversationSelection::CreateFresh,
                "Suggest a scenario"
            ),
            EventRecoveryMode::None
        );
    }
}
