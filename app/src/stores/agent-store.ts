import { create } from "zustand";
import { useWorkflowStore } from "./workflow-store";
import {
  flushDisplayItems,
  bufferDisplayItem,
  clearDisplayItemBuffer,
  clearPhantomTimer,
  clearAllPhantomTimers,
  clearDisplayItemBufferForAgents,
  clearPhantomTimersForAgents,
} from "./agent-display-buffer";

import type { DisplayItem } from "@/lib/display-types";
import type {
  CompactionEvent,
  ContextWindowEvent,
  RunConfigEvent,
  RunInitEvent,
  TurnUsageEvent,
} from "@/lib/agent-events";
import type {
  OpenHandsConversationEvent,
  OpenHandsConversationState,
} from "@/lib/openhands-conversation-events";
import {
  getParentToolCallId,
  isTerminalConversationStatus,
} from "@/lib/openhands-conversation-events";
import {
  projectConversationEvent,
  type PendingActionEntry,
} from "@/lib/openhands-event-projection";
import {
  summarizeCompletedRun,
  summarizeErrorRun,
} from "@/lib/openhands-result-summary";
import { formatProviderModelId } from "@/lib/models";

type PendingTerminalStatus = "completed" | "error" | "shutdown";

interface PendingTerminalEvent {
  status: PendingTerminalStatus;
  errorDetail?: string;
}

function patchDisplayItemById(
  items: DisplayItem[],
  targetId: string,
  patch: Partial<DisplayItem>,
): DisplayItem[] {
  let changed = false;
  const nextItems = items.map((item) => {
    if (item.id === targetId) {
      changed = true;
      return { ...item, ...patch };
    }
    if (item.subagentItems && item.subagentItems.length > 0) {
      const nextChildren = patchDisplayItemById(item.subagentItems, targetId, patch);
      if (nextChildren !== item.subagentItems) {
        changed = true;
        return { ...item, subagentItems: nextChildren };
      }
    }
    return item;
  });
  return changed ? nextItems : items;
}

function appendChildItemToParentToolCall(
  items: DisplayItem[],
  parentToolCallId: string,
  child: DisplayItem,
): DisplayItem[] {
  let changed = false;
  const nextItems = items.map((item) => {
    if (item.toolCallId === parentToolCallId && item.type === "subagent") {
      changed = true;
      return {
        ...item,
        subagentItems: [...(item.subagentItems ?? []), child],
      };
    }
    if (item.subagentItems && item.subagentItems.length > 0) {
      const nextChildren = appendChildItemToParentToolCall(
        item.subagentItems,
        parentToolCallId,
        child,
      );
      if (nextChildren !== item.subagentItems) {
        changed = true;
        return { ...item, subagentItems: nextChildren };
      }
    }
    return item;
  });
  return changed ? nextItems : items;
}

function flushQueuedChildItems(
  items: DisplayItem[],
  queuedByParentToolCallId: Record<string, DisplayItem[]>,
): {
  items: DisplayItem[];
  remaining: Record<string, DisplayItem[]>;
} {
  let nextItems = items;
  const remaining: Record<string, DisplayItem[]> = {};

  for (const [parentToolCallId, queuedItems] of Object.entries(
    queuedByParentToolCallId,
  )) {
    let localItems = nextItems;
    let attachedCount = 0;

    for (const item of queuedItems) {
      const maybeNested = appendChildItemToParentToolCall(
        localItems,
        parentToolCallId,
        item,
      );
      if (maybeNested === localItems) {
        break;
      }
      localItems = maybeNested;
      attachedCount += 1;
    }

    nextItems = localItems;
    if (attachedCount < queuedItems.length) {
      remaining[parentToolCallId] = queuedItems.slice(attachedCount);
    }
  }

  return { items: nextItems, remaining };
}

// ---------------------------------------------------------------------------
// Pending agent event buffer (for typed events arriving before run registration)
// ---------------------------------------------------------------------------

type PendingAgentEvent =
  | ({ _tag: "run_config" } & RunConfigEvent)
  | ({ _tag: "run_init" } & RunInitEvent)
  | ({ _tag: "turn_usage" } & TurnUsageEvent)
  | ({ _tag: "compaction" } & CompactionEvent)
  | ({ _tag: "context_window" } & ContextWindowEvent);

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

