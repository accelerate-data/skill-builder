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

### `workspace_skills` — User-Overridable Import Copy (Removed)

`workspace_skills` was dropped in migration 36. It held transient bundled/toggle state
for imported skills and has no replacement. Imported skills are now managed exclusively
through `imported_skills` and the `skills` master table.

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
