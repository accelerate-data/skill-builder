import type { EditableSkill, SkillSummary, ImportedSkill } from "@/lib/types";
import { toEditableSkill } from "@/lib/types";

export function resolveSkill(
  skillName: string | null | undefined,
  builderSkills: SkillSummary[],
  importedSkills: ImportedSkill[],
): EditableSkill | null {
  if (!skillName) return null;

  const builder = builderSkills.find(
    (s) => s.skill_source === "skill-builder" && (s.library_key ?? s.name) === skillName,
  );
  const imported = importedSkills.find(
    (s) => (s.library_key ?? `imported:${s.skill_id}`) === skillName,
  );
  const skill = builder ?? imported ?? null;
  if (!skill) return null;

  return "name" in skill
    ? (skill as EditableSkill)
    : toEditableSkill(skill);
}
