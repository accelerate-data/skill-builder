# Skill Builder — Desktop App

A Tauri v2 desktop application for building Claude skills. All code lives in `app/`.

## Design Plan

Full architecture, data model, and UI specs: `app/PLAN.md`

## Architecture

```
┌──────────────────── Frontend (WebView) ──────────────────────┐
│  Login │ Dashboard │ Workflow Wizard │ Chat │ Editor         │
│                        │                                     │
│              Zustand Store (auth, skills, workflow, agents)  │
│                        │ Tauri IPC (invoke / events)         │
└────────────────────────┼─────────────────────────────────────┘
                         │
┌────────────────────────┼──── Backend (Rust) ─────────────────┐
│  ┌─────────────┐ ┌─────────────┐ ┌───────────┐               │
│  │ Agent       │ │ File System │ │ Git       │               │
│  │ Orchestrator│ │ Manager     │ │ Manager   │               │
│  │ (spawns     │ │ (CRUD, MD   │ │ (commit,  │               │
│  │  Node.js    │ │  parsing,   │ │  diff,    │               │
│  │  sidecar)   │ │  watching)  │ │  push/pull│               │
│  └──────┬──────┘ └─────────────┘ └───────────┘               │
│         │                                                    │
│  GitHub Auth │ Workflow State Machine │ Settings             │
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

**Frontend:** React 19, TypeScript, Vite 7, Tailwind CSS 4, shadcn/ui, Zustand, TanStack Router + Query, React Hook Form + Zod, react-markdown, react-diff-viewer-continued

**Backend:** Tauri 2, git2, notify, pulldown-cmark, tauri-plugin-store/shell, tokio

**Agent Runtime:** Node.js + `@anthropic-ai/claude-agent-sdk` (sidecar process)

**Runtime Dependency:** Node.js 18+ (checked on startup, user prompted to install if missing)

## Project Structure

```
app/
├── src/                              # React frontend
│   ├── main.tsx                      # Entry (providers + router)
│   ├── router.tsx                    # TanStack Router routes
│   ├── pages/                        # Page components
│   │   ├── login.tsx                 # GitHub Device Flow login
│   │   ├── dashboard.tsx             # Skill cards grid
│   │   └── settings.tsx              # API key + repo config
│   ├── components/
│   │   ├── ui/                       # shadcn/ui primitives (16 components)
│   │   ├── layout/                   # App shell (app-layout, sidebar, header)
│   │   ├── theme-provider.tsx        # Dark mode (next-themes)
│   │   ├── skill-card.tsx            # Dashboard skill card
│   │   ├── new-skill-dialog.tsx      # Create skill dialog
│   │   └── delete-skill-dialog.tsx   # Delete confirmation
│   ├── stores/                       # Zustand state
│   │   ├── auth-store.ts
│   │   ├── skill-store.ts
│   │   └── settings-store.ts
│   ├── hooks/
│   │   └── use-auth.ts              # Auth convenience hook
│   ├── lib/
│   │   ├── utils.ts                 # cn() helper
│   │   ├── tauri.ts                 # Typed Tauri invoke wrappers
│   │   └── types.ts                 # Shared TypeScript interfaces
│   └── styles/globals.css           # Tailwind + dark mode tokens
├── sidecar/                          # Node.js agent runner
│   ├── package.json                  # @anthropic-ai/claude-agent-sdk dep
│   ├── agent-runner.ts               # Entry — reads config from stdin, streams JSON to stdout
│   ├── tsconfig.json
│   └── build.ts                      # esbuild bundle → single agent-runner.js
├── src-tauri/                        # Rust backend
│   ├── src/
│   │   ├── lib.rs                   # Plugin + command registration
│   │   ├── main.rs                  # Entry point
│   │   ├── types.rs                 # Shared types
│   │   ├── commands/                # Tauri IPC handlers
│   │   │   ├── auth.rs              # start_login, poll_login, get_current_user, logout
│   │   │   ├── settings.rs          # get_settings, save_settings, test_api_key
│   │   │   ├── skill.rs             # list_skills, create_skill, delete_skill
│   │   │   └── agent.rs             # start_agent, cancel_agent (spawns sidecar)
│   │   ├── agents/                  # Sidecar management
│   │   │   ├── mod.rs
│   │   │   ├── sidecar.rs           # Spawn Node.js process, pipe stdin/stdout
│   │   │   └── events.rs            # Parse JSON lines → Tauri events
│   │   ├── auth/                    # GitHub authentication
│   │   │   ├── device_flow.rs       # Device Flow implementation
│   │   │   └── token.rs             # Token storage (tauri-plugin-store)
│   │   └── markdown/                # Markdown parsing
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
- **Sub-agents work** — SDK supports the Task tool for spawning sub-agents (Step 3 parallel agents)
- **No tool execution loop to build** — SDK handles Claude → tool call → result → Claude internally
- **Session resume** — SDK supports `resume: sessionId` for continuing conversations (Step 6 reasoning)

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
| Research (Steps 1, 3) | Sonnet | `"sonnet"` |
| Merger (Step 4) | Haiku | `"haiku"` |
| Reasoner (Step 6) | Opus | `"opus"` |
| Builder/Validator/Tester (Steps 7-9) | Sonnet | `"sonnet"` |

