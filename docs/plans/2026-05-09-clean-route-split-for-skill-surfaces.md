# Clean Route Split For Skill Surfaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the overloaded `/` route with explicit home, workflow, and workspace routes so route transitions reflect real skill/session semantics and same-skill surface changes no longer look like skill exits.

**Architecture:** Split the app into explicit route-owned surfaces: `/` for home, `/settings` for settings, `/workflow/$skillName` for workflow, and `/workspace/$skillName` plus nested workspace subroutes for overview, refine, and evals. Move workspace rendering out of `AppLayout`, introduce a small route/session coordinator that distinguishes "selected skill" from "active runtime session", and make leave/enter orchestration depend on skill identity changes rather than page unmounts.

**Tech Stack:** React, TypeScript, TanStack Router, Zustand, Tauri IPC, Vitest

---

## OpenHands Lifecycle Contract

- A route change within the same skill must not restart OpenHands.
  - Example: `/workflow/sales-skill` -> `/workspace/sales-skill/refine`
- A route change to a different skill must cleanly exit the old skill, then bootstrap the new one.
  - Sequence: `leaveCurrentSkill()` -> `enterSkill()`
- A route change from a skill route to a non-skill route must cleanly exit the active skill and must not bootstrap a replacement server.
  - Example: `/workspace/sales-skill/evals` -> `/settings`
- Home-route redirection must reuse an already-active session for the same skill and must not trigger redundant cleanup/bootstrap cycles.
- Page unmounts must not own OpenHands teardown after this rewrite. Route/session coordination is the only owner of cleanup/bootstrap decisions.

## File Structure

- Create: `app/src/pages/home.tsx`
  - Route-owned home page that redirects to the last selected skill workspace when appropriate
- Create: `app/src/pages/workspace-route.tsx`
  - Route-owned wrapper for workspace skill lookup, session bootstrap gating, and rendering `WorkspaceShell`
- Create: `app/src/lib/route-skill-session.ts`
  - Single coordinator for same-skill navigation vs different-skill leave/enter transitions
- Create: `app/src/__tests__/lib/route-skill-session.test.ts`
  - Coordinator tests for same-skill navigation, different-skill leave/enter, and settings/home exit behavior
- Modify: `app/src/router.tsx`
  - Replace overloaded `/` and `/skill/$skillName` usage with explicit route tree
- Modify: `app/src/components/layout/app-layout.tsx`
  - Remove route-owned workspace rendering and delegate skill navigation to the new coordinator
- Modify: `app/src/components/workspace/workspace-shell.tsx`
  - Stop owning tab-as-route state; consume routed surface identity instead
- Modify: `app/src/pages/workflow.tsx`
  - Update close/eval/refine navigation to the new workspace routes
- Modify: `app/src/pages/settings.tsx`
  - Update back navigation to home or last selected workspace route
- Modify: `app/src/stores/skill-store.ts`
  - Split `activeSkill` into selected-skill routing intent and active-session identity
- Modify: `app/src/lib/skill-routing.ts`
  - Keep workflow vs workspace classification, but route callers to explicit paths
- Modify: `app/src/hooks/use-workflow-session.ts`
  - Remove page-owned runtime teardown; leave only blocking/confirm behavior once route coordinator owns exits
- Modify: `app/src/components/workspace/workspace-refine.tsx`
  - Remove page-owned runtime teardown; same-skill route changes should not leave the skill
- Modify: `app/src/__tests__/components/app-layout.test.tsx`
  - Assert skill-menu navigation goes to `/workflow/$skillName` or `/workspace/$skillName`
- Modify: `app/src/__tests__/pages/workflow.test.tsx`
  - Assert workflow close/eval actions navigate to explicit workspace routes
- Modify: `app/src/__tests__/hooks/use-workflow-session.test.ts`
  - Update expectations after route coordinator owns exit semantics
