import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { formatModelName, formatTokenCount } from "@/stores/session-runtime-store";
import { formatElapsed } from "@/lib/utils";
import type { ConversationRunRecord } from "@/lib/types";

interface AgentStatsBarProps {
  runs: ConversationRunRecord[];
}

function formatCost(amount: number): string {
  if (amount >= 1) return `$${amount.toFixed(2)}`;
  return `$${amount.toFixed(4)}`;
}

export function AgentStatsBar({ runs }: AgentStatsBarProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (runs.length === 0) return null;

  // Aggregate across all runs (parallel agents on research steps)
  const totals = runs.reduce(
    (acc, r) => ({
      cost: acc.cost + r.total_cost,
      input: acc.input + r.input_tokens,
      output: acc.output + r.output_tokens,
      cacheRead: acc.cacheRead + r.cache_read_tokens,
      duration: Math.max(acc.duration, r.duration_ms),
      durationApi: acc.durationApi + (r.duration_api_ms ?? 0),
      turns: acc.turns + r.num_turns,
      toolUses: acc.toolUses + r.tool_use_count,
      compactions: acc.compactions + r.compaction_count,
    }),
    { cost: 0, input: 0, output: 0, cacheRead: 0, duration: 0, durationApi: 0, turns: 0, toolUses: 0, compactions: 0 },
  );

  // Unique models used
  const models = [...new Set(runs.map((r) => formatModelName(r.model)))];

  // Derived metrics
  const cacheHitRate =
    totals.cacheRead > 0
      ? (totals.cacheRead / (totals.cacheRead + totals.input)) * 100
      : 0;

  const throughput =
    totals.duration > 0 ? totals.output / (totals.duration / 1000) : 0;

  const apiOverhead =
    totals.durationApi > 0 && totals.duration > 0
      ? (totals.durationApi / totals.duration) * 100
      : null;

  // Pick stop reason — show it if all runs agree, otherwise skip
  const stopReasons = [...new Set(runs.map((r) => r.stop_reason).filter(Boolean))];
  const stopReason = stopReasons.length === 1 ? stopReasons[0] : null;

  return (
    <div className="border rounded-lg overflow-hidden text-xs">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center gap-3 px-3 py-2 bg-muted/30 hover:bg-muted/50 transition-colors cursor-pointer"
      >
        <span><span className="text-muted-foreground">Duration </span>{formatElapsed(totals.duration)}</span>
        <span><span className="text-muted-foreground">Cost </span>{formatCost(totals.cost)}</span>
        <span><span className="text-muted-foreground">Input </span>{formatTokenCount(totals.input)} tokens</span>
        <span><span className="text-muted-foreground">Output </span>{formatTokenCount(totals.output)} tokens</span>
        <span className="ml-auto text-muted-foreground">{models.join(", ")}</span>
        {isExpanded ? (
          <ChevronDown className="size-3.5 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="size-3.5 text-muted-foreground shrink-0" />
        )}
      </button>

      {isExpanded && (
        <div className="px-3 py-2 bg-muted/10 border-t flex items-center gap-3 flex-wrap text-muted-foreground">
          <span><span className="text-foreground">{totals.turns}</span> turns</span>
          <span><span className="text-foreground">{totals.toolUses}</span> tool calls</span>
          <span><span className="text-foreground">{cacheHitRate.toFixed(0)}%</span> cache hit</span>
          <span><span className="text-foreground">{throughput.toFixed(1)}</span> tok/s</span>
          {apiOverhead !== null && (
            <span><span className="text-foreground">{apiOverhead.toFixed(0)}%</span> API time</span>
          )}
          {totals.compactions > 0 && (
            <span><span className="text-foreground">{totals.compactions}</span> compactions</span>
          )}
          {stopReason && (
            <span>stop: <span className="text-foreground font-mono">{stopReason}</span></span>
          )}
          {runs.length > 1 && (
            <span><span className="text-foreground">{runs.length}</span> agents</span>
          )}
        </div>
      )}
    </div>
  );
}
