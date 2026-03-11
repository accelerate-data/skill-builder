import { useEffect, useRef, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAgentStore } from "@/stores/agent-store";
import { AgentRunFooter } from "@/components/agent-run-footer";
import { DisplayItemList } from "@/components/agent-items/display-item-list";

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
  }, [run?.displayItems?.length, scrollToBottom]);

  if (!run) {
    return (
      <Card className="flex-1">
        <CardContent className="flex h-full items-center justify-center text-muted-foreground">
          No agent output yet
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <ScrollArea className="min-h-0 flex-1">
        <div ref={scrollRef} className="flex flex-col p-3">
          <DisplayItemList items={run.displayItems} />
          <div ref={bottomRef} />
        </div>
      </ScrollArea>
      <AgentRunFooter agentId={agentId} />
    </Card>
  );
}
