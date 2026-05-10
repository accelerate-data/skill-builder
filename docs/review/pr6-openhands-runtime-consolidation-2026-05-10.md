# Review: PR 6 — Consolidate OH artifacts to workspace root; remove skill-switch server stop

- **Branch:** `feature/runtime-model-refactor`
- **Review Date:** 2026-05-10
- **Reviewer:** code-reviewer agent
- **Plan:** `docs/plans/2026-05-10-openhands-runtime-model.md` (PR 6, Tasks 6.1–6.9)

## Intent

PR 6 has two halves addressing Gaps 6 + 11:
- **Phase 1 (Backend):** Consolidate OpenHands artifact directories (conversations, bash events, logs, secret) to workspace-root-scoped paths under `.openhands/`, add `OH_BASH_EVENTS_DIR` env var, and remove the skill-switch restart condition from `ensure_agent_server`.
- **Phase 2 (Frontend):** Remove `stopOpenHandsServer()` from `leaveCurrentSkill` and delete the dead `stop_openhands_server` Tauri command.

## Scope Comparison

| Source | Claim / Requirement |
|--------|---------------------|
| Plan (PR 6) | 9 tasks (6.1–6.9) covering path helpers, env vars, handle struct, `ensure_agent_server`, `start`/`start_once`, mod.rs call sites, test updates, frontend `leaveCurrentSkill`, and Tauri command deletion |
| Implemented | All 9 tasks have been addressed in the codebase |

## Acceptance Criteria

| Criterion | Status | Evidence |
|-----------|--------|----------|
| 6.1: Path helpers use `workspace_root` | **Proven** | `compute_conversations_path` (process.rs:59-61), `compute_bash_events_path` (process.rs:64-66), `openhands_secret_path` (process.rs:86-88), `read_or_create_openhands_secret` (process.rs:90-129), `open_server_log_file` (process.rs:488-518) — all take `workspace_root: &Path` |
| 6.2: `apply_session_env` sets `OH_BASH_EVENTS_DIR` | **Proven** | `apply_session_env` (process.rs:68-84) takes `bash_events_path: Option<&str>` and sets `OH_BASH_EVENTS_DIR` when present |
| 6.3: `conversations_path` removed from handle | **Proven** | `OpenHandsAgentServerHandle` (process.rs:131-136) has only `port`, `session_api_key`, `stderr_tail` |
| 6.4: `ensure_agent_server` no longer compares paths | **Proven** | `ensure_agent_server` (process.rs:268-308) takes `workspace_root: &Path`, no path comparison — reuse driven solely by `should_reuse_cached_server` |
| 6.5: `start`/`start_once` use `workspace_root` | **Proven** | `OpenHandsAgentServerProcess::start` (process.rs:319-334) and `start_once` (process.rs:336-415) both take `workspace_root: &Path`; `start_once` computes both `conversations_path_str` and `bash_events_path_str` from `workspace_root` |
| 6.6: All 5 mod.rs call sites updated | **Proven** | All 5 `ensure_agent_server_process` calls use `Path::new(&request.workspace_root_dir)` (mod.rs:803, 893, 922, 1014, 1222) |
| 6.7: Tests updated | **Proven** | `live_openhands_server_shutdown_prefers_sigterm` uses `workspace_root` (process.rs:851-870); old `compute_conversations_path_resolves_under_runtime_run_dir` test deleted |
| 6.8: `stopOpenHandsServer` removed from `leaveCurrentSkill` | **Proven** | `leaveCurrentSkill` (active-skill-transition.ts:58-83) has no `stopOpenHandsServer` call; import not present |
| 6.9: `stop_openhands_server` Tauri command deleted | **Proven** | No `stop_openhands_server` function in `runtime_lifecycle.rs`; no registration in `lib.rs` invoke_handler |

## Findings

### High

_None._

### Medium

1. **[Architect] Missing compile-time proof tests (Task 6.4, Steps 1–2)**

   The plan calls for two explicit tests in `process.rs`:
   - `cached_server_reuse_does_not_depend_on_conversations_path` — documents that reuse is driven solely by liveness/health
   - `ensure_agent_server_handle_have_no_conversations_path_field` — compile-time proof via struct literal

   Neither test exists in the codebase. While the underlying implementation is correct (the field is gone, the restart logic is removed), these tests were explicitly specified as structural guards against regression.

   **File:** `app/src-tauri/src/agents/openhands_server/process.rs`
   **Recommendation:** Add both tests to the `#[cfg(test)]` block.

