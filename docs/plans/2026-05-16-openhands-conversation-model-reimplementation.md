# OpenHands Conversation Model Reimplementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current Refine and transcript projection stack with one canonical OpenHands conversation-event model, then migrate all OpenHands-backed surfaces onto it before deleting the legacy `agent_id`-centric helpers.

**Architecture:** PR 1 makes a clean break by deleting the existing Refine UI and Refine-only backend command surface with no fallback. Subsequent PRs introduce a canonical conversation event stream keyed by `conversationId`, build new shared conversation helpers above the existing transport bridge, migrate the workspace conversation UI first, migrate the Workflow UI second, and only then delete the old `agent_id`-centric public helpers.

**Tech Stack:** TypeScript (React, Zustand, Vitest), Rust (Tauri), OpenHands Agent Server event payloads, existing WebSocket/Tauri event bridge

---

## Task 1: PR 1 — Delete the Existing Refine Surface and Refine-Only Helpers

**Files:**

- Modify: `app/src/pages/workflow.tsx`
- Delete: `app/src/components/workspace/workspace-refine.tsx`
- Delete: `app/src/components/refine/**`
- Delete: `app/src/stores/refine-store.ts`
- Delete: `app/src-tauri/src/commands/refine/mod.rs`
- Delete: `app/src-tauri/src/commands/refine/content.rs`
- Delete: `app/src-tauri/src/commands/refine/diff.rs`
- Delete: `app/src-tauri/src/commands/refine/events.rs`
- Delete: `app/src-tauri/src/commands/refine/output.rs`
- Delete: `app/src-tauri/src/commands/refine/protocol.rs`
- Delete: `app/src-tauri/src/commands/refine/tests.rs`
- Modify: `app/src-tauri/src/lib.rs`
- Modify: `repo-map.json`
- Delete/Modify tests: `app/src/__tests__/components/workspace/workspace-refine.test.tsx`, `app/src/__tests__/components/refine/**`, `app/src/__tests__/stores/refine-store.test.ts`, `app/src/__tests__/lib/skill-openhands-session.test.ts`

- [ ] **Step 1: Remove Refine from the Workflow page and route-level UI**

```tsx
// app/src/pages/workflow.tsx
// Remove the Refine tab content and any imports that only serve the current Refine UI.
// Keep Workflow usable without a hidden compatibility mount.
const tabs = [
  { id: "overview", label: "Overview" },
  { id: "eval-workbench", label: "Eval Workbench" },
];
```

- [ ] **Step 2: Delete the old Refine component tree and store**

```text
Delete:
- app/src/components/workspace/workspace-refine.tsx
- app/src/components/refine/
- app/src/stores/refine-store.ts
```

- [ ] **Step 3: Delete the Refine-specific Tauri command module**

```rust
// app/src-tauri/src/lib.rs
// Remove command registrations for the refine module.
// Remove the `commands::refine` module import if nothing else uses it.
```

- [ ] **Step 4: Keep shared runtime helpers that are still used outside Refine**

```text
Do not delete in PR 1:
- app/src-tauri/src/agents/tracked_openhands.rs
- app/src-tauri/src/agents/event_router.rs
- app/src-tauri/src/agents/event_types.rs
- app/src/hooks/use-agent-stream.ts
- app/src/stores/agent-store.ts

These remain the migration seam for Workflow and other surfaces until later PRs.
```

- [ ] **Step 5: Remove or rewrite tests that only cover the deleted Refine surface**

```bash
cd app && npx vitest run \
  src/__tests__/pages/workflow.test.tsx \
  src/__tests__/components/agent-output-panel.test.tsx
```

Expected:

- deleted Refine test files are gone
- remaining Workflow tests either pass or are updated to match the Refine removal

- [ ] **Step 6: Update design docs to record the Refine clean break**

```text
Update:
- docs/design/openhands-runtime-contract/README.md
- docs/design/openhands-runtime-contract/implementation-gaps.md

Record that the legacy Refine surface and Refine-only backend command path have been removed,
and that the repo is intentionally between surfaces until the new conversation model lands.
```

- [ ] **Step 7: Verify PR 1 and commit**

```bash
cd app && npx tsc --noEmit
cd app && npm run test:unit -- workflow
cargo test --manifest-path app/src-tauri/Cargo.toml commands::workflow --quiet
```

Commit:

```bash
git add app/src app/src-tauri/src repo-map.json
git commit -m "refactor: remove legacy refine surface"
```

## Task 2: Build the Canonical Conversation Event Core

**Files:**

