---
functional-specs: [custom-plugin-management]
---

# OpenHands Conversation Timeline

> **Status:** Implemented
> **Runtime prerequisite:** See [../openhands-runtime-contract/README.md](../openhands-runtime-contract/README.md) for session lifecycle, normalized event ingress, and backend ownership of persisted conversation state.

## Overview

Skill Builder uses one production conversation UI model for active OpenHands sessions: a semantic transcript built from the OpenHands TypeScript client event contract.

The app should not invent a separate frontend-only event taxonomy. Both websocket-delivered live events and REST-restored history should be normalized into the same event model as:

- <https://github.com/OpenHands/typescript-client/blob/main/src/events/types.ts>

This design is therefore driven by event `kind`, not by ad hoc `eventClass` strings or renderer-local fallbacks.

## Normalization Boundary

The OpenHands TypeScript client event types are the canonical app-boundary contract:

- <https://github.com/OpenHands/typescript-client/blob/main/src/events/types.ts>

Every event received from OpenHands must be converted into one of those event types before the frontend transcript store sees it.

That applies to both ingress paths:

- live websocket events
- restore history fetched from `GET /api/v1/conversation/{conversationId}/events/search`

The TypeScript client exposes runtime guards such as `isMessageEvent` to interpret wire payloads. Skill Builder should follow the same model: normalize raw OpenHands payloads into the TypeScript client event union first, then render from that canonical stream.

### Where normalization happens

Normalization is split across two steps:

1. **Rust** (`agents/openhands_server/`) does field-level cleanup — discriminator normalization, falling back to the SDK `kind` field when `event_class` is absent, and stripping wire-transport metadata before the Tauri event is emitted.
2. **Frontend** `openhands-conversation-events.ts` (`normalizeOpenHandsEventRecord(...)`) does the final normalization into typed `OpenHandsConversationEvent` shapes from the TypeScript client contract. This runs in both `use-session-runtime-stream.ts` (live events) and `skill-openhands-session.ts` (restore history).

Required flow:

```text
OpenHands websocket payload or /events/search payload
  -> Rust field-level cleanup (discriminator normalization)
  -> Tauri event / restore payload to frontend
  -> normalizeOpenHandsEventRecord() in openhands-conversation-events.ts
  -> ConversationEventEnvelope in conversation-store
  -> transcript + status/toast projection
```

The frontend should not need to interpret raw OpenHands wire-transport shapes such as:

- `eventClass`
- `conversation_state`
- generic `event: Record<string, unknown>`

Those are Rust normalization concerns. `normalizeOpenHandsEventRecord(...)` is the final typed normalization boundary; downstream code should consume `OpenHandsConversationEvent` shapes only.

## Production Scope

**Production consumers**

- `app/src/pages/workflow.tsx`
- `app/src/components/workspace/workspace-conversation.tsx`

Both mount the shared `EventDisplayTimeline` component.

**Out of scope**

- historical Refine-era surfaces and contracts
- converting unrelated non-conversation summaries in the app to conversation-event rendering
- changing the OpenHands SDK or TypeScript client itself
- a raw debug transcript that renders every persisted event as a standalone row

## Goals

- Use the OpenHands TypeScript client event union as the canonical frontend/backend boundary for conversation rendering.
- Normalize both websocket and restore history into the same event shape before storing them in the frontend transcript.
- Show only transcript-worthy events in the visible conversation timeline.
- Keep operational activity compact using tinted activity-log rows with inline T/A/O expansion.
- Route internal/control-plane events to dedicated UI handling instead of leaking them into transcript rows.
- Keep unknown event kinds visible through a fallback row instead of silently dropping them.

## Non-goals

- Recreating a second primary transcript model beside the OpenHands event model
- Requiring Python-only event richness for core frontend behavior
- Treating restore payloads and live websocket payloads as separate UI contracts

## Canonical Event Contract

The app boundary should mirror the OpenHands TypeScript client `ConversationEvent` union exactly.

At minimum, the renderer must recognize these wire-level kinds:

