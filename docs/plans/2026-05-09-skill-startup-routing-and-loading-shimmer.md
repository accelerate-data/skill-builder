# Skill Startup Routing and Landing Page Shimmer

## Problem

Two independent issues introduced when the defensive `useEffect` bootstrap was removed from
`AppLayout`:

**Issue 1 — Startup routing is always "/".** On app start, `SkillListPanel`'s default-selection
`useEffect` calls `void onActivateSkill?.(key)` → `activateSkill`. `activateSkill` bootstraps the
OpenHands session but never navigates. `AppLayout` then evaluates `showWorkspace =
selectedSkillData !== null && pathname === "/"` and renders `WorkspaceShell` regardless of whether
the skill is completed (should show workspace at `/`) or in progress (should show workflow at
`/skill/$skillName`).

**Issue 2 — No loading state while historical events hydrate.** After bootstrap,
`hydrateSelectedSkillOpenHandsSession` populates the refine store synchronously but the render
cycle that follows shows the real surface immediately, with no visual signal that it just arrived.
The same gap exists on the WorkflowPage: the page mounts but workflow-persistence data has not
loaded yet and the user sees a blank or partially populated surface.

The skill-selection click path (`handleSelectSkill` → `activateSkill` → `navigate({ to: "/" })`)
and the switch-away path (`cleanupCurrentSelectedSkill`) were verified against the diff and are
unchanged from main. Do not modify them except where the plan explicitly calls it out.

---

## Part A — Startup Routing Fix

### A1. Add `getSkillSurface` utility

**New file:** `app/src/lib/skill-routing.ts`

```typescript
import type { SkillSummary, ImportedSkill, EditableSkill } from "@/lib/types";

type SkillLike = Pick<SkillSummary, "skill_source" | "status">
               | Pick<EditableSkill, "skill_source" | "status">
               | ImportedSkill;

export function getSkillSurface(skill: SkillLike): "workflow" | "workspace" {
  const source = "skill_source" in skill ? skill.skill_source : null;
  if (source !== "skill-builder") return "workspace";
  const status = "status" in skill ? skill.status : null;
  return status === "completed" ? "workspace" : "workflow";
}
```

Rules:
- `skill_source !== "skill-builder"` (imported, marketplace) → always `"workspace"`
- `skill_source === "skill-builder"` AND `status === "completed"` → `"workspace"`
- `skill_source === "skill-builder"` AND any other status (null, "pending", "in_progress", etc.) → `"workflow"`

### A2. Add `navigateToSkillSurface` inside `AppLayout`

Add a `useCallback` inside `AppLayout` that encapsulates the routing decision. Place it after the
`handleSelectSkill` definition.

```typescript
const navigateToSkillSurface = useCallback(
  (skill: EditableSkill, tab?: string) => {
    if (getSkillSurface(skill) === "workflow") {
      navigate({ to: "/skill/$skillName", params: { skillName: skill.name } });
    } else {
      navigate({ to: "/", search: { tab: tab ?? undefined } });
    }
  },
  [navigate],
);
```

### A3. `activateSkill` navigates after bootstrap

At the end of `activateSkill`, after `await bootstrapSelectedSkillSession(editableSkill)` succeeds,
call `navigateToSkillSurface(editableSkill)`.

```typescript
const activateSkill = useCallback(
  async (name: string) => {
    // ... existing lookup, cleanup, setSelectedWorkspaceSkillName ...
    await bootstrapSelectedSkillSession(editableSkill);
    navigateToSkillSurface(editableSkill);          // ← add this line
  },
  [
    bootstrapSelectedSkillSession,
    builderSkills,
    cleanupCurrentSelectedSkill,
    importedSkills,
    navigateToSkillSurface,                         // ← add to deps
    selectedWorkspaceSkillName,
    setSelectedWorkspaceSkillName,
  ],
);
```

This also corrects the click path for in-progress skills: `handleSelectSkill` calls `activateSkill`
which will now navigate to `/skill/$skillName` instead of "/". See A4.

### A4. Remove the redundant `navigate` from `handleSelectSkill`

`handleSelectSkill` currently calls `navigate({ to: "/", ... })` after `await activateSkill(name)`.
Because `activateSkill` now navigates, remove that call to avoid a double-navigate.

