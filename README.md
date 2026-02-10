# Skill Builder

A multi-agent workflow for creating domain-specific Claude skills. Domain-agnostic — you choose the functional domain at startup. Skills target data/analytics engineers who need functional context for silver and gold table modeling.

## Platforms

| Platform | Status | How to Use |
| --- | --- | --- |
| **Claude Code Plugin** | Production | `/skill-builder:start` — see [Installation](#installation-plugin) |
| **Desktop App** (Tauri) | Complete | See [Desktop App](#desktop-app) |

Both platforms share the same agent prompts (`agents/`) and reference material (`references/`). Agents are organized by skill type (platform, domain, source, data-engineering) with shared sub-agents. The workflows differ slightly in step count and model selection.

## Installation (Plugin)

### From GitHub

```
/plugin marketplace add hbanerjee74/skill-builder
/plugin install skill-builder@skill-builder-marketplace
```

### From local directory (development)

```bash
claude --plugin-dir /path/to/skill-builder
```

## Usage (Plugin)

Once the plugin is loaded, invoke the workflow:

```
/skill-builder:start
```

The coordinator handles everything: creating an agent team, spawning agents, tracking state, and walking you through each step.

## Agents

Both platforms use the same agent files from `agents/`, organized by skill type. Each skill type has its own set of 6 agents, plus 3 shared sub-agents.

### Type-specific agents (in `agents/{type}/`)

Each type directory (`domain/`, `platform/`, `source/`, `data-engineering/`) contains:

| Agent File | Role |
|---|---|
| `research-concepts.md` | Orchestrator: spawns entity + metrics researchers, merges results |
| `research-patterns-and-merge.md` | Orchestrator: spawns patterns + data researchers + merger |
| `reasoning.md` | Gap analysis, contradiction detection, decisions |
| `build.md` | Skill file creation (spawns reference file writers) |
| `validate.md` | Best practices validation (spawns parallel validators) |
| `test.md` | Test generation + evaluation (spawns parallel testers) |

### Shared agents (in `agents/shared/`)

| Agent File | Role |
|---|---|
| `research-patterns.md` | Sub-agent: business patterns research |
| `research-data.md` | Sub-agent: data modeling research |
| `merge.md` | Sub-agent: question deduplication |

### Skill Types

| Type | Focus |
|---|---|
| **Platform** | Tool/platform-specific (dbt, Fabric, Databricks) |
| **Domain** | Business domain knowledge (Finance, Marketing, Supply Chain) |
| **Source** | Source system extraction patterns (Salesforce, SAP, Workday) |
| **Data Engineering** | Technical patterns (SCD Type 2, Incremental Loads) |

Shared reference: `references/shared-context.md` — domain definitions, file formats, content principles read by all agents.

## Workflow

### Plugin (9 Steps + Init)

The plugin uses Claude Code's native agent teams. The coordinator (`skills/start/SKILL.md`) orchestrates each step, selecting the model per-agent (sonnet for research, haiku for merge, opus for reasoning).

| Step | What Happens | Your Role |
|---|---|---|
| **Init** | User provides domain, skill name, skill type | Provide domain, confirm name |
| **Step 1** | Research agent identifies key entities, metrics, KPIs | Wait |
| **Step 2** | Review domain concept questions | Answer each question |
| **Step 3** | Research patterns + data + merge (single orchestrator) | Wait |
| **Step 4** | Review merged clarification questions | Answer each question |
| **Step 5** | Reasoning agent analyzes answers, finds gaps/contradictions | Confirm reasoning, answer follow-ups |
| **Step 6** | Build agent creates the skill files | Review skill structure |
| **Step 7** | Validator checks against best practices | Review validation log |
| **Step 8** | Tester generates and runs test prompts | Review test results |
| **Step 9** | Package into a `.skill` zip archive | Done |

### Desktop App (9 Steps)

The app combines parallel research + merge into a single orchestrator step and collects the skill name before the workflow starts. Model selection is a **global user preference** in Settings (one model for all agents).

| Step | What Happens | Your Role |
|---|---|---|
| **0** | Research domain concepts (orchestrator) | Wait |
| **1** | Review domain concept questions | Answer via form UI |
| **2** | Research patterns + data + merge (single orchestrator) | Wait |
| **3** | Review merged questions | Answer via form UI |
| **4** | Reasoning — analyze answers, find gaps | Confirm reasoning, chat follow-ups |
| **5** | Build skill files | Review structure |
| **6** | Validate against best practices | Review log |
| **7** | Test — generate and evaluate test prompts | Review results |
| **8** | Package into `.skill` zip | Done |

## Repo Structure

```
skill-builder/
├── .claude-plugin/
│   ├── plugin.json              # Plugin manifest
│   └── marketplace.json         # Marketplace registry (name, owner, plugin list)
├── skills/
│   └── start/
│       └── SKILL.md             # Plugin coordinator (entry point)
├── agents/                      # Agent prompts organized by skill type
│   ├── domain/                  # Domain skill agents (6 files)
│   ├── platform/                # Platform skill agents (6 files)
│   ├── source/                  # Source skill agents (6 files)
│   ├── data-engineering/        # Data engineering skill agents (6 files)
│   └── shared/                  # Shared sub-agents (3 files: merge, research-patterns, research-data)
├── references/
│   └── shared-context.md        # Shared context for all agents
├── app/                         # Desktop application
│   ├── src/                     # React frontend
│   ├── src-tauri/               # Rust backend
│   └── sidecar/                 # Node.js agent runner (Claude Agent SDK)
├── scripts/
│   └── validate.sh              # Plugin structural validation
├── CLAUDE.md                    # Developer guide overview
├── CLAUDE-PLUGIN.md             # Plugin development docs
├── CLAUDE-APP.md                # Desktop app development docs
├── README.md                    # This file
└── LICENSE
```

## Output

Both platforms produce the same skill output structure:

```
<skillname>/
├── context/                     # Intermediate working files
│   ├── clarifications-concepts.md
│   ├── clarifications-patterns.md
│   ├── clarifications-data.md
│   ├── clarifications.md
│   ├── decisions.md
│   ├── agent-validation-log.md
│   └── test-skill.md
└── skill/                       # Deployable skill
    ├── SKILL.md                 # Entry point (<500 lines)
    └── references/              # Deep-dive content
```

A `.skill` zip archive is created after the final step.

### Session Resume

Both platforms support resuming from any step. The plugin uses `workflow-state.md`; the app uses SQLite.

## Desktop App

The desktop app (`app/`) is a **Tauri v2** application providing a GUI for the skill builder workflow.

### Tech Stack

**Frontend:** React 19, TypeScript, Vite 7, Tailwind CSS 4, shadcn/ui, Zustand, TanStack Router

**Backend:** Tauri 2, Rust, rusqlite, pulldown-cmark

**Agent Runtime:** Node.js sidecar using `@anthropic-ai/claude-agent-sdk` — agents get all Claude Code tools (Read, Write, Glob, Grep, Bash, Task)

### Settings

- **Anthropic API key** — required for agent execution
- **Preferred model** — global choice of Sonnet 4.5, Haiku 4.5, or Opus 4.6 (used for all agent steps)
- **Extended context** — toggle for 1M token context window
- **Workspace folder** — where skills are stored

### Development

```bash
cd app
npm install
npm run tauri dev     # Dev mode (hot reload)
npm run tauri build   # Production build
```

Requires: Node.js 18–24, Rust toolchain, platform-specific [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

### Testing

```bash
cd app
npm test              # Frontend unit tests (Vitest)
cd src-tauri && cargo test   # Rust tests
npm run test:e2e      # E2E tests (Playwright)
```

## Development (Plugin)

### Validate plugin structure

```bash
./scripts/validate.sh
```

Also runs automatically after every Edit/Write via the Claude Code hook in `.claude/settings.json`.

### Test locally

```bash
claude --plugin-dir .
/skill-builder:start
```

## Prerequisites

- **Plugin**: Claude Code with access to sonnet, haiku, and opus models
- **Desktop App**: Node.js 18–24, Anthropic API key

## License

See [LICENSE](LICENSE) for details.
