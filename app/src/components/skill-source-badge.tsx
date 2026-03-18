import type { CSSProperties } from "react"
import { Hammer, Store, Upload } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

const SOURCE_CONFIG: Record<string, {
  icon: typeof Hammer
  label: string
  colors: string
  style?: CSSProperties
}> = {
  "skill-builder": {
    icon: Hammer,
    label: "Skill Builder",
    colors: "bg-muted text-muted-foreground",
  },
  marketplace: {
    icon: Store,
    label: "Marketplace",
    colors: "",
    style: { background: "color-mix(in oklch, var(--color-pacific), transparent 85%)", color: "var(--color-pacific)" },
  },
  imported: {
    icon: Upload,
    label: "Uploaded",
    colors: "",
    style: { background: "color-mix(in oklch, var(--color-violet), transparent 85%)", color: "var(--color-violet)" },
  },
}

export const SOURCE_DISPLAY_LABELS: Record<string, string> = {
  "skill-builder": "Skill Builder",
  "marketplace": "Marketplace",
  "imported": "Uploaded",
}

interface SkillSourceBadgeProps {
  skillSource: string | null | undefined
  className?: string
}

export function SkillSourceBadge({ skillSource, className }: SkillSourceBadgeProps) {
  if (!skillSource) return null

  const config = SOURCE_CONFIG[skillSource]
  if (!config) return null

  const Icon = config.icon

  return (
    <Badge className={cn("px-1.5 py-0 text-xs gap-1", config.colors, className)} style={config.style}>
      <Icon className="size-3" />
      {config.label}
    </Badge>
  )
}
