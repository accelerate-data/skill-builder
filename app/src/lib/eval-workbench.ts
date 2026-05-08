import { invokeCommand } from "@/lib/tauri";

export type ScenarioTag = "performance";

export interface Scenario {
  id: string;
  name: string;
  prompt: string;
  assertions: string[];
  tags?: ScenarioTag[];
}

export interface ScenarioSummary {
  name: string;
  prompt?: string;
  tags?: ScenarioTag[];
}

export type ScenarioDto = Scenario;
export type ScenarioListItem = ScenarioSummary;
export type SaveScenario = Scenario;

export function scenarioNameSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export const listScenarios = (pluginSlug: string, skillName: string) =>
  invokeCommand("list_scenarios", { pluginSlug, skillName });

export const loadScenario = (
  pluginSlug: string,
  skillName: string,
  scenarioName: string,
) =>
  invokeCommand("load_scenario", {
    pluginSlug,
    skillName,
    scenarioName,
  });

export const createScenario = (
  pluginSlug: string,
  skillName: string,
) =>
  invokeCommand("create_scenario", {
    pluginSlug,
    skillName,
  });

export const saveScenario = (
  pluginSlug: string,
  skillName: string,
  scenario: SaveScenario,
  previousScenarioName?: string | null,
) =>
  invokeCommand("save_scenario", {
    pluginSlug,
    skillName,
    scenario,
    previousScenarioName: previousScenarioName ?? null,
  });

export const deleteScenario = (
  pluginSlug: string,
  skillName: string,
  scenarioName: string,
) => invokeCommand("delete_scenario", { pluginSlug, skillName, scenarioName });

export const defineEvalScenario = (
  pluginSlug: string,
  skillName: string,
  scenarioName: string,
) =>
  invokeCommand("define_eval_scenario", {
    pluginSlug,
    skillName,
    scenarioName,
  });

export function createDraftScenario(name = ""): SaveScenario {
  return {
    id: `case-${crypto.randomUUID().slice(0, 8)}`,
    name,
    prompt: "",
    assertions: [],
    tags: ["performance"],
  };
}

export function scenarioToDraft(scenario: Scenario): SaveScenario {
  return {
    id: scenario.id,
    name: scenario.name,
    prompt: scenario.prompt,
    assertions: Array.isArray(scenario.assertions)
      ? scenario.assertions
      : [],
    ...(scenario.tags ? { tags: [...scenario.tags] } : {}),
  };
}

export function normalizeScenario(draft: SaveScenario): SaveScenario {
  return {
    id: draft.id || `case-${crypto.randomUUID().slice(0, 8)}`,
    name: draft.name.trim(),
    prompt: draft.prompt.trim(),
    assertions: Array.isArray(draft.assertions)
      ? draft.assertions.map((assertion) => assertion.trim())
      : [],
    ...(draft.tags && draft.tags.length > 0
      ? { tags: Array.from(new Set(draft.tags)) }
      : {}),
  };
}

export function validateScenario(draft: SaveScenario): string | null {
  if (!draft.name.trim()) {
    return "Scenario name is required.";
  }
  if (!Array.isArray(draft.assertions)) {
    return "Assertions must be an array.";
  }
  return null;
}

export function validateScenarioForEvaluation(draft: SaveScenario): string | null {
  if (!draft.prompt.trim()) {
    return "Scenario prompt is required.";
  }
  if (
    !Array.isArray(draft.assertions) ||
    draft.assertions.filter((assertion) => assertion.trim().length > 0)
      .length === 0
  ) {
    return "Performance scenarios need at least one assertion.";
  }
  return null;
}

export function areScenariosEqual(
  left: ScenarioDto | null,
  right: SaveScenario | null,
): boolean {
  if (!left && !right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  return JSON.stringify(normalizeScenario(left)) === JSON.stringify(normalizeScenario(right));
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
