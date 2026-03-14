# Remaining Review Findings: Skill Builder

**Review date:** 2026-03-14
**Last reconciled:** 2026-03-14 (after PR #160, #162, #163, #164, #165 merged)

All findings from the original 7-agent review are resolved except those listed below. Everything tracked by a closed Linear issue or merged PR has been removed.

---

## Open Issues (Tracked)

| Finding(s) | Issue | Status | What remains |
|---|---|---|---|
| C3, H5, M12, Rec #1, Rec #2 | [VU-489](https://linear.app/acceleratedata/issue/VU-489) | Todo | Backend API boundaries: settings ownership guards, typed client layer, artifact typed contracts, `Result<T,String>` error taxonomy, single `Mutex<Connection>` serialization |

---

## Untracked Findings

These have no Linear issue and were not addressed by any merged PR.

| ID | Severity | Finding | Location |
|---|---|---|---|
| C1 | Critical | API keys and GitHub OAuth tokens stored in plaintext SQLite; secrets traverse frontend-accessible settings paths | `db/settings.rs` |
| C2 | Critical | All agent runs use `bypassPermissions`; sidecar permission model has not been reduced | `sidecar/options.ts` |
| H8 | High | GitHub OAuth requests `repo` scope (full private repo access); should be `public_repo` | `commands/github_auth.rs:22` |

---

## Pending Recommendations (Prioritized)

| # | Action | Finding | Effort |
|---|---|---|---|
| 1 | Migrate API key + OAuth token to OS keychain | C1 (untracked) | Medium |
| 2 | Reduce agent permission mode from `bypassPermissions` | C2 (untracked) | High |
| 3 | Reduce GitHub OAuth scope from `repo` to `public_repo` (1-line change) | H8 (untracked) | Trivial |
| 4 | Complete backend settings/API-boundary ownership work | [VU-489](https://linear.app/acceleratedata/issue/VU-489) | Large |
