---
functional-specs: [custom-plugin-management]
---

# Eval Workbench Scenarios Remediation

> **Status:** Draft
> **Related issue:** `VU-1161`
> **Supersedes for this gap:** `docs/design/eval-workbench-scenarios/README.md` where it conflicts with the implementation plan or current code

## Overview

`VU-1161` is intended to replace Eval Workbench prompt sets with git-backed
scenario files, share those scenarios across Performance and Trigger modes, and
keep run history in app-owned Promptfoo state. The current worktree only
partially reaches that design. It adds scenario files and shared UI state, but
it still mirrors scenarios into SQLite prompt-set tables, still anchors runs
and candidate flows to `prompt_set_id`, and currently has a broken frontend
contract for `load_scenario`.

This document describes how to close those gaps without changing the user-level
intent of `VU-1161`.

## Design Scope

**Covers**

- Repairing the incomplete scenario command surface.
- Removing the hybrid file-plus-SQLite prompt-set model.
- Defining the app-owned Promptfoo history boundary for Eval Workbench.
- Preserving current Performance and Trigger UX while replacing hidden storage
  dependencies.
- Sequencing the remediation so verification can go green incrementally.

**Does not cover**

- Changes to the repo-owned `tests/evals` harness.
- Cross-machine sync of Promptfoo history.
- New end-user workflow behavior beyond what `VU-1161` already intends.
- Broader Promptfoo sidecar redesign outside Eval Workbench.

## Verified Gaps

| Gap | Current state | Required end state |
|---|---|---|
| Frontend type contract | `workspace-eval-workbench.tsx` passes `scenarioLoading` to child components that do not accept it. | Frontend props and call sites compile cleanly. |
| Scenario detail loading | TypeScript wrappers call `load_scenario`, but Rust does not implement or register that command. | `load_scenario` exists as a real Tauri command backed by scenario files. |
| Authored scenario storage | `save_scenario` writes YAML and also mirrors into `eval_prompt_sets`. | Authored scenarios live only on disk. |
| Run preparation | `run_eval_workbench` reads the YAML file but still resolves the runnable data through mirrored prompt sets. | Runs are prepared directly from the selected scenario file. |
| Run history | Eval Workbench still records and reads runs through SQLite tables keyed by `prompt_set_id`. | Eval Workbench reads app-owned Promptfoo persisted state under `<data_dir>/promptfoo`. |
| Trigger candidate ownership | Description candidates are tied to draft/completed SQLite runs and validated against prompt-set ownership. | Candidate ownership is tied to scenario identity and mode, not mirrored prompt-set rows. |
| Contract traceability | The original scenario design doc still says SQLite retains run history and keeps some prompt-set-era framing. | Design docs, implementation plan, and issue all describe the same architecture. |

## Target Design

### 1. Authored content boundary

Scenario YAML files under `{plugin}/evals/{skill_name}/` are the only source of
truth for authored Eval Workbench content:

- scenario name
- mode tags
- case prompts
- expected outcomes
- trigger expectations
- assertions

The app may cache scenario summaries in memory on the frontend, but it must not
persist a second authored copy in SQLite.

### 2. Command boundary

The scenario command surface is file-native and complete:

- `list_scenarios(pluginSlug, skillName)` returns lightweight summaries
- `load_scenario(pluginSlug, skillName, scenarioName)` returns full scenario
  detail from disk
- `save_scenario(pluginSlug, skillName, scenario)` writes exactly one YAML file
- `delete_scenario(pluginSlug, skillName, scenarioName)` deletes exactly one
  YAML file

These commands do not touch `eval_prompt_sets` or `eval_prompt_cases`.

### 3. Run preparation boundary

`run_eval_workbench` reads the selected scenario file from disk, filters cases
for the chosen mode, and constructs the Promptfoo sidecar request in memory.

The run path must not require:

- a mirrored prompt-set row
- a `prompt_set_id`
- a resave step before a git-synced scenario becomes runnable

This preserves the core portability goal: a scenario committed on one machine
is runnable on another machine as soon as the skill repo syncs locally.

### 4. Run history boundary

Eval Workbench run history is owned by the app-local Promptfoo persistence area
under `<data_dir>/promptfoo`.

