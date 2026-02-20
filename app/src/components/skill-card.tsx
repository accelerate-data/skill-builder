import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
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
import { Download, Lock, MessageSquare, Pencil, SquarePen, Trash2, Upload } from "lucide-react"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { SkillSummary, SkillType } from "@/lib/types"
import { SKILL_TYPE_LABELS, SKILL_TYPE_COLORS } from "@/lib/types"
import { cn } from "@/lib/utils"

interface SkillCardProps {
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

export function parseStepProgress(currentStep: string | null, status: string | null): number {
  if (status === "completed") return 100
  if (!currentStep) return 0
  const match = currentStep.match(/step\s*(\d+)/i)
  if (match) {
    const stepIndex = Number(match[1])
    // Steps are 0-5 (6 total). Use (stepIndex + 1) / 6 so step 5 = 100%.
    return Math.min(Math.round(((stepIndex + 1) / 6) * 100), 100)
  }
  if (/completed/i.test(currentStep)) return 100
  if (/initialization/i.test(currentStep)) return 0
  return 0
}

/**
 * Returns true only when all 6 workflow steps (0-5) are complete.
 * Download should be gated on full completion -- partial progress
 * (e.g. past the Build step) is not enough.
 *
 * A skill's workflow is 100% complete when:
 * - status is "completed", OR
 * - current_step text matches "completed", OR
 * - current_step parses to step 5 (the last step, 0-indexed)
 */
export function isWorkflowComplete(skill: SkillSummary): boolean {
  if (skill.status === "completed") return true
  if (!skill.current_step) return false
  if (/completed/i.test(skill.current_step)) return true
  const match = skill.current_step.match(/step\s*(\d+)/i)
  if (match) {
    return Number(match[1]) >= 5
  }
  return false
}

export interface IconActionProps {
  icon: React.ReactElement
  label: string
  tooltip: string
  onClick: () => void
  disabled?: boolean
  className?: string
}

export function IconAction({ icon, label, tooltip, onClick, disabled, className }: IconActionProps): React.ReactElement {
  const button = (
    <Button
      variant="ghost"
      size="icon-xs"
      className={cn("text-muted-foreground", className)}
      disabled={disabled}
      aria-label={label}
      tabIndex={disabled ? -1 : undefined}
      onClick={onClick}
    >
      {icon}
    </Button>
  )

  // Disabled buttons have pointer-events-none, which prevents Radix
  // tooltip from receiving hover events. Wrap in a <span> so the
  // tooltip still fires.
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {disabled ? (
          <span className="inline-flex" tabIndex={0}>{button}</span>
        ) : (
          button
        )}
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  )
}

export function getPushDisabledReason(isGitHubLoggedIn?: boolean, remoteConfigured?: boolean): string | undefined {
  if (!isGitHubLoggedIn) return "Sign in with GitHub in Settings"
  if (!remoteConfigured) return "Configure remote repository in Settings"
  return undefined
}

export default function SkillCard({
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
}: SkillCardProps) {
  const progress = parseStepProgress(skill.current_step, skill.status)
  const canDownload = isWorkflowComplete(skill)
  const pushDisabledReason = getPushDisabledReason(isGitHubLoggedIn, remoteConfigured)

  const cardContent = (
    <Card
      className={cn(
        "flex flex-col min-w-0 overflow-hidden transition-colors",
        isLocked ? "opacity-50 pointer-events-none" : "cursor-pointer hover:border-primary/50",
      )}
      onClick={() => !isLocked && onContinue(skill)}
    >
      <CardHeader className="relative group/header">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="min-w-0 truncate text-base">
            {skill.name}
          </CardTitle>
          {isLocked && <Lock className="size-3.5 text-muted-foreground shrink-0" />}
        </div>
        {!isLocked && (
          <span className="pointer-events-none absolute inset-x-0 top-0 flex justify-center pt-1 text-[10px] text-muted-foreground opacity-0 transition-opacity group-hover/header:opacity-100">
            Click to review
          </span>
        )}
        {skill.domain && (
          <Badge variant="outline" className="max-w-full min-w-0 text-xs">
            <span className="truncate">{skill.domain}</span>
          </Badge>
        )}
        {skill.skill_type && (
          <Badge className={cn("w-fit max-w-full text-xs", SKILL_TYPE_COLORS[skill.skill_type as SkillType])}>
            <span className="truncate">{SKILL_TYPE_LABELS[skill.skill_type as SkillType] || skill.skill_type}</span>
          </Badge>
        )}
        {skill.tags && skill.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {skill.tags.map((tag) => (
              <Badge key={tag} variant="secondary" className="text-xs max-w-[120px]">
                <span className="truncate">{tag}</span>
              </Badge>
            ))}
          </div>
        )}
      </CardHeader>
      <CardFooter className="mt-auto flex flex-col gap-2">
        <div className="flex w-full items-center gap-2">
          <Progress value={progress} className="flex-1" />
          <span className="shrink-0 text-xs text-muted-foreground">{progress}%</span>
        </div>
        {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
        <div className="flex w-full items-center gap-3" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-0.5">
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
          </div>
          <div className="flex items-center gap-0.5">
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
          </div>
          <IconAction
            icon={<Trash2 className="size-3" />}
            label="Delete skill"
            tooltip="Delete"
            className="ml-auto hover:text-destructive"
            onClick={() => onDelete(skill)}
          />
        </div>
      </CardFooter>
    </Card>
  )

  if (isLocked) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="cursor-not-allowed">
              {cardContent}
            </div>
          </TooltipTrigger>
          <TooltipContent>
            <p>This skill is being edited in another window</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }

  return (
    <TooltipProvider>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          {cardContent}
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={() => onEdit?.(skill)}>
            <SquarePen className="size-4" />
            Edit details
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </TooltipProvider>
  )
}
