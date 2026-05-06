# Eval Workbench Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Simplify Eval Workbench so each skill owns one performance eval package with multiple scenarios, each scenario has one prompt plus multiple user-readable expectations, each expectation is judged independently, generation is scenario-scoped rather than bulk-scoped, scenario authoring uses an accordion-style `Scenarios` section, and evaluation history plus details live in one master-detail `Results` section.

**Persistence contract:** `Add scenario` creates and persists a real scenario record immediately. `Suggest` calls Rust, Rust builds a context envelope from all available skill context, generates scenario name plus prompt plus expectations for that one scenario, overwrites the saved scenario content, and the UI reloads it. After a scenario exists, UI edits autosave. There is no explicit `Save scenario` action. `Evaluate` runs the full package.

**Architecture:** Replace the current `scenario -> cases[]` authoring model and low-level matcher assertions with a single-scenario contract exposed consistently through frontend types, Tauri commands, YAML storage, and Promptfoo run preparation. Author scenarios in business-readable expectations, then compile each expectation into one Promptfoo `llm-rubric` assertion at runtime. Keep the broader runtime boundary intact: git-backed scenario files, Rust-owned command layer, Promptfoo-sidecar execution, and app-local run history. Remove trigger-mode authoring from Eval Workbench and keep the screen focused on performance evaluation only.

**Tech Stack:** React, TanStack Query, TypeScript, Tauri, Rust, serde/serde_yaml, Promptfoo sidecar, Vitest, cargo test, Playwright E2E.

**Design doc:** `docs/design/eval-workbench/README.md`

**Supersedes:** `docs/plans/2026-05-05-eval-workbench-scenarios.md` for the active authored-model work.

**Follow-up scope for this branch:** finish the scenario-level authoring flow by exposing scenario deletion in the UI, replacing bulk generation with persisted single-scenario suggestion, removing explicit save in favor of autosaved edits on persisted scenarios, changing evaluation to package-level execution, removing trigger-mode affordances from Eval Workbench, moving to an accordion-based scenario list with inline expansion, and consolidating run history plus selected-run detail into one `Results` section.

---

## File Structure

| File | Change |
|---|---|
| `app/src/lib/eval-workbench.ts` | Replace nested `ScenarioCase` editor model and low-level assertions with a single-scenario prompt-plus-expectations contract, add single-scenario suggestion, autosave helpers, and update package-level evaluation request types. |
| `app/src/lib/tauri-command-types.ts` | Update typed scenario command shapes if payloads change. |
| `app/src/lib/tauri-command-types.typecheck.ts` | Update compile-time command examples for the new scenario payloads. |
| `app/src/lib/queries/eval-scenarios.ts` | Keep query hooks aligned with the updated scenario contract. |
| `app/src/components/workspace/eval-workbench/prompt-set-editor.tsx` | Replace nested case UI and low-level matcher editing with a single-scenario prompt-plus-expectations editor, including per-expectation delete. |
| `app/src/components/workspace/workspace-evals.tsx` | Remove bulk generation, add persisted scenario-level suggest, remove explicit save, autosave edits, switch to package-level Evaluate, and restructure the page into `Scenarios` plus `Results`. |
| `app/src/components/workspace/workspace-description.tsx` | Remove trigger-mode eval authoring from the active Eval Workbench surface or route it out of the screen entirely if it is retained elsewhere. |
| `app/src/components/workspace/workspace-eval-workbench.tsx` | Remove mode switching from Eval Workbench, keep empty-state behavior aligned with the accordion-first authoring flow, and remove obsolete selected-scenario assumptions. |
| `app/src/components/workspace/eval-workbench/**` | Add or refactor shared accordion row and results master-detail UI helpers as needed. |
| `app/src-tauri/src/commands/eval_workbench/mod.rs` | Update scenario DTO conversion, context-envelope prompt loading, single-scenario suggestion, autosave persistence hooks, expectation-to-rubric translation, validation, and package-level run preparation. |
| `app/src-tauri/src/commands/eval_workbench/scenarios.rs` | Update file-backed scenario types and YAML read/write helpers. |
| `agent-sources/prompts/**` | Replace the externalized single-scenario suggest prompt with a richer skill-grounded expectations prompt. |
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

- [ ] Replace the active frontend `Scenario` shape so one scenario owns one prompt and one expectation set rather than `cases[]`.
- [ ] Remove `ScenarioCase` as an authored editor concept from the shared frontend types.
- [ ] Remove `expectedOutcome` and low-level authored assertion objects from the user-facing scenario contract.
- [ ] Add `expectations: string[]` as the user-authored evaluation surface.
- [ ] Update DTO conversion and validation in the Rust command layer to accept and emit the simplified scenario contract.
- [ ] Update YAML load/save helpers so one file maps directly to one scenario prompt and expectation set.
- [ ] Remove authored trigger-only fields from the eval-workbench scenario contract exposed to the UI.
- [ ] Decide whether a compatibility migration is needed for existing `cases[]` files and document the exact behavior in code comments if so.

## Task 2: Rebuild scenario authoring around accordion rows

**Files:**

