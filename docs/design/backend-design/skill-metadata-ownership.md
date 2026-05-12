# Skill Metadata Ownership

Target ownership model for skill-related metadata and adjacent runtime
configuration.

## Core Rule

Canonical skill identity lives in `skills.id`. Tables that describe a skill,
bind runtime state to a skill, or persist workflow artifacts should resolve
through that canonical row rather than through ambiguous skill-name matching.

## Ownership Boundaries

### `skills`

`skills` is the authoritative store for skill metadata.

Target owned fields:

- `name`
- `plugin_id`
- `skill_source`
- `purpose`
- `description`
- `version`
- `user_invocable`
- `disable_model_invocation`

This table defines what the skill is. It does not own transient execution state
or model-selection infrastructure.

### `workflow_runs`

`workflow_runs` owns builder execution state and workflow-authoring snapshots.

### Workflow artifact tables

`clarifications`, `decisions`, and their child tables own normalized workflow
artifacts. They do not own skill metadata.

### `skill_locks`

`skill_locks` owns backend lease state only.

### `skill_conversations`

`skill_conversations` owns persistent OpenHands conversation bindings only.

### Model catalog tables

The model-catalog cache tables are adjacent backend configuration, not skill
metadata:

- `provider_catalog` owns cached provider metadata and defaults
- `model_catalog` owns cached model metadata and filterable capability fields
- modality child tables own repeated modality values for cached models

These tables define what model options the app knows about. They do not define
what a skill is.

## Write Paths

| Data category | Target owner | Target write path |
|---|---|---|
| Skill metadata | `skills` | skill CRUD and metadata commands |
| Workflow execution state | `workflow_runs` | workflow state commands |
| Workflow step progress | `workflow_steps` | workflow state commands |
| Clarifications / decisions | artifact tables | workflow artifact materialization and edit commands |
| Skill lease state | `skill_locks` | lease-acquire/release commands |
| Persistent conversation binding | `skill_conversations` | selected-skill session bootstrap and cleanup |
| Provider/model catalog cache | catalog tables | model catalog refresh/filter commands |

## Runtime Resolution Rules

### Skill resolution

Target behavior:

- frontend-selected skills resolve to canonical `skills.id`
- backend commands use that canonical identity as the starting point
- artifact lookup must not depend on cross-plugin name fallback

### Model resolution

Target behavior:

- the selected provider/model pair is resolved through the model catalog
- OpenHands runtime config is built directly from that resolved selection
- provider credentials and base-URL overrides are never treated as skill metadata

## What Does Not Belong In `skills`

The following are not skill metadata in the target design:

- transient workflow state
- runtime leases
- OpenHands conversation IDs
- provider API keys
- cached provider/model catalog rows

## Current-State Deltas

Any mismatches on latest `main` belong in
[implementation-gaps.md](implementation-gaps.md).
