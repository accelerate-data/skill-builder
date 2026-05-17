import { useMemo, useState } from "react";
import type { DisplayNode } from "@/lib/display-types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

function shouldCollapseBody(node: DisplayNode, bodyText: string): boolean {
  if (node.kind !== "task_sent" && node.kind !== "agent_update") {
    return false;
  }

  return bodyText.length > 220 || bodyText.includes("\n");
}

function buildCollapsedPreview(bodyText: string): string {
  const normalized = bodyText.replace(/\s+/g, " ").trim();
  const sentenceParts = normalized.match(/[^.!?]+[.!?]+/g) ?? [];
  const previewFromSentences = sentenceParts.slice(0, 2).join(" ").trim();

  if (previewFromSentences.length > 0 && previewFromSentences.length <= 220) {
    return previewFromSentences;
  }

  if (normalized.length <= 220) {
    return normalized;
  }

  return `${normalized.slice(0, 217).trimEnd()}...`;
}

export function ConversationSemanticRow({
  node,
}: ConversationSemanticRowProps) {
  const label = node.label?.trim() || getDefaultLabel(node.kind);
  const bodyText = node.bodyText ?? "Event captured";
  const collapsible = shouldCollapseBody(node, bodyText);
  const collapsedPreview = useMemo(() => buildCollapsedPreview(bodyText), [bodyText]);
  const [expanded, setExpanded] = useState(false);

  return (
    <article
      data-testid="conversation-event-row"
      className={cn(
        "flex flex-col gap-1.5 rounded-lg border px-3 py-2.5",
        getContainerClass(node.kind, node.status),
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{label}</p>
          <p className="text-[11px] text-muted-foreground">
            {new Date(node.createdAtMs).toLocaleTimeString([], {
              hour: "numeric",
              minute: "2-digit",
            })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {node.kind === "task_sent" || node.kind === "agent_update" ? null : (
            <Badge variant="outline" className="capitalize">
              {node.kind.replace(/_/g, " ")}
            </Badge>
          )}
          <Badge variant={getStatusVariant(node.status)} className="capitalize">
            {node.status}
          </Badge>
        </div>
      </div>

      <div className="space-y-1.5">
        <p className="text-sm leading-6 text-foreground/90 whitespace-pre-wrap break-words">
          {collapsible && !expanded ? collapsedPreview : bodyText}
        </p>
        {collapsible ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-auto w-fit px-0 py-0 text-xs text-muted-foreground hover:bg-transparent hover:text-foreground"
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? "Show less" : "Show more"}
          </Button>
        ) : null}
      </div>
    </article>
  );
}
