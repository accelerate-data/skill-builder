# Backend Design

As-built reference for the Tauri/Rust backend in `app/src-tauri/`.

## Overview

The backend bridges the React frontend and the Node.js agent sidecar. It owns all persistent state (SQLite), orchestrates agent processes, manages the skill lifecycle on disk, and exposes its surface to the frontend as Tauri commands.

**Stack:**

- **Tauri 2** — desktop framework; commands are the IPC boundary
- **Rust** — all backend logic
- **rusqlite (SQLite)** — single embedded database, WAL mode
- **OpenHands Agent Server** — Python service managed via `uvx`; primary runtime for workflow execution and refine sessions. Rust spawns and manages the server process via `agents/openhands_server/`.
- **Promptfoo sidecar** — separate process for Eval Workbench runs; managed by `agents/promptfoo_sidecar/`.

---

## Database Design

### Connection model

Single `Mutex<Connection>` — all access is serialized. WAL mode enables concurrent readers when the mutex is not held, and a 5-second busy timeout handles contention.

### Migration strategy

Sequential numbered migrations tracked in `schema_migrations`. Migrations run at startup before any commands are registered. Each migration is applied exactly once; version + `applied_at` are recorded. 47 migrations as of the current codebase.

### Schema overview

```text
plugins  ← plugin registry
 └─ skills  ← master catalog (plugin_id FK → plugins.id)
      ├─ workflow_runs        (skill_id FK → skills.id)
      │   ├─ workflow_steps     (workflow_run_id FK → workflow_runs.id)
      │   └─ workflow_artifacts (workflow_run_id FK → workflow_runs.id)
      ├─ imported_skills      (skill_master_id FK → skills.id)
      ├─ workflow_sessions    (skill_id FK → skills.id)
      │   └─ agent_runs       (workflow_session_id → workflow_sessions.session_id)
      ├─ skill_tags           (skill_id FK → skills.id)
      └─ skill_locks          (skill_id FK → skills.id)

Workflow artifacts (step 1 & 2):   Eval Workbench:
clarifications                      eval_prompt_sets → eval_prompt_cases
 ├─ clarification_sections          eval_runs → eval_run_results
 ├─ clarification_questions         description_candidates
 │   └─ clarification_choices
 └─ clarification_notes
decisions → decision_items

Agent sessions: skill_conversations (OpenHands conversation-ID persistence)
Documents: documents → document_skills
```

`skill_name TEXT` is retained in all tables for display and logging. FKs are declared via `REFERENCES` but enforcement requires `PRAGMA foreign_keys = ON` per connection. Skills are unique within a plugin: `UNIQUE(plugin_id, name)` replaces the old flat `UNIQUE(name)` constraint (migration 38).

### Skills Library tables

**`plugins`** — Plugin registry. One row per managed plugin (bundled or marketplace). Skills are owned by a plugin via `plugin_id FK → plugins.id`.

**`skills`** — Master catalog. One row per skill. Scoped by `plugin_id`; uniqueness is enforced on `(plugin_id, name)`. `skill_source` is the discriminator:

| `skill_source` | Origin | Child table |
|---|---|---|
| `skill-builder` | Created via builder workflow, or disk-discovered with full context artifacts | `workflow_runs` |
| `marketplace` | Bulk imported via `import_marketplace_to_library` | `imported_skills` |
| `imported` | Disk-discovered via reconciliation pass 2 (SKILL.md present, incomplete context) | — |

**`workflow_runs`** — Child of `skills` for `skill-builder` skills. Stores build progress: current step, status, intake data, display metadata. FK `skill_id → skills.id`. One row per skill.

**`workflow_steps`** — Child of `workflow_runs`. Per-step status (`pending` / `in_progress` / `completed`) and timing. FK `workflow_run_id → workflow_runs.id`.

**`workflow_artifacts`** — Child of `workflow_runs`. Step output files stored inline (content + size). Keyed by `(skill_name, step_id, relative_path)`. FK `workflow_run_id → workflow_runs.id`.

**`imported_skills`** — Child of `skills` for `marketplace` and imported skills. Stores import-specific metadata: disk path, skill type, version, model, argument hint. FK `skill_master_id → skills.id`.

**`workflow_sessions`** — Child of `skills`. Tracks refine and workflow session lifetimes: start, end, PID. FK `skill_id → skills.id`. Includes `reset_marker` to soft-delete cancelled sessions.

**`agent_runs`** — Child of `workflow_sessions` (via `workflow_session_id`). One row per agent invocation. Also carries `skill_name` and `step_id` to identify the workflow run step. FK `workflow_run_id → workflow_runs.id`. Stores model, token counts, cost, duration, turn count, stop reason, compaction count.

