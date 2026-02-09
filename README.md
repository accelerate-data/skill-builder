# Skill Builder

A multi-agent workflow for creating domain-specific Claude skills. Domain-agnostic — you choose the functional domain at startup. Skills target data/analytics engineers who need functional context for silver and gold table modeling.

## Platforms

| Platform | Status | How to Use |
| --- | --- | --- |
| **Claude Code Plugin** | Production | `/skill-builder:start` — see [Installation](#installation) |
| **Desktop App** (Tauri) | In development (`feature/desktop-ui`) | See [Desktop App](#desktop-app) |

Both platforms run the same 10-step workflow with the same agent prompts. The plugin uses Claude Code's native orchestration, while the desktop app provides a standalone GUI.

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

## Workflow Overview

| Step | What Happens | Your Role |
|---|---|---|
| **Init** | Choose a domain and skill name | Provide domain, confirm name |
| **Step 1** | Research agent identifies key entities, metrics, KPIs | Wait |
| **Step 2** | Review domain concept questions | Answer each question |
| **Step 3** | Two agents research business patterns + data modeling (parallel) | Wait |
| **Step 4** | Merge agent deduplicates questions | Wait |
| **Step 5** | Review merged clarification questions | Answer each question |
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
├── app/                         # Desktop application (Tauri + React)
│   ├── src/                     # React frontend
│   ├── src-tauri/               # Rust backend
│   └── sidecar/                 # Node.js agent runner
├── CLAUDE.md                    # Developer guide overview
├── CLAUDE-PLUGIN.md             # Plugin development docs
├── CLAUDE-APP.md                # Desktop app development docs
├── README.md                    # This file
└── LICENSE
```

## Output (Plugin)

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

### Session Resume

The workflow supports resuming from any step. State is tracked in `./workflow-state.md`. On restart, you'll be asked whether to continue or start fresh.

## Development (Plugin)

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

See `CLAUDE-PLUGIN.md` for the full plugin development guide, `TESTS.md` for the test plan, and `FEATURES.md` for the feature checklist.

## Desktop App

The desktop app (`app/`) is a **Tauri v2** application that provides a GUI for the skill builder workflow. It's in active development on the `feature/desktop-ui` branch.

### Why Tauri

- ~10MB binary vs 150MB+ Electron
- Rust backend for fast file I/O, SQLite persistence, secure API key storage
- Tauri events for streaming Claude API responses to the UI
- API keys stay in the Rust backend, never in the webview

### Tech Stack

**Frontend** (React + TypeScript in Tauri webview):

| Layer | Choice |
| --- | --- |
| Framework | React 19 + TypeScript |
| Build | Vite 7 |
| UI Components | shadcn/ui (Radix + Tailwind CSS 4) |
| State | Zustand |
| Routing | TanStack Router |
| Data fetching | TanStack Query |
| Forms | React Hook Form + Zod |
| Markdown | react-markdown + remark-gfm + rehype-highlight |

**Backend** (Rust / Tauri):

| Module | Choice |
| --- | --- |
| HTTP | reqwest (streaming SSE for Claude API) |
| File watching | notify |
| Markdown parsing | pulldown-cmark |
| Settings | rusqlite (SQLite) |

### Key UI Views

1. **Dashboard** — Grid of skill cards with progress, actions (Continue/Reset/Delete), "+ New Skill"
2. **Workflow Wizard** — Step progression sidebar, streaming agent output, form-based Q&A for review steps
3. **Chat Interface** — Conversational editing and review+suggest modes for post-build refinement
4. **Skill Editor** — Three-pane layout: file tree, CodeMirror source editor, live markdown preview
5. **Settings** — Anthropic API key, workspace folder, Node.js status

### Development (Desktop App)

```bash
cd app
npm install
npm run dev  # Starts both Vite and Tauri in dev mode
```

Prerequisites: Node.js, Rust toolchain, platform-specific Tauri dependencies (see [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)).

### Testing (Desktop App)

```bash
cd app

# Frontend unit tests (Vitest + React Testing Library)
npm test

# Rust unit + integration tests
cd src-tauri && cargo test

# E2E tests (Playwright — launches Vite dev server automatically)
npm run test:e2e
```

See `CLAUDE-APP.md` for full desktop app development documentation.

### Implementation Status

| Phase | Scope | Status |
| --- | --- | --- |
| 1. Foundation | Tauri scaffold, settings, dashboard, skill CRUD | Done |
| 2. Core Agent Loop | Sidecar + SDK, agent commands, streaming UI, Step 1 E2E | Done |
| 3. Q&A Forms | Markdown parser, form components, Steps 2 and 5 | Done |
| 4. Full Workflow | All 10 steps, parallel agents, reasoning loop, packaging | Done |
| 5. SQLite Migration | Replace plugin-store with rusqlite, remove GitHub/git | Done |
| 6. Editor | CodeMirror editor, split pane, file tree, auto-save | Done |
| 7. Chat | Conversational edit + review/suggest modes | Done |
| 8. Polish | Error states, retry UX, loading states, keyboard shortcuts | Done |

## Prerequisites

- **Plugin**: Claude Code with access to sonnet, haiku, and opus models
- **Desktop App**: Node.js 18+, Anthropic API key

## License

See [LICENSE](LICENSE) for details.
