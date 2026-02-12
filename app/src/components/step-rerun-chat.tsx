import { useState, useRef, useEffect, useCallback, useMemo, useImperativeHandle, forwardRef, Fragment } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Send,
  User,
  Bot,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useAgentStore } from "@/stores/agent-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useWorkflowStore } from "@/stores/workflow-store";
import {
  runWorkflowStep,
  startAgent,
  captureStepArtifacts,
} from "@/lib/tauri";
import { saveChatSession, loadChatSession } from "@/lib/chat-storage";
import { AgentStatusHeader } from "@/components/agent-status-header";
import { MessageItem, TurnMarker, computeMessageGroups, spacingClasses } from "@/components/agent-output-panel";

// --- Types ---

export interface StepRerunChatProps {
  skillName: string;
  domain: string;
  workspacePath: string;
  skillType: string;
  stepId: number;
  stepLabel: string;
  onComplete: () => void;
}

export interface StepRerunChatHandle {
  completeStep: () => Promise<void>;
}

interface ChatMessage {
  role: "agent" | "user";
  content: string;
  agentId?: string;
}

// --- Helpers ---

/** Map step IDs to agent phase names for prompt resolution. */
const STEP_PHASE_MAP: Record<number, string> = {
  0: "research-concepts",
  2: "research-patterns-and-merge",
  5: "build",
  6: "validate",
  7: "test",
};

/** Map step IDs to model shorthands. */
const STEP_MODEL_MAP: Record<number, string> = {
  0: "sonnet",
  2: "sonnet",
  5: "sonnet",
  6: "sonnet",
  7: "sonnet",
};

// --- Component ---

