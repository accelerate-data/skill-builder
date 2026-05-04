# Workflow State Machine

Four-step pipeline that generates a skill. Each step is an agent or reasoning run. State is persisted to SQLite and reconstructed on app restart.

## Steps

| ID | Name | Agent type | Model | Step output | Clarifications editable |
|---|---|---|---|---|---|
| 0 | Research | agent | sonnet | DB rows: `clarifications` + `clarification_*` tables | Yes |
| 1 | Detailed Research | agent | sonnet | DB rows: updates `clarifications` + sections/questions/refinements in-place | Yes |
| 2 | Confirm Decisions | reasoning | opus | DB rows: `decisions` + `decision_items` tables | No |
| 3 | Generate Skill | agent | sonnet | `SKILL.md`, `references/` under `<skills_path>/<skill_name>/` | No |

Steps 0–2 write to SQLite only. Step 3 writes to the skills path filesystem (`SKILL.md`, `references/`).

---

## Usage Step Semantics (All UI Surfaces)

Usage tracking uses one shared step taxonomy across Workflow, Refine, and Test.

| Surface | Persisted step ID | Usage label | Session grouping key |
|---|---:|---|---|
| Workflow page | `0` | `Research` | `workflowSessionId` from `useWorkflowStore` |
| Workflow page | `1` | `Detailed Research` | `workflowSessionId` from `useWorkflowStore` |
| Workflow page | `2` | `Confirm Decisions` | `workflowSessionId` from `useWorkflowStore` |
| Workflow page | `3` | `Generate Skill` | `workflowSessionId` from `useWorkflowStore` |
| Refine page | `-10` | `Refine` | `synthetic:refine:<skill>:<refine-session-id>` |
| Test page | `-11` | `Test` | `synthetic:test:<skill>:<test-id>` |

Legacy workflow rows with step IDs `4` and `5` are mapped to `Confirm Decisions` and `Generate Skill` for backward compatibility in usage surfaces.

---

## Cross-Surface Usage Rules

- Usage charts and session details always render labels from the canonical step mapping.
- Refine runs are grouped per refine session (not per streamed agent turn).
- Test runs (with-skill, without-skill, evaluator) are grouped into one synthetic test session for the selected skill.
- Usage "Cost by Step" includes both workflow steps and synthetic `Refine`/`Test` buckets.

---

## Step States

```text
          start
pending ─────────► in_progress ──── success ───► completed
                        │                             │
                        └──── failure ────► error     │
                                              │        │
                                      reset ◄┘   reset (sidebar
                                              │    or button)
                                              └──► pending
```

Valid statuses: `pending | in_progress | waiting_for_user | completed | error`

### Error subtypes

| Subtype | Cause | Recovery |
|---|---|---|
| `structured_output_missing` | Agent completed a JSON-contract run but the final text did not contain parseable contract JSON. | Retry the step. |
| *(general)* | Agent runtime error, timeout, or sidecar failure. | Retry or reset the step. |

---

## Global State (Zustand `useWorkflowStore`)

| Field | Type | Cleared by |
|---|---|---|
| `currentStep` | `0–3` | `initWorkflow`, `reset` |
| `reviewMode` | `boolean` | `initWorkflow` (→ `true`), `consumeUpdateMode` (→ `false`) |
| `isRunning` | `boolean` | Agent complete/fail, reset |
| `isInitializing` | `boolean` | `clearInitializing` |
| `disabledSteps` | `number[]` | `resetToStep`, `initWorkflow`, `reset` |
| `workflowSessionId` | `string \| null` | `initWorkflow`, `reset` (UUID created once per session) |
| `gateLoading` | `boolean` | Gate agent completes |

---

## State Transitions

### Step 0 — Research

