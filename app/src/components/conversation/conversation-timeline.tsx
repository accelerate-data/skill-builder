import { useMemo } from "react";
import { useConversationEvents } from "@/hooks/use-conversation-stream";
import { projectConversationEvents } from "@/lib/conversation-event-projection";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ConversationEventRow } from "./conversation-event-row";

interface ConversationTimelineProps {
  conversationId: string;
}

export function ConversationTimeline({ conversationId }: ConversationTimelineProps) {
  const events = useConversationEvents(conversationId);
  const nodes = useMemo(() => projectConversationEvents(events), [events]);

  if (nodes.length === 0) {
    return (
      <Card className="flex min-h-0 flex-1">
        <CardContent
          data-testid="conversation-timeline-empty"
          className="flex h-full items-center justify-center text-sm text-muted-foreground"
        >
          No conversation activity yet
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="flex min-h-0 flex-1 overflow-hidden py-2 gap-0">
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-3 px-4 py-2">
          {nodes.map((node) => (
            <div key={node.id} className="animate-message-in">
              <ConversationEventRow node={node} />
            </div>
          ))}
        </div>
      </ScrollArea>
    </Card>
  );
}
