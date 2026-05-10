import type { SkillSummary, ImportedSkill, EditableSkill } from "@/lib/types";

type SkillLike =
  | Pick<SkillSummary, "skill_source" | "status">
  | Pick<EditableSkill, "skill_source" | "status">
  | ImportedSkill;

export function getSkillSurface(skill: SkillLike): "workflow" | "workspace" {
  const source = "skill_source" in skill ? skill.skill_source : null;
  if (source !== "skill-builder") return "workspace";
  const status = "status" in skill ? skill.status : null;
  return status === "completed" ? "workspace" : "workflow";
}
