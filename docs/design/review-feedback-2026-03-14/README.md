# Comprehensive Code Review: Skill Builder

**Date:** 2026-03-14
**Branch:** `main` (commit `daf24ea`)
**Review scope:** Full codebase — frontend, Rust backend, Node.js sidecar, tests, E2E, security, architecture
**Method:** 7 specialized review agents run in parallel (frontend, Rust/Tauri, sidecar, unit tests, E2E tests, security audit, architecture)

## Executive Summary

**Overall Health: B+ — solid foundation with targeted improvements needed.**

The codebase is well-structured across its three layers with clean separation of concerns, a typed JSONL protocol, comprehensive path traversal defenses, and structured logging with correlation IDs. Test coverage is broad (76 frontend unit files, 223 sidecar tests, extensive Rust inline tests, 42 E2E tests across 10 specs).

| Category | Critical | High | Medium | Low |
|---|---|---|---|---|
| Security | 2 | 3 | 4 | 4 |
| Code Quality | 1 | 5 | 8 | 6 |
| Tests | 0 | 3 | 4 | 3 |
| Architecture | 0 | 2 | 5 | 3 |
| **Total** | **3** | **13** | **21** | **16** |

---

## Status Reconciliation Against PR #160 and Open Cycle 2 Issues

The tables below replace the earlier split between "covered by issues" and
"pending". "Done" means implemented on `PR #160` and validated on the branch,
even if the linked Linear issue is still in `In Review`. "Remaining" means the
finding is still open in Linear, only partially addressed, or still has no
tracked implementation path in the combined PR.

### Done

