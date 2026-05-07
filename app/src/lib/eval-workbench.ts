import { invokeCommand } from "@/lib/tauri";

export type EvalWorkbenchMode = "performance" | "trigger";
export type ScenarioTag = "performance" | "trigger" | "both";

export interface Scenario {
  id: string;
  name: string;
  prompt: string;
  expectations: string[];
  tags?: ScenarioTag[];
  shouldTrigger?: boolean | null;
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

export interface EvalRunResult {
  id: string;
  runId: string;
  caseId: string;
  candidateId: string;
  passed: boolean;
  score: number;
  output: unknown;
  reason: string | null;
}

export interface DescriptionCandidate {
  id: string;
  runId: string;
  label: string;
  description: string;
  rationale: string | null;
  rank: number | null;
}

export interface EvalRun {
  id: string;
  scenarioName: string;
  mode: EvalWorkbenchMode;
  status: string;
  summary: Record<string, unknown>;
  createdAt: string;
  completedAt: string | null;
  results: EvalRunResult[];
  descriptionCandidates: DescriptionCandidate[];
}

export interface RunEvalWorkbenchRequest {
  runId: string;
  pluginSlug: string;
  skillName: string;
  scenarioName?: string | null;
  mode: EvalWorkbenchMode;
  candidateIds: string[];
}

export interface EvalWorkbenchProgressEvent {
  runId: string;
  phase: string;
  completed: number;
  total: number;
  message: string;
}

export interface RefineImprovementBrief {
  runId: string;
  brief: string;
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
  mode: EvalWorkbenchMode,
) =>
  invokeCommand("create_scenario", {
    pluginSlug,
    skillName,
    mode,
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

export const generateScenarios = (pluginSlug: string, skillName: string) =>
  invokeCommand("generate_scenarios", { pluginSlug, skillName });

export const runEvalWorkbench = (request: RunEvalWorkbenchRequest) =>
  invokeCommand("run_eval_workbench", { request });

export const cancelEvalWorkbenchRun = (runId: string) =>
  invokeCommand("cancel_eval_workbench_run", { runId });

export const listEvalRuns = (
  pluginSlug: string,
  skillName: string,
  mode?: EvalWorkbenchMode | null,
  limit?: number | null,
  scenarioName?: string | null,
) =>
  invokeCommand("list_eval_runs", {
    pluginSlug,
    skillName,
    mode: mode ?? null,
    limit: limit ?? null,
    scenarioName: scenarioName ?? null,
  });

export const readEvalRun = (runId: string) =>
  invokeCommand("read_eval_run", { runId });

export const buildRefineImprovementBrief = (runId: string) =>
  invokeCommand("build_refine_improvement_brief", { runId });

export const PERFORMANCE_CANDIDATE_IDS = ["current-skill"];

export function createDraftScenario(
  mode: EvalWorkbenchMode = "performance",
  _pluginSlug = "",
  _skillName = "",
  name = "",
): SaveScenario {
  return {
    id: `case-${crypto.randomUUID().slice(0, 8)}`,
    name,
    prompt: "",
    expectations: [],
    ...(mode === "trigger" ? { tags: ["trigger"] as ScenarioTag[], shouldTrigger: true } : {}),
  };
}

export function scenarioSupportsMode(
  scenario: Pick<Scenario, "tags">,
  mode: EvalWorkbenchMode,
): boolean {
  const tags = scenario.tags ?? ["performance"];
  return tags.includes("both") || tags.includes(mode);
}

export function scenarioToDraft(scenario: Scenario): SaveScenario {
  return {
    id: scenario.id,
    name: scenario.name,
    prompt: scenario.prompt,
    expectations: Array.isArray(scenario.expectations)
      ? scenario.expectations
      : [],
    ...(scenario.tags ? { tags: [...scenario.tags] } : {}),
    ...(typeof scenario.shouldTrigger !== "undefined"
      ? { shouldTrigger: scenario.shouldTrigger }
      : {}),
  };
}

export function normalizeScenario(draft: SaveScenario): SaveScenario {
  return {
    id: draft.id || `case-${crypto.randomUUID().slice(0, 8)}`,
    name: draft.name.trim(),
    prompt: draft.prompt.trim(),
    expectations: Array.isArray(draft.expectations)
      ? draft.expectations.map((expectation) => expectation.trim())
      : [],
    ...(draft.tags && draft.tags.length > 0
      ? { tags: Array.from(new Set(draft.tags)) }
      : {}),
    ...(typeof draft.shouldTrigger === "boolean"
      ? { shouldTrigger: draft.shouldTrigger }
      : {}),
  };
}

export function validateScenario(
  draft: SaveScenario,
  mode?: EvalWorkbenchMode,
): string | null {
  if (!draft.name.trim()) {
    return "Scenario name is required.";
  }
  if (!Array.isArray(draft.expectations)) {
    return "Expectations must be an array.";
  }
  if (mode && !scenarioSupportsMode(draft, mode)) {
    return `This scenario is not tagged for ${mode} mode.`;
  }
  return null;
}

export function validateScenarioForEvaluation(
  draft: SaveScenario,
  mode?: EvalWorkbenchMode,
): string | null {
  if (!draft.prompt.trim()) {
    return "Scenario prompt is required.";
  }
  if (
    !Array.isArray(draft.expectations) ||
    draft.expectations.filter((expectation) => expectation.trim().length > 0)
      .length === 0
  ) {
    return "Performance scenarios need at least one expectation.";
  }
  if (
    mode === "trigger" &&
    scenarioSupportsMode(draft, "trigger") &&
    typeof draft.shouldTrigger !== "boolean"
  ) {
    return "Trigger scenarios must mark whether they should trigger.";
  }
  if (mode && !scenarioSupportsMode(draft, mode)) {
    return `This scenario is not tagged for ${mode} mode.`;
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

export function summarizeRun(run: EvalRun): {
  passed: number;
  total: number;
  failed: number;
} {
  const total = run.results.length;
  const passed = run.results.filter((result) => result.passed).length;
  return { passed, total, failed: total - passed };
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
