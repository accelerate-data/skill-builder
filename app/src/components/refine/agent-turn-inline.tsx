import { useMemo } from "react";
import { Loader2 } from "lucide-react";
import { useAgentStore } from "@/stores/agent-store";
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

export function AgentTurnInline({ agentId }: AgentTurnInlineProps) {
  const run = useAgentStore((s) => s.runs[agentId]);

  const turnMap = useMemo(() => {
    if (!run) return new Map<number, number>();
    const map = new Map<number, number>();
    let turn = 0;
    for (let i = 0; i < run.messages.length; i++) {
      if (run.messages[i].type === "assistant") {
        turn++;
        map.set(i, turn);
      }
    }
    return map;
  }, [run?.messages]);

  const messageGroups = useMemo(
    () => (run ? computeMessageGroups(run.messages, turnMap) : []),
    [run?.messages, turnMap],
  );

  const toolCallGroupMap = useMemo(
    () => (run ? computeToolCallGroups(run.messages) : EMPTY_TOOL_GROUPS),
    [run?.messages],
  );

  if (!run) return null;

  // Typing indicator while agent is running with no messages yet
  if (run.status === "running" && run.messages.length === 0) {
    return (
      <div data-testid="refine-agent-thinking" data-agent-id={agentId} className="flex items-center gap-1.5 py-2 text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        <span className="text-sm">Thinking...</span>
      </div>
    );
  }

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
    </div>
  );
}
