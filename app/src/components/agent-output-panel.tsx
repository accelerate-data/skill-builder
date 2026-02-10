import { Fragment, memo, useEffect, useMemo, useRef, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  FileText,
  Pencil,
  Search,
  Terminal,
  Globe,
  GitBranch,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  useAgentStore,
  type AgentMessage,
} from "@/stores/agent-store";
import { AgentStatusHeader } from "@/components/agent-status-header";

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

export function TurnMarker({ turn }: { turn: number }) {
  return (
    <div className="flex items-center gap-2 py-1">
      <div className="h-px flex-1 bg-border" />
      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        Turn {turn}
      </span>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}

export const MessageItem = memo(function MessageItem({ message }: { message: AgentMessage }) {
  if (message.type === "system") {
    return null;
  }

  if (message.type === "error") {
    return (
      <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
        {message.content ?? "Unknown error"}
      </div>
    );
  }

  if (message.type === "result") {
    return (
      <div className="rounded-md border border-green-500/30 bg-green-500/10 px-3 py-2 text-sm text-green-700 dark:text-green-400">
        <span className="font-medium">Result: </span>
        {message.content ?? "Agent completed"}
      </div>
    );
  }

  if (message.type === "assistant") {
    if (isToolUseMessage(message)) {
      const tool = getToolSummary(message);
      if (tool) {
        return (
          <div className="flex items-center gap-2 px-1 py-0.5 text-xs text-muted-foreground">
            {getToolIcon(tool.toolName)}
            <span>{tool.summary}</span>
          </div>
        );
      }
    }

    if (message.content) {
      return (
        <div className="markdown-body max-w-none text-sm">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {message.content}
          </ReactMarkdown>
        </div>
      );
    }
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

  return (
    <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <AgentStatusHeader agentId={agentId} />
      <Separator />
      <ScrollArea className="min-h-0 flex-1">
        <div ref={scrollRef} className="flex flex-col gap-2 p-4">
          {run.messages.map((msg, i) => {
            const turn = turnMap.get(i) ?? 0;
            return (
              <Fragment key={i}>
                {turn > 0 && <TurnMarker turn={turn} />}
                <MessageItem message={msg} />
              </Fragment>
            );
          })}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>
    </Card>
  );
}