- Modify: `app/src/components/workspace/eval-workbench/prompt-set-editor.tsx`
- Modify: `app/src/components/workspace/workspace-evals.tsx`
- Modify: `app/src/components/workspace/workspace-eval-workbench.tsx`
- Modify: `app/src/components/workspace/eval-workbench/**` as needed for shared accordion helpers

- [ ] Remove nested case rendering from the shared editor UI.
- [ ] Remove the `Performance` / `Trigger` mode system from the eval-workbench authoring UI.
- [ ] Remove per-case `Suggest` controls.
- [ ] Remove the separate `Expected outcome` editor field.
- [ ] Remove low-level authored matcher editing for `contains`, `equals`, and `javascript`.
- [ ] Replace the current top scenario card plus separate editor card with one accordion-based `Scenarios` section.
- [ ] Make the section itself collapsible and keep `New scenario` in the section header.
- [ ] Show one compact collapsed row per scenario with scenario name, mode badges, and prompt preview only.
- [ ] Expand a scenario inline when its row is clicked; do not keep a separate hidden selected-scenario state.
- [ ] Allow only one expanded scenario at a time.
- [ ] Make `New scenario` create and persist a real scenario immediately and expand that row right away.
- [ ] If there are no scenarios, show only the `Scenarios` empty state and do not render an editor yet.
- [ ] Move the performance-mode `Suggest` action into the expanded scenario row so the flow is `New scenario -> Suggest -> edit -> autosave`.
- [ ] Add a scenario-level delete affordance for persisted scenarios and keep the accordion state consistent after delete.
- [ ] Add per-expectation delete affordances in the expanded editor.
- [ ] Make prompt and expectation edits autosave after the scenario exists.
- [ ] Show `Suggesting…` in the button while `Suggest` is in flight.
- [ ] Show the same status-bar treatment and behavior used by workflow steps at the bottom of the expanded scenario editor while `Suggest` is running.
- [ ] Use specific in-flight copy such as `Reading skill and drafting scenario…`, not generic loading text.
- [ ] Remove the status bar after the saved scenario reload completes, and reuse the same position for inline error feedback when suggestion fails.
- [ ] Keep each expanded scenario editor to just scenario name, user prompt, and expectations.

## Task 3: Remove trigger-mode authoring from Eval Workbench

**Files:**

- Modify: `app/src/components/workspace/workspace-description.tsx`
- Modify: `app/src/components/workspace/workspace-eval-workbench.tsx`
- Modify: any shared router or tab helpers that expose trigger mode through Eval Workbench

- [ ] Remove trigger-mode tabs, badges, and labels from Eval Workbench.
- [ ] Remove trigger-only scenario editing from the active eval-workbench screen.
- [ ] If trigger description candidate generation still exists elsewhere, explicitly route it outside Eval Workbench rather than leaving half-active UI affordances behind.
- [ ] Keep current non-eval description/refine behavior unchanged unless it depends on removed eval-workbench mode wiring.

## Task 4: Rework scenario-level suggestion

**Files:**

- Modify: `app/src/components/workspace/workspace-evals.tsx`
- Modify: `app/src-tauri/src/commands/eval_workbench/mod.rs`
- Modify: frontend wrappers in `app/src/lib/eval-workbench.ts` if the request/response shape changes

- [ ] Replace the bulk `generate_scenarios` workflow with a scenario-scoped suggestion workflow.
- [ ] Make the scenario-level `Suggest` action generate scenario name plus prompt text plus expectation lines for one persisted scenario.
- [ ] Ensure suggestion persists the active scenario through Rust and reloads the saved scenario instead of mutating only a local draft.
- [ ] Use a single-scenario response shape, not a top-level `scenarios[]` bulk response.
- [ ] Require the prompt to return exactly one JSON object with only `name`, `prompt`, and `expectations`.
- [ ] Remove `shouldTrigger`, `tags`, and any trigger-era fields from the suggestion JSON contract.
- [ ] Require `expectations` to be an array of plain-language strings, not low-level matcher objects.
- [ ] Require the model to return JSON only, with no prose or markdown fences.
- [ ] Remove dead frontend and backend paths that only supported bulk scenario generation.
- [ ] Externalize the suggest prompt into `agent-sources/prompts/` and stop hardcoding it in Rust.
- [ ] Build a suggestion context envelope that passes the canonical skill path, workspace skill path when relevant, skill files, clarifications when present, decisions when present, and current scenario state.
- [ ] Explicitly instruct the LLM to read and understand the skill before generating the scenario prompt and expectations.
- [ ] Make suggestion overwrite the current scenario prompt and expectations rather than filling blanks.
- [ ] Allow suggestion to overwrite the scenario name as well, not just prompt and expectations.
- [ ] Replace the current invalid-JSON failure with a clearer scenario-suggestion error path that includes enough response context to debug malformed structured output.
- [ ] Tighten the parser so malformed structured output is rejected deterministically and mapped to a user-facing suggestion error.

## Task 5: Rebuild results around one master-detail section

**Files:**

