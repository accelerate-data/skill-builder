# Simplification Review: VU-1178 Eval Workbench Clean Break

- **Branch:** `feature/vu-1178-eval-workbench-clean-break-db-backed-scenario-and-assertion`
- **Review Date:** 2026-05-09
- **Scope:** 97 files changed, -2938/+2612 lines (net -326)

## Summary

This branch removes eval-run execution, migrates scenario storage from files to SQLite, and switches scenario generation to use the selected-skill OpenHands conversation. The diff deletes `scenarios.rs` (331 lines), `eval-run.ts`, `eval-running-state.ts`, and removes `model`/`argumentHint` fields across the stack.

The overall direction is sound — less code, fewer abstractions, clearer ownership. Below are simplification opportunities, ordered by severity. Some overlap with the existing review at `vu-1178-simplification-review-2026-05-09.md`; new findings are marked.

---

## Findings

### Medium

#### 1. Duplicated blank draft initialization in `workspace-evals.tsx`

**File:** `app/src/components/workspace/workspace-evals.tsx:48-61` and `73-81`

The same 8-line object literal for creating a blank draft scenario appears twice — once in the `useState` initializer and again in the `useEffect` body:

```tsx
// useState initializer
return {
  id: `case-${crypto.randomUUID().slice(0, 8)}`,
  pluginSlug: "plugin" in skill ? skill.plugin_slug : "default",
  skillName: "name" in skill ? skill.name : skill.skill_name,
  name: "",
  prompt: "",
  assertions: [],
  tags: ["performance"],
};

// useEffect body — identical
setDraft({ ...same object... });
```

**Recommendation:** Use the existing `createDraftScenario(pluginSlug, skillName)` from `eval-workbench.ts` in both places. It already produces this exact shape.

---

#### 2. `scenario_summary_to_dto` duplicates 4 of 5 fields from `scenario_to_dto`

**File:** `app/src-tauri/src/commands/eval_workbench/mod.rs:62-70`

Both functions map the same source struct (`eval_workbench::Scenario`) and share `id`, `plugin_slug`, `skill_name`, `name`, and `tags` field assignments.

**Recommendation:** Derive `ScenarioSummaryDto` from `ScenarioDto` to avoid maintaining two parallel field lists:

```rust
fn scenario_summary_to_dto(scenario: eval_workbench::Scenario) -> ScenarioSummaryDto {
    let dto = scenario_to_dto(scenario);
    ScenarioSummaryDto {
        id: dto.id,
        plugin_slug: dto.plugin_slug,
        skill_name: dto.skill_name,
        name: dto.name,
        tags: dto.tags,
    }
}
```

---

#### 3. Redundant `as ScenarioDto` cast in `workspace-eval-workbench.tsx` **[NEW]**

**File:** `app/src/components/workspace/workspace-eval-workbench.tsx:85`

```tsx
const savedScenario = await generateEvalScenarioAssertionsMutation.mutateAsync({ scenarioName }) as ScenarioDto;
```

The mutation hook (`useGenerateEvalScenarioAssertions`) already returns `ScenarioDto` via its `mutationFn`. The `as ScenarioDto` cast at the call site is redundant and suggests the caller doesn't trust the hook's type contract.

**Recommendation:** Remove the `as ScenarioDto` cast. The mutation's return type is already typed correctly.

---

#### 4. Local `SaveScenarioOptions` type shadows the same concept in the child component **[NEW]**

**File:** `app/src/components/workspace/workspace-eval-workbench.tsx:58-60`

```tsx
type SaveScenarioOptions = {
  previousScenarioName?: string | null;
};
```

This type is defined locally inside the component body and mirrors the `options` parameter shape expected by `WorkspaceEvals`'s `onSaveScenario` prop. It adds no value over an inline type or using the child's interface.

**Recommendation:** Either inline the type at the function parameter or lift it to a shared module if it's truly needed across components. Given it's only used by one function, inlining is simplest:

```tsx
async function handleSaveScenario(
  scenario: ScenarioDto,
  options?: { previousScenarioName?: string | null },
) {
```

---

#### 5. `previousScenarioName` flows through the frontend but is never sent to Tauri **[NEW]**

**Files:** `workspace-evals.tsx:92`, `workspace-eval-workbench.tsx:66-72`, `queries/eval-scenarios.ts:59-72`

The `previousScenarioName` parameter is threaded through `handleSave` → `onSaveScenario` → mutation `onSuccess` for cache invalidation (removing the old query key when a scenario is renamed). This is correct behavior — the Rust `save_scenario` command no longer needs it since SQLite updates by `id`, not file rename.

However, the `SaveScenarioMutationInput` type in `queries/eval-scenarios.ts` still carries `previousScenarioName` as part of its interface, which could mislead readers into thinking it's sent to the backend.

