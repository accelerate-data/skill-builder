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

### Schema overview

The schema has two independent skill registries that serve different parts of the UI:

```
Skills Library (list_skills)             Settings→Skills (list_workspace_skills)
─────────────────────────────            ──────────────────────────────────────
skills  ← master (skill_name)            workspace_skills  ← standalone
 ├─ workflow_runs   (skill-builder, FK)
 │   ├─ workflow_steps     (skill_name)
 │   └─ workflow_artifacts (skill_name)
 ├─ imported_skills  (marketplace, skill_name)
 ├─ workflow_sessions (skill_name)
 ├─ agent_runs        (skill_name)
 └─ skill_tags        (skill_name)
```

`skills` is the parent for the Skills Library. `workflow_runs` has an enforced FK (`skill_id → skills.id`). All other child tables link by `skill_name` convention (no enforced FK). `workspace_skills` is entirely separate — no relationship to `skills`.

### Skills Library tables

**`skills`** — Parent catalog. One row per skill in the Skills Library. `skill_source` is the discriminator:

| `skill_source` | Origin | Child table |
|---|---|---|
| `skill-builder` | Created via builder workflow, or disk-discovered with full context artifacts | `workflow_runs` |
| `marketplace` | Bulk imported via `import_marketplace_to_library` | `imported_skills` |
| `imported` | Disk-discovered via reconciliation pass 2 (SKILL.md present, incomplete context) | — |

**`workflow_runs`** — Child of `skills` for `skill-builder` skills. Stores build progress: current step, status, intake data, display metadata. FK `skill_id → skills.id`. One row per skill.

**`workflow_steps`** — Child of `workflow_runs`. Per-step status (`pending` / `in_progress` / `completed`) and timing.

**`workflow_artifacts`** — Child of `workflow_runs`. Step output files stored inline (content + size). Keyed by `(skill_name, step_id, relative_path)`.

**`imported_skills`** — Child of `skills` for `marketplace` skills. Stores import-specific metadata: disk path, active/inactive state, skill type, version, model, argument hint. Linked to `skills` by `skill_name` (convention, not enforced FK).

### Settings→Skills table

**`workspace_skills`** — Standalone registry for the Settings→Skills tab. Populated by `import_github_skills` (GitHub) and `upload_skill` (disk ZIP). Manages per-skill active/inactive toggle. These skills do **not** appear in the `skills` master and are not part of the Skills Library.

**`workflow_sessions`** — Tracks refine and workflow session lifetimes (start, end, PID). Linked to `skills` by `skill_name`. Includes `reset_marker` to soft-delete cancelled sessions.

**`agent_runs`** — One row per agent invocation. Stores model, token counts, cost, duration, turn count, stop reason, compaction count. Linked to `skills` by `skill_name`; also references `step_id` and `session_id` by convention.

**`skill_tags`** — Many-to-many skill→tag, normalized to lowercase. Keyed by `(skill_name, tag)`.

### Supporting tables

**`skill_locks`** — Concurrency control. Prevents two app instances from editing the same skill simultaneously. Keyed by `skill_name`; stores `instance_id` and `pid`.

**`settings`** — KV store. One JSON blob per key. Used for `AppSettings`: API key, paths, model, auth tokens, feature flags.

**`schema_migrations`** — Migration version tracker. `version` + `applied_at`.


---

## API Surface (Tauri Commands)

See [api.md](api.md) for the full command reference.

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
