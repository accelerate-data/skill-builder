# Scripts Directory

Automation scripts for the Skill Builder project.

## Directory Structure

```text
scripts/
├── README.md                      # This file
├── build-plugin-skill.sh          # Package workspace CLAUDE.md into skill references
├── validate.sh                    # Structural validation
└── eval/                          # Skill evaluation harness
    ├── README.md                  # Evaluation documentation
    ├── eval-skill-quality.sh      # Main evaluation script
    └── prompts/                   # Test prompts by skill type
```

## Plugin Tests

Plugin tests run via Vitest from `app/`. See `app/tests/README.md` for the full test guide.

### Quick reference (run from `app/`)

```bash
cd app

npm run test:plugin              # All plugin tests (free checks + LLM, skip LLM if no API key)
npm run test:plugin:structural   # Structural checks only — free, no API key needed
npm run test:plugin:loading      # Plugin loading tests (~$0.30)
npm run test:plugin:modes        # State detection + intent dispatch (~$0.40)
npm run test:plugin:agents       # Agent smoke tests (~$0.50)
npm run test:plugin:workflow     # Full E2E workflow (~$5)
FOREGROUND=1 ./tests/run.sh plugin workflow   # Full E2E with live Claude output
```

Each `it()` block is a standalone Vitest test — filter by name:

```bash
npx vitest run --config vitest.config.plugin.ts -t "agent exists: answer-evaluator"
npx vitest run --config vitest.config.plugin.ts -t "detects: clarification"
```

LLM tests are skipped automatically when `ANTHROPIC_API_KEY` is not set.

### What to run after a change

| What changed | Command |
|---|---|
| `agents/*.md` | `cd app && npm run test:plugin:structural` |
| `skills/building-skills/SKILL.md` | `cd app && npm run test:plugin` |
| Agent instructions (`agent-sources/workspace/CLAUDE.md`) | `./scripts/build-plugin-skill.sh && cd app && npm run test:plugin:structural` |
| Agent behavior (smoke test) | `cd app && npm run test:plugin:agents` |
| Full workflow | `cd app && npm run test:plugin:workflow` |

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Required for LLM tests |
| `CLAUDE_BIN` | `claude` | Path to the Claude CLI binary |
| `PLUGIN_DIR` | repo root | Override the plugin directory |
| `MAX_BUDGET_LOADING` | `0.10` | Max spend (USD) for loading tests |
| `MAX_BUDGET_MODES` | `0.25` | Max spend (USD) for mode detection tests |
| `MAX_BUDGET_AGENTS` | `0.50` | Max spend (USD) for agent smoke tests |
| `MAX_BUDGET_WORKFLOW` | `5.00` | Max spend (USD) for full E2E |
| `FOREGROUND` | `0` | Set to `1` to stream Claude output live during workflow test |

---

## Scripts Overview

**`build-plugin-skill.sh`**

- Packages `agent-sources/workspace/CLAUDE.md` as `workspace-context.md` into `skills/building-skills/references/`
- Run after modifying workspace CLAUDE.md
- Use `--check` flag to verify references are fresh (for CI)

**`validate.sh`**

- Structural validation: plugin manifest, agent frontmatter, model tiers, reference files, coordinator content
- Fast and free — no LLM calls

**`eval/eval-skill-quality.sh`**

- Multi-perspective skill evaluation harness
- See `eval/README.md` for documentation

---

## CI/CD Integration

**Validation (runs on every PR — free):**

```bash
./scripts/build-plugin-skill.sh --check
./scripts/validate.sh
cd app && npm run test:plugin:structural
```

**Full plugin testing:**

```bash
cd app && npm run test:plugin           # LLM tests (requires API key)
cd app && npm run test:plugin:workflow  # Full E2E (~$5)
```

---

## Development Workflow

1. Modify agents in `agents/` or coordinator in `skills/building-skills/SKILL.md`
2. If you modified `agent-sources/workspace/CLAUDE.md`, run `./scripts/build-plugin-skill.sh`
3. Validate: `./scripts/validate.sh`
4. Test: `cd app && npm run test:plugin` (or individual suite for what you changed)
5. Full E2E: `cd app && npm run test:plugin:workflow` (optional, expensive)

## See Also

- `eval/README.md` — Comprehensive skill evaluation documentation
- `../CLAUDE.md` — Main development guide
- `../CLAUDE-PLUGIN.md` — Plugin-specific documentation
