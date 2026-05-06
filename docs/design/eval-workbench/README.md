---
functional-specs: []
---

# Eval Workbench

> **Status:** Draft
> **Functional specs:** Not applicable; this design covers the app-owned eval authoring and execution model for skills.

## Overview

Eval Workbench should follow the Promptfoo mental model directly:

- each skill owns one Promptfoo package;
- that package contains a set of scenarios;
- each scenario is one authored test item;
- each scenario has one prompt and one set of assertions;
- trigger evaluation is an optional dimension on the same scenario, not a second authored object type.

The current implementation adds an extra nested `case` layer inside each scenario and exposes multiple generation surfaces that do different things. That makes the editor harder to understand and pushes the UI away from the user's expected Promptfoo model.

This design replaces the current `scenario -> many cases` authoring model with a simpler `skill -> many scenarios` model and makes generation scenario-scoped rather than bulk-scoped.

## Design Scope

**Covers**

- the authored scenario model used by the Eval Workbench UI and app runtime;
- scenario file shape under plugin-owned `evals/{skill_name}/`;
- performance and trigger semantics for one scenario;
- generation and suggestion actions in the editor;
- run enablement and selection rules;
- naming and labeling changes required to make the UI align with the Promptfoo model.

**Does not cover**

- the repo-owned `tests/evals/` engineering harness;
- Promptfoo red-team scans;
- remote or shared run-history storage;
- replacing the Promptfoo sidecar or OpenHands runtime boundary.

## Key Decisions

| Decision | Rationale |
|---|---|
| Treat each authored scenario as a single Promptfoo scenario. | This matches the user's mental model and removes the extra `case` abstraction currently exposed in the UI and runtime contracts. |
| Remove nested authored `case` objects from the editor model. | The current `scenario -> many cases` shape behaves more like a grouped folder than a Promptfoo scenario and is the main source of UX confusion. |
| Keep `Performance` always enabled and visible, but disabled in the UI. | Performance evaluation is mandatory for every authored scenario, but the user should still see that it is part of the scenario contract. |
| Keep `Trigger` as an optional checkbox. | A scenario can be performance-only or performance-plus-trigger without requiring separate authored records. |
| Use one scenario-level `Suggest` action. | Generation should help fill the current scenario draft, not silently create multiple saved scenarios or require per-subsection generation controls. |
| Remove top-level bulk `Generate scenarios` from performance mode. | Bulk creation does not match the expected workflow of `add a scenario -> suggest -> edit -> save -> run`. |
| Rename trigger-mode generation to `Generate candidates`. | Trigger description candidate generation is not scenario generation and should be labeled explicitly. |
| Disable run actions when there is no saved selected scenario. | Run should operate on a concrete saved scenario, not on an empty state or an unsaved draft. |
| Keep run history app-local in Promptfoo state. | Authored scenarios remain git-backed assets, while run history stays machine-local and operational. |

## Authored Model

The canonical authored model is:

```text
skill
  -> promptfoo package
    -> scenarios[]
      -> name
      -> prompt
      -> assertions[]
      -> performance: always true
      -> trigger: optional
      -> shouldTrigger: required only when trigger is enabled
```

This replaces the current authoring shape:

```text
skill
  -> scenarios[]
    -> cases[]
```

In the current implementation, what the app calls a `case` is effectively what the user expects to be a Promptfoo scenario. The design removes that mismatch by promoting the inner authored unit to the primary scenario contract.

## File Model

Each scenario remains a git-backed YAML file under the skill's eval directory:

```text
{skills_dir}/
  {plugin_slug}/
    evals/
      {skill_name}/
        regression.yaml
        routing-checks.yaml
```

The authored file shape becomes:

```yaml
name: Regression
performance: true
trigger: false
prompt: "Forecast next quarter revenue and call out assumptions."
assertions:
  - type: contains
    value: "assumptions"
```

If trigger is enabled:

```yaml
name: Pipeline routing checks
performance: true
trigger: true
should_trigger: true
prompt: "Show me pipeline coverage by stage for next quarter."
assertions:
  - type: contains
    value: "stage"
```

