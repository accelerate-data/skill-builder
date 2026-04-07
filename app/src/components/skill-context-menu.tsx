import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { MoreHorizontal } from "lucide-react";
import type { UnifiedSkill, SkillMenuState } from "@/hooks/use-unified-skills";

export interface SkillContextMenuProps {
  skill: UnifiedSkill;
  menuState: SkillMenuState;
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
  onExport: (skill: UnifiedSkill) => void;
  pluginOptions: [string, string][];
}

export function SkillContextMenu({
  skill,
  menuState,
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
  onExport,
  pluginOptions,
}: SkillContextMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          className="size-5 shrink-0 opacity-0 transition-opacity duration-150 group-hover:opacity-100"
          aria-label="More actions"
          onClick={(e) => e.stopPropagation()}
        >
          <MoreHorizontal className="size-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        {menuState.isComplete ? (
          <>
            {menuState.isBuilder && (
              <DropdownMenuLabel className="px-2 pt-1 pb-0 text-[11px] font-semibold tracking-[0.18em] text-muted-foreground">
                WORKFLOW
              </DropdownMenuLabel>
            )}
            {menuState.isBuilder && (
              <DropdownMenuItem onSelect={() => onReview(skill.name)}>
                Review
              </DropdownMenuItem>
            )}
            {menuState.isBuilder && (
              <DropdownMenuItem onSelect={() => onRedo(skill.name)}>
                Redo workflow
              </DropdownMenuItem>
            )}
            {menuState.isBuilder && <DropdownMenuSeparator />}
            <DropdownMenuLabel className="px-2 pt-1 pb-0 text-[11px] font-semibold tracking-[0.18em] text-muted-foreground">
              SKILL
            </DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => onOverview(skill.key)}>
              Overview
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onEval(skill.key)}>
              Eval
            </DropdownMenuItem>
            {menuState.showsLifecycleActions && (
              <DropdownMenuItem onSelect={() => onRefine(skill.key)}>
                Refine
              </DropdownMenuItem>
            )}
            {menuState.showsLifecycleActions && (
              <DropdownMenuItem onSelect={() => onRestore(skill.name, skill.pluginSlug)}>
                Restore version
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={() => onExport(skill)}>
              Export as .skill
            </DropdownMenuItem>
            {skill.source !== "marketplace" && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="px-2 pt-1 pb-0 text-[11px] font-semibold tracking-[0.18em] text-muted-foreground">
                  PLUGIN
                </DropdownMenuLabel>
                <DropdownMenuGroup>
                  {skill.isDefaultPlugin ? (
                    <DropdownMenuItem onSelect={() => onCreatePlugin(skill)}>
                      Create plugin
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem onSelect={() => onRemoveFromPlugin(skill)}>
                      Remove from plugin
                    </DropdownMenuItem>
                  )}
                  {pluginOptions.some(([slug]) => slug !== skill.pluginSlug) && (
                    <DropdownMenuItem onSelect={() => onMoveToPlugin(skill)}>
                      Move to plugin
                    </DropdownMenuItem>
                  )}
                </DropdownMenuGroup>
              </>
            )}
          </>
        ) : (
          <DropdownMenuItem onSelect={() => onContinueBuilding(skill.name)}>
            Continue Building
          </DropdownMenuItem>
        )}
        {skill.isDefaultPlugin && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => onDelete(skill)}
              className="text-destructive focus:text-destructive"
            >
              Delete
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
