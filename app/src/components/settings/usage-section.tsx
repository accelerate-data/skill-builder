import { useCallback, useMemo, useState } from "react"
import { Loader2, DollarSign, RotateCcw } from "lucide-react"
import { toast } from "@/lib/toast"
import { toUsageStartDate, useResetUsageMutation, useUsageQueries, useUsageSkillNamesQuery } from "@/lib/queries/usage"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card"
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
import type { SortCol } from "./usage/usage-helpers"
import {
  CostOverTimeChart,
  UsageBreakdownTables,
  SessionHistory,
  UsageFilters,
  UsageSummaryCards,
} from "./usage"

export function UsageSection() {
  const {
    hideCancelled, toggleHideCancelled,
    dateRange, setDateRange,
    skillFilter, setSkillFilter,
    modelFamilyFilter, setModelFamilyFilter,
    resetFilters,
  } = useUsageStore()
  const [resetting, setResetting] = useState(false)
  const [stepFilter, setStepFilter] = useState<number | "all">("all")
  const [sortCol, setSortCol] = useState<SortCol>("date")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")
  const filters = useMemo(() => ({
    hideCancelled,
    startDate: toUsageStartDate(dateRange),
    skillFilter,
    modelFamilyFilter,
  }), [dateRange, hideCancelled, modelFamilyFilter, skillFilter])
  const usage = useUsageQueries(filters)
  const skillNamesQuery = useUsageSkillNamesQuery()
  const resetUsageMutation = useResetUsageMutation()
  const summary = usage.summary.data ?? null
  const agentRuns = usage.agentRuns.data ?? []
  const byStep = usage.byStep.data ?? []
  const byModel = usage.byModel.data ?? []
  const byDay = usage.byDay.data ?? []
  const skillNames = skillNamesQuery.data ?? []
  const loading = usage.isLoading || skillNamesQuery.isLoading
  const error = usage.error ?? skillNamesQuery.error

  const handleSort = useCallback((col: SortCol) => {
    if (sortCol === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    } else {
      setSortCol(col)
      setSortDir("desc")
    }
  }, [sortCol])

  const handleReset = async () => {
    setResetting(true)
    try {
      await resetUsageMutation.mutateAsync()
      resetFilters()
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
        <p className="text-destructive">Failed to load usage data: {error instanceof Error ? error.message : String(error)}</p>
      </div>
    )
  }

  const isEmpty = !summary || (summary.total_runs === 0 && agentRuns.length === 0)

  if (isEmpty) {
    return (
      <div className="flex flex-col gap-6 p-6">
        <div className="flex items-center justify-end gap-2">
          <UsageFilters
            skillNames={skillNames} skillFilter={skillFilter} setSkillFilter={setSkillFilter}
            dateRange={dateRange} setDateRange={setDateRange}
          />
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
        <UsageFilters
          skillNames={skillNames} skillFilter={skillFilter} setSkillFilter={setSkillFilter}
          dateRange={dateRange} setDateRange={setDateRange}
        />

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

      <UsageSummaryCards summary={summary} />
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
        stepFilter={stepFilter}
        setStepFilter={setStepFilter}
        sortCol={sortCol}
        sortDir={sortDir}
        onSort={handleSort}
      />
    </div>
  )
}
