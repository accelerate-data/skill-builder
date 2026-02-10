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
  cancelled?: boolean;
}

function parseContent(message: AgentMessagePayload["message"]): string | undefined {
  if (message.type === "assistant") {
    const textBlocks = message.message?.content?.filter(
      (b) => b.type === "text"
    );
    return textBlocks?.map((b) => b.text).join("") || undefined;
  } else if (message.type === "result") {
    return message.result || undefined;
  } else if (message.type === "error") {
    return message.error || "Unknown error";
  }
  return undefined;
}

// Module-level singleton subscription.  We subscribe eagerly at import time
// so the listener is active before any agent can be started.  This eliminates
// the race condition where Tauri events arrive before a React effect sets up
// the listener.
let initialized = false;
let shuttingDown = false;

/** Call before destroying the window to suppress late agent-exit error events. */
export function markShuttingDown() {
  shuttingDown = true;
}

export function initAgentStream() {
  if (initialized) return;
  initialized = true;

  listen<AgentMessagePayload>("agent-message", (event) => {
    if (shuttingDown) return;
    const { agent_id, message } = event.payload;

    useAgentStore.getState().addMessage(agent_id, {
      type: message.type,
      content: parseContent(message),
      raw: message as unknown as Record<string, unknown>,
      timestamp: Date.now(),
    });
  });

  listen<AgentExitPayload>("agent-exit", (event) => {
    if (shuttingDown) return;
    if (event.payload.cancelled) {
      useAgentStore.getState().cancelRun(event.payload.agent_id);
    } else {
      useAgentStore.getState().completeRun(
        event.payload.agent_id,
        event.payload.success
      );
    }
  });
}

// Initialize eagerly on module load
initAgentStream();

/** Reset module-level singleton state for tests. */
export function _resetForTesting() {
  initialized = false;
}
