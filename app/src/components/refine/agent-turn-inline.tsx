import { memo, useEffect, useState } from "react";
import { Loader2, StopCircle } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useAgentStore } from "@/stores/agent-store";
import { DisplayItemList } from "@/components/agent-items/display-item-list";

interface AgentTurnInlineProps {
  agentId: string;
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

export const AgentTurnInline = memo(function AgentTurnInline({ agentId }: AgentTurnInlineProps) {
  const { displayItems, status } = useAgentStore(
    useShallow((s) => ({
      displayItems: s.runs[agentId]?.displayItems,
      status: s.runs[agentId]?.status,
    })),
  );

  if (!displayItems) return null;

  // Typing indicator while agent is running with no output yet
  if (status === "running" && displayItems.length === 0) {
    return <ThinkingIndicator agentId={agentId} />;
  }

  return (
    <div data-agent-id={agentId} className="flex min-w-0 w-full flex-col gap-2 overflow-hidden">
      <DisplayItemList items={displayItems} />
      {status === "running" && displayItems.length > 0 && (
        <div className="flex items-center gap-1.5 py-1 text-muted-foreground/80">
          <Loader2 className="size-3 animate-spin" />
        </div>
      )}
      {status === "shutdown" && (
        <div className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-muted-foreground">
          <StopCircle className="size-3.5 shrink-0" />
          Interrupted by user
        </div>
      )}
    </div>
  );
});
