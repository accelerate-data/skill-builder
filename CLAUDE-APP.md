# Skill Builder — Desktop App

A Tauri v2 desktop application for building Claude skills. All code lives in `app/`.

## Architecture

```
┌──────────────────── Frontend (WebView) ──────────────────────┐
│  Dashboard │ Workflow Wizard │ Prompts │ Settings             │
│                        │                                     │
│              Zustand Store (skills, workflow, agents)        │
│                        │ Tauri IPC (invoke / events)         │
└────────────────────────┼─────────────────────────────────────┘
                         │
┌────────────────────────┼──── Backend (Rust) ─────────────────┐
│  ┌─────────────┐ ┌─────────────┐ ┌───────────┐               │
│  │ Agent       │ │ File System │ │ SQLite    │               │
│  │ Orchestrator│ │ Manager     │ │ (rusqlite)│               │
│  │ (spawns     │ │ (CRUD, MD   │ │ settings  │               │
│  │  Node.js    │ │  parsing,   │ │ storage   │               │
│  │  sidecar)   │ │  watching)  │ │           │               │
│  └──────┬──────┘ └─────────────┘ └───────────┘               │
│         │                                                    │
│  Workflow State Machine │ Settings │ Lifecycle               │
└─────────┼────────────────────────────────────────────────────┘
          │
┌─────────┼──── Node.js Sidecar ───────────────────────────────┐
│  Claude Agent SDK (@anthropic-ai/claude-agent-sdk)           │
│  - Gets all Claude Code tools (Read, Write, Glob, Grep, etc) │
│  - Sub-agent support (Task tool)                             │
│  - Tool execution loop handled by SDK                        │
│  - Streams JSON messages to Rust via stdout                  │
└──────────────────────────────────────────────────────────────┘
```

## Tech Stack

**Frontend:** React 19, TypeScript, Vite 7, Tailwind CSS 4, shadcn/ui, Zustand, TanStack Router, react-markdown

**Backend:** Tauri 2, rusqlite, notify, pulldown-cmark, tauri-plugin-shell, tokio

**Agent Runtime:** Node.js + `@anthropic-ai/claude-agent-sdk` (sidecar process)

**Runtime Dependency:** Node.js 18–24 (checked on startup, user prompted to install if missing; Node 25+ causes SDK crashes)

## Project Structure

