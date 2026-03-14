import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  useAgentStore,
  formatModelName,
  formatTokenCount,
  getLatestContextTokens,
  getContextUtilization,
  resetAgentStoreInternals,
  getPendingTerminalCount,
  getPendingMetadataCount,
  flushDisplayItems,
} from "@/stores/agent-store";
import type { DisplayItem } from "@/lib/display-types";


function makeDisplayItem(overrides: Partial<DisplayItem> & { type: DisplayItem["type"] }): DisplayItem {
  return {
    id: `di-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
    ...overrides,
  } as DisplayItem;
}

describe("useAgentStore", () => {
  beforeEach(() => {
    resetAgentStoreInternals();
    useAgentStore.getState().clearRuns();
    vi.restoreAllMocks();
  });

  it("has empty initial state", () => {
    const state = useAgentStore.getState();
    expect(state.runs).toEqual({});
    expect(state.activeAgentId).toBeNull();
  });

  it("startRun creates a new run with status 'running'", () => {
    const beforeTime = Date.now();
    useAgentStore.getState().startRun("agent-1", "sonnet");
    const state = useAgentStore.getState();

    expect(state.runs["agent-1"]).toBeDefined();
    expect(state.runs["agent-1"].agentId).toBe("agent-1");
    expect(state.runs["agent-1"].model).toBe("sonnet");
    expect(state.runs["agent-1"].status).toBe("running");
    expect(state.runs["agent-1"].displayItems).toEqual([]);
    expect(state.runs["agent-1"].startTime).toBeGreaterThanOrEqual(beforeTime);
    expect(state.runs["agent-1"].endTime).toBeUndefined();
    expect(state.runs["agent-1"].totalCost).toBeUndefined();
    expect(state.runs["agent-1"].tokenUsage).toBeUndefined();
    // Sets activeAgentId
    expect(state.activeAgentId).toBe("agent-1");
  });

  it("addDisplayItem appends to the run's displayItems array", () => {
    useAgentStore.getState().startRun("agent-1", "sonnet");

    const item1 = makeDisplayItem({ type: "output", outputText: "Hello" });
    const item2 = makeDisplayItem({ type: "output", outputText: "World" });

    useAgentStore.getState().addDisplayItem("agent-1", item1);
    useAgentStore.getState().addDisplayItem("agent-1", item2);
    flushDisplayItems();

    const state = useAgentStore.getState();
    expect(state.runs["agent-1"].displayItems).toHaveLength(2);
    expect(state.runs["agent-1"].displayItems[0].outputText).toBe("Hello");
    expect(state.runs["agent-1"].displayItems[1].outputText).toBe("World");
  });

  it("addDisplayItem replaces existing item with same id (update-by-id)", () => {
    useAgentStore.getState().startRun("agent-1", "sonnet");

    const item = makeDisplayItem({
      id: "tool-1",
      type: "tool_call",
      toolName: "Read",
      toolStatus: "pending",
    });
    useAgentStore.getState().addDisplayItem("agent-1", item);

    const updated = makeDisplayItem({
      id: "tool-1",
      type: "tool_call",
      toolName: "Read",
      toolStatus: "ok",
    });
    useAgentStore.getState().addDisplayItem("agent-1", updated);
    flushDisplayItems();

    const run = useAgentStore.getState().runs["agent-1"];
    expect(run.displayItems).toHaveLength(1);
    expect(run.displayItems[0].toolStatus).toBe("ok");
  });

  it("completeRun with success=true sets status 'completed' and endTime", () => {
    useAgentStore.getState().startRun("agent-1", "sonnet");
    const beforeComplete = Date.now();
    useAgentStore.getState().completeRun("agent-1", true);

    const run = useAgentStore.getState().runs["agent-1"];
    expect(run.status).toBe("completed");
    expect(run.endTime).toBeDefined();
    expect(run.endTime).toBeGreaterThanOrEqual(beforeComplete);
  });

  it("completeRun with success=false sets status 'error'", () => {
    useAgentStore.getState().startRun("agent-1", "sonnet");
    useAgentStore.getState().completeRun("agent-1", false);

    const run = useAgentStore.getState().runs["agent-1"];
    expect(run.status).toBe("error");
    expect(run.endTime).toBeDefined();
  });

  it("addDisplayItem auto-creates run for unknown agent", () => {
    const item = makeDisplayItem({ type: "output", outputText: "Hello" });
    useAgentStore.getState().addDisplayItem("nonexistent", item);
    flushDisplayItems();

    const run = useAgentStore.getState().runs["nonexistent"];
    expect(run).toBeDefined();
    expect(run.model).toBe("unknown");
    expect(run.displayItems).toHaveLength(1);
    expect(run.displayItems[0].outputText).toBe("Hello");
  });

  it("completeRun for a non-existent run is a no-op", () => {
    useAgentStore.getState().completeRun("nonexistent", true);
    const state = useAgentStore.getState();
    expect(state.runs["nonexistent"]).toBeUndefined();
  });

  it("replays queued completion when terminal event arrives before registration", () => {
    // Simulate agent-exit arriving before registerRun/startRun.
    useAgentStore.getState().completeRun("late-agent", true);
    expect(useAgentStore.getState().runs["late-agent"]).toBeUndefined();

    // Registering the run should replay completion.
    useAgentStore.getState().registerRun("late-agent", "sonnet", "my-skill", "refine");
    const run = useAgentStore.getState().runs["late-agent"];
    expect(run.status).toBe("completed");
  });

  it("replays queued shutdown when shutdown event arrives before registration", () => {
    useAgentStore.getState().shutdownRun("late-shutdown");
    expect(useAgentStore.getState().runs["late-shutdown"]).toBeUndefined();

    useAgentStore.getState().registerRun("late-shutdown", "sonnet", "my-skill", "test");
    const run = useAgentStore.getState().runs["late-shutdown"];
    expect(run.status).toBe("shutdown");
  });

  it("preserves completed status when registerRun races with agent-exit after auto-create", () => {
    // Simulate fast/mock agent race:
    // 1. display_item arrives → addDisplayItem auto-creates run (status "running")
    // 2. agent-exit fires   → completeRun sets status "completed"
    // 3. registerRun called  → must NOT revert status back to "running"
    const item = makeDisplayItem({ type: "output", outputText: "hello" });
    useAgentStore.getState().addDisplayItem("race-agent", item);
    flushDisplayItems();
    expect(useAgentStore.getState().runs["race-agent"].status).toBe("running");

    useAgentStore.getState().completeRun("race-agent", true);
    expect(useAgentStore.getState().runs["race-agent"].status).toBe("completed");

    useAgentStore.getState().registerRun("race-agent", "sonnet", "my-skill", "refine");
    expect(useAgentStore.getState().runs["race-agent"].status).toBe("completed");
  });

  it("preserves completed status when startRun races with agent-exit after auto-create", () => {
    // Same race but via startRun (workflow path)
    const item = makeDisplayItem({ type: "output", outputText: "hello" });
    useAgentStore.getState().addDisplayItem("race-wf-agent", item);
    flushDisplayItems();
    useAgentStore.getState().completeRun("race-wf-agent", true);
    expect(useAgentStore.getState().runs["race-wf-agent"].status).toBe("completed");

    useAgentStore.getState().startRun("race-wf-agent", "sonnet");
    expect(useAgentStore.getState().runs["race-wf-agent"].status).toBe("completed");
  });

  it("uses provided refine usageSessionId for usage grouping", () => {
    useAgentStore.getState().registerRun(
      "refine-session-agent",
      "sonnet",
      "my-skill",
      "refine",
      "synthetic:refine:my-skill:session-123",
    );
    const run = useAgentStore.getState().runs["refine-session-agent"];
    expect(run.usageSessionId).toBe("synthetic:refine:my-skill:session-123");
  });

  it("uses provided test usageSessionId for usage grouping", () => {
    useAgentStore.getState().registerRun(
      "test-session-agent",
      "sonnet",
      "my-skill",
      "test",
      "synthetic:test:my-skill:test-456",
    );
    const run = useAgentStore.getState().runs["test-session-agent"];
    expect(run.usageSessionId).toBe("synthetic:test:my-skill:test-456");
  });

  it("clearRuns empties everything", () => {
    useAgentStore.getState().startRun("agent-1", "sonnet");
    useAgentStore.getState().startRun("agent-2", "opus");

    useAgentStore.getState().addDisplayItem("agent-1", makeDisplayItem({ type: "output", outputText: "test" }));
    flushDisplayItems();

    useAgentStore.getState().clearRuns();

    const state = useAgentStore.getState();
    expect(state.runs).toEqual({});
    expect(state.activeAgentId).toBeNull();
  });

  it("setActiveAgent changes the activeAgentId", () => {
    useAgentStore.getState().startRun("agent-1", "sonnet");
    useAgentStore.getState().startRun("agent-2", "opus");

    // activeAgentId should be the last started
    expect(useAgentStore.getState().activeAgentId).toBe("agent-2");

    useAgentStore.getState().setActiveAgent("agent-1");
    expect(useAgentStore.getState().activeAgentId).toBe("agent-1");

    useAgentStore.getState().setActiveAgent(null);
    expect(useAgentStore.getState().activeAgentId).toBeNull();
  });

  it("applyRunInit updates model and sessionId", () => {
    useAgentStore.getState().startRun("agent-1", "sonnet");

    useAgentStore.getState().applyRunInit("agent-1", {
      type: "run_init",
      sessionId: "sess-123",
      model: "claude-sonnet-4-5-20250929",
    });

    const run = useAgentStore.getState().runs["agent-1"];
    expect(run.model).toBe("claude-sonnet-4-5-20250929");
    expect(run.sessionId).toBe("sess-123");
  });

  it("multiple runs are independent", () => {
    useAgentStore.getState().startRun("agent-1", "sonnet");
    useAgentStore.getState().startRun("agent-2", "opus");

    useAgentStore.getState().addDisplayItem("agent-1", makeDisplayItem({ type: "output", outputText: "only for agent-1" }));
    flushDisplayItems();
    useAgentStore.getState().completeRun("agent-2", true);

    const state = useAgentStore.getState();
    expect(state.runs["agent-1"].displayItems).toHaveLength(1);
    expect(state.runs["agent-1"].status).toBe("running");
    expect(state.runs["agent-2"].displayItems).toHaveLength(0);
    expect(state.runs["agent-2"].status).toBe("completed");
  });
});

describe("shutdownRun", () => {
  beforeEach(() => {
    useAgentStore.getState().clearRuns();
    vi.restoreAllMocks();
  });

  it("sets status to 'shutdown' and endTime when run is 'running'", () => {
    useAgentStore.getState().startRun("agent-1", "sonnet");
    const beforeShutdown = Date.now();
    useAgentStore.getState().shutdownRun("agent-1");

    const run = useAgentStore.getState().runs["agent-1"];
    expect(run.status).toBe("shutdown");
    expect(run.endTime).toBeDefined();
    expect(run.endTime).toBeGreaterThanOrEqual(beforeShutdown);
  });

  it("no-ops when run doesn't exist", () => {
    useAgentStore.getState().shutdownRun("nonexistent");
    const state = useAgentStore.getState();
    expect(state.runs["nonexistent"]).toBeUndefined();
  });

  it("no-ops when run is already completed", () => {
    useAgentStore.getState().startRun("agent-1", "sonnet");
    useAgentStore.getState().completeRun("agent-1", true);
    const completedRun = useAgentStore.getState().runs["agent-1"];
    const originalEndTime = completedRun.endTime;

    useAgentStore.getState().shutdownRun("agent-1");

    const run = useAgentStore.getState().runs["agent-1"];
    expect(run.status).toBe("completed"); // unchanged
    expect(run.endTime).toBe(originalEndTime); // unchanged
  });

  it("no-ops when run is already in error state", () => {
    useAgentStore.getState().startRun("agent-1", "sonnet");
    useAgentStore.getState().completeRun("agent-1", false);

    useAgentStore.getState().shutdownRun("agent-1");

    const run = useAgentStore.getState().runs["agent-1"];
    expect(run.status).toBe("error"); // unchanged
  });
});

describe("context tracking via agent events", () => {
  beforeEach(() => {
    useAgentStore.getState().clearRuns();
  });

  it("startRun initializes context tracking fields", () => {
    useAgentStore.getState().startRun("agent-1", "sonnet");
    const run = useAgentStore.getState().runs["agent-1"];
    expect(run.contextHistory).toEqual([]);
    expect(run.contextWindow).toBe(200_000);
    expect(run.compactionEvents).toEqual([]);
  });

  it("adds context snapshot from turn usage event", () => {
    useAgentStore.getState().startRun("agent-1", "sonnet");

    useAgentStore.getState().applyTurnUsage("agent-1", {
      type: "turn_usage",
      turn: 1,
      inputTokens: 15000,
      outputTokens: 500,
    });

    const run = useAgentStore.getState().runs["agent-1"];
    expect(run.contextHistory).toHaveLength(1);
    expect(run.contextHistory[0]).toEqual({
      turn: 1,
      inputTokens: 15000,
      outputTokens: 500,
    });
  });

  it("tracks multiple turns of context usage", () => {
    useAgentStore.getState().startRun("agent-1", "sonnet");

    useAgentStore.getState().applyTurnUsage("agent-1", {
      type: "turn_usage",
      turn: 1,
      inputTokens: 10000,
      outputTokens: 200,
    });
    useAgentStore.getState().applyTurnUsage("agent-1", {
      type: "turn_usage",
      turn: 2,
      inputTokens: 25000,
      outputTokens: 800,
    });

    const run = useAgentStore.getState().runs["agent-1"];
    expect(run.contextHistory).toHaveLength(2);
    expect(run.contextHistory[0].turn).toBe(1);
    expect(run.contextHistory[0].inputTokens).toBe(10000);
    expect(run.contextHistory[1].turn).toBe(2);
    expect(run.contextHistory[1].inputTokens).toBe(25000);
  });

  it("records compaction events", () => {
    useAgentStore.getState().startRun("agent-1", "sonnet");

    useAgentStore.getState().applyCompaction("agent-1", {
      type: "compaction",
      turn: 5,
      preTokens: 190000,
      timestamp: 1700000000000,
    });

    const run = useAgentStore.getState().runs["agent-1"];
    expect(run.compactionEvents).toHaveLength(1);
    expect(run.compactionEvents[0]).toEqual({
      turn: 5,
      preTokens: 190000,
      timestamp: 1700000000000,
    });
  });

  it("updates thinkingEnabled from run config", () => {
    useAgentStore.getState().startRun("agent-1", "sonnet");

    useAgentStore.getState().applyRunConfig("agent-1", {
      type: "run_config",
      thinkingEnabled: true,
    });

    const run = useAgentStore.getState().runs["agent-1"];
    expect(run.thinkingEnabled).toBe(true);
  });

  it("updates agentName from run config", () => {
    useAgentStore.getState().startRun("agent-1", "sonnet");

    useAgentStore.getState().applyRunConfig("agent-1", {
      type: "run_config",
      thinkingEnabled: false,
      agentName: "research-orchestrator",
    });

    const run = useAgentStore.getState().runs["agent-1"];
    expect(run.agentName).toBe("research-orchestrator");
  });

  it("no-ops when run does not exist", () => {
    // Should not throw
    useAgentStore.getState().applyTurnUsage("nonexistent", {
      type: "turn_usage",
      turn: 1,
      inputTokens: 1000,
      outputTokens: 100,
    });
    expect(useAgentStore.getState().runs["nonexistent"]).toBeUndefined();
  });
});

describe("context helper functions", () => {
  beforeEach(() => {
    useAgentStore.getState().clearRuns();
  });

  it("formatTokenCount formats tokens as K/M", () => {
    expect(formatTokenCount(500)).toBe("500");
    expect(formatTokenCount(1000)).toBe("1K");
    expect(formatTokenCount(45000)).toBe("45K");
    expect(formatTokenCount(1500000)).toBe("1.5M");
    expect(formatTokenCount(200000)).toBe("200K");
  });

  it("getLatestContextTokens returns 0 when no history", () => {
    useAgentStore.getState().startRun("agent-1", "sonnet");
    const run = useAgentStore.getState().runs["agent-1"];
    expect(getLatestContextTokens(run)).toBe(0);
  });

  it("getLatestContextTokens returns latest input tokens", () => {
    useAgentStore.getState().startRun("agent-1", "sonnet");

    useAgentStore.getState().applyTurnUsage("agent-1", {
      type: "turn_usage",
      turn: 1,
      inputTokens: 10000,
      outputTokens: 200,
    });
    useAgentStore.getState().applyTurnUsage("agent-1", {
      type: "turn_usage",
      turn: 2,
      inputTokens: 50000,
      outputTokens: 800,
    });

    const run = useAgentStore.getState().runs["agent-1"];
    expect(getLatestContextTokens(run)).toBe(50000);
  });

  it("getContextUtilization computes percentage correctly", () => {
    useAgentStore.getState().startRun("agent-1", "sonnet");

    useAgentStore.getState().applyTurnUsage("agent-1", {
      type: "turn_usage",
      turn: 1,
      inputTokens: 100000,
      outputTokens: 500,
    });

    const run = useAgentStore.getState().runs["agent-1"];
    expect(getContextUtilization(run)).toBe(50); // 100K / 200K = 50%
  });

  it("getContextUtilization caps at 100%", () => {
    useAgentStore.getState().startRun("agent-1", "sonnet");

    useAgentStore.getState().applyTurnUsage("agent-1", {
      type: "turn_usage",
      turn: 1,
      inputTokens: 250000,
      outputTokens: 500,
    });

    const run = useAgentStore.getState().runs["agent-1"];
    expect(getContextUtilization(run)).toBe(100);
  });

  it("getContextUtilization returns 0 when no history", () => {
    useAgentStore.getState().startRun("agent-1", "sonnet");
    const run = useAgentStore.getState().runs["agent-1"];
    expect(getContextUtilization(run)).toBe(0);
  });
});

describe("formatModelName", () => {
  it("maps full model IDs to friendly names with version", () => {
    expect(formatModelName("claude-sonnet-4-5-20250929")).toBe("Sonnet 4.5");
    expect(formatModelName("claude-haiku-4-5-20251001")).toBe("Haiku 4.5");
    expect(formatModelName("claude-opus-4-6")).toBe("Opus 4.6");
    expect(formatModelName("claude-sonnet-4-6")).toBe("Sonnet 4.6");
    expect(formatModelName("claude-haiku-4-5")).toBe("Haiku 4.5");
  });

  it("maps shorthand names to friendly names without version", () => {
    expect(formatModelName("sonnet")).toBe("Sonnet");
    expect(formatModelName("haiku")).toBe("Haiku");
    expect(formatModelName("opus")).toBe("Opus");
  });

  it("capitalizes unknown model names", () => {
    expect(formatModelName("custom")).toBe("Custom");
  });
});

describe("displayItems management", () => {
  beforeEach(() => {
    useAgentStore.getState().clearRuns();
    vi.restoreAllMocks();
  });

  it("all display items end up in state after addDisplayItem calls", () => {
    useAgentStore.getState().startRun("agent-1", "sonnet");

    for (let i = 0; i < 5; i++) {
      useAgentStore.getState().addDisplayItem("agent-1", makeDisplayItem({
        id: `di-${i}`,
        type: "output",
        outputText: `msg-${i}`,
      }));
    }
    flushDisplayItems();

    expect(useAgentStore.getState().runs["agent-1"].displayItems).toHaveLength(5);
  });

  it("completeRun preserves displayItems added before status change", () => {
    useAgentStore.getState().startRun("agent-1", "sonnet");

    useAgentStore.getState().addDisplayItem("agent-1", makeDisplayItem({
      type: "output",
      outputText: "buffered",
    }));

    useAgentStore.getState().completeRun("agent-1", true);

    const run = useAgentStore.getState().runs["agent-1"];
    expect(run.displayItems).toHaveLength(1);
    expect(run.displayItems[0].outputText).toBe("buffered");
    expect(run.status).toBe("completed");
  });

  it("flushDisplayItems applies all buffered items in a single batch", () => {
    useAgentStore.getState().startRun("agent-1", "sonnet");

    useAgentStore.getState().addDisplayItem("agent-1", makeDisplayItem({
      id: "di-batch-1",
      type: "output",
      outputText: "first",
    }));
    useAgentStore.getState().addDisplayItem("agent-1", makeDisplayItem({
      id: "di-batch-2",
      type: "output",
      outputText: "second",
    }));

    // Explicit flush ensures all items are applied
    flushDisplayItems();

    const items = useAgentStore.getState().runs["agent-1"].displayItems;
    expect(items).toHaveLength(2);
    expect(items[0].outputText).toBe("first");
    expect(items[1].outputText).toBe("second");
  });

  it("update-by-id deduplicates within a single batch", () => {
    useAgentStore.getState().startRun("agent-1", "sonnet");

    useAgentStore.getState().addDisplayItem("agent-1", makeDisplayItem({
      id: "tool-batch",
      type: "tool_call",
      toolName: "Read",
      toolStatus: "pending",
    }));
    useAgentStore.getState().addDisplayItem("agent-1", makeDisplayItem({
      id: "tool-batch",
      type: "tool_call",
      toolName: "Read",
      toolStatus: "ok",
    }));
    flushDisplayItems();

    const run = useAgentStore.getState().runs["agent-1"];
    expect(run.displayItems).toHaveLength(1);
    expect(run.displayItems[0].toolStatus).toBe("ok");
  });

  it("update-by-id across flush boundaries replaces existing items", () => {
    useAgentStore.getState().startRun("agent-1", "sonnet");

    // First batch: add pending tool call
    useAgentStore.getState().addDisplayItem("agent-1", makeDisplayItem({
      id: "tool-cross",
      type: "tool_call",
      toolName: "Read",
      toolStatus: "pending",
    }));
    flushDisplayItems();
    expect(useAgentStore.getState().runs["agent-1"].displayItems).toHaveLength(1);

    // Second batch: update to ok
    useAgentStore.getState().addDisplayItem("agent-1", makeDisplayItem({
      id: "tool-cross",
      type: "tool_call",
      toolName: "Read",
      toolStatus: "ok",
    }));
    flushDisplayItems();

    const run = useAgentStore.getState().runs["agent-1"];
    expect(run.displayItems).toHaveLength(1);
    expect(run.displayItems[0].toolStatus).toBe("ok");
  });

  it("clearRuns discards all displayItems", () => {
    useAgentStore.getState().startRun("agent-1", "sonnet");

    useAgentStore.getState().addDisplayItem("agent-1", makeDisplayItem({
      type: "output",
      outputText: "will be discarded",
    }));

    useAgentStore.getState().clearRuns();

    expect(useAgentStore.getState().runs).toEqual({});
  });

});

// =============================================================================
// Pending metadata buffer (VU-507)
// =============================================================================

describe("agent event buffering", () => {
  beforeEach(() => {
    useAgentStore.getState().clearRuns();
  });

  it("applies run init immediately when run already exists", () => {
    useAgentStore.getState().startRun("agent-buf-1", "sonnet");
    useAgentStore.getState().applyRunInit("agent-buf-1", {
      type: "run_init",
      sessionId: "s1",
      model: "sonnet",
    });
    expect(useAgentStore.getState().runs["agent-buf-1"].sessionId).toBe("s1");
  });

  it("buffers run init arriving before startRun and drains after", () => {
    useAgentStore.getState().applyRunInit("agent-buf-2", {
      type: "run_init",
      sessionId: "early-session",
      model: "sonnet",
    });
    expect(useAgentStore.getState().runs["agent-buf-2"]).toBeUndefined();

    useAgentStore.getState().startRun("agent-buf-2", "sonnet");
    expect(useAgentStore.getState().runs["agent-buf-2"].sessionId).toBe("early-session");
  });

  it("buffers run config arriving before registerRun and drains after", () => {
    useAgentStore.getState().applyRunConfig("agent-buf-3", {
      type: "run_config",
      thinkingEnabled: true,
      agentName: "researcher",
    });
    expect(useAgentStore.getState().runs["agent-buf-3"]).toBeUndefined();

    useAgentStore.getState().registerRun("agent-buf-3", "sonnet", "my-skill", "refine");
    expect(useAgentStore.getState().runs["agent-buf-3"].thinkingEnabled).toBe(true);
    expect(useAgentStore.getState().runs["agent-buf-3"].agentName).toBe("researcher");
  });

  it("drains multiple buffered events in order", () => {
    useAgentStore.getState().applyTurnUsage("agent-buf-4", {
      type: "turn_usage",
      turn: 1,
      inputTokens: 100,
      outputTokens: 10,
    });
    useAgentStore.getState().applyTurnUsage("agent-buf-4", {
      type: "turn_usage",
      turn: 2,
      inputTokens: 200,
      outputTokens: 20,
    });
    useAgentStore.getState().startRun("agent-buf-4", "sonnet");
    const history = useAgentStore.getState().runs["agent-buf-4"].contextHistory;
    expect(history).toHaveLength(2);
    expect(history[0].turn).toBe(1);
    expect(history[1].turn).toBe(2);
  });

  it("clearRuns discards the pending agent event buffer", () => {
    useAgentStore.getState().applyRunInit("agent-buf-5", {
      type: "run_init",
      sessionId: "should-be-gone",
      model: "sonnet",
    });
    useAgentStore.getState().clearRuns();
    useAgentStore.getState().startRun("agent-buf-5", "sonnet");
    expect(useAgentStore.getState().runs["agent-buf-5"].sessionId).toBeUndefined();
  });

});

describe("applyContextWindow behavior", () => {
  beforeEach(() => {
    useAgentStore.getState().clearRuns();
  });

  it("sets contextWindow when a new value arrives", () => {
    useAgentStore.getState().startRun("agent-cw", "sonnet");

    useAgentStore.getState().applyContextWindow("agent-cw", {
      type: "context_window",
      contextWindow: 150_000,
    });

    const run = useAgentStore.getState().runs["agent-cw"];
    expect(run.contextWindow).toBe(150_000);
  });

  it("accepts a smaller contextWindow replacing a larger one (unconditional update)", () => {
    useAgentStore.getState().startRun("agent-cw2", "sonnet");

    // First event: large window
    useAgentStore.getState().applyContextWindow("agent-cw2", {
      type: "context_window",
      contextWindow: 300_000,
    });
    expect(useAgentStore.getState().runs["agent-cw2"].contextWindow).toBe(300_000);

    // Second event: smaller window — accepted unconditionally (model may shrink window)
    useAgentStore.getState().applyContextWindow("agent-cw2", {
      type: "context_window",
      contextWindow: 100_000,
    });
    expect(useAgentStore.getState().runs["agent-cw2"].contextWindow).toBe(100_000);
  });

  it("ignores zero or negative contextWindow values", () => {
    useAgentStore.getState().startRun("agent-cw3", "sonnet");
    const originalWindow = useAgentStore.getState().runs["agent-cw3"].contextWindow;

    useAgentStore.getState().applyContextWindow("agent-cw3", {
      type: "context_window",
      contextWindow: 0,
    });

    expect(useAgentStore.getState().runs["agent-cw3"].contextWindow).toBe(originalWindow);
  });
});

describe("module-level internal state", () => {
  beforeEach(() => {
    resetAgentStoreInternals();
    useAgentStore.getState().clearRuns();
  });

  it("getPendingTerminalCount returns 0 after reset", () => {
    expect(getPendingTerminalCount()).toBe(0);
  });

  it("getPendingMetadataCount returns 0 after reset", () => {
    expect(getPendingMetadataCount()).toBe(0);
  });

  it("completeRun queues a pending terminal event when run does not exist yet", () => {
    useAgentStore.getState().completeRun("no-such-agent", true);
    expect(getPendingTerminalCount()).toBe(1);
  });

  it("resetAgentStoreInternals clears a queued pending terminal event", () => {
    useAgentStore.getState().completeRun("no-such-agent", true);
    expect(getPendingTerminalCount()).toBe(1);
    resetAgentStoreInternals();
    expect(getPendingTerminalCount()).toBe(0);
  });

  it("clearRuns delegates to resetAgentStoreInternals, clearing pending terminal events", () => {
    useAgentStore.getState().completeRun("no-such-agent", false);
    expect(getPendingTerminalCount()).toBe(1);
    useAgentStore.getState().clearRuns();
    expect(getPendingTerminalCount()).toBe(0);
  });
});
