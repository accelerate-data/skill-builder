import { useState, useRef, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Loader2,
  Send,
  CheckCircle2,
  Brain,
  AlertCircle,
  User,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAgentStore } from "@/stores/agent-store";
import { useWorkflowStore } from "@/stores/workflow-store";
import { useSettingsStore } from "@/stores/settings-store";
import { startAgent } from "@/lib/tauri";

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

export function ReasoningChat({
  skillName,
  domain,
  workspacePath,
}: ReasoningChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [userInput, setUserInput] = useState("");
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [currentAgentId, setCurrentAgentId] = useState<string | null>(null);
  const [hasFollowUp, setHasFollowUp] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const runs = useAgentStore((s) => s.runs);
  const agentStartRun = useAgentStore((s) => s.startRun);
  const { updateStepStatus, setRunning, currentStep } = useWorkflowStore();
  const anthropicApiKey = useSettingsStore((s) => s.anthropicApiKey);

  const currentRun = currentAgentId ? runs[currentAgentId] : null;
  const isAgentRunning = currentRun?.status === "running";
  const hasStarted = messages.length > 0 || currentAgentId !== null;

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, currentRun?.messages.length]);

  // Watch for agent completion and extract output
  const handleAgentTurnComplete = useCallback(() => {
    if (!currentRun || !currentAgentId) return;
    if (currentRun.status !== "completed" && currentRun.status !== "error")
      return;

    // Extract session ID from the run
    if (currentRun.sessionId && !sessionId) {
      setSessionId(currentRun.sessionId);
    }

    if (currentRun.status === "completed") {
      // Collect all text content from assistant messages
      const textParts: string[] = [];
      for (const msg of currentRun.messages) {
        if (msg.type === "assistant" && msg.content) {
          textParts.push(msg.content);
        }
      }
      const agentText = textParts.join("\n\n");

      if (agentText) {
        setMessages((prev) => [
          ...prev,
          { role: "agent", content: agentText, agentId: currentAgentId },
        ]);

        // Check for follow-up questions
        const lower = agentText.toLowerCase();
        const hasFollowUps =
          lower.includes("follow-up question") ||
          lower.includes("follow up question") ||
          lower.includes("follow-up questions") ||
          lower.includes("follow up questions");
        setHasFollowUp(hasFollowUps);
      }

      setRunning(false);
    } else if (currentRun.status === "error") {
      const errorMsg = currentRun.messages.find((m) => m.type === "error");
      setMessages((prev) => [
        ...prev,
        {
          role: "agent",
          content: `Error: ${errorMsg?.content ?? "Agent encountered an error"}`,
          agentId: currentAgentId,
        },
      ]);
      setRunning(false);
      toast.error("Reasoning agent encountered an error");
    }
  }, [currentRun?.status, currentAgentId, currentRun, sessionId, setRunning]);

  useEffect(() => {
    handleAgentTurnComplete();
  }, [handleAgentTurnComplete]);

  // Also capture session ID as it arrives (before completion)
  useEffect(() => {
    if (currentRun?.sessionId && !sessionId) {
      setSessionId(currentRun.sessionId);
    }
  }, [currentRun?.sessionId, sessionId]);

  const launchAgent = async (prompt: string, resumeSessionId?: string) => {
    if (!anthropicApiKey) {
      toast.error("API key not configured");
      return;
    }

    try {
      updateStepStatus(currentStep, "in_progress");
      setRunning(true);

      const cwd = `${workspacePath}/${skillName}`;
      const agentId = await startAgent(
        `reasoning-${Date.now()}`,
        prompt,
        "opus",
        cwd,
        ["Read", "Write", "Glob", "Grep"],
        50,
        resumeSessionId,
      );

      agentStartRun(agentId, "opus");
      setCurrentAgentId(agentId);
    } catch (err) {
      updateStepStatus(currentStep, "error");
      setRunning(false);
      toast.error(
        `Failed to start reasoning agent: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  const handleStart = () => {
    const prompt = [
      `You are a reasoning agent analyzing a skill definition for "${domain}".`,
      `Read the file context/clarifications.md in the current directory for the user's answers to clarification questions.`,
      `Analyze the responses for implications, gaps, contradictions, and edge cases.`,
      `If you have follow-up questions, present them clearly under a "Follow-up Questions" heading.`,
      `When done, write your analysis and decisions to context/decisions.md.`,
    ].join("\n\n");

    launchAgent(prompt);
  };

  const handleSend = () => {
    const text = userInput.trim();
    if (!text || isAgentRunning) return;

    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setUserInput("");
    setHasFollowUp(false);

    launchAgent(text, sessionId);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleConfirmAndContinue = () => {
    updateStepStatus(currentStep, "completed");
    setRunning(false);
    toast.success("Reasoning step completed");

    // Advance to next step
    const steps = useWorkflowStore.getState().steps;
    if (currentStep < steps.length - 1) {
      useWorkflowStore.getState().setCurrentStep(currentStep + 1);
    }
  };

  // Not started yet
  if (!hasStarted) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4">
        <Brain className="size-12 text-muted-foreground/50" />
        <div className="text-center">
          <h3 className="text-lg font-medium">Reasoning Agent</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            This step uses a multi-turn conversation with an Opus-powered agent
            to analyze your responses and surface implications, gaps, and edge
            cases.
          </p>
        </div>
        <Button onClick={handleStart} size="lg">
          <Brain className="size-4" />
          Start Reasoning
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Follow-up banner */}
      {hasFollowUp && !isAgentRunning && (
        <div className="flex items-center gap-2 border-b bg-amber-500/10 px-4 py-2 text-sm text-amber-700 dark:text-amber-400">
          <AlertCircle className="size-4 shrink-0" />
          The reasoning agent has follow-up questions. Please review and respond
          below.
        </div>
      )}

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
                  <div className="prose prose-sm dark:prose-invert max-w-none text-sm">
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

          {/* Streaming indicator when agent is running */}
          {isAgentRunning && (
            <div className="flex gap-3">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Brain className="size-4" />
              </div>
              <Card className="px-4 py-3">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  Reasoning...
                </div>
              </Card>
            </div>
          )}

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
                : "Type your response... (Enter to send, Shift+Enter for newline)"
            }
            disabled={isAgentRunning}
            className="min-h-[60px] max-h-[160px] resize-none"
            rows={2}
          />
          <div className="flex flex-col gap-2">
            <Button
              onClick={handleSend}
              disabled={isAgentRunning || !userInput.trim()}
              size="sm"
            >
              <Send className="size-4" />
            </Button>
            <Button
              onClick={handleConfirmAndContinue}
              disabled={isAgentRunning}
              variant="outline"
              size="sm"
              title="Confirm decisions and continue to next step"
            >
              <CheckCircle2 className="size-4" />
            </Button>
          </div>
        </div>
        <div className="mt-2 flex items-center gap-2">
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
