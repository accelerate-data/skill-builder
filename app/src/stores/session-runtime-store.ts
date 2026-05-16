import { create } from "zustand";
import { useWorkflowStore } from "./workflow-store";
import type {
  CompactionEvent,
  ContextWindowEvent,
  RunConfigEvent,
  RunInitEvent,
  TurnUsageEvent,
} from "@/lib/agent-events";
import type { OpenHandsConversationState } from "@/lib/openhands-conversation-events";
import { isTerminalConversationStatus } from "@/lib/openhands-conversation-events";
import { formatProviderModelId } from "@/lib/models";

type PendingTerminalStatus = "completed" | "error" | "shutdown";

interface PendingTerminalEvent {
  status: PendingTerminalStatus;
  errorDetail?: string;
}

type PendingRuntimeEvent =
  | ({ _tag: "run_config" } & RunConfigEvent)
  | ({ _tag: "run_init" } & RunInitEvent)
  | ({ _tag: "turn_usage" } & TurnUsageEvent)
  | ({ _tag: "compaction" } & CompactionEvent)
  | ({ _tag: "context_window" } & ContextWindowEvent);

interface ContextSnapshot {
  turn: number;
  inputTokens: number;
  outputTokens: number;
}

interface CompactionRecord {
  turn: number;
  preTokens: number;
  timestamp: number;
}

type ResultSubtype =
  | "success"
  | "error_max_turns"
  | "error_during_execution"
  | "error_max_budget_usd"
  | "error_max_result_payload_retries";

type StopReason =
  | "end_turn"
  | "max_tokens"
  | "stop_sequence"
  | "tool_use"
  | "pause_turn"
  | "refusal"
  | "model_context_window_exceeded";

interface ModelUsageBreakdown {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cost: number;
}

export interface SessionRuntimeRun {
  conversationId: string;
  model: string;
  status: "running" | "completed" | "error" | "shutdown";
  conversationState?: OpenHandsConversationState;
  startTime: number;
  endTime?: number;
  totalCost?: number;
  tokenUsage?: { input: number; output: number };
  sessionId?: string;
  skillName?: string;
  contextHistory: ContextSnapshot[];
  contextWindow: number;
  compactionEvents: CompactionRecord[];
  thinkingEnabled: boolean;
  agentName?: string;
  resultSubtype?: ResultSubtype;
  resultErrors?: string[];
  stopReason?: StopReason;
  numTurns?: number;
  durationApiMs?: number | null;
  modelUsageBreakdown?: ModelUsageBreakdown[];
  runSource?: "workflow" | "workspace" | "test";
  usageSessionId?: string;
  promptSuggestion?: string;
}

interface SessionRuntimeState {
  runs: Record<string, SessionRuntimeRun>;
  transportConversationIds: Record<string, string>;
  pendingTerminal: Record<string, PendingTerminalEvent>;
  pendingMetadata: Record<string, PendingRuntimeEvent[]>;
  startSessionRun: (conversationId: string, model: string) => void;
  registerSessionRun: (
    conversationId: string,
    model: string,
    skillName?: string,
    runSource?: SessionRuntimeRun["runSource"],
    usageSessionId?: string,
  ) => void;
  bindTransportRun: (transportId: string, conversationId: string) => void;
  applyConversationState: (conversationId: string, event: OpenHandsConversationState) => void;
  applyRunConfig: (transportId: string, event: RunConfigEvent) => void;
  applyRunInit: (transportId: string, event: RunInitEvent) => void;
  applyTurnUsage: (transportId: string, event: TurnUsageEvent) => void;
  applyCompaction: (transportId: string, event: CompactionEvent) => void;
  applyContextWindow: (transportId: string, event: ContextWindowEvent) => void;
  setPromptSuggestion: (transportId: string, suggestion: string) => void;
  completeRun: (
    transportId: string,
    success: boolean,
    errorDetail?: string,
  ) => void;
  shutdownRun: (transportId: string) => void;
  clearSessionRuns: () => void;
  clearRunsBySource: (source: NonNullable<SessionRuntimeRun["runSource"]>) => void;
}

const DEFAULT_CONTEXT_WINDOW = 200_000;

function createBaseRun(
  conversationId: string,
  model: string,
  overrides: Partial<SessionRuntimeRun> = {},
): SessionRuntimeRun {
  return {
    conversationId,
    model,
    status: "running",
    startTime: Date.now(),
    contextHistory: [],
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    compactionEvents: [],
    thinkingEnabled: false,
    ...overrides,
  };
}

