# Skill Builder

Multi-agent workflow for creating domain-specific Claude skills. Tauri desktop app (React + Rust) orchestrates agents via a Node.js sidecar.

**CLAUDE.md maintenance rule**: This file contains architecture, conventions, and guidelines — not product details. Do not add counts, feature descriptions, or any fact discoverable by reading code. If it will go stale when code changes, point to the source file instead.

## Architecture

React 19 (WebView) → Tauri IPC → Rust backend → spawns Node.js sidecar (`@anthropic-ai/claude-agent-sdk`)

**Tech stack:** React 19, TypeScript, Vite 7, Tailwind CSS 4, shadcn/ui, Zustand, TanStack Router · Tauri 2, rusqlite, git2, reqwest · Node.js + `@anthropic-ai/claude-agent-sdk` (sidecar)

**Agent runtime:** No hot-reload — restart `npm run dev` after editing `app/sidecar/`. Requires Node.js 18–24 (Node 25+ crashes the SDK). See `.claude/rules/agent-sidecar.md` when working in `app/sidecar/`.

**Key directories:**

- Workspace (`~/.vibedata/` default, configurable): agent prompts, skill context, logs
- Skill output (`~/skill-builder/` default): SKILL.md, references, git-managed
- App database: `~/Library/Application Support/com.skillbuilder.app/skill-builder.db` (macOS)
- Full layout: [`docs/design/agent-specs/storage.md`](docs/design/agent-specs/storage.md)

## User Guide

Source: `docs/user-guide/` (VitePress). Deployed via `docs.yml` on push to `main`. Route → URL map: `app/src/lib/help-urls.ts`. New docs link: import `getHelpUrl`/`getWorkflowStepUrl`, call `openUrl()` from `@tauri-apps/plugin-opener`. New page: add to `docs/user-guide/`, `docs/.vitepress/config.ts`, and `help-urls.ts`.

## Dev Commands

```bash
# Desktop app (run from app/)
cd app && npm install && npm run sidecar:build
npm run dev                              # Dev mode (hot reload)
MOCK_AGENTS=true npm run dev             # Mock mode (no API calls, replays bundled templates)

# Testing — app (run from app/)
app/tests/run.sh                         # All levels (unit + integration + e2e + agents + eval)
app/tests/run.sh unit                    # Level 1: stores, utils, hooks, rust, sidecar
app/tests/run.sh integration             # Level 2: component + page tests
app/tests/run.sh e2e                     # Level 3: Playwright
app/tests/run.sh e2e --tag @workflow     # Level 3, filtered by tag
cd app && npm run test:unit              # Unit tests only (frontend)
cd app && npm run test:integration       # Integration tests only (frontend)
cd app && npm run test:e2e               # All E2E tests
cd app/src-tauri && cargo test           # Rust tests

# Testing — agents (run from app/)
cd app && npm run test:agents:structural # Agent structural checks (free, no API key)
cd app && npm run test:agents:smoke      # Agent smoke tests (requires API key or FORCE_PLUGIN_TESTS=1)
```

## Testing

### When to write tests

**App:**

1. New state logic (store actions, derived state) → store unit tests
2. New Rust command with testable logic → `#[cfg(test)]` tests
3. New UI interaction (button states, form validation) → component test
4. New page or major flow → E2E test (happy path)
5. Bug fix → regression test

Purely cosmetic changes or simple wiring don't require tests. If unclear, ask the user.

### Test discipline

Before writing any test code, read existing tests for the files you changed:

1. Update tests that broke due to your changes
2. Remove tests that are now redundant
3. Add new tests only for genuinely new behavior
4. Never add tests just to increase count — every test must catch a real regression

### Choosing which tests to run

Determine what you changed, then pick the right runner:

| What changed | Agent tests | App tests |
|---|---|---|
| Frontend (store/hook/component/page) | — | `npm run test:changed` |
| Rust command | — | `cargo test <module>` + E2E tag from `app/tests/TEST_MANIFEST.md` |
| Sidecar agent invocation (`app/sidecar/`) | `cd app && npm run test:agents:structural test:agents:smoke` | `cd app/sidecar && npx vitest run` |
| Agent prompt (`agents/`) | `cd app && npm run test:agents:structural` | `npm run test:unit` (canonical-format) |
| Agent output format (`agents/`) | `cd app && npm run test:agents:structural test:agents:smoke` | `npm run test:unit` (canonical-format) |
| `agent-sources/workspace/CLAUDE.md` | `cd app && npm run test:agents:structural` | `npm run test:unit` |
| Mock templates or E2E fixtures | — | `npm run test:unit` |
| Shared infrastructure (`src/lib/tauri.ts`, test mocks) | — | `app/tests/run.sh` (all levels) |
| Eval scripts | — | `app/tests/run.sh eval` |

**Artifact format changes** (agent output format + app parser + mock templates): run `cd app && npm run test:agents:structural test:agents:smoke` **and** `npm run test:unit`. The `canonical-format.test.ts` suite is the canary for format drift across the boundary.

**Unsure?** `app/tests/run.sh` runs everything.

### Agent test policy

**Only `test:agents:structural` may be run by Claude** — it makes no API calls and is free.

`test:agents:smoke` makes real API calls and costs real money. **Do not run it. Tell the user to run it manually.**

Rust → E2E tag mappings, E2E spec files, and cross-boundary format compliance details are in `app/tests/TEST_MANIFEST.md`.

### Updating the test manifest

Update `app/tests/TEST_MANIFEST.md` only when adding new Rust commands (add the cargo test filter + E2E tag), new E2E spec files, new agent source patterns, or changing shared infrastructure files. Frontend test mappings are handled automatically by `vitest --changed` and naming conventions.