| Trigger | From | To | Effect |
|---|---|---|---|
| "Start Step" (update mode) | `pending` | `in_progress` | — |
| Agent completes | `in_progress` | `completed` | Writes `clarifications` + `clarification_*` DB rows |
| Agent fails | `in_progress` | `error` | — |
| "Reset Step" button on current step | `completed / error` | `pending` | `resetWorkflowStep(0)` → deletes clarifications + decisions DB rows + `SKILL.md` + `references/`; `resetToStep(0)` |
| Sidebar click step 0 from later step (update mode) | `completed` | `pending` | `ResetStepDialog` → `resetWorkflowStep(0)` (same deletions); `resetToStep(0)` marks step 0 **pending** so it re-runs |
| Sidebar click step 0 (review mode) | `completed` | navigates, no state change | None |

### Step 1 — Detailed Research

| Trigger | From | To | Effect |
|---|---|---|---|
| Auto-advance from step 0 (or gate "Research more") | `pending` | `in_progress` | — |
| Agent completes | `in_progress` | `completed` | Updates `clarifications` + sections/questions/refinements DB rows in-place |
| Agent fails | `in_progress` | `error` | — |
| "Reset Step" button on current step | `completed / error` | `pending` | `resetWorkflowStep(1)` → step 1 has no DB-only artifact, so only `decisions` DB rows + `SKILL.md` are deleted; clarifications rows are **preserved**; `resetToStep(1)` |
| Sidebar click step 1 from step 2/3 (update mode) | `completed` | stays `completed` | `ResetStepDialog` → `resetWorkflowStep(1)` (same preservation); `navigateBackToStep(1)` keeps step 1 completed, resets steps 2–3 to pending |

**Key invariant**: resetting step 1 never deletes step 0 artifacts. Step 1 is a refinement pass over existing clarifications — step 0 DB rows remain valid.

### Step 2 — Confirm Decisions

| Trigger | From | To | Effect |
|---|---|---|---|
| Auto-advance from step 1 + transition gate passes | `pending` | `in_progress` | — |
| Reasoning completes | `in_progress` | `completed` | Writes `decisions` + `decision_items` DB rows |
| Reasoning fails | `in_progress` | `error` | — |
| "Reset Step" button | `completed / error` | `pending` | `resetWorkflowStep(2)` → deletes `decisions` DB rows + `SKILL.md`; `resetToStep(2)` |
| Sidebar click step 2 from step 3 (update mode) | `completed` | stays `completed` | `ResetStepDialog` → `resetWorkflowStep(2)` → deletes `SKILL.md` only; `navigateBackToStep(2)` |

### Step 3 — Generate Skill

| Trigger | From | To | Disk effect |
|---|---|---|---|
| Auto-advance from step 2 + decision guard passes | `pending` | `in_progress` | — |
| Agent completes | `in_progress` | `completed` | Writes `SKILL.md`, `references/` to skills path |
| Agent fails | `in_progress` | `error` | Partial files possible |
| "Reset Step" button | `completed / error` | `pending` | `resetWorkflowStep(3)` → deletes `SKILL.md`, `references/`; `resetToStep(3)` |

---

## Transition Gate (Steps 0 → 1 and 1 → 2)

After step 0 completes, `runAnswerEvaluator` runs in the background. The gate controls whether the workflow advances automatically or pauses for the user.

| Verdict | User action | Outcome |
|---|---|---|
| `sufficient` | Skip | `skipToDecisions()` — step 2, steps 1+2 in-progress |
| `sufficient` | Research more | Advance to step 1 |
| `mixed` | Auto-fill | Answers filled, advance to step 1 or 2 |
| `mixed` | Let me answer | Stay on step 0 completion screen |
| `insufficient` | Auto-fill | Answers filled, continue |
| `insufficient` | Let me answer | Stay on step 0 |
| Gate agent error | — | Fails open → continues to step 1 |

---

## Step Reset Cascade

`resetWorkflowStep(fromStepId)` in Rust calls `delete_step_output_files(fromStepId)` which iterates `fromStepId..=3` and deletes each step's artifacts. Steps 0–2 own DB rows; step 3 owns filesystem files.

