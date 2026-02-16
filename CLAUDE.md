# Skill Builder

Multi-agent workflow for creating domain-specific Claude skills. Two frontends (CLI plugin + Tauri desktop app) share the same agents and references.

@import CLAUDE-APP.md
@import CLAUDE-PLUGIN.md

## Workflow (7 steps)

0. **Init** -- skill type selection, name confirmation, resume detection
1. **Research** -- research orchestrator spawns concepts + practices + implementation sub-agents, consolidation agent produces `clarifications.md`
2. **Review** -- user answers `clarifications.md`
3. **Detailed Research** -- detailed-research orchestrator spawns per-section sub-agents + consolidation → `clarifications-detailed.md`
4. **Review** -- user answers `clarifications-detailed.md`
5. **Confirm Decisions** -- confirm-decisions agent produces `decisions.md`
6. **Generate Skill** -- creates SKILL.md + reference files
7. **Validate Skill** -- checks against best practices, generates and evaluates test prompts

## Model Tiers

| Role | Model |
|---|---|
| Research agents (Steps 1, 3) | sonnet |
| Consolidate Research (Steps 1, 3) | opus |
| Confirm Decisions (Step 5) | opus |
| Generate / Validate (Steps 6-7) | sonnet |
| Test evaluators (Step 7) | haiku |

The app overrides this with a global user preference in Settings. The plugin uses per-agent model tiers defined in agent frontmatter.

## Extended Thinking

Agent prompts are optimized for thinking mode using goal-oriented patterns (not step-by-step prescriptions). When Claude Code adds `thinking` or `effort` as frontmatter fields, update:
- confirm-decisions agent: `effort: max`
- generate-skill agents: `effort: high`
- research orchestrators: `effort: high`
- validate-skill agents: `effort: medium`
- consolidate-research agent: `effort: high`

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

# Skill evaluation (LLM-as-judge)
./scripts/eval-skill-quality.sh --help                        # Usage info
./scripts/eval-skill-quality.sh --baseline path/to/SKILL.md \ # Skill vs no-skill
  --prompts scripts/eval-prompts/data-engineering.txt
./scripts/eval-skill-quality.sh --compare v1/SKILL.md v2/SKILL.md \ # Skill vs skill
  --prompts scripts/eval-prompts/data-engineering.txt
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
- Changed the coordinator (`skills/generate-skill/SKILL.md`)? → `./scripts/test-plugin.sh t1 t2 t3`
- Changed `workspace/CLAUDE.md` (agent instructions)? → `./scripts/test-plugin.sh t1`
- Changed `.claude-plugin/plugin.json`? → `./scripts/test-plugin.sh t1 t2`
- Unsure? → `./scripts/test-plugin.sh` runs all tiers

**Cross-cutting** (shared files affect both app and plugin):
- Changed `agents/`, `references/`, or `.claude-plugin/`? → run both `./tests/run.sh plugin --tag <tag>` and `./scripts/test-plugin.sh t1`

### Plugin test tiers

| Tier | Name | What it tests | Cost |
|---|---|---|---|
| **T1** | Structural Validation | Plugin manifest, agent count (24), frontmatter, model tiers | Free |
| **T2** | Plugin Loading | Plugin loads into `claude -p`, skill trigger responds | ~$0.05 |
| **T3** | Start Mode Detection | Modes A/B/C detected correctly using fixtures | ~$0.25 |
| **T4** | Agent Smoke Tests | Consolidate-research produces cohesive output, confirm-decisions produces decisions, generate-skill creates SKILL.md | ~$0.50 |
| **T5** | Full E2E Workflow | End-to-end `/skill-builder:generate-skill` with auto-answered gates | ~$5.00 |

Environment variables: `PLUGIN_DIR`, `CLAUDE_BIN`, `MAX_BUDGET_T4`, `MAX_BUDGET_T5`, `KEEP_TEMP`, `VERBOSE`.

**E2E tags:** `@dashboard`, `@settings`, `@workflow`, `@workflow-agent`, `@navigation`

**Plugin tags:** `@structure`, `@agents`, `@coordinator`, `@workflow`, `@all`

### Skill evaluation harness (LLM-as-judge)

`scripts/eval-skill-quality.sh` measures whether a built skill actually improves Claude's output. It generates responses with and without a skill loaded, then uses an LLM judge to score both on a 4-dimension rubric.

**Modes:**
- `--baseline <skill-path>` — skill-loaded vs no-skill (does the skill help?)
- `--compare <skill-a> <skill-b>` — two skill versions head-to-head (is v2 better?)

**Rubric** (each 1-5, same dimensions as validate agents): actionability, specificity, domain depth, self-containment.

**Test prompts** live in `scripts/eval-prompts/` (one file per skill type, prompts separated by `---`). Currently available: `data-engineering.txt` (5 prompts).

**Environment variables:** `CLAUDE_BIN`, `JUDGE_MODEL` (default: sonnet), `RESPONSE_MODEL` (default: sonnet), `VERBOSE`.

**Cost:** ~$0.50-1.00 per prompt (2 response generations + 1 judge call). A full 5-prompt DE evaluation run costs ~$3-5.

**When to use:**
- After changing focus lines, entity examples, or output examples in `agents/types/` — run baseline mode to verify the skill type still beats no-skill
- When iterating on prompt content — run compare mode with before/after versions to measure improvement

### Updating the test manifest

When you add, remove, or rename tests (including adding tests to existing files), update `app/tests/TEST_MANIFEST.md` to keep test counts and source-to-test mappings current. The manifest has tables per source category (stores, hooks, components, pages, Rust, sidecar, plugin). Each row maps a source file to its unit tests, integration tests, and E2E tag with counts in parentheses.

## Code Style

- Granular commits: one concern per commit, run tests before each

## Gotchas

- **SDK has NO team tools**: `@anthropic-ai/claude-agent-sdk` does NOT support TeamCreate, TaskCreate, SendMessage. Use the Task tool for sub-agents. Multiple Task calls in same turn run in parallel.
- **Parallel worktrees**: `npm run dev` auto-assigns a free port.
- **Generated agents**: Files in `agents/{domain,platform,source,data-engineering}/` are generated — edit `agents/templates/` or `agents/types/` instead, then run `./scripts/build-agents.sh`. Shared agents in `agents/shared/` are edited directly.

## Shared Components

Both frontends use the same files -- no conversion needed:
- `agents/{type}/` -- 5 agents per type (4 types = 20 files), **generated** by `scripts/build-agents.sh`
- `agents/templates/` -- 5 phase templates (research-concepts, research-practices, research-implementation, research, generate-skill)
- `agents/types/` -- 4 type configs with output examples (focus lines, entity examples)
- `agents/shared/` -- 4 shared agents (consolidate-research, confirm-decisions, validate-skill, detailed-research)
- `workspace/CLAUDE.md` -- agent instructions (protocols, content principles, best practices); deployed to `.claude/CLAUDE.md` in workspace

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