- `MessageEvent`
- `ActionEvent`
- `ObservationEvent`
- `AgentErrorEvent`
- `SystemPromptEvent`
- `PauseEvent`
- `CondensationRequest`
- `CondensationSummaryEvent`
- `Condensation`
- `ConversationStateUpdateEvent`
- `ConversationErrorEvent`
- `LLMCompletionLogEvent`
- `UserRejectObservation`
- `ConfirmationRequestEvent`
- `ConfirmationResponseEvent`
- `TokenEvent`
- `StuckDetectionEvent`
- `FinishEvent`
- `ThinkEvent`
- `HookExecutionEvent`

The app may preserve richer raw payloads as optional diagnostics metadata, but display behavior must be correct when only the TypeScript client contract is available.

## Event Families

Skill Builder uses an app-level split between transcript events and internal events.

### Transcript events

These appear in the visible conversation transcript:

- `MessageEvent`
- `ActionEvent`
- `ObservationEvent`
- `AgentErrorEvent`
- `SystemPromptEvent`
- `CondensationSummaryEvent`
- `ThinkEvent`

### Hidden-but-handled events

These must be handled explicitly but do not render as transcript rows:

- `PauseEvent`
- `CondensationRequest`
- `Condensation`
- `ConversationStateUpdateEvent`
- `LLMCompletionLogEvent`
- `TokenEvent`
- `StuckDetectionEvent`
- `FinishEvent`
- `HookExecutionEvent`

### Runtime error events

These are suppressed from the transcript by `conversation-display-semantics.ts` (same suppress path as hidden internal events) but have dedicated side-effect handling outside the projection layer:

- `ConversationErrorEvent`
  - suppressed from transcript rows
  - `use-session-runtime-stream.ts` routes it to a persistent error toast
  - may also update run-level error state

### Confirmation events

These are accepted and stored if received, but are not part of the normal transcript:

- `UserRejectObservation`
- `ConfirmationRequestEvent`
- `ConfirmationResponseEvent`
  - never render in the transcript because Skill Builder does not use user confirmation flows

## Design

### Visual

**Light mode**

![Light mode](./assets/event-display-light.png)

**Dark mode**

![Dark mode](./assets/event-display-dark.png)

## Transcript Rendering Model

`EventDisplayTimeline` consumes canonical conversation events in chronological order and renders each transcript-worthy event as a compact, collapsible tinted row — an activity-log style panel. There are no chat bubbles and no slide-out drawers.

The visible order is:

1. user message row
2. agent activity rows (think, tools, condensation)
3. agent output row

A labelled turn divider is inserted between consecutive interaction cycles. A new turn starts whenever a `task_sent` row follows an `agent_update` row. Turn numbering is 1-based per conversation.

### Row anatomy

Every transcript row is a single horizontal strip:

```text
[tinted bg] [icon] [LABEL] [summary ···] [tok] [dur] [●] [›]
```

- **tinted background** — faint `--chat-*-bg` CSS token; colour encodes event type without a border
- **label** — bold 11 px type name in `--chat-*-border` colour
- **summary** — truncated muted description; italic for Think rows
- **tok** — token-count badge (monospace, tinted); shown only on Think and Output rows
- **dur** — elapsed time (monospace, muted); shown only on tool-group rows
- **●** — 6 px status dot: `--color-seafoam` when done, `--color-pacific` pulsing when running, `--destructive` on error
- **›** — chevron that rotates 90° when expanded; absent on non-expandable rows

### Event kind → row mapping

| OpenHands event kind | DisplayNode kind | Row label | Background token | Label colour token |
|---|---|---|---|---|
| `MessageEvent` (role: user) | `task_sent` | Message | `--chat-question-bg` | `--chat-question-border` |
| `MessageEvent` (role: assistant) | `agent_update` | Output | `--chat-subagent-bg` | `--chat-subagent-border` |
| `ThinkEvent` | `reasoning` | Think | `--chat-thinking-bg` | `--chat-thinking-border` |
| `ActionEvent` / `ObservationEvent` batch | `tool_batch`, `activity_trace`, `file_activity`, `terminal_activity` | N tools / 1 tool | `--chat-tool-bg` | `--chat-tool-border` |
| `SystemPromptEvent` | `runtime_setup` | Runtime setup | `--muted` | `--muted-foreground` |
| `CondensationSummaryEvent` | `lifecycle` | Condensation | `--muted` | `--muted-foreground` |
| `AgentErrorEvent` (standalone) | `error` | Error | `--chat-error-bg` | `--chat-error-border` |
| tool-call failure (`AgentErrorEvent` correlated) | `tool_error` | Tool error | `--chat-error-bg` | `--chat-error-border` |
| unknown transcript kind | `unknown_event` | Unknown | `--muted` | `--muted-foreground` |

