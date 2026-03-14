# Code Review: Skill Builder — 2026-03-14b

## Executive Summary

Five parallel agents reviewed the frontend, Rust/Tauri backend, Node.js sidecar, E2E test suite, and security/architecture layers. The codebase is generally well-structured, but two critical security issues require immediate attention: arbitrary filesystem write via unvalidated paths in Rust commands, and FK enforcement being silently disabled for all app writes. Test coverage has significant gaps across all layers, particularly in security-relevant command paths, and several E2E specs are misconfigured and never run in CI.

**Finding counts by severity:**

| Severity | Security | Code Quality | Test Coverage | E2E Coverage | E2E Quality | Total |
|---|---|---|---|---|---|---|
| Critical | 1 | 0 | 0 | 0 | 0 | 1 |
| High | 2 | 5 | 10 | 4 | 3 | 24 |
| Medium | 4 | 11 | 9 | 4 | 6 | 34 |
| Low | 3 | 6 | 4 | 2 | 1 | 16 |
| **Total** | **10** | **22** | **23** | **10** | **10** | **75** |

---

## Security

### S-01 — Critical — Path Traversal: Arbitrary Filesystem Write

**Location:** `app/src-tauri/src/commands/clarification.rs:5-21`, `commands/workflow/evaluation.rs:232-277`, `commands/workflow/evaluation.rs:481-543`

`save_raw_file` accepts arbitrary absolute paths with no allowed-roots check. `get/save_clarifications/decisions` and `reset_legacy_skills` join caller-supplied `skill_name` to workspace path without validation, enabling `../../../etc` traversal. Any Tauri frontend caller can write or delete arbitrary filesystem locations.

**Fix:** Validate all caller-supplied paths against allowed roots (e.g., workspace root and skill output dir) before use. Apply `validate_skill_name` to `skill_name` parameters in every evaluation command. Add regression tests for out-of-bounds path inputs (see TC-01, TC-02, TC-03).

### S-02 — High — Unbounded Base64 Write and Recursive Directory Traversal

**Location:** `app/src-tauri/src/commands/files.rs:428-457` (write), `files.rs:52-92` (collect_entries)

`write_base64_to_temp_file` has no size limit on the decoded payload; `MAX_BASE64_FILE_SIZE` guards reads but not writes, allowing multi-hundred-MB allocations. `collect_entries` performs unbounded recursive directory traversal with no depth cap and no symlink-cycle detection; a symlink loop causes infinite recursion. Both issues are reachable via normal Tauri IPC.

**Fix:** Apply `MAX_BASE64_FILE_SIZE` (or a separate write limit) before decoding. Add a `MAX_DEPTH` constant to `collect_entries` and detect symlink cycles before recursing. Note: IPC deserializes the full base64 string before the command body can reject it, so validation must happen early in the handler.

### S-03 — High — Foreign Key Enforcement Silently Disabled at Runtime

**Location:** `app/src-tauri/src/db/mod.rs:67-68`

The `foreign_keys` pragma is disabled before running migrations and never re-enabled, making all `ON DELETE CASCADE` rules inert at runtime. Referential integrity constraints exist in the schema but have no effect for any app write.

**Fix:** Re-enable `PRAGMA foreign_keys = ON` after migrations complete, before handing the connection back to the pool. Add a test that asserts `PRAGMA foreign_keys` returns `1` on a live connection.

### S-04 — Medium — API Key Logged via Tauri Debug Instrumentation

**Location:** `app/src-tauri/src/commands/settings.rs:338-367`

`api_key` flows through Tauri IPC as a plain string. Tauri debug logging records all command arguments, which exposes the key in debug builds and developer logs. No `ApiKey` wrapper type with a redacted `Debug` impl exists.

**Fix:** Introduce a newtype wrapper `struct ApiKey(String)` with `impl Debug` that emits `"[REDACTED]"`. Use it for all API key parameters and return values. Add a note to the logging policy about IPC argument logging.

### S-05 — Medium — `get_context_file_content` Missing Null-Byte and Reserved-Name Rejection

**Location:** `app/src-tauri/src/commands/workflow/evaluation.rs:309-321`

Path is joined from caller input but not canonicalized or checked for null bytes or Windows reserved names (e.g., `CON`, `NUL`). On Windows this can produce unexpected file access behavior.

**Fix:** Canonicalize the joined path and validate it is within the allowed root before opening. Reject inputs containing null bytes or matching Windows reserved name patterns.

### S-06 — Medium — Side-Effectful Read: `get_settings` Runs Migrations Under Lock on Every Call

