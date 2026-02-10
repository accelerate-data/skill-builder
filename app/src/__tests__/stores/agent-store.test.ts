import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  useAgentStore,
  type AgentMessage,
  formatModelName,
  formatTokenCount,
  getLatestContextTokens,
  getContextUtilization,
} from "@/stores/agent-store";

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

  it("addMessage auto-creates run for unknown agent", () => {
    const msg: AgentMessage = {
      type: "text",
      content: "Hello",
      raw: {},
      timestamp: Date.now(),
    };

    useAgentStore.getState().addMessage("nonexistent", msg);

    const run = useAgentStore.getState().runs["nonexistent"];
    expect(run).toBeDefined();
    expect(run.model).toBe("unknown");
    expect(run.messages).toHaveLength(1);
    expect(run.messages[0].content).toBe("Hello");
  });

  it("cancelRun sets status 'cancelled' and endTime", () => {
    useAgentStore.getState().startRun("agent-1", "sonnet");
    const beforeCancel = Date.now();
    useAgentStore.getState().cancelRun("agent-1");

    const run = useAgentStore.getState().runs["agent-1"];
    expect(run.status).toBe("cancelled");
    expect(run.endTime).toBeDefined();
    expect(run.endTime).toBeGreaterThanOrEqual(beforeCancel);
  });

  it("cancelRun for a non-existent run is a no-op", () => {
    useAgentStore.getState().cancelRun("nonexistent");
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

  it("addMessage with system init extracts model from raw", () => {
    useAgentStore.getState().startRun("agent-1", "sonnet");

    const initMsg: AgentMessage = {
      type: "system",
      content: undefined,
      raw: {
        type: "system",
        subtype: "init",
        session_id: "sess-123",
        model: "claude-sonnet-4-5-20250929",
      },
      timestamp: Date.now(),
    };

    useAgentStore.getState().addMessage("agent-1", initMsg);

    const run = useAgentStore.getState().runs["agent-1"];
    expect(run.model).toBe("claude-sonnet-4-5-20250929");
    expect(run.sessionId).toBe("sess-123");
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

describe("context tracking", () => {
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

  it("extracts context snapshot from assistant messages with usage", () => {
    useAgentStore.getState().startRun("agent-1", "sonnet");

    const msg: AgentMessage = {
      type: "assistant",
      content: "Analyzing...",
      raw: {
        message: {
          usage: { input_tokens: 15000, output_tokens: 500 },
          content: [{ type: "text", text: "Analyzing..." }],
        },
      },
      timestamp: Date.now(),
    };
    useAgentStore.getState().addMessage("agent-1", msg);

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

    const msg1: AgentMessage = {
      type: "assistant",
      content: "Turn 1",
      raw: { message: { usage: { input_tokens: 10000, output_tokens: 200 } } },
      timestamp: Date.now(),
    };
    const msg2: AgentMessage = {
      type: "assistant",
      content: "Turn 2",
      raw: { message: { usage: { input_tokens: 25000, output_tokens: 800 } } },
      timestamp: Date.now(),
    };

    useAgentStore.getState().addMessage("agent-1", msg1);
    useAgentStore.getState().addMessage("agent-1", msg2);

    const run = useAgentStore.getState().runs["agent-1"];
    expect(run.contextHistory).toHaveLength(2);
    expect(run.contextHistory[0].turn).toBe(1);
    expect(run.contextHistory[0].inputTokens).toBe(10000);
    expect(run.contextHistory[1].turn).toBe(2);
    expect(run.contextHistory[1].inputTokens).toBe(25000);
  });

  it("does not add context snapshot for assistant messages without usage", () => {
    useAgentStore.getState().startRun("agent-1", "sonnet");

    const msg: AgentMessage = {
      type: "assistant",
      content: "Hello",
      raw: { message: { content: [{ type: "text", text: "Hello" }] } },
      timestamp: Date.now(),
    };
    useAgentStore.getState().addMessage("agent-1", msg);

    const run = useAgentStore.getState().runs["agent-1"];
    expect(run.contextHistory).toHaveLength(0);
  });

  it("extracts contextWindow from result message modelUsage", () => {
    useAgentStore.getState().startRun("agent-1", "opus");

    const msg: AgentMessage = {
      type: "result",
      content: "Done",
      raw: {
        modelUsage: {
          "claude-opus-4-6": {
            inputTokens: 50000,
            outputTokens: 2000,
            contextWindow: 200000,
            maxOutputTokens: 32000,
            costUSD: 0.10,
          },
        },
      },
      timestamp: Date.now(),
    };
    useAgentStore.getState().addMessage("agent-1", msg);

    const run = useAgentStore.getState().runs["agent-1"];
    expect(run.contextWindow).toBe(200000);
  });

  it("keeps default contextWindow when result has no modelUsage", () => {
    useAgentStore.getState().startRun("agent-1", "sonnet");

    const msg: AgentMessage = {
      type: "result",
      content: "Done",
      raw: { cost_usd: 0.01 },
      timestamp: Date.now(),
    };
    useAgentStore.getState().addMessage("agent-1", msg);

    const run = useAgentStore.getState().runs["agent-1"];
    expect(run.contextWindow).toBe(200_000);
  });

  it("detects compact_boundary messages and records compaction events", () => {
    useAgentStore.getState().startRun("agent-1", "sonnet");

    // First, add an assistant message to establish turn count
    const assistantMsg: AgentMessage = {
      type: "assistant",
      content: "Working...",
      raw: { message: { usage: { input_tokens: 180000, output_tokens: 1000 } } },
      timestamp: Date.now(),
    };
    useAgentStore.getState().addMessage("agent-1", assistantMsg);

    const compactMsg: AgentMessage = {
      type: "system",
      content: undefined,
      raw: {
        type: "system",
        subtype: "compact_boundary",
        compact_metadata: { trigger: "auto", pre_tokens: 190000 },
      },
      timestamp: 1700000000000,
    };
    useAgentStore.getState().addMessage("agent-1", compactMsg);

    const run = useAgentStore.getState().runs["agent-1"];
    expect(run.compactionEvents).toHaveLength(1);
    expect(run.compactionEvents[0]).toEqual({
      turn: 1,
      preTokens: 190000,
      timestamp: 1700000000000,
    });
  });

  it("handles compact_boundary with missing metadata gracefully", () => {
    useAgentStore.getState().startRun("agent-1", "sonnet");

    const compactMsg: AgentMessage = {
      type: "system",
      content: undefined,
      raw: { type: "system", subtype: "compact_boundary" },
      timestamp: Date.now(),
    };
    useAgentStore.getState().addMessage("agent-1", compactMsg);

    const run = useAgentStore.getState().runs["agent-1"];
    expect(run.compactionEvents).toHaveLength(1);
    expect(run.compactionEvents[0].preTokens).toBe(0);
    expect(run.compactionEvents[0].turn).toBe(0);
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

    const msg1: AgentMessage = {
      type: "assistant",
      content: "Turn 1",
      raw: { message: { usage: { input_tokens: 10000, output_tokens: 200 } } },
      timestamp: Date.now(),
    };
    const msg2: AgentMessage = {
      type: "assistant",
      content: "Turn 2",
      raw: { message: { usage: { input_tokens: 50000, output_tokens: 800 } } },
      timestamp: Date.now(),
    };

    useAgentStore.getState().addMessage("agent-1", msg1);
    useAgentStore.getState().addMessage("agent-1", msg2);

    const run = useAgentStore.getState().runs["agent-1"];
    expect(getLatestContextTokens(run)).toBe(50000);
  });

  it("getContextUtilization computes percentage correctly", () => {
    useAgentStore.getState().startRun("agent-1", "sonnet");

    const msg: AgentMessage = {
      type: "assistant",
      content: "Working",
      raw: { message: { usage: { input_tokens: 100000, output_tokens: 500 } } },
      timestamp: Date.now(),
    };
    useAgentStore.getState().addMessage("agent-1", msg);

    const run = useAgentStore.getState().runs["agent-1"];
    expect(getContextUtilization(run)).toBe(50); // 100K / 200K = 50%
  });

  it("getContextUtilization caps at 100%", () => {
    useAgentStore.getState().startRun("agent-1", "sonnet");

    const msg: AgentMessage = {
      type: "assistant",
      content: "Working",
      raw: { message: { usage: { input_tokens: 250000, output_tokens: 500 } } },
      timestamp: Date.now(),
    };
    useAgentStore.getState().addMessage("agent-1", msg);

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
  it("maps full model IDs to friendly names", () => {
    expect(formatModelName("claude-sonnet-4-5-20250929")).toBe("Sonnet");
    expect(formatModelName("claude-haiku-4-5-20251001")).toBe("Haiku");
    expect(formatModelName("claude-opus-4-6")).toBe("Opus");
  });

  it("maps shorthand names to friendly names", () => {
    expect(formatModelName("sonnet")).toBe("Sonnet");
    expect(formatModelName("haiku")).toBe("Haiku");
    expect(formatModelName("opus")).toBe("Opus");
  });

  it("capitalizes unknown model names", () => {
    expect(formatModelName("custom")).toBe("Custom");
  });
});
