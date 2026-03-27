import { useCallback, useEffect, useRef, useState } from "react";
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
import { cleanupSkillSidecar, getSkillContentForRefine } from "@/lib/tauri";
import { PreviewPanel } from "@/components/refine/preview-panel";
import { WorkspaceOverview } from "./workspace-overview";
import { WorkspaceRefine } from "./workspace-refine";
import { WorkspaceEvals } from "./workspace-evals";
import { WorkspaceDescription } from "./workspace-description";
import type { SkillSummary, ImportedSkill, EditableSkill } from "@/lib/types";
import { toEditableSkill } from "@/lib/types";

interface WorkspaceShellProps {
  skill: SkillSummary | ImportedSkill;
  skillType: "builder" | "imported" | "marketplace";
  initialTab?: string;
}

export function WorkspaceShell({ skill, skillType, initialTab }: WorkspaceShellProps) {
  const [activeTab, setActiveTab] = useState(initialTab ?? "overview");
  const [pendingTab, setPendingTab] = useState<string | null>(null);
  const evalsRunningRef = useRef(false);
  const isSkillStoreLoading = useSkillStore((s) => s.isLoading);

  // Sync tab when a navigation sets initialTab (e.g. "Refine" from the More menu)
  useEffect(() => {
    if (initialTab) setActiveTab(initialTab);
  }, [initialTab]);

  const handleTabChange = useCallback((value: string) => {
    // Guard: block switching away from Refine while agent is running
    if (activeTab === "refine" && value !== "refine") {
      const refineRunning = useRefineStore.getState().isRunning;
      if (refineRunning) {
        setPendingTab(value);
        return;
      }
    }
    // Guard: block switching away from Evals while eval run is in progress
    if (activeTab === "evals" && value !== "evals" && evalsRunningRef.current) {
      setPendingTab(value);
      return;
    }
    setActiveTab(value);
  }, [activeTab]);

  const skillName = "name" in skill ? skill.name : skill.skill_name;

  const handleTabStay = useCallback(() => {
    setPendingTab(null);
  }, []);

  const handleTabLeave = useCallback(() => {
    if (pendingTab) {
      // Clean up sidecar processes when leaving a tab with a running agent
      if (activeTab === "evals" && evalsRunningRef.current) {
        cleanupSkillSidecar(skillName).catch((err) =>
          console.error("[workspace-shell] eval sidecar cleanup failed:", err),
        );
      }
      setActiveTab(pendingTab);
      setPendingTab(null);
    }
  }, [pendingTab, activeTab, skillName]);
  const selectedModifiedFile = useRefineStore((s) => s.selectedModifiedFile);
  const isBuilderSkill = "name" in skill;
  const workspacePath = useSettingsStore((s) => s.workspacePath);

  const toggleFileViewer = useCallback(async () => {
    const store = useRefineStore.getState();
    if (store.selectedModifiedFile) {
      store.setSelectedModifiedFile(null);
      return;
    }

    // Load skill files if not already loaded (e.g. opening from Overview tab).
    if (store.skillFiles.length === 0 && isBuilderSkill && workspacePath) {
      try {
        const contents = await getSkillContentForRefine(
          (skill as SkillSummary).name,
          workspacePath,
          (skill as SkillSummary).plugin_slug,
        );
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

  return (
    <div className="flex h-full flex-col">
      {/* 48px header */}
      <div className="flex h-12 shrink-0 items-center justify-between border-b px-4">
        <span className="truncate text-sm font-semibold">{skillName}</span>
        {isBuilderSkill && (
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
            <TabsTrigger value="evals">Evals</TabsTrigger>
            <TabsTrigger value="description">
              Description
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="flex-1 overflow-y-auto p-6">
            <WorkspaceOverview
              skill={skill}
              skillType={skillType}
              isLoading={isSkillStoreLoading}
            />
          </TabsContent>

          <TabsContent value="refine" className="min-h-0 flex-1 overflow-hidden">
            <WorkspaceRefine
              skill={"name" in skill ? (skill as EditableSkill) : toEditableSkill(skill as ImportedSkill)}
            />
          </TabsContent>

          <TabsContent value="evals" className="flex-1 overflow-y-auto p-6">
            <WorkspaceEvals
              skill={skill}
              workspacePath={workspacePath}
              onNavigateToRefine={() => setActiveTab("refine")}
              onRunningChange={(running) => { evalsRunningRef.current = running; }}
            />
          </TabsContent>

          <TabsContent value="description" className="flex-1 overflow-y-auto p-6">
            {"name" in skill ? (
              <WorkspaceDescription
                skill={skill as SkillSummary}
                workspacePath={workspacePath ?? ""}
              />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                Description optimization is not available for imported skills.
              </div>
            )}
          </TabsContent>
        </Tabs>

        <PreviewPanel />
      </div>

      {pendingTab !== null && (
        <Dialog open onOpenChange={(open) => { if (!open) handleTabStay(); }}>
          <DialogContent showCloseButton={false}>
            <DialogHeader>
              <DialogTitle>Agent Running</DialogTitle>
              <DialogDescription>
                An agent is still running. Switching tabs will abandon the session.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={handleTabStay}>
                Stay
              </Button>
              <Button variant="destructive" onClick={handleTabLeave}>
                Leave
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
