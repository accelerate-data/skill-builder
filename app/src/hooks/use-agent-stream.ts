import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";
import { useAgentStore } from "@/stores/agent-store";
import { useRefineStore } from "@/stores/refine-store";
import { useWorkflowStore } from "@/stores/workflow-store";
import type { DisplayItem } from "@/lib/display-types";
import type {
  CompactionEvent,
  ContextWindowEvent,
  InitProgressEvent,
  RunConfigEvent,
  RunInitEvent,
  SessionExhaustedEvent,
  TurnUsageEvent,
} from "@/lib/agent-events";

interface AgentMessagePayload {
  agent_id: string;
  message: {
    type: string;
    item?: DisplayItem;
    [key: string]: unknown;
  };
}

type AgentRunConfigPayload = { agent_id: string; timestamp: number } & RunConfigEvent;
type AgentRunInitPayload = { agent_id: string; timestamp: number } & RunInitEvent;
type AgentTurnUsagePayload = { agent_id: string; timestamp: number } & TurnUsageEvent;
type AgentCompactionPayload = { agent_id: string; timestamp: number } & CompactionEvent;
type AgentContextWindowPayload = { agent_id: string; timestamp: number } & ContextWindowEvent;

interface AgentExitPayload {
  agent_id: string;
  success: boolean;
}

type AgentInitProgressPayload = { agent_id: string; timestamp: number } & InitProgressEvent;
type AgentSessionExhaustedPayload = { agent_id: string; timestamp: number } & SessionExhaustedEvent;

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
    const { agent_id, stage } = event.payload;
    console.debug(
      "[use-agent-stream] event=agent_init_progress component=ipc agent_id=%s stage=%s",
      agent_id,
      stage,
    );
    const progressMessage = INIT_PROGRESS_MESSAGES[stage];
    if (progressMessage) {
      const workflowState = useWorkflowStore.getState();
      if (workflowState.isInitializing) {
        workflowState.setInitProgressMessage(progressMessage);
      }
    }
  });

  listen<AgentSessionExhaustedPayload>("agent-session-exhausted", (event) => {
    const { agent_id, sessionId } = event.payload;
    console.debug(
      "[use-agent-stream] event=agent_session_exhausted component=ipc agent_id=%s session_id=%s",
      agent_id,
      sessionId,
    );
    useRefineStore.getState().setSessionExhausted(true);
    toast.info(
      "This refine session has reached its limit. Please start a new session to continue.",
      { duration: 5000 },
    );
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

  listen<AgentRunConfigPayload>("agent-run-config", (event) => {
    const { agent_id, ...runConfig } = event.payload;
    console.debug(
      "[use-agent-stream] event=agent_run_config component=ipc agent_id=%s",
      agent_id,
    );
    useAgentStore.getState().applyRunConfig(agent_id, runConfig);
  });

  listen<AgentRunInitPayload>("agent-run-init", (event) => {
    const { agent_id, ...runInit } = event.payload;
    console.debug(
      "[use-agent-stream] event=agent_run_init component=ipc agent_id=%s",
      agent_id,
    );
    useAgentStore.getState().applyRunInit(agent_id, runInit);
  });

  listen<AgentTurnUsagePayload>("agent-turn-usage", (event) => {
    const { agent_id, ...turnUsage } = event.payload;
    console.debug(
      "[use-agent-stream] event=agent_turn_usage component=ipc agent_id=%s turn=%d",
      agent_id,
      turnUsage.turn,
    );
    useAgentStore.getState().applyTurnUsage(agent_id, turnUsage);
  });

  listen<AgentCompactionPayload>("agent-compaction", (event) => {
    const { agent_id, ...compaction } = event.payload;
    console.debug(
      "[use-agent-stream] event=agent_compaction component=ipc agent_id=%s turn=%d",
      agent_id,
      compaction.turn,
    );
    useAgentStore.getState().applyCompaction(agent_id, compaction);
  });

  listen<AgentContextWindowPayload>("agent-context-window", (event) => {
    const { agent_id, ...contextWindow } = event.payload;
    console.debug(
      "[use-agent-stream] event=agent_context_window component=ipc agent_id=%s",
      agent_id,
    );
    useAgentStore.getState().applyContextWindow(agent_id, contextWindow);
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
      console.debug(
        "[use-agent-stream] event=display_item agent_id=%s item_type=%s item_id=%s",
        agent_id,
        message.item.type,
        message.item.id,
      );
      agentStore.addDisplayItem(agent_id, message.item);
      return;
    }

    // Log unhandled message types at debug level for troubleshooting
    console.debug(
      "[use-agent-stream] event=unhandled_message agent_id=%s msg_type=%s",
      agent_id,
      message.type,
    );
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
