import { memo, useEffect, useState } from "react";
import { Loader2, StopCircle } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useAgentStore } from "@/stores/agent-store";
import { ConversationEventList } from "@/components/agent-items/conversation-event-list";

interface AgentTurnInlineProps {
  agentId: string;
  /** Render only conversation events starting from this index. */
  fromIndex?: number;
  /** Render only conversation events up to (not including) this index. */
  toIndex?: number;
}

function ThinkingIndicator({ agentId }: { agentId: string }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const start = Date.now();
    const timer = setInterval(() => setElapsed(Date.now() - start), 100);
    return () => clearInterval(timer);
  }, []);

  const seconds = Math.floor(elapsed / 1000);

  return (
    <div
      data-testid="refine-agent-thinking"
      data-agent-id={agentId}
      className="flex items-center gap-2 rounded-md px-3 py-2"
      style={{ background: "var(--chat-thinking-bg)" }}
    >
      <Loader2 className="size-3.5 animate-spin" style={{ color: "var(--chat-thinking-border)" }} />
      <span className="text-sm text-muted-foreground">
        Thinking{seconds > 0 ? `... ${seconds}s` : "..."}
      </span>
    </div>
  );
}

export const AgentTurnInline = memo(function AgentTurnInline({
  agentId,
  fromIndex,
  toIndex,
}: AgentTurnInlineProps) {
  const { conversationEvents, status } = useAgentStore(
    useShallow((s) => ({
      conversationEvents: s.runs[agentId]?.conversationEvents,
      status: s.runs[agentId]?.status,
    })),
  );

  if (!conversationEvents) return null;

  const sliced =
    fromIndex !== undefined || toIndex !== undefined
      ? conversationEvents.slice(fromIndex ?? 0, toIndex)
      : conversationEvents;
  const isSliced = fromIndex !== undefined || toIndex !== undefined;
  // Tail slice: fromIndex set, no toIndex — this is the last visible part of the turn
  const isTailSlice = fromIndex !== undefined && toIndex === undefined;

  // Typing indicator while agent is running with no output yet
  if (status === "running" && sliced.length === 0 && !isSliced) {
    return <ThinkingIndicator agentId={agentId} />;
  }

  // Nothing to render for this slice yet
  if (sliced.length === 0) return null;

  return (
    <div data-agent-id={agentId} className="flex min-w-0 w-full flex-col gap-2 overflow-hidden">
      <ConversationEventList events={sliced} />
      {!isSliced && status === "running" && sliced.length > 0 && (
        <div className="flex items-center gap-1.5 py-1 text-muted-foreground/80">
          <Loader2 className="size-3 animate-spin" />
        </div>
      )}
      {isTailSlice && status === "running" && (
        <div className="flex items-center gap-1.5 py-1 text-muted-foreground/80">
          <Loader2 className="size-3 animate-spin" />
        </div>
      )}
      {(!isSliced || isTailSlice) && status === "shutdown" && (
        <div className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-muted-foreground">
          <StopCircle className="size-3.5 shrink-0" />
          Interrupted by user
        </div>
      )}
    </div>
  );
});