**Location:** `app/src-tauri/src/commands/settings.rs:27-96`, `db/mod.rs`

`get_settings` performs two write operations (marketplace migration + normalization) on every read call, while holding the global `Mutex<Connection>`. Multiple concurrent callers can race to apply the migration. The global mutex serializes all DB commands; this is an architecture constraint that amplifies the cost of any slow operation inside a read path.

**Fix:** Run migration and normalization once at startup or lazily with a one-time guard, not on every read. Long-term, consider `r2d2` or a connection pool to reduce lock contention.

### S-07 — Low — GitHub Client ID Hardcoded with No Explanatory Comment

**Location:** `app/src-tauri/src/commands/github_auth.rs:4`

Client ID is hardcoded in the binary (acceptable for device-flow OAuth) but has no comment explaining why. Maintainers may flag it as an accidental secret exposure.

**Fix:** Add a comment: `// Public client ID — intentional for OAuth device flow; not a secret.`

### S-08 — Low — `diff_settings` Logs Marketplace URL Value

**Location:** `app/src-tauri/src/commands/settings.rs:208`

`diff_settings` logs the `marketplace_url` value, not just that it changed. This exposes internal registry hostnames in logs.

**Fix:** Log `"marketplace_url changed"` without the value, or log at `debug` level only.

### S-09 — Low — `std::sync::Mutex` in Async Context (Sidecar Pool)

**Location:** `app/sidecar/src/sidecar_pool.rs`

`std::sync::Mutex` is used in a Tokio async context. Holding it across an `await` would make the future non-`Send` and could deadlock. No documented invariant prevents this.

**Fix:** Document the invariant that the mutex is never held across `.await`, or replace with `tokio::sync::Mutex`.

---

## Code Quality (Frontend)

### CF-01 — High — `applyContextWindow` Silently Drops Smaller Values

**Location:** `app/src/stores/agent-store.ts:622`

`applyContextWindow` uses `Math.max`, so if a smaller context window arrives (e.g. from a new model response), it is silently discarded. The utilization bar can display stale percentages indefinitely.

**Fix:** Accept the incoming value unconditionally, or document the invariant that context windows are monotonically increasing and add an assertion.

### CF-02 — High — Hardcoded Step Indices for Structured Output Materialization

**Location:** `app/src/hooks/use-workflow-state-machine.ts:264`

Indices 0–3 are hardcoded to identify steps that require structured output. Adding or reordering workflow steps silently breaks materialization for the affected steps.

**Fix:** Replace hardcoded indices with a lookup against `WORKFLOW_STEP_DEFINITIONS` (e.g., a `requiresStructuredOutput` flag on each step definition).

### CF-03 — Medium — `resetAgentStoreInternals` Deprecated but Still Does Real Work

**Location:** `app/src/stores/agent-store.ts:126-130`

The function is marked `@deprecated` but performs real cleanup. Future maintainers may remove or skip the call on seeing the deprecation annotation.

**Fix:** Remove the `@deprecated` annotation, rename to a descriptive name, or replace with the intended successor call site.

### CF-04 — Medium — `autoStartAfterReset` Not Wrapped in `useCallback`

**Location:** `app/src/hooks/use-workflow-state-machine.ts:163`

Every other handler in the hook is memoized with `useCallback`, but `autoStartAfterReset` is not. This creates a reference-instability maintenance hazard and inconsistency.

**Fix:** Wrap in `useCallback` with appropriate dependency array.

### CF-05 — Medium — Double Cleanup on Navigation

**Location:** `app/src/hooks/use-workflow-session.ts:43-70`

Both the unmount effect and the `onLeave` callback call `endWorkflowSession`/`cleanupSkillSidecar`, sending two sidecar shutdown commands on navigation. The second call is likely a no-op but creates unnecessary IPC noise and could mask bugs.

**Fix:** Ensure cleanup is invoked exactly once, either via the unmount effect or the router `onLeave` callback, not both.

### CF-06 — Medium — Auth Error Does Not Clear Stale User State

**Location:** `app/src/stores/auth-store.ts:54`

The `catch` block in `loadUser` resets `isLoading` but leaves `user` and `isLoggedIn` at their previous values. If the API throws after a previously successful load, the UI renders a stale authenticated state.

**Fix:** Clear `user` and set `isLoggedIn = false` in the catch block.

### CF-07 — Medium — `saveWorkflowState` Relies on Synchronous Zustand Set

**Location:** `app/src/hooks/use-workflow-state-machine.ts:540`

`saveWorkflowState` is called with a snapshot taken after `setCurrentStep`. This relies on Zustand's `set` being synchronous, which is fragile with React concurrent rendering and batching.

