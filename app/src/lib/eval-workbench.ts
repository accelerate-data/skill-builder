import { invokeCommand } from "@/lib/tauri";

export type EvalWorkbenchMode = "performance" | "trigger";

export interface EvalPromptCase {
  id: string;
  prompt: string;
  expected: string | null;
  shouldTrigger: boolean | null;
  assertions: unknown[];
  sortOrder: number;
}

export interface EvalPromptSet {
  id: string;
  pluginSlug: string;
  skillName: string;
  mode: EvalWorkbenchMode;
  name: string;
  cases: EvalPromptCase[];
  createdAt: string;
  updatedAt: string;
}

export interface SaveEvalPromptCase {
  id?: string | null;
  prompt: string;
  expected?: string | null;
  shouldTrigger?: boolean | null;
  assertions: unknown[];
  sortOrder?: number | null;
}

export interface SaveEvalPromptSet {
  id?: string | null;
  pluginSlug: string;
  skillName: string;
  mode: EvalWorkbenchMode;
  name: string;
  cases: SaveEvalPromptCase[];
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
  promptSetId: string;
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
  promptSetId: string;
  candidateIds: string[];
}

export interface EvalWorkbenchProgressEvent {
  runId: string;
  phase: string;
  completed: number;
  total: number;
  message: string;
}

export interface SuggestDescriptionCandidatesRequest {
  promptSetId: string;
  baselineDescription: string;
  candidateCount?: number | null;
}

export interface ApplyDescriptionCandidateResponse {
  description: string;
}

export interface RefineImprovementBrief {
  runId: string;
  brief: string;
}

export interface TriggerComparisonMetrics {
  passed: number;
  total: number;
  triggerRecall: number | null;
  falseTriggerRate: number | null;
}

export interface TriggerComparisonEntry {
  candidate: DescriptionCandidate;
  isBaseline: boolean;
  metrics: TriggerComparisonMetrics | null;
}

export const listEvalPromptSets = (
  pluginSlug: string,
  skillName: string,
  mode?: EvalWorkbenchMode | null,
) =>
  invokeCommand("list_eval_prompt_sets", {
    pluginSlug,
    skillName,
    mode: mode ?? null,
  });

export const saveEvalPromptSet = (promptSet: SaveEvalPromptSet) =>
  invokeCommand("save_eval_prompt_set", { promptSet });

export const deleteEvalPromptSet = (promptSetId: string) =>
  invokeCommand("delete_eval_prompt_set", { promptSetId });

export const runEvalWorkbench = (request: RunEvalWorkbenchRequest) =>
  invokeCommand("run_eval_workbench", { request });

export const cancelEvalWorkbenchRun = (runId: string) =>
  invokeCommand("cancel_eval_workbench_run", { runId });

export const listEvalRuns = (
  pluginSlug: string,
  skillName: string,
  mode?: EvalWorkbenchMode | null,
  limit?: number | null,
) =>
  invokeCommand("list_eval_runs", {
    pluginSlug,
    skillName,
    mode: mode ?? null,
    limit: limit ?? null,
  });

export const readEvalRun = (runId: string) =>
  invokeCommand("read_eval_run", { runId });

export const suggestDescriptionCandidates = (
  request: SuggestDescriptionCandidatesRequest,
) => invokeCommand("suggest_description_candidates", { request });

export const applyDescriptionCandidate = (
  pluginSlug: string,
  skillName: string,
  candidateId: string,
) =>
  invokeCommand("apply_description_candidate", {
    pluginSlug,
    skillName,
    candidateId,
  });

export const buildRefineImprovementBrief = (runId: string) =>
  invokeCommand("build_refine_improvement_brief", { runId });

export const DEFAULT_DESCRIPTION_CANDIDATE_COUNT = 3;
export const CURRENT_SKILL_CANDIDATE_ID = "current-skill";
export const PERFORMANCE_CANDIDATE_IDS = ["current-skill"];

export function createEmptyPromptCase(
  mode: EvalWorkbenchMode,
): SaveEvalPromptCase {
  return {
    prompt: "",
    expected: mode === "performance" ? "" : null,
    shouldTrigger: mode === "trigger" ? true : null,
    assertions: [],
    sortOrder: null,
  };
}

