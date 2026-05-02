import { memo, useMemo } from "react";
import {
  AlertTriangle,
  Braces,
  Layers3,
  MessageSquare,
  Pause,
  Terminal,
  TextSearch,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ErrorBoundary } from "@/components/error-boundary";
import { MemoizedMarkdown } from "./memoized-markdown";
import type { OpenHandsConversationEvent } from "@/lib/openhands-conversation-events";
import {
  getCommandText,
  getErrorText,
  getEventText,
  getInternalEventSummary,
  getLlmResponseId,
  getObservationText,
  getReasoningText,
  getToolCallId,
  getToolInput,
  getToolName,
  groupConversationActionEvents,
  isInternalOpenHandsEventClass,
  stringifyEventPayload,
} from "@/lib/openhands-conversation-events";

export const CONVERSATION_EVENT_WINDOW_SIZE = 100;

interface ConversationEventListProps {
  events: OpenHandsConversationEvent[];
}

function EventShell({
  icon,
  title,
  tone,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  tone?: "default" | "error";
  children: React.ReactNode;
}) {
  const borderColor =
    tone === "error" ? "var(--chat-error-border)" : "var(--color-pacific)";
  const background =
    tone === "error" ? "var(--chat-error-bg)" : "var(--background)";

  return (
    <div
      className="min-w-0 rounded-md border bg-background px-3 py-2 text-sm"
      style={{ borderLeft: `3px solid ${borderColor}`, background }}
    >
      <div className="mb-1.5 flex min-w-0 items-center gap-2">
        <span className="shrink-0 text-muted-foreground">{icon}</span>
        <span className="truncate text-xs font-semibold">{title}</span>
      </div>
      <div className="min-w-0 space-y-2">{children}</div>
    </div>
  );
}

function MarkdownText({ text }: { text: string }) {
  return (
    <ErrorBoundary fallback={<pre className="whitespace-pre-wrap break-words text-sm">{text}</pre>}>
      <MemoizedMarkdown content={text} />
    </ErrorBoundary>
  );
}

function PayloadBlock({ value }: { value: unknown }) {
  return (
    <pre className="max-h-64 overflow-auto rounded bg-muted/50 p-2 text-xs whitespace-pre-wrap break-words">
      {stringifyEventPayload(value)}
    </pre>
  );
}

function MessageEventView({ event }: { event: OpenHandsConversationEvent }) {
  const text = getEventText(event);
  const source = typeof event.event.source === "string" ? event.event.source : undefined;

  return (
    <EventShell
      icon={<MessageSquare className="size-3.5" />}
      title="Message"
    >
      {source && (
        <Badge variant="outline" className="text-[10px]">
          {source}
        </Badge>
      )}
      {text ? <MarkdownText text={text} /> : <PayloadBlock value={event.event} />}
    </EventShell>
  );
}

function ActionEventView({ event }: { event: OpenHandsConversationEvent }) {
  const reasoning = getReasoningText(event);
  const toolName = getToolName(event);
  const toolCallId = getToolCallId(event);
  const llmResponseId = getLlmResponseId(event);
  const command = getCommandText(event);
  const input = getToolInput(event);
  const hasReadableContent = Boolean(
    reasoning || toolName || toolCallId || llmResponseId || command || input !== undefined,
  );

  return (
    <EventShell icon={<Terminal className="size-3.5" />} title="Action">
      {reasoning && <MarkdownText text={reasoning} />}
      {toolName && (
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="font-mono text-[10px]">
            {toolName}
          </Badge>
          {toolCallId && (
            <Badge variant="outline" className="font-mono text-[10px]">
              {toolCallId}
            </Badge>
          )}
          {llmResponseId && (
            <Badge variant="outline" className="font-mono text-[10px]">
              {llmResponseId}
            </Badge>
          )}
          {command && <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{command}</code>}
        </div>
      )}
      {input !== undefined && <PayloadBlock value={input} />}
      {!hasReadableContent && <PayloadBlock value={event.event} />}
    </EventShell>
  );
}

function ObservationEventView({ event }: { event: OpenHandsConversationEvent }) {
  const text = getObservationText(event);

  return (
    <EventShell icon={<TextSearch className="size-3.5" />} title="Observation">
      {text ? <MarkdownText text={text} /> : <PayloadBlock value={event.event} />}
    </EventShell>
  );
}

function ErrorEventView({
  event,
  title,
}: {
  event: OpenHandsConversationEvent;
  title: string;
}) {
  const text = getErrorText(event) ?? getObservationText(event);
  const toolName = getToolName(event);

  return (
    <EventShell icon={<AlertTriangle className="size-3.5" />} title={title} tone="error">
      {toolName && (
        <Badge variant="destructive" className="font-mono text-[10px]">
          {toolName}
        </Badge>
      )}
      {text ? <MarkdownText text={text} /> : <PayloadBlock value={event.event} />}
    </EventShell>
  );
}

