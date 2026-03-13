# Skill Builder

Multi-agent workflow for creating domain-specific Claude skills. Tauri desktop app (React + Rust) orchestrates agents via a Node.js sidecar.

**Maintenance rule:** This file contains architecture, conventions, and guidelines — not product details. Do not add counts, feature descriptions, or any fact that can be discovered by reading code. If it will go stale when the code changes, it doesn't belong here — point to the source file instead.

## Instruction Hierarchy

Use this precedence when maintaining agent guidance:

1. `AGENTS.md` (canonical, cross-agent source of truth)
2. `.claude/rules/*.md` (shared detailed rules; agent-agnostic content)
3. `.claude/skills/*/SKILL.md` (workflow playbooks)
4. Agent-specific adapter files (for example `CLAUDE.md`) that reference canonical docs

Adapter files must not duplicate canonical policy unless they are adding agent-specific behavior.

## Architecture

| Layer | Technology |
|---|---|
| Desktop framework | Tauri v2 |
| Frontend | React 19, TypeScript strict, Vite 7 |
| Styling | Tailwind CSS 4, shadcn/ui |
| State | Zustand, TanStack Router |
| Icons | Lucide React |
| Agent sidecar | Node.js + TypeScript + `@anthropic-ai/claude-agent-sdk` |
| Database | SQLite (`rusqlite` bundled) |
| Rust errors | `thiserror` |

**Agent runtime:** No hot-reload — restart `npm run dev` after editing `app/sidecar/`. Requires Node.js 18+. See `.claude/rules/agent-sidecar.md` when working in `app/sidecar/`.

**Key directories:**

- Workspace (derived from Tauri `app_local_data_dir()` as `<app_local_data_dir>/workspace`, not user-configurable): agent prompts, per-skill scratch data, logs
- Skill output (`~/skill-builder/` default): SKILL.md, references, git-managed
- App database: `~/Library/Application Support/com.vibedata.skill-builder/skill-builder.db` (macOS)
- Full layout: [`docs/design/agent-specs/storage.md`](docs/design/agent-specs/storage.md)

## Repository Folder Map

Use this map before reasoning about implementation location:

- `app/src/` — frontend runtime code (React/TypeScript surfaces, components, stores, hooks).
- `app/src-tauri/src/` — Rust backend runtime code (Tauri commands, DB, logging, startup wiring).
- `app/sidecar/` — Node/TypeScript sidecar runtime code.
- `app/e2e/` — Playwright E2E tests only.
- `app/src/__tests__/` and `app/sidecar/__tests__/` — unit/integration tests only.
- `agent-sources/agents/` — agent prompts (flat directory, validated by `npm run test:agents:structural`).
- `agent-sources/plugins/` — plugin definitions (skills, agents, MCP config, tooling).
- `agent-sources/workspace/CLAUDE.md` — agent instructions shared by all agents (deployed to workspace `.claude/CLAUDE.md`).
- `docs/` — documentation and design/reference material only; do not treat as executable source unless explicitly asked.
- `scripts/` — developer/automation scripts.

## User Guide

Source: `docs/user-guide/` (VitePress). Deployed via `docs.yml` on push to `main`. Route → URL map: `app/src/lib/help-urls.ts`. New docs link: import `getHelpUrl`/`getWorkflowStepUrl`, call `openUrl()` from `@tauri-apps/plugin-opener`. New page: add to `docs/user-guide/`, `docs/.vitepress/config.ts`, and `help-urls.ts`.

## Dev Commands

```bash
cd app && npm install && npm run sidecar:build
cd app && npm run dev                    # Dev mode (hot reload)
cd app && MOCK_AGENTS=true npm run dev   # Mock mode (no API calls, replays bundled templates)
```

## Repo Memory

Coding agent sessions should write durable repo-specific learnings back into this AGENTS.md file when they discover stable operational facts, environment constraints, or workflow gotchas that would help later sessions.

Record only durable, non-obvious, cross-cutting facts here. Do not append release-note style UI tweaks, obvious routes/components, or details that are already easy to recover from code, `repo-map.json`, or `README.md`.

### Agent Startup Context

Read these before starting any non-trivial task:

- `repo-map.json` — structure, entrypoints, modules, commands. Schema: `.claude/repo-map.schema.json`. Skip repo-wide rediscovery if it covers the task.
- `TEST_MANIFEST.md` — Rust → E2E tag mappings, shared infrastructure blast radius, cross-boundary format compliance. Read before choosing tests for Rust or cross-layer changes. Frontend mappings are handled automatically by `vitest --changed`.

### Maintenance Rules

| Artifact | Update when |
|---|---|
| `AGENTS.md` | A fact is durable, non-obvious, and won't be obvious from code |
| `repo-map.json` | Architecture, entrypoints, commands, modules, or package structure changes |
| `README.md` | User-facing installation, configuration, commands, or architecture overview changes |
| `TEST_MANIFEST.md` | Rust command file added/removed · E2E spec added/removed · shared infra file added/removed · agent artifact format changes affecting a Rust or TS parser |

### Stable Repo Memory

_Add durable, non-obvious, cross-cutting implementation and workflow notes here._

### Deployment-Specific Operator Values

