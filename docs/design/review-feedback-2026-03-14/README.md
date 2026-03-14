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

## Open Items

### Critical

#### C1. API Keys Stored in Plaintext SQLite

**Location:** `src-tauri/src/db/settings.rs`, `types.rs:60,85`
**Source:** Security Auditor

`anthropic_api_key` and `github_oauth_token` are serialized as plaintext JSON in the `settings` table. The `get_settings` command also returns the API key to the frontend webview, making it accessible via DevTools or any XSS.

**Fix:** Use OS keychain (macOS Keychain / Windows Credential Manager) via `tauri-plugin-stronghold` or equivalent. Strip secrets from the `get_settings` response sent to the frontend.

#### C2. Agent SDK Runs with `bypassPermissions` — Full Filesystem/Shell Access

**Location:** `sidecar/options.ts`, `commands/workflow/runtime.rs`
**Source:** Security Auditor

Every agent invocation runs with `permissionMode: "bypassPermissions"`, granting unrestricted Read/Write/Edit/Bash access. A prompt-injected agent could execute arbitrary commands.

**Fix:** Use `acceptEdits` or `default` mode. Implement a filesystem allowlist. Consider OS-level sandboxing for the sidecar process.

### High

#### H8. GitHub OAuth Requests `repo` Scope (Full Read/Write to All Repos)

**Location:** `commands/github_auth.rs:22`
**Source:** Security Auditor

`repo,read:user` grants full access to all public and private repos. Only skill-catalog browsing is needed.

**Fix:** Reduce to `public_repo` or fine-grained `repo:read`.

### Medium

| ID | Issue | Location | Tracking |
|---|---|---|---|
| M5 | CSP includes `localhost:1420` in production build | `tauri.conf.json` CSP | Untracked |
| M8 | Dashboard state structure needs refactor | `stores/` | [VU-586](https://linear.app/acceleratedata/issue/VU-586) |
| C3, H5, M12 | Backend settings/API-boundary ownership | `commands/settings.rs` | [VU-489](https://linear.app/acceleratedata/issue/VU-489) |

### Low

| ID | Issue | Tracking |
|---|---|---|
| L1, L2, L3, L4, L6, L8, L9, L10, L11 | Various low-priority findings not verified closed | [VU-589](https://linear.app/acceleratedata/issue/VU-589) |

---

## Architecture Concerns (Open)

| Concern | Impact |
|---|---|
| Single `std::sync::Mutex<Connection>` for all DB access (77 lock sites) | Serializes all commands; fragile if any future command holds lock across `.await` |
| `Result<T, String>` throughout all commands (no structured error taxonomy) | Frontend can't programmatically distinguish error types |

## Security Risk Matrix (Open)

| Finding | Severity | Effort |
|---|---|---|
| Plaintext secrets in SQLite (C1) | Critical | Medium |
| `bypassPermissions` on all agents (C2) | Critical | High |
| `repo` scope on GitHub OAuth (H8) | High | Trivial |
| CSP `'unsafe-inline'` for styles | Medium | Low |
| CSP includes localhost in production (M5) | Medium | Low |
| No integrity check on bundled agent resources (L11) | Low | Medium |

## Pending Recommendations (Prioritized)

| # | Action | Effort |
|---|---|---|
| 1 | Migrate API key + OAuth token to OS keychain (C1) | Medium |
| 2 | Reduce agent permission mode from `bypassPermissions` (C2) | High |
| 3 | Reduce GitHub OAuth scope from `repo` to `public_repo` (H8) | Trivial |
| 4 | Fix production CSP — remove `localhost:1420`, review style policy (M5) | Low |
| 5 | Finish backend settings/API-boundary ownership work (VU-489) | Large |
