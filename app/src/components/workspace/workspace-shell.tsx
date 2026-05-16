import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, Lock } from "lucide-react";
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
import { useSettingsStore } from "@/stores/settings-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { requestEvalsCancel } from "@/lib/eval-running-state";
import { loadSkillFiles } from "@/lib/skill-file-loader";
import { PreviewPanel } from "@/components/workspace/preview-panel";
import { WorkspaceOverview } from "./workspace-overview";
import { WorkspaceEvalWorkbench } from "./workspace-eval-workbench";
import { WorkspaceConversation } from "./workspace-conversation";
import type { SkillSummary, ImportedSkill } from "@/lib/types";
import { useBuilderSkillsQuery } from "@/lib/queries/skills";
import { useIsSkillLocked } from "@/stores/skill-store";

export type WorkspaceSurface = "conversation" | "overview" | "evals";

interface WorkspaceShellProps {
  skill: SkillSummary | ImportedSkill;
  skillType: "builder" | "imported" | "marketplace";
  className?: string;
}

export function WorkspaceShell({ skill, skillType, className }: WorkspaceShellProps) {
  const activeTab = useWorkspaceStore((s) => s.activeSurface);
  const setActiveTab = useWorkspaceStore((s) => s.setActiveSurface);
  const resetFileViewer = useWorkspaceStore((s) => s.resetFileViewer);
  const selectedModifiedFile = useWorkspaceStore((s) => s.selectedModifiedFile);
  const [pendingTab, setPendingTab] = useState<WorkspaceSurface | null>(null);
  const workbenchRunningRef = useRef(false);

  const handleTabChange = useCallback((value: string) => {
    const nextTab = value as WorkspaceSurface;
    if (activeTab === "evals" && nextTab !== "evals" && workbenchRunningRef.current) {
      setPendingTab(nextTab);
      return;
    }
    setActiveTab(nextTab);
  }, [activeTab, setActiveTab]);

  const skillName = "name" in skill ? skill.name : skill.skill_name;
  const skillId = "id" in skill ? skill.id : skill.skill_id;
  const isLocked = useIsSkillLocked(skillId);

  useEffect(() => {
    resetFileViewer();
  }, [resetFileViewer, skillName]);

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
  }, [pendingTab, activeTab, setActiveTab]);
  const isBuilderSkill = "name" in skill;
  const workspacePath = useSettingsStore((s) => s.workspacePath);
  const { isFetching: isSkillListFetching } = useBuilderSkillsQuery();

  const toggleFileViewer = useCallback(async () => {
    const store = useWorkspaceStore.getState();
    if (store.selectedModifiedFile) {
      store.setSelectedModifiedFile(null);
      return;
    }

    if (store.skillFiles.length === 0) {
      let files: Awaited<ReturnType<typeof loadSkillFiles>>;
      if (isBuilderSkill && workspacePath) {
        files = await loadSkillFiles({
          type: "builder",
          skillName: (skill as SkillSummary).name,
          workspacePath,
          pluginSlug: (skill as SkillSummary).plugin_slug,
        });
      } else if (!isBuilderSkill && "disk_path" in skill && (skill as ImportedSkill).disk_path) {
        files = await loadSkillFiles({
          type: "imported",
          diskPath: (skill as ImportedSkill).disk_path,
        });
      } else {
        return;
      }
      if (!files) return;
      store.setSkillFiles(files);
      if (files.length > 0) store.setActiveFileTab(files[0].filename);
    }

    const tab = store.activeFileTab || "SKILL.md";
    store.setActiveFileTab(tab);
    store.setDiffMode(false);
    store.setSelectedModifiedFile(tab);
  }, [isBuilderSkill, workspacePath, skill]);

  return (
    <div className={`relative flex h-full flex-col ${className ?? ""}`}>
      {isLocked && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-[1px]">
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <Lock className="size-8 opacity-50" />
            <p className="text-sm font-medium">Skill is locked by another instance</p>
          </div>
        </div>
      )}
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

      <div className="relative min-h-0 flex-1">
        <Tabs
          value={activeTab}
          onValueChange={handleTabChange}
          className="flex h-full flex-col"
        >
          <TabsList variant="line" className="shrink-0 border-b px-4">
            <TabsTrigger value="conversation">Conversation</TabsTrigger>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="evals">Eval Workbench</TabsTrigger>
          </TabsList>

          <TabsContent value="conversation" className="min-h-0 flex-1 overflow-hidden p-6">
            <WorkspaceConversation skillName={skillName} />
          </TabsContent>

          <TabsContent value="overview" className="flex-1 overflow-y-auto p-6">
            <WorkspaceOverview
              skill={skill}
              skillType={skillType}
              isLoading={isSkillListFetching}
            />
          </TabsContent>

          <TabsContent value="evals" className="min-h-0 flex-1 overflow-hidden">
            <WorkspaceEvalWorkbench
              key={"name" in skill ? skill.name : skill.skill_name}
              skill={skill}
              workspacePath={workspacePath}
              onRunningChange={(running) => {
                workbenchRunningRef.current = running;
              }}
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
