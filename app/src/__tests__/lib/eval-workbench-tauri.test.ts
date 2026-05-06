import { beforeEach, describe, expect, it } from "vitest";
import { mockInvoke, resetTauriMocks } from "@/test/mocks/tauri";
import {
  applyDescriptionCandidate,
  buildRefineImprovementBrief,
  deleteScenario,
  listEvalRuns,
  listScenarios,
  loadScenario,
  readEvalRun,
  runEvalWorkbench,
  saveScenario,
  suggestDescriptionCandidates,
} from "@/lib/eval-workbench";

describe("Eval Workbench Tauri wrappers", () => {
  beforeEach(() => {
    resetTauriMocks();
    mockInvoke.mockResolvedValue(undefined);
  });

  it("lists git-backed scenarios through the typed workbench contract", async () => {
    await listScenarios("skills", "forecast-skill");

    expect(mockInvoke).toHaveBeenCalledWith("list_scenarios", {
      pluginSlug: "skills",
      skillName: "forecast-skill",
    });
  });

  it("loads a single scenario through the typed workbench contract", async () => {
    await loadScenario("skills", "forecast-skill", "Regression");

    expect(mockInvoke).toHaveBeenCalledWith("load_scenario", {
      pluginSlug: "skills",
      skillName: "forecast-skill",
      scenarioName: "Regression",
    });
  });

  it("saves scenarios through the typed workbench contract", async () => {
    await saveScenario(
      "skills",
      "forecast-skill",
      {
        name: "Regression",
        tags: ["performance"],
        cases: [
          {
            prompt: "Forecast next quarter revenue",
            expectedOutcome: "Includes assumptions",
            shouldTrigger: null,
            assertions: [],
          },
        ],
      },
      "Old regression",
    );

    expect(mockInvoke).toHaveBeenCalledWith("save_scenario", {
      pluginSlug: "skills",
      skillName: "forecast-skill",
      scenario: {
        name: "Regression",
        tags: ["performance"],
        cases: [
          {
            prompt: "Forecast next quarter revenue",
            expectedOutcome: "Includes assumptions",
            shouldTrigger: null,
            assertions: [],
          },
        ],
      },
      previousScenarioName: "Old regression",
    });
  });

  it("runs eval workbench requests with scenario names and explicit candidate ids", async () => {
    await runEvalWorkbench({
      runId: "run-1",
      pluginSlug: "skills",
      skillName: "forecast-skill",
      scenarioName: "Regression",
      mode: "performance",
      candidateIds: ["current-skill"],
    });

    expect(mockInvoke).toHaveBeenCalledWith("run_eval_workbench", {
      request: {
        runId: "run-1",
        pluginSlug: "skills",
        skillName: "forecast-skill",
        scenarioName: "Regression",
        mode: "performance",
        candidateIds: ["current-skill"],
      },
    });
  });

  it("supports candidate generation, apply, history, and scenario deletion commands", async () => {
    await Promise.all([
      listEvalRuns("skills", "forecast-skill", "trigger", 20, "Routing checks"),
      readEvalRun("run-1"),
      suggestDescriptionCandidates({
        pluginSlug: "skills",
        skillName: "forecast-skill",
        scenarioName: "Routing checks",
        baselineDescription: "Route invoice reconciliation requests",
        candidateCount: 3,
      }),
      applyDescriptionCandidate("skills", "forecast-skill", "candidate-1"),
      buildRefineImprovementBrief("run-1"),
      deleteScenario("skills", "forecast-skill", "Regression"),
    ]);

    expect(mockInvoke).toHaveBeenCalledWith("list_eval_runs", {
      pluginSlug: "skills",
      skillName: "forecast-skill",
      mode: "trigger",
      limit: 20,
      scenarioName: "Routing checks",
    });
    expect(mockInvoke).toHaveBeenCalledWith("read_eval_run", { runId: "run-1" });
    expect(mockInvoke).toHaveBeenCalledWith("suggest_description_candidates", {
      request: {
        pluginSlug: "skills",
        skillName: "forecast-skill",
        scenarioName: "Routing checks",
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
    expect(mockInvoke).toHaveBeenCalledWith("delete_scenario", {
      pluginSlug: "skills",
      skillName: "forecast-skill",
      scenarioName: "Regression",
    });
  });
});