export const StepRerunChat = forwardRef<StepRerunChatHandle, StepRerunChatProps>(function StepRerunChat({
  skillName,
  domain,
  workspacePath,
  skillType,
  stepId,
  stepLabel,
  onComplete,
}, ref) {
  // Core state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [userInput, setUserInput] = useState("");
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [currentAgentId, setCurrentAgentId] = useState<string | null>(null);

  // Session restored flag
  const [restored, setRestored] = useState(false);
  // Track whether initial rerun agent has been launched
  const initialLaunchedRef = useRef(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const processedRunRef = useRef<string | null>(null);

  // Stores
  const currentRun = useAgentStore((s) => currentAgentId ? s.runs[currentAgentId] : null);
  const agentRegisterRun = useAgentStore((s) => s.registerRun);
  const agentTimeout = useSettingsStore((s) => s.agentTimeout);
  const { setRunning } = useWorkflowStore();

  const isAgentRunning = currentRun?.status === "running";
  const model = STEP_MODEL_MAP[stepId] ?? "sonnet";
  const diskStepLabel = `rerun-step-${stepId}`;

  // --- Session persistence ---

  const saveSession = useCallback(
    (msgs: ChatMessage[], sid: string | undefined) => {
      saveChatSession(workspacePath, skillName, diskStepLabel, {
        sessionId: sid ?? "",
        stepId,
        messages: msgs.map((m) => ({
          role: m.role === "agent" ? "assistant" as const : "user" as const,
          content: m.content,
          timestamp: new Date().toISOString(),
          agentId: m.agentId,
        })),
      }).catch(() => {});
    },
    [workspacePath, skillName, diskStepLabel, stepId],
  );

  // Load saved session on mount
  useEffect(() => {
    if (restored) return;
    loadChatSession(workspacePath, skillName, diskStepLabel)
      .then((diskSession) => {
        if (!diskSession || !diskSession.messages?.length) {
          setRestored(true);
          return;
        }
        // Map disk "assistant" role back to internal "agent" role
        const mappedMessages: ChatMessage[] = diskSession.messages.map((m) => ({
          role: m.role === "assistant" ? "agent" as const : "user" as const,
          content: m.content,
          agentId: m.agentId,
        }));
        setMessages(mappedMessages);
        if (diskSession.sessionId) {
          setSessionId(diskSession.sessionId);
        }
        setRestored(true);
      })
      .catch(() => setRestored(true));
  }, [workspacePath, skillName, diskStepLabel, restored]);

  // Auto-launch rerun agent on mount if no existing session
  useEffect(() => {
    if (!restored || initialLaunchedRef.current) return;
    // If there are already messages from a restored session, don't auto-launch
    if (messages.length > 0) return;

    initialLaunchedRef.current = true;
    launchRerunAgent();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restored, messages.length]);

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, currentRun?.messages.length]);

  // Capture session ID as it arrives
  useEffect(() => {
    if (currentRun?.sessionId && !sessionId) {
      setSessionId(currentRun.sessionId);
    }
  }, [currentRun?.sessionId, sessionId]);

  // --- Agent completion handler ---

  const handleAgentTurnComplete = useCallback(() => {
    if (!currentRun || !currentAgentId) return;
    if (currentRun.status !== "completed" && currentRun.status !== "error") return;
    // Prevent re-processing the same run
    if (processedRunRef.current === currentAgentId) return;
    processedRunRef.current = currentAgentId;

    const sid = currentRun.sessionId ?? sessionId;
    if (currentRun.sessionId && !sessionId) {
      setSessionId(currentRun.sessionId);
    }

    if (currentRun.status === "completed") {
      const textParts: string[] = [];
      for (const msg of currentRun.messages) {
        if (msg.type === "assistant" && msg.content) {
          textParts.push(msg.content);
        }
      }
      const agentText = textParts.join("\n\n");

      if (agentText) {
        const newMsg: ChatMessage = { role: "agent", content: agentText, agentId: currentAgentId };
        setMessages((prev) => {
          const updated = [...prev, newMsg];
          saveSession(updated, sid);
          return updated;
        });
      }

      // Capture artifacts after each turn
      captureStepArtifacts(skillName, stepId, workspacePath).catch(() => {});

      setRunning(false);
    } else if (currentRun.status === "error") {
      const errorMsg = currentRun.messages.find((m) => m.type === "error");
      setMessages((prev) => {
        const updated = [
          ...prev,
          {
            role: "agent" as const,
            content: `Error: ${errorMsg?.content ?? "Agent encountered an error"}`,
            agentId: currentAgentId,
          },
        ];
        saveSession(updated, sid);
        return updated;
      });
      setRunning(false);
      toast.error(`Rerun agent encountered an error on step "${stepLabel}"`, { duration: Infinity });
    }
  }, [currentRun?.status, currentAgentId, currentRun, sessionId, saveSession, skillName, stepId, workspacePath, stepLabel, setRunning]);

  useEffect(() => {
    handleAgentTurnComplete();
  }, [handleAgentTurnComplete]);

  // --- Agent launchers ---

  const launchRerunAgent = async () => {
    try {
      setRunning(true);

      // Use runWorkflowStep with rerun: true for the initial launch
      // The backend will prepend [RERUN MODE] to the prompt
      const agentId = await runWorkflowStep(
        skillName,
        stepId,
        domain,
        workspacePath,
        false, // resume
        true,  // rerun
        agentTimeout,
      );

      agentRegisterRun(agentId, model);
      setCurrentAgentId(agentId);
    } catch (err) {
      setRunning(false);
      toast.error(
        `Failed to start rerun agent: ${err instanceof Error ? err.message : String(err)}`,
        { duration: Infinity },
      );
    }
  };

  const launchResumeAgent = async (prompt: string) => {
    try {
      setRunning(true);

      const phaseName = STEP_PHASE_MAP[stepId] ?? stepLabel;
      const agentName = skillType ? `${skillType}-${phaseName}` : undefined;

      // On resume turns, include context reminder
      const contextPrefix = sessionId
        ? `[Context reminder: You are rerunning the "${stepLabel}" step for skill "${skillName}" in domain "${domain}". ` +
          `The workspace is at ${workspacePath}. Continue improving the output based on user feedback.]\n\n`
        : "";
      const fullPrompt = contextPrefix + prompt;

      const agentId = await startAgent(
        `rerun-${stepLabel}-${Date.now()}`,
        fullPrompt,
        model,
        workspacePath,
        ["Read", "Write", "Edit", "Glob", "Grep", "Bash", "Task"],
        50,
        sessionId,
        skillName,
        `rerun-step${stepId}-${stepLabel}`,
        agentName,
      );

      agentRegisterRun(agentId, model);
      setCurrentAgentId(agentId);
    } catch (err) {
      setRunning(false);
      toast.error(
        `Failed to resume rerun agent: ${err instanceof Error ? err.message : String(err)}`,
        { duration: Infinity },
      );
    }
  };

  // --- Handlers ---

  const handleSend = () => {
    const text = userInput.trim();
    if (!text || isAgentRunning) return;

    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setUserInput("");
    launchResumeAgent(text);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleComplete = useCallback(async () => {
    // Final artifact capture
    try {
      await captureStepArtifacts(skillName, stepId, workspacePath);
    } catch {
      // Best-effort
    }
    onComplete();
  }, [skillName, stepId, workspacePath, onComplete]);

  // Expose completeStep to parent via ref
  useImperativeHandle(ref, () => ({ completeStep: handleComplete }), [handleComplete]);

  // Pre-compute turn numbers for streaming messages
  const streamTurnMap = useMemo(() => {
    const map = new Map<number, number>();
    if (!currentRun) return map;
    let turn = 0;
    for (let i = 0; i < currentRun.messages.length; i++) {
      if (currentRun.messages[i].type === "assistant") {
        turn++;
        map.set(i, turn);
      }
    }
    return map;
  }, [currentRun?.messages]);

  const streamMessageGroups = useMemo(
    () => currentRun ? computeMessageGroups(currentRun.messages, streamTurnMap) : [],
    [currentRun?.messages, streamTurnMap],
  );

  // --- Loading state ---

  if (!restored) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <RotateCcw className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // --- Main render ---

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Agent status header -- shown when an agent has been launched */}
      {currentAgentId && (
        <>
          <AgentStatusHeader
            agentId={currentAgentId}
            title={`Rerunning: ${stepLabel}`}
          />
          <Separator />
        </>
      )}

      {/* Messages area */}
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-4 p-3">
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : ""}`}
            >
              <div
                className={`flex size-8 shrink-0 items-center justify-center rounded-full ${
                  msg.role === "agent"
                    ? "bg-primary/10 text-primary"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {msg.role === "agent" ? (
                  <Bot className="size-4" />
                ) : (
                  <User className="size-4" />
                )}
              </div>
              <Card
                className={`max-w-[80%] px-3 py-2.5 ${
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : ""
                }`}
              >
                {msg.role === "agent" ? (
                  <div className="markdown-body compact">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {msg.content}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                )}
              </Card>
            </div>
          ))}

          {/* Streaming agent messages */}
          {isAgentRunning && currentRun && currentRun.messages.map((msg, i) => {
            const turn = streamTurnMap.get(i) ?? 0;
            const spacing = spacingClasses[streamMessageGroups[i]];
            return (
              <Fragment key={`${msg.timestamp}-${i}`}>
                {turn > 0 && <TurnMarker turn={turn} />}
                <div className={`${spacing} animate-message-in`}>
                  <MessageItem message={msg} />
                </div>
              </Fragment>
            );
          })}

          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      {/* Input area */}
      <div className="border-t bg-background p-4">
        <div className="flex items-end gap-2">
          <Textarea
            ref={textareaRef}
            value={userInput}
            onChange={(e) => setUserInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              isAgentRunning
                ? "Waiting for agent response..."
                : messages.length === 0
                ? "Agent is starting up..."
                : "Guide the agent to improve this step's output... (Enter to send)"
            }
            disabled={isAgentRunning}
            className="min-h-[60px] max-h-[160px] resize-none"
            rows={2}
          />
          <Button
            onClick={handleSend}
            disabled={isAgentRunning || !userInput.trim()}
            size="sm"
            aria-label="Send message"
          >
            <Send className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
});
