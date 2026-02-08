import { create } from "zustand";

export interface AgentMessage {
  type: string;
  content?: string;
  raw: Record<string, unknown>;
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
    set((state) => ({
      runs: {
        ...state.runs,
        [agentId]: {
          agentId,
          model,
          status: "running",
          messages: [],
          startTime: Date.now(),
        },
      },
      activeAgentId: agentId,
    })),

  addMessage: (agentId, message) =>
    set((state) => {
      const run = state.runs[agentId];
      if (!run) return state;

      // Extract token usage and cost from result messages
      const raw = message.raw;
      let tokenUsage = run.tokenUsage;
      let totalCost = run.totalCost;

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
      }

      // Extract session_id from init messages
      let sessionId = run.sessionId;
      if (message.type === "system" && (raw as Record<string, unknown>)?.subtype === "init") {
        const sid = (raw as Record<string, unknown>)?.session_id;
        if (typeof sid === "string") {
          sessionId = sid;
        }
      }

      return {
        runs: {
          ...state.runs,
          [agentId]: {
            ...run,
            messages: [...run.messages, message],
            tokenUsage,
            totalCost,
            sessionId,
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
