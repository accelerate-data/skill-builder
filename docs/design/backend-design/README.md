# Backend Design

As-built reference for the Tauri/Rust backend in `app/src-tauri/`.

## Overview

The backend bridges the React frontend and the Node.js agent sidecar. It owns all persistent state (SQLite), orchestrates agent processes, manages the skill lifecycle on disk, and exposes its surface to the frontend as Tauri commands.

**Stack:**
- **Tauri 2** — desktop framework; commands are the IPC boundary
- **Rust** — all backend logic
- **rusqlite (SQLite)** — single embedded database, WAL mode
- **Node.js sidecar** — separate child process running `@anthropic-ai/claude-agent-sdk`; managed by the Rust backend

---

## Module Structure

```
src/
├── lib.rs                  # Tauri builder, app setup, command registration
├── main.rs                 # Mobile entry point (minimal)
├── types.rs                # All serializable structs (AppSettings, SkillSummary, etc.)
├── db.rs                   # All SQLite queries + 20 migrations
│
├── commands/               # One file per domain group (~20 files, 47 commands total)
│   ├── agent.rs
│   ├── clarification.rs
│   ├── feedback.rs
│   ├── files.rs
│   ├── git.rs
│   ├── github_auth.rs
│   ├── github_import.rs
│   ├── imported_skills.rs
│   ├── lifecycle.rs
│   ├── node.rs
│   ├── refine.rs
│   ├── settings.rs
│   ├── skill.rs
│   ├── skill_test.rs
│   ├── usage.rs
│   ├── workflow.rs
│   └── workspace.rs
│
├── agents/
│   ├── sidecar_pool.rs     # Lifecycle management for spawned sidecar processes
│   ├── sidecar.rs          # SidecarConfig, spawn/wait logic
│   └── events.rs           # Tauri event emission to frontend
│
├── reconciliation.rs       # Orphan/discovery detection at startup
├── git.rs                  # git2 wrapper (commit, diff, restore)
├── logging.rs              # Log plugin setup, level control, transcript pruning
├── fs_validation.rs        # Path validation (directory traversal prevention)
└── cleanup.rs              # Cleanup on shutdown
```

---

## Database Design

### Connection model

Single `Mutex<Connection>` — all access is serialized. WAL mode enables concurrent readers when the mutex is not held, and a 5-second busy timeout handles contention.

### Migration strategy

20 sequential migrations tracked in `schema_migrations`. Migrations run at startup before any commands are registered. Each migration is applied exactly once; version + `applied_at` are recorded.

### Tables

| Table | Purpose |
|---|---|
| `settings` | KV store; one row per key. Used for `AppSettings` (API key, paths, model, auth tokens, flags). |
| `skills` | Master catalog for the **Skills Library**. Three `skill_source` values: `'skill-builder'` (built via workflow), `'marketplace'` (bulk imported), `'imported'` (disk-discovered via reconciliation pass 2 — SKILL.md present but incomplete context artifacts). |
| `workflow_runs` | Build progress for skill-builder skills: current step, status, intake data, display metadata. One row per skill. |
| `workflow_steps` | Per-step status and timing for each workflow run. |
| `workflow_sessions` | Session tracking for refine and workflow invocations. Includes `reset_marker` for cancelled sessions. |
| `agent_runs` | Metrics for every agent invocation: model, token counts, cost, duration, turn count, stop reason. |
| `workflow_artifacts` | File content produced by workflow steps, stored inline with path and size. |
| `skill_tags` | Many-to-many skill→tag, normalized to lowercase. |
| `imported_skills` | Disk-path and metadata store for marketplace bulk imports. Created alongside a `skills` master row by `import_marketplace_to_library`. |
| `workspace_skills` | Skills shown in the **Settings→Skills tab** — populated via GitHub import (`import_github_skills`) and disk ZIP upload (`upload_skill`). Manages per-skill active/inactive state. These skills do **not** appear in the `skills` master table. |
| `skill_locks` | Concurrency control — prevents concurrent edits across app instances. |
| `schema_migrations` | Migration version tracker. |

### Key relationships

- `workflow_runs.skill_id` → `skills.id` (FK; skill-builder skills only)
- `imported_skills.skill_name` → `skills.name` (by convention — marketplace imports have a row in both)
- `workspace_skills` is completely separate from `skills` — Settings→Skills and the Skills Library are backed by different tables with no FK between them
- `agent_runs` references `(skill_name, step_id, session_id)` — not enforced as FK, joined by convention
- `workflow_artifacts` keyed by `(skill_name, step_id, relative_path)`
- `skill_tags` keyed by `(skill_name, tag)`

