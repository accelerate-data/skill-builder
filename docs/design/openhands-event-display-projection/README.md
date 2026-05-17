---
functional-specs: []
---

# OpenHands Conversation Timeline

> **Status:** Target state for the conversation-event rendering model.
> **Runtime prerequisite:** See [../openhands-runtime-contract/README.md](../openhands-runtime-contract/README.md) for session lifecycle, normalized event ingress, and backend ownership of persisted conversation state.

## Overview

Skill Builder uses a single production conversation UI model for active OpenHands sessions: a top-to-bottom semantic timeline built directly from canonical conversation events.

The canonical input is `conversationEvents`. The production renderer is `ConversationTimeline`, shared by the Workflow page and the Workspace Conversation surface.

The timeline is semantic rather than generic:

- user intent, agent narration, skill activations, subagent launches, results, and errors are always visible
- ordinary operational tool traffic is grouped for readability
- internal telemetry and bookkeeping events are suppressed when they do not improve the transcript
- unknown or newly introduced event shapes remain visible through fallback rows

The timeline is also accounted for by contract: grouping and suppression are editorial choices, but every raw event must still be classified explicitly instead of disappearing through an unhandled code path.

## Production Scope

**Production consumers**

- `app/src/pages/workflow.tsx`
- `app/src/components/workspace/workspace-conversation.tsx`

Both mount the shared `ConversationTimeline` component.

**Out of scope**

- historical Refine-era surfaces and contracts
- converting unrelated non-conversation summaries in the app to conversation-event rendering
- backend event normalization or OpenHands wire-format cleanup
- a raw debug transcript that renders every persisted event as a standalone row

## Goals

- Present active OpenHands conversations as a narrative timeline that still preserves operational transparency.
- Keep `Skill` and `Subagent` as first-class visible rows.
- Keep assistant updates visible as narrative rows.
- Group tool traffic without hiding the fact that it happened.
- Suppress internal telemetry and bookkeeping noise from the normal transcript.
- Preserve debuggability when the runtime evolves by rendering unknown event shapes visibly instead of silently dropping them.
- Back the renderer with fixture-driven tests over real persisted conversation event folders.

## Non-goals

- Recreating a second primary transcript model beside `conversationEvents`
- Inferring causal nesting that the event stream does not actually encode
- Designing a raw-vs-beautified toggle for production use

## Canonical Rendering Model

`ConversationTimeline` consumes canonical conversation events in chronological order and produces a semantic row sequence.

The store contract for active OpenHands runs is:

- raw `conversationEvents`
- latest `conversationState`

Terminal success or failure is canonical state, not a stored synthetic event. Timeline surfaces may derive terminal `Result` or `Error` narration from `conversationState` for presentation, but that row is a UI-level projection.

Each raw event must be classified into exactly one of these presentation forms:

1. **Visible standalone row**
2. **Visible grouped row member**
3. **Visible nested subagent row member**
4. **Explicitly suppressed event**
5. **Visible unknown/fallback row**

Suppression is allowed only for event classes that this document explicitly marks as internal telemetry or bookkeeping.

## Event Mapping

The mapping below is based on the real persisted conversation corpus in `~/Library/Application Support/com.vibedata.skill-builder/openhands/conversations`.

### Message events

| Event shape | Timeline row |
|---|---|
| `MessageEvent` with `llm_message.role: "user"` | `Task sent` row |
| `MessageEvent` with `llm_message.role: "assistant"` | `Agent update` row, always visible |

### Action and observation events

| Event shape | Timeline row |
|---|---|
| `ActionEvent` + `ObservationEvent` for `terminal` | Grouped `Terminal activity` member |
| `ActionEvent` + `ObservationEvent` for `file_editor` | Grouped `File activity` member |
| `ActionEvent` + `ObservationEvent` for `think` | Grouped `Reasoning` member, collapsed by default |
| `ActionEvent` + `ObservationEvent` for `invoke_skill` | Single standalone `Skill` row, always visible; observation enriches the same row |
| `ActionEvent` + `ObservationEvent` for `task` | Single standalone `Subagent` row, always visible; observation enriches the same row |
| `ActionEvent` for `finish` | Standalone `Result` row |
| `ObservationEvent` without a matching action | Standalone visible `Tool observation` row |

### System and runtime events

| Event shape | Timeline row |
|---|---|
| `SystemPromptEvent` | Collapsed `Runtime setup` row, or a debug disclosure outside the main timeline |
| `ConversationStateUpdateEvent` with `key: "execution_status"` | Bottom status bar state, not a timeline row |
| `ConversationStateUpdateEvent` with `key: "stats"` | Suppressed from the main timeline |
| `ConversationStateUpdateEvent` with `key: "last_user_message_id"` | Suppressed from the main timeline |
| `PauseEvent` | Bottom status bar `Paused` state, not a timeline row |
| `ConversationErrorEvent` | Standalone `Error` row |
| `AgentErrorEvent` | Standalone `Tool error` or `Subagent error` row |
| unknown `kind` or unexpected payload | `Unknown event` row with expandable payload |

## Observed Corpus

The current persisted corpus includes these top-level event kinds:

- `ConversationStateUpdateEvent`
- `ActionEvent`
- `ObservationEvent`
- `MessageEvent`
- `SystemPromptEvent`
- `PauseEvent`
- `ConversationErrorEvent`
- `AgentErrorEvent`