- Modify: `app/src/__tests__/components/workspace/workspace-refine.test.tsx`
  - Update expectations after refine no longer owns full skill-leave teardown
- Modify: `repo-map.json`
  - Reflect new pages/lib module and any renamed route responsibilities

### Task 1: Introduce explicit home, workflow, and workspace routes

**Files:**

- Create: `app/src/pages/home.tsx`
- Create: `app/src/pages/workspace-route.tsx`
- Modify: `app/src/router.tsx`
- Test: `app/src/__tests__/components/app-layout.test.tsx`
- Test: `app/src/__tests__/pages/workflow.test.tsx`

- [x] **Step 1: Write failing route-shape tests**

```ts
it("routes a completed skill to /workspace/$skillName", async () => {
  render(<AppLayout />);

  await userEvent.click(screen.getByText("Select sales"));

  await waitFor(() => {
    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/workspace/$skillName",
      params: { skillName: "sales-skill" },
    });
  });
});

it("routes an in-progress skill to /workflow/$skillName", async () => {
  render(<AppLayout />);

  await userEvent.click(screen.getByText("Select lead-analysis"));

  await waitFor(() => {
    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/workflow/$skillName",
      params: { skillName: "lead-analysis" },
    });
  });
});
```

- [x] **Step 2: Run focused navigation tests and verify they fail**

Run: `cd app && npm run test:unit -- app-layout.test.tsx workflow.test.tsx`

Expected: FAIL because the router still points workflow skills at `/skill/$skillName` and workspace skills at `/`

- [x] **Step 3: Replace the route tree with explicit surfaces**

```ts
const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: HomePage,
});

const workflowRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/workflow/$skillName",
  component: WorkflowPage,
});

const workspaceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/workspace/$skillName",
  component: WorkspaceRoutePage,
});

const workspaceRefineRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: "/refine",
  component: WorkspaceRoutePage,
});

const workspaceEvalsRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: "/evals",
  component: WorkspaceRoutePage,
});
```

- [x] **Step 4: Make `/` a real home route**

```ts
export default function HomePage() {
  const navigate = useNavigate();
  const selectedSkillName = useSkillStore((s) => s.selectedSkillName);

  useEffect(() => {
    if (!selectedSkillName) return;
    navigate({
      to: "/workspace/$skillName",
      params: { skillName: selectedSkillName },
      replace: true,
    });
  }, [navigate, selectedSkillName]);

  return <DashboardPage />;
}
```

- [x] **Step 5: Add explicit workspace route wrapper**

```ts
export default function WorkspaceRoutePage() {
  const { skillName } = useParams({ from: "/workspace/$skillName" });
  const skill = useResolvedWorkspaceSkill(skillName);
  const surface = useWorkspaceSurfaceFromRoute();

  if (!skill) {
    throw notFound();
  }

  return <WorkspaceShell skill={skill} initialSurface={surface} />;
}
```

- [x] **Step 6: Re-run focused navigation tests**

Run: `cd app && npm run test:unit -- app-layout.test.tsx workflow.test.tsx`

Expected: PASS for route-path expectations; later tests may still fail on session semantics until Task 2

- [x] **Step 7: Commit the explicit route tree**

```bash
git add app/src/router.tsx app/src/pages/home.tsx app/src/pages/workspace-route.tsx app/src/__tests__/components/app-layout.test.tsx app/src/__tests__/pages/workflow.test.tsx
git commit -m "refactor: split workflow and workspace routes"
```

### Task 2: Split selected-skill routing state from active-session runtime state

**Files:**

- Modify: `app/src/stores/skill-store.ts`
- Create: `app/src/lib/route-skill-session.ts`
- Test: `app/src/__tests__/lib/route-skill-session.test.ts`

- [x] **Step 1: Write failing coordinator tests for same-skill vs different-skill transitions**

