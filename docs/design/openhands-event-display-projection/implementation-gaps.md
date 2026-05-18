# OpenHands Conversation Timeline Implementation Gaps

This document tracks the delta between the target state in [README.md](./README.md)
and the current implementation.

## Summary

The current conversation UI is already substantially more semantic than the old
raw-event timeline, but it still runs on a repo-local event model:

- `eventClass`
- `event: Record<string, unknown>`
- special-case projector logic for tool names and restored transport envelopes

The design has now moved to a stricter contract:

- canonical event types must mirror the OpenHands TypeScript client event union
- Rust must normalize every websocket and `/events/search` payload into that union before the frontend sees it
- transcript-visible events and internal events must be handled by explicit,
  separate code paths
- restore history from `GET /api/v1/conversation/{conversationId}/events/search`
  must normalize into the same model as live websocket events before projection

The remaining work is therefore not primarily visual polish. It is a normalization and projection refactor.

## Current Gaps

### 1. Rust does not yet normalize OpenHands ingress payloads into the TypeScript client event contract

Current code:

- [app/src-tauri/src/agents/openhands_server/mod.rs](../../../app/src-tauri/src/agents/openhands_server/mod.rs)
- [app/src-tauri/src/commands/skill_session.rs](../../../app/src-tauri/src/commands/skill_session.rs)
- [app/src/lib/skill-openhands-session.ts](../../../app/src/lib/skill-openhands-session.ts)
- [app/src/hooks/use-session-runtime-stream.ts](../../../app/src/hooks/use-session-runtime-stream.ts)

The backend currently forwards restore and live events as raw or lightly wrapped payloads, and the frontend still performs the main interpretation step.

Missing target behavior:

- Rust-side normalization of every websocket payload into one TypeScript-client `ConversationEvent` kind
- Rust-side normalization of every `/events/search` payload into the same `ConversationEvent` kinds
- one canonical event stream sent to the frontend for both live and restore

### 2. Canonical frontend event normalization still uses repo-local wrappers instead of the TypeScript client event contract

Current code:

- [app/src/lib/openhands-conversation-events.ts](../../../app/src/lib/openhands-conversation-events.ts)
- [app/src/lib/conversation-event-types.ts](../../../app/src/lib/conversation-event-types.ts)

The current frontend boundary is still built around:

- `OpenHandsConversationEvent`
- `OpenHandsConversationState`
- `eventClass`
- `event: Record<string, unknown>`

This is looser than the OpenHands TypeScript client event union and forces
downstream code to infer semantics from generic payload blobs.

Missing target behavior:

- canonical app-side event types that match the TypeScript client event kinds
- normalization by event `kind`, not by `eventClass`
- one shared normalized event shape for both websocket and restore history
- removal of transport-specific `conversation_state` as a primary frontend
  transcript model

### 3. Transcript-visible events and internal events are not split as first-class families

Current code:

- [app/src/lib/conversation-display-semantics.ts](../../../app/src/lib/conversation-display-semantics.ts)
- [app/src/components/conversation/conversation-timeline.tsx](../../../app/src/components/conversation/conversation-timeline.tsx)

The current projector mixes transcript rendering, internal-event suppression, and status-bar derivation inside one `eventClass`-driven code path.

Missing target behavior:

- explicit transcript handling for:
  - `MessageEvent`
  - `ActionEvent`
  - `ObservationEvent`
  - `AgentErrorEvent`
  - `SystemPromptEvent`
  - `CondensationSummaryEvent`
  - `ThinkEvent`
- explicit internal-event handling for:
  - `PauseEvent`
  - `CondensationRequest`
  - `Condensation`
  - `ConversationStateUpdateEvent`
  - `LLMCompletionLogEvent`
  - `TokenEvent`
  - `StuckDetectionEvent`
  - `FinishEvent`
  - `HookExecutionEvent`
- explicit hidden-but-stored handling for:
  - `UserRejectObservation`
  - `ConfirmationRequestEvent`
  - `ConfirmationResponseEvent`

### 4. The frontend still interprets raw transport shapes instead of consuming canonical typed events only

Current code:

- [app/src/hooks/use-session-runtime-stream.ts](../../../app/src/hooks/use-session-runtime-stream.ts)
- [app/src/lib/skill-openhands-session.ts](../../../app/src/lib/skill-openhands-session.ts)
- [app/src/lib/openhands-conversation-events.ts](../../../app/src/lib/openhands-conversation-events.ts)

The frontend still performs normalization from:

- `conversation_event`
- `conversation_state`
- `eventClass`
- `event: Record<string, unknown>`

Missing target behavior:

- frontend receives already-normalized TypeScript-client-shaped events
- frontend does not need to infer event family from transport envelopes
- backend/frontend parity is guaranteed before the projector runs

### 5. `ConversationErrorEvent` still behaves like a transcript event instead of a runtime toast

Current code:

- [app/src/lib/conversation-display-semantics.ts](../../../app/src/lib/conversation-display-semantics.ts)
- [app/src/hooks/use-session-runtime-stream.ts](../../../app/src/hooks/use-session-runtime-stream.ts)

