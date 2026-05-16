# OpenHands Conversation Model Implementation Gaps

Current gaps between the merged runtime contract and the target conversation model in [openhands-conversation-model.md](./openhands-conversation-model.md).

Task 1 of the reimplementation plan has already removed the legacy Refine UI,
its dedicated Zustand store, and the Refine-only backend command surface. The
remaining gaps below are the post-clean-break conversation-model gaps.

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

## 3. Resolved in Task 1: Legacy Refine Turn Grouping Removed

The deleted Refine tree no longer owns transcript grouping. That removes the
old agent-turn projection seam entirely instead of migrating it.

## 4. Resolved in Task 1: Separate Refine Message State Removed

The product no longer has a parallel Refine message model. Selected-skill
session bootstrap now hydrates shared session metadata only, which avoids
keeping a second transcript authority alive while the canonical model is built.

## 5. Resolved in Task 1: Refine Dispatch Command Surface Removed

The Refine-specific send/finalize command path has been deleted. Future
conversation acknowledgement work will be added on the new canonical
conversation-event surface rather than extending the removed Refine contract.

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

Current code still splits responsibilities between:

- live event ingestion from `use-agent-stream`
- restored session metadata bootstrap in `skill-openhands-session.ts`
- agent-run display state in `agent-store`

The old Refine-specific transcript path is gone, but the canonical shared
conversation event layer still does not exist.

Relevant files:

- `app/src/hooks/use-agent-stream.ts`
- `app/src/lib/skill-openhands-session.ts`
- `app/src/stores/agent-store.ts`

## 9. Workflow and Other OpenHands-Backed Surfaces Do Not Yet Share a Canonical Conversation Event Layer

Target model expects one shared conversation/event model across all OpenHands-backed surfaces, even if each surface projects the stream differently.

Current behavior is still surface-specific:

- selected-skill bootstrap only restores session metadata today
- Workflow has its own transcript path
- throwaway surfaces often bypass transcript concerns entirely

Relevant files:

- `app/src/pages/workflow.tsx`
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
- `docs/design/openhands-event-display-projection/README.md`
