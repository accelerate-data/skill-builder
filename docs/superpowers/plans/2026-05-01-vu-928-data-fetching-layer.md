# VU-928 Data Fetching Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace request/response backend data stored in Zustand with TanStack Query hooks, keeping Zustand focused on UI state and event-driven runtime state.

**Architecture:** Add a single React Query provider at the app root and a focused query module under `app/src/lib/queries/`. Request/response data flows through query hooks and mutations; Zustand remains for local UI selections, navigation-persistent UI choices, workflow state, refine drafts, and live agent stream state.

**Tech Stack:** React 19, TypeScript strict, TanStack Query, Zustand, Tauri IPC wrappers, Vitest, React Testing Library, Playwright.

---

## File Structure

Create:

- `app/src/lib/query-client.ts` - exports the shared `QueryClient` factory and default options.
- `app/src/lib/queries/query-keys.ts` - central query key factory for stable invalidation.
- `app/src/lib/queries/skills.ts` - skill list, imported skills, delete/import-refresh mutations, and cache helpers.
- `app/src/lib/queries/usage.ts` - usage summary/session/model/day query hooks and reset mutation.
- `app/src/lib/queries/documents.ts` - document list and document mutation invalidation hooks.
- `app/src/lib/queries/plugins.ts` - plugin list query and plugin mutation invalidation hooks.
- `app/src/lib/queries/auth.ts` - GitHub user identity query and logout mutation.
- `app/src/lib/queries/agent-stream-cache.ts` - explicit helper for event streams that need to invalidate or update request/response caches.
- `app/src/test/query-test-utils.tsx` - test wrapper for React Query.
- `app/src/__tests__/lib/queries/skills.test.tsx`
- `app/src/__tests__/lib/queries/usage.test.tsx`
- `app/src/__tests__/lib/queries/cache-contract.test.tsx`

Modify:

- `app/package.json`
- `app/package-lock.json`
- `app/src/main.tsx`
- `app/src/hooks/use-app-startup.ts`
- `app/src/hooks/use-workflow-persistence.ts`
- `app/src/pages/dashboard.tsx`
- `app/src/pages/workflow.tsx`
- `app/src/components/skill-list-panel.tsx`
- `app/src/components/workspace/workspace-shell.tsx`
- `app/src/components/workspace/workspace-overview.tsx`
- `app/src/components/settings/usage-section.tsx`
- `app/src/components/imported-skills-tab.tsx`
- `app/src/components/documents-tab.tsx`
- `app/src/components/github-login-dialog.tsx`
- `app/src/components/feedback-dialog.tsx`
- `app/src/stores/skill-store.ts`
- `app/src/stores/imported-skills-store.ts`
- `app/src/stores/usage-store.ts`
- `app/src/stores/document-store.ts`
- `app/src/stores/plugin-store.ts`
- `app/src/stores/auth-store.ts`
- `.claude/rules/state-management.md`
- `repo-map.json`
- Relevant tests under `app/src/__tests__/stores/`, `app/src/__tests__/components/`, `app/src/__tests__/pages/`, and `app/e2e/`.

Do not migrate:

- `app/src/stores/agent-store.ts` - live event stream/runtime state stays in Zustand.
- `app/src/stores/workflow-store.ts` - workflow UI/session state stays in Zustand.
- `app/src/stores/refine-store.ts` fields for chat drafts, selected files, and interactive refine UI state.

---

### Task 1: Install TanStack Query and Add the App Provider

**Files:**

- Modify: `app/package.json`
- Modify: `app/package-lock.json`
- Create: `app/src/lib/query-client.ts`
- Modify: `app/src/main.tsx`
- Create: `app/src/test/query-test-utils.tsx`
- Test: `app/src/__tests__/lib/queries/cache-contract.test.tsx`

- [ ] **Step 1: Add the dependency**

Run:

```bash
cd app && npm install @tanstack/react-query
```

Expected: `app/package.json` contains `@tanstack/react-query` in `dependencies`, and `app/package-lock.json` is updated.

- [ ] **Step 2: Create the query client factory**

Create `app/src/lib/query-client.ts`:

```ts
import { QueryClient } from "@tanstack/react-query";

export function createAppQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 10 * 60_000,
        retry: 1,
        refetchOnWindowFocus: false,
      },
      mutations: {
        retry: 0,
      },
    },
  });
}

export const appQueryClient = createAppQueryClient();
```

- [ ] **Step 3: Wrap the app in `QueryClientProvider`**

Modify `app/src/main.tsx`:

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { attachConsole } from "@tauri-apps/plugin-log";
import { ThemeProvider } from "./components/theme-provider";
import { ErrorBoundary } from "./components/error-boundary";
import { Toaster } from "./components/ui/sonner";
import { router } from "./router";
import { appQueryClient } from "./lib/query-client";
import '@fontsource-variable/jetbrains-mono';
import "github-markdown-css/github-markdown.css";
import "./styles/globals.css";

