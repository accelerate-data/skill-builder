import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import SkillDialog from "@/components/skill-dialog";
import { useSettingsStore } from "@/stores/settings-store";
import { useWorkflowStore } from "@/stores/workflow-store";
import { resetWorkflowStep } from "@/lib/tauri";
import { toast } from "@/lib/toast";
import type { SkillSummary, ImportedSkill, Purpose } from "@/lib/types";
import { PURPOSE_LABELS } from "@/lib/types";

interface WorkspaceOverviewProps {
  skill: SkillSummary | ImportedSkill;
  skillType: "builder" | "imported" | "marketplace";
  onOpenRefine: () => void;
  isLoading?: boolean;
}

function getSkillDates(
  skill: SkillSummary | ImportedSkill,
): { created: string | null; modified: string | null } {
  if ("name" in skill) {
    return { created: skill.last_modified, modified: skill.last_modified };
  }
  return { created: skill.imported_at, modified: skill.imported_at };
}

function formatRelativeDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  const date = new Date(dateStr);
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

export function WorkspaceOverview({ skill, skillType, onOpenRefine, isLoading }: WorkspaceOverviewProps) {
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [redoDialogOpen, setRedoDialogOpen] = useState(false);
  const workspacePath = useSettingsStore((s) => s.workspacePath);
  const navigate = useNavigate();

  async function handleConfirmRedo() {
    if (!workspacePath) return;
    const skillName = (skill as SkillSummary).name;
    try {
      await resetWorkflowStep(workspacePath, skillName, 0);
      console.log("event=skill_redo skill=%s", skillName);
      useWorkflowStore.getState().reset();
      setRedoDialogOpen(false);
      navigate({ to: "/skill/$skillName", params: { skillName }, state: { autoStart: true } });
    } catch (err) {
      toast.error(`Failed to reset workflow: ${err instanceof Error ? err.message : String(err)}`);
      console.error("event=skill_redo_failed skill=%s error=%s", skillName, err);
    }
  }

  const isBuilderSkill = "name" in skill;
  const purpose = skill.purpose;
  const description = isBuilderSkill ? skill.description : skill.description;
  const tags = isBuilderSkill ? skill.tags : [];
  const { created, modified } = getSkillDates(skill);

  const canEdit = isBuilderSkill && !!workspacePath;

  if (isLoading) {
    return (
      <div className="grid grid-cols-[3fr_2fr] gap-4">
        <div className="flex flex-col gap-4">
          <div className="rounded-lg border bg-card p-4 space-y-3">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
          <div className="rounded-lg border bg-card p-4 space-y-3">
            <Skeleton className="h-5 w-36" />
            <Skeleton className="h-4 w-48" />
          </div>
        </div>
        <div className="flex flex-col gap-4">
          <div className="rounded-lg border bg-card p-4 space-y-3">
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
          </div>
          <div className="rounded-lg border bg-card p-4 space-y-3">
            <Skeleton className="h-5 w-20" />
            <Skeleton className="h-9 w-full" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[3fr_2fr] gap-4">
      {/* Left column */}
      <div className="flex flex-col gap-4">
        {/* Skill Details card */}
        <div className="rounded-lg border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Skill Details</h3>
            {canEdit && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEditDialogOpen(true)}
              >
                Edit
              </Button>
            )}
          </div>

          {purpose && (
            <div className="space-y-0.5">
              <p className="text-xs text-muted-foreground">Purpose</p>
              <p className="text-sm">
                {PURPOSE_LABELS[purpose as Purpose] ?? purpose}
              </p>
            </div>
          )}

          {description && (
            <div className="space-y-0.5">
              <p className="text-xs text-muted-foreground">Description</p>
              <p className="text-sm">{description}</p>
            </div>
          )}

          {tags.length > 0 && (
            <div className="space-y-0.5">
              <p className="text-xs text-muted-foreground">Tags</p>
              <div className="flex flex-wrap gap-1">
                {tags.map((tag) => (
                  <Badge key={tag} variant="secondary" className="rounded-full">
                    {tag}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-0.5">
              <p className="text-xs text-muted-foreground">
                {skillType === "imported" || skillType === "marketplace" ? "Imported" : "Created"}
              </p>
              <p className="text-sm">{formatRelativeDate(created)}</p>
            </div>
            <div className="space-y-0.5">
              <p className="text-xs text-muted-foreground">Modified</p>
              <p className="text-sm">{formatRelativeDate(modified)}</p>
            </div>
          </div>
        </div>

        {/* Version History card */}
        <div className="rounded-lg border bg-card p-4 space-y-3">
          <h3 className="text-sm font-semibold">Version History</h3>
          <div className="flex items-center gap-2 text-sm">
            <span className="font-mono rounded-full bg-muted px-2 py-0.5 text-xs">v1</span>
            <span className="text-muted-foreground">·</span>
            <span>Initial</span>
            <span className="text-muted-foreground">·</span>
            <span className="text-muted-foreground">{formatRelativeDate(created)}</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Full history available in a future update
          </p>
        </div>
      </div>

      {/* Right column */}
      <div className="flex flex-col gap-4">
        {/* Stats card */}
        <div className="rounded-lg border bg-card p-4 space-y-3">
          <h3 className="text-sm font-semibold">Stats</h3>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Pass Rate</span>
              <span>—</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Iterations</span>
              <span>—</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Tests</span>
              <span>—</span>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Stats available after running Evals
          </p>
        </div>

        {/* Actions card */}
        <div className="rounded-lg border bg-card p-4 space-y-3">
          <h3 className="text-sm font-semibold">Actions</h3>
          <Button onClick={onOpenRefine} className="w-full">
            Open Refine
          </Button>
          {skillType === "builder" && (
            <Button
              variant="outline"
              className="w-full"
              onClick={() => setRedoDialogOpen(true)}
            >
              Redo Workflow
            </Button>
          )}
        </div>
      </div>

      {canEdit && editDialogOpen && (
        <SkillDialog
          mode="edit"
          skill={skill as SkillSummary}
          open={editDialogOpen}
          onOpenChange={setEditDialogOpen}
          onSaved={() => setEditDialogOpen(false)}
        />
      )}

      <Dialog open={redoDialogOpen} onOpenChange={(open) => { if (!open) setRedoDialogOpen(false); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Redo Workflow?</DialogTitle>
            <DialogDescription>
              This will reset the workflow to Step 1 and overwrite all generated artifacts and files for &ldquo;{(skill as SkillSummary).name}&rdquo;. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRedoDialogOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleConfirmRedo}>Redo</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