- Create: `app/src/lib/conversation-event-types.ts`
- Create: `app/src/lib/conversation-event-ordering.ts`
- Create: `app/src/stores/conversation-store.ts`
- Create: `app/src/lib/conversation-event-projection.ts`
- Modify: `app/src/lib/openhands-conversation-events.ts`
- Modify: `app/src/lib/display-types.ts`
- Test: `app/src/__tests__/lib/conversation-event-ordering.test.ts`
- Test: `app/src/__tests__/stores/conversation-store.test.ts`
- Test: `app/src/__tests__/lib/conversation-event-projection.test.ts`

- [ ] **Step 1: Define the canonical frontend event envelope**

```ts
// app/src/lib/conversation-event-types.ts
export type ConversationEventStatus = "sending" | "accepted" | "failed" | "observed";
export type ConversationEventOrigin = "frontend" | "backend";

export interface ConversationEventEnvelope {
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
    frontendCommand?: { type: "send_message"; text: string };
    backendError?: { message: string; code?: string };
  };
}
```

- [ ] **Step 2: Write ordering tests before the store**

```ts
// app/src/__tests__/lib/conversation-event-ordering.test.ts
it("keeps a sending user event in place when it becomes accepted", () => {
  const stream = [
    makeSendingUserEvent("evt-1", "conv-1", "hello"),
    makeBackendEvent("evt-2", "conv-1", "state"),
  ];

  const updated = markEventAccepted(stream, "evt-1", 2000);

  expect(updated[0].status).toBe("accepted");
  expect(updated[0].eventId).toBe("evt-1");
  expect(updated[1].eventId).toBe("evt-2");
});
```

- [ ] **Step 3: Implement the conversation store as the only transcript authority**

```ts
// app/src/stores/conversation-store.ts
interface ConversationStoreState {
  eventsByConversation: Record<string, ConversationEventEnvelope[]>;
  appendFrontendSendingEvent: (event: ConversationEventEnvelope) => void;
  markFrontendEventAccepted: (conversationId: string, eventId: string, acceptedAtMs: number) => void;
  markFrontendEventFailed: (conversationId: string, eventId: string, error: { message: string; code?: string }, failedAtMs: number) => void;
  appendBackendObservedEvent: (event: ConversationEventEnvelope) => void;
  replaceConversationHistory: (conversationId: string, events: ConversationEventEnvelope[]) => void;
}
```

- [ ] **Step 4: Add a pure projection layer from canonical events to display nodes**

```ts
// app/src/lib/conversation-event-projection.ts
export function projectConversationEvents(events: ConversationEventEnvelope[]): DisplayNode[] {
  return events.map((event) => ({
    id: event.eventId,
    kind: event.display.kind,
    status: event.status,
    payload: event.payload,
    label: event.display.label,
  }));
}
```

- [ ] **Step 5: Update design docs for the canonical event core**

```text
Update:
- docs/design/openhands-runtime-contract/openhands-conversation-model.md
- docs/design/openhands-runtime-contract/README.md

Document the exact canonical event envelope, status transitions, and projection-layer boundary
that now exist in code.
```

- [ ] **Step 6: Verify Task 2 and commit**

```bash
cd app && npx vitest run \
  src/__tests__/lib/conversation-event-ordering.test.ts \
  src/__tests__/stores/conversation-store.test.ts \
  src/__tests__/lib/conversation-event-projection.test.ts
cd app && npx tsc --noEmit
```

Commit:

```bash
git add app/src
git commit -m "feat: add canonical conversation event core"
```

## Task 3: Build New Shared Conversation Helpers Above the Existing Transport

**Files:**

- Create: `app/src/lib/conversation-runtime.ts`
- Create: `app/src/hooks/use-conversation-stream.ts`
- Create: `app/src-tauri/src/commands/conversation.rs`
- Modify: `app/src-tauri/src/lib.rs`
- Modify: `app/src/lib/tauri.ts`
- Modify: `app/src/lib/tauri-command-types.ts`
- Modify: `app/src/hooks/use-agent-stream.ts`
- Modify: `app/src/stores/agent-store.ts`
- Test: `app/src/__tests__/hooks/use-conversation-stream.test.ts`
- Test: `app/src/__tests__/lib/conversation-runtime.test.ts`
- Test: `app/src-tauri/src/commands/conversation.rs` (inline tests if appropriate)

- [ ] **Step 1: Add conversation-centric frontend helpers**

```ts
// app/src/lib/conversation-runtime.ts
export async function sendConversationMessage(args: {
  conversationId: string;
  message: string;
  localEventId: string;
}): Promise<{ accepted: true } | { accepted: false; error: string }> {
  return invokeTauriCommand("send_conversation_message", args);
}
```

- [ ] **Step 2: Add a shared backend command surface for conversation actions**

```rust
// app/src-tauri/src/commands/conversation.rs
#[tauri::command]
pub async fn send_conversation_message(
    app: tauri::AppHandle,
    conversation_id: String,
    local_event_id: String,
    message: String,
) -> Result<ConversationSendAck, String> {
    // Append to the existing OpenHands conversation.
    // Start a run only if the conversation is idle.
    // Return acceptance/failure for the frontend event mutation.
}
```

