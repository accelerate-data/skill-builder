import { listen } from "@tauri-apps/api/event";
import { toast } from "@/lib/toast";
import { useConversationStore } from "@/stores/conversation-store";
import { useSessionRuntimeStore } from "@/stores/session-runtime-store";
import { useSkillStore } from "@/stores/skill-store";
import { useWorkflowStore } from "@/stores/workflow-store";
import { invalidateUsageDataAfterAgentRun } from "@/lib/queries/agent-stream-cache";
import {
  buildCanonicalConversationEventEnvelope,
  getReasoningText,
  isTerminalConversationStatus,
  normalizeConversationEventMessage,
  normalizeConversationStateMessage,
} from "@/lib/openhands-conversation-events";
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
  error_detail?: string;
}

type AgentInitProgressPayload = { agent_id: string; timestamp: number } & InitProgressEvent;
type AgentSessionExhaustedPayload = { agent_id: string; timestamp: number } & SessionExhaustedEvent;

interface AgentInitErrorPayload {
  error_type: string;
  message: string;
  fix_hint: string;
}

interface AgentShutdownPayload {
  agent_id: string;
}

const INIT_PROGRESS_MESSAGES: Record<string, string> = {
  init_start: "Loading runtime modules...",
  runtime_ready: "Connecting to API...",
};

let initialized = false;
let initPromise: Promise<void> | null = null;
let unlisteners: Array<() => void> = [];

function selectedConversationId(): string | null {
  return useSkillStore.getState().conversationId;
}

function appendCanonicalRuntimeEvent(
  event: ReturnType<typeof normalizeConversationEventMessage> | ReturnType<typeof normalizeConversationStateMessage>,
) {
  if (!event) return;

  try {
    const envelope = buildCanonicalConversationEventEnvelope(
      event,
      selectedConversationId(),
    );
    useConversationStore.getState().appendBackendObservedEvent(envelope);
  } catch (error) {
    console.warn(
      "[use-session-runtime-stream] event=canonical_event_skipped reason=%s",
      error instanceof Error ? error.message : String(error),
    );
  }
}