The current code still treats `ConversationErrorEvent` as a transcript row through the generic error projector path.

Missing target behavior:

- `ConversationErrorEvent` should trigger persistent toast/error handling
- it should not render as a transcript row
- it may update run-level error state for the footer or other runtime UI

### 6. `AgentErrorEvent` is still handled inside the generic old event model rather than as a typed tool-call failure correlated back to its action

Current code:

- [app/src/lib/conversation-display-semantics.ts](../../../app/src/lib/conversation-display-semantics.ts)

The transcript already renders agent/tool errors, which matches the target product behavior. The gap is architectural: this behavior is still encoded as old `eventClass`-based projector logic rather than as explicit typed handling of `AgentErrorEvent`.

Missing target behavior:

- `AgentErrorEvent` handled as its own canonical transcript-visible event type
- `AgentErrorEvent.tool_call_id` used to correlate the failure back to the failed `ActionEvent`
- no toast routing for `AgentErrorEvent`
- consistent rendering as a tool-call failure row

### 7. `ThinkEvent` is not implemented as the canonical reasoning contract

Current code:

- [app/src/lib/openhands-conversation-events.ts](../../../app/src/lib/openhands-conversation-events.ts)
- [app/src/lib/conversation-display-semantics.ts](../../../app/src/lib/conversation-display-semantics.ts)

The current reasoning implementation still depends on older persisted shapes and
tool-style extraction:

- `tool_name: "think"`
- `reasoning_content`
- `thinking_blocks`
- `thought` arrays inside generic action payloads

That compatibility logic may remain as optional enrichment, but it is still the
primary reasoning path today.

Missing target behavior:

- canonical transcript handling for:
  - `ThinkEvent { kind: "ThinkEvent", thought: string }`
- `ThinkEvent` rendered directly as transcript-visible reasoning
- no requirement that reasoning arrive as a tool-backed action/observation pair

### 8. Action outcomes are still keyed and rendered through tool-specific heuristics rather than the contract in the TypeScript model

Current code:

- [app/src/lib/conversation-display-semantics.ts](../../../app/src/lib/conversation-display-semantics.ts)

The current UI already pairs some tool activity, but the pairing and failure logic is still implemented in the projector as a tool-specific merge process driven primarily by `toolCallId`.

Missing target behavior:

- success pair primary key:
  - `ObservationEvent.action_id == ActionEvent.id`
- success pair consistency key:
  - `ObservationEvent.tool_call_id == ActionEvent.tool_call_id`
- failure correlation key:
  - `AgentErrorEvent.tool_call_id == ActionEvent.tool_call_id`
- every transcript-visible tool-backed `ActionEvent` resolves to either:
  - `Action` + `Observation`
  - `Action` + tool-call failure
- no structural distinction between file/terminal/task/skill pairs beyond text extraction

### 9. Parallel tool-call batches keyed by `llm_response_id` are not yet the transcript unit

Current code:

- [app/src/lib/openhands-conversation-events.ts](../../../app/src/lib/openhands-conversation-events.ts)
- [app/src/lib/conversation-display-semantics.ts](../../../app/src/lib/conversation-display-semantics.ts)

The code has some grouping support for consecutive action events sharing an
`llm_response_id`, but the visible transcript is still primarily assembled from
tool-specific rows and merged items rather than from a canonical "one LLM
response batch -> one transcript activity unit" model.

Missing target behavior:

- group all `ActionEvent`s sharing the same `llm_response_id` into one parallel
  tool-call batch
- show the batch-level `thought` in the main conversation
- show the individual paired tool calls in the drawer
- treat an `ActionEvent` without `llm_response_id` as a one-item batch

### 10. The drawer model is not yet driven from one standard `Thought` / `Action` / `Observation` contract

Current code:

- [app/src/lib/conversation-display-semantics.ts](../../../app/src/lib/conversation-display-semantics.ts)
- [app/src/components/conversation/conversation-activity-group.tsx](../../../app/src/components/conversation/conversation-activity-group.tsx)

The current drawer has converged on better behavior for some tools, but it is
still built from different trace-item constructors and special sections per
projected node kind.

Missing target behavior:

- one standard drawer structure for all tool-backed action outcomes:
  - `Thought` when present on the action
  - `Action`
  - `Observation` for success
  - `Error` for tool-call failure
- tool-specific extraction allowed only to derive readable text from raw `action`, `observation`, and tool-error payloads
- no separate structural rules for `file_editor`, `terminal`, `invoke_skill`,
  and `task`

### 11. Status-bar ownership is still coupled to transport-specific restore/live shapes

Current code:

- [app/src/components/conversation/conversation-timeline.tsx](../../../app/src/components/conversation/conversation-timeline.tsx)
- [app/src/hooks/use-session-runtime-stream.ts](../../../app/src/hooks/use-session-runtime-stream.ts)

The footer currently inspects:

- `message.type === "conversation_state"`
- `eventClass === "PauseEvent"`
- `eventClass === "ConversationStateUpdateEvent"`

