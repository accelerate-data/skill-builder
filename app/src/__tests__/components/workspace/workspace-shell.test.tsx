import { describe, it, expect, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SkillSummary } from "@/lib/types";
import { renderWithQueryClient as render } from "@/test/query-test-utils";

const mockNavigate = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
  useRouterState: () => "/",
}));

vi.mock("@/stores/settings-store", () => ({
  useSettingsStore: vi.fn((selector) =>
    selector({
      workspacePath: "/workspace",
      isConfigured: true,
      availableModels: [],
      modelSettings: { model: null },
    }),
  ),
}));

vi.mock("@/stores/skill-store", () => ({
  useSkillStore: vi.fn((selector) => selector({ skills: [], lockedSkills: new Set() })),
}));

const refineState = vi.hoisted(() => ({
  selectedSkill: null,
  refinableSkills: [],
  isLoadingSkills: false,
  skillFiles: [] as { filename: string; content: string }[],
  previewRevision: 0,
  isRunning: false,
  activeAgentId: null,
  sessionId: null,
  selectedModifiedFile: null as string | null,
  activeFileTab: null as string | null,
  setSkillFiles: vi.fn(),
  setSelectedModifiedFile: vi.fn(),
  setActiveFileTab: vi.fn(),
  setDiffMode: vi.fn(),
}));

vi.mock("@/stores/refine-store", () => ({
  useRefineStore: Object.assign(
    vi.fn((selector: (s: typeof refineState) => unknown) => selector(refineState)),
    { getState: () => refineState },
  ),
}));

vi.mock("@/stores/agent-store", () => ({
  useAgentStore: vi.fn((selector) => selector({ runs: {} })),
}));

vi.mock("@/hooks/use-leave-guard", () => ({
  useLeaveGuard: () => ({ blockerStatus: "idle", handleNavStay: vi.fn(), handleNavLeave: vi.fn() }),
}));

vi.mock("@/hooks/use-scope-blocked", () => ({
  useScopeBlocked: () => false,
}));

vi.mock("@/hooks/use-agent-stream", () => ({}));

vi.mock("@/lib/tauri", () => ({
  acquireLock: vi.fn().mockResolvedValue(undefined),
  releaseLock: vi.fn().mockResolvedValue(undefined),
  startRefineSession: vi.fn().mockResolvedValue({ session_id: "test-session" }),
  closeRefineSession: vi.fn().mockResolvedValue(undefined),
  cancelDescriptionOptimization: vi.fn().mockResolvedValue(undefined),
  getSkillContentForRefine: vi.fn().mockResolvedValue([]),
  sendRefineMessage: vi.fn().mockResolvedValue("agent-1"),
  finalizeRefineRun: vi.fn().mockResolvedValue({ files: [], diff: null }),
  getSkillHistory: vi.fn().mockResolvedValue([]),
  readLatestBenchmark: vi.fn().mockResolvedValue(null),
  listSkills: vi.fn().mockResolvedValue([]),
}));

const mockListEvalPromptSets = vi.fn();
const mockListEvalRuns = vi.fn();
const mockReadEvalRun = vi.fn();
const mockRunEvalWorkbench = vi.fn();
const mockSaveEvalPromptSet = vi.fn();
const mockSuggestDescriptionCandidates = vi.fn();
const mockApplyDescriptionCandidate = vi.fn();
const mockBuildRefineImprovementBrief = vi.fn();

vi.mock("@/lib/eval-workbench", async () => {
  const actual = await vi.importActual<typeof import("@/lib/eval-workbench")>(
    "@/lib/eval-workbench",
  );

  return {
    ...actual,
    listEvalPromptSets: (...args: unknown[]) => mockListEvalPromptSets(...args),
    saveEvalPromptSet: (...args: unknown[]) => mockSaveEvalPromptSet(...args),
    listEvalRuns: (...args: unknown[]) => mockListEvalRuns(...args),
    readEvalRun: (...args: unknown[]) => mockReadEvalRun(...args),
    runEvalWorkbench: (...args: unknown[]) => mockRunEvalWorkbench(...args),
    suggestDescriptionCandidates: (...args: unknown[]) =>
      mockSuggestDescriptionCandidates(...args),
    applyDescriptionCandidate: (...args: unknown[]) =>
      mockApplyDescriptionCandidate(...args),
    buildRefineImprovementBrief: (...args: unknown[]) =>
      mockBuildRefineImprovementBrief(...args),
  };
});

vi.mock("@/lib/agent-results", () => ({
  extractStructuredResultPayload: vi.fn().mockReturnValue(null),
}));

vi.mock("@/components/workspace/workspace-refine", () => ({
  WorkspaceRefine: () => <div data-testid="workspace-refine" />,
}));

vi.mock("@/components/workspace/workspace-overview", () => ({
  WorkspaceOverview: () => <div data-testid="workspace-overview" />,
}));

vi.mock("@/components/refine/chat-panel", () => ({
  ChatPanel: () => <div data-testid="chat-panel" />,
}));

vi.mock("@/components/refine/preview-panel", () => ({
  PreviewPanel: () => <div data-testid="preview-panel" />,
}));

