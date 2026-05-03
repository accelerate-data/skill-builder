pub mod client;
pub mod events;
pub mod process;
pub mod types;

use std::path::PathBuf;
use std::time::{Duration, Instant};

use futures::{SinkExt, StreamExt};
use tauri::Listener;
use tokio_tungstenite::tungstenite::Message;

pub use types::{OpenHandsOneShotRequest, StartConversationRequest};

use self::client::OpenHandsServerClient;
use self::events::normalize_server_event;
use self::process::ensure_agent_server;
use crate::agents::sidecar::SidecarConfig;

pub struct OpenHandsOneShotRunParams {
    pub agent_id_prefix: String,
    pub config: SidecarConfig,
    pub timeout: Duration,
}

#[allow(dead_code)]
pub struct OpenHandsOneShotRun {
    pub transcript_dir: PathBuf,
    pub conversation_state: serde_json::Value,
}

enum OpenHandsOneShotEvent {
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
    fn new(request: &OpenHandsOneShotRequest, conversation_id: &str) -> Self {
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
    websocket_url: String,
    session_api_key: String,
    summary_context: OpenHandsRunSummaryContext,
}

pub async fn dispatch_openhands_one_shot(
    app: &tauri::AppHandle,
    agent_id: &str,
    config: SidecarConfig,
    transcript_log_dir: Option<&str>,
) -> Result<PathBuf, String> {
    let persistence_path = create_openhands_persistence_dir(agent_id, &config, transcript_log_dir)?;
    let request = OpenHandsOneShotRequest::try_from_sidecar_config(&config)?;
    let start_request = StartConversationRequest::from_one_shot(&request);

    let server = ensure_agent_server(Duration::from_secs(60)).await?;
    let client = OpenHandsServerClient::new(
        server
            .base_url()
            .parse()
            .map_err(|e| format!("Invalid OpenHands Agent Server base URL: {e}"))?,
        Some(server.session_api_key.clone()),
    );

    let config_event = redact_openhands_config_for_log(&config, server.port);
    super::events::handle_sidecar_message(app, agent_id, &config_event.to_string());

    let conversation = client
        .create_conversation(&start_request)
        .await
        .map_err(|e| format!("Failed to create OpenHands Agent Server conversation: {e}"))?;
    let conversation_id = extract_conversation_id(&conversation)?;
    let summary_context = OpenHandsRunSummaryContext::new(&request, &conversation_id);
    let websocket_url = server.websocket_url(&conversation_id);

    let (cancel_tx, cancel_rx) = tokio::sync::oneshot::channel::<()>();
    register_cancel(agent_id, cancel_tx)?;

    let app_for_task = app.clone();
    let agent_for_task = agent_id.to_string();
    let session_api_key = server.session_api_key.clone();
    tokio::spawn(async move {
        let task = OpenHandsConversationTask {
            app: app_for_task.clone(),
            agent_id: agent_for_task.clone(),
            client,
            conversation_id,
            websocket_url,
            session_api_key,
            summary_context,
        };
        let result = run_conversation_task(task, cancel_rx).await;
        unregister_cancel(&agent_for_task);
        match result {
            Ok(()) => {}
            Err(error) => {
                super::events::handle_sidecar_exit_with_detail(
                    &app_for_task,
                    &agent_for_task,
                    false,
                    Some(error),
                );
            }
        }
    });

    Ok(persistence_path)
}

pub async fn run_openhands_one_shot(
    app: &tauri::AppHandle,
    params: OpenHandsOneShotRunParams,
) -> Result<OpenHandsOneShotRun, String> {
    let config = params.config;
    let agent_id = format!("{}-{}", params.agent_id_prefix, uuid::Uuid::new_v4());
    let log_dir = PathBuf::from(&config.workspace_skill_dir).join("logs");
    let log_dir_str = log_dir.to_string_lossy().into_owned();

    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<OpenHandsOneShotEvent>();
    let target_agent_id = agent_id.clone();
    let tx_message = tx.clone();
    let message_listener = app.listen("agent-message", move |event| {
        if let Some(result) =
            parse_openhands_one_shot_terminal_state(event.payload(), target_agent_id.as_str())
        {
            let _ = tx_message.send(OpenHandsOneShotEvent::TerminalState(result));
        }
    });

    let target_agent_id = agent_id.clone();
    let tx_exit = tx.clone();
    let exit_listener = app.listen("agent-exit", move |event| {
        if let Some(result) = parse_openhands_lifecycle_state(event.payload(), &target_agent_id) {
            let _ = tx_exit.send(OpenHandsOneShotEvent::Lifecycle(result));
        }
    });
    let target_agent_id = agent_id.clone();
    let tx_shutdown = tx.clone();
    let shutdown_listener = app.listen("agent-shutdown", move |event| {
        if event.payload().contains(target_agent_id.as_str()) {
            let _ = tx_shutdown.send(OpenHandsOneShotEvent::Lifecycle(Err(
                "OpenHands one-shot run cancelled".to_string(),
            )));
        }
    });

    let persistence_dir = dispatch_openhands_one_shot(app, &agent_id, config, Some(&log_dir_str))
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
                Some(OpenHandsOneShotEvent::TerminalState(result)) => {
                    terminal_state.get_or_insert(result);
                }
                Some(OpenHandsOneShotEvent::Lifecycle(result)) => {
                    result?;
                    lifecycle_result.get_or_insert(Ok(()));
                }
                None => {
                    return Err("OpenHands one-shot listener closed unexpectedly".to_string());
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
            let _ = cancel_openhands_one_shot(&agent_id);
            return Err("OpenHands one-shot run timed out".to_string());
        }
    };

