# Skill Builder

Desktop app for creating domain-specific Claude Code-compatible skills. Tauri desktop app (React + Rust) orchestrates agents via a Node.js sidecar.

**Maintenance rule:** This file contains architecture, conventions, and guidelines — not product details. Do not add counts, feature descriptions, or any fact that can be discovered by reading code. If it will go stale when the code changes, it doesn't belong here — point to the source file instead.

## Instruction Hierarchy

Use this precedence when maintaining agent guidance:

1. `AGENTS.md` (canonical, cross-agent source of truth)
2. `.claude/rules/*.md` (shared detailed rules; agent-agnostic content)
3. `agent-sources/**` (runtime agent, plugin, skill, and workspace instructions)
4. Agent-specific adapter files (for example `CLAUDE.md`) that reference canonical docs

Adapter files must not duplicate canonical policy unless they are adding agent-specific behavior.

## Architecture

| Layer | Technology |
|---|---|
| Desktop framework | Tauri v2 |
| Frontend | React 19, TypeScript strict, Vite 8 |
| Styling | Tailwind CSS 4, shadcn/ui |
| State | Zustand, TanStack Router |
| Icons | Lucide React |
| Agent sidecar | Node.js + TypeScript + `@anthropic-ai/claude-agent-sdk` |
| Database | SQLite (`rusqlite` bundled) |
| Rust errors | `thiserror` |

**Agent runtime:** No hot-reload — restart `npm run dev` after editing `app/sidecar/`. Requires Node.js 18+.

**Key directories and paths:** See `repo-map.json` → `key_directories` and `notes_for_agents` (workspace path, DB location, module layout). Full storage layout: [`docs/design/agent-specs/storage.md`](docs/design/agent-specs/storage.md).

## Dev Commands

See `repo-map.json` → `commands` for the full command reference. Quick start:

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
| `repo-map.json` | Any file added, removed, or renamed inside `commands/`, `stores/`, `pages/`, `components/`, `lib/`, `hooks/` · sub-module directory added or restructured · new Tauri command file · entrypoint or package structure change |
| `README.md` | User-facing installation, configuration, commands, or architecture overview changes |
| `TEST_MANIFEST.md` | Rust command file added/removed · E2E spec added/removed · shared infra file added/removed · agent artifact format changes affecting a Rust or TS parser |

### Stable Repo Memory

#### Skill Path Convention

Read `app/plugin-paths.json` — it defines the canonical layout for all skill file paths.

## Testing

### When to write tests

- New state logic → store unit tests
- New Rust command with logic → `#[cfg(test)]` tests
- New UI interaction → component test
- New page or major page logic → page unit test (mocked children + Tauri) + E2E test (happy path)
- Bug fix → regression test
- Cosmetic changes and simple wiring don't need tests

Before writing tests, read existing ones for the files you changed: update broken tests, remove redundant ones, add only for genuinely new behavior.

### Which tests to run

Run these automatically before reporting completion when files match:

| Changed files | Run |
|---|---|
| `agent-sources/plugins/**/agents/*.md` | `cd app && npm run test:agents:structural` |
| `agent-sources/workspace/**` | `cd app && npm run test:agents:structural` |
| `app/sidecar/**` | `cd app && npm run test:agents:structural` and `cd app/sidecar && npx vitest run` |
| `app/sidecar/mock-templates/**` | `cd app && npm run test:unit` |
| `app/e2e/fixtures/agent-responses/**` | `cd app && npm run test:unit` |
| `app/src-tauri/src/contracts/**` | `cd app && npm run codegen && cd src-tauri && cargo test contracts::` |
| `app/src/**` | `cd app && npm run test:unit` |
| `tests/evals/**` | `cd tests/evals && npm test` |

**E2E tests** use Playwright to drive the real Tauri app UI, but with mocked Tauri commands (`__TAURI_MOCK_OVERRIDES__` / `reloadWithOverrides`). They are not bare-metal system tests — the backend is always mocked.

For artifact format changes (agent output + app parser + mock templates): run `test:agents:structural` and `test:unit`, then tell the user to run `test:agents:smoke` manually. The `canonical-format.test.ts` suite is the canary for format drift.

For Rust and cross-layer changes, consult `TEST_MANIFEST.md` for the correct cargo filter and E2E tag. Unsure? `app/tests/run.sh` runs everything.

**Never run `test:agents:smoke` autonomously unless explicitly requested** — it makes live API/model calls through the OpenCode eval harness in `tests/evals`. The deterministic harness contract test is `cd tests/evals && npm test`.

## Issue Management

- **PR title format:** `VU-XXX: short description`
- **PR body link:** `Fixes VU-XXX`
- **Linear project:** All issues created for this repository must be created under **Skill Builder**.
- **Worktrees:** Use `./scripts/worktree.sh <branch-name>` as the canonical maintainer workflow for creating or attaching a repo worktree and bootstrapping it. It preserves the full branch name under `../worktrees/<branchName>` and symlinks each worktree's `tests/evals/.promptfoo` back to the source checkout so Promptfoo history/database state stays out of feature worktrees.

  ```bash
  ./scripts/worktree.sh feature/<branch-name>
  ```

**Pre-commit:** `markdownlint <file>` for `.md` files · `cd app && npx tsc --noEmit` · `cargo clippy --manifest-path app/src-tauri/Cargo.toml -- -D warnings` · `bash app/scripts/lint-agent-docs.sh` when editing `AGENTS.md`, `CLAUDE.md`, or `.claude/rules/` · `cd app && npm run test:unit` when changing event types in `app/src/lib/` or `app/sidecar/`.

**Pre-PR `repo-map.json` audit (required):** Before opening or updating a PR, verify `repo-map.json` reflects the current codebase. Check:

- `rust_commands` flat-file list matches every `.rs` file directly under `app/src-tauri/src/commands/`
- `rust_commands` sub-module names match actual files inside `commands/workflow/`, `commands/imported_skills/`, `commands/github_import/`
- `frontend_stores` lists every file in `app/src/stores/` (excluding `index.ts`)
- `frontend_pages` lists every file in `app/src/pages/`
- Any removed file or renamed directory is reflected in the description

Update stale entries in the same commit that introduced the structural change, not as a follow-up.

**Implementation agents must commit and push before reporting completion.**

## Logging

Every new feature must include logging. Canonical logging conventions and log-level guidance live in `.claude/rules/logging-policy.md`.

## Gotchas

- **Parallel worktrees:** `npm run dev` auto-assigns a free port — safe to run multiple Tauri instances simultaneously.
- **Windows compatibility:** Path separators, CRLF line endings, env-var prefix syntax, and Rust toolchain selection are recurring sources of Windows CI failures. Follow `.claude/rules/windows-compat.md` before writing path assertions, regex, `package.json` scripts, or Rust CI config.
- **Linear Markdown — no double-escaping:** The `description` and `body` fields in `save_issue`/`save_comment` accept raw Markdown. Write literal newlines, `*`, `-`, `[ ]` etc. directly. Never escape them (`\\n`, `\\*`, `\\[X\\]`) — double-escaped descriptions render as garbled text in Linear.
- **State:** Component-local UI state must stay in `useState`, not Zustand. Use Zustand only for shared, cross-component, or navigation-persistent state. Full rules: `.claude/rules/state-management.md`.
