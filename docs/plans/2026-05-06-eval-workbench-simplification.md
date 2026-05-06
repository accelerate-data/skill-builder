# Eval Workbench Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Simplify Eval Workbench so each skill owns a set of Promptfoo-style scenarios, where each scenario has one prompt and one assertion set, `Performance` is always on, `Trigger` is optional, and generation is scenario-scoped rather than bulk-scoped.

**Architecture:** Replace the current `scenario -> cases[]` authoring model with a single-scenario contract exposed consistently through frontend types, Tauri commands, YAML storage, and Promptfoo run preparation. Keep the broader runtime boundary intact: git-backed scenario files, Rust-owned command layer, Promptfoo-sidecar execution, and app-local run history.

**Tech Stack:** React, TanStack Query, TypeScript, Tauri, Rust, serde/serde_yaml, Promptfoo sidecar, Vitest, cargo test, Playwright E2E.

**Design doc:** `docs/design/eval-workbench/README.md`

**Supersedes:** `docs/plans/2026-05-05-eval-workbench-scenarios.md` for the active authored-model work.

---

## File Structure

| File | Change |
|---|---|
| `app/src/lib/eval-workbench.ts` | Replace nested `ScenarioCase` editor model with a single-scenario contract and update validation helpers. |
| `app/src/lib/tauri-command-types.ts` | Update typed scenario command shapes if payloads change. |
| `app/src/lib/tauri-command-types.typecheck.ts` | Update compile-time command examples for the new scenario payloads. |
| `app/src/lib/queries/eval-scenarios.ts` | Keep query hooks aligned with the updated scenario contract. |
| `app/src/components/workspace/eval-workbench/prompt-set-editor.tsx` | Replace nested case UI with a single-scenario editor. |
| `app/src/components/workspace/workspace-evals.tsx` | Remove bulk generation, add scenario-level suggest, and disable run when no saved scenario exists. |
| `app/src/components/workspace/workspace-description.tsx` | Rename trigger generation to `Generate candidates` and keep trigger-specific scenario editing aligned. |
| `app/src/components/workspace/workspace-eval-workbench.tsx` | Keep selection and empty-state behavior aligned with the simplified editor. |
| `app/src-tauri/src/commands/eval_workbench/mod.rs` | Update scenario DTO conversion, generation, validation, and run preparation to the simplified authored model. |
| `app/src-tauri/src/commands/eval_workbench/scenarios.rs` | Update file-backed scenario types and YAML read/write helpers. |
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

## Task 2: Simplify the performance editor

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
- [ ] Disable `Run scenario` when there is no saved selected scenario.
- [ ] Preserve the existing dirty-draft protection so run still requires the saved scenario to match the current draft.

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
- [ ] Make the scenario-level `Suggest` action generate prompt text and assertion objects for the current draft.
- [ ] Ensure suggestion updates only the active draft and does not create or save multiple scenarios behind the scenes.
- [ ] Decide whether suggestion overwrites existing prompt/assertion content or fills only blanks, then implement that rule consistently.
- [ ] Remove dead frontend and backend paths that only supported bulk scenario generation.

## Task 5: Update run preparation and validation

**Files:**

- Modify: `app/src-tauri/src/commands/eval_workbench/mod.rs`
- Modify: any helper functions that translate scenarios into Promptfoo-sidecar cases
- Modify: `app/src/lib/eval-workbench.ts`

- [ ] Update run preparation so each saved scenario produces one Promptfoo scenario input from the simplified authored contract.
- [ ] Keep `Performance` always required.
- [ ] Require at least one assertion before save or run.
- [ ] Require `shouldTrigger` only when trigger is enabled.
- [ ] Preserve run history lookup by scenario identity and mode.
- [ ] Keep the current app-local Promptfoo history boundary intact.

## Task 6: Refresh tests around the simplified model

**Files:**

- Modify: `app/src/__tests__/components/workspace/workspace-evals.test.tsx`
- Modify: `app/src/__tests__/components/workspace/workspace-description.test.tsx`
- Modify: `app/src/__tests__/components/workspace/workspace-shell.test.tsx`
- Modify: `app/src/__tests__/lib/eval-workbench-tauri.test.ts`
- Modify: `app/e2e/evals/evals.spec.ts` if the visible performance flow changes

- [ ] Replace fixtures that currently depend on nested `cases[]` payloads.
- [ ] Add coverage that `Run scenario` is disabled when no saved scenario exists.
- [ ] Add coverage that performance mode no longer exposes bulk generation or per-case suggestion.
- [ ] Add coverage that scenario-level `Suggest` updates the current draft only.
- [ ] Add coverage that trigger mode uses `Generate candidates`.
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
