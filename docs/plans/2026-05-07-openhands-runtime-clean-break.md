# OpenHands Runtime Clean Break Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current mixed OpenHands helper model with a clean two-mode runtime: persistent skill sessions (`StartOpenHandsSession`, `OpenHandsSendMessage`, `PauseOpenHandsSession`) and throwaway runs (`RunThrowawayOpenHandsSession`), while removing dead eval/create-skill paths in the same change.

**Architecture:** The Rust backend becomes the sole owner of four explicit OpenHands runtime primitives. Product commands remain product-shaped (`run_workflow_step`, `start_refine_session`, `review_skill_scope`, `run_eval_workbench`, etc.) and map onto those primitives. Persistent flows use skill-scoped conversations; throwaway flows use isolated throwaway runtime workspaces under `workspace/.openhands/throwaway/...` with the same `.agents` deployment model but no resumable product conversation ID.

**Tech Stack:** Rust (Tauri backend), TypeScript/React frontend, OpenHands Agent Server, SQLite, Vitest, cargo test, Playwright E2E, markdownlint

---

## Status Update

This plan started as the implementation checklist for the first clean-break
pass. That pass has landed on branch `feature/openhands-runtime-clean-break`,
and an independent multi-lane review has now been folded back into this plan.

The plan below is therefore split into:

- work already completed in the first pass
- remaining follow-up work required to finish the clean break

Do not treat the original unchecked boxes below as the source of truth for
current branch status. Use the updated task list in the **Remaining Work**
section.

## Completed In First Pass

- Added explicit runtime primitive entrypoints in
  `app/src-tauri/src/agents/openhands_server/mod.rs`.
- Added throwaway runtime path helpers in
  `app/src-tauri/src/skill_paths.rs`.
- Made the Agent Server runtime-root aware through the configured
  conversations root.
- Renamed `suggest_scenario` to `define_eval_scenario` across the live surface.
- Removed the dead `generate_suggestions` backend path.
- Removed the old `workspace-description` surface from the live UI.
- Renamed refine stop semantics to `pause_refine_session`.
- Ran the local validation set captured in
  [2026-05-07-openhands-runtime-clean-break-followup-todo.md](./2026-05-07-openhands-runtime-clean-break-followup-todo.md).

## Remaining Work

### Task A: Finish Persistent Session Ownership

**Goal:** Align refine, workflow gate evaluation, and eval-definition flows with
the design’s persistent-session model.

**Files**

- `app/src-tauri/src/commands/refine/mod.rs`
- `app/src-tauri/src/commands/workflow/runtime.rs`
- `app/src-tauri/src/commands/eval_workbench/mod.rs`
- `app/src-tauri/src/agents/openhands_server/mod.rs`
- related tests in `app/src-tauri/src/commands/refine/tests.rs`

- [ ] Make `start_refine_session` establish the persistent OpenHands session
      instead of deferring actual session start to `send_refine_message`.
- [ ] Fix refine resume behavior when a saved conversation is readable but
      incompatible with the current request shape.
- [ ] Rework `run_answer_evaluator` so it does not overwrite or conflict with
      the main skill conversation used by workflow and refine.
- [ ] Move `define_eval_scenario` onto
      `StartOpenHandsSession -> OpenHandsSendMessage`.
- [ ] Move `build_refine_improvement_brief` onto
      `StartOpenHandsSession -> OpenHandsSendMessage`.

### Task B: Finish Throwaway Runtime Isolation

**Goal:** Ensure throwaway runs use isolated runtime roots consistently and
retain artifacts only under `.openhands/throwaway/...`.

**Files**

- `app/src-tauri/src/commands/eval_workbench/mod.rs`
- `app/src-tauri/src/skill_paths.rs`
- `app/src-tauri/src/agents/openhands_server/mod.rs`

- [ ] Move eval throwaway execution and diagnosis onto isolated
      `.openhands/throwaway/...` runtime roots instead of skill workspace
      directories.
