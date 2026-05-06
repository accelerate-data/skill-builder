import { beforeEach, describe, expect, it } from "vitest";
import { mockInvoke, resetTauriMocks } from "@/test/mocks/tauri";
import {
  buildRefineImprovementBrief,
  createScenario,
  deleteScenario,
  listEvalRuns,
  listScenarios,
  loadScenario,
  readEvalRun,
  runEvalWorkbench,
  saveScenario,
  suggestScenario,
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
        id: "case-1",
        name: "Regression",
        prompt: "Forecast next quarter revenue",
        expectations: ["Explains the forecast assumptions."],
      },
      "Old regression",
    );

    expect(mockInvoke).toHaveBeenCalledWith("save_scenario", {
      pluginSlug: "skills",
      skillName: "forecast-skill",
      scenario: {
        id: "case-1",
        name: "Regression",
        prompt: "Forecast next quarter revenue",
        expectations: ["Explains the forecast assumptions."],
      },
      previousScenarioName: "Old regression",
    });
  });

  it("runs eval workbench requests with scenario names and explicit candidate ids", async () => {
    await runEvalWorkbench({
      runId: "run-1",
      pluginSlug: "skills",
      skillName: "forecast-skill",
      mode: "performance",
      candidateIds: ["current-skill"],
    });

    expect(mockInvoke).toHaveBeenCalledWith("run_eval_workbench", {
      request: {
        runId: "run-1",
        pluginSlug: "skills",
        skillName: "forecast-skill",
        mode: "performance",
        candidateIds: ["current-skill"],
      },
    });
  });

  it("supports scenario creation, scenario suggestion, candidate generation, apply, history, and deletion commands", async () => {
    await Promise.all([
      createScenario("skills", "forecast-skill", "performance"),
      listEvalRuns("skills", "forecast-skill", "performance", 20, "Package"),
      readEvalRun("run-1"),
      suggestScenario("skills", "forecast-skill", "Regression"),
      buildRefineImprovementBrief("run-1"),
      deleteScenario("skills", "forecast-skill", "Regression"),
    ]);

    expect(mockInvoke).toHaveBeenCalledWith("create_scenario", {
      pluginSlug: "skills",
      skillName: "forecast-skill",
      mode: "performance",
    });
    expect(mockInvoke).toHaveBeenCalledWith("list_eval_runs", {
      pluginSlug: "skills",
      skillName: "forecast-skill",
      mode: "performance",
      limit: 20,
      scenarioName: "Package",
    });
    expect(mockInvoke).toHaveBeenCalledWith("read_eval_run", { runId: "run-1" });
    expect(mockInvoke).toHaveBeenCalledWith("suggest_scenario", {
      pluginSlug: "skills",
      skillName: "forecast-skill",
      scenarioName: "Regression",
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
