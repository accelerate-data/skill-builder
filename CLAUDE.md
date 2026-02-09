# Skill Builder — Desktop App

A Tauri v2 desktop application for building Claude skills. All code lives in `app/`.

## Architecture

```
┌──────────────────── Frontend (WebView) ──────────────────────┐
│  Dashboard │ Workflow Wizard │ Chat │ Editor │ Settings      │
│                        │                                     │
│              Zustand Store (skills, workflow, agents)         │
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

**Frontend:** React 19, TypeScript, Vite 7, Tailwind CSS 4, shadcn/ui, Zustand, TanStack Router + Query, React Hook Form + Zod, react-markdown

**Backend:** Tauri 2, rusqlite, notify, pulldown-cmark, tauri-plugin-shell, tokio

**Agent Runtime:** Node.js + `@anthropic-ai/claude-agent-sdk` (sidecar process)

**Runtime Dependency:** Node.js 18+ (checked on startup, user prompted to install if missing)

## Project Structure

```
app/
├── src/                              # React frontend
│   ├── main.tsx                      # Entry (providers + router)
│   ├── router.tsx                    # TanStack Router routes
│   ├── pages/                        # Page components
│   │   ├── dashboard.tsx             # Skill cards grid
│   │   ├── workflow.tsx              # Workflow wizard (9-step)
│   │   ├── editor.tsx                # Skill file editor
│   │   └── settings.tsx              # API key + workspace config
│   ├── components/
│   │   ├── ui/                       # shadcn/ui primitives (16 components)
│   │   ├── layout/                   # App shell (app-layout, sidebar, header)
│   │   ├── editor/                   # CodeMirror editor, file tree, preview
│   │   ├── theme-provider.tsx        # Dark mode (next-themes)
│   │   ├── skill-card.tsx            # Dashboard skill card
│   │   ├── new-skill-dialog.tsx      # Create skill dialog
│   │   ├── delete-skill-dialog.tsx   # Delete confirmation
│   │   ├── close-guard.tsx           # Block close while agents running
│   │   ├── clarification-form.tsx    # Q&A form (Steps 1, 3)
│   │   ├── clarification-raw.tsx     # Raw markdown fallback
│   │   ├── agent-output-panel.tsx    # Streaming agent output
│   │   ├── reasoning-chat.tsx        # Step 4 chat interface
│   │   └── workflow-sidebar.tsx      # Step progression sidebar
│   ├── stores/                       # Zustand state
│   │   ├── skill-store.ts
│   │   ├── settings-store.ts
│   │   ├── workflow-store.ts
│   │   └── agent-store.ts
│   ├── hooks/
│   │   ├── use-agent-stream.ts      # Subscribe to Tauri agent events
│   │   └── use-skill-files.ts       # Read skill files
│   ├── lib/
│   │   ├── utils.ts                 # cn() helper
│   │   ├── tauri.ts                 # Typed Tauri invoke wrappers
│   │   └── types.ts                 # Shared TypeScript interfaces
│   └── styles/globals.css           # Tailwind + dark mode tokens
├── sidecar/                          # Node.js agent runner
│   ├── package.json                  # @anthropic-ai/claude-agent-sdk dep
│   ├── agent-runner.ts               # Entry — reads config from stdin, streams JSON to stdout
│   ├── tsconfig.json
│   └── build.js                      # esbuild bundle → single agent-runner.js
├── src-tauri/                        # Rust backend
│   ├── src/
│   │   ├── lib.rs                   # Plugin + command registration
│   │   ├── main.rs                  # Entry point
│   │   ├── types.rs                 # Shared types (AppSettings, etc.)
│   │   ├── db.rs                    # SQLite init, migrations, settings read/write
│   │   ├── commands/                # Tauri IPC handlers
│   │   │   ├── settings.rs          # get_settings, save_settings, test_api_key
│   │   │   ├── skill.rs             # list_skills, create_skill, delete_skill
│   │   │   ├── workflow.rs          # run_workflow_step, package_skill
│   │   │   ├── agent.rs             # start_agent, cancel_agent (spawns sidecar)
│   │   │   ├── node.rs              # check_node (Node.js version check)
│   │   │   └── lifecycle.rs         # check_workspace_path, has_running_agents
│   │   ├── agents/                  # Sidecar management
│   │   │   ├── mod.rs
│   │   │   ├── sidecar.rs           # Spawn Node.js process, pipe stdin/stdout
│   │   │   └── events.rs            # Parse JSON lines → Tauri events
│   │   └── markdown/                # Markdown parsing
│   │       ├── clarifications.rs    # Q&A format parser/serializer
│   │       └── workflow_state.rs    # Parse workflow state files
│   ├── Cargo.toml
│   └── tauri.conf.json              # bundles sidecar/dist/agent-runner.js
├── package.json
└── vite.config.ts
```

## Agent Orchestration (Claude Agent SDK)

Agents run via the **Claude Agent SDK** in a Node.js sidecar process. This gives us all Claude Code tools for free.

### How it works

1. **Rust backend** spawns `node agent-runner.js` as a child process
2. Writes agent config to stdin (JSON): prompt, model, API key, cwd, allowed tools
3. **Sidecar** uses SDK's `query()` function with the config
4. SDK handles the full tool execution loop (Read, Write, Glob, Grep, Bash, Task)
5. Sidecar streams `SDKMessage` objects as JSON lines to stdout
6. **Rust backend** reads stdout line by line, parses JSON, emits Tauri events
7. **Frontend** subscribes to Tauri events for real-time display
8. To cancel: Rust kills the child process (or sends abort signal via stdin)

### Key benefits

- **No prompt modifications needed** — existing `prompts/*.md` work as-is since the SDK provides the same tools as Claude Code
- **Sub-agents work** — SDK supports the Task tool for spawning sub-agents (Step 2 orchestrator)
- **No tool execution loop to build** — SDK handles Claude → tool call → result → Claude internally
- **Session resume** — SDK supports `resume: sessionId` for continuing conversations (Step 4 reasoning)

### Sidecar config (sent via stdin)

```json
{
  "prompt": "Read prompts/shared-context.md and prompts/01-research-domain-concepts.md...",
  "model": "sonnet",
  "apiKey": "sk-ant-...",
  "cwd": "/path/to/workspace",
  "allowedTools": ["Read", "Write", "Glob", "Grep"],
  "maxTurns": 50,
  "permissionMode": "bypassPermissions"
}
```

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
| Merger (Step 2 sub-agent) | Haiku | `"haiku"` |
| Reasoner (Step 4) | Opus | `"opus"` |
| Builder/Validator/Tester (Steps 5-7) | Sonnet | `"sonnet"` |

## Node.js Dependency

The app requires **Node.js 18+** for the agent sidecar.

On startup, the Rust backend runs `node --version`:
- If found and >= 18: proceed normally
- If not found or too old: show a dialog with install instructions + link to nodejs.org
- Settings page also shows Node.js status indicator

The sidecar JS file (`agent-runner.js`) is bundled with the app as a Tauri resource. It's a single esbuild-bundled file containing the SDK and all dependencies — no `npm install` needed at runtime.

## Workflow (9 steps)

The app replicates the CLI workflow. Each step is a state in the workflow state machine:

1. **Research Domain Concepts** — research agent writes `clarifications-concepts.md`
2. **Domain Concepts Review** — user answers questions via form UI
3. **Research Domain** — orchestrator spawns parallel research sub-agents + merger, writes `clarifications.md`
4. **Human Review** — user answers merged questions via form UI
5. **Reasoning** — multi-turn conversation, produces `decisions.md`
6. **Build Skill** — creates SKILL.md + reference files
7. **Validate** — checks against best practices
8. **Test** — generates and evaluates test prompts
9. **Package** — creates `.skill` zip archive

## Data Model (repo structure)

```
<repo>/
  <skill-name>/
    workflow.md                    # Session state
    SKILL.md                       # Main skill file
    references/                    # Deep-dive reference files
    <skill-name>.skill             # Packaged zip
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

- `prompts/shared-context.md` — markdown formats (used as-is by agents via SDK)
- `prompts/02-research-patterns-and-merge.md` — orchestrator (spawns parallel sub-agents + merger)
- `prompts/06-reasoning-agent.md` — most complex agent (multi-turn with follow-ups)
- `prompts/07-build-agent.md` — skill output structure (SKILL.md + references/)

## Development

```bash
cd app
npm install
cd sidecar && npm install && npm run build  # Bundle sidecar
cd .. && npm run tauri dev                   # Dev mode (hot reload)
```

## Building for Distribution

Build the app for your platform:

```bash
cd app
npm run sidecar:build  # Bundle sidecar + copy SDK runtime files to sidecar/dist/sdk/
npx tauri build        # Creates platform-specific installers
```

### Output locations

- **macOS**: `app/src-tauri/target/release/bundle/macos/`
  - `Skill Builder.app` (85MB) — app bundle
  - `Skill Builder_0.1.0_aarch64.dmg` (31MB) — compressed installer
- **Windows**: `app/src-tauri/target/release/bundle/msi/` or `.../nsis/`
- **Linux**: `app/src-tauri/target/release/bundle/deb/`, `.../appimage/`, or `.../rpm/`

### What gets bundled

- The sidecar build step (`npm run sidecar:build`) copies the SDK runtime files (`cli.js`, `wasm`, `vendor/`) from `node_modules/@anthropic-ai/claude-agent-sdk/dist/` to `sidecar/dist/sdk/`. These files are included in the Tauri bundle and are required for the sidecar to run.
- Recipients need **Node.js 18+** installed on their machine (the app checks at startup).

### Code signing status

The app is currently **unsigned**:
- **macOS**: users must right-click → Open to bypass Gatekeeper on first launch
- **Windows**: users will see a SmartScreen warning — click "More info" → "Run anyway"
- To eliminate warnings, obtain an Apple Developer ID (macOS) or code signing certificate (Windows)

### CI/CD

- Use `tauri-apps/tauri-action` GitHub Action to build for all platforms
- Auto-update support via `tauri-plugin-updater` (checks GitHub Releases)

## Parallel Development with Git Worktrees

The user runs **multiple Claude Code instances in parallel**, each in its own git worktree. This is the primary way work is parallelized — not agent teams within a single instance.

### Worktree workflow

When starting work on a task, **always create a new worktree** branching from `feature/desktop-ui`:

```bash
# Create worktree with a descriptive branch name
git worktree add ~/src/skill-builder-<task-name> -b <task-name> feature/desktop-ui

# Install dependencies in the new worktree
cd ~/src/skill-builder-<task-name>/app && npm install
cd sidecar && npm install && npm run build && cd ..
```

When done, the user will merge the branch back into `feature/desktop-ui` and clean up:

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
Add chat session SQLite schema and CRUD functions
Add chat store with session and message state
Add chat page with message bubbles and input
Wire chat route into TanStack Router
Add chat-store unit tests
```

### Examples of bad commits

```
Add chat feature                    # Too broad — mixes backend + frontend + tests
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
│   ├── stores/                   # Zustand store logic
│   ├── lib/                      # Utility functions
│   └── pages/                    # Page component tests
├── e2e/                          # E2E tests (Playwright)
│   ├── navigation.spec.ts
│   ├── settings.spec.ts
│   └── dashboard.spec.ts
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
    ├── markdown/workflow_state.rs
    ├── markdown/clarifications.rs
    ├── commands/node.rs
    └── commands/skill.rs
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