`runtime_setup` rows are collapsed by default. All other rows are expanded by default or non-expandable.

### Message events

| Event kind | Row label | Expandable |
|---|---|---|
| `MessageEvent` with `llm_message.role: "user"` | Message | No |
| `MessageEvent` with `llm_message.role: "assistant"` | Output | Yes (full markdown body via `MemoizedMarkdown`) |

### System prompt and condensation summary

| Event kind | Row label | Expandable |
|---|---|---|
| `SystemPromptEvent` | Runtime setup | Yes (system prompt text); collapsed by default |
| `CondensationSummaryEvent` | Condensation | Yes (summary body) |

### Think events

| Event kind | Row label | Expandable |
|---|---|---|
| `ThinkEvent` | Think | Yes; collapsed by default |

`ThinkEvent` rendering rules:

- the row label is `Think`
- the inline summary uses the compact reasoning text; italic
- the token count badge is shown when present
- expanding the row shows the best available reasoning text: `reasoningText` when present, falling back to `thoughtText`; absent = nothing shown

### Tool-backed action/observation pairs

The transcript groups tool activity by LLM response and resolves each tool-backed `ActionEvent` into one of two outcomes:

- success: paired `ObservationEvent`
- failure: correlated `AgentErrorEvent`

Pairing rules:

- success pair primary key: `ObservationEvent.action_id == ActionEvent.id`
- success pair consistency key: `ObservationEvent.tool_call_id == ActionEvent.tool_call_id`
- failure correlation key: `AgentErrorEvent.tool_call_id == ActionEvent.tool_call_id`
- parallel batch key: `ActionEvent.llm_response_id`

Rendering rules:

- all `ActionEvent`s become tool-call units
- each tool-call unit resolves to either `Action` + `Observation` (success) or `Action` + `Error` (failure)
- when multiple `ActionEvent`s share the same `llm_response_id`, they form one parallel tool-call batch rendered as a single row labelled `N tools`
- when an `ActionEvent` has no `llm_response_id`, treat it as a one-item batch labelled `1 tool`
- when a batch-level thought is present, it is used as the row summary
- when no batch-level thought is present, the summary lists tool names joined by ` · `

Expanding a tool-group row shows an inline T/A/O panel with three colour-banded sections:

```text
┌─ THOUGHT  (--chat-thinking-bg)  ─────────────────────────┐
│  Batch-level thought text when present                   │
│  (from ActionEvent reasoning / thought field)            │
├─ ACTION   (--chat-tool-bg)   ────────────────────────────┤
│  Formatted action text, one line per parallel call       │
├─ OBSERVATION  (--chat-result-bg)  ───────────────────────┤  ← success
│  Tool result text                                        │
│  — OR —                                                  │
├─ ERROR  (--chat-error-bg)  ──────────────────────────────┤  ← failure
│  AgentErrorEvent message text                            │
└──────────────────────────────────────────────────────────┘
```

- absent sections are omitted
- the `OBSERVATION` and `ERROR` sections are mutually exclusive per tool-call unit
- for a parallel batch, each tool-call unit's Action + Observation/Error is listed sequentially within the ACTION and OBSERVATION/ERROR sections

This structure applies uniformly to all tool-backed `ActionEvent`s. Tool-specific extraction is used only to format action text, not to change the structural model.

Action-text formatting:

- `invoke_skill`: `name: <name> action: <kind>` (dynamic value from `action.kind`)
- `file_editor`: `command: <command> path: <path>`
- `terminal`: command text
- `task`: action description

## Internal Event Handling

Internal events do not render as transcript rows, but they still have UI obligations.

### Status bar

The bottom status bar is driven by:

- `PauseEvent`
- `ConversationStateUpdateEvent`
- `FinishEvent`

At minimum it should reflect:

- `running`
- `paused`
- `idle`
- `finished`
- `error`

Pause is a resumable internal runtime state, not a cancelled or terminal step outcome.