function ParallelActionGroupView({
  events,
  llmResponseId,
  reasoningText,
}: {
  events: OpenHandsConversationEvent[];
  llmResponseId: string;
  reasoningText?: string;
}) {
  return (
    <EventShell
      icon={<Layers3 className="size-3.5" />}
      title={`Parallel Actions (${events.length})`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="font-mono text-[10px]">
          {llmResponseId}
        </Badge>
      </div>
      {reasoningText && <MarkdownText text={reasoningText} />}
      <div className="space-y-2">
        {events.map((event, index) => {
          const toolName = getToolName(event);
          const toolCallId = getToolCallId(event);
          const command = getCommandText(event);
          const input = getToolInput(event);

          return (
            <div
              key={`${toolCallId ?? event.timestamp}-${index}`}
              className="rounded border border-border/60 bg-muted/20 p-2"
            >
              <div className="mb-1 flex flex-wrap items-center gap-2">
                {toolName && (
                  <Badge variant="secondary" className="font-mono text-[10px]">
                    {toolName}
                  </Badge>
                )}
                {toolCallId && (
                  <Badge variant="outline" className="font-mono text-[10px]">
                    {toolCallId}
                  </Badge>
                )}
                {command && (
                  <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                    {command}
                  </code>
                )}
              </div>
              {input !== undefined && <PayloadBlock value={input} />}
            </div>
          );
        })}
      </div>
    </EventShell>
  );
}

function InternalEventView({ event }: { event: OpenHandsConversationEvent }) {
  const summary = getInternalEventSummary(event);
  return (
    <EventShell
      icon={<Pause className="size-3.5" />}
      title={event.eventClass}
    >
      {summary ? <MarkdownText text={summary} /> : <PayloadBlock value={event.event} />}
    </EventShell>
  );
}

function UnknownEventView({ event }: { event: OpenHandsConversationEvent }) {
  return (
    <EventShell icon={<Braces className="size-3.5" />} title={event.eventClass}>
      <PayloadBlock value={event.event} />
    </EventShell>
  );
}

function ConversationEventView({ event }: { event: OpenHandsConversationEvent }) {
  switch (event.eventClass) {
    case "MessageEvent":
      return <MessageEventView event={event} />;
    case "ActionEvent":
      return <ActionEventView event={event} />;
    case "ObservationEvent":
    case "UserRejectObservation":
      return <ObservationEventView event={event} />;
    case "AgentErrorEvent":
      return <ErrorEventView event={event} title="Agent Error" />;
    case "ConversationErrorEvent":
      return <ErrorEventView event={event} title="Conversation Error" />;
    default:
      if (isInternalOpenHandsEventClass(event.eventClass)) {
        return <InternalEventView event={event} />;
      }
      return <UnknownEventView event={event} />;
  }
}

export const ConversationEventList = memo(function ConversationEventList({
  events,
}: ConversationEventListProps) {
  const hiddenEventCount = Math.max(0, events.length - CONVERSATION_EVENT_WINDOW_SIZE);
  const visibleEvents = useMemo(
    () =>
      hiddenEventCount > 0
        ? events.slice(-CONVERSATION_EVENT_WINDOW_SIZE)
        : events,
    [events, hiddenEventCount],
  );
  const visibleEventItems = useMemo(
    () => groupConversationActionEvents(visibleEvents),
    [visibleEvents],
  );

  if (events.length === 0) return null;

  return (
    <div
      data-testid="conversation-event-list"
      className="flex min-w-0 w-full flex-col gap-2 overflow-hidden"
    >
      {hiddenEventCount > 0 && (
        <div
          data-testid="conversation-event-window-indicator"
          className="rounded border border-dashed border-muted-foreground/25 bg-muted/30 px-3 py-2 text-center text-xs text-muted-foreground"
        >
          {hiddenEventCount} older {hiddenEventCount === 1 ? "event" : "events"} hidden
        </div>
      )}
      {visibleEventItems.map((item, index) => (
        <div
          key={
            item.type === "parallel_action_group"
              ? `parallel-${item.llmResponseId}-${index}`
              : `${item.event.conversationId ?? "conversation"}-${item.event.timestamp}-${index}`
          }
          className="min-w-0 w-full animate-message-in"
        >
          {item.type === "parallel_action_group" ? (
            <ParallelActionGroupView
              events={item.events}
              llmResponseId={item.llmResponseId}
              reasoningText={item.reasoningText}
            />
          ) : (
            <ConversationEventView event={item.event} />
          )}
        </div>
      ))}
    </div>
  );
});
