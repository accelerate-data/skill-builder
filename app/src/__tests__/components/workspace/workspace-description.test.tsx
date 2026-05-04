import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SkillSummary } from "@/lib/types";
import {
  mockListen,
  resetTauriMocks,
} from "@/test/mocks/tauri";

const mockListEvalPromptSets = vi.fn();
const mockSaveEvalPromptSet = vi.fn();
const mockListEvalRuns = vi.fn();
const mockReadEvalRun = vi.fn();
const mockSuggestDescriptionCandidates = vi.fn();
const mockRunEvalWorkbench = vi.fn();
const mockCancelEvalWorkbenchRun = vi.fn();
const mockApplyDescriptionCandidate = vi.fn();
const mockBuildRefineImprovementBrief = vi.fn();

const setPendingInitialMessage = vi.fn();
let progressListener:
  | ((event: { payload: { runId: string; phase: string; completed: number; total: number; message: string } }) => void)
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
    listEvalPromptSets: (...args: unknown[]) => mockListEvalPromptSets(...args),
    saveEvalPromptSet: (...args: unknown[]) => mockSaveEvalPromptSet(...args),
    listEvalRuns: (...args: unknown[]) => mockListEvalRuns(...args),
    readEvalRun: (...args: unknown[]) => mockReadEvalRun(...args),
    suggestDescriptionCandidates: (...args: unknown[]) =>
      mockSuggestDescriptionCandidates(...args),
    runEvalWorkbench: (...args: unknown[]) => mockRunEvalWorkbench(...args),
    cancelEvalWorkbenchRun: (...args: unknown[]) =>
      mockCancelEvalWorkbenchRun(...args),
    applyDescriptionCandidate: (...args: unknown[]) =>
      mockApplyDescriptionCandidate(...args),
    buildRefineImprovementBrief: (...args: unknown[]) =>
      mockBuildRefineImprovementBrief(...args),
  };
});

import { WorkspaceDescription } from "@/components/workspace/workspace-description";

const skill: SkillSummary = {
  name: "trigger-skill",
  plugin_slug: "skills",
  plugin_display_name: "Skills",
  is_default_plugin: true,
  description: "Use when the user asks to reconcile customer invoices",
  version: "2.0.0",
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

const triggerPromptSet = {
  id: "prompt-set-trigger",
  pluginSlug: "skills",
  skillName: "trigger-skill",
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
  id: "run-trigger-1",
  promptSetId: "prompt-set-trigger",
  mode: "trigger" as const,
  status: "completed",
  summary: { passed: 3, total: 4 },
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
      runId: "run-trigger-1",
      caseId: "case-1",
      candidateId: "candidate-1",
      passed: true,
      score: 1,
      output: {},
      reason: null,
    },
  ],
  descriptionCandidates: [
    {
      id: "candidate-1",
      runId: "run-trigger-1",
      label: "Candidate 1",
      description: "Use when the user needs invoice reconciliation or payment matching",
      rationale: "Covers reconciliation intent without widening to generic billing",
      rank: 1,
    },
  ],
};

