# Plan: Skill Builder Desktop UI Application

## Context

The skill-builder is currently a CLI-only multi-agent workflow (orchestrated by Claude Code) that builds structured knowledge packages ("skills") for data engineers. Users interact by chatting in a terminal and manually editing markdown files. The goal is to create a **desktop UI application** that replaces the CLI workflow with a proper GUI — featuring a workflow dashboard, form-based Q&A, streaming agent output, a chat interface for post-build editing, and git-backed versioning.

**Pain points this solves:**
- No visual progress tracking across the 10-step workflow
- Editing raw markdown files for Q&A is clunky
- No way to manage multiple skills at a glance
- No chat-based fine-tuning of completed skills
- No version history for decisions and skill content

---

## Framework: Tauri v2

**Why Tauri over Electron:**
- ~10MB binary vs 150MB+ (resource-light, runs alongside dev tools)
- Rust backend provides fast file I/O, native git operations, secure API key storage
- Tauri events are purpose-built for streaming (perfect for Claude API SSE responses)
- API keys stay in the Rust backend process, never in the webview
- WebKit on macOS = native rendering, lower memory

---

## Technology Stack

### Frontend (React + TypeScript in Tauri webview)
| Layer | Choice |
|-------|--------|
| Framework | React 19 + TypeScript |
| Build | Vite (Tauri default) |
| UI Components | shadcn/ui (Radix + Tailwind CSS) |
| State | Zustand |
| Markdown rendering | react-markdown + remark-gfm + rehype-highlight |
| Markdown editor | CodeMirror 6 (@codemirror/lang-markdown) |
| Forms | React Hook Form + Zod |
| Routing | TanStack Router |
| Data fetching | TanStack Query |
| Diff viewer | react-diff-viewer-continued |

### Backend (Rust / Tauri)
| Module | Choice |
|--------|--------|
| HTTP client | reqwest (streaming SSE for Claude API + GitHub API) |
| Git | git2 crate (libgit2 bindings), authenticated via GitHub token |
| File watching | notify crate |
| Markdown parsing | pulldown-cmark + regex for Q&A format |
| Settings | tauri-plugin-store (encrypted) |
| OAuth | tauri-plugin-shell (open browser) + local HTTP listener for callback |
| Async | tokio (bundled with Tauri) |
| Serialization | serde + serde_json |
| Zip | zip crate |

### Storage
- **No database** — the file system IS the database (same `skills/<name>/` structure as CLI)
- **In-memory state** via Zustand, persisted to tauri-plugin-store for session resume
- **Git** is the history/versioning layer, authenticated via GitHub

---

## Authentication: GitHub Login

The app uses **GitHub OAuth** as the single login mechanism. The GitHub token serves double duty: identity + git credentials.

### OAuth Flow (GitHub Device Flow)

The **Device Flow** is ideal for desktop apps — no localhost redirect server needed:

1. App calls `POST https://github.com/login/device/code` with a registered OAuth App client ID
2. GitHub returns a `user_code` and `verification_uri`
3. App displays: "Go to **github.com/login/device** and enter code **ABCD-1234**"
4. App opens the URL in the default browser automatically
5. App polls `POST https://github.com/login/oauth/access_token` until the user authorizes
6. On success, receives an `access_token` — stored encrypted via `tauri-plugin-store`

### What the token enables

| Use | How |
|-----|-----|
| **Git push/pull** | git2 crate uses the token as HTTPS credentials: `https://x-access-token:{token}@github.com/{owner}/{repo}.git` |
| **User identity** | `GET https://api.github.com/user` → display username + avatar in the app header |
| **Repo access** | `GET https://api.github.com/user/repos` → list user's repos in the settings picker |

### OAuth App Registration

Requires a **GitHub OAuth App** (not a GitHub App). Created at `github.com/settings/developers`. The `client_id` is bundled with the app (public). No `client_secret` needed for Device Flow.

**Required scopes**: `repo` (read/write access to repositories)

---

## Architecture

