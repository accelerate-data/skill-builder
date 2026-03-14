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

## Part 1: Covered by Existing Issues

| ID | Finding | Severity | Covered by |
|---|---|---|---|
| C3 | Auth store passes partial object to `save_settings` | Critical | [VU-489](https://linear.app/acceleratedata/issue/VU-489) AC1 — granular write commands + auth-store fix |
| H1 | ~30+ silent `.catch(() => {})` error handlers | High | [VU-581](https://linear.app/acceleratedata/issue/VU-581) — replace with diagnostic logging |
| H2 | Sidecar `process.env` spread leaks entire environment | High | [VU-582](https://linear.app/acceleratedata/issue/VU-582) — env var allowlist |
| H3 | `parseSidecarConfig` validates only 4 of 15+ fields | High | [VU-583](https://linear.app/acceleratedata/issue/VU-583) — full field validation |
| H4 | `test_api_key` accepts any non-401/403 status as valid | High | [VU-584](https://linear.app/acceleratedata/issue/VU-584) — status code hardening |
| H5 | Settings page initializes state from `getState()` outside React lifecycle | High | [VU-489](https://linear.app/acceleratedata/issue/VU-489) AC1 — granular commands replace stale snapshot pattern |
| H7 | `parseStepProgress` hardcodes 6 steps; workflow has 4 | High | [VU-585](https://linear.app/acceleratedata/issue/VU-585) — use `WORKFLOW_STEP_DEFINITIONS.length` |
| M1 | `persistRunRows` failure count always logs 0 | Medium | [VU-581](https://linear.app/acceleratedata/issue/VU-581) — diagnostic logging covers this pattern |
| M12 | `AppSettings` has 25+ fields spanning unrelated concerns | Medium | [VU-489](https://linear.app/acceleratedata/issue/VU-489) AC1 — granular write commands split concerns |
| Rec #1 | Strip secrets from `get_settings` response | — | [VU-489](https://linear.app/acceleratedata/issue/VU-489) AC1 — backend-owned field guards |
| Rec #2 | Fix auth-store partial `save_settings` call | — | [VU-489](https://linear.app/acceleratedata/issue/VU-489) AC1 |
| Rec #4 | Add `console.warn` to silent `.catch` handlers | — | [VU-581](https://linear.app/acceleratedata/issue/VU-581) |
| Rec #5 | Fix `parseStepProgress` hardcoded step count | — | [VU-585](https://linear.app/acceleratedata/issue/VU-585) |
| Rec #6 | Restrict env vars passed to sidecar subprocess | — | [VU-582](https://linear.app/acceleratedata/issue/VU-582) |
| Rec #7 | Harden `test_api_key` to only accept 2xx | — | [VU-584](https://linear.app/acceleratedata/issue/VU-584) |
| Rec #10 | Complete `parseSidecarConfig` validation | — | [VU-583](https://linear.app/acceleratedata/issue/VU-583) |
| Rec #12 | Fix `persistRunRows` with `Promise.allSettled` | — | [VU-581](https://linear.app/acceleratedata/issue/VU-581) |

---

## Part 2: Pending (No Issue Coverage)

### Critical

#### C1. API Keys Stored in Plaintext SQLite

**Location:** `src-tauri/src/db.rs:2109-2137`, `types.rs:60,85`
**Source:** Security Auditor

`anthropic_api_key` and `github_oauth_token` are serialized as plaintext JSON in the `settings` table. Any process under the user's account can extract them. The `get_settings` command also returns the API key to the frontend webview, making it accessible via DevTools or any XSS.

**Fix:** Use OS keychain (macOS Keychain / Windows Credential Manager) via `tauri-plugin-stronghold` or equivalent. At minimum, strip secrets from the `get_settings` response sent to the frontend.

#### C2. Agent SDK Runs with `bypassPermissions` — Full Filesystem/Shell Access

**Location:** `sidecar/options.ts:50`, `commands/workflow/runtime.rs:541,794`
**Source:** Security Auditor

Every agent invocation runs with `permissionMode: "bypassPermissions"`, granting unrestricted Read/Write/Edit/Bash access. A prompt-injected agent (via imported skill content or research material) could execute arbitrary commands.

**Fix:** Use `acceptEdits` or `default` mode. Implement a filesystem allowlist. Consider OS-level sandboxing for the sidecar process.

### High

#### H8. GitHub OAuth Requests `repo` Scope (Full Read/Write to All Repos)

**Location:** `commands/github_auth.rs:22`
**Source:** Security Auditor

`repo,read:user` grants full access to all public and private repos. Only skill-catalog browsing is needed.

**Fix:** Reduce to `public_repo` or fine-grained `repo:read`.

### Medium — Code Quality

| ID | Issue | Location |
|---|---|---|
| M2 | `normalize_path` splits on `/` only — fails on Windows `\` | `commands/settings.rs:101-109` |
| M3 | No size limit on text `read_file`/`write_file` (memory exhaustion risk) | `commands/files.rs:307-345` |
| M4 | `use-agent-stream.ts` listener registration race condition (async `.then`) | `hooks/use-agent-stream.ts:67-69` |
| M5 | CSP includes `localhost:1420` in production builds | `tauri.conf.json:23` |
| M6 | `AgentOutputPanel` subscribes to entire run object — re-renders on every display item | `components/agent-output-panel.tsx:13` |
| M7 | `addDisplayItem` does O(n) array copy per message — O(n^2) for long runs | `agent-store.ts:546-576` |
| M8 | Dashboard has 15+ `useState` hooks — hard to reason about | `pages/dashboard.tsx:61-78` |

### Medium — Architecture

| ID | Issue | Location |
|---|---|---|
| M9 | `db.rs` is a monolith (77K+ tokens, all migrations + queries + types) | `src-tauri/src/db.rs` |
| M10 | Duplicate usage persistence path (frontend `persistRunRows` + Rust `run_result`) | `agent-store.ts` + `events.rs` |
| M11 | Module-level `Map` state outside Zustand store (invisible to devtools) | `agent-store.ts` |
| M13 | `INSERT OR REPLACE` on `agent_runs` — risks cascade if FKs ever added | `db.rs:1470-1480` |

Note: VU-489 AC6 splits `workflow.rs` but does **not** address the `db.rs` monolith (M9) or the dual-write dedup (M10).

### Medium — Security

| ID | Issue | Location |
|---|---|---|
| M14 | `list_skill_files` doesn't use `get_allowed_roots` validation | `commands/files.rs:18` |
| M15 | No `rehype-sanitize` on agent-generated markdown rendering | `components/agent-items/*.tsx` |
| M16 | Sidecar has no API key redaction utility — accidental logging risk | `sidecar/options.ts`, `config.ts` |
| M17 | `discoverInstalledPlugins` doesn't filter for directories (`.DS_Store` risk) | `sidecar/run-agent.ts:14-22` |

### Low

| ID | Issue | Location |
|---|---|---|
| L1 | `flushMessageBuffer()` is a documented no-op — dead code | `agent-store.ts:127-130` |
| L2 | Hardcoded `contextWindow: 200_000` default; models vary (1M for Opus) | `agent-store.ts:460,536` |
| L3 | TODO comment for VU-539 left in codebase | `use-agent-stream.ts:206` |
| L4 | `showContextMenu` hardcoded to `true` — dead branch | `skill-card.tsx:138` |
| L5 | Dead `App.tsx` file returns null (compatibility stub) | `App.tsx` |
| L6 | `handleShutdown` always exits with code 0 even on forced timeout | `sidecar/shutdown.ts:51` |
| L7 | `resolvePromptPathsAsync` is unnecessarily async | `sidecar/mock-agent.ts:122-129` |
| L8 | `AGENT_EVENTS_VERSION` / `DISPLAY_TYPES_VERSION` not embedded in protocol messages | `sidecar/agent-events.ts:112`, `display-types.ts:103` |
| L9 | GitHub Client ID hardcoded — can't rotate without code change | `github_auth.rs:4` |
| L10 | Tauri `opener:default` capability allows opening arbitrary URLs | `capabilities/default.json` |
| L11 | No integrity check on bundled agent resource files | `tauri.conf.json:29-35` |
| L12 | FK enforcement disabled during migration, never re-enabled | `db.rs:121-122` |
| L13 | `void Promise.allSettled([...inFlight])` is a no-op in persistent-mode | `sidecar/persistent-mode.ts:332` |
| L14 | `parsePromptPaths` regex doesn't handle CRLF line endings | `sidecar/mock-agent.ts:91-104` |
| L15 | `thinkingEnabled` detection excludes `adaptive` mode | `sidecar/message-processor.ts:470-473` |
| L16 | Usage page uses raw `<select>` instead of shadcn Select | `pages/usage.tsx:297-354` |

### Tests — Pending

| ID | Issue | Severity | Location |
|---|---|---|---|
| T1 | `create_test_db_for_tests()` diverges from production `NUMBERED_MIGRATIONS` — migration 30 called twice, migrations 12 and 17 missing | High | `db.rs:14-52` |
| T2 | 17 `waitForTimeout` calls in `workflow-smoke.spec.ts` — primary flakiness risk | High | `e2e/workflow/workflow-smoke.spec.ts` |
| T3 | Hardcoded `/tmp/` paths in 20+ E2E mock overrides violate Windows compat rules | High | Multiple E2E specs and helpers |
| T4 | No `screenshot: "only-on-failure"` configured in Playwright | Medium | `playwright.config.ts` |
| T5 | `display-items.spec.ts` not listed in TEST_MANIFEST | Medium | `e2e/workflow/display-items.spec.ts` |
| T6 | 2 orphaned fixtures (`workspace-skills.json`, `usage-data.json`) with schema drift | Low | `e2e/fixtures/` |
| T7 | `addInitScript` called after `goto` in dashboard tests | Medium | `e2e/dashboard/dashboard-smoke.spec.ts:36-56` |
| T8 | Duplicate test case `"renders skill name"` in `workspace-skill-card.test.tsx:25,37` | Medium | Unit tests |
| T9 | Real-timer `setTimeout` in 3 test files (50ms/10ms waits) creates flakiness | Medium | `use-workflow-state-machine.test.ts:192,231`, `stream-session.test.ts:201,205,209` |
| T10 | `feedback.rs:134` has empty `#[cfg(test)]` stub with no tests | Medium | Rust tests |

### E2E Coverage Gaps — Missing Critical Flows

| Flow | Why Critical |
|---|---|
| Usage page (`/usage`) | Primary cost feedback loop; `data-testid` hooks already wired |
| Settings: workspace path save, GitHub login/logout | First-run config only partially tested (1 test) |
| GitHub import dialog (marketplace) | Multi-step dialog with auth, untested |
| Imported skills management | Enable/disable/delete library, zero coverage |
| Clarification editor interaction | Users answer questions during workflow, never asserted |
| Orphan/reconciliation dialogs | Post-startup dialogs users must dismiss |
| Error boundary rendering | App-level crash recovery |

### Untested Frontend Components

| Component | Risk |
|---|---|
| `workflow-sidebar.tsx` | Core navigation, rendered on every workflow page |
| `error-boundary.tsx` | Crash recovery fallback |
| `reconciliation-ack-dialog.tsx` | Startup dialog, dismiss flows |
| `skill-dialog.tsx` | Skill creation/edit form validation |
| `agent-items/result-item.tsx`, `error-item.tsx`, `tool-item.tsx`, `subagent-item.tsx` | Agent output rendering branches |
| `refine/chat-panel.tsx`, `git-patch-view.tsx` | Refine conversation container |

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
| No markdown sanitization (M15) | Medium | Low |
| CSP `'unsafe-inline'` for styles | Medium | Low |
| CSP includes localhost in production (M5) | Medium | Low |
| `list_skill_files` missing allowed-root validation (M14) | Medium | Small |
| No integrity check on bundled agent resources (L11) | Low | Medium |

## Pending Recommendations (Prioritized)

| # | Action | Source | Effort |
|---|---|---|---|
| 1 | Migrate API key + OAuth token to OS keychain (C1) | Security | Medium |
| 2 | Reduce agent permission mode from `bypassPermissions` (C2) | Security | High |
| 3 | Reduce GitHub OAuth scope from `repo` to `public_repo` (H8) | Security | Trivial |
| 4 | Fix test DB helper — iterate `NUMBERED_MIGRATIONS` (T1) | Rust | Small |
| 5 | Replace 17 `waitForTimeout` calls with deterministic assertions (T2) | E2E | Medium |
| 6 | Add `rehype-sanitize` to markdown rendering pipeline (M15) | Security | Small |
| 7 | Re-enable FK enforcement after migrations complete (L12) | Rust | Trivial |
| 8 | Add E2E tests for usage page and settings save | E2E | Medium |
| 10 | Split `db.rs` monolith into domain modules (M9) | Architecture | Large |
