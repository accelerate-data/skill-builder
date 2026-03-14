# Code Review: Skill Builder — 2026-03-14b

## Executive Summary

Five parallel agents reviewed the frontend, Rust/Tauri backend, Node.js sidecar, E2E test suite, and security/architecture layers. This document has been reconciled against all remediation work completed in the integration branch. Resolved findings have been removed; only open items remain.

**Reconciled:** 2026-03-14 (after commits `efd975f`, `3bf033d`, `4c85382`, `7b2c861`, `b5b4979`)

**Remaining finding counts by severity:**

| Severity | Security | Code Quality | Test Coverage | E2E Coverage | Total |
|---|---|---|---|---|---|
| Critical | 1 | 0 | 0 | 0 | 1 |
| High | 2 | 1 | 5 | 2 | 10 |
| Medium | 4 | 1 | 8 | 1 | 14 |
| Low | 3 | 2 | 3 | 1 | 9 |
| **Total** | **10** | **4** | **16** | **4** | **34** |

---

## Security (All Open — Excluded from Remediation Scope)

### S-01 — Critical — Path Traversal: Arbitrary Filesystem Write

**Location:** `app/src-tauri/src/commands/clarification.rs:5-21`, `commands/workflow/evaluation.rs:232-277`, `commands/workflow/evaluation.rs:481-543`

`save_raw_file` accepts arbitrary absolute paths with no allowed-roots check. `get/save_clarifications/decisions` and `reset_legacy_skills` join caller-supplied `skill_name` to workspace path without validation, enabling `../../../etc` traversal. Any Tauri frontend caller can write or delete arbitrary filesystem locations.

**Fix:** Validate all caller-supplied paths against allowed roots (e.g., workspace root and skill output dir) before use. Apply `validate_skill_name` to `skill_name` parameters in every evaluation command. Add regression tests for out-of-bounds path inputs (see TC-01, TC-02, TC-03).

### S-02 — High — Unbounded Base64 Write and Recursive Directory Traversal

**Location:** `app/src-tauri/src/commands/files.rs:428-457` (write), `files.rs:52-92` (collect_entries)

`write_base64_to_temp_file` has no size limit on the decoded payload; `MAX_BASE64_FILE_SIZE` guards reads but not writes, allowing multi-hundred-MB allocations. `collect_entries` performs unbounded recursive directory traversal with no depth cap and no symlink-cycle detection; a symlink loop causes infinite recursion. Both issues are reachable via normal Tauri IPC.

**Fix:** Apply `MAX_BASE64_FILE_SIZE` (or a separate write limit) before decoding. Add a `MAX_DEPTH` constant to `collect_entries` and detect symlink cycles before recursing.

### S-03 — High — Foreign Key Enforcement Silently Disabled at Runtime

**Location:** `app/src-tauri/src/db/mod.rs:67-68`

The `foreign_keys` pragma is disabled before running migrations and never re-enabled, making all `ON DELETE CASCADE` rules inert at runtime.

**Fix:** Re-enable `PRAGMA foreign_keys = ON` after migrations complete. Add a test asserting `PRAGMA foreign_keys` returns `1` on a live connection.

### S-04 — Medium — API Key Logged via Tauri Debug Instrumentation

**Location:** `app/src-tauri/src/commands/settings.rs:338-367`

`api_key` flows through Tauri IPC as a plain string. Tauri debug logging records all command arguments, exposing the key in debug builds.

**Fix:** Introduce a newtype wrapper `struct ApiKey(String)` with `impl Debug` that emits `"[REDACTED]"`.

### S-05 — Medium — `get_context_file_content` Missing Null-Byte and Reserved-Name Rejection

**Location:** `app/src-tauri/src/commands/workflow/evaluation.rs:309-321`

Path is joined from caller input but not canonicalized or checked for null bytes or Windows reserved names.

**Fix:** Canonicalize the joined path and validate it is within the allowed root before opening. Reject inputs containing null bytes or matching Windows reserved name patterns.

