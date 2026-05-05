# Eval Workbench Scenarios Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign Eval Workbench so authored eval assets live on disk as git-backed scenario YAML files under `{plugin}/evals/{skill_name}/`, while run history is owned by app-side Promptfoo persisted state under `<data_dir>/promptfoo`. The app must not maintain a second eval identity or reconcile authored scenarios against app-owned history tables.

**Prerequisite:** `docs/plans/2026-05-05-plugin-folder-structure.md` must be merged first. This plan assumes the canonical skill path is `{skills_dir}/{plugin_name}/skills/{skill_name}` and that the eval path can be added as a sibling.

**Architecture:**

- Scenario YAML files are the source of truth for authored eval content: scenario name, mode tags, cases, prompts, expected outcomes, and assertions.
- Eval Workbench run history uses app-side Promptfoo persisted state under `<data_dir>/promptfoo`.
- The app reads and writes scenario files directly from disk.
- The app does not mirror scenarios into its own SQLite tables.
- If a scenario folder is deleted from disk, those scenarios disappear from the app.
- On another machine, authored scenarios appear after git sync, but prior run history does not unless that machine also has the same app-side Promptfoo state.
- Promptfoo config is generated from scenario files at run time.
- Trigger description candidates are app-local operational state keyed by scenario identity, not by `prompt_set_id`.
- Repo engineering evals under `tests/evals` remain separate and must not be reused as the Eval Workbench history store.
- This plan assumes a dev-only branch and removes prompt-set-era compatibility instead of preserving a legacy path.

**Tech Stack:** Rust / serde_yaml / Tauri / React / TanStack Query / Promptfoo persisted history. New Tauri commands for file-based scenario CRUD and file-based run preparation. Frontend renames and shared tag UI. LLM scenario and assertion generation remain one-shot generation flows, but they emit scenario content that is saved to disk.

**Design docs:** `docs/design/eval-workbench-scenarios/README.md`, `docs/design/eval-workbench-scenarios-remediation/README.md`

## Source Traceability

- Functional spec: `not_applicable`
- Design docs: `docs/design/eval-workbench-scenarios/README.md`
- Implementation plan: `docs/plans/2026-05-05-eval-workbench-scenarios.md`

## Decisions

- Keep authored eval content on disk only.
- Treat Eval Workbench Promptfoo history as app-local and machine-specific by design.
- Remove app-owned eval identity coupling such as `prompt_set_id` mirrors.
- Do not add reconciliation between authored scenarios and app-owned run tables.
- Do not preserve legacy prompt-set compatibility in the active scenario path.
- Key scenario-owned operational state by `(plugin_slug, skill_name, scenario_name)`.
- Keep repo source-code eval tooling under `tests/evals` separate from app functionality.
- If the current issue text still assumes app-owned eval history, update the issue to match this implementation plan before completion.

## Completion Audit (2026-05-05)

This section audits the implementation on branch
`feature/vu-1145-implement-openhands-native-clean-break-agent-runtime`
at commit `15042444`.

### Top-level task status

- [x] Task 1 completed in code: `eval_dir` template and `resolve_eval_dir()` landed.
- [x] Task 2 completed in code: scenario YAML types and filesystem helpers landed.
- [x] Task 3 completed in code: scenario CRUD/read commands and typed frontend wrappers landed.
- [x] Task 4 completed in code: shared scenario pool, mode tags, and active UI rename landed.
- [x] Task 5 completed after doc alignment: scenario generation ships through the app-owned OpenHands one-shot path, and the plan/design now describe that runtime boundary directly.
- [x] Task 6 completed after doc alignment: assertion suggestion shipped and the design index was updated.
- [x] Independent review gate complete: backend and frontend review findings were addressed in follow-up hardening changes and the targeted validation suite was rerun successfully.

### Acceptance criteria audit