attachConsole().catch((err) => {
  console.error('Failed to attach console logger:', err);
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={appQueryClient}>
      <ThemeProvider>
        <ErrorBoundary>
          <RouterProvider router={router} />
          <Toaster position="top-right" offset={{ top: 40, right: 12 }} />
        </ErrorBoundary>
      </ThemeProvider>
    </QueryClientProvider>
  </React.StrictMode>
);
```

- [ ] **Step 4: Add a test query wrapper**

Create `app/src/test/query-test-utils.tsx`:

```tsx
import type { ReactElement, ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { createAppQueryClient } from "@/lib/query-client";

export function createTestQueryClient() {
  const client = createAppQueryClient();
  client.setDefaultOptions({
    queries: {
      staleTime: 0,
      gcTime: Infinity,
      retry: false,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: false,
    },
  });
  return client;
}

export function renderWithQueryClient(ui: ReactElement) {
  const queryClient = createTestQueryClient();

  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }

  return {
    queryClient,
    ...render(ui, { wrapper: Wrapper }),
  };
}
```

- [ ] **Step 5: Write the provider contract test**

Create `app/src/__tests__/lib/queries/cache-contract.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { createAppQueryClient } from "@/lib/query-client";

describe("query client defaults", () => {
  it("keeps backend data fresh briefly without refetching on focus", () => {
    const client = createAppQueryClient();
    const defaults = client.getDefaultOptions();

    expect(defaults.queries?.staleTime).toBe(30_000);
    expect(defaults.queries?.refetchOnWindowFocus).toBe(false);
    expect(defaults.mutations?.retry).toBe(0);
  });
});
```

- [ ] **Step 6: Run the contract test**

Run:

```bash
cd app && npx vitest run src/__tests__/lib/queries/cache-contract.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/package.json app/package-lock.json app/src/lib/query-client.ts app/src/main.tsx app/src/test/query-test-utils.tsx app/src/__tests__/lib/queries/cache-contract.test.tsx
git commit -m "VU-928: add app query provider"
```

---

### Task 2: Add Query Keys and Skill Data Hooks

**Files:**

- Create: `app/src/lib/queries/query-keys.ts`
- Create: `app/src/lib/queries/skills.ts`
- Modify: `app/src/stores/skill-store.ts`
- Modify: `app/src/stores/imported-skills-store.ts`
- Test: `app/src/__tests__/lib/queries/skills.test.tsx`
- Test: `app/src/__tests__/stores/skill-store.test.ts`

- [ ] **Step 1: Write skill query tests first**

Create `app/src/__tests__/lib/queries/skills.test.tsx`:

```tsx
import { describe, expect, it, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { mockInvokeCommands, resetTauriMocks, mockInvoke } from "@/test/mocks/tauri";
import { createTestQueryClient } from "@/test/query-test-utils";
import { makeSkillSummary } from "@/test/fixtures";
import { useBuilderSkillsQuery, useImportedSkillsQuery, useDeleteImportedSkillMutation } from "@/lib/queries/skills";

function wrapper() {
  const queryClient = createTestQueryClient();
  return {
    queryClient,
    Wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  };
}

describe("skill queries", () => {
  beforeEach(() => {
    resetTauriMocks();
  });

  it("loads builder skills through the query cache", async () => {
    const skill = makeSkillSummary({ name: "analytics-helper" });
    mockInvokeCommands({ list_skills: [skill] });
    const { Wrapper } = wrapper();

    const { result } = renderHook(() => useBuilderSkillsQuery("/workspace"), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([skill]);
    expect(mockInvoke).toHaveBeenCalledWith("list_skills", { workspacePath: "/workspace", sourceUrl: null });
  });

  it("does not load builder skills until workspace path exists", () => {
    const { Wrapper } = wrapper();

    const { result } = renderHook(() => useBuilderSkillsQuery(null), { wrapper: Wrapper });

    expect(result.current.fetchStatus).toBe("idle");
    expect(mockInvoke).not.toHaveBeenCalledWith("list_skills", expect.anything());
  });

  it("invalidates imported skills after delete", async () => {
    mockInvokeCommands({
      list_imported_skills: [],
      delete_imported_skill: undefined,
    });
    const { Wrapper, queryClient } = wrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useDeleteImportedSkillMutation(), { wrapper: Wrapper });
    result.current.mutate("id-1");

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockInvoke).toHaveBeenCalledWith("delete_imported_skill", { skillId: "id-1" });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["skills", "imported", null] });
  });

  it("loads imported skills through the query cache", async () => {
    mockInvokeCommands({ list_imported_skills: [] });
    const { Wrapper } = wrapper();

    const { result } = renderHook(() => useImportedSkillsQuery(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockInvoke).toHaveBeenCalledWith("list_imported_skills", { sourceUrl: null });
  });
});
```

The test uses `vi`, so include it in the imports:

```ts
import { describe, expect, it, beforeEach, vi } from "vitest";
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
cd app && npx vitest run src/__tests__/lib/queries/skills.test.tsx
```

Expected: FAIL because `@/lib/queries/skills` and `@/lib/queries/query-keys` do not exist.

- [ ] **Step 3: Add query key factory**

Create `app/src/lib/queries/query-keys.ts`:

```ts
export const queryKeys = {
  skills: {
    all: ["skills"] as const,
    builder: (workspacePath: string | null, sourceUrl: string | null = null) =>
      ["skills", "builder", workspacePath, sourceUrl] as const,
    imported: (sourceUrl: string | null = null) =>
      ["skills", "imported", sourceUrl] as const,
  },
  usage: {
    all: ["usage"] as const,
    summary: (filters: UsageQueryFilters) => ["usage", "summary", filters] as const,
    sessions: (filters: UsageQueryFilters) => ["usage", "sessions", filters] as const,
    agentRuns: (filters: UsageQueryFilters) => ["usage", "agent-runs", filters] as const,
    byStep: (filters: UsageQueryFilters) => ["usage", "by-step", filters] as const,
    byModel: (filters: UsageQueryFilters) => ["usage", "by-model", filters] as const,
    byDay: (filters: UsageQueryFilters) => ["usage", "by-day", filters] as const,
    skillNames: ["usage", "skill-names"] as const,
  },
  documents: {
    all: ["documents"] as const,
    list: ["documents", "list"] as const,
    skills: ["documents", "skills"] as const,
  },
  plugins: {
    all: ["plugins"] as const,
    list: ["plugins", "list"] as const,
  },
  auth: {
    all: ["auth"] as const,
    githubUser: ["auth", "github-user"] as const,
  },
};

export interface UsageQueryFilters {
  hideCancelled: boolean;
  startDate: string | null;
  skillFilter: string | null;
  modelFamilyFilter: string | null;
}
```

- [ ] **Step 4: Add skill query hooks**

Create `app/src/lib/queries/skills.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  deleteImportedSkill,
  listImportedSkills,
  listSkills,
  type SkillSummary,
} from "@/lib/tauri";
import type { ImportedSkill } from "@/lib/types";
import { queryKeys } from "./query-keys";

export function useBuilderSkillsQuery(workspacePath: string | null, sourceUrl: string | null = null) {
  return useQuery<SkillSummary[]>({
    queryKey: queryKeys.skills.builder(workspacePath, sourceUrl),
    enabled: !!workspacePath,
    queryFn: () => listSkills(workspacePath!, sourceUrl),
    initialData: [],
  });
}

export function useImportedSkillsQuery(sourceUrl: string | null = null) {
  return useQuery<ImportedSkill[]>({
    queryKey: queryKeys.skills.imported(sourceUrl),
    queryFn: () => listImportedSkills(sourceUrl),
    initialData: [],
  });
}

export function useDeleteImportedSkillMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (skillId: string) => deleteImportedSkill(skillId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.skills.imported() });
    },
  });
}

export function useInvalidateSkillQueries() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: queryKeys.skills.all });
}
```

If `listImportedSkills` or `deleteImportedSkill` are not exported from `app/src/lib/tauri.ts`, add typed wrappers there using the existing command names:

```ts
export const listImportedSkills = (sourceUrl: string | null = null) =>
  invoke<ImportedSkill[]>("list_imported_skills", { sourceUrl });

