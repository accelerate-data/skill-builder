# Implementation Plan: Delete Clarifications & Decisions on Workflow Step Reset

## Problem

When a user resets a workflow step in **update mode**, the clarifications and decisions from the previous run remain in the database. This causes stale data to persist across workflow iterations.

## Workflow Semantics

| Mode | Purpose | Reset Available? |
|---|---|---|
| **Review** | User navigates to view completed step responses | ❌ No |
| **Update** | User re-runs steps, answers clarifications, etc. | ✅ Yes |

## Step → Artifact Mapping

| Step | Produces | DB Table |
|---|---|---|
| 0 (Research) | Clarifications | `clarifications` |
| 1 (Detailed Research) | Clarifications | `clarifications` |
| 2 (Decisions) | Decisions | `decisions` + `decision_items` |
| 3 (Generate Skill) | SKILL.md on disk | — |
| 4 (Publish) | Version tag + publish | — |

## Reset Behavior

The frontend already cascades step 1 resets to step 0. When the user clicks
"reset step 1", the UI calls `resetWorkflowStep(stepId=0)`, not stepId=1.
This is confirmed by frontend tests:
- `workflow.test.tsx:2396` — "onResetStep on step 1 calls resetWorkflowStep with stepId 0"
- `workflow.test.tsx:2426` — "Must reset from step 0, not step 1, so clarifications.json is deleted"

So the backend only receives these `from_step_id` values for reset:

| Reset from (backend receives) | Steps re-run | Delete clarifications? | Delete decisions? |
|---|---|---|---|
| 0 | 0, 1, 2, 3, 4 | ✅ Yes (steps 0 & 1 produce them) | ✅ Yes (step 2 produces them) |
| 2 | 2, 3, 4 | ❌ No (step 0 already completed) | ✅ Yes (step 2 produces them) |
| 3 | 3, 4 | ❌ No | ❌ No (disk files only) |
| 4 | 4 | ❌ No | ❌ No (publish only) |

## What Stays the Same

- `navigate_back_to_step` — review mode only, no deletion
- `save_workflow_run` — generic upsert, no deletion
- `delete_skill` — already handles this correctly

## Implementation

### File: `app/src-tauri/src/commands/workflow/evaluation.rs`

In `reset_workflow_step()`, after the git checkpoint and before `reset_workflow_steps_from`:

```rust
// Delete stale artifacts based on which step is being reset.
// Steps re-run = from_step_id and all subsequent steps.
let conn = db.0.lock().map_err(|e| e.to_string())?;

match from_step_id {
    0 | 1 => {
        // Steps 0/1 re-run → steps 0,1 (clarifications) and 2 (decisions) will be re-executed
        crate::db::workflow_artifacts::delete_clarifications(&conn, &skill_name)
            .map_err(|e| e.to_string())?;
        crate::db::workflow_artifacts::delete_decisions(&conn, &skill_name)
            .map_err(|e| e.to_string())?;
        log::info!(
            "[reset_workflow_step] cleared clarifications and decisions for '{}' (resetting from step {})",
            skill_name, from_step_id
        );
    }
    2 => {
        // Step 2 re-run → decisions will be re-executed, clarifications from step 0 remain valid
        crate::db::workflow_artifacts::delete_decisions(&conn, &skill_name)
            .map_err(|e| e.to_string())?;
        log::info!(
            "[reset_workflow_step] cleared decisions for '{}' (resetting from step {})",
            skill_name, from_step_id
        );
    }
    _ => {
        // Steps 3+ re-run → no DB artifacts to clear (disk files only)
    }
}
```

### Tests

**File:** `app/src-tauri/src/commands/workflow/evaluation.rs` (test module)

Add three tests:

1. `test_reset_step_0_clears_clarifications_and_decisions`
   - Seed clarifications + decisions
   - Reset from step 0
   - Assert both deleted

2. `test_reset_step_1_clears_clarifications_and_decisions`
   - Seed clarifications + decisions
   - Reset from step 1
   - Assert both deleted

3. `test_reset_step_2_clears_decisions_preserves_clarifications`
   - Seed clarifications + decisions
   - Reset from step 2
   - Assert decisions deleted, clarifications preserved

### Existing Tests

Verify existing `reset_workflow_step` tests still pass (they don't seed clarifications/decisions, so no change needed).

## Files Changed

| File | Change |
|---|---|
| `app/src-tauri/src/commands/workflow/evaluation.rs` | Add step-aware cleanup in `reset_workflow_step` |
| `app/src-tauri/src/commands/workflow/evaluation.rs` (tests) | Add 3 new tests |

## Risk Assessment

- **Low risk**: Uses existing `delete_clarifications` and `delete_decisions` functions that are already tested
- **No migration needed**: Schema unchanged
- **No frontend changes**: Frontend already handles empty states

## Acceptance Criteria

- [ ] Reset from step 0 deletes both clarifications and decisions
- [ ] Reset from step 1 deletes both clarifications and decisions
- [ ] Reset from step 2 deletes decisions only, preserves clarifications
- [ ] Reset from step 3+ deletes nothing from DB
- [ ] New tests pass
- [ ] All existing tests pass (1087+)
- [ ] No clippy warnings on changed files