    let conversation_state = terminal_state.unwrap_or_else(|| {
        Err("OpenHands one-shot run completed without conversation_state".into())
    })?;
    lifecycle_result.unwrap_or_else(|| {
        Err("OpenHands one-shot lifecycle listener closed unexpectedly".to_string())
    })?;

    Ok(OpenHandsOneShotRun {
        transcript_dir: persistence_dir,
        conversation_state,
    })
}

pub fn cancel_openhands_one_shot(agent_id: &str) -> bool {
    let Ok(mut registry) = cancel_registry().lock() else {
        log::warn!(
            "[openhands-agent-server:{}] failed to lock cancellation registry",
            agent_id
        );
        return false;
    };
    registry
        .remove(agent_id)
        .map(|cancel| cancel.send(()).is_ok())
        .unwrap_or(false)
}

async fn run_conversation_task(
    task: OpenHandsConversationTask,
    mut cancel_rx: tokio::sync::oneshot::Receiver<()>,
) -> Result<(), String> {
    let result = run_conversation_task_inner(&task, &mut cancel_rx).await;

    if result.is_err() {
        let _ = task.client.pause_conversation(&task.conversation_id).await;
    }
    let delete_result = task.client.delete_conversation(&task.conversation_id).await;
    match (result, delete_result) {
        (Ok(()), Ok(())) => Ok(()),
        (Ok(()), Err(e)) => {
            log::warn!(
                "[openhands-agent-server:{}] failed to delete completed conversation {}: {}",
                task.agent_id,
                task.conversation_id,
                e
            );
            Ok(())
        }
        (Err(error), Ok(())) => Err(error),
        (Err(error), Err(delete_error)) => Err(format!(
            "{error}; additionally failed to delete OpenHands Agent Server conversation: {delete_error}"
        )),
    }
}

/// Refine variant of `run_conversation_task` — identical except it does NOT
/// delete the conversation when the run finishes. The conversation stays alive
/// for the next turn.
async fn run_refine_conversation_task(
    task: OpenHandsConversationTask,
    mut cancel_rx: tokio::sync::oneshot::Receiver<()>,
) -> Result<(), String> {
    let result = run_conversation_task_inner(&task, &mut cancel_rx).await;
    if result.is_err() {
        let _ = task.client.pause_conversation(&task.conversation_id).await;
    }
    result
}