export async function initSessionRuntimeStream() {
  if (initialized) return;
  if (initPromise) return initPromise;

  function reg<T>(event: string, handler: (e: { payload: T }) => void): Promise<void> {
    return listen<T>(event, handler).then((unlisten) => {
      unlisteners.push(unlisten);
    });
  }

  initPromise = Promise.all([
    reg<AgentInitProgressPayload>("agent-init-progress", (event) => {
      const { agent_id, stage } = event.payload;
      console.debug(
        "[use-session-runtime-stream] event=agent_init_progress agent_id=%s stage=%s",
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
    }),
    reg<AgentSessionExhaustedPayload>("agent-session-exhausted", (event) => {
      const { agent_id, sessionId } = event.payload;
      console.debug(
        "[use-session-runtime-stream] event=agent_session_exhausted agent_id=%s session_id=%s",
        agent_id,
        sessionId,
      );
      toast.info("Session limit reached. Start a new session to continue.");
    }),
    reg<AgentInitErrorPayload>("agent-init-error", (event) => {
      const workflowState = useWorkflowStore.getState();
      workflowState.clearInitializing();
      workflowState.setRuntimeError({
        error_type: event.payload.error_type,
        message: event.payload.message,
        fix_hint: event.payload.fix_hint,
      });
    }),
    reg<AgentRunConfigPayload>("agent-run-config", (event) => {
      const { agent_id, ...runConfig } = event.payload;
      useSessionRuntimeStore.getState().applyRunConfig(agent_id, runConfig);
    }),
    reg<AgentRunInitPayload>("agent-run-init", (event) => {
      const { agent_id, ...runInit } = event.payload;
      useSessionRuntimeStore.getState().applyRunInit(agent_id, runInit);
    }),
    reg<AgentTurnUsagePayload>("agent-turn-usage", (event) => {
      const { agent_id, ...turnUsage } = event.payload;
      useSessionRuntimeStore.getState().applyTurnUsage(agent_id, turnUsage);
    }),
    reg<AgentCompactionPayload>("agent-compaction", (event) => {
      const { agent_id, ...compaction } = event.payload;
      useSessionRuntimeStore.getState().applyCompaction(agent_id, compaction);
    }),
    reg<AgentContextWindowPayload>("agent-context-window", (event) => {
      const { agent_id, ...contextWindow } = event.payload;
      useSessionRuntimeStore.getState().applyContextWindow(agent_id, contextWindow);
    }),
    reg<AgentMessagePayload>("agent-message", (event) => {
      const { agent_id, message } = event.payload;

      const workflowState = useWorkflowStore.getState();
      if (workflowState.isInitializing) {
        workflowState.clearInitializing();
        workflowState.clearRuntimeError();
      }

      const runtimeStore = useSessionRuntimeStore.getState();

      if (message.type === "conversation_event") {
        const conversationEvent = normalizeConversationEventMessage(message);
        if (conversationEvent) {
          appendCanonicalRuntimeEvent(conversationEvent);
          const reasoningText = getReasoningText(conversationEvent);
          console.debug(
            "[use-session-runtime-stream] event=conversation_event agent_id=%s event_class=%s reasoning_len=%d",
            agent_id,
            conversationEvent.eventClass,
            reasoningText?.length ?? 0,
          );
          return;
        }
      }

      if (message.type === "conversation_state") {
        const conversationState = normalizeConversationStateMessage(message);
        if (conversationState) {
          appendCanonicalRuntimeEvent(conversationState);
          runtimeStore.applyConversationState(agent_id, conversationState);
          if (isTerminalConversationStatus(conversationState.status)) {
            invalidateUsageDataAfterAgentRun().catch((error) => {
              console.warn(
                "[use-session-runtime-stream] event=invalidate_usage_failed error=%s",
                error,
              );
            });
          }
          return;
        }
      }

      if (message.type === "agent_event") {
        const eventPayload = message.event as Record<string, unknown> | undefined;
        if (
          eventPayload?.type === "prompt_suggestion" &&
          typeof eventPayload.suggestion === "string"
        ) {
          runtimeStore.setPromptSuggestion(agent_id, eventPayload.suggestion);
          return;
        }
      }

      console.debug(
        "[use-session-runtime-stream] event=unhandled_message agent_id=%s msg_type=%s",
        agent_id,
        message.type,
      );
    }),
    reg<AgentExitPayload>("agent-exit", (event) => {
      useSessionRuntimeStore.getState().completeRun(
        event.payload.agent_id,
        event.payload.success,
        event.payload.error_detail,
      );
      invalidateUsageDataAfterAgentRun().catch((error) => {
        console.warn(
          "[use-session-runtime-stream] event=invalidate_usage_failed error=%s",
          error,
        );
      });
    }),
    reg<AgentShutdownPayload>("agent-shutdown", (event) => {
      useSessionRuntimeStore.getState().shutdownRun(event.payload.agent_id);
    }),
    listen<{ reason: string; conversation_id: string }>("skill-session-reset", () => {
      toast.warning("Previous session not found — started a new conversation.", {
        duration: Infinity,
      });
    }).then((unlisten) => {
      unlisteners.push(unlisten);
    }),
  ])
    .then(() => {
      initialized = true;
    })
    .catch((error) => {
      initPromise = null;
      initialized = false;
      throw error;
    });

  return initPromise;
}

void initSessionRuntimeStream().catch((error) => {
  console.warn(
    "[use-session-runtime-stream] initial listener registration failed: %s",
    error,
  );
});

export async function _resetForTesting() {
  await Promise.all(unlisteners.map((fn) => fn()));
  unlisteners = [];
  initialized = false;
  initPromise = null;
}
