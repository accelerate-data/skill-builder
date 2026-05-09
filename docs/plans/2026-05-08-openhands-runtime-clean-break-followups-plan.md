# OpenHands Runtime Clean-Break Follow-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the already-landed selected-skill OpenHands runtime clean break
intact, then finish the Eval Workbench clean break by deleting run execution,
disk-backed scenario storage, and Eval-owned OpenHands bootstrap paths.

**Architecture:** Skill selection is the only owner of persistent OpenHands
bootstrap/resume/pause. Refine, Workflow, Review, and Eval send messages on the
selected-skill conversation; they do not start or resume conversations
themselves. Eval Workbench is an authoring-only surface for scenarios and
assertions stored in SQLite.

**Tech Stack:** Rust/Tauri commands, Rust-managed OpenHands Agent Server,
SQLite via `rusqlite`, React/TypeScript, TanStack Query, Vitest, cargo test,
Playwright E2E tags, markdownlint.

---

## Current Status Summary

### Already Done: Selected-Skill OpenHands Runtime Ownership

- [x] Selected-skill OpenHands bootstrap moved to the global layout/session
      layer.
- [x] Refine no longer bootstraps OpenHands on mount.
- [x] Workflow persistent turns send on the selected-skill conversation instead
      of opening/resuming their own conversation.
- [x] Reset/redo clear stale persisted conversation state and force a fresh
      selected-skill bootstrap before rerunning workflow.
- [x] Skill locks moved to selected-skill lifecycle ownership.
- [x] Skill switch and app shutdown pause the selected-skill OpenHands session
      and release the selected skill lock.
- [x] Refine resume restores transcript/messages/events and preserves
      dispatched-turn state.
- [x] Stable OpenHands workspace secret persistence exists under
      `workspace/.openhands/secret.key`.
- [x] Graceful OpenHands Agent Server shutdown is wired through app exit.

### Already Done: Eval Run Schema Removal Direction

- [x] Migration 48 creates flat `scenarios` and `assertions` tables.
- [x] Migration 48 drops legacy `eval_prompt_sets`, `eval_prompt_cases`,
      `eval_runs`, `eval_run_results`, and `description_candidates`.
- [x] The active Tauri command registration no longer exports
      `run_eval_workbench`, `cancel_eval_workbench_run`, `list_eval_runs`,
      `read_eval_run`, or `build_refine_improvement_brief`.
- [x] `app/promptfoo-sidecar/` is no longer present in the checkout.
- [x] The visible Eval UI is already close to authoring-only: scenario name,
      prompt, assertions, New, Suggest, Delete, and Save.

### Still Open: Non-Eval Runtime Test Debt

- [ ] Add direct backend tests for `select_skill_openhands_session` in
      `app/src-tauri/src/commands/skill_session.rs` covering saved-conversation
      reuse.
- [ ] Add direct command-level backend tests for `pause_openhands_session` side
      effects in `app/src-tauri/src/commands/skill_session.rs`.

## Eval Workbench Clean-Break Target

The Eval Workbench target is intentionally narrower than the old design docs:

- only scenario/assertion authoring exists;
- scenarios and assertions are SQLite-backed, not YAML-backed;
- Eval does not own OpenHands bootstrap/resume;
- Eval generation sends a prompt to the already-selected skill conversation;
- no eval run execution exists in app code, DB tables, docs, or tests;
- no Promptfoo sidecar exists in app code or app test maps;
- root `tests/evals/` remains untouched because it is the engineering regression
  harness, not the app-owned Eval Workbench runtime.

## Eval Workbench Clean-Break Tasks

### Task 1: Make SQLite The Active Scenario Store

**Files:**

- Modify: `app/src-tauri/src/commands/eval_workbench/mod.rs`
- Modify: `app/src-tauri/src/db/eval_workbench.rs`
- Delete: `app/src-tauri/src/commands/eval_workbench/scenarios.rs`
- Modify: `app/src-tauri/src/commands/eval_workbench/types.rs`
- Modify: `app/src-tauri/src/lib.rs`
- Modify: `app/src/lib/eval-workbench.ts`
- Modify: `app/src/lib/queries/eval-scenarios.ts`
- Modify tests under `app/src-tauri/src/db/eval_workbench.rs`,
  `app/src/__tests__/lib/eval-workbench-tauri.test.ts`, and
  `app/src/__tests__/lib/queries/eval-scenarios.test.tsx`

- [ ] Replace `list_scenarios`, `load_scenario`, `create_scenario`,
      `save_scenario`, and `delete_scenario` command implementations so they
      use `crate::db::eval_workbench` exclusively.
