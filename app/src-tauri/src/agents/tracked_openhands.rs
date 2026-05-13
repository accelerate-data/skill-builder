use std::time::{Duration, Instant};

use tauri::Listener;

use crate::agents::openhands_server::{
    self, OpenHandsConversationSelection, OpenHandsRuntimeEvent, OpenHandsThrowawayRun,
    PromptDelivery,
};
use crate::agents::runtime_config::OpenHandsRuntimeConfig;

pub struct OpenHandsThrowawayRunParams {
    pub agent_id: String,
    pub config: OpenHandsRuntimeConfig,
    pub timeout: Duration,
}

pub async fn send_tracked_openhands_message(
    app: &tauri::AppHandle,
    agent_id: &str,
    config: OpenHandsRuntimeConfig,
    conversation_id: String,
) -> Result<String, String> {
    let request = openhands_server::OpenHandsRuntimeRequest::try_from_runtime_config(&config)?;
    openhands_server::dispatch_openhands_turn_with_request(
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

pub fn abort_tracked_openhands_run(agent_id: &str) -> bool {
    openhands_server::close_local_openhands_run(agent_id)
}

pub async fn pause_tracked_openhands_conversation(
    config: OpenHandsRuntimeConfig,
    conversation_id: &str,
    agent_id: Option<&str>,
) -> Result<bool, String> {
    openhands_server::pause_openhands_conversation(config, conversation_id).await?;
    Ok(agent_id
        .map(openhands_server::send_cancel_signal)
        .unwrap_or(false))
}

pub async fn terminate_tracked_openhands_session(agent_id: &str, timeout: Duration) -> bool {
    let mut found = openhands_server::send_cancel_signal(agent_id);

    if openhands_server::has_registered_local_run(agent_id) {
        found = true;
    }

    let deadline = Instant::now() + timeout;
    loop {
        if !openhands_server::has_registered_local_run(agent_id) {
            return found;
        }

        if Instant::now() >= deadline {
            let stopped = openhands_server::close_local_openhands_run(agent_id);
            return found || stopped;
        }

        tokio::time::sleep(Duration::from_millis(25)).await;
    }
}

pub async fn run_tracked_throwaway_openhands_session(
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
        if let Some(result) = openhands_server::parse_openhands_runtime_terminal_state(
            event.payload(),
            target_agent_id.as_str(),
        ) {
            let _ = tx_message.send(OpenHandsRuntimeEvent::TerminalState(result));
        }
    });

    let target_agent_id = agent_id.clone();
    let tx_exit = tx.clone();
    let exit_listener = app.listen("agent-exit", move |event| {
        if let Some(result) =
            openhands_server::parse_openhands_lifecycle_state(event.payload(), &target_agent_id)
        {
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

    let request = openhands_server::OpenHandsRuntimeRequest::try_from_runtime_config(&config)?;
    openhands_server::dispatch_openhands_turn_with_request(
        app,
        &agent_id,
        config,
        request,
        None,
        OpenHandsConversationSelection::CreateFresh,
        PromptDelivery::ViaSendEvent,
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
            if !openhands_server::close_local_openhands_run(&agent_id) {
                log::warn!(
                    "[openhands-agent-server] throwaway_run_timeout agent_id={} cleanup=not-found",
                    agent_id
                );
            }
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
