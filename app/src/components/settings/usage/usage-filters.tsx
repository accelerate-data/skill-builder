import type { DateRange } from "@/stores/usage-store"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { DATE_RANGE_OPTIONS } from "./usage-helpers"

interface UsageFiltersProps {
  skillNames: string[]
  skillFilter: string | null
  setSkillFilter: (v: string | null) => void
  dateRange: DateRange
  setDateRange: (v: DateRange) => void
}

export function UsageFilters({ skillNames, skillFilter, setSkillFilter, dateRange, setDateRange }: UsageFiltersProps) {
  return (
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
  )
}
