import { useEffect } from "react";
import { useRefineStore } from "@/stores/refine-store";
import type { RefineCommand } from "@/stores/refine-store";
import { ChatMessageList } from "./chat-message-list";
import { ChatInputBar } from "./chat-input-bar";

interface ChatPanelProps {
  onSend: (text: string, targetFiles?: string[], command?: RefineCommand) => void;
  isRunning: boolean;
  hasSkill: boolean;
  availableFiles: string[];
}

export function ChatPanel({ onSend, isRunning, hasSkill, availableFiles }: ChatPanelProps) {
  const messages = useRefineStore((s) => s.messages);
  const sessionExhausted = useRefineStore((s) => s.sessionExhausted);
  const pendingInitialMessage = useRefineStore((s) => s.pendingInitialMessage);

  // Consume pending message once, then clear it from the store
  useEffect(() => {
    if (pendingInitialMessage) {
      useRefineStore.getState().setPendingInitialMessage(null);
    }
  }, [pendingInitialMessage]);

  if (!hasSkill) {
    return (
      <div data-testid="refine-no-skill" className="flex h-full items-center justify-center text-muted-foreground">
        Select a skill to start refining
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <ChatMessageList messages={messages} />
      {sessionExhausted && (
        <div className="border-t bg-muted px-3 py-2 text-center text-sm text-muted-foreground">
          This refine session has reached its limit. Select the skill again to start a new session.
        </div>
      )}
      <ChatInputBar
        onSend={onSend}
        isRunning={isRunning || sessionExhausted}
        availableFiles={availableFiles}
        prefilledValue={pendingInitialMessage ?? undefined}
      />
    </div>
  );
}
