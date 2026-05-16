# Database Design

Target database architecture for the Skill Builder backend.

## Storage Model

The backend uses one app-owned SQLite database:

1. **App database**: `{app_local_data_dir}/db/skill-builder.db`
   This is the durable product database owned by the Rust backend.

The app database remains the source of truth for product entities, runtime
selection state, and cached model metadata.

## App Database Topology

```text
plugins
└── skills
    ├── workflow_runs
    │   ├── workflow_steps
    │   └── workflow_artifacts
    ├── clarifications
    │   ├── clarification_sections
    │   ├── clarification_questions
    │   │   └── clarification_choices
    │   └── clarification_notes
    ├── decisions
    │   └── decision_items
    ├── imported_skills
    ├── workflow_sessions
    │   └── conversation_runs
    ├── skill_tags
    ├── skill_locks
    ├── skill_conversations
    └── document_skills

documents

provider_catalog
└── model_catalog
    ├── model_input_modalities
    └── model_output_modalities

scenarios
└── assertions

settings
schema_migrations
reconciliation_events
```

## Skill Library Tables

### `plugins`

Plugin registry for all managed skill containers. `skills.plugin_id` scopes
skill uniqueness and ownership.

### `skills`

Master skill catalog. Canonical identity is `skills.id`.

Owned concerns:

- plugin ownership
- skill name
- skill source (`skill-builder`, `marketplace`, `imported`)
- skill metadata and behavior flags

Every product-facing skill reference should resolve to this row.

### `workflow_runs`

Builder-workflow run state for `skill-builder` skills.

### `workflow_steps`

Per-step execution state for a workflow run.

### `workflow_artifacts`

Disk-backed workflow outputs persisted inline for reset, recovery, and history
behavior.

### `clarifications` and `decisions`

Normalized workflow artifact parents keyed by canonical `skills.id`.

Target contract:

- `clarifications.skill_id` is the canonical foreign key to `skills.id`
- `decisions.skill_id` is the canonical foreign key to `skills.id`
- child tables cascade from those parents
- all lookup and mutation paths resolve artifact ownership through canonical
  `skills.id`, not ambiguous skill-name matching

### `imported_skills`

Import-specific metadata for marketplace and imported skills. This table is a
child of `skills`; it does not define canonical identity.

### `workflow_sessions`

Workflow/refine session lifetimes keyed back to the owning skill.

### `conversation_runs`

Per-conversation telemetry for workflow, workspace, refine, evaluator, and test
activity. This remains app-owned execution telemetry and uses
`conversation_id` plus `skill_id` as the canonical historical identity.

### `skill_tags`

Normalized tag assignments for the Skills Library.

### `skill_locks`

Backend-enforced leases that prevent two app instances from owning the same
selected-skill session at once.

### `skill_conversations`

Persistent mapping from skill identity to OpenHands `conversation_id`.

### `documents` and `document_skills`

Document attachments and their optional skill scoping.

## Model Catalog Tables

### `provider_catalog`

Cached provider metadata from `models.dev`.

Target owned concerns:

- provider identifier
- provider display name
- default API/base URL
- lossless provider payload snapshot
- refresh timestamp

### `model_catalog`

Cached flat model rows used by the Settings UI and runtime model resolution.

Target owned concerns:

- owning provider foreign key
- provider-scoped model identity
- filterable capability columns
- limits and cost fields projected from `models.dev`
- lossless model payload snapshot
- refresh timestamp

### `model_input_modalities` and `model_output_modalities`

Child tables for repeated modality values.

Target contract:

- rows reference `model_catalog.full_id`
- foreign keys use `ON DELETE CASCADE`
- refreshes cannot leave orphaned child rows behind

## Eval Workbench Tables

### `scenarios`

Saved eval scenarios owned by the app database. Scenario identity is durable
`scenarios.id`; `name` is editable display data.

### `assertions`

Ordered assertion list for a scenario.

## Supporting Tables

### `settings`

Application settings blob and related key-value storage.

### `schema_migrations`

Ordered migration ledger for the app database.

### `reconciliation_events`

Append-only log of startup reconciliation actions.

## Current-State Deltas

Any mismatches between latest `main` and this target schema belong in
[implementation-gaps.md](implementation-gaps.md).