The "same skill" early-return branch (`name === selectedWorkspaceSkillName`) is used for tab
switches within the already-selected skill. Keep its navigation but replace the hardcoded `"/"` with
`navigateToSkillSurface`:

```typescript
if (name === selectedWorkspaceSkillName) {
  navigateToSkillSurface(selectedSkillData ?? editableSkill, tab);  // tab preserved
  return;
}
```

Where `editableSkill` is derived the same way as in `activateSkill`. If `selectedSkillData` is
available, prefer it (it carries the current status).

After removing the post-`activateSkill` `navigate` call, the full body of `handleSelectSkill`
becomes:

```typescript
const handleSelectSkill = useCallback(
  async (name: string, tab?: string) => {
    if (name === selectedWorkspaceSkillName) {
      navigateToSkillSurface(/* current skill data */, tab);
      return;
    }
    const refineRunning = useRefineStore.getState().isRunning;
    const evalsRunning = getEvalsRunning();
    if (refineRunning || evalsRunning || runningWorkflow) {
      setPendingSkillSwitch(name);
      pendingSkillSwitchTabRef.current = tab;
      return;
    }
    try {
      await activateSkill(name);
      // navigation is now inside activateSkill — do not add navigate() here
    } catch (err) {
      console.error("[app-layout] skill switch cleanup failed", err);
      toast.error(err instanceof Error ? err.message : String(err), { duration: Infinity });
    }
  },
  [activateSkill, navigateToSkillSurface, runningWorkflow, selectedSkillData, selectedWorkspaceSkillName],
);
```

### A5. Bootstrap error leaves no dangling state

When `bootstrapSelectedSkillSession` throws, `activateSkill` must reset
`selectedWorkspaceSkillName` to `null` before re-throwing so no broken selected-but-unhydrated
state is left behind:

```typescript
try {
  await bootstrapSelectedSkillSession(editableSkill);
  navigateToSkillSurface(editableSkill);
} catch (err) {
  setSelectedWorkspaceSkillName(null);   // ← prevent dangling selection
  throw err;
}
```

The `handleSelectSkill` catch block already toasts the error. Nothing else needed there.

### A6. No SkillListPanel changes required

The startup `useEffect` already calls `void onActivateSkill?.(key)` → `activateSkill`, which now
navigates. No changes to SkillListPanel.

---

## Part B — Landing Page Shimmer

### B1. WorkspaceShell shimmer (workspace/refine surface)

**Derive `isBootstrapping` in `AppLayout`**

Add after the `showWorkspace` line:

```typescript
const refineSelectedSkill = useRefineStore((s) => s.selectedSkill);
const selectedSkillName = selectedSkillData
  ? "name" in selectedSkillData ? selectedSkillData.name : selectedSkillData.skill_name
  : null;
const isBootstrapping =
  showWorkspace &&
  (refineSelectedSkill === null ||
   refineSelectedSkill.name !== selectedSkillName ||
   refineSelectedSkill.plugin_slug !== selectedSkillData?.plugin_slug);
```

This is purely derived — no extra state. It is `true` from the moment `selectedSkillData` becomes
non-null (skill selected, data from TanStack Query arrives) until `hydrateSelectedSkillOpenHandsSession`
calls `store.selectSkill(editableSkill)`. It naturally clears itself.

**Create `WorkspaceLoadingSkeleton`**

New file: `app/src/components/workspace/workspace-loading-skeleton.tsx`

Mirror WorkspaceShell's outer chrome: a tab bar row followed by a flex-1 content area. Use the same
token classes as WorkspaceShell so the layout dimensions match without flicker on transition.

```tsx
import { Loader2 } from "lucide-react";

export function WorkspaceLoadingSkeleton() {
  return (
    <div
      data-testid="workspace-loading-skeleton"
      className="flex h-full flex-col animate-in fade-in duration-150"
    >
      <div className="flex items-center gap-1 border-b px-3 py-1 opacity-40 select-none">
        {["Overview", "Refine", "Evals"].map((label) => (
          <div
            key={label}
            className="rounded px-3 py-1.5 text-sm text-muted-foreground"
          >
            {label}
          </div>
        ))}
      </div>
      <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" style={{ color: "var(--color-pacific)" }} />
        Loading session…
      </div>
    </div>
  );
}
```

