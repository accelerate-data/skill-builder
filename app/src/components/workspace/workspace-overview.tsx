import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import SkillDialog from "@/components/skill-dialog";
import { BenchmarkOverviewCard } from "@/components/workspace/benchmark-overview-card";
import { VersionDiffDialog } from "@/components/workspace/version-diff-dialog";
import { useSettingsStore } from "@/stores/settings-store";
import { getSkillHistory, listSkills, readLatestBenchmark } from "@/lib/tauri";
import { useSkillStore } from "@/stores/skill-store";
import type { BenchmarkData, SkillSummary, ImportedSkill, Purpose, SkillCommit, EditableSkill } from "@/lib/types";
import { PURPOSE_LABELS, toEditableSkill } from "@/lib/types";

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
  const [selectedShas, setSelectedShas] = useState<string[]>([]);
  const [diffDialogOpen, setDiffDialogOpen] = useState(false);
  const workspacePath = useSettingsStore((s) => s.workspacePath);
  const latestVersion = useSkillStore((s) => s.latestVersion);

  const isBuilderSkill = "name" in skill;
  const skillName = isBuilderSkill ? skill.name : skill.skill_name;

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

  const { created, modified } = getSkillDates(skill);

  useEffect(() => {
    if (!workspacePath || !skillName) return;
    getSkillHistory(workspacePath, skillName, 50)
      .then((result) => setCommits(result ?? []))
      .catch((err) => {
        console.warn("event=skill_history_fetch_failed skill=%s error=%s", skillName, err);
      });
  }, [workspacePath, skillName, latestVersion]);

  const purpose = skill.purpose;
  const description = isBuilderSkill ? skill.description : skill.description;
  const tags = isBuilderSkill ? skill.tags : [];

  const canEdit = !!workspacePath && !!skillName;
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
              <p className="text-xs text-muted-foreground">What the skill does</p>
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
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold">Version History</h3>
          {selectedShas.length === 2 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDiffDialogOpen(true)}
            >
              Compare
            </Button>
          )}
        </div>
        {commits.length === 0 ? (
          <p className="text-sm text-muted-foreground">No version history yet</p>
        ) : (
          <div className="space-y-2">
            {visibleCommits.map((commit) => {
              const isSelected = selectedShas.includes(commit.sha);
              return (
                <div key={commit.sha} className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5 shrink-0 cursor-pointer accent-foreground"
                    checked={isSelected}
                    onChange={() => {
                      setSelectedShas((prev) => {
                        if (prev.includes(commit.sha)) {
                          return prev.filter((s) => s !== commit.sha);
                        }
                        if (prev.length >= 2) {
                          return [prev[1], commit.sha];
                        }
                        return [...prev, commit.sha];
                      });
                    }}
                    aria-label={`Select commit ${commit.sha.slice(0, 7)} for comparison`}
                  />
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
              );
            })}
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
          skill={isBuilderSkill ? (skill as EditableSkill) : toEditableSkill(skill as ImportedSkill)}
          open={editDialogOpen}
          onOpenChange={setEditDialogOpen}
          onSaved={() => {
            setEditDialogOpen(false);
            if (workspacePath) {
              listSkills(workspacePath).then(useSkillStore.getState().setSkills).catch(() => {});
            }
          }}
        />
      )}

      {diffDialogOpen && selectedShas.length === 2 && workspacePath && (() => {
        // Always show older → newer regardless of selection order
        const commitA = commits.find((c) => c.sha === selectedShas[0]);
        const commitB = commits.find((c) => c.sha === selectedShas[1]);
        const [olderSha, newerSha, olderCommit, newerCommit] =
          commitA && commitB && new Date(commitA.timestamp) > new Date(commitB.timestamp)
            ? [selectedShas[1], selectedShas[0], commitB, commitA]
            : [selectedShas[0], selectedShas[1], commitA, commitB];
        const makeLabel = (sha: string, commit: typeof commitA) =>
          commit?.version ? `v${commit.version}` : sha.slice(0, 7);
        return (
          <VersionDiffDialog
            open={diffDialogOpen}
            onOpenChange={(open) => {
              setDiffDialogOpen(open);
              if (!open) setSelectedShas([]);
            }}
            skillName={skillName}
            workspacePath={workspacePath}
            shaA={olderSha}
            shaB={newerSha}
            labelA={makeLabel(olderSha, olderCommit)}
            labelB={makeLabel(newerSha, newerCommit)}
          />
        );
      })()}
    </div>
  );
}