```
app/
├── src/                              # React frontend
│   ├── main.tsx                      # Entry (providers + router)
│   ├── router.tsx                    # TanStack Router routes
│   ├── pages/                        # Page components (4 pages)
│   │   ├── dashboard.tsx             # Skill cards grid
│   │   ├── prompts.tsx               # Agent prompts viewer
│   │   ├── settings.tsx              # API key + workspace config
│   │   └── workflow.tsx              # Workflow wizard (9-step)
│   ├── components/
│   │   ├── ui/                       # shadcn/ui primitives (17 components)
│   │   ├── layout/                   # App shell (app-layout, sidebar, header)
│   │   ├── theme-provider.tsx        # Dark mode (next-themes)
│   │   ├── skill-card.tsx            # Dashboard skill card
│   │   ├── new-skill-dialog.tsx      # Create skill dialog
│   │   ├── delete-skill-dialog.tsx   # Delete confirmation
│   │   ├── close-guard.tsx           # Confirm-before-close when agents running
│   │   ├── agent-output-panel.tsx    # Streaming agent output with cancel button
│   │   ├── agent-status-header.tsx   # Agent run status indicator
│   │   ├── error-boundary.tsx        # React error boundary
│   │   ├── onboarding-dialog.tsx     # First-run onboarding
│   │   ├── splash-screen.tsx         # App splash screen
│   │   ├── tag-filter.tsx            # Skill tag filter bar
│   │   ├── tag-input.tsx             # Tag input component
│   │   ├── reasoning-chat.tsx        # Step 5 multi-turn reasoning chat
│   │   ├── refinement-chat.tsx       # Post-workflow skill refinement chat
│   │   ├── workflow-sidebar.tsx      # Step progression sidebar
│   │   └── workflow-step-complete.tsx # Step completion indicator
│   ├── stores/                       # Zustand state (4 stores)
│   │   ├── agent-store.ts
│   │   ├── settings-store.ts
│   │   ├── skill-store.ts
│   │   └── workflow-store.ts
│   ├── hooks/
│   │   └── use-agent-stream.ts      # Subscribe to Tauri agent events
│   ├── lib/
│   │   ├── utils.ts                 # cn() helper
│   │   ├── tauri.ts                 # Typed Tauri invoke wrappers
│   │   ├── types.ts                 # Shared TypeScript interfaces
│   │   └── reasoning-parser.ts      # Step 5 response classifier + extraction
│   └── styles/globals.css           # Tailwind + dark mode tokens + CSS color system
├── sidecar/                          # Node.js agent runner
│   ├── package.json                  # @anthropic-ai/claude-agent-sdk dep
│   ├── agent-runner.ts               # Entry — reads config from CLI argument, streams JSON to stdout
│   ├── tsconfig.json
│   └── build.js                      # esbuild bundle → single agent-runner.js
├── src-tauri/                        # Rust backend
│   ├── src/
│   │   ├── lib.rs                   # Plugin + command registration
│   │   ├── main.rs                  # Entry point
│   │   ├── types.rs                 # Shared types (AppSettings, etc.)
│   │   ├── db.rs                    # SQLite init, migrations, settings read/write
│   │   ├── commands/                # Tauri IPC handlers (9 modules)
│   │   │   ├── agent.rs             # start_agent (spawns sidecar)
│   │   │   ├── clarification.rs     # save_raw_file (persist clarification answers)
│   │   │   ├── files.rs             # list_skill_files, read_file (skill file tree + content)
│   │   │   ├── lifecycle.rs         # check_workspace_path, has_running_agents
│   │   │   ├── node.rs              # check_node (Node.js version check)
│   │   │   ├── settings.rs          # get_settings, save_settings, test_api_key
│   │   │   ├── skill.rs             # list_skills, create_skill, delete_skill
│   │   │   ├── workflow.rs          # run_review_step, run_workflow_step, package_skill
│   │   │   └── workspace.rs         # init_workspace, get_workspace_path, clear_workspace
│   │   ├── agents/                  # Sidecar management
│   │   │   ├── mod.rs
│   │   │   ├── sidecar.rs           # Spawn Node.js process, pass config as CLI arg
│   │   │   └── events.rs            # Parse JSON lines → Tauri events
│   │   └── (markdown/ removed — DB is single source of truth)
│   ├── Cargo.toml
│   └── tauri.conf.json              # bundles sidecar/dist/agent-runner.js
├── package.json
└── vite.config.ts
```

## Agent Orchestration (Claude Agent SDK)

Agents run via the **Claude Agent SDK** in a Node.js sidecar process. This gives us all Claude Code tools for free.

### How it works

1. **Rust backend** spawns `node agent-runner.js` as a child process
2. Passes agent config as a CLI argument (JSON): prompt, model, API key, cwd, allowed tools
3. **Sidecar** uses SDK's `query()` function with the config
4. SDK handles the full tool execution loop (Read, Write, Glob, Grep, Bash, Task)
5. Sidecar streams `SDKMessage` objects as JSON lines to stdout
6. **Rust backend** reads stdout line by line, parses JSON, emits Tauri events
7. **Frontend** subscribes to Tauri events for real-time display
8. To cancel: frontend unmount triggers process cleanup; no IPC cancel command needed

### Key benefits

- **No prompt modifications needed** — existing agent prompts work as-is since the SDK provides the same tools as Claude Code
- **Sub-agents work** — SDK supports the Task tool for spawning sub-agents (Step 2 orchestrator)
- **No tool execution loop to build** — SDK handles Claude → tool call → result → Claude internally
- **Session resume** — SDK supports `resume: sessionId` for continuing conversations (Step 4 reasoning)

### Agent logging