- [ ] Verify scope review, eval execution, and any other throwaway commands all
      follow the same runtime-root policy.
- [ ] Ensure throwaway conversations remain non-resumable from product state
      while still being retained only under throwaway runtime roots for
      debugging.

### Task C: Remove Legacy Runtime Residue

**Goal:** Finish the clean break by removing alias helpers and stale routing
that still preserve the old model internally.

**Files**

- `app/src-tauri/src/agents/openhands_server/mod.rs`
- `app/src-tauri/src/commands/workflow/runtime.rs`

- [ ] Replace remaining legacy runtime aliases/usages with direct clean-break
      primitives.
- [ ] Remove or simplify wrappers like `dispatch_openhands_refine_turn` and
      `run_refine_conversation_task` if they no longer add behavior.
- [ ] Replace workflow cancellation’s `cancel_openhands_one_shot` routing with
      direct pause semantics.
- [ ] Trim compile-time-only helper layering if it no longer improves clarity
      (`OpenHandsSessionKind`, `should_persist_skill_conversation`,
      `require_existing_conversation_id`).

### Task D: Finish Dead-Surface Cleanup

**Goal:** Remove remaining stale types, docs, tests, and contracts from the old
eval description/trigger comparison model.

**Files**

- `app/src/lib/eval-workbench.ts`
- `app/src/lib/tauri-command-types.ts`
- `app/src/lib/tauri-command-types.typecheck.ts`
- `docs/design/backend-design/api.md`
- `tests/evals/assertions/tauri-command-contract.test.js`
- any remaining trigger/comparison-only helpers and tests

- [ ] Remove or reconcile stale `generate_scenarios` surface.
- [ ] Remove lingering `descriptionCandidates` / trigger-era shared contracts
      that are no longer part of the live one-tab eval workbench.
- [ ] Remove stale docs/tests/assertions that still reference removed commands
      such as `suggest_description_candidates` and
      `apply_description_candidate`.
- [ ] Trim stale UI props left behind after the description-surface cleanup.
- [ ] Remove or explicitly contract-test any frontend-only stale command
      surface that is no longer registered in the backend.

### Task E: Reconcile Runtime Documentation

**Goal:** Make the runtime design doc match the actual implemented behavior.

**Files**

- `docs/design/openhands-runtime-model/README.md`
- `repo-map.json`
- `TEST_MAP.md` only if test mapping changes materially

- [ ] Update the runtime model doc so throwaway retention semantics match the
      code.
- [ ] Update the runtime model doc so eval flows match the real persistent vs
      throwaway routing.
- [ ] Update `repo-map.json` and any affected test/docs indexes after the
      cleanup.

### Task F: Close Test Coverage Gaps

**Goal:** Add the missing regression coverage found by the independent
test-coverage gate.

**Files**

- `app/src-tauri/src/commands/refine/tests.rs`
- `app/src-tauri/src/agents/openhands_server/mod.rs` tests
- Eval Workbench tests and E2E coverage

- [ ] Add Rust coverage for refine session lifecycle branches:
  - unreadable saved conversation clears ID
  - stale in-memory session replacement
  - first send persists `conversation_id` and `current_agent_id`
- [ ] Add deeper mocked-server coverage for throwaway lifecycle:
  - success
  - timeout
  - prefix-cancel
- [ ] Add Eval Workbench cancellation coverage proving one-shot runs stop and
      stop reporting progress.
- [ ] Add one E2E for the live eval path:
      author scenario -> define/suggest -> run eval -> send to refine.
- [ ] Keep the deleted description-surface browser coverage replaced by the
      live-path E2E rather than by stale trigger/comparison tests.

### Task G: Final Regression And Quality Gates

**Goal:** Re-run the clean-break verification after the follow-up work lands.

