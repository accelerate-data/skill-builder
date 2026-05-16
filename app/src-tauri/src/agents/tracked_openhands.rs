use std::time::{Duration, Instant};

use tauri::Listener;

use crate::agents::openhands_server::{
    self, OpenHandsRuntimeEvent, OpenHandsThrowawayRun,
};
use crate::agents::runtime_config::OpenHandsRuntimeConfig;

pub struct OpenHandsThrowawayRunParams {
    pub agent_id: String,
    pub config: OpenHandsRuntimeConfig,
    pub timeout: Duration,
}

async fn send_tracked_openhands_message_with<
    HasLiveRunner,
    SendMessage,
    SendFuture,
    RunConversation,
    RunFuture,
>(
    config: OpenHandsRuntimeConfig,
    conversation_id: String,
    has_live_runner: HasLiveRunner,
    send_message: SendMessage,
    run_conversation: RunConversation,
) -> Result<String, String>
where
    HasLiveRunner: Fn(&str) -> bool,
    SendMessage: Fn(OpenHandsRuntimeConfig, String, String) -> SendFuture,
    SendFuture: std::future::Future<Output = Result<(), String>>,
    RunConversation:
        Fn(OpenHandsRuntimeConfig, String, openhands_server::PromptDelivery) -> RunFuture,
    RunFuture: std::future::Future<Output = Result<String, String>>,
{
    let prompt = config.prompt.clone();

    if has_live_runner(&conversation_id) {
        send_message(config, conversation_id.clone(), prompt).await?;
        return Ok(conversation_id);
    }

    run_conversation(
        config,
        conversation_id.clone(),
        openhands_server::PromptDelivery::ViaSendEvent,
    )
    .await?;
    Ok(conversation_id)
}

pub async fn send_tracked_openhands_message(
    app: &tauri::AppHandle,
    agent_id: &str,
    config: OpenHandsRuntimeConfig,
    conversation_id: String,
) -> Result<String, String> {
    let app = app.clone();
    let agent_id = agent_id.to_string();
    send_tracked_openhands_message_with(
        config,
        conversation_id,
        openhands_server::has_live_runner_for_conversation,
        |config, conversation_id, prompt| async move {
            openhands_server::send_message_to_openhands_conversation(
                config,
                &conversation_id,
                &prompt,
            )
            .await
        },
        move |config, conversation_id, prompt_delivery| {
            let app = app.clone();
            let agent_id = agent_id.clone();
            async move {
                openhands_server::run_openhands_conversation(
                    &app,
                    &agent_id,
                    config,
                    conversation_id,
                    prompt_delivery,
                )
                .await
            }
        },
    )
    .await
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

    let conversation_id = openhands_server::create_openhands_conversation(app, &config).await?;

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

    openhands_server::run_openhands_conversation(
        app,
        &agent_id,
        config.clone(),
        conversation_id,
        openhands_server::PromptDelivery::ViaSendEvent,
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::SecretString;
    use std::sync::{Arc, Mutex};

    fn test_runtime_config(prompt: &str) -> OpenHandsRuntimeConfig {
        OpenHandsRuntimeConfig {
            mode: None,
            prompt: prompt.to_string(),
            system_prompt: None,
            model: None,
            llm: None,
            model_base_url: None,
            openhands_api_key: SecretString::new("test-key".to_string()),
            app_data_root: "/tmp/app-data".to_string(),
            skills_root: "/tmp/skills".to_string(),
            skill_dir: "/tmp/skills/default/skills/test-skill".to_string(),
            allowed_tools: None,
            max_turns: None,
            permission_mode: None,
            betas: None,
            thinking: None,
            output_format: None,
            prompt_suggestions: None,
            agent_name: Some("skill-creator".to_string()),
            required_plugins: None,
            setting_sources: None,
            conversation_history: None,
            skill_name: Some("test-skill".to_string()),
            step_id: Some(0),
            usage_session_id: None,
            run_source: Some("workflow".to_string()),
            persistence_dir: None,
            plugin_slug: crate::skill_paths::DEFAULT_PLUGIN_SLUG.to_string(),
            task_kind: Some("workflow.research".to_string()),
            user_message_suffix: None,
            system_message_suffix: None,
        }
    }

    #[tokio::test]
    async fn send_tracked_openhands_message_reuses_live_runner_with_send_only() {
        let events = Arc::new(Mutex::new(Vec::<String>::new()));
        let send_events = Arc::clone(&events);
        let run_events = Arc::clone(&events);

        let conversation_id = send_tracked_openhands_message_with(
            test_runtime_config("write the skill"),
            "conversation-123".to_string(),
            |_| true,
            move |_config, conversation_id, prompt| {
                let send_events = Arc::clone(&send_events);
                async move {
                    send_events
                        .lock()
                        .unwrap()
                        .push(format!("send:{conversation_id}:{prompt}"));
                    Ok(())
                }
            },
            move |_config, conversation_id, prompt_delivery| {
                let run_events = Arc::clone(&run_events);
                async move {
                    run_events
                        .lock()
                        .unwrap()
                        .push(format!("run:{prompt_delivery:?}:{conversation_id}"));
                    Ok(conversation_id)
                }
            },
        )
        .await
        .unwrap();

        assert_eq!(conversation_id, "conversation-123");
        assert_eq!(
            events.lock().unwrap().as_slice(),
            ["send:conversation-123:write the skill"]
        );
    }

    #[tokio::test]
    async fn send_tracked_openhands_message_starts_run_for_idle_conversation() {
        let events = Arc::new(Mutex::new(Vec::<String>::new()));
        let send_events = Arc::clone(&events);
        let run_events = Arc::clone(&events);

        let conversation_id = send_tracked_openhands_message_with(
            test_runtime_config("write the skill"),
            "conversation-456".to_string(),
            |_| false,
            move |_config, conversation_id, prompt| {
                let send_events = Arc::clone(&send_events);
                async move {
                    send_events
                        .lock()
                        .unwrap()
                        .push(format!("send:{conversation_id}:{prompt}"));
                    Ok(())
                }
            },
            move |_config, conversation_id, prompt_delivery| {
                let run_events = Arc::clone(&run_events);
                async move {
                    run_events
                        .lock()
                        .unwrap()
                        .push(format!("run:agent-1:{prompt_delivery:?}:{conversation_id}"));
                    Ok(conversation_id)
                }
            },
        )
        .await
        .unwrap();

        assert_eq!(conversation_id, "conversation-456");
        assert_eq!(
            events.lock().unwrap().as_slice(),
            [
                "run:agent-1:ViaSendEvent:conversation-456",
            ]
        );
    }
}
