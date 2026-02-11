import { useState, useRef, useEffect, useCallback, useMemo, useImperativeHandle, forwardRef, Fragment } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Send,
  Brain,
  User,
  ChevronRight,
  ChevronDown,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useAgentStore } from "@/stores/agent-store";
import { useWorkflowStore } from "@/stores/workflow-store";
import {
  runWorkflowStep,
  startAgent,
  captureStepArtifacts,
  getArtifactContent,
  saveArtifactContent,
  readFile,
} from "@/lib/tauri";
import { useSettingsStore } from "@/stores/settings-store";
import { countDecisions } from "@/lib/reasoning-parser";
import { AgentStatusHeader } from "@/components/agent-status-header";
import { MessageItem, TurnMarker, computeMessageGroups, spacingClasses } from "@/components/agent-output-panel";

// --- Types ---

export type ReasoningPhase =
  | "not_started"
  | "agent_running"
  | "awaiting_feedback"
  | "completed";

export interface ReasoningChatHandle {
  completeStep: () => Promise<void>;
}

interface ReasoningChatProps {
  skillName: string;
  domain: string;
  workspacePath: string;
  onPhaseChange?: (phase: ReasoningPhase) => void;
}

interface ChatMessage {
  role: "agent" | "user";
  content: string;
  agentId?: string;
}

const SESSION_ARTIFACT = "context/reasoning-session.json";

interface ReasoningSessionState {
  messages: ChatMessage[];
  sessionId?: string;
  phase: ReasoningPhase;
  round: number;
}

// --- Component ---