**Fix:** Pass the new step value explicitly to `saveWorkflowState` rather than reading it back from the store after `setCurrentStep`.

### CF-08 — Low — `normalizeDirectoryPickerPath` Is Case-Sensitive

**Location:** `app/src/lib/utils.ts:53-71`

The doubled-segment detection comparison is case-sensitive and will miss the bug on case-insensitive filesystems (macOS HFS+, Windows NTFS).

**Fix:** Normalize both path segments to lowercase before comparison on platforms where the filesystem is case-insensitive, or use a case-insensitive comparison consistently.

---

## Code Quality (Rust/Tauri)

### CQ-01 — Medium — `save_workflow_state` Returns Error When `skills_path` Is Missing

**Location:** `app/src-tauri/src/commands/skill.rs:534-536`

Returns an error (not warn-and-skip) when `skills_path` is missing. This blocks workflow persistence entirely rather than degrading gracefully.

**Fix:** Log a warning and return `Ok(())` when `skills_path` is absent, or surface a more actionable error message to the frontend.

### CQ-02 — Medium — `acquire_skill_lock` Leaves Open Transaction on Early Return

**Location:** `app/src-tauri/src/db/locks.rs:14-65`

Uses manual `BEGIN IMMEDIATE`/`COMMIT`/`ROLLBACK`. An early return (e.g., error path) can exit without rolling back, leaving the connection in an open transaction state.

**Fix:** Use a RAII guard or ensure every exit path issues `ROLLBACK` before returning. Alternatively, use `rusqlite`'s transaction API.

### CQ-03 — Medium — `persist_agent_run` Shutdown Guard Bypassable by Pre-Normalization Rows

**Location:** `app/src-tauri/src/db/usage.rs:63-77`

The shutdown guard queries by `(agent_id, model)`, but rows inserted before model-name normalization was added can bypass the guard and create duplicate rows.

**Fix:** Normalize `model` values on read or apply a data migration to normalize existing rows, then add a unique constraint.

### CQ-04 — Low — `restore_skill_version` Returns `Ok(())` on Failed Post-Restore Commit

**Location:** `app/src-tauri/src/commands/git.rs:61-68`

Returns success when the post-restore git commit fails. The frontend receives a success response for an incomplete operation.

**Fix:** Propagate the git commit error as a command error, or at minimum log it at `warn` and surface a partial-success status.

### CQ-05 — Low — `delete_skill_inner` Gives Confusing Error on Missing Workspace

**Location:** `app/src-tauri/src/commands/skill.rs:399`

`canonicalize` on a missing `workspace_path` emits a generic OS error rather than "workspace not found."

**Fix:** Check for `workspace_path` existence before calling `canonicalize` and return a descriptive error.

### CQ-06 — Low — Instance ID and PID Logged as Hardcoded `[REDACTED]`

**Location:** `app/src-tauri/src/lib.rs:229`

Instance ID and PID are logged as the literal string `"[REDACTED]"` rather than actual values. This appears to be an unintentional placeholder left in production code.

**Fix:** Log the real instance ID and PID, which are not sensitive values.

---

## Code Quality (Sidecar)

### CS-01 — High — `pushMessage` Silently Drops Queued Messages in Mock Mode

**Location:** `app/sidecar/src/stream-session.ts:52-68`

`pushMessage` drains the internal queue in real mode but skips draining in mock mode. Messages queued before mock mode is confirmed are silently lost.

**Fix:** Drain the queue unconditionally regardless of mode, or document and test the invariant that no messages can be queued before mock mode is set.

### CS-02 — High — Shutdown Does Not Await Active `StreamSession` Promises

**Location:** `app/sidecar/src/persistent-mode.ts:232-240`

`shutdown` awaits in-flight `agent_requests` but not `StreamSession.runQuery` promises. Active sessions can lose their final `run_result` event on shutdown.

**Fix:** Track all active `StreamSession` promises and include them in the shutdown drain set.

### CS-03 — Medium — Mock Mode Ignores `externalSignal`

**Location:** `app/sidecar/src/stream-session.ts:96-116`

Cancellation via `externalSignal` is silently ignored during mock streaming. The session appears to run to completion even when cancelled.

**Fix:** Check `externalSignal.aborted` at each mock turn emission and abort early, emitting an appropriate `run_result`.

### CS-04 — Medium — Abort/Error Race Produces Wrong DB Status

**Location:** `app/sidecar/src/run-agent.ts:145-164`

If an external abort and an SDK error arrive in the same event-loop tick, the error path can emit an `error` `run_result` instead of `shutdown`. This results in an incorrect status being persisted to the database.

