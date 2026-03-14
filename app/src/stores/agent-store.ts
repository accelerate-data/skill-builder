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

type PendingTerminalStatus = "completed" | "error" | "shutdown";

// ---------------------------------------------------------------------------
// Pending agent event buffer (for typed events arriving before run registration)
// ---------------------------------------------------------------------------

type PendingAgentEvent =
  | RunConfigEvent
  | RunInitEvent
  | TurnUsageEvent
  | CompactionEvent
  | ContextWindowEvent;

/**
 * Build a partial state update that appends `event` to the pending metadata buffer.
 * Designed to be spread into the return value of a `set()` callback so the queue
 * mutation and the "no change to runs" return happen in a single atomic update.
 */
function pendingMetadataUpdate(
  state: AgentState,
  agentId: string,
  event: PendingAgentEvent,
): Partial<AgentState> {
  console.warn(
    "[agent-store] event=metadata_queued operation=queue_pending_metadata agent_id=%s",
    agentId,
  );
  const existing = state.pendingMetadata[agentId] ?? [];
  return {
    pendingMetadata: {
      ...state.pendingMetadata,
      [agentId]: [...existing, event],
    },
  };
}

function drainPendingMetadata(agentId: string) {
  const state = useAgentStore.getState();
  const pending = state.pendingMetadata[agentId];
  if (!pending || pending.length === 0) return;
  if (!state.runs[agentId]) return;
  // Remove from pending first
  const { [agentId]: _, ...rest } = state.pendingMetadata;
  useAgentStore.setState({ pendingMetadata: rest });
  console.log(
    "[agent-store] event=metadata_replayed operation=drain_pending_metadata agent_id=%s count=%d",
    agentId,
    pending.length,
  );
  // Then apply events (re-read state each iteration since apply* calls set())
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
  const state = useAgentStore.getState();
  const existing = state.pendingTerminal[agentId];
  // Preserve the most informative terminal state. A later completed/error
  // event should overwrite an earlier shutdown fallback.
  if (!existing || existing === "shutdown") {
    useAgentStore.setState({
      pendingTerminal: {
        ...state.pendingTerminal,
        [agentId]: status,
      },
    });
    console.warn(
      "[agent-store] event=terminal_queued operation=queue_pending_terminal agent_id=%s status=%s",
      agentId,
      status,
    );
  }
}

