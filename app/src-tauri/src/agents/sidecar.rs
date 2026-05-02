use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::Write;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tauri::Listener;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

use crate::types::SecretString;

#[derive(Clone, Serialize, Deserialize)]
pub struct SidecarConfig {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mode: Option<String>,
    pub prompt: String,
    #[serde(rename = "systemPrompt", skip_serializing_if = "Option::is_none")]
    pub system_prompt: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub llm: Option<crate::types::WorkflowLlmConfig>,
    #[serde(rename = "modelBaseUrl", skip_serializing_if = "Option::is_none")]
    pub model_base_url: Option<String>,
    #[serde(rename = "apiKey")]
    pub api_key: SecretString,
    /// Workspace root directory (`{data_dir}/workspace`). Used for plugin
    /// discovery (`.claude/plugins/`) and SDK settings sources.
    #[serde(rename = "workspaceRootDir")]
    pub workspace_root_dir: String,
    /// OpenHands local workspace for this run. Existing-skill workflows use the
    /// skill-scoped directory (`{workspace}/{plugin_slug}/{skill_name}`), while
    /// pre-create tasks such as scope validation use the initialized workspace root.
    #[serde(rename = "workspaceSkillDir")]
    pub workspace_skill_dir: String,
    #[serde(rename = "allowedTools", skip_serializing_if = "Option::is_none")]
    pub allowed_tools: Option<Vec<String>>,
    #[serde(rename = "maxTurns", skip_serializing_if = "Option::is_none")]
    pub max_turns: Option<u32>,
    #[serde(rename = "permissionMode", skip_serializing_if = "Option::is_none")]
    pub permission_mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub betas: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thinking: Option<serde_json::Value>,
    #[serde(rename = "fallbackModel", skip_serializing_if = "Option::is_none")]
    pub fallback_model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub effort: Option<String>,
    #[serde(rename = "outputFormat", skip_serializing_if = "Option::is_none")]
    pub output_format: Option<serde_json::Value>,
    #[serde(rename = "promptSuggestions", skip_serializing_if = "Option::is_none")]
    pub prompt_suggestions: Option<bool>,
    #[serde(
        rename = "pathToClaudeCodeExecutable",
        skip_serializing_if = "Option::is_none"
    )]
    pub path_to_claude_code_executable: Option<String>,
    #[serde(
        rename = "pathToOpenHandsRunner",
        skip_serializing_if = "Option::is_none"
    )]
    pub path_to_openhands_runner: Option<String>,
    #[serde(rename = "agentName", skip_serializing_if = "Option::is_none")]
    pub agent_name: Option<String>,
    #[serde(rename = "requiredPlugins", skip_serializing_if = "Option::is_none")]
    pub required_plugins: Option<Vec<String>>,
    #[serde(rename = "settingSources", skip_serializing_if = "Option::is_none")]
    pub setting_sources: Option<Vec<String>>,
    #[serde(
        rename = "conversationHistory",
        skip_serializing_if = "Option::is_none"
    )]
    pub conversation_history: Option<Vec<serde_json::Value>>,
    /// The skill name this agent run is associated with. Used by the mock agent
    /// to discriminate template selection (e.g. with-skill vs. baseline runs).
    #[serde(rename = "skillName", skip_serializing_if = "Option::is_none")]
    pub skill_name: Option<String>,
    /// Step ID for persistence (-1=unknown, -10=refine, -11=test, 0-3=workflow steps).
    #[serde(rename = "stepId", skip_serializing_if = "Option::is_none")]
    pub step_id: Option<i32>,
    /// Workflow session ID.
    #[serde(rename = "workflowSessionId", skip_serializing_if = "Option::is_none")]
    pub workflow_session_id: Option<String>,
    /// Synthetic usage session ID for non-workflow runs.
    #[serde(rename = "usageSessionId", skip_serializing_if = "Option::is_none")]
    pub usage_session_id: Option<String>,
    /// Run source: "workflow", "refine", or "test".
    #[serde(rename = "runSource", skip_serializing_if = "Option::is_none")]
    pub run_source: Option<String>,
    /// Override the log directory for the JSONL transcript. When set, transcripts
    /// are written here instead of the default `{workspaceSkillDir}/logs/`.
    #[serde(rename = "transcriptLogDir", skip_serializing_if = "Option::is_none")]
    pub transcript_log_dir: Option<String>,
    /// Plugin slug for the skill (from plugin-paths.json layout: `{root}/{plugin_slug}/{skill_name}`).
    /// Threaded through terminal lifecycle events so persistence handlers can resolve the correct skill dir.
    #[serde(rename = "pluginSlug")]
    pub plugin_slug: String,
    /// Selects the agent runtime backend. Defaults to "claude" when absent.
    #[serde(rename = "runtimeProvider", skip_serializing_if = "Option::is_none")]
    pub runtime_provider: Option<String>,
    /// Task discriminator for a shared runtime agent.
    #[serde(rename = "taskKind", skip_serializing_if = "Option::is_none")]
    pub task_kind: Option<String>,
    /// Optional suffix appended by the runtime to every user message.
    #[serde(rename = "userMessageSuffix", skip_serializing_if = "Option::is_none")]
    pub user_message_suffix: Option<String>,
}