```
┌──────────────────── Frontend (WebView) ────────────────────┐
│  Login │ Dashboard │ Workflow Wizard │ Chat │ Editor        │
│                        │                                    │
│              Zustand Store (auth, skills, workflow, agents)  │
│                        │ Tauri IPC (invoke / events)        │
└────────────────────────┼────────────────────────────────────┘
                         │
┌────────────────────────┼──── Backend (Rust) ────────────────┐
│  ┌─────────────┐ ┌─────────────┐ ┌───────────┐             │
│  │ Agent       │ │ File System │ │ Git       │             │
│  │ Orchestrator│ │ Manager     │ │ Manager   │             │
│  │ (API calls, │ │ (CRUD, MD   │ │ (commit,  │             │
│  │  streaming, │ │  parsing,   │ │  diff,    │             │
│  │  tool exec) │ │  watching)  │ │  push/pull│             │
│  └─────────────┘ └─────────────┘ └───────────┘             │
│                                                             │
│  GitHub Auth │ Workflow State Machine │ Settings             │
└─────────────────────────────────────────────────────────────┘
```

### Agent Orchestration (replacing Claude Code multi-agent system)

Each "agent" becomes a **Claude Messages API call with tools**:

1. Backend loads prompt template from bundled `prompts/*.md` files
2. Constructs API payload: `system` = shared-context + agent prompt, `user` = domain + file paths
3. Provides `read_file` and `write_file` tools so Claude can read inputs and write outputs
4. Runs a **tool execution loop**: Claude requests tool calls → backend executes → sends results back → repeat until final text response
5. Streams text deltas to frontend via Tauri events for real-time display

**Model mapping** (same as CLI):
- Research agents (Steps 1, 3): `claude-sonnet-4-20250514`
- Merger (Step 4): `claude-haiku-4-20250514`
- Reasoner (Step 6): `claude-opus-4-20250514`
- Builder/Validator/Tester (Steps 7-9): `claude-sonnet-4-20250514`

**Parallel agents** (Step 3): `tokio::join!` runs both researchers concurrently, each streaming to a separate panel in the UI.

---

## Key UI Views

### 1. Dashboard
- Grid of skill cards showing name, domain, progress bar (step X/10), last activity
- Actions per card: Continue, Reset, Delete
- "+ New Skill" button

### 2. Workflow Wizard
- Left sidebar: step progression with checkmarks and current step highlight
- Main area: content for current step
  - **Agent steps**: streaming output panel with real-time text + file-write indicators
  - **Review steps (2, 5)**: Q&A rendered as radio-button forms (parsed from markdown)
  - **Reasoning step (6)**: chat-like view for multi-turn interaction with reasoner
- Agent status panel showing model, elapsed time, token usage

### 3. Chat Interface (two modes)
- **Conversational editing**: free-form chat where Claude modifies skill files directly; shows inline diffs of changes made
- **Review + suggest**: Claude reviews the skill and returns numbered suggestions; each shows a diff preview with Accept/Reject/Discuss buttons
- Toggle between modes via switch

### 4. Skill Editor
- Three-pane layout: file tree | CodeMirror source editor | live markdown preview
- File tree shows skill files (editable) + context files (read-only)
- Git status indicators per file (modified, untracked)
- Auto-save with debounce

### 5. Login Screen
- Shown on first launch or when not authenticated
- "Sign in with GitHub" button triggers Device Flow
- Displays user code + link to github.com/login/device
- Polls until authorized, then transitions to Dashboard
- App header shows GitHub avatar + username after login, with logout option

### 6. Settings
Two required fields + optional overrides:
- **Anthropic API Key** — stored encrypted, with "Test Connection" button
- **GitHub Repository** — dropdown populated from user's GitHub repos (via API), or manual `owner/repo` input. This is the repo where skills are versioned.
- Model overrides per agent type (optional, sensible defaults)
- Auto-commit toggle + commit message prefix
- Auto-push toggle (push to GitHub after each commit, default off)

---

## Data Model

### Repo Structure (different from CLI — flatter layout)

```
<repo>/
  README.md                        # Created on repo init
  <skill-name>/                    # Each skill is a top-level folder (no skills/ parent)
    workflow.md                    # Session state (renamed from workflow-state.md)
    SKILL.md                       # Main skill file (in skill root, not nested)
    references/                    # Deep-dive reference files
      topic-a.md
      topic-b.md
    <skill-name>.skill             # Packaged zip (tracked in git)
    context/                       # Intermediate working files
      clarifications-concepts.md   # Step 1 output
      clarifications-patterns.md   # Step 3a output
      clarifications-data.md       # Step 3b output
      clarifications.md            # Step 4 merged output
      decisions.md                 # Step 6 decisions
      agent-validation-log.md      # Step 8 validation
      test-skill.md                # Step 9 test results
```

