import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { Progress } from "@/components/ui/progress"
import { Download, Play, Trash2 } from "lucide-react"
import type { SkillSummary, SkillType } from "@/lib/types"
import { SKILL_TYPE_LABELS, SKILL_TYPE_COLORS } from "@/lib/types"
import { cn } from "@/lib/utils"

interface SkillCardProps {
  skill: SkillSummary
  onContinue: (skill: SkillSummary) => void
  onDelete: (skill: SkillSummary) => void
  onDownload?: (skill: SkillSummary) => void
}

function parseStepProgress(currentStep: string | null): number {
  if (!currentStep) return 0
  const match = currentStep.match(/step\s*(\d+)/i)
  if (match) {
    const stepIndex = Number(match[1])
    return Math.min(Math.round(((stepIndex + 1) / 8) * 100), 100)
  }
  if (/completed/i.test(currentStep)) return 100
  if (/initialization/i.test(currentStep)) return 5
  return 0
}

/**
 * Returns true if the skill has completed the Build step (step 5, 0-indexed).
 * A skill has build output if:
 * - current_step parses to step >= 6 (past the Build step), OR
 * - status is "completed"
 */
export function hasBuildOutput(skill: SkillSummary): boolean {
  if (skill.status === "completed") return true
  if (!skill.current_step) return false
  const match = skill.current_step.match(/step\s*(\d+)/i)
  if (match) {
    return Number(match[1]) >= 6
  }
  if (/completed/i.test(skill.current_step)) return true
  return false
}

function formatSkillName(name: string): string {
  return name
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
}

function formatRelativeTime(dateString: string | null): string {
  if (!dateString) return ""
  try {
    const date = new Date(dateString)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMinutes = Math.floor(diffMs / 60000)

    if (diffMinutes < 1) return "just now"
    if (diffMinutes < 60) return `${diffMinutes}m ago`
    const diffHours = Math.floor(diffMinutes / 60)
    if (diffHours < 24) return `${diffHours}h ago`
    const diffDays = Math.floor(diffHours / 24)
    if (diffDays < 30) return `${diffDays}d ago`
    return date.toLocaleDateString()
  } catch {
    return ""
  }
}

function statusVariant(
  status: string | null
): "default" | "secondary" | "outline" {
  switch (status) {
    case "completed":
      return "default"
    case "waiting_for_user":
      return "outline"
    default:
      return "secondary"
  }
}

function statusLabel(status: string | null): string {
  switch (status) {
    case "in_progress":
      return "In Progress"
    case "waiting_for_user":
      return "Needs Input"
    case "completed":
      return "Completed"
    default:
      return status || "Unknown"
  }
}

export default function SkillCard({
  skill,
  onContinue,
  onDelete,
  onDownload,
}: SkillCardProps) {
  const progress = parseStepProgress(skill.current_step)
  const relativeTime = formatRelativeTime(skill.last_modified)
  const canDownload = hasBuildOutput(skill)

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-2">
              <CardTitle className="text-base">
                {formatSkillName(skill.name)}
              </CardTitle>
              <Badge variant={statusVariant(skill.status)} className="shrink-0">
                {statusLabel(skill.status)}
              </Badge>
            </div>
            {skill.domain && (
              <Badge variant="outline" className="w-fit text-xs">
                {skill.domain}
              </Badge>
            )}
            {skill.skill_type && (
              <Badge className={cn("w-fit text-xs", SKILL_TYPE_COLORS[skill.skill_type as SkillType] || "")}>
                {SKILL_TYPE_LABELS[skill.skill_type as SkillType] || skill.skill_type}
              </Badge>
            )}
            {skill.tags && skill.tags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {skill.tags.map((tag) => (
                  <Badge key={tag} variant="secondary" className="text-xs">
                    {tag}
                  </Badge>
                ))}
              </div>
            )}
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{skill.current_step || "Not started"}</span>
              <span>{progress}%</span>
            </div>
            <Progress value={progress} />
          </CardContent>
          <CardFooter className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={() => onContinue(skill)}>
                <Play className="size-3" />
                Continue
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                className="text-muted-foreground hover:text-destructive"
                aria-label="Delete skill"
                onClick={() => onDelete(skill)}
              >
                <Trash2 className="size-3" />
              </Button>
            </div>
            {relativeTime && (
              <span className="text-xs text-muted-foreground">{relativeTime}</span>
            )}
          </CardFooter>
        </Card>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          disabled={!canDownload}
          onSelect={() => canDownload && onDownload?.(skill)}
        >
          <Download className="size-4" />
          Download .skill
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
