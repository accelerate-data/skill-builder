import { useState, useEffect, useRef } from "react";
import { CheckCircle2, Clock, DollarSign, GitBranch, Shield, AlertTriangle, ChevronRight, ChevronDown } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface DecisionFrontmatter {
  decision_count: number;
  conflicts_resolved: number;
  round: number;
  contradictory_inputs?: true | "revised";
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

function parseFrontmatter(content: string): DecisionFrontmatter {
  const defaults: DecisionFrontmatter = { decision_count: 0, conflicts_resolved: 0, round: 1 };
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return defaults;
  const fm = fmMatch[1];
  for (const line of fm.split("\n")) {
    const [key, ...rest] = line.split(":");
    const value = rest.join(":").trim();
    switch (key.trim()) {
      case "decision_count": defaults.decision_count = parseInt(value) || 0; break;
      case "conflicts_resolved": defaults.conflicts_resolved = parseInt(value) || 0; break;
      case "round": defaults.round = parseInt(value) || 1; break;
      case "contradictory_inputs":
        if (value === "true") defaults.contradictory_inputs = true;
        else if (value === "revised") defaults.contradictory_inputs = "revised";
        break;
    }
  }
  return defaults;
}

export function parseDecisions(content: string): Decision[] {
  const decisions: Decision[] = [];
  const body = content.replace(/^---[\s\S]*?---\n*/, "");
  const sections = body.split(/(?=^### D\d+)/m).filter((s) => s.trim());

  for (const section of sections) {
    const headingMatch = section.match(/^### (D\d+):\s*(.+)/);
    if (!headingMatch) continue;

    const id = headingMatch[1];
    const title = headingMatch[2].trim();
    const lines = section.split("\n");

    let originalQuestion = "";
    let decision = "";
    let implication = "";
    let status: Decision["status"] = "resolved";

    for (const line of lines) {
      const oq = line.match(/^\s*-?\s*\*\*Original question:\*\*\s*(.*)/);
      if (oq) { originalQuestion = oq[1].trim(); continue; }
      const dec = line.match(/^\s*-?\s*\*\*Decision:\*\*\s*(.*)/);
      if (dec) { decision = dec[1].trim(); continue; }
      const imp = line.match(/^\s*-?\s*\*\*Implication:\*\*\s*(.*)/);
      if (imp) { implication = imp[1].trim(); continue; }
      const st = line.match(/^\s*-?\s*\*\*Status:\*\*\s*(.*)/);
      if (st) {
        const val = st[1].trim();
        if (val === "conflict-resolved" || val === "needs-review") status = val;
        else status = "resolved";
      }
    }

    decisions.push({ id, title, originalQuestion, decision, implication, status });
  }
  return decisions;
}

/** Serialize Decision[] back to decisions.md format.
 *  Upgrades `contradictory_inputs: true` → `contradictory_inputs: revised`
 *  to signal the user has reviewed and accepted the flagged decisions.
 */
export function serializeDecisions(decisions: Decision[], rawFrontmatter: string): string {
  const updatedFm = rawFrontmatter.replace(
    /contradictory_inputs:\s*true/,
    "contradictory_inputs: revised"
  );
  const blocks = decisions.map((d) =>
    [
      `### ${d.id}: ${d.title}`,
      `- **Original question:** ${d.originalQuestion}`,
      `- **Decision:** ${d.decision}`,
      `- **Implication:** ${d.implication}`,
      `- **Status:** ${d.status}`,
    ].join("\n")
  );
  return `${updatedFm}\n\n${blocks.join("\n\n")}\n`;
}

function extractRawFrontmatter(content: string): string {
  const match = content.match(/^(---[\s\S]*?---)/);
  return match ? match[1] : "";
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
  const fm = parseFrontmatter(decisionsContent);
  const rawFrontmatter = extractRawFrontmatter(decisionsContent);

  const [decisions, setDecisions] = useState<Decision[]>(() => parseDecisions(decisionsContent));
  const [summaryExpanded, setSummaryExpanded] = useState(true);
  // Track whether the user has made any edit this session — used to show revised banner immediately
  const [wasEdited, setWasEdited] = useState(false);

  useEffect(() => {
    setDecisions(parseDecisions(decisionsContent));
    setWasEdited(false);
  }, [decisionsContent]);

  const resolvedCount = decisions.filter((d) => d.status === "resolved").length;
  const conflictResolvedCount = decisions.filter((d) => d.status === "conflict-resolved").length;
  const needsReviewCount = decisions.filter((d) => d.status === "needs-review").length;

  // Effective contradictory state: upgrade true → "revised" once the user edits
  const effectiveContradictory = wasEdited && fm.contradictory_inputs === true
    ? "revised"
    : fm.contradictory_inputs;

  function handleDecisionChange(updated: Decision) {
    const next = decisions.map((d) => (d.id === updated.id ? updated : d));
    setDecisions(next);
    setWasEdited(true);
    onDecisionsChange?.(serializeDecisions(next, rawFrontmatter));
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

      {/* Decision Cards */}
      {decisions.map((d) => (
        <DecisionCard
          key={d.id}
          decision={d}
          allowEdit={allowEdit}
          onChange={handleDecisionChange}
        />
      ))}
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

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

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
