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
  const displayItems = useAgentStore((s) => s.runs[agentId]?.displayItems);
  const hasRun = useAgentStore((s) => agentId in s.runs);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [displayItems?.length, scrollToBottom]);

  if (!hasRun) {
    return (
      <Card className="flex-1">
        <CardContent className="flex h-full items-center justify-center text-muted-foreground">
          No agent output yet
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="flex min-h-0 flex-1 flex-col overflow-hidden py-2 gap-0">
      <ScrollArea className="min-h-0 flex-1">
        <div ref={scrollRef} className="flex flex-col px-4 py-1">
          <DisplayItemList items={displayItems ?? []} />
          <div ref={bottomRef} />
        </div>
      </ScrollArea>
      <AgentRunFooter agentId={agentId} />
    </Card>
  );
}