**Key differences from CLI layout:**
- No `skills/` parent directory — each skill is a top-level folder in the repo
- `workflow.md` (not `workflow-state.md`) in skill root
- SKILL.md and references/ in skill root (not in a `skill/` subfolder)
- `.skill` zip file lives in the skill folder (not project root), tracked in git
- README.md at repo root, auto-generated on init
- ALL files are git tracked (including `.skill` archives)

**Markdown parsing contract**: The Rust backend parses clarification files into structured `ClarificationQuestion` objects (id, title, question text, choices with rationale, recommendation, answer) using the format defined in `prompts/shared-context.md`. Frontend renders these as form fields. On submission, serializes back to the exact markdown format. Includes "raw markdown" fallback for questions that fail to parse.

---

## Git Integration

- **GitHub-backed**: the user selects a GitHub repo in Settings. The app clones it locally (or initializes if empty) and uses it as the workspace.
- **Authentication**: all git operations use the GitHub OAuth token via HTTPS credentials — no SSH keys needed
- **Single repo, folder-based**: all skills tracked in one repo under `skills/`
- **Auto-commit after each step** (configurable): commit message format `skill-builder: [<name>] <step description>`
- **Auto-push** (optional, off by default): pushes to GitHub after each commit
- **Manual push/pull**: toolbar buttons to sync with GitHub at any time
- **Diff viewer**: shows history for any file, especially `decisions.md` evolution over time
- **No branches**: all work on current branch (users can branch manually if desired)

### Local workspace

On first setup after selecting a repo:
1. If the repo is empty → clone to `~/skill-builder-workspace/<repo-name>/`, initialize with the prompt files and `.gitignore`
2. If the repo has existing content → clone as-is, scan for `skills/` folders to populate the dashboard
3. The local workspace path is displayed in Settings but managed automatically

---

## Migration & Compatibility

- **Prompt files**: bundled with the app as Tauri resources, loaded at runtime, used almost verbatim as system prompts
- **Existing skills**: any `skills/<name>/` folder from the CLI can be opened in the UI (reads `workflow-state.md` for resume)
- **Bidirectional**: skills built in the UI can be continued in the CLI and vice versa

---

## Project Structure

```
skill-builder-app/
├── src-tauri/                    # Rust backend
│   ├── src/
│   │   ├── commands/             # Tauri IPC handlers
│   │   │   ├── auth.rs           # GitHub OAuth (device flow, token, user info)
│   │   │   ├── skill.rs          # Skill CRUD
│   │   │   ├── workflow.rs       # Step transitions
│   │   │   ├── agent.rs          # Run/cancel agents
│   │   │   ├── chat.rs           # Chat sessions
│   │   │   ├── files.rs          # File operations
│   │   │   ├── git.rs            # Git operations (clone, commit, push, pull, diff)
│   │   │   └── settings.rs       # API key, repo selection
│   │   ├── auth/                 # GitHub authentication
│   │   │   ├── device_flow.rs    # Device Flow implementation (poll loop)
│   │   │   ├── github_api.rs     # User info, list repos
│   │   │   └── token.rs          # Token storage/refresh
│   │   ├── agents/               # Agent orchestration
│   │   │   ├── runner.rs         # API call + tool exec loop
│   │   │   ├── tools.rs          # read_file/write_file definitions
│   │   │   ├── prompts.rs        # Template loading + interpolation
│   │   │   └── streaming.rs      # SSE parsing, Tauri event emission
│   │   ├── markdown/             # Markdown ↔ structured data
│   │   │   ├── clarifications.rs # Q&A format parser/serializer
│   │   │   ├── decisions.rs      # Decisions parser
│   │   │   └── workflow_state.rs # State file parser
│   │   └── git/                  # Git operations (git2 crate + GitHub token auth)
│   │       ├── repo.rs           # Clone, init, open
│   │       ├── operations.rs     # Commit, push, pull
│   │       └── history.rs        # Diff, log
│   └── prompts/                  # Bundled prompt files
├── src/                          # React frontend
│   ├── routes/
│   │   ├── login.tsx             # GitHub login screen
│   │   ├── dashboard.tsx         # Skill list / home
│   │   ├── workflow.tsx          # Workflow wizard
│   │   ├── editor.tsx            # Skill file editor
│   │   ├── chat.tsx              # Chat interface
│   │   └── settings.tsx          # API key + GitHub repo config
│   ├── components/               # UI components
│   ├── stores/
│   │   ├── auth-store.ts         # GitHub user, token state, login status
│   │   ├── skill-store.ts        # Skills list + active skill
│   │   ├── workflow-store.ts     # Current workflow state
│   │   ├── agent-store.ts        # Agent run states + streaming
│   │   ├── chat-store.ts         # Chat sessions
│   │   └── settings-store.ts     # API key, repo config
│   ├── hooks/
│   │   ├── use-auth.ts           # Login state, logout, user info
│   │   ├── use-agent-stream.ts   # Subscribe to Tauri agent events
│   │   ├── use-skill-files.ts    # Read skill files
│   │   └── use-git-status.ts     # Git status for current skill
│   └── lib/
├── vite.config.ts
├── tailwind.config.ts
└── package.json
```

