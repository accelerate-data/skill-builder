# Skill Metadata Ownership

This document defines which table owns each category of skill data, the write path
for each, and the rationale for the ownership boundaries.

## Table Roles

### `skills` — Authoritative Catalog

`skills` is the single source of truth for all skill metadata. Every skill, regardless
of origin (skill-builder, marketplace, or imported), has exactly one row here.

Owned fields:

- `description` — human-readable description of the skill
- `version` — semver string (e.g. `1.0.0`)
- `model` — preferred Claude model override, or `NULL` to inherit the global setting
- `argument_hint` — optional free-text hint passed to the agent at invocation
- `user_invocable` — whether the skill can be triggered directly by the user
- `disable_model_invocation` — whether the skill suppresses model calls entirely
- `purpose` — high-level category (e.g. `domain`, `source`, `data-engineering`)
- `skill_source` — origin: `skill-builder`, `marketplace`, or `imported`

**These fields must only be written via `set_skill_behaviour` (or `upsert_skill` for
`purpose`/`skill_source`). No other write path is permitted.**

### `workflow_runs` — Immutable Point-in-Time Execution Snapshot

`workflow_runs` records the execution state of a skill-builder workflow run. It is
scoped to skills with `skill_source = 'skill-builder'`.

Fields in this table:

- `current_step`, `status`, `purpose` — mutable execution state
- `source`, `author_login`, `author_avatar`, `display_name`, `intake_json` — snapshot
  captured at workflow creation; immutable after the run begins

**Metadata fields (`description`, `version`, `model`, `argument_hint`,
`user_invocable`, `disable_model_invocation`) were removed from this table in
migration 35.** They existed here transitionally (migrations 16–34) and were moved to
`skills` in migration 24. After migration 35 these columns do not exist in
`workflow_runs` and cannot be written here even accidentally.

The `save_workflow_state` Tauri command reflects this: it accepts only execution-state
parameters and has no metadata parameters. See the doc-comment on that command for
the full rationale.

### `workspace_skills` — Dropped

`workspace_skills` was dropped in migration 36. It held transient bundled/toggle state
for imported skills.

### `plugins` — Plugin Registry (migration 38)

Migration 38 introduced the `plugins` table and added a `plugin_id INTEGER` foreign key to `skills`. Skills are now scoped by plugin — the uniqueness constraint changed from `UNIQUE(name)` to `UNIQUE(plugin_id, name)`. All imported skills belong to a plugin row; the `imported_skills` table retains disk-path and version metadata but is joined via `skill_master_id → skills(id)` rather than holding ownership directly.

## Write Paths

| Data category | Table | Write function |
|---|---|---|
| Skill metadata (description, version, model, …) | `skills` | `db::set_skill_behaviour` |
| Skill purpose / source | `skills` | `db::upsert_skill` / `db::upsert_skill_with_source` |
| Workflow execution state | `workflow_runs` | `db::save_workflow_run` |
| Workflow step progress | `workflow_steps` | `db::save_workflow_step` |
| Intake JSON | `workflow_runs` | `db::set_skill_intake` |
| Author / avatar | `workflow_runs` | `db::set_skill_author` |
| Tags | `skill_tags` | `db::set_skill_tags` |

## Read Path for Agent Execution

`read_workflow_settings` (in `commands/workflow/runtime.rs`) assembles all data
needed to launch a workflow step. Metadata is always fetched via `get_skill_master`
from the `skills` table. The function never reads metadata from `workflow_runs` or
from any frontend-supplied payload.

## Migration History

| Migration | Change |
|---|---|
| 16 | Added `description`, `version`, `model`, … to `workflow_runs` |
| 24 | Added the same fields to `skills`; backfilled from `workflow_runs` |
| 35 | Dropped metadata columns from `workflow_runs`; `skills` is now sole owner |
| 36 | Dropped `workspace_skills` table entirely |
| 37 | Added foreign-key cascade constraints |
| 38 | Added `plugins` table; added `plugin_id → plugins(id)` FK to `skills`; uniqueness changed to `(plugin_id, name)` |
| 39 | Added `upgrade_locked` flag to `plugins` |
| 40 | Added `documents` and `document_skills` tables |
| 41 | Legacy tag cleanup |
| 42 | Performance indexes |
| 43 | Reserved migration for OpenHands LLM settings (no schema change) |
| 44 | Added Eval Workbench tables: `eval_prompt_sets`, `eval_prompt_cases`, `eval_runs`, `eval_run_results`, `description_candidates` |
| 45 | Added workflow artifact tables: `clarifications`, `clarification_sections`, `clarification_questions`, `clarification_choices`, `clarification_notes`, `decisions`, `decision_items` |
| 46 | Added `plugin_slug`, `skill_name`, `scenario_name` identity columns to `eval_runs` |
| 47 | Added `skill_conversations` table for OpenHands conversation-ID persistence |