**Update `AppLayout` render**

```tsx
{ready && isConfigured
  ? showWorkspace && selectedSkillData
    ? isBootstrapping
      ? <WorkspaceLoadingSkeleton />
      : <WorkspaceShell
          key={selectedSkillName ?? undefined}   // remount on skill change
          skill={selectedSkillData}
          skillType={selectedSkillType}
          initialTab={workspaceInitialTab}
          className="animate-in fade-in duration-200"
        />
    : <Outlet />
  : null}
```

The `key` prop on `WorkspaceShell` ensures it remounts cleanly when the selected skill changes
rather than trying to diff a stale tree.

`WorkspaceShell` accepts an optional `className` prop — add it to its props interface and spread it
onto the outermost `div`.

### B2. WorkflowPage shimmer

**Read `app/src/hooks/use-workflow-persistence.ts`** before implementing. Identify the boolean or
loading flag it exposes that signals "first hydration not yet complete". At time of writing the hook
likely has no exposed loading flag — if so, add one.

Pattern to follow if no flag exists: add `isLoaded` state inside `useWorkflowPersistence`, default
`false`, set to `true` after the first successful data fetch. Return it as `isLoaded` from the hook.

**Create `WorkflowLoadingSkeleton`**

New file: `app/src/components/workflow-loading-skeleton.tsx`

Mirrors WorkflowPage's outer structure: a narrow step-list sidebar column (shimmer bars) and a
flex-1 content column (centered spinner). Width proportions should approximate the real sidebar
(240px) so the layout does not shift on transition.

```tsx
import { Loader2 } from "lucide-react";

export function WorkflowLoadingSkeleton() {
  return (
    <div
      data-testid="workflow-loading-skeleton"
      className="flex h-full animate-in fade-in duration-150"
    >
      {/* step sidebar shimmer */}
      <div className="flex w-60 shrink-0 flex-col gap-3 border-r p-4">
        {[1, 2, 3, 4].map((n) => (
          <div key={n} className="flex items-center gap-3">
            <div className="size-6 rounded-full bg-muted animate-pulse" />
            <div className="h-3 flex-1 rounded bg-muted animate-pulse" />
          </div>
        ))}
      </div>
      {/* content area */}
      <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" style={{ color: "var(--color-pacific)" }} />
        Loading skill…
      </div>
    </div>
  );
}
```

**Use it in `WorkflowPage`**

In `WorkflowPage`, obtain the `isLoaded` flag from `useWorkflowPersistence`:

```typescript
const { isLoaded } = useWorkflowPersistence({ skillName, ... });
```

At the top of the render, before all other content:

```tsx
if (!isLoaded) {
  return <WorkflowLoadingSkeleton />;
}
```

Once `isLoaded` transitions to `true`, the real page renders with:

```tsx
<div className="flex h-full flex-col animate-in fade-in duration-200">
  {/* existing WorkflowPage content unchanged */}
</div>
```

Wrap the outermost return div (not individual children) so the fade applies to the full surface at
once. Verify that `useWorkflowPersistence` sets `isLoaded = true` promptly after the first load so
the skeleton does not flash unnecessarily when the data is already in the TanStack Query cache.

---

## Part C — Tests

Classification (Khorikov quadrant):
- `skill-routing.ts` → pure domain function, no collaborators → **unit tests**
- `AppLayout` startup routing and shimmer → controller orchestrating Tauri IPC, stores, router →
  **integration tests** (existing `app-layout.test.tsx` pattern: render with mock Tauri, assert on
  `screen` and `mockNavigate`)
- `WorkspaceLoadingSkeleton`, `WorkflowLoadingSkeleton` → trivial presentational → no dedicated
  tests; covered by integration tests that assert `data-testid`

### C1. Unit tests for `getSkillSurface`

**New file:** `app/src/__tests__/lib/skill-routing.test.ts`

```
## Approved behaviours

getSkillSurface
  - returns "workflow" for a builder skill with status null
  - returns "workflow" for a builder skill with status "pending"
  - returns "workflow" for a builder skill with status "in_progress"
  - returns "workspace" for a builder skill with status "completed"
  - returns "workspace" for a skill with skill_source "marketplace"
  - returns "workspace" for an ImportedSkill (no skill_source field)
  - returns "workspace" when skill_source is null
```

