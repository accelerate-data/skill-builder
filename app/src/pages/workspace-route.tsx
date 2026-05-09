import { useParams, useSearch } from "@tanstack/react-router";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import { useBuilderSkillsQuery, useImportedSkillsQuery } from "@/lib/queries/skills";
import { useSettingsStore } from "@/stores/settings-store";
import { toEditableSkill } from "@/lib/types";

type WorkspaceSurface = "overview" | "refine" | "evals";

function surfaceFromTab(tab?: string): WorkspaceSurface {
  if (tab === "refine") return "refine";
  if (tab === "evals" || tab === "description") return "evals";
  return "overview";
}

export default function WorkspaceRoutePage() {
  const { skillName } = useParams({ strict: false });
  const search = useSearch({ strict: false }) as Record<string, string> | undefined;
  const workspacePath = useSettingsStore((s) => s.workspacePath);
  const { data: builderSkills = [] } = useBuilderSkillsQuery(workspacePath);
  const { data: importedSkills = [] } = useImportedSkillsQuery();

  const selectedBuilderSkill = builderSkills.find(
    (s) => s.skill_source === "skill-builder" && (s.library_key ?? s.name) === skillName,
  );
  const selectedImportedSkill = importedSkills.find(
    (s) => (s.library_key ?? `imported:${s.skill_id}`) === skillName,
  );
  const skill = selectedBuilderSkill ?? selectedImportedSkill ?? null;
  const skillType = selectedBuilderSkill
    ? selectedBuilderSkill.skill_source === "marketplace"
      ? "marketplace"
      : "builder"
    : selectedImportedSkill?.marketplace_source_url
      ? "marketplace"
      : "imported";

  if (!skill) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">Skill not found</p>
      </div>
    );
  }

  const initialSurface = surfaceFromTab(search?.tab);
  const editableSkill = "name" in skill ? skill : toEditableSkill(skill);

  return (
    <WorkspaceShell
      key={skillName}
      skill={editableSkill}
      skillType={skillType}
      initialTab={initialSurface === "overview" ? undefined : initialSurface}
      className="animate-in fade-in duration-200"
    />
  );
}
