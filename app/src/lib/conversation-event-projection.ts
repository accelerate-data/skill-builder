import type { DisplayNode } from "./display-types";
import type { ConversationEventEnvelope } from "./conversation-event-types";

export function projectConversationEvents(
  events: ConversationEventEnvelope[],
): DisplayNode[] {
  return events.map((event) => ({
    id: event.eventId,
    kind: event.display.kind,
    status: event.status,
    label: event.display.label,
    collapsedByDefault: event.display.collapsedByDefault,
    payload: event.payload,
    createdAtMs: event.createdAtMs,
  }));
}
