//! Canonical agent event contract types.
//!
//! These types mirror the TypeScript definitions in `app/sidecar/agent-events.ts`
//! and serve as the single source of truth for the agent event JSON schema.
//! The sidecar uses camelCase in JSON, so all structs use `rename_all = "camelCase"`.

/// Current version of the agent events protocol.
pub const AGENT_EVENTS_VERSION: u32 = 3;

/// Per-model token usage breakdown.
#[derive(
    Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type, schemars::JsonSchema,
)]
#[serde(rename_all = "camelCase")]
pub struct ModelUsageEntry {
    pub model: String,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cache_read_tokens: i64,
    pub cache_write_tokens: i64,
    pub cost: f64,
}

/// Configuration event emitted at the start of a run.
#[derive(
    Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type, schemars::JsonSchema,
)]
#[serde(rename_all = "camelCase")]
pub struct RunConfigEvent {
    pub thinking_enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_name: Option<String>,
}

/// Initialization event with session and model info.
#[derive(
    Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type, schemars::JsonSchema,
)]
#[serde(rename_all = "camelCase")]
pub struct RunInitEvent {
    pub session_id: String,
    pub model: String,
}

/// Per-turn token usage.
#[derive(
    Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type, schemars::JsonSchema,
)]
#[serde(rename_all = "camelCase")]
pub struct TurnUsageEvent {
    pub turn: i64,
    pub input_tokens: i64,
    pub output_tokens: i64,
}

/// Context compaction event.
#[derive(
    Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type, schemars::JsonSchema,
)]
#[serde(rename_all = "camelCase")]
pub struct CompactionEvent {
    pub turn: i64,
    pub pre_tokens: i64,
    pub timestamp: f64,
}

/// Context window size event.
#[derive(
    Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type, schemars::JsonSchema,
)]
#[serde(rename_all = "camelCase")]
pub struct ContextWindowEvent {
    pub context_window: i64,
}

/// Session exhausted event.
#[derive(
    Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type, schemars::JsonSchema,
)]
#[serde(rename_all = "camelCase")]
pub struct SessionExhaustedEvent {
    pub session_id: String,
}

/// Progress stage during agent initialization.
#[derive(
    Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type, schemars::JsonSchema,
)]
#[serde(rename_all = "snake_case")]
pub enum InitProgressStage {
    InitStart,
    RuntimeReady,
}

/// Initialization progress event.
#[derive(
    Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type, schemars::JsonSchema,
)]
#[serde(rename_all = "camelCase")]
pub struct InitProgressEvent {
    pub stage: InitProgressStage,
}

/// Turn completion event.
#[derive(
    Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type, schemars::JsonSchema,
)]
#[serde(rename_all = "camelCase")]
pub struct TurnCompleteEvent {
    pub streaming: bool,
}

/// Terminal status of a run.
#[derive(
    Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type, schemars::JsonSchema,
)]
#[serde(rename_all = "snake_case")]
pub enum RunResultStatus {
    Completed,
    Error,
    Shutdown,
}

/// Source that triggered the run.
#[derive(
    Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type, schemars::JsonSchema,
)]
#[serde(rename_all = "snake_case")]
pub enum RunSource {
    Workflow,
    Refine,
    Test,
}

/// Terminal event with full run summary and token usage.
#[derive(
    Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type, schemars::JsonSchema,
)]
#[serde(rename_all = "camelCase")]
pub struct RunResultEvent {
    pub skill_name: String,
    pub step_id: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workflow_session_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub usage_session_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub run_source: Option<RunSource>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    pub model: String,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cache_read_tokens: i64,
    pub cache_write_tokens: i64,
    pub total_cost_usd: f64,
    pub model_usage_breakdown: Vec<ModelUsageEntry>,
    pub context_window: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result_subtype: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result_errors: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stop_reason: Option<String>,
    pub num_turns: i64,
    pub duration_ms: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration_api_ms: Option<i64>,
    pub tool_use_count: i64,
    pub compaction_count: i64,
    pub status: RunResultStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result_text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workspace_path: Option<String>,
    pub plugin_slug: String,
}

