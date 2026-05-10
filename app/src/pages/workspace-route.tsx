import { useParams, useSearch, useRouterState } from "@tanstack/react-router";
import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import { useBuilderSkillsQuery, useImportedSkillsQuery } from "@/lib/queries/skills";
import { useSettingsStore } from "@/stores/settings-store";

type WorkspaceSurface = "overview" | "refine" | "evals";

export function surfaceFromRoute(pathname: string, tab?: string): WorkspaceSurface {
  if (pathname.endsWith("/refine")) return "refine";
  if (pathname.endsWith("/evals")) return "evals";
  if (tab === "refine") return "refine";
  if (tab === "evals" || tab === "description") return "evals";
  return "overview";
}

export default function WorkspaceRoutePage() {
  const { skillId } = useParams({ strict: false });
  const search = useSearch({ strict: false }) as Record<string, string> | undefined;
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const workspacePath = useSettingsStore((s) => s.workspacePath);
  const { data: builderSkills = [], isPending: builderPending } = useBuilderSkillsQuery(workspacePath);
  const { data: importedSkills = [], isPending: importedPending } = useImportedSkillsQuery();

  const selectedBuilderSkill = builderSkills.find(
    (s) => s.skill_source === "skill-builder" && String(s.id) === skillId,
  );
  const selectedImportedSkill = importedSkills.find(
    (s) => String(s.skill_id) === skillId,
  );
  const skill = selectedBuilderSkill ?? selectedImportedSkill ?? null;
  const skillType = selectedBuilderSkill
    ? "builder"
    : selectedImportedSkill?.marketplace_source_url
      ? "marketplace"
      : "imported";

  if (builderPending || importedPending) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">Loading…</p>
      </div>
    );
  }

  const handleNavigateSurface = useCallback(
    (surface: WorkspaceSurface) => {
      if (!skillId) return;
      if (surface === "overview") {
        navigate({ to: "/workspace/$skillId", params: { skillId }, search: { tab: undefined }, replace: true });
      } else if (surface === "refine") {
        navigate({ to: "/workspace/$skillId/refine", params: { skillId }, search: { tab: "refine" }, replace: true });
      } else {
        navigate({ to: "/workspace/$skillId/evals", params: { skillId }, search: { tab: "evals" }, replace: true });
      }
    },
    [skillId, navigate],
  );

  if (!skill) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">Skill not found</p>
      </div>
    );
  }

  const initialSurface = surfaceFromRoute(pathname, search?.tab);

  return (
    <WorkspaceShell
      key={skillId}
      skill={skill}
      skillType={skillType}
      initialSurface={initialSurface}
      onNavigateSurface={handleNavigateSurface}
      className="animate-in fade-in duration-200"
    />
  );
}
