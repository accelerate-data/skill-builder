import { useState, useRef, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Loader2,
  Send,
  Brain,
  User,
  ChevronRight,
  ChevronDown,
  CheckCircle2,
  Pencil,
  ArrowRight,
  FileText,
  Pause,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAgentStore } from "@/stores/agent-store";
import { useWorkflowStore } from "@/stores/workflow-store";
import {
  runWorkflowStep,
  startAgent,
  cancelAgent,
  captureStepArtifacts,
  getArtifactContent,
  saveArtifactContent,
} from "@/lib/tauri";
import {
  parseAgentResponseType,
  extractFollowUpSection,
  extractRoundNumber,
  countDecisions,
} from "@/lib/reasoning-parser";

// --- Types ---

interface ReasoningChatProps {
  skillName: string;
  domain: string;
  workspacePath: string;
}

interface ChatMessage {
  role: "agent" | "user";
  content: string;
  agentId?: string;
}

type ReasoningPhase =
  | "not_started"
  | "agent_running"
  | "follow_up"
  | "summary"
  | "gate_check"
  | "completed";

const SESSION_ARTIFACT = "context/reasoning-session.json";

interface ReasoningSessionState {
  messages: ChatMessage[];
  sessionId?: string;
  phase: ReasoningPhase;
  round: number;
}

// --- Component ---

