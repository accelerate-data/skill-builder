# Agent Event Contracts

As-built reference for all Tauri events emitted from the Rust backend to the React frontend.
All payload structs live in `app/src-tauri/src/contracts/agent_events.rs` (canonical Rust types).
TypeScript types are generated from Rust via codegen into `app/src/generated/contracts.ts`.
Frontend listener registration lives in `app/src/hooks/use-agent-stream.ts`.

---

## Event Inventory

### `agent-exit`

Emitted by `handle_runtime_exit` when the runtime agent process terminates.

**Rust struct:** `AgentExitPayload`

| Field | Type | Description |
|---|---|---|
| `agent_id` | `String` | Identifier of the agent that exited |
| `success` | `bool` | `true` if the process exited cleanly (exit code 0) |

---

### `agent-shutdown`

Emitted by `handle_agent_shutdown` when an agent is stopped via a graceful shutdown command
(e.g. `graceful_shutdown`).

**Rust struct:** `AgentShutdownPayload`

| Field | Type | Description |
|---|---|---|
| `agent_id` | `String` | Identifier of the agent that was shut down |

---

### `agent-init-error`

Emitted by `emit_init_error` (runtime startup failure) and `emit_runtime_error`
(runtime failure detected from agent output, e.g. authentication failure).

**Rust struct:** `AgentInitError`

| Field | Type | Description |
|---|---|---|
| `error_type` | `String` | Machine-readable error category (e.g. `invalid_api_key`) |
| `message` | `String` | Human-readable description of the failure |
| `fix_hint` | `String` | Actionable hint shown to the user |

---

### `agent-message`

Emitted by `handle_runtime_message` for all raw runtime protocol messages that are not
internally consumed (i.e. everything except `run_result` and structured `agent_event` subtypes).

**Rust struct:** `AgentEvent`

| Field | Type | Description |
|---|---|---|
| `agent_id` | `String` | Identifier of the originating agent |
| `message` | `serde_json::Value` | Full JSON message from the runtime |

> **Note:** Individual structured agent events (run_config, turn_usage, etc.) are now typed
> via the `AgentEvent` tagged union in `contracts/agent_events.rs` rather than remaining
> as opaque `serde_json::Value`. The `agent-message` channel still carries untyped JSON for
> messages that are not internally consumed structured events.

---

### `agent-run-config`

Emitted when the runtime emits a `run_config` agent event.

**Payload shape:** `{ agent_id, timestamp, type, thinkingEnabled, agentName? }`

---

### `agent-run-init`

Emitted when the runtime emits a `run_init` agent event (SDK session established).

**Payload shape:** `{ agent_id, timestamp, type, sessionId, model }`

---

### `agent-turn-usage`

Emitted after each agent turn with token usage metrics.

**Payload shape:** `{ agent_id, timestamp, type, turn, inputTokens, outputTokens }`

---

### `agent-compaction`

Emitted when the agent context window is compacted.

**Payload shape:** `{ agent_id, timestamp, type, turn, preTokens, timestamp }`

---

### `agent-context-window`

Emitted to report the current context window size.

**Payload shape:** `{ agent_id, timestamp, type, contextWindow }`

---

### `agent-session-exhausted`

Emitted when a refine session has reached its message limit.

**Payload shape:** `{ agent_id, timestamp, type, sessionId }`

---

### `agent-init-progress`

Emitted during runtime startup to report initialization stages.

**Payload shape:** `{ agent_id, timestamp, type, stage }` where `stage` is `"init_start"` or `"runtime_ready"`.

---

### `agent-turn-complete`

Emitted after each assistant turn completes.

**Payload shape:** `{ agent_id, timestamp, type, streaming }`

---

## Error Payload Notes

The `agent-init-error` channel is shared between startup errors and
runtime errors detected from agent output (e.g. authentication failures detected by
`is_authentication_error`). Both paths produce an `AgentInitError` payload.

**Error classification does not happen in Rust.** The Rust layer emits the raw
`success: bool` on `agent-exit` and structured `error_type` / `message` / `fix_hint` on
`agent-init-error`. All higher-level run status classification (e.g. mapping `success=false`
to a terminal `"error"` state) is performed in `app/src/stores/agent-store.ts` (introduced in
VU-552). Rust is intentionally kept free of UI-level status semantics.

---

## Structured Agent Event Payload Pattern

