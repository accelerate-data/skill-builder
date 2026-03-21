import { memo } from "react";
import { Loader2 } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useAgentStore } from "@/stores/agent-store";
import { DisplayItemList } from "@/components/agent-items/display-item-list";

interface AgentTurnInlineProps {
  agentId: string;
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
    return (
      <div data-testid="refine-agent-thinking" data-agent-id={agentId} className="flex items-center gap-1.5 py-2 text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        <span className="text-sm">Thinking...</span>
      </div>
    );
  }

  return (
    <div data-agent-id={agentId} className="flex min-w-0 w-full flex-col gap-2 overflow-hidden">
      <DisplayItemList items={displayItems} />
      {status === "running" && displayItems.length > 0 && (
        <div className="flex items-center gap-1.5 py-1 text-muted-foreground/80">
          <Loader2 className="size-3 animate-spin" />
        </div>
      )}
    </div>
  );
});
