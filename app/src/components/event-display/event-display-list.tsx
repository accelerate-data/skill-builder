import { useMemo } from "react";
import type { DisplayNode, DisplayNodeMember } from "@/lib/display-types";
import { EventDisplayRow } from "./event-display-row";
import { TaoPanel } from "./tao-panel";
import { MemoizedMarkdown } from "@/components/agent-items/memoized-markdown";

const WINDOW_SIZE = 100;
const TOOL_KINDS = new Set<DisplayNode["kind"]>([
  "activity_trace",
  "tool_batch",
  "file_activity",
  "terminal_activity",
]);

interface EventDisplayListProps {
  nodes: DisplayNode[];
}

export function EventDisplayList({ nodes }: EventDisplayListProps) {
  const hidden = Math.max(0, nodes.length - WINDOW_SIZE);
  const visible = nodes.slice(-WINDOW_SIZE);

  const items = useMemo(() => buildItems(visible), [visible]);

  return (
    <div className="flex flex-col gap-1.5">
      {hidden > 0 && (
        <p className="text-center text-xs text-muted-foreground py-1">
          {hidden} older events hidden
        </p>
      )}
      {items.map(({ node, showDivider, turnNumber }) => (
        <div key={node.id} className="animate-message-in">
          {showDivider && <TurnDivider n={turnNumber} />}
          <NodeRow node={node} />
        </div>
      ))}
    </div>
  );
}

interface ListItem {
  node: DisplayNode;
  showDivider: boolean;
  turnNumber: number;
}

function buildItems(nodes: DisplayNode[]): ListItem[] {
  let turnNumber = 1;
  let lastKind: DisplayNode["kind"] | null = null;
  return nodes.map((node) => {
    const showDivider = node.kind === "task_sent" && lastKind === "agent_update";
    if (showDivider) turnNumber += 1;
    const item: ListItem = { node, showDivider, turnNumber };
    lastKind = node.kind;
    return item;
  });
}

function NodeRow({ node }: { node: DisplayNode }) {
  if (TOOL_KINDS.has(node.kind)) return <ToolRow node={node} />;

  switch (node.kind) {
    case "task_sent":
      return (
        <EventDisplayRow
          bg="var(--chat-question-bg)"
          labelColor="var(--chat-question-border)"
          label="Message"
          summary={node.bodyText ?? ""}
        />
      );

    case "agent_update":
      return (
        <EventDisplayRow
          bg="var(--chat-subagent-bg)"
          labelColor="var(--chat-subagent-border)"
          label="Output"
          summary={truncate(node.bodyText ?? "", 120)}
          status={statusDot(node)}
        >
          <div className="px-3 py-2 prose prose-sm max-w-none">
            <MemoizedMarkdown content={node.bodyText ?? ""} />
          </div>
        </EventDisplayRow>
      );

    case "reasoning": {
      const reasoningBody = node.reasoningText ?? node.thoughtText;
      return (
        <EventDisplayRow
          bg="var(--chat-thinking-bg)"
          labelColor="var(--chat-thinking-border)"
          label="Think"
          summary={node.reasoningText ?? node.thoughtText ?? node.bodyText ?? ""}
          italic
          defaultExpanded={false}
        >
          {reasoningBody && (
            <div className="px-3 py-2 text-xs text-muted-foreground whitespace-pre-wrap">
              {reasoningBody}
            </div>
          )}
        </EventDisplayRow>
      );
    }

    case "runtime_setup":
      return (
        <EventDisplayRow
          bg="var(--muted)"
          labelColor="var(--muted-foreground)"
          label="Runtime setup"
          summary={node.label ?? "System prompt"}
          defaultExpanded={false}
        >
          <div className="px-3 py-2 text-xs text-muted-foreground whitespace-pre-wrap">
            {node.bodyText}
          </div>
        </EventDisplayRow>
      );

    case "lifecycle":
      return (
        <EventDisplayRow
          bg="var(--muted)"
          labelColor="var(--muted-foreground)"
          label="Condensation"
          summary={node.label ?? "Condensation summary"}
        >
          <div className="px-3 py-2 text-xs text-muted-foreground whitespace-pre-wrap">
            {node.bodyText}
          </div>
        </EventDisplayRow>
      );

    case "error":
    case "subagent_error": {
      const errorLabel = node.kind === "error" ? "Error" : "Subagent error";
      return (
        <EventDisplayRow
          bg="var(--chat-error-bg)"
          labelColor="var(--chat-error-border)"
          label={errorLabel}
          summary={node.bodyText ?? node.label ?? "Error"}
          status="error"
        >
          <div className="px-3 py-2 text-xs text-muted-foreground whitespace-pre-wrap">
            {node.bodyText}
          </div>
        </EventDisplayRow>
      );
    }

    case "tool_error":
      return (
        <EventDisplayRow
          bg="var(--chat-error-bg)"
          labelColor="var(--chat-error-border)"
          label="Tool error"
          summary={node.bodyText ?? node.label ?? "Tool error"}
          status="error"
        >
          <TaoPanel
            thought={node.thoughtText ?? node.reasoningText}
            action={node.actionText}
            error={node.bodyText}
          />
        </EventDisplayRow>
      );

    default: {
      const ts = new Date(node.createdAtMs).toLocaleTimeString();
      return (
        <EventDisplayRow
          bg="var(--muted)"
          labelColor="var(--muted-foreground)"
          label="Unknown"
          summary={`${node.label ?? node.kind} · ${ts}`}
        >
          <pre className="px-3 py-2 text-xs text-muted-foreground overflow-x-auto">
            {JSON.stringify(node.rawPayload ?? { kind: node.kind }, null, 2)}
          </pre>
        </EventDisplayRow>
      );
    }
  }
}

