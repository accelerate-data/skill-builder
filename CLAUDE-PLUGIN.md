# Skill Builder — Claude Code Plugin

A Claude Code plugin that provides a multi-agent workflow for creating domain-specific Claude skills. Targets data/analytics engineers who need functional context for silver and gold table modeling.

## Quick Start (Development)

```bash
# Test locally from any directory
claude --plugin-dir /path/to/this/repo

# Then invoke the skill
/skill-builder:start
```

## Plugin Structure

```
skill-builder/
├── .claude-plugin/
│   ├── plugin.json                  # Plugin manifest
│   └── marketplace.json             # Marketplace registry (name, owner, plugin list)
├── .claude/
│   └── settings.json                # Dev hooks (runs validate.sh after Edit/Write)
├── scripts/
│   └── validate.sh                  # Automated structural validation (T1 checks)
├── skills/
│   └── start/
│       └── SKILL.md                 # Entry point: /skill-builder:start (coordinator)
├── agents/
│   ├── domain/                             # Domain skill agents (name prefix: domain-)
│   ├── platform/                           # Platform skill agents (name prefix: platform-)
│   ├── source/                             # Source skill agents (name prefix: source-)
│   ├── data-engineering/                   # Data engineering skill agents (name prefix: de-)
│   │   └── (each type dir has 6 agents: research-concepts, reasoning, build, validate, test, research-patterns-and-merge)
│   └── shared/                             # Shared agents (no type prefix)
│       ├── research-patterns.md            # Business patterns researcher (sub-agent)
│       ├── research-data.md                # Data modeling researcher (sub-agent)
│       └── merge.md                        # Question deduplicator (sub-agent)
├── references/
│   └── shared-context.md            # Shared context read by all agents at runtime
├── CLAUDE.md                        # This file (plugin dev instructions)
├── README.md                        # User-facing plugin docs
├── LICENSE
└── .gitignore
```

## Architecture

The plugin has three layers:

1. **Coordinator skill** (`skills/start/SKILL.md`) — invoked via `/skill-builder:start`. Contains the full 9-step + init workflow orchestration. Uses `!`echo $CLAUDE_PLUGIN_ROOT`` to resolve paths to plugin files at runtime.

2. **Subagents** (`agents/{type}/*.md` and `agents/shared/*.md`) — each has YAML frontmatter (name, model, tools, permissions) and markdown instructions. Type-specific agents are spawned via `Task(subagent_type: "skill-builder:{type_prefix}-{agent}")`, shared agents via `Task(subagent_type: "skill-builder:{agent}")`.

3. **Shared reference** (`references/shared-context.md`) — domain definitions, file formats, content principles. Read by agents at the path the coordinator passes in the Task prompt.

### Context Conservation Principle

The coordinator's context window is the scarcest resource in the workflow. **All heavy work — research, analysis, generation, validation — must be delegated to subagents via Task calls.** The coordinator exists only to orchestrate, pass parameters, and relay short summaries to the user.

Rules:
1. **Never read agent output files into the coordinator context.** Agents write to disk; the coordinator tells the user where to find the files and relays the summary the agent returned.
2. **Prefer subagents over inline work.** If a step involves reading multiple files, reasoning over content, or producing output longer than a few lines, it belongs in a subagent — not in the coordinator.
3. **Summaries only flow up.** Each Task prompt must end with an instruction like "Return a 5–10 bullet summary." The coordinator uses that summary for progress updates and to inform the next step's prompt — nothing more.
4. **Parallel where independent.** Steps that don't depend on each other must be dispatched as parallel Task calls in a single message to reduce wall-clock time without expanding coordinator context.

### Path Resolution

- Plugin files: `${CLAUDE_PLUGIN_ROOT}/references/shared-context.md` (resolved by coordinator skill via shell injection)
- Output files in the user's CWD (not the plugin directory):
  - `./workflow-state.md` — session state
  - `./context/` — working files
  - `./<skillname>/` — deployable skill (SKILL.md + references/)
- Coordinator passes skill directory, context directory, and shared context paths to agents when spawning them

### Agent Orchestration

The coordinator uses **agent teams** (TeamCreate / Task with team_name / SendMessage / TeamDelete) to orchestrate the workflow. This gives the coordinator visibility into agent progress, enables inter-agent communication, and supports parallel execution with shared task lists.

