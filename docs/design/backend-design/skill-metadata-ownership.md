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
or model-routing infrastructure.

### `workflow_runs`

`workflow_runs` owns builder execution state and workflow-authoring snapshots.

Target owned concerns:

- `current_step`
- `status`
- `purpose` as the workflow-run purpose snapshot
- intake and display metadata captured during workflow creation

`workflow_runs` must not become a second source of truth for canonical skill
metadata.

### Workflow artifact tables

`clarifications`, `decisions`, and their child tables own normalized workflow
artifacts. They do not own skill metadata. They depend on canonical skill
identity and should reference the owning skill through `skills.id`.

### `skill_locks`

`skill_locks` owns backend lease state only. It does not own any skill metadata.

### `skill_conversations`

`skill_conversations` owns persistent conversation bindings only. It does not
own any skill metadata.

### LiteLLM tables

The LiteLLM configuration tables are adjacent backend configuration, not skill
metadata:

- `llm_providers` owns provider credentials and provider-specific routing data
- `llm_profiles` owns profile budgets, rate limits, settings blobs, and virtual
  keys
- `llm_profile_models` owns per-profile model membership, priority, and
  per-model budgets

These tables define how model traffic is routed. They do not define what a
skill is.

## Write Paths

| Data category | Target owner | Target write path |
|---|---|---|
| Skill metadata | `skills` | skill CRUD and metadata commands |
| Workflow execution state | `workflow_runs` | workflow state commands |
| Workflow step progress | `workflow_steps` | workflow state commands |
| Clarifications / decisions | artifact tables | workflow artifact materialization and edit commands |
| Skill lease state | `skill_locks` | lease-acquire/release commands |
| Persistent conversation binding | `skill_conversations` | selected-skill session bootstrap and cleanup |
| Provider config | `llm_providers` | LiteLLM provider commands |
| Profile config | `llm_profiles` | LiteLLM profile commands |
| Profile model routing | `llm_profile_models` | LiteLLM profile-model commands |

## Runtime Resolution Rules

### Skill resolution

Target behavior:

- frontend-selected skills resolve to canonical `skills.id`
- backend commands use that canonical identity as the starting point
- artifact lookup must not depend on cross-plugin name fallback

### Model resolution

Target behavior:

- the selected LiteLLM profile defines the virtual key, budgets, and fallback
  order
- OpenHands runtime config points at LiteLLM rather than a direct provider
  credential
- provider credentials are never treated as skill metadata

## What Does Not Belong In `skills`

The following are not skill metadata in the target design:

- transient workflow state
- runtime leases
- OpenHands conversation IDs
- provider API keys
- LiteLLM virtual keys
- profile budgets and rate limits
- usage/spend logs

## Current-State Deltas

Any mismatches on latest `main` belong in
[implementation-gaps.md](implementation-gaps.md).
