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
  agentId: string;
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
  pendingTerminal: Record<string, PendingTerminalEvent>;
  pendingMetadata: Record<string, PendingRuntimeEvent[]>;
  startSessionRun: (agentId: string, model: string) => void;
  registerSessionRun: (
    agentId: string,
    model: string,
    skillName?: string,
    runSource?: SessionRuntimeRun["runSource"],
    usageSessionId?: string,
  ) => void;
  applyConversationState: (
    agentId: string,
    event: OpenHandsConversationState,
  ) => void;
  applyRunConfig: (agentId: string, event: RunConfigEvent) => void;
  applyRunInit: (agentId: string, event: RunInitEvent) => void;
  applyTurnUsage: (agentId: string, event: TurnUsageEvent) => void;
  applyCompaction: (agentId: string, event: CompactionEvent) => void;
  applyContextWindow: (agentId: string, event: ContextWindowEvent) => void;
  setPromptSuggestion: (agentId: string, suggestion: string) => void;
  completeRun: (
    agentId: string,
    success: boolean,
    errorDetail?: string,
  ) => void;
  shutdownRun: (agentId: string) => void;
  clearSessionRuns: () => void;
  clearRunsBySource: (source: NonNullable<SessionRuntimeRun["runSource"]>) => void;
}

const DEFAULT_CONTEXT_WINDOW = 200_000;

