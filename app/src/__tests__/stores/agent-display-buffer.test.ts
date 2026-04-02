import { describe, it, expect, beforeEach, vi } from "vitest";
import type { DisplayItem } from "@/lib/display-types";
import {
  bufferDisplayItem,
  clearDisplayItemBuffer,
  flushDisplayItems,
  clearAllPhantomTimers,
  getPhantomTimerCount,
} from "@/stores/agent-display-buffer";
import { useAgentStore } from "@/stores/agent-store";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeItem(id: string, overrides: Partial<DisplayItem> = {}): DisplayItem {
  return {
    id,
    type: "output",
    content: `content-${id}`,
    ...overrides,
  } as DisplayItem;
}

function getRun(agentId: string) {
  return useAgentStore.getState().runs[agentId];
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  // Reset Zustand store state
  useAgentStore.setState({ runs: {} });
  clearDisplayItemBuffer();
  clearAllPhantomTimers();
  vi.useFakeTimers();
});

// ---------------------------------------------------------------------------
// bufferDisplayItem + flushDisplayItems
// ---------------------------------------------------------------------------

describe("bufferDisplayItem + flushDisplayItems", () => {
  it("buffers items and flushes them into the agent store", () => {
    bufferDisplayItem("agent-1", makeItem("item-1"));
    bufferDisplayItem("agent-1", makeItem("item-2"));
    flushDisplayItems();

    const run = getRun("agent-1");
    expect(run).toBeDefined();
    expect(run!.displayItems).toHaveLength(2);
    expect(run!.displayItems[0].id).toBe("item-1");
    expect(run!.displayItems[1].id).toBe("item-2");
  });

  it("auto-creates a run when display items arrive before startRun", () => {
    bufferDisplayItem("new-agent", makeItem("item-1"));
    flushDisplayItems();

    const run = getRun("new-agent");
    expect(run).toBeDefined();
    expect(run!.model).toBe("unknown");
    expect(run!.status).toBe("running");
  });

  it("deduplicates items by id within the buffer", () => {
    bufferDisplayItem("agent-1", makeItem("item-1", { content: "v1" } as Partial<DisplayItem>));
    bufferDisplayItem("agent-1", makeItem("item-1", { content: "v2" } as Partial<DisplayItem>));
    flushDisplayItems();

    const run = getRun("agent-1");
    expect(run!.displayItems).toHaveLength(1);
    expect((run!.displayItems[0] as DisplayItem & { content: string }).content).toBe("v2");
  });

  it("merges buffered items into existing run display items", () => {
    // Pre-populate a run with one item
    useAgentStore.setState({
      runs: {
        "agent-1": {
          agentId: "agent-1",
          model: "claude-sonnet-4-6",
          status: "running",
          displayItems: [makeItem("existing")],
          startTime: Date.now(),
          contextHistory: [],
          contextWindow: 200_000,
          compactionEvents: [],
          thinkingEnabled: false,
        },
      },
    });

    bufferDisplayItem("agent-1", makeItem("new-item"));
    flushDisplayItems();

    const run = getRun("agent-1");
    expect(run!.displayItems).toHaveLength(2);
    expect(run!.displayItems[0].id).toBe("existing");
    expect(run!.displayItems[1].id).toBe("new-item");
  });

  it("updates existing display items by id during merge", () => {
    useAgentStore.setState({
      runs: {
        "agent-1": {
          agentId: "agent-1",
          model: "claude-sonnet-4-6",
          status: "running",
          displayItems: [makeItem("item-1", { content: "old" } as Partial<DisplayItem>)],
          startTime: Date.now(),
          contextHistory: [],
          contextWindow: 200_000,
          compactionEvents: [],
          thinkingEnabled: false,
        },
      },
    });

    bufferDisplayItem("agent-1", makeItem("item-1", { content: "new" } as Partial<DisplayItem>));
    flushDisplayItems();

    const run = getRun("agent-1");
    expect(run!.displayItems).toHaveLength(1);
    expect((run!.displayItems[0] as DisplayItem & { content: string }).content).toBe("new");
  });

  it("handles multiple agents independently", () => {
    bufferDisplayItem("agent-a", makeItem("a1"));
    bufferDisplayItem("agent-b", makeItem("b1"));
    bufferDisplayItem("agent-b", makeItem("b2"));
    flushDisplayItems();

    expect(getRun("agent-a")!.displayItems).toHaveLength(1);
    expect(getRun("agent-b")!.displayItems).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// clearDisplayItemBuffer
// ---------------------------------------------------------------------------

describe("clearDisplayItemBuffer", () => {
  it("discards buffered items without flushing", () => {
    bufferDisplayItem("agent-1", makeItem("item-1"));
    clearDisplayItemBuffer();
    flushDisplayItems();

    expect(getRun("agent-1")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// flushDisplayItems edge cases
// ---------------------------------------------------------------------------

describe("flushDisplayItems edge cases", () => {
  it("is a no-op when buffer is empty", () => {
    useAgentStore.setState({ runs: {} });
    flushDisplayItems();
    expect(useAgentStore.getState().runs).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// Phantom run reaper
// ---------------------------------------------------------------------------

describe("phantom run reaper", () => {
  it("schedules a phantom reaper when auto-creating a run", () => {
    bufferDisplayItem("phantom-agent", makeItem("item-1"));
    flushDisplayItems();

    expect(getPhantomTimerCount()).toBe(1);
  });

  it("marks phantom run as error after TTL expires", () => {
    bufferDisplayItem("phantom-agent", makeItem("item-1"));
    flushDisplayItems();

    // Verify it's running with unknown model
    expect(getRun("phantom-agent")!.status).toBe("running");
    expect(getRun("phantom-agent")!.model).toBe("unknown");

    // Advance past the 30s TTL
    vi.advanceTimersByTime(30_001);

    const run = getRun("phantom-agent");
    expect(run!.status).toBe("error");
    expect(run!.endTime).toBeDefined();
  });

  it("does not reap a run that was registered (model set)", () => {
    bufferDisplayItem("real-agent", makeItem("item-1"));
    flushDisplayItems();

    // Simulate registration by setting the model
    useAgentStore.setState((state) => ({
      runs: {
        ...state.runs,
        "real-agent": { ...state.runs["real-agent"]!, model: "claude-sonnet-4-6" },
      },
    }));

    vi.advanceTimersByTime(30_001);

    expect(getRun("real-agent")!.status).toBe("running");
  });

  it("clearAllPhantomTimers prevents reaping", () => {
    bufferDisplayItem("phantom-agent", makeItem("item-1"));
    flushDisplayItems();

    clearAllPhantomTimers();
    expect(getPhantomTimerCount()).toBe(0);

    vi.advanceTimersByTime(30_001);
    expect(getRun("phantom-agent")!.status).toBe("running");
  });
});