No separate repo-local AC checklist was found in this worktree. The design scope
and plan goal are the nearest local acceptance source, so this audit checks
those requirements directly.

- [x] Scenarios are file-backed YAML under `{plugin}/evals/{skill_name}/`.
- [x] The active Eval Workbench flow is scenario-first rather than prompt-set-first.
- [x] Performance and Trigger tabs share the same scenario pool, filtered by mode tags.
- [x] Scenarios support `performance`, `trigger`, and `both` tags.
- [x] Scenario CRUD is implemented through Tauri filesystem commands.
- [x] Scenario execution reads from scenario files and persists run history through Promptfoo-sidecar history support.
- [x] Scenario generation is available from the workbench UI.
- [x] Assertion suggestion is available per case.
- [x] Design/index docs are aligned with the shipped behavior, including app-owned Promptfoo history.
- [x] Scenario generation is documented as an app-owned OpenHands one-shot flow rather than a repo-owned eval harness asset.
- [x] Independent quality-gate review is closed with reviewer findings addressed.

### Validation evidence

- [x] `cd app && npx tsc --noEmit`
- [x] `cd app && cargo test --manifest-path src-tauri/Cargo.toml commands::eval_workbench`
- [x] `cd app && npx vitest run src/__tests__/lib/eval-workbench-tauri.test.ts src/__tests__/components/workspace/workspace-evals.test.tsx src/__tests__/components/workspace/workspace-description.test.tsx src/__tests__/components/workspace/workspace-shell.test.tsx`
- [x] `cd app/promptfoo-sidecar && npm run build`
- [x] `cd app/promptfoo-sidecar && npm test`
- [x] `cd app && cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`

---

## File Structure

| File | Change |
|---|---|
| `app/plugin-paths.json` | Add `eval_dir` template |
| `app/src-tauri/src/skill_paths.rs` | Add `resolve_eval_dir()` helper |
| `app/src-tauri/Cargo.toml` | Add `serde_yaml` dependency |
| `app/src-tauri/src/commands/eval_workbench/scenarios.rs` | File-based scenario types and helpers |
| `app/src-tauri/src/commands/eval_workbench/mod.rs` | File-based scenario CRUD, scenario-detail load, run preparation from disk, Promptfoo-history reads, candidate ownership rewrite |
| `app/src-tauri/src/lib.rs` | Register Tauri commands |
| `app/src-tauri/src/commands/settings.rs` or app path helpers | Resolve `<data_dir>/promptfoo` for app-side Promptfoo state |
| `app/src-tauri/src/db/eval_workbench.rs` | Remove prompt-set-era active paths; keep only minimal app-local operational metadata if still needed |
| `app/src/lib/eval-workbench.ts` | Scenario types and command wrappers |
| `app/src/lib/tauri-command-types.ts` | Typed command entries |
| `app/src/lib/queries/eval-scenarios.ts` | Query hooks for scenario list/read/write |
| `app/src/components/workspace/workspace-eval-workbench.tsx` | Shared scenario selector across modes |
| `app/src/components/workspace/workspace-evals.tsx` | Performance scenario editing and running |
| `app/src/components/workspace/workspace-description.tsx` | Trigger scenario editing and running |
| `app/src/__tests__/components/workspace/**` | UI coverage for shared scenario behavior |
| `app/e2e/evals/evals.spec.ts` | Mocked browser coverage for performance mode |
| `app/e2e/description/description-workbench.spec.ts` | Mocked browser coverage for trigger mode |

## Task 1: Clean up the existing hybrid implementation first

**Why first:** The current branch mixes file-backed scenarios with app-DB-backed prompt-set mirrors and an incomplete frontend/Tauri contract. Fix the compile/command break immediately, then remove the hybrid model before extending or tightening the feature.

**Files:**

