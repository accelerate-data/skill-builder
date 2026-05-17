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
    return "mr-auto max-w-[78%] rounded-2xl border-destructive/40 bg-rose-50/80 shadow-[0_8px_24px_-18px_rgba(190,24,93,0.4)]";
  }

  switch (kind) {
    case "task_sent":
      return "ml-auto w-full max-w-[56%] rounded-[20px] rounded-tr-md border-sky-200/70 bg-[linear-gradient(180deg,rgba(242,249,255,0.98),rgba(235,245,252,0.9))] shadow-[0_12px_28px_-24px_rgba(14,116,144,0.42)]";
    case "agent_update":
      return "mr-auto w-full max-w-[56%] rounded-[20px] rounded-tl-md border-emerald-200/80 bg-[linear-gradient(180deg,rgba(243,252,247,0.99),rgba(235,248,240,0.94))] shadow-[0_14px_32px_-28px_rgba(22,101,52,0.2)]";
    case "unknown_event":
      return "mr-auto max-w-[68%] rounded-2xl border-stone-200/80 bg-stone-50/90 shadow-[0_10px_32px_-26px_rgba(28,25,23,0.25)]";
    default:
      return "mr-auto max-w-[78%] rounded-2xl border-stone-200 bg-white/95 shadow-[0_16px_42px_-32px_rgba(28,25,23,0.22)]";
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

function looksStructured(bodyText: string): boolean {
  const trimmed = bodyText.trim();
  return (
    trimmed.startsWith("{") ||
    trimmed.startsWith("[") ||
    trimmed.includes('":{"') ||
    trimmed.includes('","') ||
    trimmed.includes('":')
  );
}

function shouldShowStatusBadge(node: DisplayNode): boolean {
  if (node.status === "failed" || node.kind === "tool_error" || node.kind === "subagent_error") {
    return true;
  }

  if (node.kind === "task_sent") {
    return node.status === "sending";
  }

  return false;
}

export function ConversationSemanticRow({
  node,
}: ConversationSemanticRowProps) {
  const label = node.label?.trim() || getDefaultLabel(node.kind);
  const bodyText = node.bodyText ?? "Event captured";
  const collapsible = shouldCollapseBody(node, bodyText);
  const collapsedPreview = useMemo(() => buildCollapsedPreview(bodyText), [bodyText]);
  const structuredBody = useMemo(() => looksStructured(bodyText), [bodyText]);
  const [expanded, setExpanded] = useState(false);
  const timestamp = new Date(node.createdAtMs).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  const actorLabel =
    node.kind === "task_sent" ? "You" : node.kind === "agent_update" ? "Agent" : "";
  const isNarrativeRow = node.kind === "task_sent" || node.kind === "agent_update";
  const metadataClass =
    node.kind === "task_sent"
      ? "ml-auto flex w-full max-w-[56%] justify-end text-right"
      : "mr-auto flex w-full max-w-[56%] justify-start text-left";

  if (isNarrativeRow) {
    return (
      <div data-testid="conversation-event-row" className="flex flex-col gap-1">
        <div className={metadataClass}>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] leading-none">
            {node.kind === "task_sent" ? (
              <>
                <p className="font-medium tracking-[0.08em] text-stone-400">{timestamp}</p>
                <p className="uppercase tracking-[0.12em] text-stone-400">{actorLabel}</p>
              </>
            ) : (
              <>
                <p className="uppercase tracking-[0.12em] text-emerald-600">{actorLabel}</p>
                <p className="font-medium tracking-[0.08em] text-stone-400">{timestamp}</p>
              </>
            )}
            {shouldShowStatusBadge(node) ? (
              <Badge variant={getStatusVariant(node.status)} className="capitalize">
                {node.status}
              </Badge>
            ) : null}
          </div>
        </div>

        <article
          className={cn(
            "relative flex flex-col gap-1 border px-2.5 py-1.5",
            getContainerClass(node.kind, node.status),
          )}
        >
          <div className="space-y-0.5">
            <div
              className={cn(
                "rounded-xl",
                structuredBody && node.kind === "agent_update"
                  ? "border border-emerald-200/80 bg-emerald-50/80 px-2 py-1.5"
                  : "px-0 py-0",
              )}
            >
              <p
                className={cn(
                  "whitespace-pre-wrap break-words text-sm leading-6 text-stone-700",
                  structuredBody && node.kind === "agent_update"
                    ? "font-mono text-[12px] leading-5 text-emerald-950/80"
                    : "tracking-[-0.01em]",
                  node.kind === "task_sent" && "text-sm leading-6 text-stone-800",
                )}
              >
                {collapsible && !expanded ? collapsedPreview : bodyText}
              </p>
            </div>
            {collapsible ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-auto w-fit px-0 py-0 text-[10px] font-semibold uppercase tracking-[0.08em] text-stone-400 hover:bg-transparent hover:text-stone-700"
                onClick={() => setExpanded((current) => !current)}
              >
                {expanded ? "Show less" : "Show more"}
              </Button>
            ) : null}
          </div>
        </article>
      </div>
    );
  }

  return (
    <article
      data-testid="conversation-event-row"
      className={cn(
        "relative flex flex-col gap-1 border px-2.5 py-1.5",
        getContainerClass(node.kind, node.status),
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {
            <div className="space-y-0.5">
              <p className="truncate text-[0.95rem] font-semibold tracking-[-0.02em] text-stone-900">
                {label}
              </p>
              <p className="text-[11px] font-medium text-stone-400">{timestamp}</p>
            </div>
          }
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="capitalize">
            {node.kind.replace(/_/g, " ")}
          </Badge>
          {shouldShowStatusBadge(node) ? (
            <Badge variant={getStatusVariant(node.status)} className="capitalize">
              {node.status}
            </Badge>
          ) : null}
        </div>
      </div>

      <div className="space-y-0.5">
        <div
          className={cn(
            "rounded-xl",
            structuredBody && node.kind === "agent_update"
              ? "border border-stone-200/80 bg-stone-50/90 px-2 py-1.5"
              : "px-0 py-0",
          )}
        >
          <p
            className={cn(
              "whitespace-pre-wrap break-words text-sm leading-6 text-stone-700",
              structuredBody && node.kind === "agent_update"
                ? "font-mono text-[12px] leading-5 text-stone-600"
                : "tracking-[-0.01em]",
              node.kind === "task_sent" && "text-[15px] leading-6 text-stone-800",
            )}
          >
            {collapsible && !expanded ? collapsedPreview : bodyText}
          </p>
        </div>
        {collapsible ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-auto w-fit px-0 py-0 text-[10px] font-semibold uppercase tracking-[0.08em] text-stone-400 hover:bg-transparent hover:text-stone-700"
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? "Show less" : "Show more"}
          </Button>
        ) : null}
      </div>
    </article>
  );
}
