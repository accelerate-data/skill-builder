# Review: VU-1176 — Make Escape interruption feel immediate and support steer-after-interrupt

- **Branch:** `feature/vu-1176-make-escape-interruption-feel-immediate-and-support-steer`
- **Review Date:** 2026-05-09
- **Reviewer:** code-reviewer agent

## Intent

Make pressing `Esc` during Refine, Workflow, or Eval runs feel immediate by introducing an optimistic local `isStopping` state that shows "stopping…" in the UI before the backend acknowledges the cancel. Replace per-page cancel buttons with a single Escape handler in `AppLayout`. Share a `RunStatusFooter` component across all three contexts.

## Scope Comparison

| Source | Claim / Requirement |
|--------|---------------------|
| **Linear Issue (VU-1176)** | 6 acceptance criteria covering optimistic state, UI distinction, steer-after-interrupt, shared contract, OpenHands limitation handling, and automated coverage |
| **Implementation Plan** | Add `isStopping` to 3 stores, single Escape handler in AppLayout, shared `RunStatusFooter`, remove cancel button from chat-input-bar, replace refine inline status bar |
| **Code Changes (18 files, +1400/-160)** | Stores: refine-store, workflow-store, eval-running-state. Components: app-layout, run-status-footer, agent-run-footer, workspace-refine, workspace-evals, chat-input-bar, chat-panel, chat-message-list. Tests: 7 test files updated/created |
| **Design Doc** | Not applicable (explicitly approved without spec) |

## Acceptance Criteria

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Pressing `Esc` puts the active run into an immediate local `stopping` state without waiting for backend acknowledgement | **Proven** | `app-layout.tsx:108-109` sets `refineStore.setStopping(true)` synchronously before `cancelAgentRun()`. Same pattern for workflow (line 120) and evals (line 136). Tests verify synchronous state change (app-layout.test.tsx lines 397-399, 447-449, 474-475). |
| 2 | The UI clearly distinguishes `interrupt requested` from fully stopped terminal states | **Proven** | `RunStatusFooter` has a dedicated `"stopping"` status with amber pulsing dot (`run-status-footer.tsx:37-40`, label `"stopping…"` at line 52). Tests verify rendering (run-status-footer.test.tsx). |
| 3 | The runtime path supports redirecting the conversation after interrupt without requiring the user to infer hidden backend state | **Open** | The `isStopping` → terminal transition clears `isStopping` for refine (workspace-refine.tsx:240), but **not for workflow or evals** (see Finding H1/H2). After a workflow cancel, the footer may remain stuck on "stopping…" which could confuse the user about whether they can redirect. |
| 4 | Refine and Workflow use the same interruption contract where applicable | **Proven** | Both stores have `isStopping: boolean` + `setStopping()`. Both are set optimistically in the same Escape handler. Both clear on error. Both reset on session init/clear. |
| 5 | If OpenHands cannot preempt an in-flight LLM completion, the product documents and handles that limitation explicitly | **Open** | No documentation or UI copy addresses the OpenHands step-boundary limitation. The "stopping…" label implies immediate action, but OpenHands may take seconds to respond. The error toast on cancel failure is the only feedback, but it doesn't explain *why*. |
| 6 | Automated coverage verifies the frontend state transition and backend pause/redirect integration contract | **Partial** | Frontend state transitions are well-tested (128 tests in affected files pass). Backend pause integration is tested via mocked Tauri commands. However, **no test exists for `AgentRunFooter` stopping state** (planned but not implemented), and **no test covers the workflow `isStopping` → terminal transition** clearing path. |

## Findings

### High

1. **[Skeptic] Workflow `isStopping` is never cleared when the run actually stops**
   - **Files:** `app/src/components/agent-run-footer.tsx:30`, `app/src/lib/workflow-teardown.ts:21`, `app/src/hooks/use-workflow-state-machine.ts:305,356,713,729,742,759,773,847`
   - **Problem:** `AgentRunFooter` gives `workflowIsStopping` absolute priority over the actual run status:
     ```typescript
     const footerStatus = workflowIsStopping ? "stopping" : ...run?.status === "running" ? "running" : "idle";
     ```
     When a workflow is cancelled via Escape, `isStopping` is set to `true`, but **no code path clears it** when the workflow actually stops. `teardownWorkflowSession` calls `setRunning(false)` but not `setStopping(false)`. All completion/error paths in `use-workflow-state-machine.ts` call `setRunning(false)` but never `setStopping(false)`. The footer will show "stopping…" indefinitely even after the workflow has completed.
   - **Impact:** User sees a permanently stuck "stopping…" status after any workflow interrupt. Cannot tell when the run has actually stopped.
   - **Recommendation:** Add `setStopping(false)` alongside every `setRunning(false)` call in the workflow completion/cancel/teardown paths. Alternatively, clear `isStopping` in `teardownWorkflowSession` and in the state machine's terminal handlers.