function ToolRow({ node }: { node: DisplayNode }) {
  const members = node.members ?? [];
  const toolCount = members.length || 1;
  const label = toolCount === 1 ? "1 tool" : `${toolCount} tools`;

  const summary =
    node.thoughtText ??
    (members.length > 0
      ? members.map((m) => m.toolName ?? m.title).join(" · ")
      : node.actionText ?? "");

  const thought = node.thoughtText ?? node.reasoningText ?? members[0]?.thoughtText;
  const action = buildActionText(node, members);
  const observation = node.observationText ?? buildObservationText(members);
  const error = buildErrorText(members);

  return (
    <EventDisplayRow
      bg="var(--chat-tool-bg)"
      labelColor="var(--chat-tool-border)"
      label={label}
      summary={summary ?? ""}
      status={statusDot(node)}
    >
      <TaoPanel
        thought={thought}
        action={action}
        observation={error ? undefined : observation}
        error={error}
      />
    </EventDisplayRow>
  );
}

function buildActionText(node: DisplayNode, members: DisplayNodeMember[]): string | undefined {
  if (members.length === 0) return node.actionText;
  return members.map((m) => m.actionText ?? m.title).join("\n");
}

function buildObservationText(members: DisplayNodeMember[]): string | undefined {
  const parts = members.map((m) => m.observationText).filter(Boolean);
  return parts.length > 0 ? parts.join("\n---\n") : undefined;
}

function buildErrorText(members: DisplayNodeMember[]): string | undefined {
  const parts = members.map((m) => m.errorText).filter(Boolean);
  return parts.length > 0 ? parts.join("\n") : undefined;
}

function statusDot(node: DisplayNode): "running" | "done" | "error" | undefined {
  if (node.status === "failed") return "error";
  if (node.status === "observed") return "done";
  if (node.status === "accepted" || node.status === "sending") return "running";
  return undefined;
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}…`;
}

function TurnDivider({ n }: { n: number }) {
  return (
    <div
      data-testid="turn-divider"
      className="flex items-center gap-2 my-1 opacity-45"
    >
      <div className="flex-1 h-px bg-border" />
      <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium">
        Turn {n}
      </span>
      <div className="flex-1 h-px bg-border" />
    </div>
  );
}
