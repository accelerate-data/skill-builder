# OpenHands Runtime Clean Break Implementation Plan

**Goal:** Finish the remaining clean-break work on
`feature/openhands-runtime-clean-break` and leave the next coding pass with
only the real unfinished items.

**Current status:** The branch has already landed the core runtime split:

- persistent runtime primitives:
  - `start_openhands_session(...)`
  - `openhands_send_message(...)`
  - `pause_openhands_session(...)`
- throwaway runtime primitive:
  - `run_throwaway_openhands_session(...)`
- persistent product flows for:
  - workflow
  - refine
  - `define_eval_scenario`
  - `build_refine_improvement_brief`
- throwaway runtime roots for:
  - scope review
  - eval execution
- structured runtime error handling, primitive-layer tests, subagent event
  discovery, and runtime observability follow-ups

This file is now the audited branch-status plan. The old migration checklist
has been retired so the next coding agent only sees actual pending work.

## Review Triage

The 2026-05-07 review feedback was audited against the current branch before
this plan update.

Accepted into the remaining work:

- refine resume should restore the full persisted transcript, not just plain
  chat messages
- remaining runtime-layer `OneShot` naming should be removed
- stale trigger-mode Eval Workbench backend code should be deleted
- pause/cancel semantics should be normalized so every product surface routes
  through the same runtime pause primitive

Explicitly not treated as active blockers:

- `start_refine_session` ownership of session preparation
  Current branch already calls `prepare_openhands_session(...)` during
  refine-session startup.
- `user_message_suffix` as a current conversation-reuse blocker
  Current branch uses a stable app-owned suffix contract for workflow/refine.
- throwaway runtime isolation doubts
  Current branch already routes scope review and eval execution through
  `.openhands/throwaway/...` runtime roots.

## Pause Contract

These are the agreed runtime-layer pause decisions for this branch.

1. Product/UI surfaces should only call product commands that resolve to the
   runtime pause primitive.

Current product surfaces:

- Refine UI calls `pause_refine_session(session_id)` in
  `app/src/components/workspace/workspace-refine.tsx`
- Workflow UI calls `cancel_workflow_step(agent_id)` in
  `app/src/components/layout/app-layout.tsx`
- Eval Workbench UI calls `cancel_eval_workbench_run(run_id)` in
  `app/src/components/workspace/eval-workbench/use-run-history.ts`

1. The single runtime pause primitive should be:

- `pause_openhands_session(agent_id)`

Current runtime implementation:

- `pause_openhands_session(agent_id)` in
  `app/src-tauri/src/agents/openhands_server/mod.rs`

1. The low-level OpenHands server transport call should remain private:

- `pause_conversation(conversation_id)`

Current transport implementation:

- `pause_conversation(conversation_id)` in
  `app/src-tauri/src/agents/openhands_server/client.rs`
- it performs `POST /api/conversations/{conversation_id}/pause`

1. The runtime task, not the UI, owns the actual pause request and terminal
   cleanup.

Current behavior:

- product commands signal the active OpenHands run by `agent_id`
- the running OpenHands task receives that signal and calls
  `pause_conversation(conversation_id)`
- the task keeps reading the stream until the terminal pause/cancel state
  arrives, then emits final lifecycle events and cleans up registry state

1. Prefix-based cancellation is not part of the desired end state.

Current exception:

- Eval Workbench still uses `cancel_openhands_runs_with_prefix(...)` from
  `cancel_eval_workbench_run_inner(...)`

Target end state:

- no product surface should depend on prefix-based OpenHands cancellation
- Eval Workbench should track exact active `agent_id`s per logical run and
  pause those exact runs through `pause_openhands_session(agent_id)`

## Audited Complete

The following plan items are complete on this branch and should not be treated
as open work:

- explicit runtime primitive entrypoints exist in
  `app/src-tauri/src/agents/openhands_server/mod.rs`
- persistent workflow / refine / eval authoring flows route through the
  clean-break primitives instead of the old helper contract
- throwaway runtime directories exist under
  `workspace/.openhands/throwaway/...`
- throwaway scope review and eval execution use isolated runtime roots
- stale description-candidate surfaces and old create-skill suggestion paths
  were removed from the live command surface
- `suggest_scenario` was renamed to `define_eval_scenario`
- refine session startup now prepares the persistent conversation up front
- stale saved refine conversations are cleared when they no longer match the
  runtime contract
- primitive-layer resolution and backfill behavior have direct Rust coverage
- runtime errors are no longer only raw stringly-typed internal state
- runtime observability and cancellation/task-handle tracking landed
- subagent child events are now discovered and emitted correctly even when the
  persisted child timestamps omit a timezone suffix

## Pending Work

### Task 1: Make Refine Resume Restore The Full Transcript

**Why this is still open**

The current resume path restores only flattened user/agent message pairs, not
the full persisted OpenHands event transcript.

Code evidence:

- `start_refine_session(...)` in
  `app/src-tauri/src/commands/refine/mod.rs` returns
  `restored_messages: Vec<ConversationMessage>`
