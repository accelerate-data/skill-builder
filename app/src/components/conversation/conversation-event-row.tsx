import type { DisplayNode } from "@/lib/display-types";
import { ConversationActivityGroup } from "./conversation-activity-group";
import { ConversationSemanticRow } from "./conversation-semantic-row";

interface ConversationEventRowProps {
  node: DisplayNode;
}

export function ConversationEventRow({ node }: ConversationEventRowProps) {
  if (node.kind === "activity_trace") {
    return <ConversationActivityGroup node={node} />;
  }

  return <ConversationSemanticRow node={node} />;
}
