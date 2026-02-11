import { Fragment, memo, useEffect, useMemo, useRef, useCallback, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  FileText,
  Pencil,
  Search,
  Terminal,
  Globe,
  GitBranch,
  ChevronRight,
  ChevronDown,
  MessageCircleQuestion,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  useAgentStore,
  type AgentMessage,
} from "@/stores/agent-store";
import { AgentStatusHeader } from "@/components/agent-status-header";
import { ErrorBoundary } from "@/components/error-boundary";
import { parseAgentResponseType } from "@/lib/reasoning-parser";

function getToolIcon(toolName: string) {
  switch (toolName) {
    case "Read":
      return <FileText className="size-3.5" />;
    case "Write":
    case "Edit":
    case "NotebookEdit":
      return <Pencil className="size-3.5" />;
    case "Grep":
    case "Glob":
    case "Search":
      return <Search className="size-3.5" />;
    case "WebSearch":
    case "WebFetch":
      return <Globe className="size-3.5" />;
    case "Task":
      return <GitBranch className="size-3.5" />;
    default:
      return <Terminal className="size-3.5" />;
  }
}

function isToolUseMessage(message: AgentMessage): boolean {
  const raw = message.raw;
  if (message.type !== "assistant") return false;
  const msgContent = (raw as Record<string, unknown>).message as
    | { content?: Array<{ type: string }> }
    | undefined;
  return msgContent?.content?.some((b) => b.type === "tool_use") ?? false;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "..." : s;
}

interface ToolSummaryResult {
  toolName: string;
  summary: string;
}

function getToolSummary(message: AgentMessage): ToolSummaryResult | null {
  const raw = message.raw;
  const msgContent = (raw as Record<string, unknown>).message as
    | { content?: Array<{ type: string; name?: string; input?: Record<string, unknown> }> }
    | undefined;
  const toolBlock = msgContent?.content?.find((b) => b.type === "tool_use");
  if (!toolBlock?.name) return null;

  const name = toolBlock.name;
  const input = toolBlock.input;

  const result = (summary: string): ToolSummaryResult => ({ toolName: name, summary });

  if (name === "Read" && input?.file_path) {
    const path = String(input.file_path).split("/").pop();
    return result(`Reading ${path}`);
  }
  if (name === "Write" && input?.file_path) {
    const path = String(input.file_path).split("/").pop();
    return result(`Writing ${path}`);
  }
  if (name === "Edit" && input?.file_path) {
    const path = String(input.file_path).split("/").pop();
    return result(`Editing ${path}`);
  }
  if (name === "Bash" && input?.command) {
    return result(`Running: ${truncate(String(input.command), 80)}`);
  }
  if (name === "Grep" && input?.pattern) {
    const pattern = truncate(String(input.pattern), 40);
    const path = input.path ? ` in ${String(input.path).split("/").pop()}` : "";
    return result(`Grep: "${pattern}"${path}`);
  }
  if (name === "Glob" && input?.pattern) {
    return result(`Glob: ${truncate(String(input.pattern), 50)}`);
  }
  if (name === "WebSearch" && input?.query) {
    return result(`Web search: "${truncate(String(input.query), 60)}"`);
  }
  if (name === "WebFetch" && input?.url) {
    return result(`Fetching: ${truncate(String(input.url), 70)}`);
  }
  if (name === "Task" && input?.description) {
    return result(`Sub-agent: ${truncate(String(input.description), 60)}`);
  }
  if (name === "NotebookEdit" && input?.notebook_path) {
    const path = String(input.notebook_path).split("/").pop();
    return result(`Editing notebook ${path}`);
  }
  if (name === "LS" && input?.path) {
    return result(`Listing ${truncate(String(input.path), 50)}`);
  }

  // Fallback: show tool name with first string input value for context
  if (input) {
    for (const val of Object.values(input)) {
      if (typeof val === "string" && val.length > 0) {
        return result(`${name}: ${truncate(val, 60)}`);
      }
    }
  }
  return result(name);
}

/**
 * Extract tool input parameters from a message for display in expanded view.
 * Returns a formatted JSON string of the input params, or null if none found.
 */
export function getToolInput(message: AgentMessage): string | null {
  const raw = message.raw;
  const msgContent = (raw as Record<string, unknown>).message as
    | { content?: Array<{ type: string; name?: string; input?: Record<string, unknown> }> }
    | undefined;
  const toolBlock = msgContent?.content?.find((b) => b.type === "tool_use");
  if (!toolBlock?.input) return null;

  const input = toolBlock.input;
  if (Object.keys(input).length === 0) return null;

  const hasContent = Object.values(input).some(val =>
    val !== null && val !== undefined && String(val).trim() !== ""
  );
  if (!hasContent) return null;

  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return null;
  }
}

