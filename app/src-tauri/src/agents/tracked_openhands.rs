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
    // If a live local runner already owns this conversation, only send the message.
    if openhands_server::has_live_runner_for_conversation(&conversation_id) {
        openhands_server::send_message_to_openhands_conversation(
            config,
            &conversation_id,
            "",
        )
        .await?;
        return Ok(conversation_id);
    }

    // Conversation is idle: send the message and start a new run.
    openhands_server::send_message_to_openhands_conversation(
        config.clone(),
        &conversation_id,
        "",
    )
    .await?;
    openhands_server::run_openhands_conversation(
        app,
        agent_id,
        config,
        conversation_id.clone(),
    )
    .await?;
    Ok(conversation_id)
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

pub async fn send_tracked_throwaway(
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
