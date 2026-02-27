import { useEffect, useState } from "react"
import { Loader2, DollarSign, Activity, TrendingUp, RotateCcw, ChevronDown, ChevronRight } from "lucide-react"
import type { AgentRunRecord, UsageByDay } from "@/lib/types"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
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
import { getSessionAgentRuns } from "@/lib/tauri"

const STEP_NAMES: Record<number, string> = {
  0: "Research",
  1: "Detailed Research",
  2: "Confirm Decisions",
  3: "Generate Skill",
}

const STEP_COLORS: Record<number, string> = {
  0: "var(--color-pacific)",
  1: "var(--color-ocean)",
  2: "var(--color-arctic)",
  3: "var(--color-seafoam)",
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

interface StepSummary {
  stepId: number
  name: string
  model: string
  cost: number
  tokens: number
}

function groupByStep(agents: AgentRunRecord[]): StepSummary[] {
  const map = new Map<string, StepSummary>()
  for (const a of agents) {
    const key = `${a.step_id}|${a.model}`
    const entry = map.get(key) ?? { stepId: a.step_id, name: getStepName(a.step_id), model: a.model, cost: 0, tokens: 0 }
    entry.cost += a.total_cost
    entry.tokens += a.input_tokens + a.output_tokens
    map.set(key, entry)
  }
  return Array.from(map.values())
    .sort((a, b) => a.stepId !== b.stepId ? a.stepId - b.stepId : a.model.localeCompare(b.model))
}

function formatTokensShort(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
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

export default function UsagePage() {
  const {
    summary, recentSessions, byStep, byModel, byDay,
    loading, error, fetchUsage, resetCounter,
    hideCancelled, toggleHideCancelled,
    dateRange, setDateRange,
    skillFilter, skillNames, setSkillFilter, fetchSkillNames,
  } = useUsageStore()
  const [resetting, setResetting] = useState(false)
  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(new Set())
  const [sessionAgents, setSessionAgents] = useState<Record<string, AgentRunRecord[]>>({})
  const [loadingSessions, setLoadingSessions] = useState<Set<string>>(new Set())

  useEffect(() => {
    fetchUsage()
    fetchSkillNames()
  }, [fetchUsage, fetchSkillNames])

  const handleReset = async () => {
    setResetting(true)
    try {
      await resetCounter()
      setExpandedSessions(new Set())
      setSessionAgents({})
      toast.success("Usage data reset")
    } catch (err) {
      console.error("usage: reset failed", err)
      toast.error(`Failed to reset usage: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setResetting(false)
    }
  }

  const toggleSession = async (sessionId: string) => {
    setExpandedSessions((prev) => {
      const next = new Set(prev)
      if (next.has(sessionId)) {
        next.delete(sessionId)
      } else {
        next.add(sessionId)
      }
      return next
    })

    if (!sessionAgents[sessionId] && !loadingSessions.has(sessionId)) {
      setLoadingSessions((prev) => new Set(prev).add(sessionId))
      try {
        const agents = await getSessionAgentRuns(sessionId)
        setSessionAgents((prev) => ({ ...prev, [sessionId]: agents }))
      } catch (err) {
        console.error("Failed to load session agents:", err)
      } finally {
        setLoadingSessions((prev) => {
          const next = new Set(prev)
          next.delete(sessionId)
          return next
        })
      }
    }
  }

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

  const isEmpty = !summary || (summary.total_runs === 0 && recentSessions.length === 0)

  if (isEmpty) {
    return (
      <div className="flex flex-col gap-6 p-6">
        <div className="flex items-center justify-end gap-2">
          {/* Skill filter */}
          {skillNames.length > 0 && (
            <select
              value={skillFilter ?? ""}
              onChange={(e) => setSkillFilter(e.target.value || null)}
              className="h-8 rounded-lg bg-muted border-0 px-3 text-xs font-medium text-foreground cursor-pointer focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="">All Skills</option>
              {skillNames.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
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
                    : "text-muted-foreground hover:text-foreground"
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
            <select
              value={skillFilter ?? ""}
              onChange={(e) => setSkillFilter(e.target.value || null)}
              className="h-8 rounded-lg bg-muted border-0 px-3 text-xs font-medium text-foreground cursor-pointer focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="">All Skills</option>
              {skillNames.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          )}
          <div className="flex items-center gap-0.5 rounded-lg bg-muted p-1">
            {DATE_RANGE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setDateRange(opt.value)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                  dateRange === opt.value
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer select-none">
            <input
              type="checkbox"
              checked={hideCancelled}
              onChange={toggleHideCancelled}
              className="rounded border-muted-foreground/40"
            />
            Hide cancelled runs
          </label>
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
            <p className="text-2xl font-bold" data-testid="total-cost">
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
            <p className="text-2xl font-bold" data-testid="total-runs">
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
            <p className="text-2xl font-bold" data-testid="avg-cost">
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
                    <span>{m.model}</span>
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

      {/* Recent Workflow Sessions */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Workflow Runs</CardTitle>
        </CardHeader>
        <CardContent>
          {recentSessions.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-8 text-center">
              <p className="text-sm font-medium text-muted-foreground">No runs in this period</p>
              <p className="text-xs text-muted-foreground/60">Try selecting a wider date range.</p>
            </div>
          ) : (
            <div className="flex flex-col divide-y">
              {recentSessions.map((session) => {
                const isExpanded = expandedSessions.has(session.session_id)
                const agents = sessionAgents[session.session_id]
                const isLoading = loadingSessions.has(session.session_id)
                return (
                  <div key={session.session_id} className="py-2">
                    <button
                      onClick={() => toggleSession(session.session_id)}
                      className="flex w-full items-center gap-3 text-sm hover:bg-muted/50 rounded-md px-2 py-1 transition-colors"
                      aria-expanded={isExpanded}
                      aria-label={`Toggle details for ${session.skill_name} workflow run`}
                    >
                      {isExpanded ? (
                        <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                      )}
                      <span className="font-medium truncate">{session.skill_name}</span>
                      <span className="text-muted-foreground text-xs shrink-0">{formatSessionTime(session.started_at)}</span>
                      <span className="ml-auto shrink-0 font-mono">{formatCost(session.total_cost)}</span>
                      <span className="shrink-0 text-muted-foreground font-mono text-xs">
                        {formatTokens(session.total_input_tokens + session.total_output_tokens)} tokens
                      </span>
                    </button>

                    {isExpanded && (
                      <div className="ml-6 mt-1 flex flex-col gap-0.5" data-testid="step-table">
                        {isLoading ? (
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Loader2 className="size-3 animate-spin" />
                            Loading step details...
                          </div>
                        ) : agents && agents.length > 0 ? (
                          groupByStep(agents).map((step) => (
                            <div
                              key={step.stepId}
                              className="flex items-center justify-between py-1 px-2 hover:bg-muted/40 rounded text-xs"
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="w-36 truncate font-medium">{step.name}</span>
                                <Badge variant="outline" className="shrink-0 text-xs">
                                  {step.model}
                                </Badge>
                              </div>
                              <div className="flex items-center gap-3 shrink-0 ml-4">
                                <span className="font-mono w-16 text-right">{formatCost(step.cost)}</span>
                                <span className="font-mono w-16 text-right text-muted-foreground">{formatTokens(step.tokens)}</span>
                              </div>
                            </div>
                          ))
                        ) : null}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}