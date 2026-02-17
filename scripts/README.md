# Scripts Directory

Automation scripts for the Skill Builder project.

## Directory Structure

```
scripts/
├── README.md                      # This file
├── build-plugin-skill.sh          # Package workspace CLAUDE.md into skill references
├── validate.sh                    # Structural validation (T1 checks)
├── test-plugin.sh                 # Full plugin test harness (T1-T5)
├── eval/                          # Skill evaluation harness
│   ├── README.md                  # Evaluation documentation
│   ├── eval-skill-quality.sh      # Main evaluation script
│   ├── prompts/                   # Test prompts by skill type
│   │   ├── data-engineering.txt
│   │   ├── domain.txt
│   │   ├── platform.txt
│   │   └── source.txt
│   └── results/                   # Evaluation outputs (gitignored)
└── plugin-tests/                  # Plugin test harness
    ├── lib.sh                     # Shared test utilities
    ├── fixtures.sh                # Test fixtures
    ├── t1-structural.sh           # T1: Structural validation
    ├── t2-plugin-loading.sh       # T2: Plugin loading
    ├── t3-mode-detection.sh       # T3: Mode detection
    ├── t4-agent-smoke.sh          # T4: Agent smoke tests
    └── t5-e2e-workflow.sh         # T5: E2E workflow

```

## Scripts Overview

### Plugin Build & Validation

**`build-plugin-skill.sh`**
- Packages `agent-sources/workspace/CLAUDE.md` into 4 reference files under `skills/generate-skill/references/`
- Run after modifying workspace CLAUDE.md
- Use `--check` flag to verify references are fresh (for CI)
- Usage: `./scripts/build-plugin-skill.sh` or `./scripts/build-plugin-skill.sh --check`

**`validate.sh`**
- Structural validation (T1 checks)
- Validates plugin manifest, agent frontmatter, model tiers, reference files
- Fast, runs in CI/CD
- Usage: `./scripts/validate.sh`

**`test-plugin.sh`**
- Full test harness (T1-T5)
- Runs all plugin tests including E2E workflows
- Requires Claude CLI and API key
- Usage: `./scripts/test-plugin.sh`

### Skill Evaluation

**`eval/eval-skill-quality.sh`**
- Multi-perspective skill evaluation harness
- Measures quality, cost, and performance
- See `eval/README.md` for detailed documentation
- Usage: `./scripts/eval/eval-skill-quality.sh --help`

## Quick Commands

```bash
# Build reference files (after modifying workspace CLAUDE.md)
./scripts/build-plugin-skill.sh
./scripts/build-plugin-skill.sh --check       # Verify references are fresh (CI)

# Plugin validation
./scripts/validate.sh                         # Structural validation (free)
./scripts/test-plugin.sh                      # Full test harness (requires API key)

# Skill evaluation
./scripts/eval/eval-skill-quality.sh \
  --baseline path/to/SKILL.md \
  --prompts scripts/eval/prompts/data-engineering.txt

# See eval/README.md for comprehensive evaluation documentation
```

## Environment Variables

**Plugin Testing:**
- `ANTHROPIC_API_KEY` - Required for test harness
- `CLAUDE_BIN` - Path to claude binary (default: `claude`)
- `VERBOSE` - Set to `1` for verbose output

**Skill Evaluation:**
- `ANTHROPIC_API_KEY` - Required for evaluation
- `CLAUDE_BIN` - Path to claude binary (default: `claude`)
- `JUDGE_MODEL` - Model for judge LLM (default: `sonnet`)
- `RESPONSE_MODEL` - Model for responses (default: `sonnet`)
- `VERBOSE` - Set to `1` for verbose output

## CI/CD Integration

**Validation (runs on every PR):**
```bash
./scripts/build-plugin-skill.sh --check
./scripts/validate.sh
```

**Full Testing (runs on main branch):**
```bash
./scripts/test-plugin.sh
```

**Skill Evaluation (manual/scheduled):**
```bash
./scripts/eval/eval-skill-quality.sh \
  --baseline path/to/SKILL.md \
  --prompts scripts/eval/prompts/data-engineering.txt \
  --perspective all \
  --format json \
  --output results/evaluation-$(date +%Y%m%d).json
```

## Development Workflow

1. **Modify agents** in `agents/`
2. **Modify agent instructions** in `agent-sources/workspace/CLAUDE.md` → run `./scripts/build-plugin-skill.sh`
3. **Validate changes**: `./scripts/validate.sh`
4. **Test locally**: `./scripts/test-plugin.sh`
5. **Evaluate skills**: `./scripts/eval/eval-skill-quality.sh` (see eval/README.md)

## See Also

- `eval/README.md` - Comprehensive skill evaluation documentation
- `plugin-tests/lib.sh` - Test utilities and helpers
- `../CLAUDE.md` - Main development guide
- `../CLAUDE-PLUGIN.md` - Plugin-specific documentation