/**
 * Check if a message ends with a question directed at the user.
 * Looks at the last non-empty line for a trailing question mark.
 */
export function endsWithUserQuestion(text: string): boolean {
  const lastLine = text.trim().split("\n").pop()?.trim() ?? "";
  if (!lastLine.endsWith("?") || lastLine.length <= 5) return false;
  // Require common question words to avoid false positives on rhetorical
  // questions, code examples, and documentation fragments
  const questionWords =
    /\b(should|would|could|do|does|did|can|will|is|are|was|were|have|has|had|shall|may|might|what|where|when|how|why|which|who)\b/i;
  return questionWords.test(lastLine);
}

export type MessageCategory =
  | "agent_response"
  | "tool_call"
  | "question"
  | "result"
  | "error"
  | "config"
  | "status";

export function classifyMessage(message: AgentMessage): MessageCategory {
  if (message.type === "config") return "config";
  if (message.type === "system") return "status";
  if (message.type === "error") return "error";
  if (message.type === "result") return "result";

  if (message.type === "assistant") {
    if (isToolUseMessage(message)) return "tool_call";

    // Detect question/action-required messages
    if (message.content) {
      const responseType = parseAgentResponseType(message.content);
      if (responseType === "follow_up" || responseType === "gate_check") {
        return "question";
      }

      // Detect messages ending with a question directed at the user
      if (endsWithUserQuestion(message.content)) {
        return "question";
      }
    }

    return "agent_response";
  }

  return "status";
}

export const categoryStyles: Record<MessageCategory, string> = {
  agent_response: "pl-3",
  tool_call:
    "border-l-2 border-l-[var(--chat-tool-border)] bg-[var(--chat-tool-bg)] rounded-md px-3 py-1",
  question:
    "border-l-2 border-l-[var(--chat-question-border)] bg-[var(--chat-question-bg)] rounded-md px-3 py-1",
  result:
    "border-l-2 border-l-[var(--chat-result-border)] bg-[var(--chat-result-bg)] rounded-md px-3 py-1",
  error:
    "border-l-2 border-l-[var(--chat-error-border)] bg-[var(--chat-error-bg)] rounded-md px-3 py-1",
  config:
    "border-l-2 border-l-blue-400 bg-blue-50 dark:bg-blue-950/30 rounded-md px-3 py-1",
  status: "",
};

// --- Message grouping ---

export type MessageSpacing = "none" | "group-start" | "continuation";

function isAssistantCategory(category: MessageCategory): boolean {
  return category === "agent_response" || category === "tool_call" || category === "question";
}

/**
 * Compute spacing for each message based on grouping rules:
 * - Consecutive assistant-type messages form a group (tight spacing)
 * - Turn markers and sender-type changes break groups (full spacing)
 * - Status messages are hidden and get "none"
 * - The very first visible message gets "none" (no top margin)
 */
export function computeMessageGroups(
  messages: AgentMessage[],
  turnMap: Map<number, number>,
): MessageSpacing[] {
  const result: MessageSpacing[] = [];
  let prevVisibleCategory: MessageCategory | null = null;

  for (let i = 0; i < messages.length; i++) {
    const hasTurnMarker = (turnMap.get(i) ?? 0) > 0;
    const category = classifyMessage(messages[i]);

    // Status messages are hidden (MessageItem returns null)
    if (category === "status") {
      result.push("none");
      continue;
    }

    if (prevVisibleCategory === null) {
      // Very first visible message — no spacing needed
      result.push("none");
    } else if (hasTurnMarker || !(isAssistantCategory(category) && isAssistantCategory(prevVisibleCategory))) {
      // New group: turn marker present, or different sender type
      result.push("group-start");
    } else {
      // Same sender type, no turn marker — continuation
      result.push("continuation");
    }

    prevVisibleCategory = category;
  }

  return result;
}

export const spacingClasses: Record<MessageSpacing, string> = {
  none: "",
  "group-start": "mt-3",
  continuation: "mt-0.5",
};

// --- Tool call grouping ---

/**
 * Find consecutive runs of 2+ tool_call messages and group them.
 * Returns a map from group leader index to all member indices,
 * and a reverse map from each member to its leader.
 */