- [ ] `cargo clippy --manifest-path app/src-tauri/Cargo.toml -- -D warnings`
- [ ] `cargo test --manifest-path app/src-tauri/Cargo.toml`
- [ ] `cd app && npx tsc --noEmit`
- [ ] `cd app && npm run test:unit`
- [ ] `cd app && npm run test:repo-map`
- [ ] `cd app && bash tests/run.sh e2e --tag @workflow`
- [ ] `cd app && bash tests/run.sh e2e --tag @refine`
- [ ] `cd app && bash tests/run.sh e2e --tag @evals`
- [ ] `markdownlint docs/design/openhands-runtime-model/README.md docs/plans/2026-05-07-openhands-runtime-clean-break.md`

## Review Findings Integrated

The remaining-work tasks above incorporate the independent review lanes that
were run after the first implementation pass:

- design alignment review
- plan audit review
- code review gate
- simplification review gate
- test coverage review gate
- acceptance-criteria review gate

The highest-signal findings that shaped the remaining work are:

- refine session start still does not establish the OpenHands conversation
- refine can hard-fail on stale but readable saved conversations
- answer evaluator currently conflicts with shared skill conversation ownership
- `define_eval_scenario` and `build_refine_improvement_brief` are still
  one-shot instead of persistent
- throwaway eval runtime roots are not isolated consistently
- old eval description/trigger surface cleanup is incomplete across docs,
  types, and tests
- runtime documentation is still partially out of sync with the code
- additional Rust and E2E coverage is still needed around refine lifecycle,
  throwaway lifecycle, and the live eval path

---

## File Map

**Modify**

- `app/src-tauri/src/agents/openhands_server/mod.rs`
  Introduce the clean-break runtime primitive API and remove heuristic persistence behavior from the old helpers.
- `app/src-tauri/src/agents/openhands_server/process.rs`
  Support non-skill throwaway runtime workspaces and conversation retention under throwaway run roots.
- `app/src-tauri/src/agents/openhands_server/types.rs`
  Keep request construction aligned with the new primitive boundaries and runtime metadata.
- `app/src-tauri/src/agents/sidecar.rs`
  Keep request/config building generic around `workspace_root_dir` and `workspace_run_dir`.
- `app/src-tauri/src/commands/workflow/runtime.rs`
  Move workflow and answer evaluator onto explicit persistent-session semantics.
- `app/src-tauri/src/commands/refine/mod.rs`
  Centralize resume/create in `start_refine_session`, simplify wrapper state, and rename pause semantics.
- `app/src-tauri/src/commands/eval_workbench/mod.rs`
  Rename `suggest_scenario` to `define_eval_scenario`, map active flows to persistent vs throwaway, and remove old trigger/comparison surface code.
- `app/src-tauri/src/commands/skill/scope_review.rs`
  Keep scope validation on the throwaway runtime primitive and move it to dedicated throwaway runtime workspaces.
- `app/src-tauri/src/lib.rs`
  Update the registered Tauri command list to reflect renamed and removed commands.
- `app/src-tauri/src/skill_paths.rs`
  Add canonical helpers for throwaway runtime directories under `workspace/.openhands/throwaway/...`.
- `app/src/lib/tauri-command-types.ts`
  Update command names and remove deleted command contracts.
- `app/src/lib/tauri.ts`
  Update frontend wrappers to match the clean-break backend command set.
- `app/src/lib/eval-workbench.ts`
  Rename `suggestScenario` to `defineEvalScenario`, remove stale description-candidate surface, and simplify to the active one-surface workbench model.
- `app/src/components/workspace/workspace-eval-workbench.tsx`
  Call the renamed eval-scenario-definition command and keep only the active one-surface workbench flow.
- `app/src/components/workspace/workspace-evals.tsx`
  Keep the active eval workbench UI on the simplified command set.
- `app/src/components/workspace/workspace-refine.tsx`
  Rename frontend pause/cancel semantics and keep the view aligned to the simplified refine session model.
- `app/src/components/layout/app-layout.tsx`
  Update any refine stop command naming.