_Add deployment- or operator-specific facts here (e.g. environment variables, infra config, service URLs)._

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
| Rust command | — | `cargo test <module>` + E2E tag from `TEST_MANIFEST.md` |
| Sidecar agent invocation (`app/sidecar/`) | `cd app && npm run test:agents:structural` (tell user to run Promptfoo `test:agents:smoke` manually) | `cd app/sidecar && npx vitest run` |
| Agent prompt (`agents/`) | `cd app && npm run test:agents:structural` | `npm run test:unit` (canonical-format) |
| Agent output format (`agents/`) | `cd app && npm run test:agents:structural` (tell user to run Promptfoo `test:agents:smoke` manually) | `npm run test:unit` (canonical-format) |
| `agent-sources/workspace/CLAUDE.md` | `cd app && npm run test:agents:structural` | `npm run test:unit` |
| Mock templates or E2E fixtures | — | `npm run test:unit` |
| Shared infrastructure (`src/lib/tauri.ts`, test mocks) | — | `app/tests/run.sh` (all levels) |

### Autonomous test triggers (coding agents)

When changed files match these patterns, run the mapped tests automatically before reporting completion:

| Changed files | Run |
|---|---|
| `agent-sources/agents/*.md` | `cd app && npm run test:agents:structural` |
| `agent-sources/workspace/**` | `cd app && npm run test:agents:structural` |
| `app/sidecar/**` | `cd app && npm run test:agents:structural` and `cd app/sidecar && npx vitest run` |
| `app/sidecar/mock-templates/**` | `cd app && npm run test:unit` |
| `app/e2e/fixtures/agent-responses/**` | `cd app && npm run test:unit` |

`test:agents:smoke` (Promptfoo) is manual by default because it makes live API calls.

**Artifact format changes** (agent output format + app parser + mock templates): run `cd app && npm run test:agents:structural` and `npm run test:unit`, then tell the user to run `cd app && npm run test:agents:smoke` (Promptfoo evals) manually. The `canonical-format.test.ts` suite is the canary for format drift across the boundary.

**Unsure?** `app/tests/run.sh` runs everything.

### Agent test policy

**Only `test:agents:structural` may be run autonomously** — it makes no API calls and is free.

`test:agents:smoke` uses Promptfoo and makes real API calls. **Do not run it autonomously; tell the user to run it manually.**

## Design Docs

Design notes live in `docs/design/`. Each topic gets its own subdirectory with a `README.md` (e.g. `docs/design/backend-design/README.md`). The index at `docs/design/README.md` must be updated when adding a new subdirectory.

Write design docs concisely — state the decision and the reason, not the reasoning process. One sentence beats a paragraph. Avoid restating what the code already makes obvious.

Research output schemas and envelopes are documented in:

- `docs/design/agent-specs/canonical-format.md` — high-level artifact contracts
- `agent-sources/plugins/skill-content-researcher/skills/research/references/schemas.md` — canonical `research_output` schema

## Code Style

- Granular commits: one concern per commit, run tests before each
- Stage specific files — use `git add <file>` not `git add .`
- All `.md` files must pass `markdownlint` before committing (`markdownlint <file>`)
- When editing `AGENTS.md`, `CLAUDE.md`, `.claude/rules/`, or `.claude/skills/`, run `bash app/scripts/lint-agent-docs.sh`
- Verify before committing: `cd app && npx tsc --noEmit` + `cargo check --manifest-path app/src-tauri/Cargo.toml`
- Canonical naming and error-handling conventions live in `.claude/rules/coding-conventions.md`

### Frontend (`app/src/`)

For AD brand rules, component constraints, and state indicator conventions, see:

- `.claude/rules/frontend-design.md`

### Rust backend (`app/src-tauri/`)

Command conventions, error types, and Rust-specific testing guidance live in `.claude/rules/rust-backend.md`.

### Sidecar (`app/sidecar/`)

Protocol and sidecar-specific constraints live in `.claude/rules/agent-sidecar.md`.

### Error handling

See `.claude/rules/coding-conventions.md` for canonical error-handling policy.

## Issue Management

- **PR title format:** `VU-XXX: short description`
- **PR body link:** `Fixes VU-XXX`
- **Linear project:** All issues created for this repository must be created under **Skill Builder**.
- **Worktrees:** `../worktrees/<branchName>` relative to repo root. Full rules: `.claude/rules/git-workflow.md`.

## Skills

Use these repo-local skills when requests match:

- `.claude/skills/create-linear-issue/SKILL.md` — create/log/file a Linear issue, bug, feature, or ticket decomposition
- `.claude/skills/implement-linear-issue/SKILL.md` — implement/fix/work on a Linear issue (e.g. `VU-123`)
- `.claude/skills/close-linear-issue/SKILL.md` — close/complete/ship/merge a Linear issue
- `.claude/skills/tauri/SKILL.md` — Tauri-specific implementation or debugging
- `.claude/skills/shadcn-ui/SKILL.md` — shadcn/ui component work
- `.claude/skills/front-end-design/SKILL.md` — design-first UI workflow for screens and components

## Logging

Every new feature must include logging. Canonical logging conventions and log-level guidance live in `.claude/rules/logging-policy.md`.

## Gotchas

- **SDK has NO team tools:** `@anthropic-ai/claude-agent-sdk` does NOT support TeamCreate, TaskCreate, SendMessage. Use the Task tool for sub-agents instead. Multiple Task calls in the same turn run in parallel.
- **Parallel worktrees:** `npm run dev` auto-assigns a free port — safe to run multiple Tauri instances simultaneously.
