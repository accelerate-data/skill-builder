import { create } from "zustand";
import { useWorkflowStore } from "./workflow-store";
import type { DisplayItem } from "@/lib/display-types";
import type {
  CompactionEvent,
  ContextWindowEvent,
  RunConfigEvent,
  RunInitEvent,
  TurnUsageEvent,
} from "@/lib/agent-events";

// ---------------------------------------------------------------------------
// Pending terminal tracking (for agent-exit arriving before startRun)
// ---------------------------------------------------------------------------

type PendingTerminalStatus = "completed" | "error" | "shutdown";
let _pendingTerminalByAgent = new Map<string, PendingTerminalStatus>();

// ---------------------------------------------------------------------------
// Pending agent event buffer (for typed events arriving before run registration)
// ---------------------------------------------------------------------------

type PendingAgentEvent =
  | RunConfigEvent
  | RunInitEvent
  | TurnUsageEvent
  | CompactionEvent
  | ContextWindowEvent;

let _pendingMetadataByAgent = new Map<string, PendingAgentEvent[]>();

function queuePendingMetadata(agentId: string, event: PendingAgentEvent) {
  const existing = _pendingMetadataByAgent.get(agentId) ?? [];
  existing.push(event);
  _pendingMetadataByAgent.set(agentId, existing);
  console.warn(
    "[agent-store] event=metadata_queued operation=queue_pending_metadata agent_id=%s",
    agentId,
  );
}

function drainPendingMetadata(agentId: string) {
  const pending = _pendingMetadataByAgent.get(agentId);
  if (!pending || pending.length === 0) return;
  if (!useAgentStore.getState().runs[agentId]) return;
  _pendingMetadataByAgent.delete(agentId);
  console.log(
    "[agent-store] event=metadata_replayed operation=drain_pending_metadata agent_id=%s count=%d",
    agentId,
    pending.length,
  );
  for (const event of pending) {
    const store = useAgentStore.getState();
    switch (event.type) {
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

/** No-op: kept for backward compatibility with test code that calls flushMessageBuffer(). */
export function flushMessageBuffer() {
  // No-op: RAF message buffer has been removed.
  // Messages now arrive directly via addDisplayItem / typed apply actions.
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

export interface ModelUsageBreakdown {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cost: number;
}

export interface AgentRun {
  agentId: string;
  model: string;
  status: "running" | "completed" | "error" | "shutdown";
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
  compactionEvents: CompactionRecord[];
  thinkingEnabled: boolean;
  agentName?: string;
  runSource?: "workflow" | "refine" | "test";
  /** Optional synthetic session key used for non-workflow usage grouping. */
  usageSessionId?: string;
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
  /** Add a structured DisplayItem from the sidecar. Update-by-id for tool call status changes. */
  addDisplayItem: (agentId: string, item: DisplayItem) => void;
  applyRunConfig: (agentId: string, event: RunConfigEvent) => void;
  applyRunInit: (agentId: string, event: RunInitEvent) => void;
  applyTurnUsage: (agentId: string, event: TurnUsageEvent) => void;
  applyCompaction: (agentId: string, event: CompactionEvent) => void;
  applyContextWindow: (agentId: string, event: ContextWindowEvent) => void;
  completeRun: (agentId: string, success: boolean) => void;
  shutdownRun: (agentId: string) => void;
  setActiveAgent: (agentId: string | null) => void;
  clearRuns: () => void;
}

export const useAgentStore = create<AgentState>((set) => ({
  runs: {},
  activeAgentId: null,

  startRun: (agentId, model) => {
    const workflow = useWorkflowStore.getState();
    const skillName = workflow.skillName ?? "unknown";

    set((state) => {
      const existing = state.runs[agentId];
      return {
        runs: {
          ...state.runs,
          [agentId]: existing
            ? // Run was auto-created by early messages — update model, keep displayItems
              { ...existing, model, skillName, status: "running" as const }
            : {
                agentId,
                model,
                skillName,
                status: "running" as const,
                displayItems: [],
                startTime: Date.now(),
                contextHistory: [],
                contextWindow: 200_000,
                compactionEvents: [],
                thinkingEnabled: false,
                runSource: "workflow",
              },
        },
        activeAgentId: agentId,
      };
    });

    drainPendingTerminal(agentId);
    drainPendingMetadata(agentId);
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
    drainPendingMetadata(agentId);
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

  applyRunConfig: (agentId, event) =>
    set((state) => {
      const run = state.runs[agentId];
      if (!run) {
        queuePendingMetadata(agentId, event);
        return state;
      }

      console.debug(
        "[agent-store] event=run_config agent_id=%s thinking=%s agent=%s",
        agentId, event.thinkingEnabled, event.agentName,
      );

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
        queuePendingMetadata(agentId, event);
        return state;
      }

      console.debug(
        "[agent-store] event=run_init agent_id=%s model=%s",
        agentId, event.model,
      );

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
        queuePendingMetadata(agentId, event);
        return state;
      }

      console.debug(
        "[agent-store] event=turn_usage agent_id=%s turn=%d input=%d output=%d",
        agentId, event.turn, event.inputTokens, event.outputTokens,
      );

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
        queuePendingMetadata(agentId, event);
        return state;
      }

      console.debug(
        "[agent-store] event=compaction agent_id=%s turn=%d pre_tokens=%d",
        agentId, event.turn, event.preTokens,
      );

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
        queuePendingMetadata(agentId, event);
        return state;
      }

      if (event.contextWindow <= 0) {
        return state;
      }

      console.debug(
        "[agent-store] event=context_window agent_id=%s window=%d",
        agentId, event.contextWindow,
      );

      return {
        runs: {
          ...state.runs,
          [agentId]: {
            ...run,
            contextWindow: Math.max(run.contextWindow, event.contextWindow),
          },
        },
      };
    }),

  completeRun: (agentId, success) => {
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
  },

  shutdownRun: (agentId: string) => {
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
  },

  setActiveAgent: (agentId) => set({ activeAgentId: agentId }),

  clearRuns: () => {
    if (_pendingTerminalByAgent.size > 0) {
      console.warn(
        "[agent-store] event=pending_terminal_cleared operation=clear_runs count=%d",
        _pendingTerminalByAgent.size,
      );
      _pendingTerminalByAgent.clear();
    }
    if (_pendingMetadataByAgent.size > 0) {
      console.warn(
        "[agent-store] event=pending_metadata_cleared operation=clear_runs count=%d",
        _pendingMetadataByAgent.size,
      );
      _pendingMetadataByAgent.clear();
    }
    set({ runs: {}, activeAgentId: null });
  },
}));
