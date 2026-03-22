import { useEffect, useRef } from "react";
import { MessageSquare } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAgentStore } from "@/stores/agent-store";
import type { RefineMessage, RefineQuestionResponse } from "@/stores/refine-store";
import { AgentTurnInline } from "./agent-turn-inline";
import { RefineQuestionInline } from "./refine-question-inline";

const SUGGESTIONS = [
  "Fix the issues found above",
  "Validate this skill",
  "Run benchmarks",
];

interface ChatMessageListProps {
  messages: RefineMessage[];
  isRunning: boolean;
  onQuestionSubmit?: (message: RefineMessage, response: RefineQuestionResponse) => Promise<void>;
  onSuggestionClick?: (text: string) => void;
}

export function ChatMessageList({
  messages,
  isRunning,
  onQuestionSubmit,
  onSuggestionClick,
}: ChatMessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "end",
      inline: "nearest",
    });
  }, [messages.length]);

  // Check if the last message is a completed agent turn (show suggestion chips)
  const lastMsg = messages.length > 0 ? messages[messages.length - 1] : undefined;
  const lastAgentId = lastMsg?.role === "agent" ? lastMsg.agentId : undefined;
  const lastAgentStatus = useAgentStore((s) =>
    lastAgentId ? s.runs[lastAgentId]?.status : undefined,
  );
  const showSuggestions = !isRunning && lastAgentStatus === "completed" && onSuggestionClick;

  if (messages.length === 0) {
    return (
      <div data-testid="refine-chat-empty" className="flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
        <MessageSquare className="size-6 text-muted-foreground/40" />
        <div className="space-y-1.5">
          <p className="text-sm text-muted-foreground">Describe a change and the agent will update your skill files.</p>
          <p className="text-xs text-muted-foreground/70">Use @ to target specific files for edits.</p>
        </div>
        {onSuggestionClick && (
          <div className="flex flex-wrap justify-center gap-2">
            {["Validate this skill", "Improve the overview", "Run benchmarks"].map((text) => (
              <Button
                key={text}
                type="button"
                size="xs"
                variant="outline"
                className="text-xs text-muted-foreground"
                onClick={() => onSuggestionClick(text)}
              >
                {text}
              </Button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <ScrollArea className="h-0 flex-1">
      <div className="mx-auto flex min-w-0 w-full max-w-4xl flex-col gap-4 overflow-x-hidden px-4 pb-5 pt-3">
        {messages.map((msg) => {
          if (msg.role === "user") {
            return (
              <div key={msg.id} className="flex w-full justify-end">
                <div
                  className="max-w-[85%] rounded-2xl px-4 py-2.5"
                  style={{
                    background: "color-mix(in oklch, var(--color-pacific), transparent 85%)",
                    borderBottomRightRadius: "4px",
                  }}
                >
                  {(msg.targetFiles && msg.targetFiles.length > 0) && (
                    <div className="mb-1.5 flex flex-wrap gap-1.5">
                      {msg.targetFiles.map((f) => (
                        <Badge key={f} variant="outline" className="max-w-full text-xs">
                          {f}
                        </Badge>
                      ))}
                    </div>
                  )}
                  {msg.userText && (
                    <div className="break-words text-sm leading-6 text-foreground">
                      {msg.userText}
                    </div>
                  )}
                </div>
              </div>
            );
          }

          if (msg.role === "agent" && msg.agentId) {
            return (
              <div
                key={msg.id}
                data-testid="refine-agent-turn-block"
                className="flex min-w-0 w-full flex-col gap-2 overflow-hidden"
              >
                <div className="min-w-0 overflow-hidden">
                  <AgentTurnInline agentId={msg.agentId} />
                </div>
              </div>
            );
          }

          if (msg.role === "question" && onQuestionSubmit) {
            return (
              <RefineQuestionInline
                key={msg.id}
                message={msg}
                onSubmit={onQuestionSubmit}
              />
            );
          }

          return null;
        })}
        {showSuggestions && (
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map((text) => (
              <Button
                key={text}
                type="button"
                size="xs"
                variant="outline"
                className="text-xs text-muted-foreground"
                onClick={() => onSuggestionClick(text)}
              >
                {text}
              </Button>
            ))}
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  );
}