This preserves behavior, but it is still keyed to the old transport wrappers
instead of normalized internal event types.

Missing target behavior:

- status bar driven by canonical internal events
- `ConversationStateUpdateEvent` used for lifecycle state
- `FinishEvent` used as terminal completion signal
- no dependence on restore-only or transport-only envelope differences

### 12. Restore and live websocket paths still converge only through the old wrapper model

Current code:

- [app/src/lib/skill-openhands-session.ts](../../../app/src/lib/skill-openhands-session.ts)
- [app/src/hooks/use-session-runtime-stream.ts](../../../app/src/hooks/use-session-runtime-stream.ts)
- [app/src/lib/openhands-conversation-events.ts](../../../app/src/lib/openhands-conversation-events.ts)

Restore currently hydrates transcript state by rebuilding the old wrapper shape
from `restored_transcript_events`, while websocket events go through separate
`conversation_event` / `conversation_state` transport normalizers.

This is the root cause of the restore/live drift bugs that have already shown up as stray `Unknown event` rows.

Missing target behavior:

- resume history fetched from:
  - `GET /api/v1/conversation/{conversationId}/events/search`
- websocket and restore both normalize into the same canonical event union
  before projection
- no resume-only transcript rows
- no restore-specific suppression hacks required to keep parity

### 13. Confirmation and reject events are not yet given explicit hidden handling

Current code:

- [app/src/lib/conversation-display-semantics.ts](../../../app/src/lib/conversation-display-semantics.ts)
- [app/src/lib/openhands-conversation-events.ts](../../../app/src/lib/openhands-conversation-events.ts)

The current code has partial suppression and fallback handling, but it is not
yet documented in code as an explicit hidden family for:

- `UserRejectObservation`
- `ConfirmationRequestEvent`
- `ConfirmationResponseEvent`

Missing target behavior:

- store or accept these events if received
- never render them in the transcript
- keep their handling distinct from internal lifecycle/status events

### 14. The test suite still locks the old event model and fixture strategy

Current tests:

- [app/src/__tests__/lib/openhands-conversation-events.test.ts](../../../app/src/__tests__/lib/openhands-conversation-events.test.ts)
- [app/src/__tests__/lib/conversation-event-projection.test.ts](../../../app/src/__tests__/lib/conversation-event-projection.test.ts)
- [app/src/__tests__/components/conversation/conversation-timeline.test.tsx](../../../app/src/__tests__/components/conversation/conversation-timeline.test.tsx)
- [app/src/__tests__/fixtures/openhands-conversations/](../../../app/src/__tests__/fixtures/openhands-conversations/)

The current tests are still centered on:

- `eventClass`
- wrapper-style `conversation_event` records
- fixture corpora shaped around the old repo-local model

Missing target behavior:

- Rust normalization tests proving raw OpenHands websocket and `/events/search` payloads become canonical TypeScript-client event kinds
- contract-based fixtures modeled from the TypeScript client event kinds
- normalization tests for the canonical event union
- parity tests proving:
  - websocket-style payloads and restore `/events/search` payloads classify the same way after normalization
- transcript tests for:
  - `MessageEvent`
  - `ThinkEvent`
  - `SystemPromptEvent`
  - `CondensationSummaryEvent`
  - `AgentErrorEvent`
- internal-event suppression tests for:
  - `PauseEvent`
  - `CondensationRequest`
  - `Condensation`
  - `ConversationStateUpdateEvent`
  - `LLMCompletionLogEvent`
  - `TokenEvent`
  - `StuckDetectionEvent`
  - `FinishEvent`
  - `HookExecutionEvent`
- toast tests for `ConversationErrorEvent`
- success-pair tests for:
  - `ObservationEvent.action_id == ActionEvent.id`
  - `ObservationEvent.tool_call_id == ActionEvent.tool_call_id`
- failure-correlation tests for:
  - `AgentErrorEvent.tool_call_id == ActionEvent.tool_call_id`
- batching tests for shared `llm_response_id`

## Exit Criteria

This gap document is complete when:

- Rust normalizes both websocket and `/events/search` payloads into the TypeScript client `ConversationEvent` contract before they reach the frontend
- the app normalizes both restore and websocket events into the TypeScript client `ConversationEvent` contract before projection
- transcript-visible events and internal events are handled by separate,
  explicit code paths
- `ConversationErrorEvent` produces a toast and does not render in the
  transcript
- `AgentErrorEvent` renders as a transcript-visible tool-call failure without a
  toast
- `ThinkEvent` is the canonical reasoning event
- successful tool calls pair by `action_id -> ActionEvent.id` with `tool_call_id` consistency checking
- failed tool calls correlate by `AgentErrorEvent.tool_call_id -> ActionEvent.tool_call_id`
- parallel tool calls sharing one `llm_response_id` render as one transcript
  batch with per-tool drawer detail
- `ConversationStateUpdateEvent` and `FinishEvent` drive the status bar
- confirmation/reject events are stored but never shown in the transcript
- tests lock the canonical event contract rather than the old wrapper model
