# Agent Event Contracts

Target event contract from the Rust backend to the React frontend.

## Contract Sources

The target contract is split across two Rust surfaces:

- `app/src-tauri/src/contracts/agent_events.rs`
  Canonical typed payloads for structured runtime `agent_event` messages.
- `app/src-tauri/src/agents/event_types.rs`
  Auxiliary payloads for non-`agent_event` channels such as `agent-exit`,
  `agent-shutdown`, and `agent-init-error`.

Rust routing and emission live in:

- `app/src-tauri/src/agents/event_router.rs`
- `app/src-tauri/src/agents/openhands_server/events.rs`

Frontend listener registration now lives in `app/src/hooks/use-session-runtime-stream.ts` for typed runtime metadata and `app/src/hooks/use-conversation-stream.ts` for canonical conversation events.

## Event Families

### `agent-message`

Pass-through channel for runtime protocol messages that are not consumed and
re-emitted as dedicated typed frontend events.

Payload:

| Field | Type | Meaning |
|---|---|---|
| `agent_id` | `string` | Originating agent |
| `message` | `unknown JSON` | Raw runtime message |

### `agent-exit`

Terminal process exit notification.

Payload:

| Field | Type | Meaning |
|---|---|---|
| `agent_id` | `string` | Agent that exited |
| `success` | `boolean` | Whether the process exited successfully |
| `error_detail` | `string?` | Optional terminal error detail |

### `agent-shutdown`

Explicit runtime shutdown notification.

Payload:

| Field | Type | Meaning |
|---|---|---|
| `agent_id` | `string` | Agent that was shut down |

### `agent-init-error`

Structured startup or runtime-init failure surfaced to the frontend.

Payload:

| Field | Type | Meaning |
|---|---|---|
| `error_type` | `string` | Machine-readable category |
| `message` | `string` | Human-readable failure |
| `fix_hint` | `string` | User-facing remediation hint |

## Structured Runtime Event Channels

The backend emits dedicated channels for structured runtime `agent_event`
payloads:

- `agent-run-config`
- `agent-run-init`
- `agent-turn-usage`
- `agent-compaction`
- `agent-context-window`
- `agent-session-exhausted`
- `agent-init-progress`
- `agent-turn-complete`

Target payload shape for each of these channels is:

```text
{
  agent_id: string,
  timestamp: number,
  type: string,
  ...event-specific fields
}
```

The common envelope is built in `event_router.rs` before the payload is emitted
to the frontend.

## Structured Event Payloads

### `agent-run-config`

```text
{ agent_id, timestamp, type, thinkingEnabled, agentName? }
```

### `agent-run-init`

```text
{ agent_id, timestamp, type, sessionId, model }
```

### `agent-turn-usage`

```text
{ agent_id, timestamp, type, turn, inputTokens, outputTokens }
```

### `agent-compaction`

```text
{ agent_id, timestamp, type, turn, preTokens, timestamp }
```

### `agent-context-window`

```text
{ agent_id, timestamp, type, contextWindow }
```

### `agent-session-exhausted`

```text
{ agent_id, timestamp, type, sessionId }
```

### `agent-init-progress`

```text
{ agent_id, timestamp, type, stage }
```

`stage` is one of:

- `init_start`
- `runtime_ready`

### `agent-turn-complete`

```text
{ agent_id, timestamp, type, streaming }
```

## `run_result` Contract

`run_result` is the canonical terminal run summary emitted by the runtime and
typed in `contracts/agent_events.rs`.

Target fields:

| Field | Type | Meaning |
|---|---|---|
| `skill_name` | `string` | Skill name used for the run |
| `step_id` | `number` | Workflow/refine step discriminator |
| `usage_session_id` | `string?` | Usage/session grouping key |
| `run_source` | `workflow` / `refine` / `test` | Origin of the run |
| `session_id` | `string?` | OpenHands session identifier |
| `model` | `string` | Primary model name |
| `input_tokens` | `number` | Aggregate input tokens |
| `output_tokens` | `number` | Aggregate output tokens |
| `cache_read_tokens` | `number` | Prompt-cache reads |
| `cache_write_tokens` | `number` | Prompt-cache writes |
| `total_cost_usd` | `number` | Aggregate run cost |
| `model_usage_breakdown` | `ModelUsageEntry[]` | Per-model usage/cost breakdown |
| `context_window` | `number` | Final context window |
| `result_subtype` | `string?` | Fine-grained terminal subtype |
| `result_errors` | `string[]?` | Terminal error list |
| `stop_reason` | `string?` | Runtime stop reason |
| `num_turns` | `number` | Total turns |
| `duration_ms` | `number` | Wall-clock duration |
| `duration_api_ms` | `number?` | API-only duration |
| `tool_use_count` | `number` | Tool-call count |
| `compaction_count` | `number` | Compaction count |
| `status` | `completed` / `error` / `shutdown` | Terminal status |

## Related Design

This page stops at emitted backend events and typed payloads. Product-wide
projection of OpenHands event streams into frontend display items is documented
separately in
[../openhands-event-display-projection/README.md](../openhands-event-display-projection/README.md).
| `result_text` | `string?` | Raw terminal result text |
| `workspace_path` | `string?` | Effective working directory |
| `plugin_slug` | `string` | Owning plugin |

## Error Classification Boundary

Rust emits transport- and runtime-level facts. The frontend owns UI-level run
status interpretation.

Examples:

- `agent-exit.success = false` is backend output
- mapping that to an error badge or banner is frontend behavior
- `agent-init-error` carries the machine category and remediation hint, but the
  frontend chooses how to present it

## Structured Output Boundary

For structured-output runs, the backend is the final validator between terminal
result text and typed contract structs. The target contract assumes:

- runtime output may contain raw result text
- the backend extracts or reconstructs structured JSON when required
- Rust validates that JSON against typed workflow/output contracts before
  frontend consumers rely on it

## Current-State Deltas

Any mismatches on latest `main` belong in
[implementation-gaps.md](implementation-gaps.md).
