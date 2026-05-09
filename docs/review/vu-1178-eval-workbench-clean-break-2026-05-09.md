# Review: VU-1178 Eval Workbench clean break — DB-backed scenario and assertion authoring

- **Branch:** `feature/vu-1178-eval-workbench-clean-break-db-backed-scenario-and-assertion`
- **Review Date:** 2026-05-09
- **Reviewer:** code-reviewer agent

## Intent

Refactor Eval Workbench into an authoring-only surface where scenarios and assertions are stored in SQLite, generation uses the selected-skill OpenHands conversation, and all app-owned eval-run execution concepts are removed. This is a clean-break refactor — not a compatibility migration.

## Scope Comparison

| Source | Claim / Requirement |
|--------|---------------------|
| **Linear Issue (VU-1178)** | 8 acceptance criteria: SQLite-only CRUD, remove YAML/disk-backed CRUD, selected-skill generation, loud failure when no conversation, no run UI, no legacy table references, updated docs/metadata, passing validation |
| **Implementation Plan** | 6 tasks: (1) SQLite as active store, (2) remove eval-owned OpenHands bootstrap, (3) delete eval run runtime/UI leftovers, (4) clean DB migration tests, (5) update docs/repo-map/contracts, (6) validate |
| **Design Doc** | Eval Workbench is authoring-only; SQLite-backed; generation via `send_openhands_message`; no run execution |
| **Functional Spec** | Describes Eval Workbench as part of the evaluate-and-refine loop; references "eval run results" stored in DB — now stale given the clean-break direction |
| **Claim (Commits)** | 4 commits: SQLite scenario store + selected-skill generation, fix race condition in generation listener, remove eval run runtime/UI leftovers, clean DB migration tests + update docs/contracts |

## Acceptance Criteria

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Eval scenario list/detail/create/save/delete read/write SQLite only | **Proven** | `mod.rs` commands delegate exclusively to `crate::db::eval_workbench`; `scenarios.rs` (YAML path) deleted; frontend wrappers call `invokeCommand` to the same commands |
| 2 | Disk-backed YAML scenario CRUD removed from active app code | **Proven** | `scenarios.rs` deleted; `resolve_eval_dir`/`scenario_file_path`/etc. removed from command path; no YAML parsing in active code |
| 3 | Eval generation sends on selected-skill OpenHands conversation only | **Proven** | `generate_eval_scenario_assertions` calls `get_skill_conversation_id` then `send_openhands_message`; no `ensure_openhands_server`, `start_openhands_session`, or `run_throwaway_openhands_session` |
| 4 | Eval generation fails loudly when no active conversation | **Proven** | `get_skill_conversation_id(...).ok_or_else(...)` returns explicit error: "No active OpenHands conversation for skill '{}' in plugin '{}'. Select a skill conversation in Refine first." |
| 5 | No active Eval UI shows run status, run history, Evaluate, or cancellation | **Proven** | `eval-run.ts`, `eval-running-state.ts`, and `eval-run.test.ts` deleted; `app-layout.tsx` Escape handler no longer references eval cancellation; `workspace-shell.tsx` has no eval-running guard; `workspace-evals.tsx` has no `RunStatusFooter` |
| 6 | No active code references legacy eval tables or Promptfoo outside migrations | **Proven** | `rg` confirms zero references to `eval_runs`, `eval_run_results`, `description_candidates`, `eval_prompt_sets`, `eval_prompt_cases`, or `promptfoo-sidecar` in active `.rs`/`.ts`/`.tsx` files |
| 7 | Docs, backend API docs, repo-map, test-map describe clean-break model | **Proven** | `api.md` lists only 6 active Eval commands; `eval-workbench/README.md` rewritten for SQLite model; contract test asserts removed commands are absent; `TEST_MAP.md` has no promptfoo-sidecar entries |
| 8 | Targeted validation passes or has documented unrelated blockers | **Proven** | Rust eval_workbench tests: 8/8 pass; frontend eval tests: 5/5 pass; tsc: clean; markdownlint: clean. One pre-existing contract-test failure (`start_refine_session`/`close_refine_session` in `vu1140Commands` list but removed from typed commands) — unrelated to this branch |

## Findings

### High

_No high-severity findings._

### Medium

1. **[Skeptic] Dead code: `resolve_eval_dir` in `skill_paths.rs` is orphaned**
   - `app/src-tauri/src/skill_paths.rs` still defines `pub fn resolve_eval_dir(...)` with its own unit tests, but it is no longer imported or called by any active command path. The implementation plan's Task 1 explicitly lists removing `resolve_eval_dir` from the active Eval command path. The function was removed from `scenarios.rs` (which was deleted), but the definition in `skill_paths.rs` remains as dead code.
   - **Recommendation:** Delete `resolve_eval_dir` and its tests from `skill_paths.rs` to complete the clean break.

