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
- each scenario has one prompt and one set of expectations;
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
- replacing the Promptfoo eval runtime or OpenHands runtime boundary.

## Key Decisions

| Decision | Rationale |
|---|---|
| Treat each authored scenario as a single Promptfoo scenario. | This matches the user's mental model and removes the extra `case` abstraction currently exposed in the UI and runtime contracts. |
| Remove nested authored `case` objects from the editor model. | The current `scenario -> many cases` shape behaves more like a grouped folder than a Promptfoo scenario and is the main source of UX confusion. |
| Keep `Performance` always enabled and visible, but disabled in the UI. | Performance evaluation is mandatory for every authored scenario, but the user should still see that it is part of the scenario contract. |
| Keep `Trigger` as an optional checkbox. | A scenario can be performance-only or performance-plus-trigger without requiring separate authored records. |
| Author expectations in plain business language. | Users should describe what the answer must explain or calculate, not low-level matcher syntax such as `contains` or `javascript`. |
| Evaluate one expectation per LLM judge rubric. | Separate model-graded checks give clear pass/fail reporting per business expectation and avoid one opaque scenario-level verdict. |
| Use one scenario-level `Suggest` action. | Generation should help fill the current scenario draft, not silently create multiple saved scenarios or require per-subsection generation controls. |
| Build suggestion prompts from a context envelope, not a short excerpt. | The LLM needs the canonical skill path, skill files, clarifications, and decisions so it can understand what the skill actually does before drafting scenarios. |
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
      -> expectations[]
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
expectations:
  - "Explains the assumptions behind the forecast."
  - "Distinguishes open pipeline from booked revenue."
```

If trigger is enabled:

```yaml
name: Pipeline routing checks
performance: true
trigger: true
should_trigger: true
prompt: "Show me pipeline coverage by stage for next quarter."
expectations:
  - "Explains pipeline coverage using stage-level logic."
  - "Calls out whether booked deals should be excluded from open pipeline."
```

The exact YAML key naming can be normalized during implementation, but the design requirement is stable: one scenario file maps to one prompt plus one expectation set, with optional trigger metadata.

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
- `Expectations`

Actions:

- `New scenario`
- `Suggest`
- `Delete scenario`
- `Evaluate`

Removed actions:

- top-level `Generate scenarios`
- per-case `Suggest`
- low-level assertion-type editing such as `contains` and `javascript`
- separate `Expected outcome` field in the performance editor

### Trigger candidate generation

Trigger description optimization remains a separate workflow, but its label must be explicit:

- `Generate candidates`

That keeps scenario authoring distinct from description-candidate comparison.

## Suggest Behavior

`Suggest` is a scenario-level action that fills the current draft.

Inputs:

- canonical skill path;
- workspace skill path when relevant;
- skill files;
- clarifications when present;
- decisions when present;
- current scenario name;
- current trigger setting;
- existing prompt and expectations for overwrite-aware regeneration.

Outputs:

- prompt text for the scenario;
- plain-language expectations for that scenario;
- optional trigger expectation guidance when trigger mode is enabled.

The action overwrites the current scenario's prompt and expectations, persists through Rust, and reloads the saved scenario in the UI. It does not create multiple scenarios and does not mutate unrelated scenarios.

## Evaluation Model

Authoring stays in user-readable language, but execution is model-graded.

```text
Scenario
  -> prompt
  -> expectations[]
     -> expectation 1 -> Promptfoo llm-rubric assertion
     -> expectation 2 -> Promptfoo llm-rubric assertion
     -> expectation 3 -> Promptfoo llm-rubric assertion
```

This means:

- one skill owns one eval package;
- that package can contain multiple scenarios;
- each scenario can contain multiple expectations;
- each expectation is judged independently.

Why this shape:

- users can write business expectations they understand;
- run results can show exactly which expectation passed or failed;
- the UI no longer needs to expose low-level matcher syntax.

## Runtime Boundary

The user-facing authoring model is simplified, but the broader runtime boundary remains the same:

- scenario files are the source of truth for authored eval assets;
- Rust/Tauri owns scenario CRUD, run preparation, and validation;
- the Promptfoo eval runtime owns eval execution orchestration and translates expectations into one `llm-rubric` per expectation;
- app-local Promptfoo state owns run history;
- Refine remains the editing surface after evaluation.

The implementation may use compatibility adapters internally while migrating, but the active editor and command surface should expose only the simplified scenario model.

## Validation Rules

- `Scenario name` is required.
- `Performance` is always true.
- `Prompt` is required.
- At least one expectation is required before save or run.
- `Trigger` is optional.
- If `Trigger` is enabled, `shouldTrigger` is required.
- `Evaluate` is disabled until at least one saved scenario exists.

## Relationship To Prior Design Docs

This document replaces the following deleted design docs:

- legacy Promptfoo execution design doc
- `docs/design/eval-workbench-scenarios/README.md`
- `docs/design/eval-workbench-scenarios-remediation/README.md`

Those documents split runtime architecture, scenario storage, and remediation into separate artifacts. The active design now needs one canonical source because the main change is no longer just storage cleanup; it is a simpler end-to-end authored model that should drive UI, runtime, and generation behavior together.

## Key Source Files

| File | Purpose |
|---|---|
| `app/src/lib/eval-workbench.ts` | Shared frontend Eval Workbench types and validation helpers; should expose prompt plus expectations and trigger state only. |
| `app/src/components/workspace/workspace-evals.tsx` | One-tab Eval Workbench shell with scenario-level suggestion and run controls. |
| `app/src/components/workspace/eval-workbench/prompt-set-editor.tsx` | Shared one-scenario editor UI for prompt, expectations, and trigger state. |
| `app/src/components/workspace/workspace-eval-workbench.tsx` | Shared scenario selection and tab wiring for the one-tab surface. |
| `app/src-tauri/src/commands/eval_workbench/mod.rs` | Tauri command surface for scenario CRUD, context-envelope suggestion, expectation-to-rubric translation, and eval execution. |

## Open Questions

1. `[implementation]` Whether the YAML contract should flatten to top-level `prompt` and `expectations` immediately or support a short-lived migration from the current `cases[]` file shape.
