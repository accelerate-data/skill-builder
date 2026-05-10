# Active Skill Leave And Enter Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every "leave current skill" path use one strict sequence: pause conversation, release lock, clear UI state, stop the OpenHands server; keep next-skill bootstrap in a separate enter path.

**Architecture:** Add one shared frontend transition module that owns `leaveCurrentSkill()` and `enterSkill()`. Route app-layout skill switching, workflow leave cleanup, and refine leave cleanup through that shared module so screens only declare when they are blocking and do not own runtime teardown logic.

**Tech Stack:** React, TypeScript, Zustand, TanStack Router, Tauri IPC, Vitest

---

## File Structure

- Create: `app/src/lib/active-skill-transition.ts`
  - Shared orchestration for `leaveCurrentSkill()` and `enterSkill()`
- Create: `app/src/__tests__/lib/active-skill-transition.test.ts`
  - Unit tests for strict leave ordering, failure handling, and enter bootstrap
- Modify: `app/src/components/layout/app-layout.tsx`
  - Replace inline switch cleanup/bootstrap with shared transition calls
- Modify: `app/src/hooks/use-workflow-session.ts`
  - Replace local teardown sequence with shared leave path
- Modify: `app/src/components/workspace/workspace-refine.tsx`
  - Replace refine-specific teardown sequence with shared leave path
- Modify: `app/src/__tests__/components/app-layout.test.tsx`
  - Assert switch flow uses leave then enter in the correct order
- Modify: `app/src/__tests__/hooks/use-workflow-session.test.ts`
  - Assert workflow leave delegates to the shared leave path
- Modify: `app/src/__tests__/components/workspace/workspace-refine.test.tsx`
  - Assert refine leave delegates to the shared leave path
- Modify: `docs/design/openhands-runtime-model/README.md`
  - Document the single leave path and separate enter/bootstrap path

### Task 1: Add the shared active-skill transition module

**Files:**

- Create: `app/src/lib/active-skill-transition.ts`
- Test: `app/src/__tests__/lib/active-skill-transition.test.ts`

- [ ] **Step 1: Write the failing leave-path tests**

```ts
it("leaves the current skill in strict order", async () => {
  const calls: string[] = [];
  mockPause.mockImplementation(async () => {
    calls.push("pause");
  });
  mockReleaseLock.mockImplementation(async () => {
    calls.push("release");
  });
  mockClearUi.mockImplementation(() => {
    calls.push("clear");
  });
  mockStopServer.mockImplementation(async () => {
    calls.push("stop");
  });

  await leaveCurrentSkill(buildLeaveDeps());

  expect(calls).toEqual(["pause", "release", "clear", "stop"]);
});

it("does not clear UI state when pause fails", async () => {
  mockPause.mockRejectedValue(new Error("pause failed"));

  await expect(leaveCurrentSkill(buildLeaveDeps())).rejects.toThrow("pause failed");
  expect(mockClearUi).not.toHaveBeenCalled();
  expect(mockStopServer).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the focused test file and verify it fails**

Run: `cd app && npm run test:unit -- active-skill-transition.test.ts`

Expected: FAIL with module-not-found or missing-export errors for `leaveCurrentSkill` / `enterSkill`

- [ ] **Step 3: Write the shared transition module**

```ts
export async function leaveCurrentSkill(deps: LeaveCurrentSkillDeps): Promise<void> {
  const session = deps.getActiveSkillSession();
  if (!session) return;

  await deps.pauseConversation(session);
  await deps.releaseLock(session.skillName);
  deps.clearUiState(session);
  await deps.stopServer();
}

export async function enterSkill(
  skill: EditableSkill,
  deps: EnterSkillDeps,
): Promise<void> {
  await deps.acquireLock(skill.name);
  const session = await deps.bootstrap(skill);
  deps.hydrate(skill, session);
}
```

- [ ] **Step 4: Add failure-policy coverage for release-lock and stop-server behavior**

```ts
it("does not clear UI state when lock release fails", async () => {
  mockReleaseLock.mockRejectedValue(new Error("release failed"));

  await expect(leaveCurrentSkill(buildLeaveDeps())).rejects.toThrow("release failed");
  expect(mockClearUi).not.toHaveBeenCalled();
  expect(mockStopServer).not.toHaveBeenCalled();
});

