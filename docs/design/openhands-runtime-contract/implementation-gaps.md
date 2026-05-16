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

## 6. Partially Resolved in Task 3: The Live Event Bridge Is Still Keyed by `agent_id`

Target model expects:

- transcript authority keyed by `conversationId`
- `agentId` to remain a transport detail only if still required

Current Tauri event payloads and frontend listeners are still keyed primarily
by `agent_id`, but Task 3 now bridges those events into canonical backend
observed events in `conversation-store` using the selected session's
`conversationId` when the runtime payload does not include one.

This keeps `agentId` as a transport concern in the live bridge, but the
transport seam still exists until the remaining consumers stop depending on the
legacy `agent-store` path.

Relevant files:

- `app/src/hooks/use-agent-stream.ts`
- `app/src-tauri/src/agents/event_router.rs`
- `app/src-tauri/src/agents/event_types.rs`
- `app/src-tauri/src/types/session.rs`

## 7. Partially Resolved in Task 3: Raw OpenHands Payload Retention Is Not Yet the Only Frontend Transcript Contract

Target model expects:

- canonical events to carry the raw OpenHands-native payload
- app-owned envelope metadata to sit around that payload
- projection to remain reversible and debuggable

The canonical envelope now exists in code and carries the raw OpenHands payload
plus app-owned metadata. The remaining gap is that legacy projection consumers
still coexist beside that canonical path.

The migration target still expects one shared transcript contract that clearly retains:

- raw OpenHands payload
- frontend command payload
- acceptance/failure state
- display metadata

Relevant files:

- `app/src/lib/openhands-conversation-events.ts`
- `app/src/lib/conversation-event-types.ts`
- `app/src/stores/conversation-store.ts`
- `app/src/lib/openhands-event-projection.ts`

## 8. Resolved in Task 4: Selected-Skill Restoration Now Replays Canonical History

Target model expects:

- one canonical event model
- one projection layer
- identical behavior for live and restored views

Current code still splits responsibilities between:

- live event ingestion from `use-agent-stream`
- restored session metadata bootstrap in `skill-openhands-session.ts`
- agent-run display state in `agent-store`

The old Refine-specific transcript path is gone, and the canonical shared conversation event layer now exists for both live backend-observed events and restored selected-skill history. Task 4 now replays `restored_transcript_events` into `conversation-store` during selected-session hydration, so the workspace surface uses the same canonical store for restored and live transcript activity.

Relevant files:

- `app/src/hooks/use-agent-stream.ts`
- `app/src/lib/skill-openhands-session.ts`
- `app/src/components/workspace/workspace-conversation.tsx`
- `app/src/stores/agent-store.ts`

## 9. Partially Resolved in Task 5: Workflow Now Shares the Canonical Conversation Event Layer, but Runtime Ownership Is Still Split

Target model expects one shared conversation/event model across all OpenHands-backed surfaces, even if each surface projects the stream differently.

Current behavior is now:

- Workspace has a canonical conversation surface for selected-skill sessions
- Workflow renders transcript activity from the canonical conversation surface
- restored selected-skill bootstrap replays canonical history into `conversation-store`
- Workflow orchestration still depends on `agent-store` lifecycle state
- throwaway surfaces often bypass transcript concerns entirely

Relevant files:

- `app/src/components/workspace/workspace-conversation.tsx`
- `app/src/pages/workflow.tsx`
- `app/src/hooks/use-workflow-state-machine.ts`
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
