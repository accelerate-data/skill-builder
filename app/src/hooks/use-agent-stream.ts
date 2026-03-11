import { listen } from "@tauri-apps/api/event";
import { useAgentStore } from "@/stores/agent-store";
import { useWorkflowStore } from "@/stores/workflow-store";
import type { DisplayItem } from "@/lib/display-types";

interface AgentMessagePayload {
  agent_id: string;
  message: {
    type: string;
    // display_item envelope
    item?: DisplayItem;
    // raw SDK message fields (for pass-through result/assistant/error)
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

interface AgentInitErrorPayload {
  error_type: string;
  message: string;
  fix_hint: string;
}

/** Map sidecar system event subtypes to user-facing progress messages. */
const INIT_PROGRESS_MESSAGES: Record<string, string> = {
  init_start: "Loading SDK modules...",
  sdk_ready: "Connecting to API...",
};

/**
 * Extract text content from a pass-through raw message.
 * Only used for result/error messages that still need content extraction.
 * Assistant messages are now handled as DisplayItems by the sidecar.
 */
function parseContent(message: AgentMessagePayload["message"]): string | undefined {
  if (message.type === "assistant") {
    // Pass-through assistant messages (for usage tracking) — extract text for backward compat
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

interface AgentShutdownPayload {
  agent_id: string;
}

export function initAgentStream() {
  if (initialized) return;
  initialized = true;

  listen<AgentInitProgressPayload>("agent-init-progress", (event) => {
    const { subtype } = event.payload;
    const progressMessage = INIT_PROGRESS_MESSAGES[subtype];
    if (progressMessage) {
      const workflowState = useWorkflowStore.getState();
      if (workflowState.isInitializing) {
        workflowState.setInitProgressMessage(progressMessage);
      }
    }
  });

  listen<AgentInitErrorPayload>("agent-init-error", (event) => {
    const workflowState = useWorkflowStore.getState();
    workflowState.clearInitializing();
    workflowState.setRuntimeError({
      error_type: event.payload.error_type,
      message: event.payload.message,
      fix_hint: event.payload.fix_hint,
    });
  });

  listen<AgentMessagePayload>("agent-message", (event) => {
    const { agent_id, message } = event.payload;

    // Clear the "initializing" spinner on the first message from the agent.
    const workflowState = useWorkflowStore.getState();
    if (workflowState.isInitializing) {
      workflowState.clearInitializing();
      workflowState.clearRuntimeError();
    }

    const agentStore = useAgentStore.getState();

    if (message.type === "display_item" && message.item) {
      // Structured display item from sidecar — route to DisplayItem store
      console.debug(
        "[use-agent-stream] event=display_item agent_id=%s item_type=%s item_id=%s",
        agent_id,
        message.item.type,
        message.item.id,
      );
      agentStore.addDisplayItem(agent_id, message.item);
      return;
    }

    // Pass-through messages (result, assistant, system, error)
    // These still go to the existing message store for usage tracking,
    // structured_output extraction, config/session tracking, etc.
    console.debug(
      "[use-agent-stream] event=pass_through agent_id=%s msg_type=%s",
      agent_id,
      message.type,
    );
    agentStore.addMessage(agent_id, {
      type: message.type,
      content: parseContent(message),
      raw: message as unknown as Record<string, unknown>,
      timestamp: Date.now(),
    });
  });

  listen<AgentExitPayload>("agent-exit", (event) => {
    useAgentStore.getState().completeRun(
      event.payload.agent_id,
      event.payload.success
    );
  });

  listen<AgentShutdownPayload>("agent-shutdown", (event) => {
    useAgentStore.getState().shutdownRun(event.payload.agent_id);
  });
}

// Initialize eagerly on module load
initAgentStream();

/** Reset module-level singleton state for tests. */
export function _resetForTesting() {
  initialized = false;
}
