import { listen } from "@tauri-apps/api/event";
import { useAgentStore } from "@/stores/agent-store";
import { useWorkflowStore } from "@/stores/workflow-store";

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

interface AgentInitProgressPayload {
  agent_id: string;
  subtype: string;
  timestamp: number;
}

/** Map sidecar system event subtypes to user-facing progress messages. */
const INIT_PROGRESS_MESSAGES: Record<string, string> = {
  init_start: "Loading SDK modules...",
  sdk_ready: "Connecting to API...",
};

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

  listen<AgentInitProgressPayload>("agent-init-progress", (event) => {
    if (shuttingDown) return;
    const { subtype } = event.payload;
    const progressMessage = INIT_PROGRESS_MESSAGES[subtype];
    if (progressMessage) {
      const workflowState = useWorkflowStore.getState();
      if (workflowState.isInitializing) {
        workflowState.setInitProgressMessage(progressMessage);
      }
    }
  });

  listen<AgentMessagePayload>("agent-message", (event) => {
    if (shuttingDown) return;
    const { agent_id, message } = event.payload;

    // Clear the "initializing" spinner on the first message from the agent.
    // This is idempotent — subsequent messages are a no-op when already cleared.
    const workflowState = useWorkflowStore.getState();
    if (workflowState.isInitializing) {
      workflowState.clearInitializing();
    }

    useAgentStore.getState().addMessage(agent_id, {
      type: message.type,
      content: parseContent(message),
      raw: message as unknown as Record<string, unknown>,
      timestamp: Date.now(),
    });
  });

  listen<AgentExitPayload>("agent-exit", (event) => {
    if (shuttingDown) return;
    useAgentStore.getState().completeRun(
      event.payload.agent_id,
      event.payload.success
    );
  });
}

// Initialize eagerly on module load
initAgentStream();

/** Reset module-level singleton state for tests. */
export function _resetForTesting() {
  initialized = false;
}