### S-06 — Medium — Side-Effectful Read: `get_settings` Runs Migrations Under Lock on Every Call

**Location:** `app/src-tauri/src/commands/settings.rs:27-96`, `db/mod.rs`

`get_settings` performs two write operations (marketplace migration + normalization) on every read call while holding the global `Mutex<Connection>`.

**Fix:** Run migration and normalization once at startup or lazily with a one-time guard, not on every read.

### S-07 — Low — GitHub Client ID Hardcoded with No Explanatory Comment

**Location:** `app/src-tauri/src/commands/github_auth.rs:4`

**Fix:** Add a comment: `// Public client ID — intentional for OAuth device flow; not a secret.`

### S-08 — Low — `diff_settings` Logs Marketplace URL Value

**Location:** `app/src-tauri/src/commands/settings.rs:208`

**Fix:** Log `"marketplace_url changed"` without the value, or log at `debug` level only.

### S-09 — Low — `std::sync::Mutex` in Async Context (Sidecar Pool)

**Location:** `app/sidecar/src/sidecar_pool.rs`

**Fix:** Document the invariant that the mutex is never held across `.await`, or replace with `tokio::sync::Mutex`.

---

## Code Quality (Open)

### CF-05 — Medium — Double Cleanup on Navigation

**Location:** `app/src/hooks/use-workflow-session.ts:43-70`

Both the unmount effect and the `onLeave` callback call `endWorkflowSession`/`cleanupSkillSidecar`, sending two sidecar shutdown commands on navigation. The second call is a no-op but creates unnecessary IPC noise.

**Deferred rationale:** Both calls are fire-and-forget and idempotent. Low correctness risk.

### CS-02 — High — Shutdown Does Not Await Active `StreamSession` Promises

**Location:** `app/sidecar/src/persistent-mode.ts:232-240`

`shutdown` awaits in-flight `agent_requests` but not `StreamSession.runQuery` promises. Active sessions can lose their final `run_result` event on shutdown.

**Deferred rationale:** Mitigated by close-before-shutdown ordering — `stream_close` arrives before `shutdown` in practice.

### CF-08 — Low — `normalizeDirectoryPickerPath` Is Case-Sensitive

**Location:** `app/src/lib/utils.ts:53-71`

The doubled-segment detection comparison is case-sensitive and will miss the bug on case-insensitive filesystems.

**Deferred rationale:** Theoretical — OS pickers return consistent casing.

### CS-06 — Low — Hardcoded 20ms Delay in Mock Turn Emission

**Location:** `app/sidecar/src/stream-session.ts:341`

**Deferred rationale:** 20ms is negligible; injecting delay as constructor param adds complexity for no real benefit.

---

## Test Coverage — Frontend (Open)

### TF-02 — High — Gate Evaluation Paths Entirely Untested

**Location:** `app/src/hooks/use-workflow-state-machine.ts`

`finishGateEvaluation`, `runGateOrAdvance`, `handleGateSkip`, `handleGateResearch`, `handleGateContinueAnyway`, and `buildGateFeedbackNotes` have no test coverage.

### TF-03 — High — Step-Completion Error Paths Untested

**Location:** `app/src/hooks/use-workflow-state-machine.ts`

Null `structuredOutput` and `verifyStepOutput` returning `false` paths are not tested.

### TF-05 — Medium — `resetCounter` Not Verified to Pass `null` modelFamily

**Location:** `app/src/stores/usage-store.ts`

### TF-06 — Medium — `consumeUpdateMode` Finally-Block Path Untested

**Location:** `app/src/hooks/use-workflow-persistence.ts`

### TF-07 — Medium — `handleSave(silent=false)` Toast Path Untested

**Location:** `app/src/hooks/use-workflow-autosave.ts`

### TF-08 — Medium — `clarifications-editor.tsx` "Other" Choice Path Untested

**Location:** `app/src/components/clarifications-editor.tsx`

