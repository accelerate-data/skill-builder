import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FileText } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useSkillStore } from "@/stores/skill-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useRefineStore } from "@/stores/refine-store";
import type { SkillFile } from "@/stores/refine-store";
import { requestEvalsCancel } from "@/lib/eval-running-state";
import { getSkillContentAtPath, getSkillContentForRefine } from "@/lib/tauri";
import type { SkillSummary as TauriSkillSummary } from "@/lib/tauri";
import { PreviewPanel } from "@/components/refine/preview-panel";
import { WorkspaceOverview } from "./workspace-overview";
import { WorkspaceRefine } from "./workspace-refine";
import { WorkspaceEvalWorkbench } from "./workspace-eval-workbench";
import type { SkillSummary, ImportedSkill, EditableSkill } from "@/lib/types";
import { toEditableSkill } from "@/lib/types";
import { patchBuilderSkillQueryData, useBuilderSkillsQuery } from "@/lib/queries/skills";

interface WorkspaceShellProps {
  skill: SkillSummary | ImportedSkill;
  skillType: "builder" | "imported" | "marketplace";
  initialTab?: string;
}

function normalizeWorkspaceTab(tab?: string | null): "overview" | "refine" | "evals" {
  if (tab === "refine") {
    return "refine";
  }
  if (tab === "evals" || tab === "description") {
    return "evals";
  }
  return "overview";
}