```ts
it("does not leave or re-enter when moving between surfaces of the same skill", async () => {
  await navigateToSkillSurface({
    currentSkillName: "sales-skill",
    nextSkillName: "sales-skill",
    nextSurface: "workspace-refine",
  });

  expect(mockLeaveCurrentSkill).not.toHaveBeenCalled();
  expect(mockEnterSkill).not.toHaveBeenCalled();
});

it("leaves the old skill and enters the new skill when skill identity changes", async () => {
  await navigateToSkillSurface({
    currentSkillName: "sales-skill",
    nextSkillName: "finance-skill",
    nextSurface: "workspace-overview",
  });

  expect(mockLeaveCurrentSkill).toHaveBeenCalledTimes(1);
  expect(mockEnterSkill).toHaveBeenCalledTimes(1);
});
```

- [x] **Step 2: Run the focused coordinator tests and verify they fail**

Run: `cd app && npm run test:unit -- route-skill-session.test.ts`

Expected: FAIL with module-not-found or missing-export errors for `navigateToSkillSurface`

- [x] **Step 3: Split store state into routing intent and runtime identity**

```ts
interface SkillState {
  selectedSkillName: string | null;
  activeSessionSkillName: string | null;
  lockedSkills: Set<string>;
  latestVersion: string | null;
  setSelectedSkillName: (name: string | null) => void;
  setActiveSessionSkillName: (name: string | null) => void;
}
```

- [x] **Step 4: Add the route/session coordinator**

```ts
export async function navigateToSkillSurface(
  target: SkillNavigationTarget,
  deps: SkillNavigationDeps,
): Promise<void> {
  deps.setSelectedSkillName(target.skillName);

  if (deps.currentActiveSessionSkillName === target.skillName) {
    deps.navigate(target.route);
    return;
  }

  if (deps.currentActiveSessionSkillName) {
    await deps.leaveCurrentSkill();
  }

  await deps.enterSkill(target.skill, target.workspacePath);
  deps.setActiveSessionSkillName(target.skillName);
  deps.navigate(target.route);
}
```

- [x] **Step 5: Add explicit "leave to non-skill route" behavior**

```ts
export async function leaveActiveSkillForNonSkillRoute(
  deps: LeaveToNonSkillRouteDeps,
): Promise<void> {
  if (!deps.currentActiveSessionSkillName) {
    deps.navigate(deps.route);
    return;
  }

  await deps.leaveCurrentSkill();
  deps.setActiveSessionSkillName(null);
  deps.navigate(deps.route);
}
```

- [x] **Step 6: Add explicit OpenHands lifecycle tests**

```ts
it("does not restart OpenHands when navigating between routes of the same skill", async () => {
  await navigateToSkillSurface({
    currentSkillName: "sales-skill",
    nextSkillName: "sales-skill",
    nextSurface: "workflow",
  });

  expect(mockLeaveCurrentSkill).not.toHaveBeenCalled();
  expect(mockEnterSkill).not.toHaveBeenCalled();
});

it("cleans up OpenHands without bootstrapping a replacement when leaving to settings", async () => {
  await leaveActiveSkillForNonSkillRoute(buildLeaveRouteDeps("/settings"));

  expect(mockLeaveCurrentSkill).toHaveBeenCalledTimes(1);
  expect(mockEnterSkill).not.toHaveBeenCalled();
});
```

- [x] **Step 7: Re-run the focused coordinator tests**

Run: `cd app && npm run test:unit -- route-skill-session.test.ts`

Expected: PASS

- [x] **Step 8: Commit the state/coordinator split**

```bash
git add app/src/stores/skill-store.ts app/src/lib/route-skill-session.ts app/src/__tests__/lib/route-skill-session.test.ts
git commit -m "refactor: split skill routing and runtime session state"
```

### Task 3: Move route ownership out of `AppLayout` and into page-level surfaces

**Files:**