### TF-09 — Low — `agent-init-error` Event Path Untested

**Location:** `app/src/hooks/use-agent-stream.ts`

---

## Test Coverage — Rust/Tauri (Open)

### TC-01 — High — Path Traversal Commands Have No Tests

**Location:** `app/src-tauri/src/commands/workflow/evaluation.rs`

Blocked on S-01 fix — regression tests for traversal inputs depend on the validation logic being implemented first.

### TC-02 — High — `save_raw_file` Has No Out-of-Bounds Path Test

**Location:** `app/src-tauri/src/commands/clarification.rs`

Blocked on S-01 fix.

### TC-03 — High — `reset_legacy_skills` Has No Tests

**Location:** `app/src-tauri/src/commands/workflow/evaluation.rs:481-543`

Blocked on S-01 fix.

### TC-06 — Medium — `save_workflow_state` Override Logic Untested

**Location:** `app/src-tauri/src/commands/skill.rs`

### TC-07 — Medium — `package_skill` Spawn Path Untested

**Location:** `app/src-tauri/src/commands/skill.rs`

### TC-08 — Medium — `rename_skill_inner` Disk-Failure Path Untested

**Location:** `app/src-tauri/src/commands/skill.rs`

### TC-09 — Medium — `graceful_shutdown` Timeout Path Untested

**Location:** `app/src-tauri/src/commands/`

### TC-10 — Low — `generate_suggestions` JSON Parsing and Field Logic Untested

**Location:** `app/src-tauri/src/commands/`

### TC-11 — Low — `write_settings` INSERT-OR-REPLACE Not Tested for Side Effects

**Location:** `app/src-tauri/src/db/settings.rs`

---

## Test Coverage — Sidecar (Open)

### TS-05 — Medium — Duplicate `session_id` Rejection Untested

**Location:** `app/sidecar/src/persistent-mode.ts`

### TS-08 — Low — `discoverInstalledPlugins` Error Behavior Undocumented by Test

**Location:** `app/sidecar/src/run-agent.ts`

---

## E2E Coverage Gaps (Open)

### E2E-CG-01 — High — Skills Library Page Completely Untested

**Location:** `app/e2e/`

Browse, toggle active, delete, export, GitHub import, and file import flows on the Skills Library page have no E2E coverage.

### E2E-CG-02 — High — Settings Save Flow Untested

**Location:** `app/e2e/`

`save_settings`, workspace/skills path configuration, and settings-reload are uncovered.

### E2E-CG-08 — Medium — Workflow Steps 3 and 4 Have No Coverage

**Location:** `app/e2e/`

Generate Skill (step 3) and Confirm Decisions (step 4) have no smoke-level coverage.

### E2E-TQ-10 — Low — `desktop-smoke.spec.ts` Workflow Path Doesn't Assert Display Items

**Location:** `app/e2e/desktop-smoke.spec.ts`

---

## Pending Recommendations

Prioritized by impact × effort. Open items only.

| # | ID(s) | Severity | Area | Action |
|---|---|---|---|---|
| 1 | S-01, TC-01, TC-02, TC-03 | Critical/High | Security | Add `validate_skill_name` and allowed-roots checks to all path-constructing commands; add regression tests |
| 2 | S-03 | High | Security | Re-enable `PRAGMA foreign_keys = ON` after migrations; add FK enforcement test |
| 3 | S-02 | High | Security | Cap base64 write size; add depth limit and symlink-cycle detection to `collect_entries` |
| 4 | TF-02, TF-03 | High | Frontend Tests | Add unit tests for gate evaluation paths and step-completion error paths |
| 5 | E2E-CG-01, E2E-CG-02 | High | E2E Coverage | Add E2E specs for Skills Library page and Settings save flow |
| 6 | S-04, S-06 | Medium | Security | Introduce `ApiKey` newtype; move settings migration out of read path |
| 7 | E2E-CG-08 | Medium | E2E Coverage | Extend workflow spec through steps 3 and 4 |
