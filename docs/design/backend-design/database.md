# Database Design

SQLite database at `{app_data_dir}/skill-builder.db` (macOS: `~/Library/Application Support/com.skillbuilder.app/`). Single `Mutex<Connection>`, WAL mode, 5-second busy timeout.

28 sequential migrations run at startup, tracked in `schema_migrations`. A startup repair pass also runs unconditionally to guard against dev builds with partially-applied migrations.

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

## Tables

| Table | PK | FKs | Purpose |
|---|---|---|---|
| `skills` | `id` INTEGER | — | Master catalog for the Skills Library. One row per skill; `skill_source` discriminates between `skill-builder`, `marketplace`, and `imported` |
| `workflow_runs` | `id` INTEGER | `skill_id → skills(id)` | Builder workflow state for `skill-builder` skills — current step, status, intake data, frontmatter |
| `workflow_steps` | `(skill_name, step_id)` | `workflow_run_id → workflow_runs(id)` | Per-step status and timing for each step in the builder workflow |
| `workflow_artifacts` | `(skill_name, step_id, relative_path)` | `workflow_run_id → workflow_runs(id)` | Step output files stored inline; source of truth for resets and version history |
| `imported_skills` | `skill_id` TEXT (UUID) | `skill_master_id → skills(id)` | Disk path and import metadata for `marketplace` skills in the library |
| `workflow_sessions` | `session_id` TEXT (UUID) | `skill_id → skills(id)` | Refine and workflow session lifetimes; tracks PID for crash detection |
| `agent_runs` | `(agent_id, model)` | `workflow_run_id → workflow_runs(id)` | One row per agent invocation; all token, cost, and timing metrics for usage analytics. Composite PK allows sub-agents using different models to each have their own row |
| `skill_tags` | `(skill_name, tag)` | `skill_id → skills(id)` | Many-to-many skill→tag associations, normalized to lowercase |
| `skill_locks` | `skill_name` TEXT | `skill_id → skills(id)` | Prevents two app instances from editing the same skill simultaneously; stale locks (dead PID) are reclaimed on acquire |
| `workspace_skills` | `skill_id` TEXT (UUID) | — | Skills deployed to `.claude/skills/` in the agent workspace. Populated via GitHub import or ZIP upload. Entirely independent of the Skills Library — no FK to `skills` |
| `settings` | `key` TEXT | — | KV store; single row with key `app_settings` holds the full `AppSettings` JSON blob |
| `schema_migrations` | `version` INTEGER | — | Migration version tracker; one row per applied migration |
