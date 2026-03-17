import { useState, useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Lock, MoreHorizontal, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import SkillDialog from "@/components/skill-dialog";
import { useSettingsStore } from "@/stores/settings-store";
import { useSkillStore } from "@/stores/skill-store";
import { useImportedSkillsStore } from "@/stores/imported-skills-store";
import { useAgentStore } from "@/stores/agent-store";
import type { SkillSummary, ImportedSkill, Purpose } from "@/lib/types";
import { PURPOSE_SHORT_LABELS } from "@/lib/types";
import { listSkills } from "@/lib/tauri";
import { cn } from "@/lib/utils";

interface UnifiedSkill {
  name: string;
  description: string | null;
  purpose: string | null;
  lastModified: Date | null;
  source: "builder" | "imported" | "marketplace";
  status: string | null;
  currentStep: string | null;
}

export interface SkillListPanelProps {
  onSelectSkill?: (name: string) => void;
  onCreateSkill?: () => void;
  className?: string;
}

function formatRelativeDate(date: Date): string {
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

function isSkillComplete(skill: UnifiedSkill): boolean {
  if (skill.status === "completed") return true;
  if (skill.source === "imported" || skill.source === "marketplace") return true;
  return false;
}

interface DotStyle {
  className: string;
  style?: React.CSSProperties;
}

function getStatusDot(skill: UnifiedSkill, isRunning: boolean): DotStyle {
  const pulse = isRunning ? " animate-dot-pulse" : "";

  // Complete / imported → green (status="completed" always wins over current_step)
  if (isSkillComplete(skill)) {
    return { className: pulse.trim(), style: { backgroundColor: "var(--color-seafoam)" } };
  }

  const stepMatch = skill.currentStep?.match(/step\s*(\d+)/i);
  const step = stepMatch ? Number(stepMatch[1]) : null;

  // Mid-progress (Step 2: Confirm Decisions, Step 3: Generate Skill) → amber
  if (step !== null && step >= 2) {
    return { className: `bg-amber-500 dark:bg-amber-400${pulse}` };
  }

  // Not started / Step 0 / Step 1 → red
  return { className: `bg-destructive${pulse}` };
}

function mergeSkills(
  builderSkills: SkillSummary[],
  importedSkills: ImportedSkill[],
): UnifiedSkill[] {
  const fromBuilder: UnifiedSkill[] = builderSkills.map((s) => ({
    name: s.name,
    description: s.description ?? null,
    purpose: s.purpose,
    lastModified: s.last_modified ? new Date(s.last_modified) : null,
    source: s.skill_source === "marketplace" ? "marketplace" : ("builder" as const),
    status: s.status,
    currentStep: s.current_step,
  }));

  const fromImported: UnifiedSkill[] = importedSkills.map((s) => ({
    name: s.skill_name,
    description: s.description,
    purpose: s.purpose,
    lastModified: new Date(s.imported_at),
    source: s.marketplace_source_url ? ("marketplace" as const) : ("imported" as const),
    status: null,
    currentStep: null,
  }));

  // Deduplicate by name — builder entry wins over imported (has richer status info)
  const byName = new Map<string, UnifiedSkill>();
  for (const s of fromBuilder) byName.set(s.name, s);
  for (const s of fromImported) {
    if (!byName.has(s.name)) byName.set(s.name, s);
  }

  return Array.from(byName.values()).sort((a, b) => {
    if (!a.lastModified && !b.lastModified) return 0;
    if (!a.lastModified) return 1;
    if (!b.lastModified) return -1;
    return b.lastModified.getTime() - a.lastModified.getTime();
  });
}

export function SkillListPanel({
  onSelectSkill,
  onCreateSkill,
  className,
}: SkillListPanelProps) {
  const [createOpen, setCreateOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedSkill, setSelectedSkill] = useState<string | null>(null);

  const workspacePath = useSettingsStore((s) => s.workspacePath);
  const builderSkills = useSkillStore((s) => s.skills);
  const setSkills = useSkillStore((s) => s.setSkills);
  const importedSkills = useImportedSkillsStore((s) => s.skills);
  const fetchImportedSkills = useImportedSkillsStore((s) => s.fetchSkills);
  const runs = useAgentStore((s) => s.runs);
  const navigate = useNavigate();

  // Fetch both skill lists whenever workspacePath becomes available
  useEffect(() => {
    if (!workspacePath) return;
    listSkills(workspacePath)
      .then(setSkills)
      .catch((err) => console.error("event=fetch_skills_failed error=%s", err));
    fetchImportedSkills().catch((err) =>
      console.error("event=fetch_imported_skills_failed error=%s", err),
    );
  }, [workspacePath, setSkills, fetchImportedSkills]);

  const unifiedSkills = mergeSkills(builderSkills, importedSkills);

  // Default selection — run once on mount after stores are populated
  useEffect(() => {
    const stored = localStorage.getItem("last-selected-skill");
    if (stored && unifiedSkills.some((s) => s.name === stored)) {
      setSelectedSkill(stored);
    } else if (unifiedSkills.length > 0) {
      setSelectedSkill(unifiedSkills[0].name);
    }
    // Intentionally mount-only: we only restore the saved selection once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runningWorkflow = Object.values(runs).find(
    (r) => r.status === "running" && r.runSource === "workflow",
  );
  const runningSkillName = runningWorkflow?.skillName ?? null;

  const filteredSkills = unifiedSkills.filter((s) =>
    s.name.toLowerCase().includes(search.toLowerCase()),
  );

  function handleRowClick(skill: UnifiedSkill) {
    // All other rows are locked while a workflow runs
    if (runningSkillName && skill.name !== runningSkillName) return;
    // Running skill is also a no-op
    if (skill.name === runningSkillName) return;

    console.log("event=skill_selected skill=%s", skill.name);
    localStorage.setItem("last-selected-skill", skill.name);
    setSelectedSkill(skill.name);

    if (isSkillComplete(skill)) {
      onSelectSkill?.(skill.name);
    } else {
      navigate({ to: "/skill/$skillName", params: { skillName: skill.name } });
    }
  }

  return (
    <div
      className={cn(
        "flex h-full w-full flex-col border-r bg-background",
        className,
      )}
    >
      {/* Topbar */}
      <div className="flex h-11 items-center gap-2 border-b px-3">
        <span className="flex-1 text-[13px] font-semibold">Skills</span>
        <Badge variant="secondary" className="rounded-full px-1.5 py-px text-[11px]">
          {filteredSkills.length}
        </Badge>
        <Button
          variant="ghost"
          size="icon-sm"
          className="size-7"
          onClick={() => {
            setCreateOpen(true);
            onCreateSkill?.();
          }}
          title="New skill"
        >
          <Plus className="size-4" />
        </Button>
      </div>

      {/* Search */}
      <div className="px-2.5 py-1.5">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search skills…"
            className="h-7 pl-6 text-xs"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Skill rows */}
      <ScrollArea className="flex-1">
        {filteredSkills.map((skill) => {
          const isLocked = !!runningSkillName && skill.name !== runningSkillName;
          const isRunning = skill.name === runningSkillName;
          const isSelected = skill.name === selectedSkill;
          const dot = getStatusDot(skill, isRunning);
          const purposeLabel = skill.purpose
            ? (PURPOSE_SHORT_LABELS[skill.purpose as Purpose] ?? skill.purpose)
            : null;

          return (
            <div
              key={skill.name}
              role="button"
              tabIndex={isLocked ? -1 : 0}
              aria-selected={isSelected}
              className={cn(
                "group flex h-[46px] cursor-pointer items-center gap-2 px-3 transition-colors",
                isSelected && "bg-accent",
                !isSelected && !isLocked && "hover:bg-accent/50",
                isLocked && "cursor-not-allowed opacity-[0.45]",
              )}
              onClick={() => handleRowClick(skill)}
              onKeyDown={(e) => {
                if (!isLocked && (e.key === "Enter" || e.key === " ")) {
                  e.preventDefault();
                  handleRowClick(skill);
                }
              }}
            >
              {/* Status dot */}
              <div
                className={cn("size-2 shrink-0 rounded-full", dot.className)}
                style={dot.style}
                aria-label={`status-dot-${skill.name}`}
              />

              {/* Name + purpose */}
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium">{skill.name}</span>
                {purposeLabel && (
                  <span className="truncate text-[11px] text-muted-foreground">
                    {purposeLabel}
                  </span>
                )}
              </div>

              {/* Timestamp */}
              {skill.lastModified && (
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                  {formatRelativeDate(skill.lastModified)}
                </span>
              )}

              {/* More button / Lock icon */}
              {isLocked ? (
                <Lock className="size-[10px] shrink-0 text-muted-foreground" />
              ) : (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="size-5 shrink-0 opacity-0 group-hover:opacity-100"
                  aria-label="More actions"
                  onClick={(e) => e.stopPropagation()}
                >
                  <MoreHorizontal className="size-3" />
                </Button>
              )}
            </div>
          );
        })}
      </ScrollArea>

      {workspacePath && (
        <SkillDialog
          mode="create"
          workspacePath={workspacePath}
          open={createOpen}
          onOpenChange={setCreateOpen}
          onCreated={async () => {
            if (workspacePath) {
              listSkills(workspacePath).then(setSkills).catch(() => {});
            }
          }}
        />
      )}
    </div>
  );
}