/// Tagged union of all agent event types.
///
/// Uses `"type"` as the discriminator field with snake_case variant names,
/// matching the TypeScript `AgentEvent` union.
#[derive(
    Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type, schemars::JsonSchema,
)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AgentEvent {
    RunConfig(RunConfigEvent),
    RunInit(RunInitEvent),
    TurnUsage(TurnUsageEvent),
    Compaction(CompactionEvent),
    ContextWindow(ContextWindowEvent),
    SessionExhausted(SessionExhaustedEvent),
    InitProgress(InitProgressEvent),
    TurnComplete(TurnCompleteEvent),
    RunResult(Box<RunResultEvent>),
}

/// Wrapper envelope for agent events, matching the sidecar `AgentEventEnvelope`.
///
/// The sidecar envelope has `type: "agent_event"` as a literal discriminator
/// plus the nested `event` and `timestamp` fields.
#[derive(
    Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type, schemars::JsonSchema,
)]
pub struct AgentEventEnvelope {
    /// Always `"agent_event"` — discriminator for the outer message type.
    #[serde(rename = "type")]
    pub type_: String,
    pub event: AgentEvent,
    pub timestamp: f64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_agent_events_version() {
        assert_eq!(AGENT_EVENTS_VERSION, 3);
    }

    #[test]
    fn test_model_usage_entry_round_trip() {
        let entry = ModelUsageEntry {
            model: "claude-sonnet-4-20250514".to_string(),
            input_tokens: 1000,
            output_tokens: 500,
            cache_read_tokens: 200,
            cache_write_tokens: 100,
            cost: 0.05,
        };

        let json = serde_json::to_string(&entry).expect("serialize");
        assert!(json.contains("\"inputTokens\":1000"));
        assert!(json.contains("\"outputTokens\":500"));
        assert!(json.contains("\"cacheReadTokens\":200"));
        assert!(json.contains("\"cacheWriteTokens\":100"));

        let deserialized: ModelUsageEntry = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(deserialized.model, "claude-sonnet-4-20250514");
        assert_eq!(deserialized.input_tokens, 1000);
        assert!((deserialized.cost - 0.05).abs() < f64::EPSILON);
    }

    #[test]
    fn test_run_config_event_camel_case() {
        let event = RunConfigEvent {
            thinking_enabled: true,
            agent_name: Some("research-orchestrator".to_string()),
        };

        let json = serde_json::to_string(&event).expect("serialize");
        assert!(json.contains("\"thinkingEnabled\":true"));
        assert!(json.contains("\"agentName\":\"research-orchestrator\""));

        let deserialized: RunConfigEvent = serde_json::from_str(&json).expect("deserialize");
        assert!(deserialized.thinking_enabled);
        assert_eq!(
            deserialized.agent_name.as_deref(),
            Some("research-orchestrator")
        );
    }

    #[test]
    fn test_run_config_event_optional_absent() {
        let json = r#"{"thinkingEnabled": false}"#;
        let event: RunConfigEvent = serde_json::from_str(json).expect("deserialize");
        assert!(!event.thinking_enabled);
        assert!(event.agent_name.is_none());

        let reserialized = serde_json::to_string(&event).expect("serialize");
        assert!(!reserialized.contains("agentName"));
    }

    #[test]
    fn test_tagged_union_run_config() {
        let event = AgentEvent::RunConfig(RunConfigEvent {
            thinking_enabled: true,
            agent_name: None,
        });

        let json = serde_json::to_string(&event).expect("serialize");
        assert!(json.contains("\"type\":\"run_config\""));
        assert!(json.contains("\"thinkingEnabled\":true"));

        let deserialized: AgentEvent = serde_json::from_str(&json).expect("deserialize");
        match deserialized {
            AgentEvent::RunConfig(e) => assert!(e.thinking_enabled),
            other => panic!("expected RunConfig, got {:?}", other),
        }
    }

    #[test]
    fn test_tagged_union_run_init() {
        let json =
            r#"{"type": "run_init", "sessionId": "sess-123", "model": "claude-sonnet-4-20250514"}"#;
        let event: AgentEvent = serde_json::from_str(json).expect("deserialize");
        match event {
            AgentEvent::RunInit(e) => {
                assert_eq!(e.session_id, "sess-123");
                assert_eq!(e.model, "claude-sonnet-4-20250514");
            }
            other => panic!("expected RunInit, got {:?}", other),
        }
    }

