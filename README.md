# Skill Builder

A multi-agent workflow for creating Anthropic Claude skills — domain knowledge packages that help data/analytics engineers build silver and gold layer models. Available as a **CLI workflow** (Claude Code / Claude Desktop) and a **desktop application** (Tauri).

## Platforms

| Platform | Status | How to Use |
| --- | --- | --- |
| **CLI** (Claude Code) | Production | Say "start" in a Claude Code session |
| **CLI** (Claude Desktop Cowork) | Production | Say "start" in a Cowork session — see `cowork/cowork.md` |
| **Desktop App** (Tauri) | In development (`feature/desktop-ui`) | See [Desktop App](#desktop-app) below |

Both CLI platforms run the same 10-step workflow orchestrated by the coordinator in `CLAUDE.md`. The desktop app replaces the CLI with a GUI — workflow dashboard, form-based Q&A, streaming agent output, a chat interface for post-build editing, and git-backed versioning.

## Workflow Overview

| Step | What Happens | Your Role |
| --- | --- | --- |
| **Initialization** | Choose a domain and skill name | Provide domain, confirm name |
| **Step 1** | Research agent identifies key entities, metrics, KPIs | Wait |
| **Step 2** | Review domain concept questions | Answer each question |
| **Step 3** | Two agents research business patterns + data modeling (parallel) | Wait |
| **Step 4** | Merge agent deduplicates questions | Wait |
| **Step 5** | Review merged clarification questions | Answer each question |
| **Step 6** | Reasoning agent analyzes answers, finds gaps/contradictions | Confirm reasoning, answer follow-ups |
| **Step 7** | Build agent creates the skill files | Review skill output |
| **Step 8** | Validator checks against best practices | Review validation log |
| **Step 9** | Tester generates and runs test prompts | Review test results |
| **Step 10** | Package into a `.skill` zip archive | Done |

## Directory Structure

```
skill-builder/
├── CLAUDE.md                  # Coordinator instructions (CLI workflow)
├── README.md
├── cowork/
│   └── cowork.md              # Cowork mode adaptation (Claude Desktop)
├── prompts/                   # Agent prompt files (shared by CLI and desktop app)
│   ├── shared-context.md
│   ├── 01-research-domain-concepts.md
│   ├── 03a-research-business-patterns.md
│   ├── 03b-research-data-modeling.md
│   ├── 04-merge-clarifications.md
│   ├── 06-reasoning-agent.md
│   ├── 07-build-agent.md
│   ├── 08-validate-agent.md
│   └── 09-test-agent.md
├── skills/                    # Built skills (CLI workflow output)
│   └── <skillname>/
│       ├── workflow-state.md
│       ├── context/
│       └── skill/
├── app/                       # Desktop application (Tauri + React)
│   ├── src/                   # React frontend
│   ├── src-tauri/             # Rust backend
│   ├── package.json
│   └── vite.config.ts
└── <skillname>.skill          # Final zip archive (CLI Step 10)
```

## CLI Workflow

### Agent Prompt Files

Each prompt file defines a single agent's behavior. The coordinator spawns them as teammates at the right step.

| File | Agent | Model Tier |
| --- | --- | --- |
| `01-research-domain-concepts.md` | Domain concepts researcher | sonnet |
| `03a-research-business-patterns.md` | Business patterns researcher | sonnet |
| `03b-research-data-modeling.md` | Data modeling researcher | sonnet |
| `04-merge-clarifications.md` | Question deduplicator/merger | haiku |
| `06-reasoning-agent.md` | Reasoning + decision engine | opus |
| `07-build-agent.md` | Skill file creator | sonnet |
| `08-validate-agent.md` | Best practices validator | sonnet |
| `09-test-agent.md` | Test prompt generator + evaluator | sonnet |

### Session Resume

The CLI workflow supports resuming from any step. State is tracked in `skills/<skillname>/workflow-state.md`. On restart, you'll be asked whether to continue or reset.

### Prerequisites

- **Claude Code** or **Claude Desktop** (Cowork mode) with access to sonnet, haiku, and opus models
- All files in this project folder

## Desktop App

The desktop app (`app/`) is a **Tauri v2** application that provides a GUI for the skill builder workflow. It's in active development on the `feature/desktop-ui` branch.

### Why Tauri

- ~10MB binary vs 150MB+ Electron
- Rust backend for fast file I/O, native git operations, secure API key storage
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
| Diff viewer | react-diff-viewer-continued |

**Backend** (Rust / Tauri):

| Module | Choice |
| --- | --- |
| HTTP | reqwest (streaming SSE for Claude API) |
| Git | git2 (libgit2 bindings) |
| File watching | notify |
| Markdown parsing | pulldown-cmark |
| Settings | tauri-plugin-store (encrypted) |
| Auth | GitHub Device Flow via tauri-plugin-shell |

### Key UI Views

1. **Dashboard** — Grid of skill cards with progress, actions (Continue/Reset/Delete), "+ New Skill"
2. **Workflow Wizard** — Step progression sidebar, streaming agent output, form-based Q&A for review steps
3. **Chat Interface** — Conversational editing and review+suggest modes for post-build refinement
4. **Skill Editor** — Three-pane layout: file tree, CodeMirror source editor, live markdown preview
5. **Settings** — Anthropic API key, GitHub repo picker, model overrides

### Authentication

GitHub OAuth Device Flow — no localhost redirect needed. The GitHub token handles both git operations (push/pull via HTTPS) and user identity. Stored encrypted via `tauri-plugin-store`.

### Development

```bash
cd app
npm install
npm run tauri dev
```

Prerequisites: Node.js, Rust toolchain, platform-specific Tauri dependencies (see [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)).

### Testing

```bash
cd app

# Frontend unit tests (Vitest + React Testing Library)
npm test

# Rust unit + integration tests
cd src-tauri && cargo test

# E2E tests (Playwright — launches Vite dev server automatically)
npm run test:e2e
```

See `CLAUDE.md` for full testing documentation including mock strategies and the testing rule for new features.

### Implementation Phases

| Phase | Scope | Status |
| --- | --- | --- |
| 1. Foundation | Tauri scaffold, OAuth login, settings, dashboard | Scaffolded |
| 2. Core Agent Loop | Agent runner with streaming, tool execution, Step 1 E2E | Not started |
| 3. Q&A Forms | Markdown parser, form components, Steps 2 and 5 | Not started |
| 4. Full Workflow | All 10 steps, parallel agents, reasoning loop, packaging | Not started |
| 5. Git | Auto-commit, push/pull, diff viewer, file history | Not started |
| 6. Editor | CodeMirror editor, split pane, file tree, auto-save | Not started |
| 7. Chat | Conversational edit + review/suggest modes | Not started |
| 8. Polish | Error states, retry UX, loading states, keyboard shortcuts | Not started |
