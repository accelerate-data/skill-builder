import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SkillSummary } from "@/lib/types";
import { mockListen, resetTauriMocks } from "@/test/mocks/tauri";
import { useSettingsStore } from "@/stores/settings-store";

const mockListEvalRuns = vi.fn();
const mockReadEvalRun = vi.fn();
const mockRunEvalWorkbench = vi.fn();
const mockCancelEvalWorkbenchRun = vi.fn();
const mockBuildRefineImprovementBrief = vi.fn();
const mockGenerateScenarios = vi.fn();

const setPendingInitialMessage = vi.fn();
let progressListener:
  | ((event: {
      payload: {
        runId: string;
        phase: string;
        completed: number;
        total: number;
        message: string;
      };
    }) => void)
  | null = null;

vi.mock("@/stores/refine-store", () => ({
  useRefineStore: {
    getState: () => ({
      setPendingInitialMessage,
    }),
  },
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
    cancelEvalWorkbenchRun: (...args: unknown[]) =>
      mockCancelEvalWorkbenchRun(...args),
    generateScenarios: (...args: unknown[]) => mockGenerateScenarios(...args),
    buildRefineImprovementBrief: (...args: unknown[]) =>
      mockBuildRefineImprovementBrief(...args),
  };
});

import { WorkspaceEvals } from "@/components/workspace/workspace-evals";

const skill: SkillSummary = {
  name: "forecast-skill",
  plugin_slug: "skills",
  plugin_display_name: "Skills",
  is_default_plugin: true,
  description: "Forecast revenue trends",
  version: "1.2.3",
  current_step: null,
  status: "completed",
  last_modified: "2026-05-04T00:00:00Z",
  tags: [],
  purpose: "domain",
  skill_source: "skill-builder",
  author_login: null,
  author_avatar: null,
  intake_json: null,
  source: null,
  model: null,
  argumentHint: null,
  userInvocable: null,
  disableModelInvocation: null,
};

const performanceScenario = {
  id: "case-1",
  name: "Regression",
  tags: ["performance"] as const,
  prompt: "Forecast next quarter revenue",
  shouldTrigger: null,
  expectations: ["Explains the forecast assumptions."],
};

