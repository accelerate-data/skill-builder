import { useMemo } from "react";
import { Loader2 } from "lucide-react";
import { useAgentStore } from "@/stores/agent-store";
import { DisplayItemList } from "@/components/agent-items/display-item-list";
import {
  computeMessageGroups,
  computeToolCallGroups,
  spacingClasses,
  ToolCallGroup,
  MessageItem,
} from "@/components/agent-output-panel";

const EMPTY_TOOL_GROUPS = { groups: new Map<number, number[]>(), memberOf: new Map<number, number>() };

interface AgentTurnInlineProps {
  agentId: string;
}

function formatCost(cost: number): string {
  return `$${cost.toFixed(4)}`;
}

export function AgentTurnInline({ agentId }: AgentTurnInlineProps) {
  const run = useAgentStore((s) => s.runs[agentId]);

  const hasDisplayItems = (run?.displayItems?.length ?? 0) > 0;

  // --- Legacy message-based rendering helpers ---
  const turnMap = useMemo(() => {
    if (!run || hasDisplayItems) return new Map<number, number>();
    const map = new Map<number, number>();
    let turn = 0;
    for (let i = 0; i < run.messages.length; i++) {
      if (run.messages[i].type === "assistant") {
        turn++;
        map.set(i, turn);
      }
    }
    return map;
  }, [run?.messages, hasDisplayItems]);

  const messageGroups = useMemo(
    () => (run && !hasDisplayItems ? computeMessageGroups(run.messages, turnMap) : []),
    [run?.messages, turnMap, hasDisplayItems],
  );

  const toolCallGroupMap = useMemo(
    () => (run && !hasDisplayItems ? computeToolCallGroups(run.messages) : EMPTY_TOOL_GROUPS),
    [run?.messages, hasDisplayItems],
  );

  if (!run) return null;

  // Typing indicator while agent is running with no output yet
  const noOutput = run.messages.length === 0 && run.displayItems.length === 0;
  if (run.status === "running" && noOutput) {
    return (
      <div data-testid="refine-agent-thinking" data-agent-id={agentId} className="flex items-center gap-1.5 py-2 text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        <span className="text-sm">Thinking...</span>
      </div>
    );
  }

  // --- DisplayItem-based rendering (new path) ---
  if (hasDisplayItems) {
    return (
      <div data-agent-id={agentId} className="flex min-w-0 flex-col">
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

  // --- Legacy message-based rendering (backward compat) ---
  return (
    <div data-agent-id={agentId} className="flex min-w-0 flex-col">
      {run.messages.map((msg, i) => {
        // Skip result messages — they duplicate the assistant's final text
        if (msg.type === "result") return null;

        const spacing = spacingClasses[messageGroups[i]];

        // Skip group members (rendered by group leader)
        if (toolCallGroupMap.memberOf.has(i) && toolCallGroupMap.memberOf.get(i) !== i) {
          return null;
        }

        const groupIndices = toolCallGroupMap.groups.get(i);
        const content = groupIndices ? (
          <ToolCallGroup messages={groupIndices.map((idx: number) => run.messages[idx])} />
        ) : (
          <MessageItem message={msg} />
        );

        return (
          <div key={`${msg.timestamp}-${i}`} className={spacing}>{content}</div>
        );
      })}
      {run.status === "running" && run.messages.length > 0 && (
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
