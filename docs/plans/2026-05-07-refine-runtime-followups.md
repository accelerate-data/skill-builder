# Refine Runtime Follow-ups

**Branch:** `feature/openhands-runtime-clean-break`

**Goal:** Finish the remaining Refine-specific cleanup after the OpenHands
runtime migration.

This plan captured the remaining Refine follow-ups after the broader
OpenHands runtime migration:

1. Refine carried `sessionId` plumbing instead of collapsing onto the runtime
   run/conversation model.
2. Refine did not visibly surface the persisted `SystemPromptEvent` / runtime
   setup row the way users expect.
3. Refine split between `refine-initial.txt` and `refine-followup.txt`, and
   the initial prompt was stale because it did not inline DB-backed user
   context, clarifications, and decisions.
4. Refine still does not visibly surface the dispatched contextual task
   message the way Workflow does.

## Current Findings

### 1. Refine `sessionId` wrapper cleanup

Current state:

- frontend store now tracks `conversationId` and `activeAgentId`
- frontend runtime calls now use:
  - bootstrap by `skillName + pluginSlug`
  - send by `conversationId`
  - pause by `agentId`
- `WorkspaceRefine` now routes cancel through `cancelAgentRun(agentId)`
- backend keeps internal Refine bookkeeping keyed by skill/plugin, but no
  frontend-visible Refine `sessionId` remains

What changed:

- removed the public `pause_refine_session` command/wrapper surface
- removed Refine `sessionId` usage from the frontend contract
- aligned Refine with the same live-run pause model as Workflow

### 2. Refine system prompt / setup is persisted but not surfaced correctly

Confirmed findings:

- persisted Refine conversations do contain `SystemPromptEvent`
- resume hydration code already restores transcript events and can build a
  setup segment before the first user message
- a fresh Refine conversation is now immediately reloaded after preparation so
  the setup/runtime row is available before the first user send

Implemented result:

- resumed Refine history shows the setup block through transcript hydration
- fresh Refine sessions surface setup-only transcript rows immediately after
  `start_refine_session`
- users no longer need to inspect raw conversation files to confirm setup

### 3. Refine should use one contextual prompt, not initial/follow-up split

Confirmed findings:

- `refine-followup.txt` has been removed from the live runtime path
- the single Refine prompt now inlines DB-backed user context,
  clarifications JSON, and decisions JSON

Agreed prompt contract:

- every dispatched Refine turn uses the same contextual prompt, including
  resumed turns on an existing conversation
- the prompt no longer references stale file-based context instructions

### 4. Refine should surface the dispatched contextual task message

Confirmed findings:

- Refine now uses one contextual prompt for every dispatched turn
- the generated prompt is passed into `send_refine_message(...)`
- the visible `SystemPromptEvent` row is only the OpenHands runtime setup row
- unlike Workflow, Refine does not visibly show the dispatched contextual
  `task_sent` / initial task message in the transcript

Agreed UI contract:

- Refine should match Workflow here
- the transcript should show:
  - runtime setup
  - the actual contextual task message sent to the agent
  - then tool activity / outputs
- this should work for both fresh Refine runs and resumed Refine history

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

- [x] Refine active-run controls no longer require a frontend-visible
      `sessionId`
- [x] pause/send path works through the real run/conversation lifecycle
- [x] active run identity stays available for the full live-run lifetime so
      pause cannot degrade into `no active turn — noop`
- [x] tests are updated to the new Refine runtime contract

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

- [x] resumed Refine conversations visibly show the restored setup/runtime row
- [x] fresh Refine runs visibly show the live setup/runtime row
- [x] no duplicate setup rows appear for the same run

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

- [x] Refine uses one contextual prompt contract on first turn and resumed
      turns
- [x] prompt includes inline user context
- [x] prompt includes inline clarifications JSON
- [x] prompt includes inline decisions JSON
- [x] stale file-based context instruction is removed

### Task 4: Surface the Contextual Task Message Like Workflow

Scope:

- project the dispatched Refine contextual prompt as a visible transcript row
- keep the runtime setup row separate from the dispatched task row
- make fresh/live Refine and restored/resumed Refine behave consistently
- avoid duplicating the plain user bubble and the contextual task row in a
  confusing way

Expected code areas:

- `app/src/components/workspace/workspace-refine.tsx`
- `app/src/lib/openhands-event-projection.ts`
- `app/src/stores/refine-store.ts`
- `app/src-tauri/src/commands/refine/mod.rs`
- targeted Refine UI / projection tests

Acceptance criteria:

- [x] fresh Refine visibly shows the contextual dispatched task message
- [x] resumed Refine visibly shows the restored contextual dispatched task row
- [x] runtime setup remains a separate row
- [x] no duplicate or contradictory first-turn rows appear
- [x] tests cover the Refine-vs-Workflow visibility contract

## Verification

Branch verification after the Refine follow-ups land:

- [x] `cargo clippy --manifest-path app/src-tauri/Cargo.toml -- -D warnings`
- [x] `cargo test --manifest-path app/src-tauri/Cargo.toml commands::refine`
- [x] `cargo test --manifest-path app/src-tauri/Cargo.toml`
- [x] `cd app && npx vitest run src/__tests__/components/workspace/workspace-refine.test.tsx`
- [x] `cd app && npx tsc --noEmit`
- [x] `cd app && npm run test:unit`
- [x] `cd app && npm run test:repo-map`
- [x] `cd app && bash tests/run.sh e2e --tag @refine`
- [x] `markdownlint docs/design/openhands-runtime-model/README.md docs/plans/2026-05-07-refine-runtime-followups.md`

If the event-stream path changes:

- [x] add any narrower targeted event-stream regression command alongside the
      full suite above
      `cd app && npx vitest run src/__tests__/components/refine/agent-turn-inline.test.tsx src/__tests__/components/workspace/workspace-refine.test.tsx src/__tests__/stores/agent-store.test.ts src/__tests__/lib/openhands-event-projection.test.ts`
      `cargo test --manifest-path app/src-tauri/Cargo.toml delta_recovery_skips_backfill_when_pre_send_watermark_is_unavailable -- --nocapture`
      `cargo test --manifest-path app/src-tauri/Cargo.toml delta_recovery_dedupes_pre_send_events_without_ids -- --nocapture`
      `cargo test --manifest-path app/src-tauri/Cargo.toml delta_recovery_filters_out_pre_send_events_and_keeps_new_task_events -- --nocapture`
      `cargo test --manifest-path app/src-tauri/Cargo.toml send_existing_turn_uses_full_history_only_for_blank_prompt_and_delta_for_non_empty -- --nocapture`
      `cargo test --manifest-path app/src-tauri/Cargo.toml seen_event_ids_dedupe_drops_duplicate_ids_across_rest_and_ws -- --nocapture`