it("surfaces stop-server failures after UI clear", async () => {
  mockStopServer.mockRejectedValue(new Error("stop failed"));

  await expect(leaveCurrentSkill(buildLeaveDeps())).rejects.toThrow("stop failed");
  expect(mockClearUi).toHaveBeenCalled();
});
```

- [ ] **Step 5: Re-run the focused unit tests**

Run: `cd app && npm run test:unit -- active-skill-transition.test.ts`

Expected: PASS

- [ ] **Step 6: Commit the shared transition module**

```bash
git add app/src/lib/active-skill-transition.ts app/src/__tests__/lib/active-skill-transition.test.ts
git commit -m "refactor: add shared active skill transition flow"
```

### Task 2: Route app-layout skill switching through leave then enter

**Files:**

- Modify: `app/src/components/layout/app-layout.tsx`
- Modify: `app/src/__tests__/components/app-layout.test.tsx`

- [ ] **Step 1: Write the failing app-layout switch test for strict sequencing**

```ts
it("leaves the current skill before bootstrapping the next one", async () => {
  const calls: string[] = [];
  mockPauseOpenHandsSession.mockImplementation(async () => {
    calls.push("pause");
  });
  mockReleaseLock.mockImplementation(async () => {
    calls.push("release");
  });
  mockStopOpenHandsServer.mockImplementation(async () => {
    calls.push("stop");
  });
  mockSelectSkillSession.mockImplementation(async () => {
    calls.push("bootstrap");
    return nextSession;
  });

  await userEvent.click(screen.getByText("Select finance"));

  await waitFor(() => {
    expect(calls).toEqual(["pause", "release", "stop", "bootstrap"]);
  });
});
```

- [ ] **Step 2: Run the focused app-layout tests and verify they fail**

Run: `cd app && npm run test:unit -- app-layout.test.tsx`

Expected: FAIL because `app-layout` still uses duplicated inline cleanup/bootstrap logic

- [ ] **Step 3: Replace inline switch orchestration with shared helpers**

```ts
const leaveSelectedSkill = useCallback(async () => {
  await leaveCurrentSkill({
    getActiveSkillSession,
    pauseConversation: pauseCurrentSkillConversation,
    releaseLock: releaseLock,
    clearUiState: clearSelectedSkillUiState,
    stopServer: stopOpenHandsServer,
  });
}, [getActiveSkillSession, pauseCurrentSkillConversation, clearSelectedSkillUiState]);

const activateSkill = useCallback(async (name: string) => {
  const editableSkill = resolveEditableSkill(name);
  if (shouldLeaveCurrentSkill(name)) {
    await leaveSelectedSkill();
  }
  setSelectedWorkspaceSkillName(name);
  await enterSkill(editableSkill, {
    acquireLock,
    bootstrap: bootstrapSelectedSkillSession,
    hydrate: hydrateSelectedSkillOpenHandsSession,
  });
  navigateToSkillSurface(editableSkill);
}, [leaveSelectedSkill, bootstrapSelectedSkillSession, navigateToSkillSurface]);
```

- [ ] **Step 4: Add same-skill and leave-failure assertions**

```ts
it("does not leave or bootstrap when the same skill is already active", async () => {
  await userEvent.click(screen.getByText("Select sales"));
  expect(mockPauseOpenHandsSession).not.toHaveBeenCalled();
  expect(mockSelectSkillSession).not.toHaveBeenCalled();
});

it("does not bootstrap the next skill when leaveCurrentSkill fails", async () => {
  mockPauseOpenHandsSession.mockRejectedValue(new Error("pause failed"));
  await userEvent.click(screen.getByText("Select finance"));
  await waitFor(() => expect(mockSelectSkillSession).not.toHaveBeenCalled());
});
```

- [ ] **Step 5: Re-run the focused app-layout tests**

Run: `cd app && npm run test:unit -- app-layout.test.tsx`

Expected: PASS

- [ ] **Step 6: Commit the app-layout switch cleanup**

```bash
git add app/src/components/layout/app-layout.tsx app/src/__tests__/components/app-layout.test.tsx
git commit -m "refactor: split active skill leave and enter flows"
```

### Task 3: Replace workflow and refine screen-local leave cleanup with the shared leave path

**Files:**

- Modify: `app/src/hooks/use-workflow-session.ts`
- Modify: `app/src/components/workspace/workspace-refine.tsx`
- Modify: `app/src/__tests__/hooks/use-workflow-session.test.ts`
- Modify: `app/src/__tests__/components/workspace/workspace-refine.test.tsx`

- [ ] **Step 1: Write the failing screen-level delegation tests**

```ts
it("workflow leave delegates to leaveCurrentSkill", async () => {
  renderHook(() => useWorkflowSession(defaultOptions));
  act(() => leaveGuardCapture.onLeave!(vi.fn()));
  expect(mockLeaveCurrentSkill).toHaveBeenCalledTimes(1);
});

