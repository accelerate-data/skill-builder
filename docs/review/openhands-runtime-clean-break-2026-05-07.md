# PR Review: OpenHands Runtime Clean Break

- **PR:** None (branch-only review)
- **Branch:** `feature/openhands-runtime-clean-break`
- **Review Date:** 2026-05-07
- **Reviewer:** pr-code-reviewer agent

## Intent

Replace the mixed OpenHands helper model with a clean two-mode runtime: persistent skill sessions (`StartOpenHandsSession`, `OpenHandsSendMessage`, `PauseOpenHandsSession`) and throwaway runs (`RunThrowawayOpenHandsSession`), while removing dead eval/create-skill paths in the same change set.

## Scope Comparison

| Source | Claim / Requirement |
|--------|---------------------|
| PR Claim | No open PR. Branch commits claim: add explicit runtime primitives, move workflow/refine/eval onto persistent/throwaway semantics, remove dead description/suggestion surfaces, address review follow-ups. |
| Linear Issue | **VU-1145** — "Implement OpenHands-native clean-break agent runtime migration" (parent, status: Done). Acceptance criteria all checked, but this branch is follow-up work that was not part of the original VU-1145 closure. |
| Design Doc | `docs/design/openhands-runtime-model/README.md` — Four backend primitives, two-layer model (product commands → runtime primitives), persistent vs throwaway sessions, throwaway runtime roots under `.openhands/throwaway/...`. |
| Plan | `docs/plans/2026-05-07-openhands-runtime-clean-break.md` — Split into **Completed In First Pass** (8 items) and **Remaining Work** (7 task groups: A–G). All remaining-work checkboxes are unchecked. |
| Functional Spec | Not directly linked. Runtime model doc covers cross-product semantics. |

## Acceptance Criteria

The branch’s own plan documents acceptance criteria as unchecked tasks. Below is their current status based on code and test evidence.

| Criterion | Status | Evidence |
|-----------|--------|----------|
| **Task A.1** `start_refine_session` establishes persistent OpenHands session up front | **Blocked** | `start_refine_session` in `commands/refine/mod.rs:225` only prepares the session; actual conversation dispatch is still deferred to `send_refine_message` or the first persistent turn. |
| **Task A.2** Fix refine resume behavior for incompatible saved conversations | **Open** | Refine clears stale saved IDs when incompatible (`mod.rs:294`), but the session wrapper still relies on `has_dispatched_turn` manual flag rather than deriving state from conversation. |
| **Task A.3** `run_answer_evaluator` does not trample main skill conversation | **Proven** | `run_answer_evaluator` uses the same skill-scoped workspace and `conversation_matches_request` confirms compatibility with workflow-generated conversations (`mod.rs:1946-2022`). |
| **Task A.4–A.5** `define_eval_scenario` / `build_refine_improvement_brief` on persistent primitives | **Proven** | Both use `prepare_openhands_session` + `openhands_send_message` via product-layer helpers (`eval_workbench/mod.rs:1946`, `mod.rs:2241`). |
| **Task A.6–A.7** Consolidate duplicated persistent-session orchestration | **Blocked** | Workflow, eval workbench, and refine each still own separate resume/send/retry policy rather than reusing a single canonical helper. |
| **Task B.1–B.4** Throwaway runs use isolated `.openhands/throwaway/...` roots | **Partially Proven** | Eval workbench uses `throwaway_runtime_dir` (`eval_workbench/mod.rs:1112`). Scope review path not verified to use throwaway roots in this review. |
| **Task C.1–C.4** Remove legacy runtime aliases and one-shot naming | **Blocked** | `OpenHandsOneShotRequest`, `OpenHandsOneShotConfigParams`, `OneShot` event types, and `dispatch_openhands_turn_with_request` still use old naming throughout `openhands_server/mod.rs`. |
| **Task D.1–D.7** Remove stale trigger/comparison surface from backend | **Blocked** | `eval_workbench/mod.rs` still compiles trigger-mode DTOs, `should_trigger` fields, `execute_trigger_cases`, and `build_trigger_sidecar_config` even though frontend no longer exposes trigger mode. |
| **Task E.1–E.4** Reconcile runtime documentation | **Proven** | Design doc updated in commit `9e778095`; runtime model doc matches implemented naming for primitives and throwaway semantics. |
| **Task F.1–F.7** Close test coverage gaps | **Partially Proven** | Primitive-layer tests added for `resolve_saved_conversation_outcome`, `should_backfill_events`, and cancellation registry. Refine lifecycle branches, workflow gate reuse, and E2E live-eval path still lack coverage. |
| **Task G.1–G.9** Final regression and quality gates | **Blocked** | Rust tests and frontend unit tests pass, but E2E tags `@workflow`, `@refine`, `@evals` were not run during this review due to time constraints. |
| **Review #1** `user_message_suffix` stability verified or removed from match check | **Blocked** | `conversation_matches_request` at `openhands_server/mod.rs:140-141` still matches on `user_message_suffix`. No evidence that suffix is stable across turns. |
| **Review #2** Direct primitive-layer tests for `resolve_openhands_conversation_id` | **Proven** | Tests added for `ResumeOrCreate` + matching, mismatching, missing, and `SendExistingOnly` + missing/mismatch (`mod.rs:2281-2376`). |