function drainPendingTerminal(agentId: string) {
  const state = useAgentStore.getState();
  const pending = state.pendingTerminal[agentId];
  if (!pending) return;
  if (!state.runs[agentId]) return;

  const { [agentId]: _, ...rest } = state.pendingTerminal;
  useAgentStore.setState({ pendingTerminal: rest });
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

export function resetAgentStoreInternals() {
  clearDisplayItemBuffer();
  useAgentStore.setState({ pendingTerminal: {}, pendingMetadata: {} });
}

// ---------------------------------------------------------------------------
// Display item batching buffer (RAF-based)
// ---------------------------------------------------------------------------
// Items are collected in a module-level buffer and flushed in a single
// requestAnimationFrame callback. This reduces O(n) array copies per item
// to O(1) amortized — one copy per frame instead of one per message.

const _displayItemBuffer: Map<string, DisplayItem[]> = new Map();
let _rafId: number | null = null;

/** Synchronously flush all buffered display items into Zustand state. */
export function flushDisplayItems(): void {
  if (_rafId !== null) {
    if (typeof cancelAnimationFrame !== "undefined") cancelAnimationFrame(_rafId);
    _rafId = null;
  }
  if (_displayItemBuffer.size === 0) return;

  // Snapshot and clear before applying so re-entrant adds don't get lost
  const snapshot = new Map(_displayItemBuffer);
  _displayItemBuffer.clear();

  useAgentStore.setState((state) => {
    const updatedRuns = { ...state.runs };

    for (const [agentId, items] of snapshot) {
      const run = updatedRuns[agentId];
      if (!run) {
        // Auto-create run for display items arriving before startRun
        console.debug(
          "[agent-store] event=auto_create_run operation=flush_display_items agent_id=%s item_count=%d",
          agentId,
          items.length,
        );
        updatedRuns[agentId] = {
          agentId,
          model: "unknown",
          status: "running" as const,
          displayItems: items,
          startTime: Date.now(),
          contextHistory: [],
          contextWindow: DEFAULT_CONTEXT_WINDOW,
          compactionEvents: [],
          thinkingEnabled: false,
        };
        continue;
      }

      // Build the merged array: start from current items, apply buffered batch
      const merged = [...run.displayItems];
      for (const item of items) {
        const existingIdx = merged.findIndex((di) => di.id === item.id);
        if (existingIdx >= 0) {
          merged[existingIdx] = item;
        } else {
          merged.push(item);
        }
      }

      updatedRuns[agentId] = { ...run, displayItems: merged };
    }

    return { runs: updatedRuns };
  });
}

function scheduleFlush(): void {
  if (_rafId !== null) return;
  if (typeof requestAnimationFrame !== "undefined") {
    _rafId = requestAnimationFrame(() => {
      _rafId = null;
      flushDisplayItems();
    });
  } else {
    // Non-browser environment (e.g. SSR/tests without RAF polyfill):
    // flush synchronously so items always reach Zustand state.
    flushDisplayItems();
  }
}

function bufferDisplayItem(agentId: string, item: DisplayItem): void {
  let buf = _displayItemBuffer.get(agentId);
  if (!buf) {
    buf = [];
    _displayItemBuffer.set(agentId, buf);
  }
  // Deduplicate within the buffer itself (update-by-id)
  const existingIdx = buf.findIndex((di) => di.id === item.id);
  if (existingIdx >= 0) {
    buf[existingIdx] = item;
  } else {
    buf.push(item);
  }
  scheduleFlush();
}

function clearDisplayItemBuffer(): void {
  if (_rafId !== null) {
    if (typeof cancelAnimationFrame !== "undefined") cancelAnimationFrame(_rafId);
    _rafId = null;
  }
  _displayItemBuffer.clear();
}

/** Returns the number of queued terminal-status events (for testing). */
export function getPendingTerminalCount(): number {
  return Object.keys(useAgentStore.getState().pendingTerminal).length;
}

/** Returns the number of queued metadata events (for testing). */
export function getPendingMetadataCount(): number {
  return Object.keys(useAgentStore.getState().pendingMetadata).length;
}

const DEFAULT_CONTEXT_WINDOW = 200_000;

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

export interface AgentRun {
  agentId: string;
  model: string;
  status: "running" | "completed" | "error" | "shutdown";
  /** Structured display items from sidecar MessageProcessor. */
  displayItems: DisplayItem[];
  messages?: AgentMessage[];
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
  runSource?: "workflow" | "refine" | "test";
  /** Optional synthetic session key used for non-workflow usage grouping. */
  usageSessionId?: string;
}

interface AgentState {
  runs: Record<string, AgentRun>;
  activeAgentId: string | null;
  /** Pending terminal statuses for runs not yet registered */
  pendingTerminal: Record<string, PendingTerminalStatus>;
  /** Pending metadata events for runs not yet registered */
  pendingMetadata: Record<string, PendingAgentEvent[]>;
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
  pendingTerminal: {},
  pendingMetadata: {},

  startRun: (agentId, model) => {
    const workflow = useWorkflowStore.getState();
    const skillName = workflow.skillName ?? "unknown";

    set((state) => {
      const existing = state.runs[agentId];
      return {
        runs: {
          ...state.runs,
          [agentId]: existing
            ? // Run was auto-created by early messages — update model, keep displayItems.
              // Preserve terminal status: if agent-exit already fired before startRun
              // (race on fast/mock agents), keep "completed"/"error"/"shutdown" so the
              // completion effect fires correctly instead of reverting to "running".
              {
                ...existing,
                model,
                skillName,
                status: (["completed", "error", "shutdown"] as string[]).includes(existing.status)
                  ? existing.status
                  : ("running" as const),
              }
            : {
                agentId,
                model,
                skillName,
                status: "running" as const,
                displayItems: [],
                startTime: Date.now(),
                contextHistory: [],
                contextWindow: DEFAULT_CONTEXT_WINDOW,
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
                // Preserve terminal status: if agent-exit already fired before registerRun
                // (race on fast/mock agents), keep "completed"/"error"/"shutdown" so the
                // completion effect fires correctly instead of reverting to "running".
                status: (["completed", "error", "shutdown"] as string[]).includes(existing.status)
                  ? existing.status
                  : ("running" as const),
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
                contextWindow: DEFAULT_CONTEXT_WINDOW,
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

  addDisplayItem: (agentId, item) => {
    console.debug(
      "[agent-store] event=add_display_item operation=buffer agent_id=%s item_id=%s item_type=%s",
      agentId,
      item.id,
      item.type,
    );
    bufferDisplayItem(agentId, item);
  },

  applyRunConfig: (agentId, event) =>
    set((state) => {
      const run = state.runs[agentId];
      if (!run) {
        return pendingMetadataUpdate(state, agentId, event);
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
        return pendingMetadataUpdate(state, agentId, event);
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
        return pendingMetadataUpdate(state, agentId, event);
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
        return pendingMetadataUpdate(state, agentId, event);
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
        return pendingMetadataUpdate(state, agentId, event);
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
    // Flush any buffered display items so they are visible in the final run state
    flushDisplayItems();
    if (!useAgentStore.getState().runs[agentId]) {
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
    // Flush any buffered display items so they are visible in the final run state
    flushDisplayItems();
    if (!useAgentStore.getState().runs[agentId]) {
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
    clearDisplayItemBuffer();
    set({ runs: {}, activeAgentId: null, pendingTerminal: {}, pendingMetadata: {} });
  },
}));