export function computeToolCallGroups(
  messages: AgentMessage[],
): { groups: Map<number, number[]>; memberOf: Map<number, number> } {
  const groups = new Map<number, number[]>();
  const memberOf = new Map<number, number>();
  let currentGroup: number[] = [];

  const flushGroup = () => {
    if (currentGroup.length >= 2) {
      const leader = currentGroup[0];
      groups.set(leader, [...currentGroup]);
      for (const idx of currentGroup) {
        memberOf.set(idx, leader);
      }
    }
    currentGroup = [];
  };

  for (let i = 0; i < messages.length; i++) {
    if (classifyMessage(messages[i]) === "tool_call") {
      currentGroup.push(i);
    } else {
      flushGroup();
    }
  }
  flushGroup();

  return { groups, memberOf };
}

// --- Components ---

export function TurnMarker({ turn }: { turn: number }) {
  return (
    <div className="flex items-center gap-2 mt-2">
      <Badge variant="secondary" className="text-[11px] font-medium px-1.5 py-0 h-5 shrink-0">
        Turn {turn}
      </Badge>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}

export function CollapsibleToolCall({ message }: { message: AgentMessage }) {
  const tool = getToolSummary(message);
  if (!tool) return null;

  const toolInput = getToolInput(message);
  const [expanded, setExpanded] = useState(false);

  // No expand affordance when there's no tool input to show
  if (!toolInput) {
    return (
      <div
        data-testid="collapsible-tool-call"
        className="flex items-center gap-2 text-xs text-muted-foreground"
      >
        {getToolIcon(tool.toolName)}
        <span className="truncate">{tool.summary}</span>
      </div>
    );
  }

  return (
    <div data-testid="collapsible-tool-call">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        aria-label={`${tool.summary} — ${expanded ? "collapse" : "expand"}`}
        className="flex w-full items-center gap-2 text-xs text-muted-foreground cursor-pointer transition-colors hover:text-foreground"
      >
        {expanded ? (
          <ChevronDown className="size-3.5 shrink-0" aria-hidden="true" />
        ) : (
          <ChevronRight className="size-3.5 shrink-0" aria-hidden="true" />
        )}
        {getToolIcon(tool.toolName)}
        <span className="truncate">{tool.summary}</span>
      </button>
      <div
        className={`overflow-hidden transition-all duration-200 ease-out ${
          expanded ? "max-h-96 opacity-100" : "max-h-0 opacity-0"
        }`}
        data-testid="collapsible-tool-details"
      >
        <div className="ml-3 mt-1 border-l-2 border-l-[var(--chat-tool-border)] pl-3">
          <pre className="text-xs text-muted-foreground whitespace-pre-wrap break-all">
            {toolInput}
          </pre>
        </div>
      </div>
    </div>
  );
}

export function ToolCallGroup({ messages }: { messages: AgentMessage[] }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div data-testid="tool-call-group">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        aria-label={`${messages.length} tool calls — ${expanded ? "collapse" : "expand"}`}
        className="flex w-full items-center gap-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        {expanded ? (
          <ChevronDown className="size-3.5 shrink-0" aria-hidden="true" />
        ) : (
          <ChevronRight className="size-3.5 shrink-0" aria-hidden="true" />
        )}
        <Terminal className="size-3.5" aria-hidden="true" />
        <span>{messages.length} tool calls</span>
      </button>
      <div
        className={`overflow-hidden transition-all duration-200 ease-out ${
          expanded ? "max-h-[2000px] opacity-100" : "max-h-0 opacity-0"
        }`}
        data-testid="tool-group-details"
      >
        <div className="ml-3 mt-1 flex flex-col gap-0.5 border-l-2 border-l-[var(--chat-tool-border)] pl-3">
          {messages.map((msg, idx) => (
            <CollapsibleToolCall key={`${msg.timestamp}-${idx}`} message={msg} />
          ))}
        </div>
      </div>
    </div>
  );
}

