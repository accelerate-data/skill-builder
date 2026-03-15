# Code Review Findings — 2026-03-15

Review of PR #167 (`feature/vu-561-create-integration-branch-from-main-and-merge-jason_clone`) at commit `a6b8866cc675ae97b56cf856199d7735e947780f`.

Branch contains 70 commits, 150 files changed (+22,148/-17,324). Covers security hardening, architecture refactoring (monolith splits), code quality fixes, test coverage expansion, and E2E improvements.

## Methodology

- 8 parallel review agents (Rust backend, frontend/sidecar, test coverage, CLAUDE.md compliance, shallow bug scan, git history, prior PR comments, code comments compliance)
- 12 parallel confidence-scoring agents verified each finding against actual code
- Findings below threshold (score < 75) or confirmed false positives are excluded

## Findings

### S-01: GitHub OAuth token silently wiped on every app startup (Critical, score 75)

**Files:** `app/src/stores/auth-store.ts:45`, `app/src-tauri/src/commands/settings.rs:529-553`

`loadUser()` (called at app startup from `app-layout.tsx`) and `setUser()` (called after OAuth login) both invoke `updateGithubIdentity(login, avatar, email, null)` — passing `null` for the token parameter. The Rust `update_github_identity` command unconditionally assigns `settings.github_oauth_token = token` at line 550, which clears the stored token in the DB.

**Impact:** After OAuth login, the next `loadUser` call wipes the token. `github_get_user_impl` returns `None` when token is `None`, so the user appears logged out on every app restart. GitHub authentication is silently broken across sessions.

**Fix:** `update_github_identity` should only update the token field when `token` is `Some`:

```rust
if let Some(t) = token { settings.github_oauth_token = Some(t); }
```

Alternatively, callers should stop passing `null` for the token from the profile-update path (`loadUser`/`setUser`).

**Status:** Resolved — `update_github_identity` now skips token when `None` (`f2b9865`+)

---

### S-02: All new FK columns lack ON DELETE CASCADE (Critical, score 75)

**Files:** `app/src-tauri/src/db/migrations.rs:840-884`

**Rule:** `.claude/rules/rust-backend.md` — "Define foreign keys with `ON DELETE CASCADE` for app table relationships so parent deletes clean up dependent rows."

Migration 23 (`run_fk_columns_migration`) adds FK columns to 7 tables without `ON DELETE CASCADE`:

- `workflow_steps.workflow_run_id REFERENCES workflow_runs(id)` (line 840)
- `workflow_artifacts.workflow_run_id REFERENCES workflow_runs(id)` (line 847)
- `agent_runs.workflow_run_id REFERENCES workflow_runs(id)` (line 854)
- `skill_tags.skill_id REFERENCES skills(id)` (line 861)
- `skill_locks.skill_id REFERENCES skills(id)` (line 868)
- `workflow_sessions.skill_id REFERENCES skills(id)` (line 875)
- `imported_skills.skill_master_id REFERENCES skills(id)` (line 882)

**Impact:** With `PRAGMA foreign_keys = ON` (enabled at `db/mod.rs:93`), deleting a skill or workflow_run will fail at runtime if child rows exist, because the FK constraint blocks the delete but no cascade cleans up children.

**Fix:** Add `ON DELETE CASCADE` to each FK definition. Since these are `ALTER TABLE ADD COLUMN`, a new migration is required (SQLite cannot alter column constraints in place).

**Status:** Resolved — migration 37 recreates 8 tables (7 from S-02 + workflow_runs) with ON DELETE CASCADE

---

### S-03: PII logged in update_github_identity (High, score 75)

**File:** `app/src-tauri/src/commands/settings.rs:536-541`

**Rule:** `.claude/rules/logging-policy.md` — "Never log ... PII values and sensitive payload fields"

The entry log prints the GitHub `login` value verbatim:

```rust
log::info!(
    "[update_github_identity] login={:?} avatar={} token={}",
    login,  // <-- PII logged verbatim
    avatar.as_deref().map(|_| "[set]").unwrap_or("[none]"),
    token.as_deref().map(|_| "[set]").unwrap_or("[none]"),
);
```

Token and avatar are correctly masked with `[set]`/`[none]`, but `login` is printed as-is.

**Fix:** Mask login the same way: `login.as_deref().map(|_| "[set]").unwrap_or("[none]")`

**Status:** Resolved — login now masked with `[set]`/`[none]` pattern matching token and avatar

---

### S-04: Hardcoded `/tmp` in sidecar test assertions (High, score 100)

**File:** `app/sidecar/__tests__/config.test.ts:48,200`

**Rule:** `.claude/rules/windows-compat.md` — "Never use hardcoded forward-slash strings or Unix-style literals (`/tmp/...`) in test assertions or path construction."

Two test assertions use hardcoded Unix paths:

```ts
expect(result.cwd).toBe("/tmp");   // line 48
expect(redacted.cwd).toBe("/tmp"); // line 200
```

**Fix:** Use `os.tmpdir()` or set the mock config's `cwd` to `os.tmpdir()` and assert against that.

**Status:** Resolved — all `/tmp` literals replaced with `os.tmpdir()` via `TEST_CWD` constant

---

### S-05: `workflow_artifacts.rs` missing from `repo-map.json` (High, score 100)

**File:** `repo-map.json:111`

**Rule:** AGENTS.md — "Pre-PR repo-map.json audit (required): ... rust_commands flat-file list matches every .rs file directly under app/src-tauri/src/commands/"

