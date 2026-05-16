import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SkillSummary } from "@/lib/types";
import { renderWithQueryClient as render } from "@/test/query-test-utils";
import { useWorkspaceStore } from "@/stores/workspace-store";

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
  useIsSkillLocked: vi.fn(() => false),
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
  cancelDescriptionOptimization: vi.fn().mockResolvedValue(undefined),
  getSelectedSkillContent: vi.fn().mockResolvedValue([]),
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
  };
});

vi.mock("@/components/workspace/workspace-overview", () => ({
  WorkspaceOverview: () => <div data-testid="workspace-overview" />,
}));
vi.mock("@/components/workspace/workspace-conversation", () => ({
  WorkspaceConversation: () => <div data-testid="workspace-conversation" />,
}));
vi.mock("@/components/workspace/preview-panel", () => ({
  PreviewPanel: () => <div data-testid="preview-panel" />,
}));

import { WorkspaceShell } from "@/components/workspace/workspace-shell";

const performanceScenario = {
  id: "case-1",
  name: "Regression",
  prompt: "Forecast next quarter revenue",
  assertions: ["Explains the forecast assumptions."],
  tags: ["performance"] as const,
};

const performanceScenarioSummary = {
  name: "Regression",
};

const alternatePerformanceScenario = {
  id: "case-2",
  name: "Smoke",
  prompt: "Summarize pipeline risk",
  assertions: ["Summarizes the main pipeline blockers."],
  tags: ["performance"] as const,
};

const alternatePerformanceScenarioSummary = {
  name: "Smoke",
};

function renderEvalWorkbench() {
  useWorkspaceStore.setState({ activeSurface: "evals" });
  return render(<WorkspaceShell skill={baseBuilderSkill} skillType="builder" />);
}


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
  userInvocable: null,
  disableModelInvocation: null,
  plugin_slug: "skills",
  plugin_display_name: "Skills",
  is_default_plugin: true,
};

describe("WorkspaceShell", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ activeSurface: "overview" });
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

  });

  it("renders skill name in header", () => {
    render(<WorkspaceShell skill={baseBuilderSkill} skillType="builder" />);

    expect(screen.getByText("sales-pipeline")).toBeInTheDocument();
  });

  it("Overview tab is active by default", () => {
    render(<WorkspaceShell skill={baseBuilderSkill} skillType="builder" />);

    const conversationTab = screen.getByRole("tab", { name: "Conversation" });
    const overviewTab = screen.getByRole("tab", { name: "Overview" });
    const evalWorkbenchTab = screen.getByRole("tab", { name: "Eval Workbench" });

    expect(conversationTab).not.toHaveAttribute("data-state", "active");
    expect(overviewTab).toHaveAttribute("data-state", "active");
    expect(evalWorkbenchTab).not.toBeDisabled();
  });

  it("renders the conversation surface when selected", () => {
    useWorkspaceStore.setState({ activeSurface: "conversation" });

    render(<WorkspaceShell skill={baseBuilderSkill} skillType="builder" />);

    expect(screen.getByRole("tab", { name: "Conversation" })).toHaveAttribute("data-state", "active");
    expect(screen.getByTestId("workspace-conversation")).toBeInTheDocument();
  });

  it("keeps eval workbench performance-only with no trigger authoring tab", async () => {
    renderEvalWorkbench();

    expect(await screen.findByText("Regression")).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Trigger" })).not.toBeInTheDocument();
    expect(screen.queryByText(/^trigger$/i)).not.toBeInTheDocument();
  });

  it("renders scenarios inside one owning eval panel", async () => {
    renderEvalWorkbench();

    const panel = await screen.findByTestId("eval-workbench-panel");
    expect(within(panel).getByRole("heading", { name: "Scenarios" })).toBeInTheDocument();
  });

  it("gives the eval panel a flex parent so it can expand to the full tab height", async () => {
    renderEvalWorkbench();

    const panel = await screen.findByTestId("eval-workbench-panel");
    const panelParent = panel.parentElement;

    expect(panelParent).not.toBeNull();
    expect(panelParent).toHaveClass("min-h-0", "flex", "flex-1", "flex-col");
    expect(panel).toHaveClass("flex-1");
  });

  it("does not pad the outer eval workbench wrapper, keeping the panel flush with the tab area", async () => {
    renderEvalWorkbench();

    const panel = await screen.findByTestId("eval-workbench-panel");
    const wrapper = panel.parentElement?.parentElement;

    expect(wrapper).not.toBeNull();
    expect(wrapper).toHaveClass("flex", "h-full", "flex-col");
    expect(wrapper?.className).not.toMatch(/\bpx-6\b|\bpt-6\b|\bpb-6\b/);
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

    renderEvalWorkbench();

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
      assertions: [],
      tags: ["performance"],
    });
    mockUseCreateScenario.mockReset().mockReturnValue({
      mutateAsync,
      isPending: false,
    });

    renderEvalWorkbench();

    await screen.findByText("Regression");
    await user.click(screen.getByRole("button", { name: /new scenario/i }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith());
  });

  it("does not render a scenario editor until the user expands or creates a scenario", async () => {
    renderEvalWorkbench();

    expect(await screen.findByText("Regression")).toBeInTheDocument();
    expect(screen.queryByLabelText(/scenario name/i)).not.toBeInTheDocument();
  });

  it("expands a scenario inline when its row is opened", async () => {
    const user = userEvent.setup();

    renderEvalWorkbench();

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

    renderEvalWorkbench();

    expect(await screen.findByText("Regression")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Regression" }));
    expect(await screen.findByDisplayValue("Forecast next quarter revenue")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Smoke" }));

    expect(await screen.findByText("Loading scenario…")).toBeInTheDocument();
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

    renderEvalWorkbench();

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
    useWorkspaceStore.setState({
      skillFiles: [{ filename: "SKILL.md", content: "# Skill" }],
      selectedModifiedFile: "SKILL.md",
      activeFileTab: "SKILL.md",
      diffMode: true,
      gitDiff: { stat: "1 file changed", files: [] },
    });

    const { rerender } = render(
      <WorkspaceShell skill={baseBuilderSkill} skillType="builder" />,
    );

    const newSkill = { ...baseBuilderSkill, name: "new-skill" };
    rerender(<WorkspaceShell skill={newSkill} skillType="builder" />);

    const workspaceState = useWorkspaceStore.getState();
    expect(workspaceState.skillFiles).toEqual([]);
    expect(workspaceState.selectedModifiedFile).toBeNull();
    expect(workspaceState.activeFileTab).toBe("SKILL.md");
    expect(workspaceState.diffMode).toBe(false);
    expect(workspaceState.gitDiff).toBeNull();
  });
});