- `app/src/__tests__/lib/tauri.test.ts`
  Update frontend wrapper contract tests for renamed/removed commands.
- `app/src/__tests__/guards/tauri-command-policy.test.ts`
  Update command allowlist/removal expectations.
- `app/src/__tests__/lib/eval-workbench-tauri.test.ts`
  Update eval workbench wrapper tests for `define_eval_scenario` and deleted description-candidate surface.
- `app/src/__tests__/components/new-skill-dialog.test.tsx`
  Keep scope-review-only coverage and remove assumptions about deleted suggestion helpers.
- `docs/design/openhands-runtime-model/README.md`
  Keep design doc aligned if implementation reveals any naming or path adjustments.
- `repo-map.json`
  Reflect any command file or public-surface changes.

**Delete**

- `app/src/components/workspace/workspace-description.tsx`
  Orphaned description comparison surface.
- Any description-candidate-specific tests that only cover the deleted surface.
- Backend/frontend code paths for:
  - `generate_suggestions`
  - `suggest_description_candidates`
  - `apply_description_candidate`
  - old trigger/comparison-only eval helpers that are no longer part of the live product surface

**Review**

- `app/src/components/workspace/workspace-shell.tsx`
  Confirm the one-tab eval workbench routing remains correct after the cleanup.
- `TEST_MAP.md`
  Update only if command/test mappings actually change.

---

## Archived Original Implementation Checklist

The sections below are preserved as the original first-pass implementation
checklist. They are retained for history only.

## Task 1: Add Canonical Runtime Primitives

**Files:**

- Modify: `app/src-tauri/src/agents/openhands_server/mod.rs`
- Modify: `app/src-tauri/src/agents/openhands_server/process.rs`
- Modify: `app/src-tauri/src/agents/openhands_server/types.rs`
- Modify: `app/src-tauri/src/skill_paths.rs`
- Test: `app/src-tauri/src/agents/openhands_server/` tests and nearby Rust unit tests

- [ ] **Step 1: Add throwaway runtime path helpers**

Implement canonical helpers in `skill_paths.rs` for:

- `throwaway_runtime_dir(workspace_root, surface, run_id)`
- `throwaway_conversations_dir(run_dir)`
- optional `throwaway_logs_dir(run_dir)`

Use the agreed shape:

```text
{workspace}/.openhands/throwaway/{surface}/{run_id}/
```

- [ ] **Step 2: Make Agent Server runtime-root agnostic**

Refactor the OpenHands Agent Server code so it accepts an arbitrary runtime run
directory, not just a skill workspace directory. The conversation root should
still be computed as:

```rust
runtime_run_dir.join("conversations")
```

The runtime must continue to restart when the conversations root changes.

- [ ] **Step 3: Introduce explicit runtime primitive entrypoints**

In `app/src-tauri/src/agents/openhands_server/mod.rs`, add explicit functions
with clear semantics:

- `start_openhands_session(...)`
- `openhands_send_message(...)`
- `pause_openhands_session(...)`
- `run_throwaway_openhands_session(...)`

Rules:

- no heuristic "persistent if skill_name exists"
- no fallback aliasing to the old helper names
- persistent start owns resume-or-create
- send only sends the next turn into an already-established session
- throwaway run does not create a resumable product conversation ID

- [ ] **Step 4: Retain throwaway conversations for debugging**

Change throwaway semantics from "delete immediately" to:

- not resumable by product state
- retained under the throwaway runtime workspace
- eligible for later cleanup policy

Do not write throwaway conversation IDs to `skill_conversations`.

- [ ] **Step 5: Add or update Rust unit tests**

Cover at least:

- persistent session reuses a saved conversation only when compatible
- `OpenHandsSendMessage` does not own resume/create
- throwaway runs do not save `skill_conversations`
- throwaway runtime paths do not live under the skill workspace tree

- [ ] **Step 6: Run Rust verification**

Run:

