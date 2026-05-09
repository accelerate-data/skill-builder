# Review: VU-1178 Eval Workbench clean break: DB-backed scenario and assertion authoring

- **Branch:** `feature/vu-1178-eval-workbench-clean-break-db-backed-scenario-and-assertion`
- **PR:** [#586](https://github.com/accelerate-data/skill-builder/pull/586)
- **Review Date:** 2026-05-09
- **Reviewer:** code-reviewer agent

## Intent

Refactor Eval Workbench into an authoring-only surface where:
1. Scenarios and assertions are stored in SQLite (not YAML/disk-backed).
2. Generation uses the selected-skill OpenHands conversation via `send_openhands_message`.
3. All app-owned eval-run execution concepts are removed (no run status, history, cancellation, or Promptfoo sidecar).

## Scope Comparison

| Source | Claim / Requirement |
|--------|---------------------|
| **Linear Issue (VU-1178)** | 8 acceptance criteria: SQLite-only CRUD, remove YAML CRUD, selected-skill generation, fail loudly without conversation, no run UI, no legacy table references, docs updated, validation passes. |
| **Implementation Plan** | 6 tasks: (1) SQLite as active store, (2) Remove eval-owned OpenHands bootstrap, (3) Delete eval run runtime/UI, (4) Clean DB migration tests, (5) Update docs/repo-map/contracts, (6) Validate. |
| **Design Doc** | Authoring-only surface, SQLite storage, generation via `send_openhands_message`, no run execution. |
| **Commits (10 total)** | `9fc63829` SQLite store + generation → `cda68c60` race condition fix → `41a35928` remove eval run leftovers → `ceed0009` clean DB tests → `272db061` adversarial review → `e421fd5f` address review findings → `78a1602d` remove duplicate button → `aad89a2f` address high-severity findings. Earlier commits for VU-1173 and docs alignment are also on the branch. |
| **Diff** | 97 files changed, +2612 / -2938 lines. Net reduction of ~326 lines. |

## Acceptance Criteria

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Eval scenario list/detail/create/save/delete read/write SQLite only | **Proven** | `mod.rs` commands (`list_scenarios`, `load_scenario`, `create_scenario`, `save_scenario`, `delete_scenario`) all use `crate::db::eval_workbench::*` exclusively. `scenarios.rs` (disk-backed) deleted. No file I/O in command path. |
| 2 | Disk-backed YAML scenario CRUD removed from active app code | **Proven** | `scenarios.rs` deleted; `resolve_eval_dir` removed from `skill_paths.rs`; no `scenario_file_path`, `read_scenario_file`, `write_scenario_file`, or YAML parsing references in active code. |
| 3 | Eval generation sends on selected-skill OpenHands conversation only | **Proven** | `generate_eval_scenario_assertions` calls `get_skill_conversation_id` then `send_openhands_message`. No `ensure_openhands_server`, `start_openhands_session`, or `run_throwaway_openhands_session`. `build_generation_sidecar_config` and `run_define_eval_scenario_throwaway_turn` deleted. |
| 4 | Eval generation fails loudly when no active conversation | **Proven** | `get_skill_conversation_id` returns `None` → error: `"No active OpenHands conversation for skill '{}' in plugin '{}'. Select a skill conversation in Refine first."` |
| 5 | No active Eval UI shows run status, run history, Evaluate, or cancellation | **Proven** | `eval-running-state.ts` and `eval-run.ts` deleted; `RunStatusFooter` removed from `workspace-evals.tsx`; Escape-key eval cancellation removed from `app-layout.tsx`; tab-switch eval-running guard removed from `workspace-shell.tsx`. E2E test asserts `Evaluate` button count is 0. |
| 6 | No active app code references eval run tables or Promptfoo paths outside migrations | **Proven** | `lib.rs` no longer registers run commands; `TEST_MAP.md` promptfoo entries removed; `api.md` updated. Legacy table references exist only in migration 43-48 code (create → migrate → drop), which is acceptable. No `promptfoo-sidecar` references in active code. |
| 7 | Eval Workbench docs, backend API, repo-map, test-map describe clean-break model | **Partially Proven** | `docs/design/eval-workbench/README.md` rewritten for SQLite/authoring-only. `docs/design/backend-design/api.md` lists only active commands. `TEST_MAP.md` cleaned. **However**, `repo-map.json` has multiple stale entries (see Findings #1). |
| 8 | Validation commands pass | **Open** | Review is static; cannot confirm `cargo test`, `tsc --noEmit`, `vitest run`, `npm test` (contracts), or `markdownlint` pass. The branch has prior review docs suggesting these were run, but verification-before-completion requires evidence on the current HEAD. |

## Findings

### Medium

1. **[Architect] `repo-map.json` has multiple stale references to deleted files and modules**
   - **File:** `repo-map.json` lines 106, 110, 165
   - **Issue:** Several descriptions reference code that no longer exists:
     - `frontend_lib` (line 106): mentions `eval-run.ts` (deleted), `eval-running-state.ts` (deleted), and describes `eval-workbench.ts` as having "run-history, and refine-brief helpers" (both removed).
     - `rust_commands` (line 110): references `description/` module (directory deleted — `run_optimization_loop`, `apply_description`, etc. are gone) and says `eval_workbench/` has "suggestion commands" (stale — `generate_suggestions` was removed). Also references `skill/suggestions` which does not exist.
     - `e2e_tests` (line 165): says "The description/ and evals/ specs cover the two modes" — `app/e2e/description/` directory was deleted.
   - **Impact:** Violates the pre-PR repo-map audit rule in `AGENTS.md`. Developers relying on repo-map for codebase navigation will be misled.
   - **Recommendation:** Update `repo-map.json` descriptions to reflect current state: remove `eval-run.ts`, `eval-running-state.ts`, `description/` module, `skill/suggestions`, and `e2e/description/` references. Update `eval-workbench.ts` description to "scenario/assertion authoring helpers for the app-owned Eval Workbench".

2. **[Minimalist] Frontend `previousScenarioName` is dead code across component/query layers**
   - **Files:** `app/src/lib/queries/eval-scenarios.ts:24`, `app/src/components/workspace/workspace-evals.tsx:22`, `app/src/components/workspace/workspace-eval-workbench.tsx:59`, `app/src/__tests__/lib/queries/eval-scenarios.test.tsx:68`
   - **Issue:** The backend `save_scenario` command and `TauriCommandMap` no longer accept `previousScenarioName`. However, the frontend still declares it in `SaveScenarioMutationInput`, `WorkspaceEvalsProps.onSaveScenario` options, `handleSaveScenario` local type, and tests. The `useSaveScenario` mutationFn destructures only `scenario` and never passes `previousScenarioName` to the backend.
   - **Impact:** No runtime error, but confusing dead code that suggests rename semantics still apply.
   - **Recommendation:** Remove `previousScenarioName` from `SaveScenarioMutationInput`, `WorkspaceEvalsProps`, `handleSaveScenario`, and the query test. The cache invalidation logic in `useSaveScenario` (lines 65-76) that uses `previousScenarioName` to remove stale cache entries should also be reviewed — since the scenario name is now the stable key (no file renames), the old-key removal may be unnecessary.

3. **[Architect] No UNIQUE constraint on `(plugin_slug, skill_name, name)` in scenarios table**
   - **File:** `app/src-tauri/src/db/migrations.rs:346-356` (migration 48)
   - **Issue:** The `scenarios` table has `id TEXT PRIMARY KEY` but no unique constraint on the `(plugin_slug, skill_name, name)` triplet. `delete_scenario` and `read_scenario` query by name. If two scenarios with the same name exist (possible via race or direct DB manipulation), delete/read operations would affect arbitrary matching rows.
   - **Recommendation:** Add `UNIQUE(plugin_slug, skill_name, name)` via a new migration, or change the command layer to use `id` for delete/load operations.

4. **[Skeptic] `parse_generated_scenario_response` silently falls back to existing data on partial LLM response**
   - **File:** `app/src-tauri/src/commands/eval_workbench/mod.rs:141-154`
   - **Issue:** If the LLM response is missing `prompt` or `expectations`, the function falls back to `existing_scenario.prompt` and `existing_scenario.assertions`. A malformed or partial LLM response results in a "successful" generation that silently preserves stale data — the user sees no error but gets no new content.
   - **Recommendation:** Fail loudly when the LLM response is missing required fields, or at minimum log a warning so the issue is observable.

### Low

5. **[Minimalist] Prompt template file retains old name**
   - **File:** `agent-sources/prompts/eval-workbench-suggest-scenario.txt` (referenced at `mod.rs:14-17`)
   - **Issue:** The constant was renamed from `SUGGEST_SCENARIO_PROMPT_TEMPLATE` to `GENERATE_SCENARIO_PROMPT_TEMPLATE`, but the source file is still named `eval-workbench-suggest-scenario.txt`.
   - **Recommendation:** Rename the file to `eval-workbench-generate-scenario.txt` in a follow-up.

6. **[Minimalist] `save_scenario` always resets `sort_order` to 0**
   - **File:** `app/src-tauri/src/db/eval_workbench.rs:80`
   - **Issue:** `save_scenario` hardcodes `sort_order` to `0i64` on every INSERT/UPDATE. All scenarios effectively sort by name only. If sort ordering is intended to be user-controllable in the future, this silently destroys it.
   - **Recommendation:** Either preserve existing `sort_order` on update, or remove `sort_order` from the schema and sort by `name` only to be explicit.

7. **[Skeptic] `ScenarioSummaryDto` includes `prompt` field**
   - **File:** `app/src-tauri/src/commands/eval_workbench/types.rs:14-23`
   - **Issue:** `ScenarioSummaryDto` has a `prompt` field even though it's intended as a lightweight summary for the list view. The `scenario_summary_to_dto` function populates it from the full scenario, meaning every list item carries the full prompt text.
   - **Recommendation:** If `prompt` isn't needed in the summary, remove it from `ScenarioSummaryDto` to reduce payload size.

## What Went Well

1. **Thorough deletion of eval-run execution.** The removal of `eval-run.ts`, `eval-running-state.ts`, `eval-run.test.ts`, `RunStatusFooter` from Eval UI, Escape-key eval cancellation, and tab-switch guards is comprehensive. No orphaned imports or dead code paths remain in the active Eval UI surface.

2. **Race condition fix is correct.** Event listeners are set up *before* dispatching `send_openhands_message`, eliminating the window where events could arrive before listeners were registered.

3. **Drop impl for TurnListener prevents listener leaks.** If `send_openhands_message` fails, the `TurnListener` is dropped and both listeners are unregistered. This was a high-severity finding in a prior review that was correctly addressed.

4. **Isolated workspace_run_dir for generation.** Changed from workspace root to `.openhands/eval-generate` subdirectory, preventing the generation agent from writing to the workspace root.

5. **DB layer is well-tested.** The `eval_workbench.rs` tests cover save/read, list filtering, update with assertion replacement, delete with cascade, and mode validation.

6. **Generation fails loudly without conversation.** The error message is actionable and matches the pattern used by Workflow.

7. **Contract test asserts removed commands are absent.** The `tauri-command-contract.test.js` explicitly checks that `run_eval_workbench`, `cancel_eval_workbench_run`, `list_eval_runs`, `read_eval_run`, and other stale commands do not appear in the published API docs.

8. **E2E test validates authoring-only UI.** The E2E spec asserts `Evaluate` button count is 0 and `Send to Refine` button count is 0, confirming no run-execution controls are present.

## Verdict

**REQUEST_CHANGES**

One medium-severity finding blocks a clean approval:

- **`repo-map.json` stale entries** (Finding #1) — This violates the pre-PR repo-map audit rule in `AGENTS.md` which states: "Before opening or updating a PR, verify `repo-map.json` reflects the current codebase." The descriptions reference multiple deleted files and modules (`eval-run.ts`, `eval-running-state.ts`, `description/`, `skill/suggestions`, `e2e/description/`). This must be updated before merge.

The remaining medium findings (dead `previousScenarioName` in frontend, missing UNIQUE constraint, silent fallback on partial LLM response) should be addressed or tracked as follow-ups.

## Next Steps

1. **Update `repo-map.json`** — Remove stale references to `eval-run.ts`, `eval-running-state.ts`, `description/` module, `skill/suggestions`, and `e2e/description/`. Update `eval-workbench.ts` description to reflect authoring-only scope.

2. **Remove dead `previousScenarioName` from frontend** — Clean up from `SaveScenarioMutationInput`, `WorkspaceEvalsProps`, `handleSaveScenario`, and the query test. Review whether the old-key cache removal logic in `useSaveScenario` is still needed.

3. **Add UNIQUE constraint** — Add `UNIQUE(plugin_slug, skill_name, name)` to the `scenarios` table via a new migration.

4. **Fail loudly on partial LLM response** — Consider returning an error when `prompt` or `expectations` are missing from the generated scenario response.

5. **Run validation suite** — Confirm `cargo test`, `tsc --noEmit`, `vitest run`, `npm test` (contract tests), and `markdownlint` all pass on the current HEAD.