## Findings

Ordered by severity (high → medium → low).

### High

1. **[Skeptic]** `user_message_suffix` in `conversation_matches_request` may break conversation reuse.  
   **Location:** `app/src-tauri/src/agents/openhands_server/mod.rs:140-141`  
   **Detail:** The compatibility check includes `user_message_suffix`. If this suffix contains per-message dynamic content (timestamps, run IDs, turn counters), every turn will recreate the conversation, losing accumulated context. The prior independent review flagged this as the highest-severity open item. Commit `9e778095` did not address it.  
   **Recommendation:** Verify stability across turns, or remove `user_message_suffix` from the match check and document which fields are compatibility keys.

2. **[Architect]** `start_refine_session` does not own resume/create up front.  
   **Location:** `app/src-tauri/src/commands/refine/mod.rs:225-389`  
   **Detail:** The plan’s Task A explicitly requires `start_refine_session` to establish the persistent OpenHands conversation. Currently it loads saved state, validates compatibility, restores history, and stores a `RefineSession` handle — but it does not call `start_openhands_session` or `prepare_openhands_session`. The actual conversation creation/resume is deferred to `send_refine_message` via `dispatch_openhands_turn_with_request`. This leaves a window where the session handle exists but no OpenHands conversation is guaranteed.  
   **Recommendation:** Move the `prepare_openhands_session` call into `start_refine_session` so the conversation ID is materialized before the function returns.

3. **[Skeptic]** `RefineSession.has_dispatched_turn` is manual state that can drift.  
   **Location:** `app/src-tauri/src/commands/refine/mod.rs:197`  
   **Detail:** If the app crashes between `start_refine_session` and first `send_refine_message`, the flag restarts as `false` even though the conversation may already have persisted events. The prior review recommended deriving this from conversation state. Commit `9e778095` did not address it.  
   **Recommendation:** Replace the boolean with a derivation from the persisted conversation event log (e.g., check for existing user turns).

4. **[Architect]** Legacy "One-Shot" naming and types still pervade the runtime layer.  
   **Location:** `app/src-tauri/src/agents/openhands_server/mod.rs` (types, functions, events), `app/src-tauri/src/agents/sidecar.rs` (`OpenHandsOneShotConfigParams`)  
   **Detail:** The clean-break plan says "no fallback compatibility shims" and "remove legacy one-shot naming." Yet `OpenHandsOneShotRequest`, `OpenHandsOneShotEvent`, `OpenHandsOneShotConfigParams`, and `OpenHandsOneShotRun` naming remain scattered across the backend. This contradicts the plan’s Task C.  
   **Recommendation:** Rename all `OneShot` runtime types to `Throwaway` or `Runtime` and remove `OneShot` from internal function names.

5. **[Minimalist]** Stale trigger/comparison eval workbench code is still compiled.  
   **Location:** `app/src-tauri/src/commands/eval_workbench/mod.rs` (lines 113, 124, 143, 158, 176, 189, 262, 320, 433-444, 489-490, 608, 632, 659, 859, 920, 922, 1258-1296, 1757-1831, 1897, 2356, 2389-2395, 2438-2493, 2562-2574, 3228, 3564-3587)  
   **Detail:** The frontend deleted the description-surface UI, but the backend still carries `Trigger` mode DTOs, `should_trigger` fields, `execute_trigger_cases`, `build_trigger_sidecar_config`, `write_trigger_stub_skill`, and related tests. This is dead code under the live product surface. The plan’s Task D requires removing it.  
   **Recommendation:** Delete all trigger-mode backend paths, DTO fields, and tests that are no longer reachable from the live one-tab eval workbench.

### Medium

6. **[Minimalist]** `start_openhands_session` and `prepare_openhands_session` are redundant.  
   **Location:** `app/src-tauri/src/agents/openhands_server/mod.rs:695-730`  
   **Detail:** `start_openhands_session` calls `prepare_openhands_session` then immediately dispatches a turn. The design doc treats `StartOpenHandsSession` as a single primitive. The prior review recommended collapsing them.  
   **Recommendation:** Collapse into one primitive; if product commands need separation, they should call lower-level helpers directly.

