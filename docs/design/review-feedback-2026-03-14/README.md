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

## Critical Issues

### C1. API Keys Stored in Plaintext SQLite

**Location:** `src-tauri/src/db.rs:2109-2137`, `types.rs:60,85`
**Source:** Security Auditor

`anthropic_api_key` and `github_oauth_token` are serialized as plaintext JSON in the `settings` table. Any process under the user's account can extract them. The `get_settings` command also returns the API key to the frontend webview, making it accessible via DevTools or any XSS.

**Fix:** Use OS keychain (macOS Keychain / Windows Credential Manager) via `tauri-plugin-stronghold` or equivalent. At minimum, strip secrets from the `get_settings` response sent to the frontend.

### C2. Agent SDK Runs with `bypassPermissions` — Full Filesystem/Shell Access

**Location:** `sidecar/options.ts:50`, `commands/workflow/runtime.rs:541,794`
**Source:** Security Auditor

Every agent invocation runs with `permissionMode: "bypassPermissions"`, granting unrestricted Read/Write/Edit/Bash access. A prompt-injected agent (via imported skill content or research material) could execute arbitrary commands.

**Fix:** Use `acceptEdits` or `default` mode. Implement a filesystem allowlist. Consider OS-level sandboxing for the sidecar process.

### C3. Auth Store Passes Partial Object to `save_settings`

**Location:** `src/stores/auth-store.ts:46-49, 67-73, 87-93`
**Source:** Frontend Reviewer

`auth-store.ts` calls `invoke("save_settings", { githubUserLogin: ... })` with only 3-4 fields. Rust's `save_settings` expects a full `AppSettings` struct. Serde fails silently, meaning GitHub identity is never persisted. The `.catch()` handler suppresses the error.

**Fix:** Load full settings via `getSettings()`, merge changes, then save via the typed wrapper.

## High Priority Issues

### H1. ~30+ Silent `.catch(() => {})` Error Handlers

**Location:** `workflow-store.ts:128`, `use-workflow-session.ts:68,90,93,119`, `use-workflow-state-machine.ts:135,470,561` + ~20 more
**Source:** Frontend + Architecture

Over 30 fire-and-forget calls silently discard errors from `endWorkflowSession`, `releaseLock`, `cleanupSkillSidecar`, `createWorkflowSession`, `persistAgentRun`, etc. Makes it impossible to diagnose state corruption or leaked locks.

**Fix:** `.catch((e) => console.warn("[component] non-fatal: op=%s err=%s", opName, e))`

### H2. Sidecar `process.env` Spread Leaks Entire Environment

**Location:** `sidecar/options.ts:28-29`
**Source:** Sidecar Reviewer

`{ env: { ...process.env, ANTHROPIC_API_KEY: config.apiKey } }` copies every environment variable into the SDK child process. If the SDK logs or serializes its options, all env vars are exposed.

**Fix:** Pass only required vars: `PATH`, `HOME`, `NODE_ENV`, `ANTHROPIC_API_KEY`.

### H3. `parseSidecarConfig` Validates Only 4 of 15+ Fields

**Location:** `sidecar/config.ts:37-52`
**Source:** Sidecar Reviewer

Validates `prompt`, `apiKey`, `cwd`, `requiredPlugins` then casts everything else blindly. `"maxTurns": "fifty"` or `"permissionMode": 123` would produce subtle runtime failures.

**Fix:** Add validation for all consumed fields. Zod is already available as a transitive dependency.

### H4. `test_api_key` Accepts Any Non-401/403 Status as Valid

**Location:** `commands/settings.rs:341-346`
**Source:** Rust Reviewer

Returns `Ok(true)` for 500, 429, etc. A server outage tells users their key is valid.

**Fix:** Accept only 2xx. Map 429 to "rate limited", 5xx to "API unavailable."

### H5. Settings Page Initializes State from `getState()` Outside React Lifecycle

**Location:** `pages/settings.tsx:65-86`
**Source:** Frontend Reviewer

Multiple `useState` initializers read from `useSettingsStore.getState()` which won't update if the store hydrates asynchronously. `workspacePath` is a plain `const` — `autoSave` will always send `null` if the path loads after mount.

**Fix:** Subscribe to the store via `useSettingsStore((s) => s.workspacePath)` and sync with `useEffect`.

### H6. Unhandled Promise in `StreamSession` Constructor

**Location:** `sidecar/stream-session.ts:45`
**Source:** Sidecar Reviewer

`this.runQuery(...)` is async but its promise is discarded. A sync throw before the first `await` becomes an unhandled rejection that crashes the entire sidecar.

**Fix:** `.catch((err) => { onMessage(requestId, { type: "error", message: err.message }); })`

### H7. `parseStepProgress` Hardcodes 6 Steps; Workflow Has 4

**Location:** `components/skill-card.tsx:47-59`
**Source:** Frontend Reviewer

Divides by 6 total steps but `WORKFLOW_STEP_DEFINITIONS` has only 4. Progress bar never reaches 100%.

**Fix:** Use `WORKFLOW_STEP_DEFINITIONS.length`.

### H8. GitHub OAuth Requests `repo` Scope (Full Read/Write to All Repos)

**Location:** `commands/github_auth.rs:22`
**Source:** Security Auditor

`repo,read:user` grants full access to all public and private repos. Only skill-catalog browsing is needed.

**Fix:** Reduce to `public_repo` or fine-grained `repo:read`.

## Medium Priority Issues

### Code Quality