/// Dispatch a refine turn against the OpenHands Agent Server.
///
/// On turn 1 (`conversation_id` is `None`) creates a new conversation seeded
/// with `config.prompt` as the initial message. On turn N (`conversation_id`
/// is `Some`) sends `config.prompt` as a follow-up `SendMessageRequest` event
/// and re-runs the existing conversation. Returns the conversation_id that
/// the caller must persist for subsequent turns.
///
/// The conversation is NOT deleted when the run completes. The caller owns
/// deletion via `close_openhands_refine_session`.
pub async fn dispatch_openhands_refine_turn(
    app: &tauri::AppHandle,
    agent_id: &str,
    config: SidecarConfig,
    conversation_id: Option<String>,
    transcript_log_dir: Option<&str>,
) -> Result<String, String> {
    let _persistence_path =
        create_openhands_persistence_dir(agent_id, &config, transcript_log_dir)?;
    let request = OpenHandsOneShotRequest::try_from_sidecar_config(&config)?;

    let server = ensure_agent_server(Duration::from_secs(60)).await?;
    let client = OpenHandsServerClient::new(
        server
            .base_url()
            .parse()
            .map_err(|e| format!("Invalid OpenHands Agent Server base URL: {e}"))?,
        Some(server.session_api_key.clone()),
    );

    let config_event = redact_openhands_config_for_log(&config, server.port);
    super::events::handle_sidecar_message(app, agent_id, &config_event.to_string());

    let conversation_id = match conversation_id {
        Some(existing) => {
            let event = serde_json::to_value(types::SendMessageRequest {
                role: "user".to_string(),
                content: vec![types::TextContent {
                    content_type: "text".to_string(),
                    text: request.prompt.clone(),
                }],
                run: false,
            })
            .map_err(|e| format!("Failed to serialize refine event: {e}"))?;
            client
                .send_event(&existing, event)
                .await
                .map_err(|e| format!("Failed to send refine event to OpenHands conversation: {e}"))?;
            existing
        }
        None => {
            let start_request = StartConversationRequest::from_one_shot(&request);
            let conversation = client
                .create_conversation(&start_request)
                .await
                .map_err(|e| format!("Failed to create OpenHands refine conversation: {e}"))?;
            extract_conversation_id(&conversation)?
        }
    };

    let summary_context = OpenHandsRunSummaryContext::new(&request, &conversation_id);
    let websocket_url = server.websocket_url(&conversation_id);

    let (cancel_tx, cancel_rx) = tokio::sync::oneshot::channel::<()>();
    register_cancel(agent_id, cancel_tx)?;

    let app_for_task = app.clone();
    let agent_for_task = agent_id.to_string();
    let conversation_id_clone = conversation_id.clone();
    let session_api_key = server.session_api_key.clone();
    tokio::spawn(async move {
        let task = OpenHandsConversationTask {
            app: app_for_task.clone(),
            agent_id: agent_for_task.clone(),
            client,
            conversation_id: conversation_id_clone,
            websocket_url,
            session_api_key,
            summary_context,
        };
        let result = run_refine_conversation_task(task, cancel_rx).await;
        unregister_cancel(&agent_for_task);
        if let Err(error) = result {
            super::events::handle_sidecar_exit_with_detail(
                &app_for_task,
                &agent_for_task,
                false,
                Some(error),
            );
        }
    });

    Ok(conversation_id)
}

