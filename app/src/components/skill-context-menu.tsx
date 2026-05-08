import type { ReactNode } from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import type { UnifiedSkill, SkillMenuState } from "@/hooks/use-unified-skills";

export interface SkillContextMenuProps {
  skill: UnifiedSkill;
  menuState: SkillMenuState;
  children: ReactNode;
  onReview: (name: string) => void | Promise<void>;
  onRedo: (name: string) => void;
  onOverview: (key: string) => void | Promise<void>;
  onEval: (key: string) => void | Promise<void>;
  onRefine: (key: string) => void | Promise<void>;
  onContinueBuilding: (name: string) => void | Promise<void>;
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
  children,
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
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent alignOffset={-4} onClick={(e) => e.stopPropagation()}>
        {menuState.isComplete ? (
          <>
            {menuState.isBuilder && (
              <ContextMenuLabel className="px-2 pt-1 pb-0 text-[11px] font-semibold tracking-[0.18em] text-muted-foreground">
                WORKFLOW
              </ContextMenuLabel>
            )}
            {menuState.isBuilder && (
              <ContextMenuItem onSelect={() => onReview(skill.name)}>
                Review
              </ContextMenuItem>
            )}
            {menuState.isBuilder && (
              <ContextMenuItem onSelect={() => onRedo(skill.name)}>
                Redo workflow
              </ContextMenuItem>
            )}
            {menuState.isBuilder && <ContextMenuSeparator />}
            <ContextMenuLabel className="px-2 pt-1 pb-0 text-[11px] font-semibold tracking-[0.18em] text-muted-foreground">
              SKILL
            </ContextMenuLabel>
            <ContextMenuItem onSelect={() => onOverview(skill.key)}>
              Overview
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => onEval(skill.key)}>
              Eval Workbench
            </ContextMenuItem>
            {menuState.showsLifecycleActions && (
              <ContextMenuItem onSelect={() => onRefine(skill.key)}>
                Refine
              </ContextMenuItem>
            )}
            {menuState.showsLifecycleActions && (
              <ContextMenuItem onSelect={() => onRestore(skill.name, skill.pluginSlug)}>
                Restore version
              </ContextMenuItem>
            )}
            {skill.source !== "marketplace" && (
              <ContextMenuItem onSelect={() => onExport(skill)}>
                Export as .skill
              </ContextMenuItem>
            )}
            {skill.source !== "marketplace" && (
              <>
                <ContextMenuSeparator />
                <ContextMenuLabel className="px-2 pt-1 pb-0 text-[11px] font-semibold tracking-[0.18em] text-muted-foreground">
                  PLUGIN
                </ContextMenuLabel>
                <ContextMenuGroup>
                  {skill.isDefaultPlugin ? (
                    <ContextMenuItem onSelect={() => onCreatePlugin(skill)}>
                      Create plugin
                    </ContextMenuItem>
                  ) : (
                    <ContextMenuItem onSelect={() => onRemoveFromPlugin(skill)}>
                      Remove from plugin
                    </ContextMenuItem>
                  )}
                  {pluginOptions.some(([slug]) => slug !== skill.pluginSlug) && (
                    <ContextMenuItem onSelect={() => onMoveToPlugin(skill)}>
                      Move to plugin
                    </ContextMenuItem>
                  )}
                </ContextMenuGroup>
              </>
            )}
          </>
        ) : (
          <ContextMenuItem onSelect={() => onContinueBuilding(skill.name)}>
            Continue Building
          </ContextMenuItem>
        )}
        {skill.isDefaultPlugin && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem
              onSelect={() => onDelete(skill)}
              variant="destructive"
            >
              Delete
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
