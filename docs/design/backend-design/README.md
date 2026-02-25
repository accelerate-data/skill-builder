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


## Database Design

### Connection model

Single `Mutex<Connection>` — all access is serialized. WAL mode enables concurrent readers when the mutex is not held, and a 5-second busy timeout handles contention.

### Migration strategy

Sequential numbered migrations tracked in `schema_migrations`. Migrations run at startup before any commands are registered. Each migration is applied exactly once; version + `applied_at` are recorded.

### Schema overview

The schema has two independent skill registries that serve different parts of the UI:

```
Skills Library (list_skills)             Settings→Skills (list_workspace_skills)
─────────────────────────────            ──────────────────────────────────────
skills  ← master                         workspace_skills  ← standalone
 ├─ workflow_runs        (skill_id FK → skills.id)
 │   ├─ workflow_steps     (workflow_run_id FK → workflow_runs.id)
 │   └─ workflow_artifacts (workflow_run_id FK → workflow_runs.id)
 ├─ imported_skills      (skill_master_id FK → skills.id)
 ├─ workflow_sessions    (skill_id FK → skills.id)
 │   └─ agent_runs       (workflow_session_id → workflow_sessions.session_id,
 │                         workflow_run_id FK → workflow_runs.id)
 ├─ skill_tags           (skill_id FK → skills.id)
 └─ skill_locks          (skill_id FK → skills.id)
```

`workflow_runs` has `skill_id → skills.id`. All child tables now link by integer FK: `workflow_steps`, `workflow_artifacts`, and `agent_runs` use `workflow_run_id → workflow_runs.id`; `skill_tags`, `skill_locks`, `workflow_sessions`, and `imported_skills` use `skill_id`/`skill_master_id → skills.id`. FKs are declared via `REFERENCES` but enforcement requires `PRAGMA foreign_keys = ON` per connection. `skill_name TEXT` is retained in all tables for display and logging. `agent_runs` is a child of `workflow_sessions` (joined via `workflow_session_id`); it also carries `skill_name` and `step_id` to identify which workflow run step it belongs to. `workspace_skills` is entirely separate — no relationship to `skills`.

### Skills Library tables

**`skills`** — Parent catalog. One row per skill in the Skills Library. `skill_source` is the discriminator:

| `skill_source` | Origin | Child table |
|---|---|---|
| `skill-builder` | Created via builder workflow, or disk-discovered with full context artifacts | `workflow_runs` |
| `marketplace` | Bulk imported via `import_marketplace_to_library` | `imported_skills` |
| `imported` | Disk-discovered via reconciliation pass 2 (SKILL.md present, incomplete context) | — |

**`workflow_runs`** — Child of `skills` for `skill-builder` skills. Stores build progress: current step, status, intake data, display metadata. FK `skill_id → skills.id`. One row per skill.

**`workflow_steps`** — Child of `workflow_runs`. Per-step status (`pending` / `in_progress` / `completed`) and timing. FK `workflow_run_id → workflow_runs.id`.

**`workflow_artifacts`** — Child of `workflow_runs`. Step output files stored inline (content + size). Keyed by `(skill_name, step_id, relative_path)`. FK `workflow_run_id → workflow_runs.id`.

**`imported_skills`** — Child of `skills` for `marketplace` skills. Stores import-specific metadata: disk path, active/inactive state, skill type, version, model, argument hint. FK `skill_master_id → skills.id`.

**`workflow_sessions`** — Child of `skills`. Tracks refine and workflow session lifetimes: start, end, PID. FK `skill_id → skills.id`. Includes `reset_marker` to soft-delete cancelled sessions.

**`agent_runs`** — Child of `workflow_sessions` (via `workflow_session_id`). One row per agent invocation. Also carries `skill_name` and `step_id` to identify the workflow run step. FK `workflow_run_id → workflow_runs.id`. Stores model, token counts, cost, duration, turn count, stop reason, compaction count.

**`skill_tags`** — Many-to-many skill→tag, normalized to lowercase. Keyed by `(skill_name, tag)`. FK `skill_id → skills.id`.

**`skill_locks`** — Prevents two app instances from editing the same skill simultaneously. FK `skill_id → skills.id`. Stores `instance_id` and `pid`; stale locks (dead PID) are reclaimed automatically.

### Settings→Skills table

**`workspace_skills`** — Registry of skills deployed to `.claude/skills/` in the agent workspace. Populated via `import_github_skills` (GitHub marketplace) and `upload_skill` (ZIP upload) from the Settings→Skills tab. Each row tracks active/inactive state, disk path, and metadata parsed from SKILL.md frontmatter. Active rows are copied into agent workspace directories at runtime so the Claude Code SDK can load them automatically.

