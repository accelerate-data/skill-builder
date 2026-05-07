# Refine Runtime Follow-ups

**Branch:** `feature/openhands-runtime-clean-break`

**Goal:** Finish the remaining Refine-specific cleanup after the OpenHands
runtime migration.

These are the three active issues left in Refine:

1. Refine still carries `sessionId` plumbing instead of collapsing onto the
   runtime run/conversation model.
2. Refine does not visibly surface the persisted `SystemPromptEvent` / runtime
   setup row the way users expect.
3. Refine still splits between `refine-initial.txt` and
   `refine-followup.txt`, and the initial prompt is stale because it does not
   inline DB-backed user context, clarifications, and decisions.

## Current Findings

### 1. Refine `sessionId` is still a real product-layer wrapper

Current state:

- frontend store keeps `sessionId` in
  `app/src/stores/refine-store.ts`
- frontend Tauri calls still require `sessionId` in
  `app/src/lib/tauri.ts`
- `WorkspaceRefine` threads `sessionId` through start/send/pause/close in
  `app/src/components/workspace/workspace-refine.tsx`
- backend `RefineSessionManager` still keeps an in-memory session map keyed by
  `session_id` in `app/src-tauri/src/commands/refine/mod.rs`

Why this is still a problem:

- Refine pause still needs a wrapper lookup `session_id -> current_agent_id`
- Refine is not aligned with the runtime contract used by other surfaces
- the wrapper obscures the real lifecycle identities:
  - durable OpenHands conversation id
  - current live run `agent_id`

Target:

- active-run controls should no longer depend on a frontend-visible Refine
  `sessionId`
- Refine should align with the same runtime pause/send model as the other
  product surfaces

### 2. Refine system prompt / setup is persisted but not surfaced correctly

Confirmed findings:

- persisted Refine conversations do contain `SystemPromptEvent`
- resume hydration code already restores transcript events and can build a
  setup segment before the first user message
- a fresh Refine conversation also persists `SystemPromptEvent` on disk, but
  the UI still does not show the setup row the way users expect

Target:

- resumed Refine history should show the setup block
- fresh/live Refine runs should also surface the setup block consistently
- users should not have to inspect raw conversation files to verify that the
  setup prompt exists

### 3. Refine should use one contextual prompt, not initial/follow-up split

Confirmed findings:

- `refine-initial.txt` is only sent when no conversation id exists
- `refine-followup.txt` is sent on subsequent turns
- `refine-initial.txt` currently points the agent at `user-context.md`
- it does not inline DB-backed user context, clarifications, or decisions
- the current contract makes resumed turns lighter than first turns, which is
  not what we want

Agreed prompt contract:

- Refine should use one prompt template that sets the context and carries the
  current user request
- every dispatched Refine turn should use that same contextual prompt,
  including resumed turns on an existing conversation
- the prompt should inline:
  - user context
  - clarifications JSON
  - decisions JSON
- the prompt should stop referencing stale file-based context instructions

## Implementation Tasks

### Task 1: Remove Refine `sessionId` Plumbing

Scope:

- remove `sessionId` from Refine frontend runtime state and Tauri API where it
  is only acting as a wrapper
- collapse pause/send/close behavior onto the real runtime identities
- simplify backend Refine session tracking so it no longer exposes a synthetic
  session contract to the frontend

Expected code areas:

- `app/src/stores/refine-store.ts`
- `app/src/lib/tauri.ts`
- `app/src/components/workspace/workspace-refine.tsx`
- `app/src-tauri/src/commands/refine/mod.rs`
- affected tests in:
  - `app/src/__tests__/components/workspace/workspace-refine.test.tsx`
  - `app/src/__tests__/stores/refine-store.test.ts`
  - `app/src/__tests__/lib/tauri*.test.ts`
  - `app/src-tauri/src/commands/refine/tests.rs`

Acceptance criteria:

- [ ] Refine active-run controls no longer require a frontend-visible
      `sessionId`
- [ ] pause/send path works through the real run/conversation lifecycle
- [ ] active run identity stays available for the full live-run lifetime so
      pause cannot degrade into `no active turn — noop`
- [ ] tests are updated to the new Refine runtime contract

### Task 2: Surface the Refine Setup/System Prompt Row

Scope:

- verify why the persisted `SystemPromptEvent` is not shown consistently in
  live Refine UI
- make fresh/live Refine and resumed Refine both show the setup/runtime block
- keep the rendering aligned with the existing OpenHands event projection model

Expected code areas:

- `app/src/components/workspace/workspace-refine.tsx`
- `app/src/hooks/use-agent-stream.ts`
- `app/src/stores/agent-store.ts`
- `app/src/lib/openhands-event-projection.ts`
- targeted Refine UI tests

Acceptance criteria:

- [ ] resumed Refine conversations visibly show the restored setup/runtime row
- [ ] fresh Refine runs visibly show the live setup/runtime row
- [ ] no duplicate setup rows appear for the same run

### Task 3: Collapse Refine to One Contextual Prompt

Scope:

- remove the split between `refine-initial.txt` and `refine-followup.txt`
- send the same contextual Refine prompt for every dispatched turn
- inline DB-backed user context, clarifications, and decisions into the prompt
- stop referencing stale `user-context.md` instructions

Expected code areas:

- `agent-sources/prompts/refine-initial.txt`
- `agent-sources/prompts/refine-followup.txt` (delete or retire)
- `app/src-tauri/src/commands/refine/protocol.rs`
- `app/src-tauri/src/commands/refine/mod.rs`
- `app/src-tauri/src/commands/workflow/prompt.rs` helpers reused from Refine
- Rust prompt-rendering tests in `app/src-tauri/src/commands/refine/tests.rs`

Acceptance criteria:

- [ ] Refine uses one contextual prompt contract on first turn and resumed
      turns
- [ ] prompt includes inline user context
- [ ] prompt includes inline clarifications JSON
- [ ] prompt includes inline decisions JSON
- [ ] stale file-based context instruction is removed

## Verification

Branch verification after the Refine follow-ups land:

- [ ] `cargo clippy --manifest-path app/src-tauri/Cargo.toml -- -D warnings`
- [ ] `cargo test --manifest-path app/src-tauri/Cargo.toml commands::refine`
- [ ] `cargo test --manifest-path app/src-tauri/Cargo.toml`
- [ ] `cd app && npx vitest run src/__tests__/components/workspace/workspace-refine.test.tsx`
- [ ] `cd app && npx tsc --noEmit`
- [ ] `cd app && npm run test:unit`
- [ ] `cd app && npm run test:repo-map`
- [ ] `cd app && bash tests/run.sh e2e --tag @refine`
- [ ] `markdownlint docs/design/openhands-runtime-model/README.md docs/plans/2026-05-07-openhands-runtime-clean-break.md docs/plans/2026-05-07-refine-runtime-followups.md`

If the event-stream path changes:

- [ ] add any narrower targeted event-stream regression command alongside the
      full suite above
