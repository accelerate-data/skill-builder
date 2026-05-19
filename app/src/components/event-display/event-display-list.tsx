import { useMemo, type ReactNode } from "react";
import {
  AlertCircle,
  Bot,
  Brain,
  FileEdit,
  Layers,
  MessageSquare,
  RefreshCw,
  Settings,
  Sparkles,
  Terminal,
  User,
  Wrench,
} from "lucide-react";
import type { DisplayNode, DisplayNodeMember } from "@/lib/display-types";
import { EventDisplayRow } from "./event-display-row";
import { TaoPanel } from "./tao-panel";
import { MemoizedMarkdown } from "@/components/agent-items/memoized-markdown";

const ICON_CLASS = "size-3.5";

const WINDOW_SIZE = 100;
const TOOL_KINDS = new Set<DisplayNode["kind"]>([
  "tool_batch",
  "file_activity",
  "terminal_activity",
  "skill",
  "subagent",
]);
const SUPPRESSED_KINDS = new Set<DisplayNode["kind"]>(["result", "pause"]);

interface EventDisplayListProps {
  nodes: DisplayNode[];
}

export function EventDisplayList({ nodes }: EventDisplayListProps) {
  const visibleNodes = useMemo(
    () => nodes.filter((node) => !SUPPRESSED_KINDS.has(node.kind)),
    [nodes],
  );
  const hidden = Math.max(0, visibleNodes.length - WINDOW_SIZE);
  const items = useMemo(
    () => buildItems(visibleNodes.slice(-WINDOW_SIZE)),
    [visibleNodes],
  );

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
    case "task_sent": {
      const body = node.bodyText ?? "";
      const long = body.length > 120 || body.includes("\n");
      return (
        <EventDisplayRow
          bg="var(--chat-question-bg)"
          labelColor="var(--chat-question-border)"
          icon={<User className={ICON_CLASS} />}
          label="Message"
          summary={long ? truncate(body, 120) : body}
          defaultExpanded={false}
        >
          {long && (
            <div className="px-3 py-2 text-xs text-foreground whitespace-pre-wrap break-words">
              {body}
            </div>
          )}
        </EventDisplayRow>
      );
    }

    case "agent_update":
      return (
        <EventDisplayRow
          bg="var(--chat-subagent-bg)"
          labelColor="var(--chat-subagent-border)"
          icon={<MessageSquare className={ICON_CLASS} />}
          label="Output"
          summary={truncate(node.bodyText ?? "", 120)}
          status={statusDot(node)}
        >
          <OutputBody content={node.bodyText ?? ""} />
        </EventDisplayRow>
      );

    case "reasoning": {
      const reasoningBody = node.reasoningText ?? node.thoughtText;
      return (
        <EventDisplayRow
          bg="var(--chat-thinking-bg)"
          labelColor="var(--chat-thinking-border)"
          icon={<Brain className={ICON_CLASS} />}
          label="Think"
          summary={node.reasoningText ?? node.thoughtText ?? node.bodyText ?? ""}
          italic
          defaultExpanded={false}
        >
          {reasoningBody && (
            <div className="px-3 py-2 text-xs text-muted-foreground whitespace-pre-wrap break-words">
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
          icon={<Settings className={ICON_CLASS} />}
          label="Runtime setup"
          summary={node.label ?? "System prompt"}
          defaultExpanded={false}
        >
          <div className="px-3 py-2 text-xs text-muted-foreground whitespace-pre-wrap break-words">
            {node.bodyText}
          </div>
        </EventDisplayRow>
      );

    case "lifecycle":
      return (
        <EventDisplayRow
          bg="var(--muted)"
          labelColor="var(--muted-foreground)"
          icon={<RefreshCw className={ICON_CLASS} />}
          label="Condensation"
          summary={node.label ?? "Condensation summary"}
        >
          <div className="px-3 py-2 text-xs text-muted-foreground whitespace-pre-wrap break-words">
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
          icon={<AlertCircle className={ICON_CLASS} />}
          label={errorLabel}
          summary={node.bodyText ?? node.label ?? "Error"}
          status="error"
        >
          <div className="px-3 py-2 text-xs text-muted-foreground whitespace-pre-wrap break-words">
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
          icon={<AlertCircle className={ICON_CLASS} />}
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
          <pre className="px-3 py-2 text-xs font-mono text-muted-foreground overflow-x-auto">
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
  const isParallel = toolCount > 1;
  const label = toolCount === 1 ? "1 tool" : `${toolCount} tools`;

  const summary =
    node.thoughtText ??
    (members.length > 0
      ? members.map((m) => m.toolName ?? m.title).join(" · ")
      : node.actionText ?? node.label ?? "");

  const observationRaw = node.observationText ?? buildObservationText(members);
  const error = buildErrorText(members);

  return (
    <EventDisplayRow
      bg="var(--chat-tool-bg)"
      labelColor="var(--chat-tool-border)"
      icon={toolIcon(node, members, isParallel)}
      label={label}
      summary={summary ?? ""}
      status={statusDot(node)}
      defaultExpanded={false}
    >
      <TaoPanel
        thought={node.thoughtText ?? node.reasoningText ?? members[0]?.thoughtText}
        action={buildActionText(node, members)}
        observation={error ? undefined : maybeFormatJson(observationRaw)}
        error={error}
      />
    </EventDisplayRow>
  );
}

function maybeFormatJson(text: string | undefined): string | undefined {
  if (!text) return text;
  return tryFormatJson(text) ?? text;
}

function OutputBody({ content }: { content: string }) {
  const json = tryFormatJson(content);
  if (json) {
    return (
      <pre className="px-3 py-2 max-h-96 text-xs font-mono text-foreground whitespace-pre-wrap break-words overflow-auto">
        {json}
      </pre>
    );
  }
  return (
    <div className="px-3 py-2 text-xs leading-relaxed text-foreground font-sans break-words">
      <MemoizedMarkdown content={content} />
    </div>
  );
}

function tryFormatJson(text: string): string | null {
  const candidate = extractJsonCandidate(text);
  if (!candidate) return null;
  try {
    return JSON.stringify(JSON.parse(candidate), null, 2);
  } catch {
    return null;
  }
}

function extractJsonCandidate(text: string): string | null {
  let trimmed = text.trim();
  if (!trimmed) return null;

  // Strip ```json ... ``` or ``` ... ``` fences
  const fenceMatch = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i);
  if (fenceMatch) {
    trimmed = fenceMatch[1].trim();
  }

  if (!trimmed) return null;
  const first = trimmed[0];
  if (first !== "{" && first !== "[") return null;
  const open = first;
  const close = open === "{" ? "}" : "]";

  // Find the balanced closing brace/bracket, respecting strings.
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = 0; i < trimmed.length; i += 1) {
    const ch = trimmed[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (inString) {
      if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) return trimmed.slice(0, i + 1);
    }
  }
  return null;
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

function toolIcon(
  node: DisplayNode,
  members: DisplayNodeMember[],
  isParallel: boolean,
): ReactNode {
  if (isParallel) return <Layers className={ICON_CLASS} />;
  switch (node.kind) {
    case "file_activity":
      return <FileEdit className={ICON_CLASS} />;
    case "terminal_activity":
      return <Terminal className={ICON_CLASS} />;
    case "skill":
      return <Sparkles className={ICON_CLASS} />;
    case "subagent":
      return <Bot className={ICON_CLASS} />;
    default:
      return iconForToolName(members[0]?.toolName);
  }
}

function iconForToolName(name: string | undefined): ReactNode {
  if (!name) return <Wrench className={ICON_CLASS} />;
  const lower = name.toLowerCase();
  if (lower.includes("file") || lower.includes("edit") || lower.includes("read") || lower.includes("write")) {
    return <FileEdit className={ICON_CLASS} />;
  }
  if (lower.includes("terminal") || lower.includes("bash") || lower.includes("shell") || lower.includes("exec")) {
    return <Terminal className={ICON_CLASS} />;
  }
  if (lower.includes("skill")) return <Sparkles className={ICON_CLASS} />;
  if (lower.includes("task") || lower.includes("subagent") || lower.includes("agent")) {
    return <Bot className={ICON_CLASS} />;
  }
  return <Wrench className={ICON_CLASS} />;
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