**Recommendation:** Add a comment on `SaveScenarioMutationInput.previousScenarioName` clarifying it's for cache invalidation only, not IPC. Or rename the type to make the distinction clearer (e.g., `SaveScenarioMutationInput` → `SaveScenarioMutationVars` with a `cache` sub-object).

---

#### 6. `handleCreateScenario` is a single-use wrapper

**File:** `app/src/components/workspace/workspace-evals.tsx:123-131`

This function is only called from one place (the empty-state "New scenario" button). It duplicates the error-handling pattern already used in `handleGenerate` and `handleDelete`.

**Recommendation:** Inline it into the button's `onClick` handler, or extract a shared `withErrorHandling` helper if the pattern appears elsewhere.

---

### Low

#### 7. Unnecessary `use tokio::sync::mpsc;` inside `setup_turn_listeners`

**File:** `app/src-tauri/src/commands/eval_workbench/mod.rs:176`

The `TurnListener` struct already uses `tokio::sync::mpsc::UnboundedReceiver` at module scope. The local `use` inside the function is redundant.

**Recommendation:** Remove the local `use tokio::sync::mpsc;` — `mpsc::unbounded_channel()` is already in scope.

---

#### 8. `tags: ["performance"]` is hardcoded but `ScenarioTag` is a single-value type

**File:** `app/src/lib/eval-workbench.ts:3`

```ts
export type ScenarioTag = "performance";
```

Since `ScenarioTag` can only ever be `"performance"`, the `tags` field and the `EvalWorkbenchMode` single-variant enum on the Rust side are redundant.

**Recommendation:** Known design smell from when multiple modes were planned. Not urgent, but worth noting for future simplification.

---

#### 9. `_onNavigateToRefine` and `_scenarioLoading` are unused props **[NEW]**

**Files:**
- `workspace-eval-workbench.tsx:25`: `onNavigateToRefine: _onNavigateToRefine`
- `workspace-evals.tsx:36`: `scenarioLoading: _scenarioLoading = false`

These props are accepted but never read. The `_` prefix convention signals intentional discard, but if they're truly unused, they should be removed from the interface to reduce cognitive load.

**Recommendation:** Remove `onNavigateToRefine` from `WorkspaceEvalWorkbenchProps` and `scenarioLoading` from `WorkspaceEvalsProps` unless they're planned for near-term use.

---

#### 10. `workspace_run_dir` equals `workspace_root_dir` in generation config

**File:** `app/src-tauri/src/commands/eval_workbench/mod.rs:415-416`

```rust
workspace_root_dir: runtime_ctx.workspace_path.clone(),
workspace_run_dir: format!("{}/.openhands/eval-generate", runtime_ctx.workspace_path),
```

Actually this is NOT the same — `workspace_run_dir` points to a subdirectory. The existing review incorrectly flagged this as a duplicate. No action needed.

---

#### 11. `create_scenario` name-generation loop is fine inline

**File:** `app/src-tauri/src/commands/eval_workbench/mod.rs:300-311`

The "Performance N" name-generation loop was previously in a dedicated function. It's now inline in `create_scenario`, which is simpler for a single caller. No change needed.

---

## What Went Well

1. **Clean removal of `scenarios.rs`** — the entire file-based scenario module (331 lines) was cleanly replaced with a SQLite-backed `eval_workbench.rs` DB module. No orphaned references remain.

2. **Race condition fix in generation listener** — Tauri event listeners are set up *before* dispatching the OpenHands message, fixing a real race where events could arrive before listeners were registered.

3. **`eval-running-state.ts` removal** — the module-scoped mutable state pattern was a known anti-pattern. Removing it entirely is the right call.

4. **`model`/`argumentHint` field removal** — cleanly excised from the entire stack (Rust types, DB migrations, frontend types, dialogs, Tauri command contracts). Migration 50 (`run_drop_model_argument_hint_migration`) handles the schema cleanup.

5. **Net-negative diff** — removing ~326 lines while adding DB-backed storage and OpenHands conversation integration is a good signal that complexity is decreasing, not increasing.

---

## Verdict

**Approve** — The branch is well-scoped and the simplifications identified above are all non-blocking improvements. None indicate a design flaw or correctness issue.

---

## Recommended Follow-ups

1. Replace duplicated draft initialization in `workspace-evals.tsx` with `createDraftScenario()` calls.
2. Derive `ScenarioSummaryDto` from `ScenarioDto` in Rust to eliminate field duplication.
3. Remove the redundant `as ScenarioDto` cast in `workspace-eval-workbench.tsx:85`.
4. Inline or remove the local `SaveScenarioOptions` type in `workspace-eval-workbench.tsx`.
5. Remove the redundant `use tokio::sync::mpsc;` inside `setup_turn_listeners`.
6. Remove unused `_onNavigateToRefine` and `_scenarioLoading` props if not planned for near-term use.
7. Add a clarifying comment on `SaveScenarioMutationInput.previousScenarioName` to indicate it's for cache invalidation only.
