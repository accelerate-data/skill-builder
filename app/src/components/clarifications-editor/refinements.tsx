import type { Question } from "@/lib/clarifications-types";
import { isQuestionAnswered, parseRecommendedChoiceId } from "@/lib/clarifications-types";
import type { ReviewFeedback } from "@/lib/clarifications-review";
import { ChoiceList, AnswerField, ReviewFeedbackCallout, RelatedConflictCallout } from "./question-card";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeAnswerUpdater(text: string): (q: Question) => Question {
  return (q) => ({
    ...q,
    answer_text: text,
    answer_choice: text.trim() !== "" ? (q.answer_choice ?? "custom") : null,
  });
}

// ─── Refinements Block ───────────────────────────────────────────────────────

export function RefinementsBlock({
  refinements, updateQuestion, readOnly, reviewFeedbackByQuestion, contradictionSourcesByQuestion,
}: {
  refinements: Question[];
  updateQuestion: (id: string, updater: (q: Question) => Question) => void;
  readOnly: boolean;
  reviewFeedbackByQuestion: Map<string, ReviewFeedback>;
  contradictionSourcesByQuestion: Map<string, string[]>;
}) {
  return (
    <div
      className="mt-3 ml-4 overflow-hidden rounded-r-lg border"
      style={{
        borderLeftWidth: "2px",
        borderLeftColor: "var(--color-ocean)",
      }}
    >
      <div
        className="border-b px-3 py-1.5 font-mono text-[11px] font-medium uppercase tracking-widest"
        style={{
          background: "color-mix(in oklch, var(--color-ocean), transparent 90%)",
          color: "var(--color-ocean)",
        }}
      >
        Refinements
      </div>
      {refinements.map((ref) => (
        <RefinementItem
          key={ref.id}
          refinement={ref}
          updateQuestion={updateQuestion}
          readOnly={readOnly}
          reviewFeedback={reviewFeedbackByQuestion.get(ref.id)}
          relatedConflictQuestionIds={contradictionSourcesByQuestion.get(ref.id)}
        />
      ))}
    </div>
  );
}

// ─── Refinement Item ─────────────────────────────────────────────────────────

function RefinementItem({
  refinement, updateQuestion, readOnly, reviewFeedback, relatedConflictQuestionIds,
}: {
  refinement: Question;
  updateQuestion: (id: string, updater: (q: Question) => Question) => void;
  readOnly: boolean;
  reviewFeedback?: ReviewFeedback;
  relatedConflictQuestionIds?: string[];
}) {
  const answered = isQuestionAnswered(refinement);

  return (
    <div
      className="border-b p-3 last:border-b-0"
      style={{
        borderLeftWidth: "2px",
        borderLeftColor: answered ? "var(--color-pacific)" : "color-mix(in oklch, var(--color-ocean), transparent 50%)",
        marginLeft: "-2px",
      }}
    >
      <div
        className="mb-1 font-mono text-[11px] font-medium"
        style={{ color: "var(--color-ocean)" }}
      >
        {refinement.id}
      </div>
      <div className="mb-2 text-xs font-semibold leading-snug text-foreground">
        {refinement.title}
        {refinement.text && refinement.text !== refinement.title && (
          <span className="font-normal text-muted-foreground">
            {" "}&mdash; {refinement.text}
          </span>
        )}
      </div>
      {reviewFeedback && <ReviewFeedbackCallout feedback={reviewFeedback} compact />}
      {!reviewFeedback && relatedConflictQuestionIds && relatedConflictQuestionIds.length > 0 && (
        <RelatedConflictCallout relatedQuestionIds={relatedConflictQuestionIds} compact />
      )}
      {refinement.choices.length > 0 && (
        <ChoiceList
          choices={refinement.choices}
          selectedId={refinement.answer_choice}
          recommendedId={parseRecommendedChoiceId(refinement.recommendation)}
          onSelect={(choiceId, choiceText) => {
            if (readOnly) return;
            updateQuestion(refinement.id, (q) => ({
              ...q,
              answer_choice: choiceId,
              answer_text: choiceText,
            }));
          }}
        />
      )}
      {(refinement.answer_choice !== null || refinement.choices.length === 0) && (
        <AnswerField
          value={refinement.answer_text ?? ""}
          onChange={(text) => {
            if (readOnly) return;
            updateQuestion(refinement.id, makeAnswerUpdater(text));
          }}
          readOnly={readOnly}
          compact
        />
      )}
    </div>
  );
}