**Fix:** Check abort state before processing SDK errors; if the signal is already aborted, emit `shutdown` regardless of the error.

### CS-05 — Medium — `pre_tokens` Silently Defaults to Zero

**Location:** `app/sidecar/src/message-processor.ts:534`

When `compact_metadata` is absent, `pre_tokens` defaults to `0` with no warning. This produces silently wrong token-usage accounting.

**Fix:** Log a `warn` when `compact_metadata` is absent and `pre_tokens` defaults.

### CS-06 — Low — Hardcoded 20ms Delay in Mock Turn Emission

**Location:** `app/sidecar/src/stream-session.ts:341`

`setTimeout(20ms)` is hardcoded in `emitMockTurn`. This makes tests timing-sensitive and slows mock-mode runs unnecessarily.

**Fix:** Use `setImmediate` for test environments, or inject the delay as a constructor parameter with a default.

### CS-07 — Low — Mock Template Line Splitting Not CRLF-Safe

**Location:** `app/sidecar/src/mock-agent.ts:223`

`content.split("\n")` does not handle CRLF line endings. On Windows checkouts, all mock template lines fail to parse.

**Fix:** Use `content.split(/\r?\n/)` per the Windows compatibility rules in `.claude/rules/windows-compat.md`.

---

## Test Coverage (Frontend)

### TF-01 — High — `applyContextWindow` "Take Max" Behavior Untested

**Location:** `app/src/stores/agent-store.ts`

No test covers the case where a smaller context window value arrives. The silent-drop behavior (CF-01) has no regression coverage.

**Fix:** Add a unit test asserting behavior when a lower value arrives after a higher one.

### TF-02 — High — Gate Evaluation Paths Entirely Untested

**Location:** `app/src/hooks/use-workflow-state-machine.ts`

`finishGateEvaluation`, `runGateOrAdvance`, `handleGateSkip`, `handleGateResearch`, `handleGateContinueAnyway`, and `buildGateFeedbackNotes` have no test coverage.

**Fix:** Add unit tests for each gate handler, including the skip, research, and continue-anyway branches.

### TF-03 — High — Step-Completion Error Paths Untested

**Location:** `app/src/hooks/use-workflow-state-machine.ts`

Null `structuredOutput` and `verifyStepOutput` returning `false` paths are not tested; these are failure modes that affect workflow progression.

**Fix:** Add tests for both null output and verification failure, asserting the step does not advance and an appropriate error state is set.

### TF-04 — Medium — `skill-store.ts` Has No Tests

**Location:** `app/src/stores/skill-store.ts`

No tests exist for `setLockedSkills` or any other store action; `Set` semantics are not verified.

**Fix:** Add a test file covering at minimum `setLockedSkills` add/remove/idempotency behavior.

### TF-05 — Medium — `resetCounter` Not Verified to Pass `null` modelFamily

**Location:** `app/src/stores/usage-store.ts`

No test verifies that `resetCounter` passes `null` (not a stale state value) to `get_agent_runs`.

**Fix:** Add a test asserting the argument passed to the Tauri command is `null` when `resetCounter` is called.

### TF-06 — Medium — `consumeUpdateMode` Finally-Block Path Untested

**Location:** `app/src/hooks/use-workflow-persistence.ts`

The `finally` block that flips `pendingUpdateMode` is not exercised by any test; error-path cleanup is unverified.

**Fix:** Add a test that causes the main body to throw and asserts `pendingUpdateMode` is reset.

### TF-07 — Medium — `handleSave(silent=false)` Toast Path Untested

**Location:** `app/src/hooks/use-workflow-autosave.ts`

The visible-toast path of `handleSave` (when `silent=false`) is not tested; only the silent path has coverage.

**Fix:** Add a test asserting the toast is shown when `silent=false`.

### TF-08 — Medium — `clarifications-editor.tsx` "Other" Choice Path Untested

**Location:** `app/src/components/clarifications-editor.tsx`

The `is_other: true` path (custom answer flow) is not exercised at the component level.

**Fix:** Add a component test that selects "Other", types a custom answer, and asserts the correct payload is emitted.

### TF-09 — Low — `agent-init-error` Event Path Untested

**Location:** `app/src/hooks/use-agent-stream.ts`

The `agent-init-error` event handler has no test coverage.

**Fix:** Add a unit test that emits the event and asserts the appropriate error state is set.

### TF-10 — Low — `joinPath` Has No Tests

**Location:** `app/src/lib/path-utils.ts`

`joinPath` utility has no test coverage.

