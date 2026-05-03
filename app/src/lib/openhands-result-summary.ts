/**
 * Result-summary detectors for OpenHands terminal `conversation_state` events.
 *
 * Given a terminal conversation_state with optional `resultText` and
 * `structuredOutput`, produce a one-line human-readable summary suitable for
 * the OutputItem summary line.
 *
 * Detectors run in tier order; first match wins.
 *
 *   Tier 1: research-complete structured output
 *   Tier 2: answer-evaluator verdict structured output
 *   Tier 3: skill-generation success structured output
 *   Tier 4: first non-empty line of `resultText` (capped at 80 chars)
 *   Tier 5: fallback "Run completed"
 *
 * For `error` / `cancelled` terminal status, callers use {@link summarizeErrorRun}
 * instead.
 */

export interface ConversationStateForSummary {
  status: "completed" | "error" | "cancelled" | string;
  resultText?: string;
  structuredOutput?: unknown;
  errorDetail?: string;
}

export interface ResultSummary {
  /** Tier number (1–5) that produced the summary, useful for tests/logs. */
  tier: 1 | 2 | 3 | 4 | 5;
  /** One-line summary string suitable for the OutputItem summary line. */
  summary: string;
}

const MAX_SUMMARY_LEN = 80;
const TRUNCATION_CUTOFF = MAX_SUMMARY_LEN - 3; // 77 + "..."

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function tryResearchComplete(structured: unknown): ResultSummary | null {
  if (!isPlainObject(structured)) {
    return null;
  }
  if (structured.status !== "research_complete") {
    return null;
  }
  const dimensions = structured.dimensions_selected;
  const questions = structured.question_count;
  if (typeof dimensions !== "number" || typeof questions !== "number") {
    return null;
  }
  return {
    tier: 1,
    summary: `Research complete: ${dimensions} dimensions, ${questions} questions`,
  };
}

function tryAnswerEvaluator(structured: unknown): ResultSummary | null {
  if (!isPlainObject(structured)) {
    return null;
  }
  const verdict = structured.verdict;
  const answered = structured.answered_count;
  const total = structured.total_count;
  if (
    typeof verdict !== "string" ||
    verdict.length === 0 ||
    typeof answered !== "number" ||
    typeof total !== "number"
  ) {
    return null;
  }
  return {
    tier: 2,
    summary: `Answers ${verdict}: ${answered}/${total}`,
  };
}

function trySkillGeneration(structured: unknown): ResultSummary | null {
  if (!isPlainObject(structured)) {
    return null;
  }
  const status = structured.status;
  if (status === "skill_updated") {
    return { tier: 3, summary: "Skill updated" };
  }
  if (status === "skill_generated" || status === "generation_complete") {
    return { tier: 3, summary: "Skill generated" };
  }
  return null;
}

function tryResultTextFirstLine(resultText: unknown): ResultSummary | null {
  if (typeof resultText !== "string") {
    return null;
  }
  // Tolerate CRLF line endings.
  const lines = resultText.split(/\r?\n/);
  let firstLine = "";
  for (const raw of lines) {
    const trimmed = raw.trim();
    if (trimmed.length > 0) {
      firstLine = trimmed;
      break;
    }
  }
  if (firstLine.length === 0) {
    return null;
  }
  let summary = firstLine;
  if (summary.length > MAX_SUMMARY_LEN) {
    summary = summary.slice(0, TRUNCATION_CUTOFF) + "...";
  }
  return { tier: 4, summary };
}

/**
 * Produce a one-line summary for a terminal conversation_state with status
 * `completed`. Detectors run in tier order; first match wins.
 *
 * For non-`completed` terminal status, use {@link summarizeErrorRun}.
 */
export function summarizeCompletedRun(
  state: ConversationStateForSummary,
): ResultSummary {
  const tier1 = tryResearchComplete(state.structuredOutput);
  if (tier1) {
    return tier1;
  }
  const tier2 = tryAnswerEvaluator(state.structuredOutput);
  if (tier2) {
    return tier2;
  }
  const tier3 = trySkillGeneration(state.structuredOutput);
  if (tier3) {
    return tier3;
  }
  const tier4 = tryResultTextFirstLine(state.resultText);
  if (tier4) {
    return tier4;
  }
  return { tier: 5, summary: "Run completed" };
}

/**
 * Produce a one-line summary for a terminal conversation_state with status
 * `error` or `cancelled`. Defensively handles unknown terminal statuses.
 */
export function summarizeErrorRun(state: ConversationStateForSummary): {
  summary: string;
} {
  if (state.status === "error") {
    const detail =
      typeof state.errorDetail === "string" ? state.errorDetail.trim() : "";
    if (detail.length > 0) {
      return { summary: `OpenHands failed: ${detail}` };
    }
    return { summary: "OpenHands failed" };
  }
  if (state.status === "cancelled") {
    return { summary: "Cancelled by user" };
  }
  return { summary: "Run ended" };
}
