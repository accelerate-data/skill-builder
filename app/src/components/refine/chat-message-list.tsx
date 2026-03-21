import { useEffect, useRef } from "react";
import { MessageSquare } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { RefineMessage, RefineQuestionResponse } from "@/stores/refine-store";
import { AgentTurnInline } from "./agent-turn-inline";
import { BenchmarkPromptInline } from "./benchmark-prompt-inline";
import { RefineQuestionInline } from "./refine-question-inline";

interface ChatMessageListProps {
  messages: RefineMessage[];
  onBenchmarkConfirm?: () => void;
  onBenchmarkSkip?: () => void;
  onQuestionSubmit?: (message: RefineMessage, response: RefineQuestionResponse) => Promise<void>;
}

export function ChatMessageList({
  messages,
  onBenchmarkConfirm,
  onBenchmarkSkip,
  onQuestionSubmit,
}: ChatMessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "end",
      inline: "nearest",
    });
  }, [messages.length]);

  if (messages.length === 0) {
    return (
      <div data-testid="refine-chat-empty" className="flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
        <MessageSquare className="size-6 text-muted-foreground/40" />
        <div className="space-y-1.5">
          <p className="text-sm text-muted-foreground">Describe a change and the agent will update your skill files.</p>
          <p className="text-xs text-muted-foreground/70">Use commands to validate or benchmark, and @ to target specific files.</p>
        </div>
        <div className="flex flex-wrap justify-center gap-2 text-xs text-muted-foreground">
          <span className="rounded-md border px-2 py-1 font-mono">/validate</span>
          <span className="rounded-md border px-2 py-1 font-mono">/benchmark</span>
          <span className="rounded-md border px-2 py-1 font-mono">@SKILL.md</span>
        </div>
      </div>
    );
  }

  return (
    <ScrollArea className="h-0 flex-1">
      <div className="mx-auto flex min-w-0 w-full max-w-4xl flex-col gap-4 overflow-x-hidden px-4 pb-5 pt-3">
        {messages.map((msg) => {
          if (msg.role === "user") {
            return (
              <div key={msg.id} className="flex w-full flex-col gap-2">
                <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  Request
                </div>
                <div className="rounded-lg border border-border/45 bg-muted/20 px-4 py-3" style={{ borderLeftWidth: 2, borderLeftColor: "var(--color-pacific)" }}>
                  {(msg.command || (msg.targetFiles && msg.targetFiles.length > 0)) && (
                    <div className="mb-2 flex flex-wrap gap-1.5">
                      {msg.command && (
                        <Badge variant="secondary" className="text-xs font-medium">
                          /{msg.command}
                        </Badge>
                      )}
                      {msg.targetFiles?.map((f) => (
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
                  {!msg.userText && msg.command && (
                    <div className="text-sm leading-6 text-muted-foreground">
                      Command-only refine request.
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
                <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  Agent
                </div>
                <div className="min-w-0 overflow-hidden px-1 py-1">
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

          if (msg.role === "benchmark-prompt") {
            return (
              <div key={msg.id} className="w-full">
                <BenchmarkPromptInline
                  onConfirm={onBenchmarkConfirm ?? (() => {})}
                  onSkip={onBenchmarkSkip ?? (() => {})}
                />
              </div>
            );
          }

          return null;
        })}
        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  );
}
