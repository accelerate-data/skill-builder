import type { EditableSkill, SkillSummary, ImportedSkill } from "@/lib/types";
import { toEditableSkill } from "@/lib/types";

export function resolveSkill(
  skillId: string | null | undefined,
  builderSkills: SkillSummary[],
  importedSkills: ImportedSkill[],
): EditableSkill | null {
  if (!skillId) return null;

  const builder = builderSkills.find(
    (s) => s.skill_source === "skill-builder" && String(s.id) === skillId,
  );
  const imported = importedSkills.find(
    (s) => s.skill_id === skillId,
  );
  const skill = builder ?? imported ?? null;
  if (!skill) return null;

  return "name" in skill
    ? (skill as EditableSkill)
    : toEditableSkill(skill);
}
