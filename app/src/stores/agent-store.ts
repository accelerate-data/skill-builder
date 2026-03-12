import { create } from "zustand";
import { useWorkflowStore } from "./workflow-store";
import type { DisplayItem, RunMetadata } from "@/lib/display-types";

// ---------------------------------------------------------------------------
// Pending terminal tracking (for agent-exit arriving before startRun)
// ---------------------------------------------------------------------------

type PendingTerminalStatus = "completed" | "error" | "shutdown";
let _pendingTerminalByAgent = new Map<string, PendingTerminalStatus>();

// ---------------------------------------------------------------------------
// Pending metadata buffer (for agent-metadata arriving before run registration)
// ---------------------------------------------------------------------------

let _pendingMetadataByAgent = new Map<string, RunMetadata[]>();

function queuePendingMetadata(agentId: string, metadata: RunMetadata) {
  const existing = _pendingMetadataByAgent.get(agentId) ?? [];
  existing.push(metadata);
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
  for (const metadata of pending) {
    useAgentStore.getState().updateMetadata(agentId, metadata);
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
  // Messages now arrive directly via addDisplayItem / updateMetadata.
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

interface CompactionEvent {
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
  compactionEvents: CompactionEvent[];
  thinkingEnabled: boolean;
  agentName?: string;
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
  /** Add a structured DisplayItem from the sidecar. Update-by-id for tool call status changes. */
  addDisplayItem: (agentId: string, item: DisplayItem) => void;
  /** Apply a metadata event from the sidecar (context snapshot, compaction, config, session init). */
  updateMetadata: (agentId: string, metadata: RunMetadata) => void;
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
    const capturedWorkflowSessionId = workflow.workflowSessionId ?? undefined;
    const capturedStepId = workflow.currentStep;

    set((state) => {
      const existing = state.runs[agentId];
      return {
        runs: {
          ...state.runs,
          [agentId]: existing
<<<<<<< HEAD
            ? // Run was auto-created by early messages — update model, keep displayItems
              { ...existing, model, skillName, status: "running" as const }
=======
            ? // Run was auto-created by early messages — update model, keep displayItems
              { ...existing, model, skillName, status: "running" as const }
>>>>>>> 092b94abfeb4805240f9ff3e78dcc7494cfe3d00
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
                capturedWorkflowSessionId,
                capturedStepId,
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

  updateMetadata: (agentId, metadata) =>
    set((state) => {
      const run = state.runs[agentId];
      if (!run) {
        // Run not yet registered — buffer for drain on startRun/registerRun
        queuePendingMetadata(agentId, metadata);
        return state;
      }

      let updatedRun = { ...run };

      if (metadata.contextSnapshot) {
        const { turn, inputTokens, outputTokens } = metadata.contextSnapshot;
        console.debug(
          "[agent-store] event=context_snapshot agent_id=%s turn=%d input=%d output=%d",
          agentId, turn, inputTokens, outputTokens,
        );
        updatedRun = {
          ...updatedRun,
          contextHistory: [
            ...updatedRun.contextHistory,
            { turn, inputTokens, outputTokens },
          ],
        };
      }

      if (metadata.compactionEvent) {
        const { turn, preTokens, timestamp } = metadata.compactionEvent;
        console.debug(
          "[agent-store] event=compaction agent_id=%s turn=%d pre_tokens=%d",
          agentId, turn, preTokens,
        );
        updatedRun = {
          ...updatedRun,
          compactionEvents: [
            ...updatedRun.compactionEvents,
            { turn, preTokens, timestamp },
          ],
        };
      }

      if (metadata.sessionInit) {
        const { sessionId, model } = metadata.sessionInit;
        console.debug(
          "[agent-store] event=session_init agent_id=%s model=%s",
          agentId, model,
        );
        updatedRun = { ...updatedRun, sessionId, model };
      }

      if (metadata.contextWindow !== undefined && metadata.contextWindow > 0) {
        console.debug(
          "[agent-store] event=context_window agent_id=%s window=%d",
          agentId, metadata.contextWindow,
        );
        updatedRun = { ...updatedRun, contextWindow: Math.max(updatedRun.contextWindow, metadata.contextWindow) };
      }

      if (metadata.config) {
        const { thinkingEnabled, agentName } = metadata.config;
        console.debug(
          "[agent-store] event=config agent_id=%s thinking=%s agent=%s",
          agentId, thinkingEnabled, agentName,
        );
        if (thinkingEnabled !== undefined) {
          updatedRun = { ...updatedRun, thinkingEnabled };
        }
        if (agentName !== undefined) {
          updatedRun = { ...updatedRun, agentName };
        }
      }

      return {
        runs: {
          ...state.runs,
          [agentId]: updatedRun,
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
