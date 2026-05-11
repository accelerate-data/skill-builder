import { useState, useEffect, useMemo } from "react";
import { useRouterState } from "@tanstack/react-router";
import { useWorkflowStore } from "@/stores/workflow-store";
import { useSkillStore } from "@/stores/skill-store";
import { PanelLeftClose, Plus, Search, Upload } from "lucide-react";
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
import { toast } from "@/lib/toast";
import SkillDialog from "@/components/skill-dialog";
import DeleteSkillDialog from "@/components/delete-skill-dialog";
import RestoreVersionDialog from "@/components/workspace/restore-version-dialog";
import { ImportSkillDialog } from "@/components/import-skill-dialog";
import { CreatePluginDialog } from "@/components/create-plugin-dialog";
import { MoveToPluginDialog } from "@/components/move-to-plugin-dialog";
import { SkillRow } from "@/components/skill-row";
import { useSettingsStore } from "@/stores/settings-store";
import { useAgentStore } from "@/stores/agent-store";
import {
  useUnifiedSkills,
} from "@/hooks/use-unified-skills";
import type { UnifiedSkill } from "@/hooks/use-unified-skills";
import type { SkillSummary } from "@/lib/types";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  deletePlugin,
  exportSkillAsFile,
  getExternallyLockedSkills,
  parseSkillFile,
  removeSkillFromPlugin,
  resetWorkflowStep,
} from "@/lib/tauri";
import { restartSkillOpenHandsSession } from "@/lib/skill-openhands-session";
import type { SkillFileMeta } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  useBuilderSkillsQuery,
  useDeleteImportedSkillMutation,
  useImportedSkillsQuery,
  useInvalidateSkillQueries,
} from "@/lib/queries/skills";

export interface SkillListPanelProps {
  onSelectSkill?: (name: string, tab?: string) => Promise<void> | void;
  onActivateSkill?: (name: string, targetSurface?: "workflow" | "workspace") => Promise<void> | void;
  onCreateSkill?: () => void;
  onCollapse?: () => void;
  className?: string;
}