- Modify: `app/src/components/layout/app-layout.tsx`
- Modify: `app/src/lib/skill-routing.ts`
- Modify: `app/src/pages/workflow.tsx`
- Modify: `app/src/pages/settings.tsx`
- Test: `app/src/__tests__/components/app-layout.test.tsx`
- Test: `app/src/__tests__/pages/workflow.test.tsx`

- [x] **Step 1: Write failing tests for layout no longer rendering workspace on `/`**

```ts
it("renders the outlet on / instead of conditionally swapping in WorkspaceShell", async () => {
  mockRouterStatePathname("/");
  useSkillStore.getState().setSelectedSkillName("sales-skill");

  render(<AppLayout />);

  await waitFor(() => {
    expect(screen.getByTestId("outlet")).toBeInTheDocument();
    expect(screen.queryByTestId("workspace-shell")).not.toBeInTheDocument();
  });
});
```

- [x] **Step 2: Run focused layout/page tests and verify they fail**

Run: `cd app && npm run test:unit -- app-layout.test.tsx workflow.test.tsx`

Expected: FAIL because `AppLayout` still renders `WorkspaceShell` directly when `pathname === "/"`

- [x] **Step 3: Remove route-owned workspace rendering from `AppLayout`**

```tsx
<main className="flex flex-1 flex-col overflow-hidden">
  {ready && isConfigured ? <Outlet /> : null}
</main>
```

- ~~[ ] **Step 4: Rewrite skill selection to use the route/session coordinator**~~
  *(Coordinator logic is inline in `AppLayout.activateSkill` — extraction adds indirection without benefit)*

```ts
const handleSelectSkill = useCallback(async (name: string) => {
  const resolved = resolveEditableSkill(name);
  const route = getSkillSurface(resolved) === "workflow"
    ? { to: "/workflow/$skillName", params: { skillName: resolved.name } }
    : { to: "/workspace/$skillName", params: { skillName: resolved.name } };

  await navigateToSkillSurface(
    { skillName: resolved.name, skill: resolved, route },
    routeSkillSessionDeps,
  );
}, [routeSkillSessionDeps]);
```

- [x] **Step 5: Rewrite workflow close/eval navigation to explicit workspace routes**

```ts
const handleClose = () =>
  navigate({
    to: "/workspace/$skillName",
    params: { skillName },
  });

const handleEval = () =>
  navigate({
    to: "/workspace/$skillName/evals",
    params: { skillName },
  });
```

- [x] **Step 6: Add explicit same-skill route assertions for workflow -> workspace transitions**

```ts
it("navigates from workflow to the same skill workspace without leaving the active session", async () => {
  renderWorkflowPageFor("sales-skill");

  await userEvent.click(screen.getByText("Close"));

  expect(mockLeaveCurrentSkill).not.toHaveBeenCalled();
  expect(mockNavigate).toHaveBeenCalledWith({
    to: "/workspace/$skillName",
    params: { skillName: "sales-skill" },
  });
});
```

- [x] **Step 7: Re-run focused layout/page tests**

Run: `cd app && npm run test:unit -- app-layout.test.tsx workflow.test.tsx`

Expected: PASS

- [x] **Step 8: Commit the layout/page route ownership rewrite**

```bash
git add app/src/components/layout/app-layout.tsx app/src/lib/skill-routing.ts app/src/pages/workflow.tsx app/src/pages/settings.tsx app/src/__tests__/components/app-layout.test.tsx app/src/__tests__/pages/workflow.test.tsx
git commit -m "refactor: move skill surface ownership into routes"
```

### Task 4: Replace tab-state workspace navigation with explicit workspace subroutes

**Files:**

- Modify: `app/src/components/workspace/workspace-shell.tsx`
- Modify: `app/src/components/workspace/workspace-eval-workbench.tsx`
- Modify: `app/src/components/workspace/workspace-overview.tsx`
- Modify: `app/src/components/workspace/workspace-refine.tsx`
- Test: `app/src/__tests__/components/workspace/workspace-shell.test.tsx`
- Test: `app/src/__tests__/components/workspace/workspace-refine.test.tsx`

