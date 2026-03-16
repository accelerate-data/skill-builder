import type { Note } from "@/lib/clarifications-types";
import type { AnswerEvaluationOutput } from "@/lib/types";

/**
 * Build feedback notes from an answer evaluation's per-question verdicts.
 * Filters to actionable verdicts (vague, contradictory, not_answered, needs_refinement)
 * and maps each to a typed Note for the clarifications editor.
 *
 * Extracted from use-workflow-state-machine.ts for independent testability.
 */
export function buildGateFeedbackNotes(evaluation: AnswerEvaluationOutput): Note[] {
  const perQuestion = evaluation.per_question ?? [];
  const optionalReason = (q: (typeof perQuestion)[number]): string | null =>
    "reason" in q && typeof q.reason === "string" && q.reason.trim().length > 0
      ? q.reason.trim()
      : null;

  return perQuestion
    .filter(
      (q) =>
        q.verdict === "vague" ||
        q.verdict === "contradictory" ||
        q.verdict === "not_answered" ||
        q.verdict === "needs_refinement"
    )
    .map((q) => {
      if (q.verdict === "contradictory") {
        const fallback = `This answer conflicts with ${q.contradicts}.`;
        return {
          type: "answer_feedback",
          title: `Contradictory answer: ${q.question_id}`,
          body: optionalReason(q) || fallback,
        };
      }
      if (q.verdict === "not_answered") {
        return {
          type: "answer_feedback",
          title: `Not answered: ${q.question_id}`,
          body:
            optionalReason(q) ||
            "This question is still unanswered. Add a concrete answer before continuing.",
        };
      }
      if (q.verdict === "needs_refinement") {
        return {
          type: "answer_feedback",
          title: `Needs refinement: ${q.question_id}`,
          body:
            optionalReason(q) ||
            "Answer has useful direction but needs more concrete detail and constraints.",
        };
      }
      return {
        type: "answer_feedback",
        title: `Vague answer: ${q.question_id}`,
        body: optionalReason(q) || "Answer is too general and needs specific details.",
      };
    });
}