2. **[Skeptic] Pre-existing contract test failure — stale `vu1140Commands` list**
   - `tests/evals/assertions/tauri-command-contract.test.js` line 14-36 lists `start_refine_session` and `close_refine_session` in `vu1140Commands`, but these commands no longer exist in `tauri-command-types.ts` or `tauri.ts`. The test fails with: `missingTypedUsage: ['start_refine_session', 'close_refine_session']`.
   - This is not caused by this branch (those commands were removed in a prior change), but it blocks the Task 6 validation checklist. It should be fixed before merge or documented as a known pre-existing blocker.
   - **Recommendation:** Remove `start_refine_session` and `close_refine_session` from the `vu1140Commands` array in the contract test.

3. **[Architect] `save_scenario` command accepts but ignores `_previous_scenario_name`**
   - `mod.rs:336` — the `save_scenario` Tauri command takes `previous_scenario_name: Option<String>` but prefixes it with `_`, meaning it is unused. The rename semantics (removing old cache entries) are handled entirely on the frontend via the mutation's `onSuccess` callback using the same parameter.
   - This is not a bug — the backend doesn't need the old name because it upserts by `id`. But the parameter exists purely as a frontend-to-frontend cache coordination signal that travels through the Tauri layer unnecessarily.
   - **Recommendation:** Consider removing `previous_scenario_name` from the Tauri command signature and passing it only through the frontend mutation context. Alternatively, leave it as-is if the round-trip cost is negligible and the parameter serves as documentation.

### Low

1. **[Minimalist] `workspace_run_dir` duplicates `workspace_root_dir` in generation config**
   - `mod.rs:421-422` — both `workspace_root_dir` and `workspace_run_dir` are set to `runtime_ctx.workspace_path.clone()`. For eval generation (read-only skill context + message dispatch), a separate run directory is unused. Not harmful, but adds noise.
   - **Recommendation:** If `build_openhands_runtime_config` tolerates `workspace_run_dir` being empty or omitted, pass only `workspace_root_dir`. Otherwise, leave as-is.

2. **[Minimalist] `clean_openhands_structured_result_text` only strips leading fence**
   - `mod.rs:121-126` — the function strips ` ```json ` and ` ``` ` from the start and ` ``` ` from the end. If the agent returns fenced code with a trailing newline before the closing fence (common), the `.trim()` handles it. But if the agent returns multi-line content with internal fences, only the outer ones are stripped. This is acceptable given the output-format schema constrains the response to JSON, but worth noting.
   - **Recommendation:** No action needed unless generation parsing failures are observed in practice.

3. **[Skeptic] 90-second generation timeout is a hard limit with no user-facing progress**
   - `mod.rs:243` — `wait_for_turn_result` uses a fixed 90-second timeout. For complex skill contexts, this may be tight. On timeout, the session is paused and an error is returned, but the user sees only "OpenHands generation timed out" with no retry affordance.
   - **Recommendation:** Not a blocker for this clean-break scope, but consider making the timeout configurable or surfacing a retry button in the UI when generation times out.

## What Went Well

1. **Clean deletion discipline.** The branch correctly removes `scenarios.rs`, `eval-run.ts`, `eval-running-state.ts`, and their tests without leaving dangling imports or broken references. The diff is net-negative (−1,374 lines vs +1,230), which is the right shape for a clean-break refactor.

2. **Generation command is well-structured.** `generate_eval_scenario_assertions` correctly acquires the conversation ID before dispatching, builds a complete prompt with skill files/clarifications/decisions, sets up event listeners before sending (avoiding the race condition called out in commit `ec805f72`), and persists results back to SQLite in the same command.

3. **Frontend cache invalidation is correct.** The `useGenerateEvalScenarioAssertions` and `useSaveScenario` mutations properly invalidate list queries, remove stale detail entries, and set fresh detail data — including the rename case where the scenario name changes.

## Verdict

**APPROVE** — with two medium-severity items to address before or immediately after merge.

All 8 acceptance criteria are proven by code evidence. The Rust and frontend test suites pass. TypeScript typecheck and markdownlint are clean. The one failing contract test is a pre-existing issue unrelated to this branch's changes.

## Next Steps

1. **Delete `resolve_eval_dir` from `skill_paths.rs`** — it is dead code after the YAML scenario path removal. Remove the function and its unit tests.

2. **Fix the pre-existing contract test** — remove `start_refine_session` and `close_refine_session` from `vu1140Commands` in `tests/evals/assertions/tauri-command-contract.test.js` so the Task 6 validation checklist passes cleanly.

3. (Optional) **Consider removing `_previous_scenario_name` from the `save_scenario` Tauri command** if the round-trip through the backend is deemed wasteful for a frontend-only cache coordination signal.