```bash
cargo test --manifest-path app/src-tauri/Cargo.toml agents::openhands_server
cargo test --manifest-path app/src-tauri/Cargo.toml commands::refine
cargo test --manifest-path app/src-tauri/Cargo.toml commands::workflow
```

Expected:

- PASS for new runtime primitive behavior and adjusted session semantics

- [ ] **Step 7: Commit**

```bash
git add app/src-tauri/src/agents/openhands_server/mod.rs \
  app/src-tauri/src/agents/openhands_server/process.rs \
  app/src-tauri/src/agents/openhands_server/types.rs \
  app/src-tauri/src/skill_paths.rs
git commit -m "refactor: add explicit openhands runtime primitives"
```

---

## Task 2: Move Workflow To Persistent Session Primitives

**Files:**

- Modify: `app/src-tauri/src/commands/workflow/runtime.rs`
- Test: `app/src-tauri/src/commands/workflow/` tests

- [ ] **Step 1: Route `run_workflow_step` through the persistent primitives**

Update workflow step execution to:

- start/resume the persistent skill session
- send the step message into that session
- keep the conversation persisted and idle after completion

Do not pause after successful step completion.

- [ ] **Step 2: Route `run_answer_evaluator` through the same persistent session**

Update answer evaluator to:

- use the same persistent skill conversation model as workflow steps
- avoid a disposable side conversation
- preserve the current output parsing and workflow gate behavior

- [ ] **Step 3: Keep workflow cancellation mapped to pause semantics**

When a workflow run is actively in flight and the user cancels, map that to the
persistent-session pause behavior instead of disposable one-shot cancellation
semantics.

- [ ] **Step 4: Update Rust workflow tests**

Cover at least:

- step execution starts or resumes the persistent conversation
- answer evaluator shares the same persistent model
- completed turns do not auto-pause

- [ ] **Step 5: Run workflow verification**

Run:

```bash
cargo test --manifest-path app/src-tauri/Cargo.toml commands::workflow
cd app && bash tests/run.sh e2e --tag @workflow
```

Expected:

- PASS for workflow runtime tests and mocked workflow E2E coverage

- [ ] **Step 6: Commit**

```bash
git add app/src-tauri/src/commands/workflow/runtime.rs
git commit -m "refactor: move workflow to persistent openhands sessions"
```

---

## Task 3: Simplify Refine Session Ownership

**Files:**

- Modify: `app/src-tauri/src/commands/refine/mod.rs`
- Modify: `app/src/lib/tauri-command-types.ts`
- Modify: `app/src/lib/tauri.ts`
- Modify: `app/src/components/workspace/workspace-refine.tsx`
- Modify: `app/src/components/layout/app-layout.tsx`
- Test: refine Rust tests and frontend tests touching refine commands

- [ ] **Step 1: Move resume/create ownership into `start_refine_session`**

Update refine so `start_refine_session` is responsible for:

- loading or creating the persistent skill conversation
- validating compatibility
- restoring message history from the selected conversation
- returning the session handle for later sends

`send_refine_message` must stop owning resume/create decisions.

- [ ] **Step 2: Reduce backend session wrapper state**

Keep only the minimum refine wrapper state needed for:

- active run control
- view lifecycle cleanup
- any still-needed product-only metadata

Do not keep redundant state that can be derived from the persistent session or
conversation identity.

- [ ] **Step 3: Rename pause semantics cleanly**

Replace `cancel_refine_turn` naming with `pause_refine_session` across:

- Rust command registration
- TS command map
- frontend wrappers
- live components that issue stop/cancel

This is a clean break. Do not keep compatibility aliases.

- [ ] **Step 4: Keep `close_refine_session` as product cleanup only**

Ensure close:

- does not delete the persistent OpenHands conversation
- only tears down product-layer wrapper state

- [ ] **Step 5: Update tests**

Cover at least:

- start handles resume/create centrally
- send only sends the next message
- pause maps to active-run stop semantics
- close does not delete persistent conversation state