export const deleteImportedSkill = (skillId: string) =>
  invoke<void>("delete_imported_skill", { skillId });
```

- [ ] **Step 5: Strip server data from skill stores**

Modify `app/src/stores/skill-store.ts` to keep only UI state:

```ts
import { create } from "zustand";

interface SkillState {
  activeSkill: string | null;
  lockedSkills: Set<string>;
  latestVersion: string | null;
  setActiveSkill: (name: string | null) => void;
  setLockedSkills: (names: Set<string>) => void;
  setLatestVersion: (version: string) => void;
}

export const useSkillStore = create<SkillState>((set) => ({
  activeSkill: null,
  lockedSkills: new Set(),
  latestVersion: null,
  setActiveSkill: (name) => set({ activeSkill: name }),
  setLockedSkills: (names) => set({ lockedSkills: names }),
  setLatestVersion: (version) => set({ latestVersion: version }),
}));
```

Modify `app/src/stores/imported-skills-store.ts` to remove fetched data. If no UI state remains after migration, delete this file and replace imports with query hooks in later tasks.

- [ ] **Step 6: Update store tests**

Replace server-state assertions in `app/src/__tests__/stores/skill-store.test.ts` with UI-state assertions:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { useSkillStore } from "@/stores/skill-store";

describe("useSkillStore", () => {
  beforeEach(() => {
    useSkillStore.setState({
      activeSkill: null,
      lockedSkills: new Set(),
      latestVersion: null,
    });
  });

  it("stores selected skill UI state", () => {
    useSkillStore.getState().setActiveSkill("my-skill");
    expect(useSkillStore.getState().activeSkill).toBe("my-skill");

    useSkillStore.getState().setActiveSkill(null);
    expect(useSkillStore.getState().activeSkill).toBeNull();
  });

  it("replaces externally locked skill UI state", () => {
    useSkillStore.getState().setLockedSkills(new Set(["a", "b"]));
    useSkillStore.getState().setLockedSkills(new Set(["c"]));

    expect([...useSkillStore.getState().lockedSkills]).toEqual(["c"]);
  });

  it("stores latest version UI state for immediate post-restore display", () => {
    useSkillStore.getState().setLatestVersion("3");
    expect(useSkillStore.getState().latestVersion).toBe("3");
  });
});
```

Delete `app/src/__tests__/stores/imported-skills-store.test.ts` if the store file is deleted.

- [ ] **Step 7: Run focused tests**

Run:

```bash
cd app && npx vitest run src/__tests__/lib/queries/skills.test.tsx src/__tests__/stores/skill-store.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add app/src/lib/queries/query-keys.ts app/src/lib/queries/skills.ts app/src/stores/skill-store.ts app/src/stores/imported-skills-store.ts app/src/__tests__/lib/queries/skills.test.tsx app/src/__tests__/stores/skill-store.test.ts app/src/__tests__/stores/imported-skills-store.test.ts app/src/lib/tauri.ts
git commit -m "VU-928: move skill data into query hooks"
```

---

### Task 3: Migrate Skill List Consumers to Query Hooks

**Files:**

- Modify: `app/src/components/skill-list-panel.tsx`
- Modify: `app/src/pages/dashboard.tsx`
- Modify: `app/src/pages/workflow.tsx`
- Modify: `app/src/components/workspace/workspace-shell.tsx`
- Modify: `app/src/components/workspace/workspace-overview.tsx`
- Modify: `app/src/hooks/use-app-startup.ts`
- Modify: `app/src/hooks/use-workflow-persistence.ts`
- Test: `app/src/__tests__/components/skill-list-panel.test.tsx`
- Test: `app/src/__tests__/pages/dashboard.test.tsx`
- Test: `app/src/__tests__/pages/workflow.test.tsx`

- [ ] **Step 1: Update `SkillListPanel` test setup to render through QueryClient**

In `app/src/__tests__/components/skill-list-panel.test.tsx`, stop seeding `useSkillStore.setState({ skills: [...] })` and `useImportedSkillsStore.setState({ skills: [...] })`. Replace each setup with Tauri command mocks and `renderWithQueryClient`.

Example replacement:

```tsx
import { renderWithQueryClient } from "@/test/query-test-utils";
import { mockInvokeCommands } from "@/test/mocks/tauri";

mockInvokeCommands({
  list_skills: [olderBuilder, recentBuilder],
  list_imported_skills: [importedSkill],
  get_externally_locked_skills: [],
});

renderWithQueryClient(<SkillListPanel />);
```

For assertions that need async loading, use:

```ts
expect(await screen.findByText("recent-skill")).toBeInTheDocument();
```

- [ ] **Step 2: Run the component test to verify failures**

Run:

```bash
cd app && npx vitest run src/__tests__/components/skill-list-panel.test.tsx
```

Expected: FAIL until the component reads query data instead of store data.

- [ ] **Step 3: Migrate `SkillListPanel`**

In `app/src/components/skill-list-panel.tsx`, replace store data and manual fetch code:

```tsx
const builderSkills = useSkillStore((s) => s.skills);
const setSkills = useSkillStore((s) => s.setSkills);
const importedSkills = useImportedSkillsStore((s) => s.skills);
const fetchImportedSkills = useImportedSkillsStore((s) => s.fetchSkills);
```

with:

```tsx
const { data: builderSkills = [] } = useBuilderSkillsQuery(workspacePath);
const { data: importedSkills = [] } = useImportedSkillsQuery();
const deleteImportedSkillMutation = useDeleteImportedSkillMutation();
const invalidateSkillQueries = useInvalidateSkillQueries();
```

Delete the `useEffect` that calls `listSkills(workspacePath).then(setSkills)` and `fetchImportedSkills()`.

For delete/import/move/restore code paths that currently call `listSkills(...).then(setSkills)` or `fetchImportedSkills`, replace with:

```ts
await invalidateSkillQueries();
```

For imported delete:

```ts
await deleteImportedSkillMutation.mutateAsync(skill.importedSkillId);
```

- [ ] **Step 4: Migrate page-level consumers**

In `app/src/pages/dashboard.tsx`, replace:

```tsx
const setSkills = useSkillStore((s) => s.setSkills)
```

and one-off `listSkills(...).then(setSkills)` calls with `useBuilderSkillsQuery(workspacePath)` if dashboard renders skill counts or redirects from current skill state. If it only preloads, remove the preloading entirely because `SkillListPanel` owns the query.

