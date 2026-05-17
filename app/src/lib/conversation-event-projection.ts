import type { DisplayNode } from "./display-types";
import type { ConversationEventEnvelope } from "./conversation-event-types";
import { projectSemanticDisplayNodes } from "./conversation-display-semantics";

export function projectConversationEvents(
  events: ConversationEventEnvelope[],
): DisplayNode[] {
  return projectSemanticDisplayNodes(events);
}
