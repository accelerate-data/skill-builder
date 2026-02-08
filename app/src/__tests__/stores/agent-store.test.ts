import { describe, it, expect, beforeEach, vi } from "vitest";
import { useAgentStore, type AgentMessage } from "@/stores/agent-store";

describe("useAgentStore", () => {
  beforeEach(() => {
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
    expect(state.runs["agent-1"].messages).toEqual([]);
    expect(state.runs["agent-1"].startTime).toBeGreaterThanOrEqual(beforeTime);
    expect(state.runs["agent-1"].endTime).toBeUndefined();
    expect(state.runs["agent-1"].totalCost).toBeUndefined();
    expect(state.runs["agent-1"].tokenUsage).toBeUndefined();
    // Sets activeAgentId
    expect(state.activeAgentId).toBe("agent-1");
  });

  it("addMessage appends to the run's messages array", () => {
    useAgentStore.getState().startRun("agent-1", "sonnet");

    const msg1: AgentMessage = {
      type: "text",
      content: "Hello",
      raw: {},
      timestamp: Date.now(),
    };
    const msg2: AgentMessage = {
      type: "text",
      content: "World",
      raw: {},
      timestamp: Date.now(),
    };

    useAgentStore.getState().addMessage("agent-1", msg1);
    useAgentStore.getState().addMessage("agent-1", msg2);

    const state = useAgentStore.getState();
    expect(state.runs["agent-1"].messages).toHaveLength(2);
    expect(state.runs["agent-1"].messages[0]).toEqual(msg1);
    expect(state.runs["agent-1"].messages[1]).toEqual(msg2);
  });

  it("addMessage with type 'result' extracts tokenUsage and totalCost from raw", () => {
    useAgentStore.getState().startRun("agent-1", "opus");

    const resultMsg: AgentMessage = {
      type: "result",
      content: "Done",
      raw: {
        usage: { input_tokens: 1500, output_tokens: 500 },
        cost_usd: 0.042,
      },
      timestamp: Date.now(),
    };

    useAgentStore.getState().addMessage("agent-1", resultMsg);

    const run = useAgentStore.getState().runs["agent-1"];
    expect(run.tokenUsage).toEqual({ input: 1500, output: 500 });
    expect(run.totalCost).toBe(0.042);
    expect(run.messages).toHaveLength(1);
  });

  it("addMessage with type 'result' handles partial usage (missing fields default to 0)", () => {
    useAgentStore.getState().startRun("agent-1", "haiku");

    const resultMsg: AgentMessage = {
      type: "result",
      content: "Done",
      raw: {
        usage: { input_tokens: 100 },
        // no cost_usd
      },
      timestamp: Date.now(),
    };

    useAgentStore.getState().addMessage("agent-1", resultMsg);

    const run = useAgentStore.getState().runs["agent-1"];
    expect(run.tokenUsage).toEqual({ input: 100, output: 0 });
    expect(run.totalCost).toBeUndefined();
  });

  it("addMessage with type 'result' but no usage keeps existing tokenUsage", () => {
    useAgentStore.getState().startRun("agent-1", "sonnet");

    const resultMsg: AgentMessage = {
      type: "result",
      content: "Done",
      raw: {
        cost_usd: 0.01,
      },
      timestamp: Date.now(),
    };

    useAgentStore.getState().addMessage("agent-1", resultMsg);

    const run = useAgentStore.getState().runs["agent-1"];
    // No usage in raw, so tokenUsage stays undefined
    expect(run.tokenUsage).toBeUndefined();
    expect(run.totalCost).toBe(0.01);
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

  it("addMessage for a non-existent run is a no-op", () => {
    const msg: AgentMessage = {
      type: "text",
      content: "Hello",
      raw: {},
      timestamp: Date.now(),
    };

    // Should not throw
    useAgentStore.getState().addMessage("nonexistent", msg);

    const state = useAgentStore.getState();
    expect(state.runs["nonexistent"]).toBeUndefined();
  });

  it("completeRun for a non-existent run is a no-op", () => {
    useAgentStore.getState().completeRun("nonexistent", true);
    const state = useAgentStore.getState();
    expect(state.runs["nonexistent"]).toBeUndefined();
  });

  it("clearRuns empties everything", () => {
    useAgentStore.getState().startRun("agent-1", "sonnet");
    useAgentStore.getState().startRun("agent-2", "opus");

    const msg: AgentMessage = {
      type: "text",
      content: "test",
      raw: {},
      timestamp: Date.now(),
    };
    useAgentStore.getState().addMessage("agent-1", msg);

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

  it("multiple runs are independent", () => {
    useAgentStore.getState().startRun("agent-1", "sonnet");
    useAgentStore.getState().startRun("agent-2", "opus");

    const msg: AgentMessage = {
      type: "text",
      content: "only for agent-1",
      raw: {},
      timestamp: Date.now(),
    };
    useAgentStore.getState().addMessage("agent-1", msg);
    useAgentStore.getState().completeRun("agent-2", true);

    const state = useAgentStore.getState();
    expect(state.runs["agent-1"].messages).toHaveLength(1);
    expect(state.runs["agent-1"].status).toBe("running");
    expect(state.runs["agent-2"].messages).toHaveLength(0);
    expect(state.runs["agent-2"].status).toBe("completed");
  });
});