const runDetailWithBaselineComparison = {
  ...runSummary,
  results: [
    {
      id: "result-baseline-positive",
      runId: "run-trigger-1",
      caseId: "case-1",
      candidateId: "current-skill",
      passed: false,
      score: 0,
      output: {},
      reason: "Misses the invoice-reconciliation trigger.",
    },
    {
      id: "result-baseline-negative",
      runId: "run-trigger-1",
      caseId: "case-2",
      candidateId: "current-skill",
      passed: true,
      score: 1,
      output: {},
      reason: "Correctly avoids unrelated billing cleanup.",
    },
    {
      id: "result-candidate-1-positive",
      runId: "run-trigger-1",
      caseId: "case-1",
      candidateId: "candidate-1",
      passed: true,
      score: 1,
      output: {},
      reason: "Catches invoice reconciliation.",
    },
    {
      id: "result-candidate-1-negative",
      runId: "run-trigger-1",
      caseId: "case-2",
      candidateId: "candidate-1",
      passed: false,
      score: 0,
      output: {},
      reason: "Still fires for unrelated billing cleanup.",
    },
    {
      id: "result-candidate-2-positive",
      runId: "run-trigger-1",
      caseId: "case-1",
      candidateId: "candidate-2",
      passed: true,
      score: 1,
      output: {},
      reason: "Catches invoice reconciliation.",
    },
    {
      id: "result-candidate-2-negative",
      runId: "run-trigger-1",
      caseId: "case-2",
      candidateId: "candidate-2",
      passed: true,
      score: 1,
      output: {},
      reason: "Avoids unrelated billing cleanup.",
    },
  ],
  descriptionCandidates: [
    {
      id: "candidate-1",
      runId: "run-trigger-1",
      label: "Candidate 1",
      description:
        "Use when the user needs invoice reconciliation or payment matching",
      rationale: "Good positive coverage but still too broad.",
      rank: 1,
    },
    {
      id: "candidate-2",
      runId: "run-trigger-1",
      label: "Candidate 2",
      description:
        "Use when reconciling invoice balances and customer payment activity",
      rationale: "Best balance of trigger recall and false-trigger control.",
      rank: 2,
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

describe("WorkspaceDescription", () => {
  beforeEach(() => {
    resetTauriMocks();
    progressListener = null;
    mockListen.mockImplementation((eventName, callback) => {
      if (eventName === "eval-workbench-progress") {
        progressListener = callback as typeof progressListener;
      }
      return Promise.resolve(() => {});
    });
    mockListEvalPromptSets.mockReset().mockResolvedValue([triggerPromptSet]);
    mockSaveEvalPromptSet.mockReset().mockResolvedValue(triggerPromptSet);
    mockListEvalRuns.mockReset().mockResolvedValue([runSummary]);
    mockReadEvalRun.mockReset().mockResolvedValue(runDetail);
    mockSuggestDescriptionCandidates.mockReset().mockResolvedValue([
      {
        id: "candidate-1",
        runId: "draft-run",
        label: "Candidate 1",
        description:
          "Use when the user needs invoice reconciliation or payment matching",
        rationale: "Best routing precision",
        rank: 1,
      },
      {
        id: "candidate-2",
        runId: "draft-run",
        label: "Candidate 2",
        description:
          "Use when reconciling invoice balances and customer payment activity",
        rationale: "Best comparison score once evaluated",
        rank: 2,
      },
    ]);
    mockRunEvalWorkbench.mockReset().mockResolvedValue(runSummary);
    mockCancelEvalWorkbenchRun.mockReset().mockResolvedValue(undefined);
    mockApplyDescriptionCandidate.mockReset().mockResolvedValue({
      description:
        "Use when the user needs invoice reconciliation or payment matching",
    });
    mockBuildRefineImprovementBrief.mockReset().mockResolvedValue({
      runId: "run-trigger-1",
      brief: "Tighten routing boundaries around invoice reconciliation",
    });
    setPendingInitialMessage.mockReset();
  });

  it("loads trigger prompt sets and run history from the eval workbench surface", async () => {
    render(
      <WorkspaceDescription
        skill={skill}
        workspacePath="/workspace"
      />,
    );

    await waitFor(() =>
      expect(mockListEvalPromptSets).toHaveBeenCalledWith(
        "skills",
        "trigger-skill",
        "trigger",
      ),
    );
    expect(mockListEvalRuns).toHaveBeenCalledWith(
      "skills",
      "trigger-skill",
      "trigger",
      20,
    );
    expect(await screen.findByText("Routing checks")).toBeInTheDocument();
    expect(screen.getByText("Reconcile open customer invoices")).toBeInTheDocument();
  });

  it("generates description candidates through the workbench command surface", async () => {
    const user = userEvent.setup();

    render(
      <WorkspaceDescription
        skill={skill}
        workspacePath="/workspace"
      />,
    );

    await screen.findByText("Routing checks");

    await user.click(screen.getByRole("button", { name: /generate candidates/i }));

    await waitFor(() =>
      expect(mockSuggestDescriptionCandidates).toHaveBeenCalledWith({
        promptSetId: "prompt-set-trigger",
        baselineDescription:
          "Use when the user asks to reconcile customer invoices",
        candidateCount: 3,
      }),
    );
    expect(
      await screen.findByText(/invoice reconciliation or payment matching/i),
    ).toBeInTheDocument();
  });

  it("applies a generated candidate and reports it back to the shell", async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();

    render(
      <WorkspaceDescription
        skill={skill}
        workspacePath="/workspace"
        onApply={onApply}
      />,
    );

    await screen.findByText("Routing checks");
    await user.click(screen.getByRole("button", { name: /generate candidates/i }));
    await screen.findByText(/invoice reconciliation or payment matching/i);
    await user.click(screen.getByRole("button", { name: /apply candidate 1/i }));

    await waitFor(() =>
      expect(mockApplyDescriptionCandidate).toHaveBeenCalledWith(
        "skills",
        "trigger-skill",
        "candidate-1",
      ),
    );
    expect(onApply).toHaveBeenCalledWith(
      "Use when the user needs invoice reconciliation or payment matching",
      "2.0.0",
    );
  });

  it("builds an improvement brief from a completed trigger run and sends it to Refine", async () => {
    const user = userEvent.setup();
    const onNavigateToRefine = vi.fn();

    render(
      <WorkspaceDescription
        skill={skill}
        workspacePath="/workspace"
        onNavigateToRefine={onNavigateToRefine}
      />,
    );

    await screen.findByText("Routing checks");
    await user.click(screen.getByRole("button", { name: /view latest run/i }));
    await screen.findByRole("heading", { name: "Candidate 1" });
    await user.click(screen.getByRole("button", { name: /send to refine/i }));

    await waitFor(() =>
      expect(mockBuildRefineImprovementBrief).toHaveBeenCalledWith(
        "run-trigger-1",
      ),
    );
    expect(setPendingInitialMessage).toHaveBeenCalledWith(
        "Tighten routing boundaries around invoice reconciliation",
    );
    expect(onNavigateToRefine).toHaveBeenCalled();
  });

  it("runs trigger comparison against the baseline plus candidates and recommends the best eval result", async () => {
    const user = userEvent.setup();
    mockListEvalPromptSets.mockResolvedValue([
      {
        ...triggerPromptSet,
        cases: [
          ...triggerPromptSet.cases,
          {
            id: "case-2",
            prompt: "Clean up old billing notes",
            expected: null,
            shouldTrigger: false,
            assertions: [],
            sortOrder: 1,
          },
        ],
      },
    ]);
    mockReadEvalRun.mockResolvedValue(runDetailWithBaselineComparison);

    render(
      <WorkspaceDescription
        skill={skill}
        workspacePath="/workspace"
      />,
    );

    await screen.findByText("Routing checks");
    await user.click(screen.getByRole("button", { name: /generate candidates/i }));

    expect(screen.getByRole("heading", { name: "Baseline" })).toBeInTheDocument();
    expect(screen.queryByText("Recommended")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /run comparison/i }));

    await waitFor(() =>
      expect(mockRunEvalWorkbench).toHaveBeenCalledWith({
        runId: expect.any(String),
        promptSetId: "prompt-set-trigger",
        candidateIds: ["current-skill", "candidate-1", "candidate-2"],
      }),
    );

    const candidateTwoCard = screen.getByTestId("candidate-card-candidate-2");
    expect(within(candidateTwoCard).getByText("Recommended")).toBeInTheDocument();
    expect(
      within(candidateTwoCard).getByTestId("candidate-pass-summary-candidate-2"),
    ).toBeInTheDocument();
  });

  it("publishes real running state while candidate generation is active", async () => {
    const user = userEvent.setup();
    const onRunningChange = vi.fn();
    const deferredCandidates = createDeferred([
      {
        id: "candidate-1",
        runId: "draft-run",
        label: "Candidate 1",
        description:
          "Use when the user needs invoice reconciliation or payment matching",
        rationale: "Best routing precision",
        rank: 1,
      },
    ]);
    mockSuggestDescriptionCandidates
      .mockReset()
      .mockReturnValue(deferredCandidates.promise);

    render(
      <WorkspaceDescription
        skill={skill}
        workspacePath="/workspace"
        onRunningChange={onRunningChange}
      />,
    );

    await screen.findByText("Routing checks");
    onRunningChange.mockClear();

    await user.click(screen.getByRole("button", { name: /generate candidates/i }));

    await waitFor(() =>
      expect(mockSuggestDescriptionCandidates).toHaveBeenCalledWith({
        promptSetId: "prompt-set-trigger",
        baselineDescription:
          "Use when the user asks to reconcile customer invoices",
        candidateCount: 3,
      }),
    );
    await waitFor(() => expect(onRunningChange).toHaveBeenCalledWith(true));

    deferredCandidates.resolve([
      {
        id: "candidate-1",
        runId: "draft-run",
        label: "Candidate 1",
        description:
          "Use when the user needs invoice reconciliation or payment matching",
        rationale: "Best routing precision",
        rank: 1,
      },
    ]);

    await waitFor(() =>
      expect(onRunningChange).toHaveBeenLastCalledWith(false),
    );
  });

  it("shows progress and cancels an active trigger comparison", async () => {
    const user = userEvent.setup();
    const deferredRun = createDeferred(runSummary);
    mockRunEvalWorkbench.mockReset().mockReturnValue(deferredRun.promise);

    render(<WorkspaceDescription skill={skill} workspacePath="/workspace" />);

    await screen.findByText("Routing checks");
    await user.click(screen.getByRole("button", { name: /generate candidates/i }));
    await screen.findByText(/invoice reconciliation or payment matching/i);
    await user.click(screen.getByRole("button", { name: /run comparison/i }));

    await waitFor(() =>
      expect(mockRunEvalWorkbench).toHaveBeenCalledWith({
        runId: expect.any(String),
        promptSetId: "prompt-set-trigger",
        candidateIds: ["current-skill", "candidate-1", "candidate-2"],
      }),
    );

    const [{ runId }] = mockRunEvalWorkbench.mock.calls.at(-1) as [
      { runId: string },
    ];
    progressListener?.({
      payload: {
        runId,
        phase: "trigger",
        completed: 2,
        total: 6,
        message: "Comparing candidate 1",
      },
    });

    expect(
      await screen.findByText("Comparing candidate 1 (2/6)"),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^cancel$/i }));

    await waitFor(() =>
      expect(mockCancelEvalWorkbenchRun).toHaveBeenCalledWith(runId),
    );

    deferredRun.resolve(runSummary);
    await waitFor(() =>
      expect(screen.queryByText("Comparing candidate 1 (2/6)")).not.toBeInTheDocument(),
    );
  });
});
