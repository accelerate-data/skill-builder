import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
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
  conversationId: null,
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
  startRefineSession: vi.fn().mockResolvedValue({
    conversation_id: "test-conversation",
    skill_name: "test-skill",
    created_at: new Date().toISOString(),
    available_agents: ["skill-creator"],
    restored_messages: [],
    restored_transcript_events: [],
  }),
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
const mockUseCreateScenario = vi.fn();
const mockUseSaveScenario = vi.fn();
const mockUseDefineEvalScenario = vi.fn();
const mockUseDeleteScenario = vi.fn();
const mockListEvalRuns = vi.fn();
const mockReadEvalRun = vi.fn();
const mockRunEvalWorkbench = vi.fn();
const mockBuildRefineImprovementBrief = vi.fn();

vi.mock("@/lib/queries/eval-scenarios", () => ({
  useScenarios: (...args: unknown[]) => mockUseScenarios(...args),
  useScenario: (...args: unknown[]) => mockUseScenario(...args),
  useCreateScenario: (...args: unknown[]) => mockUseCreateScenario(...args),
  useSaveScenario: (...args: unknown[]) => mockUseSaveScenario(...args),
  useDefineEvalScenario: (...args: unknown[]) => mockUseDefineEvalScenario(...args),
  useDeleteScenario: (...args: unknown[]) => mockUseDeleteScenario(...args),
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
  id: "case-1",
  name: "Regression",
  prompt: "Forecast next quarter revenue",
  expectations: ["Explains the forecast assumptions."],
};

const performanceScenarioSummary = {
  name: "Regression",
};

const alternatePerformanceScenario = {
  id: "case-2",
  name: "Smoke",
  prompt: "Summarize pipeline risk",
  expectations: ["Summarizes the main pipeline blockers."],
};

const alternatePerformanceScenarioSummary = {
  name: "Smoke",
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
      data: [performanceScenarioSummary],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    mockUseScenario.mockReset().mockImplementation(
      (skillName: string | null, pluginSlug: string, scenarioName: string | null) => ({
        data:
          skillName && pluginSlug && scenarioName === performanceScenario.name
            ? performanceScenario
            : null,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      }),
    );
    mockUseCreateScenario.mockReset().mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue(performanceScenario),
      isPending: false,
    });
    mockUseSaveScenario.mockReset().mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue(performanceScenario),
      isPending: false,
    });
    mockUseDefineEvalScenario.mockReset().mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue(performanceScenario),
      isPending: false,
    });
    mockUseDeleteScenario.mockReset().mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue(undefined),
      isPending: false,
    });
    mockListEvalRuns.mockReset().mockResolvedValue([runSummary]);
    mockReadEvalRun.mockReset().mockResolvedValue(runSummary);
    mockRunEvalWorkbench.mockReset().mockResolvedValue(runSummary);
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

  it("keeps eval workbench performance-only with no trigger authoring tab", async () => {
    render(<WorkspaceShell skill={baseBuilderSkill} skillType="builder" initialTab="evals" />);

    expect(await screen.findByText("Regression")).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Trigger" })).not.toBeInTheDocument();
    expect(screen.queryByText(/^trigger$/i)).not.toBeInTheDocument();
  });

  it("renders scenarios, results, and the footer inside one owning eval panel", async () => {
    render(<WorkspaceShell skill={baseBuilderSkill} skillType="builder" initialTab="evals" />);

    const panel = await screen.findByTestId("eval-workbench-panel");
    expect(within(panel).getByRole("heading", { name: "Scenarios" })).toBeInTheDocument();
    expect(within(panel).getByRole("heading", { name: "Results" })).toBeInTheDocument();
    expect(within(panel).getByTestId("eval-suggest-status-bar")).toBeInTheDocument();
  });

  it("gives the eval panel a flex parent so it can expand to the full tab height", async () => {
    render(<WorkspaceShell skill={baseBuilderSkill} skillType="builder" initialTab="evals" />);

    const panel = await screen.findByTestId("eval-workbench-panel");
    const panelParent = panel.parentElement;

    expect(panelParent).not.toBeNull();
    expect(panelParent).toHaveClass("min-h-0", "flex", "flex-1", "flex-col");
    expect(panel).toHaveClass("flex-1");
  });

  it("does not pad the outer eval workbench wrapper, keeping the panel flush with the tab area", async () => {
    render(<WorkspaceShell skill={baseBuilderSkill} skillType="builder" initialTab="evals" />);

    const panel = await screen.findByTestId("eval-workbench-panel");
    const wrapper = panel.parentElement?.parentElement;

    expect(wrapper).not.toBeNull();
    expect(wrapper).toHaveClass("flex", "h-full", "flex-col");
    expect(wrapper?.className).not.toMatch(/\bpx-6\b|\bpt-6\b|\bpb-6\b/);
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
    await user.click(screen.getByRole("button", { name: "Regression" }));
    await user.click(await screen.findByRole("button", { name: /^evaluate$/i }));
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

  it("loads scenario detail from the performance-only scenario list", async () => {
    const user = userEvent.setup();

    mockUseScenarios.mockReset().mockReturnValue({
      data: [performanceScenarioSummary],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    mockUseScenario.mockReset().mockImplementation(
      (_skillName: string | null, _pluginSlug: string, scenarioName: string | null) => ({
        data:
          scenarioName === performanceScenario.name
            ? performanceScenario
            : null,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      }),
    );

    render(
      <WorkspaceShell skill={baseBuilderSkill} skillType="builder" initialTab="evals" />,
    );

    expect(await screen.findByText("Regression")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Regression" }));
    expect(await screen.findByDisplayValue("Forecast next quarter revenue")).toBeInTheDocument();
    expect(mockUseScenario).toHaveBeenCalledWith(
      "sales-pipeline",
      "skills",
      "Regression",
    );
  });

  it("creates a new persisted scenario immediately", async () => {
    const user = userEvent.setup();
    const mutateAsync = vi.fn().mockResolvedValue({
      id: "case-1",
      name: "Smoke",
      prompt: "",
      expectations: [],
    });
    mockUseCreateScenario.mockReset().mockReturnValue({
      mutateAsync,
      isPending: false,
    });

    render(
      <WorkspaceShell skill={baseBuilderSkill} skillType="builder" initialTab="evals" />,
    );

    await screen.findByText("Regression");
    await user.click(screen.getByRole("button", { name: /new scenario/i }));

    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({
        mode: "performance",
      }),
    );
  });

  it("does not render a scenario editor until the user expands or creates a scenario", async () => {
    render(
      <WorkspaceShell skill={baseBuilderSkill} skillType="builder" initialTab="evals" />,
    );

    expect(await screen.findByText("Regression")).toBeInTheDocument();
    expect(screen.queryByLabelText(/scenario name/i)).not.toBeInTheDocument();
  });

  it("expands a scenario inline when its row is opened", async () => {
    const user = userEvent.setup();

    render(
      <WorkspaceShell skill={baseBuilderSkill} skillType="builder" initialTab="evals" />,
    );

    expect(await screen.findByText("Regression")).toBeInTheDocument();
    expect(screen.queryByLabelText(/scenario name/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Regression" }));

    expect(await screen.findByLabelText(/scenario name/i)).toBeInTheDocument();
    expect(screen.getByDisplayValue("Regression")).toBeInTheDocument();
  });

  it("disables scenario actions while the selected scenario detail is still loading", async () => {
    const user = userEvent.setup();

    mockUseScenarios.mockReset().mockReturnValue({
      data: [performanceScenarioSummary, alternatePerformanceScenarioSummary],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    mockUseScenario.mockReset().mockImplementation(
      (_skillName: string | null, _pluginSlug: string, scenarioName: string | null) => ({
        data:
          scenarioName === alternatePerformanceScenario.name
            ? alternatePerformanceScenario
            : scenarioName
              ? performanceScenario
              : null,
        isLoading: scenarioName === alternatePerformanceScenario.name,
        error: null,
        refetch: vi.fn(),
      }),
    );

    render(
      <WorkspaceShell skill={baseBuilderSkill} skillType="builder" initialTab="evals" />,
    );

    expect(await screen.findByText("Regression")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Regression" }));
    expect(await screen.findByDisplayValue("Forecast next quarter revenue")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Smoke" }));

    expect(await screen.findByText("Loading scenario…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^suggest$/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^evaluate$/i })).toBeDisabled();
  });

  it("deletes a saved scenario and falls back to a remaining selection", async () => {
    const user = userEvent.setup();
    let scenarioSummaries = [performanceScenarioSummary, alternatePerformanceScenarioSummary];
    const deleteScenarioMutation = vi.fn().mockImplementation(async () => {
      scenarioSummaries = [alternatePerformanceScenarioSummary];
    });

    mockUseScenarios.mockReset().mockImplementation(() => ({
      data: scenarioSummaries,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    }));
    mockUseScenario.mockReset().mockImplementation(
      (_skillName: string | null, _pluginSlug: string, scenarioName: string | null) => ({
        data:
          scenarioName === performanceScenario.name
            ? performanceScenario
            : scenarioName === alternatePerformanceScenario.name
              ? alternatePerformanceScenario
              : null,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      }),
    );
    mockUseDeleteScenario.mockReset().mockReturnValue({
      mutateAsync: deleteScenarioMutation,
      isPending: false,
    });

    render(
      <WorkspaceShell skill={baseBuilderSkill} skillType="builder" initialTab="evals" />,
    );

    expect(await screen.findByText("Regression")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Regression" }));
    expect(await screen.findByDisplayValue("Forecast next quarter revenue")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /delete scenario/i }));

    await waitFor(() =>
      expect(deleteScenarioMutation).toHaveBeenCalledWith({
        scenarioName: "Regression",
      }),
    );
    expect(
      screen.queryByRole("button", { name: "Regression" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/scenario name/i)).not.toBeInTheDocument();
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
