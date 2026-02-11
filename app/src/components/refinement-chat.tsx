import { useState, useRef, useEffect, useCallback, useMemo, Fragment } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Send,
  User,
  Bot,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useAgentStore } from "@/stores/agent-store";
import { useSettingsStore } from "@/stores/settings-store";
import {
  startAgent,
  getArtifactContent,
  saveArtifactContent,
} from "@/lib/tauri";
import { AgentStatusHeader } from "@/components/agent-status-header";
import { MessageItem, TurnMarker, computeMessageGroups, spacingClasses } from "@/components/agent-output-panel";

// --- Types ---

export interface RefinementChatProps {
  skillName: string;
  domain: string;
  workspacePath: string;
}

interface ChatMessage {
  role: "agent" | "user";
  content: string;
  agentId?: string;
}

type RefinementPhase = "idle" | "agent_running" | "error";

const SESSION_ARTIFACT = "context/refinement-chat.json";

interface RefinementSessionState {
  messages: ChatMessage[];
  sessionId?: string;
  lastUpdated: string;
}

// --- Component ---

export function RefinementChat({
  skillName,
  domain,
  workspacePath,
}: RefinementChatProps) {
  // Core state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [userInput, setUserInput] = useState("");
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [currentAgentId, setCurrentAgentId] = useState<string | null>(null);
  const [_phase, setPhase] = useState<RefinementPhase>("idle");

  // Session restored flag
  const [restored, setRestored] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const processedRunRef = useRef<string | null>(null);

  // Stores
  const currentRun = useAgentStore((s) => currentAgentId ? s.runs[currentAgentId] : null);
  const agentStartRun = useAgentStore((s) => s.startRun);
  const skillsPath = useSettingsStore((s) => s.skillsPath);

  const isAgentRunning = currentRun?.status === "running";

  // --- Session persistence ---

  const saveSession = useCallback(
    (msgs: ChatMessage[], sid: string | undefined) => {
      const state: RefinementSessionState = {
        messages: msgs,
        sessionId: sid,
        lastUpdated: new Date().toISOString(),
      };
      saveArtifactContent(
        skillName,
        8, // Refinement chat step
        SESSION_ARTIFACT,
        JSON.stringify(state, null, 2),
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
          const state: RefinementSessionState = JSON.parse(artifact.content);
          if (state.messages?.length > 0) {
            setMessages(state.messages);
            setSessionId(state.sessionId);
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

      setPhase("idle");
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
      setPhase("error");
      toast.error("Refinement agent encountered an error");
    }
  }, [currentRun?.status, currentAgentId, currentRun, sessionId, saveSession]);

  useEffect(() => {
    handleAgentTurnComplete();
  }, [handleAgentTurnComplete]);

  // --- System prompt builder ---

  const buildSystemPrompt = useCallback(() => {
    const outputDir = skillsPath ? `${skillsPath}/${skillName}` : `<skills-path>/${skillName}`;

    return `You are a skill refinement assistant. The user has completed the initial skill-building workflow and wants to refine their skill.

# Context

- **Skill Name**: ${skillName}
- **Domain**: ${domain}
- **Workspace Path**: ${workspacePath}
- **Output Directory**: ${outputDir}

# Key Files

The skill output is located in \`${skillName}/\`:
- \`${skillName}/SKILL.md\` - The main skill file
- \`${skillName}/context/\` - Supporting context artifacts (concepts, patterns, data, decisions)
- \`${skillName}/references/\` - Deep-dive reference materials
- \`${skillName}/context/test-skill.md\` - Test cases and results
- \`${skillName}/context/agent-validation-log.md\` - Validation report
- \`${skillName}/context/decisions.md\` - Reasoning decisions

# Your Role

Help the user refine their skill by:
- Answering questions about the skill content
- Making targeted edits based on user feedback
- Adding or removing sections as requested
- Improving clarity, completeness, or structure
- Addressing gaps or inconsistencies identified by the user

# Guidelines

- Read the existing skill files before making changes
- Make precise, surgical edits — don't rewrite entire sections unless asked
- Preserve the overall structure and style established during the workflow
- Save changes to the appropriate files in the skill directory
- Test your changes if the user requests validation

The user will guide the conversation. Ask clarifying questions if their request is ambiguous.`;
  }, [skillName, domain, workspacePath, skillsPath]);

  // --- Agent launcher ---

  const launchAgent = async (prompt: string) => {
    try {
      setPhase("agent_running");

      // Build prompt: include system prompt on first turn, just user message on resume
      const fullPrompt = sessionId ? prompt : `${buildSystemPrompt()}\n\n---\n\n${prompt}`;

      const agentId = await startAgent(
        `refinement-${Date.now()}`,
        fullPrompt,
        "sonnet",
        workspacePath,
        ["Read", "Write", "Edit", "Glob", "Grep", "Bash", "Task"],
        50,
        sessionId,
      );

      agentStartRun(agentId, "sonnet");
      setCurrentAgentId(agentId);
    } catch (err) {
      setPhase("error");
      toast.error(
        `Failed to start refinement agent: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  // --- Handlers ---

  const handleSend = () => {
    const text = userInput.trim();
    if (!text || isAgentRunning) return;

    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setUserInput("");
    launchAgent(text);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

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

  // --- Main render ---

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Agent status header — shown when an agent has been launched */}
      {currentAgentId && (
        <>
          <AgentStatusHeader
            agentId={currentAgentId}
            title="Refinement Agent"
          />
          <Separator />
        </>
      )}

      {/* Messages area */}
      <ScrollArea className="min-h-0 flex-1">
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
                  <Bot className="size-4" />
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
                ? "Ask a question or request a change to your skill..."
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
            aria-label="Send message"
          >
            <Send className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