The workbench may still maintain app-level metadata that is operational rather
than authored, but it must not treat the SQLite `eval_workbench` tables as the
authoritative history store for this flow. In practice:

- history can be empty on a fresh machine even when scenarios are present
- deleting a scenario removes authored visibility, not historical files owned by
  Promptfoo
- repo engineering evals under `tests/evals` remain separate and invisible to
  the app workbench

### 5. Trigger candidate boundary

Trigger-mode description candidates currently depend on draft/completed SQLite
runs and prompt-set ownership checks. That creates the same hidden coupling that
the scenario migration is trying to remove.

The remediation design changes candidate ownership to scenario identity:

- candidate generation is initiated for a `(pluginSlug, skillName, scenarioName)`
  tuple
- candidate metadata records scenario name and mode instead of `prompt_set_id`
- candidate validation checks that tuple when applying or comparing candidates

This keeps the trigger workflow scoped correctly without reintroducing prompt
set mirrors as a hidden source of truth.

## Chosen Remediation

The remediation for `VU-1161` is a full clean break. The implementation must
remove prompt-set mirrors, move active workbench history to app-owned Promptfoo
state, and retarget trigger candidate ownership at scenario identity.

This section defines the specific design to implement.

### What is removed

The clean break removes these concepts from the active Eval Workbench scenario
path:

- scenario mirroring into `eval_prompt_sets`
- mode-specific authored storage in `eval_prompt_cases`
- run ownership through `eval_runs.prompt_set_id`
- candidate ownership checks that depend on `db_read_eval_prompt_set`
- save/delete side effects that mutate authored state in SQLite

These code paths must be removed from the active codebase for this feature.
This remediation assumes a dev-only branch and does not preserve legacy prompt
set compatibility.

### What replaces it

The clean break introduces four explicit runtime boundaries:

1. `ScenarioStore`
   - Backed by YAML files in `{plugin}/evals/{skill_name}/`
   - Owns list, load, save, delete, and validation
   - Returns scenario summaries for lists and full scenarios for detail views

2. `ScenarioRunBuilder`
   - Accepts `(pluginSlug, skillName, scenarioName, mode)`
   - Loads the scenario file from `ScenarioStore`
   - Filters cases for the selected mode
   - Builds the in-memory Promptfoo sidecar request
   - Never consults SQLite prompt-set rows

3. `WorkbenchHistoryStore`
   - Backed by app-owned Promptfoo persisted state under `<data_dir>/promptfoo`
   - Owns `list_eval_runs` and `read_eval_run` for scenario mode
   - Returns empty history when no local Promptfoo state exists

4. `ScenarioCandidateStore`
   - Owns trigger-description candidates and refine-brief lookup metadata
   - Keys records by scenario identity instead of `prompt_set_id`
   - May use a reduced app-owned SQLite table if app-local persistence is still
     needed, but that table must not duplicate authored scenario content

### Scenario identity

Under this design, every active Eval Workbench flow resolves around scenario
identity, not prompt-set identity.

The canonical identity tuple is:

```text
(plugin_slug, skill_name, scenario_name)
```

Mode is operational input, not authored identity. A scenario may support one or
both modes through tags.

This identity is used for:

- loading scenario detail
- validating trigger candidate ownership
- associating local run history entries returned from Promptfoo state
- building Refine improvement briefs

### Scenario summary vs detail contract

This design keeps the split introduced in the current worktree, but makes it
real:

- `list_scenarios` returns summary records:
  - `name`
  - `tags`
- `load_scenario` returns the full scenario:
  - `name`
  - `tags`
  - `cases[]`

The summary/detail split is required so the shared selector can stay fast
without forcing the app to eagerly read every case body and assertion list.

### File-native run preparation

`run_eval_workbench` must use this sequence:

1. Validate `(runId, pluginSlug, skillName, scenarioName, mode, candidateIds)`
2. Load the scenario from disk
3. Reject the run if the scenario tags do not allow the requested mode
4. Convert file-backed cases into mode-specific Promptfoo cases:
   - Performance mode uses `prompt`, `expected_outcome`, and assertions
   - Trigger mode uses `prompt`, `should_trigger`, and candidate descriptions
5. Execute the Promptfoo sidecar run
6. Persist or expose history through `WorkbenchHistoryStore`