export const ReasoningChat = forwardRef<ReasoningChatHandle, ReasoningChatProps>(function ReasoningChat({
  skillName,
  domain,
  workspacePath,
  onPhaseChange,
}, ref) {
  // Core state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [userInput, setUserInput] = useState("");
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [currentAgentId, setCurrentAgentId] = useState<string | null>(null);

  // Phase state machine — notify parent via effect (not during render) to avoid React warnings
  const [phase, setPhase] = useState<ReasoningPhase>("not_started");
  useEffect(() => {
    onPhaseChange?.(phase);
  }, [phase, onPhaseChange]);
  const [round, setRound] = useState(1);

  // Decisions panel
  const [decisionsContent, setDecisionsContent] = useState<string | null>(null);
  const [showDecisions, setShowDecisions] = useState(false);

  // Session restored flag (prevents overwriting saved state)
  const [restored, setRestored] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const processedRunRef = useRef<string | null>(null);

  // Stores — granular selector: only re-render when *this* agent's run changes
  const currentRun = useAgentStore((s) => currentAgentId ? s.runs[currentAgentId] : null);
  const agentRegisterRun = useAgentStore((s) => s.registerRun);
  const { updateStepStatus, setRunning, currentStep, skillType } = useWorkflowStore();
  const skillsPath = useSettingsStore((s) => s.skillsPath);

  // Derive agent name so resume turns load the full agent persona (e.g., "domain-reasoning")
  const agentName = skillType ? `${skillType}-reasoning` : undefined;

  const isAgentRunning = currentRun?.status === "running";

  // --- Session persistence ---

  const saveSession = useCallback(
    (
      msgs: ChatMessage[],
      sid: string | undefined,
      ph: ReasoningPhase,
      rnd: number,
    ) => {
      const state: ReasoningSessionState = {
        messages: msgs,
        sessionId: sid,
        phase: ph,
        round: rnd,
      };
      saveArtifactContent(
        skillName,
        4,
        SESSION_ARTIFACT,
        JSON.stringify(state),
      ).catch(() => {});
    },
    [skillName],
  );

  // Load saved session on mount
  useEffect(() => {
    if (restored) return;
    getArtifactContent(skillName, SESSION_ARTIFACT)
      .then((artifact) => {
        if (!artifact?.content) {
          setRestored(true);
          return;
        }
        try {
          const state: ReasoningSessionState = JSON.parse(artifact.content);
          if (state.messages?.length > 0) {
            setMessages(state.messages);
            setSessionId(state.sessionId);
            // Don't restore agent_running — it's not running anymore.
            // Map old phase names to new simplified phases for backward compatibility.
            let restoredPhase: ReasoningPhase;
            if (state.phase === "agent_running") {
              restoredPhase = "awaiting_feedback";
            } else if (state.phase === "completed") {
              restoredPhase = "completed";
            } else if (state.phase === "not_started") {
              restoredPhase = "not_started";
            } else {
              // "summary", "follow_up", "gate_check", "awaiting_feedback" all map to awaiting_feedback
              restoredPhase = "awaiting_feedback";
            }
            setPhase(restoredPhase);
            setRound(state.round ?? 1);
          }
        } catch {
          // Corrupt JSON — ignore
        }
        setRestored(true);
      })
      .catch(() => setRestored(true));
  }, [skillName, restored]);

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, currentRun?.messages.length, phase]);

  // Capture session ID as it arrives
  useEffect(() => {
    if (currentRun?.sessionId && !sessionId) {
      setSessionId(currentRun.sessionId);
    }
  }, [currentRun?.sessionId, sessionId]);

  // Load decisions on mount (resume case)
  useEffect(() => {
    getArtifactContent(skillName, "context/decisions.md")
      .then((artifact) => {
        if (artifact?.content) setDecisionsContent(artifact.content);
      })
      .catch(() => {});
  }, [skillName]);

  // --- Agent completion handler ---

  const loadDecisions = useCallback(async () => {
    try {
      await captureStepArtifacts(skillName, 4, workspacePath);
      const artifact = await getArtifactContent(skillName, "context/decisions.md");
      if (artifact?.content) setDecisionsContent(artifact.content);
    } catch {
      // Decisions may not exist yet
    }
  }, [skillName, workspacePath]);

  const handleAgentTurnComplete = useCallback(() => {
    if (!currentRun || !currentAgentId) return;
    if (currentRun.status !== "completed" && currentRun.status !== "error") return;
    // Prevent re-processing the same run (avoids infinite loop from messages.length dependency)
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
          const newPhase: ReasoningPhase = "awaiting_feedback";
          setPhase(newPhase);
          saveSession(updated, sid, newPhase, round);
          return updated;
        });
      }

      setRunning(false);
      loadDecisions();
    } else if (currentRun.status === "error") {
      const errorMsg = currentRun.messages.find((m) => m.type === "error");
      const newPhase: ReasoningPhase = messages.length > 0 ? "awaiting_feedback" : "not_started";
      setMessages((prev) => {
        const updated = [
          ...prev,
          {
            role: "agent" as const,
            content: `Error: ${errorMsg?.content ?? "Agent encountered an error"}`,
            agentId: currentAgentId,
          },
        ];
        saveSession(updated, sid, newPhase, round);
        return updated;
      });
      setRunning(false);
      setPhase(newPhase);
      toast.error("Reasoning agent encountered an error");
    }
  }, [currentRun?.status, currentAgentId, currentRun, sessionId, setRunning, loadDecisions, messages.length, round, saveSession]);

  useEffect(() => {
    handleAgentTurnComplete();
  }, [handleAgentTurnComplete]);

  // --- Agent launchers ---

  const launchResumeAgent = async (prompt: string) => {
    try {
      updateStepStatus(currentStep, "in_progress");
      setRunning(true);
      setPhase("agent_running");

      // On resume turns, prepend context about the decisions.md output requirement
      // so the agent always knows to write it, even if context was lost between sessions.
      const contextPrefix = sessionId
        ? `[Context reminder: You are the reasoning agent for skill "${skillName}" in domain "${domain}". ` +
          `You MUST write your decisions to ${skillName}/context/decisions.md before completing. ` +
          `The workspace is at ${workspacePath}.]\n\n`
        : "";
      const fullPrompt = contextPrefix + prompt;

      // CWD must match runWorkflowStep (workspace root, not skill dir)
      // so the agent resolves <skill-name>/context/ paths correctly
      const agentId = await startAgent(
        `reasoning-${Date.now()}`,
        fullPrompt,
        "opus",
        workspacePath,
        ["Read", "Write", "Edit", "Glob", "Grep", "Bash", "Task"],
        100,
        sessionId,
        skillName,
        "step4-reasoning",
        agentName,
      );

      agentRegisterRun(agentId, "opus");
      setCurrentAgentId(agentId);
    } catch (err) {
      updateStepStatus(currentStep, "error");
      setRunning(false);
      setPhase("awaiting_feedback");
      toast.error(
        `Failed to start reasoning agent: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  // --- Handlers ---

  const handleStart = async () => {
    try {
      updateStepStatus(currentStep, "in_progress");
      setRunning(true);
      setPhase("agent_running");

      // Use runWorkflowStep which stages artifacts, copies prompts,
      // and builds the proper prompt from agents/reasoning.md
      const agentId = await runWorkflowStep(skillName, 4, domain, workspacePath);
      agentRegisterRun(agentId, "opus");
      setCurrentAgentId(agentId);
    } catch (err) {
      updateStepStatus(currentStep, "error");
      setRunning(false);
      setPhase("not_started");
      toast.error(
        `Failed to start reasoning: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  const handleCompleteStep = useCallback(async () => {
    try {
      await captureStepArtifacts(skillName, 4, workspacePath);
    } catch {
      // Best-effort
    }

    // Validate that decisions.md was actually created before marking step complete.
    // Check in order: skillsPath, workspacePath, SQLite artifact.
    let decisionsFound = false;

    // 1. Check skill output directory (primary per VD-405)
    if (skillsPath) {
      try {
        const content = await readFile(`${skillsPath}/${skillName}/context/decisions.md`);
        if (content && content.trim().length > 0) decisionsFound = true;
      } catch {
        // File doesn't exist there
      }
    }

    // 2. Check workspace directory (fallback)
    if (!decisionsFound) {
      try {
        const content = await readFile(`${workspacePath}/${skillName}/context/decisions.md`);
        if (content && content.trim().length > 0) decisionsFound = true;
      } catch {
        // File doesn't exist there
      }
    }

    // 3. Check SQLite artifact (last resort)
    if (!decisionsFound) {
      try {
        const artifact = await getArtifactContent(skillName, "context/decisions.md");
        if (artifact?.content && artifact.content.trim().length > 0) decisionsFound = true;
      } catch {
        // No artifact
      }
    }

    if (!decisionsFound) {
      toast.error(
        "Decisions file was not created. The reasoning agent did not save decisions.md. " +
        "Please send feedback to the agent asking it to write decisions before completing.",
      );
      return;
    }

    setPhase("completed");
    updateStepStatus(currentStep, "completed");
    setRunning(false);
    toast.success("Reasoning step completed");

    const steps = useWorkflowStore.getState().steps;
    if (currentStep < steps.length - 1) {
      useWorkflowStore.getState().setCurrentStep(currentStep + 1);
    }
  }, [skillName, workspacePath, skillsPath, setPhase, updateStepStatus, currentStep, setRunning]);

  // Expose completeStep to parent via ref
  useImperativeHandle(ref, () => ({
    completeStep: handleCompleteStep,
  }), [handleCompleteStep]);

  // Free-form send — primary interaction method
  const handleSend = () => {
    const text = userInput.trim();
    if (!text || isAgentRunning) return;

    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setUserInput("");
    setRound((prev) => prev + 1);
    launchResumeAgent(text);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Pre-compute turn numbers for streaming messages in O(n)
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

  // --- Not started ---

  if (phase === "not_started" && messages.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4">
        <Brain className="size-12 text-muted-foreground/50" />
        <div className="text-center">
          <h3 className="text-lg font-medium">Reasoning Agent</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Multi-turn conversation with Opus to analyze your responses,
            surface implications, and build decisions iteratively.
          </p>
        </div>
        <Button onClick={handleStart} size="lg">
          <Brain className="size-4" />
          Start Reasoning
        </Button>
      </div>
    );
  }

  // --- Decisions panel ---

  const renderDecisionsPanel = () => {
    if (!decisionsContent) return null;
    const count = countDecisions(decisionsContent);

    return (
      <div className="border-t">
        <button
          onClick={() => setShowDecisions(!showDecisions)}
          className="flex w-full items-center gap-2 px-4 py-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          {showDecisions ? (
            <ChevronDown className="size-3.5" />
          ) : (
            <ChevronRight className="size-3.5" />
          )}
          Current Decisions ({count} {count === 1 ? "decision" : "decisions"})
        </button>
        {showDecisions && (
          <div className="max-h-[300px] overflow-y-auto border-t px-4 py-3">
            <div className="markdown-body compact">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {decisionsContent}
              </ReactMarkdown>
            </div>
          </div>
        )}
      </div>
    );
  };

  // --- Main render ---

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Agent status header — shown when an agent has been launched */}
      {currentAgentId && (
        <>
          <AgentStatusHeader
            agentId={currentAgentId}
            title="Reasoning Agent"
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
                  <Brain className="size-4" />
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

          {/* Streaming agent messages — same rendering as AgentOutputPanel */}
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

      {/* Decisions panel (collapsible) */}
      {renderDecisionsPanel()}

      {/* Input area — primary way to give feedback */}
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
                : phase === "awaiting_feedback"
                  ? "Provide feedback or request revisions... (Enter to send)"
                  : "Type a message... (Enter to send)"
            }
            disabled={isAgentRunning}
            className="min-h-[60px] max-h-[160px] resize-none"
            rows={2}
          />
          <Button
            onClick={handleSend}
            disabled={isAgentRunning || !userInput.trim()}
            size="sm"
          >
            <Send className="size-4" />
          </Button>
        </div>
        <div className="mt-2 flex items-center gap-2">
          {round > 1 && (
            <Badge variant="outline" className="text-xs">
              Round {round}
            </Badge>
          )}
          {sessionId && (
            <Badge variant="secondary" className="text-xs">
              Session active
            </Badge>
          )}
        </div>
      </div>
    </div>
  );
});
