import { useState } from "react";
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
}

export function WorkspaceShell({ skill, skillType }: WorkspaceShellProps) {
  const [activeTab, setActiveTab] = useState("overview");

  const skillName = "name" in skill ? skill.name : skill.skill_name;
  const version = ("name" in skill ? skill.version : skill.version) ?? "1";
  const versionLabel = version.startsWith("v") ? version : `v${version.split(".")[0]}`;

  const sourceLabel =
    skillType === "builder"
      ? "Builder"
      : skillType === "marketplace"
        ? "Marketplace"
        : "Imported";

  return (
    <div className="flex h-full flex-col">
      {/* 48px header */}
      <div className="flex h-12 shrink-0 items-center gap-2.5 border-b px-4">
        <div
          className="size-2 shrink-0 rounded-full"
          style={{ background: "var(--color-seafoam)" }}
        />
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
