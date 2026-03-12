use serde::{Deserialize, Serialize};
use tauri::Emitter;

use super::sidecar_pool::SidecarStartupError;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentEvent {
    pub agent_id: String,
    pub message: serde_json::Value,
}

/// Payload for early initialization progress events (`init_start`, `sdk_ready`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentInitProgress {
    pub agent_id: String,
    pub subtype: String,
    pub timestamp: u64,
}

/// Payload for sidecar startup error events sent to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentInitError {
    pub error_type: String,
    pub message: String,
    pub fix_hint: String,
}

/// Payload for agent-metadata events (forwarded from sidecar to frontend).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentMetadataEvent {
    pub agent_id: String,
    pub data: serde_json::Value,
    pub timestamp: u64,
}

/// Per-model usage entry from sidecar run_summary.
#[derive(Debug, Clone, Deserialize)]
pub struct SidecarModelUsageEntry {
    pub model: String,
    #[serde(rename = "inputTokens")]
    pub input_tokens: i32,
    #[serde(rename = "outputTokens")]
    pub output_tokens: i32,
    #[serde(rename = "cacheReadTokens")]
    pub cache_read_tokens: i32,
    #[serde(rename = "cacheWriteTokens")]
    pub cache_write_tokens: i32,
    pub cost: f64,
}

/// Self-contained run summary from the sidecar.
/// Some fields are deserialized for protocol completeness but not yet
/// persisted to DB — suppress dead_code until the insert is wired up.
#[derive(Debug, Clone, Deserialize)]
#[allow(dead_code)]
pub struct SidecarRunSummary {
    #[serde(rename = "skillName")]
    pub skill_name: String,
    #[serde(rename = "stepId")]
    pub step_id: i32,
    #[serde(rename = "workflowSessionId")]
    pub workflow_session_id: Option<String>,
    #[serde(rename = "usageSessionId")]
    pub usage_session_id: Option<String>,
    #[serde(rename = "runSource")]
    pub run_source: Option<String>,
    #[serde(rename = "sessionId")]
    pub session_id: Option<String>,
    pub model: String,
    #[serde(rename = "inputTokens")]
    pub input_tokens: i32,
    #[serde(rename = "outputTokens")]
    pub output_tokens: i32,
    #[serde(rename = "cacheReadTokens")]
    pub cache_read_tokens: i32,
    #[serde(rename = "cacheWriteTokens")]
    pub cache_write_tokens: i32,
    #[serde(rename = "totalCostUsd")]
    pub total_cost_usd: f64,
    #[serde(rename = "modelUsageBreakdown")]
    pub model_usage_breakdown: Vec<SidecarModelUsageEntry>,
    #[serde(rename = "contextWindow")]
    pub context_window: i64,
    #[serde(rename = "resultSubtype")]
    pub result_subtype: Option<String>,
    #[serde(rename = "resultErrors")]
    pub result_errors: Option<Vec<String>>,
    #[serde(rename = "stopReason")]
    pub stop_reason: Option<String>,
    #[serde(rename = "numTurns")]
    pub num_turns: i32,
    #[serde(rename = "durationMs")]
    pub duration_ms: i64,
    #[serde(rename = "durationApiMs")]
    pub duration_api_ms: Option<i64>,
    #[serde(rename = "toolUseCount")]
    pub tool_use_count: i32,
    #[serde(rename = "compactionCount")]
    pub compaction_count: i32,
    pub status: String,
}

#[derive(Debug)]
enum SidecarMessageAction {
    PersistRunSummary(Box<SidecarRunSummary>),
    EmitMetadata(AgentMetadataEvent),
    EmitInitProgress(AgentInitProgress),
    ForwardAgentMessage(AgentEvent),
}