When the user presses `Escape`, Skill Builder should issue a pause request for the running workflow conversation. When the OpenHands runtime later emits a `PauseEvent` or a `ConversationStateUpdateEvent` indicating `paused`, the frontend should update the status bar to `paused`.

That pause acknowledgement must not reset the active workflow step back to `pending`, and it must not be coerced into a terminal cancelled or shutdown run state. Step reset is a separate user action, not a side effect of pause acknowledgement.

### Toasts and runtime error surfaces

- `ConversationErrorEvent` shows a persistent error toast.

### Hidden diagnostics

The following are handled but not shown in the transcript:

- `CondensationRequest`
- `Condensation`
- `LLMCompletionLogEvent`
- `TokenEvent`
- `HookExecutionEvent`
- `StuckDetectionEvent`

## Unknown Event Contract

This renderer is selective, but not allowed to drop unknown transcript-class payloads silently.

If the app receives a `ConversationEvent` kind that is not yet specialized and is not listed above as an internal/hidden event, it must emit a visible fallback row containing:

- event kind
- timestamp
- compact summary if available
- expandable raw payload

This keeps runtime evolution debuggable.

## Restore and Live Parity

When resuming an existing conversation, the app should fetch history from the OpenHands conversation events API rather than reconstructing transcript state from local memory or local files.

Resume history source:

- `GET /api/v1/conversation/{conversationId}/events/search`

The frontend must render those fetched events using the same semantics as live websocket events.

The restore path and websocket path must therefore converge before projection:

```text
REST history (/events/search) or websocket event
  -> Rust field-level cleanup
  -> normalizeOpenHandsEventRecord() in openhands-conversation-events.ts
  -> ConversationEventEnvelope in conversation-store
  -> project to transcript / status / toast handling
```

The UI must not rely on restore-only or Python-only fields for correctness, and resume must not invent transcript rows that would not appear in the live path.

## Contract-based Test Strategy

Tests should be built from the OpenHands TypeScript client event contract, not from saved event folders on disk.

The source of truth for frontend event tests is:

- <https://github.com/OpenHands/typescript-client/blob/main/src/events/types.ts>

Test fixtures should therefore model canonical wire events by `kind`, using the same shapes the frontend is guaranteed to receive from:

- live websocket delivery
- resume history fetched from `GET /api/v1/conversation/{conversationId}/events/search`

Required assertions:

- websocket-style normalized events and restore-style normalized events produce the same transcript classification
- transcript-only kinds render visibly
- internal kinds do not produce transcript rows
- `PauseEvent`, `ConversationStateUpdateEvent`, and `FinishEvent` drive the status bar
- `ConversationErrorEvent` drives toast/error behavior
- `AgentErrorEvent` renders as a transcript-visible tool-call failure and does not toast
- successful tool calls pair using:
  - `ObservationEvent.action_id == ActionEvent.id`
  - `ObservationEvent.tool_call_id == ActionEvent.tool_call_id`
- failed tool calls correlate using:
  - `AgentErrorEvent.tool_call_id == ActionEvent.tool_call_id`
- parallel tool calls sharing one `llm_response_id` render as one transcript batch with per-tool inline T/A/O detail
- `task` activity shows `Thought`, `Action`, and `Observation` in the inline T/A/O panel
- tool-backed action/observation pairs render the same standard inline T/A/O panel across tools
- `ThinkEvent` renders as a `Think` activity item showing `reasoningText` when present, falling back to `thoughtText`; expansion is empty when both are absent
- unknown transcript-capable kinds render fallback rows

## Key Source Files

| File | Responsibility |
|---|---|
| `app/src/lib/openhands-conversation-events.ts` | OpenHands event normalization and helper extraction |
| `app/src/lib/conversation-event-types.ts` | Canonical frontend envelope for conversation events |
| `app/src/lib/conversation-display-semantics.ts` | Event-kind classification into transcript, trace, status, and suppression behavior |
| `app/src/components/event-display/event-display-timeline.tsx` | Shared production conversation surface and status-bar integration |
| `app/src/hooks/use-session-runtime-stream.ts` | Live websocket event ingestion and toast routing |
| `app/src/lib/skill-openhands-session.ts` | Restore-history hydration path |