- `extract_conversation_messages(...)` only pulls `MessageEvent` text
- `WorkspaceRefine` in `app/src/components/workspace/workspace-refine.tsx`
  hydrates those plain messages via `setMessages(...)`
- resumed runtime tasks do not REST-backfill prior events because
  `backfill_existing_events` is only enabled for first-turn conversation setup
  in `app/src-tauri/src/agents/openhands_server/mod.rs`

**Product gap**

A resumed refine session should behave like a real resume:

- show the persisted `SystemPromptEvent`
- show the initial task / runtime setup rows
- show prior tool activity
- show prior subagent activity
- show prior assistant outputs
- then continue streaming new live events without duplication

- [ ] Replace message-only refine resume hydration with full persisted event
      transcript hydration.
- [ ] Restore enough persisted metadata on resume for the refine UI to rebuild
      prior OpenHands display items, not just plain chat bubbles.
- [ ] Remove or replace `has_dispatched_turn` manual state once resume
      restoration is derived from persisted conversation history instead of the
      current message-only bootstrap.
- [ ] Deduplicate restored history against live stream delivery by stable event
      identity so reconnect / resume does not duplicate rows.
- [ ] Add regression coverage for resumed refine sessions that verifies:
  - `SystemPromptEvent` is visible after resume
  - prior tool activity is visible after resume
  - prior subagent activity is visible after resume
  - a resumed session can continue streaming new events without replay
    duplication

### Task 2: Remove Remaining `OneShot` Runtime Naming

**Why this is still open**

The runtime model is now clean-break in behavior, but several core type and
helper names still encode the old "one-shot" vocabulary.

Current examples on this branch:

- `OpenHandsOneShotRequest`
- `OpenHandsOneShotConfigParams`
- `OpenHandsOneShotEvent`
- `StartConversationRequest::from_one_shot(...)`

This is now misleading because the same request/config contract is used for:

- prepared persistent sessions
- follow-up persistent turns
- throwaway runs

- [ ] Rename remaining runtime-layer `OneShot` request / config / event types
      to runtime-neutral names that match the implemented model.
- [ ] Update affected tests, helper names, and comments so the branch no longer
      advertises the pre-clean-break contract internally.

### Task 3: Normalize Pause Semantics Across All Surfaces

**Why this is still open**

Refine and workflow already route through `pause_openhands_session(agent_id)`,
but Eval Workbench still uses a prefix-based runtime helper instead of exact
run identity.

Code evidence:

- refine backend uses `pause_openhands_session(...)` in
  `app/src-tauri/src/commands/refine/mod.rs`
- workflow backend uses `pause_openhands_session(...)` in
  `app/src-tauri/src/commands/workflow/runtime.rs`
- eval workbench backend still uses
  `cancel_openhands_runs_with_prefix(...)` in
  `app/src-tauri/src/commands/eval_workbench/mod.rs`

- [ ] Remove `cancel_openhands_runs_with_prefix(...)` from the runtime layer.
- [ ] Update Eval Workbench run state to track exact active OpenHands
      `agent_id`s per logical `run_id`.
- [ ] Route Eval Workbench cancellation through
      `pause_openhands_session(agent_id)` for each active run instead of
      prefix matching.
- [ ] Keep `pause_conversation(conversation_id)` private to the OpenHands
      server client / runtime-task layer only.

### Task 4: Delete Stale Trigger-Mode Eval Backend Paths

**Why this is still open**

The frontend no longer exposes the old trigger/comparison workbench surface,
but the backend still compiles trigger-only helpers and config builders.

Current examples on this branch:

- `write_trigger_stub_skill(...)`
- `build_trigger_sidecar_config(...)`
- trigger-mode execution paths and related DTO fields in
  `app/src-tauri/src/commands/eval_workbench/mod.rs`

- [ ] Remove trigger-mode backend helpers and execution paths that are no
      longer reachable from the live eval workbench.
- [ ] Remove stale trigger-only DTO fields and tests that only exist for the
      deleted backend surface.
- [ ] Re-run the affected eval-workbench backend and frontend tests after the
      trigger cleanup.

### Task 5: Final Verification Sweep

Run this after Tasks 1-4 land.

- [ ] `cargo clippy --manifest-path app/src-tauri/Cargo.toml -- -D warnings`
- [ ] `cargo test --manifest-path app/src-tauri/Cargo.toml`
- [ ] `cd app && npx tsc --noEmit`
- [ ] `cd app && npm run test:unit`
- [ ] `cd app && npm run test:repo-map`
- [ ] `cd app && bash tests/run.sh e2e --tag @refine`
- [ ] `markdownlint docs/design/openhands-runtime-model/README.md docs/plans/2026-05-07-openhands-runtime-clean-break.md`

## Notes For The Next Coding Pass

- Treat the resume-history gap as the primary product bug still open on this
  branch.
- Do not re-open already landed routing refactors unless the resume fix proves
  they are directly in the way.
- Keep the next pass focused: restore real resume semantics first, then finish
  the remaining naming cleanup, then run the regression sweep.
