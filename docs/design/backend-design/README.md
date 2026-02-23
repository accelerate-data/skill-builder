# Backend Design

As-built reference for the Tauri/Rust backend in `app/src-tauri/`.

## Mental model

The backend is a Rust process (Tauri) that bridges the React frontend and a Node.js agent sidecar. It owns all persistent state in SQLite, manages skill files on disk, and exposes its surface to the frontend as Tauri IPC commands.

The agent sidecar is a separate Node.js child process — Rust spawns it, reads its stdout line by line, and forwards events to the frontend in real time.

**Stack:** Tauri 2 · Rust · rusqlite (SQLite, WAL) · Node.js sidecar (`@anthropic-ai/claude-agent-sdk`)

---

## Two skill registries

The most important thing to understand about the schema: there are **two independent skill stores** serving different parts of the UI.

**Skills Library** (`skills` table + children) — the dashboard. Skills here are created via the builder workflow, imported from the marketplace, or discovered on disk. The `skills` table is the master catalog; every library skill has a row here with a `skill_source` discriminator: `skill-builder`, `marketplace`, or `imported`. Builder-created skills have child rows tracking workflow progress, step outputs, and agent run metrics. Refine session history also links here.

**Settings → Skills** (`workspace_skills` table) — the skills actually deployed to the agent workspace. These are what Claude Code loads at runtime from `.claude/skills/`. Populated via GitHub import or ZIP upload from the Settings tab. Entirely separate from `skills` — no FK relationship between the two.

A skill can exist in the library without being in the workspace, and vice versa.

---

## Database

Single `Mutex<Connection>` serializes all access. WAL mode enables concurrent reads when the mutex is free. Sequential migrations run at startup and are tracked in `schema_migrations`.

See [database.md](database.md) for the full schema — table definitions, column descriptions, and relationships.

---

## Key data flows

### Building a skill (Skills Library)

1. `create_skill` → workspace directories created, rows inserted in `skills` and `workflow_runs`
2. User advances a step → `run_workflow_step` → backend builds a `SidecarConfig` and spawns a Node.js sidecar
3. Sidecar streams JSON lines to stdout → Rust emits Tauri events to the frontend in real time
4. On completion: artifacts written to `workflow_artifacts`, step status updated, agent metrics logged to `agent_runs`

### Installing a skill (Settings → Skills)

**GitHub import** — `import_github_skills` fetches the marketplace listing, downloads selected skill directories, parses SKILL.md frontmatter, inserts into `workspace_skills`. After insert, rewrites SKILL.md on disk with any user-edited metadata from the import wizard. If the rewrite fails, the DB row is rolled back and the skill directory is removed.

**ZIP upload** — `upload_skill` extracts the archive, parses SKILL.md, inserts into `workspace_skills`.

Neither flow creates a `skills` master row — library and workspace are independent.

### Marketplace import (Skills Library)

`import_marketplace_to_library` downloads a skill from the marketplace and writes to both `imported_skills` (disk metadata) and `skills` master (`skill_source='marketplace'`). Skills are imported one at a time. Accepts a metadata overrides map so the browse UI can let users adjust frontmatter before inserting.

### Startup reconciliation

`reconcile_startup` compares the `skills_path` directory on disk against the DB. A skill directory present on disk but not in the DB is surfaced to the user as an orphan or discovery to resolve. Tolerates workspace moves, manual edits, and multi-instance scenarios.

### Skill test

`prepare_skill_test` creates two isolated temp workspaces — one baseline (no skill) and one with the skill under test. The frontend runs plan agents against both in parallel, then an evaluator agent against the baseline. `cleanup_skill_test` removes the temp directories.

### Refine session

`get_skill_content_for_refine` loads current skill files → `start_refine_session` spawns an agent with them as context → `send_refine_message` continues the conversation → `close_refine_session` optionally persists changes to disk. `get_refine_diff` shows a unified diff at any point.

---

## Agent sidecar

`SidecarPool` in Rust manages Node.js child processes. `start_agent` builds a `SidecarConfig` (prompt, model, API key, cwd, tools, max turns) and spawns the process. The pool reads stdout line by line and emits Tauri events to the frontend.

Every request produces a JSONL transcript at `{workspace}/logs/{step}-{timestamp}.jsonl`. The first line is the config (API key redacted); subsequent lines are the full SDK conversation. Transcripts older than 30 days are pruned at startup.

Idle sidecars are cleaned up after 5 minutes. `graceful_shutdown` terminates all active sidecars before the app exits.

---

## Cross-cutting concerns

**Concurrency** — `skill_locks` table prevents two app instances from editing the same skill simultaneously. Locks store instance ID and PID; stale locks (dead PID) are reclaimed automatically.

**Path validation** — `fs_validation.rs` ensures all file I/O resolves within the skills workspace, guarding against directory traversal from malicious skill content.

**Git** — `skills_path` is initialized as a local git repo on first use. Rust commits on skill creation, path migration, and workflow completion, enabling the history and version-restore features.

**Settings** — `AppSettings` is stored as a single JSON blob in the `settings` KV table. API key and OAuth token are currently unencrypted; keychain migration is tracked in VD-882.

**Logging** — Log level is configurable at runtime via `set_log_level`. Rust uses the `log` crate; frontend `console.*` is bridged via `attachConsole()`. Agent prompts are logged at `debug`; full conversations stay in transcripts only.

---

## API surface

See [api.md](api.md) for the full command reference.
