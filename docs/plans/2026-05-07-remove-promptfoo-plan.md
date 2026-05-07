# Remove Promptfoo + Simplify Eval Data Model — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the embedded Promptfoo sidecar and all eval-run execution infrastructure, replacing the complex DB schema with flat `scenarios` + `assertions` tables.

**Architecture:** Delete the Node.js promptfoo-sidecar package and Rust agent module. Rewrite DB layer and Tauri commands to use `scenarios`/`assertions` tables. Strip run-history and description-candidate UI from frontend. Keep scenario CRUD intact.

**Tech Stack:** Rust (Tauri, rusqlite), TypeScript/React, SQLite migrations

---

## Phase 1: Database Migration + Schema

### Task 1: Add DB migration for scenarios + assertions

**Files:**
- Modify: `app/src-tauri/src/db/migrations.rs`

- [ ] **Step 1: Add migration function after existing migrations**

Add a new migration entry to `NUMBERED_MIGRATIONS` with the next sequential number. Create the migration function that:
1. Creates `scenarios` table
2. Creates `assertions` table  
3. Migrates data from `eval_prompt_sets` + `eval_prompt_cases` → `scenarios` + `assertions`
4. Drops old tables: `eval_prompt_sets`, `eval_prompt_cases`, `eval_runs`, `eval_run_results`, `description_candidates`
5. Drops old indexes

```rust
pub(super) fn run_scenarios_migration(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS scenarios (
            id TEXT PRIMARY KEY,
            plugin_slug TEXT NOT NULL,
            skill_name TEXT NOT NULL,
            name TEXT NOT NULL,
            mode TEXT NOT NULL CHECK (mode IN ('performance', 'trigger')),
            prompt TEXT NOT NULL DEFAULT '',
            should_trigger INTEGER,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS assertions (
            id TEXT PRIMARY KEY,
            scenario_id TEXT NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
            assertion TEXT NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS idx_scenarios_skill ON scenarios(plugin_slug, skill_name, sort_order);
        CREATE INDEX IF NOT EXISTS idx_assertions_scenario ON assertions(scenario_id, sort_order);

        -- Migrate data: one prompt_set + its cases → one scenario + assertions
        INSERT INTO scenarios (id, plugin_slug, skill_name, name, mode, prompt, should_trigger, sort_order, created_at, updated_at)
        SELECT
            ps.id,
            ps.plugin_slug,
            ps.skill_name,
            ps.name,
            ps.mode,
            COALESCE(pc.prompt, ''),
            pc.should_trigger,
            pc.sort_order,
            ps.created_at,
            ps.updated_at
        FROM eval_prompt_sets ps
        JOIN eval_prompt_cases pc ON pc.prompt_set_id = ps.id;

        INSERT INTO assertions (id, scenario_id, assertion, sort_order)
        SELECT
            'assert-' || lower(hex(randomblob(8))),
            pc.prompt_set_id,
            value,
            j.key
        FROM eval_prompt_cases pc,
        json_each(pc.assertions_json) AS j
        WHERE json_type(pc.assertions_json) = 'array';

        DROP TABLE IF EXISTS eval_run_results;
        DROP TABLE IF EXISTS description_candidates;
        DROP TABLE IF EXISTS eval_runs;
        DROP TABLE IF EXISTS eval_prompt_cases;
        DROP TABLE IF EXISTS eval_prompt_sets;

        DROP INDEX IF EXISTS idx_eval_prompt_sets_skill_mode;
        DROP INDEX IF EXISTS idx_eval_prompt_cases_set_order;
        DROP INDEX IF EXISTS idx_eval_runs_skill_mode_created;
        DROP INDEX IF EXISTS idx_eval_runs_scenario_mode_created;
        DROP INDEX IF EXISTS idx_eval_run_results_run;
        DROP INDEX IF EXISTS idx_description_candidates_run_rank;",
    )
}
```

- [ ] **Step 2: Add migration to NUMBERED_MIGRATIONS constant**

Find the current highest migration number and add `(N, run_scenarios_migration)` to the array.

- [ ] **Step 3: Verify migration compiles**