- Modify: `app/src-tauri/src/commands/eval_workbench/mod.rs`
- Modify: `app/src-tauri/src/db/eval_workbench.rs`
- Modify: `app/src-tauri/src/db/migrations.rs`
- Modify: any Eval Workbench Promptfoo history access helpers
- Modify: `app/src/components/workspace/workspace-eval-workbench.tsx`
- Modify: `app/src/components/workspace/workspace-evals.tsx`
- Modify: `app/src/components/workspace/workspace-description.tsx`

- [ ] Fix the current compile break by either removing `scenarioLoading` from call sites or adding it to the relevant component props and loading-state handling.
- [ ] Implement and register `load_scenario` as a real file-backed Tauri command before deeper cleanup.
- [ ] Remove scenario mirroring into app SQLite prompt-set tables.
- [ ] Remove run-time dependence on mirrored `eval_prompt_sets` rows and `prompt_set_id`.
- [ ] Remove delete / retag behavior that can wipe or hide historical results through app-DB coupling.
- [ ] Remove stale app-owned prompt-set paths rather than isolating a legacy compatibility layer.
- [ ] Identify any remaining Prompt Set era assumptions in the command layer and either delete them or rewrite them around file-backed scenarios plus Promptfoo-local history.
- [ ] Ensure this cleanup does not touch the separate `tests/evals` engineering harness storage model.
- [ ] Land this cleanup before further feature work or contract tightening.

## Task 2: Establish file-based scenario storage

**Files:**

- Modify: `app/plugin-paths.json`
- Modify: `app/src-tauri/src/skill_paths.rs`
- Modify: `app/src-tauri/Cargo.toml`
- Create / modify: `app/src-tauri/src/commands/eval_workbench/scenarios.rs`

- [X] Add `eval_dir` to `plugin-paths.json` as `{root}/{plugin_slug}/evals/{skill_name}`.
- [X] Add `resolve_eval_dir()` to `skill_paths.rs`.
- [X] Add `serde_yaml` to `Cargo.toml`.
- [X] Define scenario types in `scenarios.rs`:
  - `Scenario`
  - `ScenarioTag`
  - `ScenarioCase`
  - `ScenarioAssertion`
- [X] Implement file helpers:
  - `list_scenarios`
  - `read_scenario_file`
  - `write_scenario_file`
  - `delete_scenario_file`
  - `scenario_file_path`
  - validation helpers
- [ ] Add a summary/detail split:
  - scenario summaries for `list_scenarios`
  - full scenario payloads for `load_scenario`
- [X] Add Rust helper tests for:
  - round-trip YAML
  - file listing
  - slugging
  - delete behavior
  - invalid tags / invalid names

## Task 3: Make Tauri scenario commands purely file-based

**Files:**

- Modify: `app/src-tauri/src/commands/eval_workbench/mod.rs`
- Modify: `app/src-tauri/src/lib.rs`
- Modify: `app/src/lib/eval-workbench.ts`
- Modify: `app/src/lib/tauri-command-types.ts`
- Modify: `app/src/lib/tauri-command-types.typecheck.ts`
- Create / modify: `app/src/lib/queries/eval-scenarios.ts`

- [ ] Expose file-based commands:
  - `list_scenarios`
  - `load_scenario`
  - `save_scenario`
  - `delete_scenario`
- [ ] Ensure `save_scenario` writes only YAML to disk.
- [ ] If rename support is needed, make it a file rename operation, not a second saved identity.
- [ ] Remove any scenario mirroring into app SQLite tables.
- [ ] Remove any command requirement that a scenario must first exist in app SQLite before it can run.
- [ ] Update frontend wrappers and query hooks to use the file-based commands only.
- [ ] Add command-surface tests for scenario CRUD behavior, including real `load_scenario` registration.

## Task 4: Run Eval Workbench directly from scenario files

**Files:**

- Modify: `app/src-tauri/src/commands/eval_workbench/mod.rs`
- Modify: any helper modules that build Promptfoo input