2. **[Skeptic] Eval `isStopping` is never cleared when eval run completes**
   - **Files:** `app/src/lib/eval-running-state.ts`, `app/src/components/workspace/workspace-evals.tsx:75-79`
   - **Problem:** `setEvalsStopping(false)` is only called on cancel error in `app-layout.tsx:139`. When an eval run completes normally, `_isStopping` remains `true` and the footer shows "stopping…" forever.
   - **Impact:** Same as H1 — stuck "stopping…" status after eval completion.
   - **Recommendation:** Clear `setEvalsStopping(false)` wherever `setEvalsRunning(false)` is called in production code. (Note: see H3 for the broader eval wiring issue.)

3. **[Skeptic] Eval running state is not wired in production — Escape handler path is dead code**
   - **Files:** `app/src/components/workspace/workspace-eval-workbench.tsx:30`, `app/src/lib/eval-running-state.ts:6`
   - **Problem:** `setEvalsRunning()` is **never called** in any production file. The `_onRunningChange` callback in `workspace-eval-workbench.tsx` is received but unused (prefixed with `_`). The `eval-running-state` module's `_isRunning` defaults to `false` and is never set to `true`. This means `getEvalsRunning()` always returns `false` in production, so the Escape handler's eval cancel guard (`if (getEvalsRunning() && !getEvalsStopping())`) never triggers.
   - **Impact:** The entire eval interruption path added by this branch is unreachable in production. The eval `RunStatusFooter` will always show "idle" (or "stopping" if somehow `evalsStopping` is set).
   - **Recommendation:** This is a pre-existing issue, but the branch should either: (a) wire up `setEvalsRunning` in the eval workbench so the new code actually works, or (b) acknowledge this as out of scope and not claim eval interruption support. The current tests pass only because they manually call `setEvalsRunning(true)`.

### Medium

