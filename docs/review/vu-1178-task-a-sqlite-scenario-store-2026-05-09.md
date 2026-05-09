# Review: VU-1178 Task A (SQLite-backed scenario store + selected-skill generation)

- **Branch:** `feature/vu-1178-eval-workbench-clean-break-db-backed-scenario-and-assertion`
- **Base:** `a1852267`
- **Head:** `a3dd4729`
- **Review Date:** 2026-05-09
- **Reviewer:** code-reviewer agent

## Intent

Replace YAML file-backed Eval Workbench scenario CRUD with SQLite-backed storage via `db::eval_workbench`, and replace throwaway OpenHands session generation with `send_openhands_message` on the selected-skill conversation. Rename `defineEvalScenario` → `generateEvalScenarioAssertions` and update UI copy.

## Scope Comparison

| Source | Claim / Requirement |
|--------|---------------------|
| **Plan Task 1** | Replace all 5 scenario CRUD commands to use `crate::db::eval_workbench` exclusively; delete `scenarios.rs`; remove `#![allow(dead_code)]`; key by stable `id`; update frontend tests |
| **Plan Task 2** | Delete `build_generation_sidecar_config` and `run_define_eval_scenario_throwaway_turn`; replace with `generate_eval_scenario_assertions`; look up conversation via `get_skill_conversation_id`; fail loudly if missing; dispatch with `send_openhands_message`; add `wait_for_openhands_turn_result` helper; persist to SQLite; rename frontend wrapper and UI copy |
| **Linear AC** | SQLite-only CRUD; no YAML in active path; generation uses selected-skill conversation; fails loudly without conversation; validation commands pass |
| **Implemented** | All 5 CRUD commands use DB; `scenarios.rs` deleted; `#![allow(dead_code)]` removed; `generate_eval_scenario_assertions` uses `send_openhands_message` + `wait_for_openhands_turn_result`; conversation lookup with loud failure; frontend renamed; UI copy updated |

## Acceptance Criteria

| Criterion | Status | Evidence |
|-----------|--------|----------|
| Eval scenario CRUD reads/writes SQLite only | **Proven** | `list_scenarios`, `load_scenario`, `create_scenario`, `save_scenario`, `delete_scenario` all call `eval_workbench::*` functions (mod.rs:242–332) |
| Disk-backed YAML CRUD removed from active path | **Proven** | `scenarios.rs` deleted; zero `scenarios::` references remain in active code; `mod.rs` no longer imports it |
| Generation uses selected-skill conversation only | **Proven** | `generate_eval_scenario_assertions` calls `get_skill_conversation_id` then `send_openhands_message` with `SendExistingOnly` dispatch (mod.rs:353, 411) |
| Generation fails loudly without active conversation | **Proven** | `ok_or_else` with explicit error message at mod.rs:354–358 |
| `#![allow(dead_code)]` removed from `db/eval_workbench.rs` | **Proven** | File no longer contains the attribute |
| Frontend tests assert DB-backed contracts | **Proven** | Test descriptions updated ("DB-backed scenarios"), DTO payloads include `pluginSlug`/`skillName` |
| `build_generation_sidecar_config` deleted | **Proven** | Zero references in codebase |
| `run_define_eval_scenario_throwaway_turn` deleted | **Proven** | Zero references in codebase |
| `wait_for_openhands_turn_result` helper added | **Proven** | mod.rs:158–239 |
| UI copy renamed from Suggest → Generate | **Proven** | prompt-set-editor.tsx:77 |

## Findings

### Important (Should Fix)

