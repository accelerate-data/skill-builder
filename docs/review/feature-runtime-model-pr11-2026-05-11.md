# Review: feature/runtime-model-pr11

- **Branch:** `feature/runtime-model-pr11`
- **Review Date:** 2026-05-11
- **Reviewer:** code-reviewer agent

## Intent

Move selected-skill lease acquisition from the frontend into the backend (`select_skill_openhands_session` and `send_refine_message`), enforce lease ownership at dispatch time, and add advisory UI lock polling to the skill list panel. The frontend `acquire_lock` call is eliminated from the skill entry path; the backend becomes the single enforcement boundary for skill-level concurrency.

## Scope Comparison

| Source | Claim / Requirement |
|--------|---------------------|
| Claim (Commits) | 5 commits: (1) backend lease in bootstrap + refine dispatch, (2) move lease out of frontend, (3) advisory UI lock polling, (4) test/clippy fixes, (5) missing polling test + mark plan complete |
| Plan (PR11 Tasks 11.1–11.4) | Task 11.1: backend acquire-or-verify helper + `select_skill_openhands_session` uses `skillId` — **done**. Task 11.2: lease guard on `send_refine_message` — **done**. Task 11.3: remove frontend `acquireLock` from `enterSkill` — **done**. Task 11.4: UI lock polling in skill-list-panel — **done**. Plan doc checkboxes all marked complete. |
| Linear Issue | No Linear issue linked in commits or PR body. |
| Design Doc | `docs/design/openhands-runtime-model/README.md`, `optimistic-session-activation.md`, `backend-design/README.md` — plan references updating these but the diff does not include any design doc changes. |

**Gap:** The plan's Step 5 for Task 11.4 says to commit design doc updates, but no design docs appear in the diff. The plan text was updated to mark steps as done, but the referenced design documents were not modified in this branch.

## Acceptance Criteria

| Criterion | Status | Evidence |
|-----------|--------|----------|
| `select_skill_openhands_session` accepts `skillId` (not `skillName`/`pluginSlug`) | Proven | `app/src-tauri/src/commands/skill_session.rs:152` — signature takes `skill_id: i64`. Frontend wrapper updated in `tauri.ts:415`. |
| Backend acquires/verifies lease before session restore | Proven | `skill_session.rs:158-168` — `acquire_or_verify_skill_lock` called inside DB transaction before any session work. |
| `send_refine_message` re-checks lease before dispatch | Proven | `refine/mod.rs:302-318` — lease guard at top of command, before session lookup. |
| Frontend `acquireLock` removed from `enterSkill` | Proven | `active-skill-transition.ts:84-92` — `enterSkill` calls only `selectSkillOpenHandsSession`. `acquireLock` import removed. |
| UI lock polling runs on mount, interval, and focus | Proven | `skill-list-panel.tsx:96-124` — `useEffect` with `setInterval(3000)` and `window.addEventListener("focus")`. |
| Locked skills disabled in UI | Proven | `skill-list-panel.tsx:171` — `if (lockedSkills.has(skill.name)) return;` in `handleRowClick`. Line 399 — `isLocked` includes `lockedSkills.has(skill.name)`. |
| Frontend tests updated to not expect `acquire_lock` | Proven | `active-skill-transition.test.ts` — no `acquireLock` mock; `app-layout.test.tsx` — assertions updated to `select_skill_openhands_session`. |
| Rust tests pass | Proven | `cargo test skill_session` — 13 passed. `cargo test refine` — 76 passed. |
| Frontend tests pass | Proven | `npm run test:unit` — 655 passed, 56 files. |
| Design docs updated | **Open** | Plan references updating `docs/design/openhands-runtime-model/README.md`, `optimistic-session-activation.md`, and `backend-design/README.md` but these files are not in the diff. |

## Findings

### High

1. **[Skeptic] `acquire_or_verify_skill_lock` acquires the lease but never releases it on error paths in `select_skill_openhands_session`**

   **File:** `app/src-tauri/src/commands/skill_session.rs:158-168`

   The function acquires a skill lock via `acquire_or_verify_skill_lock` at the top of `select_skill_openhands_session`. If any subsequent step fails (e.g., `ensure_skill_runtime_ready`, `ensure_skill_session`, directory creation), the lock remains held. The frontend previously had a `try/catch` with `releaseLock` in the error path (`active-skill-transition.ts` old code). That cleanup is now gone, and the backend does not release the lock on failure.

   **Scenario:** User selects a skill → backend acquires lock → `ensure_skill_runtime_ready` fails (e.g., disk full, permission error) → lock is held indefinitely. User cannot re-select the skill from any instance until the process dies (dead-lock reclaim) or another instance's PID check reclaims it.

   **Recommendation:** Either (a) release the lock on any error after acquisition in `select_skill_openhands_session`, or (b) document that the lock is intentionally sticky and the dead-PID reclaim is the recovery path. Option (a) is safer for UX.

2. **[Skeptic] `send_refine_message` acquires the lease but does not hold it across the full dispatch**

   **File:** `app/src-tauri/src/commands/refine/mod.rs:302-318`

   The lease check is in a block that ends at line 318 (`}`). After the block, the code proceeds to session lookup, runtime readiness, prompt building, and the actual `send_openhands_message` call. The lease is only verified, not held. Between the verification and the actual dispatch, another instance could acquire the lease and start sending messages to the same conversation.

   This is a TOCTOU (time-of-check-time-of-use) race. The `acquire_skill_lock_by_skill_id` function is idempotent for the same instance (line 22-23 in `locks.rs`), so if the same instance calls it again, it's fine. But if instance A verifies the lease, then instance B steals it (because instance A's PID died or the lock was released), instance A proceeds to dispatch into a conversation it no longer owns.

   **Recommendation:** This is likely acceptable given the PID-based dead-lock reclaim and the fact that the lock is per-instance (not per-command). But the gap should be documented. If strict ownership is needed, the lease should be held for the duration of the command.

