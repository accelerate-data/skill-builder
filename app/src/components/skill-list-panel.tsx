import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useWorkflowStore } from "@/stores/workflow-store";
import { useSkillStore } from "@/stores/skill-store";
import { Lock, MoreHorizontal, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { save } from "@tauri-apps/plugin-dialog";
import { toast } from "@/lib/toast";
import SkillDialog from "@/components/skill-dialog";
import DeleteSkillDialog from "@/components/delete-skill-dialog";
import { useSettingsStore } from "@/stores/settings-store";
import { useImportedSkillsStore } from "@/stores/imported-skills-store";
import { useAgentStore } from "@/stores/agent-store";
import type { SkillSummary, ImportedSkill, Purpose } from "@/lib/types";
import { PURPOSE_SHORT_LABELS } from "@/lib/types";
import { listSkills, exportSkill, packageSkill, saveExportTo, resetWorkflowStep, getLockedSkills } from "@/lib/tauri";
import { cn } from "@/lib/utils";

interface UnifiedSkill {
  name: string;
  description: string | null;
  purpose: string | null;
  lastModified: Date | null;
  createdAt: Date | null;
  source: "builder" | "imported" | "marketplace";
  status: string | null;
  currentStep: string | null;
}

export interface SkillListPanelProps {
  onSelectSkill?: (name: string) => void;
  onCreateSkill?: () => void;
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
  if (skill.status === "completed") return true;
  if (skill.source === "imported" || skill.source === "marketplace") return true;
  return false;
}

interface DotStyle {
  className: string;
  style?: React.CSSProperties;
}

function getStatusDot(skill: UnifiedSkill, isRunning: boolean): DotStyle {
  const pulse = isRunning ? " animate-dot-pulse" : "";

  // Complete / imported → green (status="completed" always wins over current_step)
  if (isSkillComplete(skill)) {
    return { className: pulse.trim(), style: { backgroundColor: "var(--color-seafoam)" } };
  }

  const stepMatch = skill.currentStep?.match(/step\s*(\d+)/i);
  const step = stepMatch ? Number(stepMatch[1]) : null;

  // Mid-progress (any step past the first) → amber
  if (step !== null && step >= 1) {
    return { className: `bg-amber-500 dark:bg-amber-400${pulse}` };
  }

  // Not started / Step 0 / Step 1 → red
  return { className: `bg-destructive${pulse}` };
}

function mergeSkills(
  builderSkills: SkillSummary[],
  importedSkills: ImportedSkill[],
): UnifiedSkill[] {
  const fromBuilder: UnifiedSkill[] = builderSkills.map((s) => ({
    name: s.name,
    description: s.description ?? null,
    purpose: s.purpose,
    lastModified: s.last_modified ? new Date(s.last_modified) : null,
    createdAt: s.created_at ? new Date(s.created_at) : null,
    source: s.skill_source === "marketplace" ? "marketplace" : ("builder" as const),
    status: s.status,
    currentStep: s.current_step,
  }));

  const fromImported: UnifiedSkill[] = importedSkills.map((s) => ({
    name: s.skill_name,
    description: s.description,
    purpose: s.purpose,
    lastModified: new Date(s.imported_at),
    createdAt: new Date(s.imported_at),
    source: s.marketplace_source_url ? ("marketplace" as const) : ("imported" as const),
    status: null,
    currentStep: null,
  }));

  // Deduplicate by name — builder entry wins over imported (has richer status info)
  const byName = new Map<string, UnifiedSkill>();
  for (const s of fromBuilder) byName.set(s.name, s);
  for (const s of fromImported) {
    if (!byName.has(s.name)) byName.set(s.name, s);
  }

  // Sort by creation date descending — newest skill first, stable across edits
  return Array.from(byName.values()).sort((a, b) => {
    const at = a.createdAt?.getTime() ?? 0;
    const bt = b.createdAt?.getTime() ?? 0;
    return bt - at;
  });
}

export function SkillListPanel({
  onSelectSkill,
  onCreateSkill,
  className,
}: SkillListPanelProps) {
  const [createOpen, setCreateOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedSkill, setSelectedSkill] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SkillSummary | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [redoTarget, setRedoTarget] = useState<string | null>(null);
  const [externalLockedSkills, setExternalLockedSkills] = useState<Set<string>>(new Set());

  const workspacePath = useSettingsStore((s) => s.workspacePath);
  const builderSkills = useSkillStore((s) => s.skills);
  const setSkills = useSkillStore((s) => s.setSkills);
  const importedSkills = useImportedSkillsStore((s) => s.skills);
  const fetchImportedSkills = useImportedSkillsStore((s) => s.fetchSkills);
  const runs = useAgentStore((s) => s.runs);
  const navigate = useNavigate();

  // Fetch both skill lists and external lock state whenever workspacePath becomes available
  useEffect(() => {
    if (!workspacePath) return;
    listSkills(workspacePath)
      .then(setSkills)
      .catch((err) => console.error("event=fetch_skills_failed error=%s", err));
    fetchImportedSkills().catch((err) =>
      console.error("event=fetch_imported_skills_failed error=%s", err),
    );
    getLockedSkills()
      .then((locks) => setExternalLockedSkills(new Set(locks.map((l) => l.skill_name))))
      .catch(() => { /* non-fatal */ });
  }, [workspacePath, setSkills, fetchImportedSkills]);

  // Sort by creation date (newest first) — stable across edits since created_at never changes.
  const unifiedSkills = useMemo(
    () => mergeSkills(builderSkills, importedSkills),
    [builderSkills, importedSkills],
  );

  // Default selection — run once on mount after stores are populated
  useEffect(() => {
    const stored = localStorage.getItem("last-selected-skill");
    if (stored && unifiedSkills.some((s) => s.name === stored)) {
      setSelectedSkill(stored);
    } else if (unifiedSkills.length > 0) {
      setSelectedSkill(unifiedSkills[0].name);
    }
    // Intentionally mount-only: we only restore the saved selection once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runningWorkflow = Object.values(runs).find(
    (r) => r.status === "running" && r.runSource === "workflow",
  );
  const runningSkillName = runningWorkflow?.skillName ?? null;

  const filteredSkills = unifiedSkills.filter((s) =>
    s.name.toLowerCase().includes(search.toLowerCase()),
  );

  function handleRowClick(skill: UnifiedSkill) {
    // All other rows are locked while a workflow runs
    if (runningSkillName && skill.name !== runningSkillName) return;
    // Running skill is also a no-op
    if (skill.name === runningSkillName) return;

    console.log("event=skill_selected skill=%s", skill.name);
    localStorage.setItem("last-selected-skill", skill.name);
    setSelectedSkill(skill.name);

    if (isSkillComplete(skill)) {
      onSelectSkill?.(skill.name);
    } else {
      const stepMatch = skill.currentStep?.match(/step\s*(\d+)/i);
      const step = stepMatch ? Number(stepMatch[1]) : null;
      const isFresh = step === null || step === 0;
      if (isFresh) {
        useWorkflowStore.getState().setPendingUpdateMode(true); // auto-start fresh skills
      }
      // Mid-way: no pending flag → default reviewMode=true (Review mode, no auto-start)
      navigate({ to: "/skill/$skillName", params: { skillName: skill.name } });
    }
  }

  async function handleExport(skill: UnifiedSkill) {
    const toastId = toast.loading("Exporting skill...");
    try {
      // Builder skills live in the workspace — use package_skill.
      // Imported/marketplace skills are in the installed-skills DB — use export_skill.
      let zipPath: string;
      if (skill.source === "builder") {
        if (!workspacePath) throw new Error("Workspace path not set");
        const result = await packageSkill(skill.name, workspacePath);
        zipPath = result.file_path;
      } else {
        zipPath = await exportSkill(skill.name);
      }
      const savePath = await save({
        defaultPath: `${skill.name}.zip`,
        filters: [{ name: "Zip Archive", extensions: ["zip"] }],
      });
      if (savePath) {
        await saveExportTo(zipPath, savePath);
        toast.success(`Saved to ${savePath}`, { id: toastId });
        console.log("event=skill_exported skill=%s dest=%s", skill.name, savePath);
      } else {
        toast.dismiss(toastId);
      }
    } catch (err) {
      toast.error(
        `Export failed: ${err instanceof Error ? err.message : String(err)}`,
        { id: toastId },
      );
      console.error("event=skill_export_failed skill=%s error=%s", skill.name, err);
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
      useWorkflowStore.getState().setPendingUpdateMode(true);
      setRedoTarget(null);
      navigate({ to: "/skill/$skillName", params: { skillName } });
    } catch (err) {
      toast.error(`Failed to reset workflow: ${err instanceof Error ? err.message : String(err)}`);
      console.error("event=skill_redo_failed skill=%s error=%s", skillName, err);
    }
  }

  function handleOverview(skillName: string) {
    console.log("event=skill_overview skill=%s", skillName);
    localStorage.setItem("last-selected-skill", skillName);
    setSelectedSkill(skillName);
    useSkillStore.getState().setActiveSkill(skillName);
    navigate({ to: "/", search: { tab: "overview" } });
  }

  function handleRefine(skillName: string) {
    console.log("event=skill_refine skill=%s", skillName);
    useSkillStore.getState().setActiveSkill(skillName);
    navigate({ to: "/", search: { tab: "refine" } });
  }

  function handleContinueBuilding(skillName: string) {
    console.log("event=skill_continue skill=%s", skillName);
    localStorage.setItem("last-selected-skill", skillName);
    setSelectedSkill(skillName);
    useWorkflowStore.getState().setPendingUpdateMode(true); // always auto-start
    navigate({ to: "/skill/$skillName", params: { skillName } });
  }

  function handleDelete(skill: UnifiedSkill) {
    const summary = builderSkills.find((s) => s.name === skill.name) ?? null;
    setDeleteTarget(summary);
    setDeleteOpen(true);
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
        <Badge variant="secondary" className="rounded-full px-1.5 py-px text-[13px]">
          {filteredSkills.length}
        </Badge>
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
        {filteredSkills.map((skill) => {
          const isLocked = (!!runningSkillName && skill.name !== runningSkillName) || externalLockedSkills.has(skill.name);
          const isRunning = skill.name === runningSkillName;
          const isSelected = skill.name === selectedSkill;
          const dot = getStatusDot(skill, isRunning);
          const purposeLabel = skill.purpose
            ? (PURPOSE_SHORT_LABELS[skill.purpose as Purpose] ?? skill.purpose)
            : null;

          const complete = isSkillComplete(skill);

          return (
            <div
              key={skill.name}
              role="button"
              tabIndex={isLocked ? -1 : 0}
              aria-selected={isSelected}
              className={cn(
                "group flex h-[46px] cursor-pointer items-center gap-2 px-3 transition-colors",
                isSelected && "bg-accent",
                !isSelected && !isLocked && "hover:bg-accent/50",
                isLocked && "cursor-not-allowed opacity-[0.45]",
              )}
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
                aria-label={`status-dot-${skill.name}`}
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
                      className="size-5 shrink-0 opacity-0 group-hover:opacity-100"
                      aria-label="More actions"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <MoreHorizontal className="size-3" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                    {complete ? (
                      <>
                        <DropdownMenuItem onSelect={() => handleOverview(skill.name)}>
                          Overview
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => handleRefine(skill.name)}>
                          Refine
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => handleRedo(skill.name)}>
                          Redo
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => handleExport(skill)}>
                          Export
                        </DropdownMenuItem>
                      </>
                    ) : (
                      <DropdownMenuItem onSelect={() => handleContinueBuilding(skill.name)}>
                        Continue Building
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onSelect={() => handleDelete(skill)}
                      className="text-destructive focus:text-destructive"
                    >
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
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
          onCreated={async () => {
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
    </div>
  );
}
