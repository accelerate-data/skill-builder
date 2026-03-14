import { useEffect, useState, useMemo } from "react"
import { Loader2, DollarSign, Activity, TrendingUp, RotateCcw, ChevronUp, ChevronDown, CheckCircle2, XCircle } from "lucide-react"
import type { UsageByDay } from "@/lib/types"
import { toast } from "@/lib/toast"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { useUsageStore, type DateRange } from "@/stores/usage-store"

const STEP_NAMES: Record<number, string> = {
  [-11]: "Test",
  [-10]: "Refine",
  0: "Research",
  1: "Review",
  2: "Detailed Research",
  3: "Review",
  4: "Confirm Decisions",
  5: "Generate Skill",
}

const STEP_COLORS: Record<number, string> = {
  [-11]: "var(--color-navy)",
  [-10]: "var(--color-pacific)",
  0: "var(--color-pacific)",
  1: "var(--color-ocean)",
  2: "var(--color-arctic)",
  3: "var(--color-ocean)",
  4: "var(--color-seafoam)",
  5: "var(--color-seafoam)",
}

const MODEL_COLORS: Record<string, string> = {
  sonnet: "var(--color-ocean)",
  haiku: "var(--color-pacific)",
  opus: "var(--color-navy)",
}

const DATE_RANGE_OPTIONS: { label: string; value: DateRange }[] = [
  { label: "7d", value: "7d" },
  { label: "14d", value: "14d" },
  { label: "30d", value: "30d" },
  { label: "90d", value: "90d" },
  { label: "All time", value: "all" },
]

function getStepName(stepId: number): string {
  return STEP_NAMES[stepId] ?? `Step ${stepId}`
}

function getStepColor(stepId: number): string {
  return STEP_COLORS[stepId] ?? "var(--color-muted-foreground)"
}

function getModelColor(model: string): string {
  const key = model.toLowerCase()
  if (key.includes("haiku")) return MODEL_COLORS.haiku
  if (key.includes("opus")) return MODEL_COLORS.opus
  if (key.includes("sonnet")) return MODEL_COLORS.sonnet
  return "var(--color-muted-foreground)"
}

function formatCost(amount: number): string {
  return `$${amount.toFixed(2)}`
}

function formatTokens(count: number): string {
  return count.toLocaleString()
}

function formatSessionTime(iso: string): string {
  try {
    const date = new Date(iso)
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" })
      + " " + date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
  } catch {
    return ""
  }
}

function formatDayLabel(dateStr: string): string {
  try {
    // dateStr is "YYYY-MM-DD" from SQLite DATE()
    const [, month, day] = dateStr.split("-")
    return `${parseInt(month)}/${parseInt(day)}`
  } catch {
    return dateStr
  }
}


