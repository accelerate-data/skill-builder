import { useMemo } from "react";
import { useConversationEvents } from "@/hooks/use-conversation-stream";
import { projectConversationEvents } from "@/lib/conversation-event-projection";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { RunStatusFooter, type FooterDisplayStatus } from "@/components/run-status-footer";
import { EventDisplayList } from "./event-display-list";

interface EventDisplayTimelineProps {
  conversationId: string;
}

export function EventDisplayTimeline({ conversationId }: EventDisplayTimelineProps) {
  const events = useConversationEvents(conversationId);
  const nodes = useMemo(() => projectConversationEvents(events), [events]);
  const footerState = useMemo(() => deriveConversationFooterState(events), [events]);

  if (nodes.length === 0) {
    return (
      <Card className="flex min-h-0 flex-1 flex-col gap-0">
        <CardContent
          data-testid="conversation-timeline-empty"
          className="flex flex-1 items-center justify-center text-sm text-muted-foreground"
        >
          No conversation activity yet
        </CardContent>
        <RunStatusFooter
          status={footerState.status}
          label={footerState.label}
          model={footerState.model}
          tokenCount={footerState.tokenCount}
          errorText={footerState.errorText}
          testId="conversation-status-footer"
        />
      </Card>
    );
  }

  return (
    <Card className="flex min-h-0 flex-1 overflow-hidden py-2 gap-0">
      <ScrollArea className="min-h-0 flex-1">
        <div className="px-4 py-2">
          <EventDisplayList nodes={nodes} />
        </div>
      </ScrollArea>
      <RunStatusFooter
        status={footerState.status}
        label={footerState.label}
        model={footerState.model}
        tokenCount={footerState.tokenCount}
        errorText={footerState.errorText}
        testId="conversation-status-footer"
      />
    </Card>
  );
}

interface FooterState {
  status: FooterDisplayStatus;
  label?: string | null;
  model?: string | null;
  tokenCount?: string | null;
  errorText?: string | null;
}

function deriveConversationFooterState(
  events: ReturnType<typeof useConversationEvents>,
): FooterState {
  let model: string | undefined;
  let totalTokens = 0;
  let status: FooterDisplayStatus | undefined;
  let label: string | undefined;
  let errorText: string | undefined;

  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    const openHandsEvent = event.payload.openHandsEvent;
    if (!openHandsEvent) continue;

    if (openHandsEvent.kind === "TokenEvent") {
      totalTokens +=
        (openHandsEvent.prompt_token_ids?.length ?? 0) +
        (openHandsEvent.response_token_ids?.length ?? 0);
      continue;
    }

    if (!model && openHandsEvent.kind === "LLMCompletionLogEvent" && openHandsEvent.model_name) {
      model = openHandsEvent.model_name;
      continue;
    }

    if (status) continue;

    if (openHandsEvent.kind === "PauseEvent") {
      status = "paused";
      label = openHandsEvent.reason ?? "conversation";
      continue;
    }

    if (openHandsEvent.kind === "ConversationStateUpdateEvent") {
      if (openHandsEvent.key !== "execution_status") continue;
      const value =
        typeof openHandsEvent.value === "string" ? openHandsEvent.value : undefined;
      const mapped = mapExecutionStatus(value);
      if (mapped) {
        status = mapped;
        label = "conversation";
      }
      continue;
    }

    if (openHandsEvent.kind === "FinishEvent") {
      status = "completed";
      label = "conversation";
      continue;
    }

    if (openHandsEvent.kind === "ConversationErrorEvent") {
      status = "error";
      label = "conversation";
      errorText = openHandsEvent.detail;
      continue;
    }
  }

  return {
    status: status ?? "idle",
    label: label ?? "conversation",
    model: model ?? null,
    tokenCount: totalTokens > 0 ? formatTokenCount(totalTokens) : null,
    errorText: errorText ?? null,
  };
}

function mapExecutionStatus(value: string | undefined): FooterDisplayStatus | undefined {
  switch (value) {
    case "running":
      return "running";
    case "paused":
      return "paused";
    case "finished":
    case "completed":
      return "completed";
    case "error":
      return "error";
    case "idle":
      return "idle";
    default:
      return undefined;
  }
}

function formatTokenCount(n: number): string {
  if (n < 1_000) return String(n);
  if (n < 1_000_000) return `${(n / 1_000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}
