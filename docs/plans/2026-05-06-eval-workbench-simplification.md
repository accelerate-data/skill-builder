# Eval Workbench Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Simplify Eval Workbench so each skill owns a set of Promptfoo-style scenarios, where each scenario has one prompt and one assertion set, `Performance` is always on, `Trigger` is optional, and generation is scenario-scoped rather than bulk-scoped.

**Persistence contract:** `Add scenario` creates and persists a real scenario record immediately. `Suggest` calls Rust, Rust generates prompt plus assertions for that one scenario, persists the result, and the UI reloads the saved scenario. After a scenario exists, UI edits autosave. There is no explicit `Save scenario` action. `Evaluate` runs the full package, not a single selected scenario.

**Architecture:** Replace the current `scenario -> cases[]` authoring model with a single-scenario contract exposed consistently through frontend types, Tauri commands, YAML storage, and Promptfoo run preparation. Keep the broader runtime boundary intact: git-backed scenario files, Rust-owned command layer, Promptfoo-sidecar execution, and app-local run history.

**Tech Stack:** React, TanStack Query, TypeScript, Tauri, Rust, serde/serde_yaml, Promptfoo sidecar, Vitest, cargo test, Playwright E2E.

**Design doc:** `docs/design/eval-workbench/README.md`

**Supersedes:** `docs/plans/2026-05-05-eval-workbench-scenarios.md` for the active authored-model work.

**Follow-up scope for this branch:** finish the scenario-level authoring flow by exposing scenario deletion in the UI, replacing bulk generation with persisted single-scenario suggestion, removing explicit save in favor of autosaved edits on persisted scenarios, and changing evaluation from selected-scenario run to package-level execution.

---

## File Structure

| File | Change |
|---|---|
| `app/src/lib/eval-workbench.ts` | Replace nested `ScenarioCase` editor model with a single-scenario contract, add single-scenario suggestion, autosave helpers, and update package-level evaluation request types. |
| `app/src/lib/tauri-command-types.ts` | Update typed scenario command shapes if payloads change. |
| `app/src/lib/tauri-command-types.typecheck.ts` | Update compile-time command examples for the new scenario payloads. |
| `app/src/lib/queries/eval-scenarios.ts` | Keep query hooks aligned with the updated scenario contract. |
| `app/src/components/workspace/eval-workbench/prompt-set-editor.tsx` | Replace nested case UI with a single-scenario editor. |
| `app/src/components/workspace/workspace-evals.tsx` | Remove bulk generation, add persisted scenario-level suggest, remove explicit save, autosave edits, and switch to package-level Evaluate. |
| `app/src/components/workspace/workspace-description.tsx` | Rename trigger generation to `Generate candidates` and keep trigger-specific scenario editing aligned. |
| `app/src/components/workspace/workspace-eval-workbench.tsx` | Keep selection and empty-state behavior aligned with the simplified editor. |
| `app/src-tauri/src/commands/eval_workbench/mod.rs` | Update scenario DTO conversion, prompt loading, single-scenario suggestion, autosave persistence hooks, generation, validation, and package-level run preparation. |
| `app/src-tauri/src/commands/eval_workbench/scenarios.rs` | Update file-backed scenario types and YAML read/write helpers. |
| `agent-sources/prompts/**` | Add the externalized single-scenario suggest prompt. |
| `app/src/__tests__/components/workspace/*.test.tsx` | Update editor and button-behavior coverage. |
| `app/src/__tests__/lib/eval-workbench-tauri.test.ts` | Update wrapper expectations for the revised scenario payloads. |
| `app/e2e/evals/evals.spec.ts` | Update mocked performance-mode coverage if UI flows change materially. |
| `docs/design/README.md` | Point the design index at the consolidated eval-workbench doc. |

## Task 1: Consolidate the scenario contract

**Files:**

