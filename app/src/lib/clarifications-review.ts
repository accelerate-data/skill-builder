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
