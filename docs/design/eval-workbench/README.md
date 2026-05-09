---
functional-specs: []
---

# Eval Workbench

> **Status:** Draft
> **Functional specs:** Not applicable; this design covers the app-owned eval authoring model for skills.

## Overview

Eval Workbench is an **authoring-only** surface for scenarios and assertions stored in SQLite. It does not execute eval runs, does not own OpenHands bootstrap/resume, and does not use a Promptfoo sidecar.

- each skill owns a set of scenarios in SQLite;
- each scenario has one prompt and one set of assertions;
- scenario generation sends a prompt to the already-selected skill conversation;
- no eval run execution exists in app code, DB tables, docs, or tests.

## Design Scope

**Covers**

- the authored scenario model used by the Eval Workbench UI;
- SQLite-backed scenario and assertion storage;
- generation via the selected-skill conversation;
- scenario CRUD operations (create, list, load, save, delete).

**Does not cover**

- the repo-owned `tests/evals/` engineering harness;
- eval run execution or run history;
- Promptfoo sidecar or any eval execution engine.

## Key Decisions

| Decision | Rationale |
|---|---|
| Scenarios and assertions are SQLite-backed. | Removes git-backed YAML file complexity; single source of truth in the app database. |
| Eval does not own OpenHands bootstrap/resume. | Skill selection is the only owner of persistent OpenHands bootstrap/resume/pause. |
| Generation uses the selected-skill conversation. | Eval sends a prompt to the already-selected skill conversation via `send_openhands_message`; it does not start or resume conversations itself. |
| No eval run execution exists. | Clean break from the old Promptfoo-backed run model. Run execution will be redesigned later if needed. |
| Treat each authored scenario as a single test item. | Matches the user's mental model and removes the extra `case` abstraction. |
| Author assertions in plain business language. | Users describe what the answer must explain or calculate, not low-level matcher syntax. |

## Data Model

Scenarios and assertions are stored in SQLite via migration 48:

```sql
scenarios (
  id TEXT PRIMARY KEY,
  plugin_slug TEXT NOT NULL,
  skill_name TEXT NOT NULL,
  name TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode = 'performance'),
  prompt TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)

assertions (
  id TEXT PRIMARY KEY,
  scenario_id TEXT NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  assertion TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
)
```

Legacy tables (`eval_prompt_sets`, `eval_prompt_cases`, `eval_runs`, `eval_run_results`, `description_candidates`) are dropped by the same migration.

## UI Model

### Scenario list

Eval Workbench shows a scenario list for the selected skill.

Selection rules:

- when there are saved scenarios, the first valid scenario is auto-selected;
- when there are no saved scenarios, the editor opens in new-scenario draft state.

### Scenario editor

The scenario editor owns one authored scenario at a time.

Fields:

- `Scenario name`
- `Prompt`
- `Assertions`

Actions:

- `New scenario`
- `Generate scenario and assertions`
- `Delete scenario`
- `Save`

## Generation Behavior

`Generate scenario and assertions` is a scenario-level action that fills the current draft using the selected-skill OpenHands conversation.

Inputs:

- canonical skill path;
- workspace skill path when relevant;
- skill files;
- clarifications when present;
- decisions when present;
- current scenario name;
- existing prompt and assertions for overwrite-aware regeneration.

Outputs:

- prompt text for the scenario;
- plain-language assertions for that scenario.

The action dispatches via `send_openhands_message` (canonical `SendExistingOnly` dispatch), waits for the terminal result, parses the structured output, and persists the generated scenario prompt and assertions back to SQLite. If no selected-skill conversation exists, it fails loudly.

## Runtime Boundary

- SQLite is the source of truth for authored eval assets;
- Rust/Tauri owns scenario CRUD and generation dispatch;
- Eval does not execute runs or manage run history;
- Refine remains the editing surface after generation.

## Validation Rules

- `Scenario name` is required.
- `Prompt` is required.
- At least one assertion is required before save.

## Relationship To Prior Design Docs

This document replaces the following deleted design docs:

- prior sidecar integration design (deleted)
- prior scenario storage design (deleted)
- prior scenario remediation design (deleted)

## Key Source Files

| File | Purpose |
|---|---|
| `app/src-tauri/src/db/eval_workbench.rs` | SQLite CRUD for scenarios and assertions. |
| `app/src-tauri/src/commands/eval_workbench/mod.rs` | Tauri command surface for scenario CRUD and generation via selected-skill conversation. |
| `app/src/lib/queries/eval-scenarios.ts` | TanStack Query hooks for scenario operations. |
| `app/src/components/workspace/workspace-eval-workbench.tsx` | Scenario selection and generation wiring. |
| `app/src/components/workspace/workspace-evals.tsx` | One-tab Eval Workbench shell with scenario-level controls. |

## Open Questions

1. `[future]` How will eval run execution be reintroduced when the product direction requires it?
