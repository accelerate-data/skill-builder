import { useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import type { EvalAggregateSummary, EvalBenchmark, EvalBenchmarkRun } from "@/lib/types";

interface EvalRunBenchmarkCardProps {
  benchmark: EvalBenchmark;
  analystNotes: string[];
  onRefine: () => void;
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

function buildEvalRates(runs: EvalBenchmarkRun[]): Record<number, { eval_name: string; runRates: number[] }> {
  const byId: Record<number, { eval_name: string; runRates: number[] }> = {};
  for (const run of runs) {
    for (const e of run.evals) {
      if (!byId[e.eval_id]) byId[e.eval_id] = { eval_name: e.eval_name, runRates: [] };
      byId[e.eval_id].runRates.push(e.summary.pass_rate);
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

export function EvalRunBenchmarkCard({
  benchmark,
  analystNotes,
  onRefine,
}: EvalRunBenchmarkCardProps) {
  const { aggregate_summary, baseline_aggregate_summary, runs, baseline_runs, iteration, run_count, eval_ids, comparison_mode } = benchmark;
  const hasFailures = aggregate_summary.has_failures;
  const isComparison = !!baseline_runs;

  // Analyst notes expand automatically when there are failures
  const [notesOpen, setNotesOpen] = useState(hasFailures);

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
      baselineRunRates: baselineById[id]?.runRates,
    }));

  return (
    <div className="mt-4 rounded-lg border bg-card shadow-sm">
      {/* Header */}
      <div className="flex items-center gap-2 border-b px-4 py-2.5">
        <span className="text-sm font-semibold tracking-tight">Benchmark Results</span>
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

      {/* Per-eval breakdown */}
      {evalRows.length > 0 && (
        <div className="border-b">
          <div className="bg-muted/40 px-4 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {isComparison
              ? `${primaryLabel} vs ${baselineLabel}`
              : run_count > 1 ? "Per-eval · per-run breakdown" : "Per-eval results"}
          </div>
          {evalRows.map(({ eval_id, eval_name, runRates, baselineRunRates }) => {
            const avgRate = runRates.length > 0
              ? runRates.reduce((s, r) => s + r, 0) / runRates.length
              : 0;
            const baselineAvgRate = baselineRunRates && baselineRunRates.length > 0
              ? baselineRunRates.reduce((s, r) => s + r, 0) / baselineRunRates.length
              : undefined;
            const delta = baselineAvgRate !== undefined ? avgRate - baselineAvgRate : undefined;
            return (
              <div
                key={eval_id}
                className="flex items-center gap-3 border-t px-4 py-2 text-xs"
              >
                <span className="flex-1 font-medium">{eval_name}</span>
                {isComparison ? (
                  <div className="flex items-center gap-3">
                    {/* Primary avg */}
                    <div className="flex flex-col items-end gap-0.5">
                      <span
                        className={`font-mono text-[11px] font-semibold ${passRateClass(avgRate)}`}
                        style={avgRate >= 1.0 ? { color: "var(--color-seafoam)" } : {}}
                      >
                        {fmt(avgRate)}
                      </span>
                      <span className="text-[10px] text-muted-foreground">{primaryLabel}</span>
                    </div>
                    {/* Delta badge */}
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
                    {/* Baseline avg */}
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
            );
          })}
        </div>
      )}

      {/* Analyst notes */}
      {analystNotes.length > 0 && (
        <div className="border-b">
          <button
            className="flex w-full items-center gap-2 px-4 py-2 text-left text-xs font-medium text-muted-foreground hover:text-foreground transition-colors duration-150"
            onClick={() => setNotesOpen((v) => !v)}
          >
            {notesOpen ? (
              <ChevronDown className="size-3 shrink-0" />
            ) : (
              <ChevronRight className="size-3 shrink-0" />
            )}
            Analyst Notes
            <span className="text-[11px] text-muted-foreground">
              ({analystNotes.length} observation{analystNotes.length !== 1 ? "s" : ""})
            </span>
          </button>
          {notesOpen && (
            <div>
              {analystNotes.map((note, i) => (
                <div key={i} className="flex items-start gap-2.5 border-t px-4 py-2 text-xs leading-relaxed">
                  <span
                    className="mt-1.5 size-1.5 shrink-0 rounded-full"
                    style={{ background: "var(--color-pacific)" }}
                  />
                  <span>{note}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Refine CTA — only when there are failures */}
      {hasFailures && (
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