## Docs

Design notes live in `docs/design/`. Each topic gets its own subdirectory with a `README.md` (e.g. `docs/design/backend-design/README.md`). The index at `docs/design/README.md` must be updated when adding a new subdirectory.

Write design docs concisely — state the decision and the reason, not the reasoning process. One sentence beats a paragraph. Avoid restating what the code already makes obvious.

## Code Style

- Granular commits: one concern per commit, run tests before each
- TypeScript strict mode, no `any`
- Zustand stores: one file per store in `app/src/stores/`
- Rust commands: one module per concern in `app/src-tauri/src/commands/`
- Tailwind 4 + shadcn/ui for all UI — see `.claude/rules/frontend-design.md` (auto-loaded in `app/src/`)
- **Error colors:** Always use `text-destructive` for error text — never hardcoded `text-red-*`
- Verify before committing: `cd app && npx tsc --noEmit` (frontend) + `cargo check --manifest-path app/src-tauri/Cargo.toml` (backend)

## Logging

Every new feature must include logging. The app uses `log` crate (Rust) and `console.*` (frontend, bridged to Rust via `attachConsole()`). All agent interactions — prompts, responses, tool use, and SDK diagnostics — are captured in per-request JSONL transcripts at `{skill}/logs/{step}-{timestamp}.jsonl`. The app log captures lifecycle events; transcripts capture the full conversation.

### Log levels

| Level | When to use | Examples |
|---|---|---|
| **error** | Operation failed, user impact likely | DB write failed, API call returned 5xx, file not found when expected, deserialization error |
| **warn** | Unexpected but recoverable, or user did something questionable | Retrying after transient failure, config value missing (using default), skill already exists on import |
| **info** | Key lifecycle events and operations a developer would want in production logs | Command invoked with key params, skill created/deleted/imported, agent started/completed, settings changed, auth login/logout |
| **debug** | Internal details useful only when troubleshooting | **Agent prompts sent to the SDK**, intermediate state, cache hits/misses, branch logic taken, SQL queries |

### Rules

- **Rust commands:** Every `#[tauri::command]` function logs `info!` on entry (with key params) and `error!` on failure. Use `debug!` for intermediate steps. Never log secrets (API keys, tokens).
- **Frontend:** Use `console.error()` for caught errors, `console.warn()` for unexpected states, `console.log()` for significant user actions (navigation, form submissions). Don't log render cycles or state reads.
- **Agent interactions:** Every agent request produces a JSONL transcript with the full SDK conversation (prompt, assistant messages, tool_use, tool_result). The first transcript line is the config object with `apiKey` redacted but prompt included — making each transcript self-contained. Agent prompts are also logged at `debug` level in the app log (`sidecar_pool.rs`). Response payloads stay in transcripts only — don't duplicate them in the app log.
- **Format:** Include context — `info!("import_github_skills: importing {} skills from {}", count, repo)` not just `info!("importing skills")`.

## Gotchas

- **SDK has NO team tools**: `@anthropic-ai/claude-agent-sdk` does NOT support TeamCreate, TaskCreate, SendMessage. Use the Task tool for sub-agents. Multiple Task calls in same turn run in parallel.
- **Parallel worktrees**: `npm run dev` auto-assigns a free port.

## Shared Components

The desktop app uses these files:

- `agents/` — agent prompts (flat directory, validated by `./scripts/validate.sh`)
- `agent-sources/workspace/CLAUDE.md` — agent instructions shared by all agents. The app deploys this to the workspace `.claude/CLAUDE.md` (auto-loaded by SDK).

## Issue Management

- **PR title format**: `VU-XXX: short description`
- **PR body link**: `Fixes VU-XXX`

## Delegation Policy

### Hierarchy

Use the lightest option that fits:

1. **Inline** — trivial: one-liner, single-file read, direct answer
2. **Task subagents** — independent workstreams, no mid-task coordination (the common case)
3. **Teams (TeamCreate)** — agents must exchange findings mid-task or hold competing hypotheses

### Model tiers

| Tier | Model | When |
|---|---|---|
| Reasoning | sonnet | Planning, architecture, requirements drafting |
| Implementation | default | Coding, exploration, review, merge |
| Lightweight | haiku | Linear API calls, AC checkoffs, status updates |

### Sub-agent rules

Sub-agents must follow project conventions:

- Logging (§ Logging): Rust `info!` on entry + `error!` on failure; frontend `console.error/warn/log`
- Testing (§ Testing): run only relevant tests, `npx tsc --noEmit` after implementation

## Custom Skills

### /create-linear-issue

When the user runs /create-linear-issue or asks to create a Linear issue, log a bug, file a ticket,
track a feature idea, break down a large issue, or decompose an issue into smaller ones
(e.g. "break down VD-123", "decompose VD-123", "split VD-123"),
read and follow the skill at `.claude/skills/create-linear-issue/SKILL.md`.

Default project: **Skill Builder** — use this project unless the user specifies otherwise.

### /implement-linear-issue

When the user runs /implement-linear-issue, or mentions a Linear issue identifier (e.g. "VU-123", "implement VU-123",
"work on VU-452", "working on VU-100", "build VU-100", "fix VU-99"), or asks to implement, build, fix, or work on a Linear issue,
read and follow the skill at `.claude/skills/implement-linear-issue/SKILL.md`.

### /close-linear-issue

When the user runs /close-linear-issue, or asks to close, complete, merge, or ship a Linear issue (e.g. "close VU-123",
"merge VU-453", "ship VU-100", "complete VU-99"), read and follow the skill at
`.claude/skills/close-linear-issue/SKILL.md`.