vi.mock("@/components/refine/resizable-split-pane", () => ({
  ResizableSplitPane: ({ left, right }: { left: React.ReactNode; right: React.ReactNode }) => (
    <div>
      {left}
      {right}
    </div>
  ),
}));

import { WorkspaceShell } from "@/components/workspace/workspace-shell";

const performancePromptSet = {
  id: "prompt-set-performance",
  pluginSlug: "skills",
  skillName: "sales-pipeline",
  mode: "performance" as const,
  name: "Regression",
  createdAt: "2026-05-04T00:00:00Z",
  updatedAt: "2026-05-04T00:00:00Z",
  cases: [
    {
      id: "case-1",
      prompt: "Forecast next quarter revenue",
      expected: "Includes assumptions",
      shouldTrigger: null,
      assertions: [],
      sortOrder: 0,
    },
  ],
};

const triggerPromptSet = {
  id: "prompt-set-trigger",
  pluginSlug: "skills",
  skillName: "sales-pipeline",
  mode: "trigger" as const,
  name: "Routing checks",
  createdAt: "2026-05-04T00:00:00Z",
  updatedAt: "2026-05-04T00:00:00Z",
  cases: [
    {
      id: "case-1",
      prompt: "Reconcile open customer invoices",
      expected: null,
      shouldTrigger: true,
      assertions: [],
      sortOrder: 0,
    },
  ],
};

const runSummary = {
  id: "run-1",
  promptSetId: "prompt-set-performance",
  mode: "performance" as const,
  status: "completed",
  summary: { passed: 1, total: 1 },
  createdAt: "2026-05-04T00:00:00Z",
  completedAt: "2026-05-04T00:05:00Z",
  results: [],
  descriptionCandidates: [],
};

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const baseBuilderSkill: SkillSummary = {
  name: "sales-pipeline",
  current_step: null,
  status: "completed",
  last_modified: "2026-01-15T10:00:00Z",
  tags: ["crm", "salesforce"],
  purpose: "domain",
  skill_source: "skill-builder",
  author_login: null,
  author_avatar: null,
  intake_json: null,
  source: null,
  description: "Automates sales pipeline tracking",
  version: "1.0.0",
  model: null,
  argumentHint: null,
  userInvocable: null,
  disableModelInvocation: null,
  plugin_slug: "skills",
  plugin_display_name: "Skills",
  is_default_plugin: true,
};