impl std::fmt::Debug for SidecarConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SidecarConfig")
            .field("mode", &self.mode)
            .field("prompt", &self.prompt)
            .field("model", &self.model)
            .field("llm", &self.llm)
            .field("model_base_url", &self.model_base_url)
            .field("api_key", &"[redacted]")
            .field("workspace_root_dir", &self.workspace_root_dir)
            .field("workspace_skill_dir", &self.workspace_skill_dir)
            .field("allowed_tools", &self.allowed_tools)
            .field("max_turns", &self.max_turns)
            .field("permission_mode", &self.permission_mode)
            .field("betas", &self.betas)
            .field("thinking", &self.thinking)
            .field("fallback_model", &self.fallback_model)
            .field("effort", &self.effort)
            .field("output_format", &self.output_format)
            .field("prompt_suggestions", &self.prompt_suggestions)
            .field("agent_name", &self.agent_name)
            .field("required_plugins", &self.required_plugins)
            .field("setting_sources", &self.setting_sources)
            .field("runtime_provider", &self.runtime_provider)
            .field("task_kind", &self.task_kind)
            .field(
                "user_message_suffix",
                &self.user_message_suffix.as_ref().map(|_| "[configured]"),
            )
            .finish()
    }
}

pub struct OpenHandsOneShotConfigParams {
    pub prompt: String,
    pub llm: crate::types::WorkflowLlmConfig,
    pub workspace_root_dir: String,
    pub workspace_run_dir: String,
    pub agent_name: String,
    pub task_kind: Option<String>,
    pub user_message_suffix: Option<String>,
    pub allowed_tools: Vec<String>,
    pub max_turns: u32,
    pub output_format: Option<serde_json::Value>,
    pub skill_name: Option<String>,
    pub step_id: Option<i32>,
    pub run_source: Option<String>,
    pub plugin_slug: String,
}

/// Build the backend-owned OpenHands one-shot runtime request.
///
/// Feature commands supply only agent/task details. Initialized workspace and
/// selected LLM must already have been resolved by the backend runtime context
/// API before this helper is called.
pub fn build_openhands_one_shot_config(params: OpenHandsOneShotConfigParams) -> SidecarConfig {
    SidecarConfig {
        mode: Some("one-shot".to_string()),
        prompt: params.prompt,
        system_prompt: None,
        model: None,
        llm: Some(params.llm),
        model_base_url: None,
        api_key: SecretString::new("openhands-llm-config".to_string()),
        workspace_root_dir: params.workspace_root_dir.replace('\\', "/"),
        workspace_skill_dir: params.workspace_run_dir.replace('\\', "/"),
        allowed_tools: Some(params.allowed_tools),
        max_turns: Some(params.max_turns),
        permission_mode: None,
        betas: None,
        thinking: None,
        fallback_model: None,
        effort: None,
        output_format: params.output_format,
        prompt_suggestions: None,
        path_to_claude_code_executable: None,
        path_to_openhands_runner: None,
        agent_name: Some(params.agent_name),
        required_plugins: None,
        setting_sources: None,
        conversation_history: None,
        skill_name: params.skill_name,
        step_id: params.step_id,
        workflow_session_id: None,
        usage_session_id: None,
        run_source: params.run_source,
        plugin_slug: params.plugin_slug,
        transcript_log_dir: None,
        runtime_provider: Some("openhands".to_string()),
        task_kind: params.task_kind,
        user_message_suffix: params.user_message_suffix,
    }
}

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

type OpenHandsCancelRegistry = Mutex<HashMap<String, tokio::sync::oneshot::Sender<()>>>;

fn openhands_cancel_registry() -> &'static OpenHandsCancelRegistry {
    static REGISTRY: OnceLock<OpenHandsCancelRegistry> = OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

pub fn cancel_openhands_one_shot(agent_id: &str) -> bool {
    let Ok(mut registry) = openhands_cancel_registry().lock() else {
        log::warn!(
            "[openhands-direct:{}] failed to lock cancellation registry",
            agent_id
        );
        return false;
    };
    registry
        .remove(agent_id)
        .map(|cancel| cancel.send(()).is_ok())
        .unwrap_or(false)
}

fn redact_openhands_config_for_log(config: &SidecarConfig) -> serde_json::Value {
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
    }
    serde_json::json!({
        "type": "config",
        "config": value,
    })
}

fn openhands_request_secrets(config: &SidecarConfig) -> Vec<String> {
    let mut secrets = vec![config.api_key.expose().to_string()];
    if let Some(llm) = &config.llm {
        if let Some(api_key) = &llm.api_key {
            secrets.push(api_key.expose().to_string());
        }
        if let Some(extra_headers) = &llm.extra_headers {
            secrets.extend(extra_headers.values().cloned());
        }
    }
    secrets
        .into_iter()
        .filter(|secret| !secret.trim().is_empty())
        .collect()
}

fn redact_openhands_text(text: &str, secrets: &[String]) -> String {
    secrets.iter().fold(text.to_string(), |redacted, secret| {
        redacted.replace(secret, "[REDACTED]")
    })
}

fn openhands_terminal_outcome(line: &str) -> Option<(bool, Option<String>)> {
    let value = serde_json::from_str::<serde_json::Value>(line).ok()?;
    if value.get("type").and_then(|v| v.as_str()) != Some("conversation_state") {
        return None;
    }

    match value.get("status").and_then(|v| v.as_str())? {
        "completed" => Some((true, None)),
        "error" => Some((
            false,
            Some(openhands_conversation_state_error_detail(
                &value,
                "OpenHands one-shot run failed",
            )),
        )),
        "cancelled" | "canceled" => Some((
            false,
            Some(openhands_conversation_state_error_detail(
                &value,
                "OpenHands one-shot run cancelled",
            )),
        )),
        _ => None,
    }
}

async fn write_openhands_transcript_line(
    log_handle: &Option<std::sync::Arc<std::sync::Mutex<std::fs::File>>>,
    line: &str,
) {
    if let Some(handle) = log_handle {
        if let Ok(mut file) = handle.lock() {
            let _ = writeln!(file, "{}", line);
        }
    }
}