```
# 1. Create the team at workflow start
TeamCreate(team_name: "skill-builder-<skillname>", description: "Building <domain> skill")

# 2. Create tasks for the team's shared task list
TaskCreate(subject: "Research domain concepts", description: "...")

# 3. Spawn agents as teammates (type_prefix derived from skill_type)
Task(
  subagent_type: "skill-builder:{type_prefix}-research-concepts",
  team_name: "skill-builder-<skillname>",
  name: "research-concepts",
  model: "sonnet",
  prompt: "Domain: <domain>. Shared context: <plugin_root>/references/shared-context.md. Write to ./context/clarifications-concepts.md. Claim your task from the task list, mark it complete when done, and return a 5-10 bullet summary."
)

# 4. Coordinate via messages
SendMessage(type: "message", recipient: "research-concepts", content: "...", summary: "...")

# 5. Clean up when workflow completes
TeamDelete()
```

### Model Selection

| Agent | Model | Rationale |
|---|---|---|
| research-concepts | **sonnet** | Structured research, runs in parallel |
| research-patterns-and-merge | **sonnet** | Orchestrator: spawns patterns + data researchers + merger |
| reasoning | **opus** | Deep analytical reasoning, contradiction detection |
| build | **sonnet** | Content generation and structured writing |
| validate | **sonnet** | Checking against best practices |
| test | **sonnet** | Test generation and evaluation |

## Start Modes

Only one skill is active at a time. The coordinator detects which mode to use based on the filesystem:

| Mode | Condition | Behavior |
|---|---|---|
| **A — Resume** | `workflow-state.md` exists | Continue from last completed step, or start fresh |
| **B — Modify existing** | `SKILL.md` exists but no `workflow-state.md` | Skip to Step 5 (reasoning) to refine the existing skill |
| **C — Scratch** | No skill directory | Full workflow from Step 0 |

## Workflow (9 Steps + Init)

| Step | Agent | What Happens | Human Gate? |
|---|---|---|---|
| Init | — | User provides domain, skill name, skill type | Yes (confirm name) |
| 1 | research-concepts | Research key entities, metrics, KPIs | No |
| 2 | — | User answers domain concept questions | **Yes** |
| 3 | research-patterns-and-merge | Research patterns + data + merge (single orchestrator) | No |
| 4 | — | User answers merged questions | **Yes** |
| 5 | reasoning | Analyze answers, find gaps, update decisions | **Yes** (confirm reasoning) |
| 6 | build | Create SKILL.md + reference files | Yes (confirm structure) |
| 7 | validate | Check against best practices | Yes (review log) |
| 8 | test | Generate + evaluate test prompts | Yes (review results) |
| 9 | — | Package into .skill zip | No |

## Output Data Model (in user's CWD)

```
./                                       # User's CWD
├── workflow-state.md                    # Session resume checkpoint
├── context/                             # Working files
│   ├── clarifications-concepts.md       # Step 1 output
│   ├── clarifications-patterns.md       # Step 3 internal output (orchestrator)
│   ├── clarifications-data.md           # Step 3 internal output (orchestrator)
│   ├── clarifications.md               # Step 3 merged output
│   ├── decisions.md                     # Step 5 output
│   ├── agent-validation-log.md          # Step 7 output
│   └── test-skill.md                    # Step 8 output
└── <skillname>/                         # Deployable skill
    ├── SKILL.md                         # Entry point (<500 lines)
    └── references/                      # Deep-dive files
```

## Development Guide

### Adding/modifying an agent

1. Edit the agent file in `agents/` — frontmatter controls model, tools, permissions
2. The markdown body IS the agent's system prompt
3. Agents receive runtime parameters (domain, paths) from the coordinator's Task prompt
4. Agents read `references/shared-context.md` at the path provided by the coordinator

### Modifying the workflow

Edit `skills/start/SKILL.md`. This contains the full coordinator logic:
- Session resume
- All 9 steps + init with agent spawning instructions
- Human review gates
- Error recovery
- Context conservation rules

### Testing changes

