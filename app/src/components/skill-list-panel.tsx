import { useState, useEffect, useMemo } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useWorkflowStore } from "@/stores/workflow-store";
import { useSkillStore } from "@/stores/skill-store";
import { Lock, MoreHorizontal, PanelLeftClose, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/lib/toast";
import SkillDialog from "@/components/skill-dialog";
import DeleteSkillDialog from "@/components/delete-skill-dialog";
import RestoreVersionDialog from "@/components/workspace/restore-version-dialog";
import { CreatePluginDialog } from "@/components/create-plugin-dialog";
import { MoveToPluginDialog } from "@/components/move-to-plugin-dialog";
import { useSettingsStore } from "@/stores/settings-store";
import { useImportedSkillsStore } from "@/stores/imported-skills-store";
import { useAgentStore } from "@/stores/agent-store";
import type { SkillSummary, ImportedSkill, Purpose } from "@/lib/types";
import { PURPOSE_SHORT_LABELS } from "@/lib/types";
import {
  getExternallyLockedSkills,
  listSkills,
  removeSkillFromPlugin,
  resetWorkflowStep,
} from "@/lib/tauri";
import { cn } from "@/lib/utils";

interface UnifiedSkill {
  key: string;
  name: string;
  description: string | null;
  purpose: string | null;
  lastModified: Date | null;
  createdAt: Date | null;
  source: "builder" | "imported" | "marketplace";
  pluginSlug: string;
  pluginDisplayName: string;
  isDefaultPlugin: boolean;
  importedSkillId: string | null;
  status: string | null;
  currentStep: string | null;
}

interface SkillMenuState {
  isBuilder: boolean;
  isComplete: boolean;
  showsLifecycleActions: boolean;
}

export interface SkillListPanelProps {
  onSelectSkill?: (name: string) => void;
  onCreateSkill?: () => void;
  onCollapse?: () => void;
  className?: string;
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

function isSkillComplete(skill: UnifiedSkill): boolean {
  return skill.status === "completed";
}

interface DotStyle {
  className: string;
  style?: React.CSSProperties;
}

function getStatusDot(skill: UnifiedSkill, isRunning: boolean): DotStyle {
  const pulse = isRunning ? " animate-dot-pulse" : "";

  if (skill.source === "marketplace") {
    return { className: pulse.trim(), style: { backgroundColor: "var(--color-pacific)" } };
  }

  if (skill.source === "imported") {
    return { className: pulse.trim(), style: { backgroundColor: "var(--color-violet)" } };
  }

  // Completed builder skill → seafoam
  if (isSkillComplete(skill)) {
    return { className: pulse.trim(), style: { backgroundColor: "var(--color-seafoam)" } };
  }

  const stepMatch = skill.currentStep?.match(/step\s*(\d+)/i);
  const step = stepMatch ? Number(stepMatch[1]) : null;

  // Step 1+ (step 1+ in 0-indexed, i.e. past Research) → amber
  if (step !== null && step >= 1) {
    return { className: `bg-amber-500 dark:bg-amber-400${pulse}` };
  }

  // Never started or on Step 1 (step 0 in 0-indexed) → red
  return { className: `bg-destructive${pulse}` };
}

function mergeSkills(
  builderSkills: SkillSummary[],
  importedSkills: ImportedSkill[],
): UnifiedSkill[] {
  const fromBuilder: UnifiedSkill[] = builderSkills
    .filter((s) => s.skill_source === "skill-builder")
    .map((s) => ({
      key: s.library_key ?? s.name,
      name: s.name,
      description: s.description ?? null,
      purpose: s.purpose,
      lastModified: s.last_modified ? new Date(s.last_modified) : null,
      createdAt: s.created_at ? new Date(s.created_at) : null,
      source: "builder" as const,
      pluginSlug: s.plugin_slug ?? "skills",
      pluginDisplayName: s.plugin_display_name ?? "Skills",
      isDefaultPlugin: s.is_default_plugin ?? true,
      importedSkillId: null,
      status: s.status,
      currentStep: s.current_step,
    }));

  const fromImported: UnifiedSkill[] = importedSkills.map((s) => ({
    key: s.library_key ?? `imported:${s.skill_id}`,
    name: s.skill_name,
    description: s.description,
    purpose: s.purpose,
    lastModified: new Date(s.imported_at),
    createdAt: new Date(s.imported_at),
    source: s.marketplace_source_url ? ("marketplace" as const) : ("imported" as const),
    pluginSlug: s.plugin_slug ?? "skills",
    pluginDisplayName: s.plugin_display_name ?? "Skills",
    isDefaultPlugin: s.is_default_plugin ?? true,
    importedSkillId: s.skill_id,
    status: null,
    currentStep: null,
  }));

  // Sort by plugin slug (groups skills by plugin), then by creation date descending within each plugin
  return [...fromBuilder, ...fromImported].sort((a, b) => {
    if (a.pluginSlug !== b.pluginSlug) {
      if (a.isDefaultPlugin !== b.isDefaultPlugin) return a.isDefaultPlugin ? -1 : 1;
      return a.pluginSlug.localeCompare(b.pluginSlug);
    }
    const at = a.createdAt?.getTime() ?? 0;
    const bt = b.createdAt?.getTime() ?? 0;
    return bt - at;
  });
}

function getSkillMenuState(skill: UnifiedSkill): SkillMenuState {
  return {
    isBuilder: skill.source === "builder",
    isComplete: isSkillComplete(skill) || skill.source !== "builder",
    showsLifecycleActions: isSkillComplete(skill) || skill.source !== "builder",
  };
}

export function SkillListPanel({
  onSelectSkill,
  onCreateSkill,
  onCollapse,
  className,
}: SkillListPanelProps) {
  const [createOpen, setCreateOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<SkillSummary | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [redoTarget, setRedoTarget] = useState<string | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<string | null>(null);
  const [externalLockedSkills, setExternalLockedSkills] = useState<Set<string>>(new Set());
  const [moveTarget, setMoveTarget] = useState<UnifiedSkill | null>(null);
  const [createPluginTarget, setCreatePluginTarget] = useState<UnifiedSkill | null>(null);

  const workspacePath = useSettingsStore((s) => s.workspacePath);
  const builderSkills = useSkillStore((s) => s.skills);
  const setSkills = useSkillStore((s) => s.setSkills);
  const selectedSkill = useSkillStore((s) => s.activeSkill);
  const setSelectedSkill = useSkillStore((s) => s.setActiveSkill);
  const importedSkills = useImportedSkillsStore((s) => s.skills);
  const fetchImportedSkills = useImportedSkillsStore((s) => s.fetchSkills);
  const runs = useAgentStore((s) => s.runs);
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  // Fetch both skill lists whenever workspacePath becomes available
  useEffect(() => {
    if (!workspacePath) return;
    listSkills(workspacePath)
      .then(setSkills)
      .catch((err) => console.error("event=fetch_skills_failed error=%s", err));
    fetchImportedSkills().catch((err) =>
      console.error("event=fetch_imported_skills_failed error=%s", err),
    );
  }, [workspacePath, setSkills, fetchImportedSkills]);

  // Refresh external locks on every navigation so stale lock state clears after leaving a skill
  useEffect(() => {
    getExternallyLockedSkills()
      .then((names) => setExternalLockedSkills(new Set(names)))
      .catch(() => { /* non-fatal */ });
  }, [pathname]);

  // Sort by creation date (newest first) — stable across edits since created_at never changes.
  const unifiedSkills = useMemo(
    () => mergeSkills(builderSkills, importedSkills),
    [builderSkills, importedSkills],
  );

  // Default selection — run once on mount after stores are populated
  useEffect(() => {
    const stored = localStorage.getItem("last-selected-skill");
    if (stored && unifiedSkills.some((s) => s.key === stored)) {
      setSelectedSkill(stored);
    } else if (unifiedSkills.length > 0) {
      setSelectedSkill(unifiedSkills[0].key);
    }
    // Intentionally mount-only: we only restore the saved selection once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runningAgent = Object.values(runs).find(
    (r) => r.status === "running" && (r.runSource === "workflow" || r.runSource === "refine"),
  );
  const runningSkillName = runningAgent?.skillName ?? null;

  const filteredSkills = unifiedSkills.filter((s) =>
    `${s.name} ${s.pluginDisplayName}`.toLowerCase().includes(search.toLowerCase()),
  );
  const pluginOptions = useMemo(
    () =>
      Array.from(
        new Map(
          unifiedSkills
            .filter((skill) => !skill.isDefaultPlugin && skill.pluginSlug)
            .map((skill) => [skill.pluginSlug, skill.pluginDisplayName]),
        ).entries(),
      ),
    [unifiedSkills],
  );

  function handleRowClick(skill: UnifiedSkill) {
    // All other rows are locked while a workflow or refine agent runs
    if (runningSkillName && skill.name !== runningSkillName) return;
    // Running skill is also a no-op
    if (skill.name === runningSkillName) return;
    // Skill locked by another instance
    if (externalLockedSkills.has(skill.name)) return;

    console.log("event=skill_selected skill=%s", skill.name);
    localStorage.setItem("last-selected-skill", skill.key);
    setSelectedSkill(skill.key);

    if (isSkillComplete(skill) || skill.source !== "builder") {
      onSelectSkill?.(skill.key);
    } else {
      // Row click always opens in Review mode — auto-start is only for explicit actions
      // (SkillDialog create, Continue Building, Redo) which pass state: { autoStart: true }.
      navigate({ to: "/skill/$skillName", params: { skillName: skill.name } });
    }
  }



  function handleRedo(skillName: string) {
    setRedoTarget(skillName);
  }

  async function confirmRedo(skillName: string) {
    if (!workspacePath) return;
    try {
      await resetWorkflowStep(workspacePath, skillName, 0);
      console.log("event=skill_redo skill=%s", skillName);
      // Reset store so persistence hook re-hydrates from DB (picks up the step reset).
      useWorkflowStore.getState().reset();
      setRedoTarget(null);
      navigate({ to: "/skill/$skillName", params: { skillName }, state: { autoStart: true } });
    } catch (err) {
      toast.error(`Failed to reset workflow: ${err instanceof Error ? err.message : String(err)}`);
      console.error("event=skill_redo_failed skill=%s error=%s", skillName, err);
    }
  }

  function handleOverview(skillKey: string) {
    console.log("event=skill_overview skill=%s", skillKey);
    localStorage.setItem("last-selected-skill", skillKey);
    setSelectedSkill(skillKey);
    useSkillStore.getState().setActiveSkill(skillKey);
    navigate({ to: "/", search: { tab: "overview" } });
  }

  function handleRefine(skillKey: string) {
    console.log("event=skill_refine skill=%s", skillKey);
    useSkillStore.getState().setActiveSkill(skillKey);
    navigate({ to: "/", search: { tab: "refine" } });
  }

  function handleReview(skillName: string) {
    console.log("event=skill_review skill=%s", skillName);
    localStorage.setItem("last-selected-skill", skillName);
    setSelectedSkill(skillName);
    navigate({ to: "/skill/$skillName", params: { skillName } });
  }

  function handleContinueBuilding(skillName: string) {
    console.log("event=skill_continue skill=%s", skillName);
    localStorage.setItem("last-selected-skill", skillName);
    setSelectedSkill(skillName);
    navigate({ to: "/skill/$skillName", params: { skillName }, state: { autoStart: true } });
  }

  function handleDelete(skill: UnifiedSkill) {
    if (skill.importedSkillId) {
      const toastId = toast.loading(`Deleting "${skill.name}"...`);
      useImportedSkillsStore.getState().deleteSkill(skill.importedSkillId, fetchImportedSkills)
        .then(() => toast.success(`Deleted "${skill.name}"`, { id: toastId }))
        .catch((err) => toast.error(`Delete failed: ${err instanceof Error ? err.message : String(err)}`, { id: toastId }));
      return;
    }
    const summary = builderSkills.find((s) => s.name === skill.name) ?? null;
    setDeleteTarget(summary);
    setDeleteOpen(true);
  }

  async function refreshSkillLists() {
    if (workspacePath) {
      await listSkills(workspacePath).then(setSkills);
    }
    await fetchImportedSkills();
  }

  function handleCreatePlugin(skill: UnifiedSkill) {
    setCreatePluginTarget(skill)
  }

  function handleMoveToPlugin(skill: UnifiedSkill) {
    setMoveTarget(skill)
  }

  async function handleRemoveFromPlugin(skill: UnifiedSkill) {
    const toastId = toast.loading(`Removing "${skill.name}" from plugin...`)
    try {
      await removeSkillFromPlugin(skill.key)
      await refreshSkillLists()
      toast.success(`Removed "${skill.name}" from plugin`, { id: toastId })
    } catch (err) {
      toast.error(`Remove failed: ${err instanceof Error ? err.message : String(err)}`, {
        id: toastId,
      })
    }
  }

  return (
    <div
      className={cn(
        "flex h-full w-full flex-col border-r bg-background",
        className,
      )}
    >
      {/* Topbar */}
      <div className="flex h-11 items-center gap-2 border-b px-3">
        <span className="flex-1 text-[15px] font-semibold">Skills</span>
        <Button
          variant="ghost"
          size="icon-sm"
          className="size-7"
          onClick={() => {
            setCreateOpen(true);
            onCreateSkill?.();
          }}
          title="New skill"
        >
          <Plus className="size-4" />
        </Button>
        {onCollapse && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-7"
            onClick={onCollapse}
            title="Collapse skill list"
          >
            <PanelLeftClose className="size-4" />
          </Button>
        )}
      </div>

      {/* Search */}
      <div className="px-2.5 py-1.5">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search skills…"
            className="h-7 pl-6 text-sm"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Skill rows */}
      <ScrollArea className="flex-1">
        {filteredSkills.map((skill, index) => {
          const isLocked = (!!runningSkillName && skill.name !== runningSkillName) || externalLockedSkills.has(skill.name);
          const isRunning = skill.name === runningSkillName;
          const isSelected = skill.key === selectedSkill;
          const dot = getStatusDot(skill, isRunning);
          const purposeLabel = skill.purpose
            ? (PURPOSE_SHORT_LABELS[skill.purpose as Purpose] ?? skill.purpose)
            : null;

          const menuState = getSkillMenuState(skill);
          const showPluginHeader = index === 0 || filteredSkills[index - 1]?.pluginSlug !== skill.pluginSlug;

          return (
            <div key={skill.key}>
              {showPluginHeader && (
                <div className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  {skill.pluginDisplayName}
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
                onClick={() => handleRowClick(skill)}
                onKeyDown={(e) => {
                  if (!isLocked && (e.key === "Enter" || e.key === " ")) {
                    e.preventDefault();
                    handleRowClick(skill);
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
                          <DropdownMenuItem onSelect={() => handleReview(skill.name)}>
                            Review
                          </DropdownMenuItem>
                        )}
                        {menuState.isBuilder && (
                          <DropdownMenuItem onSelect={() => handleRedo(skill.name)}>
                            Redo workflow
                          </DropdownMenuItem>
                        )}
                        {menuState.isBuilder && <DropdownMenuSeparator />}
                        <DropdownMenuLabel className="px-2 pt-1 pb-0 text-[11px] font-semibold tracking-[0.18em] text-muted-foreground">
                          SKILL
                        </DropdownMenuLabel>
                        <DropdownMenuItem onSelect={() => handleOverview(skill.key)}>
                          Overview
                        </DropdownMenuItem>
                        {menuState.showsLifecycleActions && (
                          <DropdownMenuItem onSelect={() => handleRefine(skill.key)}>
                            Refine
                          </DropdownMenuItem>
                        )}
                        {menuState.showsLifecycleActions && (
                          <DropdownMenuItem onSelect={() => setRestoreTarget(skill.name)}>
                            Restore version
                          </DropdownMenuItem>
                        )}
                        {skill.source !== "marketplace" && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuLabel className="px-2 pt-1 pb-0 text-[11px] font-semibold tracking-[0.18em] text-muted-foreground">
                              PLUGIN
                            </DropdownMenuLabel>
                            <DropdownMenuGroup>
                              {skill.isDefaultPlugin ? (
                                <DropdownMenuItem onSelect={() => handleCreatePlugin(skill)}>
                                  Create plugin
                                </DropdownMenuItem>
                              ) : (
                                <DropdownMenuItem onSelect={() => handleRemoveFromPlugin(skill)}>
                                  Remove from plugin
                                </DropdownMenuItem>
                              )}
                              {pluginOptions.some(([slug]) => slug !== skill.pluginSlug) && (
                                <DropdownMenuItem onSelect={() => handleMoveToPlugin(skill)}>
                                  Move to plugin
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuGroup>
                          </>
                        )}
                      </>
                    ) : (
                      <DropdownMenuItem onSelect={() => handleContinueBuilding(skill.name)}>
                        Continue Building
                      </DropdownMenuItem>
                    )}
                    {skill.isDefaultPlugin && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onSelect={() => handleDelete(skill)}
                          className="text-destructive focus:text-destructive"
                        >
                          Delete
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              </div>
            </div>
          );
        })}
      </ScrollArea>

      {workspacePath && (
        <SkillDialog
          mode="create"
          workspacePath={workspacePath}
          open={createOpen}
          onOpenChange={setCreateOpen}
          onCreated={async (createdName) => {
            localStorage.setItem("last-selected-skill", createdName);
            setSelectedSkill(createdName);
            if (workspacePath) {
              listSkills(workspacePath).then(setSkills).catch(() => {});
            }
          }}
        />
      )}

      <DeleteSkillDialog
        skill={deleteTarget}
        workspacePath={workspacePath ?? ""}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onDeleted={() => {
          setDeleteTarget(null);
          if (workspacePath) listSkills(workspacePath).then(setSkills).catch(() => {});
        }}
      />

      <Dialog open={redoTarget !== null} onOpenChange={(open) => { if (!open) setRedoTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Redo Workflow?</DialogTitle>
            <DialogDescription>
              This will reset the workflow to Step 1 and overwrite all generated artifacts and files for &ldquo;{redoTarget}&rdquo;. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRedoTarget(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => { if (redoTarget) confirmRedo(redoTarget); }}
            >
              Redo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {restoreTarget && workspacePath && (
        <RestoreVersionDialog
          skillName={restoreTarget}
          workspacePath={workspacePath}
          open={!!restoreTarget}
          onOpenChange={(open) => { if (!open) setRestoreTarget(null); }}
          onRestored={() => {
            setRestoreTarget(null);
            if (workspacePath) listSkills(workspacePath).then(setSkills).catch(() => {});
          }}
        />
      )}

      {moveTarget && (
        <MoveToPluginDialog
          open={!!moveTarget}
          onOpenChange={(open) => { if (!open) setMoveTarget(null); }}
          skillName={moveTarget.name}
          skillKey={moveTarget.key}
          currentPluginSlug={moveTarget.pluginSlug}
          onMoved={refreshSkillLists}
        />
      )}

      <CreatePluginDialog
        open={!!createPluginTarget}
        onOpenChange={(open) => { if (!open) setCreatePluginTarget(null); }}
        onCreated={async () => {
          setCreatePluginTarget(null);
          await refreshSkillLists();
        }}
        initialSkillKey={createPluginTarget?.key}
      />
    </div>
  );
}
