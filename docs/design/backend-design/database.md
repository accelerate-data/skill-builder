# Database Design

SQLite database at `{app_data_dir}/skill-builder.db` (macOS: `~/Library/Application Support/com.skillbuilder.app/`). Single `Mutex<Connection>`, WAL mode, 5-second busy timeout.

24 sequential migrations run at startup, tracked in `schema_migrations`. A startup repair pass also runs unconditionally to guard against dev builds with partially-applied migrations.

---

## Table map

```
Skills Library                          Settings → Skills
──────────────────────────────────────  ─────────────────────────
skills  (master catalog)                workspace_skills
 ├── workflow_runs                           (standalone — no FK to skills)
 │    ├── workflow_steps
 │    └── workflow_artifacts
 ├── imported_skills
 ├── workflow_sessions
 │    └── agent_runs
 ├── skill_tags
 └── skill_locks

Supporting
──────────
settings
schema_migrations
```

---

## Skills Library tables

### `skills` — master catalog

One row per skill in the Skills Library. All library queries start here.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK AUTOINCREMENT | |
| `name` | TEXT UNIQUE NOT NULL | |
| `skill_source` | TEXT NOT NULL | `skill-builder` · `marketplace` · `imported` |
| `domain` | TEXT | |
| `skill_type` | TEXT | |
| `description` | TEXT | From SKILL.md frontmatter |
| `version` | TEXT | From SKILL.md frontmatter |
| `model` | TEXT | From SKILL.md frontmatter |
| `argument_hint` | TEXT | From SKILL.md frontmatter |
| `user_invocable` | INTEGER | 1 = invocable by user |
| `disable_model_invocation` | INTEGER | 1 = model cannot invoke |
| `created_at` · `updated_at` | TEXT | ISO timestamps |

**`skill_source` discriminator:**

| Value | Origin | Has child row in |
|---|---|---|
| `skill-builder` | Created via builder workflow | `workflow_runs` |
| `marketplace` | Imported from marketplace browse dialog | `imported_skills` |
| `imported` | Disk-discovered during reconciliation (SKILL.md present, no full context) | — |

---

### `workflow_runs` — builder workflow state

One row per `skill-builder` skill. Tracks the build in progress: current step, status, intake data, display metadata.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK AUTOINCREMENT | |
| `skill_name` | TEXT UNIQUE NOT NULL | |
| `skill_id` | INTEGER FK → `skills(id)` | |
| `domain` | TEXT NOT NULL | |
| `current_step` | INTEGER | 0-based index of the active step |
| `status` | TEXT | `pending` · `in_progress` · `completed` |
| `skill_type` | TEXT | `domain` · `source` · `platform` etc. |
| `description` · `version` · `model` | TEXT | Frontmatter (also mirrored to `skills`) |
| `argument_hint` | TEXT | |
| `user_invocable` · `disable_model_invocation` | INTEGER | |
| `display_name` | TEXT | Human-readable display name from intake |
| `intake_json` | TEXT | Full intake form answers as JSON |
| `author_login` · `author_avatar` | TEXT | GitHub author info |
| `created_at` · `updated_at` | TEXT | |

---

### `workflow_steps` — per-step status

One row per (skill, step). Tracks completion state and timing for each step in the builder workflow.

| Column | Type | Notes |
|---|---|---|
| `skill_name` | TEXT NOT NULL | |
| `step_id` | INTEGER NOT NULL | |
| `workflow_run_id` | INTEGER FK → `workflow_runs(id)` | |
| `status` | TEXT | `pending` · `in_progress` · `completed` |
| `started_at` · `completed_at` | TEXT | |

PK: `(skill_name, step_id)`

---

### `workflow_artifacts` — step output files

Stores the output files produced by each workflow step, inline in the DB. Content is also written to disk; the DB copy is the source of truth for resets and history.

| Column | Type | Notes |
|---|---|---|
| `skill_name` | TEXT NOT NULL | |
| `step_id` | INTEGER NOT NULL | |
| `relative_path` | TEXT NOT NULL | Path relative to the skill directory |
| `workflow_run_id` | INTEGER FK → `workflow_runs(id)` | |
| `content` | TEXT NOT NULL | Full file content stored inline |
| `size_bytes` | INTEGER | |
| `created_at` · `updated_at` | TEXT | |

PK: `(skill_name, step_id, relative_path)`

---

### `imported_skills` — marketplace skill metadata

One row per marketplace skill imported into the Skills Library. Stores disk path and frontmatter. The `skills` master row is the source of truth for display; this table adds the import-specific fields.

| Column | Type | Notes |
|---|---|---|
| `skill_id` | TEXT PK | UUID |
| `skill_name` | TEXT UNIQUE NOT NULL | |
| `skill_master_id` | INTEGER FK → `skills(id)` | |
| `domain` | TEXT | |
| `is_active` | INTEGER | 1 = active (default) |
| `disk_path` | TEXT NOT NULL | Absolute path to skill directory |
| `imported_at` | TEXT | |
| `is_bundled` | INTEGER | 1 = seeded by app on startup |
| `skill_type` · `version` · `model` | TEXT | From SKILL.md frontmatter |
| `argument_hint` | TEXT | |
| `user_invocable` · `disable_model_invocation` | INTEGER | |

