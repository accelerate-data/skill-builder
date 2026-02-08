import { useState, useRef, useEffect, useCallback } from "react";
import { useParams, Link } from "@tanstack/react-router";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Loader2,
  Send,
  MessageSquare,
  Bot,
  User,
  ArrowLeft,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAgentStore } from "@/stores/agent-store";
import { useAgentStream } from "@/hooks/use-agent-stream";
import { useSettingsStore } from "@/stores/settings-store";
import { useChatStore, type ChatMessage } from "@/stores/chat-store";
import {
  createChatSession,
  listChatSessions,
  addChatMessage,
  getChatMessages,
  runChatAgent,
} from "@/lib/tauri";

export default function ChatPage() {
  const { skillName } = useParams({ from: "/skill/$skillName/chat" });
  const workspacePath = useSettingsStore((s) => s.workspacePath);

  const {
    sessionId,
    messages,
    activeAgentId,
    initSession,
    addMessage: addLocalMessage,
    setMessages,
    setStreaming,
    setActiveAgentId,
    reset: resetChat,
  } = useChatStore();

  const runs = useAgentStore((s) => s.runs);
  const agentStartRun = useAgentStore((s) => s.startRun);

  useAgentStream();

  const [userInput, setUserInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const initRef = useRef(false);

  const currentRun = activeAgentId ? runs[activeAgentId] : null;
  const isAgentRunning = currentRun?.status === "running";

  // Initialize or resume session
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;

    const init = async () => {
      try {
        // Check for existing sessions
        const sessions = await listChatSessions(skillName);
        if (sessions.length > 0) {
          const latest = sessions[0]; // sorted by updated_at DESC
          initSession(latest.id, skillName, latest.mode);
          // Load existing messages
          const msgs = await getChatMessages(latest.id);
          setMessages(
            msgs.map((m) => ({
              id: m.id,
              role: m.role as "user" | "assistant",
              content: m.content,
              createdAt: m.created_at,
            }))
          );
        } else {
          // Create new session
          const session = await createChatSession(skillName, "conversational");
          initSession(session.id, skillName, session.mode);
        }
      } catch (err) {
        toast.error("Failed to initialize chat session");
      }
    };

    init();

    return () => {
      resetChat();
    };
  }, [skillName]);

  // Scroll to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, currentRun?.messages.length]);

  // Watch for agent completion
  useEffect(() => {
    if (!currentRun || !activeAgentId) return;
    if (currentRun.status !== "completed" && currentRun.status !== "error") return;

    if (currentRun.status === "completed") {
      const textParts: string[] = [];
      for (const msg of currentRun.messages) {
        if (msg.type === "assistant" && msg.content) {
          textParts.push(msg.content);
        }
      }
      const agentText = textParts.join("\n\n");

      if (agentText && sessionId) {
        const newMsg: ChatMessage = {
          id: `msg-${Date.now()}`,
          role: "assistant",
          content: agentText,
          createdAt: new Date().toISOString(),
        };
        addLocalMessage(newMsg);
        // Persist to SQLite
        addChatMessage(sessionId, "assistant", agentText).catch(() => {});
      }
    } else if (currentRun.status === "error") {
      toast.error("Chat agent encountered an error");
    }

    setStreaming(false);
    setActiveAgentId(null);
  }, [currentRun?.status, activeAgentId, sessionId]);

  const handleSend = useCallback(async () => {
    const text = userInput.trim();
    if (!text || isAgentRunning || !sessionId || !workspacePath) return;

    // Add user message
    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: "user",
      content: text,
      createdAt: new Date().toISOString(),
    };
    addLocalMessage(userMsg);
    setUserInput("");

    // Persist user message
    try {
      await addChatMessage(sessionId, "user", text);
    } catch {
      // Continue even if persistence fails
    }

    // Launch agent
    try {
      setStreaming(true);
      const agentId = await runChatAgent(skillName, sessionId, text, workspacePath);
      agentStartRun(agentId, "sonnet");
      setActiveAgentId(agentId);
    } catch (err) {
      setStreaming(false);
      toast.error(
        `Failed to start chat agent: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }, [userInput, isAgentRunning, sessionId, workspacePath, skillName, addLocalMessage, setStreaming, setActiveAgentId, agentStartRun]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex h-full flex-col -m-6">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-6 py-4">
        <div className="flex items-center gap-3">
          <Link to="/skill/$skillName" params={{ skillName }}>
            <Button variant="ghost" size="sm">
              <ArrowLeft className="size-4" />
            </Button>
          </Link>
          <div>
            <h2 className="text-lg font-semibold">Chat</h2>
            <p className="text-sm text-muted-foreground">{skillName}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="gap-1">
            <MessageSquare className="size-3" />
            Conversational
          </Badge>
          {currentRun?.tokenUsage && (
            <Badge variant="secondary" className="text-xs">
              {(currentRun.tokenUsage.input + currentRun.tokenUsage.output).toLocaleString()} tokens
            </Badge>
          )}
          {currentRun?.totalCost !== undefined && (
            <Badge variant="secondary" className="text-xs">
              ${currentRun.totalCost.toFixed(4)}
            </Badge>
          )}
        </div>
      </div>

      {/* Messages */}
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-4 p-6">
          {messages.length === 0 && !isAgentRunning && (
            <div className="flex flex-col items-center justify-center gap-4 py-12 text-muted-foreground">
              <MessageSquare className="size-12 text-muted-foreground/30" />
              <div className="text-center">
                <p className="font-medium">Start a conversation</p>
                <p className="mt-1 text-sm">
                  Ask questions about your skill or request modifications.
                </p>
              </div>
            </div>
          )}

          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : ""}`}
            >
              <div
                className={`flex size-8 shrink-0 items-center justify-center rounded-full ${
                  msg.role === "assistant"
                    ? "bg-primary/10 text-primary"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {msg.role === "assistant" ? (
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
                {msg.role === "assistant" ? (
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

          {isAgentRunning && (
            <div className="flex gap-3">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Bot className="size-4" />
              </div>
              <Card className="px-4 py-3">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  Thinking...
                </div>
              </Card>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      {/* Input */}
      <div className="border-t bg-background p-4">
        <div className="flex items-end gap-2">
          <Textarea
            ref={textareaRef}
            value={userInput}
            onChange={(e) => setUserInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              isAgentRunning
                ? "Waiting for response..."
                : "Type a message... (Enter to send, Shift+Enter for newline)"
            }
            disabled={isAgentRunning}
            className="min-h-[60px] max-h-[160px] resize-none"
            rows={2}
          />
          <Button
            onClick={handleSend}
            disabled={isAgentRunning || !userInput.trim()}
            size="sm"
            className="h-10 px-4"
          >
            <Send className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