**Automated validation** runs automatically after every Edit/Write via a Claude Code hook (configured in `.claude/settings.json`). It checks:
- Manifest validity (JSON, required fields)
- All 27 agent files exist with valid frontmatter (name, description, model, tools as comma-separated string)
- Model tiers match the spec (sonnet/haiku/opus)
- Coordinator skill exists with frontmatter and references TeamCreate, TeamDelete, CLAUDE_PLUGIN_ROOT, etc.
- Shared context exists, old files removed, .gitignore correct

Run manually: `./scripts/validate.sh`

**Live testing** (requires interactive session):
```bash
# Load plugin from local directory
claude --plugin-dir .

# Invoke the workflow
/skill-builder:start

# Or test a specific agent directly
# (from within a Claude Code session with the plugin loaded)
```

**Test harness** (`scripts/test-plugin.sh`):

A reusable test runner with 5 tiers of increasing cost and scope:

```bash
./scripts/test-plugin.sh           # Run all tiers
./scripts/test-plugin.sh t1        # Run only T1 (free, no LLM)
./scripts/test-plugin.sh t1 t2     # Run T1 and T2
./scripts/test-plugin.sh --list    # List available tiers
```

| Tier | Name | What it tests | LLM cost |
|---|---|---|---|
| **T1** | Structural Validation | `claude plugin validate`, `scripts/validate.sh`, agent file count (27), frontmatter presence, model tiers, coordinator keywords, plugin.json fields | Free |
| **T2** | Plugin Loading | Plugin loads into `claude -p`, skill trigger responds with domain/skill keywords | ~$0.05 |
| **T3** | Start Mode Detection | Mode A (resume), B (modify), C (scratch) detected correctly using fixture directories | ~$0.25 |
| **T4** | Agent Smoke Tests | Merge agent deduplicates questions, reasoning agent produces decisions, build agent creates SKILL.md + references | ~$0.50 |
| **T5** | Full E2E Workflow | Runs `/skill-builder:start` end-to-end with auto-answered gates, checks all workflow artifacts | ~$5.00 |

Environment variables: `PLUGIN_DIR`, `CLAUDE_BIN`, `MAX_BUDGET_T4`, `MAX_BUDGET_T5`, `KEEP_TEMP`, `VERBOSE`.

Test files live in `scripts/tests/`: `lib.sh` (shared utilities), `fixtures.sh` (test data), and `t1-t5` tier scripts.

### When adding a new feature

Before implementing, reason about what tests are needed:

1. **Does the change affect plugin structure?** (new files, renamed agents, changed frontmatter) → Add checks to `scripts/validate.sh` and add a T1 test case in `scripts/tests/`.
2. **Does the change affect coordinator behavior?** (new steps, changed orchestration, modified gates) → Add a T3 test case in `scripts/tests/` and verify the coordinator content check in `scripts/validate.sh` covers any new keywords.
3. **Does the change affect an agent's output format or behavior?** → Add a T4 test case in `scripts/tests/` and consider adding a live test via `claude -p --plugin-dir .`.
4. **Does the change affect the workflow end-to-end?** → Add a T5 test case in `scripts/tests/`.
5. **Not sure what tests to add?** → Propose 2-3 options with tradeoffs (automated vs. manual, structural vs. behavioral) and decide before implementing.

The goal: every feature change has a corresponding test — either an automated check in `scripts/validate.sh` or a documented test in `scripts/tests/`. If you can't determine the right test, stop and propose options before writing code.

### Key constraints

- **`skills/start/SKILL.md`**: The coordinator. Must not read agent output files into its own context (context conservation). Only relays summaries.
- **Agent definitions**: Must specify `model` in frontmatter. The coordinator does NOT override models — it uses whatever the agent definition specifies.
- **`references/shared-context.md`**: Read by every agent. Changes here affect all agents.
- **Plugin caching**: Plugins are copied to a cache dir on install. All references must be within the plugin directory or in the user's CWD.

## Key Reference

- [Claude Code Plugin docs](https://code.claude.com/docs/en/plugins)
- [Plugin reference](https://code.claude.com/docs/en/plugins-reference)
- [Subagent docs](https://code.claude.com/docs/en/sub-agents)
- [Hooks reference](https://code.claude.com/docs/en/hooks)
- [Skills docs](https://code.claude.com/docs/en/skills)