### Design decisions

**Two separate skill registries.** The `skills` table is the master catalog for the Skills Library (`list_skills`). The `workspace_skills` table is a separate registry for the Settings→Skills tab (`list_workspace_skills`). Skills in `workspace_skills` — those imported from GitHub or uploaded via ZIP — do not appear in the Skills Library and have no row in `skills`. Marketplace bulk imports (`import_marketplace_to_library`) are the only import path that writes to both: `imported_skills` (disk metadata) and `skills` (library entry).

**`skill_source` discriminator in `skills`.** Three values: `'skill-builder'` for workflow-built skills (always have a `workflow_runs` row), `'marketplace'` for marketplace imports (no `workflow_runs`), and `'imported'` for skills discovered on disk during reconciliation pass 2 with a SKILL.md but incomplete context artifacts (no `workflow_runs`).

**Soft-delete for usage data.** `agent_runs` and `workflow_sessions` use a `reset_marker` column rather than hard deletes. The UI can hide cancelled/reset entries without losing historical cost data.

**Split workspace vs. app data.** Skills content lives in the user-configured workspace path (`~/.vibedata/` by default). The database lives in Tauri's `app_data_dir`. These are intentionally separate: the workspace is user-owned and portable; the DB is app-owned and not hand-edited.

---

## API Surface (Tauri Commands)

All commands return `Result<T, String>`. Async commands use `#[tauri::command]` with Tokio.

### Settings (7 commands)
Get and save `AppSettings`, test the Anthropic API key, change runtime log level, get the log file path and default skills path.

### Skill Management (13 commands)
List skills (with tags and metadata), create, delete, rename, update tags, update metadata, get all tags, get installed skill names, AI-powered name/domain suggestions, acquire/release/check/list skill locks.

### Workflow Execution (11 commands)
Run a workflow step (spawns agent), get and save workflow state, verify step output, reset a step and all subsequent steps, preview what a reset would delete, run the answer evaluator gate, autofill clarifications and refinement suggestions, log gate decisions, get disabled steps.

### Agent Lifecycle (3 commands)
Start an agent (spawn sidecar), check whether any agents are running, graceful shutdown of all sidecars.

### File I/O (7 commands)
List skill files, read/write text files (5 MB cap), copy files, read/write base64-encoded binary files, save raw files during clarification.

### Imported & Marketplace Skills (6 commands)
Upload a ZIP skill, list imported skills (hydrated with SKILL.md), toggle active flag, delete, get skill content, export as ZIP.

### GitHub Integration (9 commands)
Parse GitHub URLs, check marketplace URL validity, list and import skills from GitHub repos, import all marketplace skills, GitHub OAuth device flow (start, poll, get user, logout).

### Usage Analytics (8 commands)
Persist agent run metrics, get usage summary (total cost, runs, averages), get recent runs and sessions, get session/step agent runs, aggregate cost by step and by model, reset usage (soft delete via reset_marker).

### Workspace & Reconciliation (7 commands)
Get workspace path, clear workspace, run startup reconciliation, resolve orphan skills, resolve discovered skills, create/end workflow sessions.

### Refine (4 commands)
Get skill content for refine editor, compute diff between original and modified, start/send/close refine session.

### Git History (3 commands)
Get commit history for a skill, compute diff between two commits, restore skill to a previous commit.

### Node & Dependencies (2 commands)
Check Node.js availability (bundled or system), check all startup dependencies.

### Feedback & Testing (3 commands)
Create a GitHub issue (feedback repo), prepare and clean up skill test environment.

---

## Key Data Flows

### Skill creation and workflow execution

1. Frontend calls `create_skill` → backend creates workspace directories + inserts into `skills` and `workflow_runs`.
2. User advances to a step → frontend calls `run_workflow_step` with step config (prompt template, model, tools).
3. Backend reads API key from settings, builds `SidecarConfig`, spawns Node.js sidecar via `SidecarPool`.
4. Sidecar streams JSON lines to stdout → Tauri captures and emits as frontend events in real time.
5. On completion, backend writes artifacts to `workflow_artifacts`, updates step status in `workflow_steps`, logs agent metrics to `agent_runs`.

### Startup reconciliation