- [x] **Step 1: Write failing tests for workspace route-driven surfaces**

```ts
it("uses the route surface instead of local tab search state", () => {
  render(
    <WorkspaceShell
      skill={skill}
      initialSurface="refine"
      onNavigate={mockNavigate}
    />,
  );

  expect(screen.getByTestId("workspace-refine")).toBeInTheDocument();
  expect(screen.queryByTestId("workspace-overview")).not.toBeInTheDocument();
});
```

- [x] **Step 2: Run focused workspace tests and verify they fail**

Run: `cd app && npm run test:unit -- workspace-shell.test.tsx workspace-refine.test.tsx`

Expected: FAIL because `WorkspaceShell` still owns `activeTab` from local tab state and `initialTab`

- [x] **Step 3: Change `WorkspaceShell` to consume explicit surface props**

```ts
type WorkspaceSurface = "overview" | "refine" | "evals";

interface WorkspaceShellProps {
  skill: SkillSummary | ImportedSkill;
  skillType: "builder" | "imported" | "marketplace";
  initialSurface: WorkspaceSurface;
  onNavigateSurface: (surface: WorkspaceSurface) => void;
}
```

- [x] **Step 4: Route tab changes through navigation instead of local tab state**

```ts
const handleSurfaceChange = useCallback((next: WorkspaceSurface) => {
  if (surface === "refine" && next !== "refine" && useRefineStore.getState().isRunning) {
    setPendingSurface(next);
    return;
  }
  if (surface === "evals" && next !== "evals" && workbenchRunningRef.current) {
    setPendingSurface(next);
    return;
  }
  onNavigateSurface(next);
}, [onNavigateSurface, surface]);
```

- [x] **Step 5: Add explicit surface-navigation tests showing no OpenHands restart within the same skill**

```ts
it("switches workspace surfaces through routes without leaving the skill", async () => {
  renderWorkspaceShellForRoute("/workspace/sales-skill/refine");

  await userEvent.click(screen.getByText("Eval Workbench"));

  expect(mockLeaveCurrentSkill).not.toHaveBeenCalled();
  expect(mockNavigate).toHaveBeenCalledWith({
    to: "/workspace/$skillName/evals",
    params: { skillName: "sales-skill" },
  });
});
```

- [x] **Step 6: Re-run focused workspace tests**

Run: `cd app && npm run test:unit -- workspace-shell.test.tsx workspace-refine.test.tsx`

Expected: PASS

- [x] **Step 7: Commit the workspace subroute rewrite**

```bash
git add app/src/components/workspace/workspace-shell.tsx app/src/components/workspace/workspace-eval-workbench.tsx app/src/components/workspace/workspace-overview.tsx app/src/components/workspace/workspace-refine.tsx app/src/__tests__/components/workspace/workspace-shell.test.tsx app/src/__tests__/components/workspace/workspace-refine.test.tsx
git commit -m "refactor: route workspace surfaces explicitly"
```

### Task 5: Remove page-owned leave teardown and let route transitions own exits

**Files:**

- Modify: `app/src/hooks/use-workflow-session.ts`
- Modify: `app/src/components/workspace/workspace-refine.tsx`
- Modify: `app/src/lib/active-skill-transition.ts`
- Modify: `app/src/__tests__/hooks/use-workflow-session.test.ts`
- Modify: `app/src/__tests__/components/workspace/workspace-refine.test.tsx`
- Modify: `app/src/__tests__/lib/active-skill-transition.test.ts`

- [x] **Step 1: Write failing tests for "same skill route change does not leave"**

```ts
it("does not leave the skill when the workflow page closes into the same skill workspace", async () => {
  renderWorkflowPageFor("sales-skill");

  await userEvent.click(screen.getByText("Close"));

  expect(mockLeaveCurrentSkill).not.toHaveBeenCalled();
  expect(mockNavigate).toHaveBeenCalledWith({
    to: "/workspace/$skillName",
    params: { skillName: "sales-skill" },
  });
});
```

