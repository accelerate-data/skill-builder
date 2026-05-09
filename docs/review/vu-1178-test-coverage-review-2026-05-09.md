# Test Coverage Review: VU-1178 — Eval Workbench clean break

- **Branch:** `feature/vu-1178-eval-workbench-clean-break-db-backed-scenario-and-assertion`
- **PR:** #586
- **Review Date:** 2026-05-09
- **Reviewer:** code-reviewer agent

## Summary

This branch refactors Eval Workbench from a disk-backed (YAML files) + throwaway-OpenHands-runtime model to a SQLite-backed authoring-only surface that uses the selected-skill conversation for scenario/assertion generation. It removes 42 files worth of eval-run execution code, deletes the `scenarios.rs` disk-CRUD module, and rewrites the generation flow to use `send_openhands_message` + event listeners instead of `run_throwaway_openhands_session`.

**Change set:** 43 files changed, +1,315 / −1,421 lines. 9 commits, rebased onto main.

## Test Results

| Suite | Result |
|-------|--------|
| Rust (`cargo test`) | **1083 passed, 0 failed** |
| Frontend eval-workbench tests | **26 passed, 0 failed** (4 files) |
| Full frontend suite | 43 failures — **all pre-existing**, unrelated to this branch (skill-dialog, skill-list-panel, toast-lifecycle) |

## Coverage Map

### Rust Production Files

| Changed File | Test Coverage | Status |
|---|---|---|
| `commands/eval_workbench/mod.rs` (rewritten, −490/+340 lines) | Inline `#[cfg(test)]` module: 3 new tests (`validate_plugin_slug_*`). Old `define_eval_scenario_uses_throwaway_runtime_path` test removed. | **Partial** — command-level logic has no direct tests |
| `commands/eval_workbench/types.rs` (+4 fields) | No dedicated tests; covered indirectly by `eval-workbench-tauri.test.ts` DTO assertions | **Covered indirectly** |
| `commands/eval_workbench/scenarios.rs` (deleted, 331 lines) | N/A — module removed | ✅ |
| `db/eval_workbench.rs` (`#![allow(dead_code)]` removed) | Inline `#[cfg(test)]` module: 5 tests — `saves_and_reads_scenario`, `lists_scenarios_for_skill`, `updates_scenario_replacing_assertions`, `deletes_scenario_cascading_assertions`, `saves_performance_scenario_without_trigger_metadata` | **Good** |
| `db/tests.rs` (−84 lines) | N/A — old migration/skill tests removed; remaining tests still pass | ✅ |
| `skill_paths.rs` (removed `resolve_eval_dir` + 2 tests) | N/A — function removed; remaining tests pass | ✅ |
| `lib.rs` (command rename) | Covered by `tauri-command-contract.test.js` | ✅ |

### Frontend Production Files

| Changed File | Test Coverage | Status |
|---|---|---|
| `lib/eval-workbench.ts` (added `pluginSlug`/`skillName` to types, renamed `defineEvalScenario` → `generateEvalScenarioAssertions`, updated `createDraftScenario`/`scenarioToDraft`/`normalizeScenario`) | `eval-workbench-tauri.test.ts` updated for new command names and DTO fields | **Good** |
| `lib/eval-run.ts` (deleted, 42 lines) | `eval-run.test.ts` (deleted, 85 lines) — both removed together | ✅ |
| `lib/eval-running-state.ts` (deleted, 33 lines) | N/A — module removed | ✅ |
| `lib/queries/eval-scenarios.ts` (renamed hook, updated mutation input type) | `eval-scenarios.test.tsx` updated for new DTO shape | **Good** |
| `lib/tauri-command-types.ts` (command rename) | `tauri-command-contract.test.js` updated | ✅ |
| `components/layout/app-layout.tsx` (removed eval-running-state imports and guards) | `app-layout.test.tsx` — removed eval-cancellation test (29 lines) | ✅ |
| `components/workspace/workspace-shell.tsx` (removed eval-running-state imports, `workbenchRunningRef`, cancellation logic) | `workspace-shell.test.tsx` — mock updated for renamed hook | **Good** |
| `components/workspace/workspace-eval-workbench.tsx` (renamed handler, removed `onRunningChange` prop) | No dedicated component test; covered by E2E | **Partial** |
| `components/workspace/workspace-evals.tsx` (renamed props, removed `RunStatusFooter`, inline draft initialization with `pluginSlug`/`skillName`) | No dedicated component test; covered by E2E | **Partial** |
| `components/eval-workbench/prompt-set-editor.tsx` (renamed `onSuggest`→`onGenerate`, removed `showNew`/`onNew` props) | No dedicated component test | **Gap** |

