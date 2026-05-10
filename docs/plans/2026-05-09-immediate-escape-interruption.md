# Immediate Escape Interruption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make pressing `Esc` during Refine or Workflow runs feel immediate by introducing an optimistic local `isStopping` state, updating the UI to distinguish "interrupt requested" from fully stopped, and supporting steer-after-interrupt.

**Architecture:** Three simplifications over the original approach:
1. **Single Escape handler** — `AppLayout` is the only place Escape is handled. No per-page Escape listeners.
2. **Single status bar component** — `RunStatusFooter` is used everywhere (refine, workflow, evals). The refine page's inline status bar is replaced with it.
3. **No per-page cancel buttons** — The refine `chat-input-bar` cancel button is removed. Escape is the only interrupt mechanism.

State flow: `AppLayout` Escape handler → sets `isStopping` optimistically in the relevant store → calls backend cancel → UI shows "stopping…" via `RunStatusFooter` → terminal event arrives → `isStopping` cleared.

**Tech Stack:** Zustand (state), React (components), Tauri (backend invoke), Vitest (tests)

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `app/src/stores/refine-store.ts` | Add `isStopping` + `setStopping()` + SESSION_DEFAULTS reset | Refine interruption state |
| `app/src/stores/workflow-store.ts` | Add `isStopping` + `setStopping()` + init/reset | Workflow interruption state |
| `app/src/lib/eval-running-state.ts` | Add `isStopping` + `setEvalsStopping()` | Eval interruption state |
| `app/src/components/layout/app-layout.tsx` | Escape handler sets `isStopping` optimistically + idempotency guard | Single Escape entry point |
| `app/src/components/run-status-footer.tsx` | Add "stopping" status variant | Shared status bar |
| `app/src/components/agent-run-footer.tsx` | Wire `isStopping` from stores to `RunStatusFooter` | Workflow footer |
| `app/src/components/workspace/workspace-refine.tsx` | Replace inline status bar with `RunStatusFooter`; clear `isStopping` on terminal | Refine uses shared footer |
| `app/src/components/workspace/workspace-evals.tsx` | Wire `isStopping` to `RunStatusFooter` (currently hardcoded to "idle") | Eval uses shared footer |
| `app/src/components/refine/chat-input-bar.tsx` | Remove cancel button (Escape is the only interrupt) | Simplify UI |
| `app/src/__tests__/stores/refine-store.test.ts` | Tests for `isStopping` / `setStopping` | Refine store unit tests |
| `app/src/__tests__/stores/workflow-store.test.ts` | Tests for `isStopping` / `setStopping` | Workflow store unit tests |
| `app/src/__tests__/components/app-layout.test.tsx` | Tests for optimistic `isStopping` + idempotent Escape | AppLayout integration tests |
| `app/src/__tests__/components/run-status-footer.test.tsx` | Tests for "stopping" status | Footer unit tests |

---

### Task 1: Add `isStopping` to refine-store

**Files:**
- Modify: `app/src/stores/refine-store.ts`
- Test: `app/src/__tests__/stores/refine-store.test.ts`

- [x] **Step 1: Write the failing test**
- [x] **Step 2: Run test to verify it fails**
- [x] **Step 3: Add `isStopping` to the RefineState interface** (line 72)
- [x] **Step 4: Add `setStopping` action signature to interface**
- [x] **Step 5: Add `isStopping` to SESSION_DEFAULTS** (line 127)
- [x] **Step 6: Implement `setStopping` in the store** (line 308)
- [x] **Step 7: Run test to verify it passes**
- [x] **Step 8: Commit** — `65c6c94b`

---

### Task 2: Add `isStopping` to workflow-store

**Files:**
- Modify: `app/src/stores/workflow-store.ts`
- Test: `app/src/__tests__/stores/workflow-store.test.ts`

- [x] **Step 1: Check for existing workflow-store tests**
- [x] **Step 2: Run test to verify it fails**
- [x] **Step 3: Add `isStopping` to WorkflowState interface** (line 19)
- [x] **Step 4: Add `setStopping` action signature**
- [x] **Step 5: Add initial value and implementation** (lines 78, 137)
- [x] **Step 6: Add `isStopping: false` to `initWorkflow` and `reset`** (lines 97, 233)
- [x] **Step 7: Run test to verify it passes**
- [x] **Step 8: Commit** — `83a8a28f`

---

### Task 3: Add `isStopping` to eval-running-state

**Files:**
- Modify: `app/src/lib/eval-running-state.ts`
- Test: `app/src/__tests__/lib/eval-running-state.test.ts`

- [x] **Step 1: Write the failing test**
- [x] **Step 2: Run test to verify it fails**
- [x] **Step 3: Add `isStopping` to eval-running-state module** (lines 7, 22, 27, 48)
- [x] **Step 4: Run test to verify it passes**
- [x] **Step 5: Commit** — `fc6b5131`

---

### Task 4: Add "stopping" status to RunStatusFooter (shared component)

**Files:**
- Modify: `app/src/components/run-status-footer.tsx`
- Test: `app/src/__tests__/components/run-status-footer.test.tsx`

- [x] **Step 1: Write the failing test**
- [x] **Step 2: Run test to verify it fails**
- [x] **Step 3: Add "stopping" to FooterDisplayStatus type** (line 7)
- [x] **Step 4: Add stopping dot style** (line 37)
- [x] **Step 5: Add stopping label** (line 52)
- [x] **Step 6: Run test to verify it passes**
- [x] **Step 7: Commit** — `56eae70c`

---

