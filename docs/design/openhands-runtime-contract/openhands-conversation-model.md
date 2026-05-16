---
functional-specs: [custom-plugin-management]
---

# OpenHands Conversation Model

> **Status:** Implemented
> **Functional specs:** Not applicable; this design defines the shared conversation/event model for OpenHands-backed surfaces.

## Overview

This page defines the clean-slate conversation model for OpenHands-backed surfaces in Skill Builder. The target model replaces agent-centric frontend authority with one shared conversation event stream that both frontend and backend contribute to.

The key idea is simple:

- OpenHands owns the raw runtime conversation protocol.
- Skill Builder owns one canonical event stream per conversation.
- UI surfaces render that stream with event-type display semantics.
- Render projections are view models only. They are not the source of truth.

This model is shared across Refine, Workflow, Eval Workbench, and throwaway OpenHands-backed surfaces where a transcript-like experience is needed.

## Design Scope

**Covers**

- the canonical event stream model for OpenHands-backed surfaces
- frontend-originated and backend-originated event ownership
- event ordering, acceptance, and failure semantics
- raw OpenHands payload retention with app-owned display metadata
- projection from canonical events into UI display models
- the final steady state after removing `agent-store` / `DisplayItem` transcript authority

**Does not cover**

- detailed visual design of any specific tab or page
- Tauri event transport redesign
- workflow step artifact schemas
- OpenHands server lifecycle and storage-root ownership already covered in [README.md](./README.md)

## Key Decisions

| Decision | Rationale |
|---|---|
| The canonical source of truth is one ordered conversation event stream. | A single stream removes drift between optimistic UI state, restored history, and agent display projections. |
| Frontend-originated events enter the stream immediately in `sending` state. | The transcript stays stable while acknowledging that the send is still pending. |
| Frontend-originated events mutate in place to `accepted` or `failed`. | The UI should not reorder accepted messages or reinsert them later based on backend timestamp. |
| Backend-originated events keep the raw OpenHands-native payload. | Raw payload retention avoids translation drift and keeps replay/debugging possible. |
| Canonical events carry a small app-owned envelope for UI metadata. | The UI needs stable local ids, local status, and display hints without rewriting the underlying OpenHands event. |
| Projection into display nodes is a pure view layer. | `DisplayItem`-style structures should be render outputs, not authoritative state. |
| Product surfaces render one shared event timeline, not synthetic turn ownership. | The UI already differentiates event types visually, so a flat event stream is sufficient and more robust than inferred turn grouping. |
| `agentId` may remain in the transport adapter temporarily, but it is not part of the target public model. | The live bridge is still keyed by `agent_id` today, but the new conversation model should be conversation-centric. |

## Canonical Event Model

Each OpenHands-backed surface owns zero or more conversations. Each conversation owns one ordered stream of canonical events.

```ts
type ConversationEventStatus =
  | "sending"
  | "accepted"
  | "failed"
  | "observed";

type ConversationEventOrigin =
  | "frontend"
  | "backend";

interface CanonicalConversationEvent {
  eventId: string;
  conversationId: string;
  origin: ConversationEventOrigin;
  status: ConversationEventStatus;
  createdAtMs: number;
  acceptedAtMs?: number | null;
  failedAtMs?: number | null;
  display: {
    kind: "user_message" | "agent_message" | "tool_call" | "tool_result" | "subagent" | "state" | "error" | "system";
    label?: string;
    collapsedByDefault?: boolean;
  };
  payload: {
    rawOpenHandsEvent?: unknown;
    frontendCommand?: {
      type: "send_message";
      text: string;
      targetFiles?: string[];
    };
    backendError?: {
      message: string;
      code?: string;
    };
  };
}
```

Important rules:

- Every event has a stable local `eventId`.
- Every event belongs to exactly one `conversationId`.
- Frontend sends are represented as canonical events, not separate local-only chat state.
- Backend-originated runtime events retain the raw OpenHands-native payload inside `payload.rawOpenHandsEvent`.
- The canonical event shape may add app-owned display metadata, but it must not lossy-rewrite the raw OpenHands payload.

Current Task 2 implementation lives in:

- `app/src/lib/conversation-event-types.ts`
- `app/src/lib/conversation-event-ordering.ts`
- `app/src/stores/conversation-store.ts`
- `app/src/lib/conversation-event-projection.ts`
- `app/src/lib/openhands-conversation-events.ts`

Current shared helper boundary above the transport is:

- `app/src/lib/conversation-runtime.ts`
- `app/src-tauri/src/commands/conversation.rs`
- `app/src/hooks/use-session-runtime-stream.ts`

