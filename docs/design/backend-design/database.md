# Database Design

SQLite database at `{app_data_dir}/skill-builder.db` (macOS: `~/Library/Application Support/com.vibedata.skill-builder/`). Single `Mutex<Connection>`, WAL mode, 5-second busy timeout.

47 sequential migrations run at startup, tracked in `schema_migrations`. A startup repair pass also runs unconditionally to guard against dev builds with partially-applied migrations.

---

## Table map

```text
Skills Library
──────────────────────────────────────────────────────────────
plugins  (plugin registry)
 └── skills  (master catalog — plugin_id FK → plugins.id)
      ├── workflow_runs
      │    ├── workflow_steps
      │    └── workflow_artifacts
      ├── imported_skills
      ├── workflow_sessions
      │    └── agent_runs
      ├── skill_tags
      └── skill_locks

Workflow Artifacts                      Eval Workbench
──────────────────────────────────────  ───────────────────────────────
clarifications                          eval_prompt_sets
 ├── clarification_sections              └── eval_prompt_cases
 ├── clarification_questions            eval_runs (plugin_slug/skill/scenario)
 │    └── clarification_choices          └── eval_run_results
 └── clarification_notes                description_candidates
decisions
 └── decision_items

Agent Sessions                          Documents
──────────────────                      ──────────────────────
skill_conversations                     documents
                                         └── document_skills

Supporting
──────────
settings
schema_migrations
reconciliation_events
```

---

## Tables

| Table | PK | FKs | Purpose |
|---|---|---|---|
| `plugins` | `id` INTEGER | — | Plugin registry; one row per managed plugin (bundled or marketplace). Skills are owned by a plugin via `plugin_id → plugins(id)` |
| `skills` | `id` INTEGER | `plugin_id → plugins(id)` | Master catalog for the Skills Library. One row per skill; `skill_source` discriminates between `skill-builder`, `marketplace`, and `imported`. Uniqueness is enforced on `(plugin_id, name)` |
| `workflow_runs` | `id` INTEGER | `skill_id → skills(id)` | Builder workflow state for `skill-builder` skills — current step, status, intake data, frontmatter |
| `workflow_steps` | `(skill_name, step_id)` | `workflow_run_id → workflow_runs(id)` | Per-step status and timing for each step in the builder workflow |
| `workflow_artifacts` | `(skill_name, step_id, relative_path)` | `workflow_run_id → workflow_runs(id)` | Step output files stored inline; source of truth for resets and version history |
| `imported_skills` | `skill_id` TEXT (UUID) | `skill_master_id → skills(id)` | Disk path and import metadata for `marketplace` skills in the library |
| `workflow_sessions` | `session_id` TEXT (UUID) | `skill_id → skills(id)` | Refine and workflow session lifetimes; tracks PID for crash detection |
| `agent_runs` | `(agent_id, model)` | `workflow_run_id → workflow_runs(id)` | One row per agent invocation; all token, cost, and timing metrics for usage analytics. Composite PK allows sub-agents using different models to each have their own row |
| `skill_tags` | `(skill_name, tag)` | `skill_id → skills(id)` | Many-to-many skill→tag associations, normalized to lowercase |
| `skill_locks` | `skill_name` TEXT | `skill_id → skills(id)` | Prevents two app instances from editing the same skill simultaneously; stale locks (dead PID) are reclaimed on acquire |
| `clarifications` | `id` INTEGER | — | Parent for step-1 research refinement artifacts; stores question metadata and evaluation verdicts |
| `clarification_sections` | `id` INTEGER | `clarification_id → clarifications(id)` | Hierarchical section groupings within a clarifications document |
| `clarification_questions` | `id` INTEGER | `clarification_id → clarifications(id)` | Individual research questions with answers and per-question verdicts |
| `clarification_choices` | `id` INTEGER | `question_id → clarification_questions(id)` | Multiple-choice options for a clarification question |
| `clarification_notes` | `id` INTEGER | `clarification_id → clarifications(id)` | Free-form notes attached to a clarifications document |
| `decisions` | `id` INTEGER | — | Parent for step-2 decision confirmation artifacts; stores decision metadata and reconciliation state |
| `decision_items` | `id` INTEGER | `decision_id → decisions(id)` | Individual decision items with original questions, implications, and conflict state |
| `eval_prompt_sets` | `id` INTEGER | — | Eval Workbench scenario definitions (migration 44) |
| `eval_prompt_cases` | `id` INTEGER | `prompt_set_id → eval_prompt_sets(id)` | Individual test cases within a prompt set |
| `eval_runs` | `id` INTEGER | — | Eval Workbench run history; keyed by `(plugin_slug, skill_name, scenario_name)` (identity added in migration 46) |
| `eval_run_results` | `id` INTEGER | `eval_run_id → eval_runs(id)` | Per-case results for an eval run |
| `description_candidates` | `id` INTEGER | — | Generated trigger-description candidates from eval runs |
| `skill_conversations` | `id` INTEGER | — | Maps `(plugin_slug, skill_name)` to OpenHands conversation IDs for session persistence (migration 47) |
| `documents` | `id` INTEGER | — | Documents attached to agents (file, URL, or folder). Scope `all` applies globally; scope `skill` links via `document_skills` |
| `document_skills` | `(document_id, skill_id)` | `document_id → documents(id)`, `skill_id → skills(id)` | Many-to-many join for skill-scoped document attachments |
| `reconciliation_events` | `id` INTEGER | — | Audit log of startup reconciliation actions (type + details). Append-only |
| `settings` | `key` TEXT | — | KV store; single row with key `app_settings` holds the full `AppSettings` JSON blob |
| `schema_migrations` | `version` INTEGER | — | Migration version tracker; one row per applied migration |