    #[test]
    fn test_tagged_union_turn_usage() {
        let json = r#"{"type": "turn_usage", "turn": 3, "inputTokens": 500, "outputTokens": 200}"#;
        let event: AgentEvent = serde_json::from_str(json).expect("deserialize");
        match event {
            AgentEvent::TurnUsage(e) => {
                assert_eq!(e.turn, 3);
                assert_eq!(e.input_tokens, 500);
                assert_eq!(e.output_tokens, 200);
            }
            other => panic!("expected TurnUsage, got {:?}", other),
        }
    }

    #[test]
    fn test_tagged_union_compaction() {
        let json =
            r#"{"type": "compaction", "turn": 5, "preTokens": 50000, "timestamp": 1700000000.0}"#;
        let event: AgentEvent = serde_json::from_str(json).expect("deserialize");
        match event {
            AgentEvent::Compaction(e) => {
                assert_eq!(e.turn, 5);
                assert_eq!(e.pre_tokens, 50000);
            }
            other => panic!("expected Compaction, got {:?}", other),
        }
    }

    #[test]
    fn test_tagged_union_context_window() {
        let json = r#"{"type": "context_window", "contextWindow": 200000}"#;
        let event: AgentEvent = serde_json::from_str(json).expect("deserialize");
        match event {
            AgentEvent::ContextWindow(e) => assert_eq!(e.context_window, 200000),
            other => panic!("expected ContextWindow, got {:?}", other),
        }
    }

    #[test]
    fn test_tagged_union_session_exhausted() {
        let json = r#"{"type": "session_exhausted", "sessionId": "sess-abc"}"#;
        let event: AgentEvent = serde_json::from_str(json).expect("deserialize");
        match event {
            AgentEvent::SessionExhausted(e) => assert_eq!(e.session_id, "sess-abc"),
            other => panic!("expected SessionExhausted, got {:?}", other),
        }
    }

    #[test]
    fn test_tagged_union_init_progress() {
        let json = r#"{"type": "init_progress", "stage": "runtime_ready"}"#;
        let event: AgentEvent = serde_json::from_str(json).expect("deserialize");
        match event {
            AgentEvent::InitProgress(e) => match e.stage {
                InitProgressStage::RuntimeReady => {}
                other => panic!("expected RuntimeReady, got {:?}", other),
            },
            other => panic!("expected InitProgress, got {:?}", other),
        }
    }

    #[test]
    fn test_tagged_union_turn_complete() {
        let json = r#"{"type": "turn_complete", "streaming": true}"#;
        let event: AgentEvent = serde_json::from_str(json).expect("deserialize");
        match event {
            AgentEvent::TurnComplete(e) => assert!(e.streaming),
            other => panic!("expected TurnComplete, got {:?}", other),
        }
    }

    #[test]
    fn test_init_progress_stage_snake_case() {
        let cases = vec![
            (InitProgressStage::InitStart, "\"init_start\""),
            (InitProgressStage::RuntimeReady, "\"runtime_ready\""),
        ];
        for (stage, expected) in cases {
            let json = serde_json::to_string(&stage).expect("serialize");
            assert_eq!(json, expected);
        }
    }

    #[test]
    fn test_run_result_status_snake_case() {
        let cases = vec![
            (RunResultStatus::Completed, "\"completed\""),
            (RunResultStatus::Error, "\"error\""),
            (RunResultStatus::Shutdown, "\"shutdown\""),
        ];
        for (status, expected) in cases {
            let json = serde_json::to_string(&status).expect("serialize");
            assert_eq!(json, expected);
        }
    }

    #[test]
    fn test_run_source_snake_case() {
        let cases = vec![
            (RunSource::Workflow, "\"workflow\""),
            (RunSource::Refine, "\"refine\""),
            (RunSource::Test, "\"test\""),
        ];
        for (source, expected) in cases {
            let json = serde_json::to_string(&source).expect("serialize");
            assert_eq!(json, expected);
        }
    }

