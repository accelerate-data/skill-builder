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
- [x] Settings page — API key (with test), GitHub PAT (with test), repo picker, folder picker
- [x] Rust: GitHub PAT validation (fetch user from token)
- [x] Rust: Token storage via tauri-plugin-store
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

### Git Integration (pulled forward from Phase 5)
- [x] Rust: `list_github_repos` — paginated GitHub API fetch of user repos
- [x] Rust: `clone_repo` — clone via HTTPS + token auth, seed README.md + .gitignore
- [x] Rust: `commit_and_push` — stage all, commit, push to remote
- [x] Frontend: Repo picker — searchable dropdown of GitHub repos with refresh
- [x] Frontend: Folder picker — native OS dialog via tauri-plugin-dialog
- [x] Frontend: Clone & Setup button (turns green on success)
- [x] Frontend: Save commits and pushes to repo

### UI Polish (pulled forward from Phase 8)
- [x] Test buttons turn green with checkmark on success (API key, GitHub token)
- [x] Save button turns green "Saved" for 3 seconds after save
- [x] Toast notifications for all async operations

## Phase 3: Q&A Forms

- [ ] Rust: Clarification markdown parser (Q&A format → structured data)
- [ ] Rust: Clarification serializer (structured data → markdown)
- [ ] Rust: Parse command (parse_clarifications) returning structured questions
- [ ] Rust: Save command (save_clarification_answers) writing markdown back
- [ ] Frontend: Q&A form component (radio buttons from choices, text answer field)
- [ ] Frontend: Question list renderer (parsed from markdown, with recommendations)
- [ ] Frontend: Raw markdown fallback for unparseable questions
- [ ] Frontend: Form submission → serialize back to exact markdown format
- [ ] Step 2 end-to-end: view questions as form → answer → save to file
- [ ] Step 5 end-to-end: view merged questions as form → answer → save

## Phase 4: Full Workflow

- [ ] Rust: Workflow state machine (step ordering, transitions, gates)
- [ ] Rust: Step 3 — parallel agents (spawn two sidecar processes concurrently)
- [ ] Rust: Step 4 — merge agent execution
- [ ] Rust: Step 6 — reasoning agent (multi-turn conversation loop)
- [ ] Rust: Step 6 — follow-up question detection + append to clarifications
- [ ] Rust: Step 7 — build agent execution
- [ ] Rust: Step 8 — validator agent execution
- [ ] Rust: Step 9 — tester agent execution
- [ ] Rust: Step 10 — package skill as .skill zip archive
- [ ] Frontend: Step 3 — dual streaming panels (parallel agent output)
- [ ] Frontend: Step 6 — chat-like view for multi-turn reasoning
- [ ] Frontend: Step 6 — follow-up question prompt + re-run
- [ ] Frontend: Step 7-9 — agent output + summary display
- [ ] Frontend: Step 10 — package confirmation
- [ ] Frontend: Workflow resume (load state, skip completed steps)
- [ ] Full 10-step workflow end-to-end

## Phase 5: Git Integration

- [x] Rust: git2 — clone repo (HTTPS + GitHub token)
- [x] Rust: git2 — commit with message
- [x] Rust: git2 — push to remote
- [x] Rust: git2 — seed README.md + .gitignore on empty repos
- [x] Rust: Clone/init on first setup after repo selection
- [ ] Rust: git2 — pull from remote
- [ ] Rust: git2 — diff (file-level + line-level)
- [ ] Rust: git2 — log (commit history)
- [ ] Rust: git2 — file status (modified, untracked)
- [ ] Rust: Auto-commit after each workflow step (configurable)
- [ ] Rust: Auto-push after commit (optional)
- [ ] Frontend: Push/pull toolbar buttons
- [ ] Frontend: Diff viewer for file history (react-diff-viewer-continued)
- [ ] Frontend: Git status indicators per file
- [ ] Frontend: `use-git-status` hook

## Phase 6: Editor

- [ ] Install CodeMirror 6 (@codemirror/lang-markdown)
- [ ] Frontend: Three-pane layout (file tree | editor | preview)
- [ ] Frontend: File tree showing skill files (editable) + context files (read-only)
- [ ] Frontend: CodeMirror source editor with markdown syntax highlighting
- [ ] Frontend: Live markdown preview (react-markdown)
- [ ] Frontend: Auto-save with debounce
- [ ] Frontend: Git status indicators in file tree
- [ ] Frontend: `use-skill-files` hook

## Phase 7: Chat Interface

- [ ] Rust: Chat session management (create, list, messages)
- [ ] Sidecar: Chat agent mode — SDK query with skill file tools + conversational context
- [ ] Rust: Inline diff generation for file changes
- [ ] Frontend: Conversational editing mode — free-form chat, Claude modifies files
- [ ] Frontend: Review + suggest mode — numbered suggestions with diff previews
- [ ] Frontend: Accept/Reject/Discuss buttons per suggestion
- [ ] Frontend: Mode toggle switch (conversational vs review)
- [ ] Frontend: Chat store (sessions, messages, streaming)

## Phase 8: Polish

- [ ] Error boundaries + error state components
- [ ] Retry UX for failed operations
- [ ] Loading states / skeleton components
- [ ] Keyboard shortcuts
- [ ] Toast notifications for all async operations
- [ ] Empty states with guidance
- [ ] Responsive layout adjustments
- [ ] App icon and branding
- [ ] First-run onboarding flow
- [ ] Onboarding: prompt for GitHub PAT + API key on first launch
