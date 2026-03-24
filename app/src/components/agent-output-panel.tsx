import { useEffect, useRef, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAgentStore } from "@/stores/agent-store";
import { useWorkflowStore } from "@/stores/workflow-store";
import { AgentRunFooter } from "@/components/agent-run-footer";
import { DisplayItemList } from "@/components/agent-items/display-item-list";
import { RefineQuestionInline } from "@/components/refine/refine-question-inline";
import { answerWorkflowStepQuestion } from "@/lib/tauri";
import type { RefineMessage, RefineQuestionResponse } from "@/stores/refine-store";

interface AgentOutputPanelProps {
  agentId: string;
}

export function AgentOutputPanel({ agentId }: AgentOutputPanelProps) {
  const displayItems = useAgentStore((s) => s.runs[agentId]?.displayItems);
  const hasRun = useAgentStore((s) => agentId in s.runs);
  const activeAgentId = useAgentStore((s) => s.activeAgentId);
  const pendingQuestion = useWorkflowStore((s) => s.pendingQuestion);
  const clearPendingQuestion = useWorkflowStore((s) => s.clearPendingQuestion);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Only show the pending question for the currently active workflow step agent
  const stepQuestion = activeAgentId === agentId ? pendingQuestion : null;

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [displayItems?.length, stepQuestion, scrollToBottom]);

  const handleQuestionSubmit = useCallback(async (message: RefineMessage, response: RefineQuestionResponse) => {
    if (!message.toolUseId || !message.questions) return;
    await answerWorkflowStepQuestion(
      agentId,
      message.toolUseId,
      message.questions,
      response.answers as Record<string, unknown>,
    );
    clearPendingQuestion();
  }, [agentId, clearPendingQuestion]);

  if (!hasRun) {
    return (
      <Card className="flex-1">
        <CardContent className="flex h-full items-center justify-center text-muted-foreground">
          No agent output yet
        </CardContent>
      </Card>
    );
  }

  // Build a RefineMessage from the pending question to pass to RefineQuestionInline
  const questionMessage: RefineMessage | null = stepQuestion
    ? {
        id: stepQuestion.toolUseId,
        role: "question",
        agentId,
        toolUseId: stepQuestion.toolUseId,
        questions: stepQuestion.questions,
        pending: true,
        timestamp: Date.now(),
      }
    : null;

  return (
    <Card className="flex min-h-0 flex-1 flex-col overflow-hidden py-2 gap-0">
      <ScrollArea className="min-h-0 flex-1">
        <div ref={scrollRef} className="flex flex-col px-4 py-1">
          <DisplayItemList items={displayItems ?? []} />
          {questionMessage && (
            <div className="mt-4">
              <RefineQuestionInline
                message={questionMessage}
                onSubmit={handleQuestionSubmit}
              />
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>
      <AgentRunFooter agentId={agentId} />
    </Card>
  );
}
