# VU-1178 Acceptance Criteria Review Gate

**Date:** 2026-05-09
**Branch:** `feature/vu-1178-eval-workbench-clean-break-db-backed-scenario-and-assertion`
**Reviewer:** Automated AC verification

---

## AC 1: Eval scenario list, detail, create, save, and delete read/write SQLite scenarios and assertions only

**Verdict: ✅ MET**

**Evidence:**

- `app/src-tauri/src/commands/eval_workbench/mod.rs:263-353` — All five commands (`list_scenarios`, `load_scenario`, `create_scenario`, `save_scenario`, `delete_scenario`) call `crate::db::eval_workbench` exclusively.
- `app/src-tauri/src/db/eval_workbench.rs` — Full SQLite CRUD with bound parameters (`rusqlite::params!`), no file I/O.
- `app/src-tauri/src/commands/eval_workbench/scenarios.rs` — Deleted (directory contains only `mod.rs` and `types.rs`).
- `app/src/lib/eval-workbench.ts` — Frontend wrappers invoke Tauri commands that route to SQLite.
- `app/src/lib/queries/eval-scenarios.ts` — TanStack Query hooks wired to the SQLite-backed commands.
- No YAML file reads/writes in the eval command path.

---

## AC 2: Disk-backed YAML scenario CRUD is removed from active app code

**Verdict: ✅ MET**

**Evidence:**

- `scenarios.rs` (the old YAML-backed file module) is deleted.
- No `yaml` references in `app/src-tauri/src/commands/eval_workbench/` — YAML usage in the codebase is limited to SKILL.md frontmatter parsing (`imported_skills/frontmatter.rs`, `github_import/import.rs`, `refine/output.rs`), which is unrelated to eval scenarios.
- No `.yaml` file path construction for eval scenarios anywhere in active code.
- `app/src-tauri/src/db/eval_workbench.rs` has no `#![allow(dead_code)]` — the CRUD is live.

---

## AC 3: Eval scenario/assertion generation sends on the selected-skill OpenHands conversation only

**Verdict: ✅ MET**

**Evidence:**

- `app/src-tauri/src/commands/eval_workbench/mod.rs:355-458` — `generate_eval_scenario_assertions`:
  - Looks up `conversation_id` via `get_skill_conversation_id` (line 374).
  - Dispatches via `openhands_server::send_openhands_message` (line 435) — the canonical `SendExistingOnly` path.
  - Does NOT call `ensure_openhands_server`, `start_openhands_session`, or `run_throwaway_openhands_session`.
  - Uses `setup_turn_listeners` + `wait_for_turn_result` to wait for the terminal result on the existing conversation.
- Old command names `suggest_scenario` and `generate_scenario_description` are absent from the codebase.
- `define_eval_scenario` and `build_generation_sidecar_config` are absent from active code.

---

## AC 4: Eval generation fails loudly when the selected skill has no active OpenHands conversation

**Verdict: ✅ MET**

**Evidence:**

- `app/src-tauri/src/commands/eval_workbench/mod.rs:374-380`:
  ```rust
  let conversation_id = get_skill_conversation_id(&conn, &plugin_slug, &skill_name)?
      .ok_or_else(|| {
          format!(
              "No active OpenHands conversation for skill '{}' in plugin '{}'. Select a skill conversation in Refine first.",
              skill_name, plugin_slug
          )
      })?;
  ```
  Returns an `Err` with a clear message when no conversation exists — fails before any dispatch attempt.

---

## AC 5: No active Eval UI shows run status, run history, Evaluate, or cancellation controls

**Verdict: ✅ MET**

**Evidence:**

- `app/src/components/workspace/workspace-evals.tsx` — Contains only scenario authoring UI: New scenario button, PromptSetEditor (name, prompt, assertions), Generate scenario and assertions button, Delete scenario button, Save button. No run status, no run history, no Evaluate button, no cancellation controls.
- `app/src/components/workspace/workspace-shell.tsx` — No eval-running tab-switch guard. The only tab guard is for Refine-while-running (line 52-58).
- `app/src/components/layout/app-layout.tsx` — No `getEvalsRunning`, `requestEvalsCancel`, or `subscribeEvalsRunning` imports. Escape-key handler only cancels refine runs and workflow steps (lines 95-116), not eval runs.
- `app/src/lib/eval-run.ts` — Deleted.
- `app/src/lib/eval-running-state.ts` — Deleted.
- `app/src/__tests__/lib/eval-run.test.ts` — Deleted.
- E2E test (`app/e2e/evals/evals.spec.ts:74`) explicitly asserts: `await expect(page.getByRole("button", { name: "Evaluate" })).toHaveCount(0)`.
- `RunStatusFooter` component still exists (`app/src/components/run-status-footer.tsx`) but is only used by `agent-run-footer.tsx` for workflow/refine agent runs — NOT by any eval component.

---

## AC 6: No active app code references app-owned eval run tables or Promptfoo sidecar paths outside historical migrations

**Verdict: ✅ MET (with one repo-map documentation staleness note)**

**Evidence:**