The current tool and state subtypes visible in the corpus are:

- `terminal`
- `file_editor`
- `think`
- `invoke_skill`
- `task`
- `finish`
- `execution_status`
- `stats`
- `last_user_message_id`

These observed shapes are the baseline contract for the timeline. Future unknown shapes must fall back visibly instead of disappearing.

## Grouping Rules

Grouping is purely visual. It does not change event accounting.

### Allowed grouping

Ordinary tool traffic may be grouped into a semantic activity block when the items belong to the same top-level conversation flow and remain adjacent after semantic row construction.

Allowed grouped buckets:

- `Terminal activity`
- `File activity`
- `Reasoning`

### Disallowed grouping

These rows must remain individually visible and must never be absorbed into generic tool grouping:

- `Agent update`
- `Skill`
- `Subagent`
- `Result`
- `Error`
- `Paused`

### Group boundaries

Any visible narrative or structural row breaks the current ordinary tool group.

At minimum, grouping resets on:

- user message rows
- agent update rows
- skill rows
- subagent rows
- result rows
- error rows
- explicit runtime or system rows

## Nesting Rules

### Real child subagents

Nested rendering is deferred for live production timeline rendering.

`parentToolCallId` remains the target correlation field, but current websocket-delivered conversation events are not sufficient to guarantee child-event coverage for subagent internals. Nested subagent rendering therefore requires a second-source enrichment path over persisted events before it becomes part of the production contract.

### Skill rows

`invoke_skill` is shown as a visible `Skill` row, but the renderer must not invent nested ownership for subsequent parent-agent tool calls unless the event stream provides an explicit correlation.

In other words:

- skill rows are visible
- skill rows are not fake parents for unrelated parent-agent activity

## Visibility Contract

This renderer is editorial and selective, not transcript-dumping.

**Invariant:** every raw conversation event must be accounted for as visible, grouped-visible, nested-visible, or explicitly suppressed.

The renderer must never silently no-op an event because:

- a new event kind was introduced
- a payload shape drifted
- a mapper forgot to handle a case

If the renderer cannot confidently classify an event, it must emit a visible fallback row that includes:

- the event kind
- timestamp
- compact summary if available
- expandable raw payload

Suppression is allowed only for event classes this document explicitly marks as non-primary transcript material:

- `ConversationStateUpdateEvent.key === "stats"`
- `ConversationStateUpdateEvent.key === "last_user_message_id"`
- lifecycle-only transport state (`execution_status`, `PauseEvent`) when the same state remains accessible through the bottom status bar
- `SystemPromptEvent` only if runtime setup remains accessible through a dedicated disclosure instead of the main timeline

Repeated `execution_status` churn should update the bottom status bar rather than introducing extra transcript rows:

- `running`
- `paused`
- `finished`
- `error`

## Fixture-based Test Strategy

Tests should use the existing persisted conversation fixture folders as the source corpus.

### Source of truth

- existing checked-in conversation event fixture folders
- real persisted event JSON files from prior runs, not re-authored synthetic summaries

### Test flow

1. Load raw persisted conversation events from the fixture folder.
2. Run the same normalization path used by production.
3. Feed normalized events into the semantic timeline projection.
4. Assert both row semantics and event accounting.

### Required assertions

For each fixture:

- every raw event is accounted for
- `invoke_skill` yields a visible `Skill` row
- `task` yields a visible `Subagent` row
- child events with `parentToolCallId` attach to the correct subagent row when present
- assistant message updates remain visible even around grouped tool activity
- terminal and file-editor traffic is grouped without losing member accounting
- `stats` and `last_user_message_id` are suppressed intentionally
- `execution_status` rows only appear for meaningful lifecycle transitions
- `ConversationErrorEvent` and `AgentErrorEvent` remain visibly destructive
- unknown events render visible fallback rows

### Accounting invariant

Each fixture must satisfy:

```text
raw event count
  = visible standalone rows
  + grouped member events
  + nested subagent member events
  + suppressed events
```

Suppression must remain explicit and test-backed. Any newly suppressed event class must be added to this document and to the fixture assertions.

## Renderer Boundaries

### Shared production renderer

The production conversation surfaces share one semantic timeline renderer:

- Workflow running state
- Workspace Conversation tab

The same event classification, grouping, suppression, and nesting rules apply to both.

### Projection boundary

The timeline contract starts from raw `conversationEvents` plus raw `conversationState`. Semantic row derivation happens in the conversation UI layer, and renderer-facing display nodes remain projections rather than transcript authority.

## Key Source Files

| File | Responsibility |
|---|---|
| `app/src/components/conversation/conversation-timeline.tsx` | Shared production conversation surface for timeline rendering |
| `app/src/components/conversation/conversation-event-row.tsx` | Event row shell and semantic event presentation |
| `app/src/lib/conversation-event-projection.ts` | Conversation-event to timeline-row projection |
| `app/src/lib/conversation-event-types.ts` | Canonical frontend envelope for conversation events |
| `app/src/lib/openhands-conversation-events.ts` | OpenHands event normalization and helper extraction |
| `app/src/pages/workflow.tsx` | Workflow consumer of `ConversationTimeline` |
| `app/src/components/workspace/workspace-conversation.tsx` | Workspace Conversation consumer of `ConversationTimeline` |
