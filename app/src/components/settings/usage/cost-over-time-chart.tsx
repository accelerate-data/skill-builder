import { useState } from "react"
import type { UsageByDay } from "@/lib/types"
import { formatCost, formatTokens, formatTokensShort, formatDayLabel } from "./usage-helpers"

export function CostOverTimeChart({ data }: { data: UsageByDay[] }) {
  const [metric, setMetric] = useState<"cost" | "tokens">("cost")

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-24 text-muted-foreground text-sm">
        No data for this period
      </div>
    )
  }

  const getValue = (d: UsageByDay) => metric === "cost" ? d.total_cost : d.total_tokens
  const maxVal = Math.max(...data.map(getValue), 0.0001)
  const showValueLabels = data.length <= 30
  const labelStep = data.length <= 7 ? 1 : data.length <= 14 ? 2 : data.length <= 31 ? 5 : 10

  return (
    <div className="flex flex-col gap-2">
      {/* Toggle */}
      <div className="flex justify-end">
        <div className="flex items-center gap-0.5 rounded-md bg-muted p-0.5">
          {(["cost", "tokens"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMetric(m)}
              className={`px-2.5 py-0.5 rounded text-xs font-medium transition-all ${
                metric === m
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {m === "cost" ? "Cost" : "Tokens"}
            </button>
          ))}
        </div>
      </div>

      {/* Bars */}
      <div className="flex gap-px h-40">
        {data.map((day) => {
          const val = getValue(day)
          const pct = (val / maxVal) * 100
          const label = metric === "cost" ? formatCost(val) : formatTokensShort(val)
          const tooltip = `${day.date}: ${metric === "cost" ? formatCost(day.total_cost) : formatTokens(day.total_tokens)} (${day.run_count} run${day.run_count !== 1 ? "s" : ""})`
          return (
            <div
              key={day.date}
              className="flex-1 min-w-[4px] max-w-[48px] flex flex-col justify-end group relative"
              title={tooltip}
            >
              {showValueLabels && val > 0 && (
                <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-0.5 text-[9px] text-muted-foreground whitespace-nowrap">
                  {label}
                </span>
              )}
              <div
                className="w-full rounded-sm transition-opacity group-hover:opacity-70"
                style={{
                  height: `${Math.max(pct, 1)}%`,
                  backgroundColor: "var(--color-pacific)",
                }}
              />
            </div>
          )
        })}
      </div>

      {/* X-axis labels */}
      <div className="flex gap-px">
        {data.map((day, i) => (
          <div key={day.date} className="flex-1 min-w-[4px] max-w-[48px] text-center overflow-hidden">
            {i % labelStep === 0 && (
              <span className="text-[10px] text-muted-foreground leading-none">
                {formatDayLabel(day.date)}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