fn route_sidecar_message(
    agent_id: &str,
    message: serde_json::Value,
) -> Option<SidecarMessageAction> {
    let msg_type = message
        .get("type")
        .and_then(|t| t.as_str())
        .unwrap_or("unknown");

    if msg_type == "run_summary" {
        log::debug!("[event:run_summary:{}] intercepted", agent_id);
        return match message.get("data") {
            Some(data) => match serde_json::from_value::<SidecarRunSummary>(data.clone()) {
                Ok(summary) => Some(SidecarMessageAction::PersistRunSummary(Box::new(summary))),
                Err(e) => {
                    log::error!(
                        "[event:run_summary:{}] Failed to deserialize: {}",
                        agent_id,
                        e
                    );
                    None
                }
            },
            None => {
                log::error!("[event:run_summary:{}] Missing 'data' field", agent_id);
                None
            }
        };
    }

    if msg_type == "metadata" {
        log::debug!("[event:agent-metadata:{}] forwarding metadata", agent_id);
        return match message.get("data") {
            Some(data) => {
                let timestamp = message
                    .get("timestamp")
                    .and_then(|t| t.as_u64())
                    .unwrap_or(0);
                Some(SidecarMessageAction::EmitMetadata(AgentMetadataEvent {
                    agent_id: agent_id.to_string(),
                    data: data.clone(),
                    timestamp,
                }))
            }
            None => {
                log::warn!(
                    "[event:metadata:{}] Missing 'data' field — skipping",
                    agent_id
                );
                None
            }
        };
    }

    if msg_type == "system" {
        if let Some(subtype) = message.get("subtype").and_then(|s| s.as_str()) {
            if matches!(subtype, "init_start" | "sdk_ready" | "init") {
                let timestamp = message
                    .get("timestamp")
                    .and_then(|t| t.as_u64())
                    .unwrap_or(0);
                return Some(SidecarMessageAction::EmitInitProgress(AgentInitProgress {
                    agent_id: agent_id.to_string(),
                    subtype: subtype.to_string(),
                    timestamp,
                }));
            }
        }
    }

    Some(SidecarMessageAction::ForwardAgentMessage(AgentEvent {
        agent_id: agent_id.to_string(),
        message,
    }))
}

fn persist_run_summary_to_conn(
    conn: &rusqlite::Connection,
    agent_id: &str,
    summary: &SidecarRunSummary,
) {
    // Determine the effective workflow_session_id (prefer workflowSessionId, fallback to usageSessionId)
    let effective_session_id = summary
        .workflow_session_id
        .as_deref()
        .or(summary.usage_session_id.as_deref());

    // Persist one row per model entry or one aggregate row
    if !summary.model_usage_breakdown.is_empty() {
        for entry in &summary.model_usage_breakdown {
            log::info!(
                "[persist_run_summary] agent={} skill={} step={} model={} status={} cost={:.4}",
                agent_id,
                summary.skill_name,
                summary.step_id,
                entry.model,
                summary.status,
                entry.cost
            );
            if let Err(e) = crate::db::persist_agent_run(
                conn,
                agent_id,
                &summary.skill_name,
                summary.step_id,
                &entry.model,
                &summary.status,
                entry.input_tokens,
                entry.output_tokens,
                entry.cache_read_tokens,
                entry.cache_write_tokens,
                entry.cost,
                summary.duration_ms,
                summary.num_turns,
                summary.stop_reason.as_deref(),
                summary.duration_api_ms,
                summary.tool_use_count,
                summary.compaction_count,
                summary.session_id.as_deref(),
                effective_session_id,
            ) {
                log::error!(
                    "[persist_run_summary] Failed to persist for agent={} model={}: {}",
                    agent_id,
                    entry.model,
                    e
                );
            }
        }
    } else {
        // Single aggregate row
        log::info!(
            "[persist_run_summary] agent={} skill={} step={} model={} status={} cost={:.4}",
            agent_id,
            summary.skill_name,
            summary.step_id,
            summary.model,
            summary.status,
            summary.total_cost_usd
        );
        if let Err(e) = crate::db::persist_agent_run(
            conn,
            agent_id,
            &summary.skill_name,
            summary.step_id,
            &summary.model,
            &summary.status,
            summary.input_tokens,
            summary.output_tokens,
            summary.cache_read_tokens,
            summary.cache_write_tokens,
            summary.total_cost_usd,
            summary.duration_ms,
            summary.num_turns,
            summary.stop_reason.as_deref(),
            summary.duration_api_ms,
            summary.tool_use_count,
            summary.compaction_count,
            summary.session_id.as_deref(),
            effective_session_id,
        ) {
            log::error!(
                "[persist_run_summary] Failed to persist aggregate for agent={}: {}",
                agent_id,
                e
            );
        }
    }
}