- [ ] Remove `resolve_eval_dir`, `scenario_file_path`, `read_scenario_file`,
      `write_scenario_file`, `delete_scenario_file`, and YAML parsing from the
      active Eval command path.
- [ ] Delete `commands/eval_workbench/scenarios.rs` once no active code imports
      it.
- [ ] Remove `#![allow(dead_code)]` from `db/eval_workbench.rs` by making its
      scenario/assertion CRUD the live command implementation.
- [ ] Keep scenario identity keyed by stable `id`; use name only as display text
      and command lookup compatibility where the current UI still passes names.
- [ ] Update frontend tests that currently say "git-backed scenarios" so they
      assert DB-backed scenario command contracts instead.

### Task 2: Remove Eval-Owned OpenHands Bootstrap And Throwaway Generation

**Files:**

- Modify: `app/src-tauri/src/commands/eval_workbench/mod.rs`
- Modify: `app/src-tauri/src/commands/eval_workbench/types.rs`
- Modify: `app/src/lib/eval-workbench.ts`
- Modify: `app/src/lib/queries/eval-scenarios.ts`
- Modify: `app/e2e/evals/evals.spec.ts`
- Modify: `tests/evals/packages/workspace-eval-workbench-suggest-scenario-prompt/*`

- [ ] Delete `build_generation_sidecar_config`.
- [ ] Delete `run_define_eval_scenario_throwaway_turn`.
- [ ] Delete the test `define_eval_scenario_uses_throwaway_runtime_path`.
- [ ] Replace `define_eval_scenario` with a selected-conversation generation
      command. Preferred public name: `generate_eval_scenario_assertions`.
- [ ] The generation command must look up the persisted selected-skill
      conversation id from `skill_conversations`.
- [ ] If no selected-skill conversation exists, fail loudly with the same class
      of error Workflow uses: no active OpenHands conversation for the skill and
      plugin.
- [ ] Dispatch the generation prompt with `send_openhands_message` /
      `openhands_send_message` using `SendExistingOnly`; do not call
      `ensure_openhands_server`, `start_openhands_session`, or
      `run_throwaway_openhands_session`.
- [ ] Persist generated scenario prompt and assertions back to SQLite in the
      same command.
- [ ] Update frontend wrapper/query names from `defineEvalScenario` to
      `generateEvalScenarioAssertions`.
- [ ] Rename UI copy from `Suggest` / `Suggesting...` to `Generate scenario and
      assertions` / `Generating...`.

### Task 3: Delete Eval Run Runtime And UI Leftovers

**Files:**

- Delete: `app/src/lib/eval-running-state.ts`
- Delete: `app/src/lib/eval-run.ts`
- Delete: `app/src/__tests__/lib/eval-run.test.ts`
- Modify: `app/src/components/layout/app-layout.tsx`
- Modify: `app/src/components/workspace/workspace-shell.tsx`
- Modify: `app/src/components/workspace/workspace-evals.tsx`
- Modify tests under `app/src/__tests__/components/app-layout.test.tsx` and
  `app/src/__tests__/components/workspace/workspace-shell.test.tsx`

- [ ] Remove `getEvalsRunning`, `requestEvalsCancel`, and
      `subscribeEvalsRunning` imports/usages from app layout.
- [ ] Remove Eval-running tab-switch guard behavior from `workspace-shell.tsx`.
- [ ] Remove Eval-specific Escape-key cancellation behavior from
      `app-layout.tsx`.
- [ ] Remove `RunStatusFooter` from `workspace-evals.tsx`; Eval authoring has no
      active run status.
- [ ] Delete pure run-result helper tests and code that only support old eval
      run analysis.
- [ ] Keep Workflow benchmark/eval artifact helpers untouched; they are separate
      from app-owned Eval Workbench runs.

### Task 4: Clean DB Migration Tests And Schema Contracts

**Files:**

- Modify: `app/src-tauri/src/db/tests.rs`
- Modify: `app/src-tauri/src/db/migrations.rs` only if a new forward migration
  is needed
- Modify: `app/src-tauri/src/db/eval_workbench.rs`

- [ ] Remove tests that validate preserving or recovering legacy `eval_runs`
      state, because clean break intentionally discards run history.
- [ ] Keep migration coverage proving old prompt-set/case data migrates into
      `scenarios` and `assertions`.
- [ ] Add direct DB tests for create, list, load, update, rename, delete, and
      assertion replacement through the same DB helpers used by Tauri commands.
- [ ] Do not add new eval run tables.
- [ ] Do not add compatibility tables for old Promptfoo app-owned run history.

