import { useCallback, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { readGrading } from "@/lib/tauri";
import type { EvalAggregateSummary, EvalBenchmark, EvalBenchmarkRun } from "@/lib/types";

interface EvalRunBenchmarkCardProps {
  benchmark: EvalBenchmark;
  /** If provided, shows the Refine CTA when there are failures. */
  onRefine?: () => void;
}

function passRateClass(rate: number): string {
  if (rate >= 1.0) return "";
  if (rate > 0) return "text-amber-600 dark:text-amber-400";
  return "text-destructive";
}

/** Format pass rate as a percentage string. */
function fmt(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

function buildEvalRates(runs: EvalBenchmarkRun[]): Record<number, { eval_name: string; runRates: number[]; gradingPaths: string[] }> {
  const byId: Record<number, { eval_name: string; runRates: number[]; gradingPaths: string[] }> = {};
  if (!Array.isArray(runs)) return byId;
  for (const run of runs) {
    if (!Array.isArray(run.evals)) continue;
    for (const e of run.evals) {
      if (!byId[e.eval_id]) byId[e.eval_id] = { eval_name: e.eval_name, runRates: [], gradingPaths: [] };
      byId[e.eval_id].runRates.push(e.summary.pass_rate);
      if (e.grading_path) byId[e.eval_id].gradingPaths.push(e.grading_path);
    }
  }
  return byId;
}

function AggregateStat({ label, summary }: { label?: string; summary: EvalAggregateSummary }) {
  return (
    <div className="flex flex-col gap-2">
      {label && <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>}
      <div className="flex items-center gap-5">
        <div className="flex flex-col gap-0.5">
          <span
            className={`font-mono text-lg font-semibold leading-tight ${passRateClass(summary.avg_pass_rate)}`}
            style={summary.avg_pass_rate >= 1.0 ? { color: "var(--color-seafoam)" } : {}}
          >
            {fmt(summary.avg_pass_rate)}
          </span>
          <span className="text-[11px] text-muted-foreground">avg pass rate</span>
        </div>
        <Separator orientation="vertical" className="h-8" />
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-lg font-semibold leading-tight" style={{ color: "var(--color-seafoam)" }}>
            {summary.total_passed}
          </span>
          <span className="text-[11px] text-muted-foreground">passed</span>
        </div>
        <Separator orientation="vertical" className="h-8" />
        <div className="flex flex-col gap-0.5">
          <span className={`font-mono text-lg font-semibold leading-tight ${summary.total_failed > 0 ? "text-destructive" : "text-muted-foreground"}`}>
            {summary.total_failed}
          </span>
          <span className="text-[11px] text-muted-foreground">failed</span>
        </div>
      </div>
    </div>
  );
}

type GradingExpectation = { text: string; passed: boolean; evidence: string };

function PassFailIcon({ passed }: { passed: boolean }) {
  return passed
    ? <CheckCircle2 className="inline size-3.5" style={{ color: "var(--color-seafoam)" }} />
    : <XCircle className="inline size-3.5 text-destructive" />;
}

/** Single grading table for one variant — Expectation | Result | Evidence. */
function GradingTable({ label, expectations }: { label?: string; expectations: GradingExpectation[] }) {
  return (
    <div>
      {label && (
        <div className="px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground border-b">
          {label}
        </div>
      )}
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b text-[11px] text-muted-foreground">
            <th className="px-4 py-1.5 text-left font-medium">Expectation</th>
            <th className="px-2 py-1.5 text-center font-medium w-20">Result</th>
            <th className="px-4 py-1.5 text-left font-medium">Evidence</th>
          </tr>
        </thead>
        <tbody>
          {expectations.map((exp, i) => (
            <tr key={i} className="border-b last:border-b-0">
              <td className="px-4 py-2 align-top max-w-[200px]">
                <span className="text-xs leading-relaxed">{exp.text}</span>
              </td>
              <td className="px-2 py-2 text-center align-top">
                <PassFailIcon passed={exp.passed} />
              </td>
              <td className="px-4 py-2 align-top max-w-[300px]">
                <span className="text-[11px] leading-relaxed text-muted-foreground">{exp.evidence}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Expandable per-expectation details for one eval — renders separate tables per run/variant. */
function EvalExpectationsDetail({
  gradingPaths,
  baselineGradingPaths,
  primaryLabel,
  baselineLabel,
}: {
  gradingPaths: string[];
  baselineGradingPaths?: string[];
  primaryLabel?: string;
  baselineLabel?: string;
}) {
  // null = not loaded, undefined = loading
  const [allExpectations, setAllExpectations] = useState<GradingExpectation[][] | null>(null);
  const [baselineExpectations, setBaselineExpectations] = useState<GradingExpectation[] | null>(null);
  const [loading, setLoading] = useState(false);
  const isComparison = !!baselineGradingPaths && baselineGradingPaths.length > 0;
  const isMultiRun = !isComparison && gradingPaths.length > 1;

  const loadExpectations = useCallback(async () => {
    if (allExpectations || loading || gradingPaths.length === 0) return;
    setLoading(true);
    try {
      // Load all runs in parallel
      const results = await Promise.all(
        gradingPaths.map((p) => readGrading(p)),
      );
      setAllExpectations(results.map((g) => (g.expectations as GradingExpectation[] | undefined) ?? []));

      if (isComparison) {
        const baselineGrading = await readGrading(baselineGradingPaths![0]);
        setBaselineExpectations((baselineGrading.expectations as GradingExpectation[] | undefined) ?? []);
      }
    } catch (err) {
      console.error("[eval-benchmark] Failed to read grading:", err);
      setAllExpectations([]);
    } finally {
      setLoading(false);
    }
  }, [gradingPaths, baselineGradingPaths, allExpectations, loading, isComparison]);

  if (!allExpectations && !loading) {
    void loadExpectations();
    return <div className="px-4 py-2 text-[11px] text-muted-foreground">Loading expectations…</div>;
  }

  if (loading) {
    return <div className="px-4 py-2 text-[11px] text-muted-foreground">Loading expectations…</div>;
  }

  if (!allExpectations || allExpectations.length === 0 || allExpectations[0].length === 0) return null;

  return (
    <div className="bg-muted/20">
      {isMultiRun ? (
        // Multi-run non-comparison: one table per run
        allExpectations.map((exps, i) => (
          exps.length > 0 && (
            <GradingTable key={i} label={`Run ${i + 1}`} expectations={exps} />
          )
        ))
      ) : (
        // Single run or comparison mode
        <>
          <GradingTable
            label={isComparison ? primaryLabel ?? "Primary" : undefined}
            expectations={allExpectations[0]}
          />
          {isComparison && baselineExpectations && baselineExpectations.length > 0 && (
            <GradingTable
              label={baselineLabel ?? "Baseline"}
              expectations={baselineExpectations}
            />
          )}
        </>
      )}
    </div>
  );
}

export function EvalRunBenchmarkCard({
  benchmark,
  onRefine,
}: EvalRunBenchmarkCardProps) {
  const { aggregate_summary, baseline_aggregate_summary, runs, baseline_runs, iteration, run_count, eval_ids, comparison_mode } = benchmark;
  const hasFailures = aggregate_summary.has_failures;
  const isComparison = !!baseline_runs;

  // Track which eval rows are expanded to show expectations
  const [expandedEvalId, setExpandedEvalId] = useState<number | null>(null);

  const primaryLabel = comparison_mode === "current_vs_previous" ? "Current" : "With skill";
  const baselineLabel = comparison_mode === "current_vs_previous" ? "Previous" : "Without skill";

  // Build per-eval display data
  const primaryById = buildEvalRates(runs);
  const baselineById = isComparison ? buildEvalRates(baseline_runs!) : {};

  const evalRows = eval_ids
    .filter((id) => primaryById[id])
    .map((id) => ({
      eval_id: id,
      eval_name: primaryById[id].eval_name,
      runRates: primaryById[id].runRates,
      gradingPaths: primaryById[id].gradingPaths,
      baselineRunRates: baselineById[id]?.runRates,
      baselineGradingPaths: baselineById[id]?.gradingPaths,
    }));

  return (
    <div className="mt-4 rounded-lg border bg-card shadow-sm">
      {/* Header */}
      <div className="flex items-center gap-2 border-b px-4 py-2.5">
        <span className="text-sm font-semibold tracking-tight">Benchmark Summary</span>
        <Badge
          className="rounded-full px-2 py-0.5 text-xs font-medium"
          style={{ background: "var(--color-background)", color: "var(--color-muted-foreground)", border: "1px solid var(--color-border)" }}
        >
          iteration-{iteration}
        </Badge>
        <span className="ml-auto text-xs text-muted-foreground">
          {run_count} run{run_count > 1 ? "s" : ""} · {eval_ids.length} eval{eval_ids.length !== 1 ? "s" : ""} · {aggregate_summary.total_assertions} assertions
        </span>
      </div>

      {/* Aggregate stats */}
      <div className="border-b px-4 py-3">
        {isComparison ? (
          <div className="flex items-start gap-6">
            <AggregateStat label={primaryLabel} summary={aggregate_summary} />
            <Separator orientation="vertical" className="h-20 self-center" />
            <AggregateStat label={baselineLabel} summary={baseline_aggregate_summary!} />
            <div className="ml-auto self-center">
              {hasFailures ? (
                <span className="text-xs font-medium text-destructive">
                  {aggregate_summary.total_failed} failure{aggregate_summary.total_failed !== 1 ? "s" : ""} in {primaryLabel.toLowerCase()}
                </span>
              ) : (
                <span className="text-xs font-medium" style={{ color: "var(--color-seafoam)" }}>
                  ✓ {primaryLabel} passing
                </span>
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-5">
            <div className="flex flex-col gap-0.5">
              <span
                className={`font-mono text-lg font-semibold leading-tight ${passRateClass(aggregate_summary.avg_pass_rate)}`}
                style={aggregate_summary.avg_pass_rate >= 1.0 ? { color: "var(--color-seafoam)" } : {}}
              >
                {fmt(aggregate_summary.avg_pass_rate)}
              </span>
              <span className="text-[11px] text-muted-foreground">avg pass rate</span>
            </div>
            <Separator orientation="vertical" className="h-8" />
            <div className="flex flex-col gap-0.5">
              <span className="font-mono text-lg font-semibold leading-tight" style={{ color: "var(--color-seafoam)" }}>
                {aggregate_summary.total_passed}
              </span>
              <span className="text-[11px] text-muted-foreground">passed</span>
            </div>
            <Separator orientation="vertical" className="h-8" />
            <div className="flex flex-col gap-0.5">
              <span className={`font-mono text-lg font-semibold leading-tight ${aggregate_summary.total_failed > 0 ? "text-destructive" : "text-muted-foreground"}`}>
                {aggregate_summary.total_failed}
              </span>
              <span className="text-[11px] text-muted-foreground">failed</span>
            </div>
            <div className="ml-auto">
              {hasFailures ? (
                <span className="text-xs font-medium text-destructive">
                  {aggregate_summary.total_failed} failure{aggregate_summary.total_failed !== 1 ? "s" : ""} across {eval_ids.length} test{eval_ids.length !== 1 ? "s" : ""}
                </span>
              ) : (
                <span className="text-xs font-medium" style={{ color: "var(--color-seafoam)" }}>
                  ✓ All assertions passing
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Per-eval breakdown with expandable expectations */}
      {evalRows.length > 0 && (
        <div className="border-b">
          <div className="bg-muted/40 px-4 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {isComparison
              ? `${primaryLabel} vs ${baselineLabel}`
              : run_count > 1 ? "Per-eval · per-run breakdown" : "Per-eval results"}
          </div>
          {evalRows.map(({ eval_id, eval_name, runRates, gradingPaths, baselineRunRates, baselineGradingPaths }) => {
            const avgRate = runRates.length > 0
              ? runRates.reduce((s, r) => s + r, 0) / runRates.length
              : 0;
            const baselineAvgRate = baselineRunRates && baselineRunRates.length > 0
              ? baselineRunRates.reduce((s, r) => s + r, 0) / baselineRunRates.length
              : undefined;
            const delta = baselineAvgRate !== undefined ? avgRate - baselineAvgRate : undefined;
            const isExpanded = expandedEvalId === eval_id;
            return (
              <div key={eval_id}>
                <div
                  className="flex items-center gap-3 border-t px-4 py-2 text-xs cursor-pointer hover:bg-muted/30 transition-colors duration-150"
                  onClick={() => setExpandedEvalId(isExpanded ? null : eval_id)}
                >
                  {isExpanded ? (
                    <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
                  )}
                  <span className="flex-1 font-medium">{eval_id}: {eval_name}</span>
                  {isComparison ? (
                    <div className="flex items-center gap-3">
                      <div className="flex flex-col items-end gap-0.5">
                        <span
                          className={`font-mono text-[11px] font-semibold ${passRateClass(avgRate)}`}
                          style={avgRate >= 1.0 ? { color: "var(--color-seafoam)" } : {}}
                        >
                          {fmt(avgRate)}
                        </span>
                        <span className="text-[10px] text-muted-foreground">{primaryLabel}</span>
                      </div>
                      {delta !== undefined && (
                        <span className={`rounded-full px-1.5 py-0.5 font-mono text-[10px] font-semibold ${
                          delta > 0.01
                            ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                            : delta < -0.01
                              ? "bg-destructive/10 text-destructive"
                              : "bg-muted text-muted-foreground"
                        }`}>
                          {delta > 0.01 ? "+" : delta < -0.01 ? "" : "~"}{delta !== 0 ? Math.round(delta * 100) + "%" : "0%"}
                        </span>
                      )}
                      {baselineAvgRate !== undefined && (
                        <div className="flex flex-col items-end gap-0.5">
                          <span className="font-mono text-[11px] font-semibold text-muted-foreground">
                            {fmt(baselineAvgRate)}
                          </span>
                          <span className="text-[10px] text-muted-foreground">{baselineLabel}</span>
                        </div>
                      )}
                    </div>
                  ) : (
                    <>
                      {run_count > 1 ? (
                        <div className="flex gap-1.5">
                          {runRates.map((rate, i) => (
                            <span
                              key={i}
                              className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold ${
                                rate >= 1.0
                                  ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                                  : rate > 0
                                    ? "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                                    : "bg-destructive/10 text-destructive"
                              }`}
                            >
                              R{i + 1} {fmt(rate)}
                            </span>
                          ))}
                        </div>
                      ) : null}
                      <span
                        className={`font-mono text-[11px] font-semibold ${passRateClass(avgRate)}`}
                        style={avgRate >= 1.0 ? { color: "var(--color-seafoam)" } : {}}
                      >
                        {fmt(avgRate)}
                      </span>
                    </>
                  )}
                </div>
                {/* Expanded per-expectation details */}
                {isExpanded && gradingPaths.length > 0 && (
                  <EvalExpectationsDetail
                    gradingPaths={gradingPaths}
                    baselineGradingPaths={isComparison ? baselineGradingPaths : undefined}
                    primaryLabel={isComparison ? primaryLabel : undefined}
                    baselineLabel={isComparison ? baselineLabel : undefined}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Refine CTA — only when there are failures AND onRefine is provided */}
      {hasFailures && onRefine && (
        <div
          className="flex items-center gap-3 px-4 py-3"
          style={{
            background: "color-mix(in oklch, var(--destructive, hsl(0 84% 60%)), transparent 95%)",
            borderTop: "1px solid color-mix(in oklch, var(--destructive, hsl(0 84% 60%)), transparent 75%)",
          }}
        >
          <AlertTriangle className="size-4 shrink-0 text-destructive" />
          <div className="flex-1">
            <p className="text-xs font-semibold text-foreground">
              Failures detected — skill may need refinement
            </p>
            <p className="text-[11px] text-muted-foreground">
              {aggregate_summary.total_failed} assertion failure{aggregate_summary.total_failed !== 1 ? "s" : ""}. Analyst notes have been pre-loaded into Refine.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="shrink-0 text-destructive border-destructive/50 hover:bg-destructive/10"
            onClick={onRefine}
          >
            Refine skill
          </Button>
        </div>
      )}
    </div>
  );
}
