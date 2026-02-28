import {
  Download,
  FlaskConical,
  Lock,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  SquarePen,
  Trash2,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  IconAction,
  isWorkflowComplete,
} from "@/components/skill-card"
import { SkillSourceBadge } from "@/components/skill-source-badge"
import type { SkillSummary, Purpose } from "@/lib/types"
import { PURPOSE_SHORT_LABELS } from "@/lib/types"
import { cn } from "@/lib/utils"

function formatRelativeDate(isoDate: string): string {
  const date = new Date(isoDate)
  if (isNaN(date.getTime())) return isoDate
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  if (diffMins < 1) return "just now"
  if (diffMins < 60) return `${diffMins}m ago`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

function getStatusLabel(skill: SkillSummary): string {
  if (skill.skill_source === "marketplace" || skill.skill_source === "imported" || isWorkflowComplete(skill)) {
    return "Completed"
  }
  const match = skill.current_step?.match(/step\s*(\d+)/i)
  if (match) return `Step ${match[1]}/5`
  return "In Progress"
}

interface SkillListRowProps {
  skill: SkillSummary
  isLocked?: boolean
  onContinue: (skill: SkillSummary) => void
  onDelete: (skill: SkillSummary) => void
  onDownload?: (skill: SkillSummary) => void
  onEdit?: (skill: SkillSummary) => void
  onEditWorkflow?: (skill: SkillSummary) => void
  onRefine?: (skill: SkillSummary) => void
  onTest?: (skill: SkillSummary) => void
}

export default function SkillListRow({
  skill,
  isLocked,
  onContinue,
  onDelete,
  onDownload,
  onEdit,
  onEditWorkflow,
  onRefine,
  onTest,
}: SkillListRowProps) {
  const isMarketplace = skill.skill_source === 'marketplace'
  const canDownload = isMarketplace || isWorkflowComplete(skill)
  const statusLabel = getStatusLabel(skill)
  const isComplete = statusLabel === "Completed"

  const tdBase = cn(
    "py-2.5 border-b transition-colors",
    isLocked ? "opacity-50" : "",
  )

  const row = (
    <tr
      tabIndex={isLocked ? -1 : 0}
      className={cn(
        "transition-colors",
        isLocked
          ? "cursor-not-allowed"
          : "cursor-pointer hover:bg-accent/50",
      )}
      onClick={() => !isLocked && onContinue(skill)}
      onKeyDown={(e) => {
        if (!isLocked && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault()
          onContinue(skill)
        }
      }}
    >
      {/* Col 1: Name + Type subtitle */}
      <td className={cn(tdBase, "pl-4 min-w-0")}>
        <div className={cn("min-w-0", isLocked && "flex items-center gap-1.5")}>
          {isLocked && <Lock className="size-3.5 shrink-0 text-muted-foreground" />}
          <div className="truncate text-sm font-medium">{skill.name}</div>
          <div className="hidden sm:block truncate text-xs text-muted-foreground">
            {skill.purpose ? (PURPOSE_SHORT_LABELS[skill.purpose as Purpose] || skill.purpose) : ""}
          </div>
        </div>
      </td>

      {/* Col 2: Source */}
      <td className={cn(tdBase, "hidden sm:table-cell")}>
        <div className="flex items-center">
          <SkillSourceBadge skillSource={skill.skill_source} />
        </div>
      </td>

      {/* Col 3: Status */}
      <td className={cn(tdBase, "hidden sm:table-cell")}>
        <div className="flex items-center">
          {isComplete ? (
            <Badge className="text-xs px-1.5 py-0" style={{ background: "color-mix(in oklch, var(--color-seafoam), transparent 85%)", color: "var(--color-seafoam)" }}>
              Completed
            </Badge>
          ) : (
            <Badge variant="secondary" className="text-xs px-1.5 py-0">
              {statusLabel}
            </Badge>
          )}
        </div>
      </td>

      {/* Col 4: Updated */}
      <td className={cn(tdBase, "hidden md:table-cell text-xs text-muted-foreground")}>
        {skill.last_modified ? formatRelativeDate(skill.last_modified) : "—"}
      </td>

      {/* Mobile: status text */}
      <td className={cn(tdBase, "sm:hidden text-xs text-muted-foreground")}>
        {statusLabel}
      </td>

      {/* Col 4: Actions */}
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <td className={cn(tdBase, "pr-4")} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-0.5 justify-end">
          {skill.skill_source === 'skill-builder' && (
            <IconAction
              icon={<Pencil className="size-3" />}
              label="Edit workflow"
              tooltip="Edit workflow"
              onClick={() => onEditWorkflow?.(skill)}
            />
          )}
          {canDownload && onRefine && (
            <IconAction
              icon={<MessageSquare className="size-3" />}
              label="Refine skill"
              tooltip="Refine"
              onClick={() => onRefine(skill)}
            />
          )}
          {canDownload && (
            <IconAction
              icon={<FlaskConical className="size-3" />}
              label="Test skill"
              tooltip="Test"
              onClick={() => onTest?.(skill)}
            />
          )}
          {canDownload && onDownload && (
            <IconAction
              icon={<Download className="size-3" />}
              label="Download skill"
              tooltip="Download .skill"
              onClick={() => onDownload(skill)}
            />
          )}
          <IconAction
            icon={<Trash2 className="size-3" />}
            label="Delete skill"
            tooltip="Delete"
            className="hover:text-destructive"
            onClick={() => onDelete(skill)}
          />

          {skill.skill_source === 'skill-builder' && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="text-muted-foreground"
                  aria-label="More actions"
                >
                  <MoreHorizontal className="size-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => onEdit?.(skill)}>
                  <SquarePen className="size-4" />
                  Edit details
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </td>
    </tr>
  )

  if (isLocked) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>{row}</TooltipTrigger>
          <TooltipContent>
            <p>This skill is being edited in another window</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }

  return <TooltipProvider>{row}</TooltipProvider>
}
