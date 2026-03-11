import { useState, useEffect, useRef } from "react";
import { CheckCircle2, Clock, DollarSign, GitBranch, Shield, AlertTriangle, ChevronRight, ChevronDown } from "lucide-react";
import { Switch } from "@/components/ui/switch";

// ─── Types ────────────────────────────────────────────────────────────────────

interface DecisionFrontmatter {
  decision_count: number;
  conflicts_resolved: number;
  round: number;
  contradictory_inputs?: true | "revised";
  scope_recommendation?: true;
}

export interface Decision {
  id: string;
  title: string;
  originalQuestion: string;
  decision: string;
  implication: string;
  status: "resolved" | "conflict-resolved" | "needs-review";
}

interface DecisionsSummaryCardProps {
  decisionsContent: string;
  duration?: number;
  cost?: number;
  allowEdit?: boolean;
  onDecisionsChange?: (serialized: string) => void;
}

// ─── Parsers & Serializers ────────────────────────────────────────────────────

interface DecisionsJsonFile {
  version?: string;
  metadata?: DecisionFrontmatter;
  decisions?: Decision[];
}

const DEFAULT_METADATA: DecisionFrontmatter = { decision_count: 0, conflicts_resolved: 0, round: 1 };

function parseDecisionsFile(content: string): {
  metadata: DecisionFrontmatter;
  decisions: Decision[];
} {
  try {
    const parsed = JSON.parse(content) as DecisionsJsonFile;
    const decisions = Array.isArray(parsed.decisions) ? parsed.decisions : [];
    const metadata = parsed.metadata ?? { ...DEFAULT_METADATA, decision_count: decisions.length };
    return { metadata, decisions };
  } catch {
    return { metadata: { ...DEFAULT_METADATA }, decisions: [] };
  }
}

export function parseDecisions(content: string): Decision[] {
  return parseDecisionsFile(content).decisions;
}

/** Serialize Decision[] back to decisions JSON content.
 *  Upgrades `contradictory_inputs: true` → `contradictory_inputs: "revised"`
 *  only when `allReviewed` signals that the user has addressed all flagged decisions.
 */
