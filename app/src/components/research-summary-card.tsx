import { useState } from "react";
import { CheckCircle2, Clock, HelpCircle, AlertTriangle, ChevronRight, XCircle } from "lucide-react";
import { ClarificationsEditor } from "@/components/clarifications-editor";
import type { SaveStatus } from "@/components/clarifications-editor";
import { type ClarificationsFile } from "@/lib/clarifications-types";
import { formatElapsed } from "@/lib/utils";

interface ResearchSummaryCardProps {
  researchPlan?: string;
  clarificationsData: ClarificationsFile;
  duration?: number;
  /** When true, make the research plan collapsible (default collapsed) and clarifications editable */
  editable?: boolean;
  onClarificationsChange?: (data: ClarificationsFile) => void;
  onClarificationsContinue?: () => void;
  onReset?: () => void;
  saveStatus?: SaveStatus;
  evaluating?: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────

// ─── Outcome helpers ─────────────────────────────────────────────────────────

type OutcomeState = "ok" | "error" | "scope_guard" | "warning";

function getOutcomeState(meta: ClarificationsFile["metadata"]): OutcomeState {
  if (meta?.error) return "error";
  if (meta?.warning?.code === "scope_guard_triggered" || meta?.scope_recommendation) return "scope_guard";
  if (meta?.warning) return "warning";
  return "ok";
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ResearchSummaryCard({
  clarificationsData,
  duration,
  editable,
  onClarificationsChange,
  onClarificationsContinue,
  onReset,
  saveStatus,
  evaluating,
}: ResearchSummaryCardProps) {
  const [planExpanded, setPlanExpanded] = useState(false);
  const meta = clarificationsData.metadata;

  const outcome = getOutcomeState(meta);
  const isNonHappyPath = outcome !== "ok";
  const summaryStats = [
    { label: "Questions", value: meta?.question_count ?? 0 },
    { label: "Sections", value: meta?.section_count ?? 0 },
    { label: "Must answer", value: meta?.must_answer_count ?? 0 },
    { label: "Refinements", value: meta?.refinement_count ?? 0 },
  ];

  // Header config per outcome
  const headerConfig = {
    ok: {
      icon: <CheckCircle2 className="size-5 shrink-0" style={{ color: "var(--color-seafoam)" }} />,
      label: "Research Complete",
      labelClass: "text-sm font-semibold tracking-tight text-foreground",
    },
    error: {
      icon: <XCircle className="size-5 shrink-0 text-destructive" />,
      label: "Research Failed",
      labelClass: "text-sm font-semibold tracking-tight text-destructive",
    },
    scope_guard: {
      icon: <AlertTriangle className="size-5 shrink-0 text-amber-600 dark:text-amber-400" />,
      label: "Scope Too Broad",
      labelClass: "text-sm font-semibold tracking-tight text-amber-600 dark:text-amber-400",
    },
    warning: {
      icon: <AlertTriangle className="size-5 shrink-0 text-amber-600 dark:text-amber-400" />,
      label: "Research Warning",
      labelClass: "text-sm font-semibold tracking-tight text-amber-600 dark:text-amber-400",
    },
  }[outcome];

  // Banner for non-happy-path outcomes
  const banner = isNonHappyPath ? (
    outcome === "error" ? (
      <div className="flex items-start gap-2 px-4 py-3 bg-destructive/10 border-b text-destructive text-sm">
        <XCircle className="size-4 shrink-0 mt-0.5" />
        <div>
          <p className="font-medium">{meta?.error?.message}</p>
        </div>
      </div>
    ) : (
      <div className="flex items-start gap-2 px-4 py-3 bg-amber-100 dark:bg-amber-900/30 border-b text-amber-700 dark:text-amber-300 text-sm">
        <AlertTriangle className="size-4 shrink-0 mt-0.5" />
        <div>
          <p className="font-medium">
            {meta?.warning?.message ?? meta?.scope_reason ?? "Research needs a narrower scope before continuing."}
          </p>
          {meta?.scope_reason && (
            <p className="mt-1 text-xs opacity-80">{meta?.scope_reason}</p>
          )}
          {meta?.scope_next_action && (
            <p className="mt-1 text-xs opacity-80">{meta.scope_next_action}</p>
          )}
        </div>
      </div>
    )
  ) : null;

  // Reset-only footer (shown for non-happy-path when onReset is provided)
  const resetFooter = isNonHappyPath && onReset ? (
    <div className="flex items-center justify-end px-4 py-3 border-t bg-muted/20">
      <button
        type="button"
        className="rounded-md px-3 py-1.5 text-xs font-medium border bg-background hover:bg-muted transition-colors duration-150"
        onClick={onReset}
      >
        Reset
      </button>
    </div>
  ) : null;

  // Research plan summary card content
  const summaryCard = (
    <div className="rounded-lg border shadow-sm overflow-hidden">
      {/* Header — clickable when collapsible */}
      <button
        type="button"
        className="flex w-full items-center gap-3 px-5 py-3 border-b bg-muted/30 text-left"
        onClick={() => setPlanExpanded((prev) => !prev)}
        style={{ cursor: "pointer" }}
      >
        <ChevronRight
          className="size-4 shrink-0 text-muted-foreground transition-transform duration-150"
          style={{ transform: planExpanded ? "rotate(90deg)" : undefined }}
        />
        {headerConfig.icon}
        <span className={headerConfig.labelClass}>
          {headerConfig.label}
        </span>
        <div className="flex-1" />
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          {duration !== undefined && (
            <span className="flex items-center gap-1">
              <Clock className="size-3" />
              {formatElapsed(duration)}
            </span>
          )}
        </div>
      </button>

      {/* Banner — non-happy-path message */}
      {planExpanded && banner}

      {planExpanded && !isNonHappyPath && (
        <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4">
          {summaryStats.map((stat) => (
            <div key={stat.label} className="rounded-md border bg-muted/30 px-3 py-2">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                <HelpCircle className="size-3.5" />
                {stat.label}
              </div>
              <div className="mt-1 text-sm font-medium text-foreground">
                {stat.value} {stat.label.toLowerCase()}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Reset-only footer — non-happy-path */}
      {planExpanded && resetFooter}
    </div>
  );

  // Non-happy-path: show only the summary card (no ClarificationsEditor)
  if (isNonHappyPath) {
    return <div className="flex w-full min-w-0 flex-col gap-4">{summaryCard}</div>;
  }

  if (editable) {
    return (
      <div className="flex h-full w-full min-w-0 flex-col gap-3">
        {/* Summary Card — fixed height, collapses when toggled */}
        <div className="shrink-0">{summaryCard}</div>

        {/* Clarifications editor — fills remaining space */}
        <div className="min-h-0 w-full min-w-0 flex-1 overflow-hidden rounded-lg border shadow-sm">
          <ClarificationsEditor
            data={clarificationsData}
            onChange={onClarificationsChange ?? (() => {})}
            onContinue={onClarificationsContinue}
            onReset={onReset}
            saveStatus={saveStatus}
            evaluating={evaluating}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full min-w-0 flex-col gap-4 overflow-hidden">
      {/* Summary Card */}
      {summaryCard}

      {/* Clarifications — read-only, fills remaining space */}
      <div className="min-h-0 flex-1 overflow-hidden rounded-lg border shadow-sm">
        <ClarificationsEditor
          data={clarificationsData}
          onChange={() => {}}
          readOnly
        />
      </div>
    </div>
  );
}