- [ ] **Step 3: Bridge legacy `agent_id` transport events into canonical backend events**

```ts
// app/src/hooks/use-conversation-stream.ts
// Consume existing runtime events, normalize them into ConversationEventEnvelope,
// and append them into conversation-store by conversationId.
useEffect(() => {
  return subscribeToRuntimeEvents((runtimeEvent) => {
    const normalized = normalizeRuntimeEventToConversationEnvelope(runtimeEvent);
    conversationStore.appendBackendObservedEvent(normalized);
  });
}, []);
```

- [ ] **Step 4: Freeze the old helpers as transport-only seams**

```text
Allowed temporary role:
- app/src/hooks/use-agent-stream.ts
- app/src/stores/agent-store.ts

Forbidden after this task:
- new transcript authority
- new Refine/Workflow-specific display grouping
- new product-level state additions
```

- [ ] **Step 5: Update design docs for the new helper boundary**

```text
Update:
- docs/design/openhands-runtime-contract/README.md
- docs/design/openhands-runtime-contract/openhands-conversation-model.md
- docs/design/openhands-runtime-contract/implementation-gaps.md

Describe the new conversation-centric helper layer and mark the legacy `agent_id` path as a
temporary transport bridge only.
```

- [ ] **Step 6: Verify Task 3 and commit**

```bash
cd app && npx vitest run \
  src/__tests__/hooks/use-conversation-stream.test.ts \
  src/__tests__/lib/conversation-runtime.test.ts \
  src/__tests__/stores/agent-store.test.ts
cd app && npx tsc --noEmit
cargo test --manifest-path app/src-tauri/Cargo.toml commands::conversation --quiet
```

Commit:

```bash
git add app/src app/src-tauri/src
git commit -m "feat: add conversation-centric runtime helpers"
```

## Task 4: PR 4 — Build the New Workspace Conversation Surface

**Files:**

- Create: `app/src/components/conversation/conversation-timeline.tsx`
- Create: `app/src/components/conversation/conversation-event-row.tsx`
- Create: `app/src/components/workspace/workspace-conversation.tsx`
- Modify: `app/src/lib/skill-openhands-session.ts`
- Test: `app/src/__tests__/components/conversation/conversation-timeline.test.tsx`
- Test: `app/src/__tests__/components/workspace/workspace-conversation.test.tsx`

- [ ] **Step 1: Build the flat timeline renderer over canonical events**

```tsx
// app/src/components/conversation/conversation-timeline.tsx
export function ConversationTimeline({ conversationId }: { conversationId: string }) {
  const events = useConversationEvents(conversationId);
  const nodes = projectConversationEvents(events);

  return (
    <div>
      {nodes.map((node) => (
        <ConversationEventRow key={node.id} node={node} />
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Add the new clean-slate conversation workspace surface**

```tsx
// app/src/components/workspace/workspace-conversation.tsx
// This replaces the old Refine contract entirely.
// It reads only from conversation-store and conversation-runtime helpers.
```

- [ ] **Step 3: Wire the workspace surface to selected-skill session restoration**

```ts
// app/src/lib/skill-openhands-session.ts
// Restore raw OpenHands events into canonical conversation events.
// Feed the workspace conversation surface without any refine-store shim.
```

- [ ] **Step 4: Update design docs for the new workspace conversation surface**

```text
Update:
- docs/design/openhands-runtime-contract/README.md
- docs/design/openhands-runtime-contract/openhands-conversation-model.md

Record that the first consumer of the canonical conversation stream is now the workspace
conversation surface, and remove any stale Refine-specific rendering assumptions.
```

- [ ] **Step 5: Verify the workspace-only PR and commit**

```bash
cd app && npx vitest run \
  src/__tests__/components/conversation/conversation-timeline.test.tsx \
  src/__tests__/components/workspace/workspace-conversation.test.tsx \
  src/__tests__/lib/skill-openhands-session.test.ts
cd app && npx tsc --noEmit
```

Commit:

```bash
git add app/src app/src-tauri/src
git commit -m "feat: add workspace conversation surface"
```

## Task 5: PR 5 — Migrate the Workflow UI and Remaining Conversation Consumers

**Files:**

- Modify: `app/src/pages/workflow.tsx`
- Modify: `app/src/components/agent-output-panel.tsx`
- Modify: `app/src/hooks/use-workflow-session.ts`
- Modify: `app/src/components/workflow-sidebar.tsx`
- Modify: `app/src-tauri/src/commands/skill_session.rs`
- Test: `app/src/__tests__/pages/workflow.test.tsx`
- Test: `app/src/__tests__/components/agent-output-panel.test.tsx`

- [ ] **Step 1: Replace workflow transcript rendering with the canonical conversation surface**

```tsx
// app/src/pages/workflow.tsx
// Mount WorkspaceConversation in the workflow page.
// Route send actions through sendConversationMessage.
// Render the canonical event stream directly.
```

- [ ] **Step 2: Migrate workflow-side viewers away from agent-store transcript state**

```text
Review and migrate:
- app/src/components/agent-output-panel.tsx
- app/src/hooks/use-workflow-session.ts
- app/src/components/workflow-sidebar.tsx
```

- [ ] **Step 3: Update design docs for Workflow adoption**

```text
Update:
- docs/design/openhands-runtime-contract/README.md
- docs/design/openhands-runtime-contract/workflow-sequence.md
- docs/design/openhands-runtime-contract/implementation-gaps.md

