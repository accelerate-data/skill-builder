import { useCallback, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { readGrading } from "@/lib/tauri";
import type { EvalAggregateSummary, EvalBenchmark, EvalRunEvalSummary } from "@/lib/types";

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

/** Expanded detail for a single run — one GradingTable per eval, with optional baseline. */
function RunDetail({
  evals,
  baselineEvals,
  primaryLabel,
  baselineLabel,
}: {
  evals: EvalRunEvalSummary[];
  baselineEvals?: EvalRunEvalSummary[];
  primaryLabel?: string;
  baselineLabel?: string;
}) {
  const [data, setData] = useState<Array<{
    eval_name: string;
    expectations: GradingExpectation[];
    baselineExpectations?: GradingExpectation[];
  }> | null>(null);
  const [loading, setLoading] = useState(false);
  const isComparison = !!baselineEvals && baselineEvals.length > 0;

  const load = useCallback(async () => {
    if (data || loading || evals.length === 0) return;
    setLoading(true);
    try {
      const results = await Promise.all(evals.map((e) => readGrading(e.grading_path)));
      const baselineResults = baselineEvals
        ? await Promise.all(baselineEvals.map((e) => readGrading(e.grading_path)))
        : undefined;
      setData(results.map((g, i) => ({
        eval_name: evals[i].eval_name,
        expectations: (g.expectations as GradingExpectation[] | undefined) ?? [],
        baselineExpectations: baselineResults
          ? ((baselineResults[i]?.expectations as GradingExpectation[] | undefined) ?? [])
          : undefined,
      })));
    } catch (err) {
      console.error("[eval-benchmark] Failed to read grading:", err);
      setData([]);
    } finally {
      setLoading(false);
    }
  }, [evals, baselineEvals, data, loading]);

  if (!data && !loading) {
    void load();
    return <div className="px-4 py-2 text-[11px] text-muted-foreground">Loading…</div>;
  }
  if (loading) {
    return <div className="px-4 py-2 text-[11px] text-muted-foreground">Loading…</div>;
  }
  if (!data || data.length === 0) return null;

  return (
    <div className="bg-muted/20">
      {data.map(({ eval_name, expectations, baselineExpectations }, i) => (
        <div key={i} className={i > 0 ? "border-t" : ""}>
          {expectations.length > 0 && (
            <GradingTable
              label={isComparison ? `${eval_name} — ${primaryLabel ?? "Primary"}` : eval_name}
              expectations={expectations}
            />
          )}
          {baselineExpectations && baselineExpectations.length > 0 && (
            <GradingTable
              label={`${eval_name} — ${baselineLabel ?? "Baseline"}`}
              expectations={baselineExpectations}
            />
          )}
        </div>
      ))}
    </div>
  );
}

export function EvalRunBenchmarkCard({
  benchmark,
  onRefine,
}: EvalRunBenchmarkCardProps) {
  const { aggregate_summary, baseline_aggregate_summary, runs, baseline_runs, iteration, run_count, eval_ids, comparison_mode } = benchmark;
  const hasFailures = aggregate_summary.has_failures;
  const isComparison = !!baseline_runs && baseline_runs.length > 0;

  const [expandedRunIndex, setExpandedRunIndex] = useState<number | null>(null);

  const primaryLabel = comparison_mode === "current_vs_previous" ? "Current" : "With skill";
  const baselineLabel = comparison_mode === "current_vs_previous" ? "Previous" : "Without skill";

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

      {/* Per-run breakdown — one expandable row per run */}
      {runs.length > 0 && (
        <div className="border-b">
          <div className="bg-muted/40 px-4 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Per-run breakdown
          </div>
          {runs.map((run) => {
            const isExpanded = expandedRunIndex === run.run_index;
            const baselineRun = baseline_runs?.find((br) => br.run_index === run.run_index);
            return (
              <div key={run.run_index}>
                <div
                  className="flex items-center gap-3 border-t px-4 py-2 text-xs cursor-pointer hover:bg-muted/30 transition-colors duration-150"
                  onClick={() => setExpandedRunIndex(isExpanded ? null : run.run_index)}
                >
                  {isExpanded ? (
                    <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
                  )}
                  <span className="font-medium">Run {run.run_index}</span>
                  <span className="ml-auto flex items-center gap-3">
                    <span
                      className={`font-mono text-[11px] font-semibold ${passRateClass(run.run_summary.pass_rate)}`}
                      style={run.run_summary.pass_rate >= 1.0 ? { color: "var(--color-seafoam)" } : {}}
                    >
                      {fmt(run.run_summary.pass_rate)}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {run.run_summary.passed}✓{run.run_summary.failed > 0 ? ` ${run.run_summary.failed}✗` : ""}
                    </span>
                  </span>
                </div>
                {isExpanded && run.evals.length > 0 && (
                  <RunDetail
                    evals={run.evals}
                    baselineEvals={baselineRun?.evals}
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
