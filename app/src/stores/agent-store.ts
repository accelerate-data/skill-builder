import { create } from "zustand";
import { useWorkflowStore } from "./workflow-store";
import { persistAgentRun } from "@/lib/tauri";
import type { DisplayItem } from "@/lib/display-types";

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
type PendingTerminalStatus = "completed" | "error" | "shutdown";
let _pendingTerminalByAgent = new Map<string, PendingTerminalStatus>();

function queuePendingTerminal(agentId: string, status: PendingTerminalStatus) {
  const existing = _pendingTerminalByAgent.get(agentId);
  // Preserve the most informative terminal state. A later completed/error
  // event should overwrite an earlier shutdown fallback.
  if (!existing || existing === "shutdown") {
    _pendingTerminalByAgent.set(agentId, status);
    console.warn(
      "[agent-store] event=terminal_queued operation=queue_pending_terminal agent_id=%s status=%s",
      agentId,
      status,
    );
  }
}

function drainPendingTerminal(agentId: string) {
  const pending = _pendingTerminalByAgent.get(agentId);
  if (!pending) return;
  if (!useAgentStore.getState().runs[agentId]) return;

  _pendingTerminalByAgent.delete(agentId);
  console.log(
    "[agent-store] event=terminal_replayed operation=drain_pending_terminal agent_id=%s status=%s",
    agentId,
    pending,
  );
  if (pending === "shutdown") {
    useAgentStore.getState().shutdownRun(agentId);
    return;
  }
  useAgentStore.getState().completeRun(agentId, pending === "completed");
}

function _flushMessageBuffer() {
  _rafScheduled = false;
  if (_messageBuffer.length === 0) return;

  const batch = _messageBuffer;
  _messageBuffer = [];
  const touchedAgentIds = [...new Set(batch.map((b) => b.agentId))];

  useAgentStore.getState()._applyMessageBatch(batch);
  for (const agentId of touchedAgentIds) {
    drainPendingTerminal(agentId);
  }
}

/** Force-flush any buffered messages (for cleanup / testing). */
export function flushMessageBuffer() {
  if (_rafScheduled) {
    cancelAnimationFrame(_rafId);
    _rafScheduled = false;
  }
  _flushMessageBuffer();
}

