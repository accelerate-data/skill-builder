import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockInvoke } from "@/test/mocks/tauri";
import { useWorkflowStore } from "@/stores/workflow-store";
import {
  useAgentStore,
  flushMessageBuffer,
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
    flushMessageBuffer();

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
        total_cost_usd: 0.042,
      },
      timestamp: Date.now(),
    };

    useAgentStore.getState().addMessage("agent-1", resultMsg);
    flushMessageBuffer();

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
        // no total_cost_usd
      },
      timestamp: Date.now(),
    };

    useAgentStore.getState().addMessage("agent-1", resultMsg);
    flushMessageBuffer();

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
        total_cost_usd: 0.01,
      },
      timestamp: Date.now(),
    };

    useAgentStore.getState().addMessage("agent-1", resultMsg);
    flushMessageBuffer();

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
    flushMessageBuffer();

    const run = useAgentStore.getState().runs["nonexistent"];
    expect(run).toBeDefined();
    expect(run.model).toBe("unknown");
    expect(run.messages).toHaveLength(1);
    expect(run.messages[0].content).toBe("Hello");
  });

  it("completeRun for a non-existent run is a no-op", () => {
    useAgentStore.getState().completeRun("nonexistent", true);
    const state = useAgentStore.getState();
    expect(state.runs["nonexistent"]).toBeUndefined();
  });

  it("replays queued completion when terminal event arrives before registration", () => {
    mockInvoke.mockReset().mockResolvedValue(undefined);

    // Simulate agent-exit arriving before registerRun/startRun.
    useAgentStore.getState().completeRun("late-agent", true);
    expect(useAgentStore.getState().runs["late-agent"]).toBeUndefined();

    // Registering the run should replay completion and persist.
    useAgentStore.getState().registerRun("late-agent", "sonnet", "my-skill", "refine");
    const run = useAgentStore.getState().runs["late-agent"];
    expect(run.status).toBe("completed");

    const persistCalls = (mockInvoke.mock.calls as [string, Record<string, unknown>][]).filter(
      ([cmd]) => cmd === "persist_agent_run",
    );
    expect(persistCalls).toHaveLength(1);
    const args = persistCalls[0][1] as Record<string, unknown>;
    expect(args.agentId).toBe("late-agent");
    expect(args.status).toBe("completed");
    expect(args.stepId).toBe(-10);
  });

  it("replays queued shutdown when shutdown event arrives before registration", () => {
    mockInvoke.mockReset().mockResolvedValue(undefined);

    useAgentStore.getState().shutdownRun("late-shutdown");
    expect(useAgentStore.getState().runs["late-shutdown"]).toBeUndefined();

    useAgentStore.getState().registerRun("late-shutdown", "sonnet", "my-skill", "test");
    const run = useAgentStore.getState().runs["late-shutdown"];
    expect(run.status).toBe("shutdown");

    const persistCalls = (mockInvoke.mock.calls as [string, Record<string, unknown>][]).filter(
      ([cmd]) => cmd === "persist_agent_run",
    );
    expect(persistCalls).toHaveLength(1);
    const args = persistCalls[0][1] as Record<string, unknown>;
    expect(args.agentId).toBe("late-shutdown");
    expect(args.status).toBe("shutdown");
    expect(args.stepId).toBe(-11);
  });

  it("uses provided refine usageSessionId for usage grouping", () => {
    mockInvoke.mockReset().mockResolvedValue(undefined);

    useAgentStore.getState().registerRun(
      "refine-session-agent",
      "sonnet",
      "my-skill",
      "refine",
      "synthetic:refine:my-skill:session-123",
    );
    useAgentStore.getState().completeRun("refine-session-agent", true);

    const persistCalls = (mockInvoke.mock.calls as [string, Record<string, unknown>][]).filter(
      ([cmd]) => cmd === "persist_agent_run",
    );
    expect(persistCalls).toHaveLength(1);
    const args = persistCalls[0][1] as Record<string, unknown>;
    expect(args.stepId).toBe(-10);
    expect(args.workflowSessionId).toBe("synthetic:refine:my-skill:session-123");
  });

  it("uses provided test usageSessionId for usage grouping", () => {
    mockInvoke.mockReset().mockResolvedValue(undefined);

    useAgentStore.getState().registerRun(
      "test-session-agent",
      "sonnet",
      "my-skill",
      "test",
      "synthetic:test:my-skill:test-456",
    );
    useAgentStore.getState().completeRun("test-session-agent", true);

    const persistCalls = (mockInvoke.mock.calls as [string, Record<string, unknown>][]).filter(
      ([cmd]) => cmd === "persist_agent_run",
    );
    expect(persistCalls).toHaveLength(1);
    const args = persistCalls[0][1] as Record<string, unknown>;
    expect(args.stepId).toBe(-11);
    expect(args.workflowSessionId).toBe("synthetic:test:my-skill:test-456");
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

    // clearRuns discards the buffer and resets state
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
    flushMessageBuffer();

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
    // completeRun flushes the buffer internally before changing status
    useAgentStore.getState().completeRun("agent-2", true);

    const state = useAgentStore.getState();
    expect(state.runs["agent-1"].messages).toHaveLength(1);
    expect(state.runs["agent-1"].status).toBe("running");
    expect(state.runs["agent-2"].messages).toHaveLength(0);
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
    flushMessageBuffer();

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
    flushMessageBuffer();

    const run = useAgentStore.getState().runs["agent-1"];
    expect(run.contextHistory).toHaveLength(2);
    expect(run.contextHistory[0].turn).toBe(1);
    expect(run.contextHistory[0].inputTokens).toBe(10000);
    expect(run.contextHistory[1].turn).toBe(2);
    expect(run.contextHistory[1].inputTokens).toBe(25000);
  });

  it("includes cache tokens in context snapshot inputTokens", () => {
    useAgentStore.getState().startRun("agent-1", "sonnet");

    const msg: AgentMessage = {
      type: "assistant",
      content: "Cached turn",
      raw: {
        message: {
          usage: {
            input_tokens: 7,
            output_tokens: 300,
            cache_read_input_tokens: 48000,
            cache_creation_input_tokens: 2000,
          },
        },
      },
      timestamp: Date.now(),
    };
    useAgentStore.getState().addMessage("agent-1", msg);
    flushMessageBuffer();

    const run = useAgentStore.getState().runs["agent-1"];
    expect(run.contextHistory).toHaveLength(1);
    // Total input = 7 + 48000 + 2000 = 50007
    expect(run.contextHistory[0].inputTokens).toBe(50007);
    expect(run.contextHistory[0].outputTokens).toBe(300);
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
    flushMessageBuffer();

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
    flushMessageBuffer();

    const run = useAgentStore.getState().runs["agent-1"];
    expect(run.contextWindow).toBe(200000);
  });

  it("keeps default contextWindow when result has no modelUsage", () => {
    useAgentStore.getState().startRun("agent-1", "sonnet");

    const msg: AgentMessage = {
      type: "result",
      content: "Done",
      raw: { total_cost_usd: 0.01 },
      timestamp: Date.now(),
    };
    useAgentStore.getState().addMessage("agent-1", msg);
    flushMessageBuffer();

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
    flushMessageBuffer();

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
    flushMessageBuffer();

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
    flushMessageBuffer();

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
    flushMessageBuffer();

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
    flushMessageBuffer();

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

describe("RAF batching", () => {
  beforeEach(() => {
    useAgentStore.getState().clearRuns();
    vi.restoreAllMocks();
  });

  it("all buffered messages end up in state after addMessage calls", () => {
    // Note: In tests, RAF fires synchronously so messages apply immediately.
    // In production, they batch up and flush once per animation frame.
    useAgentStore.getState().startRun("agent-1", "sonnet");

    for (let i = 0; i < 5; i++) {
      useAgentStore.getState().addMessage("agent-1", {
        type: "text",
        content: `msg-${i}`,
        raw: {},
        timestamp: Date.now(),
      });
    }

    // All 5 messages should be present
    expect(useAgentStore.getState().runs["agent-1"].messages).toHaveLength(5);
  });

  it("completeRun preserves messages added before status change", () => {
    useAgentStore.getState().startRun("agent-1", "sonnet");

    useAgentStore.getState().addMessage("agent-1", {
      type: "text",
      content: "buffered",
      raw: {},
      timestamp: Date.now(),
    });

    // completeRun should flush first, then set status
    useAgentStore.getState().completeRun("agent-1", true);

    const run = useAgentStore.getState().runs["agent-1"];
    expect(run.messages).toHaveLength(1);
    expect(run.messages[0].content).toBe("buffered");
    expect(run.status).toBe("completed");
  });

  it("clearRuns discards buffered messages", () => {
    useAgentStore.getState().startRun("agent-1", "sonnet");

    // In tests, RAF fires synchronously so this message is applied immediately.
    // clearRuns should still reset everything.
    useAgentStore.getState().addMessage("agent-1", {
      type: "text",
      content: "will be discarded",
      raw: {},
      timestamp: Date.now(),
    });

    useAgentStore.getState().clearRuns();

    // After clear, runs should be empty
    expect(useAgentStore.getState().runs).toEqual({});
  });

  it("flushMessageBuffer is safe to call when buffer is empty", () => {
    useAgentStore.getState().startRun("agent-1", "sonnet");
    // No messages added — flush should be a no-op
    flushMessageBuffer();
    expect(useAgentStore.getState().runs["agent-1"].messages).toHaveLength(0);
  });
});

describe("result message metadata", () => {
  beforeEach(() => {
    useAgentStore.getState().clearRuns();
  });

  it("extracts resultSubtype from successful result message", () => {
    useAgentStore.getState().startRun("agent-1", "sonnet");
    useAgentStore.getState().addMessage("agent-1", {
      type: "result",
      content: "Done",
      raw: { subtype: "success", stop_reason: "end_turn" },
      timestamp: Date.now(),
    });
    flushMessageBuffer();

    const run = useAgentStore.getState().runs["agent-1"];
    expect(run.resultSubtype).toBe("success");
    expect(run.stopReason).toBe("end_turn");
    expect(run.resultErrors).toBeUndefined();
  });

  it("extracts error_max_turns subtype and errors array", () => {
    useAgentStore.getState().startRun("agent-1", "sonnet");
    useAgentStore.getState().addMessage("agent-1", {
      type: "result",
      content: undefined,
      raw: {
        subtype: "error_max_turns",
        is_error: true,
        errors: ["Max turns reached"],
        stop_reason: "end_turn",
      },
      timestamp: Date.now(),
    });
    flushMessageBuffer();

    const run = useAgentStore.getState().runs["agent-1"];
    expect(run.resultSubtype).toBe("error_max_turns");
    expect(run.resultErrors).toEqual(["Max turns reached"]);
    expect(run.stopReason).toBe("end_turn");
  });

  it("extracts error_max_budget_usd subtype", () => {
    useAgentStore.getState().startRun("agent-1", "sonnet");
    useAgentStore.getState().addMessage("agent-1", {
      type: "result",
      content: undefined,
      raw: {
        subtype: "error_max_budget_usd",
        is_error: true,
        errors: ["Budget exceeded"],
      },
      timestamp: Date.now(),
    });
    flushMessageBuffer();

    const run = useAgentStore.getState().runs["agent-1"];
    expect(run.resultSubtype).toBe("error_max_budget_usd");
    expect(run.resultErrors).toEqual(["Budget exceeded"]);
  });

  it("extracts refusal stop_reason", () => {
    useAgentStore.getState().startRun("agent-1", "sonnet");
    useAgentStore.getState().addMessage("agent-1", {
      type: "result",
      content: "Refused",
      raw: { subtype: "success", stop_reason: "refusal" },
      timestamp: Date.now(),
    });
    flushMessageBuffer();

    const run = useAgentStore.getState().runs["agent-1"];
    expect(run.stopReason).toBe("refusal");
  });

  it("leaves metadata undefined when result has no subtype or stop_reason", () => {
    useAgentStore.getState().startRun("agent-1", "sonnet");
    useAgentStore.getState().addMessage("agent-1", {
      type: "result",
      content: "Done",
      raw: { usage: { input_tokens: 10, output_tokens: 5 } },
      timestamp: Date.now(),
    });
    flushMessageBuffer();

    const run = useAgentStore.getState().runs["agent-1"];
    expect(run.resultSubtype).toBeUndefined();
    expect(run.stopReason).toBeUndefined();
    expect(run.resultErrors).toBeUndefined();
  });
});

describe("modelUsageBreakdown", () => {
  beforeEach(() => {
    useAgentStore.getState().clearRuns();
    vi.restoreAllMocks();
  });

  it("extracts per-model breakdown from result message with multi-model modelUsage", () => {
    useAgentStore.getState().startRun("agent-1", "sonnet");

    const resultMsg: AgentMessage = {
      type: "result",
      content: "Done",
      raw: {
        usage: { input_tokens: 3000, output_tokens: 1000 },
        total_cost_usd: 0.15,
        modelUsage: {
          "claude-sonnet-4-5-20250929": {
            inputTokens: 2000,
            outputTokens: 800,
            cacheReadInputTokens: 500,
            cacheCreationInputTokens: 100,
            cost: 0.05,
            contextWindow: 200000,
          },
          "claude-haiku-4-5-20251001": {
            inputTokens: 1000,
            outputTokens: 200,
            cacheReadInputTokens: 0,
            cacheCreationInputTokens: 0,
            cost: 0.10,
            contextWindow: 200000,
          },
        },
      },
      timestamp: Date.now(),
    };

    useAgentStore.getState().addMessage("agent-1", resultMsg);
    flushMessageBuffer();

    const run = useAgentStore.getState().runs["agent-1"];
    expect(run.modelUsageBreakdown).toBeDefined();
    expect(run.modelUsageBreakdown).toHaveLength(2);

    const sonnet = run.modelUsageBreakdown!.find(
      (m) => m.model === "claude-sonnet-4-5-20250929"
    );
    expect(sonnet).toEqual({
      model: "claude-sonnet-4-5-20250929",
      inputTokens: 2000,
      outputTokens: 800,
      cacheReadTokens: 500,
      cacheWriteTokens: 100,
      cost: 0.05,
    });

    const haiku = run.modelUsageBreakdown!.find(
      (m) => m.model === "claude-haiku-4-5-20251001"
    );
    expect(haiku).toEqual({
      model: "claude-haiku-4-5-20251001",
      inputTokens: 1000,
      outputTokens: 200,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      cost: 0.10,
    });
  });

  it("leaves modelUsageBreakdown undefined when result has no modelUsage", () => {
    useAgentStore.getState().startRun("agent-1", "sonnet");

    useAgentStore.getState().addMessage("agent-1", {
      type: "result",
      content: "Done",
      raw: {
        usage: { input_tokens: 100, output_tokens: 50 },
        total_cost_usd: 0.01,
      },
      timestamp: Date.now(),
    });
    flushMessageBuffer();

    const run = useAgentStore.getState().runs["agent-1"];
    expect(run.modelUsageBreakdown).toBeUndefined();
  });

  it("defaults missing fields to 0 in modelUsage entries", () => {
    useAgentStore.getState().startRun("agent-1", "opus");

    useAgentStore.getState().addMessage("agent-1", {
      type: "result",
      content: "Done",
      raw: {
        usage: { input_tokens: 500, output_tokens: 100 },
        total_cost_usd: 0.02,
        modelUsage: {
          "claude-opus-4-6": {
            // Only inputTokens provided — rest should default to 0
            inputTokens: 500,
            contextWindow: 200000,
          },
        },
      },
      timestamp: Date.now(),
    });
    flushMessageBuffer();

    const run = useAgentStore.getState().runs["agent-1"];
    expect(run.modelUsageBreakdown).toHaveLength(1);
    expect(run.modelUsageBreakdown![0]).toEqual({
      model: "claude-opus-4-6",
      inputTokens: 500,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      cost: 0,
    });
  });
});

describe("completeRun persistence with modelUsageBreakdown", () => {
  beforeEach(() => {
    useAgentStore.getState().clearRuns();
    mockInvoke.mockReset().mockResolvedValue(undefined);
  });

  it("calls persistAgentRun once per model when breakdown has 2+ models", () => {
    useAgentStore.getState().startRun("agent-1", "sonnet");
    mockInvoke.mockClear();

    // Add a result message with multi-model usage
    useAgentStore.getState().addMessage("agent-1", {
      type: "result",
      content: "Done",
      raw: {
        usage: { input_tokens: 3000, output_tokens: 1000 },
        total_cost_usd: 0.15,
        modelUsage: {
          "claude-sonnet-4-5-20250929": {
            inputTokens: 2000,
            outputTokens: 800,
            cacheReadInputTokens: 500,
            cacheCreationInputTokens: 100,
            cost: 0.05,
            contextWindow: 200000,
          },
          "claude-haiku-4-5-20251001": {
            inputTokens: 1000,
            outputTokens: 200,
            cacheReadInputTokens: 0,
            cacheCreationInputTokens: 0,
            cost: 0.10,
            contextWindow: 200000,
          },
        },
      },
      timestamp: Date.now(),
    });
    flushMessageBuffer();

    useAgentStore.getState().completeRun("agent-1", true);

    // Should have been called twice — once per model
    const allCalls = mockInvoke.mock.calls as [string, Record<string, unknown>][];
    const persistCalls = allCalls.filter(
      ([cmd]) => cmd === "persist_agent_run"
    );
    expect(persistCalls).toHaveLength(2);

    // Verify model-specific data is passed correctly
    const models = persistCalls.map(([, args]) => args.model);
    expect(models).toContain("claude-sonnet-4-5-20250929");
    expect(models).toContain("claude-haiku-4-5-20251001");

    // Check sonnet row details
    const sonnetCall = persistCalls.find(
      ([, args]) => args.model === "claude-sonnet-4-5-20250929"
    );
    expect(sonnetCall).toBeDefined();
    const sonnetArgs = sonnetCall![1] as Record<string, unknown>;
    expect(sonnetArgs.inputTokens).toBe(2000);
    expect(sonnetArgs.outputTokens).toBe(800);
    expect(sonnetArgs.cacheReadTokens).toBe(500);
    expect(sonnetArgs.cacheWriteTokens).toBe(100);
    expect(sonnetArgs.totalCost).toBe(0.05);
    expect(sonnetArgs.status).toBe("completed");

    // Check haiku row details
    const haikuCall = persistCalls.find(
      ([, args]) => args.model === "claude-haiku-4-5-20251001"
    );
    expect(haikuCall).toBeDefined();
    const haikuArgs = haikuCall![1] as Record<string, unknown>;
    expect(haikuArgs.inputTokens).toBe(1000);
    expect(haikuArgs.outputTokens).toBe(200);
    expect(haikuArgs.totalCost).toBe(0.10);
  });

  it("falls back to single-model persist when no modelUsageBreakdown", () => {
    useAgentStore.getState().startRun("agent-1", "sonnet");
    mockInvoke.mockClear();

    // Add result WITHOUT modelUsage
    useAgentStore.getState().addMessage("agent-1", {
      type: "result",
      content: "Done",
      raw: {
        usage: { input_tokens: 1500, output_tokens: 500 },
        total_cost_usd: 0.042,
      },
      timestamp: Date.now(),
    });
    flushMessageBuffer();

    useAgentStore.getState().completeRun("agent-1", true);

    const fallbackCalls = (mockInvoke.mock.calls as [string, Record<string, unknown>][]).filter(
      ([cmd]) => cmd === "persist_agent_run"
    );
    expect(fallbackCalls).toHaveLength(1);

    const args = fallbackCalls[0][1] as Record<string, unknown>;
    expect(args.model).toBe("sonnet");
    expect(args.inputTokens).toBe(1500);
    expect(args.outputTokens).toBe(500);
    expect(args.totalCost).toBe(0.042);
  });

  it("passes shared params (agentId, status, etc.) to each per-model row", () => {
    useAgentStore.getState().startRun("agent-1", "sonnet");
    mockInvoke.mockClear();

    useAgentStore.getState().addMessage("agent-1", {
      type: "result",
      content: "Done",
      raw: {
        usage: { input_tokens: 2000, output_tokens: 500 },
        total_cost_usd: 0.10,
        num_turns: 5,
        stop_reason: "end_turn",
        modelUsage: {
          "claude-sonnet-4-5-20250929": {
            inputTokens: 1500,
            outputTokens: 400,
            cost: 0.07,
          },
          "claude-haiku-4-5-20251001": {
            inputTokens: 500,
            outputTokens: 100,
            cost: 0.03,
          },
        },
      },
      timestamp: Date.now(),
    });
    flushMessageBuffer();

    useAgentStore.getState().completeRun("agent-1", false);

    const sharedCalls = (mockInvoke.mock.calls as [string, Record<string, unknown>][]).filter(
      ([cmd]) => cmd === "persist_agent_run"
    );
    expect(sharedCalls).toHaveLength(2);

    // Both rows should share agentId, status=error, numTurns, stopReason
    for (const [, args] of sharedCalls) {
      const a = args as Record<string, unknown>;
      expect(a.agentId).toBe("agent-1");
      expect(a.status).toBe("error");
      expect(a.numTurns).toBe(5);
      expect(a.stopReason).toBe("end_turn");
    }
  });

  it("uses workflow context captured at startRun, not at completeRun (attribution stability)", () => {
    // Arrange: workflow is at session-A / step 3 when the run starts
    vi.spyOn(useWorkflowStore, "getState").mockReturnValue({
      ...useWorkflowStore.getState(),
      workflowSessionId: "session-A",
      currentStep: 3,
    });

    useAgentStore.getState().startRun("attr-agent", "sonnet");
    mockInvoke.mockClear();

    // Simulate navigation / session reset before the run completes
    vi.spyOn(useWorkflowStore, "getState").mockReturnValue({
      ...useWorkflowStore.getState(),
      workflowSessionId: null,
      currentStep: 0,
    });

    useAgentStore.getState().completeRun("attr-agent", true);

    const persistCalls = (mockInvoke.mock.calls as [string, Record<string, unknown>][]).filter(
      ([cmd]) => cmd === "persist_agent_run",
    );
    expect(persistCalls).toHaveLength(1);
    const args = persistCalls[0][1] as Record<string, unknown>;
    // Must reflect start-time context, not the changed ambient state
    expect(args.workflowSessionId).toBe("session-A");
    expect(args.stepId).toBe(3);
  });

  it("persists when tokenUsage is missing but modelUsageBreakdown exists", () => {
    useAgentStore.getState().startRun("agent-1", "sonnet");
    mockInvoke.mockClear();

    useAgentStore.getState().addMessage("agent-1", {
      type: "result",
      content: "Done",
      raw: {
        // intentionally no `usage` field
        total_cost_usd: 0.06,
        modelUsage: {
          "claude-sonnet-4-5-20250929": {
            inputTokens: 1200,
            outputTokens: 300,
            cost: 0.06,
            contextWindow: 200000,
          },
        },
      },
      timestamp: Date.now(),
    });
    flushMessageBuffer();

    const run = useAgentStore.getState().runs["agent-1"];
    expect(run.tokenUsage).toBeUndefined();
    expect(run.modelUsageBreakdown).toHaveLength(1);

    useAgentStore.getState().completeRun("agent-1", true);

    const persistCalls = (mockInvoke.mock.calls as [string, Record<string, unknown>][]).filter(
      ([cmd]) => cmd === "persist_agent_run"
    );
    expect(persistCalls).toHaveLength(1);
    const args = persistCalls[0][1] as Record<string, unknown>;
    expect(args.model).toBe("claude-sonnet-4-5-20250929");
    expect(args.totalCost).toBe(0.06);
    expect(args.status).toBe("completed");
  });
});
