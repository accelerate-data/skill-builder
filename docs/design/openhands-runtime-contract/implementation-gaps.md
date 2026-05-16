# OpenHands Conversation Model Implementation Gaps

Current gaps between the merged runtime contract and the target conversation model in [openhands-conversation-model.md](./openhands-conversation-model.md).

## 1. `agent-store` Still Owns Transcript Authority

Target model expects:

- one canonical conversation event stream per `conversationId`
- transcript authority to live in that stream
- runtime-oriented stores to become transport adapters only

Current frontend runtime state still treats `agent-store` as authoritative for live transcript rendering through `runs[agentId]`, `displayItems`, and `conversationEvents`.

Relevant files:

- `app/src/stores/agent-store.ts`
- `app/src/stores/agent-display-buffer.ts`
- `app/src/hooks/use-agent-stream.ts`

## 2. `DisplayItem` Is Still More Than a View Model

Target model expects:

- canonical conversation events as the source of truth
- `DisplayItem` or equivalent display nodes to be derived projections only

Current code still stores transcript-like authority inside `DisplayItem[]`, including grouping and ownership assumptions that should instead be derived from canonical events.

Relevant files:

- `app/src/lib/display-types.ts`
- `app/src/lib/openhands-event-projection.ts`
- `app/src/components/agent-items/**`
- `app/src/components/refine/agent-turn-inline.tsx`

## 3. Refine Still Uses Synthetic Agent-Turn Grouping

Target model expects:

- one flat ordered event stream
- renderer-level event display semantics
- no transcript authority based on synthetic turn boundaries, display item indices, or agent-group slicing

Current Refine still relies on:

- `RefineMessage.role === "agent"`
- `displayItemStartIndex`
- `displayItemSplitIndex`
- agent-turn inline slices

Relevant files:

- `app/src/stores/refine-store.ts`
- `app/src/components/refine/chat-message-list.tsx`
- `app/src/components/refine/agent-turn-inline.tsx`
- `app/src/components/workspace/workspace-refine.tsx`

## 4. Frontend-Originated Sends Are Not Yet First-Class Canonical Events

Target model expects:

- a frontend-originated canonical event inserted immediately in `sending` state
- in-place mutation to `accepted` or `failed`
- no separate optimistic chat model outside the canonical stream

Current Refine still uses separate local message insertion plus later runtime event projection, which allows drift between:

- local UI state
- backend-accepted conversation state
- restored conversation history

Relevant files:

- `app/src/components/workspace/workspace-refine.tsx`
- `app/src/stores/refine-store.ts`
- `app/src/lib/skill-openhands-session.ts`

## 5. Backend Acceptance Does Not Yet Correlate to a Canonical Frontend Event

Target model expects:

- the same frontend-originated event to mutate from `sending` to `accepted` or `failed`
- a stable local event id or correlation token

Current command flows return runtime data like `agent_id`, `conversation_id`, and `run_started`, but they do not yet participate in a canonical conversation-event acknowledgement contract.

Relevant files:

- `app/src-tauri/src/commands/refine/mod.rs`
- `app/src/lib/tauri.ts`
- `app/src/lib/tauri-command-types.ts`

## 6. The Live Event Bridge Is Still Keyed by `agent_id`

Target model expects:

- transcript authority keyed by `conversationId`
- `agentId` to remain a transport detail only if still required

Current Tauri event payloads and frontend listeners are still keyed primarily by `agent_id`.

This is acceptable as a migration seam, but it means the new conversation model still needs a transport adapter before `agentId` can disappear from frontend public state.

Relevant files:

- `app/src/hooks/use-agent-stream.ts`
- `app/src-tauri/src/agents/event_router.rs`
- `app/src-tauri/src/agents/event_types.rs`
- `app/src-tauri/src/types/refine.rs`

## 7. Raw OpenHands Payload Retention Is Not Yet the Frontend Transcript Contract

Target model expects:

- canonical events to carry the raw OpenHands-native payload
- app-owned envelope metadata to sit around that payload
- projection to remain reversible and debuggable

Current frontend normalized event handling is useful, but it does not yet define one canonical event envelope that clearly retains:

- raw OpenHands payload
- frontend command payload
- acceptance/failure state
- display metadata

Relevant files:

- `app/src/lib/openhands-conversation-events.ts`
- `app/src/lib/openhands-event-projection.ts`
- `app/src/lib/types.ts`

## 8. Live and Restored Transcript Construction Still Use Different Mental Models

Target model expects:

- one canonical event model
- one projection layer
- identical behavior for live and restored views

Current code still mixes:

- live event ingestion from `use-agent-stream`
- restored transcript rebuilding in `skill-openhands-session.ts`
- local Refine message state in `refine-store.ts`

That split is the source of many “it was sent and persisted but not visible live” failures.

Relevant files:

- `app/src/hooks/use-agent-stream.ts`
- `app/src/lib/skill-openhands-session.ts`
- `app/src/stores/refine-store.ts`

## 9. Workflow and Other OpenHands-Backed Surfaces Do Not Yet Share a Canonical Conversation Event Layer

Target model expects one shared conversation/event model across all OpenHands-backed surfaces, even if each surface projects the stream differently.

Current behavior is still surface-specific:

- Refine has one transcript path
- Workflow has another
- throwaway surfaces often bypass transcript concerns entirely

Relevant files:

- `app/src/pages/workflow.tsx`
- `app/src/components/workspace/workspace-refine.tsx`
- `app/src/components/agent-output-panel.tsx`
- `app/src-tauri/src/commands/skill/scope_review.rs`
- `app/src-tauri/src/commands/eval_workbench/mod.rs`

## 10. Documentation Still Splits Between Runtime Contract and Old Projection Assumptions

Target model expects:

- runtime contract docs to point to the canonical conversation stream
- projection docs to describe view-layer semantics only

Current docs still describe agent/display grouping assumptions that should be downgraded to migration-era behavior.

Relevant files:

- `docs/design/openhands-runtime-contract/README.md`
- `docs/design/openhands-runtime-contract/refine-sequence.md`
- `docs/design/openhands-event-display-projection/README.md`