7. **[Minimalist]** `session_init_request` wastes a full clone.  
   **Location:** `app/src-tauri/src/agents/openhands_server/mod.rs:~220`  
   **Detail:** Clones the entire request (including potentially large prompt/suffix strings) just to clear one field.  
   **Recommendation:** Build `StartConversationRequest` directly without the intermediate clone.

8. **[Architect]** `load_saved_skill_conversation_id` couples to `AppHandle`.  
   **Location:** `app/src-tauri/src/agents/openhands_server/mod.rs:85-95`  
   **Detail:** Takes `&tauri::AppHandle` just to extract `Db` state, making unit testing harder. The prior review recommended taking `&Db` directly.  
   **Recommendation:** Change signature to accept `&Db`; callers already have access to it.

9. **[Skeptic]** No structured metrics/telemetry counters on primitive usage.  
   **Location:** All primitives in `openhands_server/mod.rs`  
   **Detail:** `log_session_resolution` logs creation reasons, but there are no typed counters for session created vs resumed, throwaway run duration, or mismatch recreation rates. This makes operational debugging hard. The prior review recommended lightweight counters.  
   **Recommendation:** Add typed counters (e.g., `openhands_session_created`, `openhands_session_resumed`) or at minimum structured log fields that can be aggregated.

10. **[Architect]** Duplicated persistent-session orchestration across product modules.  
    **Location:** `commands/refine/mod.rs`, `commands/workflow/runtime.rs`, `commands/eval_workbench/mod.rs`  
    **Detail:** Each product module still contains its own resume/create/send/retry logic rather than delegating to a canonical runtime-layer helper. The plan’s Task A.6 calls for consolidation.  
    **Recommendation:** Extract a single `run_persistent_skill_turn` helper in the runtime layer that all three product commands call.

### Low

11. **[Minimalist]** Markdown lint errors in the review feedback doc.  
    **Location:** `docs/plans/2026-05-07-openhands-runtime-clean-break-review.md`  
    **Detail:** `markdownlint` reports 5 `MD032` errors (lists not surrounded by blank lines).  
    **Recommendation:** Fix lint errors so the review doc meets repo standards.

12. **[Minimalist]** Minor naming inconsistency in backfill test.  
    **Location:** `app/src-tauri/src/agents/openhands_server/mod.rs:2379`  
    **Detail:** The test is named `prepared_session_backfills_history_only_for_blank_send_existing_turns`, but the function under test is `should_backfill_events`.  
    **Recommendation:** Align test name with function name for discoverability.

## What Went Well

1. **Architecture is sound.** The four-primitive runtime model (`StartOpenHandsSession`, `OpenHandsSendMessage`, `PauseOpenHandsSession`, `RunThrowawayOpenHandsSession`) is clearly separated from product commands, and the persistent vs throwaway semantics are well-defined in the design doc.

2. **Review follow-ups were partially addressed with discipline.** Commit `9e778095` introduced structured error types (`OpenHandsRuntimeError`), added primitive-level unit tests for conversation resolution, replaced `std::sync::Mutex` with `DashMap` in the cancel registry, added a task abort-handle registry, and extracted `should_backfill_events` with tests.

3. **All automated gates pass.** 1,105 Rust tests, 599 frontend unit tests, `cargo clippy -- -D warnings`, and the `repo-map.json` audit all pass, indicating the branch does not break existing correctness.

## Verdict

**REQUEST_CHANGES**

This branch is architecturally correct and functionally sound, but it is **incomplete** according to its own plan. Seven task groups in the "Remaining Work" section remain entirely unchecked. Two high-severity items from the independent code review (`user_message_suffix` match instability and `has_dispatched_turn` drift) are still unaddressed. Legacy naming residue and stale trigger-mode backend code contradict the clean-break mandate of "no fallback compatibility shims."

**Do not open this branch as a PR in its current state.** It should either:
- Continue as a development branch until Tasks A–D and the two unaddressed high-severity review items are resolved, or
- Be split into smaller, focused PRs (e.g., one for refine session ownership, one for legacy residue removal, one for throwaway isolation verification) so each can be reviewed and merged independently.

## Next Steps

1. **Address `user_message_suffix` in `conversation_matches_request`** — verify stability across turns or remove it from the compatibility check.
2. **Move resume/create ownership into `start_refine_session`** — ensure the OpenHands conversation is materialized before the function returns.
3. **Derive `has_dispatched_turn` from conversation state** — eliminate the crash-vulnerable manual flag.
4. **Remove or rename remaining `OneShot` types and functions** — align all runtime-layer naming with the "throwaway" model.
5. **Delete stale trigger/comparison eval workbench backend code** — remove unreachable `Trigger` mode paths, `should_trigger` fields, and associated tests.
6. **Run E2E regression tags `@workflow`, `@refine`, `@evals`** — confirm no regressions in the mocked E2E suite before opening a PR.
7. **Re-run `markdownlint`** on the review feedback doc and fix `MD032` violations.