- [ ] Change run preparation so both Performance and Trigger modes read the selected scenario YAML from disk.
- [ ] Filter cases by scenario tags and selected mode.
- [ ] Generate Promptfoo input in memory from the file-backed scenario.
- [ ] Remove any dependency on mirrored `eval_prompt_sets` rows or `prompt_set_id` lookups for active runs.
- [ ] Ensure a git-synced scenario can run on a fresh app DB with no resave step.
- [ ] Key active runtime lookups by `(plugin_slug, skill_name, scenario_name)` rather than prompt-set ids.
- [ ] Add Rust tests for:
  - running a disk-backed scenario with a fresh DB
  - rejecting a scenario for the wrong mode
  - loading the right case set for `performance`, `trigger`, and `both`

## Task 5: Treat Promptfoo state as the run-history system

**Files:**

- Modify: `app/src-tauri/src/commands/eval_workbench/mod.rs`
- Modify: any Promptfoo history access helpers used by Eval Workbench
- Modify or remove: app DB-backed eval history code paths
- Modify: app data-dir path helpers as needed to resolve `<data_dir>/promptfoo`

- [ ] Stop using app SQLite as the authoritative eval run-history store for Eval Workbench.
- [ ] Read run history from app-side Promptfoo persisted state under `<data_dir>/promptfoo`.
- [ ] Make the app resilient to empty local Promptfoo history:
  - scenarios still load from disk
  - history simply appears empty on that machine
- [ ] Ensure deleting a scenario from disk removes authored visibility only; it must not trigger app-owned run-history deletion logic.
- [ ] Update any UI copy that previously implied run history follows the scenario across machines.
- [ ] Remove or bypass app-owned schema assumptions such as `eval_runs.prompt_set_id` for this flow.
- [ ] If Promptfoo persisted state alone cannot recover the existing `EvalRun` frontend contract, add only the minimum run-metadata adapter keyed by run id and scenario identity.
- [ ] Keep this state path separate from repo engineering eval state under `tests/evals`.

## Task 6: Update the shared workbench UI around scenarios

**Files:**

- Modify: `app/src/components/workspace/workspace-eval-workbench.tsx`
- Modify: `app/src/components/workspace/workspace-evals.tsx`
- Modify: `app/src/components/workspace/workspace-description.tsx`
- Modify: `app/src/components/workspace/eval-workbench/prompt-set-editor.tsx`

- [X] Rename user-facing "Prompt Set" language to "Scenario".
- [X] Keep one shared scenario list for Performance and Trigger, filtered by tag.
- [X] Allow authors to mark scenarios as:
  - `performance`
  - `trigger`
  - `both`
- [X] Ensure the selected scenario survives tab switches where valid and falls back safely when not valid.
- [X] Ensure deleting the eval folder from disk results in no scenarios being shown after refresh.
- [ ] Keep creation/editing UI aligned with the accepted product behavior; if the issue text still says "modal" but the chosen UX is inline, update the issue before completion.

## Task 7: Keep LLM generation file-first

**Files:**

- Modify: `app/src/components/workspace/workspace-evals.tsx`
- Modify: `app/src/components/workspace/eval-workbench/prompt-set-editor.tsx`
- Modify: `app/src-tauri/src/commands/eval_workbench/mod.rs`

- [X] Keep "Generate scenarios" as a one-shot generation flow that reads the skill folder and returns scenario content.
- [X] Save generated scenarios as YAML files through the same file-based save path as manual edits.
- [X] Keep "Suggest assertions" as a per-case generation flow that updates the scenario draft and persists to disk on save.
- [ ] Enforce any required output bounds in code, not just in prompt text:
  - scenarios: 3 to 5 generated items if that remains the contract
  - assertions: 1 to 3 generated items if that remains the contract
- [ ] If the accepted product behavior is "generate scenario DTOs and then save to YAML", record that clearly in Linear and the design doc.
- [ ] Do not route generation flows through prompt-set-era save or ownership helpers.