function pendingMetadataUpdate(
  state: SessionRuntimeState,
  transportId: string,
  event: PendingRuntimeEvent,
): Partial<SessionRuntimeState> {
  const existing = state.pendingMetadata[transportId] ?? [];
  return {
    pendingMetadata: {
      ...state.pendingMetadata,
      [transportId]: [...existing, event],
    },
  };
}

function queuePendingTerminal(
  transportId: string,
  status: PendingTerminalStatus,
  errorDetail?: string,
) {
  const state = useSessionRuntimeStore.getState();
  const existing = state.pendingTerminal[transportId];
  if (!existing || existing.status === "shutdown") {
    useSessionRuntimeStore.setState({
      pendingTerminal: {
        ...state.pendingTerminal,
        [transportId]: { status, errorDetail },
      },
    });
  }
}

function resolveConversationId(state: SessionRuntimeState, transportId: string): string | null {
  return state.transportConversationIds[transportId] ?? null;
}

function drainPendingTerminal(transportId: string) {
  const state = useSessionRuntimeStore.getState();
  const pending = state.pendingTerminal[transportId];
  const conversationId = resolveConversationId(state, transportId);
  if (!pending || !conversationId || !state.runs[conversationId]) return;

  const { [transportId]: _removed, ...rest } = state.pendingTerminal;
  useSessionRuntimeStore.setState({ pendingTerminal: rest });

  if (pending.status === "shutdown") {
    useSessionRuntimeStore.getState().shutdownRun(transportId);
    return;
  }
  useSessionRuntimeStore
    .getState()
    .completeRun(
      transportId,
      pending.status === "completed",
      pending.errorDetail,
    );
}

function drainPendingMetadata(transportId: string) {
  const state = useSessionRuntimeStore.getState();
  const pending = state.pendingMetadata[transportId];
  const conversationId = resolveConversationId(state, transportId);
  if (!pending || pending.length === 0 || !conversationId || !state.runs[conversationId]) {
    return;
  }

  const { [transportId]: _removed, ...rest } = state.pendingMetadata;
  useSessionRuntimeStore.setState({ pendingMetadata: rest });

  for (const event of pending) {
    const store = useSessionRuntimeStore.getState();
    switch (event._tag) {
      case "run_config":
        store.applyRunConfig(transportId, event);
        break;
      case "run_init":
        store.applyRunInit(transportId, event);
        break;
      case "turn_usage":
        store.applyTurnUsage(transportId, event);
        break;
      case "compaction":
        store.applyCompaction(transportId, event);
        break;
      case "context_window":
        store.applyContextWindow(transportId, event);
        break;
    }
  }
}

export function resetSessionRuntimeStoreInternals() {
  useSessionRuntimeStore.setState({
    transportConversationIds: {},
    pendingTerminal: {},
    pendingMetadata: {},
  });
}

export function formatModelName(model: string): string {
  return formatProviderModelId(model);
}

export function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return String(tokens);
}

export function getLatestContextTokens(run: SessionRuntimeRun): number {
  if (run.contextHistory.length === 0) return 0;
  return run.contextHistory[run.contextHistory.length - 1].inputTokens;
}

export function getContextUtilization(run: SessionRuntimeRun): number {
  const tokens = getLatestContextTokens(run);
  if (run.contextWindow <= 0) return 0;
  return Math.min(100, (tokens / run.contextWindow) * 100);
}

