# Skill Builder

Multi-agent workflow for creating domain-specific Claude skills. Two frontends (CLI plugin + Tauri desktop app) share the same agents and references.

@import CLAUDE-APP.md
@import CLAUDE-PLUGIN.md

**Companion files** (imported above, must be reviewed together with this file):
- `CLAUDE-APP.md` — Desktop app architecture, Rust/frontend conventions, logging rules, git/publishing workflow
- `CLAUDE-PLUGIN.md` — Plugin structure, agent management, validation hooks

## Workflow (7 steps)

0. **Init** -- skill type selection, name confirmation, resume detection
1. **Research** -- research orchestrator uses opus planner to select relevant research dimensions, launches all in parallel, opus consolidation produces `clarifications.md`. If planner selects more dimensions than the configured threshold, spawns scope-advisor instead (produces scope recommendation in `clarifications.md`, downstream steps no-op)
2. **Review** -- user answers `clarifications.md`
3. **Detailed Research** -- detailed-research orchestrator reads answered `clarifications.md`, spawns per-section sub-agents, consolidation inserts `#### Refinements` subsections back into `clarifications.md`
4. **Review** -- user answers the refinement questions in `clarifications.md`
5. **Confirm Decisions** -- confirm-decisions agent produces `decisions.md`
6. **Generate Skill** -- creates SKILL.md + reference files
7. **Validate Skill** -- checks against best practices, generates and evaluates test prompts

## Model Tiers

| Role | Model |
|---|---|
| Research agents (Steps 1, 3) | sonnet |
| Simpler research dimensions (config-patterns, reconciliation, field-semantics, lifecycle-and-state) | haiku |
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
MOCK_AGENTS=true npm run dev             # Mock mode (no API calls, replays bundled templates)

# Testing (all from app/)
./tests/run.sh                           # All levels (unit + integration + e2e + plugin + eval)
./tests/run.sh unit                      # Level 1: stores, utils, hooks, rust, sidecar
./tests/run.sh integration               # Level 2: component + page tests
./tests/run.sh e2e                       # Level 3: Playwright
./tests/run.sh e2e --tag @workflow       # Level 3, filtered by tag
./tests/run.sh eval                      # Eval harness tests
npm run test:unit                        # Unit tests only (frontend)
npm run test:integration                 # Integration tests only (frontend)
npm run test:e2e                         # All E2E tests
cd src-tauri && cargo test               # Rust tests

# Plugin
./scripts/build-plugin-skill.sh         # Package workspace CLAUDE.md into skill references
./scripts/build-plugin-skill.sh --check # Check if reference files are stale (CI)
./scripts/validate.sh                    # Structural validation
./scripts/test-plugin.sh                 # Full test harness (T1-T5)
claude --plugin-dir .                    # Load plugin locally

# Skill evaluation (LLM-as-judge)
./scripts/eval/eval-skill-quality.sh --help                        # Usage info
./scripts/eval/eval-skill-quality.sh --baseline path/to/SKILL.md \ # Skill vs no-skill
  --prompts scripts/eval/prompts/data-engineering.txt
./scripts/eval/eval-skill-quality.sh --compare v1/SKILL.md v2/SKILL.md \ # Skill vs skill
  --prompts scripts/eval/prompts/data-engineering.txt
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

**Frontend (stores, hooks, components, pages):** Use `npm run test:changed` to auto-detect and run tests affected by your changes. This uses `vitest --changed` which traces module dependencies — no manual mapping needed. For targeted runs: `npm run test:unit`, `npm run test:integration`, or specific test files.

**Rust:** Run `cargo test --manifest-path src-tauri/Cargo.toml <module>` for the module you changed. If the command is UI-facing, also run the cross-layer E2E tag from `app/tests/TEST_MANIFEST.md`.

**Sidecar:** `cd sidecar && npx vitest run`

**Shared infrastructure** (`src/lib/tauri.ts`, test mocks, config files): Run `./tests/run.sh` (all levels). See the manifest for the full list.

**App quick rules:**
- Changed a store/hook/component/page? → `npm run test:changed`
- Changed a Rust command? → `cargo test <module>` + E2E tag from `app/tests/TEST_MANIFEST.md`
- Changed `src/lib/tauri.ts` or test mocks? → `./tests/run.sh` (all levels)
- Unsure? → `./tests/run.sh` runs everything

**Plugin quick rules:**
- Changed an agent (`agents/`)? → `./scripts/test-plugin.sh t1`
- Changed the coordinator (`skills/generate-skill/SKILL.md`)? → `./scripts/test-plugin.sh t1 t2 t3`
- Changed `agent-sources/workspace/CLAUDE.md` (agent instructions)? → `./scripts/build-plugin-skill.sh && ./scripts/test-plugin.sh t1`
- Changed `.claude-plugin/plugin.json`? → `./scripts/test-plugin.sh t1 t2`
- Unsure? → `./scripts/test-plugin.sh` runs all tiers

