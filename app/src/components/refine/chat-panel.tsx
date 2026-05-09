import { useCallback } from "react";
import { AlertTriangle, CircleSlash } from "lucide-react";
import { useRefineStore } from "@/stores/refine-store";
import type { RefineMessage, RefineQuestionResponse } from "@/stores/refine-store";
import { ChatMessageList } from "./chat-message-list";
import { ChatInputBar } from "./chat-input-bar";

interface ChatPanelProps {
  onSend: (text: string, targetFiles?: string[]) => void;
  hasSkill: boolean;
  availableFiles: string[];
  availableAgents: string[];
  scopeBlocked?: boolean;
  onQuestionSubmit?: (message: RefineMessage, response: RefineQuestionResponse) => Promise<void>;
}

export function ChatPanel({
  onSend,
  hasSkill,
  availableFiles,
  availableAgents,
  scopeBlocked,
  onQuestionSubmit,
}: ChatPanelProps) {
  const messages = useRefineStore((s) => s.messages);
  const sessionExhausted = useRefineStore((s) => s.sessionExhausted);
  const pendingInitialMessage = useRefineStore((s) => s.pendingInitialMessage);
  const waitingForQuestion = messages.some((message) => message.role === "question" && message.pending);

  const handleSuggestionClick = useCallback((text: string) => {
    useRefineStore.getState().setPendingInitialMessage(text);
  }, []);

  if (!hasSkill) {
    return (
      <div data-testid="refine-no-skill" className="flex h-full items-center justify-center text-muted-foreground">
        Select a skill to start refining
      </div>
    );
  }

  const isBlocked = sessionExhausted || !!scopeBlocked;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border/50 px-3 py-1.5">
        <span className="text-xs font-semibold text-muted-foreground">Refine</span>
      </div>
      {scopeBlocked && (
        <div className="flex items-center gap-2 border-b bg-amber-500/10 px-3 py-2 text-sm text-amber-600 dark:text-amber-400">
          <AlertTriangle className="size-4 shrink-0" />
          Scope recommendation active — the skill scope is too broad. Refine and test are blocked until the scope is resolved.
        </div>
      )}
      <ChatMessageList
        messages={messages}
        onQuestionSubmit={onQuestionSubmit}
        onSuggestionClick={handleSuggestionClick}
      />
      {sessionExhausted && (
        <div className="flex items-center justify-center gap-2 border-t bg-muted px-3 py-2 text-sm text-muted-foreground">
          <CircleSlash className="size-3.5 shrink-0" />
          This refine session has reached its limit. Select the skill again to start a new session.
        </div>
      )}
      <ChatInputBar
        onSend={onSend}
        waitingForQuestion={waitingForQuestion}
        availableFiles={availableFiles}
        availableAgents={availableAgents}
        prefilledValue={pendingInitialMessage ?? undefined}
        disabled={isBlocked}
      />
    </div>
  );
}