| Review finding(s) | Issue | What changed on PR #160 | Linear state |
|---|---|---|---|
| H1, M1, Rec #4, Rec #12 | [VU-581](https://linear.app/acceleratedata/issue/VU-581) | Replaced silent frontend error swallowing with diagnostic logging and updated the related tests | In Review |
| H2, Rec #6 | [VU-582](https://linear.app/acceleratedata/issue/VU-582) | Restricted env vars passed into the sidecar SDK subprocess | In Review |
| H3, Rec #10 | [VU-583](https://linear.app/acceleratedata/issue/VU-583) | Added runtime validation for sidecar config fields | In Review |
| H4, Rec #7 | [VU-584](https://linear.app/acceleratedata/issue/VU-584) | Hardened API key validation behavior and its tests | In Review |
| H7, Rec #5 | [VU-585](https://linear.app/acceleratedata/issue/VU-585) | Switched progress/completion logic to the actual workflow step definitions | In Review |
| M2, M3, M4, M6 | [VU-586](https://linear.app/acceleratedata/issue/VU-586) | Landed the code-quality fixes in PR #160 for path handling, file limits, listener timing, and render/test cleanup | In Review |
| M10, M11, M13 | [VU-587](https://linear.app/acceleratedata/issue/VU-587) | Landed the architecture fixes in PR #160 for usage persistence, hidden store state, and `agent_runs` write behavior | In Review |
| M14, M15, M16, M17 | [VU-588](https://linear.app/acceleratedata/issue/VU-588) | Landed the medium-severity security hardening batch included in PR #160 | In Review |
| L5, L7, L13, L14, L15, L16 plus related cleanup/tests in the low-priority batch | [VU-589](https://linear.app/acceleratedata/issue/VU-589) | Landed the cleanup work in PR #160 around dead stubs, CRLF handling, persistent-mode cleanup, adaptive thinking detection, and usage-page control updates | In Review |
| T1-T10 test-infra bucket | [VU-590](https://linear.app/acceleratedata/issue/VU-590) | Fixed test DB drift, removed flaky waits, improved Windows-safe paths, updated Playwright/test-manifest coverage, and repaired stale test infrastructure | In Review |
| E2E coverage gaps table | [VU-591](https://linear.app/acceleratedata/issue/VU-591) | Added the missing E2E coverage and cross-platform path regressions called out in the review | In Review |
| Untested frontend components table | [VU-592](https://linear.app/acceleratedata/issue/VU-592) | Added the missing component/unit coverage for sidebar, error boundary, dialogs, agent item renderers, and refine panel pieces | In Review |

### Remaining

| Review finding(s) | Issue / tracking | Why it remains |
|---|---|---|
| C1 | Untracked in Cycle 2 | API keys and GitHub OAuth tokens are still stored in plaintext SQLite, and secrets still traverse frontend-accessible settings paths |
| C2 | Untracked in Cycle 2 | Agent runs still use `bypassPermissions`; PR #160 did not reduce the sidecar permission model |
| H6 | Untracked in Cycle 2 | `StreamSession` constructor async error handling was not part of PR #160 |
| H8 | Untracked in Cycle 2 | GitHub OAuth scope reduction is still outstanding |
| C3, H5, M12, Rec #1, Rec #2 | [VU-489](https://linear.app/acceleratedata/issue/VU-489) | Still open in `Todo`; the backend settings/API-boundary ownership work was not part of PR #160 |
| M5, M8 | [VU-586](https://linear.app/acceleratedata/issue/VU-586) | The open issue exists, but PR #160 did not include the CSP production cleanup or dashboard state-structure refactor |
| M9 | [VU-587](https://linear.app/acceleratedata/issue/VU-587) | `db.rs` is still a monolith after PR #160 |
| M7 | [VU-593](https://linear.app/acceleratedata/issue/VU-593) | Split out after the review because the O(n^2) display-item append path still needs a dedicated fix |
| L1, L2, L3, L4, L6, L8, L9, L10, L11 | [VU-589](https://linear.app/acceleratedata/issue/VU-589) | These low-priority findings are not clearly closed by the PR #160 file set and should still be treated as remaining until verified or split out |
| L12 | [VU-596](https://linear.app/acceleratedata/issue/VU-596) | Split out after the review because foreign-key enforcement is still disabled after migrations |
| Any merge-dependent item still marked `In Review` above | [PR #160](https://github.com/accelerate-data/skill-builder/pull/160) | Implemented on the branch, but not `Done` in Linear or merged to `main` yet |

---

## Architecture Assessment

### Strengths (Preserve These)

- Clean JSONL protocol boundary with versioned event types
- Rust-side `run_result` interception for server-side persistence
- Sidecar pool with per-skill process reuse (amortizes 2s Node.js startup)
- Comprehensive sensitive-field redaction in all Debug impls
- Layered path traversal defense (reject, canonicalize, containment check)
- Startup reconciliation system for crash recovery
- WAL mode + busy timeout for SQLite concurrency
- Structural agent tests keeping sidecar/frontend event contracts in sync

### Concerns (Pending)

| Concern | Impact |
|---|---|
| Single `std::sync::Mutex<Connection>` for all DB access (77 lock sites) | Serializes all commands; fragile if any future command holds lock across `.await` |
| `Result<T, String>` throughout all commands (no structured error taxonomy) | Frontend can't programmatically distinguish error types |
| `db.rs` monolith | Every schema change touches one file; merge conflict magnet |
| No backpressure on agent event stream | O(n^2) display item accumulation for long runs |
| FK enforcement disabled during migration, never re-enabled | `foreign_keys` pragma stays `false` at runtime |

## Security Findings Summary

### Positive (Well Done)

- Path traversal: `reject_traversal()` + `canonicalize_for_write_target()` + `is_within_allowed_roots()`
- SQL: parameterized queries throughout (`?1`, `?2`, `params![]`)
- Logging: Custom `Debug` impls redact all secrets; `diff_settings` skips sensitive fields
- No `eval()`, `new Function()`, or `dangerouslySetInnerHTML` in production code
- CSP: `object-src 'none'`, `frame-src 'none'`, `base-uri 'self'`
- Zip extraction: layered symlink/traversal/containment defense
- GitHub OAuth uses Device Flow (no client secret in app)
- `CLAUDECODE` env var explicitly removed to prevent nested-session issues

### Pending Risk Matrix

| Finding | Severity | Effort to Fix |
|---|---|---|
| Plaintext secrets in SQLite (C1) | Critical | Medium |
| `bypassPermissions` on all agents (C2) | Critical | High |
| `repo` scope on GitHub OAuth (H8) | High | Trivial (1 line) |
| CSP `'unsafe-inline'` for styles | Medium | Low |
| CSP includes localhost in production (M5) | Medium | Low |
| No integrity check on bundled agent resources (L11) | Low | Medium |

## Pending Recommendations (Prioritized)

| # | Action | Source | Effort |
|---|---|---|---|
| 1 | Migrate API key + OAuth token to OS keychain (C1) | Security | Medium |
| 2 | Reduce agent permission mode from `bypassPermissions` (C2) | Security | High |
| 3 | Reduce GitHub OAuth scope from `repo` to `public_repo` (H8) | Security | Trivial |
| 4 | Catch unhandled promise in `StreamSession` constructor (H6) | Sidecar | Small |
| 5 | Fix the remaining production CSP issue (`localhost:1420`) and review style policy (`M5`) | Security / Config | Low |
| 6 | Batch display-item accumulation to remove the remaining O(n^2) append path (M7 / VU-593) | Frontend architecture | Medium |
| 7 | Re-enable FK enforcement after migrations complete (L12 / VU-596) | Rust | Trivial |
| 8 | Split `db.rs` monolith into domain modules (M9) | Architecture | Large |
| 9 | Finish the backend settings/API-boundary ownership work in VU-489 | Backend contracts | Large |
