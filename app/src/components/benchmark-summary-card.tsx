import { useState } from "react";
import { CheckCircle2, ChevronRight, AlertTriangle, TrendingUp, TrendingDown } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { markdownComponents } from "@/components/markdown-link";
import { Button } from "@/components/ui/button";
import { formatElapsed } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface BenchmarkExpectation {
  text: string;
  passed: boolean;
  evidence?: string;
}

interface BenchmarkRunResult {
  pass_rate: number;
  passed: number;
  failed: number;
  total: number;
  time_seconds?: number;
  tokens?: number;
  tool_calls?: number;
  errors?: number;
}

interface BenchmarkRun {
  eval_id: number;
  configuration: string;
  run_number: number;
  result: BenchmarkRunResult;
  expectations?: BenchmarkExpectation[];
  notes?: string;
}

interface BenchmarkStat {
  mean: number;
  stddev: number;
  min: number;
  max: number;
}

interface BenchmarkConfigSummary {
  pass_rate: BenchmarkStat;
  time_seconds?: BenchmarkStat;
  tokens?: BenchmarkStat;
}

interface BenchmarkDelta {
  pass_rate: string;
  time_seconds?: string;
  tokens?: string;
}

interface BenchmarkMetadata {
  skill_name?: string;
  timestamp?: string;
  evals_run?: number[];
  runs_per_configuration?: number;
}

export interface BenchmarkData {
  metadata?: BenchmarkMetadata;
  runs?: BenchmarkRun[];
  run_summary?: Record<string, BenchmarkConfigSummary | BenchmarkDelta>;
  notes?: string;
}