All tests are synchronous, parameterized where possible. No mocks.

### C2. Integration tests for startup routing (add to `app-layout.test.tsx`)

Setup shared across these tests: mock `list_skills` to return one skill, mock `acquire_lock` and
`select_skill_openhands_session` to resolve. Assert on `mockNavigate` calls.

```
AppLayout / startup routing
  - navigates to "/" when the pre-selected skill has status "completed"
  - navigates to "/skill/$skillName" when the pre-selected skill has status "in_progress"
  - navigates to "/" for an imported skill (no workflow steps)
  - does not navigate when bootstrap throws (mockNavigate not called after error)
  - clears selectedWorkspaceSkillName when bootstrap throws
      assert: useSkillStore.getState().activeSkill is null after error
```

The mock for `SkillListPanel` in this test file already exposes buttons to trigger `onSelectSkill`.
For startup routing tests, set `useSkillStore.getState().setActiveSkill(skillKey)` **before**
rendering so the SkillListPanel default-selection effect fires immediately.

### C3. Integration tests for WorkspaceShell shimmer (add to `app-layout.test.tsx`)

```
AppLayout / workspace shimmer
  - renders WorkspaceLoadingSkeleton while bootstrap is in progress
      approach: make select_skill_openhands_session hang (never resolve);
      assert: screen.getByTestId("workspace-loading-skeleton") is in the document
      assert: screen.queryByTestId("workspace-shell") is NOT in the document
  - renders WorkspaceShell (not skeleton) after bootstrap completes
      approach: resolve select_skill_openhands_session normally;
      assert: screen.queryByTestId("workspace-loading-skeleton") is NOT in the document
  - skeleton disappears when refineStore.selectedSkill is set to the matching skill
      approach: set refineStore.selectedSkill manually to simulate a completed bootstrap;
      assert: WorkspaceLoadingSkeleton is gone
```

`WorkspaceShell` is already mocked in this test file (or should be, to isolate AppLayout). Add
`data-testid="workspace-shell"` to its mock element.

### C4. Integration tests for WorkflowPage loading state

**New describe block** in the existing workflow page test file (read
`app/src/__tests__/pages/workflow.test.tsx` or equivalent before writing to match its setup
pattern).

```
WorkflowPage / loading shimmer
  - renders WorkflowLoadingSkeleton before persistence data loads
      approach: make the persistence hook's first fetch hang;
      assert: screen.getByTestId("workflow-loading-skeleton") is in the document
  - renders workflow content (not skeleton) after persistence data loads
      approach: resolve persistence hook;
      assert: screen.queryByTestId("workflow-loading-skeleton") is NOT in the document
```

---

## Execution order for a coding agent

1. `app/src/lib/skill-routing.ts` — create `getSkillSurface`
2. `app/src/__tests__/lib/skill-routing.test.ts` — unit tests (run: `npx vitest run src/__tests__/lib/skill-routing.test.ts`)
3. `app/src/components/workspace/workspace-loading-skeleton.tsx` — create skeleton
4. `app/src/components/workflow-loading-skeleton.tsx` — create skeleton
5. `app/src/components/layout/app-layout.tsx` — A2–A5 + B1 render change
6. `app/src/hooks/use-workflow-persistence.ts` — add `isLoaded` flag if missing
7. `app/src/pages/workflow.tsx` — B2 skeleton gate + fade wrapper
8. `app/src/__tests__/components/app-layout.test.tsx` — C2 and C3 tests
9. Workflow page test file — C4 tests
10. Run full suite: `cd app && npm run test:unit`
11. TypeScript check: `cd app && npx tsc --noEmit`

## Pre-commit checklist

- [ ] `getSkillSurface` unit tests all pass
- [ ] AppLayout startup routing tests pass (navigate called with correct route per skill status)
- [ ] WorkspaceLoadingSkeleton visible while bootstrap pending; gone after hydration
- [ ] WorkflowPage skeleton visible before persistence loads; gone after
- [ ] `npx tsc --noEmit` — zero errors
- [ ] `npm run test:unit` — zero new failures
- [ ] `repo-map.json` updated: `skill-routing.ts` added to `frontend_libs` or equivalent section;
  `workspace-loading-skeleton.tsx` and `workflow-loading-skeleton.tsx` added to `frontend_components`
