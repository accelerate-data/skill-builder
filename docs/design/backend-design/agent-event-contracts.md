# Agent Event Contracts

As-built reference for all Tauri events emitted from the Rust backend to the React frontend.
All payload structs live in `app/src-tauri/src/agents/events.rs`. Frontend types that mirror
these payloads live in `app/src/hooks/use-agent-stream.ts`.

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

## Source References

- Rust payload structs and emit logic: `app/src-tauri/src/agents/events.rs`
- Frontend listener registration: `app/src/hooks/use-agent-stream.ts`
- Frontend TypeScript event types: `app/src/lib/agent-events.ts`
- Frontend run state and error classification: `app/src/stores/agent-store.ts`
