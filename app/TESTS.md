# Test Plan

## Running Automated Tests

```bash
cd app

# Frontend unit tests (Vitest)
npm test                    # Single run
npm run test:watch          # Watch mode

# Rust unit + integration tests
cd src-tauri && cargo test

# E2E tests (Playwright)
npm run test:e2e            # Starts Vite + runs Playwright

# All frontend tests
npm run test:all
```

**Automated test files:**
- `src/__tests__/` — Vitest unit tests (stores, utils, pages)
- `e2e/` — Playwright E2E tests (navigation, settings, dashboard)
- `src-tauri/src/` — Rust `#[cfg(test)]` modules (workflow_state, node, skill, db)

---

## Manual Test Checklist

The checklists below cover manual QA scenarios not yet covered by automated tests. Check items off as you verify them.

## Phase 1: Foundation

### Dashboard
- [ ] Launch app → dashboard shown directly (no login gate)
- [ ] Empty state shown when no skills exist
- [ ] "New Skill" button opens creation dialog
- [ ] Create skill → card appears in grid
- [ ] Skill card shows: name, domain badge, progress bar, status badge
- [ ] "Continue" button navigates to workflow page
- [ ] "Delete" button shows confirmation dialog
- [ ] Delete confirmed → skill removed from grid
- [ ] Multiple skills render in responsive grid (1/2/3 columns)

### Settings
- [ ] API key field is password-masked with show/hide toggle
- [ ] "Test" button validates API key → turns green on success, error toast on failure
- [ ] Workspace folder: "Browse" opens native OS folder dialog, path saved
- [ ] Save → settings persisted to SQLite
- [ ] Save button turns green "Saved" for 3 seconds
- [ ] Node.js status indicator: green badge with version, or red badge with download link
- [ ] Load existing settings on page mount

### Navigation & Layout
- [ ] Sidebar shows Dashboard + Settings links
- [ ] Active route highlighted in sidebar
- [ ] 3-way theme toggle works (System / Light / Dark)
- [ ] Theme persists across page navigation

### Rust Backend
- [ ] `get_settings` returns default settings from SQLite on first run
- [ ] `save_settings` persists to SQLite and `get_settings` retrieves them
- [ ] `test_api_key` returns true for valid key, false for invalid
- [ ] `list_skills` returns empty array when no skills
- [ ] `create_skill` creates directory structure on disk
- [ ] `list_skills` returns created skill with parsed state
- [ ] `delete_skill` removes directory from disk
- [ ] `list_skills` no longer shows deleted skill
- [ ] `check_node` returns correct version or error

## Phase 2: Core Agent Loop (SDK Sidecar)

### Node.js Dependency Check
- [ ] Settings page shows Node.js version status (green/red indicator)
- [ ] `check_node` command returns correct version or error
- [ ] Node.js < 18 shows "Version too old" badge with download link
- [ ] Node.js missing shows "Not found" badge with download link

### Sidecar
- [ ] `agent-runner.js` bundled as Tauri resource (exists in app bundle)
- [ ] Sidecar reads JSON config from stdin correctly
- [ ] Sidecar calls SDK `query()` with correct options (model, cwd, tools, API key via env)
- [ ] Sidecar streams assistant messages as JSON lines during execution
- [ ] Sidecar streams result message as final JSON line (with cost + usage)
- [ ] Sidecar exits cleanly after query completes
- [ ] Sidecar exits on stdin close / SIGTERM / SIGINT (via AbortController)
- [ ] SDK tools work: agent can Read, Write, Glob, Grep files in workspace

### Rust Agent Management
- [ ] `start_agent` spawns Node.js sidecar process
- [ ] Config (API key via env, model, prompt, cwd) passed correctly to sidecar stdin
- [ ] JSON lines from sidecar stdout parsed into typed structs
- [ ] Each parsed message emitted as Tauri event (`agent-message`, `agent-exit`)
- [ ] `cancel_agent` kills the sidecar process
- [ ] Multiple agents can run concurrently (different agent IDs)
- [ ] Agent process cleanup on app exit (no orphan Node processes)
- [ ] Dev-mode sidecar path resolution works via `CARGO_MANIFEST_DIR`

### Streaming UI
- [ ] Text from assistant messages renders in real-time in output panel (markdown)
- [ ] Agent status shows model name + elapsed time
- [ ] On completion: token usage + cost displayed from result message
- [ ] Cancel button stops the agent (sidecar killed)

### Step 1 End-to-End
- [ ] Create skill → navigate to workflow → Step 1 starts
- [ ] Sidecar spawned with research prompt + correct workspace cwd
- [ ] Streaming text appears in output panel
- [ ] Agent reads prompts via SDK tools
- [ ] `clarifications-concepts.md` written to correct path by agent
- [ ] File contains properly formatted Q&A sections
- [ ] Result message received → step marked complete, workflow advances

