/**
 * RAF-based display item batching buffer for the agent store.
 *
 * Items are collected in a module-level buffer and flushed in a single
 * requestAnimationFrame callback. This reduces O(n) array copies per item
 * to O(1) amortized — one copy per frame instead of one per message.
 *
 * Also manages phantom run reaping: auto-created runs that never receive
 * startRun/registerRun within PHANTOM_RUN_TTL_MS are marked as "error"
 * so they don't stay stuck at status: "running" with model: "unknown".
 */
import type { DisplayItem } from "@/lib/display-types";
// Circular import is safe: useAgentStore is only accessed at runtime inside
// callbacks/timers, never at module-evaluation time.
import { useAgentStore } from "./agent-store";

const DEFAULT_CONTEXT_WINDOW = 200_000;

// ---------------------------------------------------------------------------
// Display item buffer
// ---------------------------------------------------------------------------

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
        schedulePhantomReaper(agentId);
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

export function bufferDisplayItem(agentId: string, item: DisplayItem): void {
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

export function clearDisplayItemBuffer(): void {
  if (_rafId !== null) {
    if (typeof cancelAnimationFrame !== "undefined") cancelAnimationFrame(_rafId);
    _rafId = null;
  }
  _displayItemBuffer.clear();
}

// ---------------------------------------------------------------------------
// Phantom run reaper
// ---------------------------------------------------------------------------

const PHANTOM_RUN_TTL_MS = 30_000;
const _phantomTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

export function schedulePhantomReaper(agentId: string): void {
  clearPhantomTimer(agentId);
  const timer = setTimeout(() => {
    _phantomTimers.delete(agentId);
    const run = useAgentStore.getState().runs[agentId];
    if (run && run.model === "unknown" && run.status === "running") {
      console.warn(
        "[agent-store] event=phantom_run_reaped operation=reaper agent_id=%s age_ms=%d",
        agentId,
        Date.now() - run.startTime,
      );
      useAgentStore.setState((state) => {
        const existing = state.runs[agentId];
        if (!existing || existing.model !== "unknown" || existing.status !== "running") return state;
        return {
          runs: {
            ...state.runs,
            [agentId]: { ...existing, status: "error" as const, endTime: Date.now() },
          },
        };
      });
    }
  }, PHANTOM_RUN_TTL_MS);
  _phantomTimers.set(agentId, timer);
}

export function clearPhantomTimer(agentId: string): void {
  const existing = _phantomTimers.get(agentId);
  if (existing !== undefined) {
    clearTimeout(existing);
    _phantomTimers.delete(agentId);
  }
}

export function clearAllPhantomTimers(): void {
  for (const timer of _phantomTimers.values()) clearTimeout(timer);
  _phantomTimers.clear();
}

/** Visible for testing. */
export function getPhantomTimerCount(): number {
  return _phantomTimers.size;
}
