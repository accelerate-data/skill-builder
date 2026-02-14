# Skill Builder

Multi-agent workflow for creating domain-specific Claude skills. Two frontends (CLI plugin + Tauri desktop app) share the same agents and references.

@import CLAUDE-APP.md
@import CLAUDE-PLUGIN.md

## Workflow (9 steps)

0. **Init** -- skill type selection, name confirmation, resume detection
1. **Research Concepts** -- research agent writes `clarifications-concepts.md`
2. **Concepts Review** -- user answers questions
3. **Research Patterns + Data + Merge** -- orchestrator spawns sub-agents
4. **Human Review** -- user answers merged questions
5. **Reasoning** -- multi-turn conversation, produces `decisions.md`
6. **Build** -- creates SKILL.md + reference files
7. **Validate & Test** -- checks against best practices, generates and evaluates test prompts
8. **Package / Refine** -- zip for distribution (plugin) or iterative chat (app)

## Model Tiers

| Role | Model |
|---|---|
| Research agents (Steps 1, 3) | sonnet |
| Merge (Step 3) | haiku |
| Reasoning (Step 5) | opus |
| Build / Validate & Test (Steps 6-7) | sonnet |

The app overrides this with a global user preference in Settings. The plugin uses per-agent model tiers defined in agent frontmatter.

## Extended Thinking

Agent prompts are optimized for thinking mode using goal-oriented patterns (not step-by-step prescriptions). When Claude Code adds `thinking` or `effort` as frontmatter fields, update:
- reasoning agents: `effort: max`
- build agents: `effort: high`
- research orchestrators: `effort: high`
- validate/test agents: `effort: medium`
- merge agent: thinking disabled (haiku)

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
./scripts/build-agents.sh               # Regenerate 20 agent files from templates
./scripts/build-agents.sh --check       # Check if generated files are stale (CI)
./scripts/validate.sh                    # Structural validation
./scripts/test-plugin.sh                 # Full test harness (T1-T5)
claude --plugin-dir .                    # Load plugin locally
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

**Plugin:** Agent prompts and coordinator changes are validated by the existing test tiers — don't write new tests, run the appropriate tier instead (see below).

### Test discipline

Before writing any test code, read existing tests for the files you changed:
1. Update tests that broke due to your changes
2. Remove tests that are now redundant
3. Add new tests only for genuinely new behavior
4. Never add tests just to increase count — every test must catch a real regression

### Choosing which tests to run

Consult `app/tests/TEST_MANIFEST.md` to determine which tests cover the files you're changing — during planning to scope the work, and before committing to verify coverage.

**App quick rules:**
- Changed a store? → `./tests/run.sh unit` + E2E tag from manifest
- Changed a component? → `./tests/run.sh integration` + E2E tag from manifest
- Changed a Rust command? → `cargo test` + E2E tag if UI-facing
- Changed `src/lib/tauri.ts` or test mocks? → `./tests/run.sh` (all levels)
- Unsure? → `./tests/run.sh` runs everything

**Plugin quick rules:**
- Changed a template (`agents/templates/`) or type config (`agents/types/`)? → `./scripts/build-agents.sh && ./scripts/test-plugin.sh t1`
- Changed a shared agent (`agents/shared/`)? → `./scripts/test-plugin.sh t1`
- Changed the coordinator (`skills/start/SKILL.md`)? → `./scripts/test-plugin.sh t1 t2 t3`
- Changed `references/shared-context.md`? → `./scripts/test-plugin.sh t1`
- Changed `.claude-plugin/plugin.json`? → `./scripts/test-plugin.sh t1 t2`
- Unsure? → `./scripts/test-plugin.sh` runs all tiers

**Cross-cutting** (shared files affect both app and plugin):
- Changed `agents/`, `references/`, or `.claude-plugin/`? → run both `./tests/run.sh plugin --tag <tag>` and `./scripts/test-plugin.sh t1`

### Plugin test tiers

| Tier | Name | What it tests | Cost |
|---|---|---|---|
| **T1** | Structural Validation | Plugin manifest, agent count (23), frontmatter, model tiers | Free |
| **T2** | Plugin Loading | Plugin loads into `claude -p`, skill trigger responds | ~$0.05 |
| **T3** | Start Mode Detection | Modes A/B/C detected correctly using fixtures | ~$0.25 |
| **T4** | Agent Smoke Tests | Merge deduplicates, reasoning produces decisions, build creates SKILL.md | ~$0.50 |
| **T5** | Full E2E Workflow | End-to-end `/skill-builder:start` with auto-answered gates | ~$5.00 |

Environment variables: `PLUGIN_DIR`, `CLAUDE_BIN`, `MAX_BUDGET_T4`, `MAX_BUDGET_T5`, `KEEP_TEMP`, `VERBOSE`.

**E2E tags:** `@dashboard`, `@settings`, `@workflow`, `@workflow-agent`, `@navigation`

**Plugin tags:** `@structure`, `@agents`, `@coordinator`, `@workflow`, `@all`

### Updating the test manifest

When you add, remove, or rename tests (including adding tests to existing files), update `app/tests/TEST_MANIFEST.md` to keep test counts and source-to-test mappings current. The manifest has tables per source category (stores, hooks, components, pages, Rust, sidecar, plugin). Each row maps a source file to its unit tests, integration tests, and E2E tag with counts in parentheses.

## Code Style

- Granular commits: one concern per commit, run tests before each

## Gotchas

- **SDK has NO team tools**: `@anthropic-ai/claude-agent-sdk` does NOT support TeamCreate, TaskCreate, SendMessage. Use the Task tool for sub-agents. Multiple Task calls in same turn run in parallel.
- **Parallel worktrees**: Set `DEV_PORT=<port>` to avoid conflicts (convention: `1000 + issue_number`).
- **Generated agents**: Files in `agents/{domain,platform,source,data-engineering}/` are generated — edit `agents/templates/` or `agents/types/` instead, then run `./scripts/build-agents.sh`.

## Shared Components

Both frontends use the same files -- no conversion needed:
- `agents/{type}/` -- 5 agents per type (4 types = 20 files), **generated** by `scripts/build-agents.sh`
- `agents/templates/` -- 5 phase templates (source of truth for agent content)
- `agents/types/` -- 4 type configs with output examples (focus lines, entity examples)
- `agents/shared/` -- 3 shared sub-agents (merge, research-patterns, research-data)
- `references/shared-context.md` -- domain definitions, file formats, content principles
- `references/agent-protocols.md` -- rerun/resume, before-you-start, sub-agent communication protocols
- `references/validate-best-practices.md` -- embedded skill best practices for validate agents

**Adding a new skill type:** Create `agents/types/<name>/config.conf` + `output-examples/`, run `./scripts/build-agents.sh`.

## Skill Configuration

### Issue Management
- **PR title format**: `VD-XXX: short description`
- **PR body link**: `Fixes VD-XXX`

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