In `app/src/pages/workflow.tsx`, replace:

```tsx
const pluginSlug = useSkillStore((s) => s.skills.find((sk) => sk.name === skillName)?.plugin_slug);
const skillLibraryKey = useSkillStore((s) => s.skills.find((sk) => sk.name === skillName)?.library_key);
```

with:

```tsx
const { data: builderSkills = [] } = useBuilderSkillsQuery(workspacePath);
const currentSkill = builderSkills.find((sk) => sk.name === skillName);
const pluginSlug = currentSkill?.plugin_slug;
const skillLibraryKey = currentSkill?.library_key;
```

In `app/src/components/workspace/workspace-shell.tsx`, replace `isSkillStoreLoading` with query loading state from `useBuilderSkillsQuery(workspacePath)`.

In `app/src/components/workspace/workspace-overview.tsx`, replace post-restore `listSkills(...).then(useSkillStore.getState().setSkills)` with `useInvalidateSkillQueries`.

In `app/src/hooks/use-app-startup.ts`, delete background `listSkills(wp).then(useSkillStore.getState().setSkills)` calls.

In `app/src/hooks/use-workflow-persistence.ts`, replace post-workflow `listSkills(workspacePath).then(useSkillStore.getState().setSkills)` with a call to the cache helper from `app/src/lib/queries/agent-stream-cache.ts` added in Task 7, or pass an `onWorkflowComplete` invalidation callback from the component using the hook.

- [ ] **Step 5: Run skill/dashboard/workflow tests**

Run:

```bash
cd app && npx vitest run src/__tests__/components/skill-list-panel.test.tsx src/__tests__/pages/dashboard.test.tsx src/__tests__/pages/workflow.test.tsx
```

Expected: PASS after tests are updated to use query-backed data.

- [ ] **Step 6: Commit**

```bash
git add app/src/components/skill-list-panel.tsx app/src/pages/dashboard.tsx app/src/pages/workflow.tsx app/src/components/workspace/workspace-shell.tsx app/src/components/workspace/workspace-overview.tsx app/src/hooks/use-app-startup.ts app/src/hooks/use-workflow-persistence.ts app/src/__tests__/components/skill-list-panel.test.tsx app/src/__tests__/pages/dashboard.test.tsx app/src/__tests__/pages/workflow.test.tsx
git commit -m "VU-928: migrate skill list consumers to query hooks"
```

---

### Task 4: Migrate Usage Data to Query Hooks

**Files:**

- Create: `app/src/lib/queries/usage.ts`
- Modify: `app/src/stores/usage-store.ts`
- Modify: `app/src/components/settings/usage-section.tsx`
- Test: `app/src/__tests__/lib/queries/usage.test.tsx`
- Test: `app/src/__tests__/stores/usage-store.test.ts`
- Test: `app/e2e/usage/usage-smoke.spec.ts`

- [ ] **Step 1: Write usage query tests first**

Create `app/src/__tests__/lib/queries/usage.test.tsx`:

```tsx
import { describe, expect, it, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { mockInvokeCommands, mockInvoke, resetTauriMocks } from "@/test/mocks/tauri";
import { createTestQueryClient } from "@/test/query-test-utils";
import { useUsageQueries, useUsageSkillNamesQuery, useResetUsageMutation } from "@/lib/queries/usage";

function wrapper() {
  const queryClient = createTestQueryClient();
  return {
    queryClient,
    Wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  };
}

const filters = {
  hideCancelled: false,
  startDate: null,
  skillFilter: null,
  modelFamilyFilter: null,
};

describe("usage queries", () => {
  beforeEach(() => {
    resetTauriMocks();
  });

  it("loads usage data through stable query keys", async () => {
    mockInvokeCommands({
      get_usage_summary: { total_cost: 1, total_runs: 2, avg_cost_per_run: 0.5 },
      get_recent_workflow_sessions: [],
      get_agent_runs: [],
      get_usage_by_step: [],
      get_usage_by_model: [],
      get_usage_by_day: [],
    });
    const { Wrapper } = wrapper();

    const { result } = renderHook(() => useUsageQueries(filters), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.summary.isSuccess).toBe(true));
    expect(result.current.summary.data?.total_runs).toBe(2);
    expect(mockInvoke).toHaveBeenCalledWith("get_usage_summary", {
      hideCancelled: false,
      startDate: null,
      skillName: null,
    });
  });

  it("keeps stale usage responses from overwriting the latest filter result", async () => {
    const { Wrapper } = wrapper();
    let resolveOld!: (value: unknown) => void;
    const oldSummary = new Promise((resolve) => { resolveOld = resolve; });

    mockInvoke.mockImplementation((cmd: string, args: Record<string, unknown>) => {
      if (cmd === "get_usage_summary" && args.skillName === "old") return oldSummary;
      if (cmd === "get_usage_summary" && args.skillName === "new") {
        return Promise.resolve({ total_cost: 9, total_runs: 9, avg_cost_per_run: 1 });
      }
      return Promise.resolve([]);
    });

    const { result, rerender } = renderHook(
      ({ skillFilter }) => useUsageQueries({ ...filters, skillFilter }),
      { wrapper: Wrapper, initialProps: { skillFilter: "old" as string | null } },
    );

    rerender({ skillFilter: "new" });
    await waitFor(() => expect(result.current.summary.data?.total_runs).toBe(9));

    resolveOld({ total_cost: 1, total_runs: 1, avg_cost_per_run: 1 });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(result.current.summary.data?.total_runs).toBe(9);
  });

  it("invalidates usage queries after reset", async () => {
    mockInvokeCommands({ reset_usage: undefined });
    const { Wrapper, queryClient } = wrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useResetUsageMutation(), { wrapper: Wrapper });
    result.current.mutate();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["usage"] });
  });

  it("loads usage skill names", async () => {
    mockInvokeCommands({ get_workflow_skill_names: ["alpha"] });
    const { Wrapper } = wrapper();

    const { result } = renderHook(() => useUsageSkillNamesQuery(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.data).toEqual(["alpha"]));
  });
});
```

Include `vi` in the imports:

```ts
import { describe, expect, it, beforeEach, vi } from "vitest";
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
cd app && npx vitest run src/__tests__/lib/queries/usage.test.tsx
```

Expected: FAIL because usage query hooks do not exist.

- [ ] **Step 3: Add usage query hooks**

Create `app/src/lib/queries/usage.ts`:

