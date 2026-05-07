# Remove Promptfoo + Simplify Eval Data Model

**Date:** 2026-05-07  
**Status:** Approved

## Summary

Remove the embedded Promptfoo sidecar and all eval-run execution infrastructure from the app. Replace the complex `eval_prompt_sets` / `eval_prompt_cases` / `eval_runs` / `eval_run_results` / `description_candidates` schema with a flat `scenarios` + `assertions` model: one skill has many scenarios, each scenario has many free-text assertions.

## Background

The app currently embeds a Node.js Promptfoo sidecar (`app/promptfoo-sidecar/`) that executes eval runs against scenarios. Scenarios are stored as `eval_prompt_sets` containing `eval_prompt_cases`, each case holding an `assertions_json` blob. Eval runs and their results are persisted in `eval_runs` / `eval_run_results`, and description optimization produces `description_candidates`. This is too complex for the current product direction, which only needs a UI to create/edit scenarios and assertions stored in the database.

## Goals

1. Remove all Promptfoo integration from the app (sidecar package, Rust module, execution commands).
2. Simplify the DB schema to `scenarios` + `assertions`.
3. Preserve the existing scenario CRUD UI with minimal changes.
4. Drop eval-run history, description candidates, and all execution-related commands.

## Non-Goals

- Do not touch `tests/evals/` (root-level Promptfoo harness for agent regression tests).
- Do not redesign the scenario editor UI beyond renaming "expectations" → "assertions".
- Do not add a new eval execution engine; execution will be redesigned later.

## Data Model

### New Tables

#### `scenarios`

| Column         | Type     | Constraints                                           |
|----------------|----------|-------------------------------------------------------|
| `id`           | TEXT     | PRIMARY KEY                                           |
| `plugin_slug`  | TEXT     | NOT NULL                                              |
| `skill_name`   | TEXT     | NOT NULL                                              |
| `name`         | TEXT     | NOT NULL                                              |
| `mode`         | TEXT     | NOT NULL, CHECK (`performance` or `trigger`)          |
| `prompt`       | TEXT     | NOT NULL                                              |
| `should_trigger`| INTEGER | NULL (meaningful only when `mode = 'trigger'`)        |
| `sort_order`   | INTEGER  | NOT NULL DEFAULT 0                                    |
| `created_at`   | TEXT     | NOT NULL                                              |
| `updated_at`   | TEXT     | NOT NULL                                              |

Index: `idx_scenarios_skill` on `(plugin_slug, skill_name, sort_order)`.

#### `assertions`

| Column        | Type     | Constraints                                           |
|---------------|----------|-------------------------------------------------------|
| `id`          | TEXT     | PRIMARY KEY                                           |
| `scenario_id` | TEXT     | NOT NULL, REFERENCES `scenarios(id)` ON DELETE CASCADE|
| `assertion`   | TEXT     | NOT NULL                                              |
| `sort_order`  | INTEGER  | NOT NULL DEFAULT 0                                    |

Index: `idx_assertions_scenario` on `(scenario_id, sort_order)`.

### Tables to Drop

- `eval_prompt_sets`
- `eval_prompt_cases`
- `eval_runs`
- `eval_run_results`
- `description_candidates`

### Migration Strategy

1. Create `scenarios` and `assertions` tables.
2. For every `eval_prompt_set` + its `eval_prompt_cases` rows, create one `scenario` and N `assertion` rows.
3. Drop old tables, indexes, and foreign-key references.
4. Migration is **destructive** — eval run history is intentionally discarded.

## Rust API Surface

### Commands to Keep (adapted)

| Command               | Notes                                                    |
|-----------------------|----------------------------------------------------------|
| `list_scenarios`      | Query `scenarios` + `assertions` for a skill.            |
| `load_scenario`       | Read one scenario + joined assertions.                   |
| `create_scenario`     | Insert empty scenario with default assertion.            |
| `save_scenario`       | Upsert scenario; replace assertions in transaction.      |
| `delete_scenario`     | Delete by id (assertions cascade).                       |
| `suggest_scenario`    | Keep LLM suggestion logic; adapt to new types.           |
| `generate_scenarios`  | Keep bulk generation; adapt to new types.                |

### Commands to Remove

- `run_eval_workbench`
- `cancel_eval_workbench_run`
- `list_eval_runs`
- `read_eval_run`
- `suggest_description_candidates`
- `apply_description_candidate`
- `build_refine_improvement_brief`

## Code Deletion List

1. **`app/promptfoo-sidecar/`** — entire directory (package, dist, tests).
2. **`app/src-tauri/src/agents/promptfoo_sidecar/`** — Rust module (`mod.rs`, `process.rs`, `protocol.rs`, `tests.rs`).
3. **`app/src-tauri/src/commands/eval_workbench/mod.rs`** — remove all eval-run execution, refine, description-candidate logic. Keep scenario CRUD.
4. **`app/src-tauri/src/db/eval_workbench.rs`** — remove types and functions for runs, results, candidates, prompt sets, prompt cases. Add `scenarios` and `assertions` CRUD.
5. **Frontend components to remove:**
   - `eval-workbench/run-history.tsx`
   - `eval-workbench/result-table.tsx`
   - `eval-workbench/candidate-cards.tsx`
   - `eval-workbench/use-run-history.ts`
6. **`workspace-eval-workbench.tsx`** — strip out run-history and candidate-comparison UI; keep scenario list + editor.
7. **`lib/eval-workbench.ts`** — remove `EvalRun`, `EvalRunResult`, `DescriptionCandidate`, `RunEvalWorkbenchRequest`, and all run-related helpers. Keep `Scenario`, `Assertion` types and validation.
8. **`tauri-command-types.ts`** — remove deleted command signatures.
9. **`app/package.json`** — remove `promptfoo-sidecar:install`, `promptfoo-sidecar:build`, `postinstall` references.
10. **`app/src-tauri/tauri.conf.json`** — remove `promptfoo-sidecar/dist` from `bundle.resources`.
11. **`app/src-tauri/Cargo.toml`** — remove any promptfoo-sidecar resource references if present.

## Frontend Types

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

export interface SaveScenario {
  id?: string;
  name: string;
  prompt: string;
  mode: "performance" | "trigger";
  shouldTrigger?: boolean | null;
  assertions: string[];
}
```

The current `expectations` array is renamed to `assertions` in the type and UI labels. No other UI changes.

## Testing Impact

- **Rust DB tests** in `db/tests.rs` that reference old tables must be updated or removed.
- **Frontend unit tests** for eval-run helpers should be removed.
- **E2E tests** in `app/e2e/evals/` and `app/e2e/description/` that exercise eval runs will fail and need to be removed or stubbed.
- **Agent structural tests** unaffected (no agent sources change).

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Data loss from destructive migration | Acceptable — user explicitly wants to discard eval run history. |
| Tauri build breaks from missing resource | Ensure `tauri.conf.json` and `Cargo.toml` are cleaned up. |
| Frontend compile errors from deleted types | Systematically update `tauri-command-types.ts` and `lib/eval-workbench.ts`. |
| CI breaks from deleted test paths | Update or remove E2E specs that depend on eval-run commands. |

## Rollback

This change is **not rollback-safe** because the migration drops old tables. A backup of the SQLite database should be taken before the migration runs in production.

## Open Questions

None — design approved by user.
