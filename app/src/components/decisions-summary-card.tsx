import { useState, useEffect, useRef } from "react";
import { CheckCircle2, GitBranch, AlertTriangle, ChevronRight } from "lucide-react";
import { Switch } from "@/components/ui/switch";

// ─── Types ────────────────────────────────────────────────────────────────────

interface DecisionsMetadata {
  decision_count: number;
  conflicts_resolved: number;
  round: number;
  contradictory_inputs?: true | "revised";
  scope_recommendation?: true;
}

export interface Decision {
  id: string;
  title: string;
  original_question: string;
  decision: string;
  implication: string;
  status: "resolved" | "conflict-resolved" | "needs-review" | "revised";
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
  metadata?: DecisionsMetadata;
  decisions?: Decision[];
}

const DEFAULT_METADATA: DecisionsMetadata = { decision_count: 0, conflicts_resolved: 0, round: 1 };

function parseDecisionsFile(content: string): {
  metadata: DecisionsMetadata;
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
 *  Decisions carry their own status ("revised", "resolved", etc.) — no mapping needed.
 *  Upgrades `contradictory_inputs: true` → `"revised"` when no decisions are "needs-review".
 */
export function serializeDecisions(decisions: Decision[], rawContent: string): string {
  const parsed = parseDecisionsFile(rawContent);
  const metadata: DecisionsMetadata = {
    ...parsed.metadata,
    decision_count: decisions.length,
    conflicts_resolved: decisions.filter((d) => d.status === "conflict-resolved").length,
  };
  // Upgrade contradictory_inputs when all needs-review have been addressed
  const hasNeedsReview = decisions.some((d) => d.status === "needs-review");
  const hasRevised = decisions.some((d) => d.status === "revised");
  if (metadata.contradictory_inputs === true && !hasNeedsReview && hasRevised) {
    metadata.contradictory_inputs = "revised";
  }
  const payload: DecisionsJsonFile = {
    version: "1",
    metadata,
    decisions,
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
  const [showNeedsReviewOnly, setShowNeedsReviewOnly] = useState(false);

  useEffect(() => {
    setDecisions(parseDecisionsFile(decisionsContent).decisions);
  }, [decisionsContent]);

  const resolvedCount = decisions.filter((d) => d.status === "resolved").length;
  const conflictResolvedCount = decisions.filter((d) => d.status === "conflict-resolved").length;
  const revisedCount = decisions.filter((d) => d.status === "revised").length;
  const needsReviewDecisions = decisions.filter((d) => d.status === "needs-review");
  const needsReviewCount = needsReviewDecisions.length;
  const visibleDecisions = showNeedsReviewOnly
    ? needsReviewDecisions
    : decisions;

  // Effective contradictory state: upgrade true → "revised" when no needs-review left
  const effectiveContradictory = fm.contradictory_inputs === true
    ? (needsReviewCount > 0 ? true : (revisedCount > 0 ? "revised" : true))
    : fm.contradictory_inputs;

  const headerState = needsReviewCount > 0 || effectiveContradictory === true
    ? "review-required"
    : effectiveContradictory === "revised"
      ? "ready-with-edits"
      : "ready";

  const headerTone = headerState === "review-required"
    ? {
        icon: AlertTriangle,
        iconClassName: "text-amber-600 dark:text-amber-400",
        panelClassName: "border-border",
        chipClassName: "border-border",
      }
    : {
        icon: CheckCircle2,
        iconClassName: "",
        panelClassName: "border-border bg-muted/30",
        chipClassName: "border-border bg-background/80 text-muted-foreground",
      };

  const headerTitle = headerState === "review-required"
    ? `${needsReviewCount} decision${needsReviewCount === 1 ? " needs" : "s need"} your review`
    : headerState === "ready-with-edits"
      ? "All decisions reviewed"
      : "Decisions confirmed";

  const headerDescription = headerState === "review-required"
    ? "Review the highlighted decisions below. Changes save when you leave each field."
    : headerState === "ready-with-edits"
      ? "No blocking contradictions remain. You can generate the skill with your edits."
      : "No contradictions were found. You can proceed to Generate Skill.";

  const HeaderIcon = headerTone.icon;

  // Called on every keystroke — update local decisions array only, no save
  function handleDecisionDraftChange(updated: Decision) {
    setDecisions((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
  }

  // Called on blur — flip status to "revised", serialize, notify parent
  function handleDecisionBlur(updated: Decision) {
    const blurred: Decision = updated.status === "needs-review"
      ? { ...updated, status: "revised" }
      : updated;
    const next = decisions.map((d) => (d.id === blurred.id ? blurred : d));
    setDecisions(next);
    onDecisionsChange?.(serializeDecisions(next, decisionsContent));
  }

  return (
    <div className="flex flex-col gap-4 min-w-0 overflow-hidden">
      {/* Summary Card */}
      <div className={`rounded-lg border shadow-sm overflow-hidden ${headerTone.panelClassName}`}>
        <div className="p-4">
          <div className="flex flex-col gap-4">
            <div className="flex items-start gap-3">
              <div className="mt-0.5">
                <HeaderIcon
                  className={`size-4 shrink-0 ${headerTone.iconClassName}`}
                  style={headerState === "review-required" ? undefined : { color: "var(--color-seafoam)" }}
                />
              </div>

              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center gap-2">
                  <p className="text-base font-semibold tracking-tight text-foreground">
                    {headerTitle}
                  </p>
                  <GitBranch className="size-3.5 shrink-0 text-muted-foreground" />
                </div>
                <p className="text-sm text-muted-foreground">
                  {headerDescription}
                </p>
              </div>

              <div className="flex items-center gap-2 self-start rounded-full border border-border bg-background/80 px-3 py-1.5">
                <span className="text-xs font-medium text-muted-foreground">Needs Review</span>
                <Switch
                  size="sm"
                  aria-label="Needs Review"
                  checked={showNeedsReviewOnly}
                  onCheckedChange={setShowNeedsReviewOnly}
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 pl-7">
              <StatusChip className={headerTone.chipClassName} label={`${fm.decision_count} total`} />
              <StatusChip className={headerTone.chipClassName} label={`${resolvedCount} resolved`} />
              {conflictResolvedCount > 0 && (
                <StatusChip className={headerTone.chipClassName} label={`${conflictResolvedCount} conflict resolved`} />
              )}
              {needsReviewCount > 0 && (
                <StatusChip
                  className={headerTone.chipClassName}
                  style={headerState === "review-required"
                    ? {
                        borderColor: "color-mix(in oklch, currentColor, transparent 70%)",
                        background: "color-mix(in oklch, currentColor, transparent 92%)",
                        color: "rgb(217 119 6)",
                      }
                    : undefined}
                  label={`${needsReviewCount} ${needsReviewCount === 1 ? "needs" : "need"} review`}
                />
              )}
              {revisedCount > 0 && (
                <StatusChip className={headerTone.chipClassName} label={`${revisedCount} revised`} />
              )}
              {duration !== undefined && (
                <StatusChip className={headerTone.chipClassName} label={formatDuration(duration)} />
              )}
              {cost !== undefined && cost > 0 && (
                <StatusChip className={headerTone.chipClassName} label={`$${cost.toFixed(4)}`} />
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Decision Cards */}
      {visibleDecisions.map((d) => (
        <DecisionCard
          key={d.id}
          decision={d}
          allowEdit={allowEdit}
          onChange={handleDecisionDraftChange}
          onBlur={handleDecisionBlur}
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

function StatusChip({ label, className, style }: { label: string; className?: string; style?: React.CSSProperties }) {
  return (
    <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${className ?? ""}`} style={style}>
      {label}
    </span>
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
  revised: {
    border: "var(--color-pacific)",
    badge: "var(--color-pacific)",
    badgeBg: "color-mix(in oklch, var(--color-pacific), transparent 85%)",
  },
};

function AutoResizeTextarea({
  value,
  onChange,
  onBlur,
  className,
  style,
  placeholder,
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  className?: string;
  style?: React.CSSProperties;
  placeholder?: string;
  ariaLabel?: string;
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
      aria-label={ariaLabel}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
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
  onBlur,
}: {
  decision: Decision;
  allowEdit?: boolean;
  onChange?: (updated: Decision) => void;
  onBlur?: (updated: Decision) => void;
}) {
  const isEditable = allowEdit && (decision.status === "needs-review" || decision.status === "revised");
  const [expanded, setExpanded] = useState(isEditable ?? false);
  // Auto-expand when the card becomes editable (e.g. review → update mode switch)
  useEffect(() => { if (isEditable) setExpanded(true); }, [isEditable]);
  // Local draft state for typing — propagated on blur
  const [draft, setDraft] = useState(decision);
  useEffect(() => { setDraft(decision); }, [decision]);

  const colors = statusColors[decision.status];

  function handleDraftChange(field: "decision" | "implication", value: string) {
    const updated = { ...draft, [field]: value };
    setDraft(updated);
    onChange?.(updated);
  }

  function handleBlur() {
    onBlur?.(draft);
  }

  return (
    <div
      className="rounded-lg border shadow-sm overflow-hidden min-w-0"
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
          {decision.status === "conflict-resolved"
            ? "conflict resolved"
            : decision.status === "needs-review"
              ? "needs review"
              : decision.status}
        </span>
        <ChevronRight
          className="mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform duration-150"
          style={{ transform: expanded ? "rotate(90deg)" : "rotate(0deg)" }}
        />
      </button>

      {/* Collapsed preview — show decision text */}
      {!expanded && draft.decision && (
        <div className="flex items-center gap-2 bg-muted/40 px-4 pb-2.5">
          <span
            className="flex-1 truncate text-xs italic"
            style={{ color: "var(--color-pacific)" }}
          >
            {draft.decision}
          </span>
        </div>
      )}

      {/* Expanded body */}
      {expanded && (
        <div className="border-t bg-card p-4 space-y-3 min-w-0">
          {/* Original question */}
          {draft.original_question && (
            <div>
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Original question
              </span>
              <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">
                {draft.original_question}
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
                value={draft.decision}
                onChange={(v) => handleDraftChange("decision", v)}
                onBlur={handleBlur}
                placeholder="Enter decision…"
                ariaLabel={`Decision for ${decision.title}`}
                className="mt-1 w-full rounded-md border border-border bg-transparent px-2 py-1.5 text-sm text-foreground leading-relaxed focus:outline-none focus:ring-1 focus:ring-offset-0"
              />
            ) : (
              <p className="mt-0.5 text-sm text-foreground leading-relaxed break-words">
                {draft.decision}
              </p>
            )}
          </div>

          {/* Implication */}
          {(draft.implication || isEditable) && (
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
                  value={draft.implication}
                  onChange={(v) => handleDraftChange("implication", v)}
                  onBlur={handleBlur}
                  placeholder="Enter implication…"
                  ariaLabel={`Implication for ${decision.title}`}
                  className="mt-1 w-full rounded-md border border-border bg-transparent px-2 py-1.5 text-xs leading-relaxed focus:outline-none focus:ring-1 focus:ring-offset-0"
                  style={{ color: "var(--color-ocean)" }}
                />
              ) : (
                <p className="mt-0.5 text-xs leading-relaxed break-words" style={{ color: "var(--color-ocean)" }}>
                  {draft.implication}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