**`skill_tags`** — Many-to-many skill→tag, normalized to lowercase. Keyed by `(skill_name, tag)`. FK `skill_id → skills.id`.

**`skill_locks`** — Prevents two app instances from editing the same skill simultaneously. FK `skill_id → skills.id`. Stores `instance_id` and `pid`; stale locks (dead PID) are reclaimed automatically.

**`skill_conversations`** — Maps `(plugin_slug, skill_name)` to OpenHands conversation IDs, enabling persistent multi-turn agent sessions across app restarts (migration 47).

### Supporting tables

**`settings`** — KV store. One JSON blob per key. Used for `AppSettings`: API key, paths, model, auth tokens, feature flags.

**`schema_migrations`** — Migration version tracker. `version` + `applied_at`.

---

## API Surface (Tauri Commands)

See [api.md](api.md) for the full command reference.

---

## Key Data Flows

### Skill creation and workflow execution

1. Frontend calls `create_skill` → backend creates workspace directories + inserts into `skills` (under the skill's plugin) and `workflow_runs`.
2. User advances to a step → frontend calls `run_workflow_step` with step config (prompt template, model, tools).
3. Backend reads API key from settings, builds `SidecarConfig`, and dispatches to the OpenHands Agent Server via `agents/openhands_server/`.
4. Agent Server streams events over HTTP; Rust translates them into Tauri events and emits to the frontend in real time.
5. On completion, backend writes artifacts to `workflow_artifacts`, updates step status in `workflow_steps`, logs agent metrics to `agent_runs`.

### Startup reconciliation

On each app launch, `reconcile_on_startup` runs before the dashboard loads. See [startup-recon design doc](../startup-recon/README.md) for the full three-pass state machine.

### Skill ingestion — Skills Library

**Local file import**: `import_skill_from_file` parses SKILL.md frontmatter and inserts into `imported_skills` + `skills` master under the target plugin.

**Marketplace bulk import**: `import_marketplace_to_library` walks the marketplace repo, downloads all skills, and writes to both `imported_skills` (disk metadata) and `skills` master (`skill_source='marketplace'`). Accepts an optional `metadata_overrides` map (`skill_path → SkillMetadataOverride`) that lets callers override any frontmatter field before the DB insert. Used by the marketplace browse UI to let users adjust metadata before importing.

**Plugin skills are intentionally excluded.** `{workspace_path}/.claude/skills` (skills bundled with the workspace for the Claude Code plugin) is not scanned during reconciliation. Only `skills_path` (the user-configured output directory) is reconciled.

### Refine session lifecycle

1. `get_skill_content_for_refine` loads current skill files into the editor.
2. `start_refine_session` spawns an OpenHands Agent Server session with the skill content as context; returns a `session_id`. Conversation state is persisted in `skill_conversations`.
3. `send_refine_message` continues the conversation within the same session.
4. `pause_refine_session` suspends the session without closing it (conversation ID persists).
5. `close_refine_session` optionally persists changes back to disk and ends the session record.
6. `finalize_refine_run` writes the final summary and closes out the run metrics.

---

## Agent Runtime Integration

The primary agent runtime is the **OpenHands Agent Server**, a Python service managed by Rust in `agents/openhands_server/`. Workflow execution and refine sessions both dispatch through this server.

**Process management**: `process.rs` spawns the server via `uvx` (bundled `uv` binary when available, system `uvx` otherwise). The server is pinned to `openhands-agent-server==<version>` and `openhands-tools==<version>`. `init_bundled_uv_path()` is called at Tauri startup to locate the bundled binary.

**Request dispatch**:
- `run_openhands_one_shot` — fires a single workflow-step run and streams results back.
- `dispatch_openhands_refine_turn` — sends one refine message turn within a persistent conversation.

**Conversation persistence**: The Agent Server stores per-conversation state on disk under a runtime directory. `skill_conversations` maps `(plugin_slug, skill_name)` to conversation IDs so sessions survive app restarts.

**Event streaming**: The Agent Server emits structured events over HTTP. Rust's `events.rs` translates them into Tauri events and forwards them to the frontend in real time using the same event contract (`AgentEvent` tagged union) used by all runtimes.

**Startup check**: `check_startup_deps` probes for the Agent Server (via `uvx`) alongside Node.js, and reports availability to the frontend.

**Eval Workbench**: The **Promptfoo sidecar** (`agents/promptfoo_sidecar/`) is a separate process used only for Eval Workbench runs. It is managed independently of the Agent Server.

**Graceful shutdown**: `graceful_shutdown` terminates all active agent processes with a configurable timeout before the app exits. `cancel_agent_run` cancels a specific in-flight run.

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