## Phase 3: Q&A Forms

### Markdown Parsing
- [ ] Valid clarification markdown → structured ClarificationQuestion objects
- [ ] All fields parsed: id, title, question, choices (with rationale), recommendation, answer
- [ ] Malformed questions → raw markdown fallback (not crash)
- [ ] Serialize answers back → exact original markdown format preserved
- [ ] Round-trip: parse → modify answer → serialize → parse again = consistent

### Form UI
- [ ] Questions rendered as radio-button groups (one per choice)
- [ ] Recommendation highlighted/noted
- [ ] Text input for custom answer ("Other")
- [ ] Submit → answers written back to markdown file on disk
- [ ] Re-open → previously answered questions show saved answers

### Step 2 + 5 End-to-End
- [ ] Step 2: `clarifications-concepts.md` rendered as form
- [ ] Answer all questions → submit → file updated on disk
- [ ] Step 5: `clarifications.md` rendered as form
- [ ] Answer all questions → submit → file updated on disk

## Phase 4: Full Workflow

### Step 3 (Parallel Agents)
- [ ] Two agents start simultaneously
- [ ] Each streams to its own panel
- [ ] Both complete before Step 4 begins
- [ ] `clarifications-patterns.md` and `clarifications-data.md` both written

### Step 6 (Reasoning)
- [ ] Multi-turn conversation displayed in chat-like view
- [ ] Reasoning summary shown to user
- [ ] Follow-up questions detected and prompted
- [ ] User answers follow-ups → reasoning re-runs
- [ ] `decisions.md` written as clean snapshot (not cumulative)
- [ ] Loop ends when all clarifications resolved

### Steps 7-9 (Build/Validate/Test)
- [ ] Step 7: SKILL.md + reference files created in skill directory
- [ ] Step 8: Validation log written, pass/fail summary shown
- [ ] Step 9: Test results written, pass/partial/fail summary shown
- [ ] If Step 9 finds issues → option to loop back to Step 7

### Step 10 (Package)
- [ ] `.skill` zip archive created in skill folder
- [ ] Archive contains SKILL.md + references/
- [ ] Workflow state marked "completed"

### Resume
- [ ] Close app mid-workflow → relaunch → resume from correct step
- [ ] Completed steps skipped on resume
- [ ] In-progress step re-runs from beginning
- [ ] Review steps (2, 5) show form with previous answers on resume

## Phase 5: SQLite Migration

- [ ] First run → SQLite database created in app data directory
- [ ] `get_settings` returns defaults when no settings saved
- [ ] `save_settings` → `get_settings` returns saved values
- [ ] Settings survive app restart (persisted in SQLite)
- [ ] Login page removed — app loads directly to dashboard
- [ ] Settings page shows only: API key, workspace folder, Node.js status
- [ ] No GitHub-related UI anywhere in the app
- [ ] Close app with no agents → closes immediately (no git check)
- [ ] Editor file tree has no git status badges

## Phase 6: Editor

- [ ] File tree shows skill files + context files
- [ ] Click file → opens in CodeMirror editor
- [ ] Markdown syntax highlighting works
- [ ] Live preview updates as you type
- [ ] Auto-save triggers after typing pause (debounce)
- [ ] Context files are read-only in editor

## Phase 7: Chat Interface

### Conversational Editing
- [ ] Send message → Claude responds
- [ ] Claude modifies skill file → inline diff shown
- [ ] Changes saved to disk automatically
- [ ] Conversation history maintained in session

### Review + Suggest
- [ ] Claude returns numbered suggestions
- [ ] Each suggestion shows diff preview
- [ ] Accept → change applied to file
- [ ] Reject → change discarded
- [ ] Discuss → follow-up conversation about that suggestion

## Phase 8: Polish

- [ ] API error → user-friendly error message (not raw error)
- [ ] Network failure → retry button offered
- [ ] Long operations → loading spinners/skeletons shown
- [ ] All async operations show toast on success/failure
- [ ] Empty states have helpful guidance text
- [ ] App works at minimum window size (900x600)
- [ ] Keyboard shortcuts functional (if implemented)

### App Lifecycle
- [ ] Configured workspace path deleted from disk → warning banner on dashboard
- [ ] Warning banner has link to Settings page
- [ ] Close app while agent running → "Agents Still Running" dialog shown
- [ ] "Go Back" dismisses dialog, app stays open
- [ ] Close app with no agents running → closes immediately
- [ ] Close app with no workspace configured → closes immediately