export function ReasoningChat({
  skillName,
  domain,
  workspacePath,
}: ReasoningChatProps) {
  // Core state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [userInput, setUserInput] = useState("");
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [currentAgentId, setCurrentAgentId] = useState<string | null>(null);

  // Phase state machine
  const [phase, setPhase] = useState<ReasoningPhase>("not_started");
  const [round, setRound] = useState(1);

  // Action panel state
  const [followUpText, setFollowUpText] = useState("");
  const [showCorrections, setShowCorrections] = useState(false);
  const [correctionText, setCorrectionText] = useState("");

  // Decisions panel
  const [decisionsContent, setDecisionsContent] = useState<string | null>(null);
  const [showDecisions, setShowDecisions] = useState(false);

  // Session restored flag (prevents overwriting saved state)
  const [restored, setRestored] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Stores
  const runs = useAgentStore((s) => s.runs);
  const agentStartRun = useAgentStore((s) => s.startRun);
  const { updateStepStatus, setRunning, currentStep } = useWorkflowStore();

  const currentRun = currentAgentId ? runs[currentAgentId] : null;
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
        6,
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
            // Don't restore agent_running — it's not running anymore
            setPhase(
              state.phase === "agent_running"
                ? "summary"
                : state.phase,
            );
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
      await captureStepArtifacts(skillName, 6, workspacePath);
      const artifact = await getArtifactContent(skillName, "context/decisions.md");
      if (artifact?.content) setDecisionsContent(artifact.content);
    } catch {
      // Decisions may not exist yet
    }
  }, [skillName, workspacePath]);

  const handleAgentTurnComplete = useCallback(() => {
    if (!currentRun || !currentAgentId) return;
    if (currentRun.status !== "completed" && currentRun.status !== "error") return;

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

          // Classify response and transition phase
          const responseType = parseAgentResponseType(agentText);
          let newPhase: ReasoningPhase;
          let newRound = round;

          switch (responseType) {
            case "follow_up": {
              const extracted = extractFollowUpSection(agentText);
              setFollowUpText(extracted ?? "");
              const detectedRound = extractRoundNumber(agentText);
              if (detectedRound) {
                newRound = detectedRound;
                setRound(detectedRound);
              }
              newPhase = "follow_up";
              break;
            }
            case "gate_check":
              newPhase = "gate_check";
              break;
            default:
              newPhase = "summary";
              break;
          }

          setPhase(newPhase);
          saveSession(updated, sid, newPhase, newRound);
          return updated;
        });
      }

      setRunning(false);
      loadDecisions();
    } else if (currentRun.status === "error") {
      const errorMsg = currentRun.messages.find((m) => m.type === "error");
      const newPhase = messages.length > 0 ? "summary" : "not_started";
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

  // --- Pause handler ---

  const handlePause = async () => {
    if (!currentAgentId) return;
    try {
      await cancelAgent(currentAgentId);
    } catch {
      // Agent may have already finished
    }

    // Collect any partial text the agent produced before pause
    if (currentRun) {
      const textParts: string[] = [];
      for (const msg of currentRun.messages) {
        if (msg.type === "assistant" && msg.content) {
          textParts.push(msg.content);
        }
      }
      const partialText = textParts.join("\n\n");
      if (partialText) {
        setMessages((prev) => [
          ...prev,
          { role: "agent", content: partialText, agentId: currentAgentId },
        ]);
      }
    }

    const pausePhase = messages.length > 0 ? "summary" : "not_started";
    setPhase(pausePhase);
    setRunning(false);
    updateStepStatus(currentStep, "pending");

    // Save state so we can resume later
    saveSession(messages, sessionId, pausePhase, round);
    loadDecisions();
    toast.info("Reasoning session paused — you can resume anytime");
  };

  // --- Agent launchers ---

  const launchResumeAgent = async (prompt: string) => {
    try {
      updateStepStatus(currentStep, "in_progress");
      setRunning(true);
      setPhase("agent_running");

      // CWD must match runWorkflowStep (workspace root, not skill dir)
      // so the agent resolves <skill-name>/context/ paths correctly
      const agentId = await startAgent(
        `reasoning-${Date.now()}`,
        prompt,
        "opus",
        workspacePath,
        ["Read", "Write", "Edit", "Glob", "Grep", "Bash", "Task"],
        100,
        sessionId,
      );

      agentStartRun(agentId, "opus");
      setCurrentAgentId(agentId);
    } catch (err) {
      updateStepStatus(currentStep, "error");
      setRunning(false);
      setPhase("summary");
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
      // and builds the proper prompt from 06-reasoning-agent.md
      const agentId = await runWorkflowStep(skillName, 6, domain, workspacePath);
      agentStartRun(agentId, "opus");
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

  const handleSubmitFollowUps = () => {
    const text = followUpText.trim();
    if (!text || isAgentRunning) return;

    const message = `Here are my answers to the follow-up questions:\n\n${text}\n\nPlease analyze these responses and continue the reasoning process.`;
    setMessages((prev) => [...prev, { role: "user", content: message }]);
    setFollowUpText("");
    setRound((prev) => prev + 1);
    launchResumeAgent(message);
  };

  const handleConfirmSummary = () => {
    const message =
      "Confirmed. Please update decisions.md and check if there are any remaining follow-up questions. If not, proceed to the gate check.";
    setMessages((prev) => [...prev, { role: "user", content: message }]);
    setShowCorrections(false);
    setCorrectionText("");
    launchResumeAgent(message);
  };

  const handleSubmitCorrections = () => {
    const text = correctionText.trim();
    if (!text || isAgentRunning) return;

    const message = `I have corrections to the reasoning summary:\n\n${text}\n\nPlease address these corrections, update your analysis, and check for remaining questions.`;
    setMessages((prev) => [...prev, { role: "user", content: message }]);
    setShowCorrections(false);
    setCorrectionText("");
    launchResumeAgent(message);
  };

  const handleProceedToBuild = async () => {
    try {
      await captureStepArtifacts(skillName, 6, workspacePath);
    } catch {
      // Best-effort
    }

    setPhase("completed");
    updateStepStatus(currentStep, "completed");
    setRunning(false);
    toast.success("Reasoning step completed");

    const steps = useWorkflowStore.getState().steps;
    if (currentStep < steps.length - 1) {
      useWorkflowStore.getState().setCurrentStep(currentStep + 1);
    }
  };

  // Free-form send (escape hatch)
  const handleSend = () => {
    const text = userInput.trim();
    if (!text || isAgentRunning) return;

    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setUserInput("");
    setShowCorrections(false);
    launchResumeAgent(text);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

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

  // --- Action panels (inline after last agent message) ---

  const renderActionPanel = () => {
    if (phase === "agent_running") return null;

    if (phase === "follow_up") {
      return (
        <Card className="border-amber-500/30 bg-amber-500/5 p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-400">
            <FileText className="size-4" />
            Follow-up Questions {round > 1 && `\u2014 Round ${round}`}
          </div>
          <Textarea
            value={followUpText}
            onChange={(e) => setFollowUpText(e.target.value)}
            placeholder="Add your answers below each question..."
            className="mb-3 min-h-[120px] max-h-[300px] resize-y font-mono text-sm"
            rows={6}
          />
          <div className="flex justify-end">
            <Button
              onClick={handleSubmitFollowUps}
              disabled={!followUpText.trim() || isAgentRunning}
              size="sm"
            >
              <ArrowRight className="size-3.5" />
              Submit Answers
            </Button>
          </div>
        </Card>
      );
    }

    if (phase === "summary") {
      return (
        <Card className="border-blue-500/30 bg-blue-500/5 p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium text-blue-700 dark:text-blue-400">
            <Brain className="size-4" />
            Review the reasoning summary above
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={handleConfirmSummary} disabled={isAgentRunning} size="sm">
              <CheckCircle2 className="size-3.5" />
              Confirm Reasoning
            </Button>
            <Button
              variant="outline"
              onClick={() => setShowCorrections(!showCorrections)}
              disabled={isAgentRunning}
              size="sm"
            >
              <Pencil className="size-3.5" />
              Add Corrections
            </Button>
          </div>
          {showCorrections && (
            <div className="mt-3">
              <Textarea
                value={correctionText}
                onChange={(e) => setCorrectionText(e.target.value)}
                placeholder="Describe your corrections or additional context..."
                className="mb-2 min-h-[80px] max-h-[200px] resize-y text-sm"
                rows={3}
              />
              <div className="flex justify-end">
                <Button
                  onClick={handleSubmitCorrections}
                  disabled={!correctionText.trim() || isAgentRunning}
                  size="sm"
                >
                  <Send className="size-3.5" />
                  Send Corrections
                </Button>
              </div>
            </div>
          )}
        </Card>
      );
    }

    if (phase === "gate_check") {
      return (
        <Card className="border-green-500/30 bg-green-500/5 p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium text-green-700 dark:text-green-400">
            <CheckCircle2 className="size-4" />
            All clarifications resolved. Decisions are logged.
          </div>
          <Button onClick={handleProceedToBuild} disabled={isAgentRunning} size="sm">
            <ArrowRight className="size-3.5" />
            Proceed to Build
          </Button>
        </Card>
      );
    }

    return null;
  };

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
            <div className="markdown-body max-w-none text-sm">
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
      {/* Messages area */}
      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-4 p-4">
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
                className={`max-w-[80%] px-4 py-3 ${
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : ""
                }`}
              >
                {msg.role === "agent" ? (
                  <div className="markdown-body max-w-none text-sm">
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

          {/* Streaming indicator with pause button */}
          {isAgentRunning && (
            <div className="flex gap-3">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Brain className="size-4" />
              </div>
              <Card className="flex items-center gap-3 px-4 py-3">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  Reasoning...
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={handlePause}
                >
                  <Pause className="size-3" />
                  Pause
                </Button>
              </Card>
            </div>
          )}

          {/* Action panel — shown after messages */}
          {renderActionPanel()}

          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      {/* Decisions panel (collapsible) */}
      {renderDecisionsPanel()}

      {/* Input area (always available as escape hatch) */}
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
                : "Type a message to override the flow... (Enter to send)"
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
          {currentRun?.tokenUsage && (
            <Badge variant="secondary" className="text-xs">
              {(
                currentRun.tokenUsage.input + currentRun.tokenUsage.output
              ).toLocaleString()}{" "}
              tokens
            </Badge>
          )}
          {currentRun?.totalCost !== undefined && (
            <Badge variant="secondary" className="text-xs">
              ${currentRun.totalCost.toFixed(4)}
            </Badge>
          )}
        </div>
      </div>
    </div>
  );
}
