import type { Note } from "@/lib/clarifications-types";

export type ReviewStatus = "not_answered" | "vague" | "contradictory" | "needs_refinement";

export interface ReviewFeedback {
  status: ReviewStatus;
  questionId: string;
  reason: string;
  contradicts?: string;
}

export const REVIEW_STATUS_LABEL: Record<ReviewStatus, string> = {
  not_answered: "Not answered",
  vague: "Vague",
  contradictory: "Contradictory",
  needs_refinement: "Needs refinement",
};

export const REVIEW_STATUS_COLOR: Record<ReviewStatus, { cssVar?: string; className?: string }> = {
  not_answered: { cssVar: "var(--destructive)" },
  contradictory: { cssVar: "var(--destructive)" },
  vague: { className: "border-amber-500/40 bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400" },
  needs_refinement: { cssVar: "var(--color-pacific)" },
};

export function parseAnswerFeedback(note: Note): ReviewFeedback | null {
  if (note.type !== "answer_feedback") return null;

  const title = note.title.trim();
  const reason = note.body.trim();
  const contradictoryMatch = /^Contradictory answer:\s*(.+)$/i.exec(title);
  if (contradictoryMatch) {
    const contradictsMatch = /conflicts with\s+([A-Za-z]\d+(?:\.\d+[a-z]?)?)/i.exec(reason);
    return {
      status: "contradictory",
      questionId: contradictoryMatch[1].trim(),
      reason,
      contradicts: contradictsMatch?.[1],
    };
  }

  const vagueMatch = /^Vague answer:\s*(.+)$/i.exec(title);
  if (vagueMatch) {
    return { status: "vague", questionId: vagueMatch[1].trim(), reason };
  }

  const unansweredMatch = /^Not answered:\s*(.+)$/i.exec(title);
  if (unansweredMatch) {
    return { status: "not_answered", questionId: unansweredMatch[1].trim(), reason };
  }

  const needsRefinementMatch = /^Needs refinement:\s*(.+)$/i.exec(title);
  if (needsRefinementMatch) {
    return { status: "needs_refinement", questionId: needsRefinementMatch[1].trim(), reason };
  }

  return null;
}

export function getReviewFeedbackMap(notes: Note[]): Map<string, ReviewFeedback> {
  const map = new Map<string, ReviewFeedback>();
  for (const note of notes) {
    const feedback = parseAnswerFeedback(note);
    if (!feedback) continue;
    map.set(feedback.questionId, feedback);
  }
  return map;
}
