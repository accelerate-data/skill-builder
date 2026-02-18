import { useEffect, useRef } from "react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import type { RefineMessage } from "@/stores/refine-store";
import { AgentTurnInline } from "./agent-turn-inline";

interface ChatMessageListProps {
  messages: RefineMessage[];
}

export function ChatMessageList({ messages }: ChatMessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  if (messages.length === 0) {
    return (
      <div data-testid="refine-chat-empty" className="flex flex-1 items-center justify-center text-muted-foreground">
        Send a message to start refining
      </div>
    );
  }

  return (
    <ScrollArea className="h-0 flex-1">
      <div className="flex min-w-0 flex-col gap-3 p-4">
        {messages.map((msg) => {
          if (msg.role === "user") {
            return (
              <div key={msg.id} className="flex flex-col items-end gap-1">
                {(msg.command || (msg.targetFiles && msg.targetFiles.length > 0)) && (
                  <div className="flex gap-1">
                    {msg.command && (
                      <Badge variant="default" className="text-xs">
                        /{msg.command}
                      </Badge>
                    )}
                    {msg.targetFiles?.map((f) => (
                      <Badge key={f} variant="outline" className="text-xs">
                        {f}
                      </Badge>
                    ))}
                  </div>
                )}
                {msg.userText && (
                  <div className="max-w-[80%] rounded-2xl bg-primary px-4 py-2 text-primary-foreground">
                    {msg.userText}
                  </div>
                )}
              </div>
            );
          }

          if (msg.role === "agent" && msg.agentId) {
            return (
              <div key={msg.id} className="flex flex-col gap-1">
                <Separator />
                <AgentTurnInline agentId={msg.agentId} />
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