3. **[Architect] `_workspace_path` parameter is now unused in `select_skill_openhands_session`**

   **File:** `app/src-tauri/src/commands/skill_session.rs:153`

   The parameter `_workspace_path: String` is prefixed with `_` (Rust convention for unused variables) but is still accepted from the frontend. The frontend passes it (`tauri.ts:415`), but the backend ignores it, resolving the workspace path from `read_initialized_runtime_context` instead. This is a minor contract inconsistency — the parameter exists in the Tauri command signature but serves no purpose.

   **Recommendation:** Remove the parameter entirely from both the backend command and the frontend wrapper to keep the contract clean.

### Medium

4. **[Minimalist] 3-second polling interval for lock state may be aggressive**

   **File:** `app/src/components/skill-list-panel.tsx:111-113`

   The polling interval is set to 3 seconds, which means `getExternallyLockedSkills` is called every 3 seconds while the component is mounted. This triggers a DB query, `reclaim_dead_locks` (which iterates all locks and calls `check_pid_alive` for each), and `get_all_skill_locks`. In a workspace with many skills and multiple instances, this could add noticeable overhead.

   **Recommendation:** Consider increasing to 5 seconds or making it configurable. The window focus handler already provides immediate refresh on user interaction.

5. **[Skeptic] `skill-list-panel.tsx` uses `skill.name` for lock matching, but locks are per `(skill_name, plugin_slug)`**

   **File:** `app/src/components/skill-list-panel.tsx:171`, `app/src-tauri/src/commands/skill/metadata.rs:59-63`

   The `get_externally_locked_skills` command returns `skill_name` only (not qualified by plugin). The frontend then checks `lockedSkills.has(skill.name)`. If two skills with the same name exist in different plugins, and one is locked, both would appear locked in the UI.

   **Recommendation:** Either qualify the lock names (e.g., `"plugin::skill"`) or ensure skill names are globally unique. This is a pre-existing issue, not introduced by this branch, but the polling mechanism makes it more visible.

6. **[Architect] `leaveCurrentSkill` still calls `releaseLock` but lease is now backend-owned**

   **File:** `app/src/lib/active-skill-transition.ts:76-78`

   The `leaveCurrentSkill` function still calls `releaseLock(session.skillId)` on the frontend. This is the old `acquire_lock`/`release_lock` Tauri command pair. Since the lease is now acquired by `select_skill_openhands_session` internally, the frontend's `releaseLock` call is still valid (it releases the same DB row), but the ownership model is now: frontend acquires nothing, backend acquires everything, frontend releases what it never acquired.

   **Recommendation:** This works correctly but is conceptually confusing. Consider moving the release into the backend as well (e.g., a `release_skill_session` command that handles both session pause and lock release), or document the split clearly.

### Low

7. **[Minimalist] `handleRowClick` has three guard clauses that could be consolidated**

   **File:** `app/src/components/skill-list-panel.tsx:165-171`

   The three guards (`runningSkillName`, `skill.name === runningSkillName`, `lockedSkills.has(skill.name)`) are clear but the first two could be one: `if (runningSkillName) return;` since both branches are no-ops when a skill is running.

8. **[Skeptic] `restartSkillOpenHandsSession` now requires `skill.id` but the `EditableSkill` type allows `id: null`**

   **File:** `app/src/lib/skill-openhands-session.ts:189-191`

   The null check was added (`if (editableSkill.id == null)`), which is good. But the error is thrown at runtime rather than being prevented at the call site. The `confirmRedo` handler in `skill-list-panel.tsx:183-209` passes a skill object constructed from `UnifiedSkill` which always has a `skillId`. This is likely safe in practice but worth noting.

## What Went Well

1. **Clean separation of concerns.** The lease acquisition moved cleanly from frontend to backend. The `acquire_or_verify_skill_lock` helper is well-tested and the tests cover both the acquire and reject paths.

2. **Advisory UI is the right pattern.** The polling-based advisory lock in the skill list panel is a good UX choice — it prevents accidental conflicts without creating a hard dependency on the lock for UI rendering.

3. **Test coverage is thorough.** The diff includes updated tests for all affected layers: Rust unit tests, frontend component tests, and typed contract tests. All 655 frontend tests and all relevant Rust tests pass.

## Verdict

**REQUEST_CHANGES**

Two high-severity findings block a clean approval:

1. **Lock not released on error in `select_skill_openhands_session`** — this creates a scenario where a failed skill selection permanently locks the skill until process death. This is a real UX bug that will surface in production.

2. **Design docs not updated** — the implementation plan explicitly lists design doc updates as part of the scope, but they are missing from the branch.

The `_workspace_path` dead parameter (High #3) should also be cleaned up before merge.

## Next Steps

1. Add error-handling in `select_skill_openhands_session` to release the skill lock if any step fails after acquisition. Add a test for this path.

2. Update the three design documents referenced in the plan (`docs/design/openhands-runtime-model/README.md`, `optimistic-session-activation.md`, `docs/design/backend-design/README.md`) to reflect the backend-owned lease contract.

3. Remove the unused `_workspace_path` parameter from `select_skill_openhands_session` and the frontend wrapper.

4. (Optional) Increase the polling interval from 3s to 5s to reduce DB load.