The exact YAML key naming can be normalized during implementation, but the design requirement is stable: one scenario file maps to one prompt plus one assertion set, with optional trigger metadata.

## UI Model

### Shared scenario list

Eval Workbench continues to show a scenario list for the selected skill. That list is shared across Performance and Trigger views.

Selection rules:

- when there are saved scenarios, the first valid scenario is auto-selected;
- when there are no saved scenarios, the editor opens in new-scenario draft state;
- run actions stay disabled until a saved scenario is selected.

### Scenario editor

The scenario editor owns one authored scenario at a time.

Fields:

- `Scenario name`
- `Performance` shown, always enabled, visually disabled
- `Trigger` optional checkbox
- `Should trigger` checkbox when trigger is enabled
- `Prompt`
- `Assertions`

Actions:

- `New scenario`
- `Suggest`
- `Save scenario`
- `Run scenario`

Removed actions:

- top-level `Generate scenarios`
- per-case `Suggest`
- separate `Expected outcome` field in the performance editor

### Trigger candidate generation

Trigger description optimization remains a separate workflow, but its label must be explicit:

- `Generate candidates`

That keeps scenario authoring distinct from description-candidate comparison.

## Suggest Behavior

`Suggest` is a scenario-level action that fills the current draft.

Inputs:

- skill identity;
- current scenario name, if present;
- current trigger setting;
- existing prompt or assertions when the user has already started editing;
- skill files and relevant app context already used by the Eval Workbench runtime.

Outputs:

- prompt text for the scenario;
- assertion objects for that scenario;
- optional trigger expectation guidance when trigger mode is enabled.

The action updates only the current draft. It does not create multiple scenarios, does not save automatically, and does not mutate unrelated scenarios.

## Runtime Boundary

The user-facing authoring model is simplified, but the broader runtime boundary remains the same:

- scenario files are the source of truth for authored eval assets;
- Rust/Tauri owns scenario CRUD, run preparation, and validation;
- the Promptfoo sidecar owns eval execution orchestration;
- app-local Promptfoo state owns run history;
- Refine remains the editing surface after evaluation.

The implementation may use compatibility adapters internally while migrating, but the active editor and command surface should expose only the simplified scenario model.

## Validation Rules

- `Scenario name` is required.
- `Performance` is always true.
- `Prompt` is required.
- At least one assertion is required before save or run.
- `Trigger` is optional.
- If `Trigger` is enabled, `shouldTrigger` is required.
- `Run scenario` is disabled until the selected scenario is saved and matches the current draft.

## Relationship To Prior Design Docs

This document replaces the following deleted design docs:

- `docs/design/eval-workbench-promptfoo-sidecar/README.md`
- `docs/design/eval-workbench-scenarios/README.md`
- `docs/design/eval-workbench-scenarios-remediation/README.md`

Those documents split runtime architecture, scenario storage, and remediation into separate artifacts. The active design now needs one canonical source because the main change is no longer just storage cleanup; it is a simpler end-to-end authored model that should drive UI, runtime, and generation behavior together.

## Key Source Files

| File | Purpose |
|---|---|
| `app/src/lib/eval-workbench.ts` | Shared frontend Eval Workbench types and validation helpers; currently still exposes `ScenarioCase` and `expectedOutcome`. |
| `app/src/components/workspace/workspace-evals.tsx` | Performance-mode editor and top-level generation/run controls. |
| `app/src/components/workspace/workspace-description.tsx` | Trigger-mode editor and description candidate generation flow. |
| `app/src/components/workspace/eval-workbench/prompt-set-editor.tsx` | Shared scenario editor UI; currently renders nested case editing. |
| `app/src/components/workspace/workspace-eval-workbench.tsx` | Shared scenario selection and tab wiring. |
| `app/src-tauri/src/commands/eval_workbench/mod.rs` | Tauri command surface for scenario CRUD, scenario generation, assertions generation, and eval execution. |

## Open Questions

1. `[implementation]` Whether the YAML contract should flatten to top-level `prompt` and `assertions` immediately or support a short-lived migration from the current `cases[]` file shape.
2. `[implementation]` Whether scenario-level `Suggest` should overwrite previously edited fields or only fill blanks.
