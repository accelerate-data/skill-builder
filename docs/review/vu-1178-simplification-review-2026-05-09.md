# Simplification Review: VU-1178 Eval Workbench Clean Break

- **Branch:** `feature/vu-1178-eval-workbench-clean-break-db-backed-scenario-and-assertion`
- **Review Date:** 2026-05-09
- **Reviewer:** code-reviewer agent (code-simplifier lens)

## Summary

This branch removes eval-run execution, moves scenario storage from files to SQLite, and switches scenario generation to use selected-skill conversation via `send_openhands_message`. The diff is net-negative (~100 lines removed), removes the `scenarios.rs` module (331 lines), deletes `eval-run.ts` and `eval-running-state.ts`, and consolidates the generation flow. The overall direction is good — less code, fewer abstractions, clearer ownership.

Below are simplification opportunities found in the changed code, ordered by severity.

---

## Simplification Opportunities

### Medium

#### 1. Duplicated draft initialization in `workspace-evals.tsx`

**File:** `app/src/components/workspace/workspace-evals.tsx:48-61` and `73-81`

The same 8-line object literal for creating a blank draft scenario appears twice — once in the `useState` initializer and again in the `useEffect` body when `scenario` becomes null:

```tsx
// useState initializer (line 52-60)
return {
  id: `case-${crypto.randomUUID().slice(0, 8)}`,
  pluginSlug: "plugin" in skill ? skill.plugin_slug : "default",
  skillName: "name" in skill ? skill.name : skill.skill_name,
  name: "",
  prompt: "",
  assertions: [],
  tags: ["performance"],
};

// useEffect body (line 73-81) — identical
setDraft({
  id: `case-${crypto.randomUUID().slice(0, 8)}`,
  pluginSlug: "plugin" in skill ? skill.plugin_slug : "default",
  skillName: "name" in skill ? skill.name : skill.skill_name,
  name: "",
  prompt: "",
  assertions: [],
  tags: ["performance"],
});
```

**Recommendation:** Extract a helper `makeBlankDraft(skill)` or use the existing `createDraftScenario(pluginSlug, skillName)` from `eval-workbench.ts` in both places. The `createDraftScenario` function already exists and accepts the right parameters.

#### 2. `scenario_summary_to_dto` duplicates 4 of 5 fields from `scenario_to_dto`

**File:** `app/src-tauri/src/commands/eval_workbench/mod.rs:50-70`

```rust
fn scenario_to_dto(scenario: eval_workbench::Scenario) -> ScenarioDto {
    ScenarioDto {
        id: scenario.id,
        plugin_slug: scenario.plugin_slug,
        skill_name: scenario.skill_name,
        name: scenario.name,
        tags: vec![scenario.mode.as_str().to_string()],
        prompt: scenario.prompt,
        assertions: scenario.assertions,
    }
}

fn scenario_summary_to_dto(scenario: eval_workbench::Scenario) -> ScenarioSummaryDto {
    ScenarioSummaryDto {
        id: scenario.id,
        plugin_slug: scenario.plugin_slug,
        skill_name: scenario.skill_name,
        name: scenario.name,
        tags: vec![scenario.mode.as_str().to_string()],
    }
}
```

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

Or better yet, if `ScenarioSummaryDto` is always a subset, consider using `#[serde(flatten)]` or a shared base struct.

#### 3. Unused `_previous_scenario_name` parameter in `save_scenario` Tauri command

**File:** `app/src-tauri/src/commands/eval_workbench/mod.rs:330`

```rust
pub fn save_scenario(
    ...
    _previous_scenario_name: Option<String>,
    ...
) -> Result<ScenarioDto, String> {
```

The parameter was needed for file-based rename semantics (delete old file, write new). With SQLite, the scenario is identified by `id`, so rename is just an update. The parameter is now dead weight but still part of the Tauri IPC contract.

**Recommendation:** If the frontend still passes it, keep it but add a `#[allow(unused)]` or a comment explaining why it's retained for backward compat. If the frontend no longer passes it, remove it from both the Rust command and the frontend `saveScenario` wrapper.

#### 4. `handleCreateScenario` is a single-use wrapper

**File:** `app/src/components/workspace/workspace-evals.tsx:123-131`