The sidecar creates log files under each skill's `logs/` directory: `{workspace}/{skill-name}/logs/{step_label}-{timestamp}.jsonl`. For example: `~/.vibedata/my-skill/logs/step0-research-concepts-2026-02-11T09-30-00.jsonl`. Each log file contains:
- First line: redacted config (API key replaced with `[REDACTED]`)
- Subsequent lines: raw JSON messages from stdout (same as Tauri events)
- stderr lines logged as `{"type":"stderr","content":"..."}`
- Final line: `{"type":"agent-exit","success":true|false}`

Useful for debugging agent runs: `tail -f ~/.vibedata/my-skill/logs/step0-research-concepts-*.jsonl`

### Sidecar config (passed as CLI argument)

```json
{
  "prompt": "Read references/shared-context.md and agents/{type}/research-concepts.md...",
  "model": "sonnet",
  "apiKey": "sk-ant-...",
  "cwd": "/path/to/workspace",
  "allowedTools": ["Read", "Write", "Glob", "Grep"],
  "maxTurns": 50,
  "permissionMode": "bypassPermissions",
  "sessionId": "abc-123",
  "betas": ["interleaved-thinking"],
  "pathToClaudeCodeExecutable": "/path/to/sdk/cli.js"
}
```

Optional fields (`sessionId`, `betas`, `pathToClaudeCodeExecutable`) are omitted when not set. `sessionId` enables session resume (used by Step 4 reasoning). `pathToClaudeCodeExecutable` is auto-resolved by the Rust backend to the bundled SDK cli.js.

### Sidecar output (JSON lines to stdout)

```json
{"type":"system","subtype":"init","session_id":"...","model":"sonnet","tools":["Read","Write"]}
{"type":"assistant","message":{"content":[{"type":"text","text":"Analyzing domain..."}]}}
{"type":"result","subtype":"success","result":"...","total_cost_usd":0.05,"duration_ms":12000}
```

### Model mapping

| Agent | Model | SDK model value |
| --- | --- | --- |
| Research (Steps 0, 2) | Sonnet | `"sonnet"` |
| Reasoner (Step 4) | Opus | `"opus"` |
| Builder/Validator/Tester (Steps 5-7) | Sonnet | `"sonnet"` |

## Node.js Dependency

The app requires **Node.js 18–24** for the agent sidecar (Node 25+ causes SDK crashes).

On startup, the Rust backend runs `node --version`:
- If found and in the 18–24 range: proceed normally
- If not found, too old, or 25+: show a dialog with install instructions + link to nodejs.org
- Settings page also shows Node.js status indicator

The sidecar JS file (`agent-runner.js`) is bundled with the app as a Tauri resource. It's a single esbuild-bundled file containing the SDK and all dependencies — no `npm install` needed at runtime.

## Workflow (9 steps)

The app replicates the plugin workflow. Each step is a state in the workflow state machine:

0. **Research Concepts** — research agent writes `clarifications-concepts.md`
1. **Concepts Review** — user answers questions via form UI
2. **Research Patterns + Data + Merge** — single orchestrator (spawns sub-agents internally)
3. **Human Review** — user answers merged questions via form UI
4. **Reasoning** — multi-turn conversation, produces `decisions.md`
5. **Build** — creates SKILL.md + reference files
6. **Validate** — checks against best practices
7. **Test** — generates and evaluates test prompts
8. **Refine Skill** — interactive chat to review, iterate, and polish the skill

## Data Model (repo structure)

```
<repo>/
  <skill-name>/
    SKILL.md                       # Main skill file
    references/                    # Deep-dive reference files
    <skill-name>.skill             # Packaged zip
    logs/                          # Agent output logs ({step_label}-{timestamp}.jsonl)
    context/                       # Intermediate working files
      clarifications-concepts.md
      clarifications-patterns.md
      clarifications-data.md
      clarifications.md
      decisions.md
      agent-validation-log.md
      test-skill.md
```

## Key Reference Files

- `references/shared-context.md` — markdown formats (used as-is by agents via SDK)
- `agents/{type}/reasoning.md` — most complex agent (multi-turn with follow-ups)
- `agents/{type}/build.md` — skill output structure (SKILL.md + references/)

## Development