export function serializeDecisions(decisions: Decision[], rawContent: string, allReviewed = false): string {
  const parsed = parseDecisionsFile(rawContent);
  const metadata: DecisionFrontmatter = {
    ...parsed.metadata,
    decision_count: decisions.length,
    conflicts_resolved: decisions.filter((d) => d.status === "conflict-resolved").length,
  };
  // When all needs-review decisions have been addressed, upgrade the guard
  // and flip their status to "resolved" so the state survives round-trips.
  const finalDecisions = allReviewed
    ? decisions.map((d) => d.status === "needs-review" ? { ...d, status: "resolved" as const } : d)
    : decisions;
  if (metadata.contradictory_inputs === true && allReviewed) {
    metadata.contradictory_inputs = "revised";
  }
  const payload: DecisionsJsonFile = {
    version: "1",
    metadata,
    decisions: finalDecisions,
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function DecisionsSummaryCard({
  decisionsContent,
  duration,
  cost,
  allowEdit,
  onDecisionsChange,
}: DecisionsSummaryCardProps) {
  const parsedFile = parseDecisionsFile(decisionsContent);
  const fm = parsedFile.metadata;

  const [decisions, setDecisions] = useState<Decision[]>(() => parsedFile.decisions);
  const [summaryExpanded, setSummaryExpanded] = useState(true);
  const [showNeedsReviewOnly, setShowNeedsReviewOnly] = useState(false);
  // Track which needs-review decisions the user has edited (by decision id).
  const [editedIds, setEditedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    setDecisions(parseDecisionsFile(decisionsContent).decisions);
    setEditedIds(new Set());
  }, [decisionsContent]);

  const resolvedCount = decisions.filter((d) => d.status === "resolved").length;
  const conflictResolvedCount = decisions.filter((d) => d.status === "conflict-resolved").length;
  const needsReviewDecisions = decisions.filter((d) => d.status === "needs-review");
  const needsReviewCount = needsReviewDecisions.length;
  const visibleDecisions = showNeedsReviewOnly
    ? needsReviewDecisions
    : decisions;

  // All needs-review decisions have been touched by the user.
  const allNeedsReviewEdited = needsReviewCount > 0
    ? needsReviewDecisions.every((d) => editedIds.has(d.id))
    : editedIds.size > 0; // edge case: user edited last needs-review, count already 0 on re-parse

  // Effective contradictory state: upgrade true → "revised" only once ALL
  // needs-review decisions have been addressed by the user.
  const effectiveContradictory = allNeedsReviewEdited && fm.contradictory_inputs === true
    ? "revised"
    : fm.contradictory_inputs;

  function handleDecisionChange(updated: Decision) {
    const next = decisions.map((d) => (d.id === updated.id ? updated : d));
    const nextEditedIds = new Set(editedIds).add(updated.id);
    setDecisions(next);
    setEditedIds(nextEditedIds);
    // Check if all needs-review decisions are now edited (including this one)
    const nextNeedsReview = next.filter((d) => d.status === "needs-review");
    const allEdited = nextNeedsReview.length > 0
      ? nextNeedsReview.every((d) => nextEditedIds.has(d.id))
      : true;
    onDecisionsChange?.(serializeDecisions(next, decisionsContent, allEdited));
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Summary Card */}
      <div className="rounded-lg border shadow-sm overflow-hidden">
        {/* Header — collapsible */}
        <button
          type="button"
          className="flex w-full items-center gap-3 px-5 py-3 border-b bg-muted/30 text-left cursor-pointer"
          onClick={() => setSummaryExpanded((prev) => !prev)}
        >
          {summaryExpanded ? (
            <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform duration-150" />
          ) : (
            <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform duration-150" />
          )}
          <CheckCircle2 className="size-5 shrink-0" style={{ color: "var(--color-seafoam)" }} />
          <span className="text-sm font-semibold tracking-tight text-foreground">
            Decisions Complete
          </span>
          <div className="flex-1" />
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            {duration !== undefined && (
              <span className="flex items-center gap-1">
                <Clock className="size-3" />
                {formatDuration(duration)}
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

        {/* Contradictory inputs banner */}
        {effectiveContradictory === true && (
          <div className="flex items-center gap-2 border-b bg-destructive/10 px-5 py-2 text-xs text-destructive font-medium">
            <AlertTriangle className="size-3.5" />
            Contradictory inputs detected — some answers are logically incompatible. Review decisions marked "needs-review" before generating the skill.
          </div>
        )}
        {effectiveContradictory === "revised" && (
          <div
            className="flex items-center gap-2 border-b px-5 py-2 text-xs font-medium"
            style={{
              background: "color-mix(in oklch, var(--color-seafoam), transparent 90%)",
              color: "var(--color-seafoam)",
            }}
          >
            <CheckCircle2 className="size-3.5" />
            Contradictions reviewed — skill will be generated with your edits.
          </div>
        )}

        {/* needs-review editing hint — only shown before user has edited */}
        {allowEdit && needsReviewCount > 0 && effectiveContradictory !== "revised" && (
          <div className="flex items-center gap-2 border-b bg-amber-50 dark:bg-amber-950/20 px-5 py-2 text-xs text-amber-600 dark:text-amber-400 font-medium">
            <AlertTriangle className="size-3.5" />
            {needsReviewCount} decision{needsReviewCount > 1 ? "s" : ""} need your review — edit the text below, changes save automatically.
          </div>
        )}

        {/* Stats Grid — collapsible */}
        {summaryExpanded && <div className="grid grid-cols-2 divide-x">
          {/* Decisions Column */}
          <div className="p-4">
            <div className="flex items-center gap-1.5 mb-3">
              <GitBranch className="size-3.5" style={{ color: "var(--color-pacific)" }} />
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Decisions
              </span>
            </div>
            <div className="flex items-baseline gap-1.5 mb-2">
              <span className="text-2xl font-semibold tracking-tight" style={{ color: "var(--color-pacific)" }}>
                {fm.decision_count}
              </span>
              <span className="text-xs text-muted-foreground">total</span>
            </div>
            <div className="flex flex-col gap-1.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Resolved</span>
                <span className="font-medium text-foreground">{resolvedCount}</span>
              </div>
              {conflictResolvedCount > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Conflict-resolved</span>
                  <span className="font-medium" style={{ color: "var(--color-ocean)" }}>{conflictResolvedCount}</span>
                </div>
              )}
              {needsReviewCount > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Needs review</span>
                  <span className="font-medium text-destructive">{needsReviewCount}</span>
                </div>
              )}
            </div>
          </div>

          {/* Quality Column */}
          <div className="p-4">
            <div className="flex items-center gap-1.5 mb-3">
              <Shield className="size-3.5" style={{ color: "var(--color-ocean)" }} />
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Quality
              </span>
            </div>
            <div className="flex items-baseline gap-1.5 mb-2">
              <span className="text-2xl font-semibold tracking-tight" style={{ color: "var(--color-ocean)" }}>
                {fm.conflicts_resolved}
              </span>
              <span className="text-xs text-muted-foreground">reconciled</span>
            </div>
            {effectiveContradictory === true ? (
              <div className="flex items-center gap-1.5 text-xs text-destructive font-medium">
                <AlertTriangle className="size-3" />
                Contradictions — review required
              </div>
            ) : effectiveContradictory === "revised" ? (
              <div className="flex items-center gap-1.5 text-xs font-medium" style={{ color: "var(--color-seafoam)" }}>
                <CheckCircle2 className="size-3" />
                Reviewed — proceeding with edits
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No unresolvable contradictions</p>
            )}
          </div>

        </div>}
      </div>

      {/* Decision filter */}
      {needsReviewCount > 0 && (
        <div className="flex items-center justify-end gap-2 px-1">
          <span className="text-xs text-muted-foreground">Needs Review</span>
          <Switch
            size="sm"
            aria-label="Needs Review"
            checked={showNeedsReviewOnly}
            onCheckedChange={setShowNeedsReviewOnly}
          />
        </div>
      )}

      {/* Decision Cards */}
      {visibleDecisions.map((d) => (
        <DecisionCard
          key={d.id}
          decision={d}
          allowEdit={allowEdit}
          onChange={handleDecisionChange}
        />
      ))}
      {showNeedsReviewOnly && visibleDecisions.length === 0 && (
        <div className="rounded-md border border-dashed px-4 py-3 text-sm text-muted-foreground">
          No decisions need review.
        </div>
      )}
    </div>
  );
}

