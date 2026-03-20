import { useMemo } from "react"
import { ChevronUp, ChevronDown, CheckCircle2, XCircle } from "lucide-react"
import type { AgentRunRecord, UsageByModel } from "@/lib/types"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  STEP_NAMES,
  getStepName,
  getStepColor,
  shortModelName,
  formatSessionTime,
  formatCost,
  formatTokensShort,
  type SortCol,
} from "./usage-helpers"

interface SessionHistoryProps {
  agentRuns: AgentRunRecord[]
  byModel: UsageByModel[]
  modelFamilyFilter: string | null
  setModelFamilyFilter: (v: string | null) => void
  stepFilter: number | "all"
  setStepFilter: (v: number | "all") => void
  sortCol: SortCol
  sortDir: "asc" | "desc"
  onSort: (col: SortCol) => void
}

export function SessionHistory({
  agentRuns, byModel, modelFamilyFilter, setModelFamilyFilter,
  stepFilter, setStepFilter, sortCol, sortDir, onSort,
}: SessionHistoryProps) {

  const availableModels = useMemo(() => byModel.map((m) => m.model).sort(), [byModel])

  const filteredRuns = useMemo(() => {
    let rows = agentRuns
    if (stepFilter !== "all") rows = rows.filter((r) => r.step_id === stepFilter)
    // model family filtering is applied at the DB level via modelFamilyFilter in the store
    return [...rows].sort((a, b) => {
      let cmp = 0
      switch (sortCol) {
        case "date": cmp = a.started_at.localeCompare(b.started_at); break
        case "skill": cmp = a.skill_name.localeCompare(b.skill_name); break
        case "step": cmp = getStepName(a.step_id).localeCompare(getStepName(b.step_id)); break
        case "model": cmp = shortModelName(a.model).localeCompare(shortModelName(b.model)); break
        case "cost": cmp = a.total_cost - b.total_cost; break
        case "tokens": cmp = (a.input_tokens + a.output_tokens) - (b.input_tokens + b.output_tokens); break
      }
      return sortDir === "asc" ? cmp : -cmp
    })
  }, [agentRuns, stepFilter, sortCol, sortDir])

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <CardTitle>Step History</CardTitle>
          {/* Table-level filters */}
          <div className="flex items-center gap-2">
            <Select
              value={stepFilter === "all" ? "all" : String(stepFilter)}
              onValueChange={(v) => setStepFilter(v === "all" ? "all" : Number(v))}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Steps</SelectItem>
                {Object.entries(STEP_NAMES).map(([id, name]) => (
                  <SelectItem key={id} value={id}>{name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {availableModels.length > 1 && (
              <Select value={modelFamilyFilter ?? "all"} onValueChange={(v) => setModelFamilyFilter(v === "all" ? null : v)}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Models</SelectItem>
                  {availableModels.map((m) => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {filteredRuns.length > 0 && (
              <span className="text-xs text-muted-foreground">{filteredRuns.length} run{filteredRuns.length !== 1 ? "s" : ""}</span>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {filteredRuns.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed m-4 p-8 text-center">
            <p className="text-sm font-medium text-muted-foreground">No runs in this period</p>
            <p className="text-xs text-muted-foreground/60">Try selecting a wider date range or clearing filters.</p>
          </div>
        ) : (
          <table className="w-full table-auto border-separate border-spacing-0" data-testid="step-table">
            <thead>
              <tr>
                {(["date", "skill", "step", "model"] as SortCol[]).map((col) => (
                  <th key={col} scope="col" className="pl-4 py-2 text-left text-xs font-medium text-muted-foreground border-b border-border">
                    <button
                      type="button"
                      onClick={() => onSort(col)}
                      className="flex items-center gap-1 hover:text-foreground transition-colors capitalize"
                    >
                      {col}
                      {sortCol === col && (sortDir === "asc"
                        ? <ChevronUp className="size-3" />
                        : <ChevronDown className="size-3" />)}
                    </button>
                  </th>
                ))}
                <th scope="col" className="py-2 text-xs font-medium text-muted-foreground border-b border-border text-center">Status</th>
                {(["cost", "tokens"] as SortCol[]).map((col) => (
                  <th key={col} scope="col" className="pr-4 py-2 text-right text-xs font-medium text-muted-foreground border-b border-border">
                    <button
                      type="button"
                      onClick={() => onSort(col)}
                      className="flex items-center gap-1 ml-auto hover:text-foreground transition-colors capitalize"
                    >
                      {col}
                      {sortCol === col && (sortDir === "asc"
                        ? <ChevronUp className="size-3" />
                        : <ChevronDown className="size-3" />)}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredRuns.map((run) => {
                const tokens = run.input_tokens + run.output_tokens
                const isComplete = run.status === "completed"
                const isCancelled = run.status === "cancelled"
                return (
                  <tr key={run.agent_id} className="hover:bg-muted/40 transition-colors">
                    <td className="pl-4 py-2 text-xs text-muted-foreground whitespace-nowrap border-b border-border/50">
                      {formatSessionTime(run.started_at)}
                    </td>
                    <td className="pl-4 py-2 text-xs font-medium max-w-[140px] border-b border-border/50">
                      <span className="block truncate" title={run.skill_name}>{run.skill_name}</span>
                    </td>
                    <td className="pl-4 py-2 text-xs border-b border-border/50">
                      <div className="flex items-center gap-1.5">
                        <span
                          className="size-2 rounded-full shrink-0"
                          style={{ backgroundColor: getStepColor(run.step_id) }}
                        />
                        {getStepName(run.step_id)}
                      </div>
                    </td>
                    <td className="pl-4 py-2 text-xs text-muted-foreground border-b border-border/50">
                      {shortModelName(run.model)}
                    </td>
                    <td className="py-2 text-center border-b border-border/50">
                      {isComplete
                        ? <CheckCircle2 className="size-3.5 mx-auto" style={{ color: "var(--color-seafoam)" }} />
                        : isCancelled
                          ? <XCircle className="size-3.5 mx-auto text-muted-foreground/50" />
                          : <XCircle className="size-3.5 mx-auto text-destructive" />}
                    </td>
                    <td className="pr-4 py-2 text-right text-xs font-mono border-b border-border/50">
                      {formatCost(run.total_cost)}
                    </td>
                    <td className="pr-4 py-2 text-right text-xs font-mono text-muted-foreground border-b border-border/50">
                      {formatTokensShort(tokens)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  )
}