export function WorkspaceShell({ skill, skillType, initialTab }: WorkspaceShellProps) {
  const [activeTab, setActiveTab] = useState(() => normalizeWorkspaceTab(initialTab));
  const [pendingTab, setPendingTab] = useState<"overview" | "refine" | "evals" | null>(null);
  const workbenchRunningRef = useRef(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    setActiveTab(normalizeWorkspaceTab(initialTab));
  }, [initialTab]);

  const handleTabChange = useCallback((value: string) => {
    const nextTab = normalizeWorkspaceTab(value);
    // Guard: block switching away from Refine while agent is running
    if (activeTab === "refine" && nextTab !== "refine") {
      const refineRunning = useRefineStore.getState().isRunning;
      if (refineRunning) {
        setPendingTab(nextTab);
        return;
      }
    }
    if (activeTab === "evals" && nextTab !== "evals" && workbenchRunningRef.current) {
      setPendingTab(nextTab);
      return;
    }
    setActiveTab(nextTab);
  }, [activeTab]);

  const skillName = "name" in skill ? skill.name : skill.skill_name;

  // Reset file viewer state whenever the active skill changes so the file viewer
  // re-reads from disk rather than showing the previous skill's content.
  useEffect(() => {
    const store = useRefineStore.getState();
    store.setSkillFiles([]);
    store.setSelectedModifiedFile(null);
  }, [skillName]);

  const handleTabStay = useCallback(() => {
    setPendingTab(null);
  }, []);

  const handleTabLeave = useCallback(async () => {
    if (pendingTab) {
      if (activeTab === "evals" && workbenchRunningRef.current) {
        try {
          await requestEvalsCancel();
        } catch (err) {
          console.error("[workspace-shell] eval workbench cancellation failed:", err);
          return;
        }
      }
      setActiveTab(pendingTab);
      setPendingTab(null);
    }
  }, [pendingTab, activeTab]);
  const selectedModifiedFile = useRefineStore((s) => s.selectedModifiedFile);
  const isBuilderSkill = "name" in skill;
  const workspacePath = useSettingsStore((s) => s.workspacePath);
  const { isFetching: isSkillListFetching } = useBuilderSkillsQuery(workspacePath);

  const toggleFileViewer = useCallback(async () => {
    const store = useRefineStore.getState();
    if (store.selectedModifiedFile) {
      store.setSelectedModifiedFile(null);
      return;
    }

    // Load skill files if not already loaded (e.g. opening from Overview tab).
    if (store.skillFiles.length === 0) {
      try {
        let contents: Awaited<ReturnType<typeof getSkillContentForRefine>>;
        if (isBuilderSkill && workspacePath) {
          contents = await getSkillContentForRefine(
            (skill as SkillSummary).name,
            workspacePath,
            (skill as SkillSummary).plugin_slug,
          );
        } else if (!isBuilderSkill && "disk_path" in skill && (skill as ImportedSkill).disk_path) {
          contents = await getSkillContentAtPath((skill as ImportedSkill).disk_path!);
        } else {
          return;
        }
        const files: SkillFile[] = contents
          .map((c) => ({ filename: c.path, content: c.content }))
          .sort((a, b) => {
            if (a.filename === "SKILL.md") return -1;
            if (b.filename === "SKILL.md") return 1;
            return a.filename.localeCompare(b.filename);
          });
        store.setSkillFiles(files);
        if (files.length > 0) store.setActiveFileTab(files[0].filename);
      } catch {
        return;
      }
    }

    const tab = store.activeFileTab || "SKILL.md";
    store.setActiveFileTab(tab);
    store.setDiffMode(false);
    store.setSelectedModifiedFile(tab);
  }, [isBuilderSkill, workspacePath, skill]);

  // Called by WorkspaceDescription after a description is applied to disk.
  // Patches query data immediately because apply_description writes to disk,
  // while listSkills can still return the prior DB-backed description.
  const handleDescriptionApply = useCallback(async (newDescription: string, newVersion: string) => {
    useSkillStore.getState().setLatestVersion(newVersion);
    patchBuilderSkillQueryData(queryClient, (cachedSkill) =>
      cachedSkill.name === (skill as TauriSkillSummary).name && cachedSkill.plugin_slug === (skill as TauriSkillSummary).plugin_slug
        ? { ...cachedSkill, description: newDescription }
        : cachedSkill
    );

    // 2. Reload skill files so the file viewer (and any open panel) shows updated SKILL.md content.
    if (!isBuilderSkill || !workspacePath) return;
    try {
      const contents = await getSkillContentForRefine(
        (skill as TauriSkillSummary).name,
        workspacePath,
        (skill as TauriSkillSummary).plugin_slug,
      );
      const files: SkillFile[] = contents
        .map((c) => ({ filename: c.path, content: c.content }))
        .sort((a, b) => {
          if (a.filename === "SKILL.md") return -1;
          if (b.filename === "SKILL.md") return 1;
          return a.filename.localeCompare(b.filename);
        });
      const refineStore = useRefineStore.getState();
      refineStore.setSkillFiles(files);
      if (files.length > 0) refineStore.setActiveFileTab(files[0].filename);
    } catch {
      // Non-fatal: file viewer will reload on next open
      useRefineStore.getState().setSkillFiles([]);
    }
  }, [isBuilderSkill, queryClient, workspacePath, skill]);

  return (
    <div className="flex h-full flex-col">
      {/* 48px header */}
      <div className="flex h-12 shrink-0 items-center justify-between border-b px-4">
        <span className="truncate text-sm font-semibold">{skillName}</span>
        {(isBuilderSkill || "disk_path" in skill) && (
          <Button
            type="button"
            variant={selectedModifiedFile ? "secondary" : "ghost"}
            size="icon-xs"
            data-file-viewer-toggle
            onClick={toggleFileViewer}
            title={selectedModifiedFile ? "Close file viewer" : "View skill files"}
            aria-label={selectedModifiedFile ? "Close file viewer" : "View skill files"}
          >
            <FileText className="size-3.5" />
          </Button>
        )}
      </div>

      {/* Tabs + overlay container */}
      <div className="relative min-h-0 flex-1">
        <Tabs
          value={activeTab}
          onValueChange={handleTabChange}
          className="flex h-full flex-col"
        >
          <TabsList variant="line" className="shrink-0 border-b px-4">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="refine">Refine</TabsTrigger>
            <TabsTrigger value="evals">Eval Workbench</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="flex-1 overflow-y-auto p-6">
            <WorkspaceOverview
              skill={skill}
              skillType={skillType}
              isLoading={isSkillListFetching}
            />
          </TabsContent>

          <TabsContent value="refine" className="min-h-0 flex-1 overflow-hidden">
            <WorkspaceRefine
              skill={"name" in skill ? (skill as EditableSkill) : toEditableSkill(skill as ImportedSkill)}
            />
          </TabsContent>

          <TabsContent value="evals" className="min-h-0 flex-1 overflow-hidden">
            <WorkspaceEvalWorkbench
              key={"name" in skill ? skill.name : skill.skill_name}
              skill={skill}
              workspacePath={workspacePath}
              initialMode={initialTab === "description" ? "trigger" : "performance"}
              onNavigateToRefine={() => setActiveTab("refine")}
              onRunningChange={(running) => {
                workbenchRunningRef.current = running;
              }}
              onApplyDescription={(desc, ver) =>
                void handleDescriptionApply(desc, ver)
              }
            />
          </TabsContent>
        </Tabs>

        <PreviewPanel />
      </div>

      {pendingTab !== null && (
        <Dialog open onOpenChange={(open) => { if (!open) handleTabStay(); }}>
          <DialogContent showCloseButton={false}>
            <DialogHeader>
              <DialogTitle>Process Running</DialogTitle>
              <DialogDescription>
                A process is still running. Switching tabs will abandon the session.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={handleTabStay}>
                Stay
              </Button>
              <Button variant="destructive" onClick={() => void handleTabLeave()}>
                Leave
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
