import { selectSkillOpenHandsSession } from "@/lib/tauri";
import {
  getMessageText,
  type OpenHandsConversationEvent,
} from "@/lib/openhands-conversation-events";
import type {
  EditableSkill,
  SkillSessionInfo,
  RestoredConversationEvent,
} from "@/lib/types";
import {
  type RefineMessage,
  useRefineStore,
} from "@/stores/refine-store";
import { useAgentStore } from "@/stores/agent-store";

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

function toConversationEvent(
  event: RestoredConversationEvent,
): OpenHandsConversationEvent {
  return {
    type: "conversation_event",
    runtime: "openhands",
    eventClass: event.event_class,
    event: event.event,
    timestamp: event.timestamp,
    toolCallId: event.tool_call_id ?? undefined,
    parentToolCallId: event.parent_tool_call_id ?? undefined,
  };
}

function isUserMessageEvent(event: OpenHandsConversationEvent): boolean {
  return (
    event.eventClass === "MessageEvent" &&
    event.event.source === "user"
  );
}

function buildRestoredMessages(
  skill: EditableSkill,
  conversationId: string,
  restoredEvents: RestoredConversationEvent[],
): RefineMessage[] {
  const normalizedEvents = restoredEvents
    .map(toConversationEvent)
    .sort((left, right) => left.timestamp - right.timestamp);
  const messages: RefineMessage[] = [];
  const usageSessionId = `restored:refine:${skill.name}:${conversationId}`;
  const agentStore = useAgentStore.getState();
  let leadingEvents: OpenHandsConversationEvent[] = [];
  let currentUserText: string | null = null;
  let currentTurnEvents: OpenHandsConversationEvent[] = [];
  let turnIndex = 0;

  const pushTurn = () => {
    if (!currentUserText && currentTurnEvents.length === 0) {
      return;
    }
    const timestamp =
      currentTurnEvents[currentTurnEvents.length - 1]?.timestamp ?? Date.now();

    if (currentUserText) {
      messages.push({
        id: crypto.randomUUID(),
        role: "user",
        userText: currentUserText,
        timestamp,
      });
    }

    const hasRenderableAgentEvents = currentTurnEvents.some(
      (event) => !isUserMessageEvent(event),
    );
    if (hasRenderableAgentEvents) {
      const agentId = `${usageSessionId}:turn:${turnIndex}`;
      agentStore.registerRun(agentId, "restored", skill.name, "refine", usageSessionId);
      currentTurnEvents.forEach((event) => {
        agentStore.addConversationEvent(agentId, event);
      });
      useAgentStore.setState((state) => {
        const run = state.runs[agentId];
        if (!run) return state;
        return {
          runs: {
            ...state.runs,
            [agentId]: {
              ...run,
              status: "completed",
              startTime: currentTurnEvents[0]?.timestamp ?? run.startTime,
              endTime: timestamp,
              conversationEvents: currentTurnEvents,
            },
          },
        };
      });
      messages.push({
        id: crypto.randomUUID(),
        role: "agent",
        agentId,
        hideTaskSent: false,
        timestamp,
      });
      turnIndex += 1;
    }

    currentUserText = null;
    currentTurnEvents = [];
  };

  normalizedEvents.forEach((event) => {
    if (isUserMessageEvent(event)) {
      pushTurn();
      currentUserText = getMessageText(event) ?? "";
      currentTurnEvents = [
        ...(turnIndex === 0 ? leadingEvents : []),
        event,
      ];
      leadingEvents = [];
      return;
    }

    if (currentUserText != null || currentTurnEvents.length > 0) {
      currentTurnEvents.push(event);
      return;
    }

    leadingEvents.push(event);
  });

  pushTurn();
  return messages;
}

function buildFallbackMessages(
  session: SkillSessionInfo,
): RefineMessage[] {
  return session.restored_messages.map((message, index) => ({
    id: crypto.randomUUID(),
    role: message.role === "user" ? "user" : "agent",
    userText: message.role === "user" ? message.content : undefined,
    agentText: message.role === "user" ? undefined : message.content,
    timestamp: Date.now() + index,
  }));
}

export function hydrateSelectedSkillOpenHandsSession(
  skill: Pick<EditableSkill, "name" | "plugin_slug"> & Partial<EditableSkill>,
  session: SkillSessionInfo,
): void {
  const editableSkill = buildSessionSkill(skill);
  const store = useRefineStore.getState();
  useAgentStore.getState().clearRunsBySource("refine");
  store.selectSkill(editableSkill);
  store.setConversationId(session.conversation_id || null);
  store.setAvailableAgents(session.available_agents ?? []);

  const messages =
    session.restored_transcript_events.length > 0
      ? buildRestoredMessages(
          editableSkill,
          session.conversation_id,
          session.restored_transcript_events,
        )
      : buildFallbackMessages(session);
  store.setMessages(messages);
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