```ts
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getAgentRuns,
  getRecentWorkflowSessions,
  getUsageByDay,
  getUsageByModel,
  getUsageByStep,
  getUsageSummary,
  getWorkflowSkillNames,
  resetUsage,
} from "@/lib/tauri";
import type { UsageQueryFilters } from "./query-keys";
import { queryKeys } from "./query-keys";

export type DateRange = "7d" | "14d" | "30d" | "90d" | "all";

export function toUsageStartDate(range: DateRange): string | null {
  if (range === "all") return null;
  const days = range === "7d" ? 7 : range === "14d" ? 14 : range === "30d" ? 30 : 90;
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

export function useUsageQueries(filters: UsageQueryFilters) {
  const results = useQueries({
    queries: [
      {
        queryKey: queryKeys.usage.summary(filters),
        queryFn: () => getUsageSummary(filters.hideCancelled, filters.startDate, filters.skillFilter),
      },
      {
        queryKey: queryKeys.usage.sessions(filters),
        queryFn: () => getRecentWorkflowSessions(50, filters.hideCancelled, filters.startDate, filters.skillFilter),
      },
      {
        queryKey: queryKeys.usage.agentRuns(filters),
        queryFn: () => getAgentRuns(filters.hideCancelled, filters.startDate, filters.skillFilter, filters.modelFamilyFilter),
      },
      {
        queryKey: queryKeys.usage.byStep(filters),
        queryFn: () => getUsageByStep(filters.hideCancelled, filters.startDate, filters.skillFilter),
      },
      {
        queryKey: queryKeys.usage.byModel(filters),
        queryFn: () => getUsageByModel(filters.hideCancelled, filters.startDate, filters.skillFilter),
      },
      {
        queryKey: queryKeys.usage.byDay(filters),
        queryFn: () => getUsageByDay(filters.hideCancelled, filters.startDate, filters.skillFilter),
      },
    ],
  });

  return {
    summary: results[0],
    recentSessions: results[1],
    agentRuns: results[2],
    byStep: results[3],
    byModel: results[4],
    byDay: results[5],
    isLoading: results.some((result) => result.isLoading),
    isError: results.some((result) => result.isError),
    error: results.find((result) => result.error)?.error ?? null,
  };
}

export function useUsageSkillNamesQuery() {
  return useQuery({
    queryKey: queryKeys.usage.skillNames,
    queryFn: getWorkflowSkillNames,
    initialData: [],
  });
}

export function useResetUsageMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: resetUsage,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.usage.all });
    },
  });
}
```

- [ ] **Step 4: Reduce `usage-store` to UI filters only**

Modify `app/src/stores/usage-store.ts`:

```ts
import { create } from "zustand";
import type { DateRange } from "@/lib/queries/usage";

interface UsageState {
  hideCancelled: boolean;
  dateRange: DateRange;
  skillFilter: string | null;
  modelFamilyFilter: string | null;
  toggleHideCancelled: () => void;
  setDateRange: (range: DateRange) => void;
  setSkillFilter: (skill: string | null) => void;
  setModelFamilyFilter: (family: string | null) => void;
  resetFilters: () => void;
}

export const useUsageStore = create<UsageState>((set, get) => ({
  hideCancelled: false,
  dateRange: "all",
  skillFilter: null,
  modelFamilyFilter: null,
  toggleHideCancelled: () => set({ hideCancelled: !get().hideCancelled }),
  setDateRange: (range) => set({ dateRange: range }),
  setSkillFilter: (skill) => set({ skillFilter: skill }),
  setModelFamilyFilter: (family) => set({ modelFamilyFilter: family }),
  resetFilters: () => set({ skillFilter: null, modelFamilyFilter: null }),
}));
```

- [ ] **Step 5: Update `UsageSection`**

In `app/src/components/settings/usage-section.tsx`, derive filters from store UI state and data from query hooks:

```tsx
const {
  hideCancelled,
  toggleHideCancelled,
  dateRange,
  setDateRange,
  skillFilter,
  setSkillFilter,
  modelFamilyFilter,
  setModelFamilyFilter,
  resetFilters,
} = useUsageStore();

const filters = {
  hideCancelled,
  startDate: toUsageStartDate(dateRange),
  skillFilter,
  modelFamilyFilter,
};

const usage = useUsageQueries(filters);
const skillNamesQuery = useUsageSkillNamesQuery();
const resetUsageMutation = useResetUsageMutation();

const summary = usage.summary.data ?? null;
const recentSessions = usage.recentSessions.data ?? [];
const agentRuns = usage.agentRuns.data ?? [];
const byStep = usage.byStep.data ?? [];
const byModel = usage.byModel.data ?? [];
const byDay = usage.byDay.data ?? [];
const skillNames = skillNamesQuery.data ?? [];
const loading = usage.isLoading || skillNamesQuery.isLoading;
const error = usage.error ?? skillNamesQuery.error;
```

In reset handler:

```ts
await resetUsageMutation.mutateAsync();
resetFilters();
```

- [ ] **Step 6: Update usage store tests**

Replace `app/src/__tests__/stores/usage-store.test.ts` with UI-state-only tests:

```ts
import { describe, expect, it, beforeEach } from "vitest";
import { useUsageStore } from "@/stores/usage-store";

describe("useUsageStore", () => {
  beforeEach(() => {
    useUsageStore.setState({
      hideCancelled: false,
      dateRange: "all",
      skillFilter: null,
      modelFamilyFilter: null,
    });
  });

  it("stores usage filter UI state", () => {
    useUsageStore.getState().setDateRange("30d");
    useUsageStore.getState().setSkillFilter("skill-a");
    useUsageStore.getState().setModelFamilyFilter("sonnet");
    useUsageStore.getState().toggleHideCancelled();

    expect(useUsageStore.getState()).toMatchObject({
      dateRange: "30d",
      skillFilter: "skill-a",
      modelFamilyFilter: "sonnet",
      hideCancelled: true,
    });
  });

  it("resets data filters after usage reset", () => {
    useUsageStore.setState({ skillFilter: "skill-a", modelFamilyFilter: "haiku" });
    useUsageStore.getState().resetFilters();

    expect(useUsageStore.getState().skillFilter).toBeNull();
    expect(useUsageStore.getState().modelFamilyFilter).toBeNull();
  });
});
```

- [ ] **Step 7: Run usage tests**

Run:

```bash
cd app && npx vitest run src/__tests__/lib/queries/usage.test.tsx src/__tests__/stores/usage-store.test.ts src/__tests__/components/settings/usage-section.test.tsx
```