- Modify: `app/src/lib/eval-workbench.ts`
- Modify: `app/src/lib/tauri-command-types.ts`
- Modify: `app/src/lib/tauri-command-types.typecheck.ts`
- Modify: `app/src-tauri/src/commands/eval_workbench/mod.rs`
- Modify: `app/src-tauri/src/commands/eval_workbench/scenarios.rs`

- [ ] Replace the active frontend `Scenario` shape so one scenario owns one prompt and one assertion set rather than `cases[]`.
- [ ] Remove `ScenarioCase` as an authored editor concept from the shared frontend types.
- [ ] Remove `expectedOutcome` from the user-facing scenario contract and keep assertions as the single evaluation surface.
- [ ] Keep trigger-specific state on the scenario itself rather than on nested cases.
- [ ] Update DTO conversion and validation in the Rust command layer to accept and emit the simplified scenario contract.
- [ ] Update YAML load/save helpers so one file maps directly to one scenario prompt and assertion set.
- [ ] Decide whether a compatibility migration is needed for existing `cases[]` files and document the exact behavior in code comments if so.

## Task 2: Simplify the performance editor and persistence flow

**Files:**

- Modify: `app/src/components/workspace/eval-workbench/prompt-set-editor.tsx`
- Modify: `app/src/components/workspace/workspace-evals.tsx`
- Modify: `app/src/components/workspace/workspace-eval-workbench.tsx`

- [ ] Remove nested case rendering from the shared editor UI.
- [ ] Keep `Performance` visible but disabled/greyed and always enabled in the draft.
- [ ] Keep `Trigger` as an optional checkbox.
- [ ] Show `Should trigger` only when trigger is enabled.
- [ ] Replace the current top-level `Generate scenarios` action with one scenario-level `Suggest` action.
- [ ] Remove per-case `Suggest` controls.
- [ ] Remove the separate `Expected outcome` editor field.
- [ ] Add a scenario-level delete affordance for persisted scenarios and keep selection state consistent after delete.
- [ ] Move the performance-mode `Suggest` action into the scenario editor so the flow is `Add scenario -> Suggest -> edit -> autosave`.
- [ ] Remove the explicit `Save scenario` action from the performance editor.
- [ ] Make `New scenario` create and persist a real scenario immediately instead of only creating a local draft.
- [ ] Make prompt, trigger, and assertion edits autosave after the scenario exists.
- [ ] Show a busy pointer/spinner affordance while `Suggest` is in flight.

## Task 3: Keep trigger-mode generation explicit

**Files:**

- Modify: `app/src/components/workspace/workspace-description.tsx`
- Modify: any shared button labels or helper constants used by trigger mode

- [ ] Rename trigger-mode generation controls from generic `Generate` wording to `Generate candidates`.
- [ ] Keep trigger description candidate generation separate from scenario authoring generation.
- [ ] Ensure the trigger view uses the same simplified scenario payload as performance mode.
- [ ] Keep current compare/apply/refine behavior unchanged unless it depends on removed nested-case fields.

## Task 4: Rework scenario-level suggestion

**Files:**

- Modify: `app/src/components/workspace/workspace-evals.tsx`
- Modify: `app/src-tauri/src/commands/eval_workbench/mod.rs`
- Modify: frontend wrappers in `app/src/lib/eval-workbench.ts` if the request/response shape changes

- [ ] Replace the bulk `generate_scenarios` workflow with a scenario-scoped suggestion workflow.
- [ ] Make the scenario-level `Suggest` action generate prompt text and assertion objects for one persisted scenario.
- [ ] Ensure suggestion persists the active scenario through Rust and reloads the saved scenario instead of mutating only a local draft.
- [ ] Use a single-scenario response shape, not a top-level `scenarios[]` bulk response.
- [ ] Remove dead frontend and backend paths that only supported bulk scenario generation.
- [ ] Externalize the suggest prompt into `agent-sources/prompts/` and stop hardcoding it in Rust.
- [ ] Replace the current invalid-JSON failure with a clearer scenario-suggestion error path that includes enough response context to debug malformed structured output.
- [ ] Tighten the parser so malformed structured output is rejected deterministically and mapped to a user-facing suggestion error.