| ID | Issue | Location |
|---|---|---|
| M1 | `persistRunRows` failure count always logs 0 (async `.catch` vs sync summary) | `agent-store.ts:310-348` |
| M2 | `normalize_path` splits on `/` only — fails on Windows `\` | `commands/settings.rs:101-109` |
| M3 | No size limit on text `read_file`/`write_file` (memory exhaustion risk) | `commands/files.rs:307-345` |
| M4 | `use-agent-stream.ts` listener registration race condition (async `.then`) | `hooks/use-agent-stream.ts:67-69` |
| M5 | CSP includes `localhost:1420` in production builds | `tauri.conf.json:23` |
| M6 | `AgentOutputPanel` subscribes to entire run object — re-renders on every display item | `components/agent-output-panel.tsx:13` |
| M7 | `addDisplayItem` does O(n) array copy per message — O(n^2) for long runs | `agent-store.ts:546-576` |
| M8 | Dashboard has 15+ `useState` hooks — hard to reason about | `pages/dashboard.tsx:61-78` |

### Architecture

| ID | Issue | Location |
|---|---|---|
| M9 | `db.rs` is a monolith (77K+ tokens, all migrations + queries + types) | `src-tauri/src/db.rs` |
| M10 | Duplicate usage persistence path (frontend `persistRunRows` + Rust `run_result`) | `agent-store.ts` + `events.rs` |
| M11 | Module-level `Map` state outside Zustand store (invisible to devtools) | `agent-store.ts` |
| M12 | `AppSettings` has 25+ fields spanning unrelated concerns (auth, UI, marketplace) | `types.rs` |
| M13 | `INSERT OR REPLACE` on `agent_runs` — risks cascade if FKs ever added | `db.rs:1470-1480` |

### Security

| ID | Issue | Location |
|---|---|---|
| M14 | `list_skill_files` doesn't use `get_allowed_roots` validation | `commands/files.rs:18` |
| M15 | No `rehype-sanitize` on agent-generated markdown rendering | `components/agent-items/*.tsx` |
| M16 | Sidecar has no API key redaction utility — accidental logging risk | `sidecar/options.ts`, `config.ts` |
| M17 | `discoverInstalledPlugins` doesn't filter for directories (`.DS_Store` risk) | `sidecar/run-agent.ts:14-22` |

## Low Priority Issues

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

## Test Coverage Analysis

### Coverage by Layer

| Layer | Files | Status |
|---|---|---|
| Frontend unit tests | 76 test files | Strong — stores, hooks, components, pages covered |
| Sidecar tests | 10 files, 223 tests | Strong — all modules have corresponding tests |
| Rust inline tests | Extensive `#[cfg(test)]` | Good — commands, DB, migrations, cleanup |
| E2E tests | 10 specs, 42 tests | Moderate — major flows covered, gaps below |

### Test Infrastructure Issues

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

### Well-Covered Areas (Positive)

- **Workflow store**: 40+ tests — initialization, transitions, session lifecycle, legacy migration
- **Rust workflow output format**: 113 tests — every step's payload schema validation
- **Sidecar protocol**: thorough JSONL coverage — error subtypes, auth failures, abort paths
- **Reconciliation**: 57 tests — all 12 documented scenarios
- **DB migrations**: 106 tests including migration count guard
- **Cross-layer sync guards**: excellent drift prevention between sidecar and frontend
- **Agent store buffering**: well-structured out-of-order event buffer tests

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

### Concerns

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

### Risk Matrix

| Finding | Severity | Effort to Fix |
|---|---|---|
| Plaintext secrets in SQLite | Critical | Medium |
| `bypassPermissions` on all agents | Critical | High |
| API key returned to frontend via `get_settings` | High | Low |
| `repo` scope on GitHub OAuth | High | Low (1 line) |
| API key in sidecar process env | High | Medium |
| No markdown sanitization (`rehype-sanitize`) | Medium | Low |
| CSP `'unsafe-inline'` for styles | Medium | Low |
| CSP includes localhost in production | Medium | Low |
| `list_skill_files` missing allowed-root validation | Medium | Small |
| No integrity check on bundled agent resources | Low | Medium |

## Top 15 Recommendations (Prioritized)

| # | Action | Source | Effort |
|---|---|---|---|
| 1 | Strip secrets from `get_settings` response to frontend | Security | Low |
| 2 | Fix auth-store partial `save_settings` call (C3) | Frontend | Small |
| 3 | Reduce GitHub OAuth scope from `repo` to `public_repo` | Security | Trivial |
| 4 | Add `console.warn` to 30+ silent `.catch(() => {})` handlers | Frontend + Arch | Medium |
| 5 | Fix `parseStepProgress` hardcoded step count (progress never hits 100%) | Frontend | Trivial |
| 6 | Restrict env vars passed to sidecar subprocess | Sidecar | Small |
| 7 | Harden `test_api_key` to only accept 2xx | Rust | Small |
| 8 | Fix test DB helper — iterate `NUMBERED_MIGRATIONS` instead of manual list | Rust | Small |
| 9 | Replace 17 `waitForTimeout` calls with deterministic assertions | E2E | Medium |
| 10 | Complete `parseSidecarConfig` validation (consider Zod) | Sidecar | Small |
| 11 | Add `rehype-sanitize` to markdown rendering pipeline | Security | Small |
| 12 | Fix `persistRunRows` with `Promise.allSettled` | Frontend | Small |
| 13 | Re-enable FK enforcement after migrations complete (`PRAGMA foreign_keys = ON`) | Rust | Trivial |
| 14 | Add E2E tests for usage page and settings save | E2E | Medium |
| 15 | Plan migration to OS keychain for API key + OAuth token storage | Security | Medium |