fn create_openhands_transcript(
    agent_id: &str,
    config: &SidecarConfig,
    transcript_log_dir: Option<&str>,
) -> Option<(PathBuf, std::sync::Arc<std::sync::Mutex<std::fs::File>>)> {
    let now = chrono::Local::now();
    let ts = now.format("%Y-%m-%dT%H-%M-%S").to_string();
    let log_dir = transcript_log_dir
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(&config.workspace_skill_dir).join("logs"));
    let log_path = log_dir.join(format!("{}-{}.jsonl", agent_id, ts));
    match std::fs::create_dir_all(&log_dir).and_then(|_| std::fs::File::create(&log_path)) {
        Ok(mut file) => {
            let first_line = redact_openhands_config_for_log(config).to_string();
            let _ = writeln!(file, "{}", first_line);
            Some((log_path, std::sync::Arc::new(std::sync::Mutex::new(file))))
        }
        Err(e) => {
            log::warn!(
                "[openhands-direct:{}] failed to create transcript in {}: {}",
                agent_id,
                log_dir.display(),
                e
            );
            None
        }
    }
}

/// Spawn the bundled OpenHands runner directly from Rust.
///
/// Stdout is the JSONL app protocol (`conversation_event` and
/// `conversation_state`) and is routed through the existing Rust event router.
/// Stderr is diagnostic output only and is written to app logs; it is never
/// forwarded as frontend activity.
pub async fn dispatch_openhands_one_shot(
    app: &tauri::AppHandle,
    agent_id: &str,
    mut config: SidecarConfig,
    transcript_log_dir: Option<&str>,
) -> Result<Option<PathBuf>, String> {
    if config.path_to_openhands_runner.is_none() {
        config.path_to_openhands_runner = Some(resolve_openhands_runner_path(app)?);
    }

    let runner_path = config
        .path_to_openhands_runner
        .clone()
        .ok_or_else(|| "OpenHands runner path was not resolved".to_string())?;
    let transcript = create_openhands_transcript(agent_id, &config, transcript_log_dir);
    let transcript_path = transcript.as_ref().map(|(path, _)| path.clone());
    let log_handle = transcript.map(|(_, handle)| handle);
    let stderr_secrets = openhands_request_secrets(&config);

    let config_event = redact_openhands_config_for_log(&config);
    super::events::handle_sidecar_message(app, agent_id, &config_event.to_string());

    let request_json = serde_json::to_string(&config)
        .map_err(|e| format!("Failed to serialize OpenHands request: {}", e))?;
    let mut child = tokio::process::Command::new(&runner_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn OpenHands runner {}: {}", runner_path, e))?;

    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Failed to open OpenHands runner stdin".to_string())?;
    stdin
        .write_all(request_json.as_bytes())
        .await
        .map_err(|e| format!("Failed to write OpenHands request: {}", e))?;
    stdin
        .write_all(b"\n")
        .await
        .map_err(|e| format!("Failed to terminate OpenHands request: {}", e))?;
    stdin
        .shutdown()
        .await
        .map_err(|e| format!("Failed to close OpenHands runner stdin: {}", e))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to open OpenHands runner stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Failed to open OpenHands runner stderr".to_string())?;

    let (cancel_tx, cancel_rx) = tokio::sync::oneshot::channel::<()>();
    {
        let mut registry = openhands_cancel_registry()
            .lock()
            .map_err(|e| format!("Failed to lock OpenHands cancellation registry: {}", e))?;
        registry.insert(agent_id.to_string(), cancel_tx);
    }

    let app_for_stdout = app.clone();
    let agent_for_stdout = agent_id.to_string();
    let log_for_stdout = log_handle.clone();
    let stdout_task = tokio::spawn(async move {
        let mut terminal_outcome: Option<(bool, Option<String>)> = None;
        let mut lines = BufReader::new(stdout).lines();
        loop {
            match lines.next_line().await {
                Ok(Some(line)) => {
                    write_openhands_transcript_line(&log_for_stdout, &line).await;
                    if let Some(outcome) = openhands_terminal_outcome(&line) {
                        terminal_outcome = Some(outcome);
                    }
                    super::events::handle_sidecar_message(
                        &app_for_stdout,
                        &agent_for_stdout,
                        &line,
                    );
                }
                Ok(None) => break,
                Err(e) => {
                    log::warn!(
                        "[openhands-direct:{}] stdout read failed: {}",
                        agent_for_stdout,
                        e
                    );
                    break;
                }
            }
        }
        terminal_outcome
    });

    let agent_for_stderr = agent_id.to_string();
    let stderr_task = tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        loop {
            match lines.next_line().await {
                Ok(Some(line)) => {
                    if !line.trim().is_empty() {
                        let line = redact_openhands_text(&line, &stderr_secrets);
                        log::debug!("[openhands-stderr:{}] {}", agent_for_stderr, line);
                    }
                }
                Ok(None) => break,
                Err(e) => {
                    log::warn!(
                        "[openhands-direct:{}] stderr read failed: {}",
                        agent_for_stderr,
                        e
                    );
                    break;
                }
            }
        }
    });

    let app_for_exit = app.clone();
    let agent_for_exit = agent_id.to_string();
    tokio::spawn(async move {
        let mut was_cancelled = false;
        let exit_status = tokio::select! {
            status = child.wait() => status,
            _ = cancel_rx => {
                was_cancelled = true;
                if let Err(e) = child.start_kill() {
                    log::warn!(
                        "[openhands-direct:{}] failed to kill cancelled runner: {}",
                        agent_for_exit,
                        e
                    );
                }
                child.wait().await
            }
        };
        let terminal_outcome = match stdout_task.await {
            Ok(outcome) => outcome,
            Err(e) => {
                log::warn!(
                    "[openhands-direct:{}] stdout task join failed: {}",
                    agent_for_exit,
                    e
                );
                None
            }
        };
        let _ = stderr_task.await;
        if let Ok(mut registry) = openhands_cancel_registry().lock() {
            registry.remove(&agent_for_exit);
        }

        if was_cancelled {
            let cancel_state = serde_json::json!({
                "type": "conversation_state",
                "runtime": "openhands",
                "agent_id": agent_for_exit.clone(),
                "status": "cancelled",
                "timestamp": chrono::Utc::now().timestamp_millis(),
                "error_detail": "OpenHands one-shot run cancelled",
                "result_text": null,
                "structured_output": null,
            });
            super::events::handle_sidecar_message(
                &app_for_exit,
                &agent_for_exit,
                &cancel_state.to_string(),
            );
            super::events::handle_agent_shutdown(&app_for_exit, &agent_for_exit);
            return;
        }

        let (success, detail) = match terminal_outcome {
            Some(outcome) => outcome,
            None => match exit_status {
                Ok(status) if status.success() => (
                    false,
                    Some("OpenHands runner exited without terminal conversation_state".to_string()),
                ),
                Ok(status) => (
                    false,
                    Some(format!("OpenHands runner exited with {}", status)),
                ),
                Err(e) => (false, Some(format!("OpenHands runner wait failed: {}", e))),
            },
        };
        super::events::handle_sidecar_exit_with_detail(
            &app_for_exit,
            &agent_for_exit,
            success,
            detail,
        );
    });

    Ok(transcript_path)
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

