import { useEffect, useRef } from "react";
import { FileText, MessageSquare } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { normalizeDiffPath } from "@/lib/path-utils";
import { useAgentStore } from "@/stores/agent-store";
import { useRefineStore } from "@/stores/refine-store";
import type { RefineMessage, RefineQuestionResponse } from "@/stores/refine-store";
import { AgentTurnInline } from "./agent-turn-inline";
import { RefineQuestionInline } from "./refine-question-inline";

/** Static suggestions shown in empty state only. Post-turn suggestions come from the SDK. */
const EMPTY_STATE_SUGGESTIONS = [
  "Validate this skill",
  "Improve the skill",
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
  const questionRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // Scroll to the question card when one exists, otherwise scroll to bottom.
  // Uses ResizeObserver to re-scroll when the agent turn above the question
  // grows with new display items (which pushes the question card down).
  useEffect(() => {
    const scrollToTarget = () => {
      if (questionRef.current) {
        questionRef.current.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
          inline: "nearest",
        });
      } else {
        bottomRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "end",
          inline: "nearest",
        });
      }
    };

    scrollToTarget();

    const el = contentRef.current;
    if (!el || !questionRef.current) return;
    const observer = new ResizeObserver((_entries, _observer) => {
      scrollToTarget();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [messages.length, messages]);

  // Check if the last message is a completed agent turn (show suggestion chips)
  const lastMsg = messages.length > 0 ? messages[messages.length - 1] : undefined;
  const lastAgentId = lastMsg?.role === "agent" ? lastMsg.agentId : undefined;
  const lastAgentStatus = useAgentStore((s) =>
    lastAgentId ? s.runs[lastAgentId]?.status : undefined,
  );
  const promptSuggestion = useAgentStore((s) =>
    lastAgentId ? s.runs[lastAgentId]?.promptSuggestion : undefined,
  );
  const showSuggestion = !isRunning && lastAgentStatus === "completed" && onSuggestionClick && promptSuggestion;

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
            {EMPTY_STATE_SUGGESTIONS.map((text) => (
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
      <div ref={contentRef} className="mx-auto flex min-w-0 w-full max-w-4xl flex-col gap-4 overflow-x-hidden px-4 pb-5 pt-3">
        {messages.map((msg, msgIdx) => {
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
                    <div className="break-words whitespace-pre-wrap text-sm leading-6 text-foreground">
                      {msg.userText}
                    </div>
                  )}
                </div>
              </div>
            );
          }

          if (msg.role === "agent" && msg.agentId) {
            // Check if a question follows this agent turn — if so, split display
            // items so content after the question appears below it.
            const nextQuestion = messages.slice(msgIdx + 1).find(
              (m) => m.role === "question" && m.agentId === msg.agentId && m.displayItemSplitIndex !== undefined,
            );
            const splitAt = nextQuestion?.displayItemSplitIndex;

            const diffFiles = msg.diff
              ? Array.from(new Set(
                  msg.diff.files
                    .map((f) => normalizeDiffPath(f.path))
                    .filter((p) => p === "SKILL.md" || p.startsWith("references/")),
                ))
              : [];
            return (
              <div
                key={msg.id}
                data-testid="refine-agent-turn-block"
                className="flex min-w-0 w-full flex-col gap-2 overflow-hidden"
              >
                <div className="min-w-0 overflow-hidden">
                  <AgentTurnInline agentId={msg.agentId} toIndex={splitAt} />
                </div>
                {diffFiles.length > 0 && <InlineChangedFiles files={diffFiles} />}
              </div>
            );
          }

          if (msg.role === "question" && onQuestionSubmit) {
            return (
              <div key={msg.id} ref={msg.pending ? questionRef : undefined} className="flex flex-col gap-4">
                <RefineQuestionInline
                  message={msg}
                  onSubmit={onQuestionSubmit}
                />
                {msg.agentId && msg.displayItemSplitIndex !== undefined && (
                  <div className="min-w-0 overflow-hidden">
                    <AgentTurnInline agentId={msg.agentId} fromIndex={msg.displayItemSplitIndex} />
                  </div>
                )}
              </div>
            );
          }

          return null;
        })}
        {showSuggestion && (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="xs"
              variant="outline"
              className="text-xs text-muted-foreground"
              onClick={() => onSuggestionClick(promptSuggestion)}
            >
              {promptSuggestion}
            </Button>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  );
}

function InlineChangedFiles({ files }: { files: string[] }) {
  const setActiveFileTab = useRefineStore((s) => s.setActiveFileTab);
  const setSelectedModifiedFile = useRefineStore((s) => s.setSelectedModifiedFile);

  return (
    <div data-testid="refine-modified-files" className="flex items-center gap-3">
      <span className="shrink-0 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        Changed
      </span>
      <div className="flex flex-wrap gap-1.5">
        {files.map((filename) => (
          <Button
            key={filename}
            type="button"
            size="xs"
            variant="outline"
            className="max-w-full justify-start rounded-full bg-background/80"
            data-testid={`refine-modified-file-pill-${filename}`}
            onClick={() => {
              setActiveFileTab(filename);
              setSelectedModifiedFile(filename);
            }}
          >
            <FileText className="size-3" />
            <span className="truncate">{filename}</span>
          </Button>
        ))}
      </div>
    </div>
  );
}