---

### `workflow_sessions` — refine and workflow session lifetimes

One row per session (refine or workflow). Tracks the process PID so the app can detect crashes. Cancelled sessions are soft-deleted via `reset_marker`.

| Column | Type | Notes |
|---|---|---|
| `session_id` | TEXT PK | UUID |
| `skill_name` | TEXT NOT NULL | |
| `skill_id` | INTEGER FK → `skills(id)` | |
| `pid` | INTEGER NOT NULL | Child process PID |
| `started_at` · `ended_at` | TEXT | |
| `reset_marker` | TEXT | Non-null = session was cancelled/reset |

---

### `agent_runs` — individual agent invocations

One row per agent invocation. Captures all metrics for the usage analytics screens. Composite PK `(agent_id, model)` allows sub-agents using different models within the same invocation to each have their own row.

| Column | Type | Notes |
|---|---|---|
| `agent_id` | TEXT NOT NULL | |
| `model` | TEXT NOT NULL | |
| `skill_name` | TEXT NOT NULL | |
| `step_id` | INTEGER NOT NULL | |
| `workflow_run_id` | INTEGER FK → `workflow_runs(id)` | |
| `workflow_session_id` | TEXT → `workflow_sessions(session_id)` | |
| `status` | TEXT | `running` · `completed` · `shutdown` |
| `input_tokens` · `output_tokens` | INTEGER | |
| `cache_read_tokens` · `cache_write_tokens` | INTEGER | |
| `total_cost` | REAL | USD |
| `duration_ms` · `duration_api_ms` | INTEGER | Wall time vs API time |
| `num_turns` | INTEGER | Conversation turns |
| `stop_reason` | TEXT | Why the agent stopped |
| `tool_use_count` | INTEGER | Total tool calls |
| `compaction_count` | INTEGER | Context compactions |
| `reset_marker` | TEXT | Non-null = soft-deleted by usage reset |
| `started_at` · `completed_at` | TEXT | |

PK: `(agent_id, model)`

---

### `skill_tags` — tag associations

Many-to-many between skills and tags. Tags are normalized to lowercase.

| Column | Type | Notes |
|---|---|---|
| `skill_name` | TEXT NOT NULL | |
| `skill_id` | INTEGER FK → `skills(id)` | |
| `tag` | TEXT NOT NULL | Lowercase |
| `created_at` | TEXT | |

PK: `(skill_name, tag)`

---

### `skill_locks` — multi-instance edit safety

Prevents two running app instances from editing the same skill simultaneously. Stale locks (PID no longer alive) are reclaimed automatically on acquire.

| Column | Type | Notes |
|---|---|---|
| `skill_name` | TEXT PK | |
| `skill_id` | INTEGER FK → `skills(id)` | |
| `instance_id` | TEXT NOT NULL | UUID assigned to this app instance |
| `pid` | INTEGER NOT NULL | |
| `acquired_at` | TEXT | |

---

## Settings → Skills table

### `workspace_skills` — deployed skill registry

Skills deployed to `.claude/skills/` in the agent workspace — what the Claude Code SDK actually loads at runtime. Populated via GitHub import or ZIP upload from the Settings tab. **No FK relationship to `skills`** — entirely independent of the library.

| Column | Type | Notes |
|---|---|---|
| `skill_id` | TEXT PK | UUID |
| `skill_name` | TEXT UNIQUE NOT NULL | Directory name; enforces no duplicates |
| `domain` | TEXT | |
| `is_active` | INTEGER | 1 = active; inactive skills are not deployed to agent workspaces |
| `is_bundled` | INTEGER | 1 = seeded by app on startup (e.g. skill-test, research) |
| `disk_path` | TEXT NOT NULL | Absolute path to skill directory |
| `imported_at` | TEXT | |
| `skill_type` · `version` · `model` | TEXT | From SKILL.md frontmatter |
| `argument_hint` | TEXT | |
| `user_invocable` · `disable_model_invocation` | INTEGER | |

`description` and `trigger_text` were removed in earlier migrations — both are read on-demand from SKILL.md on disk.

---

## Supporting tables

### `settings`

Single-row KV store (key = `'app_settings'`). Value is the `AppSettings` struct serialized as a JSON blob: API key, workspace path, model, GitHub OAuth token, marketplace URL, feature flags. Read and written as a whole unit.

| Column | Type |
|---|---|
| `key` | TEXT PK |
| `value` | TEXT NOT NULL |

### `schema_migrations`

Migration version tracker.

| Column | Type |
|---|---|
| `version` | INTEGER PK |
| `applied_at` | TEXT |
