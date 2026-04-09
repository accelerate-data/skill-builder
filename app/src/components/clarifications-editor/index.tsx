import { useState, useCallback, useEffect, useMemo } from "react";
import { RotateCcw, Check, Loader2, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  type ClarificationsFile,
  type Question,
  type Section,
  getTotalCounts,
  isQuestionAnswered,
} from "@/lib/clarifications-types";
import { getReviewFeedbackMap } from "@/lib/clarifications-review";
import { SectionBlock } from "./section-block";
import { NotesBlock } from "./notes-block";

// ─── Types ───────────────────────────────────────────────────────────────────

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

function flattenQuestions(questions: Question[]): Question[] {
  return questions.flatMap((question) => [question, ...flattenQuestions(question.refinements ?? [])]);
}

function flattenSectionQuestions(sections: Section[]): Question[] {
  return sections.flatMap((section) => flattenQuestions(section.questions ?? []));
}

// ─── Main Component ──────────────────────────────────────────────────────────

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
  const [expandedSections, setExpandedSections] = useState<Set<number>>(() => new Set((data.sections ?? []).map((section) => section.id)));
  const [notesExpanded, setNotesExpanded] = useState(true);
  const [showNeedsReviewOnly, setShowNeedsReviewOnly] = useState(false);
  const { answered, total, mustUnanswered } = getTotalCounts(data);
  const reviewFeedbackByQuestion = useMemo(
    () => getReviewFeedbackMap(data.answer_evaluator_notes ?? []),
    [data.answer_evaluator_notes],
  );
  const allQuestions = useMemo(() => flattenSectionQuestions(data.sections ?? []), [data.sections]);
  const allQuestionIds = useMemo(() => new Set(allQuestions.map((question) => question.id)), [allQuestions]);
  const contradictionSourcesByQuestion = useMemo(() => {
    const map = new Map<string, Set<string>>();

    for (const feedback of reviewFeedbackByQuestion.values()) {
      if (feedback.status !== "contradictory" || !feedback.contradicts) continue;
      if (!allQuestionIds.has(feedback.contradicts)) continue;

      const sources = map.get(feedback.contradicts) ?? new Set<string>();
      sources.add(feedback.questionId);
      map.set(feedback.contradicts, sources);
    }

    return new Map(
      Array.from(map.entries()).map(([questionId, sources]) => [questionId, Array.from(sources).sort()])
    );
  }, [allQuestionIds, reviewFeedbackByQuestion]);
  const canContinue = mustUnanswered === 0;
  const progressPct = total > 0 ? Math.round((answered / total) * 100) : 0;
  const isComplete = answered === total;
  const needsReviewQuestionIds = useMemo(() => {
    const ids = new Set<string>();

    for (const question of allQuestions) {
      const feedback = reviewFeedbackByQuestion.get(question.id);
      if (feedback?.status === "contradictory") {
        ids.add(question.id);
        if (feedback.contradicts && allQuestionIds.has(feedback.contradicts)) {
          ids.add(feedback.contradicts);
        }
        continue;
      }

      if (!isQuestionAnswered(question) && (Boolean(feedback) || question.must_answer)) {
        ids.add(question.id);
      }
    }

    return ids;
  }, [allQuestionIds, allQuestions, reviewFeedbackByQuestion]);
  const needsReviewCount = needsReviewQuestionIds.size;

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
      for (const section of data.sections ?? []) {
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
          if ((q.refinements ?? []).length > 0) {
            return { ...q, refinements: walkQuestions(q.refinements ?? []) };
          }
          return q;
        });
      }
      const updated: ClarificationsFile = {
        ...data,
        sections: (data.sections ?? []).map((s) => ({
          ...s,
          questions: walkQuestions(s.questions ?? []),
        })),
      };
      onChange(updated);
    },
    [data, onChange],
  );

  const hasNeedsReviewInTree = useCallback((q: Question): boolean => {
    if (needsReviewQuestionIds.has(q.id)) return true;
    return (q.refinements ?? []).some(hasNeedsReviewInTree);
  }, [needsReviewQuestionIds]);

  const visibleSections = (data.sections ?? [])
    .map((section) => ({
      section,
      visibleQuestions: showNeedsReviewOnly
        ? (section.questions ?? []).filter(hasNeedsReviewInTree)
        : (section.questions ?? []),
    }))
    .filter(({ visibleQuestions }) => visibleQuestions.length > 0);

  return (
    <div className="flex h-full w-full min-w-0 flex-col">
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

        {(data.notes ?? []).length > 0 && (
          <NotesBlock notes={data.notes ?? []} isExpanded={notesExpanded} onToggle={() => setNotesExpanded((prev) => !prev)} />
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
            contradictionSourcesByQuestion={contradictionSourcesByQuestion}
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

// ─── Metadata Block ──────────────────────────────────────────────────────────

function MetadataBlock({ data }: { data: ClarificationsFile }) {
  const m = data.metadata;
  return (
    <div className="mx-6 mt-4 flex flex-wrap gap-x-6 gap-y-1 rounded-lg border bg-muted/40 px-4 py-2.5 font-mono text-xs">
      {(m.priority_questions ?? []).length > 0 && (
        <span>
          <span className="text-muted-foreground">priority</span>{": "}
          <span className="text-amber-600 dark:text-amber-400">
            [{(m.priority_questions ?? []).join(", ")}]
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

// ─── Save Indicator ──────────────────────────────────────────────────────────

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
