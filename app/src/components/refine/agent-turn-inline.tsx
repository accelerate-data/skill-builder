import { Loader2 } from "lucide-react";
import { useAgentStore } from "@/stores/agent-store";
import { DisplayItemList } from "@/components/agent-items/display-item-list";

interface AgentTurnInlineProps {
  agentId: string;
}

function formatCost(cost: number): string {
  return `$${cost.toFixed(4)}`;
}

export function AgentTurnInline({ agentId }: AgentTurnInlineProps) {
  const run = useAgentStore((s) => s.runs[agentId]);

  if (!run) return null;

  // Typing indicator while agent is running with no output yet
  if (run.status === "running" && run.displayItems.length === 0) {
    return (
      <div data-testid="refine-agent-thinking" data-agent-id={agentId} className="flex items-center gap-1.5 py-2 text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        <span className="text-sm">Thinking...</span>
      </div>
    );
  }

  return (
    <div data-agent-id={agentId} className="flex min-w-0 w-full flex-col overflow-hidden">
      <DisplayItemList items={run.displayItems} />
      {run.status === "running" && run.displayItems.length > 0 && (
        <div className="flex items-center gap-1.5 py-1 text-muted-foreground">
          <Loader2 className="size-3 animate-spin" />
        </div>
      )}
      {run.status !== "running" && run.totalCost !== undefined && (
        <div className="pt-1 text-xs text-muted-foreground/70">
          Cost {formatCost(run.totalCost)}
        </div>
      )}
    </div>
  );
}
