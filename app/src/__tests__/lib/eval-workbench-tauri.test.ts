import { beforeEach, describe, expect, it } from "vitest";
import { mockInvoke, resetTauriMocks } from "@/test/mocks/tauri";
import {
  applyDescriptionCandidate,
  buildRefineImprovementBrief,
  deleteEvalPromptSet,
  listEvalPromptSets,
  listEvalRuns,
  readEvalRun,
  runEvalWorkbench,
  saveEvalPromptSet,
  suggestDescriptionCandidates,
} from "@/lib/eval-workbench";

describe("Eval Workbench Tauri wrappers", () => {
  beforeEach(() => {
    resetTauriMocks();
    mockInvoke.mockResolvedValue(undefined);
  });

  it("lists eval prompt sets with typed mode filters", async () => {
    await listEvalPromptSets("skills", "forecast-skill", "performance");

    expect(mockInvoke).toHaveBeenCalledWith("list_eval_prompt_sets", {
      pluginSlug: "skills",
      skillName: "forecast-skill",
      mode: "performance",
    });
  });

  it("saves prompt sets through the typed workbench contract", async () => {
    await saveEvalPromptSet({
      pluginSlug: "skills",
      skillName: "forecast-skill",
      mode: "performance",
      name: "Regression",
      cases: [
        {
          prompt: "Forecast next quarter revenue",
          expected: "Includes assumptions",
          shouldTrigger: null,
          assertions: [],
        },
      ],
    });

    expect(mockInvoke).toHaveBeenCalledWith("save_eval_prompt_set", {
      promptSet: {
        pluginSlug: "skills",
        skillName: "forecast-skill",
        mode: "performance",
        name: "Regression",
        cases: [
          {
            prompt: "Forecast next quarter revenue",
            expected: "Includes assumptions",
            shouldTrigger: null,
            assertions: [],
          },
        ],
      },
    });
  });

  it("runs eval workbench requests with explicit candidate ids", async () => {
    await runEvalWorkbench({
      runId: "run-1",
      promptSetId: "prompt-set-1",
      candidateIds: ["current-skill"],
    });

    expect(mockInvoke).toHaveBeenCalledWith("run_eval_workbench", {
      request: {
        runId: "run-1",
        promptSetId: "prompt-set-1",
        candidateIds: ["current-skill"],
      },
    });
  });

  it("supports candidate generation, apply, history, and refine brief commands", async () => {
    await Promise.all([
      listEvalRuns("skills", "forecast-skill", "trigger", 20),
      readEvalRun("run-1"),
      suggestDescriptionCandidates({
        promptSetId: "prompt-set-1",
        baselineDescription: "Route invoice reconciliation requests",
        candidateCount: 3,
      }),
      applyDescriptionCandidate("skills", "forecast-skill", "candidate-1"),
      buildRefineImprovementBrief("run-1"),
      deleteEvalPromptSet("prompt-set-1"),
    ]);

    expect(mockInvoke).toHaveBeenCalledWith("list_eval_runs", {
      pluginSlug: "skills",
      skillName: "forecast-skill",
      mode: "trigger",
      limit: 20,
    });
    expect(mockInvoke).toHaveBeenCalledWith("read_eval_run", { runId: "run-1" });
    expect(mockInvoke).toHaveBeenCalledWith("suggest_description_candidates", {
      request: {
        promptSetId: "prompt-set-1",
        baselineDescription: "Route invoice reconciliation requests",
        candidateCount: 3,
      },
    });
    expect(mockInvoke).toHaveBeenCalledWith("apply_description_candidate", {
      pluginSlug: "skills",
      skillName: "forecast-skill",
      candidateId: "candidate-1",
    });
    expect(mockInvoke).toHaveBeenCalledWith("build_refine_improvement_brief", {
      runId: "run-1",
    });
    expect(mockInvoke).toHaveBeenCalledWith("delete_eval_prompt_set", {
      promptSetId: "prompt-set-1",
    });
  });
});