2. **[Skeptic] Dead frontend code: `stopOpenHandsServer` still in `tauri.ts`**

   The Rust-side `stop_openhands_server` command has been deleted (Task 6.9), but the frontend wrapper remains:
   - `app/src/lib/tauri.ts:434` — `export const stopOpenHandsServer = () => invokeCommand("stop_openhands_server", {})`
   - `app/src/lib/tauri-command-types.ts:216` — type definition still declares `stop_openhands_server`

   These will fail at runtime if invoked (the Tauri command no longer exists). They are not called from `active-skill-transition.ts` (Task 6.8 is satisfied), but they are dead code that will throw if accidentally used.

   **Files:** `app/src/lib/tauri.ts`, `app/src/lib/tauri-command-types.ts`
   **Recommendation:** Remove `stopOpenHandsServer` export from `tauri.ts` and its type from `tauri-command-types.ts`. Also clean up test mocks that reference it (`app/src/__tests__/components/app-layout.test.tsx` lines 799, 972, 1023, 1041, 1043, 1098, 1349; `app/src/test/mocks/tauri.ts` line 16).

3. **[Architect] `EventRecoveryMode` and related watermark functions still present in `mod.rs`**

   The `EventRecoveryMode` enum (mod.rs:222-227), `determine_event_recovery_mode` (mod.rs:694-707), and the watermark functions (`event_watermark_key`, `collect_event_watermark_keys`, `filter_events_after_watermark`) are still present. The `event_recovery` field is still on `OpenHandsConversationTask` (mod.rs:213) and is still assigned in `dispatch_openhands_turn_with_request` (mod.rs:1234).

   This is **not a bug** — it belongs to PR 8 (Gap 8), which is a separate task in the plan. However, the presence of the Delta recovery path means the codebase still carries complexity that PR 6's architectural simplification was meant to eventually eliminate.

   **File:** `app/src-tauri/src/agents/openhands_server/mod.rs`
   **Recommendation:** No action for this PR — correctly out of scope. Flag for PR 8 follow-up.

### Low

1. **[Minimalist] `release_stale_conversation_leases` still uses per-skill path naming**

   The function `release_stale_conversation_leases` (process.rs:246-266) is called with `&compute_conversations_path(workspace_root)` at line 295. The function name references "conversation" (singular) but it now operates on the workspace-scoped conversations directory. This is semantically correct but the naming could be confusing.

   **File:** `app/src-tauri/src/agents/openhands_server/process.rs:246`
   **Recommendation:** Consider renaming to `release_stale_conversation_leases_for_workspace` for clarity.

2. **[Minimalist] `OpenHandsRunSummaryContext.workspace_path` still uses `workspace_skill_dir`**

   In `OpenHandsRunSummaryContext::new` (mod.rs:179-196), `workspace_path` is set from `request.workspace_skill_dir.clone()` (line 192). After PR 6, this field name is misleading — it holds the skill dir, not the workspace root. This is a naming debt, not a functional issue.

   **File:** `app/src-tauri/src/agents/openhands_server/mod.rs:192`
   **Recommendation:** Rename the field to `workspace_skill_dir` to match what it actually stores, or update to use `workspace_root_dir` if that's the intended semantics.

## What Went Well

1. **Path consolidation is clean and complete.** All path helpers (`compute_conversations_path`, `compute_bash_events_path`, `openhands_secret_path`, `open_server_log_file`) correctly derive from `workspace_root`, and all 5 call sites in `mod.rs` pass `Path::new(&request.workspace_root_dir)`. The skill-switch restart condition is fully eliminated.

2. **`apply_session_env` correctly handles both env vars.** The function takes both `conversations_path` and `bash_events_path` as `Option<&str>`, sets `OH_CONVERSATIONS_PATH` and `OH_BASH_EVENTS_DIR` respectively, and omits both when `None`. Tests cover both present and absent cases.

3. **Frontend `leaveCurrentSkill` is correctly simplified.** The function follows the prescribed order (pause → release lock → clear UI state) with no server stop. The `stopOpenHandsServer` import is removed.

## Verdict

**REQUEST_CHANGES**

The core implementation of PR 6 is correct and complete — all 9 tasks have been addressed at the implementation level. The skill-switch restart is eliminated, artifact paths are workspace-root-scoped, `OH_BASH_EVENTS_DIR` is set, and the frontend no longer stops the server on skill switch.

However, two medium-severity issues should be addressed before merging:

1. **Missing compile-time proof tests** (Task 6.4 Steps 1–2) — the plan explicitly calls for these as regression guards.
2. **Dead frontend code** — `stopOpenHandsServer` in `tauri.ts` and its type definition will throw at runtime if invoked, and test mocks reference a deleted Tauri command.

## Next Steps

1. Add the two missing tests to `process.rs`:
   - `cached_server_reuse_does_not_depend_on_conversations_path`
   - `ensure_agent_server_handle_have_no_conversations_path_field`
2. Remove `stopOpenHandsServer` from `app/src/lib/tauri.ts` and its type from `app/src/lib/tauri-command-types.ts`
3. Clean up test mocks referencing `stop_openhands_server` in `app/src/__tests__/components/app-layout.test.tsx` and `app/src/test/mocks/tauri.ts`
4. Run `cargo test` and `npm run test:unit` to confirm all tests pass
