import { useRef, useEffect, type CSSProperties } from "react";
import { ChevronRight } from "lucide-react";
import {
  type Question,
  type Choice,
  isQuestionAnswered,
  parseRecommendedChoiceId,
} from "@/lib/clarifications-types";
import {
  type ReviewStatus,
  type ReviewFeedback,
  REVIEW_STATUS_LABEL,
  REVIEW_STATUS_COLOR,
} from "@/lib/clarifications-review";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeAnswerUpdater(text: string): (q: Question) => Question {
  return (q) => ({
    ...q,
    answer_text: text,
    answer_choice: text.trim() !== "" ? (q.answer_choice ?? "custom") : null,
  });
}

// ─── Question Card ───────────────────────────────────────────────────────────

export function QuestionCard({
  question,
  isExpanded,
  toggleCard,
  updateQuestion,
  readOnly,
  reviewFeedback,
  reviewFeedbackByQuestion,
  relatedConflictQuestionIds,
  renderRefinements,
}: {
  question: Question;
  isExpanded: boolean;
  toggleCard: (id: string) => void;
  updateQuestion: (id: string, updater: (q: Question) => Question) => void;
  readOnly: boolean;
  reviewFeedback?: ReviewFeedback;
  reviewFeedbackByQuestion: Map<string, ReviewFeedback>;
  relatedConflictQuestionIds?: string[];
  renderRefinements: (props: {
    refinements: Question[];
    updateQuestion: (id: string, updater: (q: Question) => Question) => void;
    readOnly: boolean;
    reviewFeedbackByQuestion: Map<string, ReviewFeedback>;
  }) => React.ReactNode;
}) {
  const answered = isQuestionAnswered(question);
  const accentColorByStatus: Record<ReviewStatus, string> = {
    not_answered: "var(--destructive)",
    contradictory: "var(--destructive)",
    vague: "oklch(0.769 0.188 70.08)",
    needs_refinement: "var(--color-pacific)",
  };
  const cardAccentColor = reviewFeedback
    ? accentColorByStatus[reviewFeedback.status]
    : (answered ? "var(--color-pacific)" : "var(--border)");

  return (
    <div
      className="mx-6 mt-3 overflow-hidden rounded-lg border shadow-sm transition-shadow duration-150 hover:shadow"
      style={{
        borderLeftWidth: "3px",
        borderLeftColor: cardAccentColor,
      }}
    >
      {/* Header */}
      <button
        type="button"
        className="flex w-full cursor-pointer items-start gap-3 bg-muted/40 px-4 py-3 text-left select-none transition-colors duration-150 hover:bg-muted/70"
        onClick={() => toggleCard(question.id)}
      >
        <span className="mt-0.5 shrink-0 font-mono text-[11px] font-medium text-muted-foreground tabular-nums">
          {question.id}
        </span>
        <span className="flex-1 text-sm font-semibold leading-snug tracking-tight text-foreground">
          {question.title}
        </span>
        {reviewFeedback && <ReviewStatusBadge status={reviewFeedback.status} />}
        {!reviewFeedback && relatedConflictQuestionIds && relatedConflictQuestionIds.length > 0 && (
          <RelatedConflictBadge relatedQuestionIds={relatedConflictQuestionIds} />
        )}
        {question.must_answer && <MustBadge />}
        <ChevronRight
          className="mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform duration-150"
          style={{ transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)" }}
        />
      </button>

      {/* Collapsed preview */}
      {!isExpanded && (
        <div className="flex items-center gap-2 bg-muted/40 px-4 pb-2.5">
          {answered ? (
            <span
              className="flex-1 truncate text-xs italic"
              style={{ color: "var(--color-pacific)" }}
            >
              {question.answer_text || `Choice ${question.answer_choice}`}
            </span>
          ) : (
            <span className="text-xs italic text-muted-foreground">
              Not yet answered
            </span>
          )}
        </div>
      )}

      {/* Expanded body */}
      {isExpanded && (
        <div className="border-t bg-card p-4">
          <p className="mb-3 text-sm leading-relaxed text-foreground/90">
            {question.text}
          </p>
          {reviewFeedback && <ReviewFeedbackCallout feedback={reviewFeedback} />}
          {!reviewFeedback && relatedConflictQuestionIds && relatedConflictQuestionIds.length > 0 && (
            <RelatedConflictCallout relatedQuestionIds={relatedConflictQuestionIds} />
          )}

          {(question.choices ?? []).length > 0 && (
            <ChoiceList
              choices={question.choices ?? []}
              selectedId={question.answer_choice ?? null}
              recommendedId={parseRecommendedChoiceId(question.recommendation)}
              onSelect={(choiceId, choiceText) => {
                if (readOnly) return;
                updateQuestion(question.id, (q) => ({
                  ...q,
                  answer_choice: choiceId,
                  answer_text: choiceText,
                }));
              }}
            />
          )}

          {question.consolidated_from && question.consolidated_from.length > 0 && (
            <p className="mb-2 text-[11px] italic text-muted-foreground">
              Consolidated from: {question.consolidated_from.join(", ")}
            </p>
          )}

          {(question.answer_choice != null || (question.choices ?? []).length === 0) && (
            <AnswerField
              value={question.answer_text ?? ""}
              onChange={(text) => {
                if (readOnly) return;
                updateQuestion(question.id, makeAnswerUpdater(text));
              }}
              readOnly={readOnly}
            />
          )}

          {(question.refinements ?? []).length > 0 &&
            renderRefinements({
              refinements: question.refinements ?? [],
              updateQuestion,
              readOnly,
              reviewFeedbackByQuestion,
            })}
        </div>
      )}
    </div>
  );
}

// ─── Badges ──────────────────────────────────────────────────────────────────

function MustBadge() {
  return (
    <span className="shrink-0 rounded border border-destructive/40 bg-destructive/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-destructive">
      must
    </span>
  );
}

// ─── Choice List ─────────────────────────────────────────────────────────────

export function ChoiceList({
  choices, selectedId, recommendedId, onSelect,
}: {
  choices: Choice[];
  selectedId: string | null;
  recommendedId?: string | null;
  onSelect: (id: string, text: string) => void;
}) {
  return (
    <div className="mb-3 flex flex-col gap-1">
      {choices.map((choice) => {
        const isSelected = selectedId === choice.id;
        const isRecommended = recommendedId === choice.id;
        return (
          <button
            type="button"
            key={choice.id}
            className="flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 text-left text-xs leading-snug transition-all duration-150"
            style={{
              background: isSelected
                ? "color-mix(in oklch, var(--color-pacific), transparent 88%)"
                : "transparent",
              borderColor: isSelected
                ? "color-mix(in oklch, var(--color-pacific), transparent 50%)"
                : isRecommended
                  ? "color-mix(in oklch, var(--color-seafoam), transparent 60%)"
                  : "transparent",
              color: isSelected ? "var(--color-pacific)" : "var(--muted-foreground)",
            }}
            onClick={() => onSelect(choice.id, choice.is_other ? "" : choice.text)}
          >
            <span
              className="mt-px shrink-0 font-mono text-[11px] font-semibold tabular-nums"
              style={{ color: isSelected ? "var(--color-pacific)" : "var(--muted-foreground)" }}
            >
              {choice.id}.
            </span>
            <span className="flex-1">{choice.text}</span>
            {isRecommended && (
              <span
                className="shrink-0 self-center rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                style={{
                  background: "color-mix(in oklch, var(--color-seafoam), transparent 85%)",
                  color: "var(--color-seafoam)",
                }}
              >
                recommended
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ─── Answer Field ────────────────────────────────────────────────────────────

export function AnswerField({
  value, onChange, readOnly, compact = false,
}: {
  value: string;
  onChange: (text: string) => void;
  readOnly: boolean;
  compact?: boolean;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <div className="mt-1 overflow-hidden rounded-md border border-input transition-colors duration-150 focus-within:border-ring focus-within:ring-[2px] focus-within:ring-ring/20">
      {!compact && (
        <div
          className="flex items-center justify-between border-b bg-muted/50 px-3 py-1.5 font-mono text-[11px] font-medium uppercase tracking-wide"
          style={{ color: "var(--color-pacific)" }}
        >
          Answer
          <span className="font-normal normal-case tracking-normal text-muted-foreground">
            type freely or reference a choice above
          </span>
        </div>
      )}
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        readOnly={readOnly}
        rows={compact ? 1 : 2}
        placeholder={compact ? "Type your answer..." : "Type your answer here..."}
        className="w-full resize-none border-none bg-background px-3 font-sans outline-none placeholder:text-muted-foreground"
        style={{
          padding: compact ? "6px 12px" : "8px 12px",
          fontSize: compact ? "12px" : "13px",
          color: "var(--color-pacific)",
          lineHeight: "1.6",
          minHeight: compact ? "28px" : "36px",
        }}
      />
    </div>
  );
}

// ─── Review Feedback ─────────────────────────────────────────────────────────

export function ReviewFeedbackCallout({ feedback, compact = false }: { feedback: ReviewFeedback; compact?: boolean }) {
  const { cssVar, className: chipClassName } = REVIEW_STATUS_COLOR[feedback.status];

  return (
    <div
      className={`mb-3 rounded-md border px-3 ${compact ? "py-2" : "py-2.5"} text-xs leading-relaxed`}
      style={{
        borderColor: feedback.status === "contradictory"
          ? "color-mix(in oklch, var(--destructive), transparent 55%)"
          : "color-mix(in oklch, var(--color-pacific), transparent 60%)",
        background: feedback.status === "contradictory"
          ? "color-mix(in oklch, var(--destructive), transparent 92%)"
          : "color-mix(in oklch, var(--color-pacific), transparent 92%)",
      }}
    >
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${chipClassName ?? ""}`}
          style={chipClassName
            ? undefined
            : {
              color: cssVar,
              background: `color-mix(in oklch, ${cssVar}, transparent 88%)`,
              border: `1px solid color-mix(in oklch, ${cssVar}, transparent 55%)`,
            }}
        >
          Need Review: {REVIEW_STATUS_LABEL[feedback.status]}
        </span>
        {feedback.contradicts && (
          <span className="rounded-full border px-2 py-0.5 text-[11px] font-medium text-destructive">
            Conflicts with {feedback.contradicts}
          </span>
        )}
      </div>
      <p className="text-muted-foreground">Why flagged: {feedback.reason}</p>
    </div>
  );
}

function ReviewStatusBadge({ status }: { status: ReviewStatus }) {
  const { cssVar, className } = REVIEW_STATUS_COLOR[status];
  const style: CSSProperties | undefined = cssVar
    ? {
      color: cssVar,
      border: `1px solid color-mix(in oklch, ${cssVar}, transparent 50%)`,
      background: `color-mix(in oklch, ${cssVar}, transparent 88%)`,
    }
    : undefined;

  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${className ?? ""}`}
      style={style}
    >
      {REVIEW_STATUS_LABEL[status]}
    </span>
  );
}

function RelatedConflictBadge({ relatedQuestionIds }: { relatedQuestionIds: string[] }) {
  const relatedLabel = relatedQuestionIds.join(", ");

  return (
    <span className="shrink-0 rounded-full border border-destructive/30 bg-destructive/10 px-2 py-0.5 text-[11px] font-medium text-destructive">
      In conflict with {relatedLabel}
    </span>
  );
}

export function RelatedConflictCallout({ relatedQuestionIds, compact = false }: { relatedQuestionIds: string[]; compact?: boolean }) {
  const relatedLabel = relatedQuestionIds.join(", ");

  return (
    <div
      className={`mb-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 ${compact ? "py-2" : "py-2.5"} text-xs leading-relaxed`}
    >
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <span className="rounded-full border border-destructive/30 bg-destructive/10 px-2 py-0.5 text-[11px] font-medium text-destructive">
          Need Review: Conflict counterpart
        </span>
        <span className="rounded-full border border-destructive/30 px-2 py-0.5 text-[11px] font-medium text-destructive">
          Conflicts with {relatedLabel}
        </span>
      </div>
      <p className="text-muted-foreground">
        Another answer in this set conflicts with this response. Review both answers together.
      </p>
    </div>
  );
}
