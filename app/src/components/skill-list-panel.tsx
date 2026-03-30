import { useState, useEffect, useMemo } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
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
import { useImportedSkillsStore } from "@/stores/imported-skills-store";
import { useAgentStore } from "@/stores/agent-store";
import {
  useUnifiedSkills,
  isSkillComplete,
} from "@/hooks/use-unified-skills";
import type { UnifiedSkill } from "@/hooks/use-unified-skills";
import type { SkillSummary } from "@/lib/types";
import { open } from "@tauri-apps/plugin-dialog";
import {
  deletePlugin,
  getExternallyLockedSkills,
  listSkills,
  parseSkillFile,
  removeSkillFromPlugin,
  resetWorkflowStep,
} from "@/lib/tauri";
import type { SkillFileMeta } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface SkillListPanelProps {
  onSelectSkill?: (name: string, tab?: string) => void;
  onCreateSkill?: () => void;
  onCollapse?: () => void;
  className?: string;
}

export function SkillListPanel({
  onSelectSkill,
  onCreateSkill,
  onCollapse,
  className,
}: SkillListPanelProps) {
  const [createOpen, setCreateOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadFile, setUploadFile] = useState("");
  const [uploadMeta, setUploadMeta] = useState<SkillFileMeta>({
    name: null, description: null, version: null, model: null,
    argument_hint: null, user_invocable: null, disable_model_invocation: null,
  });
  const [search, setSearch] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<SkillSummary | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [redoTarget, setRedoTarget] = useState<string | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<string | null>(null);
  const [externalLockedSkills, setExternalLockedSkills] = useState<Set<string>>(new Set());
  const [moveTarget, setMoveTarget] = useState<UnifiedSkill | null>(null);
  const [createPluginTarget, setCreatePluginTarget] = useState<UnifiedSkill | null>(null);
  const [deletePluginTarget, setDeletePluginTarget] = useState<{ slug: string; displayName: string } | null>(null);
  const [deletingPlugin, setDeletingPlugin] = useState(false);

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
  const unifiedSkills = useUnifiedSkills(builderSkills, importedSkills);

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
    onSelectSkill?.(skillKey, "overview");
  }

  function handleRefine(skillKey: string) {
    console.log("event=skill_refine skill=%s", skillKey);
    onSelectSkill?.(skillKey, "refine");
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
          const isLocked = (!!runningSkillName && skill.name !== runningSkillName) || externalLockedSkills.has(skill.name);
          const isRunning = skill.name === runningSkillName;
          const isSelected = skill.key === selectedSkill;
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
              onRefine={handleRefine}
              onContinueBuilding={handleContinueBuilding}
              onRestore={(name) => setRestoreTarget(name)}
              onDelete={handleDelete}
              onCreatePlugin={handleCreatePlugin}
              onMoveToPlugin={handleMoveToPlugin}
              onRemoveFromPlugin={handleRemoveFromPlugin}
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
          fetchImportedSkills().catch(() => {});
        }}
      />

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
