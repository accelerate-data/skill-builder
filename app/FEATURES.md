# Features

## Phase 1: Foundation

- [x] Tauri v2 scaffold with React 19 + TypeScript + Vite 7
- [x] shadcn/ui component library (16 components)
- [x] Tailwind CSS 4 with light/dark mode tokens
- [x] TanStack Router with dashboard, settings, workflow routes
- [x] Zustand stores (auth, skills, settings, workflow, agent)
- [x] App layout with sidebar navigation + header with user avatar
- [x] 3-way theme toggle (System/Light/Dark) via next-themes
- [x] Typed Tauri invoke wrappers for all backend commands
- [x] Dashboard — skill cards grid with progress, status badges, actions
- [x] New Skill dialog — domain input with auto-derived kebab-case name
- [x] Delete Skill dialog — confirmation with invoke
- [x] Settings page — API key (with test), workspace folder picker
- [x] Rust: Settings storage via rusqlite (SQLite)
- [x] Rust: Settings CRUD (get/save/test API key)
- [x] Rust: Skill CRUD (list/create/delete from filesystem)
- [x] Rust: Workflow state markdown parser

## Phase 2: Core Agent Loop (SDK Sidecar)

### Node.js Dependency Check
- [x] Rust: `check_node` command — run `node --version`, parse version, return status
- [x] Frontend: Node.js status indicator on Settings page (green/red badge)

### Sidecar (Node.js)
- [x] `sidecar/` directory with package.json, tsconfig.json
- [x] `@anthropic-ai/claude-code` SDK installed as dependency
- [x] `agent-runner.ts` — reads JSON config from stdin, runs `query()`, streams JSON lines to stdout
- [x] Handles SDK message types (system, assistant, result)
- [x] Graceful shutdown on stdin close, SIGTERM, SIGINT via AbortController
- [x] `build.js` — esbuild bundles into single `dist/agent-runner.js` (417KB)
- [x] Bundled JS file included as Tauri resource

### Rust: Agent Management
- [x] `commands/agent.rs` — `start_agent` and `cancel_agent` Tauri commands
- [x] `agents/sidecar.rs` — spawn `node agent-runner.js`, write config to stdin, read stdout
- [x] `agents/events.rs` — parse JSON lines from stdout → emit Tauri events
- [x] Pass API key (via env var), model, prompt, cwd, allowedTools, maxTurns to sidecar
- [x] Track running agent processes (AgentRegistry: HashMap of agent_id → child process)
- [x] Cancel: kill child process on `cancel_agent`
- [x] Dev-mode sidecar path fallback via `CARGO_MANIFEST_DIR`

### Frontend: Streaming UI
- [x] Agent output streaming panel (real-time markdown display from Tauri events)
- [x] Agent status display (model, elapsed time, token usage from result message)
- [x] Workflow store (10 workflow steps with status tracking)
- [x] Agent store (run state, streaming events, cost tracking)
- [x] `use-agent-stream` hook (subscribe to Tauri agent-message/agent-exit events)
- [x] Workflow wizard page — step progression sidebar + content area

### UI Polish (pulled forward from Phase 8)
- [x] Test buttons turn green with checkmark on success (API key, GitHub token)
- [x] Save button turns green "Saved" for 3 seconds after save
- [x] Toast notifications for all async operations

## Phase 3: Q&A Forms

- [x] Rust: Clarification markdown parser (Q&A format → structured data)
- [x] Rust: Clarification serializer (structured data → markdown)
- [x] Rust: Parse command (parse_clarifications) returning structured questions
- [x] Rust: Save command (save_clarification_answers) writing markdown back
- [x] Rust: Save raw file fallback (save_raw_file)
- [x] Frontend: Q&A form component (radio buttons from choices, text answer field)
- [x] Frontend: Question list renderer (parsed from markdown, with recommendations)
- [x] Frontend: Raw markdown fallback for unparseable questions
- [x] Frontend: Form submission → serialize back to exact markdown format
- [x] Step 2 end-to-end: view questions as form → answer → save to file
- [x] Step 5 end-to-end: view merged questions as form → answer → save
- [x] Tests: 10 clarification form component tests + 7 Rust parser unit tests