/// Dispatch a backend-owned OpenHands one-shot request through the direct
/// runner boundary and wait for its terminal `conversation_state` payload.
///
/// Callers keep task-specific result parsing, but they should not duplicate the
/// dispatch, transcript directory, runner path, or terminal wait
/// mechanics for each migrated OpenHands feature.
pub async fn run_openhands_one_shot(
    app: &tauri::AppHandle,
    _pool: &crate::agents::sidecar_pool::SidecarPool,
    params: OpenHandsOneShotRunParams,
) -> Result<OpenHandsOneShotRun, String> {
    let config = params.config;
    let agent_id = format!("{}-{}", params.agent_id_prefix, uuid::Uuid::new_v4());
    let transcript_dir = PathBuf::from(&config.workspace_skill_dir)
        .join("logs")
        .join(format!(
            "{}-{}",
            params.agent_id_prefix,
            uuid::Uuid::new_v4()
        ));
    let transcript_dir_str = transcript_dir.to_string_lossy().into_owned();

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
        let payload = event.payload();
        if !payload.contains(target_agent_id.as_str()) {
            return;
        }
        let Ok(value) = serde_json::from_str::<serde_json::Value>(payload) else {
            return;
        };
        if value.get("agent_id").and_then(|v| v.as_str()) != Some(target_agent_id.as_str()) {
            return;
        }
        let success = value
            .get("success")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let result = if success {
            Ok(())
        } else {
            let detail = value
                .get("error_detail")
                .and_then(|v| v.as_str())
                .unwrap_or("OpenHands one-shot run failed")
                .to_string();
            Err(detail)
        };
        let _ = tx_exit.send(OpenHandsOneShotEvent::Lifecycle(result));
    });
    let target_agent_id = agent_id.clone();
    let tx_shutdown = tx.clone();
    let shutdown_listener = app.listen("agent-shutdown", move |event| {
        let payload = event.payload();
        if !payload.contains(target_agent_id.as_str()) {
            return;
        }
        let Ok(value) = serde_json::from_str::<serde_json::Value>(payload) else {
            return;
        };
        if value.get("agent_id").and_then(|v| v.as_str()) != Some(target_agent_id.as_str()) {
            return;
        }
        let _ = tx_shutdown.send(OpenHandsOneShotEvent::Lifecycle(Err(
            "OpenHands one-shot run cancelled".to_string(),
        )));
    });

    dispatch_openhands_one_shot(app, &agent_id, config, Some(&transcript_dir_str))
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
                    if terminal_state.is_none() {
                        terminal_state = Some(result);
                    }
                }
                Some(OpenHandsOneShotEvent::Lifecycle(result)) => {
                    if lifecycle_result.is_none() {
                        lifecycle_result = Some(result);
                    }
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
        Err(_) => return Err("OpenHands one-shot run timed out".to_string()),
    };

    let conversation_state = terminal_state.unwrap_or_else(|| {
        Err("OpenHands one-shot run completed without conversation_state".into())
    })?;
    lifecycle_result.unwrap_or_else(|| {
        Err("OpenHands one-shot lifecycle listener closed unexpectedly".to_string())
    })?;

    Ok(OpenHandsOneShotRun {
        transcript_dir,
        conversation_state,
    })
}

/// Spawn an agent request.
///
/// OpenHands requests use the direct Rust -> Python runner boundary. Legacy
/// runtime requests still use the persistent sidecar pool, which reuses a
/// long-lived Node.js process per skill to reduce startup latency.
///
/// The request runs until the agent completes or the user cancels manually.
pub async fn spawn_sidecar(
    agent_id: String,
    mut config: SidecarConfig,
    pool: super::sidecar_pool::SidecarPool,
    app_handle: tauri::AppHandle,
    skill_name: String,
    transcript_log_dir: Option<String>,
) -> Result<(), String> {
    if config.runtime_provider.as_deref() == Some("openhands") {
        dispatch_openhands_one_shot(
            &app_handle,
            &agent_id,
            config,
            transcript_log_dir.as_deref(),
        )
        .await?;
        return Ok(());
    } else if config.path_to_claude_code_executable.is_none() {
        // Resolve the SDK native binary path so the bundled SDK can spawn it.
        if let Ok(cli_path) = resolve_sdk_cli_path(&app_handle) {
            config.path_to_claude_code_executable = Some(cli_path);
        }
    }

    pool.send_request(
        &skill_name,
        &agent_id,
        config,
        &app_handle,
        transcript_log_dir.as_deref(),
    )
    .await?;

    Ok(())
}