**Fix:** Add tests for empty segments, trailing slashes, and cross-platform separator behavior.

---

## Test Coverage (Rust/Tauri)

### TC-01 — High — Path Traversal Commands Have No Tests

**Location:** `app/src-tauri/src/commands/workflow/evaluation.rs`

`get_clarifications`, `save_clarifications`, `get_decisions`, `save_decisions` have no tests. The path traversal fix for S-01 has no regression coverage.

**Fix:** Add `#[cfg(test)]` tests for each command covering valid inputs and traversal-attempt inputs (e.g., `skill_name = "../../etc"`).

### TC-02 — High — `save_raw_file` Has No Out-of-Bounds Path Test

**Location:** `app/src-tauri/src/commands/clarification.rs`

No test exercises a path outside the workspace; the fix for S-01 cannot be verified without one.

**Fix:** Add a test asserting `save_raw_file` returns an error when the target path is outside allowed roots.

### TC-03 — High — `reset_legacy_skills` Has No Tests

**Location:** `app/src-tauri/src/commands/workflow/evaluation.rs:481-543`

Bulk-delete command with path construction from caller input has zero test coverage.

**Fix:** Add tests for the normal path, empty input, and traversal-attempt skill names.

### TC-04 — High — `locks.rs` Has No Tests

**Location:** `app/src-tauri/src/db/locks.rs`

Lock acquire, release, and dead-lock reclaim paths are all untested; no `#[cfg(test)]` block exists.

**Fix:** Add tests for acquire-success, acquire-on-held-lock, release, and reclaim-dead-process scenarios.

### TC-05 — High — `commands/git.rs` Has No Tests

**Location:** `app/src-tauri/src/commands/git.rs`

`get_skill_history`, `get_skill_diff`, and `restore_skill_version` have no `#[cfg(test)]` coverage.

**Fix:** Add tests using a temp git repo fixture, covering the happy path and the failed-commit case for `restore_skill_version`.

### TC-06 — Medium — `save_workflow_state` Override Logic Untested

**Location:** `app/src-tauri/src/commands/skill.rs`

The all-steps-completed override path is not exercised by any test.

**Fix:** Add a test that sets all steps complete and asserts the override behavior.

### TC-07 — Medium — `package_skill` Spawn Path Untested

**Location:** `app/src-tauri/src/commands/skill.rs`

`spawn_blocking` path and the missing-`skills_path` early-return are not covered.

**Fix:** Add tests for both paths using a mock or temp directory.

### TC-08 — Medium — `rename_skill_inner` Disk-Failure Path Untested

**Location:** `app/src-tauri/src/commands/skill.rs`

The case where DB commits but disk rename fails is not tested; the inconsistent state is unverified.

**Fix:** Add a test using a read-only target directory to trigger the disk failure after DB commit.

### TC-09 — Medium — `graceful_shutdown` Timeout Path Untested

**Location:** `app/src-tauri/src/commands/`

The `process::exit` branch of `graceful_shutdown` (triggered on timeout) is never exercised.

**Fix:** Add a test with a mock sidecar that never exits; assert the timeout fires and exit is called.

### TC-10 — Low — `generate_suggestions` JSON Parsing and Field Logic Untested

**Location:** `app/src-tauri/src/commands/`

JSON parsing fallback, field projection, and field schema generation are uncovered.

**Fix:** Add unit tests for the parsing fallback and field schema output shape.

### TC-11 — Low — `write_settings` INSERT-OR-REPLACE Not Tested for Side Effects

**Location:** `app/src-tauri/src/db/settings.rs`

No test verifies that re-writing settings via `INSERT OR REPLACE` does not disrupt other tables sharing the same implicit row ID space.

**Fix:** Add a test that writes settings twice and asserts related tables are unaffected.

---

## Test Coverage (Sidecar)

### TS-01 — High — `linkExternalSignal` Has Zero Coverage

**Location:** `app/sidecar/src/shutdown.ts`

Already-aborted and late-abort paths are completely untested.

**Fix:** Add tests for: signal already aborted before link, signal aborted during run, and normal non-aborted run.

### TS-02 — High — Abort Path Not Tested End-to-End

**Location:** `app/sidecar/src/run-agent.ts`

External abort mid-iteration and the resulting `shutdown` `run_result` are not verified end-to-end.

**Fix:** Add a test that aborts via `externalSignal` mid-stream and asserts a `shutdown` run_result is emitted (not `error`).

### TS-03 — High — `pushMessage` Queue Draining Path Untested

**Location:** `app/sidecar/src/stream-session.ts`

The path where a message arrives before the generator parks (queue pre-fill) has zero coverage.