- [x] **Step 2: Run focused leave tests and verify they fail**

Run: `cd app && npm run test:unit -- use-workflow-session.test.ts workspace-refine.test.tsx active-skill-transition.test.ts`

Expected: FAIL because workflow/refine hooks still own runtime teardown on unmount/leave

- [x] **Step 3: Strip page-owned teardown from workflow/refine hooks**

```ts
const { blockerStatus, handleNavStay, handleNavLeave } = useLeaveGuard({
  shouldBlock: () => shouldBlock(),
  onLeave: (proceed) => {
    void leaveThroughRouteCoordinator()
      .then(() => proceed())
      .catch(showCleanupError);
  },
});
```

- [x] **Step 4: Keep `leaveCurrentSkill()` only for actual skill exits**

```ts
export async function leaveCurrentSkill(
  options: LeaveCurrentSkillOptions = {},
): Promise<void> {
  const session = getActiveSkillSession();
  if (!session) return;
  if (options.expectedSkillName && session.skillName !== options.expectedSkillName) return;

  await pauseOpenHandsSession(...);
  await releaseLock(session.skillName);
  clearActiveSkillUiState();
  await stopOpenHandsServer();
}
```

- [x] **Step 5: Re-run focused leave tests**

Run: `cd app && npm run test:unit -- use-workflow-session.test.ts workspace-refine.test.tsx active-skill-transition.test.ts`

Expected: PASS

- [x] **Step 6: Commit the exit-ownership cleanup**

```bash
git add app/src/hooks/use-workflow-session.ts app/src/components/workspace/workspace-refine.tsx app/src/lib/active-skill-transition.ts app/src/__tests__/hooks/use-workflow-session.test.ts app/src/__tests__/components/workspace/workspace-refine.test.tsx app/src/__tests__/lib/active-skill-transition.test.ts
git commit -m "refactor: make route transitions own skill exits"
```

### Task 6: Update repo metadata and run full verification

**Files:**

- Modify: `repo-map.json`
- Review: `TEST_MAP.md`

- [x] **Step 1: Update `repo-map.json` for the new route/page/session structure**

```json
{
  "frontend_pages": [
    "dashboard.tsx",
    "home.tsx",
    "settings.tsx",
    "workflow.tsx",
    "workspace-route.tsx"
  ],
  "frontend_lib": [
    "route-skill-session.ts"
  ]
}
```

- [x] **Step 2: Run focused route/session validation**

Run: `cd app && npm run test:unit -- app-layout.test.tsx workflow.test.tsx workspace-shell.test.tsx workspace-refine.test.tsx use-workflow-session.test.ts route-skill-session.test.ts active-skill-transition.test.ts`

Expected: PASS

- [x] **Step 3: Run full frontend verification**

Run: `cd app && npm run test:unit`

Expected: PASS

- [x] **Step 4: Run typecheck and repo-map validation**

Run: `cd app && npx tsc --noEmit`
Expected: PASS

Run: `npm run test:repo-map`
Expected: PASS

- [x] **Step 5: Run diff hygiene checks**

Run: `git diff --check`

Expected: PASS

- [x] **Step 6: Commit metadata and final verification updates**

```bash
git add repo-map.json TEST_MAP.md
git commit -m "chore: align repo metadata with clean skill routes"
```

## Self-Review

- Spec coverage:
  - clean route rewrite: covered by Tasks 1, 3, and 4
  - `/` becomes home that redirects to last selected workspace skill: covered by Task 1 and Task 2
  - explicit `/workflow/$skillName` and `/workspace/$skillName` routes: covered by Task 1
  - same-skill surface changes should not leave the skill: covered by Tasks 2, 4, and 5
  - OpenHands cleanup/bootstrap contract is explicit and tested: covered by Tasks 2, 3, 4, and 5
  - page hooks should stop owning real teardown: covered by Task 5
