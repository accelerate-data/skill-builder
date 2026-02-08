# Skill Builder

A Claude Code plugin that provides a multi-agent workflow for creating domain-specific Claude skills. Domain-agnostic — you choose the functional domain at startup. Skills target data/analytics engineers who need functional context for silver and gold table modeling.

## Installation

```bash
# Install from local directory
claude --plugin-dir /path/to/skill-builder

# Or install from GitHub (future)
# claude plugin install owner/skill-builder
```

## Usage

Once the plugin is loaded, invoke the workflow:

```
/skill-builder:start
```

The coordinator handles everything: creating an agent team, spawning agents, tracking state, and walking you through each step.

## Workflow Overview

| Step | What Happens | Your Role |
|---|---|---|
| **Init** | Choose a domain and skill name | Provide domain, confirm name |
| **Step 1** | Research agent identifies key entities, metrics, KPIs | Wait |
| **Step 2** | Review domain concept questions | Answer each question in the file |
| **Step 3** | Two agents research business patterns + data modeling (parallel) | Wait |
| **Step 4** | Merge agent deduplicates questions | Wait |
| **Step 5** | Review merged clarification questions | Answer each question in the file |
| **Step 6** | Reasoning agent analyzes answers, finds gaps/contradictions | Confirm reasoning, answer follow-ups |
| **Step 7** | Build agent creates the skill files | Review skill structure |
| **Step 8** | Validator checks against best practices | Review validation log |
| **Step 9** | Tester generates and runs test prompts | Review test results |
| **Step 10** | Package into a `.skill` zip archive | Done |

## Architecture

The plugin has three layers:

1. **Coordinator skill** (`skills/start/SKILL.md`) — the entry point invoked via `/skill-builder:start`. Orchestrates the full workflow using agent teams (TeamCreate/SendMessage/TeamDelete).

2. **Subagents** (`agents/*.md`) — each has YAML frontmatter (name, model, tools, permissions) and markdown instructions. Spawned as teammates by the coordinator.

3. **Shared reference** (`references/shared-context.md`) — domain definitions, file formats, content principles. Read by all agents at runtime.

### Agent Team Orchestration

The coordinator creates an agent team at the start of the workflow. Each agent is spawned as a teammate with access to a shared task list. Agents work concurrently where steps are independent (e.g., Step 3 runs two research agents in parallel).

### Agents

| Agent | Model | Role |
|---|---|---|
| `research-concepts` | sonnet | Domain concepts, entities, metrics, KPIs |
| `research-patterns` | sonnet | Business patterns and edge cases |
| `research-data` | sonnet | Silver/gold layer modeling, source systems |
| `merge` | haiku | Question deduplication across research outputs |
| `reasoning` | opus | Gap analysis, contradiction detection, decisions |
| `build` | sonnet | Skill file creation (SKILL.md + references) |
| `validate` | sonnet | Best practices validation and auto-fix |
| `test` | sonnet | Test prompt generation and coverage evaluation |

## Plugin Structure

```
skill-builder/
├── .claude-plugin/
│   └── plugin.json              # Plugin manifest
├── skills/
│   └── start/
│       └── SKILL.md             # Coordinator (entry point)
├── agents/
│   ├── research-concepts.md     # Step 1
│   ├── research-patterns.md     # Step 3a
│   ├── research-data.md         # Step 3b
│   ├── merge.md                 # Step 4
│   ├── reasoning.md             # Step 6
│   ├── build.md                 # Step 7
│   ├── validate.md              # Step 8
│   └── test.md                  # Step 9
├── references/
│   └── shared-context.md        # Shared context for all agents
├── CLAUDE.md                    # Plugin development docs
├── README.md                    # This file
└── LICENSE
```

## Output

All output is created in your current working directory:

```
./                               # Your CWD
├── workflow-state.md            # Session resume checkpoint
├── context/                     # Working files
│   ├── clarifications-*.md      # Research outputs
│   ├── clarifications.md        # Merged questions + answers
│   ├── decisions.md             # Confirmed decisions
│   ├── agent-validation-log.md  # Validation results
│   └── test-skill.md            # Test results
└── <skillname>/                 # Deployable skill
    ├── SKILL.md                 # Entry point (<500 lines)
    └── references/              # Deep-dive content
```

A `.skill` zip archive is also created at the project root after Step 10.

## Session Resume

The workflow supports resuming from any step. State is tracked in `./workflow-state.md`. On restart, you'll be asked whether to continue or start fresh.

## Development

### Validate plugin structure

```bash
# Run automated checks (manifest, agents, frontmatter, coordinator, etc.)
./scripts/validate.sh
```

This also runs automatically after every Edit/Write via the Claude Code hook in `.claude/settings.json`.

### Test the plugin locally

```bash
# Start Claude Code with the plugin loaded
claude --plugin-dir .

# Then invoke the workflow
/skill-builder:start
```

### Validate the manifest

```bash
claude plugin validate .
```

See `CLAUDE.md` for the full development guide, `TESTS.md` for the test plan, and `FEATURES.md` for the feature checklist.

## Prerequisites

- Claude Code with access to sonnet, haiku, and opus models
- Internet access (for the validation agent's best practices fetch)
