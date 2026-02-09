import { create } from "zustand";
import { useSettingsStore } from "./settings-store";

/** Map model IDs and shorthands to human-readable display names. */
export function formatModelName(model: string): string {
  const lower = model.toLowerCase();
  if (lower.includes("opus")) return "Opus";
  if (lower.includes("sonnet")) return "Sonnet";
  if (lower.includes("haiku")) return "Haiku";
  // Already a readable name or unknown — capitalize first letter
  if (model.length > 0) return model.charAt(0).toUpperCase() + model.slice(1);
  return model;
}

/** Format a token count as a compact string (e.g. 45000 -> "45K"). */
export function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`;
  return String(tokens);
}

/** Get the latest input_tokens from context history (most recent turn). */
export function getLatestContextTokens(run: AgentRun): number {
  if (run.contextHistory.length === 0) return 0;
  return run.contextHistory[run.contextHistory.length - 1].inputTokens;
}

/** Compute context utilization as a percentage (0-100). */
export function getContextUtilization(run: AgentRun): number {
  const tokens = getLatestContextTokens(run);
  if (run.contextWindow <= 0) return 0;
  return Math.min(100, (tokens / run.contextWindow) * 100);
}

export interface AgentMessage {
  type: string;
  content?: string;
  raw: Record<string, unknown>;
  timestamp: number;
}

export interface ContextSnapshot {
  turn: number;
  inputTokens: number;
  outputTokens: number;
}

export interface CompactionEvent {
  turn: number;
  preTokens: number;
  timestamp: number;
}

export interface AgentRun {
  agentId: string;
  model: string;
  status: "running" | "completed" | "error" | "cancelled";
  messages: AgentMessage[];
  startTime: number;
  endTime?: number;
  totalCost?: number;
  tokenUsage?: { input: number; output: number };
  sessionId?: string;
  contextHistory: ContextSnapshot[];
  contextWindow: number;
  compactionEvents: CompactionEvent[];
}

interface AgentState {
  runs: Record<string, AgentRun>;
  activeAgentId: string | null;
  parallelAgentIds: [string, string] | null;

  startRun: (agentId: string, model: string) => void;
  addMessage: (agentId: string, message: AgentMessage) => void;
  completeRun: (agentId: string, success: boolean) => void;
  setActiveAgent: (agentId: string | null) => void;
  setParallelAgents: (ids: [string, string] | null) => void;
  clearRuns: () => void;
}

export const useAgentStore = create<AgentState>((set) => ({
  runs: {},
  activeAgentId: null,
  parallelAgentIds: null,

  startRun: (agentId, model) =>
    set((state) => {
      const extendedContext = useSettingsStore.getState().extendedContext;
      return {
        runs: {
          ...state.runs,
          [agentId]: {
            agentId,
            model,
            status: "running",
            messages: [],
            startTime: Date.now(),
            contextHistory: [],
            contextWindow: extendedContext ? 1_000_000 : 200_000,
            compactionEvents: [],
          },
        },
        activeAgentId: agentId,
      };
    }),

  addMessage: (agentId, message) =>
    set((state) => {
      const run = state.runs[agentId];
      if (!run) return state;

      // Extract token usage and cost from result messages
      const raw = message.raw;
      let tokenUsage = run.tokenUsage;
      let totalCost = run.totalCost;
      let contextHistory = run.contextHistory;
      let contextWindow = run.contextWindow;
      let compactionEvents = run.compactionEvents;

      if (message.type === "result") {
        const usage = raw.usage as
          | { input_tokens?: number; output_tokens?: number }
          | undefined;
        if (usage) {
          tokenUsage = {
            input: usage.input_tokens ?? 0,
            output: usage.output_tokens ?? 0,
          };
        }
        const cost = raw.cost_usd as number | undefined;
        if (cost !== undefined) {
          totalCost = cost;
        }
        // Extract contextWindow from modelUsage in result messages
        const modelUsage = raw.modelUsage as
          | Record<string, { contextWindow?: number }>
          | undefined;
        if (modelUsage) {
          for (const mu of Object.values(modelUsage)) {
            if (mu.contextWindow && mu.contextWindow > 0) {
              contextWindow = Math.max(contextWindow, mu.contextWindow);
              break;
            }
          }
        }
      }

      // Extract per-turn context usage from assistant messages
      if (message.type === "assistant") {
        const betaMsg = (raw as Record<string, unknown>).message as
          | { usage?: { input_tokens?: number; output_tokens?: number } }
          | undefined;
        if (betaMsg?.usage) {
          const turn = run.messages.filter((m) => m.type === "assistant").length + 1;
          contextHistory = [
            ...contextHistory,
            {
              turn,
              inputTokens: betaMsg.usage.input_tokens ?? 0,
              outputTokens: betaMsg.usage.output_tokens ?? 0,
            },
          ];
        }
      }

      // Detect compaction boundary messages
      if (
        message.type === "system" &&
        (raw as Record<string, unknown>)?.subtype === "compact_boundary"
      ) {
        const metadata = (raw as Record<string, unknown>)?.compact_metadata as
          | { pre_tokens?: number }
          | undefined;
        const turn = run.messages.filter((m) => m.type === "assistant").length;
        compactionEvents = [
          ...compactionEvents,
          {
            turn,
            preTokens: metadata?.pre_tokens ?? 0,
            timestamp: message.timestamp,
          },
        ];
      }

      // Extract session_id and model from init messages
      let sessionId = run.sessionId;
      let model = run.model;
      if (message.type === "system" && (raw as Record<string, unknown>)?.subtype === "init") {
        const sid = (raw as Record<string, unknown>)?.session_id;
        if (typeof sid === "string") {
          sessionId = sid;
        }
        const initModel = (raw as Record<string, unknown>)?.model;
        if (typeof initModel === "string" && initModel.length > 0) {
          model = initModel;
        }
      }

      return {
        runs: {
          ...state.runs,
          [agentId]: {
            ...run,
            model,
            messages: [...run.messages, message],
            tokenUsage,
            totalCost,
            sessionId,
            contextHistory,
            contextWindow,
            compactionEvents,
          },
        },
      };
    }),

  completeRun: (agentId, success) =>
    set((state) => {
      const run = state.runs[agentId];
      if (!run) return state;
      return {
        runs: {
          ...state.runs,
          [agentId]: {
            ...run,
            status: success ? "completed" : "error",
            endTime: Date.now(),
          },
        },
      };
    }),

  setActiveAgent: (agentId) => set({ activeAgentId: agentId }),

  setParallelAgents: (ids) => set({ parallelAgentIds: ids }),

  clearRuns: () => set({ runs: {}, activeAgentId: null, parallelAgentIds: null }),
}));