Document Workflow as a consumer of the canonical conversation stream and remove stale
workflow-side transcript assumptions.
```

- [ ] **Step 4: Verify the workflow migration PR and commit**

```bash
cd app && npx vitest run \
  src/__tests__/pages/workflow.test.tsx \
  src/__tests__/components/agent-output-panel.test.tsx
cd app && npx tsc --noEmit
```

Commit:

```bash
git add app/src app/src-tauri/src
git commit -m "feat: migrate workflow to conversation timeline"
```

## Task 6: Delete Legacy `agent_id`-Centric Public Helpers

**Files:**

- Modify/Delete: `app/src/hooks/use-agent-stream.ts`
- Modify/Delete: `app/src/stores/agent-store.ts`
- Modify/Delete: `app/src/stores/agent-display-buffer.ts`
- Modify/Delete: `app/src/lib/openhands-event-projection.ts`
- Modify/Delete: `app/src/lib/display-types.ts`
- Modify: `app/src-tauri/src/agents/tracked_openhands.rs`
- Modify: `app/src-tauri/src/agents/event_router.rs`
- Modify: `app/src-tauri/src/agents/event_types.rs`
- Modify: `app/src-tauri/src/types/refine.rs`
- Modify: `repo-map.json`
- Modify: `TEST_MAP.md`
- Modify: `docs/design/openhands-runtime-contract/README.md`
- Modify: `docs/design/openhands-runtime-contract/implementation-gaps.md`
- Test: `app/src/__tests__/lib/openhands-conversation-events.test.ts`
- Test: `app/src/__tests__/hooks/use-agent-stream.test.ts` (delete or rewrite)
- Test: `app/src/__tests__/stores/agent-store.test.ts` (delete or rewrite)

- [ ] **Step 1: Remove transcript authority from legacy helpers**

```text
Delete or rewrite legacy helpers so they no longer expose:
- transcript-like displayItems
- transcript grouping semantics
- agent-centric public UI contracts
```

- [ ] **Step 2: Narrow remaining runtime helpers to transport-only concerns**

```rust
// app/src-tauri/src/agents/tracked_openhands.rs
// Keep only the run-control and transport behavior that still belongs below
// the canonical conversation event layer.
```

- [ ] **Step 3: Update docs and test maps to the new source of truth**

```text
Update:
- docs/design/openhands-runtime-contract/README.md
- docs/design/openhands-runtime-contract/implementation-gaps.md
- TEST_MAP.md
- repo-map.json
```

- [ ] **Step 4: Update design docs for legacy-helper removal completion**

```text
Update:
- docs/design/openhands-runtime-contract/README.md
- docs/design/openhands-runtime-contract/openhands-conversation-model.md
- docs/design/openhands-runtime-contract/implementation-gaps.md

Mark the legacy `agent_id`-centric public transcript helpers removed and describe the final
conversation-centric steady state.
```

- [ ] **Step 5: Verify the full migration and commit**

```bash
cd app && npm run test:unit
cd app && npx tsc --noEmit
cargo test --manifest-path app/src-tauri/Cargo.toml --quiet
markdownlint \
  docs/design/openhands-runtime-contract/README.md \
  docs/design/openhands-runtime-contract/implementation-gaps.md \
  docs/plans/2026-05-16-openhands-conversation-model-reimplementation.md
```

Commit:

```bash
git add app/src app/src-tauri/src docs repo-map.json TEST_MAP.md
git commit -m "refactor: remove legacy agent transcript helpers"
```

## Self-Review

Spec coverage:

- Clean-slate PR 1 deletion is covered in Task 1.
- New helper creation is covered in Tasks 2 and 3.
- Workspace-only migration is covered in Task 4.
- Workflow migration is covered in Task 5.
- Deletion of old helpers after migration is covered in Task 6.

Placeholder scan:

- No `TODO`, `TBD`, or “handle later” language remains.
- Each task names concrete files, commands, and migration intent.

Type consistency:

- The plan consistently treats `conversationId` as the canonical transcript key.
- `agent_id` remains only as a temporary transport seam until Task 5.
