import { beforeEach, describe, expect, it } from "vitest";
import { mockInvoke, resetTauriMocks } from "@/test/mocks/tauri";
import {
  createScenario,
  deleteScenario,
  listScenarios,
  loadScenario,
  saveScenario,
  generateEvalScenarioAssertions,
} from "@/lib/eval-workbench";

describe("Eval Workbench Tauri wrappers", () => {
  beforeEach(() => {
    resetTauriMocks();
    mockInvoke.mockResolvedValue(undefined);
  });

  it("lists DB-backed scenarios through the typed workbench contract", async () => {
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
        pluginSlug: "skills",
        skillName: "forecast-skill",
        name: "Regression",
        prompt: "Forecast next quarter revenue",
        assertions: ["Explains the forecast assumptions."],
      },
      "Old regression",
    );

    expect(mockInvoke).toHaveBeenCalledWith("save_scenario", {
      pluginSlug: "skills",
      skillName: "forecast-skill",
      scenario: {
        id: "case-1",
        pluginSlug: "skills",
        skillName: "forecast-skill",
        name: "Regression",
        prompt: "Forecast next quarter revenue",
        assertions: ["Explains the forecast assumptions."],
      },
    });
  });

  it("supports scenario creation, generation, and deletion commands", async () => {
    await Promise.all([
      createScenario("skills", "forecast-skill"),
      generateEvalScenarioAssertions("skills", "forecast-skill", "Regression"),
      deleteScenario("skills", "forecast-skill", "Regression"),
    ]);

    expect(mockInvoke).toHaveBeenCalledWith("create_scenario", {
      pluginSlug: "skills",
      skillName: "forecast-skill",
    });
    expect(mockInvoke).toHaveBeenCalledWith("generate_eval_scenario_assertions", {
      pluginSlug: "skills",
      skillName: "forecast-skill",
      scenarioName: "Regression",
    });
    expect(mockInvoke).toHaveBeenCalledWith("delete_scenario", {
      pluginSlug: "skills",
      skillName: "forecast-skill",
      scenarioName: "Regression",
    });
  });
});
