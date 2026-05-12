# Database Design

Target database architecture for the Skill Builder backend.

## Storage Model

The backend uses two SQLite databases:

1. **App database**: `{app_local_data_dir}/db/skill-builder.db`
   This is the durable product database owned by the Rust backend.
2. **LiteLLM database**: `{app_local_data_dir}/litellm/litellm.db`
   This is owned by LiteLLM for spend logs, verification tokens, and related
   proxy-managed state.

The app database remains the source of truth for product entities. LiteLLM owns
usage and budget-enforcement internals.

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
    │   └── agent_runs
    ├── skill_tags
    ├── skill_locks
    ├── skill_conversations
    └── document_skills

documents

llm_providers
llm_profiles
└── llm_profile_models

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

Owned concerns:

- current step
- overall workflow status
- intake snapshot and workflow-authoring metadata

### `workflow_steps`

Per-step execution state for a workflow run.

### `workflow_artifacts`

Disk-backed workflow outputs that are persisted inline for reset, recovery, and
history behavior.

These are distinct from the normalized clarifications/decisions artifact tables.

### `clarifications` and `decisions`

Normalized workflow artifact parents keyed by canonical `skills.id`.

Target contract:

- `clarifications.skill_id` is the canonical foreign key to `skills.id`
- `decisions.skill_id` is the canonical foreign key to `skills.id`
- child tables cascade from those parents
- all lookup and mutation paths resolve artifact ownership through canonical
  `skills.id`, not ambiguous skill-name matching

#### Clarifications child tables

- `clarification_sections`
- `clarification_questions`
- `clarification_choices`
- `clarification_notes`

#### Decisions child tables

- `decision_items`

### `imported_skills`

Import-specific metadata for marketplace and imported skills. This table is a
child of `skills`; it does not define canonical identity.

### `workflow_sessions`

Workflow/refine session lifetimes keyed back to the owning skill.

### `agent_runs`

Per-run telemetry for workflow and refine activity. In the target architecture,
this remains app-owned execution telemetry, but spend and budget enforcement are
expected to shift to LiteLLM.

### `skill_tags`

Normalized tag assignments for the Skills Library.

### `skill_locks`

Backend-enforced leases that prevent two app instances from owning the same
selected-skill session at once.

### `skill_conversations`

Persistent mapping from `(plugin_slug, skill_name)` to OpenHands
`conversation_id`.

### `documents` and `document_skills`

Document attachments and their optional skill scoping.

## LiteLLM Configuration Tables

### `llm_providers`

App-owned provider configuration.

Target owned fields:

- provider display name
- API key
- optional base URL
- enabled flag
- LiteLLM provider prefix
- forward-compatible provider settings blob

### `llm_profiles`

App-owned model-routing profiles.

Target owned fields:

- profile name
- monthly and total budget caps
- RPM and TPM limits
- virtual key issued by LiteLLM
- forward-compatible profile settings blob

The target architecture uses one shared LiteLLM user and one virtual key per
profile.

### `llm_profile_models`

Ordered model membership within a profile.

Target owned fields:

- `model_name`
- owning provider
- fallback priority
- optional per-model budget cap

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

## LiteLLM-Owned Database

The LiteLLM proxy maintains its own SQLite schema under
`{app_local_data_dir}/litellm/litellm.db`. Target backend design assumes this
database owns:

- virtual-key records
- spend logs
- budget-enforcement state
- shared-user records used by the proxy

The Rust backend treats that database as LiteLLM-managed infrastructure rather
than part of the app database contract.

## Current-State Deltas

Any mismatches between latest `main` and this target schema belong in
[implementation-gaps.md](implementation-gaps.md).
