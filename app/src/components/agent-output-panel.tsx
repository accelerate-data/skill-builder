import { Fragment, useEffect, useRef, useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Loader2,
  Square,
  CheckCircle2,
  XCircle,
  Clock,
  Cpu,
  FileText,
  Pencil,
  Search,
  Terminal,
  Globe,
  GitBranch,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useAgentStore, type AgentMessage } from "@/stores/agent-store";
import { cancelAgent } from "@/lib/tauri";

function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  }
  return `${secs}s`;
}

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

function TurnMarker({ turn }: { turn: number }) {
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

function MessageItem({ message }: { message: AgentMessage }) {
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
}

export function AgentOutputPanel({ agentId }: { agentId: string }) {
  const run = useAgentStore((s) => s.runs[agentId]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [run?.messages.length, scrollToBottom]);

  // Force re-render every second while running so elapsed time updates
  const [, setTick] = useState(0);
  useEffect(() => {
    if (run?.status !== "running") return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [run?.status]);

  const handleCancel = async () => {
    try {
      await cancelAgent(agentId);
    } catch {
      // Agent may already be finished
    }
  };

  if (!run) {
    return (
      <Card className="flex-1">
        <CardContent className="flex h-full items-center justify-center text-muted-foreground">
          No agent output yet
        </CardContent>
      </Card>
    );
  }

  const elapsed = run.endTime
    ? run.endTime - run.startTime
    : Date.now() - run.startTime;

  const statusIcon = {
    running: <Loader2 className="size-3.5 animate-spin" />,
    completed: <CheckCircle2 className="size-3.5 text-green-500" />,
    error: <XCircle className="size-3.5 text-destructive" />,
    cancelled: <Square className="size-3.5 text-muted-foreground" />,
  }[run.status];

  const statusLabel = {
    running: "Running",
    completed: "Completed",
    error: "Error",
    cancelled: "Cancelled",
  }[run.status];

  // Count turns: each 'assistant' message = one SDK round-trip
  const turnCount = run.messages.filter((m) => m.type === "assistant").length;

  return (
    <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <CardHeader className="shrink-0 flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <Cpu className="size-4" />
          Agent Output
        </CardTitle>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="gap-1 text-xs">
            {statusIcon}
            {statusLabel}
          </Badge>
          <Badge variant="secondary" className="text-xs">
            {run.model}
          </Badge>
          <Badge variant="secondary" className="gap-1 text-xs">
            <Clock className="size-3" />
            {formatElapsed(elapsed)}
          </Badge>
          {turnCount > 0 && (
            <Badge variant="secondary" className="text-xs">
              Turn {turnCount}
            </Badge>
          )}
          {run.tokenUsage && (
            <Badge variant="secondary" className="text-xs">
              {(run.tokenUsage.input + run.tokenUsage.output).toLocaleString()} tokens
            </Badge>
          )}
          {run.totalCost !== undefined && (
            <Badge variant="secondary" className="text-xs">
              ${run.totalCost.toFixed(4)}
            </Badge>
          )}
          {run.status === "running" && (
            <Button
              variant="destructive"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={handleCancel}
            >
              <Square className="size-3" />
              Cancel
            </Button>
          )}
        </div>
      </CardHeader>
      <Separator />
      <ScrollArea className="min-h-0 flex-1">
        <div ref={scrollRef} className="flex flex-col gap-2 p-4">
          {run.messages.map((msg, i) => {
            // Insert a turn marker before each assistant message
            let turn = 0;
            if (msg.type === "assistant") {
              turn = run.messages.slice(0, i + 1).filter((m) => m.type === "assistant").length;
            }
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
