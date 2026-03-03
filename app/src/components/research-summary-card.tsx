import { useState } from "react";
import { CheckCircle2, Clock, DollarSign, Layers, MessageCircleQuestion, StickyNote, AlertTriangle, ChevronRight, Info } from "lucide-react";
import { ClarificationsEditor } from "@/components/clarifications-editor";
import type { SaveStatus } from "@/components/clarifications-editor";
import { type ClarificationsFile, getTotalCounts } from "@/lib/clarifications-types";
import { formatElapsed } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface DimensionScore {
  name: string;
  score: number;
  reason: string;
  companion?: string;
}

interface ResearchPlanData {
  purpose: string;
  dimensionsEvaluated: number;
  dimensionsSelected: number;
  topicRelevance?: string;
  dimensions: DimensionScore[];
  selectedDimensions: string[];
}

interface ResearchSummaryCardProps {
  researchPlan: string;
  clarificationsData: ClarificationsFile;
  duration?: number;
  cost?: number;
  /** When true, make the research plan collapsible (default collapsed) and clarifications editable */
  editable?: boolean;
  onClarificationsChange?: (data: ClarificationsFile) => void;
  onClarificationsContinue?: () => void;
  onReset?: () => void;
  saveStatus?: SaveStatus;
  evaluating?: boolean;
}

// ─── Parser ───────────────────────────────────────────────────────────────────

