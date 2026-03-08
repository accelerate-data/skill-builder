import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Circle, AlertCircle, XCircle, Info } from "lucide-react";
import type { AnswerEvaluation } from "@/lib/tauri";

export type GateVerdict = "sufficient" | "mixed" | "insufficient";

interface TransitionGateDialogProps {
  open: boolean;
  verdict: GateVerdict | null;
  evaluation: AnswerEvaluation | null;
  context?: "clarifications" | "refinements";
  /** Sufficient gate 1: skip research, jump to decisions. */
  onSkip: () => void;
  /** Sufficient gate 1: run research anyway. Sufficient gate 2: advance to decisions. Mixed/insufficient: continue anyway. */
  onResearch: () => void;
  /** Go back to the review editor. */
  onLetMeAnswer: () => void;
  /** Continue anyway (advance without auto-fill). Same as onSkip for gate 2, onResearch for gate 1. */
  onContinueAnyway: () => void;
}

/** Render per-question verdicts grouped by category. */
function EvaluationBreakdown({ evaluation }: { evaluation: AnswerEvaluation }) {
  const pq = evaluation.per_question ?? [];
  const ok = pq.filter(q => q.verdict === "clear");
  const missing = pq.filter(q => q.verdict === "not_answered");
  const vague = pq.filter(q => q.verdict === "vague");
  const contradictory = pq.filter(q => q.verdict === "contradictory");
  const needsRefinement = pq.filter(q => q.verdict === "needs_refinement");

  return (
    <div
      className="max-h-56 space-y-2 overflow-y-auto rounded-md border bg-muted/30 p-3 text-xs"
      data-testid="question-breakdown"
    >
      {ok.length > 0 && (
        <div className="flex items-center gap-2">
          <CheckCircle2 className="size-3" style={{ color: "var(--color-seafoam)" }} />
          <span style={{ color: "var(--color-seafoam)" }} className="font-medium">OK:</span>
          <span className="text-muted-foreground">{ok.length} questions</span>
        </div>
      )}
      {missing.length > 0 && (
        <div className="flex items-start gap-2">
          <Circle className="size-3 mt-0.5 text-destructive" />
          <span className="text-destructive font-medium">Missing:</span>
          <div className="flex min-w-0 flex-wrap gap-1.5">
            {missing.map((q) => (
              <span key={q.question_id} className="rounded border px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                {q.question_id}
              </span>
            ))}
          </div>
        </div>
      )}
      {vague.length > 0 && (
        <div className="flex items-start gap-2">
          <AlertCircle className="size-3 mt-0.5 text-amber-600 dark:text-amber-400" />
          <span className="text-amber-600 dark:text-amber-400 font-medium">Vague:</span>
          <div className="min-w-0 flex-1 space-y-1">
            {vague.map((q) => (
              <p key={q.question_id} className="break-words leading-relaxed text-muted-foreground">
                <span className="font-mono text-[11px]">{q.question_id}</span>: {q.reason}
              </p>
            ))}
          </div>
        </div>
      )}
      {contradictory.length > 0 && (
        <div className="flex items-start gap-2">
          <XCircle className="size-3 mt-0.5 text-destructive" />
          <span className="text-destructive font-medium">Contradictory:</span>
          <div className="min-w-0 flex-1 space-y-1">
            {contradictory.map((q) => (
              <p key={q.question_id} className="break-words leading-relaxed text-muted-foreground">
                <span className="font-mono text-[11px]">{q.question_id}</span>: {q.reason}{" "}
                <span className="font-medium text-destructive">(conflicts with {q.contradicts})</span>
              </p>
            ))}
          </div>
        </div>
      )}
      {needsRefinement.length > 0 && (
        <div className="flex items-start gap-2">
          <Info className="size-3 mt-0.5" style={{ color: "var(--color-pacific)" }} />
          <span style={{ color: "var(--color-pacific)" }} className="font-medium">Needs refinement:</span>
          <div className="flex min-w-0 flex-wrap gap-1.5">
            {needsRefinement.map((q) => (
              <span key={q.question_id} className="rounded border px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                {q.question_id}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function TransitionGateDialog({
  open,
  verdict,
  evaluation,
  context = "clarifications",
  onSkip,
  onResearch,
  onLetMeAnswer,
  onContinueAnyway,
}: TransitionGateDialogProps) {
  if (!verdict) return null;

  const isRefinements = context === "refinements";

  // Check if the only issues are needs_refinement (no missing/vague/contradictory)
  const pq = evaluation?.per_question ?? [];
  const hasMissing = pq.some(q => q.verdict === "not_answered");
  const hasVague = pq.some(q => q.verdict === "vague");
  const hasContradictory = pq.some(q => q.verdict === "contradictory");
  const onlyNeedsRefinement = !hasMissing && !hasVague && !hasContradictory
    && pq.some(q => q.verdict === "needs_refinement");

  // ── Sufficient ──────────────────────────────────────────────────────────────

  if (verdict === "sufficient") {
    if (isRefinements) {
      return (
        <Dialog open={open} onOpenChange={(o) => { if (!o) onResearch(); }}>
          <DialogContent showCloseButton={false}>
            <DialogHeader>
              <DialogTitle>Refinement Answers Complete</DialogTitle>
              <DialogDescription>
                Your refinement answers look good. Continue to the decision analysis phase.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={onLetMeAnswer}>
                Back to Review
              </Button>
              <Button onClick={onResearch}>Continue to Decisions</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      );
    }

    // Gate 1: offer to skip research
    return (
      <Dialog open={open} onOpenChange={(o) => { if (!o) onResearch(); }}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Skip Detailed Research?</DialogTitle>
            <DialogDescription>
              Your clarification answers are detailed and complete. You can skip
              the detailed research phase and go straight to confirming decisions,
              or run research anyway for additional depth.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={onResearch}>
              Run Research Anyway
            </Button>
            <Button onClick={onSkip}>Skip to Decisions</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // ── Mixed: only needs_refinement (gate 1) ─────────────────────────────────

  if (verdict === "mixed" && onlyNeedsRefinement && !isRefinements) {
    return (
      <Dialog open={open} onOpenChange={(o) => { if (!o) onResearch(); }}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Some Answers Need Deeper Research</DialogTitle>
            <DialogDescription asChild>
              <div>
                <p>
                  Your answers are substantive but some introduce parameters that need
                  pinning down. The detailed research step will generate follow-up
                  questions for these:
                </p>
                {evaluation && <EvaluationBreakdown evaluation={evaluation} />}
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={onLetMeAnswer}>
              Let Me Revise
            </Button>
            <Button onClick={onResearch}>Continue to Research</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // ── Contradictory answers: block forward progress ─────────────────────────

  if (hasContradictory) {
    return (
      <Dialog open={open} onOpenChange={(o) => { if (!o) onLetMeAnswer(); }}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Contradictory Answers</DialogTitle>
            <DialogDescription asChild>
              <div>
                <p>
                  Some answers contradict each other. Please resolve these before
                  continuing — the decisions phase cannot reconcile conflicting answers.
                </p>
                {evaluation && <EvaluationBreakdown evaluation={evaluation} />}
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={onLetMeAnswer}>Let Me Answer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // ── Mixed / Insufficient (no contradictions): Let Me Answer / Continue Anyway

  const title = verdict === "mixed"
    ? (isRefinements ? "Some Refinements Unanswered" : "Review Answer Quality")
    : (isRefinements ? "Refinements Need Attention" : "Review Answer Quality");

  const description = verdict === "mixed"
    ? (isRefinements
        ? "Some refinement answers are missing or need attention:"
        : "The evaluator found issues with some answers:")
    : (isRefinements
        ? "Most refinement questions haven't been answered:"
        : "The evaluator found issues with most answers:");

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onLetMeAnswer(); }}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription asChild>
            <div>
              <p>{description}</p>
              {evaluation && <EvaluationBreakdown evaluation={evaluation} />}
            </div>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onLetMeAnswer}>
            Let Me Answer
          </Button>
          <Button onClick={onContinueAnyway}>Continue Anyway</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