- **Promptfoo references in active app code:** Zero matches. All `promptfoo` references are confined to `tests/evals/` (the engineering harness), which is explicitly a non-goal per the plan.
- **Eval run table references in active code:** Only found in `app/src-tauri/src/db/migrations.rs` (historical migrations 44, 46, 48), which is expected and acceptable.
- **`app/promptfoo-sidecar/`** — Does not exist in the checkout.
- **Old run commands:** `run_eval_workbench`, `cancel_eval_workbench_run`, `list_eval_runs`, `read_eval_run`, `build_refine_improvement_brief` are NOT registered in `app/src-tauri/src/lib.rs:302-416`.
- **Tauri command contract test** (`tests/evals/assertions/tauri-command-contract.test.js:158-200`) asserts these commands are absent from the published API.

**Note:** `repo-map.json` still references deleted files in its `lib/` module description (`eval-run.ts`, `eval-running-state.ts`) and mentions `description/` sub-module in the `commands/` description (directory no longer exists). This is a documentation staleness issue, not an active code violation. See "Repo-Map Staleness" below.

---

## AC 7: Eval Workbench docs, backend API docs, repo-map, and test-map describe the clean-break model

**Verdict: ⚠️ PARTIALLY MET**

**Evidence — Docs that are correctly updated:**

- `docs/design/eval-workbench/README.md` — Fully rewritten. Describes authoring-only SQLite model, generation via selected-skill conversation, no eval run execution. Includes correct data model (scenarios + assertions tables), UI model, generation behavior, and key source files.
- `docs/design/remove-promptfoo/README.md` — Marked "Completed (2026-05-09)" with completion notes confirming all goals achieved.
- `docs/design/backend-design/api.md` — Eval Workbench section (lines 192-202) lists only the five active commands: `list_scenarios`, `load_scenario`, `create_scenario`, `save_scenario`, `delete_scenario`, `generate_eval_scenario_assertions`. No stale run commands present.
- `TEST_MAP.md` — No `promptfoo-sidecar` entries. Eval workbench correctly mapped to `@evals` E2E tag and `commands::eval_workbench` cargo filter.

**Evidence — Repo-map staleness (needs fixing):**

- `repo-map.json` `lib/` module description still references:
  - `eval-workbench.ts (scenario, run-history, and refine-brief helpers...)` — should say "scenario/assertion authoring only"
  - `eval-run.ts (pure evaluation result helpers)` — file deleted
  - `eval-running-state.ts (module-scoped running-state pub/sub...)` — file deleted
- `repo-map.json` `commands/` module description still references:
  - `eval_workbench/ (scenario CRUD and suggestion commands)` — "suggestion" is stale; it's generation now
  - `description/ (mod.rs: run_optimization_loop/...)` — directory does not exist

These are documentation-only issues in repo metadata, not active code violations. They should be fixed but do not block the functional clean break.

---

## AC 8: Targeted validation passes or has documented unrelated blockers

**Verdict: ⚠️ NOT VERIFIED (validation commands not run in this review)**

The following validation commands from the implementation plan Task 6 should be run before merge:

```bash
# Rust Eval command and DB tests
cargo test --manifest-path app/src-tauri/Cargo.toml commands::eval_workbench db::eval_workbench

# Frontend tests
cd app && npx vitest run \
  src/__tests__/lib/eval-workbench-tauri.test.ts \
  src/__tests__/lib/queries/eval-scenarios.test.tsx \
  src/__tests__/components/workspace/workspace-evals.test.tsx \
  src/__tests__/components/workspace/workspace-shell.test.tsx \
  src/__tests__/components/app-layout.test.tsx

# Command contract and repo-map
cd tests/evals && npm test
cd app && npm run test:repo-map

# Typecheck
cd app && npx tsc --noEmit

# Markdown lint
markdownlint \
  docs/design/eval-workbench/README.md \
  docs/design/remove-promptfoo/README.md \
  docs/design/backend-design/api.md \
  TEST_MAP.md
```

---

## Summary

| AC | Status | Notes |
|---|---|---|
| 1. SQLite scenario CRUD | ✅ MET | All five commands use `db::eval_workbench` exclusively |
| 2. YAML scenario CRUD removed | ✅ MET | `scenarios.rs` deleted; no YAML in eval path |
| 3. Generation via selected-skill conversation | ✅ MET | Uses `send_openhands_message` with `get_skill_conversation_id` |
| 4. Fails loudly without conversation | ✅ MET | Returns descriptive `Err` before dispatch |
| 5. No run UI controls | ✅ MET | Deleted `eval-run.ts`, `eval-running-state.ts`; E2E asserts no Evaluate button |
| 6. No eval run / promptfoo refs in active code | ✅ MET | Only in migrations and `tests/evals/` harness |
| 7. Docs describe clean-break model | ⚠️ PARTIALLY MET | All docs correct; `repo-map.json` has stale descriptions for deleted files |
| 8. Validation commands pass | ⚠️ NOT VERIFIED | Must be run before merge |

## Required Actions Before Merge

1. **Update `repo-map.json`** to remove references to deleted files (`eval-run.ts`, `eval-running-state.ts`) and the non-existent `description/` command module. Update `eval-workbench.ts` description to "scenario/assertion authoring only".
2. **Run validation commands** from AC 8 to confirm tests, typecheck, and lint pass.
