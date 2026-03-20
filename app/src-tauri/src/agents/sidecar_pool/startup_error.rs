use std::fmt;

/// The three possible terminal outcomes for a sidecar request.
#[derive(Debug, PartialEq)]
pub(super) enum TerminalOutcome {
    /// Agent completed successfully.
    Completed,
    /// Agent failed (SDK error, execution error).
    Error,
    /// Agent was shut down by user request.
    Shutdown,
}

pub(super) fn stream_message_terminal_status(msg: &serde_json::Value) -> Option<TerminalOutcome> {
    match msg.get("type").and_then(|t| t.as_str()) {
        Some("agent_event") => {
            let event = msg.get("event")?;
            let event_type = event.get("type").and_then(|t| t.as_str())?;
            if event_type != "run_result" {
                return None;
            }
            let status = event
                .get("status")
                .and_then(|status| status.as_str())
                .unwrap_or("completed");
            match status {
                "completed" => Some(TerminalOutcome::Completed),
                "shutdown" => Some(TerminalOutcome::Shutdown),
                _ => Some(TerminalOutcome::Error),
            }
        }
        // Raw error messages from sidecar protocol-error paths (e.g.
        // duplicate session, missing session) are terminal failures.
        Some("error") => Some(TerminalOutcome::Error),
        _ => None,
    }
}

/// Categorized sidecar startup failure with actionable fix instructions.
#[derive(Debug, Clone, serde::Serialize)]
pub enum SidecarStartupError {
    /// The agent-runner.js bundle was not found in any expected location.
    SidecarMissing,
    /// Node.js binary was not found on the system.
    NodeMissing,
    /// Node.js was found but its version is below the minimum supported version (18).
    NodeIncompatible { found: String, required: String },
    /// The sidecar process could not be spawned (OS-level failure).
    SpawnFailed { detail: String },
    /// The sidecar started but did not send the ready signal within the timeout.
    ReadyTimeout { pid: u32 },
    /// An unexpected error during startup.
    Other { detail: String },
}

impl SidecarStartupError {
    /// Machine-readable error type for frontend classification.
    pub fn error_type(&self) -> &'static str {
        match self {
            SidecarStartupError::SidecarMissing => "sidecar_missing",
            SidecarStartupError::NodeMissing => "node_missing",
            SidecarStartupError::NodeIncompatible { .. } => "node_incompatible",
            SidecarStartupError::SpawnFailed { .. } => "spawn_failed",
            SidecarStartupError::ReadyTimeout { .. } => "ready_timeout",
            SidecarStartupError::Other { .. } => "other",
        }
    }

    /// Human-readable message describing the error.
    pub fn message(&self) -> String {
        match self {
            SidecarStartupError::SidecarMissing => "Agent runtime not found.".to_string(),
            SidecarStartupError::NodeMissing => {
                "Node.js is not installed or not in PATH.".to_string()
            }
            SidecarStartupError::NodeIncompatible { found, required } => {
                format!(
                    "Node.js {} is not compatible. This app requires Node.js {}.",
                    found, required
                )
            }
            SidecarStartupError::SpawnFailed { detail } => {
                format!("Failed to start agent runtime: {}", detail)
            }
            SidecarStartupError::ReadyTimeout { pid } => {
                format!(
                    "Agent runtime started (pid {}) but failed to initialize within 10 seconds.",
                    pid
                )
            }
            SidecarStartupError::Other { detail } => detail.clone(),
        }
    }

    /// Actionable instruction for the user to fix the error.
    pub fn fix_hint(&self) -> String {
        match self {
            SidecarStartupError::SidecarMissing => {
                "Run `npm run sidecar:build` in the app/ directory, or use `npm run dev` which builds automatically.".to_string()
            }
            SidecarStartupError::NodeMissing => {
                "Install Node.js 18+ from https://nodejs.org".to_string()
            }
            SidecarStartupError::NodeIncompatible { .. } => {
                "Install Node.js 18+ from https://nodejs.org".to_string()
            }
            SidecarStartupError::SpawnFailed { .. } => {
                "Check file permissions and ensure the sidecar bundle exists. Try running `npm run sidecar:build` in the app/ directory.".to_string()
            }
            SidecarStartupError::ReadyTimeout { .. } => {
                "Check the app logs for details (Settings > Log File). The sidecar process may have crashed during initialization.".to_string()
            }
            SidecarStartupError::Other { .. } => {
                "Check the app logs for details (Settings > Log File).".to_string()
            }
        }
    }
}