const alternatePerformanceScenario = {
  id: "case-2",
  name: "Smoke",
  tags: ["performance"] as const,
  prompt: "Summarize pipeline risk",
  shouldTrigger: null,
  expectations: ["Summarizes the main pipeline blockers."],
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

const runDetail = {
  ...runSummary,
  results: [
    {
      id: "result-1",
      runId: "run-1",
      caseId: "case-1",
      candidateId: "current-skill",
      passed: false,
      score: 0.25,
      output: {},
      reason: "Missed assumptions section",
    },
  ],
};

const workspaceBRunSummary = {
  ...runSummary,
  id: "run-2",
  createdAt: "2026-05-04T01:00:00Z",
  completedAt: "2026-05-04T01:05:00Z",
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

describe("WorkspaceEvals", () => {
  beforeEach(() => {
    resetTauriMocks();
    useSettingsStore.getState().reset();
    progressListener = null;
    mockListen.mockImplementation((eventName, callback) => {
      if (eventName === "eval-workbench-progress") {
        progressListener = callback as typeof progressListener;
      }
      return Promise.resolve(() => {});
    });
    mockListEvalRuns.mockReset().mockResolvedValue([runSummary]);
    mockReadEvalRun.mockReset().mockResolvedValue(runDetail);
    mockRunEvalWorkbench.mockReset().mockResolvedValue(runSummary);
    mockCancelEvalWorkbenchRun.mockReset().mockResolvedValue(undefined);
    mockGenerateScenarios.mockReset().mockResolvedValue([]);
    mockBuildRefineImprovementBrief.mockReset().mockResolvedValue({
      runId: "run-1",
      brief: "Improve assumptions handling",
    });
    setPendingInitialMessage.mockReset();
  });

  it("loads performance run history from the eval workbench surface", async () => {
    render(
      <WorkspaceEvals
        skill={skill}
        workspacePath="/workspace"
        scenario={performanceScenario}
        onStartNewScenario={vi.fn()}
        onSaveScenario={vi.fn()}
      />,
    );

    await waitFor(() =>
      expect(mockListEvalRuns).toHaveBeenCalledWith(
        "skills",
        "forecast-skill",
        "performance",
        20,
        "Package",
      ),
    );
    expect(
      await screen.findByDisplayValue("Forecast next quarter revenue"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^evaluate$/i })).toBeInTheDocument();
  });

  it("does not request run history before a scenario exists", async () => {
    render(
      <WorkspaceEvals
        skill={skill}
        workspacePath="/workspace"
        scenario={null}
        onStartNewScenario={vi.fn()}
        onSaveScenario={vi.fn()}
      />,
    );

    expect(screen.queryByLabelText(/scenario name/i)).not.toBeInTheDocument();
    expect(mockListEvalRuns).not.toHaveBeenCalled();
    expect(screen.getByText(/no evaluations yet/i)).toBeInTheDocument();
  });

  it("enables package evaluation when scenarios exist even if no scenario row is expanded", async () => {
    const user = userEvent.setup();

    render(
      <WorkspaceEvals
        skill={skill}
        workspacePath="/workspace"
        scenario={null}
        hasScenarios
        onStartNewScenario={vi.fn()}
        onSaveScenario={vi.fn()}
      />,
    );

    expect(screen.queryByLabelText(/scenario name/i)).not.toBeInTheDocument();
    const evaluateButton = await screen.findByRole("button", { name: /^evaluate$/i });
    expect(evaluateButton).toBeEnabled();

    await user.click(evaluateButton);

    await waitFor(() =>
      expect(mockRunEvalWorkbench).toHaveBeenCalledWith({
        runId: expect.any(String),
        pluginSlug: "skills",
        skillName: "forecast-skill",
        mode: "performance",
        candidateIds: ["current-skill"],
      }),
    );
  });

  it("uses a combined results section in the empty state", async () => {
    render(
      <WorkspaceEvals
        skill={skill}
        workspacePath="/workspace"
        scenario={null}
        onStartNewScenario={vi.fn()}
        onSaveScenario={vi.fn()}
      />,
    );

    expect(screen.queryByLabelText(/scenario name/i)).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Results" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^evaluate$/i })).toBeDisabled();
    expect(screen.queryByRole("heading", { name: /run history/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /latest run/i })).not.toBeInTheDocument();
  });

  it("shows plain-language expectations instead of low-level assertion editors", async () => {
    render(
      <WorkspaceEvals
        skill={skill}
        workspacePath="/workspace"
        scenario={performanceScenario}
        onStartNewScenario={vi.fn()}
        onSaveScenario={vi.fn()}
      />,
    );

    expect(await screen.findByDisplayValue("Forecast next quarter revenue")).toBeInTheDocument();
    expect(screen.getByText("Expectations")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Explains the forecast assumptions.")).toBeInTheDocument();
    expect(screen.queryByText("Assertions")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add assertion/i })).not.toBeInTheDocument();
  });

  it("leaves new scenario creation to the parent Scenarios section", async () => {
    render(
      <WorkspaceEvals
        skill={skill}
        workspacePath="/workspace"
        scenario={performanceScenario}
        onStartNewScenario={vi.fn()}
        onSaveScenario={vi.fn()}
      />,
    );

    expect(await screen.findByDisplayValue("Forecast next quarter revenue")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /new scenario/i })).not.toBeInTheDocument();
  });

  it("autosaves edits after a persisted scenario exists", async () => {
    const user = userEvent.setup();
    const onSaveScenario = vi.fn().mockResolvedValue({
      ...performanceScenario,
      prompt: "Forecast next quarter revenue with assumptions",
    });

    render(
      <WorkspaceEvals
        skill={skill}
        workspacePath="/workspace"
        scenario={performanceScenario}
        onStartNewScenario={vi.fn()}
        onSaveScenario={onSaveScenario}
      />,
    );

    const prompt = await screen.findByLabelText(/user prompt/i);
    await user.clear(prompt);
    await user.type(prompt, "Forecast next quarter revenue with assumptions");

    await waitFor(() =>
      expect(onSaveScenario).toHaveBeenCalledWith({
        id: "case-1",
        name: "Regression",
        tags: ["performance"],
        prompt: "Forecast next quarter revenue with assumptions",
        expectations: ["Explains the forecast assumptions."],
      }, { previousScenarioName: "Regression" }),
    );
  });

  it("deletes an expectation from the expanded scenario editor", async () => {
    const user = userEvent.setup();
    const onSaveScenario = vi.fn().mockResolvedValue({
      ...performanceScenario,
      expectations: [],
    });

    render(
      <WorkspaceEvals
        skill={skill}
        workspacePath="/workspace"
        scenario={performanceScenario}
        onStartNewScenario={vi.fn()}
        onSaveScenario={onSaveScenario}
      />,
    );

    expect(await screen.findByDisplayValue("Explains the forecast assumptions.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /delete expectation 1/i }));

    await waitFor(() =>
      expect(onSaveScenario).toHaveBeenCalledWith({
        id: "case-1",
        name: "Regression",
        tags: ["performance"],
        prompt: "Forecast next quarter revenue",
        expectations: [],
      }, { previousScenarioName: "Regression" }),
    );
  });

  it("builds an improvement brief and sends it to Refine", async () => {
    const user = userEvent.setup();
    const onNavigateToRefine = vi.fn();

    render(
      <WorkspaceEvals
        skill={skill}
        workspacePath="/workspace"
        scenario={performanceScenario}
        onStartNewScenario={vi.fn()}
        onSaveScenario={vi.fn()}
        onNavigateToRefine={onNavigateToRefine}
      />,
    );

    await screen.findByDisplayValue("Forecast next quarter revenue");
    await screen.findByText("Missed assumptions section");
    await user.click(screen.getByRole("button", { name: /send to refine/i }));

    await waitFor(() =>
      expect(mockBuildRefineImprovementBrief).toHaveBeenCalledWith("run-1"),
    );
    expect(setPendingInitialMessage).toHaveBeenCalledWith(
      "Improve assumptions handling",
    );
    expect(onNavigateToRefine).toHaveBeenCalled();
  });

  it("keeps package history stable when the selected scenario changes", async () => {
    const { rerender } = render(
      <WorkspaceEvals
        skill={skill}
        workspacePath="/workspace"
        scenario={performanceScenario}
        onStartNewScenario={vi.fn()}
        onSaveScenario={vi.fn()}
      />,
    );

    await screen.findByDisplayValue("Forecast next quarter revenue");
    await screen.findByText("Missed assumptions section");

    rerender(
      <WorkspaceEvals
        skill={skill}
        workspacePath="/workspace"
        scenario={alternatePerformanceScenario}
        onStartNewScenario={vi.fn()}
        onSaveScenario={vi.fn()}
      />,
    );

    expect(mockListEvalRuns).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Missed assumptions section")).toBeInTheDocument();
  });

  it("reloads filtered history and clears the selected run when the workspace changes", async () => {
    const { rerender } = render(
      <WorkspaceEvals
        skill={skill}
        workspacePath="/workspace-a"
        scenario={performanceScenario}
        onStartNewScenario={vi.fn()}
        onSaveScenario={vi.fn()}
      />,
    );

    await screen.findByDisplayValue("Forecast next quarter revenue");
    await screen.findByText("Missed assumptions section");

    rerender(
      <WorkspaceEvals
        skill={skill}
        workspacePath="/workspace-b"
        scenario={performanceScenario}
        onStartNewScenario={vi.fn()}
        onSaveScenario={vi.fn()}
      />,
    );

    await waitFor(() =>
      expect(mockListEvalRuns).toHaveBeenLastCalledWith(
        "skills",
        "forecast-skill",
        "performance",
        20,
        "Package",
      ),
    );
    await screen.findByText("Missed assumptions section");
  });

  it("ignores stale history responses after the workspace changes", async () => {
    const firstHistory = createDeferred([runSummary]);
    const secondHistory = createDeferred([workspaceBRunSummary]);
    mockListEvalRuns.mockReset();
    mockListEvalRuns
      .mockImplementationOnce(() => firstHistory.promise)
      .mockImplementationOnce(() => secondHistory.promise);

    const { rerender } = render(
      <WorkspaceEvals
        skill={skill}
        workspacePath="/workspace-a"
        scenario={performanceScenario}
        onStartNewScenario={vi.fn()}
        onSaveScenario={vi.fn()}
      />,
    );

    rerender(
      <WorkspaceEvals
        skill={skill}
        workspacePath="/workspace-b"
        scenario={performanceScenario}
        onStartNewScenario={vi.fn()}
        onSaveScenario={vi.fn()}
      />,
    );

    secondHistory.resolve([workspaceBRunSummary]);
    expect(await screen.findByText("run-2")).toBeInTheDocument();

    firstHistory.resolve([runSummary]);
    await waitFor(() =>
      expect(screen.queryByText("run-1")).not.toBeInTheDocument(),
    );
  });

  it("ignores stale run-detail responses after the workspace changes", async () => {
    const staleDetail = createDeferred(runDetail);
    mockReadEvalRun.mockReset().mockReturnValue(staleDetail.promise);
    mockListEvalRuns
      .mockReset()
      .mockResolvedValueOnce([runSummary])
      .mockResolvedValueOnce([workspaceBRunSummary]);

    const { rerender } = render(
      <WorkspaceEvals
        skill={skill}
        workspacePath="/workspace-a"
        scenario={performanceScenario}
        onStartNewScenario={vi.fn()}
        onSaveScenario={vi.fn()}
      />,
    );

    await screen.findByDisplayValue("Forecast next quarter revenue");

    rerender(
      <WorkspaceEvals
        skill={skill}
        workspacePath="/workspace-b"
        scenario={performanceScenario}
        onStartNewScenario={vi.fn()}
        onSaveScenario={vi.fn()}
      />,
    );

    await screen.findByText("run-2");
    staleDetail.resolve(runDetail);

    await waitFor(() =>
      expect(screen.queryByText("Missed assumptions section")).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: /send to refine/i })).toBeInTheDocument();
  });

  it("persists and reloads the selected scenario from the scenario-level suggest action", async () => {
    const user = userEvent.setup();
    const onSuggestScenario = vi.fn().mockResolvedValue({
      id: "generated-case",
      name: "Regression",
      tags: ["performance"],
      prompt: "Summarize pipeline risk",
      shouldTrigger: null,
      expectations: ["Summarizes the main pipeline blockers."],
    });

    render(
      <WorkspaceEvals
        skill={skill}
        workspacePath="/workspace"
        scenario={performanceScenario}
        onStartNewScenario={vi.fn()}
        onSaveScenario={vi.fn()}
        onSuggestScenario={onSuggestScenario}
      />,
    );

    await screen.findByDisplayValue("Forecast next quarter revenue");
    expect(screen.getAllByRole("button", { name: /^suggest$/i })).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: /^suggest$/i }));

    await waitFor(() =>
      expect(onSuggestScenario).toHaveBeenCalled(),
    );
    expect(await screen.findByDisplayValue("Summarize pipeline risk")).toBeInTheDocument();
    expect(
      screen.getByDisplayValue("Summarizes the main pipeline blockers."),
    ).toBeInTheDocument();
  });

  it("shows a workflow-style footer status while scenario suggestion is running", async () => {
    useSettingsStore.getState().setSettings({
      modelSettings: {
        provider: "opencode",
        model: "opencode-go/minimax-m2.7",
      },
    });
    const user = userEvent.setup();
    const deferredSuggestion = createDeferred({
      id: "generated-case",
      name: "Risk Summary",
      tags: ["performance"],
      prompt: "Summarize pipeline risk",
      shouldTrigger: null,
      expectations: ["Summarizes the main pipeline blockers."],
    });
    const onSuggestScenario = vi.fn().mockReturnValue(deferredSuggestion.promise);

    render(
      <WorkspaceEvals
        skill={skill}
        workspacePath="/workspace"
        scenario={performanceScenario}
        onStartNewScenario={vi.fn()}
        onSaveScenario={vi.fn()}
        onSuggestScenario={onSuggestScenario}
      />,
    );

    await screen.findByDisplayValue("Forecast next quarter revenue");
    expect(screen.getByTestId("eval-suggest-status-bar")).toBeInTheDocument();
    expect(screen.getByText("ready")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^suggest$/i }));

    expect(screen.getByText("Reading skill and drafting scenario…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /suggesting/i })).toBeDisabled();
    expect(screen.getByText("running…")).toBeInTheDocument();
    expect(screen.getByText("Opencode Go/minimax M2.7")).toBeInTheDocument();
    expect(screen.getByText(/\d+s/)).toBeInTheDocument();

    deferredSuggestion.resolve({
      id: "generated-case",
      name: "Risk Summary",
      tags: ["performance"],
      prompt: "Summarize pipeline risk",
      shouldTrigger: null,
      expectations: ["Summarizes the main pipeline blockers."],
    });
    await waitFor(() =>
      expect(
        screen.queryByText("Reading skill and drafting scenario…"),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByText("ready")).toBeInTheDocument();
  });

  it("surfaces an actionable error when scenario suggestion returns malformed structured output", async () => {
    const user = userEvent.setup();
    const onSuggestScenario = vi.fn().mockRejectedValue(
      new Error(
        "OpenHands eval structured result was not valid JSON: expected value at line 2 column 1",
      ),
    );

    render(
      <WorkspaceEvals
        skill={skill}
        workspacePath="/workspace"
        scenario={performanceScenario}
        onStartNewScenario={vi.fn()}
        onSaveScenario={vi.fn()}
        onSuggestScenario={onSuggestScenario}
      />,
    );

    await screen.findByDisplayValue("Forecast next quarter revenue");
    await user.click(screen.getByRole("button", { name: /^suggest$/i }));

    expect(
      await screen.findAllByText(/scenario suggestion failed/i),
    ).toHaveLength(2);
    expect(screen.getAllByText(/invalid json/i)).toHaveLength(2);
  });

  it("shows suggestion failures in the scenario footer status area", async () => {
    const user = userEvent.setup();
    const onSuggestScenario = vi.fn().mockRejectedValue(
      new Error("missing field `name`"),
    );

    render(
      <WorkspaceEvals
        skill={skill}
        workspacePath="/workspace"
        scenario={performanceScenario}
        onStartNewScenario={vi.fn()}
        onSaveScenario={vi.fn()}
        onSuggestScenario={onSuggestScenario}
      />,
    );

    await screen.findByDisplayValue("Forecast next quarter revenue");
    await user.click(screen.getByRole("button", { name: /^suggest$/i }));

    expect(
      await screen.findAllByText("Scenario suggestion failed: missing field `name`"),
    ).toHaveLength(2);
  });

  it("keeps trigger-mode generation separate from performance suggestion", async () => {
    const user = userEvent.setup();
    const onSuggestScenario = vi.fn().mockResolvedValue({
      id: "case-1",
      name: "Happy Path",
      tags: ["performance"],
      prompt: "Forecast next quarter revenue",
      shouldTrigger: null,
      expectations: ["Explains the forecast assumptions."],
    });

    render(
      <WorkspaceEvals
        skill={skill}
        workspacePath="/workspace"
        scenario={performanceScenario}
        onStartNewScenario={vi.fn()}
        onSaveScenario={vi.fn()}
        onSuggestScenario={onSuggestScenario}
      />,
    );

    await screen.findByDisplayValue("Forecast next quarter revenue");
    await user.click(screen.getAllByRole("button", { name: /^suggest$/i })[0]!);

    await waitFor(() =>
      expect(onSuggestScenario).toHaveBeenCalled(),
    );
  });

  it("publishes real running state while a scenario run is active", async () => {
    const user = userEvent.setup();
    const onRunningChange = vi.fn();
    const deferredRun = createDeferred(runSummary);
    mockRunEvalWorkbench.mockReset().mockReturnValue(deferredRun.promise);

    render(
      <WorkspaceEvals
        skill={skill}
        workspacePath="/workspace"
        scenario={performanceScenario}
        onStartNewScenario={vi.fn()}
        onSaveScenario={vi.fn()}
        onRunningChange={onRunningChange}
      />,
    );

    await screen.findByDisplayValue("Forecast next quarter revenue");
    onRunningChange.mockClear();

    await user.click(screen.getByRole("button", { name: /^evaluate$/i }));

    await waitFor(() =>
      expect(mockRunEvalWorkbench).toHaveBeenCalledWith({
        runId: expect.any(String),
        pluginSlug: "skills",
        skillName: "forecast-skill",
        mode: "performance",
        candidateIds: ["current-skill"],
      }),
    );
    await waitFor(() => expect(onRunningChange).toHaveBeenCalledWith(true));

    deferredRun.resolve(runSummary);

    await waitFor(() =>
      expect(onRunningChange).toHaveBeenLastCalledWith(false),
    );
  });

  it("shows progress and cancels the active workbench run", async () => {
    const user = userEvent.setup();
    const deferredRun = createDeferred(runSummary);
    mockRunEvalWorkbench.mockReset().mockReturnValue(deferredRun.promise);

    render(
      <WorkspaceEvals
        skill={skill}
        workspacePath="/workspace"
        scenario={performanceScenario}
        onStartNewScenario={vi.fn()}
        onSaveScenario={vi.fn()}
      />,
    );

    await screen.findByDisplayValue("Forecast next quarter revenue");
    await user.click(screen.getByRole("button", { name: /^evaluate$/i }));

    await waitFor(() =>
      expect(mockRunEvalWorkbench).toHaveBeenCalledWith({
        runId: expect.any(String),
        pluginSlug: "skills",
        skillName: "forecast-skill",
        mode: "performance",
        candidateIds: ["current-skill"],
      }),
    );

    const [{ runId }] = mockRunEvalWorkbench.mock.calls.at(-1) as [
      { runId: string },
    ];
    progressListener?.({
      payload: {
        runId,
        phase: "performance",
        completed: 1,
        total: 3,
        message: "Running case 1 of 3",
      },
    });

    expect(
      await screen.findByText("Running case 1 of 3 (1/3)"),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^cancel$/i }));

    await waitFor(() =>
      expect(mockCancelEvalWorkbenchRun).toHaveBeenCalledWith(runId),
    );

    deferredRun.resolve(runSummary);
    await waitFor(() =>
      expect(screen.queryByText("Running case 1 of 3 (1/3)")).not.toBeInTheDocument(),
    );
  });
});