export const MessageItem = memo(function MessageItem({ message }: { message: AgentMessage }) {
  const category = classifyMessage(message);
  const wrapperClass = categoryStyles[category];

  if (category === "status") {
    return null;
  }

  if (category === "config") {
    const raw = message.raw as Record<string, unknown>;
    const config = raw.config as Record<string, unknown> | undefined;
    if (!config) return null;
    const tools = config.allowedTools as string[] | undefined;
    const model = config.model as string | undefined;
    const agentName = config.agentName as string | undefined;
    const discoveredSkills = raw.discoveredSkills as string[] | undefined;
    return (
      <div className={`${wrapperClass} text-xs text-muted-foreground space-y-0.5`}>
        {agentName && <div><span className="font-medium">Agent:</span> {agentName}</div>}
        {model && <div><span className="font-medium">Model:</span> {model}</div>}
        {tools && (
          <div className="flex flex-wrap items-center gap-1">
            <span className="font-medium">Tools:</span>
            {tools.map((t) => (
              <Badge key={t} variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
                {t}
              </Badge>
            ))}
          </div>
        )}
        {discoveredSkills && discoveredSkills.length > 0 && (
          <div className="flex flex-wrap items-center gap-1">
            <span className="font-medium">Skills:</span>
            {discoveredSkills.map((s) => (
              <Badge key={s} variant="outline" className="text-[10px] px-1.5 py-0 h-4 border-blue-400 text-blue-600 dark:text-blue-400">
                {s}
              </Badge>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (category === "error") {
    return (
      <div className={`${wrapperClass} flex items-start gap-2 text-sm text-destructive`}>
        <XCircle className="size-4 shrink-0 mt-0.5" aria-hidden="true" />
        <span>{message.content ?? "Unknown error"}</span>
      </div>
    );
  }

  if (category === "result") {
    return (
      <div className={`${wrapperClass} flex items-start gap-2 text-sm text-green-700 dark:text-green-400`}>
        <CheckCircle2 className="size-4 shrink-0 mt-0.5" aria-hidden="true" />
        <span><span className="font-medium">Result: </span>{message.content ?? "Agent completed"}</span>
      </div>
    );
  }

  if (category === "tool_call") {
    return <CollapsibleToolCall message={message} />;
  }

  if (category === "question") {
    return (
      <div className={wrapperClass}>
        <div className="mb-0.5 flex items-center gap-2">
          <MessageCircleQuestion className="size-4 shrink-0 text-[var(--chat-question-border)]" aria-hidden="true" />
          <Badge className="bg-[var(--chat-question-border)] text-white text-[10px] px-1.5 py-0">
            Needs Response
          </Badge>
        </div>
        <ErrorBoundary fallback={<pre className="whitespace-pre-wrap text-sm">{message.content}</pre>}>
          <div className="markdown-body compact">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {message.content ?? ""}
            </ReactMarkdown>
          </div>
        </ErrorBoundary>
      </div>
    );
  }

  if (category === "agent_response" && message.content) {
    return (
      <ErrorBoundary fallback={<pre className="whitespace-pre-wrap text-sm">{message.content}</pre>}>
        <div className={`${wrapperClass} markdown-body compact`}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {message.content}
          </ReactMarkdown>
        </div>
      </ErrorBoundary>
    );
  }

  return null;
});

interface AgentOutputPanelProps {
  agentId: string;
}

export function AgentOutputPanel({ agentId }: AgentOutputPanelProps) {
  const run = useAgentStore((s) => s.runs[agentId]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [run?.messages.length, scrollToBottom]);

  if (!run) {
    return (
      <Card className="flex-1">
        <CardContent className="flex h-full items-center justify-center text-muted-foreground">
          No agent output yet
        </CardContent>
      </Card>
    );
  }

  // Pre-compute turn numbers in O(n) instead of O(n^2)
  const turnMap = useMemo(() => {
    const map = new Map<number, number>();
    let turn = 0;
    for (let i = 0; i < run.messages.length; i++) {
      if (run.messages[i].type === "assistant") {
        turn++;
        map.set(i, turn);
      }
    }
    return map;
  }, [run.messages]);

  const messageGroups = useMemo(
    () => computeMessageGroups(run.messages, turnMap),
    [run.messages, turnMap],
  );

  const toolCallGroupMap = useMemo(
    () => computeToolCallGroups(run.messages),
    [run.messages],
  );

  return (
    <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <AgentStatusHeader agentId={agentId} />
      <Separator />
      <ScrollArea className="min-h-0 flex-1">
        <div ref={scrollRef} className="flex flex-col p-3">
          {run.messages.map((msg, i) => {
            const turn = turnMap.get(i) ?? 0;
            const spacing = spacingClasses[messageGroups[i]];

            // Skip group members (rendered by group leader)
            if (toolCallGroupMap.memberOf.has(i) && toolCallGroupMap.memberOf.get(i) !== i) {
              return null;
            }

            const groupIndices = toolCallGroupMap.groups.get(i);
            const content = groupIndices ? (
              <ToolCallGroup messages={groupIndices.map(idx => run.messages[idx])} />
            ) : (
              <MessageItem message={msg} />
            );

            return (
              <Fragment key={`${msg.timestamp}-${i}`}>
                {turn > 0 && <TurnMarker turn={turn} />}
                <div className={`${spacing} animate-message-in`}>
                  {content}
                </div>
              </Fragment>
            );
          })}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>
    </Card>
  );
}
