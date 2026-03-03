# Workflow State Machine

Four-step pipeline that generates a skill. Each step is an agent or reasoning run. State is persisted to SQLite and reconstructed on app restart.

## Steps

| ID | Name | Agent type | Model | Output files | Clarifications editable |
|---|---|---|---|---|---|
| 0 | Research | agent | sonnet | `context/research-plan.md`, `context/clarifications.json` | Yes |
| 1 | Detailed Research | agent | sonnet | *(mutates `clarifications.json` in-place — no unique file)* | Yes |
| 2 | Confirm Decisions | reasoning | opus | `context/decisions.md` | No |
| 3 | Generate Skill | agent | sonnet | `SKILL.md`, `references/`, `<name>.skill` | No |

All output files live under `<skills_path>/<skill_name>/`. Steps 0–2 write into `context/`; step 3 writes directly into the skill root.

---

## Step States

```
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

| Trigger | From | To | Disk effect |
|---|---|---|---|
| "Start Step" (update mode) | `pending` | `in_progress` | — |
| Agent completes | `in_progress` | `completed` | Writes `research-plan.md` + `clarifications.json` |
| Agent fails | `in_progress` | `error` | Partial files possible |
| "Reset Step" button on current step | `completed / error` | `pending` | `resetWorkflowStep(0)` → deletes `research-plan.md`, `clarifications.json`, `decisions.md`, `SKILL.md` + `references/`; `resetToStep(0)` |
| Sidebar click step 0 from later step (update mode) | `completed` | `pending` | `ResetStepDialog` → `resetWorkflowStep(0)` (same deletions); `resetToStep(0)` marks step 0 **pending** so it re-runs |
| Sidebar click step 0 (review mode) | `completed` | navigates, no state change | None |

### Step 1 — Detailed Research

| Trigger | From | To | Disk effect |
|---|---|---|---|
| Auto-advance from step 0 (or gate "Research more") | `pending` | `in_progress` | — |
| Agent completes | `in_progress` | `completed` | Mutates `clarifications.json`; no unique file written |
| Agent fails | `in_progress` | `error` | — |
| "Reset Step" button on current step | `completed / error` | `pending` | `resetWorkflowStep(1)` → step 1 has **no files**, so only `decisions.md` + `SKILL.md` are deleted; `research-plan.md` and `clarifications.json` are **preserved**; `resetToStep(1)` |
| Sidebar click step 1 from step 2/3 (update mode) | `completed` | stays `completed` | `ResetStepDialog` → `resetWorkflowStep(1)` (same preservation); `navigateBackToStep(1)` keeps step 1 completed, resets steps 2–3 to pending |

**Key invariant**: resetting step 1 never deletes step 0 artifacts. Step 1 is a refinement pass over existing clarifications — step 0 output remains valid.

### Step 2 — Confirm Decisions

| Trigger | From | To | Disk effect |
|---|---|---|---|
| Auto-advance from step 1 + transition gate passes | `pending` | `in_progress` | — |
| Reasoning completes | `in_progress` | `completed` | Writes `decisions.md` |
| Reasoning fails | `in_progress` | `error` | — |
| "Reset Step" button | `completed / error` | `pending` | `resetWorkflowStep(2)` → deletes `decisions.md` + `SKILL.md`; `resetToStep(2)` |
| Sidebar click step 2 from step 3 (update mode) | `completed` | stays `completed` | `ResetStepDialog` → `resetWorkflowStep(2)` → deletes `SKILL.md` only; `navigateBackToStep(2)` |

### Step 3 — Generate Skill

| Trigger | From | To | Disk effect |
|---|---|---|---|
| Auto-advance from step 2 + decision guard passes | `pending` | `in_progress` | — |
| Agent completes | `in_progress` | `completed` | Writes `SKILL.md`, `references/`, `<name>.skill` |
| Agent fails | `in_progress` | `error` | Partial files possible |
| "Reset Step" button | `completed / error` | `pending` | `resetWorkflowStep(3)` → deletes `SKILL.md`, `references/`, `.skill`; `resetToStep(3)` |

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

## File Deletion Cascade

`resetWorkflowStep(fromStepId)` in Rust calls `delete_step_output_files(fromStepId)` which iterates `fromStepId..=3` and deletes each step's output files.

| `fromStepId` | Files deleted |
|---|---|
| 0 | `research-plan.md`, `clarifications.json`, `decisions.md`, `SKILL.md` + `references/` |
| 1 | *(nothing for step 1)*, `decisions.md`, `SKILL.md` + `references/` |
| 2 | `decisions.md`, `SKILL.md` + `references/` |
| 3 | `SKILL.md` + `references/` |

Also resets SQLite `workflow_steps.status` for `step_id >= fromStepId`.

---

## `disabledSteps` Guards

Read from disk after each step completes and after each reset.

| Condition | Disabled steps | Effect |
|---|---|---|
| `clarifications.json` → `scope_recommendation: true` | `[1, 2, 3]` | Steps grayed out; user must refine scope |
| `decisions.md` → `contradictory_inputs: true` | `[3]` | Generate Skill blocked until decisions are fixed |
| After any `resetToStep()` | `[]` | Guards re-evaluated from disk after next step |

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

## Missing-Files Error Recovery

When a completed step's output files are not found on disk (agent write failure or manual deletion), `WorkflowStepComplete` renders an error state instead of the step content. A **Reset Step** button (`onResetStep` prop) is shown in update mode, calling `performStepReset(currentStep)` to clear the stale completed status and re-run the step.

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
