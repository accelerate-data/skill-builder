# Agent Event Contracts

As-built reference for all Tauri events emitted from the Rust backend to the React frontend.
All payload structs live in `app/src-tauri/src/contracts/agent_events.rs` (canonical Rust types).
TypeScript types are generated from Rust via codegen into `app/src/generated/contracts.ts` and
`app/sidecar/generated/contracts.ts`. Frontend listener registration lives in
`app/src/hooks/use-agent-stream.ts`.

---

## Event Inventory

### `agent-exit`

Emitted by `handle_sidecar_exit` when the Node.js sidecar process terminates.

**Rust struct:** `AgentExitPayload`

| Field | Type | Description |
|---|---|---|
| `agent_id` | `String` | Identifier of the agent that exited |
| `success` | `bool` | `true` if the process exited cleanly (exit code 0) |

---

### `agent-shutdown`

Emitted by `handle_agent_shutdown` when an agent is stopped via a graceful shutdown command
(e.g. `cleanup_skill_sidecar`, `graceful_shutdown`).

**Rust struct:** `AgentShutdownPayload`

| Field | Type | Description |
|---|---|---|
| `agent_id` | `String` | Identifier of the agent that was shut down |

---

### `agent-init-error`

Emitted by `emit_init_error` (sidecar startup failure) and `emit_runtime_error`
(runtime failure detected from agent output, e.g. authentication failure).

**Rust struct:** `AgentInitError`

| Field | Type | Description |
|---|---|---|
| `error_type` | `String` | Machine-readable error category (e.g. `invalid_api_key`) |
| `message` | `String` | Human-readable description of the failure |
| `fix_hint` | `String` | Actionable hint shown to the user |

---

### `agent-message`

Emitted by `handle_sidecar_message` for all raw sidecar protocol messages that are not
internally consumed (i.e. everything except `run_result` and structured `agent_event` subtypes).

**Rust struct:** `AgentEvent`

| Field | Type | Description |
|---|---|---|
| `agent_id` | `String` | Identifier of the originating agent |
| `message` | `serde_json::Value` | Full JSON message from the sidecar |

> **Note:** Individual structured agent events (run_config, turn_usage, etc.) are now typed
> via the `AgentEvent` tagged union in `contracts/agent_events.rs` rather than remaining
> as opaque `serde_json::Value`. The `agent-message` channel still carries untyped JSON for
> messages that are not internally consumed structured events.

---

### `agent-run-config`

Emitted when the sidecar fires a `run_config` agent event.

**Payload shape:** `{ agent_id, timestamp, type, thinkingEnabled, agentName? }`

---

### `agent-run-init`

Emitted when the sidecar fires a `run_init` agent event (SDK session established).

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

Emitted during sidecar startup to report initialization stages.

**Payload shape:** `{ agent_id, timestamp, type, stage }` where `stage` is `"init_start"` or `"sdk_ready"`.

---

### `agent-turn-complete`

Emitted after each assistant turn completes.

**Payload shape:** `{ agent_id, timestamp, type, streaming }`

---

## Error Payload Notes

The `agent-init-error` channel is shared between startup errors (`SidecarStartupError`) and
runtime errors detected from agent output (e.g. authentication failures detected by
`is_authentication_error`). Both paths produce an `AgentInitError` payload.

**Error classification does not happen in Rust.** The Rust layer emits the raw
`success: bool` on `agent-exit` and structured `error_type` / `message` / `fix_hint` on
`agent-init-error`. All higher-level run status classification (e.g. mapping `success=false`
to a terminal `"error"` state) is performed in `app/src/stores/agent-store.ts` (introduced in
VU-552). Rust is intentionally kept free of UI-level status semantics.

---

## Structured Agent Event Payload Pattern

For sidecar-originated `agent_event` messages (all events except `agent-exit`,
`agent-shutdown`, `agent-init-error`, and `agent-message`), Rust merges the event fields
into a common envelope via `build_frontend_event_payload`:

```text
{
  agent_id:  string   — added by Rust
  timestamp: number   — taken from the sidecar message envelope
  type:      string   — from the inner event object
  ...rest            — all other fields from the inner event object
}
```

This means frontend payload types have the shape
`{ agent_id: string; timestamp: number } & <EventType>`.

---

## Structured Output Handling

When a workflow step completes, the SDK result message may include:

- `structured_output` — parsed JSON object (when SDK constrained decoding works)
- `result` — text field containing the agent's final output

Due to a known SDK bug ([anthropics/claude-agent-sdk-typescript#277](https://github.com/anthropics/claude-agent-sdk-typescript/issues/277)), `structured_output` is not populated for nested JSON schemas. In this case, the sidecar extracts JSON from the `result` text field via `tryParseJsonFromText`. If both are absent, the sidecar emits `status: "error"` with `errorSubtype: "structured_output_missing"`.

The `result` text field is used when:
- `structured_output` is absent (SDK bug workaround)
- The agent returned an error (non-JSON output)

Rust is the final validator — it deserializes the extracted JSON into typed contract structs.

---

## Source References

- Canonical Rust contract types (agent events): `app/src-tauri/src/contracts/agent_events.rs`
- Canonical Rust contract types (workflow outputs): `app/src-tauri/src/contracts/workflow_outputs.rs`
- Rust emit logic: `app/src-tauri/src/agents/events.rs`
- Generated TypeScript types: `app/src/generated/contracts.ts`, `app/sidecar/generated/contracts.ts`
- Generated JSON Schema (inline): `agent-sources/plugins/skill-content-researcher/shared/output-schemas/`
- Generated JSON Schema (deep, with `$ref`): `agent-sources/plugins/skill-content-researcher/shared/output-deep-schemas/`
- Sidecar message processing: `app/sidecar/message-processor.ts`
- Sidecar JSON extraction: `app/sidecar/lib/result-extraction.ts`
- Frontend listener registration: `app/src/hooks/use-agent-stream.ts`
- Frontend TypeScript event types: `app/src/lib/agent-events.ts`
- Frontend run state and error classification: `app/src/stores/agent-store.ts`