## Event Sources

### Frontend-Originated Events

Frontend-originated events are currently limited to user actions that must appear in the transcript:

- send message

Future candidate frontend-originated events may include:

- explicit retry
- pause requested
- resume requested
- answer question

Target behavior for send:

1. User submits a message.
2. Frontend appends a canonical `frontend` event with:
   - `status = "sending"`
   - `display.kind = "user_message"`
   - `payload.frontendCommand.type = "send_message"`
3. Backend accepts or rejects the send.
4. The same event mutates in place:
   - `sending -> accepted`
   - or `sending -> failed`

Important rule:

- Accepted sends do not get removed and re-added.
- Failed sends remain visible in the transcript so failures are diagnosable.

### Backend-Originated Events

Backend-originated events come from the OpenHands runtime and Tauri bridge:

- raw conversation events
- raw conversation state updates
- raw runtime errors or transport errors that need transcript visibility

Backend-originated events are always appended to the stream as new events. They do not mutate prior frontend send events except where the app explicitly correlates a send acknowledgement back to the originating frontend event.

## Ordering Rules

The canonical conversation stream is append-only except for status mutation on frontend-originated pending events.

Ordering rules:

1. Frontend send events are inserted immediately at the current tail of the stream.
2. Those events keep their position while they are pending.
3. Acceptance or failure mutates the event in place.
4. Backend-originated events append in the order the app receives and normalizes them.
5. Restored persisted conversations must rebuild the same ordering contract.

This means the stream is stable from the user’s perspective:

- no message jumps
- no reinsertion after acceptance
- no “missing second message” ambiguity when the backend is still processing later runtime work

The current store implementation encodes those rules in pure helpers:

- `markEventAccepted(...)`
- `markEventFailed(...)`
- `appendObservedEvent(...)`

## Display Semantics

The UI does not invent higher-level chat ownership. It renders the canonical stream using event-type semantics.

Default display mapping:

| `display.kind` | UI treatment |
|---|---|
| `user_message` | right-aligned user bubble |
| `agent_message` | left-aligned prose block |
| `tool_call` | tool activity row |
| `tool_result` | tool output row or inline detail |
| `subagent` | subagent activity row |
| `state` | lifecycle/system row |
| `error` | error row |
| `system` | non-chat system note |

Important rules:

- The renderer should not need to infer “which turn owns this tool call.”
- The renderer should not depend on `displayItemStartIndex` slicing.
- The renderer should not treat `agentId` as the grouping key.
- Live and restored views must use the same canonical event stream and the same display mapping rules.
- `projectConversationEvents(...)` is the current pure projection boundary from canonical events into renderer-facing `DisplayNode` values.

## Relationship to Current Runtime Structures

Legacy `agent-store` and `DisplayItem` projection are removed. The shipped
model keeps exactly two frontend authorities:

- `conversation-store` for transcript state
- `session-runtime-store` for selected-session runtime lifecycle metadata

The long-term target shape is:

```text
OpenHands raw events / frontend send acknowledgements
  -> canonical conversation events
  -> pure display projection
  -> UI rendering
```

## Transport Compatibility

The current live event bridge is still keyed by `agent_id` in Tauri events and frontend listeners.

That does not change the target conversation model.

Short-term compatibility rule:

- transport adapters may still use `agent_id` internally to subscribe, route, or normalize events
- the canonical conversation model remains keyed by `conversationId`
- `agentId` must not be a first-class public transcript concept

Current implementation state:

- frontend sends go through `sendConversationMessage(...)` and the typed
  `send_conversation_message` backend command
- backend-observed runtime events append into `conversation-store` through
  `use-session-runtime-stream`
- transport metadata lives in `session-runtime-store`
- legacy `display_item` frontend transcript handling has been removed

## Surface Adoption

### Refine

Refine is the first intended adopter.

Target behavior:

- free-flow human and agent chat in one flat transcript
- user sends stay visible immediately as `sending`
- later runtime activity simply appears after them in the same conversation stream
- no synthetic turn ownership is required for correctness

### Workspace

Workspace is now the first shipped canonical conversation surface for selected skill sessions.

Current behavior:

- the selected session's `conversationId` remains the public transcript key
- `WorkspaceConversation` renders the canonical conversation timeline through `useConversationEvents(...)`, `projectConversationEvents(...)`, and the flat timeline row renderer
- selected-session hydration replays `restored_transcript_events` into `conversation-store` as canonical backend-observed events for that `conversationId`
- implicit workspace entry after selected-skill session bootstrap now restores to the conversation surface by default