If `usage-section.test.tsx` does not exist, run:

```bash
cd app && npm run test:integration -- --run src/__tests__/components/settings/usage-section.test.tsx
```

Expected: query and store tests PASS; if no component test exists, the command reports no matching test and E2E in Step 8 covers the screen.

- [ ] **Step 8: Run usage E2E**

Run:

```bash
cd app && npm run test:e2e:usage
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add app/src/lib/queries/usage.ts app/src/stores/usage-store.ts app/src/components/settings/usage-section.tsx app/src/__tests__/lib/queries/usage.test.tsx app/src/__tests__/stores/usage-store.test.ts app/e2e/usage/usage-smoke.spec.ts
git commit -m "VU-928: migrate usage data to query hooks"
```

---

### Task 5: Migrate Documents, Plugins, and Auth Server State

**Files:**

- Create: `app/src/lib/queries/documents.ts`
- Create: `app/src/lib/queries/plugins.ts`
- Create: `app/src/lib/queries/auth.ts`
- Modify: `app/src/stores/document-store.ts`
- Modify: `app/src/stores/plugin-store.ts`
- Modify: `app/src/stores/auth-store.ts`
- Modify: `app/src/components/documents-tab.tsx`
- Modify: `app/src/components/imported-skills-tab.tsx`
- Modify: `app/src/components/github-login-dialog.tsx`
- Modify: `app/src/components/feedback-dialog.tsx`
- Modify: `app/src/pages/settings.tsx`
- Test: `app/src/__tests__/stores/auth-store.test.ts`
- Test: `app/src/__tests__/pages/settings.test.tsx`
- Test: `app/e2e/settings/documents.spec.ts`
- Test: `app/e2e/settings/github-oauth.spec.ts`

- [ ] **Step 1: Add document query hooks**

Create `app/src/lib/queries/documents.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addDocumentFile,
  addDocumentFolder,
  addDocumentUrl,
  deleteDocument,
  listDocuments,
  listSkillsForDocuments,
  updateDocument,
} from "@/lib/tauri";
import { queryKeys } from "./query-keys";

export function useDocumentsQuery() {
  return useQuery({
    queryKey: queryKeys.documents.list,
    queryFn: listDocuments,
    initialData: [],
  });
}

export function useDocumentSkillOptionsQuery() {
  return useQuery({
    queryKey: queryKeys.documents.skills,
    queryFn: listSkillsForDocuments,
    initialData: [],
  });
}

export function useInvalidateDocuments() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: queryKeys.documents.all });
}

export function useDeleteDocumentMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteDocument,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.documents.all }),
  });
}
```

If the add/update commands are currently called inline from `DocumentsTab`, add matching mutations that call the existing wrappers and invalidate `queryKeys.documents.all`.

- [ ] **Step 2: Add plugin query hooks**

Create `app/src/lib/queries/plugins.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createPlugin, deletePlugin, listPlugins } from "@/lib/tauri";
import { queryKeys } from "./query-keys";

export function usePluginsQuery() {
  return useQuery({
    queryKey: queryKeys.plugins.list,
    queryFn: listPlugins,
    initialData: [],
  });
}

export function useCreatePluginMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createPlugin,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.plugins.all }),
  });
}

export function useDeletePluginMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deletePlugin,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.plugins.all }),
  });
}
```

- [ ] **Step 3: Add auth query hooks**

Create `app/src/lib/queries/auth.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { githubLogout, githubUser, updateGithubIdentity } from "@/lib/tauri";
import { queryKeys } from "./query-keys";

export function useGithubUserQuery() {
  return useQuery({
    queryKey: queryKeys.auth.githubUser,
    queryFn: async () => {
      const user = await githubUser();
      if (user) {
        updateGithubIdentity(user).catch((error: unknown) => {
          console.error("Failed to persist GitHub user identity to database:", error);
        });
      }
      return user;
    },
  });
}

export function useGithubLogoutMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await githubLogout();
      await updateGithubIdentity(null);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.auth.all });
    },
  });
}
```

- [ ] **Step 4: Remove server state from stores**

Delete `app/src/stores/document-store.ts` and `app/src/stores/plugin-store.ts` if no UI state remains.

Modify `app/src/stores/auth-store.ts` so it only stores auth UI state that cannot be derived from `useGithubUserQuery`, or delete it if all consumers can use the query directly.

If `lastCheckedAt` is still needed for display, keep a tiny UI store:

```ts
import { create } from "zustand";

interface AuthUiState {
  lastCheckedAt: string | null;
  setLastCheckedAt: (value: string | null) => void;
}

export const useAuthStore = create<AuthUiState>((set) => ({
  lastCheckedAt: null,
  setLastCheckedAt: (value) => set({ lastCheckedAt: value }),
}));
```

- [ ] **Step 5: Migrate component consumers**

In `app/src/components/documents-tab.tsx`, replace local/server fetch effects with:

```tsx
const documentsQuery = useDocumentsQuery();
const skillOptionsQuery = useDocumentSkillOptionsQuery();
const deleteDocumentMutation = useDeleteDocumentMutation();

const documents = documentsQuery.data ?? [];
const skills = skillOptionsQuery.data ?? [];
const loading = documentsQuery.isLoading || skillOptionsQuery.isLoading;
```

In `app/src/components/imported-skills-tab.tsx`, use `useImportedSkillsQuery()` and skill mutations from `skills.ts`.

In `app/src/components/github-login-dialog.tsx`, use `useGithubUserQuery()` and `useGithubLogoutMutation()`.

In `app/src/components/feedback-dialog.tsx`, replace `useAuthStore` user reads with `useGithubUserQuery()`.

In `app/src/pages/settings.tsx`, replace auth loading props with query state.

- [ ] **Step 6: Update tests**

Replace auth/document/plugin store tests with query hook tests or delete them if the store no longer exists.

Update `settings.test.tsx`, `github-login-dialog.test.tsx`, `feedback-dialog.test.tsx`, and document tests to render with `renderWithQueryClient`.

Example:

```tsx
mockInvokeCommands({ github_user: { login: "octocat", avatar_url: "https://example.com/a.png", email: "octo@example.com" } });
renderWithQueryClient(<FeedbackDialog open onOpenChange={vi.fn()} />);
expect(await screen.findByText(/octocat/i)).toBeInTheDocument();
```

- [ ] **Step 7: Run settings and document tests**

Run:

