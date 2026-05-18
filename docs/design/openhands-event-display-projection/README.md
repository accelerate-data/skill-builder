---
functional-specs: []
---

# OpenHands Conversation Timeline

> **Status:** Current implementation for the conversation-event rendering model.
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
- restore history fetched from
  `GET /api/v1/conversation/{conversationId}/events/search`

The TypeScript client exposes runtime guards such as `isMessageEvent` to interpret wire payloads. Skill Builder should follow the same model: normalize raw OpenHands payloads into the TypeScript client event union first, then render from that canonical stream.

### Where normalization happens

Normalization should happen in Rust at the backend/frontend boundary.

Required flow:

```text
OpenHands websocket payload or /events/search payload
  -> Rust normalization to TypeScript client ConversationEvent shape
  -> Tauri event / restore payload to frontend
  -> frontend transcript + status/toast projection
```

The frontend should not be responsible for interpreting raw OpenHands transport shapes such as:

- `eventClass`
- `conversation_state`
- generic `event: Record<string, unknown>`

Those are backend normalization concerns. The frontend should consume canonical typed events only.

## Production Scope

**Production consumers**

- `app/src/pages/workflow.tsx`
- `app/src/components/workspace/workspace-conversation.tsx`

Both mount the shared `ConversationTimeline` component.

**Out of scope**

- historical Refine-era surfaces and contracts
- converting unrelated non-conversation summaries in the app to conversation-event rendering
- changing the OpenHands SDK or TypeScript client itself
- a raw debug transcript that renders every persisted event as a standalone row

## Goals

- Use the OpenHands TypeScript client event union as the canonical frontend/backend boundary for conversation rendering.
- Normalize both websocket and restore history in Rust into the same event shape before storing them in the frontend transcript.
- Show only transcript-worthy events in the visible conversation timeline.
- Keep operational activity compact by using grouped trace items and a detail drawer.
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

These have dedicated runtime error handling outside the transcript:

- `ConversationErrorEvent`
  - show a user-visible error toast
  - may also update run-level error state

### Confirmation events

These are accepted and stored if received, but are not part of the normal transcript:

- `UserRejectObservation`
- `ConfirmationRequestEvent`
- `ConfirmationResponseEvent`
  - never render in the transcript because Skill Builder does not use user confirmation flows

## Transcript Rendering Model

`ConversationTimeline` consumes canonical conversation events in chronological order and produces a narrative-first row sequence.

The visible order remains:

1. user message
2. grouped activity trace
3. agent update

Activity trace items are editorial projections over transcript events, not new canonical event kinds.

Current trace item kinds used by the renderer are:

- `file_activity`
- `terminal_activity`
- `skill`
- `subagent`
- `reasoning`

### Message events

| Event kind | Transcript presentation |
|---|---|
| `MessageEvent` with `llm_message.role: "user"` | `Task sent` row |
| `MessageEvent` with `llm_message.role: "assistant"` | `Agent update` row |

### System prompt and condensation summary

| Event kind | Transcript presentation |
|---|---|
| `SystemPromptEvent` | `Runtime setup` trace item with drawer |
| `CondensationSummaryEvent` | visible transcript summary row |

### Think events

| Event kind | Transcript presentation |
|---|---|
| `ThinkEvent` | grouped `Think` activity item |

Current `ThinkEvent` rendering rules:

- the activity-trace title is `Think`
- the inline summary uses the compact reasoning text
- the drawer shows:
  - `Reasoning` when a reasoning text field is present
  - `Thought` when a distinct thought field is present
- absent fields are omitted
- duplicate fallback sections are not rendered

### Tool-backed action/observation pairs

The transcript groups tool activity by LLM response and resolves each tool-backed `ActionEvent` into one of two outcomes:

- success:
  - paired `ObservationEvent`
- failure:
  - correlated `AgentErrorEvent`

Pairing rules:

- success pair primary key: `ObservationEvent.action_id == ActionEvent.id`
- success pair consistency key: `ObservationEvent.tool_call_id == ActionEvent.tool_call_id`
- failure correlation key: `AgentErrorEvent.tool_call_id == ActionEvent.tool_call_id`
- parallel batch key: `ActionEvent.llm_response_id`

Rendering rules:

- all `ActionEvent`s become tool-call units
- each tool-call unit resolves to either:
  - `Action` + `Observation`
  - `Action` + transcript-visible tool-call failure
- when multiple `ActionEvent`s share the same `llm_response_id`, they form one parallel tool-call batch
- the main conversation shows the batch-level `thought` when present
- if no batch-level thought is present, the trace summary falls back to a compact `tool_name: action` string built from the first action in the batch
- the drawer shows the individual paired tool calls within that batch
- if an `ActionEvent` has no `llm_response_id`, treat it as a one-item batch

The activity trace summary shows the action-side intent. The drawer shows the paired tool-call detail in a standard structure:

- `Thought` when the `ActionEvent` carries it
- `Action`
- `Observation` for success
- `Error` for transcript-visible tool-call failure

This applies uniformly to all tool-backed `ActionEvent`s. Tool-specific extraction is used only to turn raw `action`, `observation`, and tool error payloads into readable text, not to change the structural model.

Current action-text formatting in the renderer is:

- `invoke_skill`: `name: <name> action: InvokeSkillAction`
- `file_editor`: `command: <command> path: <path>`
- `terminal`: command text
- `task`: action description

### Activity trace presentation

The expanded `Activity trace` UI currently behaves as follows:

- each trace row shows its timestamp
- the old type-chip strip is not shown
- the old preview line under the trace header is not shown
- the old one-character badges per trace row are not shown

Drawer items are created in these cases:

- one parallel tool-call batch grouped by `llm_response_id`
- one standalone tool-call item when no sibling action shares that `llm_response_id`
- one `ThinkEvent`
- one `SystemPromptEvent`

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

The following are handled but hidden from the transcript unless a future diagnostics surface explicitly opts in:

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
  -> Rust normalization to OpenHands TypeScript client ConversationEvent shape
  -> store
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
- parallel tool calls sharing one `llm_response_id` render as one transcript batch with per-tool drawer detail
- `task` activity shows `Thought`, `Action`, and `Observation` in the drawer
- tool-backed action/observation pairs render the same standard drawer structure across tools
- `ThinkEvent` renders as a `Think` activity item with only the sections backed by present fields
- unknown transcript-capable kinds render fallback rows

## Key Source Files

| File | Responsibility |
|---|---|
| `app/src/lib/openhands-conversation-events.ts` | OpenHands event normalization and helper extraction |
| `app/src/lib/conversation-event-types.ts` | Canonical frontend envelope for conversation events |
| `app/src/lib/conversation-display-semantics.ts` | Event-kind classification into transcript, trace, status, and suppression behavior |
| `app/src/components/conversation/conversation-timeline.tsx` | Shared production conversation surface and status-bar integration |
| `app/src/hooks/use-session-runtime-stream.ts` | Live websocket event ingestion and toast routing |
| `app/src/lib/skill-openhands-session.ts` | Restore-history hydration path |
