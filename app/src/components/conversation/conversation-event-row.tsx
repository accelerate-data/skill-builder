import type { DisplayNode } from "@/lib/display-types";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface ConversationEventRowProps {
  node: DisplayNode;
}

function getDefaultLabel(kind: DisplayNode["kind"]): string {
  switch (kind) {
    case "user_message":
      return "You";
    case "agent_message":
      return "OpenHands";
    case "tool_call":
      return "Tool call";
    case "tool_result":
      return "Tool result";
    case "subagent":
      return "Subagent";
    case "state":
      return "State";
    case "error":
      return "Error";
    case "system":
      return "System";
    default:
      return "Conversation";
  }
}

function getStatusVariant(status: DisplayNode["status"]): "secondary" | "outline" | "destructive" {
  switch (status) {
    case "failed":
      return "destructive";
    case "observed":
      return "secondary";
    default:
      return "outline";
  }
}

function getBodyText(node: DisplayNode): string {
  if (node.payload.frontendCommand?.text) {
    return node.payload.frontendCommand.text;
  }

  if (node.payload.backendError?.message) {
    return node.payload.backendError.message;
  }

  const rawEvent = node.payload.rawOpenHandsEvent;
  if (rawEvent && typeof rawEvent === "object") {
    const candidate = rawEvent as Record<string, unknown>;
    const text =
      candidate.text ??
      candidate.message ??
      candidate.content ??
      candidate.summary ??
      candidate.tool_name ??
      candidate.event;

    if (typeof text === "string" && text.trim().length > 0) {
      return text;
    }
  }

  return "Event captured";
}

function getKindContainerClass(kind: DisplayNode["kind"]): string {
  switch (kind) {
    case "user_message":
      return "ml-auto max-w-[85%] border-primary/20 bg-primary/5";
    case "agent_message":
      return "mr-auto max-w-[90%] border-border bg-card";
    case "error":
      return "mr-auto max-w-[90%] border-destructive/40 bg-destructive/5";
    default:
      return "mr-auto max-w-[90%] border-border bg-card";
  }
}

export function ConversationEventRow({ node }: ConversationEventRowProps) {
  const label = node.label?.trim() || getDefaultLabel(node.kind);
  const bodyText = getBodyText(node);

  return (
    <article
      data-testid="conversation-event-row"
      className={cn(
        "flex flex-col gap-2 rounded-lg border px-4 py-3",
        node.status === "failed"
          ? "mr-auto max-w-[90%] border-destructive/40 bg-destructive/5"
          : getKindContainerClass(node.kind),
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{label}</p>
          <p className="text-xs text-muted-foreground">
            {new Date(node.createdAtMs).toLocaleTimeString([], {
              hour: "numeric",
              minute: "2-digit",
            })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="capitalize">
            {node.kind.replace(/_/g, " ")}
          </Badge>
          <Badge variant={getStatusVariant(node.status)} className="capitalize">
            {node.status}
          </Badge>
        </div>
      </div>
      <p className="text-sm leading-6 text-foreground/90 whitespace-pre-wrap break-words">
        {bodyText}
      </p>
    </article>
  );
}
