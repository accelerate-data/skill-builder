import { useState, useCallback, useRef, useEffect, useMemo, type CSSProperties } from "react";
import { ChevronRight, AlertTriangle, Info, RotateCcw, Check, Loader2, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  type ClarificationsFile,
  type Section,
  type Question,
  type Choice,
  type Note,
  type SectionStatus,
  getSectionStatus,
  getSectionCounts,
  getTotalCounts,
  isQuestionAnswered,
  parseRecommendedChoiceId,
} from "@/lib/clarifications-types";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeAnswerUpdater(text: string): (q: Question) => Question {
  return (q) => ({
    ...q,
    answer_text: text,
    answer_choice: text.trim() !== "" ? (q.answer_choice ?? "custom") : null,
  });
}

function isWarnNote(type: string): boolean {
  return type === "blocked" || type === "critical_gap";
}

function resolveNoteIcon(type: string): typeof AlertTriangle {
  if (isWarnNote(type)) return AlertTriangle;
  return Info;
}

type ReviewStatus = "not_answered" | "vague" | "contradictory" | "needs_refinement";

interface ReviewFeedback {
  status: ReviewStatus;
  questionId: string;
  reason: string;
  contradicts?: string;
}

const REVIEW_STATUS_LABEL: Record<ReviewStatus, string> = {
  not_answered: "Not answered",
  vague: "Vague",
  contradictory: "Contradictory",
  needs_refinement: "Needs refinement",
};

