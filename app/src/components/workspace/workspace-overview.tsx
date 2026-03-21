import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import SkillDialog from "@/components/skill-dialog";
import { BenchmarkOverviewCard } from "@/components/workspace/benchmark-overview-card";
import { useSettingsStore } from "@/stores/settings-store";
import { getSkillHistory, readLatestBenchmark } from "@/lib/tauri";
import type { BenchmarkData, SkillSummary, ImportedSkill, Purpose, SkillCommit } from "@/lib/types";
import { PURPOSE_LABELS } from "@/lib/types";

interface WorkspaceOverviewProps {
  skill: SkillSummary | ImportedSkill;
  skillType: "builder" | "imported" | "marketplace";
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

function formatCommitMessage(message: string): string {
  // Strip the "skill-name: " prefix if present for cleaner display
  const colonIdx = message.indexOf(": ");
  return colonIdx > 0 ? message.slice(colonIdx + 2) : message;
}

export function WorkspaceOverview({ skill, skillType, isLoading }: WorkspaceOverviewProps) {
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [commits, setCommits] = useState<SkillCommit[]>([]);
  const [showAllCommits, setShowAllCommits] = useState(false);
  const [benchmarkData, setBenchmarkData] = useState<BenchmarkData | null>(null);
  const [benchmarkIteration, setBenchmarkIteration] = useState<number | null>(null);
  const workspacePath = useSettingsStore((s) => s.workspacePath);

  const isBuilderSkill = "name" in skill;
  const skillName = isBuilderSkill ? skill.name : null;

  useEffect(() => {
    if (!workspacePath || !skillName) return;
    getSkillHistory(workspacePath, skillName, 50)
      .then((result) => setCommits(result ?? []))
      .catch((err) => {
        console.warn("event=skill_history_fetch_failed skill=%s error=%s", skillName, err);
      });
  }, [workspacePath, skillName]);

  useEffect(() => {
    if (!isBuilderSkill || !workspacePath || !skillName) {
      setBenchmarkData(null);
      return;
    }
    let cancelled = false;
    readLatestBenchmark(skillName, workspacePath)
      .then((result) => {
        if (cancelled) return;
        if (result) {
          setBenchmarkData(result.data);
          setBenchmarkIteration(result.iteration);
        } else {
          setBenchmarkData(null);
          setBenchmarkIteration(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.warn("event=benchmark_fetch_failed operation=readLatestBenchmark skill=%s error=%s", skillName, err);
          setBenchmarkData(null);
        }
      });
    return () => { cancelled = true; };
  }, [isBuilderSkill, workspacePath, skillName]);

  const purpose = skill.purpose;
  const description = isBuilderSkill ? skill.description : skill.description;
  const tags = isBuilderSkill ? skill.tags : [];
  const { created, modified } = getSkillDates(skill);

  const canEdit = isBuilderSkill && !!workspacePath;
  const visibleCommits = showAllCommits ? commits : commits.slice(0, 5);

  // Source display: Skill Builder for builder skills, marketplace URL, or "Uploaded"
  const marketplaceUrl = !isBuilderSkill ? (skill as ImportedSkill).marketplace_source_url : null;
  const sourceValue =
    skillType === "builder"
      ? "Skill Builder"
      : skillType === "marketplace" && marketplaceUrl
        ? marketplaceUrl
        : "Uploaded";

  if (isLoading) {
    return (
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
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Skill Details card */}
      <div className="rounded-lg border bg-card p-4">
        <div className="flex items-center justify-between mb-3">
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

        <div className="space-y-3">
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

          <div className="space-y-0.5">
            <p className="text-xs text-muted-foreground">Source</p>
            {skillType === "marketplace" && marketplaceUrl ? (
              <a
                href={marketplaceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm break-all"
                style={{ color: "var(--color-pacific)" }}
              >
                {marketplaceUrl}
              </a>
            ) : (
              <p className="text-sm">{sourceValue}</p>
            )}
          </div>

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
      </div>

      {/* Benchmark Results card — full width */}
      {benchmarkData && (
        <BenchmarkOverviewCard benchmarkData={benchmarkData} iteration={benchmarkIteration} />
      )}

      {/* Version History card */}
      <div className="rounded-lg border bg-card p-4">
        <h3 className="text-sm font-semibold mb-3">Version History</h3>
        {commits.length === 0 ? (
          <p className="text-sm text-muted-foreground">No version history yet</p>
        ) : (
          <div className="space-y-2">
            {visibleCommits.map((commit) => (
              <div key={commit.sha} className="flex items-start gap-2 text-sm">
                <span className="font-mono shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs">
                  {commit.sha.slice(0, 7)}
                </span>
                {commit.version && (
                  <span
                    className="shrink-0 rounded-full text-xs font-medium px-2 py-0.5"
                    style={{
                      color: "var(--color-seafoam)",
                      background: "color-mix(in oklch, var(--color-seafoam), transparent 85%)",
                    }}
                  >
                    v{commit.version}
                  </span>
                )}
                <span className="min-w-0 truncate">{formatCommitMessage(commit.message)}</span>
                <span className="shrink-0 text-muted-foreground">{formatRelativeDate(commit.timestamp)}</span>
              </div>
            ))}
            {commits.length > 5 && !showAllCommits && (
              <button
                type="button"
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => setShowAllCommits(true)}
              >
                Show {commits.length - 5} more
              </button>
            )}
          </div>
        )}
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
    </div>
  );
}