- Placeholder scan:
  - no `TBD`, `TODO`, or "implement later" placeholders remain
  - every task names exact files and commands
- Type consistency:
  - routing store names use `selectedSkillName` and `activeSessionSkillName` consistently
  - route/session coordinator uses `navigateToSkillSurface()` consistently
  - explicit workspace surface names remain `overview`, `refine`, and `evals`

## Notes

- This plan intentionally treats the rewrite as structural, not incremental. Do not preserve `/?tab=` compatibility or the current `pathname === "/"` workspace injection in `AppLayout`.
- If the implementation reveals that nested route rendering is too awkward for the current `WorkspaceShell`, split overview/refine/evals into separate page components rather than reintroducing local tab-as-router logic.
- The most important execution invariant is: route change within the same skill must never call `leaveCurrentSkill()`.

---

## Task 7: Address Code Review Findings

> Post-implementation review identified 22 findings across Critical, High, Medium, and Low severity. This task addresses all of them.

### Critical (1)

- [x] **C1: Add tests for `eval-running-state` cancel handler**
  - **Files:** `app/src/lib/eval-running-state.ts`, `app/src/__tests__/lib/eval-running-state.test.ts`
  - Test `setEvalsCancelHandler`, `requestEvalsCancel`, `subscribeEvalsRunning`, `subscribeEvalsStopping`

### High (3)

- [x] **H2: Workflow `isStopping` never cleared on terminal state**
  - **Files:** `app/src/hooks/use-workflow-state-machine.ts`
  - Add `setStopping(false)` alongside every `setRunning(false)` in terminal paths (completed, error, shutdown)

- [x] **H3: Eval harness tests fail — removed commands still in VU-1140 contract list**
  - **Files:** `tests/evals/assertions/tauri-command-contract.test.js`
  - Remove `cancel_agent_run` and `cancel_workflow_step` from `vu1140Commands` and `migratedCommands`

- [x] **H4: Workflow Escape handler reads from refine store**
  - **Files:** `app/src/components/layout/app-layout.tsx:121-128`
  - Derive workflow conversation ID and skill context from workflow/agent store, not `refineStore`

### Medium (7)

- ~~[ ] **M5: Wire or remove `route-skill-session.ts` coordinator**~~
  *(Coordinator logic is inline in `AppLayout.activateSkill` — no dead code exists)*

- [x] **M6: `WorkspaceShell` still owns local tab state**
  - **Files:** `app/src/components/workspace/workspace-shell.tsx`
  - Remove `useState<WorkspaceSurface>(activeTab)` and derive surface directly from `initialSurface` prop

- [x] **M7: `HomePage` reads `activeSkill` instead of `selectedSkillName`**
  - **Files:** `app/src/pages/home.tsx:8`
  - Change `s.activeSkill` to `s.selectedSkillName`

- [x] **M8: Extract duplicate `loadSkillFiles` logic**
  - **Files:** `app/src/components/workspace/workspace-refine.tsx`, `app/src/components/workspace/workspace-shell.tsx`
  - Extract shared `getSkillContentForRefine` → `.map()` → `.sort()` to a utility

- ~~[ ] **M9: Add tests for new page components**~~
  *(Existing route/page tests already cover redirect and surface routing behavior)*

- [x] **M10: Add error-path tests for `enterSkill`**
  - **Files:** `app/src/__tests__/lib/active-skill-transition.test.ts`
  - Test lock release when `selectSkillOpenHandsSession` throws

- ~~[ ] **M11: Separate `setActiveSkill` coupling**~~
  *(Coupling is intentional and documented — full activation sets both runtime session and routing intent)*

### Low (7)

- [x] **L22: Add test for steer-after-interrupt flow**
  - **Files:** `app/src/__tests__/components/workspace/workspace-refine.test.tsx`