```bash
cd app && npx vitest run src/__tests__/pages/settings.test.tsx src/__tests__/components/github-login-dialog.test.tsx src/__tests__/components/feedback-dialog.test.tsx
cd app && npm run test:e2e:settings
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add app/src/lib/queries/documents.ts app/src/lib/queries/plugins.ts app/src/lib/queries/auth.ts app/src/stores/document-store.ts app/src/stores/plugin-store.ts app/src/stores/auth-store.ts app/src/components/documents-tab.tsx app/src/components/imported-skills-tab.tsx app/src/components/github-login-dialog.tsx app/src/components/feedback-dialog.tsx app/src/pages/settings.tsx app/src/__tests__/stores app/src/__tests__/pages/settings.test.tsx app/src/__tests__/components/github-login-dialog.test.tsx app/src/__tests__/components/feedback-dialog.test.tsx
git commit -m "VU-928: migrate documents plugins and auth data"
```

---

### Task 6: Preserve Agent Stream Behavior and Add Cache Integration Points

**Files:**

- Create: `app/src/lib/queries/agent-stream-cache.ts`
- Modify: `app/src/hooks/use-agent-stream.ts`
- Modify: `app/src/hooks/use-workflow-persistence.ts`
- Test: `app/src/__tests__/hooks/use-agent-stream.test.ts`
- Test: `app/src/__tests__/lib/queries/cache-contract.test.tsx`

- [ ] **Step 1: Add a stream cache helper**

Create `app/src/lib/queries/agent-stream-cache.ts`:

```ts
import type { QueryClient } from "@tanstack/react-query";
import { appQueryClient } from "@/lib/query-client";
import { queryKeys } from "./query-keys";

export function invalidateSkillDataAfterWorkflow(queryClient: QueryClient = appQueryClient) {
  return queryClient.invalidateQueries({ queryKey: queryKeys.skills.all });
}

export function invalidateUsageDataAfterAgentRun(queryClient: QueryClient = appQueryClient) {
  return queryClient.invalidateQueries({ queryKey: queryKeys.usage.all });
}
```

- [ ] **Step 2: Add cache helper tests**

Append to `app/src/__tests__/lib/queries/cache-contract.test.tsx`:

```tsx
import { vi } from "vitest";
import { invalidateSkillDataAfterWorkflow, invalidateUsageDataAfterAgentRun } from "@/lib/queries/agent-stream-cache";

describe("stream cache integration", () => {
  it("invalidates skill and usage query families explicitly", async () => {
    const client = createAppQueryClient();
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");

    await invalidateSkillDataAfterWorkflow(client);
    await invalidateUsageDataAfterAgentRun(client);

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["skills"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["usage"] });
  });
});
```

- [ ] **Step 3: Wire invalidation after terminal agent events**

In `app/src/hooks/use-agent-stream.ts`, after an `agent-exit` success or error is processed, call:

```ts
invalidateUsageDataAfterAgentRun().catch((error) => {
  console.warn("[use-agent-stream] event=invalidate_usage_failed error=%s", error);
});
```

Keep display items, run metadata, terminal status, and refine questions in `useAgentStore` and `useRefineStore`.

- [ ] **Step 4: Wire workflow completion invalidation**

In `app/src/hooks/use-workflow-persistence.ts`, replace `listSkills(...).then(useSkillStore.getState().setSkills)` with:

```ts
invalidateSkillDataAfterWorkflow().catch((err) =>
  console.error("event=refresh_skills_failed error=%s", err),
);
```

- [ ] **Step 5: Update stream tests**

In `app/src/__tests__/hooks/use-agent-stream.test.ts`, mock the cache helper:

```ts
vi.mock("@/lib/queries/agent-stream-cache", () => ({
  invalidateUsageDataAfterAgentRun: vi.fn().mockResolvedValue(undefined),
  invalidateSkillDataAfterWorkflow: vi.fn().mockResolvedValue(undefined),
}));
```

Add:

```ts
it("invalidates usage query data after agent exit", async () => {
  const { invalidateUsageDataAfterAgentRun } = await import("@/lib/queries/agent-stream-cache");
  useAgentStore.getState().startRun("agent-1", "sonnet");
  await initAgentStream();

  listeners["agent-exit"]({
    payload: {
      agent_id: "agent-1",
      success: true,
    },
  });

  expect(invalidateUsageDataAfterAgentRun).toHaveBeenCalled();
});
```

- [ ] **Step 6: Run stream/cache tests**

Run:

```bash
cd app && npx vitest run src/__tests__/hooks/use-agent-stream.test.ts src/__tests__/lib/queries/cache-contract.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/src/lib/queries/agent-stream-cache.ts app/src/hooks/use-agent-stream.ts app/src/hooks/use-workflow-persistence.ts app/src/__tests__/hooks/use-agent-stream.test.ts app/src/__tests__/lib/queries/cache-contract.test.tsx
git commit -m "VU-928: connect event streams to query cache"
```

---

### Task 7: Remove Remaining Async Server State From Stores

**Files:**

- Modify or delete: `app/src/stores/skill-store.ts`
- Delete: `app/src/stores/imported-skills-store.ts`
- Delete: `app/src/stores/document-store.ts`
- Delete: `app/src/stores/plugin-store.ts`
- Modify or delete: `app/src/stores/auth-store.ts`
- Modify: `repo-map.json`
- Test: `app/src/__tests__/stores/*.test.ts`

- [ ] **Step 1: Search for forbidden server-state store patterns**

Run:

```bash
cd app && rg -n "fetch[A-Z]|load[A-Z]|isLoading|loading:|error:|setLoading|set.*Error|Promise<" src/stores
```

Expected: only UI/runtime exceptions remain:

- `workflow-store.ts` may keep `gateLoading` and runtime errors.
- `refine-store.ts` may keep file-loading UI flags.
- `agent-store.ts` may keep terminal status and runtime error state.

No request/response backend fetch methods should remain in `skill-store`, `usage-store`, `document-store`, `plugin-store`, `auth-store`, or `imported-skills-store`.

- [ ] **Step 2: Delete empty stores and fix imports**

Delete stores that no longer contain UI state:

```bash
git rm app/src/stores/imported-skills-store.ts app/src/stores/document-store.ts app/src/stores/plugin-store.ts
```

If `auth-store.ts` is empty after migration, delete it too and update every import to use `useGithubUserQuery`.

- [ ] **Step 3: Update `repo-map.json`**

In `repo-map.json`, update `frontend_stores.description` to remove deleted stores and describe remaining store responsibilities:

