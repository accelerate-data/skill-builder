import { selectSkillOpenHandsSession } from "@/lib/tauri";
import type { EditableSkill } from "@/lib/types";
import { useRefineStore } from "@/stores/refine-store";

function buildSessionSkill(
  skill: Pick<EditableSkill, "name" | "plugin_slug"> & Partial<EditableSkill>,
): EditableSkill {
  return {
    name: skill.name,
    plugin_slug: skill.plugin_slug,
    skill_source: skill.skill_source ?? null,
    purpose: skill.purpose ?? null,
    description: skill.description ?? null,
    tags: skill.tags ?? [],
    intake_json: skill.intake_json ?? null,
    version: skill.version ?? null,
    model: skill.model ?? null,
    argumentHint: skill.argumentHint ?? null,
    userInvocable: skill.userInvocable ?? null,
    disableModelInvocation: skill.disableModelInvocation ?? null,
    status: skill.status ?? null,
    current_step: skill.current_step ?? null,
  };
}

export async function restartSkillOpenHandsSession(
  skill: Pick<EditableSkill, "name" | "plugin_slug"> & Partial<EditableSkill>,
  workspacePath: string,
): Promise<void> {
  const editableSkill = buildSessionSkill(skill);
  const store = useRefineStore.getState();
  store.selectSkill(null);

  const session = await selectSkillOpenHandsSession(
    editableSkill.name,
    workspacePath,
    editableSkill.plugin_slug,
  );

  store.setSelectedSkill(editableSkill);
  store.setConversationId(session.conversation_id || null);
  store.setAvailableAgents(session.available_agents ?? []);
  store.setMessages([]);
}