/// Public accessor for startup dependency checks.
pub fn resolve_sdk_cli_path_public(app_handle: &tauri::AppHandle) -> Result<String, String> {
    resolve_sdk_cli_path(app_handle)
}

/// Public accessor for startup dependency checks.
pub fn resolve_openhands_runner_path_public(
    app_handle: &tauri::AppHandle,
) -> Result<String, String> {
    resolve_openhands_runner_path(app_handle)
}

fn openhands_runner_executable_name() -> &'static str {
    if cfg!(windows) {
        "openhands-runner.exe"
    } else {
        "openhands-runner"
    }
}

fn normalize_executable_path(path: &str) -> String {
    path.strip_prefix("\\\\?\\")
        .unwrap_or(path)
        .replace('\\', "/")
}

/// Resolve the path to the SDK's native `claude` binary, which the bundled SDK
/// spawns as a child process. Looks in sidecar/dist/sdk/claude (or claude.exe
/// on Windows), where build.js copies it from the platform-specific
/// @anthropic-ai/claude-agent-sdk-{platform}-{arch} package.
fn resolve_sdk_cli_path(app_handle: &tauri::AppHandle) -> Result<String, String> {
    use tauri::Manager;

    let exe_name = if cfg!(windows) {
        "claude.exe"
    } else {
        "claude"
    };

    // Try resource directory first (production)
    if let Ok(resource_dir) = app_handle.path().resource_dir() {
        let cli = resource_dir
            .join("sidecar")
            .join("dist")
            .join("sdk")
            .join(exe_name);
        if cli.exists() {
            return cli
                .to_str()
                .map(normalize_executable_path)
                .ok_or_else(|| "Invalid SDK binary path".to_string());
        }
    }

    // Fallback: next to the binary
    if let Ok(exe_dir) = std::env::current_exe() {
        if let Some(dir) = exe_dir.parent() {
            let cli = dir.join("sidecar").join("dist").join("sdk").join(exe_name);
            if cli.exists() {
                return cli
                    .to_str()
                    .map(normalize_executable_path)
                    .ok_or_else(|| "Invalid SDK binary path".to_string());
            }
        }
    }

    // Dev mode fallback
    let dev_path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(|p| p.join("sidecar").join("dist").join("sdk").join(exe_name));
    if let Some(path) = dev_path {
        if path.exists() {
            return path
                .to_str()
                .map(normalize_executable_path)
                .ok_or_else(|| "Invalid SDK binary path".to_string());
        }
    }

    Err(format!(
        "Could not find SDK binary ({exe_name}) — run 'npm run build' in app/sidecar/ first"
    ))
}