**Fix:** Add a test that calls `pushMessage` synchronously before awaiting the generator, asserting the message is consumed.

### TS-04 — Medium — Setup-Error Path Not Tested

**Location:** `app/sidecar/src/stream-session.ts`

If `discoverInstalledPlugins` throws during setup, the `run_result` emission is not tested.

**Fix:** Mock `discoverInstalledPlugins` to throw and assert a `run_result` with error status is emitted.

### TS-05 — Medium — Duplicate `session_id` Rejection Untested

**Location:** `app/sidecar/src/persistent-mode.ts`

The duplicate session guard is not exercised; error message format is unverified.

**Fix:** Add a test that submits two requests with the same `session_id` and asserts the second is rejected with the expected error.

### TS-06 — Medium — `runMockAgent` Has No Tests

**Location:** `app/sidecar/src/mock-agent.ts`

Happy path, cancellation, unknown agent name, and missing template are all uncovered.

**Fix:** Add tests for each scenario. The CRLF safety fix (CS-07) also needs a regression test here.

### TS-07 — Medium — `processAuthStatusMessage` Not Tested

**Location:** `app/sidecar/src/message-processor.ts`

`auth_status` messages with and without an error field are not exercised.

**Fix:** Add tests for both the success and error variants of `auth_status`.

### TS-08 — Low — `discoverInstalledPlugins` Error Behavior Undocumented by Test

**Location:** `app/sidecar/src/run-agent.ts`

Swallowed-error behavior on permission failure is not documented or verified by test.

**Fix:** Add a test that mocks a permission-denied error from the discovery function and asserts the session continues (or fails explicitly).

---

## E2E Coverage Gaps

### E2E-CG-01 — High — Skills Library Page Completely Untested

**Location:** `app/e2e/`

Browse, toggle active, delete, export, GitHub import, and file import flows on the Skills Library page have no E2E coverage.

**Fix:** Add a spec covering at minimum: listing skills, toggling active state, and triggering a delete with confirmation.

### E2E-CG-02 — High — Settings Save Flow Untested

**Location:** `app/e2e/`

`save_settings`, workspace/skills path configuration, and settings-reload are uncovered. Only the API key entry test exists.

**Fix:** Add a spec that saves workspace and skills paths and asserts the values persist after navigation.

### E2E-CG-03 — High — Startup Dependency Failure Untested

**Location:** `app/e2e/`

The `agent-init-error` path (missing Node.js, failed sidecar startup) has zero E2E coverage despite mock support existing.

**Fix:** Add a spec using the mock override to inject an `agent-init-error` event and assert the error UI renders.

### E2E-CG-04 — High — Skill Tester Completion and Results UI Untested

**Location:** `app/e2e/`

The "done" phase, comparison panel, and final score of the skill tester are not tested end-to-end.

**Fix:** Add a spec that runs the tester to completion and asserts the results panel and score are visible.

### E2E-CG-05 — Medium — API Key Invalid/Error Path Untested

**Location:** `app/e2e/`

`test_api_key` always returns true in mocks; the invalid-key error path is never exercised.

**Fix:** Add a mock override that returns a failed result and assert the error state is displayed.

### E2E-CG-06 — Medium — Post-Delete Dashboard State Not Verified

**Location:** `app/e2e/`

After confirming a skill deletion, no assertion verifies the skill card disappears from the dashboard.

**Fix:** Assert the deleted skill's card is no longer visible in the DOM after the confirmation dialog closes.

### E2E-CG-07 — Medium — Gate "Run Research Anyway" Path Untested

**Location:** `app/e2e/`

The "Run Research Anyway" button path through Gate 1 is not covered.

**Fix:** Add a test case within the gate spec that clicks "Run Research Anyway" and asserts the workflow advances.

### E2E-CG-08 — Medium — Workflow Steps 3 and 4 Have No Coverage

**Location:** `app/e2e/`

Generate Skill (step 3) and Confirm Decisions (step 4) have no smoke-level coverage.

**Fix:** Extend the workflow happy-path spec to pass through steps 3 and 4 using mock agent responses.

### E2E-CG-09 — Low — Reconciliation/Orphan-Cleanup Notification UI Untested

**Location:** `app/e2e/`

The notification UI shown after orphan cleanup has no test coverage.

**Fix:** Add a spec that triggers reconciliation via mock and asserts the notification renders.

### E2E-CG-10 — Low — Usage Dashboard Page Has No Tests

**Location:** `app/e2e/`

Billing, sessions, and chart rendering on the usage dashboard page are uncovered.

**Fix:** Add a smoke spec that navigates to the usage dashboard and asserts the page renders without errors.