### Task 5: Update Docs, Repo Map, And Contract Tests

**Files:**

- Modify: `docs/design/eval-workbench/README.md`
- Modify: `docs/design/remove-promptfoo/README.md`
- Modify: `docs/design/backend-design/api.md`
- Modify: `repo-map.json`
- Modify: `TEST_MAP.md`
- Modify: `tests/evals/assertions/tauri-command-contract.test.js`

- [ ] Rewrite `docs/design/eval-workbench/README.md` so the source of truth is
      SQLite `scenarios` + `assertions`, not git-backed YAML files.
- [ ] Remove `Evaluate`, Promptfoo sidecar, run history, and run-preparation
      language from Eval Workbench design docs.
- [ ] Update `docs/design/remove-promptfoo/README.md` to mark completed clean
      break work and remove stale instructions that say to keep bulk generation.
- [ ] Update backend API docs to list only active Eval Workbench commands.
- [ ] Remove stale API docs entries for `run_eval_workbench`,
      `cancel_eval_workbench_run`, `list_eval_runs`, `read_eval_run`, and
      `build_refine_improvement_brief`.
- [ ] Update the Tauri command contract test so it asserts those run commands
      are absent, not present.
- [ ] Remove `app/promptfoo-sidecar` entries from `TEST_MAP.md`.
- [ ] Update `repo-map.json` descriptions so `eval-workbench.ts` is described as
      scenario/assertion authoring only, with no run history/refine brief.

### Task 6: Validate The Clean Break

**Files:**

- No production file ownership; this is verification only.

- [ ] Run Rust Eval command and DB tests:

```bash
cargo test --manifest-path app/src-tauri/Cargo.toml commands::eval_workbench db::eval_workbench
```

- [ ] Run frontend tests for Eval wrappers and workspace shell:

```bash
cd app && npx vitest run \
  src/__tests__/lib/eval-workbench-tauri.test.ts \
  src/__tests__/lib/queries/eval-scenarios.test.tsx \
  src/__tests__/components/workspace/workspace-evals.test.tsx \
  src/__tests__/components/workspace/workspace-shell.test.tsx \
  src/__tests__/components/app-layout.test.tsx
```

- [ ] Run command-contract and repo metadata checks:

```bash
cd tests/evals && npm test
cd ../.. && cd app && npm run test:repo-map
```

- [ ] Run typecheck:

```bash
cd app && npx tsc --noEmit
```

- [ ] Run markdownlint for changed docs:

```bash
markdownlint \
  docs/plans/2026-05-08-openhands-runtime-clean-break-followups-plan.md \
  docs/design/eval-workbench/README.md \
  docs/design/remove-promptfoo/README.md \
  docs/design/backend-design/api.md \
  TEST_MAP.md
```

## Explicit Delete List

Delete these if the implementation confirms they only support removed Eval run
or disk-backed scenario behavior:

- `app/src-tauri/src/commands/eval_workbench/scenarios.rs`
- `app/src/lib/eval-running-state.ts`
- `app/src/lib/eval-run.ts`
- `app/src/__tests__/lib/eval-run.test.ts`
- old Eval-running guards in `app/src/components/layout/app-layout.tsx`
- old Eval-running guards in `app/src/components/workspace/workspace-shell.tsx`
- stale Promptfoo sidecar rows in `TEST_MAP.md`
- stale Eval run command rows in `docs/design/backend-design/api.md`

## Non-Goals

- Do not touch root `tests/evals/` packages except for contract tests and prompt
  text directly tied to the app-owned Eval Workbench generation command.
- Do not add an eval execution engine.
- Do not add eval run tables.
- Do not preserve app-owned Promptfoo run history.
- Do not support YAML scenario files as a source of truth.
- Do not make Eval bootstrap or resume OpenHands.

## Completion Criteria

- [ ] Eval scenario list/detail/create/save/delete read and write SQLite only.
- [ ] Eval generation uses the selected-skill OpenHands conversation only.
- [ ] Eval generation fails loudly when the selected skill has no active
      conversation.
- [ ] No active app code references `eval_runs`, `eval_run_results`,
      `description_candidates`, `eval_prompt_sets`, or `eval_prompt_cases`
      outside historical migrations.
- [ ] No active app code references `app/promptfoo-sidecar`.
- [ ] No active Eval UI shows run status, run history, Evaluate, or
      cancellation controls.
- [ ] Docs and repo metadata describe the clean-break model.
- [ ] Validation commands in Task 6 pass or have documented, unrelated blockers.
