import { Lock, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SkillContextMenu } from "@/components/skill-context-menu";
import {
  getStatusDot,
  getSkillMenuState,
} from "@/hooks/use-unified-skills";
import type { UnifiedSkill } from "@/hooks/use-unified-skills";
import { PURPOSE_SHORT_LABELS } from "@/lib/types";
import type { Purpose } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface SkillRowProps {
  skill: UnifiedSkill;
  isSelected: boolean;
  isLocked: boolean;
  isRunning: boolean;
  showPluginHeader: boolean;
  onRowClick: (skill: UnifiedSkill) => void;
  onReview: (name: string) => void;
  onRedo: (name: string) => void;
  onOverview: (key: string) => void;
  onEval: (key: string) => void;
  onRefine: (key: string) => void;
  onContinueBuilding: (name: string) => void;
  onRestore: (name: string, pluginSlug: string) => void;
  onDelete: (skill: UnifiedSkill) => void;
  onCreatePlugin: (skill: UnifiedSkill) => void;
  onMoveToPlugin: (skill: UnifiedSkill) => void;
  onRemoveFromPlugin: (skill: UnifiedSkill) => void;
  onDeletePlugin: (pluginSlug: string, pluginDisplayName: string) => void;
  pluginOptions: [string, string][];
}

function formatRelativeDate(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function SkillRow({
  skill,
  isSelected,
  isLocked,
  isRunning,
  showPluginHeader,
  onRowClick,
  onReview,
  onRedo,
  onOverview,
  onEval,
  onRefine,
  onContinueBuilding,
  onRestore,
  onDelete,
  onCreatePlugin,
  onMoveToPlugin,
  onRemoveFromPlugin,
  onDeletePlugin,
  pluginOptions,
}: SkillRowProps) {
  const dot = getStatusDot(skill, isRunning);
  const purposeLabel = skill.purpose
    ? (PURPOSE_SHORT_LABELS[skill.purpose as Purpose] ?? skill.purpose)
    : null;
  const menuState = getSkillMenuState(skill);

  return (
    <div>
      {showPluginHeader && (
        <div className="group/plugin-header flex items-center px-3 pb-1 pt-3">
          <span className="flex-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            {skill.pluginDisplayName}
          </span>
          {!skill.isDefaultPlugin && (
            <Button
              variant="ghost"
              size="icon-sm"
              className="size-5 opacity-0 group-hover/plugin-header:opacity-100 transition-opacity"
              title={`Delete plugin "${skill.pluginDisplayName}"`}
              onClick={(e) => {
                e.stopPropagation();
                onDeletePlugin(skill.pluginSlug ?? "", skill.pluginDisplayName);
              }}
            >
              <Trash2 className="size-3 text-muted-foreground" />
            </Button>
          )}
        </div>
      )}
      <div
        role="button"
        tabIndex={isLocked ? -1 : 0}
        aria-selected={isSelected}
        className={cn(
          "group flex h-[46px] cursor-pointer items-center gap-2 px-3 transition-colors",
          isSelected && "border-l-2 bg-muted/60 pl-[10px]",
          !isSelected && "border-l-2 border-l-transparent",
          !isSelected && !isLocked && "hover:bg-accent/50",
          isLocked && "cursor-not-allowed opacity-[0.45]",
        )}
        style={isSelected ? { borderLeftColor: "var(--color-pacific)" } : undefined}
        onClick={() => onRowClick(skill)}
        onKeyDown={(e) => {
          if (!isLocked && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            onRowClick(skill);
          }
        }}
      >
        {/* Status dot */}
        <div
          className={cn("size-2 shrink-0 rounded-full", dot.className)}
          style={dot.style}
          aria-label={`status-dot-${skill.key}`}
        />

        {/* Name + purpose */}
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-base font-medium">{skill.name}</span>
          {purposeLabel && (
            <span className="truncate text-[13px] text-muted-foreground">
              {purposeLabel}
            </span>
          )}
        </div>

        {/* Timestamp */}
        {skill.lastModified && (
          <span className="shrink-0 font-mono text-xs text-muted-foreground">
            {formatRelativeDate(skill.lastModified)}
          </span>
        )}

        {/* More button / Lock icon */}
        {isLocked ? (
          <Lock className="size-[10px] shrink-0 text-muted-foreground" />
        ) : (
          <SkillContextMenu
            skill={skill}
            menuState={menuState}
            onReview={onReview}
            onRedo={onRedo}
            onOverview={onOverview}
            onEval={onEval}
            onRefine={onRefine}
            onContinueBuilding={onContinueBuilding}
            onRestore={onRestore}
            onDelete={onDelete}
            onCreatePlugin={onCreatePlugin}
            onMoveToPlugin={onMoveToPlugin}
            onRemoveFromPlugin={onRemoveFromPlugin}
            pluginOptions={pluginOptions}
          />
        )}
      </div>
    </div>
  );
}
