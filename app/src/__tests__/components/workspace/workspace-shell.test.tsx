import { describe, it, expect, vi, beforeEach } from "vitest";
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

const mockUseScenarios = vi.fn();
const mockUseScenario = vi.fn();
const mockUseSaveScenario = vi.fn();
const mockListEvalRuns = vi.fn();
const mockReadEvalRun = vi.fn();
const mockRunEvalWorkbench = vi.fn();
const mockSuggestDescriptionCandidates = vi.fn();
const mockApplyDescriptionCandidate = vi.fn();
const mockBuildRefineImprovementBrief = vi.fn();

vi.mock("@/lib/queries/eval-scenarios", () => ({
  useScenarios: (...args: unknown[]) => mockUseScenarios(...args),
  useScenario: (...args: unknown[]) => mockUseScenario(...args),
  useSaveScenario: (...args: unknown[]) => mockUseSaveScenario(...args),
}));

vi.mock("@/lib/eval-workbench", async () => {
  const actual = await vi.importActual<typeof import("@/lib/eval-workbench")>(
    "@/lib/eval-workbench",
  );

  return {
    ...actual,
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

const performanceScenario = {
  name: "Regression",
  tags: ["performance"] as const,
  cases: [
    {
      id: "case-1",
      prompt: "Forecast next quarter revenue",
      expectedOutcome: "Includes assumptions",
      shouldTrigger: null,
      assertions: [],
    },
  ],
};

const performanceScenarioSummary = {
  name: "Regression",
  tags: ["performance"] as const,
};

const triggerScenario = {
  name: "Routing checks",
  tags: ["trigger"] as const,
  cases: [
    {
      id: "case-1",
      prompt: "Reconcile open customer invoices",
      expectedOutcome: null,
      shouldTrigger: true,
      assertions: [],
    },
  ],
};

const triggerScenarioSummary = {
  name: "Routing checks",
  tags: ["trigger"] as const,
};

const sharedScenario = {
  name: "Core workflow coverage",
  tags: ["both"] as const,
  cases: [
    {
      id: "case-shared-1",
      prompt: "Reconcile open customer invoices",
      expectedOutcome: "Confirms invoice reconciliation steps",
      shouldTrigger: true,
      assertions: [],
    },
  ],
};

const sharedScenarioSummary = {
  name: "Core workflow coverage",
  tags: ["both"] as const,
};

const runSummary = {
  id: "run-1",
  scenarioName: "Regression",
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
    mockUseScenarios.mockReset().mockReturnValue({
      data: [performanceScenarioSummary, triggerScenarioSummary],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    mockUseScenario.mockReset().mockImplementation(
      (skillName: string | null, pluginSlug: string, scenarioName: string | null) => ({
        data:
          skillName && pluginSlug && scenarioName === performanceScenario.name
            ? performanceScenario
            : skillName && pluginSlug && scenarioName === triggerScenario.name
              ? triggerScenario
              : null,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      }),
    );
    mockUseSaveScenario.mockReset().mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue(performanceScenario),
      isPending: false,
    });
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

    const refineTab = container.querySelector('[role="tab"][data-state="active"]');
    expect(refineTab?.textContent).toBe("Refine");

    const overviewTab = container.querySelector('[role="tab"]');
    await user.click(overviewTab!);

    expect(screen.getByText("Process Running")).toBeInTheDocument();
    expect(screen.getByText(/process is still running/i)).toBeInTheDocument();

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

    await user.click(screen.getByRole("button", { name: "Leave" }));

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

    await user.click(screen.getByRole("button", { name: "Stay" }));

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
    await user.click(await screen.findByRole("button", { name: /run scenario/i }));
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

    await screen.findByDisplayValue("Routing checks");
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

  it("loads scenario detail separately from the shared scenario list and keeps shared selections across tabs", async () => {
    const user = userEvent.setup();

    mockUseScenarios.mockReset().mockReturnValue({
      data: [
        performanceScenarioSummary,
        sharedScenarioSummary,
        triggerScenarioSummary,
      ],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    mockUseScenario.mockReset().mockImplementation(
      (_skillName: string | null, _pluginSlug: string, scenarioName: string | null) => ({
        data:
          scenarioName === performanceScenario.name
            ? performanceScenario
            : scenarioName === sharedScenario.name
              ? sharedScenario
              : scenarioName === triggerScenario.name
                ? triggerScenario
                : null,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      }),
    );

    render(
      <WorkspaceShell skill={baseBuilderSkill} skillType="builder" initialTab="evals" />,
    );

    expect(await screen.findByDisplayValue("Forecast next quarter revenue")).toBeInTheDocument();
    expect(mockUseScenario).toHaveBeenCalledWith(
      "sales-pipeline",
      "skills",
      "Regression",
    );

    await user.click(screen.getByRole("button", { name: "Core workflow coverage" }));
    expect(await screen.findByDisplayValue("Confirms invoice reconciliation steps")).toBeInTheDocument();
    expect(mockUseScenario).toHaveBeenLastCalledWith(
      "sales-pipeline",
      "skills",
      "Core workflow coverage",
    );

    await user.click(screen.getByRole("tab", { name: "Trigger" }));
    expect(await screen.findByDisplayValue("Confirms invoice reconciliation steps")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Core workflow coverage" })).toHaveAttribute(
      "data-variant",
      "secondary",
    );
    expect(mockUseScenario).toHaveBeenLastCalledWith(
      "sales-pipeline",
      "skills",
      "Core workflow coverage",
    );
  });

  it("saves a newly created scenario without sending a previous scenario name", async () => {
    const user = userEvent.setup();
    const mutateAsync = vi.fn().mockResolvedValue({
      name: "Smoke",
      tags: ["performance"],
      cases: [
        {
          id: "case-1",
          prompt: "Summarize pipeline risk",
          expectedOutcome: "Lists top blockers",
          shouldTrigger: null,
          assertions: [],
        },
      ],
    });
    mockUseSaveScenario.mockReset().mockReturnValue({
      mutateAsync,
      isPending: false,
    });

    render(
      <WorkspaceShell skill={baseBuilderSkill} skillType="builder" initialTab="evals" />,
    );

    await screen.findByDisplayValue("Forecast next quarter revenue");
    await user.click(screen.getByRole("button", { name: /new scenario/i }));
    await user.clear(screen.getByLabelText(/scenario name/i));
    await user.type(screen.getByLabelText(/scenario name/i), "Smoke");
    await user.clear(screen.getByLabelText(/user prompt/i));
    await user.type(screen.getByLabelText(/user prompt/i), "Summarize pipeline risk");
    await user.clear(screen.getByLabelText(/expected outcome/i));
    await user.type(screen.getByLabelText(/expected outcome/i), "Lists top blockers");
    await user.click(screen.getByRole("button", { name: /^save scenario$/i }));

    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({
        scenario: {
          name: "Smoke",
          tags: ["performance"],
          cases: [
            expect.objectContaining({
              prompt: "Summarize pipeline risk",
              expectedOutcome: "Lists top blockers",
              shouldTrigger: null,
              assertions: [],
            }),
          ],
        },
        previousScenarioName: null,
      }),
    );
  });

  it("disables scenario actions while the selected scenario detail is still loading", async () => {
    const user = userEvent.setup();

    mockUseScenarios.mockReset().mockReturnValue({
      data: [
        performanceScenarioSummary,
        sharedScenarioSummary,
        triggerScenarioSummary,
      ],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    mockUseScenario.mockReset().mockImplementation(
      (_skillName: string | null, _pluginSlug: string, scenarioName: string | null) => ({
        data:
          scenarioName === triggerScenario.name
            ? triggerScenario
            : scenarioName
              ? performanceScenario
              : null,
        isLoading: scenarioName === sharedScenario.name,
        error: null,
        refetch: vi.fn(),
      }),
    );

    render(
      <WorkspaceShell skill={baseBuilderSkill} skillType="builder" initialTab="evals" />,
    );

    expect(await screen.findByDisplayValue("Forecast next quarter revenue")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Core workflow coverage" }));

    expect(await screen.findByText("Loading scenario…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /generate scenarios/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /run scenario/i })).toBeDisabled();

    await user.click(screen.getByRole("tab", { name: "Trigger" }));

    expect(screen.getByRole("button", { name: /generate candidates/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /run comparison/i })).toBeDisabled();
  });

  it("falls back to the first visible scenario when the selected one does not support the next tab", async () => {
    const user = userEvent.setup();

    mockUseScenarios.mockReset().mockReturnValue({
      data: [performanceScenarioSummary, triggerScenarioSummary],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    mockUseScenario.mockReset().mockImplementation(
      (_skillName: string | null, _pluginSlug: string, scenarioName: string | null) => ({
        data:
          scenarioName === performanceScenario.name
            ? performanceScenario
            : scenarioName === triggerScenario.name
              ? triggerScenario
              : null,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      }),
    );

    render(
      <WorkspaceShell skill={baseBuilderSkill} skillType="builder" initialTab="evals" />,
    );

    expect(await screen.findByDisplayValue("Forecast next quarter revenue")).toBeInTheDocument();
    expect(mockUseScenario).toHaveBeenLastCalledWith(
      "sales-pipeline",
      "skills",
      "Regression",
    );

    await user.click(screen.getByRole("tab", { name: "Trigger" }));

    expect(await screen.findByDisplayValue("Routing checks")).toBeInTheDocument();
    expect(mockUseScenario).toHaveBeenLastCalledWith(
      "sales-pipeline",
      "skills",
      "Routing checks",
    );
  });

  it("clears skillFiles cache when skill name changes", async () => {
    refineState.setSkillFiles.mockClear();

    const { rerender } = render(
      <WorkspaceShell skill={baseBuilderSkill} skillType="builder" />,
    );

    const callsAfterMount = refineState.setSkillFiles.mock.calls.length;

    const newSkill = { ...baseBuilderSkill, name: "new-skill" };
    rerender(<WorkspaceShell skill={newSkill} skillType="builder" />);

    expect(refineState.setSkillFiles.mock.calls.length).toBeGreaterThan(callsAfterMount);
    const lastCall = refineState.setSkillFiles.mock.calls.at(-1);
    expect(lastCall?.[0]).toEqual([]);
  });
});