**Eval quick rules:**
- Changed `scripts/eval/eval-skill-quality.sh` or `scripts/eval/test-eval-harness.sh`? → `./tests/run.sh eval`
- Changed `scripts/eval/prompts/`? → no tests needed (prompts are data files)

**Cross-cutting** (shared files affect both app and plugin):
- Changed `agents/`, `references/`, or `.claude-plugin/`? → `./scripts/test-plugin.sh t1`

### Plugin test tiers

| Tier | Name | What it tests | Cost |
|---|---|---|---|
| **T1** | Structural Validation | Plugin manifest, agent count (26), frontmatter, model tiers | Free |
| **T2** | Plugin Loading | Plugin loads into `claude -p`, skill trigger responds | ~$0.05 |
| **T3** | Start Mode Detection | Modes A/B/C detected correctly using fixtures | ~$0.25 |
| **T4** | Agent Smoke Tests | Consolidate-research produces cohesive output, confirm-decisions produces decisions, generate-skill creates SKILL.md | ~$0.50 |
| **T5** | Full E2E Workflow | End-to-end `/skill-builder:generate-skill` with auto-answered gates | ~$5.00 |

Environment variables: `PLUGIN_DIR`, `CLAUDE_BIN`, `MAX_BUDGET_T4`, `MAX_BUDGET_T5`, `KEEP_TEMP`, `VERBOSE`.

**E2E tags:** `@dashboard`, `@navigation`, `@prompts`, `@settings`, `@skills`, `@usage`, `@workflow`, `@workflow-agent`

**Plugin tags:** `@structure`, `@agents`, `@coordinator`, `@workflow`, `@all`

### Skill evaluation harness (LLM-as-judge)

`scripts/eval/eval-skill-quality.sh` measures whether a built skill actually improves Claude's output. It generates responses with and without a skill loaded, then uses an LLM judge to score on a 7-dimension rubric.

**Modes:**
- `--baseline <skill-path>` — skill-loaded vs no-skill (does the skill help?)
- `--compare <skill-a> <skill-b>` — two skill versions head-to-head (is v2 better?)

**Perspectives** (`--perspective`): `quality` (default), `cost`, `performance`, `all` (includes recommendations and production readiness).

**Rubric** (each 1-5): Quality — actionability, specificity, domain depth, self-containment. Claude Practices — progressive disclosure, structure/organization, Claude-centric design.

**Test prompts** live in `scripts/eval/prompts/` (one file per skill type, prompts separated by `---`). Available: `data-engineering.txt`, `domain.txt`, `platform.txt`, `source.txt` (5 prompts each).

**Environment variables:** `CLAUDE_BIN`, `JUDGE_MODEL` (default: sonnet), `RESPONSE_MODEL` (default: sonnet), `VERBOSE`, `INPUT_COST_PER_MTOK`, `OUTPUT_COST_PER_MTOK`.

**Cost:** ~$0.70-1.40 per prompt (2 response generations + 2 judge calls). A full 5-prompt evaluation run costs ~$4-7.

**When to use:**
- After changing agent prompts in `agents/` — run baseline mode to verify the skill type still beats no-skill
- When iterating on prompt content — run compare mode with before/after versions to measure improvement
- Use `--perspective all` for a comprehensive assessment including cost efficiency and production readiness

### Updating the test manifest

Update `app/tests/TEST_MANIFEST.md` only when adding new Rust commands (add the cargo test filter + E2E tag), new E2E spec files, new plugin source patterns, or changing shared infrastructure files. Frontend test mappings are handled automatically by `vitest --changed` and naming conventions.

## Code Style

- Granular commits: one concern per commit, run tests before each

## Gotchas

- **SDK has NO team tools**: `@anthropic-ai/claude-agent-sdk` does NOT support TeamCreate, TaskCreate, SendMessage. Use the Task tool for sub-agents. Multiple Task calls in same turn run in parallel.
- **Parallel worktrees**: `npm run dev` auto-assigns a free port.

## Shared Components

Both frontends use the same files -- no conversion needed:
- `agents/` -- 26 agents (18 research dimensions + planner + orchestrator + scope-advisor + consolidate-research + detailed-research + confirm-decisions + generate-skill + validate-skill)
- `agent-sources/workspace/CLAUDE.md` -- agent instructions (protocols, content principles, best practices); the app deploys this to `.claude/CLAUDE.md` in workspace, the plugin packages it into `skills/generate-skill/references/` via `scripts/build-plugin-skill.sh`

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