For runtime-originated `agent_event` messages (all events except `agent-exit`,
`agent-shutdown`, `agent-init-error`, and `agent-message`), Rust merges the event fields
into a common envelope via `build_frontend_event_payload`:

```text
{
  agent_id:  string   — added by Rust
  timestamp: number   — taken from the runtime message envelope
  type:      string   — from the inner event object
  ...rest            — all other fields from the inner event object
}
```

This means frontend payload types have the shape
`{ agent_id: string; timestamp: number } & <EventType>`.

---

## RunResultEvent Fields

The `run_result` event (emitted at the end of every agent run) carries the complete run summary. Key fields added since the initial implementation:

| Field | Type | Notes |
|---|---|---|
| `skill_name` | `String` | Skill that was run |
| `step_id` | `i64` | Workflow step index |
| `plugin_slug` | `String` | Plugin that owns the skill |
| `model` | `String` | Primary model used |
| `input_tokens` | `i64` | Total input tokens |
| `output_tokens` | `i64` | Total output tokens |
| `cache_read_tokens` | `i64` | Prompt-cache read tokens |
| `cache_write_tokens` | `i64` | Prompt-cache write tokens |
| `total_cost_usd` | `f64` | Aggregate cost |
| `model_usage_breakdown` | `Vec<ModelUsageEntry>` | Per-model token/cost breakdown for multi-model runs |
| `context_window` | `i64` | Final context window size |
| `num_turns` | `i64` | Agent turns taken |
| `duration_ms` | `i64` | Wall-clock duration |
| `duration_api_ms` | `i64?` | Time spent waiting for API responses |
| `tool_use_count` | `i64` | Total tool calls |
| `compaction_count` | `i64` | Number of context compactions |
| `status` | `RunResultStatus` | Terminal status: `completed`, `error`, or `shutdown` |
| `run_source` | `RunSource?` | Discriminator: `workflow`, `refine`, or `test` |
| `result_subtype` | `String?` | Fine-grained classification of the result type |
| `result_errors` | `Vec<String>?` | Error messages when `status = error` |
| `result_text` | `String?` | Raw agent output text |
| `workspace_path` | `String?` | Working directory used for the run |
| `workflow_session_id` | `String?` | Links to `workflow_sessions` |
| `usage_session_id` | `String?` | Links to usage tracking session |
| `stop_reason` | `String?` | SDK stop reason (e.g. `end_turn`, `max_turns`) |

`ModelUsageEntry` carries `model`, `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens`, `cost`.

## Structured Output Handling

When a workflow step completes, the result message may include:

- `result_text` — the agent's final output text
- `structured_output` — optional parsed JSON; the OpenHands Agent Server delivers structured output via the conversation state, which Rust extracts from the result text

For JSON-contract runs, the app extracts a JSON object from the terminal result text and forwards that object to Rust validation. If no parseable JSON object is present, the run fails with `result_subtype: "structured_output_missing"`.

The `result_text` field is used when:

- The run has no structured-output contract
- The agent returned an error (non-JSON output)

Rust is the final validator — it deserializes the extracted JSON object into typed contract structs defined in `contracts/workflow_outputs.rs`, `contracts/clarifications.rs`, and `contracts/decisions.rs`.

---

## Source References

- Canonical Rust contract types (agent events): `app/src-tauri/src/contracts/agent_events.rs`
- Canonical Rust contract types (workflow outputs): `app/src-tauri/src/contracts/workflow_outputs.rs`
- Canonical Rust contract types (clarifications): `app/src-tauri/src/contracts/clarifications.rs`
- Canonical Rust contract types (decisions): `app/src-tauri/src/contracts/decisions.rs`
- Canonical Rust contract types (workflow artifacts): `app/src-tauri/src/contracts/workflow_artifacts.rs`
- Rust emit logic: `app/src-tauri/src/agents/events.rs`
- Rust event routing: `app/src-tauri/src/agents/event_router.rs`
- Generated TypeScript types: `app/src/generated/contracts.ts`
- Generated JSON Schema (inline, no `$ref`): `agent-sources/workspace/skills/shared/output-schemas/`
- Frontend listener registration: `app/src/hooks/use-agent-stream.ts`
- Frontend TypeScript event types: `app/src/lib/agent-events.ts`
- Frontend run state and error classification: `app/src/stores/agent-store.ts`
