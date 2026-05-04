import { useEffect, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ImportedSkill, SkillSummary } from "@/lib/types";
import { WorkspaceDescription } from "./workspace-description";
import { WorkspaceEvals } from "./workspace-evals";

interface WorkspaceEvalWorkbenchProps {
  skill: SkillSummary | ImportedSkill;
  workspacePath: string | null;
  initialMode?: "performance" | "trigger";
  onRunningChange?: (running: boolean) => void;
  onNavigateToRefine?: () => void;
  onApplyDescription?: (newDescription: string, newVersion: string) => void;
}

export function WorkspaceEvalWorkbench({
  skill,
  workspacePath,
  initialMode = "performance",
  onRunningChange,
  onNavigateToRefine,
  onApplyDescription,
}: WorkspaceEvalWorkbenchProps) {
  const [activeMode, setActiveMode] = useState<"performance" | "trigger">(
    initialMode,
  );
  const [performanceRunning, setPerformanceRunning] = useState(false);
  const [triggerRunning, setTriggerRunning] = useState(false);
  const isRunning = performanceRunning || triggerRunning;

  useEffect(() => {
    setActiveMode(initialMode);
  }, [initialMode]);

  useEffect(() => {
    onRunningChange?.(isRunning);
  }, [isRunning, onRunningChange]);

  const triggerSkill =
    "name" in skill
      ? (skill as SkillSummary)
      : ({
          ...(skill as ImportedSkill),
          name: (skill as ImportedSkill).skill_name,
        } as unknown as SkillSummary);

  return (
    <Tabs
      value={activeMode}
      onValueChange={(value) => {
        if (isRunning) {
          return;
        }
        setActiveMode(value === "trigger" ? "trigger" : "performance");
      }}
      className="flex h-full flex-col gap-4"
    >
      <div className="px-6 pt-6">
        <TabsList variant="line" className="w-full justify-start border-b px-0">
          <TabsTrigger value="performance">Performance</TabsTrigger>
          <TabsTrigger value="trigger">Trigger</TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="performance" className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
        <WorkspaceEvals
          key={`performance-${"name" in skill ? skill.name : skill.skill_name}`}
          skill={skill}
          workspacePath={workspacePath}
          onNavigateToRefine={onNavigateToRefine}
          onRunningChange={setPerformanceRunning}
        />
      </TabsContent>

      <TabsContent value="trigger" className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
        <WorkspaceDescription
          key={`trigger-${triggerSkill.name}`}
          skill={triggerSkill}
          workspacePath={workspacePath ?? ""}
          onNavigateToRefine={onNavigateToRefine}
          onRunningChange={setTriggerRunning}
          onApply={(description, version) =>
            onApplyDescription?.(description, version)
          }
        />
      </TabsContent>
    </Tabs>
  );
}
