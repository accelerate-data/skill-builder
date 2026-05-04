import type { EvalCaseResult, EvalMode, EvalRunResult } from "./protocol.js";

export type PromptfooLikeResult = {
  vars?: Record<string, unknown>;
  testCase?: {
    vars?: Record<string, unknown>;
  };
  provider?: {
    id?: string;
  };
  success?: boolean;
  score?: number;
  response?: {
    output?: unknown;
    text?: string;
  };
  failureReason?: string | number;
  namedScores?: Record<string, number>;
};

export function normalizePromptfooResults(
  mode: EvalMode,
  rawResults: PromptfooLikeResult[],
): EvalRunResult {
  const results = rawResults.map(normalizePromptfooResult);
  const passed = results.filter((result) => result.passed).length;

  return {
    mode,
    total: results.length,
    passed,
    failed: results.length - passed,
    results,
  };
}

export function normalizePromptfooResult(
  rawResult: PromptfooLikeResult,
): EvalCaseResult {
  const vars = rawResult.vars ?? rawResult.testCase?.vars ?? {};
  const caseId = readRequiredString(vars.caseId, "caseId");
  const candidateId = readRequiredString(
    rawResult.provider?.id ?? vars.candidateId,
    "candidateId",
  );
  const score = normalizeScore(rawResult);
  const passed = rawResult.success ?? score >= 1;

  return {
    caseId,
    candidateId,
    passed,
    score,
    output: rawResult.response?.output ?? rawResult.response?.text ?? null,
    ...(rawResult.failureReason !== undefined &&
    rawResult.failureReason !== null &&
    String(rawResult.failureReason).length > 0
      ? { reason: String(rawResult.failureReason) }
      : {}),
  };
}

function normalizeScore(rawResult: PromptfooLikeResult): number {
  if (typeof rawResult.score === "number" && Number.isFinite(rawResult.score)) {
    return rawResult.score;
  }

  const namedScores = rawResult.namedScores ?? {};
  const scores = Object.values(namedScores).filter(
    (score): score is number =>
      typeof score === "number" && Number.isFinite(score),
  );

  if (scores.length === 0) {
    return rawResult.success ? 1 : 0;
  }

  return scores.reduce((sum, score) => sum + score, 0) / scores.length;
}

function readRequiredString(
  value: unknown,
  field: "caseId" | "candidateId",
): string {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  throw new Error(`Promptfoo result missing ${field}`);
}