### E2E / Contract Tests

| Changed File | Status |
|---|---|
| `e2e/evals/evals.spec.ts` | Updated for new command names and button text. **Good** |
| `tests/evals/assertions/tauri-command-contract.test.js` | Updated to assert `generate_eval_scenario_assertions` is present and `define_eval_scenario` is absent. Added assertions for `run_eval_workbench`, `cancel_eval_workbench_run`, `list_eval_runs`, `read_eval_run`, `promptfoo-sidecar` being absent. **Good** |
| `runtime-api-contract.test.ts` | Updated for renamed prop. **Good** |

## Gaps and Risks

### High

1. **[Skeptic] Generation command path has no unit tests**
   - `generate_eval_scenario_assertions` (~130 lines) is the most complex new function on the branch. It orchestrates: DB reads, conversation ID lookup, skill file loading, prompt building, sidecar config construction, event listener setup, OpenHands message dispatch, result waiting with timeout, response parsing, and DB save.
   - The old `define_eval_scenario` had a test (`define_eval_scenario_uses_throwaway_runtime_path`) that verified the throwaway runtime path. The new function has zero tests.
   - **Risk:** A regression in the generation flow (wrong conversation ID lookup, missing error when no conversation exists, incorrect prompt assembly, listener race condition) would only be caught by E2E.
   - **Recommendation:** Add at least one unit test for `parse_generated_scenario_response` (pure function) and one integration-style test for the happy path of `generate_eval_scenario_assertions` with mocked dependencies.

2. **[Skeptic] `parse_terminal_state` (inside `setup_turn_listeners`) has no test coverage**
   - This nested function parses `agent-message` event payloads, filters by `agent_id`, checks `message.type === "conversation_state"`, and maps `status` values (`completed` → `Ok`, `error`/`cancelled` → `Err`, other → `None`).
   - **Risk:** Incorrect parsing of OpenHands terminal states would silently fail or produce wrong errors.
   - **Recommendation:** Extract `parse_terminal_state` to module-level and add tests for each status variant and edge cases (missing fields, wrong agent_id, malformed JSON).

3. **[Architect] `previous_scenario_name` is dead code across the full stack**
   - Rust: `_previous_scenario_name` (underscored, ignored)
   - Frontend: `SaveScenarioMutationInput.previousScenarioName` still typed and passed through `eval-scenarios.ts` → `eval-workbench.ts` → Tauri invoke
   - The parameter was meaningful when scenarios were file-backed (rename detection). In the SQLite model, the scenario is identified by `id` and the `ON CONFLICT(id)` upsert handles updates.
   - **Risk:** Low functional risk (harmless passthrough), but it's misleading for future maintainers.
   - **Recommendation:** Remove `previousScenarioName` from the frontend type chain in a follow-up.

### Medium

4. **[Minimalist] `save_scenario` hardcodes `sort_order = 0i64`**
   - Every scenario gets `sort_order = 0`, so ordering falls back to `name ASC`. This is fine for now but the `sort_order` column and `ORDER BY sort_order ASC, name ASC` query suggest future custom ordering intent.
   - **Risk:** If custom ordering is added later, existing scenarios will all have `sort_order = 0` and need a migration.
   - **Recommendation:** Acceptable for this scope; document the intent.