On each app launch, `reconcile_startup` scans the workspace directory and compares disk state to the DB:
- **Orphans**: skill directory on disk but no DB entry → surfaced to user for manual resolution or auto-cleaned if empty.
- **Discoveries**: skill directory found that was previously unknown → user can register it into the catalog.

This tolerates workspace moves, manual edits, and multi-instance scenarios.

### Skill ingestion paths

**ZIP upload** (Settings→Skills): `upload_skill` extracts the archive, parses SKILL.md frontmatter, and inserts into `workspace_skills`. No `skills` master row is created.

**GitHub import** (Settings→Skills): `import_github_skills` fetches the repo tree, downloads selected skill directories, parses SKILL.md, and inserts into `workspace_skills`. No `skills` master row is created.

**Marketplace bulk import** (Skills Library): `import_marketplace_to_library` walks the marketplace repo, downloads all skills, and writes to both `imported_skills` (disk metadata) and `skills` master (`skill_source='marketplace'`). These skills appear in the Skills Library, not Settings→Skills.

**Plugin skills are intentionally excluded.** `{workspace_path}/.claude/skills` (skills bundled with the workspace for the Claude Code plugin) is not scanned during reconciliation. Only `skills_path` (the user-configured output directory) is reconciled.

### Refine session lifecycle

1. `get_skill_content_for_refine` loads current skill files into the editor.
2. `start_refine_session` spawns an agent with the skill content as context; returns a `session_id`.
3. `send_refine_message` continues the conversation within the same session.
4. `close_refine_session` optionally persists changes back to disk; ends the session record.
5. `get_refine_diff` can be called at any point to show a unified diff between original and modified content.

---

## Agent Sidecar Integration

The agent runtime is a Node.js process using `@anthropic-ai/claude-agent-sdk`, managed by `SidecarPool` in Rust.

**Spawn**: `start_agent` builds a `SidecarConfig` (prompt, model, API key, cwd, allowed tools, max turns, optional extended thinking budget) and hands it to the pool. The pool spawns the child process and tracks it by `agent_id`.

**Streaming**: The sidecar writes JSON events to stdout line by line. The Rust pool reads stdout, parses each line, and emits the corresponding Tauri event to the frontend. This enables real-time streaming of agent output in the UI.

**Transcripts**: Every agent request produces a JSONL transcript at `{workspace}/logs/{step}-{timestamp}.jsonl`. The first line is the config object (API key redacted). Subsequent lines are the full SDK conversation: prompts, assistant messages, tool use, tool results. Transcripts are pruned at startup (>30 days old).

**Pool lifecycle**:
- Agents idle for more than 5 minutes are cleaned up automatically.
- `graceful_shutdown` terminates all active sidecars with a configurable timeout before the app exits.
- `cleanup_skill_sidecar` terminates the sidecar for a specific skill (used when resetting or deleting).

**Extended thinking**: When enabled in settings, `max_thinking_tokens=16_000` is passed to the sidecar config. The appropriate `betas` header is set based on the model and thinking flag combination.

---

## Cross-Cutting Concerns

### Concurrency

**Skill locks** (`skill_locks` table) prevent two app instances from editing the same skill simultaneously. Locks are keyed by `(skill_name, instance_id, pid)` and released on app exit.

**DB mutex**: A single `Mutex<Connection>` serializes all database access. This is sufficient for the current workload; the WAL mode allows reads to proceed while Tauri event handling (which doesn't touch the DB) runs concurrently.

### Path validation

`fs_validation.rs` validates all file I/O commands to ensure paths resolve within the skills workspace. This prevents directory traversal attacks from malicious skill content.

### Settings persistence

`AppSettings` is stored as a single JSON blob in the `settings` KV table. Sensitive fields (API key, GitHub OAuth token) are stored in the DB — not encrypted, but access requires local file system access. Changing `skills_path` triggers directory initialization and optional migration of existing skill directories.

### Git integration

The skills output directory (`skills_path`) is initialized as a git repository on first use. The Rust `git.rs` module (backed by `git2`) commits changes on skill creation, path migration, and workflow completion. This enables the history and version-restore features exposed via the git commands.

### Log levels

Runtime log level is configurable via `set_log_level` without restarting the app. The `log` crate is used throughout Rust code; frontend `console.*` calls are bridged to Rust via Tauri's `attachConsole()`. Agent prompts are logged at `debug` level in the app log; full conversation details stay in per-request JSONL transcripts only.
