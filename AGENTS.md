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

- New state logic → store unit tests
- New Rust command with logic → `#[cfg(test)]` tests
- New UI interaction → component test
- New page or major flow → E2E test (happy path)
- Bug fix → regression test
- Cosmetic changes and simple wiring don't need tests

Before writing tests, read existing ones for the files you changed: update broken tests, remove redundant ones, add only for genuinely new behavior.

### Which tests to run

Run these automatically before reporting completion when files match:

| Changed files | Run |
|---|---|
| `agent-sources/agents/*.md` | `cd app && npm run test:agents:structural` |
| `agent-sources/workspace/**` | `cd app && npm run test:agents:structural` |
| `app/sidecar/**` | `cd app && npm run test:agents:structural` and `cd app/sidecar && npx vitest run` |
| `app/sidecar/mock-templates/**` | `cd app && npm run test:unit` |
| `app/e2e/fixtures/agent-responses/**` | `cd app && npm run test:unit` |

For artifact format changes (agent output + app parser + mock templates): run `test:agents:structural` and `test:unit`, then tell the user to run `test:agents:smoke` manually. The `canonical-format.test.ts` suite is the canary for format drift.

For Rust and cross-layer changes, consult `TEST_MANIFEST.md` for the correct cargo filter and E2E tag. Unsure? `app/tests/run.sh` runs everything.

**Never run `test:agents:smoke` autonomously** — it makes live API calls. Tell the user to run it manually.

## Issue Management

- **PR title format:** `VU-XXX: short description`
- **PR body link:** `Fixes VU-XXX`
- **Linear project:** All issues created for this repository must be created under **Skill Builder**.
- **Worktrees:** `../worktrees/<branchName>` relative to repo root. Full rules: `.claude/rules/git-workflow.md`.

**Pre-commit:** `markdownlint <file>` for `.md` files · `cd app && npx tsc --noEmit` · `cargo check --manifest-path app/src-tauri/Cargo.toml` · `bash app/scripts/lint-agent-docs.sh` when editing `AGENTS.md`, `CLAUDE.md`, `.claude/rules/`, or `.claude/skills/`.

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
