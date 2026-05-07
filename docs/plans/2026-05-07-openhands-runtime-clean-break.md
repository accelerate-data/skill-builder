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
- resumed refine sessions now restore persisted transcript rows, including
  runtime setup before the first user turn and prior tool activity, instead of
  only flattening chat bubbles
- resumed refine sessions now replay persisted child-subagent transcript rows
  and preserve parent tool-call links when hydrating restored history
- refine session follow-up routing now derives from dispatched user-turn count
  instead of the old `has_dispatched_turn` latch
- runtime-layer `OneShot` request / config / event names were renamed to
  runtime-neutral equivalents
- Eval Workbench now tracks exact active OpenHands `agent_id`s and cancels
  them through `pause_openhands_session(agent_id)` instead of prefix matching
- trigger-only Eval Workbench config builders and execution paths were removed
  from the live backend run path
- stale trigger-only Eval Workbench backend DTO fields, scenario tags, and
  validation branches were removed from the remaining backend authoring surface

## Pending Work

### Task 1: Final Verification Sweep

The implementation tasks are complete. Run the full branch verification sweep
before final merge.

- [ ] `cargo clippy --manifest-path app/src-tauri/Cargo.toml -- -D warnings`
- [ ] `cargo test --manifest-path app/src-tauri/Cargo.toml`
- [ ] `cd app && npx tsc --noEmit`
- [ ] `cd app && npm run test:unit`
- [ ] `cd app && npm run test:repo-map`
- [ ] `cd app && bash tests/run.sh e2e --tag @refine`
- [ ] `markdownlint docs/design/openhands-runtime-model/README.md docs/plans/2026-05-07-openhands-runtime-clean-break.md`

## Notes For The Next Coding Pass

- Treat the remaining work as verification and cleanup only unless new review
  findings reopen a specific runtime seam.
- Do not re-open already landed routing refactors unless a failing verification
  step proves they are directly implicated.
