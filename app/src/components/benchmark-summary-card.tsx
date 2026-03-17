import { useState } from "react";
import { CheckCircle2, ChevronRight, AlertTriangle, TrendingUp, TrendingDown } from "lucide-react";

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
  notes?: string[];
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
  notes?: string[];
}

interface BenchmarkSummaryCardProps {
  benchmarkData: BenchmarkData | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function evalDisplayName(evalId: number): string {
  return `Eval ${evalId}`;
}

function passRateClass(rate: number): string {
  if (rate >= 0.8) return "";
  if (rate >= 0.5) return "text-amber-600 dark:text-amber-400";
  return "text-destructive";
}

function formatPassRate(rate: number): string {
  return `${(rate * 100).toFixed(0)}%`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function BenchmarkSummaryCard({ benchmarkData }: BenchmarkSummaryCardProps) {
  if (!benchmarkData) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-8">
        <AlertTriangle className="size-8 text-amber-600 dark:text-amber-400" />
        <div className="text-center">
          <p className="text-sm font-semibold">Benchmark data unavailable</p>
          <p className="mt-1 text-xs text-muted-foreground">
            The evaluation run did not produce benchmark results. This can happen if eval scripts failed.
          </p>
        </div>
      </div>
    );
  }

  const runs = benchmarkData.runs ?? [];
  const summary = benchmarkData.run_summary ?? {};
  const metadata = benchmarkData.metadata ?? {};

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

  // Overall status
  const allPassing = primaryPassRate !== undefined && primaryPassRate >= 1.0;
  const hasFailures = primaryPassRate !== undefined && primaryPassRate < 0.8;

  const headerIcon = hasFailures ? AlertTriangle : CheckCircle2;
  const HeaderIcon = headerIcon;
  const headerTitle = allPassing
    ? "All evaluations passing"
    : hasFailures
      ? "Some evaluations need attention"
      : "Benchmark complete";

  return (
    <div className="flex flex-col gap-4 min-w-0 overflow-hidden">
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
                  {headerTitle}
                </p>
                <p className="text-sm text-muted-foreground">
                  {evalIds.length} eval{evalIds.length !== 1 ? "s" : ""} run
                  {primaryPassRate !== undefined && ` · ${formatPassRate(primaryPassRate)} with skill`}
                  {baselinePassRate !== undefined && ` · ${formatPassRate(baselinePassRate)} baseline`}
                </p>
              </div>
            </div>

            {/* Status chips */}
            <div className="flex flex-wrap items-center gap-2 pl-7">
              <StatusChip label={`${evalIds.length} evals`} />
              {metadata.runs_per_configuration && (
                <StatusChip label={`${metadata.runs_per_configuration} runs each`} />
              )}
              {metadata.timestamp && (
                <StatusChip label={new Date(metadata.timestamp).toLocaleDateString()} />
              )}
            </div>
          </div>
        </div>
      </div>

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
    <div className="rounded-lg border overflow-hidden">
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
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${passRateClass(primaryAvg)}`}
          style={primaryAvg >= 0.8 ? {
            color: "var(--color-seafoam)",
            background: "color-mix(in oklch, var(--color-seafoam), transparent 85%)",
          } : primaryAvg >= 0.5 ? {
            color: "rgb(217 119 6)",
            background: "color-mix(in oklch, rgb(217 119 6), transparent 85%)",
          } : {
            color: "var(--destructive)",
            background: "color-mix(in oklch, var(--destructive), transparent 85%)",
          }}
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

function AssertionRow({
  assertion,
  configs,
  runs,
}: {
  assertion: string;
  configs: string[];
  runs: BenchmarkRun[];
}) {
  const [showEvidence, setShowEvidence] = useState(false);

  // Collect evidence from first run that has it
  let evidence: string | undefined;
  for (const run of runs) {
    const exp = run.expectations?.find((e) => e.text === assertion);
    if (exp?.evidence) {
      evidence = exp.evidence;
      break;
    }
  }

  return (
    <>
      <tr
        className="border-b last:border-b-0 hover:bg-muted/20 transition-colors duration-150 cursor-pointer"
        onClick={() => evidence && setShowEvidence(!showEvidence)}
      >
        <td className="px-3 py-2 text-xs">{assertion}</td>
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