function parseAnswerFeedback(note: Note): ReviewFeedback | null {
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

function getReviewFeedbackMap(notes: Note[]): Map<string, ReviewFeedback> {
  const map = new Map<string, ReviewFeedback>();
  for (const note of notes) {
    const feedback = parseAnswerFeedback(note);
    if (!feedback) continue;
    map.set(feedback.questionId, feedback);
  }
  return map;
}

// ─── Props ────────────────────────────────────────────────────────────────────

export type SaveStatus = "idle" | "dirty" | "saving" | "saved";

interface ClarificationsEditorProps {
  data: ClarificationsFile;
  onChange: (updated: ClarificationsFile) => void;
  onReload?: () => void;
  onContinue?: () => void;
  onReset?: () => void;
  readOnly?: boolean;
  filePath?: string;
  saveStatus?: SaveStatus;
  evaluating?: boolean;
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function ClarificationsEditor({
  data,
  onChange,
  onReload,
  onContinue,
  onReset,
  readOnly = false,
  filePath,
  saveStatus = "idle",
  evaluating = false,
}: ClarificationsEditorProps) {
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());
  const [expandedSections, setExpandedSections] = useState<Set<number>>(() => new Set(data.sections.map((section) => section.id)));
  const [notesExpanded, setNotesExpanded] = useState(true);
  const [showNeedsReviewOnly, setShowNeedsReviewOnly] = useState(false);
  const { answered, total, mustUnanswered } = getTotalCounts(data);
  const reviewFeedbackByQuestion = useMemo(
    () => getReviewFeedbackMap(data.answer_evaluator_notes ?? []),
    [data.answer_evaluator_notes],
  );
  const needsReviewCount = reviewFeedbackByQuestion.size;
  const canContinue = mustUnanswered === 0;
  const progressPct = total > 0 ? Math.round((answered / total) * 100) : 0;
  const isComplete = answered === total;

  const questionNeedsReview = useCallback(
    (question: Question): boolean => {
      if (reviewFeedbackByQuestion.has(question.id)) return true;
      if (isQuestionAnswered(question)) return false;
      return question.must_answer;
    },
    [reviewFeedbackByQuestion],
  );

  const toggleCard = useCallback((id: string) => {
    setExpandedCards((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSection = useCallback((sectionId: number) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) next.delete(sectionId);
      else next.add(sectionId);
      return next;
    });
  }, []);

  useEffect(() => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const section of data.sections) {
        if (!next.has(section.id)) {
          next.add(section.id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [data.sections]);

  const updateQuestion = useCallback(
    (questionId: string, updater: (q: Question) => Question) => {
      function walkQuestions(questions: Question[]): Question[] {
        return questions.map((q) => {
          if (q.id === questionId) return updater(q);
          if (q.refinements.length > 0) {
            return { ...q, refinements: walkQuestions(q.refinements) };
          }
          return q;
        });
      }
      const updated: ClarificationsFile = {
        ...data,
        sections: data.sections.map((s) => ({
          ...s,
          questions: walkQuestions(s.questions),
        })),
      };
      onChange(updated);
    },
    [data, onChange],
  );

  const hasNeedsReviewInTree = useCallback((q: Question): boolean => {
    if (questionNeedsReview(q)) return true;
    return q.refinements.some(hasNeedsReviewInTree);
  }, [questionNeedsReview]);

  const visibleSections = data.sections
    .map((section) => ({
      section,
      visibleQuestions: showNeedsReviewOnly
        ? section.questions.filter(hasNeedsReviewInTree)
        : section.questions,
    }))
    .filter(({ visibleQuestions }) => visibleQuestions.length > 0);

  return (
    <div className="flex h-full flex-col">
      {/* ── Toolbar ── */}
      <div className="flex shrink-0 items-center gap-3 border-b bg-muted/60 px-6 py-2">
        <div className="flex flex-1 items-center gap-3">
          <div className="h-1 w-28 overflow-hidden rounded-full bg-border">
            <div
              className="h-full rounded-full transition-all duration-200"
              style={{
                width: `${progressPct}%`,
                background: isComplete ? "var(--color-seafoam)" : "var(--color-pacific)",
              }}
            />
          </div>
          <span
            className="text-xs font-medium whitespace-nowrap tracking-wide"
            style={{ color: isComplete ? "var(--color-seafoam)" : "var(--color-pacific)" }}
          >
            {answered} / {total} answered
          </span>
          {mustUnanswered > 0 && (
            <>
              <span className="text-xs text-muted-foreground">·</span>
              <span className="text-xs text-destructive font-medium">
                {total - answered} unanswered (incl. {mustUnanswered} MUST ANSWER)
              </span>
            </>
          )}
        </div>
        {filePath && (
          <span className="text-[11px] font-mono text-muted-foreground">{filePath}</span>
        )}
        <div className="ml-1 flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Need Review</span>
          <Switch
            size="sm"
            aria-label="Need Review"
            checked={showNeedsReviewOnly}
            onCheckedChange={setShowNeedsReviewOnly}
          />
        </div>
      </div>

      {/* ── Scrollable document ── */}
      <div className="min-h-0 flex-1 overflow-y-auto pb-12">
        <MetadataBlock data={data} />

        <div className="px-6 pt-4 pb-1 text-base font-semibold tracking-tight text-foreground">
          {data.metadata.title}
        </div>
        <div
          className="mx-6 rounded-md border px-3 py-2 text-xs leading-relaxed"
          style={{
            borderColor: "color-mix(in oklch, var(--color-pacific), transparent 70%)",
            background: "color-mix(in oklch, var(--color-pacific), transparent 92%)",
            color: "var(--color-pacific)",
          }}
        >
          Questions marked <strong className="font-semibold">MUST ANSWER</strong> block skill generation.
          All others refine quality but have reasonable defaults.
        </div>
        {needsReviewCount > 0 && (
          <div
            className="mx-6 mt-2 rounded-md border px-3 py-2 text-xs leading-relaxed"
            style={{
              borderColor: "color-mix(in oklch, var(--destructive), transparent 70%)",
              background: "color-mix(in oklch, var(--destructive), transparent 93%)",
              color: "var(--destructive)",
            }}
          >
            {needsReviewCount} question{needsReviewCount === 1 ? "" : "s"} currently marked for review by the answer evaluator.
          </div>
        )}

        {data.notes.length > 0 && (
          <NotesBlock notes={data.notes} isExpanded={notesExpanded} onToggle={() => setNotesExpanded((prev) => !prev)} />
        )}

        {visibleSections.map(({ section, visibleQuestions }) => (
          <SectionBlock
            key={section.id}
            section={section}
            visibleQuestions={visibleQuestions}
            isExpanded={expandedSections.has(section.id)}
            toggleSection={toggleSection}
            expandedCards={expandedCards}
            toggleCard={toggleCard}
            updateQuestion={updateQuestion}
            readOnly={readOnly}
            reviewFeedbackByQuestion={reviewFeedbackByQuestion}
          />
        ))}
        {visibleSections.length === 0 && (
          <div className="mx-6 mt-6 rounded-md border border-dashed px-4 py-3 text-sm text-muted-foreground">
            No questions currently need review.
          </div>
        )}
      </div>

      {/* ── Bottom bar ── */}
      <div className="flex shrink-0 items-center justify-between border-t px-6 py-3">
        <SaveIndicator status={saveStatus} />
        <div className="flex items-center gap-2">
          {onReset && (
            <Button variant="outline" size="sm" onClick={onReset}>
              <RotateCcw className="size-3.5" />
              Re-run
            </Button>
          )}
          {onReload && (
            <Button variant="outline" size="sm" onClick={onReload}>
              <RotateCcw className="size-3.5" />
              Reload
            </Button>
          )}
          {onContinue && (
            <Button size="sm" onClick={onContinue} disabled={!canContinue || readOnly || evaluating}>
              {evaluating ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  Evaluating answers...
                </>
              ) : (
                <>
                  <ArrowRight className="size-3.5" />
                  Continue
                </>
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Metadata Block ───────────────────────────────────────────────────────────

function MetadataBlock({ data }: { data: ClarificationsFile }) {
  const m = data.metadata;
  return (
    <div className="mx-6 mt-4 flex flex-wrap gap-x-6 gap-y-1 rounded-lg border bg-muted/40 px-4 py-2.5 font-mono text-xs">
      {m.priority_questions.length > 0 && (
        <span>
          <span className="text-muted-foreground">priority</span>{": "}
          <span className="text-amber-600 dark:text-amber-400">
            [{m.priority_questions.join(", ")}]
          </span>
        </span>
      )}
      <span>
        <span className="text-muted-foreground">questions</span>{": "}
        <span style={{ color: "var(--color-pacific)" }}>{m.question_count}</span>
      </span>
      <span>
        <span className="text-muted-foreground">sections</span>{": "}
        <span style={{ color: "var(--color-pacific)" }}>{m.section_count}</span>
      </span>
      <span>
        <span className="text-muted-foreground">refinements</span>{": "}
        <span style={{ color: "var(--color-pacific)" }}>{m.refinement_count}</span>
      </span>
    </div>
  );
}

// ─── Section Band ─────────────────────────────────────────────────────────────

function SectionBlock({
  section, visibleQuestions, isExpanded, toggleSection, expandedCards, toggleCard, updateQuestion, readOnly, reviewFeedbackByQuestion,
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
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Status Chip ──────────────────────────────────────────────────────────────

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

// ─── Question Card ────────────────────────────────────────────────────────────

function QuestionCard({
  question, isExpanded, toggleCard, updateQuestion, readOnly, reviewFeedback, reviewFeedbackByQuestion,
}: {
  question: Question;
  isExpanded: boolean;
  toggleCard: (id: string) => void;
  updateQuestion: (id: string, updater: (q: Question) => Question) => void;
  readOnly: boolean;
  reviewFeedback?: ReviewFeedback;
  reviewFeedbackByQuestion: Map<string, ReviewFeedback>;
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
  const refCount = question.refinements.length;
  const refUnanswered = refCount > 0
    ? question.refinements.filter((r) => !isQuestionAnswered(r)).length
    : 0;

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
        {refCount > 0 && <RefinementBadge count={refCount} unanswered={refUnanswered} />}
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

          {question.choices.length > 0 && (
            <ChoiceList
              choices={question.choices}
              selectedId={question.answer_choice}
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

          {(question.answer_choice !== null || question.choices.length === 0) && (
            <AnswerField
              value={question.answer_text ?? ""}
              onChange={(text) => {
                if (readOnly) return;
                updateQuestion(question.id, makeAnswerUpdater(text));
              }}
              readOnly={readOnly}
            />
          )}

          {question.refinements.length > 0 && (
            <RefinementsBlock
              refinements={question.refinements}
              updateQuestion={updateQuestion}
              readOnly={readOnly}
              reviewFeedbackByQuestion={reviewFeedbackByQuestion}
            />
          )}
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

function RefinementBadge({ count, unanswered }: { count: number; unanswered: number }) {
  const allAnswered = unanswered === 0;
  return (
    <span
      className="shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px] font-medium"
      style={{
        borderColor: allAnswered
          ? "color-mix(in oklch, var(--color-pacific), transparent 50%)"
          : "color-mix(in oklch, var(--color-ocean), transparent 50%)",
        background: allAnswered
          ? "color-mix(in oklch, var(--color-pacific), transparent 88%)"
          : "color-mix(in oklch, var(--color-ocean), transparent 88%)",
        color: allAnswered ? "var(--color-pacific)" : "var(--color-ocean)",
      }}
    >
      {count} {count === 1 ? "refinement" : "refinements"}
      {unanswered > 0 && ` (${unanswered} unanswered)`}
    </span>
  );
}

// ─── Choice List ──────────────────────────────────────────────────────────────

function ChoiceList({
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

// ─── Answer Field ─────────────────────────────────────────────────────────────

function AnswerField({
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

// ─── Refinements Block ────────────────────────────────────────────────────────

function RefinementsBlock({
  refinements, updateQuestion, readOnly, reviewFeedbackByQuestion,
}: {
  refinements: Question[];
  updateQuestion: (id: string, updater: (q: Question) => Question) => void;
  readOnly: boolean;
  reviewFeedbackByQuestion: Map<string, ReviewFeedback>;
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
        />
      ))}
    </div>
  );
}

function RefinementItem({
  refinement, updateQuestion, readOnly, reviewFeedback,
}: {
  refinement: Question;
  updateQuestion: (id: string, updater: (q: Question) => Question) => void;
  readOnly: boolean;
  reviewFeedback?: ReviewFeedback;
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

function ReviewFeedbackCallout({ feedback, compact = false }: { feedback: ReviewFeedback; compact?: boolean }) {
  const chipStyles: Record<ReviewStatus, { bg: string; text: string; border: string; className?: string }> = {
    not_answered: {
      bg: "var(--destructive)",
      text: "var(--destructive)",
      border: "color-mix(in oklch, var(--destructive), transparent 55%)",
    },
    contradictory: {
      bg: "var(--destructive)",
      text: "var(--destructive)",
      border: "color-mix(in oklch, var(--destructive), transparent 55%)",
    },
    vague: {
      bg: "",
      text: "",
      border: "",
      className: "border-amber-500/40 bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400",
    },
    needs_refinement: {
      bg: "var(--color-pacific)",
      text: "var(--color-pacific)",
      border: "color-mix(in oklch, var(--color-pacific), transparent 55%)",
    },
  };
  const statusChip = chipStyles[feedback.status];

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
          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
            statusChip.className ?? ""
          }`}
          style={statusChip.className
            ? undefined
            : {
              color: statusChip.text,
              background: `color-mix(in oklch, ${statusChip.bg}, transparent 88%)`,
              border: `1px solid ${statusChip.border}`,
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
  const statusStyles: Record<ReviewStatus, { className?: string; style?: CSSProperties }> = {
    not_answered: {
      style: {
        color: "var(--destructive)",
        border: "1px solid color-mix(in oklch, var(--destructive), transparent 50%)",
        background: "color-mix(in oklch, var(--destructive), transparent 88%)",
      },
    },
    contradictory: {
      style: {
        color: "var(--destructive)",
        border: "1px solid color-mix(in oklch, var(--destructive), transparent 50%)",
        background: "color-mix(in oklch, var(--destructive), transparent 88%)",
      },
    },
    vague: {
      className: "border-amber-500/40 bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400",
    },
    needs_refinement: {
      style: {
        color: "var(--color-pacific)",
        border: "1px solid color-mix(in oklch, var(--color-pacific), transparent 50%)",
        background: "color-mix(in oklch, var(--color-pacific), transparent 88%)",
      },
    },
  };
  const s = statusStyles[status];

  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${s.className ?? ""}`}
      style={s.style}
    >
      {REVIEW_STATUS_LABEL[status]}
    </span>
  );
}

// ─── Research Notes ───────────────────────────────────────────────────────────

function NotesBlock({
  notes, isExpanded, onToggle,
}: {
  notes: Note[];
  isExpanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div>
      <button
        type="button"
        className="mt-6 flex w-full items-center gap-2.5 px-6 py-2.5 text-left transition-colors hover:bg-muted/40"
        style={{
          borderTop: "2px solid var(--color-ocean)",
          background: "color-mix(in oklch, var(--color-ocean), transparent 90%)",
        }}
        onClick={onToggle}
        aria-expanded={isExpanded}
        aria-controls="research-notes-content"
      >
        <ChevronRight
          className="size-3.5 shrink-0 text-muted-foreground transition-transform duration-150"
          style={{ transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)" }}
          aria-hidden="true"
        />
        <Info className="size-4" style={{ color: "var(--color-ocean)" }} />
        <span
          className="flex-1 text-sm font-semibold tracking-tight"
          style={{ color: "var(--color-ocean)" }}
        >
          Research Notes
        </span>
        <span className="text-[11px] text-muted-foreground">{notes.length} {notes.length === 1 ? "note" : "notes"}</span>
      </button>
      {isExpanded && (
        <div id="research-notes-content">
          {notes.map((note, i) => (
            <NoteCard key={i} note={note} />
          ))}
        </div>
      )}
    </div>
  );
}

function NoteCard({ note }: { note: Note }) {
  const warn = isWarnNote(note.type);
  const Icon = resolveNoteIcon(note.type);

  return (
    <div className={`mx-6 mt-3 rounded-lg border p-4 ${warn ? "border-amber-500/30 bg-amber-500/5" : "border-border bg-muted/30"}`}>
      <div className="mb-1.5 flex items-center gap-2">
        <Icon className={`size-3.5 ${warn ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`} />
        <span className={`text-xs font-semibold ${warn ? "text-amber-600 dark:text-amber-400" : "text-foreground"}`}>
          {note.title}
        </span>
        <span className="rounded border px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
          {note.type.replace(/_/g, " ")}
        </span>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">{note.body}</p>
    </div>
  );
}

// ─── Save Indicator ───────────────────────────────────────────────────────────

function SaveIndicator({ status }: { status: SaveStatus }) {
  switch (status) {
    case "dirty":
      return (
        <div className="flex items-center gap-1.5 text-xs font-medium text-amber-600 dark:text-amber-400">
          <span className="size-1.5 rounded-full bg-amber-500" />
          Unsaved changes
        </div>
      );
    case "saving":
      return (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="size-3 animate-spin" />
          Saving...
        </div>
      );
    case "saved":
      return (
        <div className="flex items-center gap-1.5 text-xs font-medium" style={{ color: "var(--color-seafoam)" }}>
          <Check className="size-3" />
          Saved
        </div>
      );
    default:
      return (
        <p className="text-xs text-muted-foreground">Answers save automatically as you type.</p>
      );
  }
}