export function createDraftPromptSet(
  mode: EvalWorkbenchMode,
  pluginSlug: string,
  skillName: string,
  name = "",
): SaveEvalPromptSet {
  return {
    id: null,
    pluginSlug,
    skillName,
    mode,
    name,
    cases: [createEmptyPromptCase(mode)],
  };
}

export function promptSetToDraft(promptSet: EvalPromptSet): SaveEvalPromptSet {
  return {
    id: promptSet.id,
    pluginSlug: promptSet.pluginSlug,
    skillName: promptSet.skillName,
    mode: promptSet.mode,
    name: promptSet.name,
    cases: promptSet.cases.map((caseItem) => ({
      id: caseItem.id,
      prompt: caseItem.prompt,
      expected: caseItem.expected,
      shouldTrigger: caseItem.shouldTrigger,
      assertions: Array.isArray(caseItem.assertions) ? caseItem.assertions : [],
      sortOrder: caseItem.sortOrder,
    })),
  };
}

export function normalizePromptSet(
  draft: SaveEvalPromptSet,
): SaveEvalPromptSet {
  return {
    ...draft,
    name: draft.name.trim(),
    cases: draft.cases.map((caseItem, index) => ({
      id: caseItem.id ?? null,
      prompt: caseItem.prompt.trim(),
      expected:
        draft.mode === "performance"
          ? (caseItem.expected ?? "").trim()
          : null,
      shouldTrigger:
        draft.mode === "trigger" ? Boolean(caseItem.shouldTrigger) : null,
      assertions: Array.isArray(caseItem.assertions) ? caseItem.assertions : [],
      sortOrder: caseItem.sortOrder ?? index,
    })),
  };
}

