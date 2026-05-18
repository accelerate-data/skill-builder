---
functional-specs: [custom-plugin-management]
---

# OpenHands Conversation Model

> **Status:** Implemented
> **Functional specs:** Not applicable; this design defines the shared conversation/event model for OpenHands-backed surfaces.

## Overview

This page defines the conversation model for OpenHands-backed surfaces in Skill Builder. One shared conversation event stream is the source of truth, with both frontend and backend contributing to it.

The key idea is simple:

- OpenHands owns the raw runtime conversation protocol.
- Skill Builder owns one canonical event stream per conversation.
- UI surfaces render that stream with event-type display semantics.
- Render projections are view models only. They are not the source of truth.

This model is shared across selected-skill persistent sessions, Workflow, Eval Workbench, and throwaway OpenHands-backed surfaces where a transcript-like experience is needed.

## Design Scope

**Covers**

- the canonical event stream model for OpenHands-backed surfaces
- frontend-originated and backend-originated event ownership
- event ordering, acceptance, and failure semantics
- raw OpenHands payload retention with app-owned display metadata
- projection from canonical events into UI display models

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
| Projection into display nodes is a pure view layer. | Renderer-facing display nodes should be render outputs, not authoritative state. |
| Product surfaces render one shared event timeline, not synthetic turn ownership. | The UI already differentiates event types visually, so a flat event stream is sufficient and more robust than a second turn-grouped transcript model. |
| `conversationId` is the canonical runtime and transcript identity at every active boundary. | The live bridge, canonical store, and render path are all conversation-centric. |

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

// Matches ConversationDisplayKind in conversation-event-types.ts.
// For frontend-originated events this is set at envelope creation.
// For backend-originated events the projection layer derives display
// semantics from payload.openHandsEvent.kind via conversation-display-semantics.ts.
type ConversationDisplayKind =
  | "user_message"
  | "agent_message"
  | "tool_call"
  | "tool_result"
  | "subagent"
  | "state"
  | "error"
  | "system";