/// Persist a run summary directly to SQLite (fire-and-forget from the caller's perspective).
pub fn persist_run_summary(
    app_handle: &tauri::AppHandle,
    agent_id: &str,
    summary: &SidecarRunSummary,
) {
    use tauri::Manager;

    let db = match app_handle.try_state::<crate::db::Db>() {
        Some(db) => db,
        None => {
            log::error!(
                "[persist_run_summary] DB state not available for agent={}",
                agent_id
            );
            return;
        }
    };

    let conn = match db.0.lock() {
        Ok(c) => c,
        Err(e) => {
            log::error!(
                "[persist_run_summary] Failed to acquire DB lock for agent={}: {}",
                agent_id,
                e
            );
            return;
        }
    };

    persist_run_summary_to_conn(&conn, agent_id, summary);
}

pub fn handle_sidecar_message(app_handle: &tauri::AppHandle, agent_id: &str, line: &str) {
    match serde_json::from_str::<serde_json::Value>(line) {
        Ok(message) => match route_sidecar_message(agent_id, message) {
            Some(SidecarMessageAction::PersistRunSummary(summary)) => {
                persist_run_summary(app_handle, agent_id, &summary);
            }
            Some(SidecarMessageAction::EmitMetadata(event)) => {
                if let Err(e) = app_handle.emit("agent-metadata", &event) {
                    log::warn!("Failed to emit agent-metadata for {}: {}", agent_id, e);
                }
            }
            Some(SidecarMessageAction::EmitInitProgress(progress)) => {
                log::debug!(
                    "[event:agent-init-progress:{}] {}",
                    agent_id,
                    progress.subtype
                );
                if let Err(e) = app_handle.emit("agent-init-progress", &progress) {
                    log::warn!("Failed to emit agent-init-progress for {}: {}", agent_id, e);
                }
            }
            Some(SidecarMessageAction::ForwardAgentMessage(event)) => {
                let msg_type = event
                    .message
                    .get("type")
                    .and_then(|t| t.as_str())
                    .unwrap_or("unknown");
                if msg_type == "display_item" {
                    let item_type = event
                        .message
                        .get("item")
                        .and_then(|i| i.get("type"))
                        .and_then(|t| t.as_str())
                        .unwrap_or("unknown");
                    let item_id = event
                        .message
                        .get("item")
                        .and_then(|i| i.get("id"))
                        .and_then(|t| t.as_str())
                        .unwrap_or("unknown");
                    log::debug!(
                        "[event:agent-message:{}] display_item type={} id={}",
                        agent_id,
                        item_type,
                        item_id
                    );
                } else {
                    log::debug!(
                        "[event:agent-message:{}] pass_through type={}",
                        agent_id,
                        msg_type
                    );
                }

                if let Err(e) = app_handle.emit("agent-message", &event) {
                    log::warn!("Failed to emit agent-message for {}: {}", agent_id, e);
                }
            }
            None => {}
        },
        Err(e) => {
            log::warn!("Failed to parse sidecar output: {}", e);
        }
    }
}

pub fn handle_sidecar_exit(app_handle: &tauri::AppHandle, agent_id: &str, success: bool) {
    log::info!("[event:agent-exit:{}] success={}", agent_id, success);
    if let Err(e) = app_handle.emit(
        "agent-exit",
        serde_json::json!({
            "agent_id": agent_id,
            "success": success,
        }),
    ) {
        log::warn!(
            "Failed to emit agent-exit for {} (success={}): {}",
            agent_id,
            success,
            e
        );
    }
}

pub fn handle_agent_shutdown(app_handle: &tauri::AppHandle, agent_id: &str) {
    log::info!("[event:agent-shutdown:{}]", agent_id);
    if let Err(e) = app_handle.emit(
        "agent-shutdown",
        serde_json::json!({
            "agent_id": agent_id,
        }),
    ) {
        log::warn!("Failed to emit agent-shutdown for {}: {}", agent_id, e);
    }
}

