# Code Review: Skill Builder — 2026-03-14c

## Executive Summary

One agent reviewed all changes on the integration branch (`feature/vu-561`) versus `main`. This document has been reconciled against all remediation work. Resolved and invalid findings have been removed.

**Reconciled:** 2026-03-14 (after commits through `f65fd68`)

**Resolved findings:**

- **CC-01** (Critical): Invalid — each agent run has its own `agentId` in the `runs` map; sub-agents never overwrite the parent's context window. The `Math.max` guard was incorrect (stale denominator after compaction).
- **CC-02** (Critical): Invalid — `persistRunRows` was intentionally removed in VU-595. Persistence is fully handled in Rust via `run_result` events in `agents/events.rs:241,282` → `db::persist_agent_run`.
- **CH-01** (High): Fixed — listener registrations use `Promise.all()` — `1766795`
- **CH-02** (High): Invalid — JS single-threading makes TOCTOU impossible; no async operations between `setState` and `completeRun`.
- **CH-03** (High): Fixed — 4 migration doc-comments aligned to array indices — `1766795`
- **CM-01** (Medium): Invalid — `pendingResolve` is always `null` in mock mode (real SDK generator never runs).
- **CM-02** (Medium): Fixed — `joinPath` normalizes internal backslashes with `.replace(/\\/g, "/")` — `5f5b7e7`
- **CM-03** (Medium): Invalid/intentional — `skills_path` absence only affects git auto-commit (non-critical side effect); DB save completes before this point. Returning an error regresses to the original CQ-01 bug.
- **CM-05** (Medium): Fixed — `USERPROFILE` added to `ENV_ALLOWLIST` — `5f5b7e7`
- **CL-01** (Low): Invalid — test `test_rename_skill_inner_disk_failure_returns_error` has 3 assertions. The name cited in the finding doesn't exist.
- **CL-03** (Low): Fixed — `get_tags_for_skills` uses `s.name` from JOIN — `f65fd68`

**Remaining finding counts:**

| Severity | Code Quality | Total |
|---|---|---|
| Medium | 1 | 1 |
| Low | 1 | 1 |
| **Total** | **2** | **2** |

---

## Open Findings

### CM-04 — Medium — `flushDisplayItems` Creates Phantom Runs with Incomplete Metadata

**Location:** `app/src/stores/agent-store.ts` (flushDisplayItems)

When display items arrive before `startRun`, `flushDisplayItems` auto-creates a run with `model: "unknown"` and no `skillName` or `runSource`. If `startRun` is never called (e.g. an error path), the phantom run appears in the UI stuck at `"running"`. In practice, `agent-exit` fires for every agent and calls `completeRun` which transitions any run to a terminal state, but a belt-and-suspenders TTL cleanup would be safer.

### CL-02 — Low — Disk I/O Inside DB Mutex Path

**Location:** `app/src-tauri/src/db/imported_skills.rs` (hydrate_skill_metadata)

`hydrate_skill_metadata` calls `fs::read_to_string` inside what is logically a DB query helper. If the DB mutex is held across this call, slow disk (network mount, spun-down disk) blocks all other DB operations.

**Fix:** Hydrate metadata outside the DB lock, or restructure callers to release the lock before file I/O.

---

## Pending Recommendations

| # | ID | Severity | Area | Action | Effort |
|---|---|---|---|---|---|
| 1 | CM-04 | Medium | Frontend | Add TTL/cleanup for auto-created phantom runs | M |
| 2 | CL-02 | Low | Rust | Move disk I/O out of DB mutex path in `imported_skills.rs` | M |