```bash
cd app
npm install
cd sidecar && npm install && npm run build  # Bundle sidecar
cd .. && npm run tauri dev                   # Dev mode (hot reload)
npm run tauri build                          # Production build
```

## Distribution

- `npm run tauri build` produces platform-specific installers (~10MB + bundled sidecar)
- macOS: `.dmg` + `.app` (needs Apple Developer ID for code signing)
- Windows: `.msi` or `.exe` (needs code signing cert for SmartScreen)
- Linux: `.deb`, `.AppImage`, `.rpm`
- CI: `tauri-apps/tauri-action` GitHub Action builds all platforms
- Auto-update: `tauri-plugin-updater` checks GitHub Releases
- **Requires Node.js 18–24** on user's machine (checked at startup; Node 25+ causes SDK crashes)

## Parallel Development with Git Worktrees

The user runs **multiple Claude Code instances in parallel**, each in its own git worktree. This is the primary way work is parallelized — not agent teams within a single instance.

### Worktree workflow

When starting work on a task, **always create a new worktree** branching from `main`:

```bash
# Create worktree with a descriptive branch name
git worktree add ~/src/skill-builder-<task-name> -b <task-name> main

# Install dependencies in the new worktree
cd ~/src/skill-builder-<task-name>/app && npm install
cd sidecar && npm install && npm run build && cd ..
```

When done, the user will merge the branch back into `main` and clean up:

```bash
# From the main repo
git merge <task-name>
git worktree remove ~/src/skill-builder-<task-name>
git branch -d <task-name>
```

### Rules for worktree branches

- **Keep branches focused** — one feature, one fix, or one refactor per branch
- **Avoid overlapping file edits** across concurrent branches to minimize merge conflicts
- **Frontend, backend, and sidecar are independent** — safe to work on in parallel branches
- **Verify before committing**: `cd app && npx tsc --noEmit` (frontend) + `$HOME/.cargo/bin/cargo check --manifest-path app/src-tauri/Cargo.toml` (backend)

### When to also use agent teams within a single instance

Use Claude Code agent teams (`TeamCreate` + `Task` tool) **in addition to worktrees** when a single task itself has parallelizable sub-tasks (e.g., a feature that needs both new Rust commands and new React components simultaneously). See the Team workflow below.

#### Team workflow (within a single Claude Code instance)

1. **`TeamCreate`** with a descriptive name
2. **`TaskCreate`** for each independent work stream — include file paths, acceptance criteria, and what NOT to touch
3. **Spawn teammates** via `Task` tool:
   - `subagent_type: "general-purpose"` (needs file read/write/bash access)
   - `mode: "bypassPermissions"` (no interactive prompts)
   - `run_in_background: true` (parallel execution)
   - `model: "sonnet"` (fast, cost-effective for code generation)
   - `team_name: "<team-name>"` (joins the team)
4. **Wait for all teammates** to complete their tasks
5. **Integrate**: wire cross-cutting concerns (imports, registrations, type sharing)
6. **Verify**: `npx tsc --noEmit` + `cargo check`
7. **Shut down** teammates via `SendMessage` (`type: "shutdown_request"`) + `TeamDelete`

#### Splitting rules

- **Never split a single file** across agents — one agent owns each file
- **Shared types**: define in one agent's scope, other agents use placeholder types, integrator fixes imports after

## Commits

**Make granular commits.** Each commit should be a single logical change that compiles and passes tests independently.

### Guidelines

- **One concern per commit** — don't mix a bug fix with a refactor, or a new feature with a cleanup
- **Commit as you go** — don't accumulate a large diff and commit everything at the end
- **Commit messages** should be concise and describe the *what* and *why*, not the *how*
- **Run tests before each commit**: `cd app && npm test` (frontend) + `cd app/src-tauri && cargo test` (backend)
- **Stage specific files** — use `git add <file>` not `git add .` to avoid accidentally including unrelated changes

### Examples of good granular commits

```
Add refinement chat component with session persistence
Add workflow step 9 support to Rust backend
Wire refinement chat into workflow completion screen
Add refinement-chat unit tests
```

### Examples of bad commits