## Task 5: Update run preparation and validation

**Files:**

- Modify: `app/src-tauri/src/commands/eval_workbench/mod.rs`
- Modify: any helper functions that translate scenarios into Promptfoo-sidecar cases
- Modify: `app/src/lib/eval-workbench.ts`

- [ ] Update run preparation so each saved scenario produces one Promptfoo scenario input from the simplified authored contract.
- [ ] Change performance-mode execution from selected-scenario run to package-level evaluation across all saved scenarios.
- [ ] Keep `Performance` always required.
- [ ] Require at least one assertion before persisted suggestion completion or package evaluation.
- [ ] Require `shouldTrigger` only when trigger is enabled.
- [ ] Preserve run history lookup by scenario identity and mode even when one Evaluate action runs the package.
- [ ] Keep the current app-local Promptfoo history boundary intact.

## Task 6: Refresh tests around the simplified model

**Files:**

- Modify: `app/src/__tests__/components/workspace/workspace-evals.test.tsx`
- Modify: `app/src/__tests__/components/workspace/workspace-description.test.tsx`
- Modify: `app/src/__tests__/components/workspace/workspace-shell.test.tsx`
- Modify: `app/src/__tests__/lib/eval-workbench-tauri.test.ts`
- Modify: `app/e2e/evals/evals.spec.ts` if the visible performance flow changes

- [ ] Replace fixtures that currently depend on nested `cases[]` payloads.
- [ ] Add coverage that there is no explicit `Save scenario` button.
- [ ] Add coverage that `New scenario` persists immediately.
- [ ] Add coverage that prompt/assertion edits autosave after persistence.
- [ ] Add coverage that performance mode no longer exposes bulk generation or per-case suggestion.
- [ ] Add coverage that scenario-level `Suggest` persists and reloads exactly one scenario.
- [ ] Add coverage that performance mode exposes `Suggest` from the scenario editor, not the workbench header.
- [ ] Add coverage that deleting a saved scenario updates the list and selected scenario state correctly.
- [ ] Add coverage for malformed scenario-suggestion responses so the surfaced error is actionable.
- [ ] Add coverage that `Suggest` shows a busy affordance while it is running.
- [ ] Add coverage that trigger mode uses `Generate candidates`.
- [ ] Add coverage that the primary performance action is `Evaluate`, not `Run scenario`.
- [ ] Add coverage that `Evaluate` invokes package-level execution rather than passing a single scenario name.
- [ ] Keep existing run-history and selected-scenario regression coverage green after the model change.

## Task 7: Final documentation sync

**Files:**

- Modify: `docs/design/README.md`
- Modify: `docs/design/eval-workbench/README.md` if implementation choices require clarifications
- Optionally modify: `docs/plans/2026-05-05-eval-workbench-scenarios.md` only if a deprecation note is needed

- [ ] Keep `docs/design/README.md` aligned with the new single eval-workbench design doc.
- [ ] Ensure implementation does not leave references to the deleted design docs in active documentation.
- [ ] If the older implementation plan remains in-tree, mark it as superseded rather than silently leaving two active-looking plans.

## Validation

- [ ] `npx markdownlint-cli2 docs/design/eval-workbench/README.md docs/design/README.md docs/plans/2026-05-06-eval-workbench-simplification.md`
- [ ] `cd app && npx vitest run src/__tests__/lib/eval-workbench-tauri.test.ts src/__tests__/components/workspace/workspace-evals.test.tsx src/__tests__/components/workspace/workspace-description.test.tsx src/__tests__/components/workspace/workspace-shell.test.tsx`
- [ ] `cd app && npm run test:unit`
- [ ] `cd app && cargo test --manifest-path src-tauri/Cargo.toml commands::eval_workbench`
- [ ] `cd app && npx tsc --noEmit`
- [ ] `cd app && npm run test:e2e -- --grep @evals`
