import type { UsageByStep, UsageByModel } from "@/lib/types"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { getStepName, getStepColor, getModelColor, formatCost, shortModelName } from "./usage-helpers"

interface UsageBreakdownTablesProps {
  byStep: UsageByStep[]
  byModel: UsageByModel[]
}

export function UsageBreakdownTables({ byStep, byModel }: UsageBreakdownTablesProps) {
  const maxStepCost = Math.max(...byStep.map((s) => s.total_cost), 0.0001)
  const maxModelCost = Math.max(...byModel.map((m) => m.total_cost), 0.0001)

  return (
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
  )
}