- Modify: `app/src/components/workspace/workspace-evals.tsx`
- Modify: `app/src/components/workspace/workspace-description.tsx`
- Modify: `app/src/components/workspace/eval-workbench/use-run-history.ts`
- Modify: `app/src/components/workspace/eval-workbench/**` as needed for shared results helpers

- [ ] Replace the separate `Run history` and `Latest run` cards with one `Results` section.
- [ ] Move `Evaluate` into the `Results` section header rather than keeping it near the top of the page.
- [ ] Present history as a reverse-chronological run list, newest first.
- [ ] Auto-open the newest run by default.
- [ ] Prepend a newly completed run to the top of the list and open it immediately.
- [ ] Keep run detail in the same section as a master-detail view rather than a separate card.
- [ ] Keep `Send to Refine` in the selected run detail pane.
- [ ] Use a stacked history-then-detail layout on narrow screens.

## Task 6: Update run preparation and validation

**Files:**

- Modify: `app/src-tauri/src/commands/eval_workbench/mod.rs`
- Modify: any helper functions that translate scenarios into Promptfoo-sidecar cases
- Modify: `app/src/lib/eval-workbench.ts`

- [ ] Update run preparation so each saved scenario produces one Promptfoo scenario input from the simplified authored contract.
- [ ] Compile each authored expectation into one Promptfoo `llm-rubric` assertion at runtime.
- [ ] Change execution from selected-scenario run to package-level evaluation across all saved scenarios.
- [ ] Require at least one expectation before persisted suggestion completion or package evaluation.
- [ ] Preserve run history lookup for the package-oriented performance workbench even when one Evaluate action runs all saved scenarios.
- [ ] Keep the current app-local Promptfoo history boundary intact.

## Task 7: Refresh tests around the simplified model

**Files:**

- Modify: `app/src/__tests__/components/workspace/workspace-evals.test.tsx`
- Modify: `app/src/__tests__/components/workspace/workspace-description.test.tsx`
- Modify: `app/src/__tests__/components/workspace/workspace-shell.test.tsx`
- Modify: `app/src/__tests__/lib/eval-workbench-tauri.test.ts`
- Modify: `app/e2e/evals/evals.spec.ts` if the visible performance flow changes

- [ ] Replace fixtures that currently depend on nested `cases[]` payloads.
- [ ] Add coverage that there is no explicit `Save scenario` button.
- [ ] Add coverage that `New scenario` persists immediately.
- [ ] Add coverage that `New scenario` creates an expanded accordion row immediately.
- [ ] Add coverage that only one scenario row is expanded at a time.
- [ ] Add coverage that collapsed rows show prompt preview only.
- [ ] Add coverage that prompt/expectation edits autosave after persistence.
- [ ] Add coverage that performance mode no longer exposes bulk generation or per-case suggestion.
- [ ] Add coverage that scenario-level `Suggest` persists and reloads exactly one scenario.
- [ ] Add coverage that the scenario editor renders plain-language expectations rather than low-level matcher controls.
- [ ] Add coverage that `Suggest` is scenario-level, not workbench-level.
- [ ] Add coverage that deleting a saved scenario updates the list and selected scenario state correctly.
- [ ] Add coverage that expectations can be deleted individually.
- [ ] Add coverage for malformed scenario-suggestion responses so the surfaced error is actionable.
- [ ] Add coverage that `Suggest` shows a busy affordance while it is running.
- [ ] Add coverage that trigger-mode tabs and mode affordances no longer appear in Eval Workbench.
- [ ] Add coverage that the primary action is `Evaluate`, not `Run scenario`.
- [ ] Add coverage that `Evaluate` invokes package-level execution rather than passing a single scenario name.
- [ ] Add coverage that `Results` is one combined master-detail section rather than separate history/detail cards.
- [ ] Add coverage that run history is reverse chronological and the newest run opens by default.
- [ ] Add coverage that each expectation becomes its own model-graded runtime assertion.
- [ ] Keep existing run-history and accordion regression coverage green after the model change.

## Task 8: Final documentation sync

**Files:**

- Modify: `docs/design/README.md`
- Modify: `docs/design/eval-workbench/README.md` if implementation choices require clarifications
- Optionally modify: `docs/plans/2026-05-05-eval-workbench-scenarios.md` only if a deprecation note is needed

- [ ] Keep `docs/design/README.md` aligned with the new single eval-workbench design doc.
- [ ] Ensure implementation does not leave references to the deleted design docs in active documentation.
- [ ] If the older implementation plan remains in-tree, mark it as superseded rather than silently leaving two active-looking plans.

## Validation

- [ ] `npx markdownlint-cli2 docs/design/eval-workbench/README.md docs/design/README.md docs/plans/2026-05-06-eval-workbench-simplification.md`
- [ ] `cd app && npx vitest run src/__tests__/lib/eval-workbench-tauri.test.ts src/__tests__/components/workspace/workspace-evals.test.tsx src/__tests__/components/workspace/workspace-shell.test.tsx`
- [ ] `cd app && npm run test:unit`
- [ ] `cd app && cargo test --manifest-path src-tauri/Cargo.toml commands::eval_workbench`
- [ ] `cd app && npx tsc --noEmit`
- [ ] `cd app && npm run test:e2e -- --grep @evals`