export function validatePromptSet(
  draft: SaveEvalPromptSet,
): string | null {
  if (!draft.name.trim()) {
    return "Prompt set name is required.";
  }
  if (draft.cases.length === 0) {
    return "At least one prompt case is required.";
  }
  for (const caseItem of draft.cases) {
    if (!caseItem.prompt.trim()) {
      return "Each prompt case needs a prompt.";
    }
    if (!Array.isArray(caseItem.assertions)) {
      return "Assertions must be an array.";
    }
    if (
      draft.mode === "performance" &&
      !(caseItem.expected ?? "").trim() &&
      caseItem.assertions.length === 0
    ) {
      return "Performance cases need an expected outcome or at least one assertion.";
    }
    if (draft.mode === "trigger" && typeof caseItem.shouldTrigger !== "boolean") {
      return "Trigger cases must mark whether they should trigger.";
    }
  }
  return null;
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

function createBaselineDescriptionCandidate(
  baselineDescription: string,
  runId?: string | null,
): DescriptionCandidate {
  return {
    id: CURRENT_SKILL_CANDIDATE_ID,
    runId: runId ?? "baseline",
    label: "Baseline",
    description: baselineDescription,
    rationale: null,
    rank: null,
  };
}

function summarizeTriggerResults(
  run: EvalRun | null,
  promptCases: EvalPromptCase[],
): Map<string, TriggerComparisonMetrics> {
  if (!run) {
    return new Map();
  }

  const promptCasesById = new Map(
    promptCases.map((caseItem) => [caseItem.id, caseItem]),
  );
  const groupedResults = new Map<string, EvalRunResult[]>();
  for (const result of run.results) {
    const results = groupedResults.get(result.candidateId) ?? [];
    results.push(result);
    groupedResults.set(result.candidateId, results);
  }

  const metricsByCandidateId = new Map<string, TriggerComparisonMetrics>();
  for (const [candidateId, results] of groupedResults) {
    const passed = results.filter((result) => result.passed).length;
    let positiveTotal = 0;
    let positivePassed = 0;
    let negativeTotal = 0;
    let falseTriggers = 0;

    for (const result of results) {
      const promptCase = promptCasesById.get(result.caseId);
      if (!promptCase) {
        continue;
      }
      if (promptCase.shouldTrigger === true) {
        positiveTotal += 1;
        if (result.passed) {
          positivePassed += 1;
        }
      } else if (promptCase.shouldTrigger === false) {
        negativeTotal += 1;
        if (!result.passed) {
          falseTriggers += 1;
        }
      }
    }

    metricsByCandidateId.set(candidateId, {
      passed,
      total: results.length,
      triggerRecall:
        positiveTotal > 0 ? positivePassed / positiveTotal : null,
      falseTriggerRate:
        negativeTotal > 0 ? falseTriggers / negativeTotal : null,
    });
  }

  return metricsByCandidateId;
}

function compareDescendingMetric(
  left: number | null,
  right: number | null,
): number {
  const leftValue = left ?? Number.NEGATIVE_INFINITY;
  const rightValue = right ?? Number.NEGATIVE_INFINITY;
  return rightValue - leftValue;
}

function compareAscendingMetric(
  left: number | null,
  right: number | null,
): number {
  const leftValue = left ?? Number.POSITIVE_INFINITY;
  const rightValue = right ?? Number.POSITIVE_INFINITY;
  return leftValue - rightValue;
}

function compareTriggerEntries(
  left: TriggerComparisonEntry,
  right: TriggerComparisonEntry,
): number {
  const leftMetrics = left.metrics;
  const rightMetrics = right.metrics;
  if (!leftMetrics && !rightMetrics) {
    return 0;
  }
  if (!leftMetrics) {
    return 1;
  }
  if (!rightMetrics) {
    return -1;
  }

  const passDelta = rightMetrics.passed - leftMetrics.passed;
  if (passDelta !== 0) {
    return passDelta;
  }

  const recallDelta = compareDescendingMetric(
    leftMetrics.triggerRecall,
    rightMetrics.triggerRecall,
  );
  if (recallDelta !== 0) {
    return recallDelta;
  }

  const falseTriggerDelta = compareAscendingMetric(
    leftMetrics.falseTriggerRate,
    rightMetrics.falseTriggerRate,
  );
  if (falseTriggerDelta !== 0) {
    return falseTriggerDelta;
  }

  if (left.isBaseline !== right.isBaseline) {
    return left.isBaseline ? -1 : 1;
  }

  return left.candidate.description.length - right.candidate.description.length;
}

export function buildTriggerComparisonEntries(
  baselineDescription: string,
  candidates: DescriptionCandidate[],
  run: EvalRun | null,
  promptCases: EvalPromptCase[],
): TriggerComparisonEntry[] {
  const hasComparisonCandidates =
    candidates.length > 0 ||
    (run?.descriptionCandidates.length ?? 0) > 0 ||
    run?.results.length;
  if (!hasComparisonCandidates) {
    return [];
  }

  const baselineCandidate = createBaselineDescriptionCandidate(
    baselineDescription,
    run?.id,
  );
  const comparisonCandidates = [
    baselineCandidate,
    ...candidates.filter(
      (candidate) => candidate.id !== CURRENT_SKILL_CANDIDATE_ID,
    ),
  ];
  const metricsByCandidateId = summarizeTriggerResults(run, promptCases);

  return comparisonCandidates.map((candidate) => ({
    candidate,
    isBaseline: candidate.id === CURRENT_SKILL_CANDIDATE_ID,
    metrics: metricsByCandidateId.get(candidate.id) ?? null,
  }));
}

export function getRecommendedCandidate(
  baselineDescription: string,
  candidates: DescriptionCandidate[],
  run: EvalRun | null,
  promptCases: EvalPromptCase[],
): DescriptionCandidate | null {
  if (!run || run.results.length === 0) {
    return null;
  }

  return (
    [...buildTriggerComparisonEntries(baselineDescription, candidates, run, promptCases)]
      .sort(compareTriggerEntries)[0]?.candidate ?? null
  );
}

export function buildTriggerCandidateIds(
  candidates: DescriptionCandidate[],
): string[] {
  if (candidates.length === 0) {
    return [];
  }

  return candidates
    .map((candidate) => candidate.id)
    .filter((candidateId, index, candidateIds) => {
      return (
        candidateId !== CURRENT_SKILL_CANDIDATE_ID &&
        candidateIds.indexOf(candidateId) === index
      );
    });
}

export function getRunCandidateIds(run: EvalRun | null): string[] {
  if (!run) {
    return [];
  }

  if (run.mode === "trigger") {
    const resultCandidateIds = Array.from(
      new Set(run.results.map((result) => result.candidateId)),
    ).filter((candidateId) => candidateId !== CURRENT_SKILL_CANDIDATE_ID);
    if (resultCandidateIds.length > 0) {
      return resultCandidateIds;
    }

    return buildTriggerCandidateIds(run.descriptionCandidates);
  }

  return run.descriptionCandidates.map((candidate) => candidate.id);
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