it("refine leave delegates to leaveCurrentSkill", async () => {
  render(<WorkspaceRefine {...defaultProps} />);
  act(() => refineLeaveGuardCapture.onLeave!(vi.fn()));
  expect(mockLeaveCurrentSkill).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run the focused hook/component tests and verify they fail**

Run: `cd app && npm run test:unit -- use-workflow-session.test.ts workspace-refine.test.tsx`

Expected: FAIL because both files still perform screen-local cleanup and direct `stop_openhands_server` calls

- [ ] **Step 3: Replace local teardown logic with the shared leave helper**

```ts
onLeave: (proceed) => {
  void leaveCurrentSkill(sharedLeaveDeps)
    .then(() => proceed())
    .catch((err) => {
      toast.error(err instanceof Error ? err.message : String(err));
    });
};
```

- [ ] **Step 4: Remove duplicated direct server-stop and local state-reset sequences**

```ts
// remove:
store.setRunning(false);
store.setActiveAgentId(null);
clearRefineAgentRuns();
void invokeCommand("stop_openhands_server", {});

// replace with:
await leaveCurrentSkill(sharedLeaveDeps);
```

- [ ] **Step 5: Re-run the focused workflow/refine tests**

Run: `cd app && npm run test:unit -- use-workflow-session.test.ts workspace-refine.test.tsx`

Expected: PASS

- [ ] **Step 6: Commit the shared leave-path adoption**

```bash
git add app/src/hooks/use-workflow-session.ts app/src/components/workspace/workspace-refine.tsx app/src/__tests__/hooks/use-workflow-session.test.ts app/src/__tests__/components/workspace/workspace-refine.test.tsx
git commit -m "refactor: route screen leave guards through shared skill exit"
```

### Task 4: Update runtime design docs and run full validation

**Files:**

- Modify: `docs/design/openhands-runtime-model/README.md`
- Test: `app/src/__tests__/lib/active-skill-transition.test.ts`
- Test: `app/src/__tests__/components/app-layout.test.tsx`
- Test: `app/src/__tests__/hooks/use-workflow-session.test.ts`
- Test: `app/src/__tests__/components/workspace/workspace-refine.test.tsx`

- [ ] **Step 1: Update the runtime design doc to describe the new contract**

```md
### Active Skill Transition Contract

- Leaving the current skill always uses one shared path:
  1. pause conversation
  2. release lock
  3. clear UI state
  4. stop OpenHands server
- Entering the next skill is a separate path:
  1. acquire lock
  2. bootstrap selected skill session
  3. hydrate UI state
```

- [ ] **Step 2: Run the focused transition-related unit tests**

Run: `cd app && npm run test:unit -- active-skill-transition.test.ts app-layout.test.tsx use-workflow-session.test.ts workspace-refine.test.tsx`

Expected: PASS

- [ ] **Step 3: Run the broader required validation**

Run: `cd app && npm run test:unit`

Expected: PASS

Run: `cd app && npx tsc --noEmit`

Expected: PASS

- [ ] **Step 4: Lint the design doc and check for diff hygiene**

Run: `markdownlint docs/design/openhands-runtime-model/README.md docs/plans/2026-05-09-active-skill-leave-enter-cleanup.md`

Expected: PASS

Run: `git diff --check`

Expected: no output

- [ ] **Step 5: Commit the docs and verification follow-through**

```bash
git add docs/design/openhands-runtime-model/README.md docs/plans/2026-05-09-active-skill-leave-enter-cleanup.md
git commit -m "docs: document shared active skill transition flow"
```

## Self-Review

- Spec coverage:
  - single shared leave path: Task 1, Task 2, Task 3
  - separate enter/bootstrap path: Task 1, Task 2
  - every UI surface uses the same leave path: Task 3
  - failure policy keeps current skill visible on pause/release failure: Task 1, Task 2
  - docs updated for the runtime model: Task 4
- Placeholder scan:
  - no `TODO`, `TBD`, or implicit "handle errors" placeholders remain
- Type consistency:
  - plan uses one pair of names consistently: `leaveCurrentSkill()` and `enterSkill()`
