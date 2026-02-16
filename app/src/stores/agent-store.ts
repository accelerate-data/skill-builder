import { create } from "zustand";
import { useSettingsStore } from "./settings-store";
import { useWorkflowStore } from "./workflow-store";
import { persistAgentRun } from "@/lib/tauri";

// --- RAF-batched message buffer ---
// Instead of calling set() per message (which copies the full state tree each
// time), we collect incoming messages and flush them once per animation frame.
// This reduces GC pressure and re-renders during agent runs that produce
// hundreds of messages.

interface BufferedMessage {
  agentId: string;
  message: AgentMessage;
}

let _messageBuffer: BufferedMessage[] = [];
let _rafScheduled = false;
let _rafId = 0;

function _flushMessageBuffer() {
  _rafScheduled = false;
  if (_messageBuffer.length === 0) return;

  const batch = _messageBuffer;
  _messageBuffer = [];

  useAgentStore.getState()._applyMessageBatch(batch);
}

/** Force-flush any buffered messages (for cleanup / testing). */
export function flushMessageBuffer() {
  if (_rafScheduled) {
    cancelAnimationFrame(_rafId);
    _rafScheduled = false;
  }
  _flushMessageBuffer();
}

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

interface ContextSnapshot {
  turn: number;
  inputTokens: number;
  outputTokens: number;
}

interface CompactionEvent {
  turn: number;
  preTokens: number;
  timestamp: number;
}

type ResultSubtype =
  | "success"
  | "error_max_turns"
  | "error_during_execution"
  | "error_max_budget_usd"
  | "error_max_structured_output_retries";

type StopReason =
  | "end_turn"
  | "max_tokens"
  | "stop_sequence"
  | "tool_use"
  | "pause_turn"
  | "refusal"
  | "model_context_window_exceeded";

interface AgentRun {
  agentId: string;
  model: string;
  status: "running" | "completed" | "error" | "shutdown";
  messages: AgentMessage[];
  startTime: number;
  endTime?: number;
  totalCost?: number;
  tokenUsage?: { input: number; output: number };
  sessionId?: string;
  contextHistory: ContextSnapshot[];
  contextWindow: number;
  compactionEvents: CompactionEvent[];
  thinkingEnabled: boolean;
  agentName?: string;
  resultSubtype?: ResultSubtype;
  resultErrors?: string[];
  stopReason?: StopReason;
}

interface AgentState {
  runs: Record<string, AgentRun>;
  activeAgentId: string | null;
  startRun: (agentId: string, model: string) => void;
  /** Register a run for streaming without setting activeAgentId.
   *  Used by reasoning-review component that manages its own lifecycle. */
  registerRun: (agentId: string, model: string) => void;
  addMessage: (agentId: string, message: AgentMessage) => void;
  completeRun: (agentId: string, success: boolean) => void;
  shutdownRun: (agentId: string) => void;
  setActiveAgent: (agentId: string | null) => void;
  clearRuns: () => void;
  /** Internal: apply a batch of buffered messages in a single set() call. */
  _applyMessageBatch: (batch: BufferedMessage[]) => void;
}