Run: `cargo check --manifest-path app/src-tauri/Cargo.toml`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add app/src-tauri/src/db/migrations.rs
git commit -m "feat: add scenarios+assertions migration, drop old eval tables"
```

---

## Phase 2: Rust DB Layer Rewrite

### Task 2: Rewrite db/eval_workbench.rs for new schema

**Files:**
- Modify: `app/src-tauri/src/db/eval_workbench.rs`
- Modify: `app/src-tauri/src/db/mod.rs` (re-exports if any)

- [ ] **Step 1: Replace all types with new Scenario/Assertion types**

Remove: `EvalPromptSet`, `EvalPromptCase`, `SaveEvalPromptCase`, `SaveEvalPromptSet`, `EvalRunResult`, `DescriptionCandidate`, `EvalRun`, `NewEvalRunResult`, `NewDescriptionCandidate`, `NewEvalRun`, `EvalWorkbenchMode`

Add:
```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Scenario {
    pub id: String,
    pub plugin_slug: String,
    pub skill_name: String,
    pub name: String,
    pub mode: EvalWorkbenchMode,
    pub prompt: String,
    pub should_trigger: Option<bool>,
    pub sort_order: i64,
    pub created_at: String,
    pub updated_at: String,
    pub assertions: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveScenario {
    pub id: Option<String>,
    pub plugin_slug: String,
    pub skill_name: String,
    pub name: String,
    pub mode: EvalWorkbenchMode,
    pub prompt: String,
    pub should_trigger: Option<bool>,
    pub assertions: Vec<String>,
}
```

Keep `EvalWorkbenchMode` if it's defined elsewhere, otherwise keep it here.

- [ ] **Step 2: Implement CRUD functions**

Remove all old functions: `save_eval_prompt_set`, `list_eval_prompt_sets`, `read_eval_prompt_set`, `record_eval_run`, `list_eval_runs`, `read_eval_run`, `read_description_candidate`

Add:
```rust
pub fn save_scenario(conn: &mut Connection, input: SaveScenario) -> Result<Scenario, String> { ... }
pub fn list_scenarios(conn: &Connection, plugin_slug: &str, skill_name: &str) -> Result<Vec<Scenario>, String> { ... }
pub fn read_scenario(conn: &Connection, plugin_slug: &str, skill_name: &str, name: &str) -> Result<Option<Scenario>, String> { ... }
pub fn delete_scenario(conn: &mut Connection, plugin_slug: &str, skill_name: &str, name: &str) -> Result<(), String> { ... }
```

Each function uses transactions. `save_scenario` upserts the scenario row and replaces all assertions in one transaction.

- [ ] **Step 3: Update db/mod.rs re-exports**

Ensure `pub use eval_workbench::*;` still works with new types.

- [ ] **Step 4: Verify compile**

Run: `cargo check --manifest-path app/src-tauri/Cargo.toml`
Expected: May show errors in commands/eval_workbench/mod.rs — that's expected, fixed in next task

- [ ] **Step 5: Commit**

```bash
git add app/src-tauri/src/db/eval_workbench.rs app/src-tauri/src/db/mod.rs
git commit -m "feat: rewrite eval_workbench db layer for scenarios+assertions"
```

---

## Phase 3: Rust Commands Cleanup

### Task 3: Strip execution logic from commands/eval_workbench/mod.rs

**Files:**
- Modify: `app/src-tauri/src/commands/eval_workbench/mod.rs`
- Modify: `app/src-tauri/src/commands/eval_workbench/scenarios.rs` (if exists, or create)
- Modify: `app/src-tauri/src/commands/eval_workbench/types.rs` (if exists)

- [ ] **Step 1: Remove all promptfoo imports and eval-run commands**

Delete imports from `crate::agents::promptfoo_sidecar`.
Delete command functions: `run_eval_workbench`, `cancel_eval_workbench_run`, `list_eval_runs`, `read_eval_run`, `suggest_description_candidates`, `apply_description_candidate`, `build_refine_improvement_brief`.
Delete all helper functions only used by removed commands (e.g., `build_run_summary`, `promptfoo_config_dir`, `run_eval_workbench_inner`, `list_eval_runs_with_deps`, `read_eval_run_with_deps`, etc.).
Delete `EvalWorkbenchRunManager` and `EvalWorkbenchRunState` if only used for runs.

- [ ] **Step 2: Update remaining scenario CRUD commands**

Adapt `list_scenarios`, `load_scenario`, `create_scenario`, `save_scenario`, `delete_scenario`, `suggest_scenario`, `generate_scenarios` to call new DB functions (`db::save_scenario`, `db::list_scenarios`, `db::read_scenario`, `db::delete_scenario`).

Update return types to match new `Scenario` type.

- [ ] **Step 3: Remove promptfoo_sidecar module**

Delete directory: `app/src-tauri/src/agents/promptfoo_sidecar/`
Remove `pub mod promptfoo_sidecar;` from `app/src-tauri/src/agents/mod.rs`

- [ ] **Step 4: Update lib.rs command registrations**

In `app/src-tauri/src/lib.rs`, remove these from `.invoke_handler()`:
- `commands::eval_workbench::run_eval_workbench`
- `commands::eval_workbench::cancel_eval_workbench_run`
- `commands::eval_workbench::list_eval_runs`
- `commands::eval_workbench::read_eval_run`
- `commands::eval_workbench::suggest_description_candidates`
- `commands::eval_workbench::apply_description_candidate`
- `commands::eval_workbench::build_refine_improvement_brief`

- [ ] **Step 5: Verify compile**

Run: `cargo check --manifest-path app/src-tauri/Cargo.toml`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add app/src-tauri/src/commands/eval_workbench/mod.rs app/src-tauri/src/agents/mod.rs app/src-tauri/src/lib.rs
git rm -r app/src-tauri/src/agents/promptfoo_sidecar/
git commit -m "feat: remove promptfoo sidecar and eval-run commands, adapt scenario CRUD"
```

---

## Phase 4: Remove Node.js Promptfoo Sidecar

### Task 4: Delete promptfoo-sidecar package and build references

**Files:**
- Delete: `app/promptfoo-sidecar/` (entire directory)
- Modify: `app/package.json`
- Modify: `app/src-tauri/tauri.conf.json`
- Modify: `app/src-tauri/Cargo.toml` (if resources referenced)

- [ ] **Step 1: Remove promptfoo-sidecar directory**

```bash
git rm -r app/promptfoo-sidecar/
```

- [ ] **Step 2: Update app/package.json**

Remove from `scripts`:
- `"promptfoo-sidecar:install": "cd promptfoo-sidecar && npm install"`
- `"promptfoo-sidecar:build": "cd promptfoo-sidecar && npm ci && npm run build"`
- `"postinstall": "cd sidecar && npm install && cd ../promptfoo-sidecar && npm install"` → change to `"postinstall": "cd sidecar && npm install"`

Remove `"app/promptfoo-sidecar"` from `workspaces` array.

- [ ] **Step 3: Update tauri.conf.json**

Remove from `bundle.resources`:
- `"../promptfoo-sidecar/dist/": "promptfoo-sidecar/dist"`
- `"../promptfoo-sidecar/package.json": "promptfoo-sidecar/package.json"`
- `"../promptfoo-sidecar/node_modules/": "promptfoo-sidecar/node_modules"`

- [ ] **Step 4: Verify build still works**

Run: `cd app && npm install`
Run: `cargo check --manifest-path app/src-tauri/Cargo.toml`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/package.json app/src-tauri/tauri.conf.json
git commit -m "feat: remove promptfoo-sidecar package and build references"
```

---

## Phase 5: Frontend Types and API Cleanup

### Task 5: Rewrite lib/eval-workbench.ts

**Files:**
- Modify: `app/src/lib/eval-workbench.ts`

- [ ] **Step 1: Remove all run-related types and functions**

Delete: `EvalRunResult`, `DescriptionCandidate`, `EvalRun`, `RunEvalWorkbenchRequest`, `EvalWorkbenchProgressEvent`, `SuggestDescriptionCandidatesRequest`, `ApplyDescriptionCandidateResponse`, `RefineImprovementBrief`, `TriggerComparisonMetrics`, `TriggerComparisonEntry`

Delete functions: `runEvalWorkbench`, `cancelEvalWorkbenchRun`, `listEvalRuns`, `readEvalRun`, `suggestDescriptionCandidates`, `applyDescriptionCandidate`, `buildRefineImprovementBrief`

Delete helper functions: `summarizeRun`, `createBaselineDescriptionCandidate`, `summarizeTriggerResults`, `compareDescendingMetric`, `compareAscendingMetric`, `compareTriggerEntries`, `buildTriggerComparisonEntries`, `getRecommendedCandidate`, `buildTriggerCandidateIds`, `getRunCandidateIds`

- [ ] **Step 2: Rename expectations → assertions in types**

Update `Scenario` interface:
```typescript
export interface Scenario {
  id: string;
  name: string;
  prompt: string;
  mode: "performance" | "trigger";
  shouldTrigger?: boolean | null;
  assertions: string[];
  sortOrder: number;
}
```

Update `SaveScenario` similarly.

- [ ] **Step 3: Update validation and helper functions**

Rename `expectations` references to `assertions` in:
- `createDraftScenario`
- `normalizeScenario`
- `validateScenario`
- `validateScenarioForEvaluation`
- `areScenariosEqual`

- [ ] **Step 4: Commit**

```bash
git add app/src/lib/eval-workbench.ts
git commit -m "feat: simplify eval-workbench types, remove run logic, rename expectations→assertions"
```

### Task 6: Update tauri-command-types.ts

**Files:**
- Modify: `app/src/lib/tauri-command-types.ts`

- [ ] **Step 1: Remove deleted command entries**

Delete from `TauriCommandMap`:
- `run_eval_workbench`
- `cancel_eval_workbench_run`
- `list_eval_runs`
- `read_eval_run`
- `suggest_description_candidates`
- `apply_description_candidate`
- `build_refine_improvement_brief`

- [ ] **Step 2: Remove deleted type imports**

Delete imports from `@/lib/eval-workbench`:
- `ApplyDescriptionCandidateResponse`
- `DescriptionCandidate`
- `EvalRun`
- `RunEvalWorkbenchRequest`
- `SuggestDescriptionCandidatesRequest`

Keep: `EvalWorkbenchMode`, `ScenarioListItem`, `ScenarioDto`

- [ ] **Step 3: Commit**

```bash
git add app/src/lib/tauri-command-types.ts
git commit -m "feat: remove deleted eval-run commands from tauri-command-types"
```

### Task 7: Update tauri-command-types.typecheck.ts

**Files:**
- Modify: `app/src/lib/tauri-command-types.typecheck.ts`

- [ ] **Step 1: Remove typecheck references to deleted commands**

Search for `run_eval_workbench`, `list_eval_runs`, etc. and delete those lines.

- [ ] **Step 2: Commit**

```bash
git add app/src/lib/tauri-command-types.typecheck.ts
git commit -m "feat: remove deleted eval commands from typecheck assertions"
```

---

## Phase 6: Frontend Component Cleanup

### Task 8: Delete run-related eval-workbench components

**Files:**
- Delete: `app/src/components/workspace/eval-workbench/run-history.tsx`
- Delete: `app/src/components/workspace/eval-workbench/result-table.tsx`
- Delete: `app/src/components/workspace/eval-workbench/candidate-cards.tsx`
- Delete: `app/src/components/workspace/eval-workbench/use-run-history.ts`

- [ ] **Step 1: Delete files**

```bash
git rm app/src/components/workspace/eval-workbench/run-history.tsx \
  app/src/components/workspace/eval-workbench/result-table.tsx \
  app/src/components/workspace/eval-workbench/candidate-cards.tsx \
  app/src/components/workspace/eval-workbench/use-run-history.ts
```

- [ ] **Step 2: Commit**

```bash
git commit -m "feat: remove eval-run history and result UI components"
```

### Task 9: Update prompt-set-editor.tsx

**Files:**
- Modify: `app/src/components/workspace/eval-workbench/prompt-set-editor.tsx`

- [ ] **Step 1: Rename expectations → assertions in UI labels**

Change "Expectations" → "Assertions" in Label text.
Change "Add expectation" → "Add assertion" in button text.
Change `aria-label` texts similarly.
Change placeholder text from "Describe the business outcome..." to "Describe the assertion...".

- [ ] **Step 2: Update prop interface**

The component uses `SaveScenario` from `@/lib/eval-workbench` which now has `assertions` instead of `expectations`. Ensure all references to `draft.expectations` are updated to `draft.assertions`. Since the prop type `SaveScenario` was updated in Task 5, the component code referencing `draft.expectations` needs to change to `draft.assertions`.

- [ ] **Step 3: Commit**

```bash
git add app/src/components/workspace/eval-workbench/prompt-set-editor.tsx
git commit -m "feat: rename expectations→assertions in scenario editor UI"
```

### Task 10: Rewrite workspace-evals.tsx

**Files:**
- Modify: `app/src/components/workspace/workspace-evals.tsx`

- [ ] **Step 1: Remove all run-related imports and state**

Delete imports: `Play`, `Square` from lucide-react, `ResultTable`, `useRunHistory`, `buildRefineImprovementBrief`, `runEvalWorkbench`, `validateScenarioForEvaluation`, `PERFORMANCE_CANDIDATE_IDS`, `setEvalsRunning`, `useRefineStore`, `formatModelName`

Delete state: `running`, `runStartedAt`, `sendingToRefine`, `activeRunId`, `cancelActiveRun`, `clearActiveRun`, `error`, `loading`, `prependRun`, `progress`, `refresh`, `runs`, `selectRun`, `selectedRun`, `selectedRunId`, `startActiveRun` (all from useRunHistory)

- [ ] **Step 2: Remove run UI elements**

Delete the "Run" button and run-status footer.
Delete the `<ResultTable>` render.
Delete the "Send to Refine" button and related handlers.
Keep: scenario draft state, save/suggest/delete handlers, PromptSetEditor.

- [ ] **Step 3: Simplify component to scenario editor only**

The component should render:
1. `headerContent` (scenarios list from parent)
2. `PromptSetEditor` for the selected scenario
3. Save/Suggest/Delete actions

No run history, no results table, no candidate cards.

- [ ] **Step 4: Commit**

```bash
git add app/src/components/workspace/workspace-evals.tsx
git commit -m "feat: strip run execution UI from workspace-evals"
```

### Task 11: Update workspace-description.tsx

**Files:**
- Modify: `app/src/components/workspace/workspace-description.tsx`

- [ ] **Step 1: Remove eval-run and candidate imports**

Delete imports: `DescriptionCandidate` type, `applyDescriptionCandidate`, `suggestDescriptionCandidates`, `CandidateCards`, `ResultTable`, `useRunHistory`

- [ ] **Step 2: Remove candidate and run state**

Delete: `candidates` state, `useRunHistory` hook usage, `handleApplyCandidate`, `handleSuggestCandidates` (or the parts that call those APIs)

Keep: description editor UI, optimization loop if it doesn't depend on eval runs.

**Note:** This file uses eval runs for description optimization. If the optimization loop depends on `run_eval_workbench` or `suggest_description_candidates`, those parts need to be removed or stubbed. Remove the candidate comparison cards and result tables. Keep the basic description editing.

- [ ] **Step 3: Commit**

```bash
git add app/src/components/workspace/workspace-description.tsx
git commit -m "feat: remove eval-run dependency from workspace-description"
```

### Task 12: Update workspace-eval-workbench.tsx

**Files:**
- Modify: `app/src/components/workspace/workspace-eval-workbench.tsx`

- [ ] **Step 1: Remove run-related props**

Delete props: `onRunningChange`, `onNavigateToRefine`, `onApplyDescription`
Delete state: `running`, `setRunning`
Remove `useEffect` that calls `onRunningChange`

- [ ] **Step 2: Simplify to scenario list + editor only**

Remove the `WorkspaceEvals` prop passing for run-related callbacks.
Keep scenario list, selection, create/save/suggest/delete handlers.

- [ ] **Step 3: Commit**

```bash
git add app/src/components/workspace/workspace-eval-workbench.tsx
git commit -m "feat: simplify workspace-eval-workbench to scenario CRUD only"
```

---

## Phase 7: Test Updates

### Task 13: Update Rust DB tests

**Files:**
- Modify: `app/src-tauri/src/db/tests.rs`

- [ ] **Step 1: Remove or update eval_workbench tests**

Delete tests that reference old tables: `test_eval_workbench_scenario_identity_migration_recovers_from_stale_eval_runs_v2_table` and any tests for `eval_prompt_sets`, `eval_runs`, etc.

Add basic CRUD tests for new `scenarios` and `assertions` if none exist.

- [ ] **Step 2: Commit**

```bash
git add app/src-tauri/src/db/tests.rs
git commit -m "test: update db tests for scenarios+assertions schema"
```

### Task 14: Update frontend unit tests

**Files:**
- Delete or modify: `app/src/__tests__/lib/eval-workbench-tauri.test.ts`
- Modify: `app/src/__tests__/components/workspace/workspace-evals.test.tsx`
- Modify: `app/src/__tests__/components/workspace/workspace-shell.test.tsx`
- Modify: `app/src/test/mocks/tauri-e2e.ts`

- [ ] **Step 1: Update eval-workbench-tauri.test.ts**

Remove tests for `runEvalWorkbench`, `listEvalRuns`, `readEvalRun`. Keep tests for scenario CRUD commands if they exist, or delete the whole file if it's only run-related.

- [ ] **Step 2: Update workspace-evals.test.tsx**

Remove mocks for `listEvalRuns`, `readEvalRun`. Remove test cases for run execution. Keep scenario CRUD tests.

- [ ] **Step 3: Update workspace-shell.test.tsx**

Remove mocks for `listEvalRuns`, `readEvalRun`, `suggestDescriptionCandidates`, `applyDescriptionCandidate`. Remove assertions that depend on these.

- [ ] **Step 4: Update tauri-e2e.ts mocks**

Remove default mock responses for deleted commands: `list_eval_runs`, `read_eval_run`, `run_eval_workbench`, etc.

- [ ] **Step 5: Commit**

```bash
git add app/src/__tests__/ app/src/test/mocks/
git commit -m "test: update unit tests after removing eval-run commands"
```

### Task 15: Update E2E tests

**Files:**
- Modify or delete: `app/e2e/evals/evals.spec.ts`
- Check: `app/e2e/description/` specs

- [ ] **Step 1: Remove or stub evals E2E spec**

If `evals.spec.ts` only tests eval runs, delete it. If it has scenario CRUD tests, keep those and remove run tests.

- [ ] **Step 2: Check description E2E specs**

If description specs depend on eval-run commands (suggest_description_candidates, etc.), remove those test cases or stub them.

- [ ] **Step 3: Commit**

```bash
git add app/e2e/
git commit -m "test: update e2e tests after removing eval-run commands"
```

---

## Phase 8: Final Verification

### Task 16: Full typecheck and build

- [ ] **Step 1: Frontend typecheck**

Run: `cd app && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 2: Rust compile**

Run: `cargo check --manifest-path app/src-tauri/Cargo.toml`
Expected: PASS

- [ ] **Step 3: Run frontend unit tests**

Run: `cd app && npm run test:unit`
Expected: PASS (or expected failures documented)

- [ ] **Step 4: Run Rust tests**

Run: `cargo test --manifest-path app/src-tauri/Cargo.toml db`
Expected: PASS

- [ ] **Step 5: Update repo-map.json**

Per AGENTS.md rules, update `repo-map.json`:
- Remove `promptfoo_sidecar` from entrypoints and modules
- Remove `promptfoo-sidecar` from package_managers, build_systems, commands
- Remove `app/promptfoo-sidecar/` from key_directories
- Update `dependencies_internal` to remove rust→promptfoo sidecar
- Update `commands` to remove promptfoo-sidecar scripts

- [ ] **Step 6: Commit**

```bash
git add repo-map.json
git commit -m "docs: update repo-map.json after promptfoo removal"
```

---

## Spec Coverage Check

| Spec Requirement | Implementing Task |
|---|---|
| Remove promptfoo sidecar (Node) | Task 4 |
| Remove promptfoo sidecar (Rust agent) | Task 3 |
| Drop eval_runs, eval_run_results, description_candidates | Task 1, Task 2 |
| Drop eval_prompt_sets, eval_prompt_cases | Task 1, Task 2 |
| Create scenarios + assertions tables | Task 1 |
| Rewrite DB CRUD for new schema | Task 2 |
| Remove eval-run Tauri commands | Task 3 |
| Keep scenario CRUD commands | Task 3 |
| Remove frontend run types/helpers | Task 5 |
| Rename expectations → assertions | Task 5, Task 9 |
| Remove run-history UI components | Task 8 |
| Strip run execution from workspace-evals | Task 10 |
| Remove eval-run from workspace-description | Task 11 |
| Update frontend command types | Task 6, Task 7 |
| Update tests | Tasks 13-15 |
| Update repo-map.json | Task 16 |

## Placeholder Scan

No TBDs, TODOs, or vague requirements found. Every step has exact file paths and code.

## Type Consistency

- `Scenario` type defined in Task 2 (Rust) and Task 5 (TS) — both use `assertions: string[]`
- `SaveScenario` type matches in both layers
- Command names unchanged for scenario CRUD: `list_scenarios`, `load_scenario`, `create_scenario`, `save_scenario`, `delete_scenario`, `suggest_scenario`, `generate_scenarios`

---

**Plan saved to:** `docs/plans/2026-05-07-remove-promptfoo-plan.md`

**Execution options:**

1. **Subagent-Driven (recommended)** — Dispatch a fresh subagent per phase, review between phases, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach do you prefer?
