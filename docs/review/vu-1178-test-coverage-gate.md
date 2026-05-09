# VU-1178 Test Coverage Gate

**Date:** 2026-05-09
**Branch:** `feature/vu-1178-eval-workbench-clean-break-db-backed-scenario-and-assertion`
**Reviewer:** Automated test coverage analysis

## Summary

**Overall assessment: GOOD — with a few specific gaps.**

Both test suites pass:
- Frontend: **603 passed** (5 skipped) across 53 test files
- Rust: **1083 passed** across the lib test suite

The DB-backed scenario/assertion authoring surface has solid coverage at the DB layer, command layer, and frontend component layer. The scenarios migration from the old `eval_prompt_sets`/`eval_prompt_cases` schema is tested. However, several edge cases and integration paths are not covered.

---

## Coverage by Layer

### 1. Rust DB Layer (`app/src-tauri/src/db/eval_workbench.rs`)

**Tests:** `app/src-tauri/src/db/eval_workbench.rs` — `mod tests` (5 tests)

| Test | Covers |
|---|---|
| `saves_and_reads_scenario` | Basic CRUD: insert + read round-trip |
| `lists_scenarios_for_skill` | Filtering by plugin_slug + skill_name |
| `updates_scenario_replacing_assertions` | UPSERT: old assertions deleted, new ones inserted |
| `deletes_scenario_cascading_assertions` | Cascade delete of assertions |
| `saves_performance_scenario_without_trigger_metadata` | Mode validation |

**Gaps:**
- **No test for duplicate scenario name** — The `scenarios` table has no UNIQUE constraint on `(plugin_slug, skill_name, name)`. Two scenarios with the same name in the same skill/plugin can be created. The `create_scenario` command has an application-level loop to avoid duplicates, but the DB layer itself doesn't enforce uniqueness.
- **No test for empty assertions array** — `save_scenario` with `assertions: vec![]` should succeed (valid for a draft scenario), but this isn't explicitly tested.
- **No test for very long prompt/assertion text** — SQLite TEXT columns have no explicit length limits, but no boundary test exists.
- **No test for `EvalWorkbenchMode::parse` with invalid input** — The `parse` function rejects anything other than `"performance"`, but there's no unit test for the error path.

### 2. Rust Command Layer (`app/src-tauri/src/commands/eval_workbench/mod.rs`)

**Tests:** `mod tests` (3 tests)

| Test | Covers |
|---|---|
| `validate_plugin_slug_rejects_empty` | Empty slug rejection |
| `validate_plugin_slug_rejects_path_traversal` | Path traversal rejection |
| `validate_plugin_slug_accepts_valid` | Valid slug acceptance |

**Gaps:**
- **No tests for `scenario_from_dto`** — The DTO-to-domain conversion, including `EvalWorkbenchMode::parse` which can fail on invalid tags.
- **No tests for `scenario_to_dto` / `scenario_summary_to_dto`** — Serialization round-trip not tested.
- **No tests for `build_generate_scenario_prompt`** — Prompt template assembly with skill files, clarifications, and decisions.
- **No tests for `parse_openhands_structured_output`** — JSON parsing of OpenHands responses.
- **No tests for `clean_openhands_structured_result_text`** — Markdown fence stripping logic.
- **No tests for `parse_generated_scenario_response`** — Parsing the AI-generated scenario JSON, including fallback to existing values when fields are missing.
- **No tests for `setup_turn_listeners` / `wait_for_turn_result`** — Event listener setup and timeout behavior.
- **No integration tests for the full `generate_eval_scenario_assertions` command** — This is the most complex command (OpenHands session, timeout, parsing, DB save). It's only tested indirectly through the E2E test.

### 3. Frontend: `eval-workbench.ts` (utility functions)

**Tests:** None directly. The functions are tested indirectly through component tests and the Tauri wrapper test.

**Gaps:**
- **`scenarioNameSlug`** — No unit tests for the slug generation function.
- **`createDraftScenario`** — No unit tests.
- **`scenarioToDraft`** — No unit tests.
- **`normalizeScenario`** — No unit tests. Edge cases: empty name, whitespace-only assertions, missing tags.
- **`validateScenario`** — No unit tests.
- **`validateScenarioForEvaluation`** — No unit tests. Critical for preventing submission of incomplete scenarios.
- **`areScenariosEqual`** — No unit tests. Important for dirty-state detection.
- **`getErrorMessage`** — No unit tests.

### 4. Frontend: `queries/eval-scenarios.ts` (TanStack Query hooks)

**Tests:** `app/src/__tests__/lib/queries/eval-scenarios.test.tsx` (1 test)

| Test | Covers |
|---|---|
| `stores renamed scenario detail under the new key` | Cache invalidation on rename |

**Gaps:**
- **`useScenarios`** — No test for the list query (enabled/disabled behavior, error state).
- **`useScenario`** — No test for the detail query.
- **`useCreateScenario`** — No test for the create mutation.
- **`useGenerateEvalScenarioAssertions`** — No test for the generate mutation.
- **`useDeleteScenario`** — No test for the delete mutation.
- **`useSaveScenario` onError** — No test for mutation error handling.

### 5. Frontend: `WorkspaceEvals` component

**Tests:** `app/src/__tests__/components/workspace/workspace-evals.test.tsx` (4 tests)