## Phase 4: Full Workflow

- [x] Rust: Workflow state machine (step ordering, transitions, gates)
- [x] Rust: Step 3 — parallel agents (spawn two sidecar processes concurrently)
- [x] Rust: Step 4 — merge agent execution
- [x] Rust: Step 6 — reasoning agent with session resume for multi-turn
- [x] Rust: Step 6 — follow-up question detection in reasoning chat
- [x] Rust: Step 7 — build agent execution
- [x] Rust: Step 8 — validator agent execution
- [x] Rust: Step 9 — tester agent execution
- [x] Rust: Step 10 — package skill as .skill zip archive
- [x] Frontend: Step 3 — dual streaming panels (parallel agent output)
- [x] Frontend: Step 6 — chat-like view for multi-turn reasoning
- [x] Frontend: Step 6 — follow-up question prompt + re-run via session resume
- [x] Frontend: Step 7-9 — agent output + summary display
- [x] Frontend: Step 10 — package confirmation
- [x] Frontend: Workflow resume (load state, skip completed steps)
- [x] Full 10-step workflow end-to-end

## Phase 5: SQLite Migration (replaced Git Integration)

- [x] Removed: GitHub OAuth, clone, push, pull, commit, diff, log, status
- [x] Removed: git2 dependency, tauri-plugin-store
- [x] Added: rusqlite with bundled SQLite for settings persistence
- [x] Rust: db.rs — connection init, migrations, read/write settings helpers
- [x] Rust: Settings commands rewritten to use SQLite (Db state)
- [x] Rust: Workflow commands use Db state for API key lookup
- [x] Frontend: Removed login page, auth store, git hooks, git components
- [x] Frontend: Simplified settings (API key + workspace folder only)
- [x] Frontend: Simplified close guard (agents-only check, no git)
- [x] Frontend: Removed git status from editor file tree
- [x] Added: workflow_runs, workflow_steps tables for workflow state persistence
- [x] Added: agent_runs table for agent execution history
- [x] Added: chat_sessions, chat_messages tables for chat interface
- [x] Removed: workflow.md file-based state persistence
- [x] Rust: get_workflow_state/save_workflow_state rewritten for SQLite

## Phase 6: Editor

- [x] Install CodeMirror 6 (@codemirror/lang-markdown)
- [x] Frontend: Three-pane layout (file tree | editor | preview)
- [x] Frontend: File tree showing skill files (editable) + context files (read-only)
- [x] Frontend: CodeMirror source editor with markdown syntax highlighting
- [x] Frontend: Live markdown preview (react-markdown)
- [x] Frontend: Auto-save with debounce
- [x] Frontend: `use-skill-files` hook

## Phase 7: Chat Interface

- [x] Rust: Chat session management (create, list, messages) via SQLite
- [x] Sidecar: Chat agent mode — same SDK sidecar with skill-editing prompt
- [x] Frontend: Conversational editing mode — free-form chat, Claude modifies files
- [x] Frontend: Chat store (sessions, messages, streaming)
- [x] Frontend: Chat page with message bubbles and agent streaming
- [x] Rust: Inline diff generation for file changes
- [x] Frontend: Review + suggest mode — numbered suggestions with diff previews
- [x] Frontend: Accept/Reject/Discuss buttons per suggestion
- [x] Frontend: Mode toggle switch (conversational vs review)

## Phase 8: Polish

- [x] Error boundaries + error state components
- [x] Retry UX for failed operations
- [x] Loading states / skeleton components
- [x] Keyboard shortcuts
- [x] Toast notifications for all async operations
- [x] Empty states with guidance
- [x] Responsive layout adjustments
- [ ] App icon and branding
- [x] First-run onboarding flow
- [x] Onboarding: prompt for API key + workspace folder on first launch

### App Lifecycle
- [x] Rust: `check_workspace_path` — validate workspace folder exists on disk
- [x] Rust: `has_running_agents` — check if any agent processes are running
- [x] Rust: Window close interceptor (on_window_event + CloseRequested)
- [x] Frontend: Workspace folder missing warning banner on dashboard
- [x] Frontend: Close guard — block close while agents running