// ─── Decision Card ────────────────────────────────────────────────────────────

const statusColors: Record<Decision["status"], { border: string; badge: string; badgeBg: string }> = {
  resolved: {
    border: "var(--color-seafoam)",
    badge: "var(--color-seafoam)",
    badgeBg: "color-mix(in oklch, var(--color-seafoam), transparent 85%)",
  },
  "conflict-resolved": {
    border: "var(--color-ocean)",
    badge: "var(--color-ocean)",
    badgeBg: "color-mix(in oklch, var(--color-ocean), transparent 85%)",
  },
  "needs-review": {
    border: "var(--destructive)",
    badge: "var(--destructive)",
    badgeBg: "color-mix(in oklch, var(--destructive), transparent 85%)",
  },
};

function AutoResizeTextarea({
  value,
  onChange,
  className,
  style,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
  style?: React.CSSProperties;
  placeholder?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const syncHeight = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };

  useEffect(() => {
    syncHeight();
  }, [value]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Recalculate height when container width changes (pane resize/sidebar toggle).
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(() => {
        syncHeight();
      });
      observer.observe(el);
      return () => observer.disconnect();
    }

    // Fallback for environments without ResizeObserver support.
    const onResize = () => syncHeight();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return (
    <textarea
      ref={ref}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={className}
      style={{ resize: "none", overflow: "hidden", ...style }}
      rows={1}
    />
  );
}