1. **[Architect] Race condition: listeners registered after `send_openhands_message` dispatch**
   - **File:** `app/src-tauri/src/commands/eval_workbench/mod.rs:411–414`
   - **What's wrong:** `send_openhands_message` is called at line 411, which spawns the agent task via `tokio::spawn` (confirmed in `openhands_server/mod.rs:1217–1245`). The task begins executing immediately and can emit `agent-message` / `agent-exit` events. `wait_for_openhands_turn_result` is called at line 413–414, which sets up the listeners *after* the agent has already started.
   - **Why it matters:** If the agent completes quickly (e.g., the prompt is simple, the model is fast, or the server is under low load), the terminal `conversation_state` event could fire before the listeners are registered. The result: `wait_for_openhands_turn_result` waits for the full 90-second timeout, then times out and calls `pause_openhands_session`. The generation "succeeds" on the agent side but the command returns a timeout error to the user. This is a latent bug that will surface intermittently under fast-model or low-latency conditions.
   - **How to fix:** Set up the listeners *before* calling `send_openhands_message`. Refactor `wait_for_openhands_turn_result` to return the listener handles and channel receiver, then call `send_openhands_message`, then await the receiver. Alternatively, restructure so the listener setup and dispatch happen in the correct order within `generate_eval_scenario_assertions`.

2. **[Architect] `wait_for_openhands_turn_result` silently swallows parse errors in `agent-message` handler**
   - **File:** `app/src-tauri/src/commands/eval_workbench/mod.rs:169`
   - **What's wrong:** `serde_json::from_str::<serde_json::Value>(payload).ok()?` silently returns `None` for any malformed JSON in the `agent-message` event payload. This means parse errors from the target agent (or noise from other agents) are dropped without logging.
   - **Why it matters:** If the agent emits a malformed `conversation_state` event (e.g., truncated JSON due to a bug in the agent server), the listener will silently ignore it and the caller will timeout after 90 seconds with no diagnostic information. A `log::warn!` or `eprintln!` on parse failure would make debugging significantly easier.
   - **How to fix:** Add a `log::warn!("Failed to parse agent-message payload: {}", e)` branch when `serde_json::from_str` fails for the target agent_id.

3. **[Architect] `delete_scenario` relies entirely on SQLite FK cascade for assertion cleanup**
   - **File:** `app/src-tauri/src/db/eval_workbench.rs:218–232`
   - **What's wrong:** `delete_scenario` only executes `DELETE FROM scenarios ...`. Assertions are cleaned up solely by the `ON DELETE CASCADE` foreign key constraint defined in migration 48. There is no explicit `DELETE FROM assertions WHERE scenario_id = ...` in the transaction.
   - **Why it matters:** While foreign keys are currently enabled after migrations (confirmed in `db/mod.rs:48`), cascade behavior depends on a runtime pragma that could be accidentally disabled in future refactoring or test setup. The existing test `deletes_scenario_cascading_assertions` passes, but it relies on the test DB also having FK enabled. An explicit delete within the transaction would make the cascade intent self-documenting and resilient to pragma changes.
   - **How to fix:** Add `tx.execute("DELETE FROM assertions WHERE scenario_id IN (SELECT id FROM scenarios WHERE ...)", ...)` before deleting the scenario row, or at minimum add a comment in the function documenting the FK cascade dependency.

4. **[Architect] `save_scenario` resets `sort_order` to 0 on every update**
   - **File:** `app/src-tauri/src/db/eval_workbench.rs:80`
   - **What's wrong:** The `SaveScenario` struct has no `sort_order` field, so every INSERT/UPDATE hardcodes `sort_order = 0`. The `ON CONFLICT DO UPDATE` clause also sets `sort_order = excluded.sort_order`, which is always 0.
   - **Why it matters:** If sort ordering is ever needed (e.g., user reordering scenarios), the current schema and API make it impossible without a migration. For now, all scenarios sort by name (the secondary sort key), which is acceptable. But this is a latent limitation that should be documented or addressed before sort ordering becomes a requirement.
   - **How to fix:** Either add `sort_order` to `SaveScenario` and pass it through, or add a comment noting that sort_order is intentionally fixed at 0 and ordering is by name.

### Minor (Nice to Have)