function queuePendingTerminal(
  agentId: string,
  status: PendingTerminalStatus,
  errorDetail?: string,
) {
  const state = useAgentStore.getState();
  const existing = state.pendingTerminal[agentId];
  // Preserve the most informative terminal state. A later completed/error
  // event should overwrite an earlier shutdown fallback.
  if (!existing || existing.status === "shutdown") {
    useAgentStore.setState({
      pendingTerminal: {
        ...state.pendingTerminal,
        [agentId]: { status, errorDetail },
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
    pending.status,
  );
  if (pending.status === "shutdown") {
    useAgentStore.getState().shutdownRun(agentId);
    return;
  }
  useAgentStore
    .getState()
    .completeRun(
      agentId,
      pending.status === "completed",
      pending.errorDetail,
    );
}

export function resetAgentStoreInternals() {
  clearDisplayItemBuffer();
  clearAllPhantomTimers();
  useAgentStore.setState({ pendingTerminal: {}, pendingMetadata: {} });
}

// Re-export buffer utilities for external consumers
export {
  flushDisplayItems,
  getPhantomTimerCount,
} from "./agent-display-buffer";

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
  return formatProviderModelId(model);
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

export interface AgentRun {
  agentId: string;
  model: string;
  status: "running" | "completed" | "error" | "shutdown";
  /** Structured display items from the runtime event stream. */
  displayItems: DisplayItem[];
  /** OpenHands-native conversation events for clean-break runtime runs. */
  conversationEvents?: OpenHandsConversationEvent[];
  conversationState?: OpenHandsConversationState;
  /** Pending OpenHands ActionEvents awaiting their matching ObservationEvent.
   *  Keyed by tool_call_id. Used by the projection to pair actions ↔ observations. */
  pendingActionsByToolCallId: Record<string, PendingActionEntry>;
  /** Child subagent items that arrived before the parent subagent row existed. */
  pendingSubagentItemsByParentToolCallId: Record<string, DisplayItem[]>;
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
  /** SDK prompt suggestion — predicted next user prompt, arrives after result. */
  promptSuggestion?: string;
}

interface AgentState {
  runs: Record<string, AgentRun>;
  activeAgentId: string | null;
  /** Pending terminal statuses for runs not yet registered */
  pendingTerminal: Record<string, PendingTerminalEvent>;
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
  /** Add a structured DisplayItem from the runtime. Update-by-id for tool call status changes. */
  addDisplayItem: (agentId: string, item: DisplayItem) => void;
  addConversationEvent: (
    agentId: string,
    event: OpenHandsConversationEvent,
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
  setActiveAgent: (agentId: string | null) => void;
  clearRuns: () => void;
  clearRunsBySource: (source: AgentRun["runSource"]) => void;
}

export const useAgentStore = create<AgentState>((set) => ({
  runs: {},
  activeAgentId: null,
  pendingTerminal: {},
  pendingMetadata: {},

  startRun: (agentId, model) => {
    clearPhantomTimer(agentId);
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
                status: (
                  ["completed", "error", "shutdown"] as string[]
                ).includes(existing.status)
                  ? existing.status
                  : ("running" as const),
              }
            : {
                agentId,
                model,
                skillName,
                status: "running" as const,
                displayItems: [],
                conversationEvents: [],
                pendingActionsByToolCallId: {},
                pendingSubagentItemsByParentToolCallId: {},
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

  registerRun: (
    agentId,
    model,
    skillName?,
    runSource = "refine",
    usageSessionId?,
  ) => {
    clearPhantomTimer(agentId);
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
                status: (
                  ["completed", "error", "shutdown"] as string[]
                ).includes(existing.status)
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
                conversationEvents: [],
                pendingActionsByToolCallId: {},
                pendingSubagentItemsByParentToolCallId: {},
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

  addConversationEvent: (agentId, event) =>
    set((state) => {
      const parentToolCallId = getParentToolCallId(event);
      const run = state.runs[agentId];
      if (!run) {
        console.debug(
          "[agent-store] event=auto_create_run operation=add_conversation_event agent_id=%s",
          agentId,
        );
        // Project against an empty pending map for the freshly created run.
        const projection = projectConversationEvent(event, {});
        const nextPendingSubagentItems: Record<string, DisplayItem[]> = {};
        let nextDisplayItems: DisplayItem[] = [];
        if (parentToolCallId) {
          for (const item of projection.add) {
            console.warn(
              "[agent-store] event=subagent_child_queued_without_run agent_id=%s parent_tool_call_id=%s item_type=%s item_id=%s",
              agentId,
              parentToolCallId,
              item.type,
              item.id,
            );
            nextPendingSubagentItems[parentToolCallId] = [
              ...(nextPendingSubagentItems[parentToolCallId] ?? []),
              {
                ...item,
                parentToolCallId,
              },
            ];
          }
        } else {
          nextDisplayItems = [...projection.add];
        }
        const nextPending: Record<string, PendingActionEntry> = {};
        for (const entry of projection.pendingDelta.set ?? []) {
          nextPending[entry.key] = entry.value;
        }
        for (const key of projection.pendingDelta.delete ?? []) {
          delete nextPending[key];
        }
        return {
          runs: {
            ...state.runs,
            [agentId]: {
              agentId,
              model: "unknown",
              status: "running" as const,
              displayItems: nextDisplayItems,
              conversationEvents: [event],
              pendingActionsByToolCallId: nextPending,
              pendingSubagentItemsByParentToolCallId: nextPendingSubagentItems,
              startTime: Date.now(),
              contextHistory: [],
              contextWindow: DEFAULT_CONTEXT_WINDOW,
              compactionEvents: [],
              thinkingEnabled: false,
            },
          },
        };
      }

      const projection = projectConversationEvent(
        event,
        run.pendingActionsByToolCallId,
      );

      // Apply updates: shallow-merge each patch onto the matching DisplayItem by id.
      let nextDisplayItems: DisplayItem[] = run.displayItems;
      let nextPendingSubagentItems = {
        ...run.pendingSubagentItemsByParentToolCallId,
      };
      if (projection.update.length > 0) {
        for (const update of projection.update) {
          nextDisplayItems = patchDisplayItemById(
            nextDisplayItems,
            update.id,
            update.patch,
          );
        }
      }
      if (projection.add.length > 0) {
        if (parentToolCallId) {
          for (const item of projection.add) {
            const nestedItem = {
              ...item,
              parentToolCallId,
            };
            const maybeNested = appendChildItemToParentToolCall(
              nextDisplayItems,
              parentToolCallId,
              nestedItem,
            );
            if (maybeNested === nextDisplayItems) {
              console.warn(
                "[agent-store] event=subagent_child_queued agent_id=%s parent_tool_call_id=%s item_type=%s item_id=%s",
                agentId,
                parentToolCallId,
                item.type,
                item.id,
              );
              nextPendingSubagentItems[parentToolCallId] = [
                ...(nextPendingSubagentItems[parentToolCallId] ?? []),
                nestedItem,
              ];
            } else {
              console.debug(
                "[agent-store] event=subagent_child_attached agent_id=%s parent_tool_call_id=%s item_type=%s item_id=%s",
                agentId,
                parentToolCallId,
                item.type,
                item.id,
              );
              nextDisplayItems = maybeNested;
            }
          }
        } else {
          nextDisplayItems = [...nextDisplayItems, ...projection.add];
        }
      }

      const flushed = flushQueuedChildItems(
        nextDisplayItems,
        nextPendingSubagentItems,
      );
      if (
        Object.keys(nextPendingSubagentItems).length > 0 ||
        Object.keys(flushed.remaining).length > 0
      ) {
        console.debug(
          "[agent-store] event=subagent_flush agent_id=%s queued_before=%d queued_after=%d display_items=%d",
          agentId,
          Object.keys(nextPendingSubagentItems).length,
          Object.keys(flushed.remaining).length,
          flushed.items.length,
        );
      }
      nextDisplayItems = flushed.items;
      nextPendingSubagentItems = flushed.remaining;

      // Apply pending-actions delta (set first, then delete — matches projection contract).
      let nextPending = run.pendingActionsByToolCallId;
      const setEntries = projection.pendingDelta.set ?? [];
      const deleteKeys = projection.pendingDelta.delete ?? [];
      if (setEntries.length > 0 || deleteKeys.length > 0) {
        nextPending = { ...nextPending };
        for (const entry of setEntries) {
          nextPending[entry.key] = entry.value;
        }
        for (const key of deleteKeys) {
          delete nextPending[key];
        }
      }

      return {
        runs: {
          ...state.runs,
          [agentId]: {
            ...run,
            conversationEvents: [...(run.conversationEvents ?? []), event],
            displayItems: nextDisplayItems,
            pendingActionsByToolCallId: nextPending,
            pendingSubagentItemsByParentToolCallId: nextPendingSubagentItems,
          },
        },
      };
    }),

  applyConversationState: (agentId, event) => {
    clearPhantomTimer(agentId);
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

      // Build the synthesized terminal DisplayItem (if any) for the appropriate
      // terminal status. Returns undefined for non-terminal transitions.
      const buildTerminalItem = (): DisplayItem | undefined => {
        if (event.status === "completed") {
          const { summary } = summarizeCompletedRun(event);
          const body =
            typeof event.resultText === "string" &&
            event.resultText.trim().length > 0
              ? event.resultText
              : summary;
          return {
            id:
              typeof crypto !== "undefined" &&
              typeof crypto.randomUUID === "function"
                ? crypto.randomUUID()
                : `id-${Math.random().toString(36).slice(2)}-${Date.now()}`,
            type: "output",
            timestamp: event.timestamp ?? Date.now(),
            outputText: body,
            outputText_result: summary,
          };
        }
        if (event.status === "error" || event.status === "cancelled") {
          const { summary } = summarizeErrorRun(event);
          return {
            id:
              typeof crypto !== "undefined" &&
              typeof crypto.randomUUID === "function"
                ? crypto.randomUUID()
                : `id-${Math.random().toString(36).slice(2)}-${Date.now()}`,
            type: "error",
            timestamp: event.timestamp ?? Date.now(),
            errorMessage: summary,
          };
        }
        return undefined;
      };

      if (!run) {
        const terminalItem = buildTerminalItem();
        return {
          runs: {
            ...state.runs,
            [agentId]: {
              agentId,
              model: "unknown",
              status: nextStatus,
              displayItems: terminalItem ? [terminalItem] : [],
              conversationEvents: [],
              pendingActionsByToolCallId: {},
              pendingSubagentItemsByParentToolCallId: {},
              conversationState: event,
              startTime: now,
              endTime: nextEndTime,
              resultErrors: nextResultErrors,
              contextHistory: [],
              contextWindow: DEFAULT_CONTEXT_WINDOW,
              compactionEvents: [],
              thinkingEnabled: false,
            },
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

      const terminalItem = buildTerminalItem();
      const nextDisplayItems = terminalItem
        ? [...run.displayItems, terminalItem]
        : run.displayItems;

      return {
        runs: {
          ...state.runs,
          [agentId]: {
            ...run,
            status: nextStatus,
            conversationState: event,
            endTime: nextEndTime,
            resultErrors: nextResultErrors,
            displayItems: nextDisplayItems,
          },
        },
      };
    });
  },

  applyRunConfig: (agentId, event) =>
    set((state) => {
      const run = state.runs[agentId];
      if (!run) {
        return pendingMetadataUpdate(state, agentId, {
          _tag: "run_config",
          ...event,
        });
      }

      console.debug(
        "[agent-store] event=run_config agent_id=%s thinking=%s agent=%s",
        agentId,
        event.thinkingEnabled,
        event.agentName,
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
        return pendingMetadataUpdate(state, agentId, {
          _tag: "run_init",
          ...event,
        });
      }

      console.debug(
        "[agent-store] event=run_init agent_id=%s model=%s",
        agentId,
        event.model,
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
        return pendingMetadataUpdate(state, agentId, {
          _tag: "turn_usage",
          ...event,
        });
      }

      console.debug(
        "[agent-store] event=turn_usage agent_id=%s turn=%d input=%d output=%d",
        agentId,
        event.turn,
        event.inputTokens,
        event.outputTokens,
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
        return pendingMetadataUpdate(state, agentId, {
          _tag: "compaction",
          ...event,
        });
      }

      console.debug(
        "[agent-store] event=compaction agent_id=%s turn=%d pre_tokens=%d",
        agentId,
        event.turn,
        event.preTokens,
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
        return pendingMetadataUpdate(state, agentId, {
          _tag: "context_window",
          ...event,
        });
      }

      if (event.contextWindow <= 0) {
        return state;
      }

      console.debug(
        "[agent-store] event=context_window agent_id=%s window=%d",
        agentId,
        event.contextWindow,
      );

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
    clearPhantomTimer(agentId);
    // Flush any buffered display items so they are visible in the final run state
    flushDisplayItems();
    if (!useAgentStore.getState().runs[agentId]) {
      queuePendingTerminal(
        agentId,
        success ? "completed" : "error",
        errorDetail,
      );
      return;
    }

    set((state) => {
      const run = state.runs[agentId];
      if (!run) return state;
      // If the run is already in a terminal state (e.g. set by a display-item
      // flush racing ahead of startRun), do not overwrite terminal status, but
      // still allow a later agent-exit payload to enrich missing error detail.
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

  shutdownRun: (agentId: string) => {
    clearPhantomTimer(agentId);
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
    clearAllPhantomTimers();
    set({
      runs: {},
      activeAgentId: null,
      pendingTerminal: {},
      pendingMetadata: {},
    });
  },

  clearRunsBySource: (source) => {
    set((state) => {
      const removedAgentIds = Object.entries(state.runs)
        .filter(([, run]) => run.runSource === source)
        .map(([agentId]) => agentId);
      clearDisplayItemBufferForAgents(removedAgentIds);
      clearPhantomTimersForAgents(removedAgentIds);
      const nextRuns = Object.fromEntries(
        Object.entries(state.runs).filter(([, run]) => run.runSource !== source),
      );
      const nextActiveAgentId =
        state.activeAgentId && nextRuns[state.activeAgentId]
          ? state.activeAgentId
          : null;
      const nextPendingTerminal = Object.fromEntries(
        Object.entries(state.pendingTerminal).filter(([agentId]) => nextRuns[agentId]),
      );
      const nextPendingMetadata = Object.fromEntries(
        Object.entries(state.pendingMetadata).filter(([agentId]) => nextRuns[agentId]),
      );
      return {
        runs: nextRuns,
        activeAgentId: nextActiveAgentId,
        pendingTerminal: nextPendingTerminal,
        pendingMetadata: nextPendingMetadata,
      };
    });
  },
}));
