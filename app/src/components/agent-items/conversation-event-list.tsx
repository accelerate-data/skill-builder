import { memo, useMemo } from "react";
import {
  AlertTriangle,
  Braces,
  MessageSquare,
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
  getObservationText,
  getReasoningText,
  getToolInput,
  getToolName,
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
  if (!text) return null;
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
      <MarkdownText text={text} />
    </EventShell>
  );
}

function ActionEventView({ event }: { event: OpenHandsConversationEvent }) {
  const reasoning = getReasoningText(event);
  const toolName = getToolName(event);
  const command = getCommandText(event);
  const input = getToolInput(event);

  return (
    <EventShell icon={<Terminal className="size-3.5" />} title="Action">
      {reasoning && <MarkdownText text={reasoning} />}
      {toolName && (
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="font-mono text-[10px]">
            {toolName}
          </Badge>
          {command && <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{command}</code>}
        </div>
      )}
      {input !== undefined && <PayloadBlock value={input} />}
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
      {visibleEvents.map((event, index) => (
        <div
          key={`${event.conversationId ?? "conversation"}-${event.timestamp}-${index}`}
          className="min-w-0 w-full animate-message-in"
        >
          <ConversationEventView event={event} />
        </div>
      ))}
    </div>
  );
});