    #[test]
    fn test_tagged_union_run_result_minimal() {
        let json = serde_json::json!({
            "type": "run_result",
            "skillName": "my-skill",
            "stepId": 0,
            "model": "claude-sonnet-4-20250514",
            "inputTokens": 1000,
            "outputTokens": 500,
            "cacheReadTokens": 0,
            "cacheWriteTokens": 0,
            "totalCostUsd": 0.01,
            "modelUsageBreakdown": [],
            "contextWindow": 200000,
            "numTurns": 3,
            "durationMs": 5000,
            "toolUseCount": 2,
            "compactionCount": 0,
            "status": "completed",
            "pluginSlug": "my-plugin"
        });

        let event: AgentEvent = serde_json::from_value(json).expect("deserialize");
        match event {
            AgentEvent::RunResult(e) => {
                assert_eq!(e.skill_name, "my-skill");
                assert_eq!(e.step_id, 0);
                assert_eq!(e.num_turns, 3);
                assert_eq!(e.plugin_slug, "my-plugin");
                assert!(e.workflow_session_id.is_none());
                assert!(e.result_text.is_none());
                match e.status {
                    RunResultStatus::Completed => {}
                    other => panic!("expected Completed, got {:?}", other),
                }
            }
            other => panic!("expected RunResult, got {:?}", other),
        }
    }

    #[test]
    fn test_tagged_union_run_result_full() {
        let json = serde_json::json!({
            "type": "run_result",
            "skillName": "my-skill",
            "stepId": 2,
            "workflowSessionId": "ws-123",
            "usageSessionId": "us-456",
            "runSource": "workflow",
            "sessionId": "sess-789",
            "model": "claude-sonnet-4-20250514",
            "inputTokens": 5000,
            "outputTokens": 2000,
            "cacheReadTokens": 1000,
            "cacheWriteTokens": 500,
            "totalCostUsd": 0.15,
            "modelUsageBreakdown": [
                {
                    "model": "claude-sonnet-4-20250514",
                    "inputTokens": 5000,
                    "outputTokens": 2000,
                    "cacheReadTokens": 1000,
                    "cacheWriteTokens": 500,
                    "cost": 0.15
                }
            ],
            "contextWindow": 200000,
            "resultSubtype": "research",
            "resultErrors": ["timeout"],
            "stopReason": "end_turn",
            "numTurns": 10,
            "durationMs": 30000,
            "durationApiMs": 25000,
            "toolUseCount": 15,
            "compactionCount": 1,
            "status": "error",
            "resultText": "Partial output",
            "workspacePath": "/tmp/workspace",
            "pluginSlug": "my-plugin"
        });

        let event: AgentEvent = serde_json::from_value(json).expect("deserialize");
        match event {
            AgentEvent::RunResult(e) => {
                assert_eq!(e.workflow_session_id.as_deref(), Some("ws-123"));
                assert_eq!(e.usage_session_id.as_deref(), Some("us-456"));
                assert_eq!(e.duration_api_ms, Some(25000));
                assert_eq!(e.model_usage_breakdown.len(), 1);
                assert_eq!(e.result_errors.as_ref().unwrap().len(), 1);
                assert_eq!(e.plugin_slug, "my-plugin");
                match e.run_source {
                    Some(RunSource::Workflow) => {}
                    other => panic!("expected Some(Workflow), got {:?}", other),
                }
                match e.status {
                    RunResultStatus::Error => {}
                    other => panic!("expected Error, got {:?}", other),
                }
            }
            other => panic!("expected RunResult, got {:?}", other),
        }
    }

    #[test]
    fn test_agent_event_envelope_round_trip() {
        let envelope = AgentEventEnvelope {
            type_: "agent_event".to_string(),
            event: AgentEvent::TurnComplete(TurnCompleteEvent { streaming: false }),
            timestamp: 1700000000.123,
        };

        let json = serde_json::to_string(&envelope).expect("serialize");
        assert!(json.contains("\"type\":\"agent_event\""));

        let deserialized: AgentEventEnvelope = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(deserialized.type_, "agent_event");
        assert!((deserialized.timestamp - 1700000000.123).abs() < f64::EPSILON);
        match deserialized.event {
            AgentEvent::TurnComplete(e) => assert!(!e.streaming),
            other => panic!("expected TurnComplete, got {:?}", other),
        }
    }

    #[test]
    fn test_envelope_from_sidecar_json() {
        // Simulate what the sidecar sends: outer type + nested event with its own type
        let json = r#"{
            "type": "agent_event",
            "event": {
                "type": "context_window",
                "contextWindow": 128000
            },
            "timestamp": 1700000001.5
        }"#;

        let envelope: AgentEventEnvelope = serde_json::from_str(json).expect("deserialize");
        assert_eq!(envelope.type_, "agent_event");
        match envelope.event {
            AgentEvent::ContextWindow(e) => assert_eq!(e.context_window, 128000),
            other => panic!("expected ContextWindow, got {:?}", other),
        }
    }
}
