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

  if (node.kind === "runtime_setup") {
    return (
      <ConversationActivityGroup
        node={{
          ...node,
          kind: "activity_trace",
          label: node.label ?? "Runtime setup",
          collapsedByDefault: true,
          traceItems: [
            {
              id: `${node.id}:runtime-setup`,
              kind: "runtime_setup",
              title: node.label ?? "Runtime setup",
              summary: "System prompt prepared.",
              badgeLabel: "setup",
              sourceEventIds: node.sourceEventIds,
              interactive: true,
              drawerTitle: node.label ?? "Runtime setup",
              drawerSubtitle: "1 items",
              drawerSections: [
                {
                  title: "Summary",
                  body: node.bodyText ?? "System prompt prepared.",
                },
              ],
            },
          ],
        }}
      />
    );
  }

  return <ConversationSemanticRow node={node} />;
}