- [ ] **Step 6: Run refine verification**

Run:

```bash
cargo test --manifest-path app/src-tauri/Cargo.toml commands::refine
cd app && npm run test:unit -- workspace-refine
cd app && bash tests/run.sh e2e --tag @refine
```

Expected:

- PASS for refine Rust tests, frontend tests, and mocked refine E2E coverage

- [ ] **Step 7: Commit**

```bash
git add app/src-tauri/src/commands/refine/mod.rs \
  app/src/lib/tauri-command-types.ts \
  app/src/lib/tauri.ts \
  app/src/components/workspace/workspace-refine.tsx \
  app/src/components/layout/app-layout.tsx
git commit -m "refactor: simplify refine session ownership"
```

---

## Task 4: Clean-Break Eval Workbench Surface

**Files:**

- Modify: `app/src-tauri/src/commands/eval_workbench/mod.rs`
- Modify: `app/src/lib/eval-workbench.ts`
- Modify: `app/src/components/workspace/workspace-eval-workbench.tsx`
- Modify: `app/src/components/workspace/workspace-evals.tsx`
- Modify: `app/src/lib/tauri-command-types.ts`
- Modify: `app/src/lib/tauri.ts`
- Delete: `app/src/components/workspace/workspace-description.tsx`
- Delete: stale tests tied only to the removed description surface

- [ ] **Step 1: Rename `suggest_scenario` to `define_eval_scenario`**

Apply the rename across:

- Rust command name
- frontend wrappers
- typed command map
- live workbench UI
- tests and docs

Do not keep a compatibility alias.

- [ ] **Step 2: Move eval scenario definition to persistent primitives**

Update the renamed `define_eval_scenario` flow so it uses:

- `StartOpenHandsSession`
- `OpenHandsSendMessage`

This flow should be skill-bound and conversation-aware.

- [ ] **Step 3: Move refine-brief generation to persistent primitives**

Update `build_refine_improvement_brief` so it uses the persistent skill
conversation model rather than a throwaway run.

- [ ] **Step 4: Keep `run_eval_workbench` throwaway**

The actual eval execution path should stay throwaway:

- isolated runtime workspace
- no resumable product conversation
- retained throwaway artifacts for debugging

- [ ] **Step 5: Delete the dead description/comparison surface**

Remove:

- `WorkspaceDescription`
- `suggest_description_candidates`
- `apply_description_candidate`
- old trigger/comparison-only helpers and tests no longer reachable from the
  one-tab eval workbench

- [ ] **Step 6: Update eval tests**

Cover at least:

- renamed `define_eval_scenario`
- active one-tab workbench command flow
- deleted description surface no longer appears in wrapper or component tests

- [ ] **Step 7: Run eval verification**

Run:

```bash
cargo test --manifest-path app/src-tauri/Cargo.toml commands::eval_workbench
cd app && npm run test:unit -- eval-workbench
cd app && bash tests/run.sh e2e --tag @evals
```

Expected:

- PASS for eval workbench backend and frontend tests on the simplified surface

- [ ] **Step 8: Commit**

```bash
git add app/src-tauri/src/commands/eval_workbench/mod.rs \
  app/src/lib/eval-workbench.ts \
  app/src/components/workspace/workspace-eval-workbench.tsx \
  app/src/components/workspace/workspace-evals.tsx \
  app/src/lib/tauri-command-types.ts \
  app/src/lib/tauri.ts
git rm app/src/components/workspace/workspace-description.tsx
git commit -m "refactor: simplify eval workbench runtime surface"
```

---

## Task 5: Remove Dead Create-Skill Suggestion Path

**Files:**

- Delete: `app/src-tauri/src/commands/skill/suggestions.rs`
- Modify: `app/src-tauri/src/lib.rs`
- Modify: `app/src/lib/tauri-command-types.ts`
- Modify: `app/src/lib/tauri.ts`
- Modify: tests/docs that still mention `generate_suggestions`