| `fromStepId` | DB rows deleted | Filesystem files deleted |
|---|---|---|
| 0 | `clarifications` + `clarification_*` rows, `decisions` + `decision_items` rows | `SKILL.md` + `references/` |
| 1 | `decisions` + `decision_items` rows (clarifications rows preserved) | `SKILL.md` + `references/` |
| 2 | `decisions` + `decision_items` rows | `SKILL.md` + `references/` |
| 3 | *(none)* | `SKILL.md` + `references/` |

Also resets SQLite `workflow_steps.status` for `step_id >= fromStepId`.

---

## `disabledSteps` Guards

Read from DB after each step completes and after each reset.

| Condition | Disabled steps | Effect |
|---|---|---|
| `clarifications.scope_recommendation = 1` | `[1, 2, 3]` | Steps grayed out; user must refine scope |
| `decisions.contradictory_inputs_state = 'active'` | `[3]` | Generate Skill blocked until decisions are fixed |
| After any `resetToStep()` | `[]` | Guards re-evaluated from DB after next step |

---

## Store Actions Reference

| Action | Steps affected | `currentStep` | Notes |
|---|---|---|---|
| `resetToStep(n)` | `steps[n..3]` → `pending` | `n` | Used when re-running step n from scratch (files already deleted) |
| `navigateBackToStep(n)` | `steps[n+1..3]` → `pending` | `n` | Used when navigating back to view a completed step; step n stays `completed` |
| `loadWorkflowState(ids, saved)` | ids → `completed` | `saved` or first incomplete | Hydration from SQLite on app start |
| `initWorkflow(skill, purpose)` | all → `pending` | `0` | On skill open; resets `reviewMode: true` |

### `resetToStep` vs `navigateBackToStep`

- `resetToStep(0)` — step 0 becomes pending (its files were deleted, must re-run)
- `navigateBackToStep(1)` — step 1 stays completed (files intact, just viewing it again before re-running step 2+)

The sidebar-click flow uses `resetToStep(0)` only for step 0 (files deleted). All other steps use `navigateBackToStep` because the target step's files survive the `resetWorkflowStep` call.

---

## Review vs Update Mode

| Mode | `reviewMode` | Sidebar click | Pending step renders |
|---|---|---|---|
| Review | `true` | Navigate directly, no dialog, no deletion | "Switch to Update mode to run this step." |
| Update | `false` | If prior completed step → `ResetStepDialog`; if current/future → navigate | "Ready to run" + Start button |

`reviewMode` defaults to `true`. Switches to `false` when navigating in from the dashboard "Update" button (`pendingUpdateMode` flag) or when the user toggles the mode.

---

## Missing-Output Error Recovery

For steps 0–2, the frontend reads from DB; if no row exists for a completed step, `WorkflowStepComplete` renders an error state. For step 3, if `SKILL.md` is missing on disk despite a completed status, the same error state is shown. In both cases a **Reset Step** button (`onResetStep` prop) is shown in update mode, calling `performStepReset(currentStep)` to clear the stale completed status and re-run the step.

---

## Key Source Files

| File | Role |
|---|---|
| `app/src/stores/workflow-store.ts` | Zustand state, all step status/navigation actions |
| `app/src/pages/workflow.tsx` | Page component; `renderContent`, `performStepReset`, `onStepClick`, `ResetStepDialog` wiring |
| `app/src/components/workflow-step-complete.tsx` | Completion/error screen for each step |
| `app/src/components/reset-step-dialog.tsx` | Confirmation dialog for sidebar back-navigation |
| `app/src-tauri/src/commands/workflow.rs` | `reset_workflow_step`, `preview_step_reset`, `get_step_output_files` |
| `app/src-tauri/src/cleanup.rs` | `delete_step_output_files`, `clean_step_output_thorough` |