## Node.js Dependency

The app requires **Node.js 18+** for the agent sidecar.

On startup, the Rust backend runs `node --version`:
- If found and >= 18: proceed normally
- If not found or too old: show a dialog with install instructions + link to nodejs.org
- Settings page also shows Node.js status indicator

The sidecar JS file (`agent-runner.js`) is bundled with the app as a Tauri resource. It's a single esbuild-bundled file containing the SDK and all dependencies — no `npm install` needed at runtime.

## Workflow (10 steps)

The app replicates the CLI workflow. Each step is a state in the workflow state machine:

1. **Research Domain Concepts** — research agent writes `clarifications-concepts.md`
2. **Domain Concepts Review** — user answers questions via form UI
3. **Research Patterns + Data Modeling** — two agents run in parallel (two sidecar processes)
4. **Merge** — deduplicate questions into `clarifications.md`
5. **Human Review** — user answers merged questions via form UI
6. **Reasoning** — multi-turn conversation, produces `decisions.md`
7. **Build** — creates SKILL.md + reference files
8. **Validate** — checks against best practices
9. **Test** — generates and evaluates test prompts
10. **Package** — creates `.skill` zip archive

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

## Authentication

GitHub OAuth Device Flow. Token stored encrypted via `tauri-plugin-store`. Used for both git operations (HTTPS credentials) and user identity. Requires a GitHub OAuth App registration — `client_id` is bundled (public), no secret needed.

## Git Integration

- User selects a GitHub repo in Settings → app clones locally to `~/skill-builder-workspace/<repo-name>/`
- Auto-commit after each workflow step (configurable)
- Auto-push (optional, off by default)
- Manual push/pull toolbar buttons
- Diff viewer for file history

## Key Reference Files

- `prompts/shared-context.md` — markdown formats (used as-is by agents via SDK)
- `prompts/06-reasoning-agent.md` — most complex agent (multi-turn with follow-ups)
- `prompts/07-build-agent.md` — skill output structure (SKILL.md + references/)
- `app/PLAN.md` — full architecture, data model, UI specs, implementation phases
- `app/FEATURES.md` — feature checklist with status per phase
- `app/TESTS.md` — test plan per phase

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
- **Requires Node.js 18+** on user's machine (checked at startup)

## Implementation Phases

| Phase | Scope | Status |
| --- | --- | --- |
| 1. Foundation | Login, settings, dashboard, skill CRUD | Done |
| 2. Core Agent Loop | Sidecar + SDK, agent commands, streaming UI, Step 1 E2E | Next |
| 3. Q&A Forms | Markdown parser, form components, Steps 2 + 5 | Pending |
| 4. Full Workflow | All 10 steps, parallel agents, reasoning loop, packaging | Pending |
| 5. Git | Auto-commit, push/pull, diff viewer, file history | Pending |
| 6. Editor | CodeMirror, split pane, file tree, auto-save | Pending |
| 7. Chat | Conversational edit + review/suggest modes | Pending |
| 8. Polish | Error states, retry UX, loading states, keyboard shortcuts | Pending |

## Build Approach

Use **Claude Code agent teams** to parallelize development across frontend, backend, and sidecar work streams. Every phase should use teams unless the work is trivially small.

### Team workflow

1. **`TeamCreate`** with a descriptive name (e.g., `desktop-ui-phase2`)
2. **`TaskCreate`** for each independent work stream — include file paths, acceptance criteria, and what NOT to touch
3. **Spawn teammates** via `Task` tool:
   - `subagent_type: "general-purpose"` (needs file read/write/bash access)
   - `mode: "bypassPermissions"` (no interactive prompts)
   - `run_in_background: true` (parallel execution)
   - `model: "sonnet"` (fast, cost-effective for code generation)
   - `team_name: "<team-name>"` (joins the team)
