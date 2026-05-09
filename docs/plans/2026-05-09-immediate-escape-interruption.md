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

- [ ] **Step 1: Write the failing test**

```typescript
// In app/src/__tests__/stores/refine-store.test.ts (add to existing describe block)

it("setStopping toggles the stopping flag", () => {
  useRefineStore.getState().setStopping(true);
  expect(useRefineStore.getState().isStopping).toBe(true);
  useRefineStore.getState().setStopping(false);
  expect(useRefineStore.getState().isStopping).toBe(false);
});

it("clearSession resets isStopping to false", () => {
  useRefineStore.getState().setStopping(true);
  useRefineStore.getState().clearSession();
  expect(useRefineStore.getState().isStopping).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npm run test:unit -- --run --testPathPattern refine-store.test`
Expected: FAIL with "setStopping is not a function" / "isStopping is undefined"

- [ ] **Step 3: Add `isStopping` to the RefineState interface**

In `app/src/stores/refine-store.ts`, add to the interface (around line 71, after `isRunning`):

```typescript
  isRunning: boolean;
  isStopping: boolean;
  conversationId: string | null;
```

- [ ] **Step 4: Add `setStopping` action signature to interface**

Add after `setRunning` (around line 106):

```typescript
  setRunning: (v: boolean) => void;
  setStopping: (v: boolean) => void;
```

- [ ] **Step 5: Add `isStopping` to SESSION_DEFAULTS**

In `SESSION_DEFAULTS` (around line 124):

```typescript
  isRunning: false,
  isStopping: false,
  conversationId: null as string | null,
```

- [ ] **Step 6: Implement `setStopping` in the store**

After `setRunning` implementation (around line 270):

```typescript
  setRunning: (v) => set({ isRunning: v }),
  setStopping: (v) => set({ isStopping: v }),
```

- [ ] **Step 7: Run test to verify it passes**

Run: `cd app && npm run test:unit -- --run --testPathPattern refine-store.test`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add app/src/stores/refine-store.ts app/src/__tests__/stores/refine-store.test.ts
git commit -m "VU-1176: add isStopping state to refine-store"
```

---

### Task 2: Add `isStopping` to workflow-store

**Files:**
- Modify: `app/src/stores/workflow-store.ts`
- Test: `app/src/__tests__/stores/workflow-store.test.ts`

- [ ] **Step 1: Check for existing workflow-store tests**

```bash
ls app/src/__tests__/stores/workflow-store.test.ts 2>/dev/null || echo "FILE NOT FOUND"
```

If the file doesn't exist, create it:

```typescript
// app/src/__tests__/stores/workflow-store.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { useWorkflowStore } from "@/stores/workflow-store";

beforeEach(() => {
  useWorkflowStore.getState().reset();
});