5. **[Skeptic] `createDraftScenario` signature change is not tested**
   - `createDraftScenario` now requires `(pluginSlug, skillName, name?)` instead of `(name?)`. The inline fallback in `workspace-evals.tsx` duplicates this logic with a `crypto.randomUUID()` call.
   - **Risk:** If the inline draft initialization diverges from `createDraftScenario`, new scenarios could be created with missing fields.
   - **Recommendation:** Add a test for `createDraftScenario` with the new signature, or refactor `workspace-evals.tsx` to use `createDraftScenario` directly.

6. **[Skeptic] `workspace-evals.tsx` inline draft initialization duplicates `createDraftScenario` logic**
   - The `useState` initializer and the `scenario` effect both construct a draft object inline with `crypto.randomUUID()`, `pluginSlug`, `skillName`, etc. This duplicates `createDraftScenario` and `scenarioToDraft`.
   - **Risk:** Drift between inline logic and helper functions.
   - **Recommendation:** Use `createDraftScenario(pluginSlug, skillName)` and `scenarioToDraft(scenario)` directly.

### Low

7. **[Minimalist] `PromptSetEditor` has no dedicated component test**
   - The editor component received significant prop renaming (`onSuggest`→`onGenerate`, `showNew` removed, button text changed). No unit test verifies the rendered output.
   - **Risk:** Low — covered by E2E test that clicks the generate button.
   - **Recommendation:** Add a snapshot or rendering test if this component continues to evolve.

8. **[Skeptic] `EvalWorkbenchMode::parse` only accepts `"performance"`**
   - Any other mode string returns an error. This is correct per the current spec, but the error message `"mode must be 'performance'"` is slightly confusing if an empty string is passed.
   - **Risk:** Minimal — the frontend only sends `"performance"`.
   - **Recommendation:** No action needed for this scope.

## What Went Well

1. **SQLite CRUD is well-tested.** The `db/eval_workbench.rs` module has 5 focused tests covering save, read, list, update (with assertion replacement), and delete (with cascade verification). Foreign key cascade is confirmed by `create_test_db_for_tests` enabling `PRAGMA foreign_keys = ON`.

2. **Deletions are clean.** Removed files (`eval-run.ts`, `eval-running-state.ts`, `scenarios.rs`) had their corresponding tests removed in the same commits. No orphaned test references remain.

3. **Contract tests are comprehensive.** The `tauri-command-contract.test.js` now explicitly asserts that legacy commands (`run_eval_workbench`, `cancel_eval_workbench_run`, `list_eval_runs`, `read_eval_run`, `define_eval_scenario`, `promptfoo-sidecar`) are absent from the published API.

## Verdict

**REQUEST_CHANGES**

The branch is structurally sound and the deletion/refactor is thorough. However, the generation command path (`generate_eval_scenario_assertions`) — the most complex new function — has zero unit test coverage. The `parse_terminal_state` event parser is also untested. These are the highest-risk areas because they involve async event handling, OpenHands integration, and JSON parsing of LLM responses.

The dead `previous_scenario_name` parameter and duplicated draft initialization logic are lower-priority but should be cleaned up.

## Next Steps

1. **Required before merge:**
   - Add unit tests for `parse_generated_scenario_response` (pure function, easy to test with various JSON payloads including missing fields, wrong types, and valid responses).
   - Extract and test `parse_terminal_state` for each status variant (`completed`, `error`, `cancelled`, unknown, missing fields, wrong agent_id, malformed JSON).

2. **Recommended follow-ups:**
   - Remove `previousScenarioName` from the frontend type chain (`SaveScenarioMutationInput`, `saveScenario` wrapper, `handleSaveScenario`).
   - Refactor `workspace-evals.tsx` to use `createDraftScenario` and `scenarioToDraft` instead of inline draft construction.
   - Add a component test for `PromptSetEditor` if further UI changes are planned.