```json
"description": "Zustand state stores: agent (+ agent-display-buffer), auth UI if retained, refine, settings, skill UI, test, usage UI filters, workflow. Request/response backend data lives in app/src/lib/queries/."
```

Add `app/src/lib/queries/` to `frontend_lib.description`.

- [ ] **Step 4: Run store tests**

Run:

```bash
cd app && npm run test:unit -- --run src/__tests__/stores/
```

Expected: PASS. Deleted store tests should be removed from the test tree.

- [ ] **Step 5: Commit**

```bash
git add app/src/stores repo-map.json app/src/__tests__/stores
git commit -m "VU-928: remove backend fetch state from stores"
```

---

### Task 8: Document the Data-Fetching Convention

**Files:**

- Modify: `.claude/rules/state-management.md`
- Modify: `AGENTS.md`

- [ ] **Step 1: Update state-management rules**

Append this section to `.claude/rules/state-management.md`:

```md
## Server State Rule

Request/response backend data must use TanStack Query hooks under `app/src/lib/queries/`.

Use query hooks for:

- Tauri command results fetched from SQLite, filesystem, GitHub, or the app backend
- Lists and records that need loading, error, refresh, invalidation, or stale-response handling
- Mutations that should refresh related backend data

Do not store server data, loading flags, request errors, or fetch methods in Zustand stores.

Use Zustand for:

- UI state shared across unrelated components
- Navigation-persistent UI selections
- Form drafts and local interaction state that should not be cached as backend data
- Live event stream state such as active agent runs, display items, workflow runtime status, and refine chat state

When a mutation changes backend data, invalidate the smallest stable query family in `app/src/lib/queries/query-keys.ts`.
When an event stream changes request/response data, update or invalidate the query cache through `app/src/lib/queries/agent-stream-cache.ts`.
```

- [ ] **Step 2: Update AGENTS stable memory**

In `AGENTS.md`, under `Stable Repo Memory`, add:

```md
#### Frontend Server State

Request/response backend data belongs in TanStack Query hooks under `app/src/lib/queries/`. Zustand stores are for UI state, navigation-persistent selections, workflow/refine runtime state, and live agent event streams. Event streams that affect request/response data should update or invalidate the query cache through explicit helpers.
```

- [ ] **Step 3: Lint changed markdown**

Run:

```bash
markdownlint AGENTS.md .claude/rules/state-management.md docs/superpowers/plans/2026-05-01-vu-928-data-fetching-layer.md
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add AGENTS.md .claude/rules/state-management.md
git commit -m "VU-928: document server state convention"
```

---

### Task 9: Full Verification and PR Readiness

**Files:**

- No code changes unless verification exposes issues.

- [ ] **Step 1: Run frontend unit tests**

Run:

```bash
cd app && npm run test:unit
```

Expected: PASS.

- [ ] **Step 2: Run frontend integration tests**

Run:

```bash
cd app && npm run test:integration
```

Expected: PASS.

- [ ] **Step 3: Run relevant E2E tests**

Run:

```bash
cd app && npm run test:e2e:dashboard
cd app && npm run test:e2e:settings
cd app && npm run test:e2e:workflow
```

Expected: PASS.

- [ ] **Step 4: Run typecheck/build**

Run:

```bash
cd app && npx tsc --noEmit
cd app && npm run build
```

Expected: PASS.

- [ ] **Step 5: Run repo-map audit manually**

Check that:

- `frontend_stores` in `repo-map.json` matches files in `app/src/stores/`.
- `frontend_lib` mentions `app/src/lib/queries/`.
- Deleted stores are not listed.
- New query files are not missing from any structural descriptions that mention module layout.

Run:

```bash
cd app && find src/stores -maxdepth 1 -type f -name '*.ts' | sort
rg -n "frontend_stores|frontend_lib|queries" ../repo-map.json
```

Expected: listed stores match `repo-map.json`, and query module is documented.

- [ ] **Step 6: Run markdown and agent-doc lint**

Run:

```bash
markdownlint AGENTS.md .claude/rules/state-management.md docs/superpowers/plans/2026-05-01-vu-928-data-fetching-layer.md
cd app && bash scripts/lint-agent-docs.sh
```

Expected: PASS.

- [ ] **Step 7: Final search for forbidden patterns**

Run:

```bash
cd app && rg -n "fetch[A-Z]|load[A-Z]|isLoading|loading:|error:|setLoading|set.*Error|Promise<" src/stores
```

Expected: no request/response backend fetch state remains in Zustand stores. Any remaining match must be one of these documented exceptions:

- live agent runtime state
- workflow gate/runtime state
- refine local file/UI state
- component-local UI loading state outside stores

- [ ] **Step 8: Commit verification fixes if needed**

If any verification step required fixes:

```bash
git add <fixed-files>
git commit -m "VU-928: fix verification issues"
```

- [ ] **Step 9: Prepare PR**

Run:

```bash
git status --short
git log --oneline origin/main..HEAD
```

Expected: clean worktree and a commit stack containing the migration tasks.

PR title:

```text
VU-928: replace store server state with query hooks
```

PR body must include:

```md
Fixes VU-928

## Summary

- Added TanStack Query as the request/response backend data layer.
- Migrated skill, imported skill, usage, document, plugin, and auth backend data out of Zustand stores.
- Kept UI state and live agent stream state in Zustand.
- Documented the server-state convention and cache invalidation path.

## Verification

- `cd app && npm run test:unit`
- `cd app && npm run test:integration`
- `cd app && npm run test:e2e:dashboard`
- `cd app && npm run test:e2e:settings`
- `cd app && npm run test:e2e:workflow`
- `cd app && npx tsc --noEmit`
- `cd app && npm run build`
- `markdownlint AGENTS.md .claude/rules/state-management.md docs/superpowers/plans/2026-05-01-vu-928-data-fetching-layer.md`
- `cd app && bash scripts/lint-agent-docs.sh`
```

---

## Self-Review Notes

- VU-928 acceptance coverage:
  - Standard pattern: Tasks 1, 2, 4, 5, 8.
  - Wide migration: Tasks 3, 4, 5, 7.
  - Stores contain only UI/runtime state: Tasks 2, 4, 5, 7.
  - Agent stream cache integration: Task 6.
  - Stale data races eliminated by query keys/cache semantics: Task 4 tests, Task 9 search/verification.
- No live model smoke tests are required for this issue.
- `test:agents:smoke` is automated OpenCode validation; run it when prompt, agent, or runtime behavior changes.
