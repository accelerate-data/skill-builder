import { useState } from "react";
import { ChevronRight, TrendingUp, TrendingDown } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { markdownComponents } from "@/components/markdown-link";
import type { BenchmarkData, BenchmarkConfigSummary, BenchmarkDelta } from "@/components/benchmark-summary-card";

interface BenchmarkOverviewCardProps {
  benchmarkData: BenchmarkData;
  iteration: number | null;
}

function formatPassRate(rate: number): string {
  return `${(rate * 100).toFixed(0)}%`;
}

export function BenchmarkOverviewCard({ benchmarkData, iteration }: BenchmarkOverviewCardProps) {
  const [notesExpanded, setNotesExpanded] = useState(true);

  const runs = benchmarkData.runs ?? [];
  const summary = benchmarkData.run_summary ?? {};
  const rawNotes = benchmarkData.notes;
  const notes = typeof rawNotes === "string"
    ? rawNotes
    : Array.isArray(rawNotes)
      ? rawNotes.join("\n\n")
      : "";

  const configs = Object.keys(summary).filter((k) => k !== "delta");
  const primaryConfig = configs[0] ?? "with_skill";
  const primaryStats = summary[primaryConfig] as BenchmarkConfigSummary | undefined;
  const delta = summary.delta as BenchmarkDelta | undefined;

  const primaryPassRate = primaryStats?.pass_rate?.mean;
  const deltaPassRate = delta?.pass_rate ? parseFloat(delta.pass_rate) : undefined;

  const evalIds = [...new Set(runs.map((r) => r.eval_id))].sort((a, b) => a - b);
  const primaryRuns = runs.filter((r) => r.configuration === primaryConfig);
  const totalPassed = primaryRuns.reduce((sum, r) => sum + r.result.passed, 0);
  const totalAssertions = primaryRuns.reduce((sum, r) => sum + r.result.total, 0);

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Benchmark Results</h3>
        {iteration !== null && (
          <span className="text-xs text-muted-foreground">iteration {iteration}</span>
        )}
      </div>

      {/* Hero stats + per-eval rows side by side */}
      <div className="flex flex-wrap items-start gap-4">
        {/* Hero stat pills */}
        <div className="flex items-center gap-3">
          {primaryPassRate !== undefined && (
            <div className="rounded-lg border px-3 py-2 text-center min-w-[72px]">
              <p className="text-lg font-semibold tracking-tight" style={{ color: "var(--color-pacific)" }}>
                {formatPassRate(primaryPassRate)}
              </p>
              <p className="text-[11px] text-muted-foreground">pass</p>
            </div>
          )}
          {deltaPassRate !== undefined && (
            <div
              className="rounded-lg border px-3 py-2 text-center min-w-[72px]"
              style={{
                background: deltaPassRate > 0
                  ? "color-mix(in oklch, var(--color-seafoam), transparent 92%)"
                  : deltaPassRate < 0
                    ? "color-mix(in oklch, var(--destructive), transparent 92%)"
                    : undefined,
              }}
            >
              <p
                className="flex items-center justify-center gap-1 text-lg font-semibold tracking-tight"
                style={{
                  color: deltaPassRate > 0
                    ? "var(--color-seafoam)"
                    : deltaPassRate < 0
                      ? "var(--destructive)"
                      : undefined,
                }}
              >
                {deltaPassRate > 0 ? <TrendingUp className="size-3.5" /> : deltaPassRate < 0 ? <TrendingDown className="size-3.5" /> : null}
                {deltaPassRate > 0 ? "+" : ""}{(deltaPassRate * 100).toFixed(0)}%
              </p>
              <p className="text-[11px] text-muted-foreground">delta</p>
            </div>
          )}
          <div className="rounded-lg border px-3 py-2 text-center min-w-[72px]">
            <p className="text-lg font-semibold tracking-tight">
              {totalPassed}/{totalAssertions}
            </p>
            <p className="text-[11px] text-muted-foreground">
              across {evalIds.length} eval{evalIds.length !== 1 ? "s" : ""}
            </p>
          </div>
        </div>

        {/* Per-eval summary rows — inline next to hero stats */}
        {evalIds.length > 0 && (
          <div className="flex-1 min-w-[200px] space-y-1 pt-0.5">
            {evalIds.map((evalId, idx) => {
              const evalRuns = primaryRuns.filter((r) => r.eval_id === evalId);
              const evalName = evalRuns[0]?.eval_name ?? `Eval ${evalId}`;
              const evalPassed = evalRuns.reduce((s, r) => s + r.result.passed, 0);
              const evalTotal = evalRuns.reduce((s, r) => s + r.result.total, 0);
              const evalRate = evalTotal > 0 ? evalPassed / evalTotal : 0;

              return (
                <div key={evalId} className="flex items-center justify-between text-xs px-1">
                  <span className="text-muted-foreground">
                    Eval {idx + 1}
                    <span className="ml-2 text-foreground">{evalName}</span>
                  </span>
                  <span
                    className="font-medium"
                    style={evalRate >= 0.8 ? { color: "var(--color-seafoam)" } : evalRate < 0.5 ? { color: "var(--destructive)" } : undefined}
                  >
                    {formatPassRate(evalRate)} ({evalPassed}/{evalTotal})
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Analyst Observations — expanded by default, prominent */}
      {notes && (
        <div className="rounded-md border overflow-hidden">
          <button
            type="button"
            className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/50 transition-colors duration-150"
            onClick={() => setNotesExpanded(!notesExpanded)}
          >
            <ChevronRight
              className={`size-3 shrink-0 text-muted-foreground transition-transform duration-150 ${notesExpanded ? "rotate-90" : ""}`}
            />
            <span className="text-xs font-medium">Analyst Observations</span>
          </button>
          {notesExpanded && (
            <div className="border-t px-4 pb-4 pt-3">
              <div className="markdown-body compact max-w-none text-xs leading-relaxed">
                <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]} components={markdownComponents}>
                  {notes}
                </ReactMarkdown>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
