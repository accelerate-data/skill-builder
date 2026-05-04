import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SkillSummary } from "@/lib/types";

const mockListEvalPromptSets = vi.fn();
const mockSaveEvalPromptSet = vi.fn();
const mockListEvalRuns = vi.fn();
const mockReadEvalRun = vi.fn();
const mockRunEvalWorkbench = vi.fn();
const mockBuildRefineImprovementBrief = vi.fn();

const setPendingInitialMessage = vi.fn();

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
    listEvalPromptSets: (...args: unknown[]) => mockListEvalPromptSets(...args),
    saveEvalPromptSet: (...args: unknown[]) => mockSaveEvalPromptSet(...args),
    listEvalRuns: (...args: unknown[]) => mockListEvalRuns(...args),
    readEvalRun: (...args: unknown[]) => mockReadEvalRun(...args),
    runEvalWorkbench: (...args: unknown[]) => mockRunEvalWorkbench(...args),
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

const performancePromptSet = {
  id: "prompt-set-performance",
  pluginSlug: "skills",
  skillName: "forecast-skill",
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
    mockListEvalPromptSets.mockReset().mockResolvedValue([performancePromptSet]);
    mockSaveEvalPromptSet.mockReset().mockResolvedValue(performancePromptSet);
    mockListEvalRuns.mockReset().mockResolvedValue([runSummary]);
    mockReadEvalRun.mockReset().mockResolvedValue(runDetail);
    mockRunEvalWorkbench.mockReset().mockResolvedValue(runSummary);
    mockBuildRefineImprovementBrief.mockReset().mockResolvedValue({
      runId: "run-1",
      brief: "Improve assumptions handling",
    });
    setPendingInitialMessage.mockReset();
  });

  it("loads performance prompt sets and run history from the eval workbench surface", async () => {
    render(<WorkspaceEvals skill={skill} workspacePath="/workspace" />);

    await waitFor(() =>
      expect(mockListEvalPromptSets).toHaveBeenCalledWith(
        "skills",
        "forecast-skill",
        "performance",
      ),
    );
    expect(mockListEvalRuns).toHaveBeenCalledWith(
      "skills",
      "forecast-skill",
      "performance",
      20,
    );
    expect(await screen.findByText("Regression")).toBeInTheDocument();
    expect(screen.getByText("Forecast next quarter revenue")).toBeInTheDocument();
  });

  it("saves a new performance prompt set through the workbench command surface", async () => {
    const user = userEvent.setup();
    render(<WorkspaceEvals skill={skill} workspacePath="/workspace" />);

    await screen.findByText("Regression");

    await user.click(screen.getByRole("button", { name: /new prompt set/i }));
    await user.clear(screen.getByLabelText(/prompt set name/i));
    await user.type(screen.getByLabelText(/prompt set name/i), "Smoke");
    await user.clear(screen.getByLabelText(/case prompt/i));
    await user.type(screen.getByLabelText(/case prompt/i), "Summarize pipeline risk");
    await user.clear(screen.getByLabelText(/expected outcome/i));
    await user.type(screen.getByLabelText(/expected outcome/i), "Lists top blockers");
    await user.click(screen.getByRole("button", { name: /^save prompt set$/i }));

    await waitFor(() =>
      expect(mockSaveEvalPromptSet).toHaveBeenCalledWith(
        expect.objectContaining({
          pluginSlug: "skills",
          skillName: "forecast-skill",
          mode: "performance",
          name: "Smoke",
        }),
      ),
    );
  });

  it("builds an improvement brief and sends it to Refine", async () => {
    const user = userEvent.setup();
    const onNavigateToRefine = vi.fn();

    render(
      <WorkspaceEvals
        skill={skill}
        workspacePath="/workspace"
        onNavigateToRefine={onNavigateToRefine}
      />,
    );

    await screen.findByText("Regression");
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

  it("publishes real running state while a prompt set run is active", async () => {
    const user = userEvent.setup();
    const onRunningChange = vi.fn();
    const deferredRun = createDeferred(runSummary);
    mockRunEvalWorkbench.mockReset().mockReturnValue(deferredRun.promise);

    render(
      <WorkspaceEvals
        skill={skill}
        workspacePath="/workspace"
        onRunningChange={onRunningChange}
      />,
    );

    await screen.findByText("Regression");
    onRunningChange.mockClear();

    await user.click(screen.getByRole("button", { name: /run prompt set/i }));

    await waitFor(() =>
      expect(mockRunEvalWorkbench).toHaveBeenCalledWith({
        promptSetId: "prompt-set-performance",
        candidateIds: ["current-skill"],
      }),
    );
    await waitFor(() => expect(onRunningChange).toHaveBeenCalledWith(true));

    deferredRun.resolve(runSummary);

    await waitFor(() =>
      expect(onRunningChange).toHaveBeenLastCalledWith(false),
    );
  });
});