/// Resolve the path to the PyInstaller-built OpenHands runner.
///
/// Looks in sidecar/dist/openhands/openhands-runner (or .exe on Windows),
/// matching the staging path created by app/sidecar/build.js.
fn resolve_openhands_runner_path(app_handle: &tauri::AppHandle) -> Result<String, String> {
    use tauri::Manager;

    let exe_name = openhands_runner_executable_name();

    if let Ok(resource_dir) = app_handle.path().resource_dir() {
        let runner = resource_dir
            .join("sidecar")
            .join("dist")
            .join("openhands")
            .join(exe_name);
        if runner.exists() {
            return runner
                .to_str()
                .map(normalize_executable_path)
                .ok_or_else(|| "Invalid OpenHands runner path".to_string());
        }
    }

    if let Ok(exe_dir) = std::env::current_exe() {
        if let Some(dir) = exe_dir.parent() {
            let runner = dir
                .join("sidecar")
                .join("dist")
                .join("openhands")
                .join(exe_name);
            if runner.exists() {
                return runner
                    .to_str()
                    .map(normalize_executable_path)
                    .ok_or_else(|| "Invalid OpenHands runner path".to_string());
            }
        }
    }

    let dev_path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(|p| {
            p.join("sidecar")
                .join("dist")
                .join("openhands")
                .join(exe_name)
        });
    if let Some(path) = dev_path {
        if path.exists() {
            return path
                .to_str()
                .map(normalize_executable_path)
                .ok_or_else(|| "Invalid OpenHands runner path".to_string());
        }
    }

    Err(format!(
        "Could not find OpenHands runner ({exe_name}) — run 'cd app/sidecar/openhands && ./build.sh' and then 'cd app && npm run sidecar:build'"
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sidecar_config_serialization() {
        let config = SidecarConfig {
            mode: Some("one-shot".to_string()),
            prompt: "Analyze this codebase".to_string(),
            system_prompt: None,
            model: Some("sonnet".to_string()),
            llm: None,
            model_base_url: Some("https://models.example.com/v1".to_string()),
            api_key: crate::types::SecretString::new("sk-ant-test".to_string()),
            workspace_root_dir: "/home/user/project".to_string(),
            workspace_skill_dir: "/home/user/project".to_string(),
            allowed_tools: Some(vec!["Read".to_string(), "Glob".to_string()]),
            max_turns: Some(25),
            permission_mode: Some("bypassPermissions".to_string()),
            betas: None,
            thinking: None,
            fallback_model: None,
            effort: None,
            output_format: None,
            prompt_suggestions: None,
            path_to_claude_code_executable: None,
            path_to_openhands_runner: None,
            agent_name: Some("research-entities".to_string()),
            required_plugins: None,
            setting_sources: None,
            conversation_history: None,
            skill_name: None,
            step_id: None,
            workflow_session_id: None,
            usage_session_id: None,
            run_source: None,
            plugin_slug: "skills".to_string(),
            transcript_log_dir: None,
            runtime_provider: None,
            task_kind: None,
            user_message_suffix: None,
        };

        let json = serde_json::to_string(&config).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

        // Verify camelCase field names from serde rename
        assert_eq!(parsed["apiKey"], "sk-ant-test");
        assert_eq!(parsed["allowedTools"][0], "Read");
        assert_eq!(parsed["maxTurns"], 25);
        assert_eq!(parsed["permissionMode"], "bypassPermissions");
        assert_eq!(parsed["model"], "sonnet");
        assert_eq!(parsed["modelBaseUrl"], "https://models.example.com/v1");
        assert_eq!(parsed["mode"], "one-shot");
        assert_eq!(parsed["agentName"], "research-entities");
        // betas is None + skip_serializing_if — should be absent
        assert!(parsed.get("betas").is_none());
        // thinking is None + skip_serializing_if — should be absent
        assert!(parsed.get("thinking").is_none());
    }

    #[test]
    fn test_openhands_log_config_redacts_nested_llm_secrets() {
        let config = SidecarConfig {
            mode: Some("one-shot".to_string()),
            prompt: "run".to_string(),
            system_prompt: None,
            model: None,
            llm: Some(crate::types::WorkflowLlmConfig {
                model: "openai/test".to_string(),
                api_key: Some(crate::types::SecretString::new("sk-secret".to_string())),
                base_url: Some("https://example.test/v1".to_string()),
                api_version: None,
                temperature: None,
                max_output_tokens: None,
                timeout_seconds: None,
                num_retries: None,
                reasoning_effort: None,
                extra_headers: Some(std::collections::HashMap::from([(
                    "Authorization".to_string(),
                    "Bearer secret".to_string(),
                )])),
                input_cost_per_token: None,
                output_cost_per_token: None,
                usage_id: Some("workflow".to_string()),
            }),
            model_base_url: None,
            api_key: crate::types::SecretString::new("transport-secret".to_string()),
            workspace_root_dir: "/tmp".to_string(),
            workspace_skill_dir: "/tmp".to_string(),
            allowed_tools: None,
            max_turns: None,
            permission_mode: None,
            betas: None,
            thinking: None,
            fallback_model: None,
            effort: None,
            output_format: None,
            prompt_suggestions: None,
            path_to_claude_code_executable: None,
            path_to_openhands_runner: None,
            agent_name: Some("skill-creator".to_string()),
            required_plugins: None,
            setting_sources: None,
            conversation_history: None,
            skill_name: Some("demo".to_string()),
            step_id: Some(0),
            workflow_session_id: None,
            usage_session_id: None,
            run_source: Some("workflow".to_string()),
            plugin_slug: "skills".to_string(),
            transcript_log_dir: None,
            runtime_provider: Some("openhands".to_string()),
            task_kind: Some("workflow.research".to_string()),
            user_message_suffix: None,
        };

        let redacted = redact_openhands_config_for_log(&config).to_string();

        assert!(redacted.contains("[REDACTED]"));
        assert!(!redacted.contains("sk-secret"));
        assert!(!redacted.contains("transport-secret"));
        assert!(!redacted.contains("Bearer secret"));
        assert!(redacted.contains("workflow.research"));
    }

    #[test]
    fn test_openhands_stderr_redaction_replaces_request_secrets() {
        let config = SidecarConfig {
            mode: Some("one-shot".to_string()),
            prompt: "Prompt".to_string(),
            system_prompt: None,
            model: Some("provider/model".to_string()),
            llm: Some(crate::types::WorkflowLlmConfig {
                model: "provider/model".to_string(),
                api_key: Some(crate::types::SecretString::new("sk-secret".to_string())),
                base_url: None,
                api_version: None,
                temperature: None,
                max_output_tokens: None,
                timeout_seconds: None,
                num_retries: None,
                reasoning_effort: None,
                extra_headers: Some(std::collections::HashMap::from([(
                    "Authorization".to_string(),
                    "Bearer secret".to_string(),
                )])),
                input_cost_per_token: None,
                output_cost_per_token: None,
                usage_id: None,
            }),
            model_base_url: None,
            api_key: crate::types::SecretString::new("transport-secret".to_string()),
            workspace_root_dir: "/tmp".to_string(),
            workspace_skill_dir: "/tmp".to_string(),
            allowed_tools: None,
            max_turns: None,
            permission_mode: None,
            betas: None,
            thinking: None,
            fallback_model: None,
            effort: None,
            output_format: None,
            prompt_suggestions: None,
            path_to_claude_code_executable: None,
            path_to_openhands_runner: None,
            agent_name: Some("skill-creator".to_string()),
            required_plugins: None,
            setting_sources: None,
            conversation_history: None,
            skill_name: Some("demo".to_string()),
            step_id: Some(0),
            workflow_session_id: None,
            usage_session_id: None,
            run_source: Some("workflow".to_string()),
            plugin_slug: "skills".to_string(),
            transcript_log_dir: None,
            runtime_provider: Some("openhands".to_string()),
            task_kind: Some("workflow.research".to_string()),
            user_message_suffix: None,
        };

        let secrets = openhands_request_secrets(&config);
        let redacted = redact_openhands_text(
            "failed with sk-secret / transport-secret / Bearer secret",
            &secrets,
        );

        assert_eq!(redacted, "failed with [REDACTED] / [REDACTED] / [REDACTED]");
    }

    #[test]
    fn test_cancel_openhands_one_shot_consumes_registered_cancel_sender() {
        let agent_id = format!("test-agent-{}", uuid::Uuid::new_v4());
        let (tx, mut rx) = tokio::sync::oneshot::channel::<()>();
        {
            let mut registry = openhands_cancel_registry().lock().unwrap();
            registry.insert(agent_id.clone(), tx);
        }

        assert!(cancel_openhands_one_shot(&agent_id));
        assert!(rx.try_recv().is_ok());
        assert!(!cancel_openhands_one_shot(&agent_id));
    }

    #[test]
    fn test_openhands_terminal_outcome_reads_conversation_state() {
        let completed = r#"{"type":"conversation_state","status":"completed"}"#;
        let error = r#"{"type":"conversation_state","status":"error","error_detail":"zip failed"}"#;
        let running = r#"{"type":"conversation_state","status":"running"}"#;

        assert_eq!(openhands_terminal_outcome(completed), Some((true, None)));
        assert_eq!(
            openhands_terminal_outcome(error),
            Some((false, Some("zip failed".to_string())))
        );
        assert_eq!(openhands_terminal_outcome(running), None);
    }

    #[test]
    fn test_sidecar_config_serialization_with_thinking() {
        let config = SidecarConfig {
            mode: None,
            prompt: "Reason about this".to_string(),
            system_prompt: None,
            model: Some("opus".to_string()),
            llm: None,
            model_base_url: None,
            api_key: crate::types::SecretString::new("sk-ant-test".to_string()),
            workspace_root_dir: "/home/user/project".to_string(),
            workspace_skill_dir: "/home/user/project".to_string(),
            allowed_tools: None,
            max_turns: None,
            permission_mode: None,
            betas: None,
            thinking: Some(serde_json::json!({
                "type": "enabled",
                "budgetTokens": 32000
            })),
            fallback_model: None,
            effort: None,
            output_format: None,
            prompt_suggestions: None,
            path_to_claude_code_executable: None,
            path_to_openhands_runner: None,
            agent_name: None,
            required_plugins: None,
            setting_sources: None,
            conversation_history: None,
            skill_name: None,
            step_id: None,
            workflow_session_id: None,
            usage_session_id: None,
            run_source: None,
            plugin_slug: "skills".to_string(),
            transcript_log_dir: None,
            runtime_provider: None,
            task_kind: None,
            user_message_suffix: None,
        };

        let json = serde_json::to_string(&config).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed["thinking"]["type"], "enabled");
        assert_eq!(parsed["thinking"]["budgetTokens"], 32000);
    }

    #[test]
    fn test_sidecar_config_skill_name_serialized_as_camel_case() {
        // skill_name must serialize as "skillName" so the sidecar's
        // mock discriminator (config.skillName) receives the value correctly.
        let config = SidecarConfig {
            mode: None,
            prompt: "test".to_string(),
            system_prompt: None,
            model: None,
            llm: None,
            model_base_url: None,
            api_key: crate::types::SecretString::new("sk-ant-test".to_string()),
            workspace_root_dir: "/tmp".to_string(),
            workspace_skill_dir: "/tmp".to_string(),
            allowed_tools: None,
            max_turns: None,
            permission_mode: None,
            betas: None,
            thinking: None,
            fallback_model: None,
            effort: None,
            output_format: None,
            prompt_suggestions: None,
            path_to_claude_code_executable: None,
            path_to_openhands_runner: None,
            agent_name: None,
            required_plugins: None,
            setting_sources: None,
            conversation_history: None,
            skill_name: Some("my-skill".to_string()),
            step_id: None,
            workflow_session_id: None,
            usage_session_id: None,
            run_source: None,
            plugin_slug: "skills".to_string(),
            transcript_log_dir: None,
            runtime_provider: None,
            task_kind: None,
            user_message_suffix: None,
        };
        let json = serde_json::to_string(&config).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(
            parsed["skillName"], "my-skill",
            "skill_name must be camelCase 'skillName' in JSON"
        );
        assert!(
            parsed.get("skill_name").is_none(),
            "snake_case key must not appear in JSON"
        );
    }

    #[test]
    fn test_sidecar_config_skill_name_absent_when_none() {
        // When skill_name is None, it must be omitted (skip_serializing_if = "Option::is_none").
        let config = SidecarConfig {
            mode: None,
            prompt: "test".to_string(),
            system_prompt: None,
            model: None,
            llm: None,
            model_base_url: None,
            api_key: crate::types::SecretString::new("sk-ant-test".to_string()),
            workspace_root_dir: "/tmp".to_string(),
            workspace_skill_dir: "/tmp".to_string(),
            allowed_tools: None,
            max_turns: None,
            permission_mode: None,
            betas: None,
            thinking: None,
            fallback_model: None,
            effort: None,
            output_format: None,
            prompt_suggestions: None,
            path_to_claude_code_executable: None,
            path_to_openhands_runner: None,
            agent_name: None,
            required_plugins: None,
            setting_sources: None,
            conversation_history: None,
            skill_name: None,
            step_id: None,
            workflow_session_id: None,
            usage_session_id: None,
            run_source: None,
            plugin_slug: "skills".to_string(),
            transcript_log_dir: None,
            runtime_provider: None,
            task_kind: None,
            user_message_suffix: None,
        };
        let json = serde_json::to_string(&config).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert!(
            parsed.get("skillName").is_none(),
            "skillName must be absent when None"
        );
    }

    #[test]
    fn test_sidecar_config_openhands_runner_path_serialized_as_camel_case() {
        let config = SidecarConfig {
            mode: Some("one-shot".to_string()),
            prompt: "test".to_string(),
            system_prompt: None,
            model: None,
            llm: None,
            model_base_url: None,
            api_key: crate::types::SecretString::new("sk-ant-test".to_string()),
            workspace_root_dir: "/tmp".to_string(),
            workspace_skill_dir: "/tmp".to_string(),
            allowed_tools: None,
            max_turns: None,
            permission_mode: None,
            betas: None,
            thinking: None,
            fallback_model: None,
            effort: None,
            output_format: None,
            prompt_suggestions: None,
            path_to_claude_code_executable: None,
            path_to_openhands_runner: Some("/tmp/openhands-runner".to_string()),
            agent_name: None,
            required_plugins: None,
            setting_sources: None,
            conversation_history: None,
            skill_name: None,
            step_id: None,
            workflow_session_id: None,
            usage_session_id: None,
            run_source: None,
            plugin_slug: "skills".to_string(),
            transcript_log_dir: None,
            runtime_provider: Some("openhands".to_string()),
            task_kind: None,
            user_message_suffix: None,
        };

        let json = serde_json::to_string(&config).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed["pathToOpenHandsRunner"], "/tmp/openhands-runner");
        assert!(
            parsed.get("path_to_openhands_runner").is_none(),
            "snake_case key must not appear in JSON"
        );
        assert!(
            parsed.get("pathToClaudeCodeExecutable").is_none(),
            "OpenHands runner path must not be serialized as the Claude executable path"
        );
    }

    #[test]
    fn test_openhands_runner_executable_name_matches_platform() {
        let expected = if cfg!(windows) {
            "openhands-runner.exe"
        } else {
            "openhands-runner"
        };

        assert_eq!(openhands_runner_executable_name(), expected);
    }

    #[test]
    fn test_normalize_executable_path_strips_windows_verbatim_prefix_and_slashes() {
        assert_eq!(
            normalize_executable_path(r"\\?\C:\Skill Builder\openhands-runner.exe"),
            "C:/Skill Builder/openhands-runner.exe"
        );
    }

    #[test]
    fn test_scope_review_config_serializes_user_suffix_and_task_kind() {
        let config = SidecarConfig {
            mode: Some("one-shot".to_string()),
            prompt: "review scope".to_string(),
            system_prompt: None,
            model: None,
            llm: Some(crate::types::WorkflowLlmConfig {
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
                usage_id: Some("workflow".to_string()),
            }),
            model_base_url: None,
            api_key: crate::types::SecretString::new("openhands-llm-config".to_string()),
            workspace_root_dir: "/tmp/workspace".to_string(),
            workspace_skill_dir: "/tmp/workspace/skills/new-skill".to_string(),
            allowed_tools: Some(vec!["file_editor".to_string()]),
            max_turns: Some(4),
            permission_mode: None,
            betas: None,
            thinking: None,
            fallback_model: None,
            effort: None,
            output_format: None,
            prompt_suggestions: None,
            path_to_claude_code_executable: None,
            path_to_openhands_runner: None,
            agent_name: Some("skill-creator".to_string()),
            required_plugins: None,
            setting_sources: None,
            conversation_history: None,
            skill_name: Some("new-skill".to_string()),
            step_id: Some(-30),
            workflow_session_id: None,
            usage_session_id: None,
            run_source: None,
            plugin_slug: "skills".to_string(),
            transcript_log_dir: None,
            runtime_provider: Some("openhands".to_string()),
            task_kind: Some("scope_review".to_string()),
            user_message_suffix: Some(
                "Follow the current user message exactly. Do not infer a different task than the one stated in the message.".to_string(),
            ),
        };

        let json = serde_json::to_value(&config).unwrap();
        assert_eq!(json["taskKind"], "scope_review");
        assert_eq!(
            json["userMessageSuffix"],
            "Follow the current user message exactly. Do not infer a different task than the one stated in the message."
        );
    }

    #[test]
    fn test_openhands_one_shot_extracts_terminal_conversation_state_for_target_agent() {
        let terminal_state = serde_json::json!({
            "type": "conversation_state",
            "runtime": "openhands",
            "conversation_id": "scope-review-1",
            "status": "completed",
            "result": {
                "status": "new"
            }
        });
        let payload = serde_json::json!({
            "agent_id": "agent-1",
            "message": terminal_state.clone()
        })
        .to_string();

        let result =
            parse_openhands_one_shot_terminal_state(&payload, "agent-1").expect("terminal state");

        assert_eq!(result.unwrap(), terminal_state);
    }

    #[test]
    fn test_openhands_one_shot_ignores_other_agents_and_running_state() {
        let completed_payload = serde_json::json!({
            "agent_id": "other-agent",
            "message": {
                "type": "conversation_state",
                "runtime": "openhands",
                "status": "completed"
            }
        })
        .to_string();
        let running_payload = serde_json::json!({
            "agent_id": "agent-1",
            "message": {
                "type": "conversation_state",
                "runtime": "openhands",
                "status": "running"
            }
        })
        .to_string();

        assert!(parse_openhands_one_shot_terminal_state(&completed_payload, "agent-1").is_none());
        assert!(parse_openhands_one_shot_terminal_state(&running_payload, "agent-1").is_none());
    }

    #[test]
    fn test_openhands_one_shot_terminal_error_carries_error_detail() {
        let payload = serde_json::json!({
            "agent_id": "agent-1",
            "message": {
                "type": "conversation_state",
                "runtime": "openhands",
                "status": "error",
                "error_detail": "scope validation failed"
            }
        })
        .to_string();

        let result =
            parse_openhands_one_shot_terminal_state(&payload, "agent-1").expect("terminal state");

        assert_eq!(result.unwrap_err(), "scope validation failed");
    }
}
