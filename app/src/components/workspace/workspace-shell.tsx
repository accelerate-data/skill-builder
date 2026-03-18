import React, { useEffect, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { WorkspaceOverview } from "./workspace-overview";
import { WorkspaceRefine } from "./workspace-refine";
import type { SkillSummary, ImportedSkill } from "@/lib/types";

interface WorkspaceShellProps {
  skill: SkillSummary | ImportedSkill;
  skillType: "builder" | "imported" | "marketplace";
  initialTab?: string;
}

function getHeaderDot(
  skill: SkillSummary | ImportedSkill,
  skillType: string,
): { className: string; style?: React.CSSProperties } {
  if (skillType === "marketplace") {
    return { className: "size-2 shrink-0 rounded-full", style: { background: "var(--color-pacific)" } };
  }

  if (skillType === "imported") {
    return { className: "size-2 shrink-0 rounded-full", style: { background: "var(--color-violet)" } };
  }

  const s = skill as SkillSummary;
  // Completed → green (status="completed" wins over current_step)
  if (s.status === "completed") {
    return { className: "size-2 shrink-0 rounded-full", style: { background: "var(--color-seafoam)" } };
  }
  const stepMatch = s.current_step?.match(/step\s*(\d+)/i);
  const step = stepMatch ? Number(stepMatch[1]) : null;
  // Mid-progress (any step past the first) → amber
  if (step !== null && step >= 1) {
    return { className: "size-2 shrink-0 rounded-full bg-amber-500 dark:bg-amber-400" };
  }
  // Not started / Step 0 / Step 1 → red
  return { className: "size-2 shrink-0 rounded-full bg-destructive" };
}

export function WorkspaceShell({ skill, skillType, initialTab }: WorkspaceShellProps) {
  const [activeTab, setActiveTab] = useState(initialTab ?? "overview");

  // Sync tab when a navigation sets initialTab (e.g. "Refine" from the More menu)
  useEffect(() => {
    if (initialTab) setActiveTab(initialTab);
  }, [initialTab]);

  const skillName = "name" in skill ? skill.name : skill.skill_name;
  const version = ("name" in skill ? skill.version : skill.version) ?? "1";
  const versionLabel = version.startsWith("v") ? version : `v${version.split(".")[0]}`;

  const sourceLabel =
    skillType === "builder"
      ? "Builder"
      : skillType === "marketplace"
        ? "Marketplace"
        : "Imported";

  const headerDot = getHeaderDot(skill, skillType);

  return (
    <div className="flex h-full flex-col">
      {/* 48px header */}
      <div className="flex h-12 shrink-0 items-center gap-2.5 border-b px-4">
        <div className={headerDot.className} style={headerDot.style} />
        <span className="truncate text-sm font-semibold">{skillName}</span>
        <Badge variant="outline" className="shrink-0 font-mono text-xs">
          {versionLabel}
        </Badge>
        <Badge variant="outline" className="shrink-0 capitalize">
          {sourceLabel}
        </Badge>
        <Button variant="outline" size="icon" className="ml-auto size-7 shrink-0">
          <MoreHorizontal className="size-4" />
        </Button>
      </div>

      {/* Tabs */}
      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
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
            onOpenRefine={() => setActiveTab("refine")}
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
    </div>
  );
}
