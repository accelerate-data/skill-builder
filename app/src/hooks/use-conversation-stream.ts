import { useConversationStore } from "@/stores/conversation-store";
import type { ConversationEventEnvelope } from "@/lib/conversation-event-types";

const EMPTY_EVENTS: ConversationEventEnvelope[] = [];

export function useConversationEvents(
  conversationId: string,
): ConversationEventEnvelope[] {
  return useConversationStore(
    (state) => state.eventsByConversation[conversationId] ?? EMPTY_EVENTS,
  );
}