---

## E2E Test Quality

### E2E-TQ-01 — High — `display-items.spec.ts` Tag Never Runs in CI

**Location:** `app/e2e/display-items.spec.ts`

Tagged `@workflow-agent`, which matches neither the smoke nor nightly CI project grep patterns. The entire spec silently never executes in CI.

**Fix:** Change the tag to `@workflow` (or whichever pattern is configured in the Playwright project grep), or add `@workflow-agent` to the CI grep config.

### E2E-TQ-02 — High — `setup-screen.spec.ts` Wrong Tag

**Location:** `app/e2e/setup-screen.spec.ts`

Tagged `@workflow` instead of `@setup`. The `@setup` tag exists in the grep config but is never assigned to any spec, so setup flows never run in CI.

**Fix:** Change the tag to `@setup`.

### E2E-TQ-03 — High — `workflow-gate.spec.ts` Uses 7 Bare `waitForTimeout` Calls

**Location:** `app/e2e/workflow-gate.spec.ts`

Seven `waitForTimeout(50–500ms)` calls substitute for event-driven synchronization. These are a primary source of flakiness under CI load.

**Fix:** Replace each `waitForTimeout` with `waitFor` on a specific element, attribute, or network event.

### E2E-TQ-04 — Medium — Gate Dialog Closed State Not Asserted Before Next Step

**Location:** `app/e2e/workflow-gate.spec.ts`

Tests assert the next workflow step without first asserting the dialog has closed. A timing window exists where assertions pass before the UI has settled.

**Fix:** Assert `dialog` is not visible (or the close animation completes) before asserting the step that follows.

### E2E-TQ-05 — Medium — `refine.spec.ts` Slash Command Uses `waitForTimeout`

**Location:** `app/e2e/refine.spec.ts`

`waitForTimeout(100)` gates whether the command picker has opened. Replace with `waitFor` on the picker's DOM element.

**Fix:** `await expect(page.locator('[data-testid="command-picker"]')).toBeVisible()`.

### E2E-TQ-06 — Medium — `display-items.spec.ts` Tool Call Status Asserted with Timing Gap

**Location:** `app/e2e/display-items.spec.ts`

`wait(100)` precedes a status assertion for a tool call status change from `pending` to `ok`; this is racy.

**Fix:** Use `waitFor` on the status attribute directly.

### E2E-TQ-07 — Medium — `dashboard-smoke.spec.ts` Create Skill Form Doesn't Assert Navigation

**Location:** `app/e2e/dashboard-smoke.spec.ts`

After submitting the "create skill" form, neither the new skill's appearance nor the workflow navigation is asserted.

**Fix:** Assert the workflow page URL or a workflow-step heading is visible after form submission.

### E2E-TQ-08 — Medium — Specs Import `useAgentStore` via Vite-Relative URL

**Location:** `app/e2e/skill-tester.spec.ts`, `app/e2e/test-to-refine.spec.ts`

Store is imported via a Vite-relative URL path. If the URL changes these imports silently fail without a compile error.

**Fix:** Use the module alias configured in `vite.config.ts` or import via the standard `@/stores/...` path.

### E2E-TQ-09 — Medium — `test-to-refine.spec.ts` Asserts `callCount >= 1` Instead of `=== 1`

**Location:** `app/e2e/test-to-refine.spec.ts`

`callCount >= 1` allows re-render loops to pass silently; exactly one call should be expected.

**Fix:** Change to `toEqual(1)` or `toBe(1)`.

### E2E-TQ-10 — Low — `desktop-smoke.spec.ts` Workflow Path Doesn't Assert Display Items

**Location:** `app/e2e/desktop-smoke.spec.ts`

The "workflow happy path" test completes without asserting that any display items rendered.

**Fix:** Assert at least one display item (e.g., agent message or tool call) is visible in the output panel.

---

## E2E Structural Issues

### E2E-SI-01 — High — Hardcoded Windows Path and Non-`path.join` Concatenation

**Location:** `app/e2e/helpers/test-paths.ts`, `app/e2e/helpers/tauri-e2e.ts`

`test-paths.ts` contains a hardcoded `"C:/skill-builder-test"` absolute path. `joinE2ePath` concatenates with `"/"` instead of `path.join()`. `tauri-e2e.ts` independently duplicates path constants.

**Fix:** Replace hardcoded path with `path.join(os.tmpdir(), "skill-builder-test")`. Use `path.join()` in `joinE2ePath`. Deduplicate constants into a single source per `.claude/rules/windows-compat.md`.