function formatTokensShort(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function shortModelName(model: string): string {
  const lower = model.toLowerCase()
  if (lower.includes("haiku")) return "Haiku"
  if (lower.includes("opus")) return "Opus"
  if (lower.includes("sonnet")) return "Sonnet"
  return model
}

function CostOverTimeChart({ data }: { data: UsageByDay[] }) {
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

type SortCol = "date" | "skill" | "step" | "model" | "cost" | "tokens"

export default function UsagePage() {
  const {
    summary, agentRuns, byStep, byModel, byDay,
    loading, error, fetchUsage, resetCounter,
    hideCancelled, toggleHideCancelled,
    dateRange, setDateRange,
    skillFilter, skillNames, setSkillFilter, fetchSkillNames,
    modelFamilyFilter, setModelFamilyFilter,
  } = useUsageStore()
  const [resetting, setResetting] = useState(false)
  const [stepFilter, setStepFilter] = useState<number | "all">("all")
  const [sortCol, setSortCol] = useState<SortCol>("date")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")

  useEffect(() => {
    fetchUsage()
    fetchSkillNames()
  }, [fetchUsage, fetchSkillNames])

  const handleReset = async () => {
    setResetting(true)
    try {
      await resetCounter()
      toast.success("Usage data reset")
    } catch (err) {
      console.error("usage: reset failed", err)
      toast.error(`Failed to reset usage: ${err instanceof Error ? err.message : String(err)}`, {
        duration: Infinity,
        cause: err,
        context: { operation: "usage_reset" },
      })
    } finally {
      setResetting(false)
    }
  }

  const handleSort = (col: SortCol) => {
    if (sortCol === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    } else {
      setSortCol(col)
      setSortDir("desc")
    }
  }

  // availableModels derived from byModel which already uses family names ("Sonnet", "Opus", "Haiku")
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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col gap-6 p-6">
        <p className="text-destructive">Failed to load usage data: {error}</p>
      </div>
    )
  }

  const isEmpty = !summary || (summary.total_runs === 0 && agentRuns.length === 0)

  if (isEmpty) {
    return (
      <div className="flex flex-col gap-6 p-6">
        <div className="flex items-center justify-end gap-2">
          {/* Skill filter */}
          {skillNames.length > 0 && (
            <Select value={skillFilter ?? "all"} onValueChange={(v) => setSkillFilter(v === "all" ? null : v)}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Skills</SelectItem>
                {skillNames.map((name) => (
                  <SelectItem key={name} value={name}>{name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {/* Date range filter shown even on empty state */}
          <div className="flex items-center gap-0.5 rounded-lg bg-muted p-1">
            {DATE_RANGE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setDateRange(opt.value)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                  dateRange === opt.value
                    ? "bg-background text-foreground shadow-sm"
                    : "text-foreground/65 hover:text-foreground"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <DollarSign className="size-12 text-muted-foreground/40 mb-4" />
          <p className="text-muted-foreground text-lg">No usage data yet.</p>
          <p className="text-muted-foreground text-sm mt-1">Run an agent to start tracking costs.</p>
        </div>
      </div>
    )
  }

  const maxStepCost = Math.max(...byStep.map((s) => s.total_cost), 0.0001)
  const maxModelCost = Math.max(...byModel.map((m) => m.total_cost), 0.0001)

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Controls row */}
      <div className="flex items-center justify-between gap-4">
        {/* Left: skill filter + date range */}
        <div className="flex items-center gap-2">
          {skillNames.length > 0 && (
            <Select value={skillFilter ?? "all"} onValueChange={(v) => setSkillFilter(v === "all" ? null : v)}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Skills</SelectItem>
                {skillNames.map((name) => (
                  <SelectItem key={name} value={name}>{name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <div className="flex items-center gap-0.5 rounded-lg bg-muted p-1">
            {DATE_RANGE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setDateRange(opt.value)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                  dateRange === opt.value
                    ? "bg-background text-foreground shadow-sm"
                    : "text-foreground/65 hover:text-foreground"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Checkbox
              id="hide-cancelled"
              checked={hideCancelled}
              onCheckedChange={toggleHideCancelled}
            />
            <Label htmlFor="hide-cancelled" className="text-sm text-muted-foreground cursor-pointer font-normal">
              Hide cancelled runs
            </Label>
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" className="text-destructive hover:text-destructive">
                <RotateCcw className="size-4" />
                Reset
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Reset Usage Data</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently delete all usage tracking data, including cost history and run records. This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={handleReset} disabled={resetting}>
                  {resetting && <Loader2 className="size-4 animate-spin" />}
                  Reset All Data
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <DollarSign className="size-4" />
              Total Spent (USD)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold" data-testid="total-cost">
              ${(summary?.total_cost ?? 0).toFixed(2)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Activity className="size-4" />
              Total Runs
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold" data-testid="total-runs">
              {summary?.total_runs ?? 0}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <TrendingUp className="size-4" />
              Avg Cost/Run
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold" data-testid="avg-cost">
              {formatCost(summary?.avg_cost_per_run ?? 0)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Cost Breakdowns */}
      <div className="grid grid-cols-2 gap-4">
        {/* Cost by Step */}
        <Card>
          <CardHeader>
            <CardTitle>Cost by Step</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {byStep.length === 0 ? (
              <p className="text-sm text-muted-foreground">No step data available.</p>
            ) : (
              byStep.map((step) => (
                <div key={step.step_id} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between text-sm">
                    <span>{step.step_name || getStepName(step.step_id)}</span>
                    <span className="text-muted-foreground">
                      {formatCost(step.total_cost)} ({step.run_count} agents)
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${Math.max((step.total_cost / maxStepCost) * 100, 1)}%`, backgroundColor: getStepColor(step.step_id) }}
                    />
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* Cost by Model */}
        <Card>
          <CardHeader>
            <CardTitle>Cost by Model</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {byModel.length === 0 ? (
              <p className="text-sm text-muted-foreground">No model data available.</p>
            ) : (
              byModel.map((m) => (
                <div key={m.model} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between text-sm">
                    <span title={m.model}>{shortModelName(m.model)}</span>
                    <span className="text-muted-foreground">
                      {formatCost(m.total_cost)} ({m.run_count} agents)
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${Math.max((m.total_cost / maxModelCost) * 100, 1)}%`, backgroundColor: getModelColor(m.model) }}
                    />
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {/* Cost Over Time Chart */}
      <Card>
        <CardHeader>
          <CardTitle>Cost Over Time</CardTitle>
        </CardHeader>
        <CardContent>
          <CostOverTimeChart data={byDay} />
        </CardContent>
      </Card>

      {/* Step History Table */}
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
                        onClick={() => handleSort(col)}
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
                        onClick={() => handleSort(col)}
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
    </div>
  )
}