/** Map model IDs and shorthands to human-readable display names with version. */
export function formatModelName(model: string): string {
  const lower = model.toLowerCase();
  const families: [string, string][] = [
    ["opus", "Opus"],
    ["sonnet", "Sonnet"],
    ["haiku", "Haiku"],
  ];
  for (const [key, label] of families) {
    if (lower.includes(key)) {
      const match = lower.match(new RegExp(`${key}-(\\d+)-(\\d+)`));
      return match ? `${label} ${match[1]}.${match[2]}` : label;
    }
  }
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

export interface ModelUsageBreakdown {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cost: number;
}

interface AgentRun {
  agentId: string;
  model: string;
  status: "running" | "completed" | "error" | "shutdown";
  messages: AgentMessage[];
  /** Structured display items from sidecar MessageProcessor. */
  displayItems: DisplayItem[];
  startTime: number;
  endTime?: number;
  totalCost?: number;
  tokenUsage?: { input: number; output: number };
  sessionId?: string;
  skillName?: string;
  contextHistory: ContextSnapshot[];
  contextWindow: number;
  compactionEvents: CompactionEvent[];
  thinkingEnabled: boolean;
  agentName?: string;
  resultSubtype?: ResultSubtype;
  resultErrors?: string[];
  stopReason?: StopReason;
  numTurns?: number;
  durationApiMs?: number | null;
  modelUsageBreakdown?: ModelUsageBreakdown[];
  runSource?: "workflow" | "refine" | "test";
  /** Optional synthetic session key used for non-workflow usage grouping. */
  usageSessionId?: string;
  /** Workflow context captured at run start — used for attribution, never read from live store. */
  capturedWorkflowSessionId?: string;
  capturedStepId?: number;
}

interface AgentState {
  runs: Record<string, AgentRun>;
  activeAgentId: string | null;
  startRun: (agentId: string, model: string) => void;
  /** Register a run for streaming without setting activeAgentId.
   *  Used by refine page which manages its own agent lifecycle.
   *  Pass skillName so usage data is attributed correctly (otherwise defaults to workflow store). */
  registerRun: (
    agentId: string,
    model: string,
    skillName?: string,
    runSource?: "refine" | "test",
    usageSessionId?: string,
  ) => void;
  addMessage: (agentId: string, message: AgentMessage) => void;
  /** Add a structured DisplayItem from the sidecar. Update-by-id for tool call status changes. */
  addDisplayItem: (agentId: string, item: DisplayItem) => void;
  completeRun: (agentId: string, success: boolean) => void;
  shutdownRun: (agentId: string) => void;
  setActiveAgent: (agentId: string | null) => void;
  clearRuns: () => void;
  /** Internal: apply a batch of buffered messages in a single set() call. */
  _applyMessageBatch: (batch: BufferedMessage[]) => void;
}

/** Persist one row per model entry (fire-and-forget). Used by both completeRun and shutdownRun. */
function persistRunRows(
  sharedParams: Record<string, unknown>,
  modelEntries: Array<{ model: string; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; totalCost: number }>,
): void {
  for (const entry of modelEntries) {
    persistAgentRun({
      ...sharedParams,
      model: entry.model,
      inputTokens: entry.inputTokens,
      outputTokens: entry.outputTokens,
      cacheReadTokens: entry.cacheReadTokens,
      cacheWriteTokens: entry.cacheWriteTokens,
      totalCost: entry.totalCost,
    } as Parameters<typeof persistAgentRun>[0]).catch((err) =>
      console.error("Failed to persist agent run:", err),
    );
  }
}

/** Build per-model entries from breakdown or fallback to a single aggregate row. */
function buildModelEntries(
  run: AgentRun,
): Array<{ model: string; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; totalCost: number }> {
  const breakdown = run.modelUsageBreakdown;
  if (breakdown && breakdown.length > 0) {
    return breakdown.map((mu) => ({
      model: mu.model,
      inputTokens: mu.inputTokens,
      outputTokens: mu.outputTokens,
      cacheReadTokens: mu.cacheReadTokens,
      cacheWriteTokens: mu.cacheWriteTokens,
      totalCost: mu.cost,
    }));
  }

  // Fallback: single-model persistence using aggregate totals.
  // Extract cache tokens from the last assistant message's raw usage.
  let cacheRead = 0;
  let cacheWrite = 0;
  const assistantMessages = run.messages.filter((m) => m.type === "assistant");
  if (assistantMessages.length > 0) {
    const lastMsg = assistantMessages[assistantMessages.length - 1];
    const betaMsg = (lastMsg.raw as Record<string, unknown>).message as
      | { usage?: { cache_read_input_tokens?: number; cache_creation_input_tokens?: number } }
      | undefined;
    cacheRead = betaMsg?.usage?.cache_read_input_tokens ?? 0;
    cacheWrite = betaMsg?.usage?.cache_creation_input_tokens ?? 0;
  }

  return [{
    model: run.model,
    inputTokens: run.tokenUsage?.input ?? 0,
    outputTokens: run.tokenUsage?.output ?? 0,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    totalCost: run.totalCost ?? 0,
  }];
}

function resolvePersistenceContext(
  run: AgentRun | undefined,
): { stepId: number; workflowSessionId?: string } {
  const runSourceStepId = run?.runSource === "refine"
    ? -10
    : run?.runSource === "test"
      ? -11
      : -1;

  const capturedWorkflowSessionId = run?.capturedWorkflowSessionId ?? null;
  const capturedStepId = run?.capturedStepId ?? -1;

  if (capturedWorkflowSessionId) {
    return { stepId: capturedStepId, workflowSessionId: capturedWorkflowSessionId };
  }

  if (!run) return { stepId: -1 };

  if (runSourceStepId !== -1 && run.usageSessionId) {
    return {
      stepId: runSourceStepId,
      workflowSessionId: run.usageSessionId,
    };
  }

  if (run.runSource === "refine") {
    return {
      stepId: -10,
      workflowSessionId: `synthetic:refine:${run.skillName ?? "unknown"}:${run.agentId}`,
    };
  }

  if (run.runSource === "test") {
    return {
      stepId: -11,
      workflowSessionId: `synthetic:test:${run.skillName ?? "unknown"}:${run.agentId}`,
    };
  }

  return { stepId: -1 };
}

export const useAgentStore = create<AgentState>((set) => ({
  runs: {},
  activeAgentId: null,

  startRun: (agentId, model) => {
    const workflow = useWorkflowStore.getState();
    const skillName = workflow.skillName ?? "unknown";
    const capturedWorkflowSessionId = workflow.workflowSessionId ?? undefined;
    const capturedStepId = workflow.currentStep;

    set((state) => {
      const existing = state.runs[agentId];
      return {
        runs: {
          ...state.runs,
          [agentId]: existing
            ? // Run was auto-created by early messages — update model, keep messages
              { ...existing, model, skillName, status: "running" as const, capturedWorkflowSessionId, capturedStepId }
            : {
                agentId,
                model,
                skillName,
                status: "running" as const,
                messages: [],
                displayItems: [],
                startTime: Date.now(),
                contextHistory: [],
                contextWindow: 200_000,
                compactionEvents: [],
                thinkingEnabled: false,
                runSource: "workflow",
                capturedWorkflowSessionId,
                capturedStepId,
              },
        },
        activeAgentId: agentId,
      };
    });

    drainPendingTerminal(agentId);
  },

  registerRun: (agentId, model, skillName?, runSource = "refine", usageSessionId?) => {
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
                status: "running" as const,
                runSource,
                usageSessionId: usageSessionId ?? existing.usageSessionId,
              }
            : {
                agentId,
                model,
                skillName,
                status: "running" as const,
                messages: [],
                displayItems: [],
                startTime: Date.now(),
                contextHistory: [],
                contextWindow: 200_000,
                compactionEvents: [],
                thinkingEnabled: false,
                runSource,
                usageSessionId,
              },
        },
        // Do NOT set activeAgentId — callers manage their own lifecycle
      };
    });
    drainPendingTerminal(agentId);
  },

  addMessage: (agentId, message) => {
    _messageBuffer.push({ agentId, message });
    if (!_rafScheduled) {
      _rafScheduled = true;
      _rafId = requestAnimationFrame(_flushMessageBuffer);
    }
  },

  addDisplayItem: (agentId, item) =>
    set((state) => {
      const run = state.runs[agentId];
      if (!run) {
        // Auto-create run for display items that arrive before startRun
        console.debug(
          "[agent-store] event=auto_create_run operation=add_display_item agent_id=%s item_type=%s",
          agentId,
          item.type,
        );
        return {
          runs: {
            ...state.runs,
            [agentId]: {
              agentId,
              model: "unknown",
              status: "running" as const,
              messages: [],
              displayItems: [item],
              startTime: Date.now(),
              contextHistory: [],
              contextWindow: 200_000,
              compactionEvents: [],
              thinkingEnabled: false,
            },
          },
        };
      }

      // Update-by-id: if this item has the same id as an existing one,
      // replace it (tool call status updates, subagent completion)
      const existingIdx = run.displayItems.findIndex((di) => di.id === item.id);
      let updatedItems: DisplayItem[];
      if (existingIdx >= 0) {
        updatedItems = [...run.displayItems];
        updatedItems[existingIdx] = item;
        console.debug(
          "[agent-store] event=update_display_item operation=replace_by_id agent_id=%s item_id=%s item_type=%s",
          agentId,
          item.id,
          item.type,
        );
      } else {
        updatedItems = [...run.displayItems, item];
        console.debug(
          "[agent-store] event=add_display_item operation=append agent_id=%s item_id=%s item_type=%s total=%d",
          agentId,
          item.id,
          item.type,
          updatedItems.length,
        );
      }

      return {
        runs: {
          ...state.runs,
          [agentId]: {
            ...run,
            displayItems: updatedItems,
          },
        },
      };
    }),

  completeRun: (agentId, success) => {
    // Flush any buffered messages so all data is applied before status changes
    flushMessageBuffer();

    // Capture run data before status update for persistence
    const runBeforeUpdate = useAgentStore.getState().runs[agentId];
    if (!runBeforeUpdate) {
      queuePendingTerminal(agentId, success ? "completed" : "error");
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
            status: success ? "completed" : "error",
            endTime: Date.now(),
          },
        },
      };
    });

    // Persist agent run to SQLite (fire-and-forget). Do not require tokenUsage;
    // some runs only report modelUsage breakdown or partial result metadata.
    if (runBeforeUpdate) {
      const persistenceContext = resolvePersistenceContext(runBeforeUpdate);

      // Count tool uses across all assistant messages
      let toolUseCount = 0;
      for (const msg of runBeforeUpdate.messages) {
        if (msg.type === "assistant") {
          const content = (msg.raw as Record<string, unknown>)?.message as
            | { content?: Array<{ type: string }> }
            | undefined;
          if (Array.isArray(content?.content)) {
            toolUseCount += content.content.filter((b) => b.type === "tool_use").length;
          }
        }
      }

      persistRunRows(
        {
          agentId,
          skillName: runBeforeUpdate.skillName ?? "unknown",
          stepId: persistenceContext.stepId,
          status: success ? "completed" : "error",
          durationMs: Date.now() - runBeforeUpdate.startTime,
          numTurns: runBeforeUpdate.numTurns ?? 0,
          stopReason: runBeforeUpdate.stopReason ?? null,
          durationApiMs: runBeforeUpdate.durationApiMs ?? null,
          toolUseCount,
          compactionCount: runBeforeUpdate.compactionEvents.length,
          sessionId: runBeforeUpdate.sessionId,
          workflowSessionId: persistenceContext.workflowSessionId,
        },
        buildModelEntries(runBeforeUpdate),
      );
    }
  },

  shutdownRun: (agentId: string) => {
    // Flush any buffered messages so all data is applied before status changes
    flushMessageBuffer();

    const runBeforeUpdate = useAgentStore.getState().runs[agentId];
    if (!runBeforeUpdate) {
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
            status: "shutdown" as const,
            endTime: Date.now(),
          },
        },
      };
    });

    // Persist shutdown status with whatever partial data we have
    if (runBeforeUpdate) {
      const persistenceContext = resolvePersistenceContext(runBeforeUpdate);
      persistRunRows(
        {
          agentId,
          skillName: runBeforeUpdate.skillName ?? "unknown",
          stepId: persistenceContext.stepId,
          status: "shutdown" as const,
          durationMs: Date.now() - runBeforeUpdate.startTime,
          workflowSessionId: persistenceContext.workflowSessionId,
        },
        buildModelEntries(runBeforeUpdate),
      );
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
    if (_pendingTerminalByAgent.size > 0) {
      console.warn(
        "[agent-store] event=pending_terminal_cleared operation=clear_runs count=%d",
        _pendingTerminalByAgent.size,
      );
      _pendingTerminalByAgent.clear();
    }
    set({ runs: {}, activeAgentId: null });
  },

  _applyMessageBatch: (batch) =>
    set((state) => {
      const updatedRuns = { ...state.runs };

      for (const { agentId, message } of batch) {
        // Auto-create run for messages that arrive before startRun
        const run: AgentRun = updatedRuns[agentId] ?? {
          agentId,
          model: "unknown",
          status: "running" as const,
          messages: [],
          displayItems: [],
          startTime: Date.now(),
          contextHistory: [],
          contextWindow: 200_000,
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
        let numTurns = run.numTurns;
        let durationApiMs = run.durationApiMs;
        let modelUsageBreakdown = run.modelUsageBreakdown;

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
          // Extract contextWindow and per-model usage breakdown from modelUsage
          const modelUsage = raw.modelUsage as
            | Record<string, {
                inputTokens?: number;
                outputTokens?: number;
                cacheReadInputTokens?: number;
                cacheCreationInputTokens?: number;
                cost?: number;
                costUSD?: number;
                contextWindow?: number;
              }>
            | undefined;
          if (modelUsage) {
            const breakdown: ModelUsageBreakdown[] = [];
            for (const [modelId, mu] of Object.entries(modelUsage)) {
              if (mu.contextWindow && mu.contextWindow > 0) {
                contextWindow = Math.max(contextWindow, mu.contextWindow);
              }
              breakdown.push({
                model: modelId,
                inputTokens: mu.inputTokens ?? 0,
                outputTokens: mu.outputTokens ?? 0,
                cacheReadTokens: mu.cacheReadInputTokens ?? 0,
                cacheWriteTokens: mu.cacheCreationInputTokens ?? 0,
                cost: mu.costUSD ?? mu.cost ?? 0,
              });
            }
            if (breakdown.length > 0) {
              modelUsageBreakdown = breakdown;
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
          if (typeof raw.num_turns === "number") {
            numTurns = raw.num_turns;
          }
          if (typeof raw.duration_api_ms === "number") {
            durationApiMs = raw.duration_api_ms;
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
            | { thinking?: { type?: string; budgetTokens?: number }; agentName?: string }
            | undefined;
          if (
            configObj?.thinking?.type === "enabled"
            && typeof configObj.thinking.budgetTokens === "number"
            && configObj.thinking.budgetTokens > 0
          ) {
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
          numTurns,
          durationApiMs,
          modelUsageBreakdown,
        };
      }

      return { runs: updatedRuns };
    }),
}));