export const useSessionRuntimeStore = create<SessionRuntimeState>((set) => ({
  runs: {},
  transportConversationIds: {},
  pendingTerminal: {},
  pendingMetadata: {},

  startSessionRun: (conversationId, model) => {
    const workflow = useWorkflowStore.getState();
    const skillName = workflow.skillName ?? "unknown";

    set((state) => {
      const existing = state.runs[conversationId];
      return {
        runs: {
          ...state.runs,
          [conversationId]: existing
            ? {
                ...existing,
                model,
                skillName,
                status: (
                  ["completed", "error", "shutdown"] as string[]
                ).includes(existing.status)
                  ? existing.status
                  : "running",
              }
            : createBaseRun(conversationId, model, {
                skillName,
                runSource: "workflow",
              }),
        },
        transportConversationIds: {
          ...state.transportConversationIds,
          [conversationId]: conversationId,
        },
      };
    });
    drainPendingTerminal(conversationId);
    drainPendingMetadata(conversationId);
  },

  registerSessionRun: (
    conversationId,
    model,
    skillName,
    runSource = "workspace",
    usageSessionId,
  ) => {
    set((state) => {
      const existing = state.runs[conversationId];
      return {
        runs: {
          ...state.runs,
          [conversationId]: existing
            ? {
                ...existing,
                model,
                skillName: skillName ?? existing.skillName,
                status: (
                  ["completed", "error", "shutdown"] as string[]
                ).includes(existing.status)
                  ? existing.status
                  : "running",
                runSource,
                usageSessionId: usageSessionId ?? existing.usageSessionId,
              }
            : createBaseRun(conversationId, model, {
                skillName,
                runSource,
                usageSessionId,
              }),
        },
        transportConversationIds: {
          ...state.transportConversationIds,
          [conversationId]: conversationId,
        },
      };
    });
    drainPendingTerminal(conversationId);
    drainPendingMetadata(conversationId);
  },

  bindTransportRun: (transportId, conversationId) => {
    if (!transportId || !conversationId) return;
    set((state) => ({
      transportConversationIds: {
        ...state.transportConversationIds,
        [transportId]: conversationId,
      },
    }));
    drainPendingTerminal(transportId);
    drainPendingMetadata(transportId);
  },

  applyConversationState: (conversationId, event) =>
    set((state) => {
      const run = state.runs[conversationId];
      const now = Date.now();
      const nextStatus =
        event.status === "completed"
          ? "completed"
          : event.status === "error"
            ? "error"
            : event.status === "cancelled"
              ? "shutdown"
              : "running";
      const nextEndTime = isTerminalConversationStatus(event.status)
        ? (run?.endTime ?? now)
        : run?.endTime;
      const nextResultErrors =
        event.errorDetail && event.status === "error"
          ? [event.errorDetail]
          : run?.resultErrors;

      if (!run) {
        return {
          runs: {
            ...state.runs,
            [conversationId]: createBaseRun(conversationId, "unknown", {
              status: nextStatus,
              conversationState: event,
              endTime: nextEndTime,
              resultErrors: nextResultErrors,
            }),
          },
        };
      }

      if (run.status !== "running" && nextStatus === "running") {
        return {
          runs: {
            ...state.runs,
            [conversationId]: {
              ...run,
              conversationState: event,
            },
          },
        };
      }

      return {
        runs: {
          ...state.runs,
          [conversationId]: {
            ...run,
            status: nextStatus,
            conversationState: event,
            endTime: nextEndTime,
            resultErrors: nextResultErrors,
          },
        },
      };
    }),

  applyRunConfig: (transportId, event) =>
    set((state) => {
      const conversationId = resolveConversationId(state, transportId);
      const run = conversationId ? state.runs[conversationId] : undefined;
      if (!run) {
        return pendingMetadataUpdate(state, transportId, {
          _tag: "run_config",
          ...event,
        });
      }
      const key = conversationId as string;

      return {
        runs: {
          ...state.runs,
          [key]: {
            ...run,
            thinkingEnabled: event.thinkingEnabled,
            agentName: event.agentName ?? run.agentName,
          },
        },
      };
    }),

  applyRunInit: (transportId, event) =>
    set((state) => {
      const conversationId = resolveConversationId(state, transportId);
      const run = conversationId ? state.runs[conversationId] : undefined;
      if (!run) {
        return pendingMetadataUpdate(state, transportId, {
          _tag: "run_init",
          ...event,
        });
      }
      const key = conversationId as string;

      return {
        runs: {
          ...state.runs,
          [key]: {
            ...run,
            sessionId: event.sessionId,
            model: event.model,
          },
        },
      };
    }),

  applyTurnUsage: (transportId, event) =>
    set((state) => {
      const conversationId = resolveConversationId(state, transportId);
      const run = conversationId ? state.runs[conversationId] : undefined;
      if (!run) {
        return pendingMetadataUpdate(state, transportId, {
          _tag: "turn_usage",
          ...event,
        });
      }
      const key = conversationId as string;

      return {
        runs: {
          ...state.runs,
          [key]: {
            ...run,
            contextHistory: [
              ...run.contextHistory,
              {
                turn: event.turn,
                inputTokens: event.inputTokens,
                outputTokens: event.outputTokens,
              },
            ],
          },
        },
      };
    }),

  applyCompaction: (transportId, event) =>
    set((state) => {
      const conversationId = resolveConversationId(state, transportId);
      const run = conversationId ? state.runs[conversationId] : undefined;
      if (!run) {
        return pendingMetadataUpdate(state, transportId, {
          _tag: "compaction",
          ...event,
        });
      }
      const key = conversationId as string;

      return {
        runs: {
          ...state.runs,
          [key]: {
            ...run,
            compactionEvents: [
              ...run.compactionEvents,
              {
                turn: event.turn,
                preTokens: event.preTokens,
                timestamp: event.timestamp,
              },
            ],
          },
        },
      };
    }),

  applyContextWindow: (transportId, event) =>
    set((state) => {
      const conversationId = resolveConversationId(state, transportId);
      const run = conversationId ? state.runs[conversationId] : undefined;
      if (!run) {
        return pendingMetadataUpdate(state, transportId, {
          _tag: "context_window",
          ...event,
        });
      }

      if (event.contextWindow <= 0) {
        return state;
      }
      const key = conversationId as string;

      return {
        runs: {
          ...state.runs,
          [key]: {
            ...run,
            contextWindow: event.contextWindow,
          },
        },
      };
    }),

  setPromptSuggestion: (transportId, suggestion) =>
    set((state) => {
      const conversationId = resolveConversationId(state, transportId);
      const run = conversationId ? state.runs[conversationId] : undefined;
      if (!run) return {};
      const key = conversationId as string;
      return {
        runs: {
          ...state.runs,
          [key]: { ...run, promptSuggestion: suggestion },
        },
      };
    }),

  completeRun: (transportId, success, errorDetail) => {
    const state = useSessionRuntimeStore.getState();
    const conversationId = resolveConversationId(state, transportId);
    if (!conversationId || !state.runs[conversationId]) {
      queuePendingTerminal(
        transportId,
        success ? "completed" : "error",
        errorDetail,
      );
      return;
    }

    set((state) => {
      const run = state.runs[conversationId];
      if (!run) return state;
      if (run.status !== "running") {
        const nextErrors = errorDetail ? [errorDetail] : run.resultErrors;
        if (run.endTime !== undefined) {
          if (nextErrors === run.resultErrors) return state;
          return {
            runs: {
              ...state.runs,
              [conversationId]: {
                ...run,
                resultErrors: nextErrors,
              },
            },
          };
        }
        return {
          runs: {
            ...state.runs,
            [conversationId]: {
              ...run,
              endTime: Date.now(),
              resultErrors: nextErrors,
            },
          },
        };
      }

      return {
        runs: {
          ...state.runs,
          [conversationId]: {
            ...run,
            status: success ? "completed" : "error",
            endTime: Date.now(),
            resultErrors: errorDetail ? [errorDetail] : run.resultErrors,
          },
        },
      };
    });
  },

  shutdownRun: (transportId) => {
    const state = useSessionRuntimeStore.getState();
    const conversationId = resolveConversationId(state, transportId);
    if (!conversationId || !state.runs[conversationId]) {
      queuePendingTerminal(transportId, "shutdown");
      return;
    }

    set((state) => {
      const run = state.runs[conversationId];
      if (!run || run.status !== "running") return state;
      return {
        runs: {
          ...state.runs,
          [conversationId]: {
            ...run,
            status: "shutdown",
            endTime: Date.now(),
          },
        },
      };
    });
  },

  clearSessionRuns: () =>
    set({
      runs: {},
      transportConversationIds: {},
      pendingTerminal: {},
      pendingMetadata: {},
    }),

  clearRunsBySource: (source) =>
    set((state) => ({
      runs: Object.fromEntries(
        Object.entries(state.runs).filter(([, run]) => run.runSource !== source),
      ),
      transportConversationIds: Object.fromEntries(
        Object.entries(state.transportConversationIds).filter(
          ([, conversationId]) => {
            const run = state.runs[conversationId];
            return run && run.runSource !== source;
          },
        ),
      ),
      pendingTerminal: Object.fromEntries(
        Object.entries(state.pendingTerminal).filter(([transportId]) => {
          const conversationId = state.transportConversationIds[transportId];
          const run = conversationId ? state.runs[conversationId] : undefined;
          return run && run.runSource !== source;
        }),
      ),
      pendingMetadata: Object.fromEntries(
        Object.entries(state.pendingMetadata).filter(([transportId]) => {
          const conversationId = state.transportConversationIds[transportId];
          const run = conversationId ? state.runs[conversationId] : undefined;
          return run && run.runSource !== source;
        }),
      ),
    })),
}));