interface BenchmarkSummaryCardProps {
  benchmarkData: BenchmarkData | null;
  /** "skipped" = agent reported no evals (stub); "missing" = expected but not found; "partial" = incomplete run; false = ok */
  status?: "skipped" | "missing" | "partial" | false;
  duration?: number;
  cost?: number;
  onResetStep?: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function evalDisplayName(evalId: number): string {
  return `Eval ${evalId}`;
}

function formatPassRate(rate: number): string {
  return `${(rate * 100).toFixed(0)}%`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function BenchmarkSummaryCard({ benchmarkData, status, duration, cost, onResetStep }: BenchmarkSummaryCardProps) {
  const [notesExpanded, setNotesExpanded] = useState(false);

  // Missing = benchmark.json expected but not found on disk — error state, offer reset
  if (status === "missing") {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-8">
        <AlertTriangle className="size-8 text-destructive/50" />
        <div className="text-center">
          <p className="font-medium text-destructive">Benchmark data missing</p>
          <p className="mt-1 text-xs text-muted-foreground">
            The evaluation run did not produce benchmark results. This can happen if the agent returned before graders finished.
          </p>
        </div>
        {onResetStep && (
          <Button variant="outline" size="sm" className="transition-colors duration-150" onClick={onResetStep}>
            Re-run Step
          </Button>
        )}
      </div>
    );
  }

  // Skipped = agent reported no evals (stub case) — show simple complete state
  if (status === "skipped" || !benchmarkData) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-8">
        <CheckCircle2 className="size-8" style={{ color: "var(--color-seafoam)" }} />
        <div className="text-center">
          <p className="text-sm font-semibold">Skill created</p>
          <p className="mt-1 text-xs text-muted-foreground">
            No evaluations were configured for this skill.
          </p>
        </div>
      </div>
    );
  }

  const runs = benchmarkData.runs ?? [];
  const summary = benchmarkData.run_summary ?? {};
  const metadata = benchmarkData.metadata ?? {};
  const notes = benchmarkData.notes ?? "";

  // Discover config names (everything except "delta")
  const configs = Object.keys(summary).filter((k) => k !== "delta");
  const primaryConfig = configs[0] ?? "with_skill";
  const baselineConfig = configs[1] ?? "without_skill";
  const primaryStats = summary[primaryConfig] as BenchmarkConfigSummary | undefined;
  const baselineStats = summary[baselineConfig] as BenchmarkConfigSummary | undefined;
  const delta = summary.delta as BenchmarkDelta | undefined;

  const primaryPassRate = primaryStats?.pass_rate?.mean;
  const baselinePassRate = baselineStats?.pass_rate?.mean;
  const deltaPassRate = delta?.pass_rate ? parseFloat(delta.pass_rate) : undefined;

  // Eval IDs
  const evalIds = [...new Set(runs.map((r) => r.eval_id))].sort((a, b) => a - b);

  // Aggregate assertion counts from primary config runs
  const primaryRuns = runs.filter((r) => r.configuration === primaryConfig);
  const totalAssertionsPassed = primaryRuns.reduce((sum, r) => sum + r.result.passed, 0);
  const totalAssertions = primaryRuns.reduce((sum, r) => sum + r.result.total, 0);
  const totalAssertionsFailed = totalAssertions - totalAssertionsPassed;

  // Overall status
  const allPassing = totalAssertions > 0 && totalAssertionsFailed === 0;
  const hasFailures = primaryPassRate !== undefined && primaryPassRate < 0.5;

  const HeaderIcon = hasFailures ? AlertTriangle : CheckCircle2;

  // Subtitle: human sentence about assertion results
  const subtitle = allPassing
    ? `Passes all ${totalAssertions} domain expectations across ${evalIds.length} evaluation${evalIds.length !== 1 ? "s" : ""}`
    : totalAssertionsFailed > 0
      ? `Passes ${totalAssertionsPassed} of ${totalAssertions} expectations — ${totalAssertionsFailed} need${totalAssertionsFailed === 1 ? "s" : ""} refinement`
      : `Tested against ${evalIds.length} evaluation${evalIds.length !== 1 ? "s" : ""}`;

  return (
    <div className="flex flex-col gap-4 min-w-0 overflow-hidden">
      {/* Partial benchmark warning banner */}
      {status === "partial" && (
        <div className="flex items-start gap-3 rounded-lg border p-4 bg-amber-100 dark:bg-amber-900/30">
          <AlertTriangle className="size-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
          <div>
            <p className="text-sm font-medium text-amber-600 dark:text-amber-400">Evaluation incomplete</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Some evaluations did not finish. Results below may be partial.
            </p>
          </div>
        </div>
      )}

      {/* Summary Card */}
      <div className="rounded-lg border shadow-sm overflow-hidden">
        <div className="p-4">
          <div className="flex flex-col gap-4">
            {/* Header */}
            <div className="flex items-start gap-3">
              <div className="mt-0.5">
                <HeaderIcon
                  className={`size-4 shrink-0 ${hasFailures ? "text-amber-600 dark:text-amber-400" : ""}`}
                  style={hasFailures ? undefined : { color: "var(--color-seafoam)" }}
                />
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                <p className="text-base font-semibold tracking-tight text-foreground">
                  Skill created
                  {metadata.skill_name && (
                    <span className="font-normal text-muted-foreground"> · {metadata.skill_name}/SKILL.md</span>
                  )}
                </p>
                <p className="text-sm text-muted-foreground">
                  {subtitle}
                </p>
              </div>
            </div>

            {/* Status chips */}
            <div className="flex flex-wrap items-center gap-2 pl-7">
              <StatusChip label={`${evalIds.length} evals`} />
              <StatusChip label={`${totalAssertionsPassed}/${totalAssertions} assertions`} />
              {duration !== undefined && (
                <StatusChip label={formatElapsed(duration)} />
              )}
              {cost !== undefined && cost > 0 && (
                <StatusChip label={`$${cost.toFixed(4)}`} />
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Analyst Notes — collapsible, positioned before delta for narrative flow */}
      {notes && (
        <div className="rounded-lg border shadow-sm overflow-hidden">
          <button
            type="button"
            className="flex w-full items-center gap-3 p-4 text-left hover:bg-muted/50 transition-colors duration-150"
            onClick={() => setNotesExpanded(!notesExpanded)}
          >
            <ChevronRight
              className={`size-3.5 shrink-0 text-muted-foreground transition-transform duration-150 ${notesExpanded ? "rotate-90" : ""}`}
            />
            <span className="text-xs font-medium text-muted-foreground">Analyst Observations</span>
          </button>
          {notesExpanded && (
            <div className="border-t px-4 pb-4 pt-2">
              <div className="prose prose-sm dark:prose-invert max-w-none [&_*]:text-sm [&_table]:text-xs [&_th]:text-xs [&_td]:text-xs">
                <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]} components={markdownComponents}>
                  {notes}
                </ReactMarkdown>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Delta Hero */}
      {deltaPassRate !== undefined && (
        <div
          className="rounded-lg border p-4"
          style={{
            background: deltaPassRate > 0
              ? "color-mix(in oklch, var(--color-seafoam), transparent 92%)"
              : deltaPassRate < 0
                ? "color-mix(in oklch, var(--destructive), transparent 92%)"
                : undefined,
          }}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {deltaPassRate > 0 ? (
                <TrendingUp className="size-5" style={{ color: "var(--color-seafoam)" }} />
              ) : deltaPassRate < 0 ? (
                <TrendingDown className="size-5 text-destructive" />
              ) : null}
              <div>
                <p
                  className="text-2xl font-semibold tracking-tight"
                  style={{
                    color: deltaPassRate > 0
                      ? "var(--color-seafoam)"
                      : deltaPassRate < 0
                        ? "var(--destructive)"
                        : undefined,
                  }}
                >
                  {deltaPassRate > 0 ? "+" : ""}{(deltaPassRate * 100).toFixed(0)}%
                </p>
                <p className="text-xs text-muted-foreground">pass rate improvement</p>
              </div>
            </div>

            <div className="flex gap-6">
              <div className="text-right">
                <p className="text-sm font-semibold" style={{ color: "var(--color-pacific)" }}>
                  {primaryPassRate !== undefined ? `${formatPassRate(primaryPassRate)} ± ${((primaryStats?.pass_rate?.stddev ?? 0) * 100).toFixed(0)}%` : "—"}
                </p>
                <p className="text-xs text-muted-foreground">With Skill</p>
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold text-muted-foreground">
                  {baselinePassRate !== undefined ? `${formatPassRate(baselinePassRate)} ± ${((baselineStats?.pass_rate?.stddev ?? 0) * 100).toFixed(0)}%` : "—"}
                </p>
                <p className="text-xs text-muted-foreground">Without Skill</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Per-Eval Breakdown */}
      {evalIds.map((evalId) => (
        <EvalAccordion
          key={evalId}
          evalId={evalId}
          runs={runs.filter((r) => r.eval_id === evalId)}
          configs={[primaryConfig, baselineConfig]}
        />
      ))}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusChip({ label }: { label: string }) {
  return (
    <span className="rounded-full border border-border bg-background/80 px-2.5 py-1 text-xs font-medium text-muted-foreground">
      {label}
    </span>
  );
}

function EvalAccordion({
  evalId,
  runs,
  configs,
}: {
  evalId: number;
  runs: BenchmarkRun[];
  configs: string[];
}) {
  const [expanded, setExpanded] = useState(false);

  const primaryRuns = runs.filter((r) => r.configuration === configs[0]);
  const primaryAvg = primaryRuns.length > 0
    ? primaryRuns.reduce((sum, r) => sum + r.result.pass_rate, 0) / primaryRuns.length
    : 0;

  const primaryPassed = primaryRuns.reduce((sum, r) => sum + r.result.passed, 0);
  const primaryTotal = primaryRuns.reduce((sum, r) => sum + r.result.total, 0);

  // Collect all unique assertions across all runs for this eval
  const allExpectations: BenchmarkExpectation[] = [];
  const seenTexts = new Set<string>();
  for (const run of runs) {
    for (const exp of run.expectations ?? []) {
      if (!seenTexts.has(exp.text)) {
        seenTexts.add(exp.text);
        allExpectations.push(exp);
      }
    }
  }

  return (
    <div className="rounded-lg border shadow-sm overflow-hidden">
      <button
        type="button"
        className="flex w-full items-center gap-3 p-3 text-left hover:bg-muted/50 transition-colors duration-150"
        onClick={() => setExpanded(!expanded)}
      >
        <ChevronRight
          className={`size-3.5 shrink-0 text-muted-foreground transition-transform duration-150 ${expanded ? "rotate-90" : ""}`}
        />
        <span className="flex-1 text-sm font-medium">
          {evalDisplayName(evalId)}
        </span>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            primaryAvg >= 0.8
              ? ""
              : primaryAvg >= 0.5
                ? "text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/30"
                : "text-destructive"
          }`}
          style={primaryAvg >= 0.8 ? {
            color: "var(--color-seafoam)",
            background: "color-mix(in oklch, var(--color-seafoam), transparent 85%)",
          } : primaryAvg < 0.5 ? {
            background: "color-mix(in oklch, var(--destructive), transparent 85%)",
          } : undefined}
        >
          {formatPassRate(primaryAvg)} ({primaryPassed}/{primaryTotal})
        </span>
      </button>

      {expanded && allExpectations.length > 0 && (
        <div className="border-t">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/30">
                <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Assertion</th>
                {configs.map((config) => (
                  <th key={config} className="px-3 py-2 text-center text-xs font-medium text-muted-foreground w-24">
                    {configLabel(config)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {allExpectations.map((exp, idx) => (
                <AssertionRow
                  key={idx}
                  assertion={exp.text}
                  hasEvidence={!!findEvidence(exp.text, runs)}
                  configs={configs}
                  runs={runs}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function configLabel(config: string): string {
  return config.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function findEvidence(assertion: string, runs: BenchmarkRun[]): string | undefined {
  for (const run of runs) {
    const exp = run.expectations?.find((e) => e.text === assertion);
    if (exp?.evidence) return exp.evidence;
  }
  return undefined;
}

function AssertionRow({
  assertion,
  hasEvidence,
  configs,
  runs,
}: {
  assertion: string;
  hasEvidence: boolean;
  configs: string[];
  runs: BenchmarkRun[];
}) {
  const [showEvidence, setShowEvidence] = useState(false);
  const evidence = hasEvidence ? findEvidence(assertion, runs) : undefined;

  return (
    <>
      <tr
        className={`border-b last:border-b-0 transition-colors duration-150 ${hasEvidence ? "hover:bg-muted/20 cursor-pointer" : ""}`}
        onClick={() => hasEvidence && setShowEvidence(!showEvidence)}
      >
        <td className="px-3 py-2 text-xs">
          <span className="flex items-center gap-1.5">
            {hasEvidence && (
              <ChevronRight
                className={`size-3 shrink-0 text-muted-foreground/50 transition-transform duration-150 ${showEvidence ? "rotate-90" : ""}`}
              />
            )}
            {assertion}
          </span>
        </td>
        {configs.map((config) => {
          const configRuns = runs.filter((r) => r.configuration === config);
          return (
            <td key={config} className="px-3 py-2 text-center">
              {configRuns.map((run) => {
                const exp = run.expectations?.find((e) => e.text === assertion);
                if (!exp) return <span key={run.run_number} className="text-muted-foreground">—</span>;
                return exp.passed ? (
                  <span key={run.run_number} style={{ color: "var(--color-seafoam)" }} className="text-sm font-medium">
                    ✓
                  </span>
                ) : (
                  <span key={run.run_number} className="text-sm font-medium text-destructive">
                    ✗
                  </span>
                );
              })}
            </td>
          );
        })}
      </tr>
      {showEvidence && evidence && (
        <tr>
          <td colSpan={configs.length + 1} className="px-3 py-2 bg-muted/20">
            <p className="text-xs text-muted-foreground leading-relaxed">{evidence}</p>
          </td>
        </tr>
      )}
    </>
  );
}