function DecisionCard({
  decision,
  allowEdit,
  onChange,
}: {
  decision: Decision;
  allowEdit?: boolean;
  onChange?: (updated: Decision) => void;
}) {
  const isEditable = allowEdit && decision.status === "needs-review";
  const [expanded, setExpanded] = useState(isEditable ?? false);
  const colors = statusColors[decision.status];

  return (
    <div
      className="rounded-lg border shadow-sm overflow-hidden"
      style={{ borderLeftWidth: "3px", borderLeftColor: colors.border }}
    >
      {/* Header — click to expand */}
      <button
        type="button"
        className="flex w-full cursor-pointer items-start gap-3 bg-muted/40 px-4 py-3 text-left select-none transition-colors duration-150 hover:bg-muted/70"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="mt-0.5 shrink-0 font-mono text-[11px] font-medium text-muted-foreground tabular-nums">
          {decision.id}
        </span>
        <span className="flex-1 text-sm font-semibold leading-snug tracking-tight text-foreground">
          {decision.title}
        </span>
        <span
          className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium"
          style={{ background: colors.badgeBg, color: colors.badge, border: `1px solid ${colors.badge}40` }}
        >
          {decision.status === "conflict-resolved" ? "conflict" : decision.status}
        </span>
        <ChevronRight
          className="mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform duration-150"
          style={{ transform: expanded ? "rotate(90deg)" : "rotate(0deg)" }}
        />
      </button>

      {/* Collapsed preview — show decision text */}
      {!expanded && decision.decision && (
        <div className="bg-muted/40 px-4 pb-2.5">
          <span className="truncate text-xs italic" style={{ color: "var(--color-pacific)" }}>
            {decision.decision}
          </span>
        </div>
      )}

      {/* Expanded body */}
      {expanded && (
        <div className="border-t bg-card p-4 space-y-3">
          {/* Original question */}
          {decision.originalQuestion && (
            <div>
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Original question
              </span>
              <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">
                {decision.originalQuestion}
              </p>
            </div>
          )}

          {/* Decision */}
          <div>
            <span className="text-[11px] font-medium uppercase tracking-wide" style={{ color: "var(--color-pacific)" }}>
              Decision
            </span>
            {isEditable ? (
              <AutoResizeTextarea
                value={decision.decision}
                onChange={(v) => onChange?.({ ...decision, decision: v })}
                placeholder="Enter decision…"
                className="mt-1 w-full rounded-md border border-border bg-transparent px-2 py-1.5 text-sm text-foreground leading-relaxed focus:outline-none focus:ring-1 focus:ring-offset-0"
              />
            ) : (
              <p className="mt-0.5 text-sm text-foreground leading-relaxed">
                {decision.decision}
              </p>
            )}
          </div>

          {/* Implication */}
          {(decision.implication || isEditable) && (
            <div
              className="rounded-md border px-3 py-2"
              style={{
                borderColor: "color-mix(in oklch, var(--color-ocean), transparent 70%)",
                background: "color-mix(in oklch, var(--color-ocean), transparent 92%)",
              }}
            >
              <span className="text-[11px] font-medium uppercase tracking-wide" style={{ color: "var(--color-ocean)" }}>
                Implication
              </span>
              {isEditable ? (
                <AutoResizeTextarea
                  value={decision.implication}
                  onChange={(v) => onChange?.({ ...decision, implication: v })}
                  placeholder="Enter implication…"
                  className="mt-1 w-full rounded-md border border-border bg-transparent px-2 py-1.5 text-xs leading-relaxed focus:outline-none focus:ring-1 focus:ring-offset-0"
                  style={{ color: "var(--color-ocean)" }}
                />
              ) : (
                <p className="mt-0.5 text-xs leading-relaxed" style={{ color: "var(--color-ocean)" }}>
                  {decision.implication}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
