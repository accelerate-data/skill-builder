import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SkillSummary } from "@/lib/types";
import { mockListen, resetTauriMocks } from "@/test/mocks/tauri";

const mockListEvalRuns = vi.fn();
const mockReadEvalRun = vi.fn();
const mockRunEvalWorkbench = vi.fn();
const mockCancelEvalWorkbenchRun = vi.fn();
const mockBuildRefineImprovementBrief = vi.fn();

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
      ),
    );
    expect(
      await screen.findByDisplayValue("Forecast next quarter revenue"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /run scenario/i })).toBeInTheDocument();
  });

  it("saves a new performance scenario through the shared workbench surface", async () => {
    const user = userEvent.setup();
    const onSaveScenario = vi.fn().mockResolvedValue({
      name: "Smoke",
      tags: ["performance"],
      cases: [
        {
          id: "case-2",
          prompt: "Summarize pipeline risk",
          expectedOutcome: "Lists top blockers",
          shouldTrigger: null,
          assertions: [],
        },
      ],
    });
    const onStartNewScenario = vi.fn();

    render(
      <WorkspaceEvals
        skill={skill}
        workspacePath="/workspace"
        scenario={performanceScenario}
        onStartNewScenario={onStartNewScenario}
        onSaveScenario={onSaveScenario}
      />,
    );

    await screen.findByDisplayValue("Forecast next quarter revenue");

    await user.click(screen.getByRole("button", { name: /new scenario/i }));
    expect(onStartNewScenario).toHaveBeenCalled();

    await user.clear(screen.getByLabelText(/scenario name/i));
    await user.type(screen.getByLabelText(/scenario name/i), "Smoke");
    await user.clear(screen.getByLabelText(/user prompt/i));
    await user.type(screen.getByLabelText(/user prompt/i), "Summarize pipeline risk");
    await user.clear(screen.getByLabelText(/expected outcome/i));
    await user.type(screen.getByLabelText(/expected outcome/i), "Lists top blockers");
    await user.click(screen.getByRole("button", { name: /^save scenario$/i }));

    await waitFor(() =>
      expect(onSaveScenario).toHaveBeenCalledWith({
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
      }),
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
    await user.click(screen.getByRole("button", { name: /view latest run/i }));
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

    await user.click(screen.getByRole("button", { name: /run scenario/i }));

    await waitFor(() =>
      expect(mockRunEvalWorkbench).toHaveBeenCalledWith({
        runId: expect.any(String),
        pluginSlug: "skills",
        skillName: "forecast-skill",
        scenarioName: "Regression",
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
    await user.click(screen.getByRole("button", { name: /run scenario/i }));

    await waitFor(() =>
      expect(mockRunEvalWorkbench).toHaveBeenCalledWith({
        runId: expect.any(String),
        pluginSlug: "skills",
        skillName: "forecast-skill",
        scenarioName: "Regression",
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