/// Best-effort delete of an OpenHands refine conversation.
///
/// Errors are logged and swallowed — the server will eventually GC abandoned
/// conversations, so a transient failure here is not fatal.
pub async fn close_openhands_refine_session(conversation_id: &str) -> Result<(), String> {
    let server = ensure_agent_server(Duration::from_secs(60))
        .await
        .map_err(|e| format!("OpenHands Agent Server not available: {e}"))?;
    let client = OpenHandsServerClient::new(
        server
            .base_url()
            .parse()
            .map_err(|e| format!("Invalid OpenHands Agent Server base URL: {e}"))?,
        Some(server.session_api_key.clone()),
    );
    if let Err(e) = client.delete_conversation(conversation_id).await {
        log::warn!(
            "[close_openhands_refine_session] failed to delete conversation {}: {}",
            conversation_id,
            e
        );
    }
    Ok(())
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

    task.client
        .run_conversation(&task.conversation_id)
        .await
        .map_err(|e| format!("Failed to run OpenHands Agent Server conversation: {e}"))?;

    let mut terminal_state: Option<serde_json::Value> = None;
    let mut cancel_pending = false;
    loop {
        tokio::select! {
            _ = &mut *cancel_rx, if !cancel_pending => {
                task.client
                    .pause_conversation(&task.conversation_id)
                    .await
                    .map_err(|e| format!("Failed to pause OpenHands Agent Server conversation: {e}"))?;
                // Continue reading the WebSocket — the server will stream back a PauseEvent
                // which normalize_server_event maps to conversation_state(status="cancelled").
                cancel_pending = true;
            }
            message = ws_read.next() => {
                let Some(message) = message else {
                    break;
                };
                let message = message.map_err(|e| {
                    format!("OpenHands Agent Server socket read failed: {e}")
                })?;
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

    let terminal_state = match terminal_state {
        Some(state) if terminal_state_needs_final_response(&state) => {
            fetch_final_response_state(
                &task.client,
                &task.agent_id,
                &task.conversation_id,
                Some(state),
            )
            .await?
        }
        Some(state) => state,
        None => build_socket_closed_state(&task.agent_id, &task.conversation_id),
    };

    let terminal_error = if terminal_state
        .get("status")
        .and_then(|value| value.as_str())
        != Some("completed")
    {
        terminal_state
            .get("error_detail")
            .and_then(|value| value.as_str())
            .map(str::to_string)
            .or_else(|| Some("OpenHands one-shot run failed".to_string()))
    } else {
        None
    };
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

fn build_socket_closed_state(agent_id: &str, conversation_id: &str) -> serde_json::Value {
    serde_json::json!({
        "type": "conversation_state",
        "runtime": "openhands",
        "agent_id": agent_id,
        "conversation_id": conversation_id,
        "status": "error",
        "timestamp": chrono::Utc::now().timestamp_millis(),
        "error_detail": "OpenHands Agent Server socket closed before terminal conversation_state",
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

fn create_openhands_persistence_dir(
    agent_id: &str,
    config: &SidecarConfig,
    transcript_log_dir: Option<&str>,
) -> Result<PathBuf, String> {
    let now = chrono::Local::now();
    let ts = now.format("%Y-%m-%dT%H-%M-%S").to_string();
    let log_dir = transcript_log_dir
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(&config.workspace_skill_dir).join("logs"));
    let persistence_dir = log_dir.join(format!("{}-{}", agent_id, ts));
    std::fs::create_dir_all(&persistence_dir).map_err(|e| {
        format!(
            "Failed to create OpenHands Agent Server persistence dir {} for {}: {}",
            persistence_dir.display(),
            agent_id,
            e
        )
    })?;
    Ok(persistence_dir)
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

fn parse_openhands_one_shot_terminal_state(
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
            "OpenHands one-shot run failed",
        ))),
        "cancelled" | "canceled" => Some(Err(openhands_conversation_state_error_detail(
            message,
            "OpenHands one-shot run cancelled",
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
            .unwrap_or("OpenHands one-shot run failed")
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

type OpenHandsCancelRegistry =
    std::sync::Mutex<std::collections::HashMap<String, tokio::sync::oneshot::Sender<()>>>;

fn cancel_registry() -> &'static OpenHandsCancelRegistry {
    static REGISTRY: std::sync::OnceLock<OpenHandsCancelRegistry> = std::sync::OnceLock::new();
    REGISTRY.get_or_init(|| std::sync::Mutex::new(std::collections::HashMap::new()))
}

fn register_cancel(agent_id: &str, cancel: tokio::sync::oneshot::Sender<()>) -> Result<(), String> {
    let mut registry = cancel_registry()
        .lock()
        .map_err(|e| format!("Failed to lock OpenHands cancellation registry: {e}"))?;
    registry.insert(agent_id.to_string(), cancel);
    Ok(())
}

fn unregister_cancel(agent_id: &str) {
    if let Ok(mut registry) = cancel_registry().lock() {
        registry.remove(agent_id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
    fn socket_close_without_terminal_state_is_error_state() {
        let state = build_socket_closed_state("agent-1", "conversation-1");

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
    fn cancellation_registry_signals_and_clears_active_agent() {
        let agent_id = format!("test-agent-{}", uuid::Uuid::new_v4());
        let (cancel_tx, mut cancel_rx) = tokio::sync::oneshot::channel::<()>();

        register_cancel(&agent_id, cancel_tx).unwrap();

        assert!(cancel_openhands_one_shot(&agent_id));
        assert!(cancel_rx.try_recv().is_ok());
        assert!(!cancel_openhands_one_shot(&agent_id));
    }
}