export const useAgentStore = create<AgentState>((set) => ({
  runs: {},
  activeAgentId: null,

  startRun: (agentId, model) => {
    set((state) => {
      const existing = state.runs[agentId];
      const extendedContext = useSettingsStore.getState().extendedContext;
      return {
        runs: {
          ...state.runs,
          [agentId]: existing
            ? // Run was auto-created by early messages — update model, keep messages
              { ...existing, model, status: "running" as const }
            : {
                agentId,
                model,
                status: "running" as const,
                messages: [],
                startTime: Date.now(),
                contextHistory: [],
                contextWindow: extendedContext ? 1_000_000 : 200_000,
                compactionEvents: [],
                thinkingEnabled: false,
              },
        },
        activeAgentId: agentId,
      };
    });

    // Persist initial row so in-progress and shutdown runs are tracked
    const workflow = useWorkflowStore.getState();
    persistAgentRun({
      agentId,
      skillName: workflow.skillName ?? "unknown",
      stepId: workflow.currentStep,
      model,
      status: "running",
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalCost: 0,
      durationMs: 0,
      workflowSessionId: workflow.workflowSessionId ?? undefined,
    }).catch((err) => console.error("Failed to persist agent start:", err));
  },

  registerRun: (agentId, model) =>
    set((state) => {
      const existing = state.runs[agentId];
      const extendedContext = useSettingsStore.getState().extendedContext;
      return {
        runs: {
          ...state.runs,
          [agentId]: existing
            ? { ...existing, model, status: "running" as const }
            : {
                agentId,
                model,
                status: "running" as const,
                messages: [],
                startTime: Date.now(),
                contextHistory: [],
                contextWindow: extendedContext ? 1_000_000 : 200_000,
                compactionEvents: [],
                thinkingEnabled: false,
              },
        },
        // Do NOT set activeAgentId — reasoning-review manages its own lifecycle
      };
    }),

  addMessage: (agentId, message) => {
    _messageBuffer.push({ agentId, message });
    if (!_rafScheduled) {
      _rafScheduled = true;
      _rafId = requestAnimationFrame(_flushMessageBuffer);
    }
  },

  completeRun: (agentId, success) => {
    // Flush any buffered messages so all data is applied before status changes
    flushMessageBuffer();

    // Capture run data before status update for persistence
    const runBeforeUpdate = useAgentStore.getState().runs[agentId];

    set((state) => {
      const run = state.runs[agentId];
      if (!run || run.status !== "running") return state;
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
    });

    // Persist agent run to SQLite (fire-and-forget)
    if (runBeforeUpdate?.tokenUsage && runBeforeUpdate?.totalCost !== undefined) {
      const workflow = useWorkflowStore.getState();

      // Extract cache tokens from the last assistant message's raw usage
      let cacheRead = 0;
      let cacheWrite = 0;
      const assistantMessages = runBeforeUpdate.messages.filter((m) => m.type === "assistant");
      if (assistantMessages.length > 0) {
        const lastMsg = assistantMessages[assistantMessages.length - 1];
        const betaMsg = (lastMsg.raw as Record<string, unknown>).message as
          | { usage?: { cache_read_input_tokens?: number; cache_creation_input_tokens?: number } }
          | undefined;
        cacheRead = betaMsg?.usage?.cache_read_input_tokens ?? 0;
        cacheWrite = betaMsg?.usage?.cache_creation_input_tokens ?? 0;
      }

      persistAgentRun({
        agentId,
        skillName: workflow.skillName ?? "unknown",
        stepId: workflow.currentStep,
        model: runBeforeUpdate.model,
        status: success ? "completed" : "error",
        inputTokens: runBeforeUpdate.tokenUsage.input,
        outputTokens: runBeforeUpdate.tokenUsage.output,
        cacheReadTokens: cacheRead,
        cacheWriteTokens: cacheWrite,
        totalCost: runBeforeUpdate.totalCost,
        durationMs: Date.now() - runBeforeUpdate.startTime,
        sessionId: runBeforeUpdate.sessionId,
        workflowSessionId: workflow.workflowSessionId ?? undefined,
      }).catch((err) => console.error("Failed to persist agent run:", err));
    }
  },

  shutdownRun: (agentId: string) => {
    // Flush any buffered messages so all data is applied before status changes
    flushMessageBuffer();

    const runBeforeUpdate = useAgentStore.getState().runs[agentId];

    set((state) => {
      const run = state.runs[agentId];
      if (!run || run.status !== "running") return state;
      return {
        runs: {
          ...state.runs,
          [agentId]: {
            ...run,
            status: "shutdown" as const,
            endTime: Date.now(),
          },
        },
      };
    });

    // Persist shutdown status with whatever partial data we have
    if (runBeforeUpdate) {
      const workflow = useWorkflowStore.getState();
      persistAgentRun({
        agentId,
        skillName: workflow.skillName ?? "unknown",
        stepId: workflow.currentStep,
        model: runBeforeUpdate.model,
        status: "shutdown",
        inputTokens: runBeforeUpdate.tokenUsage?.input ?? 0,
        outputTokens: runBeforeUpdate.tokenUsage?.output ?? 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalCost: runBeforeUpdate.totalCost ?? 0,
        durationMs: Date.now() - runBeforeUpdate.startTime,
        workflowSessionId: workflow.workflowSessionId ?? undefined,
      }).catch((err) => console.error("Failed to persist agent shutdown:", err));
    }
  },

  setActiveAgent: (agentId) => set({ activeAgentId: agentId }),

  clearRuns: () => {
    // Cancel any pending RAF and clear the buffer so stale messages
    // from the previous run don't leak into the next one.
    if (_rafScheduled) {
      cancelAnimationFrame(_rafId);
      _rafScheduled = false;
    }
    _messageBuffer = [];
    set({ runs: {}, activeAgentId: null });
  },

  _applyMessageBatch: (batch) =>
    set((state) => {
      const extendedContext = useSettingsStore.getState().extendedContext;
      const updatedRuns = { ...state.runs };

      for (const { agentId, message } of batch) {
        // Auto-create run for messages that arrive before startRun
        const run: AgentRun = updatedRuns[agentId] ?? {
          agentId,
          model: "unknown",
          status: "running" as const,
          messages: [],
          startTime: Date.now(),
          contextHistory: [],
          contextWindow: extendedContext ? 1_000_000 : 200_000,
          compactionEvents: [],
          thinkingEnabled: false,
        };

        // Extract token usage and cost from result messages
        const raw = message.raw;
        let tokenUsage = run.tokenUsage;
        let totalCost = run.totalCost;
        let contextHistory = run.contextHistory;
        let contextWindow = run.contextWindow;
        let compactionEvents = run.compactionEvents;
        let resultSubtype = run.resultSubtype;
        let resultErrors = run.resultErrors;
        let stopReason = run.stopReason;

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
          const cost = raw.total_cost_usd as number | undefined;
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
          // Extract result subtype, errors, and stop_reason
          if (typeof raw.subtype === "string") {
            resultSubtype = raw.subtype as ResultSubtype;
          }
          if (Array.isArray(raw.errors)) {
            resultErrors = raw.errors as string[];
          }
          if (typeof raw.stop_reason === "string") {
            stopReason = raw.stop_reason as StopReason;
          }
        }

        // Extract per-turn context usage from assistant messages
        if (message.type === "assistant") {
          const betaMsg = (raw as Record<string, unknown>).message as
            | { usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } }
            | undefined;
          if (betaMsg?.usage) {
            const turn = run.messages.filter((m) => m.type === "assistant").length + 1;
            // Total context = non-cached + cache-read + cache-creation tokens
            const totalInput = (betaMsg.usage.input_tokens ?? 0)
              + (betaMsg.usage.cache_read_input_tokens ?? 0)
              + (betaMsg.usage.cache_creation_input_tokens ?? 0);
            contextHistory = [
              ...contextHistory,
              {
                turn,
                inputTokens: totalInput,
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

        // Extract thinkingEnabled and agentName from config messages
        let thinkingEnabled = run.thinkingEnabled;
        let agentName = run.agentName;
        if (message.type === "config") {
          const configObj = (raw as Record<string, unknown>).config as
            | { maxThinkingTokens?: number; agentName?: string }
            | undefined;
          if (configObj?.maxThinkingTokens && configObj.maxThinkingTokens > 0) {
            thinkingEnabled = true;
          }
          if (configObj?.agentName) {
            agentName = configObj.agentName;
          }
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

        updatedRuns[agentId] = {
          ...run,
          model,
          messages: [...run.messages, message],
          tokenUsage,
          totalCost,
          sessionId,
          thinkingEnabled,
          agentName,
          contextHistory,
          contextWindow,
          compactionEvents,
          resultSubtype,
          resultErrors,
          stopReason,
        };
      }

      return { runs: updatedRuns };
    }),
}));