The current intermediary step:

```text
scenario_name -> prompt_set_id -> db_read_eval_prompt_set(...)
```

is removed entirely.

### History model

Promptfoo persisted state is the active history system for Eval Workbench.

The app-level history adapter should expose a normalized view shaped around the
existing frontend `EvalRun` contract so the UI does not need a second refactor
at the same time as the storage break:

- `id`
- `scenarioName`
- `mode`
- `status`
- `summary`
- `createdAt`
- `completedAt`
- `results`
- `descriptionCandidates`

The source of those fields changes, but the frontend contract should stay
stable where possible.

If Promptfoo persisted state does not currently contain enough metadata to
recover `scenarioName` or candidate context, the clean-break implementation must
write a companion app-local metadata record keyed by run id. That metadata may
live in SQLite, but only for operational history lookup. It must not restore
prompt-set mirroring or duplicate authored scenario cases.

### Candidate persistence

Trigger description candidates are app-local operational state, not authored
scenario state. This design keeps them app-local but rewrites their ownership
model.

The replacement metadata record is:

```text
candidate_id
run_id
plugin_slug
skill_name
scenario_name
mode = trigger
label
description
rationale
rank
created_at
```

Key properties:

- candidates belong to a scenario identity tuple
- candidates can be validated without loading a mirrored prompt set
- applying a candidate verifies `(plugin_slug, skill_name, scenario_name)`
- refine-brief generation can still recover candidate context for the run

### No legacy compatibility

This design does not preserve prompt-set-era compatibility.

Required:

- remove prompt-set mirroring code
- remove active reads from mirrored prompt sets
- remove prompt-set-based deletion side effects
- remove candidate validation paths that require prompt-set lookup

Not allowed:

- one-time import logic in the active scenario runtime
- isolated legacy adapters kept in the command path
- auto-recreating prompt-set mirrors during `save_scenario`
- reading mirrored prompt sets during `run_eval_workbench`
- using prompt-set deletion as part of normal scenario deletion

### Recommended implementation sequence

The remediation should be delivered in this order:

1. Fix the compile break and add/register `load_scenario`
2. Land `ScenarioStore` as the only authored-content path
3. Rewrite `run_eval_workbench` around `ScenarioRunBuilder`
4. Move history reads to `WorkbenchHistoryStore`
5. Rewrite trigger candidates around `ScenarioCandidateStore`
6. Remove leftover prompt-set-era code

That order keeps the branch runnable while preventing a partial cleanup from
reintroducing the hybrid model.

## Migration Plan

### Phase 1: Restore a valid command and UI contract

Purpose: get the branch back to a truthful, compilable state before deeper
storage changes.

- Add `scenarioLoading` to the relevant component props, or remove those props
  if the loading state is rendered only in the parent.
- Implement and register `load_scenario` in Rust.
- Keep `list_scenarios` returning summaries and `load_scenario` returning full
  scenario detail.
- Extend command-surface tests so the new command is verified against the typed
  wrapper and the real Tauri registry.

### Phase 2: Remove authored-scenario mirroring

Purpose: eliminate the second source of truth.

- Delete `save_prompt_set_mirror_for_scenario`.
- Remove prompt-set deletion side effects from `save_scenario` and
  `delete_scenario`.
- Stop relying on `eval_prompt_sets` and `eval_prompt_cases` for new scenario
  flows.
- Remove the legacy prompt-set path entirely.

### Phase 3: Run directly from scenario files

Purpose: make git-backed scenarios independently runnable.

- Introduce a file-native run-preparation helper that converts
  `Scenario -> mode-filtered cases -> sidecar request`.
- Use that helper in both Performance and Trigger runs.
- Replace `prompt_set_id`-based ownership checks with scenario identity checks.
- Add regression tests for a fresh DB plus existing scenario files.

### Phase 4: Move history reads to Promptfoo persisted state

Purpose: align the runtime with the plan’s machine-local history model.

- Add a Promptfoo-history adapter that reads the app-owned persisted state under
  `<data_dir>/promptfoo`.
- Update `list_eval_runs` and `read_eval_run` to source from that adapter for
  Eval Workbench history.
- Keep any remaining SQLite records out of the active read path for this
  feature.
- Ensure missing Promptfoo history produces an empty history state, not an
  error.
