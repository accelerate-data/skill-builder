import { LayoutGrid, List } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

export type ViewMode = "grid" | "list"

interface DashboardViewToggleProps {
  value: ViewMode
  onChange: (mode: ViewMode) => void
}

export function DashboardViewToggle({ value, onChange }: DashboardViewToggleProps) {
  return (
    <TooltipProvider>
      <div className="flex items-center gap-0.5 rounded-md border p-0.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Grid view"
              aria-pressed={value === "grid"}
              className={cn(value === "grid" && "bg-accent text-accent-foreground")}
              onClick={() => onChange("grid")}
            >
              <LayoutGrid className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Grid view</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="List view"
              aria-pressed={value === "list"}
              className={cn(value === "list" && "bg-accent text-accent-foreground")}
              onClick={() => onChange("list")}
            >
              <List className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>List view</TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  )
}
