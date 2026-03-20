import { DollarSign, Activity, TrendingUp } from "lucide-react"
import type { UsageSummary } from "@/lib/types"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { formatCost } from "./usage-helpers"

interface UsageSummaryCardsProps {
  summary: UsageSummary | null
}

export function UsageSummaryCards({ summary }: UsageSummaryCardsProps) {
  return (
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
  )
}
