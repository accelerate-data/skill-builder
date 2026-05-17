import { useMemo } from "react";
import { useConversationEvents } from "@/hooks/use-conversation-stream";
import { projectConversationEvents } from "@/lib/conversation-event-projection";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { RunStatusFooter, type FooterDisplayStatus } from "@/components/run-status-footer";
import { ConversationEventRow } from "./conversation-event-row";

interface ConversationTimelineProps {
  conversationId: string;
}

export function ConversationTimeline({ conversationId }: ConversationTimelineProps) {
  const events = useConversationEvents(conversationId);
  const nodes = useMemo(() => projectConversationEvents(events), [events]);
  const footerState = useMemo(() => deriveConversationFooterState(events), [events]);

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
      <RunStatusFooter
        status={footerState.status}
        label={footerState.label}
        errorText={footerState.errorText}
        testId="conversation-status-footer"
      />
    </Card>
  );
}

function deriveConversationFooterState(events: ReturnType<typeof useConversationEvents>): {
  status: FooterDisplayStatus;
  label?: string | null;
  errorText?: string | null;
} {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    const rawEvent = event.payload.rawOpenHandsEvent;
    if (!rawEvent || typeof rawEvent !== "object") continue;

    const message = rawEvent as {
      type?: unknown;
      status?: unknown;
      errorDetail?: unknown;
      error_detail?: unknown;
      eventClass?: unknown;
      event?: Record<string, unknown>;
    };

    if (message.type === "conversation_state") {
      const status = typeof message.status === "string" ? message.status : undefined;
      switch (status) {
        case "starting":
          return { status: "initializing", label: "conversation" };
        case "running":
          return { status: "running", label: "conversation" };
        case "completed":
          return { status: "completed", label: "conversation" };
        case "error":
          return {
            status: "error",
            label: "conversation",
            errorText:
              typeof message.errorDetail === "string"
                ? message.errorDetail
                : typeof message.error_detail === "string"
                  ? message.error_detail
                  : null,
          };
        case "cancelled":
          return { status: "paused", label: "conversation" };
      }
    }

    if (typeof message.eventClass !== "string") continue;
    if (message.eventClass === "PauseEvent") {
      const reason =
        typeof message.event?.reason === "string" ? message.event.reason : undefined;
      return { status: "paused", label: reason ?? "conversation" };
    }

    if (message.eventClass === "ConversationStateUpdateEvent") {
      const key = typeof message.event?.key === "string" ? message.event.key : undefined;
      const value =
        typeof message.event?.value === "string" ? message.event.value : undefined;
      if (key !== "execution_status" || !value) continue;
      switch (value) {
        case "running":
          return { status: "running", label: "conversation" };
        case "paused":
          return { status: "paused", label: "conversation" };
        case "finished":
          return { status: "completed", label: "conversation" };
        case "error":
          return { status: "error", label: "conversation" };
        case "idle":
          return { status: "idle", label: "conversation" };
      }
    }
  }

  return { status: "idle", label: "conversation" };
}
