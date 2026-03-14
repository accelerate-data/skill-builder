# Code Review: Skill Builder — 2026-03-14b

## Executive Summary

Five parallel agents reviewed the frontend, Rust/Tauri backend, Node.js sidecar, E2E test suite, and security/architecture layers. All critical and high-severity findings have been resolved. The remaining items are low-priority test coverage gaps and deferred code quality items.

**Reconciled:** 2026-03-14 (after all recommendation commits through `e8d7495`)

**Resolved in this cycle:**

- **S-01** (Critical): `validate_skill_name` + allowed-roots validation on `save_raw_file` — `5b9a0f0`
- **S-02** (High): Base64 write size cap + `MAX_COLLECT_DEPTH` + symlink skip — `c97e47f`
- **S-03** (High): `PRAGMA foreign_keys = ON` re-enabled after migrations — `c5b957b`
- **S-04** (Medium): `ApiKey` newtype with `Debug` → `[REDACTED]` — `f349946`
- **S-06** (Medium): Settings migration moved from `get_settings` read path to `init_db` startup — `f349946`
- **S-05** (Medium): Null bytes rejected by `validate_skill_name`; `file_name` already validated in `get_context_file_content`
- **S-09** (Low): Invalid finding — `sidecar_pool.rs` already uses `tokio::sync::Mutex`
- **TF-02/03** (High): 20 gate evaluation + step-completion error path tests — `2559e8f`
- **TC-01/02/03** (High): Path traversal regression tests in `validate_skill_name` + `save_raw_file_inner` — `5b9a0f0`
- **E2E-CG-01/02** (High): Skills Library + Settings save E2E specs — `da627d2`
- **E2E-CG-08** (Medium): Workflow steps 3-4 smoke coverage — `e8d7495`

Plus 35 earlier fixes from the test gap session (`efd975f` through `b5b4979`).

**Remaining finding counts:**

| Severity | Code Quality | Test Coverage | Total |
|---|---|---|---|
| High | 1 | 0 | 1 |
| Medium | 1 | 5 | 6 |
| Low | 3 | 5 | 8 |
| **Total** | **5** | **10** | **15** |

No critical or high-severity security findings remain.

---

## Code Quality (Open — Deferred)

### CS-02 — High — Shutdown Does Not Await Active `StreamSession` Promises

**Location:** `app/sidecar/persistent-mode.ts:232-240`

`shutdown` awaits in-flight `agent_requests` but not `StreamSession.runQuery` promises. Active sessions can lose their final `run_result` event on shutdown.

**Deferred rationale:** Mitigated by close-before-shutdown ordering — `stream_close` arrives before `shutdown` in practice. Fix requires tracking all active session promises in a drain set, which is medium effort for an edge-case race.

### CF-05 — Medium — Double Cleanup on Navigation

**Location:** `app/src/hooks/use-workflow-session.ts`

Both the unmount effect and the `onLeave` callback call `endWorkflowSession`/`cleanupSkillSidecar`. Both are fire-and-forget and idempotent — two extra no-op IPC calls per navigation.

### S-07 — Low — GitHub Client ID Hardcoded with No Explanatory Comment

**Location:** `app/src-tauri/src/commands/github_auth.rs:4`

Add `// Public client ID — intentional for OAuth device flow; not a secret.`

### CF-08 — Low — `normalizeDirectoryPickerPath` Is Case-Sensitive

**Location:** `app/src/lib/utils.ts:53-71`

Theoretical — OS pickers return consistent casing; the doubled-segment bug requires mismatched case on a case-insensitive FS.

### CS-06 — Low — Hardcoded 20ms Delay in Mock Turn Emission

**Location:** `app/sidecar/stream-session.ts:341`

Negligible timing impact; abstraction adds complexity for no real benefit.

---

## Test Coverage — Remaining Gaps

These are all medium-to-low priority edge-case test gaps. None affect critical user-facing paths.

### Frontend

| ID | Severity | Location | Gap |
|---|---|---|---|
| TF-05 | Medium | `stores/usage-store.ts` | `resetCounter` not verified to pass `null` modelFamily |
| TF-06 | Medium | `hooks/use-workflow-persistence.ts` | `consumeUpdateMode` finally-block path untested |
| TF-07 | Medium | `hooks/use-workflow-autosave.ts` | `handleSave(silent=false)` toast path untested |
| TF-08 | Medium | `components/clarifications-editor.tsx` | "Other" choice path untested |
| TF-09 | Low | `hooks/use-agent-stream.ts` | `agent-init-error` event path untested |

### Rust/Tauri

| ID | Severity | Location | Gap |
|---|---|---|---|
| TC-06 | Medium | `commands/skill.rs` | `save_workflow_state` all-completed override logic untested |
| TC-07 | Medium | `commands/skill.rs` | `package_skill` spawn path untested |
| TC-08 | Medium | `commands/skill.rs` | `rename_skill_inner` disk-failure path untested |
| TC-09 | Medium | `commands/` | `graceful_shutdown` timeout path untested |
| TC-10 | Low | `commands/` | `generate_suggestions` JSON parsing untested |
| TC-11 | Low | `db/settings.rs` | `write_settings` INSERT-OR-REPLACE side effects untested |

### Sidecar

| ID | Severity | Location | Gap |
|---|---|---|---|
| TS-05 | Medium | `persistent-mode.ts` | Duplicate `session_id` rejection untested |
| TS-08 | Low | `run-agent.ts` | `discoverInstalledPlugins` error behavior untested |

### E2E

| ID | Severity | Location | Gap |
|---|---|---|---|
| E2E-TQ-10 | Low | `desktop-smoke.spec.ts` | Workflow path doesn't assert display items |

---

## Pending Recommendations

Only items with meaningful impact remaining.

| # | ID | Severity | Area | Action | Effort |
|---|---|---|---|---|---|
| 1 | CS-02 | High | Sidecar | Track active `StreamSession` promises in shutdown drain set | M |
| 2 | S-07 | Low | Rust | Add 1-line comment to GitHub client ID | Trivial |