4. **Wait for all teammates** to complete their tasks
5. **Integrate**: wire cross-cutting concerns (imports, registrations, type sharing)
6. **Verify**: `cd app && npx tsc --noEmit` (frontend) + `$HOME/.cargo/bin/cargo check --manifest-path app/src-tauri/Cargo.toml` (backend)
7. **Shut down** teammates via `SendMessage` (`type: "shutdown_request"`) + `TeamDelete`

### Agent splitting guidelines

- **Frontend vs Backend vs Sidecar** — these are always independent and can run in parallel
- **Within frontend**: split by feature area (pages, stores/hooks, components) when there are 6+ files to create
- **Within backend**: split by module (commands, agents, markdown) when there are 6+ files to create
- **Shared types**: define types in one agent's scope, other agents use placeholder types and the integrator fixes imports after
- **Never split a single file** across agents — one agent owns each file

### Phase-specific team plans

**Phase 2 — Core Agent Loop (3 agents)**
| Agent | Scope | Files |
|-------|-------|-------|
| `sidecar` | Node.js agent runner + build | `sidecar/package.json`, `agent-runner.ts`, `tsconfig.json`, `build.ts` |
| `rust-agents` | Rust sidecar management | `commands/agent.rs`, `agents/mod.rs`, `agents/sidecar.rs`, `agents/events.rs`, `commands/node.rs` |
| `frontend-streaming` | Streaming UI + workflow | `stores/workflow-store.ts`, `stores/agent-store.ts`, `hooks/use-agent-stream.ts`, `pages/workflow.tsx`, `components/agent-output-panel.tsx`, `components/workflow-sidebar.tsx` |

Integration: register new commands in `lib.rs`, add workflow route to `router.tsx`, wire Tauri event types between backend and frontend.

**Phase 3 — Q&A Forms (2 agents)**
| Agent | Scope | Files |
|-------|-------|-------|
| `rust-clarifications` | Markdown parser + serializer | `markdown/clarifications.rs`, `commands/clarifications.rs` |
| `frontend-forms` | Q&A form components | `components/clarification-form.tsx`, `components/question-card.tsx`, workflow step 2/5 UI |

**Phase 4 — Full Workflow (2-3 agents)**
| Agent | Scope | Files |
|-------|-------|-------|
| `rust-workflow` | State machine, all step handlers | `workflow/mod.rs`, `workflow/steps.rs`, `commands/workflow.rs` |
| `frontend-workflow` | Step UI components, chat view | Step 3 dual panel, Step 6 chat view, Step 10 packaging UI |
| `frontend-reasoning` (optional) | Step 6 reasoning UI if complex | Multi-turn chat component, follow-up detection |

**Phase 5 — Git (2 agents)**
| Agent | Scope | Files |
|-------|-------|-------|
| `rust-git` | git2 operations | `git/mod.rs`, `git/operations.rs`, `commands/git.rs` |
| `frontend-git` | Push/pull UI, diff viewer, status | `components/diff-viewer.tsx`, `hooks/use-git-status.ts`, toolbar buttons |

**Phase 6 — Editor (2 agents)**
| Agent | Scope | Files |
|-------|-------|-------|
| `frontend-editor` | CodeMirror + file tree | `components/editor/code-editor.tsx`, `components/editor/file-tree.tsx`, `components/editor/preview-pane.tsx` |
| `frontend-layout` | Three-pane layout + auto-save | `pages/editor.tsx`, `hooks/use-skill-files.ts`, `hooks/use-auto-save.ts` |

**Phase 7 — Chat (2 agents)**
| Agent | Scope | Files |
|-------|-------|-------|
| `rust-chat` | Chat session management, diff gen | `chat/mod.rs`, `commands/chat.rs` |
| `frontend-chat` | Chat UI, suggestions, accept/reject | `components/chat/chat-panel.tsx`, `components/chat/suggestion-card.tsx`, `stores/chat-store.ts` |

**Phase 8 — Polish (1-2 agents)**
Single pass or split into `frontend-polish` (error boundaries, loading states, empty states) and `ux-polish` (keyboard shortcuts, toasts, responsive layout).

### Proven patterns from Phase 1

- 3 parallel agents completed all of Phase 1 (Rust backend, frontend core, frontend pages) with zero merge conflicts
- Each agent was given explicit file paths and told what NOT to modify
- Types were defined by the backend agent; frontend agents used compatible interfaces
- Integration step took ~5 minutes (wiring imports in router.tsx, lib.rs)
- Verification caught 0 TypeScript errors and 0 Rust compilation errors

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
    ├── markdown/workflow_state.rs
    ├── commands/node.rs
    ├── commands/skill.rs
    └── commands/git.rs
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

See `app/TESTS.md` for a comprehensive manual test plan organized by phase. Use it for QA before releases.
