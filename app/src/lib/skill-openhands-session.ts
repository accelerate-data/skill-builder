import { selectSkillOpenHandsSession } from "@/lib/tauri";
import {
  buildCanonicalConversationEventEnvelope,
  normalizeOpenHandsEventRecord,
} from "@/lib/openhands-conversation-events";
import type {
  EditableSkill,
  RestoredConversationEvent,
  SkillSessionInfo,
} from "@/lib/types";
import { useConversationStore } from "@/stores/conversation-store";
import { useSkillStore } from "@/stores/skill-store";

function buildSessionSkill(
  skill: Pick<EditableSkill, "name" | "plugin_slug"> & Partial<EditableSkill>,
): EditableSkill {
  return {
    id: skill.id ?? null,
    name: skill.name,
    plugin_slug: skill.plugin_slug,
    skill_source: skill.skill_source ?? null,
    purpose: skill.purpose ?? null,
    description: skill.description ?? null,
    tags: skill.tags ?? [],
    intake_json: skill.intake_json ?? null,
    version: skill.version ?? null,
    userInvocable: skill.userInvocable ?? null,
    disableModelInvocation: skill.disableModelInvocation ?? null,
    status: skill.status ?? null,
    current_step: skill.current_step ?? null,
  };
}

function hydrateCanonicalConversationHistory(
  conversationId: string | null,
  restoredTranscriptEvents: RestoredConversationEvent[],
): void {
  if (!conversationId) {
    return;
  }

  const canonicalEvents = restoredTranscriptEvents
    .map((event) => {
      const normalized = normalizeOpenHandsEventRecord(event);
      if (!normalized) {
        console.warn(
          "[skill-openhands-session] Skipping unrecognized restored OpenHands event",
          event,
        );
        return null;
      }
      return buildCanonicalConversationEventEnvelope(normalized, conversationId, {
        conversationId,
        rawEvent: event,
      });
    })
    .filter((event): event is NonNullable<typeof event> => event !== null);

  useConversationStore
    .getState()
    .replaceConversationHistory(conversationId, canonicalEvents);
}

export function hydrateSelectedSkillOpenHandsSession(
  skill: Pick<EditableSkill, "name" | "plugin_slug"> & Partial<EditableSkill>,
  session: SkillSessionInfo,
): void {
  const editableSkill = buildSessionSkill(skill);
  const store = useSkillStore.getState();
  store.selectSkill(editableSkill);
  store.setConversationId(session.conversation_id || null);
  store.setAvailableAgents(session.available_agents ?? []);
  hydrateCanonicalConversationHistory(
    session.conversation_id || null,
    session.restored_transcript_events ?? [],
  );
}

export async function restartSkillOpenHandsSession(
  skill: Pick<EditableSkill, "name" | "plugin_slug"> & Partial<EditableSkill>,
): Promise<void> {
  const editableSkill = buildSessionSkill(skill);
  if (editableSkill.id == null) {
    throw new Error(`Missing DB skill ID for '${editableSkill.name}'`);
  }
  const session = await selectSkillOpenHandsSession(
    editableSkill.id,
  );

  hydrateSelectedSkillOpenHandsSession(editableSkill, session);
}