interface ConversationEventEnvelope {
  eventId: string;
  conversationId: string;
  origin: ConversationEventOrigin;
  status: ConversationEventStatus;
  createdAtMs: number;
  acceptedAtMs?: number | null;
  failedAtMs?: number | null;
  display: {
    kind: ConversationDisplayKind;
    label?: string;
    collapsedByDefault?: boolean;
  };
  payload: {
    // Strongly-typed normalized OpenHands event. This is the primary field
    // read by the display projection layer (conversation-display-semantics.ts).
    openHandsEvent?: OpenHandsConversationEvent;
    // Correlation metadata (tool_call_id, parent_tool_call_id, raw wire payload).
    openHandsDiagnostics?: OpenHandsEventDiagnostics;
    // Retained raw wire shape for replay/debugging.
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
- Backend-originated runtime events carry the typed normalized payload in `payload.openHandsEvent`; the raw wire shape is retained separately in `payload.rawOpenHandsEvent` for debugging.
- The canonical event shape may add app-owned display metadata, but it must not lossy-rewrite the raw OpenHands payload.

Implementation lives in:

- `app/src/lib/conversation-event-types.ts`
- `app/src/lib/conversation-event-ordering.ts`
- `app/src/stores/conversation-store.ts`
- `app/src/lib/conversation-event-projection.ts`
- `app/src/lib/openhands-conversation-events.ts`

Shared helper boundary above the transport:

- `app/src/lib/conversation-runtime.ts`
- `app/src-tauri/src/commands/conversation.rs`
- `app/src/hooks/use-session-runtime-stream.ts`

## Event Sources

### Frontend-Originated Events

Frontend-originated events are user actions that must appear in the transcript:

- send message

Send behavior:

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

This means the stream is stable from the user's perspective:

- no message jumps
- no reinsertion after acceptance
- no "missing second message" ambiguity when the backend is still processing later runtime work

The store implementation encodes those rules in pure helpers:

- `markEventAccepted(...)`
- `markEventFailed(...)`
- `appendObservedEvent(...)`

## Display Projection Boundary

The canonical conversation model stops at the ordered event stream plus its app-owned envelope. Detailed row taxonomy, grouping, suppression, and nesting rules belong to the event-display projection design, not to the runtime contract.

The UI-facing rules are:

- the renderer does not invent higher-level turn ownership
- the renderer does not depend on `displayItemStartIndex` slicing
- the renderer treats `conversationId` as the grouping key
- live and restored views use the same canonical event stream and the same projection boundary

The detailed rendering semantics live in:

- `docs/design/openhands-event-display-projection/README.md`

The pure projection boundary from canonical events into renderer-facing `DisplayNode` values is:

- `projectConversationEvents(...)` in `conversation-event-projection.ts`

Event-kind classification (transcript vs. internal vs. suppressed), tool-call pairing, and trace-node construction live in:

- `conversation-display-semantics.ts`

## Runtime Structures

Two frontend authorities manage state:

- `conversation-store` for transcript state
- `session-runtime-store` for selected-session runtime lifecycle metadata

The pipeline is:

```text
OpenHands raw events / frontend send acknowledgements
  -> canonical conversation events
  -> pure display projection
  -> UI rendering
```

## Transport Contract

The live event bridge is keyed by `conversation_id` in Tauri events and frontend listeners.

Normalization happens in two steps:

1. Rust (`agents/openhands_server/`) does field-level cleanup — discriminator normalization, falling back to the SDK `kind` field when `event_class` is absent, and stripping wire-transport metadata before the Tauri event is emitted.
2. Frontend `openhands-conversation-events.ts` (`normalizeOpenHandsEventRecord(...)`) does the final normalization into typed `OpenHandsConversationEvent` shapes from the TypeScript client contract. This runs in both `use-session-runtime-stream.ts` (live events) and `skill-openhands-session.ts` (restore history).

- frontend sends go through `sendConversationMessage(...)` and the typed `send_conversation_message` backend command
- backend-observed runtime events are normalized and appended into `conversation-store` through `use-session-runtime-stream`
- transport metadata lives in `session-runtime-store`

## Surface Adoption

### Workspace

Workspace is the canonical conversation surface for selected skill sessions.

- the selected session's `conversationId` is the public transcript key
- `WorkspaceConversation` renders the canonical conversation timeline through `useConversationEvents(...)`, `projectConversationEvents(...)`, and the flat timeline row renderer
- selected-session hydration replays `restored_transcript_events` into `conversation-store` as canonical backend-observed events for that `conversationId`
- implicit workspace entry after selected-skill session bootstrap restores to the conversation surface by default

### Workflow

Workflow renders live transcript activity from the same canonical event stream while keeping its step-specific page structure.

- the workflow page renders `ConversationTimeline` for the active selected session `conversationId`
- workflow initialization uses a lightweight spinner until canonical conversation events arrive for the active run
- completed-step and gate-specific UI remain workflow-specific page concerns layered around the shared conversation stream

Workflow tracks active run lifecycle through `session-runtime-store`.

Important rule:

- Workflow may project the shared stream differently, but it should not fork the underlying event authority model.

### Throwaway Surfaces

Throwaway runs can also use the canonical event stream if they need transcript rendering. They may choose a simpler renderer if they only need progress plus terminal result.

## Key Source Files

| File | Purpose |
|---|---|
| `app/src/lib/conversation-event-types.ts` | Canonical event envelope (`ConversationEventEnvelope`), statuses, origins, and payload metadata |
| `app/src/lib/conversation-event-ordering.ts` | Pure ordering helpers for in-place acceptance/failure mutation and observed-event appends |
| `app/src/stores/conversation-store.ts` | Canonical frontend transcript authority keyed by `conversationId` |
| `app/src/lib/conversation-event-projection.ts` | Pure projection from canonical events into renderer-facing display nodes |
| `app/src/lib/conversation-display-semantics.ts` | Event-kind classification (transcript, trace, suppressed), tool-call pairing, and trace-node construction |
| `app/src/lib/openhands-conversation-events.ts` | Normalization helpers (`normalizeOpenHandsEventRecord`) and backend-to-canonical envelope mapping |
| `app/src/lib/conversation-runtime.ts` | Frontend send helper for conversation-scoped actions |
| `app/src-tauri/src/commands/conversation.rs` | Session-based backend command surface for selected-skill conversation sends |
| `app/src/components/conversation/conversation-timeline.tsx` | Flat canonical renderer for conversation-store-backed display nodes |
| `app/src/components/workspace/workspace-conversation.tsx` | Workspace transcript surface bound to the selected session |
| `app/src/pages/workflow.tsx` | Workflow page that renders canonical conversation activity for the active selected session |
| `app/src/stores/session-runtime-store.ts` | Session-centric runtime lifecycle store for active selected-skill runs without transcript state |

## Relationship to Existing Design Specs

| Spec | Relationship |
|---|---|
| [README.md](./README.md) | Parent runtime contract; this page defines the conversation/event model that sits under those runtime primitives |
| [selected-skill-conversation-sequence.md](./selected-skill-conversation-sequence.md) | Shared persistent selected-skill conversation sequence, including workflow-specific run and reset behavior |
| [../openhands-event-display-projection/README.md](../openhands-event-display-projection/README.md) | Frontend event rendering and display projection design; defines event classification, tool pairing, trace kinds, and renderer behavior above the canonical event stream defined here |

## Open Questions

1. `[design]` Whether additional throwaway OpenHands surfaces should also adopt `session-runtime-store`, or keep lighter-weight local runtime state when they do not expose a transcript.
