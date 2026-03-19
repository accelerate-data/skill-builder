import { useCallback, useEffect, useState } from "react";
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
import { useRefineStore } from "@/stores/refine-store";
import { WorkspaceOverview } from "./workspace-overview";
import { WorkspaceRefine } from "./workspace-refine";
import type { SkillSummary, ImportedSkill } from "@/lib/types";

interface WorkspaceShellProps {
  skill: SkillSummary | ImportedSkill;
  skillType: "builder" | "imported" | "marketplace";
  initialTab?: string;
}

export function WorkspaceShell({ skill, skillType, initialTab }: WorkspaceShellProps) {
  const [activeTab, setActiveTab] = useState(initialTab ?? "overview");
  const [pendingTab, setPendingTab] = useState<string | null>(null);
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
    setActiveTab(value);
  }, [activeTab]);

  const handleTabStay = useCallback(() => {
    setPendingTab(null);
  }, []);

  const handleTabLeave = useCallback(() => {
    if (pendingTab) {
      setActiveTab(pendingTab);
      setPendingTab(null);
    }
  }, [pendingTab]);

  const skillName = "name" in skill ? skill.name : skill.skill_name;

  return (
    <div className="flex h-full flex-col">
      {/* 48px header */}
      <div className="flex h-12 shrink-0 items-center gap-2.5 border-b px-4">
        <span className="truncate text-sm font-semibold">{skillName}</span>
      </div>

      {/* Tabs */}
      <Tabs
        value={activeTab}
        onValueChange={handleTabChange}
        className="flex min-h-0 flex-1 flex-col"
      >
        <TabsList variant="line" className="shrink-0 border-b px-4">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="refine">Refine</TabsTrigger>
          <TabsTrigger value="evals" disabled>
            Evals
          </TabsTrigger>
          <TabsTrigger value="description" disabled>
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
          {"name" in skill ? (
            <WorkspaceRefine skill={skill as SkillSummary} />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Refine is not available for imported skills.
            </div>
          )}
        </TabsContent>
      </Tabs>

      {pendingTab !== null && (
        <Dialog open onOpenChange={(open) => { if (!open) handleTabStay(); }}>
          <DialogContent showCloseButton={false}>
            <DialogHeader>
              <DialogTitle>Agent Running</DialogTitle>
              <DialogDescription>
                A refine agent is still running. Switching tabs will abandon it.
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