| Column | Type | Notes |
|---|---|---|
| `skill_id` | TEXT PK | UUID |
| `skill_name` | TEXT UNIQUE NOT NULL | Directory name; enforces no duplicates |
| `is_active` | INTEGER | 1 = active (default), 0 = inactive |
| `disk_path` | TEXT NOT NULL | Absolute path to skill directory on disk |
| `imported_at` | TEXT | ISO timestamp, auto-set on insert |
| `is_bundled` | INTEGER | 1 = seeded by app on startup (skill-test, research, etc.), 0 = user-imported |
| `purpose` | TEXT | From frontmatter (domain, source, platform, etc.) |
| `version` | TEXT | From frontmatter |
| `model` | TEXT | From frontmatter |
| `argument_hint` | TEXT | From frontmatter |
| `user_invocable` | INTEGER | From frontmatter |
| `disable_model_invocation` | INTEGER | From frontmatter |

`description` and `trigger_text` were removed in migrations — both are read on-demand from SKILL.md on disk. `skill_name` UNIQUE enforces the no-duplicate-name constraint for uploads and imports.

### Supporting tables

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

On each app launch, `reconcile_on_startup` runs before the dashboard loads. See [startup-recon design doc](../startup-recon/README.md) for the full three-pass state machine.

### Skill ingestion — Settings→Skills

**ZIP upload**: `upload_skill` extracts the archive, parses SKILL.md frontmatter, and inserts into `workspace_skills`. No `skills` master row is created.

**GitHub import**: `import_github_skills` fetches the repo tree, downloads selected skill directories, parses SKILL.md, and inserts into `workspace_skills`. No `skills` master row is created.

### Skill ingestion — Skills Library

**Marketplace bulk import**: `import_marketplace_to_library` walks the marketplace repo, downloads all skills, and writes to both `imported_skills` (disk metadata) and `skills` master (`skill_source='marketplace'`). Accepts an optional `metadata_overrides` map (`skill_path → SkillMetadataOverride`) that lets callers override any frontmatter field (name, description, purpose, version, model, argument_hint, user_invocable, disable_model_invocation) before the DB insert. Used by the marketplace browse UI to let users adjust metadata before importing.

**Plugin skills are intentionally excluded.** `{workspace_path}/.claude/skills` (skills bundled with the workspace for the Claude Code plugin) is not scanned during reconciliation. Only `skills_path` (the user-configured output directory) is reconciled.

### Skill test lifecycle

1. Frontend calls `prepare_skill_test` with a `skill_name`.
2. Backend creates two isolated temp workspaces under a shared `skill-builder-test-{uuid}/` parent:
   - `baseline/` — `.claude/CLAUDE.md` (`# Test Workspace`) + `.claude/skills/skill-test/` copied from bundled resources. No user skill.
   - `with-skill/` — same as baseline, plus `.claude/skills/{skill_name}/` copied from `skills_path`.
3. Returns `test_id`, both `cwd` paths, and a `transcript_log_dir` pointing to `{workspace}/{skill_name}/logs/`.
4. Frontend wraps the user prompt (`"You are a data engineer and the user is trying to do the following task:\n\n{prompt}"`) and spawns plan agents against both workspaces in parallel. The SDK auto-loads `.claude/skills/` from each workspace `cwd`.
5. After both plan agents complete, frontend spawns an evaluator agent in the baseline workspace.
6. Frontend calls `cleanup_skill_test` with the `test_id` → backend removes the shared temp parent directory.

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

`AppSettings` is stored as a single JSON blob in the `settings` KV table. The blob is always read and written as a whole unit, so a proper relational table would add migration overhead with no query benefit.

The API key and GitHub OAuth token are currently stored in the blob unencrypted. Migration of these two fields to the OS keychain is tracked in VD-882.

Changing `skills_path` triggers directory initialization and optional migration of existing skill directories.

### Git integration

The skills output directory (`skills_path`) is initialized as a **local** git repository on first use. The Rust `git.rs` module (backed by `git2`) commits changes on skill creation, path migration, and workflow completion. This enables the history and version-restore features exposed via the git commands.

### Log levels

Runtime log level is configurable via `set_log_level` without restarting the app. The `log` crate is used throughout Rust code; frontend `console.*` calls are bridged to Rust via Tauri's `attachConsole()`. Agent prompts are logged at `debug` level in the app log; full conversation details stay in per-request JSONL transcripts only.
