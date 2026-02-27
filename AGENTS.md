# Skill Builder

Multi-agent workflow for creating domain-specific Claude skills. Tauri desktop app (React + Rust) orchestrates agents via a Node.js sidecar.

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

**Only `test:agents:structural` may be run autonomously** — it makes no API calls and is free.

`test:agents:smoke` makes real API calls and costs real money. **Do not run it. Tell the user to run it manually.**

Rust → E2E tag mappings, E2E spec files, and cross-boundary format compliance details are in `app/tests/TEST_MANIFEST.md`.

### Updating the test manifest

Update `app/tests/TEST_MANIFEST.md` only when adding new Rust commands (add the cargo test filter + E2E tag), new E2E spec files, new agent source patterns, or changing shared infrastructure files. Frontend test mappings are handled automatically by `vitest --changed` and naming conventions.

## Design Docs

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

Every new feature must include logging. Use `log` crate (Rust) and `console.*` (frontend, bridged via `attachConsole()`). Per-request JSONL transcripts at `{workspace}/{skill}/logs/{step}-{timestamp}.jsonl`. Layer-specific rules are in the relevant `.claude/rules/` file.

| Level | When to use |
|---|---|
| **error** | Operation failed, user impact likely |
| **warn** | Unexpected but recoverable |
| **info** | Key lifecycle events (command invoked, skill created, agent started) |
| **debug** | Internal details useful only when troubleshooting |

## Gotchas

- **SDK has NO team tools**: `@anthropic-ai/claude-agent-sdk` does NOT support TeamCreate, TaskCreate, SendMessage. The "Teams" option in the Delegation Policy applies to the main Claude Code session only — agents running inside the SDK cannot form teams. Use the Task tool for sub-agents. Multiple Task calls in same turn run in parallel.
- **Parallel worktrees**: `npm run dev` auto-assigns a free port.

## Shared Components

The desktop app uses these files:

- `agents/` — agent prompts (flat directory, validated by `./scripts/validate.sh`)
- `agent-sources/workspace/CLAUDE.md` — agent instructions shared by all agents. The app deploys this to the workspace `.claude/CLAUDE.md` (auto-loaded by SDK).

## Issue Management

- **PR title format**: `VU-XXX: short description`
- **PR body link**: `Fixes VU-XXX`

## Skills

Use these repo-local skills when requests match:

- `.claude/skills/create-linear-issue/SKILL.md` — create/log/file a Linear issue, bug, feature, or ticket decomposition
- `.claude/skills/implement-linear-issue/SKILL.md` — implement/fix/work on a Linear issue (e.g. `VU-123`)
- `.claude/skills/close-linear-issue/SKILL.md` — close/complete/ship/merge a Linear issue
- `.claude/skills/tauri/SKILL.md` — Tauri-specific implementation or debugging
- `.claude/skills/shadcn-ui/SKILL.md` — shadcn/ui component work