### Workflow

Workflow now renders live transcript activity from the same canonical event stream while keeping its step-specific page structure.

Current behavior:

- the workflow page renders `ConversationTimeline` for the active selected session `conversationId`
- workflow initialization still uses a lightweight spinner until canonical conversation events arrive for the active run
- completed-step and gate-specific UI remain workflow-specific page concerns layered around the shared conversation stream

Workflow now tracks active run lifecycle through `session-runtime-store`.
Important rule:

- Workflow may project the shared stream differently, but it should not fork the underlying event authority model.

### Throwaway Surfaces

Throwaway runs can also use the canonical event stream if they need transcript rendering. They may choose a simpler renderer if they only need progress plus terminal result.

## Key Source Files

| File | Purpose |
|---|---|
| [app/src/lib/conversation-event-types.ts](/Users/hbanerjee/src/worktrees/feature/openhands-conversation-redesig/app/src/lib/conversation-event-types.ts) | Canonical event envelope, statuses, origins, and payload metadata |
| [app/src/lib/conversation-event-ordering.ts](/Users/hbanerjee/src/worktrees/feature/openhands-conversation-redesig/app/src/lib/conversation-event-ordering.ts) | Pure ordering helpers for in-place acceptance/failure mutation and observed-event appends |
| [app/src/stores/conversation-store.ts](/Users/hbanerjee/src/worktrees/feature/openhands-conversation-redesig/app/src/stores/conversation-store.ts) | Canonical frontend transcript authority keyed by `conversationId` |
| [app/src/lib/conversation-event-projection.ts](/Users/hbanerjee/src/worktrees/feature/openhands-conversation-redesig/app/src/lib/conversation-event-projection.ts) | Pure projection from canonical events into renderer-facing display nodes |
| [app/src/lib/openhands-conversation-events.ts](/Users/hbanerjee/src/worktrees/feature/openhands-conversation-redesig/app/src/lib/openhands-conversation-events.ts) | Normalization helpers plus backend-to-canonical envelope mapping for OpenHands runtime payloads |
| [app/src/lib/conversation-runtime.ts](/Users/hbanerjee/src/worktrees/feature/openhands-conversation-redesig/app/src/lib/conversation-runtime.ts) | Frontend send helper for conversation-scoped actions |
| [app/src-tauri/src/commands/conversation.rs](/Users/hbanerjee/src/worktrees/feature/openhands-conversation-redesig/app/src-tauri/src/commands/conversation.rs) | Session-based backend command surface for selected-skill conversation sends |
| [app/src/components/conversation/conversation-timeline.tsx](/Users/hbanerjee/src/worktrees/feature/openhands-conversation-redesig/app/src/components/conversation/conversation-timeline.tsx) | Flat canonical renderer for conversation-store-backed display nodes |
| [app/src/components/workspace/workspace-conversation.tsx](/Users/hbanerjee/src/worktrees/feature/openhands-conversation-redesig/app/src/components/workspace/workspace-conversation.tsx) | Clean-slate workspace transcript surface bound to the selected session |
| [app/src/pages/workflow.tsx](/Users/hbanerjee/src/worktrees/feature/openhands-conversation-redesig/app/src/pages/workflow.tsx) | Workflow page that now renders canonical conversation activity for the active selected session |
| [app/src/stores/session-runtime-store.ts](/Users/hbanerjee/src/worktrees/feature/openhands-conversation-redesig/app/src/stores/session-runtime-store.ts) | Session-centric runtime lifecycle store for active selected-skill runs without transcript state |

## Relationship to Existing Design Specs

| Spec | Relationship |
|---|---|
| [README.md](./README.md) | Parent runtime contract; this page defines the conversation/event model that sits under those runtime primitives |
| [refine-sequence.md](./refine-sequence.md) | Current sequence view; should eventually be revised to describe the shared event stream model instead of logical turn ownership |
| [../openhands-event-display-projection/README.md](../openhands-event-display-projection/README.md) | Existing frontend display projection design; this page changes the source-of-truth boundary underneath it |
| [implementation-gaps.md](./implementation-gaps.md) | Tracks the concrete migration work needed to reach this model |

## Open Questions

1. `[design]` Whether send acknowledgement should come from a dedicated backend acknowledgement event or from correlation against current command responses.
2. `[design]` Whether the canonical event stream should be persisted app-side as a normalized cache or always rebuilt from OpenHands conversation history plus local pending state.
3. `[design]` Whether additional throwaway OpenHands surfaces should also adopt `session-runtime-store`, or keep lighter-weight local runtime state when they do not expose a transcript.
