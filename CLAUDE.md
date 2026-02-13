# Skill Builder

Multi-agent workflow for creating domain-specific Claude skills. Two frontends (CLI plugin + Tauri desktop app) share the same agents and references.

@import CLAUDE-APP.md
@import CLAUDE-PLUGIN.md

## Dev Commands

```bash
# Desktop app
cd app && npm install && npm run sidecar:build
npm run dev                              # Dev mode (hot reload)

# Testing (all from app/)
./tests/run.sh                           # All levels (unit + integration + e2e)
./tests/run.sh unit                      # Level 1: stores, utils, hooks, rust, sidecar
./tests/run.sh integration               # Level 2: component + page tests
./tests/run.sh e2e                       # Level 3: Playwright
./tests/run.sh e2e --tag @workflow       # Level 3, filtered by tag
npm run test:unit                        # Unit tests only (frontend)
npm run test:integration                 # Integration tests only (frontend)
npm run test:e2e                         # All E2E tests
cd src-tauri && cargo test               # Rust tests

# Plugin
./scripts/validate.sh                    # Structural validation
./scripts/test-plugin.sh                 # Full test harness (T1-T5)
claude --plugin-dir .                    # Load plugin locally
```

## Code Style

- TypeScript strict mode, no `any`
- Zustand stores: one file per store in `app/src/stores/`
- Rust commands: one module per concern in `app/src-tauri/src/commands/`
- Tailwind 4 + shadcn/ui for all UI components
- Granular commits: one concern per commit, run tests before each

## Gotchas

- **SDK has NO team tools**: `@anthropic-ai/claude-agent-sdk` does NOT support TeamCreate, TaskCreate, SendMessage. Use the Task tool for sub-agents. Multiple Task calls in same turn run in parallel.
- **Node.js 18-24 only**: Node 25+ causes SDK crashes. Checked at app startup.
- **Parallel worktrees**: Set `DEV_PORT=<port>` to avoid conflicts (convention: `1000 + issue_number`).
- **Verify before committing**: `cd app && npx tsc --noEmit` (frontend) + `cargo check --manifest-path app/src-tauri/Cargo.toml` (backend)

## Shared Components

Both frontends use the same files -- no conversion needed:
- `agents/{type}/` -- 6 agents per type (domain, platform, source, data-engineering)
- `agents/shared/` -- 3 shared sub-agents (merge, research-patterns, research-data)
- `references/shared-context.md` -- domain definitions, file formats, content principles

## Custom Skills

### /create-issue
When the user runs /create-issue or asks to create a Linear issue, log a bug, file a ticket,
track a feature idea, break down a large issue, or decompose an issue into smaller ones
(e.g. "break down VD-123", "decompose VD-123", "split VD-123"),
read and follow the skill at `.claude/skills/create-linear-issue/SKILL.md`.

### /implement-issue
When the user runs /implement-issue, or mentions a Linear issue identifier (e.g. "VD-123", "implement VD-123",
"work on VD-452", "build VD-100", "fix VD-99"), or asks to implement, build, fix, or work on a Linear issue,
read and follow the skill at `.claude/skills/implement-linear-issue/SKILL.md`.

### /close-issue
When the user runs /close-issue, or asks to close, complete, merge, or ship a Linear issue (e.g. "close VD-123",
"merge VD-453", "ship VD-100", "complete VD-99"), read and follow the skill at
`.claude/skills/close-linear-issue/SKILL.md`.