| Test | Covers |
|---|---|
| `renders scenario list and detail` | Basic rendering |
| `allows editing and saving a scenario` | Edit + save flow |
| `calls onStartNewScenario when creating new` | Empty state creation |
| `shows no scenarios message when hasScenarios is false` | Empty state display |

**Gaps:**
- **Generate assertions flow** — No test for clicking "Generate scenario and assertions" button, the busy state, or error handling.
- **Delete scenario flow** — No test for delete button click, confirmation, or error handling.
- **Dirty state detection** — No test for the save button appearing only when the draft differs from the persisted scenario.
- **Error display** — No test for `actionError` state rendering.
- **Draft reset when scenario prop changes** — The `useEffect` that resets draft when `scenario` changes is not tested.

### 6. Frontend: `WorkspaceEvalWorkbench` component

**Tests:** Tested indirectly through `workspace-shell.test.tsx`.

**Gaps:**
- **Scenario selection/deselection** — The toggle logic (click same scenario to deselect) is not directly tested.
- **Deleted scenario cleanup** — When a selected scenario is deleted from the list, the `useEffect` should clear `selectedScenarioName`. Not directly tested.
- **Error state for scenarios query** — The retry button and error banner rendering not tested.

### 7. Frontend: `PromptSetEditor` component

**Tests:** None directly. Tested indirectly through `workspace-evals.test.tsx`.

**Gaps:**
- **Assertion add/remove** — No test for adding a new assertion or removing an existing one.
- **Generate button disabled state** — No test for `generateDisabled` prop behavior.
- **Delete button visibility** — No test for `showDelete` prop behavior.
- **Footer status rendering** — No test for `footerStatus` with "error" and "running" tones.

### 8. Tauri Command Types (`tauri-command-types.ts`)

**Tests:** `app/src/__tests__/lib/tauri.test.ts` (wrapper contract tests)

**Gap:** The eval workbench commands (`list_scenarios`, `load_scenario`, `create_scenario`, `save_scenario`, `delete_scenario`, `generate_eval_scenario_assertions`) are **NOT** included in the `it.each` wrapper contract test suite. They are tested in `eval-workbench-tauri.test.ts` separately, but the typed contract pattern isn't applied.

### 9. Bug Found: Test signature mismatch

In `app/src/__tests__/lib/eval-workbench-tauri.test.ts`, the `saveScenario` test passes **4 arguments**:

```typescript
await saveScenario("skills", "forecast-skill", { ... }, "Old regression");
```

But the actual `saveScenario` function only accepts **3 arguments**:

```typescript
export const saveScenario = (pluginSlug, skillName, scenario) => ...
```

The 4th argument (`"Old regression"`) is silently ignored by JavaScript. This is not a runtime bug (the test still passes because it only checks the mock call), but it indicates the test was written against an old API signature and was never updated. The `previousScenarioName` concept belongs at the mutation layer (`useSaveScenario`), not the Tauri invoke layer.

### 10. Deleted Files — Orphaned Tests?

- `app/src/lib/eval-run.ts` — **deleted**. No corresponding test file existed or was removed.
- `app/src/lib/eval-running-state.ts` — **deleted**. No corresponding test file existed or was removed.
- `app/src-tauri/src/commands/eval_workbench/scenarios.rs` — **deleted** (merged into `mod.rs`). Tests moved accordingly.

These deletions are clean — no orphaned test files remain.

---

## Risk Assessment

| Risk | Severity | Likelihood | Mitigation |
|---|---|---|---|
| Duplicate scenario names in DB | Medium | Low | App-level dedup in `create_scenario` works, but DB has no UNIQUE constraint |
| `generate_eval_scenario_assertions` command failure modes | Medium | Medium | No unit tests for OpenHands response parsing, timeout, or error paths |
| Validation functions untested | Low | Low | `validateScenario` and `validateScenarioForEvaluation` are simple but untested |
| `areScenariosEqual` dirty detection bugs | Low | Medium | Critical for preventing unnecessary saves; no unit tests |
| Query hooks error handling untested | Low | Low | TanStack Query patterns are well-established; error paths not explicitly tested |

---

## Recommended Actions

### High Priority
1. **Add `EvalWorkbenchMode::parse` error test** — One-liner test for invalid mode string.
2. **Add `validateScenarioForEvaluation` tests** — 3-4 tests for empty prompt, empty assertions, valid scenario.
3. **Add `areScenariosEqual` tests** — Test null/null, null/object, object/object, deep equality.

### Medium Priority
4. **Fix the `saveScenario` test signature** — Remove the spurious 4th argument in `eval-workbench-tauri.test.ts`.
5. **Add `generate_eval_scenario_assertions` parsing tests** — Test `parse_generated_scenario_response` with valid JSON, missing fields, malformed JSON.
6. **Add `PromptSetEditor` assertion add/remove tests** — Simple interaction tests.

### Low Priority
7. **Add UNIQUE constraint test for scenarios** — Or add a UNIQUE constraint to the DB schema.
8. **Add eval workbench commands to Tauri wrapper contract test** — Consistency with other commands.
9. **Add `useScenarios`/`useScenario` query tests** — Enabled/disabled behavior.

---

## Verdict

**PASS with reservations.** The core DB operations, migrations, and component rendering are well-tested. The main gap is in the AI-assisted generation path (`generate_eval_scenario_assertions`) which has no unit-level tests for its parsing and error-handling logic, and the utility functions in `eval-workbench.ts` which are entirely untested at the unit level. These are not blockers for merge but should be addressed in follow-up work.
