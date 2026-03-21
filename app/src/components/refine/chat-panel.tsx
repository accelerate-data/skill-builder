import { AlertTriangle, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRefineStore } from "@/stores/refine-store";
import type { RefineCommand } from "@/stores/refine-store";
import { ChatMessageList } from "./chat-message-list";
import { ChatInputBar } from "./chat-input-bar";

function normalizeDiffPath(path: string): string {
  const parts = path.split("/");
  return parts.length > 1 ? parts.slice(1).join("/") : path;
}

interface ChatPanelProps {
  onSend: (text: string, targetFiles?: string[], command?: RefineCommand) => void;
  isRunning: boolean;
  hasSkill: boolean;
  availableFiles: string[];
  scopeBlocked?: boolean;
  onBenchmarkConfirm?: () => void;
  onBenchmarkSkip?: () => void;
}

export function ChatPanel({ onSend, isRunning, hasSkill, availableFiles, scopeBlocked, onBenchmarkConfirm, onBenchmarkSkip }: ChatPanelProps) {
  const messages = useRefineStore((s) => s.messages);
  const sessionExhausted = useRefineStore((s) => s.sessionExhausted);
  const pendingInitialMessage = useRefineStore((s) => s.pendingInitialMessage);
  const gitDiff = useRefineStore((s) => s.gitDiff);
  const setActiveFileTab = useRefineStore((s) => s.setActiveFileTab);
  const setSelectedModifiedFile = useRefineStore((s) => s.setSelectedModifiedFile);

  const modifiedFiles = Array.from(new Set(
    (gitDiff?.files ?? [])
      .map((file) => normalizeDiffPath(file.path))
      .filter((path) => path === "SKILL.md" || path.startsWith("references/")),
  ));

  if (!hasSkill) {
    return (
      <div data-testid="refine-no-skill" className="flex h-full items-center justify-center text-muted-foreground">
        Select a skill to start refining
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {scopeBlocked && (
        <div className="flex items-center gap-2 border-b bg-amber-500/10 px-3 py-2 text-sm text-amber-600 dark:text-amber-400">
          <AlertTriangle className="size-4 shrink-0" />
          Scope recommendation active — the skill scope is too broad. Refine and test are blocked until the scope is resolved.
        </div>
      )}
      {modifiedFiles.length > 0 && (
        <div className="border-b px-4 py-3">
          <div data-testid="refine-modified-files" className="mx-auto max-w-4xl rounded-lg border bg-card/50 px-4 py-3">
            <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              Changed in this run
            </div>
            <div className="mb-3 text-sm text-muted-foreground">
              Open a file to inspect the final preview or git diff without leaving the conversation.
            </div>
            <div className="flex flex-wrap gap-2">
              {modifiedFiles.map((filename) => (
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
        </div>
      )}
      <ChatMessageList
        messages={messages}
        onBenchmarkConfirm={onBenchmarkConfirm}
        onBenchmarkSkip={onBenchmarkSkip}
      />
      {sessionExhausted && (
        <div className="border-t bg-muted px-3 py-2 text-center text-sm text-muted-foreground">
          This refine session has reached its limit. Select the skill again to start a new session.
        </div>
      )}
      <ChatInputBar
        onSend={onSend}
        isRunning={isRunning || sessionExhausted || !!scopeBlocked}
        availableFiles={availableFiles}
        prefilledValue={pendingInitialMessage ?? undefined}
      />
    </div>
  );
}
