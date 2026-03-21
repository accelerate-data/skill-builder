import { ChevronRight } from "lucide-react";
import {
  type Section,
  type Question,
  type SectionStatus,
  getSectionStatus,
  getSectionCounts,
} from "@/lib/clarifications-types";
import type { ReviewFeedback } from "@/lib/clarifications-review";
import { QuestionCard } from "./question-card";
import { RefinementsBlock } from "./refinements";

// ─── Section Block ───────────────────────────────────────────────────────────

export function SectionBlock({
  section, visibleQuestions, isExpanded, toggleSection, expandedCards, toggleCard, updateQuestion, readOnly, reviewFeedbackByQuestion, contradictionSourcesByQuestion,
}: {
  section: Section;
  visibleQuestions: Question[];
  isExpanded: boolean;
  toggleSection: (id: number) => void;
  expandedCards: Set<string>;
  toggleCard: (id: string) => void;
  updateQuestion: (id: string, updater: (q: Question) => Question) => void;
  readOnly: boolean;
  reviewFeedbackByQuestion: Map<string, ReviewFeedback>;
  contradictionSourcesByQuestion: Map<string, string[]>;
}) {
  const status = getSectionStatus(section);
  const { answered, total } = getSectionCounts(section);

  return (
    <div>
      <button
        type="button"
        className="sticky top-0 z-10 mt-6 flex w-full items-center gap-3 px-6 py-2.5 text-left backdrop-blur-sm transition-colors hover:bg-muted/50"
        style={{
          borderTop: "2px solid var(--color-pacific)",
          background: "color-mix(in oklch, var(--color-pacific), transparent 90%)",
        }}
        onClick={() => toggleSection(section.id)}
        aria-expanded={isExpanded}
        aria-controls={`section-content-${section.id}`}
      >
        <ChevronRight
          className="size-3.5 shrink-0 text-muted-foreground transition-transform duration-150"
          style={{ transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)" }}
          aria-hidden="true"
        />
        <span
          className="flex-1 text-sm font-semibold tracking-tight"
          style={{ color: "var(--color-pacific)" }}
        >
          {section.title}
        </span>
        <StatusChip status={status} answered={answered} total={total} />
      </button>

      {isExpanded && (
        <div id={`section-content-${section.id}`}>
          {section.description && (
            <div className="border-b bg-muted/30 px-6 py-2 text-xs text-muted-foreground italic leading-relaxed">
              {section.description}
            </div>
          )}

          {visibleQuestions.map((question) => (
            <QuestionCard
              key={question.id}
              question={question}
              isExpanded={expandedCards.has(question.id)}
              toggleCard={toggleCard}
              updateQuestion={updateQuestion}
              readOnly={readOnly}
              reviewFeedback={reviewFeedbackByQuestion.get(question.id)}
              reviewFeedbackByQuestion={reviewFeedbackByQuestion}
              relatedConflictQuestionIds={contradictionSourcesByQuestion.get(question.id)}
              renderRefinements={(props) => (
                <RefinementsBlock
                  {...props}
                  contradictionSourcesByQuestion={contradictionSourcesByQuestion}
                />
              )}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Status Chip ─────────────────────────────────────────────────────────────

function StatusChip({ status, answered, total }: { status: SectionStatus; answered: number; total: number }) {
  const chipStyles: Record<SectionStatus, { bg: string; border: string; color: string }> = {
    complete: {
      bg: "color-mix(in oklch, var(--color-seafoam), transparent 85%)",
      border: "color-mix(in oklch, var(--color-seafoam), transparent 50%)",
      color: "var(--color-seafoam)",
    },
    partial: {
      bg: "color-mix(in oklch, var(--color-pacific), transparent 85%)",
      border: "color-mix(in oklch, var(--color-pacific), transparent 50%)",
      color: "var(--color-pacific)",
    },
    blocked: {
      bg: "color-mix(in oklch, var(--destructive), transparent 85%)",
      border: "color-mix(in oklch, var(--destructive), transparent 50%)",
      color: "var(--destructive)",
    },
  };
  const s = chipStyles[status];

  return (
    <span
      className="shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-medium"
      style={{ background: s.bg, border: `1px solid ${s.border}`, color: s.color }}
    >
      {answered} / {total} answered
    </span>
  );
}
