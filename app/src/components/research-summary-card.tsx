import { useState } from "react";
import { CheckCircle2, Clock, DollarSign, Layers, MessageCircleQuestion, StickyNote, AlertTriangle, ChevronRight, Info, XCircle } from "lucide-react";
import { ClarificationsEditor } from "@/components/clarifications-editor";
import type { SaveStatus } from "@/components/clarifications-editor";
import { type ClarificationsFile, getTotalCounts } from "@/lib/clarifications-types";
import { formatElapsed } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface DimensionScore {
  name: string;
  score: number;
  reason: string;
}

interface ResearchPlanData {
  purpose: string;
  domain?: string;
  dimensionsEvaluated: number;
  dimensionsSelected: number;
  topicRelevance?: string;
  dimensions: DimensionScore[];
  selectedDimensions: string[];
}

interface ResearchPlanJson {
  purpose: string;
  domain: string;
  topic_relevance: string;
  dimensions_evaluated: number;
  dimensions_selected: number;
  dimension_scores: Array<{
    name: string;
    score: number;
    reason: string;
    focus: string;
  }>;
  selected_dimensions: Array<{
    name: string;
    focus: string;
  }>;
}

function stripInlineMarkdown(text: string): string {
  return text.replace(/[*_`~]/g, "").trim();
}

interface ResearchSummaryCardProps {
  researchPlan?: string;
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

  // Back-compat: older research-plan outputs may only contain a single top-level
  // markdown table (Dimension | Score | Reasoning | Clarifications Needed),
  // without frontmatter or a dedicated "Selected Dimensions" section.
  if (result.dimensions.length === 0) {
    const tableRows = markdown
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("|") && line.endsWith("|"));

    for (const row of tableRows) {
      const cells = row.split("|").map((c) => c.trim()).filter(Boolean);
      if (cells.length < 2) continue;

      const scoreMatch = cells[1].match(/\d+/);
      const score = scoreMatch ? parseInt(scoreMatch[0], 10) : NaN;
      if (!Number.isFinite(score)) continue;

      result.dimensions.push({
        name: stripInlineMarkdown(cells[0]),
        score,
        reason: cells[2] ?? "",
      });
    }
  }

  if (result.dimensionsEvaluated === 0 && result.dimensions.length > 0) {
    result.dimensionsEvaluated = result.dimensions.length;
  }

  if (result.selectedDimensions.length === 0 && result.dimensions.length > 0) {
    const inferred = result.dimensions
      .filter((d) => d.score >= 4)
      .map((d) => d.name);
    result.selectedDimensions = inferred.length > 0
      ? inferred
      : result.dimensions.map((d) => d.name);
  }

  if (result.dimensionsSelected === 0 && result.selectedDimensions.length > 0) {
    result.dimensionsSelected = result.selectedDimensions.length;
  }

  return result;
}

function parseResearchPlanFromClarifications(
  clarificationsData: ClarificationsFile,
): ResearchPlanData | null {
  const metadata = clarificationsData.metadata as typeof clarificationsData.metadata & {
    research_plan?: ResearchPlanJson;
  };
  const rawPlan = metadata.research_plan;
  if (!rawPlan || typeof rawPlan !== "object") return null;
  return {
    purpose: rawPlan.purpose ?? "",
    domain: rawPlan.domain ?? "",
    topicRelevance: rawPlan.topic_relevance ?? "",
    dimensionsEvaluated: rawPlan.dimensions_evaluated ?? 0,
    dimensionsSelected: rawPlan.dimensions_selected ?? 0,
    dimensions: Array.isArray(rawPlan.dimension_scores)
      ? rawPlan.dimension_scores.map((d) => ({
        name: d.name,
        score: d.score,
        reason: d.reason,
      }))
      : [],
    selectedDimensions: Array.isArray(rawPlan.selected_dimensions)
      ? rawPlan.selected_dimensions
          .map((d) => d?.name)
          .filter((name): name is string => typeof name === "string" && name.trim().length > 0)
      : [],
  };
}

// ─── Component ────────────────────────────────────────────────────────────────

// ─── Outcome helpers ─────────────────────────────────────────────────────────

type OutcomeState = "ok" | "error" | "scope_guard" | "low_score";

function getOutcomeState(meta: ClarificationsFile["metadata"]): OutcomeState {
  if (meta.error) return "error";
  if (meta.warning?.code === "scope_guard_triggered") return "scope_guard";
  if (meta.warning?.code === "all_dimensions_low_score") return "low_score";
  return "ok";
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
  const plan = parseResearchPlanFromClarifications(clarificationsData)
    ?? parseResearchPlan(researchPlan ?? "");
  const { answered, total } = getTotalCounts(clarificationsData);
  const meta = clarificationsData.metadata;
  const noteCount = clarificationsData.notes.length;
  const warnCount = clarificationsData.notes.filter((n) => n.type === "blocked" || n.type === "critical_gap").length;

  const sortedDimensions = [...plan.dimensions].sort((a, b) => b.score - a.score);

  const dimPct = plan.dimensionsEvaluated > 0
    ? Math.round((plan.dimensionsSelected / plan.dimensionsEvaluated) * 100)
    : 0;

  const outcome = getOutcomeState(meta);
  const isNonHappyPath = outcome !== "ok";

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
    low_score: {
      icon: <AlertTriangle className="size-5 shrink-0 text-amber-600 dark:text-amber-400" />,
      label: "No Dimensions Selected",
      labelClass: "text-sm font-semibold tracking-tight text-amber-600 dark:text-amber-400",
    },
  }[outcome];

  // Dimensions column (shown for "ok" and "low_score")
  const showDimensions = outcome === "ok" || outcome === "low_score";
  // Full stats grid (Clarifications + Notes) only for happy path
  const showFullStats = outcome === "ok";

  // Banner for non-happy-path outcomes
  const banner = isNonHappyPath ? (
    outcome === "error" ? (
      <div className="flex items-start gap-2 px-4 py-3 bg-destructive/10 border-b text-destructive text-sm">
        <XCircle className="size-4 shrink-0 mt-0.5" />
        <div>
          <p className="font-medium">{meta.error?.message}</p>
        </div>
      </div>
    ) : (
      <div className="flex items-start gap-2 px-4 py-3 bg-amber-100 dark:bg-amber-900/30 border-b text-amber-700 dark:text-amber-300 text-sm">
        <AlertTriangle className="size-4 shrink-0 mt-0.5" />
        <div>
          <p className="font-medium">{meta.warning?.message}</p>
          {meta.scope_reason && (
            <p className="mt-1 text-xs opacity-80">{meta.scope_reason}</p>
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
          {cost !== undefined && cost > 0 && (
            <span className="flex items-center gap-1">
              <DollarSign className="size-3" />
              ${cost.toFixed(4)}
            </span>
          )}
        </div>
      </button>

      {/* Banner — non-happy-path message */}
      {planExpanded && banner}

      {/* Stats Grid — collapsible; hidden for error/scope_guard */}
      {planExpanded && (showDimensions || showFullStats) && (
        <div className={`grid divide-x ${showFullStats ? "grid-cols-3" : "grid-cols-1"}`}>
          {/* Dimensions Column */}
          {showDimensions && (
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
              {sortedDimensions.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {sortedDimensions.map((dim) => {
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
              )}

              {/* Dimension reasons */}
              {sortedDimensions.length > 0 && (
                <div className="space-y-1.5">
                  {sortedDimensions.map((dim) => {
                    const isSelected = plan.selectedDimensions.includes(dim.name);
                    return (
                      <div
                        key={`${dim.name}-reason`}
                        className="rounded-md border bg-muted/40 px-2.5 py-1.5"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[11px] font-medium text-foreground">
                              {dim.name}
                            </span>
                            <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                              {dim.score}/5
                            </span>
                          </div>
                          <span
                            className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium"
                            style={{
                              borderColor: isSelected
                                ? "color-mix(in oklch, var(--color-pacific), transparent 40%)"
                                : "var(--border)",
                              background: isSelected
                                ? "color-mix(in oklch, var(--color-pacific), transparent 90%)"
                                : "transparent",
                              color: isSelected ? "var(--color-pacific)" : "var(--muted-foreground)",
                            }}
                          >
                            {isSelected ? "Selected" : "Evaluated"}
                          </span>
                        </div>
                        {dim.reason && (
                          <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                            {dim.reason}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Clarifications Column — happy path only */}
          {showFullStats && (
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
          )}

          {/* Notes Column — happy path only */}
          {showFullStats && (
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
          )}
        </div>
      )}

      {/* Reset-only footer — non-happy-path */}
      {planExpanded && resetFooter}
    </div>
  );

  // Non-happy-path: show only the summary card (no ClarificationsEditor)
  if (isNonHappyPath) {
    return <div className="flex flex-col gap-4">{summaryCard}</div>;
  }

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
