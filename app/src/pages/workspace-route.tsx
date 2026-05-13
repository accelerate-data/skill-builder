import { useParams } from "@tanstack/react-router";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import { useBuilderSkillsQuery, useImportedSkillsQuery } from "@/lib/queries/skills";
import { useSettingsStore } from "@/stores/settings-store";

export default function WorkspaceRoutePage() {
  const { skillId } = useParams({ strict: false });
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

  if (!skill) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">Skill not found</p>
      </div>
    );
  }

  return (
    <WorkspaceShell
      key={skillId}
      skill={skill}
      skillType={skillType}
      className="animate-in fade-in duration-200"
    />
  );
}