describe("isStopping", () => {
  it("setStopping toggles the stopping flag", () => {
    useWorkflowStore.getState().setStopping(true);
    expect(useWorkflowStore.getState().isStopping).toBe(true);
    useWorkflowStore.getState().setStopping(false);
    expect(useWorkflowStore.getState().isStopping).toBe(false);
  });

  it("reset clears isStopping", () => {
    useWorkflowStore.getState().setStopping(true);
    useWorkflowStore.getState().reset();
    expect(useWorkflowStore.getState().isStopping).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npm run test:unit -- --run --testPathPattern workflow-store.test`
Expected: FAIL

- [ ] **Step 3: Add `isStopping` to WorkflowState interface**

In `app/src/stores/workflow-store.ts`, add after `isRunning` (around line 18):

```typescript
  isRunning: boolean;
  isStopping: boolean;
```

- [ ] **Step 4: Add `setStopping` action signature**

Add after `setRunning` (around line 44):

```typescript
  setRunning: (running: boolean) => void;
  setStopping: (stopping: boolean) => void;
```

- [ ] **Step 5: Add initial value and implementation**

In the store creation (around line 75):

```typescript
  isRunning: false,
  isStopping: false,
```

After `setRunning` implementation (around line 131):

```typescript
  setStopping: (stopping) => set({ isStopping: stopping }),
```

- [ ] **Step 6: Add `isStopping: false` to `initWorkflow` and `reset`**

In `initWorkflow` (around line 93):

```typescript
    isRunning: false,
    isStopping: false,
```

In `reset` function (find it and add):

```typescript
    isRunning: false,
    isStopping: false,
```

- [ ] **Step 7: Run test to verify it passes**

Run: `cd app && npm run test:unit -- --run --testPathPattern workflow-store.test`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add app/src/stores/workflow-store.ts app/src/__tests__/stores/workflow-store.test.ts
git commit -m "VU-1176: add isStopping state to workflow-store"
```

---

### Task 3: Add `isStopping` to eval-running-state

**Files:**
- Modify: `app/src/lib/eval-running-state.ts`
- Test: `app/src/__tests__/lib/eval-running-state.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// In app/src/__tests__/lib/eval-running-state.test.ts (create if needed)
import { describe, it, expect, beforeEach } from "vitest";
import {
  getEvalsRunning,
  setEvalsRunning,
  getEvalsStopping,
  setEvalsStopping,
} from "@/lib/eval-running-state";

beforeEach(() => {
  setEvalsRunning(false);
  setEvalsStopping(false);
});

describe("eval-running-state", () => {
  it("setEvalsStopping toggles the stopping flag", () => {
    setEvalsStopping(true);
    expect(getEvalsStopping()).toBe(true);
    setEvalsStopping(false);
    expect(getEvalsStopping()).toBe(false);
  });

  it("setEvalsRunning clears isStopping", () => {
    setEvalsStopping(true);
    setEvalsRunning(true);
    expect(getEvalsStopping()).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npm run test:unit -- --run --testPathPattern eval-running-state.test`
Expected: FAIL

- [ ] **Step 3: Add `isStopping` to eval-running-state module**

In `app/src/lib/eval-running-state.ts`, add stopping state alongside running state:

```typescript
let _isRunning = false;
let _isStopping = false;
let _cancelCurrentRun: (() => Promise<void>) | null = null;
const _listeners = new Set<(v: boolean) => void>();
const _stoppingListeners = new Set<(v: boolean) => void>();

export function setEvalsRunning(v: boolean): void {
  _isRunning = v;
  if (v) _isStopping = false; // Clear stopping when starting a new run
  for (const fn of _listeners) fn(v);
}

export function getEvalsRunning(): boolean {
  return _isRunning;
}

export function setEvalsStopping(v: boolean): void {
  _isStopping = v;
  for (const fn of _stoppingListeners) fn(v);
}

export function getEvalsStopping(): boolean {
  return _isStopping;
}
```

Also add a subscriber for stopping state:

```typescript
export function subscribeEvalsStopping(fn: (v: boolean) => void): () => void {
  _stoppingListeners.add(fn);
  return () => _stoppingListeners.delete(fn);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npm run test:unit -- --run --testPathPattern eval-running-state.test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/eval-running-state.ts app/src/__tests__/lib/eval-running-state.test.ts
git commit -m "VU-1176: add isStopping to eval-running-state"
```

---

### Task 4: Add "stopping" status to RunStatusFooter (shared component)

**Files:**
- Modify: `app/src/components/run-status-footer.tsx`
- Test: `app/src/__tests__/components/run-status-footer.test.tsx`

- [ ] **Step 1: Write the failing test**

```typescript
// In app/src/__tests__/components/run-status-footer.test.tsx (create if needed)
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RunStatusFooter } from "@/components/run-status-footer";

describe("RunStatusFooter", () => {
  it("shows 'stopping…' label when status is stopping", () => {
    render(<RunStatusFooter status="stopping" model="test-model" />);
    expect(screen.getByText("stopping…")).toBeInTheDocument();
  });

  it("shows pulsing dot for stopping status", () => {
    const { container } = render(<RunStatusFooter status="stopping" />);
    const dot = container.querySelector(".size-\\[5px\\]");
    expect(dot).toHaveClass("animate-pulse");
  });

  it("uses amber color for stopping dot", () => {
    const { container } = render(<RunStatusFooter status="stopping" />);
    const dot = container.querySelector(".size-\\[5px\\]");
    expect(dot).toHaveStyle({ background: "var(--color-amber)" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npm run test:unit -- --run --testPathPattern run-status-footer.test`
Expected: FAIL

- [ ] **Step 3: Add "stopping" to FooterDisplayStatus type**

In `app/src/components/run-status-footer.tsx`, update the type (around line 3):

```typescript
export type FooterDisplayStatus =
  | "idle"
  | "initializing"
  | "running"
  | "stopping"
  | "completed"
  | "error";
```

- [ ] **Step 4: Add stopping dot style**

In `statusDot` record (around line 35):

```typescript
  running: {
    className: "animate-pulse",
    style: { background: "var(--color-pacific)" },
  },
  stopping: {
    className: "animate-pulse",
    style: { background: "var(--color-amber)" },
  },
```

- [ ] **Step 5: Add stopping label**

In `statusLabels` record (around line 46):

```typescript
  running: "running…",
  stopping: "stopping…",
  completed: "completed",
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd app && npm run test:unit -- --run --testPathPattern run-status-footer.test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add app/src/components/run-status-footer.tsx app/src/__tests__/components/run-status-footer.test.tsx
git commit -m "VU-1176: add stopping status to RunStatusFooter"
```

---

### Task 4: Update AppLayout Escape handler — optimistic isStopping + idempotency

**Files:**
- Modify: `app/src/components/layout/app-layout.tsx:88-134`

- [ ] **Step 1: Write the failing tests**

In `app/src/__tests__/components/app-layout.test.tsx`, add after the existing Escape tests:

```typescript
it("sets isStopping immediately when Escape is pressed during refine run", async () => {
  mockInvokeCommands({
    get_settings: defaultSettings,
    reconcile_startup: emptyReconciliation,
  });
  useRefineStore.setState({
    isRunning: true,
    isStopping: false,
    activeAgentId: "refine-agent-1",
  });

  render(<AppLayout />);

  await waitFor(() => {
    expect(screen.getByTestId("outlet")).toBeInTheDocument();
  });

  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

  // isStopping should be true immediately (optimistic), not waiting for backend
  expect(useRefineStore.getState().isStopping).toBe(true);
});

it("does not call cancel again when Escape is pressed during stopping state", async () => {
  mockInvokeCommands({
    get_settings: defaultSettings,
    reconcile_startup: emptyReconciliation,
  });
  useRefineStore.setState({
    isRunning: true,
    isStopping: true,
    activeAgentId: "refine-agent-stopping",
  });

  render(<AppLayout />);

  await waitFor(() => {
    expect(screen.getByTestId("outlet")).toBeInTheDocument();
  });

  mockInvoke.mockClear();
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

  // Should NOT call cancel because isStopping is already true
  await new Promise((r) => setTimeout(r, 100));
  expect(mockInvoke).not.toHaveBeenCalledWith("cancel_agent_run", expect.anything());
});

it("sets workflow isStopping immediately when Escape is pressed during workflow run", async () => {
  mockInvokeCommands({
    get_settings: defaultSettings,
    reconcile_startup: emptyReconciliation,
  });
  useAgentStore.getState().registerRun(
    "workflow-agent-1",
    "test-model",
    "my-skill",
    "workflow",
    "parent-1",
  );
  useWorkflowStore.getState().setRunning(true);
  useWorkflowStore.getState().setStopping(false);

  render(<AppLayout />);

  await waitFor(() => {
    expect(screen.getByTestId("outlet")).toBeInTheDocument();
  });

  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

  // isStopping should be true immediately
  expect(useWorkflowStore.getState().isStopping).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npm run test:unit -- --run --testPathPattern app-layout.test`
Expected: FAIL — `isStopping` not set, no idempotency guard

- [ ] **Step 3: Update the Escape handler**

In `app/src/components/layout/app-layout.tsx`, replace the Escape handler (around lines 102-129):

```typescript
    if (e.key === "Escape") {
      // Refine: check if running and not already stopping
      const refineStore = useRefineStore.getState();
      if (refineStore.isRunning && refineStore.activeAgentId && !refineStore.isStopping) {
        // Optimistic: set stopping immediately
        refineStore.setStopping(true);
        cancelAgentRun(refineStore.activeAgentId);
        return;
      }

      // Workflow: check if running and not already stopping
      const workflowStore = useWorkflowStore.getState();
      if (workflowStore.isRunning && !workflowStore.isStopping) {
        // Optimistic: set stopping immediately
        workflowStore.setStopping(true);
        const runs = useAgentStore.getState().runs;
        const runningWorkflow = Object.entries(runs).find(
          ([, run]) => run.status === "running" && run.runSource === "workflow",
        );
        if (runningWorkflow) {
          cancelWorkflowStep(runningWorkflow[0]);
        }
        return;
      }

      // Evals: check if running and not already stopping
      if (getEvalsRunning() && !getEvalsStopping()) {
        // Optimistic: set stopping immediately
        setEvalsStopping(true);
        requestEvalsCancel();
        return;
      }
    }
```

Also add the import for `getEvalsStopping` and `setEvalsStopping` at the top of the file.

- [ ] **Step 1b: Add eval stopping test**

In `app/src/__tests__/components/app-layout.test.tsx`, add:

```typescript
it("sets evals isStopping immediately when Escape is pressed during eval run", async () => {
  mockInvokeCommands({
    get_settings: defaultSettings,
    reconcile_startup: emptyReconciliation,
  });
  setEvalsRunning(true);
  setEvalsStopping(false);
  const cancelEval = vi.fn().mockResolvedValue(undefined);
  setEvalsCancelHandler(cancelEval);

  render(<AppLayout />);

  await waitFor(() => {
    expect(screen.getByTestId("outlet")).toBeInTheDocument();
  });

  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

  // isStopping should be true immediately
  expect(getEvalsStopping()).toBe(true);
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npm run test:unit -- --run --testPathPattern app-layout.test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/src/components/layout/app-layout.tsx app/src/__tests__/components/app-layout.test.tsx
git commit -m "VU-1176: optimistic isStopping + idempotent Escape in AppLayout"
```

---

### Task 5: Replace refine inline status bar with RunStatusFooter

**Files:**
- Modify: `app/src/components/workspace/workspace-refine.tsx`
- Test: `app/src/__tests__/components/workspace/workspace-refine.test.tsx`

- [ ] **Step 1: Read current status bar section**

Read `workspace-refine.tsx` lines 400-460 to understand the current inline status bar.

- [ ] **Step 2: Write the failing test**

In `app/src/__tests__/components/workspace/workspace-refine.test.tsx`, add:

```typescript
it("renders RunStatusFooter with stopping status when isStopping is true", async () => {
  const skill = makeSkill("my-skill");
  refineStoreState.conversationId = "conv-status";
  refineStoreState.selectedSkill = skill;
  refineStoreState.isRunning = true;
  refineStoreState.isStopping = true;
  refineStoreState.activeAgentId = "agent-status";

  await act(async () => {
    renderRefine(skill);
  });

  const footer = screen.getByTestId("refine-status-footer");
  expect(footer).toBeInTheDocument();
  expect(footer).toHaveTextContent("stopping…");
});

it("renders RunStatusFooter with running status when isRunning is true", async () => {
  const skill = makeSkill("my-skill");
  refineStoreState.conversationId = "conv-running";
  refineStoreState.selectedSkill = skill;
  refineStoreState.isRunning = true;
  refineStoreState.isStopping = false;
  refineStoreState.activeAgentId = "agent-running";

  await act(async () => {
    renderRefine(skill);
  });

  const footer = screen.getByTestId("refine-status-footer");
  expect(footer).toBeInTheDocument();
  expect(footer).toHaveTextContent("running…");
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd app && npm run test:unit -- --run --testPathPattern workspace-refine.test`
Expected: FAIL — no `refine-status-footer` element

- [ ] **Step 4: Replace inline status bar with RunStatusFooter**

In `app/src/components/workspace/workspace-refine.tsx`, replace the inline status bar (lines 408-460 area) with `RunStatusFooter`:

Remove the inline dot/style/label logic and replace with:

```typescript
import { RunStatusFooter, type FooterDisplayStatus } from "@/components/run-status-footer";

// In the component, derive footer status:
const footerStatus: FooterDisplayStatus = isStopping
  ? "stopping"
  : isRunning
    ? "running"
    : activeSkill
      ? "idle"
      : "idle";
```

Replace the status bar div (lines 437-460 area) with:

```tsx
      {/* Status bar */}
      <RunStatusFooter
        status={footerStatus}
        model={modelLabel !== "No model selected" ? modelLabel : null}
        elapsedMs={isRunning ? Date.now() - (sessionStartTime ?? Date.now()) : null}
        testId="refine-status-footer"
      />
```

Note: You may need to track `sessionStartTime` or use the agent run's `startTime` from `agent-store`. Check what elapsed time data is available.

- [ ] **Step 3: Clear isStopping in the completion watcher**

In the agent completion `useEffect` (around line 255-280), add `setStopping(false)` when terminal:

```typescript
    // Clear stopping state when terminal event arrives
    useRefineStore.getState().setStopping(false);
```

Add it right after the terminal status check, before any other cleanup.

- [ ] **Step 4: Remove handleCancel and onCancel prop**

Since Escape is the only interrupt mechanism, remove `handleCancel` from `workspace-refine.tsx` and stop passing `onCancel` to `ChatPanel`.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd app && npm run test:unit -- --run --testPathPattern workspace-refine.test`
Expected: PASS (update tests that reference the old status bar or cancel button)

- [ ] **Step 6: Commit**

```bash
git add app/src/components/workspace/workspace-refine.tsx app/src/__tests__/components/workspace/workspace-refine.test.tsx
git commit -m "VU-1176: replace refine inline status bar with RunStatusFooter"
```

---

### Task 6: Wire eval isStopping to RunStatusFooter

**Files:**
- Modify: `app/src/components/workspace/workspace-evals.tsx`

- [ ] **Step 1: Read current RunStatusFooter usage**

The eval page already uses `RunStatusFooter` at line 182-186 but it's hardcoded to `status="idle"`. We need to make it dynamic based on eval running/stopping state.

- [ ] **Step 2: Update workspace-evals.tsx to wire stopping state**

In `app/src/components/workspace/workspace-evals.tsx`, add state subscription and derive footer status:

```typescript
import { RunStatusFooter, type FooterDisplayStatus } from "@/components/run-status-footer";
import {
  getEvalsRunning,
  getEvalsStopping,
  subscribeEvalsRunning,
  subscribeEvalsStopping,
} from "@/lib/eval-running-state";

// In the component, add reactive state:
const [evalsRunning, setEvalsRunningReactive] = useState(getEvalsRunning());
const [evalsStopping, setEvalsStoppingReactive] = useState(getEvalsStopping());

useEffect(() => {
  const unsubRunning = subscribeEvalsRunning(setEvalsRunningReactive);
  const unsubStopping = subscribeEvalsStopping(setEvalsStoppingReactive);
  return () => {
    unsubRunning();
    unsubStopping();
  };
}, []);

// Derive footer status:
const footerStatus: FooterDisplayStatus = evalsStopping
  ? "stopping"
  : evalsRunning
    ? "running"
    : "idle";
```

Update the `RunStatusFooter` usage (around line 182):

```tsx
      <RunStatusFooter
        status={footerStatus}
        label={skillName}
        model={selectedModel ? formatModelName(selectedModel) : null}
      />
```

- [ ] **Step 3: Clear eval isStopping when run completes**

In the eval workbench component where `setEvalsRunning(false)` is called (when eval run finishes), also call `setEvalsStopping(false)`.

- [ ] **Step 4: Commit**

```bash
git add app/src/components/workspace/workspace-evals.tsx
git commit -m "VU-1176: wire eval isStopping to RunStatusFooter"
```

---

### Task 7: Wire isStopping through AgentRunFooter (workflow)

**Files:**
- Modify: `app/src/components/agent-run-footer.tsx`
- Test: `app/src/__tests__/components/agent-run-footer.test.tsx`

- [ ] **Step 1: Check for existing AgentRunFooter tests**

```bash
ls app/src/__tests__/components/agent-run-footer.test.tsx 2>/dev/null || echo "FILE NOT FOUND"
```

If the file doesn't exist, create it with the new tests below.

- [ ] **Step 2: Write the failing test**

```typescript
// In app/src/__tests__/components/agent-run-footer.test.tsx
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { AgentRunFooter } from "@/components/agent-run-footer";
import { useAgentStore } from "@/stores/agent-store";
import { useWorkflowStore } from "@/stores/workflow-store";

beforeEach(() => {
  useAgentStore.getState().clearAllRuns();
  useWorkflowStore.getState().reset();
});

describe("AgentRunFooter", () => {
  it("shows 'stopping…' when workflow isStopping is true", () => {
    useAgentStore.getState().registerRun("wf-agent-1", "test-model", "my-skill", "workflow", "parent-1");
    useWorkflowStore.getState().setRunning(true);
    useWorkflowStore.getState().setStopping(true);

    render(<AgentRunFooter agentId="wf-agent-1" />);

    const footer = screen.getByTestId("agent-run-footer");
    expect(footer).toHaveTextContent("stopping…");
  });

  it("shows 'running…' when workflow isRunning but not isStopping", () => {
    useAgentStore.getState().registerRun("wf-agent-2", "test-model", "my-skill", "workflow", "parent-1");
    useWorkflowStore.getState().setRunning(true);
    useWorkflowStore.getState().setStopping(false);

    render(<AgentRunFooter agentId="wf-agent-2" />);

    const footer = screen.getByTestId("agent-run-footer");
    expect(footer).toHaveTextContent("running…");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd app && npm run test:unit -- --run --testPathPattern agent-run-footer.test`
Expected: FAIL — `isStopping` not wired through

- [ ] **Step 4: Update AgentRunFooter to pass stopping status**

In `app/src/components/agent-run-footer.tsx`, read `isStopping` from workflow store and map it to the footer status:

```typescript
import { RunStatusFooter, type FooterDisplayStatus } from "@/components/run-status-footer";

export function AgentRunFooter({ agentId }: AgentRunFooterProps) {
  const run = useAgentStore((s) => s.runs[agentId]);
  const workflowIsInitializing = useWorkflowStore((s) => s.isInitializing);
  const workflowIsStopping = useWorkflowStore((s) => s.isStopping);
  const workflowInitStartTime = useWorkflowStore((s) => s.initStartTime);

  const displayStatus: DisplayStatus | null = run
    ? getDisplayStatus(run.status, getAgentActivityCount(run), workflowIsInitializing)
    : null;

  // Map stopping state to footer status
  const footerStatus: FooterDisplayStatus = workflowIsStopping
    ? "stopping"
    : displayStatus === "initializing"
      ? "initializing"
      : displayStatus === "error"
        ? "error"
        : displayStatus === "completed"
          ? "completed"
          : run?.status === "running"
            ? "running"
            : "idle";
```

- [ ] **Step 2: Pass footerStatus to RunStatusFooter**

Update the return statement to use `footerStatus`:

```typescript
  return (
    <RunStatusFooter
      status={footerStatus}
      label={run.agentName ?? null}
      model={run.model && run.model !== "unknown" ? formatModelName(run.model) : null}
      elapsedMs={elapsed}
      turns={turnCount}
      tokenCount={
        run.tokenUsage && isFinished
          ? formatTokenCount(run.tokenUsage.input + run.tokenUsage.output)
          : null
      }
      cost={run.totalCost !== undefined && isFinished ? `$${run.totalCost.toFixed(4)}` : null}
      testId="agent-run-footer"
    />
  );
```

- [ ] **Step 3: Clear isStopping when workflow completes**

Find where workflow sets `isRunning(false)` and add `setStopping(false)` alongside it.

- [ ] **Step 4: Commit**

```bash
git add app/src/components/agent-run-footer.tsx
git commit -m "VU-1176: wire isStopping through AgentRunFooter"
```

---

### Task 8: Remove cancel button from chat-input-bar

**Files:**
- Modify: `app/src/components/refine/chat-input-bar.tsx`
- Test: `app/src/__tests__/components/refine/chat-input-bar.test.tsx`

- [ ] **Step 1: Check for existing chat-input-bar tests**

```bash
ls app/src/__tests__/components/refine/chat-input-bar.test.tsx 2>/dev/null || echo "FILE NOT FOUND"
```

- [ ] **Step 2: Write the failing test**

```typescript
// In app/src/__tests__/components/refine/chat-input-bar.test.tsx (add or create)
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChatInputBar } from "@/components/refine/chat-input-bar";

describe("ChatInputBar", () => {
  it("does not render a cancel button", () => {
    const { container } = render(<ChatInputBar onSend={() => {}} hasSkill />);
    // No stop/cancel button should exist
    expect(container.querySelector('[aria-label="Cancel current run"]')).toBeNull();
    expect(container.querySelector('[aria-label="Stop generation"]')).toBeNull();
  });

  it("always renders a send button", () => {
    render(<ChatInputBar onSend={() => {}} hasSkill />);
    expect(screen.getByRole("button", { name: /send/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd app && npm run test:unit -- --run --testPathPattern chat-input-bar.test`
Expected: FAIL — cancel button still present

- [ ] **Step 4: Remove the cancel button rendering**

In `app/src/components/refine/chat-input-bar.tsx`, find the button that switches between send/cancel (around lines 443-453) and remove the cancel variant. The button should always be the send button:

```typescript
// Before: button switches between send and cancel based on isRunning
// After: button is always send

<button
  onClick={handleSend}
  disabled={!editor?.getText().trim()}
  aria-label="Send refine message"
  title="Send refine message"
>
  <SendHorizontal className="size-4" />
</button>
```

- [ ] **Step 2: Remove isRunning and onCancel from props**

Remove `isRunning` and `onCancel` from `ChatInputBarProps` interface and the component's destructured props.

- [ ] **Step 3: Remove isRunning editor lock**

Remove the `useEffect` that disables the editor when `isRunning` is true (around lines 396-398). The editor should always be editable — if a run is in progress, the user can still type their next message.

- [ ] **Step 4: Update workspace-refine.tsx to not pass removed props**

Remove `isRunning` and `onCancel` props from the `<ChatInputBar>` usage in `workspace-refine.tsx`.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd app && npm run test:unit -- --run --testPathPattern chat-input-bar`
Expected: PASS (update tests that reference the cancel button)

- [ ] **Step 6: Commit**

```bash
git add app/src/components/refine/chat-input-bar.tsx app/src/components/workspace/workspace-refine.tsx
git commit -m "VU-1176: remove cancel button from chat-input-bar (Escape is the only interrupt)"
```

---

### Task 9: Run full test suite and verify

- [ ] **Step 1: Run all unit tests**

Run: `cd app && npm run test:unit`
Expected: ALL PASS

- [ ] **Step 2: Run agent structural tests**

Run: `cd app && npm run test:agents:structural`
Expected: PASS

- [ ] **Step 3: Run TypeScript check**

Run: `cd app && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "VU-1176: fix test failures and type errors"
```

---

## Functional Spec

Path: `not_applicable` (Utilities team issue, explicitly approved without functional spec per issue description)

## Design Docs

Path: `not_applicable` (no existing design doc found)

## Implementation Plan

Path: `docs/plans/2026-05-09-immediate-escape-interruption.md`

## Independent Gates

- Code review: independent subagent via `superpowers:requesting-code-review`
- Simplification review: independent subagent via `code-simplifier`
- Test coverage review: independent subagent via `superpowers:requesting-code-review` with test-coverage-focused brief
- Acceptance-criteria review: independent subagent

## Manual Checks

- Press `Esc` during Refine streaming — should show "stopping…" immediately in status bar
- Press `Esc` during Workflow streaming — should show "stopping…" immediately in status bar
- Press `Esc` repeatedly — should be idempotent, no double-cancel
- After interrupt completes, send a new message — should work normally
- No cancel button visible in refine chat input — Escape is the only interrupt