function createBaseRun(
  agentId: string,
  model: string,
  overrides: Partial<SessionRuntimeRun> = {},
): SessionRuntimeRun {
  return {
    agentId,
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
  agentId: string,
  event: PendingRuntimeEvent,
): Partial<SessionRuntimeState> {
  const existing = state.pendingMetadata[agentId] ?? [];
  return {
    pendingMetadata: {
      ...state.pendingMetadata,
      [agentId]: [...existing, event],
    },
  };
}

function queuePendingTerminal(
  agentId: string,
  status: PendingTerminalStatus,
  errorDetail?: string,
) {
  const state = useSessionRuntimeStore.getState();
  const existing = state.pendingTerminal[agentId];
  if (!existing || existing.status === "shutdown") {
    useSessionRuntimeStore.setState({
      pendingTerminal: {
        ...state.pendingTerminal,
        [agentId]: { status, errorDetail },
      },
    });
  }
}

function drainPendingTerminal(agentId: string) {
  const state = useSessionRuntimeStore.getState();
  const pending = state.pendingTerminal[agentId];
  if (!pending || !state.runs[agentId]) return;

  const { [agentId]: _removed, ...rest } = state.pendingTerminal;
  useSessionRuntimeStore.setState({ pendingTerminal: rest });

  if (pending.status === "shutdown") {
    useSessionRuntimeStore.getState().shutdownRun(agentId);
    return;
  }
  useSessionRuntimeStore
    .getState()
    .completeRun(agentId, pending.status === "completed", pending.errorDetail);
}

function drainPendingMetadata(agentId: string) {
  const state = useSessionRuntimeStore.getState();
  const pending = state.pendingMetadata[agentId];
  if (!pending || pending.length === 0 || !state.runs[agentId]) return;

  const { [agentId]: _removed, ...rest } = state.pendingMetadata;
  useSessionRuntimeStore.setState({ pendingMetadata: rest });

  for (const event of pending) {
    const store = useSessionRuntimeStore.getState();
    switch (event._tag) {
      case "run_config":
        store.applyRunConfig(agentId, event);
        break;
      case "run_init":
        store.applyRunInit(agentId, event);
        break;
      case "turn_usage":
        store.applyTurnUsage(agentId, event);
        break;
      case "compaction":
        store.applyCompaction(agentId, event);
        break;
      case "context_window":
        store.applyContextWindow(agentId, event);
        break;
    }
  }
}

export function resetSessionRuntimeStoreInternals() {
  useSessionRuntimeStore.setState({ pendingTerminal: {}, pendingMetadata: {} });
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
  pendingTerminal: {},
  pendingMetadata: {},

  startSessionRun: (agentId, model) => {
    const workflow = useWorkflowStore.getState();
    const skillName = workflow.skillName ?? "unknown";

    set((state) => {
      const existing = state.runs[agentId];
      return {
        runs: {
          ...state.runs,
          [agentId]: existing
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
            : createBaseRun(agentId, model, {
                skillName,
                runSource: "workflow",
              }),
        },
      };
    });

    drainPendingTerminal(agentId);
    drainPendingMetadata(agentId);
  },

  registerSessionRun: (
    agentId,
    model,
    skillName,
    runSource = "workspace",
    usageSessionId,
  ) => {
    set((state) => {
      const existing = state.runs[agentId];
      return {
        runs: {
          ...state.runs,
          [agentId]: existing
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
            : createBaseRun(agentId, model, {
                skillName,
                runSource,
                usageSessionId,
              }),
        },
      };
    });

    drainPendingTerminal(agentId);
    drainPendingMetadata(agentId);
  },

  applyConversationState: (agentId, event) =>
    set((state) => {
      const run = state.runs[agentId];
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
            [agentId]: createBaseRun(agentId, "unknown", {
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
            [agentId]: {
              ...run,
              conversationState: event,
            },
          },
        };
      }

      return {
        runs: {
          ...state.runs,
          [agentId]: {
            ...run,
            status: nextStatus,
            conversationState: event,
            endTime: nextEndTime,
            resultErrors: nextResultErrors,
          },
        },
      };
    }),

  applyRunConfig: (agentId, event) =>
    set((state) => {
      const run = state.runs[agentId];
      if (!run) {
        return pendingMetadataUpdate(state, agentId, {
          _tag: "run_config",
          ...event,
        });
      }

      return {
        runs: {
          ...state.runs,
          [agentId]: {
            ...run,
            thinkingEnabled: event.thinkingEnabled,
            agentName: event.agentName ?? run.agentName,
          },
        },
      };
    }),

  applyRunInit: (agentId, event) =>
    set((state) => {
      const run = state.runs[agentId];
      if (!run) {
        return pendingMetadataUpdate(state, agentId, {
          _tag: "run_init",
          ...event,
        });
      }

      return {
        runs: {
          ...state.runs,
          [agentId]: {
            ...run,
            sessionId: event.sessionId,
            model: event.model,
          },
        },
      };
    }),

  applyTurnUsage: (agentId, event) =>
    set((state) => {
      const run = state.runs[agentId];
      if (!run) {
        return pendingMetadataUpdate(state, agentId, {
          _tag: "turn_usage",
          ...event,
        });
      }

      return {
        runs: {
          ...state.runs,
          [agentId]: {
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

  applyCompaction: (agentId, event) =>
    set((state) => {
      const run = state.runs[agentId];
      if (!run) {
        return pendingMetadataUpdate(state, agentId, {
          _tag: "compaction",
          ...event,
        });
      }

      return {
        runs: {
          ...state.runs,
          [agentId]: {
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

  applyContextWindow: (agentId, event) =>
    set((state) => {
      const run = state.runs[agentId];
      if (!run) {
        return pendingMetadataUpdate(state, agentId, {
          _tag: "context_window",
          ...event,
        });
      }

      if (event.contextWindow <= 0) {
        return state;
      }

      return {
        runs: {
          ...state.runs,
          [agentId]: {
            ...run,
            contextWindow: event.contextWindow,
          },
        },
      };
    }),

  setPromptSuggestion: (agentId, suggestion) =>
    set((state) => {
      const run = state.runs[agentId];
      if (!run) return {};
      return {
        runs: {
          ...state.runs,
          [agentId]: { ...run, promptSuggestion: suggestion },
        },
      };
    }),

  completeRun: (agentId, success, errorDetail) => {
    if (!useSessionRuntimeStore.getState().runs[agentId]) {
      queuePendingTerminal(agentId, success ? "completed" : "error", errorDetail);
      return;
    }

    set((state) => {
      const run = state.runs[agentId];
      if (!run) return state;
      if (run.status !== "running") {
        const nextErrors = errorDetail ? [errorDetail] : run.resultErrors;
        if (run.endTime !== undefined) {
          if (nextErrors === run.resultErrors) return state;
          return {
            runs: {
              ...state.runs,
              [agentId]: {
                ...run,
                resultErrors: nextErrors,
              },
            },
          };
        }
        return {
          runs: {
            ...state.runs,
            [agentId]: {
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
          [agentId]: {
            ...run,
            status: success ? "completed" : "error",
            endTime: Date.now(),
            resultErrors: errorDetail ? [errorDetail] : run.resultErrors,
          },
        },
      };
    });
  },

  shutdownRun: (agentId) => {
    if (!useSessionRuntimeStore.getState().runs[agentId]) {
      queuePendingTerminal(agentId, "shutdown");
      return;
    }

    set((state) => {
      const run = state.runs[agentId];
      if (!run || run.status !== "running") return state;
      return {
        runs: {
          ...state.runs,
          [agentId]: {
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
      pendingTerminal: {},
      pendingMetadata: {},
    }),

  clearRunsBySource: (source) =>
    set((state) => ({
      runs: Object.fromEntries(
        Object.entries(state.runs).filter(([, run]) => run.runSource !== source),
      ),
      pendingTerminal: Object.fromEntries(
        Object.entries(state.pendingTerminal).filter(([agentId]) => {
          const run = state.runs[agentId];
          return run && run.runSource !== source;
        }),
      ),
      pendingMetadata: Object.fromEntries(
        Object.entries(state.pendingMetadata).filter(([agentId]) => {
          const run = state.runs[agentId];
          return run && run.runSource !== source;
        }),
      ),
    })),
}));