1. **[Minimalist] `scenario_summary_to_dto` has duplicated struct fields**
   - **File:** `app/src-tauri/src/commands/eval_workbench/mod.rs:63–69`
   - `id`, `plugin_slug`, and `skill_name` appear twice in the struct literal (lines 64–66 and 68–69). This looks like a copy-paste artifact. The first set is correct; the second set (lines 68–69) is redundant and will cause a compile error if the struct doesn't allow duplicate field names. Wait — actually, looking more carefully, lines 64–66 set `id`, `plugin_slug`, `skill_name` and lines 68–69 set `name` and `tags`. Let me re-read...

   Actually, re-reading:
   ```rust
   ScenarioSummaryDto {
       id: scenario.id,           // line 64
       plugin_slug: scenario.plugin_slug,  // line 65
       skill_name: scenario.skill_name,    // line 66
       name: scenario.name,       // line 67
       tags: vec![scenario.mode.as_str().to_string()],  // line 68
   }
   ```
   This is fine — no duplicates. My initial read was confused by the diff context. Retracting this finding.

2. **[Minimalist] `as ScenarioDto` cast bypasses type checking in frontend**
   - **File:** `app/src/lib/queries/eval-scenarios.ts:111`
   - `generateEvalScenarioAssertions(pluginSlug, skillName!, scenarioName) as Promise<ScenarioDto>` uses a TypeScript `as` cast. Since the backend returns `ScenarioDto`, this is safe in practice, but a proper type on the Tauri invoke would be more robust.

3. **[Minimalist] `generated_scenario_output_format` requests `name` but caller ignores it**
   - **File:** `app/src-tauri/src/commands/eval_workbench/mod.rs:436–449`
   - The output format JSON requires `name` in the agent response, but `parse_generated_scenario_response` (mod.rs:128–156) never reads the `name` field — it preserves the existing scenario name. This is correct behavior (the scenario name shouldn't change), but the output format could omit `name` from `required` to avoid confusing the agent.

## What Went Well

1. **Clean deletion of YAML path.** The `scenarios.rs` file (331 lines) was fully removed with no orphaned references. All `scenarios::` imports, `build_generation_sidecar_config`, and `run_define_eval_scenario_throwaway_turn` are gone from the active Eval path. The diff is net -374 lines, which is a healthy sign of simplification.

2. **Proper conversation lookup with loud failure.** The `generate_eval_scenario_assertions` command correctly calls `get_skill_conversation_id` and returns a clear, actionable error message when no conversation exists: "No active OpenHands conversation for skill 'X' in plugin 'Y'. Select a skill conversation in Refine first." This matches the pattern Workflow uses and gives users a clear recovery path.

3. **Test coverage tracks the rename.** Frontend tests were updated to reflect the new naming (`useGenerateEvalScenarioAssertions`, `generateEvalScenarioAssertions`), and E2E tests were updated to click the new button text and track the new command name. The test updates are mechanical but thorough.

## Verdict

**REQUEST_CHANGES**

The race condition between `send_openhands_message` dispatch and listener registration (Finding #1) is a real correctness bug that will cause intermittent timeout failures. The agent task is spawned asynchronously and can emit terminal events before the listeners are wired up. This must be fixed before merging.

The other findings (silent parse error swallowing, implicit FK cascade dependency) are important for robustness but not blocking.

## Next Steps

1. **Fix the race condition:** Restructure `generate_eval_scenario_assertions` so that `wait_for_openhands_turn_result` sets up its listeners *before* `send_openhands_message` is called. The simplest approach is to split `wait_for_openhands_turn_result` into a "setup" function that returns the receiver and cleanup handles, call it first, then dispatch, then await.

2. **Add logging for parse failures:** In `parse_terminal_state`, log a warning when `serde_json::from_str` fails for the target agent's payload.

3. **Document or harden cascade behavior:** Either add an explicit `DELETE FROM assertions` in the `delete_scenario` transaction, or add a comment documenting the FK cascade dependency.