describe("WorkspaceShell", () => {
  beforeEach(() => {
    refineState.isRunning = false;
    mockListEvalPromptSets.mockReset().mockImplementation((_pluginSlug, _skillName, mode) =>
      Promise.resolve(mode === "trigger" ? [triggerPromptSet] : [performancePromptSet]),
    );
    mockSaveEvalPromptSet.mockReset().mockResolvedValue(performancePromptSet);
    mockListEvalRuns.mockReset().mockResolvedValue([runSummary]);
    mockReadEvalRun.mockReset().mockResolvedValue(runSummary);
    mockRunEvalWorkbench.mockReset().mockResolvedValue(runSummary);
    mockSuggestDescriptionCandidates.mockReset().mockResolvedValue([
      {
        id: "candidate-1",
        runId: "draft-run",
        label: "Candidate 1",
        description: "Use when the user needs invoice reconciliation or payment matching",
        rationale: "Best routing precision",
        rank: 1,
      },
    ]);
    mockApplyDescriptionCandidate.mockReset().mockResolvedValue({
      description: "Use when the user needs invoice reconciliation or payment matching",
    });
    mockBuildRefineImprovementBrief.mockReset().mockResolvedValue({
      runId: "run-1",
      brief: "Improve assumptions handling",
    });
  });

  it("renders skill name in header", () => {
    render(<WorkspaceShell skill={baseBuilderSkill} skillType="builder" />);

    expect(screen.getByText("sales-pipeline")).toBeInTheDocument();
  });

  it("Overview tab is active by default", () => {
    render(<WorkspaceShell skill={baseBuilderSkill} skillType="builder" />);

    const overviewTab = screen.getByRole("tab", { name: "Overview" });
    const evalWorkbenchTab = screen.getByRole("tab", { name: "Eval Workbench" });

    expect(overviewTab).toHaveAttribute("data-state", "active");
    expect(evalWorkbenchTab).not.toBeDisabled();
  });

  it("shows dialog when switching away from Refine while agent is running", async () => {
    const user = userEvent.setup();
    refineState.isRunning = true;

    const { container } = render(
      <WorkspaceShell skill={baseBuilderSkill} skillType="builder" initialTab="refine" />,
    );

    // Refine tab is active
    const refineTab = container.querySelector('[role="tab"][data-state="active"]');
    expect(refineTab?.textContent).toBe("Refine");

    // Try to switch to Overview — click the first tab trigger
    const overviewTab = container.querySelector('[role="tab"]');
    await user.click(overviewTab!);

    // Dialog should appear
    expect(screen.getByText("Process Running")).toBeInTheDocument();
    expect(screen.getByText(/process is still running/i)).toBeInTheDocument();

    // Refine tab should still be active (check via container, not role query — dialog captures aria)
    const stillActive = container.querySelector('[role="tab"][data-state="active"]');
    expect(stillActive?.textContent).toBe("Refine");

    refineState.isRunning = false;
  });

  it("switches tab after confirming Leave in the guard dialog", async () => {
    const user = userEvent.setup();
    refineState.isRunning = true;

    const { container } = render(
      <WorkspaceShell skill={baseBuilderSkill} skillType="builder" initialTab="refine" />,
    );

    const overviewTab = container.querySelector('[role="tab"]');
    await user.click(overviewTab!);
    expect(screen.getByText("Process Running")).toBeInTheDocument();

    // Click Leave
    await user.click(screen.getByRole("button", { name: "Leave" }));

    // Overview should now be active
    const activeTab = container.querySelector('[role="tab"][data-state="active"]');
    expect(activeTab?.textContent).toBe("Overview");

    refineState.isRunning = false;
  });

  it("stays on Refine tab when clicking Stay in the guard dialog", async () => {
    const user = userEvent.setup();
    refineState.isRunning = true;

    const { container } = render(
      <WorkspaceShell skill={baseBuilderSkill} skillType="builder" initialTab="refine" />,
    );

    const overviewTab = container.querySelector('[role="tab"]');
    await user.click(overviewTab!);
    expect(screen.getByText("Process Running")).toBeInTheDocument();

    // Click Stay
    await user.click(screen.getByRole("button", { name: "Stay" }));

    // Dialog should close, Refine still active
    expect(screen.queryByText("Process Running")).not.toBeInTheDocument();
    const activeTab = container.querySelector('[role="tab"][data-state="active"]');
    expect(activeTab?.textContent).toBe("Refine");

    refineState.isRunning = false;
  });

  it("shows guard dialog when switching away from Eval Workbench while a performance run is active", async () => {
    const user = userEvent.setup();
    const deferredRun = createDeferred(runSummary);
    mockRunEvalWorkbench.mockReset().mockReturnValue(deferredRun.promise);

    const { container } = render(
      <WorkspaceShell skill={baseBuilderSkill} skillType="builder" initialTab="evals" />,
    );

    await screen.findByText("Regression");
    await user.click(await screen.findByRole("button", { name: /run prompt set/i }));
    await waitFor(() => expect(mockRunEvalWorkbench).toHaveBeenCalled());

    const overviewTab = Array.from(container.querySelectorAll('[role="tab"]')).find(
      (t) => t.textContent === "Overview",
    );
    await user.click(overviewTab!);

    expect(screen.getByText("Process Running")).toBeInTheDocument();
    const activeTab = container.querySelector('[role="tab"][data-state="active"]');
    expect(activeTab?.textContent).toBe("Eval Workbench");

    deferredRun.resolve(runSummary);
  });

  it("shows guard dialog when switching away from Eval Workbench while trigger work is active", async () => {
    const user = userEvent.setup();
    const deferredCandidates = createDeferred([
      {
        id: "candidate-1",
        runId: "draft-run",
        label: "Candidate 1",
        description: "Use when the user needs invoice reconciliation or payment matching",
        rationale: "Best routing precision",
        rank: 1,
      },
    ]);
    mockSuggestDescriptionCandidates
      .mockReset()
      .mockReturnValue(deferredCandidates.promise);

    const { container } = render(
      <WorkspaceShell skill={baseBuilderSkill} skillType="builder" initialTab="description" />,
    );

    await screen.findByText("Routing checks");
    await user.click(screen.getByRole("button", { name: /generate candidates/i }));
    await waitFor(() =>
      expect(mockSuggestDescriptionCandidates).toHaveBeenCalled(),
    );

    const overviewTab = Array.from(container.querySelectorAll('[role="tab"]')).find(
      (t) => t.textContent === "Overview",
    );
    await user.click(overviewTab!);

    expect(screen.getByText("Process Running")).toBeInTheDocument();
    const activeTab = container.querySelector('[role="tab"][data-state="active"]');
    expect(activeTab?.textContent).toBe("Eval Workbench");

    deferredCandidates.resolve([
      {
        id: "candidate-1",
        runId: "draft-run",
        label: "Candidate 1",
        description: "Use when the user needs invoice reconciliation or payment matching",
        rationale: "Best routing precision",
        rank: 1,
      },
    ]);
  });

  it("clears skillFiles cache when skill name changes", async () => {
    refineState.setSkillFiles.mockClear();

    const { rerender } = render(
      <WorkspaceShell skill={baseBuilderSkill} skillType="builder" />,
    );

    // Initial mount calls setSkillFiles([]) once for the initial skillName
    const callsAfterMount = refineState.setSkillFiles.mock.calls.length;

    // Switch to a different skill
    const newSkill = { ...baseBuilderSkill, name: "new-skill" };
    rerender(<WorkspaceShell skill={newSkill} skillType="builder" />);

    // Should have called setSkillFiles([]) again after the skill name changed
    expect(refineState.setSkillFiles.mock.calls.length).toBeGreaterThan(callsAfterMount);
    const lastCall = refineState.setSkillFiles.mock.calls.at(-1);
    expect(lastCall?.[0]).toEqual([]);
  });
});