- [ ] **Step 1: Remove backend command registration and implementation**

Delete the dead `generate_suggestions` path and remove its Tauri registration.

- [ ] **Step 2: Remove frontend wrapper and type surface**

Delete:

- `generateSuggestions(...)` wrapper
- `FieldSuggestions` command contract if it becomes unused

- [ ] **Step 3: Remove stale tests and docs**

Delete or update tests that only exist for the dead command and remove stale
docs that still list it as an active product surface.

- [ ] **Step 4: Run create-skill verification**

Run:

```bash
cargo test --manifest-path app/src-tauri/Cargo.toml commands::skill
cd app && npm run test:unit -- new-skill-dialog
```

Expected:

- PASS with only `review_skill_scope` remaining as the live Create Skill
  OpenHands surface

- [ ] **Step 5: Commit**

```bash
git add app/src-tauri/src/lib.rs \
  app/src/lib/tauri-command-types.ts \
  app/src/lib/tauri.ts
git rm app/src-tauri/src/commands/skill/suggestions.rs
git commit -m "refactor: remove dead create-skill suggestion path"
```

---

## Task 6: Final Docs, Repo Map, and Regression Sweep

**Files:**

- Modify: `docs/design/openhands-runtime-model/README.md`
- Modify: `repo-map.json`
- Modify: `TEST_MAP.md` only if command/test mapping changed materially

- [ ] **Step 1: Reconcile docs with final implementation names**

Ensure the runtime model doc matches the actual implemented command names and
runtime primitive names exactly.

- [ ] **Step 2: Update repo-map if command surfaces changed**

Reflect renamed or removed command surfaces so the repo map matches the code.

- [ ] **Step 3: Run the required docs checks**

Run:

```bash
markdownlint docs/design/openhands-runtime-model/README.md docs/plans/2026-05-07-openhands-runtime-clean-break.md
cd app && npm run test:repo-map
```

Expected:

- PASS for doc lint and repo map audit

- [ ] **Step 4: Run focused final regression**

Run:

```bash
cargo test --manifest-path app/src-tauri/Cargo.toml
cd app && npm run test:unit
cd app && bash tests/run.sh e2e --tag @workflow
cd app && bash tests/run.sh e2e --tag @refine
cd app && bash tests/run.sh e2e --tag @evals
```

Expected:

- PASS on the clean-break runtime model with no fallback aliases

- [ ] **Step 5: Commit**

```bash
git add docs/design/openhands-runtime-model/README.md repo-map.json TEST_MAP.md
git commit -m "docs: finalize openhands runtime clean break"
```

---

## Spec Coverage Check

- Explicit four-primitive OpenHands runtime model: covered by Tasks 1-4.
- Clean break with no fallback compatibility shims: enforced throughout Tasks
  1-6.
- Persistent session semantics for Workflow, answer evaluator, Refine,
  eval-scenario definition, and refine-improvement brief: covered by Tasks 2-4.
- Throwaway runtime semantics with separate runtime workspaces and debug
  retention: covered by Task 1 and Task 4.
- Dead code cleanup of old eval/create-skill surfaces: covered by Tasks 4-5.

## Placeholder Scan

This plan intentionally does **not** include fallback aliases, compatibility
shims, or "migrate later" branches. Dead surfaces are removed in the same
change set.

## Type Consistency Check

The intended clean-break command/runtime names used throughout this plan are:

- Runtime primitives:
  - `StartOpenHandsSession`
  - `OpenHandsSendMessage`
  - `PauseOpenHandsSession`
  - `RunThrowawayOpenHandsSession`

- Product commands:
  - `run_workflow_step`
  - `run_answer_evaluator`
  - `start_refine_session`
  - `send_refine_message`
  - `pause_refine_session`
  - `close_refine_session`
  - `review_skill_scope`
  - `define_eval_scenario`
  - `build_refine_improvement_brief`
  - `run_eval_workbench`