### E2E-SI-02 — Medium — Mock Override Merging Uses Shallow Spread

**Location:** `app/e2e/helpers/`

No deep-merge utility exists; tests must re-specify entire nested objects for partial overrides.

**Fix:** Introduce a `deepMerge` helper (or use `lodash.merge`) for mock overrides.

### E2E-SI-03 — Medium — `reloadDashboardWithOverrides` Duplicates Navigation Logic

**Location:** `app/e2e/`

This local helper duplicates the `navigateToWorkflow` pattern; should be consolidated into the shared helper set.

**Fix:** Extract into the shared helpers and remove the local copy.

### E2E-SI-04 — Medium — `display-items.spec.ts` Repeats 5-Line Setup in Every Test

**Location:** `app/e2e/display-items.spec.ts`

Identical setup block duplicated in every test case instead of a `beforeEach`.

**Fix:** Move to `beforeEach`.

### E2E-SI-05 — Medium — Gate Agent ID Hardcoded in 3 Places

**Location:** `app/e2e/workflow-gate.spec.ts`

The gate agent ID literal appears three times with no named constant.

**Fix:** Extract to a `const GATE_AGENT_ID = "..."` at the top of the file.

### E2E-SI-06 — Low — `simulateAgentRun` Does Not Expose `resultStatus` Override

**Location:** `app/e2e/helpers/`

Tests wanting non-success result statuses must bypass the helper entirely.

**Fix:** Add an optional `resultStatus` parameter to `simulateAgentRun` with a default of `"success"`.

### E2E-SI-07 — Low — Stale Fixture Files Never Imported

**Location:** `app/e2e/fixtures/research-step.json`, `app/e2e/fixtures/review-content.json`

Both fixture files exist in the repo but are not imported by any spec.

**Fix:** Delete them or add a comment documenting their intended use.

---

## Pending Recommendations

Prioritized by impact × effort. Top 15 actionable items.

| # | ID(s) | Severity | Area | Action |
|---|---|---|---|---|
| 1 | S-01, TC-01, TC-02, TC-03 | Critical/High | Security | Add `validate_skill_name` and allowed-roots checks to all path-constructing commands; add regression tests for traversal inputs |
| 2 | S-03, A1 | Critical/High | Security/Arch | Re-enable `PRAGMA foreign_keys = ON` after migrations; add a DB connection test asserting FK enforcement is on |
| 3 | S-02 | High | Security | Cap base64 write size with `MAX_BASE64_FILE_SIZE`; add depth limit and symlink-cycle detection to `collect_entries` |
| 4 | E2E-TQ-01, E2E-TQ-02 | High | E2E | Fix CI tags on `display-items.spec.ts` and `setup-screen.spec.ts` so they actually run in CI |
| 5 | E2E-TQ-03 | High | E2E | Replace 7 `waitForTimeout` calls in `workflow-gate.spec.ts` with event-driven `waitFor` assertions |
| 6 | E2E-SI-01 | High | E2E | Fix hardcoded Windows path and non-`path.join` concatenation in E2E path helpers |
| 7 | TC-04, TC-05 | High | Rust Tests | Add `#[cfg(test)]` coverage to `locks.rs` and `commands/git.rs` |
| 8 | TF-02, TF-03 | High | Frontend Tests | Add unit tests for gate evaluation paths and step-completion error paths in `use-workflow-state-machine` |
| 9 | TS-01, TS-02, TS-03 | High | Sidecar Tests | Add tests for `linkExternalSignal`, abort end-to-end path, and `pushMessage` queue draining |
| 10 | CS-01, CS-02 | High | Sidecar | Fix `pushMessage` silent message loss in mock mode; track `StreamSession` promises in shutdown drain |
| 11 | TQI-1 (frontend) / TQI-1 (sidecar) | High | Test Quality | Fix mock store not applying `set()` in `use-workflow-state-machine.test.ts`; fix double-cast type error in `stream-session.test.ts` |
| 12 | S-04, S-06 | Medium | Security | Introduce `ApiKey` newtype with redacted `Debug`; move settings migration out of `get_settings` read path |
| 13 | CF-02 | High | Frontend | Replace hardcoded step indices 0–3 with `WORKFLOW_STEP_DEFINITIONS` lookup |
| 14 | E2E-CG-01, E2E-CG-02, E2E-CG-03 | High | E2E Coverage | Add E2E specs for Skills Library page, Settings save flow, and startup dependency failure |
| 15 | CQ-02 (locks), CQ-03 | Medium | Rust | Fix `acquire_skill_lock` missing ROLLBACK on early exit; normalize `model` in `persist_agent_run` shutdown guard |
