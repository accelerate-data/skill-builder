import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useAgentStore } from "@/stores/agent-store";

interface AgentMessagePayload {
  agent_id: string;
  message: {
    type: string;
    message?: {
      content?: Array<{ type: string; text?: string }>;
    };
    result?: string;
    error?: string;
    usage?: { input_tokens?: number; output_tokens?: number };
    cost_usd?: number;
    [key: string]: unknown;
  };
}

interface AgentExitPayload {
  agent_id: string;
  success: boolean;
}

export function useAgentStream() {
  const addMessage = useAgentStore((s) => s.addMessage);
  const completeRun = useAgentStore((s) => s.completeRun);

  useEffect(() => {
    const unlistenMessage = listen<AgentMessagePayload>(
      "agent-message",
      (event) => {
        const { agent_id, message } = event.payload;

        let content: string | undefined;
        if (message.type === "assistant") {
          const textBlocks = message.message?.content?.filter(
            (b) => b.type === "text"
          );
          content = textBlocks?.map((b) => b.text).join("") || undefined;
        } else if (message.type === "result") {
          content = message.result || undefined;
        } else if (message.type === "error") {
          content = message.error || "Unknown error";
        }

        addMessage(agent_id, {
          type: message.type,
          content,
          raw: message as unknown as Record<string, unknown>,
          timestamp: Date.now(),
        });
      }
    );

    const unlistenExit = listen<AgentExitPayload>(
      "agent-exit",
      (event) => {
        completeRun(event.payload.agent_id, event.payload.success);
      }
    );

    return () => {
      unlistenMessage.then((fn) => fn());
      unlistenExit.then((fn) => fn());
    };
  }, [addMessage, completeRun]);
}