The new file `app/src-tauri/src/commands/workflow_artifacts.rs` exists on disk but is absent from the `rust_commands` flat-file list in `repo-map.json`. The current list ends with `test_utils` and does not mention `workflow_artifacts`.

**Fix:** Add `workflow_artifacts` to the flat files list in `repo-map.json` under `rust_commands.description`.

**Status:** Resolved — full audit: added `workflow_artifacts` to rust_commands, fixed db tests.rs attribution (was "all tests" in mod.rs), added `secret.rs` to types, alphabetized flat file list

---

### S-06: Missing `error!` on failure in 3 Tauri commands (Medium, score 75)

**Files:** `app/src-tauri/src/commands/settings.rs:462-505,529-553`, `app/src-tauri/src/commands/refine/output.rs:142-154`

**Rule:** `.claude/rules/coding-conventions.md` / `.claude/rules/rust-backend.md` — "Every `#[tauri::command]` logs `error!` on failure"

Three commands propagate failures via `?` without `log::error!()`:

1. `update_user_settings` — `read_settings`, `handle_skills_path_change`, `write_settings` failures (lines 479, 484, 503) are silent. Only the DB lock failure is logged.
2. `update_github_identity` — `read_settings` (line 546) and `write_settings` (line 551) failures are silent.
3. `materialize_refine_validation_output` — inner function failure (line 153) propagates without logging.

**Fix:** Add `map_err` with `log::error!` before `?` on each fallible call, or use a helper that logs before returning the error.

**Status:** Resolved — added `map_err` with `log::error!` on all fallible calls in all 3 commands

---

### S-07: `create_skill_inner` lost transaction wrapper during refactoring — regression (Critical, score 75)

**File:** `app/src-tauri/src/commands/skill/crud.rs:324-359`

**Rules:**

- `.claude/rules/rust-backend.md` — "Wrap multi-table write flows in a transaction and commit once"
- `.claude/rules/coding-conventions.md` — "Every `#[tauri::command]` logs `error!` on failure"

**Regression:** Git history analysis (commit `83b3049`, "refactor: split commands/skill.rs into concern-based sub-modules") confirms that the original `create_skill_inner` on main was wrapped in a `BEGIN`/`COMMIT`/`ROLLBACK` transaction with proper `?` error propagation on all DB writes. The refactoring accidentally dropped the transaction and demoted three DB writes to `let _ =` (silent error swallowing):

```rust
crate::db::save_workflow_run(conn, name, 0, "pending", purpose)?;      // line 325
crate::db::set_skill_tags(conn, name, tags)?;                          // line 329
let _ = crate::db::set_skill_author(conn, name, login, author_avatar); // line 334 — was ?
let _ = crate::db::set_skill_intake(conn, name, Some(ij));             // line 338 — was ?
let _ = crate::db::set_skill_behaviour(conn, ...);                     // line 348 — was ?
```

**Impact:** If `set_skill_tags` fails, `save_workflow_run` is already committed, leaving an orphaned skill with no tags/author/metadata. The reconciler does not clean this up. Failures in `set_skill_author`, `set_skill_intake`, and `set_skill_behaviour` are silently lost — skills can be created with blank attribution.

**Fix:** Restore the `BEGIN`/`COMMIT`/`ROLLBACK` transaction wrapper and change `let _ =` back to `?` propagation (or at minimum `log::warn!`).

**Status:** Resolved — restored BEGIN/COMMIT/ROLLBACK transaction, replaced `let _ =` with `?` + `log::warn!`

---

### S-08: Missing size-limit boundary tests for text read/write (Medium, score 75)

**File:** `app/src-tauri/src/commands/files.rs:248-256,277-282`

The code enforces 50MB limits via `MAX_TEXT_FILE_SIZE` (line 248) and `MAX_WRITE_SIZE` (line 277). Tests exist for the base64 size limit (`test_read_file_as_base64_exceeds_size_limit`, `test_read_file_as_base64_at_size_limit`) but no corresponding boundary tests exist for the text file read/write limits.

**Fix:** Add boundary tests for:

- Text read at exactly 50MB (should succeed)
- Text read at 50MB + 1 byte (should fail)
- Write payload at 50MB + 1 byte (should fail)
- Correct error messages

**Status:** Resolved — added 3 boundary tests for text read/write size limits

---

## False Positives (excluded)

| Finding | Score | Reason |
|---|---|---|
| CodeQL cleartext-logging alerts #39/#40 | 0 | `SecretString` correctly redacts in Debug/Display; CodeQL conflates IPC serialization with logging |
| Sidecar exit hardcodes `success=true` | 0 | Terminal outcome at line 1131 correctly discriminates via `stream_message_terminal_status()` → `TerminalOutcome::Error` → `false` |

## Below-Threshold (excluded)

| Finding | Score | Notes |
|---|---|---|
| Dead `validate_skill_name` in `workflow/evaluation.rs` | 50 | Real but parameterized SQL prevents injection; only a defense-in-depth gap |
| `list_models` takes raw `String` API key | 50 | Inconsistency but Tauri doesn't auto-log args |

## Previously Deferred (carried forward)

These were flagged in prior review cycles and remain unresolved:

| ID | Finding | Source | Severity |
|---|---|---|---|
| CM-04 | ~~Phantom runs with `model: "unknown"` from `flushDisplayItems` auto-create~~ — Resolved: 30s reaper marks orphaned auto-created runs as error | review-feedback-2026-03-14c | Medium |
| CL-02 | `fs::read_to_string` inside DB mutex in `hydrate_skill_metadata` | review-feedback-2026-03-14c | Low |
| TC-06 | `save_workflow_state` all-completed override path untested | review-feedback-2026-03-14b | Low |