### Task 5: Update AppLayout Escape handler — optimistic isStopping + idempotency

**Files:**
- Modify: `app/src/components/layout/app-layout.tsx`

- [x] **Step 1: Write the failing tests**
- [x] **Step 2: Run test to verify it fails**
- [x] **Step 3: Update the Escape handler** (lines 108-139)
- [x] **Step 1b: Add eval stopping test**
- [x] **Step 4: Run test to verify it passes**
- [x] **Step 5: Commit** — `ba1c0cd6`

---

### Task 6: Replace refine inline status bar with RunStatusFooter

**Files:**
- Modify: `app/src/components/workspace/workspace-refine.tsx`
- Test: `app/src/__tests__/components/workspace/workspace-refine.test.tsx`

- [x] **Step 1: Read current status bar section**
- [x] **Step 2: Write the failing test**
- [x] **Step 3: Run test to verify it fails**
- [x] **Step 4: Replace inline status bar with RunStatusFooter** (lines 29, 387-408)
- [x] **Step 3: Clear isStopping in the completion watcher**
- [x] **Step 4: Remove handleCancel and onCancel prop**
- [x] **Step 5: Run test to verify it passes**
- [x] **Step 6: Commit** — `91089193`

---

### Task 7: Wire eval isStopping to RunStatusFooter

**Files:**
- Modify: `app/src/components/workspace/workspace-evals.tsx`

- [x] **Step 1: Read current RunStatusFooter usage**
- [x] **Step 2: Update workspace-evals.tsx to wire stopping state** (lines 16-18, 64-75, 207)
- [x] **Step 3: Clear eval isStopping when run completes**
- [x] **Step 4: Commit** — `c39e96b2`

---

### Task 8: Wire isStopping through AgentRunFooter (workflow)

**Files:**
- Modify: `app/src/components/agent-run-footer.tsx`
- Test: `app/src/__tests__/components/agent-run-footer.test.tsx`

- [x] **Step 1: Check for existing AgentRunFooter tests** — file created
- [x] **Step 2: Write the failing test**
- [x] **Step 3: Run test to verify it fails**
- [x] **Step 4: Update AgentRunFooter to pass stopping status** (lines 22, 29-31, 65)
- [x] **Step 2: Pass footerStatus to RunStatusFooter**
- [x] **Step 3: Clear isStopping when workflow completes**
- [x] **Step 4: Commit** — `c39e96b2`

---

### Task 9: Remove cancel button from chat-input-bar

**Files:**
- Modify: `app/src/components/refine/chat-input-bar.tsx`
- Test: `app/src/__tests__/components/refine/chat-input-bar.test.tsx`

- [x] **Step 1: Check for existing chat-input-bar tests**
- [x] **Step 2: Write the failing test**
- [x] **Step 3: Run test to verify it fails**
- [x] **Step 4: Remove the cancel button rendering** — no cancel/Cancel/onCancel/isRunning references remain
- [x] **Step 2: Remove isRunning and onCancel from props**
- [x] **Step 3: Remove isRunning editor lock**
- [x] **Step 4: Update workspace-refine.tsx to not pass removed props**
- [x] **Step 5: Run test to verify it passes**
- [x] **Step 6: Commit** — `91089193`

---

### Task 10: Run full test suite and verify

- [x] **Step 1: Run all unit tests** — 614 passed, 55 test files
- [x] **Step 2: Run agent structural tests** — passing
- [x] **Step 3: Run TypeScript check** — no errors
- [x] **Step 4: Commit any fixes** — `af368f2b`

---

## Functional Spec

Path: `not_applicable` (Utilities team issue, explicitly approved without functional spec per issue description)

## Design Docs

Path: `not_applicable` (no existing design doc found)

## Implementation Plan

Path: `docs/plans/2026-05-09-immediate-escape-interruption.md`

## Independent Gates

- [x] Code review: completed (PR #587)
- [x] Simplification review: completed
- [x] Test coverage review: completed
- [x] Acceptance-criteria review: completed

## Manual Checks

- [x] Press `Esc` during Refine streaming — should show "stopping…" immediately in status bar
- [x] Press `Esc` during Workflow streaming — should show "stopping…" immediately in status bar
- [x] Press `Esc` repeatedly — should be idempotent, no double-cancel
- [x] After interrupt completes, send a new message — should work normally
- [x] No cancel button visible in refine chat input — Escape is the only interrupt

---

### Task 11: Fix "socket closed before terminal state" after Escape

**Root cause:** `pause_openhands_conversation` called `close_local_openhands_run(agent_id)` when `agent_id` was provided, aborting the WebSocket Tokio task before OpenHands could send the PAUSED terminal state.

- [x] Pass `null` as `agentId` in both refine and workflow Escape handlers in `app-layout.tsx`
- [x] Update app-layout tests to assert `agentId: null`

---

### Task 12: Fix "conversation not found and cannot be resumed" after data loss

**Root cause:** When the conversations directory was deleted, the DB retained the old `conversation_id`. `send_openhands_message` used `SendExistingOnly` which returned `ConversationNotFound` error instead of falling back.

- [x] In `resolve_openhands_conversation_id` (mod.rs), add fallback arm for `ConversationNotFound | MissingExistingConversation` — log warning, create new conversation, persist new ID to DB, emit `skill-session-reset` Tauri event
- [x] In `send_refine_message` (refine/mod.rs), remove equality guard that blocked the new-ID return path
- [x] In `use-agent-stream.ts`, add `skill-session-reset` listener that shows a `toast.warning`
- [x] Update use-agent-stream test listener count from 12 to 13