```
Add refinement chat feature         # Too broad — mixes backend + frontend + tests
Fix stuff                           # No context
Update files                        # Meaningless
Add chat and also fix sidebar bug   # Two unrelated changes
```

## Testing

Three tiers of automated tests. **Run all tests before committing.**

### Commands

```bash
cd app

# Tier 1: Frontend unit tests (Vitest + Testing Library)
npm test              # Single run
npm run test:watch    # Watch mode

# Tier 2: Rust unit + integration tests
cd src-tauri && cargo test    # (or use full path to cargo)

# Tier 3: E2E tests (Playwright against Vite dev server)
npm run test:e2e      # Starts Vite in E2E mode, runs Playwright

# All frontend tests at once
npm run test:all      # Vitest + Playwright
```

### Test structure

```
app/
├── src/__tests__/                # Frontend unit tests (Vitest)
│   ├── stores/                   # Zustand store logic (agent, settings, skill, workflow)
│   ├── lib/                      # Utility functions (reasoning-parser, utils)
│   ├── pages/                    # Page component tests (dashboard, prompts, settings, workflow)
│   ├── components/               # Component tests
│   │   ├── agent-output-panel.test.tsx
│   │   ├── close-guard.test.tsx
│   │   ├── delete-skill-dialog.test.tsx
│   │   ├── new-skill-dialog.test.tsx
│   │   ├── reasoning-chat.test.tsx
│   │   ├── refinement-chat.test.tsx
│   │   ├── skill-card.test.tsx
│   │   ├── tag-filter.test.tsx
│   │   └── tag-input.test.tsx
│   └── hooks/                    # Hook tests
│       └── use-agent-stream.test.ts
├── e2e/                          # E2E tests (Playwright)
│   ├── clarification.spec.ts
│   ├── close-guard.spec.ts
│   ├── dashboard.spec.ts
│   ├── dashboard-states.spec.ts
│   ├── navigation.spec.ts
│   ├── settings.spec.ts
│   └── skill-crud.spec.ts
├── src/test/                     # Test infrastructure
│   ├── setup.ts                  # Vitest setup (jest-dom + mocks)
│   └── mocks/                    # Tauri API mocks
│       ├── tauri.ts              # Unit test mocks (vi.fn stubs)
│       ├── tauri-e2e.ts          # E2E mocks (invoke replacement)
│       └── tauri-e2e-dialog.ts   # E2E dialog mock
├── vitest.config.ts
├── playwright.config.ts
└── src-tauri/src/                # Rust tests (inline #[cfg(test)] modules)
    ├── db.rs
    ├── types.rs
    ├── agents/sidecar.rs
    ├── commands/clarification.rs
    ├── commands/files.rs
    ├── commands/node.rs
    ├── commands/skill.rs
    ├── commands/workflow.rs
    └── commands/workspace.rs
```

### Mocking Tauri APIs

**Unit tests (Vitest):** `@tauri-apps/api/core` is globally mocked in `src/test/setup.ts`. Use `mockInvoke` from `src/test/mocks/tauri.ts` to configure return values per command.

**E2E tests (Playwright):** Vite aliases replace `@tauri-apps/api/core` with `src/test/mocks/tauri-e2e.ts` when `TAURI_E2E=true`. Override specific commands via `window.__TAURI_MOCK_OVERRIDES__` in tests.

### Testing rule

**When implementing a new feature or fixing a bug, evaluate whether tests should be added.** Follow this decision process:

1. **New state logic** (Zustand store actions, derived state) → write store unit tests
2. **New Rust command** with parseable/testable logic → add `#[cfg(test)]` tests
3. **New UI interaction pattern** (button states, form validation, conditional rendering) → write component test
4. **New page or major UI flow** → add E2E test covering the happy path
5. **Bug fix** → write a regression test that would have caught the bug

If the change is purely cosmetic (CSS tweaks, copy changes) or wiring-only (registering an existing command), tests are optional.

**If unclear whether tests are needed, ask the user.**

Always run existing tests (`npm test && cargo test`) before committing to catch regressions.

### Manual test checklist

Run all three test tiers before merging to catch regressions.