---

## Implementation Phases

| Phase | Scope | Key Deliverable |
|-------|-------|-----------------|
| **1. Foundation** | Tauri scaffold, GitHub OAuth login, settings (API key + repo picker), clone/init repo, dashboard with skill cards | Working app with login → dashboard flow |
| **2. Core Agent Loop** | Agent runner with streaming, tool execution loop, Step 1 end-to-end | First agent runs and streams output in UI |
| **3. Q&A Forms** | Markdown parser for clarifications, form components, Steps 2 and 5 | Users answer questions via forms, not markdown |
| **4. Full Workflow** | All 10 steps, parallel agents (Step 3), reasoning loop (Step 6), packaging (Step 10) | Complete workflow equivalent to CLI |
| **5. Git** | Auto-commit after steps, push/pull to GitHub, diff viewer, file history | Versioned decisions synced to GitHub |
| **6. Editor** | CodeMirror editor, split pane, file tree, auto-save | Direct skill file editing |
| **7. Chat** | Conversational edit mode, review + suggest mode | Post-build skill refinement |
| **8. Polish** | Error states, retry UX, loading states, keyboard shortcuts | Production-ready experience |

---

## Key Technical Risks

1. **GitHub OAuth registration** — Requires creating a GitHub OAuth App at github.com/settings/developers and bundling its `client_id`. Device Flow must be enabled for the app. Mitigation: document the setup steps; the `client_id` is public and safe to bundle.
2. **Markdown parsing fragility** — agents may produce slightly off-format Q&A. Mitigation: defensive parser with raw-markdown fallback for unparseable questions.
3. **Tool execution loop complexity** — multi-turn API conversations with interleaved streaming and tool calls. Mitigation: build and test the `runner.rs` module thoroughly in Phase 2 before adding more agents.
4. **Reasoning agent statefulness** — Step 6 is a multi-turn conversation that may span user sessions. Mitigation: on resume, re-launch reasoner with current `decisions.md` + `clarifications.md` as context (losing conversation history but preserving decisions).

---

## Verification

1. **Phase 1**: Launch app → GitHub login → set API key → select/create repo → see empty dashboard. Verify repo cloned locally.
2. **Phase 2**: Create skill, run Step 1, verify streaming output appears in UI, verify `clarifications-concepts.md` written correctly
3. **Phase 3**: Answer questions via form, verify answers written back to markdown in correct format
4. **Phase 4**: Run full 10-step workflow end-to-end, compare output to a CLI-built skill
5. **Phase 5**: Check git log after a workflow run, verify commits at each step. Push to GitHub, verify files appear in the repo.
6. **Phase 7**: Open chat on a completed skill, make an edit via conversation, verify file updated on disk + committed

---

## Critical Files to Reference

- `prompts/shared-context.md` — defines all markdown formats (clarifications, decisions, workflow-state) that the Rust parser must handle
- `CLAUDE.md` — complete workflow state machine (step ordering, transitions, gates) to replicate in Rust
- `prompts/06-reasoning-agent.md` — most complex agent (multi-turn with follow-ups), defines the conversation protocol
- `prompts/07-build-agent.md` — defines skill output structure (SKILL.md + references/)
- `prompts/08-validate-agent.md` — references external URL, needs web-fetch tool support