```tsx
async function handleCreateScenario() {
  if (!onCreateScenario) return;
  setActionError(null);
  try {
    await onCreateScenario();
  } catch (err) {
    setActionError(getErrorMessage(err));
  }
}
```

This function is only called from one place (the empty-state "New scenario" button at line 150). It duplicates the error-handling pattern already used in `handleGenerate` and `handleDelete`.

**Recommendation:** Inline it into the button's `onClick` or extract a shared `withErrorHandling` helper if the pattern repeats elsewhere.

### Low

#### 5. Unnecessary `use tokio::sync::mpsc;` inside `setup_turn_listeners`

**File:** `app/src-tauri/src/commands/eval_workbench/mod.rs:168`

```rust
fn setup_turn_listeners(
    app: &tauri::AppHandle,
    agent_id: &str,
) -> TurnListener {
    use tokio::sync::mpsc;  // <-- unnecessary local import
```

The `TurnListener` struct at line 158 already uses `tokio::sync::mpsc::UnboundedReceiver` at module scope. The local `use` inside the function is redundant.

**Recommendation:** Remove the local `use tokio::sync::mpsc;` and use `mpsc::unbounded_channel()` directly (it's already in scope via the struct definition).

#### 6. `tags: ["performance"]` is hardcoded but `ScenarioTag` is a single-value type

**File:** `app/src/lib/eval-workbench.ts:3` and `workspace-evals.tsx:59`

```ts
export type ScenarioTag = "performance";
```

Since `ScenarioTag` can only ever be `"performance"`, the `tags` field on `SaveScenario` and the `tags: ["performance"]` default are redundant. The `EvalWorkbenchMode` enum on the Rust side is similarly a single-variant enum.

**Recommendation:** This is a known design smell from when multiple modes were planned. Not urgent to fix, but worth noting as future simplification when the single-variant constraint is confirmed permanent.

#### 7. `workspace_run_dir` set to same value as `workspace_root_dir`

**File:** `app/src-tauri/src/commands/eval_workbench/mod.rs:415-416`

```rust
workspace_root_dir: runtime_ctx.workspace_path.clone(),
workspace_run_dir: runtime_ctx.workspace_path.clone(),
```

This is correct now that throwaway runtimes are removed — both point to the workspace. However, the `OpenHandsRuntimeConfigParams` struct still has both fields, and passing the same value twice is a mild code smell.

**Recommendation:** No immediate action needed, but consider whether `workspace_run_dir` should become optional or default to `workspace_root_dir` in the config builder.

#### 8. `create_scenario` duplicates the `next_default_scenario_name` loop from old code

**File:** `app/src-tauri/src/commands/eval_workbench/mod.rs:298-310`

The name-generation loop (checking for unused "Performance N" names) was previously in a dedicated `next_default_scenario_name` function. It's now inline in `create_scenario`. This is actually fine — the function was only called once even before. But if more scenario creation paths appear, consider extracting it back.

**Recommendation:** No change needed. Inline is simpler for a single caller.

---

## What Went Well

1. **Clean removal of `scenarios.rs`** — the entire file-based scenario module (331 lines) was cleanly replaced with a SQLite-backed `eval_workbench.rs` DB module. The `scenarios.rs` deletion is complete with no orphaned references.

2. **Race condition fix in generation listener** — the commit `cda68c60` correctly sets up Tauri event listeners *before* dispatching the OpenHands message, fixing a real race where events could arrive before listeners were registered.

3. **`eval-run.ts` and `eval-running-state.ts` removal** — the module-scoped mutable state pattern in `eval-running-state.ts` was a known anti-pattern. Removing it entirely (along with the eval-run execution it supported) is the right call.

---

## Verdict

**Approve** — The branch is well-scoped and the simplifications identified above are all non-blocking improvements. None of them indicate a design flaw or correctness issue; they are opportunities to reduce duplication and dead parameters in follow-up work.

---

## Next Steps (Optional)

1. Replace duplicated draft initialization in `workspace-evals.tsx` with `createDraftScenario()` calls.
2. Derive `ScenarioSummaryDto` from `ScenarioDto` to eliminate field duplication.
3. Decide whether to keep or remove `_previous_scenario_name` from `save_scenario` based on frontend usage.
4. Remove the redundant `use tokio::sync::mpsc;` inside `setup_turn_listeners`.