export function SkillListPanel({
  onSelectSkill,
  onActivateSkill,
  onCreateSkill,
  onCollapse,
  className,
}: SkillListPanelProps) {
  const [createOpen, setCreateOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadFile, setUploadFile] = useState("");
  const [uploadMeta, setUploadMeta] = useState<SkillFileMeta>({
    name: null, description: null, version: null,
    user_invocable: null, disable_model_invocation: null,
  });
  const [search, setSearch] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<SkillSummary | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [redoTarget, setRedoTarget] = useState<string | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<{ skillName: string; pluginSlug: string } | null>(null);
  const lockedSkills = useSkillStore((s) => s.lockedSkills);
  const setLockedSkills = useSkillStore((s) => s.setLockedSkills);
  const [moveTarget, setMoveTarget] = useState<UnifiedSkill | null>(null);
  const [createPluginTarget, setCreatePluginTarget] = useState<UnifiedSkill | null>(null);
  const [deletePluginTarget, setDeletePluginTarget] = useState<{ slug: string; displayName: string } | null>(null);
  const [deletingPlugin, setDeletingPlugin] = useState(false);

  const workspacePath = useSettingsStore((s) => s.workspacePath);
  const selectedSkillId = useSkillStore((s) => s.activeSkillId);
  const setSelectedSkill = useSkillStore((s) => s.setActiveSkill);
  const { data: builderSkills = [] } = useBuilderSkillsQuery(workspacePath);
  const { data: importedSkills = [] } = useImportedSkillsQuery();
  const deleteImportedSkillMutation = useDeleteImportedSkillMutation();
  const invalidateSkillQueries = useInvalidateSkillQueries();
  const runs = useAgentStore((s) => s.runs);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  // Refresh external locks on mount, interval ticks, and window focus
  useEffect(() => {
    let cancelled = false;

    const refreshLocks = async () => {
      try {
        const names = await getExternallyLockedSkills();
        if (!cancelled) {
          setLockedSkills(new Set(names));
        }
      } catch {
        // non-fatal
      }
    };

    void refreshLocks();
    const intervalId = window.setInterval(() => {
      void refreshLocks();
    }, 3000);
    const onFocus = () => {
      void refreshLocks();
    };
    window.addEventListener("focus", onFocus);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", onFocus);
    };
  }, [pathname, setLockedSkills]);

  // Sort by creation date (newest first) — stable across edits since created_at never changes.
  const unifiedSkills = useUnifiedSkills(builderSkills, importedSkills);

  // Default selection once query data is available.
  useEffect(() => {
    if (unifiedSkills.length === 0 || selectedSkillId) return;
    const stored = localStorage.getItem("last-selected-skill");
    const key = stored && unifiedSkills.some((s) => s.key === stored)
      ? stored
      : unifiedSkills[0].key;
    const skill = unifiedSkills.find((candidate) => candidate.key === key);
    if (!skill) return;
    setSelectedSkill(skill.skillId);
    void onActivateSkill?.(key);
  }, [onActivateSkill, selectedSkillId, setSelectedSkill, unifiedSkills]);

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
  const redoSkill = redoTarget
    ? unifiedSkills.find((candidate) => candidate.key === redoTarget) ?? null
    : null;

  async function handleRowClick(skill: UnifiedSkill) {
    // All other rows are locked while a workflow or refine agent runs
    if (runningSkillName && skill.name !== runningSkillName) return;
    // Running skill is also a no-op
    if (skill.name === runningSkillName) return;
    // Skill locked by another instance
    if (lockedSkills.has(skill.name)) return;

    console.log("event=skill_selected skill=%s", skill.name);
    localStorage.setItem("last-selected-skill", skill.key);
    setSelectedSkill(skill.skillId);
    await onSelectSkill?.(skill.key);
  }

  function handleRedo(skill: UnifiedSkill) {
    setRedoTarget(skill.key);
  }

  async function confirmRedo(skill: UnifiedSkill) {
    if (!workspacePath) return;
    try {
      await resetWorkflowStep(workspacePath, skill.name, 0);
      await restartSkillOpenHandsSession(
        {
          name: skill.name,
          plugin_slug: skill.pluginSlug,
          skill_source: skill.source,
          description: skill.description,
          purpose: skill.purpose,
          status: skill.status,
          current_step: skill.currentStep,
        },
        workspacePath,
      );
      console.log("event=skill_redo skill=%s", skill.name);
      // Reset store so persistence hook re-hydrates from DB (picks up the step reset).
      useWorkflowStore.getState().reset();
      localStorage.setItem("last-selected-skill", skill.key);
      setSelectedSkill(skill.skillId);
      setRedoTarget(null);
      await onActivateSkill?.(skill.key, "workflow");
    } catch (err) {
      toast.error(`Failed to reset workflow: ${err instanceof Error ? err.message : String(err)}`);
      console.error("event=skill_redo_failed skill=%s error=%s", skill.name, err);
    }
  }

  async function handleOverview(skillKey: string) {
    console.log("event=skill_overview skill=%s", skillKey);
    await onSelectSkill?.(skillKey, "overview");
  }

  async function handleEval(skillKey: string) {
    console.log("event=skill_eval skill=%s", skillKey);
    await onSelectSkill?.(skillKey, "evals");
  }

  async function handleRefine(skillKey: string) {
    console.log("event=skill_refine skill=%s", skillKey);
    await onSelectSkill?.(skillKey, "refine");
  }

  async function handleReview(skill: UnifiedSkill) {
    console.log("event=skill_review skill=%s", skill.name);
    localStorage.setItem("last-selected-skill", skill.key);
    setSelectedSkill(skill.skillId);
    await onActivateSkill?.(skill.key, "workflow");
  }

  async function handleContinueBuilding(skill: UnifiedSkill) {
    console.log("event=skill_continue skill=%s", skill.name);
    localStorage.setItem("last-selected-skill", skill.key);
    setSelectedSkill(skill.skillId);
    await onActivateSkill?.(skill.key, "workflow");
  }

  function handleDelete(skill: UnifiedSkill) {
    if (skill.importedSkillId) {
      const toastId = toast.loading(`Deleting "${skill.name}"...`);
      deleteImportedSkillMutation.mutateAsync(Number(skill.importedSkillId))
        .then(() => toast.success(`Deleted "${skill.name}"`, { id: toastId }))
        .catch((err) => toast.error(`Delete failed: ${err instanceof Error ? err.message : String(err)}`, { id: toastId }));
      return;
    }
    const summary = builderSkills.find((s) => s.name === skill.name) ?? null;
    setDeleteTarget(summary);
    setDeleteOpen(true);
  }

  async function refreshSkillLists() {
    await invalidateSkillQueries();
  }

  function handleDeletePlugin(pluginSlug: string, pluginDisplayName: string) {
    setDeletePluginTarget({ slug: pluginSlug, displayName: pluginDisplayName });
  }

  async function confirmDeletePlugin() {
    if (!deletePluginTarget) return;
    setDeletingPlugin(true);
    const toastId = toast.loading(`Deleting plugin "${deletePluginTarget.displayName}"...`);
    try {
      await deletePlugin(deletePluginTarget.slug);
      toast.success(`Deleted plugin "${deletePluginTarget.displayName}"`, { id: toastId });
      setDeletePluginTarget(null);
      await refreshSkillLists();
    } catch (err) {
      toast.error(
        `Failed to delete plugin: ${err instanceof Error ? err.message : String(err)}`,
        { id: toastId },
      );
    } finally {
      setDeletingPlugin(false);
    }
  }

  function handleCreatePlugin(skill: UnifiedSkill) {
    setCreatePluginTarget(skill)
  }

  function handleMoveToPlugin(skill: UnifiedSkill) {
    setMoveTarget(skill)
  }

  async function handleUpload() {
    const filePath = await open({
      title: "Import Skill Package",
      filters: [{ name: "Skill Package", extensions: ["skill", "zip"] }],
    });
    if (!filePath) return;
    try {
      const meta = await parseSkillFile(filePath);
      setUploadFile(filePath);
      setUploadMeta(meta);
      setUploadOpen(true);
    } catch (err) {
      console.error("[skill-list-panel] parse failed:", err);
      toast.error("Import failed: not a valid skill package.", {
        duration: Infinity, cause: err, context: { operation: "skill_list_upload_parse" },
      });
    }
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

  async function handleExportAsSkill(skill: UnifiedSkill) {
    const destPath = await save({
      title: "Export Skill",
      defaultPath: `${skill.name}.skill`,
      filters: [{ name: "Skill Package", extensions: ["skill"] }],
    });
    if (!destPath) return;
    try {
      await exportSkillAsFile(skill.name, skill.pluginSlug, destPath);
      toast.success(`Exported "${skill.name}"`);
    } catch (err) {
      toast.error(`Export failed: ${err instanceof Error ? err.message : String(err)}`, {
        duration: Infinity,
      });
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
        <Button
          variant="ghost"
          size="icon-sm"
          className="size-7"
          onClick={handleUpload}
          title="Upload skill"
        >
          <Upload className="size-4" />
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
          const isLocked = (!!runningSkillName && skill.name !== runningSkillName) || lockedSkills.has(skill.name);
          const isRunning = skill.name === runningSkillName;
          const isSelected = skill.skillId === selectedSkillId;
          const showPluginHeader = index === 0 || filteredSkills[index - 1]?.pluginSlug !== skill.pluginSlug;

          return (
            <SkillRow
              key={skill.key}
              skill={skill}
              isSelected={isSelected}
              isLocked={isLocked}
              isRunning={isRunning}
              showPluginHeader={showPluginHeader}
              onRowClick={handleRowClick}
              onReview={handleReview}
              onRedo={handleRedo}
              onOverview={handleOverview}
              onEval={handleEval}
              onRefine={handleRefine}
              onContinueBuilding={handleContinueBuilding}
              onRestore={(name, pluginSlug) => setRestoreTarget({ skillName: name, pluginSlug })}
              onDelete={handleDelete}
              onCreatePlugin={handleCreatePlugin}
              onMoveToPlugin={handleMoveToPlugin}
              onRemoveFromPlugin={handleRemoveFromPlugin}
              onExport={handleExportAsSkill}
              onDeletePlugin={handleDeletePlugin}
              pluginOptions={pluginOptions}
            />
          );
        })}
      </ScrollArea>

      {workspacePath && (
        <SkillDialog
          mode="create"
          workspacePath={workspacePath}
          open={createOpen}
          onOpenChange={setCreateOpen}
          onCreated={async (createdSkillId) => {
            localStorage.setItem("last-selected-skill", createdSkillId);
            useSkillStore.getState().setActiveSkill(createdSkillId);
            await invalidateSkillQueries();
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
          invalidateSkillQueries().catch(() => {});
        }}
      />

      <Dialog open={redoTarget !== null} onOpenChange={(open) => { if (!open) setRedoTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Redo Workflow?</DialogTitle>
            <DialogDescription>
              This will reset the workflow to Step 1 and overwrite all generated artifacts and files for &ldquo;{redoSkill?.name ?? redoTarget}&rdquo;. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRedoTarget(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (!redoTarget) return;
                const skill = redoSkill;
                if (!skill) {
                  toast.error(`Failed to reset workflow: Skill '${redoTarget}' is not available`);
                  return;
                }
                void confirmRedo(skill);
              }}
            >
              Redo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deletePluginTarget !== null}
        onOpenChange={(open) => { if (!open && !deletingPlugin) setDeletePluginTarget(null); }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Plugin?</DialogTitle>
            <DialogDescription>
              {(() => {
                if (!deletePluginTarget) return null;
                const skillCount = unifiedSkills.filter(
                  (s) => s.pluginSlug === deletePluginTarget.slug,
                ).length;
                return skillCount > 0
                  ? `This will permanently delete the plugin "${deletePluginTarget.displayName}" and all ${skillCount} skill${skillCount === 1 ? "" : "s"} inside it, including their files. This cannot be undone.`
                  : `This will permanently delete the plugin "${deletePluginTarget.displayName}". This cannot be undone.`;
              })()}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setDeletePluginTarget(null)}
              disabled={deletingPlugin}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDeletePlugin}
              disabled={deletingPlugin}
            >
              {deletingPlugin ? "Deleting…" : "Delete Plugin"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ImportSkillDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        filePath={uploadFile}
        meta={uploadMeta}
        onImported={() => {
          setUploadOpen(false);
          invalidateSkillQueries().catch(() => {});
        }}
      />


      {restoreTarget && workspacePath && (
        <RestoreVersionDialog
          skillName={restoreTarget.skillName}
          pluginSlug={restoreTarget.pluginSlug}
          workspacePath={workspacePath}
          open={!!restoreTarget}
          onOpenChange={(open) => { if (!open) setRestoreTarget(null); }}
          onRestored={() => {
            setRestoreTarget(null);
            invalidateSkillQueries().catch(() => {});
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