/// Emit a structured error event when sidecar startup fails.
/// The frontend listens for `agent-init-error` to show an actionable dialog.
pub fn emit_init_error(app_handle: &tauri::AppHandle, error: &SidecarStartupError) {
    let payload = AgentInitError {
        error_type: error.error_type().to_string(),
        message: error.message(),
        fix_hint: error.fix_hint(),
    };
    log::error!(
        "Sidecar startup error [{}]: {} | Fix: {}",
        payload.error_type,
        payload.message,
        payload.fix_hint
    );
    if let Err(e) = app_handle.emit("agent-init-error", &payload) {
        log::error!(
            "Failed to emit agent-init-error [{}]: {}",
            payload.error_type,
            e
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn route_sidecar_message_returns_metadata_event() {
        let message = serde_json::json!({
            "type": "metadata",
            "data": {
                "sessionInit": {
                    "sessionId": "sess-123",
                    "model": "claude-sonnet-4-6"
                }
            },
            "timestamp": 42_u64
        });

        let action = route_sidecar_message("agent-1", message);

        match action {
            Some(SidecarMessageAction::EmitMetadata(event)) => {
                assert_eq!(event.agent_id, "agent-1");
                assert_eq!(event.timestamp, 42);
                assert_eq!(event.data["sessionInit"]["sessionId"], "sess-123");
            }
            other => panic!("expected metadata action, got {:?}", other),
        }
    }

    #[test]
    fn route_sidecar_message_returns_init_progress_event() {
        let message = serde_json::json!({
            "type": "system",
            "subtype": "sdk_ready",
            "timestamp": 99_u64
        });

        let action = route_sidecar_message("agent-2", message);

        match action {
            Some(SidecarMessageAction::EmitInitProgress(progress)) => {
                assert_eq!(progress.agent_id, "agent-2");
                assert_eq!(progress.subtype, "sdk_ready");
                assert_eq!(progress.timestamp, 99);
            }
            other => panic!("expected init progress action, got {:?}", other),
        }
    }

    #[test]
    fn route_sidecar_message_intercepts_run_summary() {
        let message = serde_json::json!({
            "type": "run_summary",
            "data": {
                "skillName": "demo-skill",
                "stepId": 2,
                "workflowSessionId": "wf-123",
                "usageSessionId": null,
                "runSource": "workflow",
                "sessionId": "sdk-session",
                "model": "claude-sonnet-4-6",
                "inputTokens": 120,
                "outputTokens": 45,
                "cacheReadTokens": 6,
                "cacheWriteTokens": 2,
                "totalCostUsd": 0.12,
                "modelUsageBreakdown": [],
                "contextWindow": 200000,
                "resultSubtype": null,
                "resultErrors": null,
                "stopReason": "end_turn",
                "numTurns": 3,
                "durationMs": 4000,
                "durationApiMs": 3500,
                "toolUseCount": 2,
                "compactionCount": 1,
                "status": "completed"
            }
        });

        let action = route_sidecar_message("agent-3", message);

        match action {
            Some(SidecarMessageAction::PersistRunSummary(summary)) => {
                assert_eq!(summary.skill_name, "demo-skill");
                assert_eq!(summary.step_id, 2);
                assert_eq!(summary.workflow_session_id.as_deref(), Some("wf-123"));
            }
            other => panic!("expected run summary action, got {:?}", other),
        }
    }

    #[test]
    fn route_sidecar_message_skips_metadata_without_data() {
        let message = serde_json::json!({
            "type": "metadata",
            "timestamp": 7_u64
        });

        assert!(route_sidecar_message("agent-4", message).is_none());
    }

    #[test]
    fn persist_run_summary_writes_aggregate_row_for_workflow_session() {
        let conn = crate::db::create_test_db_for_tests();
        crate::db::save_workflow_run(&conn, "demo-skill", 2, "in_progress", "domain").unwrap();
        crate::db::create_workflow_session(&conn, "wf-aggregate", "demo-skill", 1000).unwrap();

        let summary = SidecarRunSummary {
            skill_name: "demo-skill".to_string(),
            step_id: 2,
            workflow_session_id: Some("wf-aggregate".to_string()),
            usage_session_id: None,
            run_source: Some("workflow".to_string()),
            session_id: Some("sdk-session".to_string()),
            model: "sonnet".to_string(),
            input_tokens: 120,
            output_tokens: 45,
            cache_read_tokens: 6,
            cache_write_tokens: 2,
            total_cost_usd: 0.12,
            model_usage_breakdown: vec![],
            context_window: 200_000,
            result_subtype: None,
            result_errors: None,
            stop_reason: Some("end_turn".to_string()),
            num_turns: 3,
            duration_ms: 4_000,
            duration_api_ms: Some(3_500),
            tool_use_count: 2,
            compaction_count: 1,
            status: "completed".to_string(),
        };

        persist_run_summary_to_conn(&conn, "agent-aggregate", &summary);

        let runs = crate::db::get_session_agent_runs(&conn, "wf-aggregate").unwrap();
        assert_eq!(runs.len(), 1);
        let run = &runs[0];
        assert_eq!(run.agent_id, "agent-aggregate");
        assert_eq!(run.skill_name, "demo-skill");
        assert_eq!(run.step_id, 2);
        assert_eq!(run.model, "claude-sonnet-4-6");
        assert_eq!(run.input_tokens, 120);
        assert_eq!(run.output_tokens, 45);
        assert_eq!(run.cache_read_tokens, 6);
        assert_eq!(run.cache_write_tokens, 2);
        assert!((run.total_cost - 0.12).abs() < 1e-10);
        assert_eq!(run.session_id.as_deref(), Some("sdk-session"));
    }

    #[test]
    fn persist_run_summary_writes_breakdown_rows_and_falls_back_to_usage_session() {
        let conn = crate::db::create_test_db_for_tests();
        crate::db::save_workflow_run(&conn, "demo-skill", -10, "in_progress", "domain").unwrap();

        let summary = SidecarRunSummary {
            skill_name: "demo-skill".to_string(),
            step_id: -10,
            workflow_session_id: None,
            usage_session_id: Some("synthetic:refine:demo-skill:sess-1".to_string()),
            run_source: Some("refine".to_string()),
            session_id: Some("sdk-session".to_string()),
            model: "unknown".to_string(),
            input_tokens: 0,
            output_tokens: 0,
            cache_read_tokens: 0,
            cache_write_tokens: 0,
            total_cost_usd: 0.0,
            model_usage_breakdown: vec![
                SidecarModelUsageEntry {
                    model: "sonnet".to_string(),
                    input_tokens: 100,
                    output_tokens: 20,
                    cache_read_tokens: 5,
                    cache_write_tokens: 1,
                    cost: 0.10,
                },
                SidecarModelUsageEntry {
                    model: "opus".to_string(),
                    input_tokens: 50,
                    output_tokens: 10,
                    cache_read_tokens: 0,
                    cache_write_tokens: 0,
                    cost: 0.25,
                },
            ],
            context_window: 200_000,
            result_subtype: Some("completed".to_string()),
            result_errors: None,
            stop_reason: Some("end_turn".to_string()),
            num_turns: 2,
            duration_ms: 2_000,
            duration_api_ms: Some(1_500),
            tool_use_count: 1,
            compaction_count: 0,
            status: "completed".to_string(),
        };

        persist_run_summary_to_conn(&conn, "agent-breakdown", &summary);

        let runs =
            crate::db::get_session_agent_runs(&conn, "synthetic:refine:demo-skill:sess-1").unwrap();
        assert_eq!(runs.len(), 2);
        let models: Vec<_> = runs.iter().map(|run| run.model.as_str()).collect();
        assert!(models.contains(&"claude-sonnet-4-6"));
        assert!(models.contains(&"claude-opus-4-6"));
        assert!(runs.iter().all(|run| run.skill_name == "demo-skill"));
        assert!(runs.iter().all(|run| run.step_id == -10));
    }
}
