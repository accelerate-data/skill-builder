import type { DisplayNode } from "@/lib/display-types";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface ConversationSemanticRowProps {
  node: DisplayNode;
}

function getDefaultLabel(kind: DisplayNode["kind"]): string {
  switch (kind) {
    case "task_sent":
      return "Task sent";
    case "agent_update":
      return "Agent update";
    case "skill":
      return "Skill";
    case "subagent":
      return "Subagent";
    case "result":
      return "Result";
    case "runtime_setup":
      return "Runtime setup";
    case "lifecycle":
      return "Lifecycle";
    case "pause":
      return "Paused";
    case "tool_error":
      return "Tool error";
    case "subagent_error":
      return "Subagent error";
    default:
      return "Unknown event";
  }
}

function getContainerClass(kind: DisplayNode["kind"], status: DisplayNode["status"]): string {
  if (status === "failed" || kind === "tool_error" || kind === "subagent_error") {
    return "mr-auto max-w-[90%] border-destructive/40 bg-destructive/5";
  }

  switch (kind) {
    case "task_sent":
      return "ml-auto max-w-[85%] border-primary/20 bg-primary/5";
    case "agent_update":
      return "mr-auto max-w-[90%] border-border bg-card";
    default:
      return "mr-auto max-w-[90%] border-border bg-card";
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

export function ConversationSemanticRow({
  node,
}: ConversationSemanticRowProps) {
  const label = node.label?.trim() || getDefaultLabel(node.kind);

  return (
    <article
      data-testid="conversation-event-row"
      className={cn(
        "flex flex-col gap-2 rounded-lg border px-4 py-3",
        getContainerClass(node.kind, node.status),
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
        {node.bodyText ?? "Event captured"}
      </p>
    </article>
  );
}
