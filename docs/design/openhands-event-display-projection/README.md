---
functional-specs: []
---

# OpenHands Conversation Timeline

> **Status:** Proposed rewrite for the conversation-events-first rendering model.
> **Runtime prerequisite:** See [../openhands-runtime-contract/README.md](../openhands-runtime-contract/README.md) for session lifecycle, normalized event ingress, and backend ownership of persisted conversation state.

## Overview

Skill Builder now has a single production conversation UI model for active OpenHands sessions: a **top-to-bottom semantic timeline built directly from conversation events**.

The canonical input is `conversationEvents`. The production renderer is `ConversationTimeline`, shared by the Workflow page and the Workspace Conversation surface.

The timeline is **semantic, not generic**:

- every conversation event is rendered as a meaningful row instead of a raw `"Event captured"` placeholder
- agent updates, skill activations, and subagent launches are always visible
- ordinary operational tool traffic can be grouped for readability
- unknown or newly introduced event shapes remain visible through fallback rows

The timeline is also **lossless by contract**: grouping and visual weighting are editorial choices, not permission to silently drop events.

## Production Scope

**Current production consumers**

- `app/src/pages/workflow.tsx`
- `app/src/components/workspace/workspace-conversation.tsx`

Both mount the shared `ConversationTimeline` component.

**Out of scope**

- historical Refine-era surfaces and contracts
- converting unrelated non-conversation summaries in the app to conversation-event rendering
- backend event normalization or OpenHands wire-format cleanup
- suppression policy beyond the initial "show everything" phase

## Goals

- Replace the current generic conversation-event cards with a narrative
  timeline that still preserves operational transparency.
- Make every conversation event visible in the first pass.
- Keep `Skill` and `Subagent` as first-class visible rows.
- Keep agent updates visible as narrative rows.
- Preserve debuggability when the runtime evolves by rendering unknown event
  shapes visibly instead of silently dropping them.
- Back the renderer with fixture-driven tests over real persisted conversation
  event folders.

## Non-goals

- Recreating a second primary transcript model beside `conversationEvents`
- Hiding complexity by default in phase 1
- Inferring causal nesting that the event stream does not actually encode
- Designing a raw-vs-beautified toggle for production use

## Canonical Rendering Model

`ConversationTimeline` consumes canonical conversation events in chronological order and produces a semantic row sequence.

The store contract for active OpenHands runs is:

- raw `conversationEvents`
- latest `conversationState`

Terminal success or failure is canonical state, not a stored synthetic event. Timeline surfaces may derive a terminal `Result` or `Error` row from `conversationState` for presentation, but that row is a UI-level projection.

Each raw event must be classified into exactly one of these presentation forms:

1. **Visible standalone row**
2. **Visible grouped row member**
3. **Visible nested subagent row member**
4. **Explicitly suppressed event**
5. **Visible unknown/fallback row**

For the first implementation pass, the suppression bucket is intentionally empty. Everything is shown.

## Event Mapping

### Message events

| Event shape | Timeline row |
|---|---|
| `MessageEvent` with `source: "user"` | `Task sent` / user-message row |
| `MessageEvent` with `source: "agent"` | `Agent update` row, always visible |

### Action and observation events

| Event shape | Timeline row |
|---|---|
| Ordinary `ActionEvent` + matching `ObservationEvent` | Semantic operational row; can participate in grouped `Tool Activity` presentation |
| `ActionEvent` for `invoke_skill` | Standalone `Skill` row, always visible |
| `ActionEvent` for `task` / `task_tool_set` | Standalone `Subagent` row, always visible |
| `ObservationEvent` without a matching action | Standalone visible result row |

### System and runtime events

| Event shape | Timeline row |
|---|---|
| `SystemPromptEvent` | `Runtime setup` row |
| `ConversationStateUpdateEvent` | `State update` row |
| `Condensation*Event` | `Context condensed` row |
| `PauseEvent` | `Paused` row |
| latest `conversation_state` success | UI-derived `Result` row when the surface wants terminal narration |
| latest `conversation_state` error/cancel | UI-derived `Error` row when the surface wants terminal narration |
| unknown `eventClass` or unexpected payload | `Unknown event` row with expandable payload |

## Grouping Rules

Grouping is purely visual. It does not change event accounting.

### Allowed grouping

Ordinary tool traffic may be grouped into a `Tool Activity` row when the items belong to the same top-level conversation flow and remain adjacent after semantic row construction.

### Disallowed grouping

These rows must remain individually visible and must never be absorbed into generic tool grouping:

- `Agent update`
- `Skill`
- `Subagent`
- `Result`
- `Error`

### Group boundaries

Any visible narrative or structural row breaks the current ordinary tool group.

At minimum, grouping resets on:

- user message rows
- agent update rows
- skill rows
- subagent rows
- result rows
- error rows
- explicit runtime/system rows

## Nesting Rules

### Real child subagents

Nested rendering is allowed only when the event stream provides an explicit relationship via `parentToolCallId`.

When child events carry `parentToolCallId`, they attach beneath the matching top-level `Subagent` row.

### Skill rows

`invoke_skill` is shown as a visible `Skill` row, but the renderer must not invent nested ownership for subsequent parent-agent tool calls unless the event stream provides an explicit correlation.

In other words:

- skill rows are visible
- skill rows are not fake parents for unrelated parent-agent activity

## Visibility Contract

This renderer is editorial, not lossy.

**Invariant:** every raw conversation event must be accounted for as visible, grouped-visible, nested-visible, or explicitly suppressed.

The renderer must never silently no-op an event because:

- a new `eventClass` was introduced
- a payload shape drifted
- a mapper forgot to handle a case

If the renderer cannot confidently classify an event, it must emit a visible fallback row that includes:

- the event class
- timestamp
- compact summary if available
- expandable raw payload

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
- `suppressed events = 0` in phase 1
- `invoke_skill` yields a visible `Skill` row
- `task` / `task_tool_set` yields a visible `Subagent` row
- child events with `parentToolCallId` attach to the correct subagent row
- agent message updates remain visible even around grouped tool activity
- system and state rows remain visible in the first pass
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

For the initial rollout:

```text
suppressed events = 0
```

Any future suppression policy must change this doc and update the fixture tests explicitly.

## Architecture Impact

### Shared production renderer

The production conversation surfaces converge on one renderer:

- Workflow running state
- Workspace Conversation tab

The same semantic event classification rules apply to both.

### Relationship to `displayItems`

`displayItems` should be removed from the active OpenHands run path entirely. The timeline contract is based on raw `conversationEvents` plus raw `conversationState`, with semantic row derivation happening in the conversation UI layer.

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

## Migration Notes

This document replaces the older design direction that treated projected `displayItems` as the primary production transcript path and referenced removed Refine-era consumers.

The new direction is:

- top-to-bottom conversation-event rendering
- raw `conversationState` retained as state rather than converted into stored synthetic events
- semantic row construction
- visible-first event accounting
- removal of `displayItems` from the active OpenHands transcript path
- fixture-backed guarantees against silent event loss

## Open Follow-ups

1. Define the later suppression policy once the visible-first timeline has been reviewed against real runs.
2. Decide whether `ConversationStateUpdateEvent` remains permanently visible or
   becomes an explicitly suppressed class after the first review pass.
3. Decide whether grouped tool activity should remain expanded by default in the
   first implementation or collapse immediately after grouping.
