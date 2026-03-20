import { useEffect, useState } from "react"
import { Loader2, DollarSign, Activity, TrendingUp, RotateCcw } from "lucide-react"
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
import { useUsageStore } from "@/stores/usage-store"
import { DATE_RANGE_OPTIONS, formatCost } from "./usage/usage-helpers"
import { CostOverTimeChart, UsageBreakdownTables, SessionHistory } from "./usage"

export function UsageSection() {
  const {
    summary, agentRuns, byStep, byModel, byDay,
    loading, error, fetchUsage, resetCounter,
    hideCancelled, toggleHideCancelled,
    dateRange, setDateRange,
    skillFilter, skillNames, setSkillFilter, fetchSkillNames,
    modelFamilyFilter, setModelFamilyFilter,
  } = useUsageStore()
  const [resetting, setResetting] = useState(false)

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
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <DollarSign className="size-12 text-muted-foreground/40 mb-4" />
          <p className="text-muted-foreground text-lg">No usage data yet.</p>
          <p className="text-muted-foreground text-sm mt-1">Run an agent to start tracking costs.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Controls row */}
      <div className="flex items-center justify-between gap-4">
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

      <UsageBreakdownTables byStep={byStep} byModel={byModel} />

      <Card>
        <CardHeader>
          <CardTitle>Cost Over Time</CardTitle>
        </CardHeader>
        <CardContent>
          <CostOverTimeChart data={byDay} />
        </CardContent>
      </Card>

      <SessionHistory
        agentRuns={agentRuns}
        byModel={byModel}
        modelFamilyFilter={modelFamilyFilter}
        setModelFamilyFilter={setModelFamilyFilter}
      />
    </div>
  )
}