4. **[Architect] `cleanupCurrentSelectedSkill` doesn't clear workflow `isStopping` on skill switch**
   - **Files:** `app/src/components/layout/app-layout.tsx:196-221`
   - **Problem:** When switching skills while a workflow is in `isStopping` state, `cleanupCurrentSelectedSkill` calls `cancelWorkflowStep()` and `refineStore.selectSkill(null)` (which clears refine's `isStopping` via `clearSession`), but **never clears `workflowStore.isStopping`**. The workflow store's stopping state persists across skill switches.
   - **Impact:** If a user interrupts a workflow, then switches skills, the workflow store remains in `isStopping` state. If they return to workflow later, the footer may show "stopping…" incorrectly.
   - **Recommendation:** Add `useWorkflowStore.getState().setStopping(false)` in `cleanupCurrentSelectedSkill`.

5. **[Skeptic] Workflow Escape handler sets `isStopping` even when no running agent is found**
   - **Files:** `app/src/components/layout/app-layout.tsx:118-132`
   - **Problem:** The workflow path checks `workflowStore.isRunning && !workflowStore.isStopping`, sets `isStopping(true)`, then searches for a running agent. If the agent-store lookup returns nothing (race condition between `isRunning` being set and the agent being registered), `cancelWorkflowStep` is never called but `isStopping` remains `true`. Since H1 shows `isStopping` is never cleared on completion, this creates a permanent stuck state.
   - **Impact:** In a race condition, the user sees "stopping…" forever with no backend cancel ever attempted.
   - **Recommendation:** If no running agent is found, clear `isStopping` immediately:
     ```typescript
     if (!running) {
       workflowStore.setStopping(false);
     }
     ```

6. **[Minimalist] No test for `AgentRunFooter` stopping state despite plan specifying it**
   - **Files:** `docs/plans/2026-05-09-immediate-escape-interruption.md` (Task 7), `app/src/__tests__/components/` (no `agent-run-footer.test.tsx`)
   - **Problem:** The implementation plan explicitly calls for tests verifying `AgentRunFooter` shows "stopping…" when `workflowIsStopping` is true. No such test file exists. The `AgentRunFooter` is the primary consumer of workflow `isStopping` state, and its priority logic (`workflowIsStopping ? "stopping" : ...`) is the exact code path affected by H1.
   - **Impact:** No automated guard against regressions in the most critical UI path for workflow interruption feedback.
   - **Recommendation:** Add `agent-run-footer.test.tsx` with tests for stopping, running, completed, and idle states.

### Low

7. **[Minimalist] `modelLabel` fallback changed from "No model selected" to `null`**
   - **Files:** `app/src/components/workspace/workspace-refine.tsx:384` (was `"No model selected"`, now `null`)
   - **Problem:** The old inline status bar showed "No model selected" when no model was configured. The new `RunStatusFooter` passes `null` for the model, which hides the model label entirely. This is a minor UX change — users lose visibility into the "no model configured" state.
   - **Recommendation:** Consider preserving the "No model selected" label or adding it as a separate indicator.

8. **[Minimalist] Workflow store has inconsistent indentation**
   - **Files:** `app/src/stores/workflow-store.ts:105`
   - **Problem:** Line 105 (`hydrated: false,`) uses 10-space indentation while surrounding lines use 6-space. Cosmetic only.
   - **Recommendation:** Fix indentation for consistency.

9. **[Architect] `chat-input-bar` `disabled` prop replaces `isRunning` editor lock**
   - **Files:** `app/src/components/refine/chat-panel.tsx:68`, `app/src/components/refine/chat-input-bar.tsx:265-266`
   - **Observation:** The old code disabled the editor when `isRunning` was true. The new code passes `disabled={isBlocked}` where `isBlocked = sessionExhausted || !!scopeBlocked`. This means the editor is now **always editable** during a running agent (the plan explicitly intended this). Users can type their next message while the agent is running. This is a behavioral change beyond the scope of "make Escape feel immediate."
   - **Impact:** Users may send messages while an agent is still running. The `handleSend` guard in `workspace-refine.tsx:170` (`if (store.isRunning) return;`) prevents the send from executing, but the user gets no feedback that their message was ignored.
   - **Recommendation:** Consider showing a subtle indicator that the input is queued or blocked, or re-add the editor disabled state during running.

## What Went Well

1. **Clean optimistic state pattern** — The `setStopping(true)` → async cancel → `setStopping(false)` on terminal/error flow is well-structured for refine. The idempotency guard (`!isStopping`) prevents double-cancel. Tests verify this thoroughly.

2. **Shared `RunStatusFooter` component** — Good consolidation. The component is well-typed with `FooterDisplayStatus`, handles all status variants consistently, and the amber pulsing dot provides clear visual distinction for the stopping state.

3. **Test quality for core paths** — The app-layout Escape handler tests are comprehensive: they verify optimistic state setting, idempotency, and correct backend calls for all three contexts (refine, workflow, evals). Store tests verify `isStopping` reset on `clearSession`, `reset`, and `initWorkflow`.

## Verdict

**REQUEST_CHANGES**

Three high-severity findings block a clean approval:

- **H1 (Workflow `isStopping` leak):** The workflow footer will show "stopping…" permanently after any interrupt because `isStopping` is never cleared on workflow completion. This is a visible user-facing bug.
- **H2 (Eval `isStopping` leak):** Same issue for evals.
- **H3 (Eval running state dead code):** The eval interruption path added by this branch is unreachable in production because `setEvalsRunning` is never called. The tests pass only because they manually set the state.

These are not architectural disagreements — they are missing cleanup paths that the optimistic state pattern requires. The refine path got it right (clearing `isStopping` on terminal event); workflow and evals need the same treatment.

## Next Steps

1. **Add `setStopping(false)` to all workflow terminal paths:**
   - `teardownWorkflowSession` — add `store.setStopping(false)` alongside `store.setRunning(false)`
   - `failWorkflowStep` in `use-workflow-state-machine.ts` — add `setStopping(false)`
   - All other `setRunning(false)` call sites in the state machine that represent terminal transitions

2. **Add `setEvalsStopping(false)` to eval completion paths:**
   - Find where eval runs complete in production and clear stopping state there
   - If eval running state is not yet wired (H3), either wire it or scope eval interruption out of this PR

3. **Add `setStopping(false)` to `cleanupCurrentSelectedSkill`** in `app-layout.tsx`

4. **Guard workflow Escape handler** — if no running agent is found after setting `isStopping`, clear it immediately

5. **Add `agent-run-footer.test.tsx`** covering stopping/running/completed/idle states

6. **Address AC5** — add UI copy or documentation explaining that OpenHands cancellation is step-boundary based and may not be instant