## Task 8: Retarget trigger candidate persistence around scenario identity

**Files:**

- Modify: `app/src-tauri/src/commands/eval_workbench/mod.rs`
- Modify: `app/src-tauri/src/db/eval_workbench.rs`
- Modify: candidate/history helper code used by `apply_description_candidate` and `build_refine_improvement_brief`

- [ ] Store trigger description candidates as app-local operational metadata keyed by scenario identity, not `prompt_set_id`.
- [ ] Update candidate generation, comparison, apply, and refine-brief flows to validate `(plugin_slug, skill_name, scenario_name)`.
- [ ] Ensure this store does not duplicate authored scenario cases, tags, or assertions.
- [ ] Add tests that prove candidates remain valid across scenario reloads and on a fresh DB.

## Task 9: Remove stale app-DB coupling from the implementation contract

**Files:**

- Modify: `docs/design/eval-workbench-scenarios/README.md`
- Modify: `docs/design/eval-workbench-scenarios-remediation/README.md` if implementation details sharpen further
- Modify: Linear issue `VU-1161` if needed

- [ ] Update the design doc to state explicitly:
  - authored scenarios live on disk
  - Eval Workbench Promptfoo history is app-local under `<data_dir>/promptfoo`
  - the app does not reconcile scenario identity against its own DB
  - trigger candidate ownership is scenario-scoped operational metadata
  - repo eval tooling under `tests/evals` is separate from app functionality
- [ ] Update acceptance criteria if they still require app-owned `scenario_name` run history instead of Promptfoo-owned history.
- [ ] Remove any plan or issue language that implies a second app-owned source of truth for eval identity.

## Task 10: Verification

- [ ] Run:

```bash
cd app && npx tsc --noEmit
cd app && cargo test --manifest-path src-tauri/Cargo.toml commands::eval_workbench
cd app && npx vitest run src/__tests__/lib/eval-workbench-tauri.test.ts
cd app && npm run test:unit
cd app && bash tests/run.sh e2e --tag @evals
cd app && bash tests/run.sh e2e --tag @description
```

- [ ] Add focused tests for the critical regressions:
  - the current compile break stays fixed
  - `load_scenario` is implemented and registered for the real command surface
  - fresh DB plus existing YAML scenarios can run without resave
  - deleting or retagging scenarios does not corrupt local run-history access
  - renaming a scenario behaves as a rename, not a duplicate
  - shared scenario selection behaves correctly across tabs
  - trigger candidates remain scoped to scenario identity without `prompt_set_id`
- [ ] Run any additional changed-area tests required by `TEST_MAP.md`.

## Checkpoints

- [ ] Checkpoint 1: hybrid DB/disk coupling is removed.
- [ ] Checkpoint 2: file-based scenario CRUD is complete and tested.
- [ ] Checkpoint 3: run preparation no longer depends on app-owned prompt-set mirrors.
- [ ] Checkpoint 4: Promptfoo history is the only run-history source used by Eval Workbench.
- [ ] Checkpoint 5: trigger candidates are scoped by scenario identity, not prompt-set identity.
- [ ] Checkpoint 6: UI flows and mapped E2E coverage pass.
- [ ] Checkpoint 7: design docs and Linear contract match the implementation.

## Manual Checks

- [ ] Verify that a scenario committed to git appears on a second checkout without any app-DB migration step.
- [ ] Verify that the second checkout shows no prior run history until it runs Promptfoo locally under that app's `<data_dir>/promptfoo`.
- [ ] Verify that deleting the scenario file from disk removes it from the app after refresh.
- [ ] Verify that repo engineering eval runs under `tests/evals` do not appear in the app history view.

## Out of Scope

- Shared cross-machine Promptfoo history sync
- Multi-skill or cross-plugin scenario reuse
- Promptfoo bundling changes
- Reworking unrelated trigger-description optimization flows