- If Promptfoo state alone cannot reconstruct the current `EvalRun` shape,
  introduce a minimal run-metadata adapter keyed by run id rather than falling
  back to prompt-set tables.

### Phase 5: Retarget trigger candidate lifecycle

Purpose: preserve Trigger-mode features after prompt-set removal.

- Store candidate metadata against scenario identity and mode.
- Update generation, comparison, apply, and refine-brief paths to resolve that
  identity without prompt-set joins.
- Add tests that prove candidates remain valid across scenario loads and on a
  fresh DB.
- Do not persist scenario cases, tags, or other authored data in the candidate
  store.

### Phase 6: Realign documentation and issue contract

Purpose: remove ambiguity for future work.

- Update `docs/design/eval-workbench-scenarios/README.md` so it no longer says
  SQLite is the active run-history system for this flow.
- Keep this remediation doc and the implementation plan consistent.
- Update the Linear issue only if its acceptance criteria still imply the old
  hybrid design.

## Architecture Changes

### Current runtime shape

```text
scenario YAML -> save_scenario -> YAML file + mirrored eval_prompt_sets row
run_eval_workbench -> scenario file lookup -> prompt_set_id lookup -> SQLite prompt set -> sidecar run
history/candidates -> SQLite eval_runs + description_candidates
```

### Target runtime shape

```text
ScenarioStore -> YAML files only
ScenarioRunBuilder -> file-backed scenario -> in-memory mode filtering -> sidecar run
WorkbenchHistoryStore -> app-owned Promptfoo persisted state under <data_dir>/promptfoo
ScenarioCandidateStore -> scenario-scoped operational metadata without prompt_set_id ownership
```

## Key Source Files

| File | Purpose |
|---|---|
| `app/src-tauri/src/commands/eval_workbench/mod.rs` | Current hybrid command layer; primary remediation target |
| `app/src-tauri/src/commands/eval_workbench/scenarios.rs` | File-backed scenario model and helpers |
| `app/src-tauri/src/db/eval_workbench.rs` | Legacy prompt-set and SQLite run helpers that must be reduced or bypassed |
| `app/src-tauri/src/db/migrations.rs` | Existing `eval_workbench` schema; useful for identifying leftover coupling |
| `app/src-tauri/src/lib.rs` | Tauri command registration surface |
| `app/src/lib/eval-workbench.ts` | Frontend command wrappers and scenario helpers |
| `app/src/lib/queries/eval-scenarios.ts` | Scenario summary/detail query model |
| `app/src/components/workspace/workspace-eval-workbench.tsx` | Shared scenario selector and mode shell |
| `app/src/components/workspace/workspace-evals.tsx` | Performance-mode editing and execution |
| `app/src/components/workspace/workspace-description.tsx` | Trigger-mode editing and candidate workflow |
| `docs/design/eval-workbench-scenarios/README.md` | Original scenario design doc that now needs contract cleanup |
| `docs/plans/2026-05-05-eval-workbench-scenarios.md` | Canonical implementation plan for the clean-break target |

## Verification Strategy

The remediation is complete only when all of these are true:

- `cd app && npx tsc --noEmit` passes
- `cd app && cargo test --manifest-path src-tauri/Cargo.toml commands::eval_workbench` passes
- `cd app && npx vitest run src/__tests__/lib/eval-workbench-tauri.test.ts` passes
- `cd app && npm run test:unit` passes
- `cd app && bash tests/run.sh e2e --tag @evals` passes
- `cd app && bash tests/run.sh e2e --tag @description` passes

Required regression coverage:

- scenario detail loads through the real Tauri command surface
- a disk-backed scenario runs on a fresh DB without any mirror row
- deleting or retagging a scenario does not corrupt local history access
- shared scenario selection survives tab switches when valid
- invalid tab switches fall back to the first visible scenario
- trigger candidates remain scoped to the selected scenario without
  `prompt_set_id`

## Open Questions

1. Where should scenario-scoped description candidates persist after
   `prompt_set_id` removal: Promptfoo-owned metadata, a reduced app table keyed
   by scenario identity, or ephemeral files under app data?
2. Should run-history companion metadata live in the existing app DB or in a
   separate app-local store beside Promptfoo persisted state?
