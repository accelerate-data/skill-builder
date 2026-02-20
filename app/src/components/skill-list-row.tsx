import {
  Download,
  Lock,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  SquarePen,
  Trash2,
  Upload,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Progress } from "@/components/ui/progress"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  IconAction,
  isWorkflowComplete,
  parseStepProgress,
  getPushDisabledReason,
} from "@/components/skill-card"
import type { SkillSummary, SkillType } from "@/lib/types"
import { SKILL_TYPE_LABELS } from "@/lib/types"
import { cn } from "@/lib/utils"

interface SkillListRowProps {
  skill: SkillSummary
  isLocked?: boolean
  onContinue: (skill: SkillSummary) => void
  onDelete: (skill: SkillSummary) => void
  onDownload?: (skill: SkillSummary) => void
  onEdit?: (skill: SkillSummary) => void
  onEditWorkflow?: (skill: SkillSummary) => void
  onRefine?: (skill: SkillSummary) => void
  onPushToRemote?: (skill: SkillSummary) => void
  remoteConfigured?: boolean
  isGitHubLoggedIn?: boolean
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
  onPushToRemote,
  remoteConfigured,
  isGitHubLoggedIn,
}: SkillListRowProps) {
  const progress = parseStepProgress(skill.current_step, skill.status)
  const canDownload = isWorkflowComplete(skill)
  const pushDisabledReason = getPushDisabledReason(isGitHubLoggedIn, remoteConfigured)

  const row = (
    <div
      role="button"
      tabIndex={isLocked ? -1 : 0}
      className={cn(
        "grid items-center gap-x-3 rounded-md border px-3 py-2 transition-colors",
        "grid-cols-[1fr_auto] sm:grid-cols-[14%_22%_10%_22%_7rem_1fr]",
        isLocked
          ? "opacity-50 cursor-not-allowed"
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
      {/* Col 1: Name */}
      <span className={cn("min-w-0 truncate text-sm font-medium", isLocked && "flex items-center gap-1.5")}>
        {isLocked && <Lock className="size-3.5 shrink-0 text-muted-foreground" />}
        {skill.name}
      </span>

      {/* Col 2: Domain (2fr — wide, plain text, truncate at 30ch) */}
      <span className="hidden sm:block min-w-0 truncate text-xs text-muted-foreground max-w-[30ch]">
        {skill.domain ?? ""}
      </span>

      {/* Col 3: Type (plain text) */}
      <span className="hidden sm:block text-xs text-muted-foreground whitespace-nowrap">
        {skill.skill_type ? (SKILL_TYPE_LABELS[skill.skill_type as SkillType] || skill.skill_type) : ""}
      </span>

      {/* Col 4: Tags (2fr — wide, plain text, comma-separated) */}
      <span className="hidden sm:block min-w-0 truncate text-xs text-muted-foreground">
        {skill.tags?.join(", ") ?? ""}
      </span>

      {/* Col 5: Progress (hidden on mobile) */}
      <div className="hidden items-center gap-1 sm:flex">
        <Progress value={progress} className="w-20" />
        <span className="w-8 text-right text-xs text-muted-foreground">{progress}%</span>
      </div>

      {/* Col 4: Progress on mobile only — compact */}
      <div className="flex items-center gap-1 sm:hidden">
        <span className="text-xs text-muted-foreground">{progress}%</span>
      </div>

      {/* Col 6: Actions (right-aligned) */}
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div className="flex shrink-0 items-center gap-0.5 justify-self-end" onClick={(e) => e.stopPropagation()}>
        <IconAction
          icon={<Pencil className="size-3" />}
          label="Edit workflow"
          tooltip="Edit workflow"
          onClick={() => onEditWorkflow?.(skill)}
        />
        {canDownload && onRefine && (
          <IconAction
            icon={<MessageSquare className="size-3" />}
            label="Refine skill"
            tooltip="Refine"
            onClick={() => onRefine(skill)}
          />
        )}
        {canDownload && onPushToRemote && (
          <IconAction
            icon={<Upload className="size-3" />}
            label="Push to remote"
            tooltip={pushDisabledReason ?? "Push to remote"}
            disabled={!remoteConfigured || !isGitHubLoggedIn}
            onClick={() => remoteConfigured && isGitHubLoggedIn && onPushToRemote(skill)}
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
      </div>
    </div>
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