function parseResearchPlan(markdown: string): ResearchPlanData {
  const result: ResearchPlanData = {
    purpose: "",
    dimensionsEvaluated: 0,
    dimensionsSelected: 0,
    dimensions: [],
    selectedDimensions: [],
  };

  // Parse YAML frontmatter
  const fmMatch = markdown.match(/^---\n([\s\S]*?)\n---/);
  if (fmMatch) {
    const fm = fmMatch[1];
    for (const line of fm.split("\n")) {
      const [key, ...rest] = line.split(":");
      const value = rest.join(":").trim();
      switch (key.trim()) {
        case "purpose": result.purpose = value; break;
        case "dimensions_evaluated": result.dimensionsEvaluated = parseInt(value) || 0; break;
        case "dimensions_selected": result.dimensionsSelected = parseInt(value) || 0; break;
        case "topic_relevance": result.topicRelevance = value; break;
      }
    }
  }

  // Parse Dimension Scores table
  const scoreTableMatch = markdown.match(/## Dimension Scores\s*\n\|[^\n]+\n\|[-|\s]+\n([\s\S]*?)(?=\n##|\n---|\Z)/);
  if (scoreTableMatch) {
    for (const row of scoreTableMatch[1].trim().split("\n")) {
      const cells = row.split("|").map((c) => c.trim()).filter(Boolean);
      if (cells.length >= 3) {
        result.dimensions.push({
          name: cells[0],
          score: parseInt(cells[1]) || 0,
          reason: cells[2],
          companion: cells[3] || undefined,
        });
      }
    }
  }

  // Parse Selected Dimensions table
  const selectedMatch = markdown.match(/## Selected Dimensions\s*\n\|[^\n]+\n\|[-|\s]+\n([\s\S]*?)(?=\n##|\n---|\Z)/);
  if (selectedMatch) {
    for (const row of selectedMatch[1].trim().split("\n")) {
      const cells = row.split("|").map((c) => c.trim()).filter(Boolean);
      if (cells.length >= 1) {
        result.selectedDimensions.push(cells[0]);
      }
    }
  }

  return result;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ResearchSummaryCard({
  researchPlan,
  clarificationsData,
  duration,
  cost,
  editable,
  onClarificationsChange,
  onClarificationsContinue,
  onReset,
  saveStatus,
  evaluating,
}: ResearchSummaryCardProps) {
  const [planExpanded, setPlanExpanded] = useState(true);
  const plan = parseResearchPlan(researchPlan);
  const { answered, total } = getTotalCounts(clarificationsData);
  const meta = clarificationsData.metadata;
  const noteCount = clarificationsData.notes.length;
  const warnCount = clarificationsData.notes.filter((n) => n.type === "blocked" || n.type === "critical_gap").length;

  const dimPct = plan.dimensionsEvaluated > 0
    ? Math.round((plan.dimensionsSelected / plan.dimensionsEvaluated) * 100)
    : 0;

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
        <CheckCircle2 className="size-5 shrink-0" style={{ color: "var(--color-seafoam)" }} />
        <span className="text-sm font-semibold tracking-tight text-foreground">
          Research Complete
        </span>
        <div className="flex-1" />
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          {duration !== undefined && (
            <span className="flex items-center gap-1">
              <Clock className="size-3" />
              {formatElapsed(duration)}
            </span>
          )}
          {cost !== undefined && cost > 0 && (
            <span className="flex items-center gap-1">
              <DollarSign className="size-3" />
              ${cost.toFixed(4)}
            </span>
          )}
        </div>
      </button>

      {/* Stats Grid — collapsible when editable */}
      {planExpanded && (
        <div className="grid grid-cols-3 divide-x">
          {/* Dimensions Column */}
          <div className="p-4">
            <div className="flex items-center gap-1.5 mb-3">
              <Layers className="size-3.5" style={{ color: "var(--color-pacific)" }} />
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Dimensions
              </span>
            </div>
            <div className="flex items-baseline gap-1.5 mb-2">
              <span className="text-2xl font-semibold tracking-tight" style={{ color: "var(--color-pacific)" }}>
                {plan.dimensionsSelected}
              </span>
              <span className="text-xs text-muted-foreground">
                of {plan.dimensionsEvaluated} selected
              </span>
            </div>
            {/* Progress bar */}
            <div className="h-1.5 w-full rounded-full bg-border mb-3">
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{ width: `${dimPct}%`, background: "var(--color-pacific)" }}
              />
            </div>
            {/* Dimension pills */}
            <div className="flex flex-wrap gap-1.5">
              {plan.dimensions
                .sort((a, b) => b.score - a.score)
                .map((dim) => {
                  const isSelected = plan.selectedDimensions.includes(dim.name);
                  return (
                    <span
                      key={dim.name}
                      className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium"
                      style={{
                        background: isSelected
                          ? "color-mix(in oklch, var(--color-pacific), transparent 88%)"
                          : "transparent",
                        border: isSelected
                          ? "1px solid color-mix(in oklch, var(--color-pacific), transparent 60%)"
                          : "1px solid var(--border)",
                        color: isSelected ? "var(--color-pacific)" : "var(--muted-foreground)",
                        opacity: isSelected ? 1 : 0.6,
                      }}
                    >
                      {dim.name}
                      <span className="font-mono text-[10px] tabular-nums">{dim.score}/5</span>
                    </span>
                  );
                })}
            </div>
          </div>

          {/* Clarifications Column */}
          <div className="p-4">
            <div className="flex items-center gap-1.5 mb-3">
              <MessageCircleQuestion className="size-3.5" style={{ color: "var(--color-ocean)" }} />
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Clarifications
              </span>
            </div>
            <div className="flex items-baseline gap-1.5 mb-2">
              <span className="text-2xl font-semibold tracking-tight" style={{ color: "var(--color-ocean)" }}>
                {meta.question_count}
              </span>
              <span className="text-xs text-muted-foreground">
                questions
              </span>
            </div>
            <div className="flex flex-col gap-1.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Sections</span>
                <span className="font-medium text-foreground">{meta.section_count}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Must answer</span>
                <span className="font-medium" style={{ color: meta.must_answer_count > 0 ? "var(--destructive)" : "var(--foreground)" }}>
                  {meta.must_answer_count}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Answered</span>
                <span className="font-medium" style={{ color: answered === total && total > 0 ? "var(--color-seafoam)" : "var(--foreground)" }}>
                  {answered} / {total}
                </span>
              </div>
              {meta.duplicates_removed !== undefined && meta.duplicates_removed > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Deduped</span>
                  <span className="font-medium text-foreground">{meta.duplicates_removed} removed</span>
                </div>
              )}
            </div>
          </div>

          {/* Notes Column */}
          <div className="p-4">
            <div className="flex items-center gap-1.5 mb-3">
              <StickyNote className="size-3.5 text-muted-foreground" />
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Notes
              </span>
            </div>
            <div className="flex items-baseline gap-1.5 mb-2">
              <span className="text-2xl font-semibold tracking-tight" style={{ color: noteCount > 0 ? "var(--color-ocean)" : "var(--muted-foreground)" }}>
                {noteCount}
              </span>
              <span className="text-xs text-muted-foreground">
                {noteCount === 1 ? "note" : "notes"}
              </span>
            </div>
            {noteCount > 0 && (
              <div className="flex flex-col gap-1.5">
                {warnCount > 0 && (
                  <div className="flex items-center gap-1.5 text-xs">
                    <AlertTriangle className="size-3 text-amber-600 dark:text-amber-400" />
                    <span className="text-amber-600 dark:text-amber-400 font-medium">
                      {warnCount} {warnCount === 1 ? "warning" : "warnings"}
                    </span>
                  </div>
                )}
                {noteCount - warnCount > 0 && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Info className="size-3" />
                    <span>{noteCount - warnCount} informational</span>
                  </div>
                )}
              </div>
            )}
            {noteCount === 0 && (
              <p className="text-xs text-muted-foreground">No issues flagged</p>
            )}
          </div>
        </div>
      )}
    </div>
  );

  if (editable) {
    return (
      <div className="flex h-full flex-col gap-3">
        {/* Summary Card — fixed height, collapses when toggled */}
        <div className="shrink-0">{summaryCard}</div>

        {/* Clarifications editor — fills remaining space */}
        <div className="flex-1 min-h-0 rounded-lg border shadow-sm overflow-hidden">
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
    <div className="flex flex-col gap-4">
      {/* Summary Card */}
      {summaryCard}

      {/* Clarifications — read-only, fixed height */}
      <div className="rounded-lg border shadow-sm" style={{ height: "min(600px, 60vh)" }}>
        <ClarificationsEditor
          data={clarificationsData}
          onChange={() => {}}
          readOnly
        />
      </div>
    </div>
  );
}