impl fmt::Display for SidecarStartupError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{} {}", self.message(), self.fix_hint())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_stream_message_terminal_status_recognizes_run_result_agent_event() {
        let completed = serde_json::json!({
            "type": "agent_event",
            "request_id": "agent-1",
            "event": {
                "type": "run_result",
                "status": "completed"
            }
        });
        let failed = serde_json::json!({
            "type": "agent_event",
            "request_id": "agent-1",
            "event": {
                "type": "run_result",
                "status": "error"
            }
        });
        let display_item = serde_json::json!({
            "type": "display_item",
            "request_id": "agent-1",
            "item": {
                "type": "result"
            }
        });

        let raw_error = serde_json::json!({
            "type": "error",
            "request_id": "agent-1",
            "message": "No stream session found"
        });

        assert_eq!(stream_message_terminal_status(&completed), Some(TerminalOutcome::Completed));
        assert_eq!(stream_message_terminal_status(&failed), Some(TerminalOutcome::Error));
        assert_eq!(stream_message_terminal_status(&raw_error), Some(TerminalOutcome::Error));
        assert_eq!(stream_message_terminal_status(&display_item), None);

        // "shutdown" status must map to Shutdown, not Error, so the frontend
        // calls shutdownRun() instead of completeRun(false).
        let shutdown = serde_json::json!({
            "type": "agent_event",
            "request_id": "agent-1",
            "event": {
                "type": "run_result",
                "status": "shutdown"
            }
        });
        assert_eq!(stream_message_terminal_status(&shutdown), Some(TerminalOutcome::Shutdown));
    }

    #[tokio::test]
    async fn test_pong_message_is_recognized() {
        // Verify that a pong message is correctly identified — this is the
        // same check handle_stdout_line uses to update last_pong.
        let msg: serde_json::Value = serde_json::from_str(r#"{"type":"pong"}"#).unwrap();
        assert_eq!(
            msg.get("type").and_then(|t| t.as_str()),
            Some("pong"),
            "Pong messages should be detected by type field"
        );
        // Pong messages are NOT terminal — stream_message_terminal_status returns None
        assert_eq!(
            stream_message_terminal_status(&msg),
            None,
            "Pong should not be a terminal status"
        );
    }

    #[tokio::test]
    async fn test_message_without_request_id_detected() {
        // Messages without request_id are logged and skipped.
        let msg: serde_json::Value =
            serde_json::from_str(r#"{"type":"unknown_msg"}"#).unwrap();
        assert!(
            msg.get("request_id").is_none(),
            "Message should lack request_id"
        );
        // Should also not be terminal
        assert_eq!(stream_message_terminal_status(&msg), None);
    }

    #[tokio::test]
    async fn test_request_complete_is_not_terminal() {
        // request_complete is handled separately from terminal outcomes.
        // stream_message_terminal_status should return None for it.
        let msg: serde_json::Value = serde_json::from_str(
            r#"{"type":"request_complete","request_id":"agent-1"}"#,
        )
        .unwrap();
        assert_eq!(
            stream_message_terminal_status(&msg),
            None,
            "request_complete should not be a terminal status"
        );
    }

    #[tokio::test]
    async fn test_turn_complete_is_not_terminal() {
        // turn_complete (agent_event) has its own handling in handle_stdout_line
        // and should NOT be detected as terminal by stream_message_terminal_status.
        let msg = serde_json::json!({
            "type": "agent_event",
            "request_id": "agent-1",
            "event": {
                "type": "turn_complete",
                "streaming": true,
            }
        });
        assert_eq!(
            stream_message_terminal_status(&msg),
            None,
            "turn_complete should not be a terminal status"
        );
    }

    #[tokio::test]
    async fn test_session_exhausted_is_not_terminal() {
        // session_exhausted (agent_event) has its own handling and should
        // NOT be detected as terminal by stream_message_terminal_status.
        let msg = serde_json::json!({
            "type": "agent_event",
            "request_id": "agent-1",
            "event": {
                "type": "session_exhausted",
            }
        });
        assert_eq!(
            stream_message_terminal_status(&msg),
            None,
            "session_exhausted should not be a terminal status"
        );
    }
}
