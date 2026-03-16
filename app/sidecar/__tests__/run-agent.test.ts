import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the SDK before importing anything that uses it
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn(),
}));

// Mock fs/promises for TS-08 discoverInstalledPlugins error test
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    readdir: vi.fn(actual.readdir),
  };
});

import { query } from "@anthropic-ai/claude-agent-sdk";
import * as fsPromises from "node:fs/promises";
import { runAgentRequest, emitSystemEvent, selectPluginPaths, discoverInstalledPlugins } from "../run-agent.js";
import type { SidecarConfig } from "../config.js";

const mockQuery = vi.mocked(query);

function findRunResult(messages: Record<string, unknown>[]) {
  return messages.find(
    (message) =>
      message.type === "agent_event"
      && (message.event as Record<string, unknown> | undefined)?.type === "run_result",
  );
}

function baseConfig(overrides: Partial<SidecarConfig> = {}): SidecarConfig {
  return {
    prompt: "test prompt",
    apiKey: "sk-test",
    cwd: "/tmp/test",
    ...overrides,
  };
}

describe("runAgentRequest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls query with the correct prompt", async () => {
    async function* fakeConversation() {
      yield { type: "result", content: "done" };
    }
    mockQuery.mockReturnValue(fakeConversation() as ReturnType<typeof query>);

    const messages: Record<string, unknown>[] = [];
    await runAgentRequest(baseConfig({ prompt: "hello agent" }), (msg) =>
      messages.push(msg),
    );

    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "hello agent",
      }),
    );
  });

  it("streams all messages to the onMessage callback", async () => {
    // Use proper SDK message shapes that MessageProcessor can process
    const sdkMessages = [
      {
        type: "assistant",
        message: {
          content: [{ type: "text", text: "step 1" }],
          usage: { input_tokens: 10, output_tokens: 5 },
        },
      },
      { type: "result", subtype: "success", usage: { input_tokens: 50, output_tokens: 20 }, total_cost_usd: 0.01 },
    ];

    async function* fakeConversation() {
      for (const msg of sdkMessages) {
        yield msg;
      }
    }
    mockQuery.mockReturnValue(fakeConversation() as ReturnType<typeof query>);

    const messages: Record<string, unknown>[] = [];
    await runAgentRequest(baseConfig(), (msg) => messages.push(msg));

    // Messages: system events (sdk_plugins_debug filtered, init_start, sdk_ready),
    // then processed display items + agent_event messages
    // init_start and sdk_ready are forwarded as-is (system category)
    // sdk_plugins_debug is filtered (hardNoise)
    // assistant → display_item(output) + agent_event(turn_usage)
    // result → display_item(result) + agent_event(context_window/run_result)
    const displayItems = messages.filter((m) => m.type === "display_item");
    const systemMsgs = messages.filter((m) => m.type === "system");
    const runResult = findRunResult(messages);

    expect(systemMsgs.length).toBeGreaterThanOrEqual(2); // init_start + sdk_ready
    expect(displayItems).toHaveLength(2); // output + result
    expect(runResult).toBeDefined();

    // Verify display items
    const outputItem = (displayItems[0] as Record<string, unknown>).item as Record<string, unknown>;
    expect(outputItem.type).toBe("output");
    expect(outputItem.outputText).toBe("step 1");

    const resultItem = (displayItems[1] as Record<string, unknown>).item as Record<string, unknown>;
    expect(resultItem.type).toBe("result");
    expect(resultItem.resultStatus).toBe("success");
  });

  it("emits init_start and sdk_ready system events in order", async () => {
    async function* fakeConversation() {
      yield { type: "result", content: "done" };
    }
    mockQuery.mockReturnValue(fakeConversation() as ReturnType<typeof query>);

    const messages: Record<string, unknown>[] = [];
    await runAgentRequest(baseConfig(), (msg) => messages.push(msg));

    // System events come first: sdk_plugins_debug, init_start, sdk_ready
    expect(messages[0]).toMatchObject({ type: "system", subtype: "sdk_plugins_debug" });

    expect(messages[1]).toMatchObject({ type: "system", subtype: "init_start" });
    expect(messages[1]).toHaveProperty("timestamp");
    expect(typeof messages[1].timestamp).toBe("number");

    expect(messages[2]).toMatchObject({ type: "system", subtype: "sdk_ready" });
    expect(messages[2]).toHaveProperty("timestamp");
    expect(typeof messages[2].timestamp).toBe("number");

    // init_start timestamp should be <= sdk_ready timestamp
    expect(messages[1].timestamp as number).toBeLessThanOrEqual(
      messages[2].timestamp as number,
    );
  });

  it("emits error run_result when query() throws synchronously", async () => {
    const messages: Record<string, unknown>[] = [];
    mockQuery.mockImplementation(() => {
      throw new Error("SDK failure");
    });

    // query() throw is now caught inside the try block and emits an error run_result
    // instead of propagating — this ensures the frontend always gets a terminal event.
    await runAgentRequest(baseConfig(), (msg) => messages.push(msg));

    // sdk_plugins_debug, init_start, error display item, then error run_result
    const errorItem = messages.find(
      (m) => m.type === "display_item" && (m as Record<string, unknown>).item &&
        ((m as Record<string, unknown>).item as Record<string, unknown>).type === "error",
    );
    expect(errorItem).toBeDefined();

    const runResult = messages.find(
      (m) => m.type === "agent_event" && (m as Record<string, unknown>).event &&
        ((m as Record<string, unknown>).event as Record<string, unknown>).type === "run_result",
    );
    expect(runResult).toBeDefined();
  });

  it("passes apiKey via SDK env option instead of mutating process.env", async () => {
    async function* fakeConversation() {
      yield { type: "result", content: "done" };
    }
    mockQuery.mockReturnValue(fakeConversation() as ReturnType<typeof query>);

    const originalKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      await runAgentRequest(
        baseConfig({ apiKey: "sk-my-test-key" }),
        vi.fn(),
      );
      // API key should NOT be set on process.env (no global mutation)
      expect(process.env.ANTHROPIC_API_KEY).toBeUndefined();

      // API key should be passed through the SDK options.env field
      const callArgs = mockQuery.mock.calls[0][0];
      const opts = callArgs.options as Record<string, unknown>;
      const env = opts.env as Record<string, string | undefined>;
      expect(env.ANTHROPIC_API_KEY).toBe("sk-my-test-key");
    } finally {
      if (originalKey !== undefined) {
        process.env.ANTHROPIC_API_KEY = originalKey;
      } else {
        delete process.env.ANTHROPIC_API_KEY;
      }
    }
  });

  it("passes options with correct defaults", async () => {
    async function* fakeConversation() {
      yield { type: "result", content: "done" };
    }
    mockQuery.mockReturnValue(fakeConversation() as ReturnType<typeof query>);

    await runAgentRequest(baseConfig(), vi.fn());

    const callArgs = mockQuery.mock.calls[0][0];
    expect(callArgs.options).toMatchObject({
      cwd: "/tmp/test",
      maxTurns: 50,
      permissionMode: "bypassPermissions",
    });
  });

  it("routes SDK stderr through onMessage as sdk_stderr system events", async () => {
    // Capture the stderr callback that buildQueryOptions passes to the SDK
    let capturedStderr: ((data: string) => void) | undefined;
    mockQuery.mockImplementation((args: Record<string, unknown>) => {
      const opts = args.options as Record<string, unknown>;
      capturedStderr = opts.stderr as (data: string) => void;
      async function* fakeConversation() {
        yield { type: "result", content: "done" };
      }
      return fakeConversation() as ReturnType<typeof query>;
    });

    const messages: Record<string, unknown>[] = [];
    await runAgentRequest(baseConfig(), (msg) => messages.push(msg));

    // The stderr handler should have been passed to the SDK
    expect(capturedStderr).toBeDefined();

    // Simulate SDK subprocess stderr output
    capturedStderr!("some debug output\n");

    const stderrMsg = messages.find(
      (m) => m.type === "system" && m.subtype === "sdk_stderr",
    );
    expect(stderrMsg).toBeDefined();
    expect(stderrMsg!.data).toBe("some debug output");
    expect(stderrMsg!.timestamp).toEqual(expect.any(Number));
  });

  it("emits an error display item and run_result when the async iterator throws after startup", async () => {
    async function* failingConversation() {
      yield {
        type: "assistant",
        message: {
          content: [{ type: "text", text: "step 1" }],
          usage: { input_tokens: 10, output_tokens: 5 },
        },
      };
      throw new Error("stream failed after startup");
    }
    mockQuery.mockReturnValue(failingConversation() as ReturnType<typeof query>);

    const messages: Record<string, unknown>[] = [];
    await runAgentRequest(baseConfig({ skillName: "sales-analysis", stepId: -10 }), (msg) =>
      messages.push(msg),
    );

    const displayItems = messages.filter((m) => m.type === "display_item");
    const runResult = findRunResult(messages);

    expect(displayItems).toHaveLength(2);
    expect(runResult).toBeDefined();

    const errorItem = (displayItems[1] as Record<string, unknown>).item as Record<string, unknown>;
    expect(errorItem.type).toBe("error");
    expect(errorItem.errorMessage).toBe("stream failed after startup");

    const summary = runResult!.event as Record<string, unknown>;
    expect(summary.skillName).toBe("sales-analysis");
    expect(summary.stepId).toBe(-10);
    expect(summary.status).toBe("error");
    expect(summary.resultSubtype).toBe("error_during_execution");
    expect(summary.resultErrors).toEqual(["stream failed after startup"]);
    expect(summary.stopReason).toBe("error");
    expect(summary.numTurns).toBe(1);
  });
});

describe("selectPluginPaths", () => {
  it("returns no plugins when none are explicitly required", () => {
    expect(
      selectPluginPaths(
        ["/workspace/.claude/plugins/vd-agent", "/workspace/.claude/plugins/skill-creator"],
        undefined,
      ),
    ).toEqual([]);
    expect(
      selectPluginPaths(
        ["/workspace/.claude/plugins/vd-agent", "/workspace/.claude/plugins/skill-creator"],
        [],
      ),
    ).toEqual([]);
  });

  it("filters discovered plugin paths to the explicit required set", () => {
    expect(
      selectPluginPaths(
        [
          "/workspace/.claude/plugins/vd-agent",
          "/workspace/.claude/plugins/skill-creator",
          "/workspace/.claude/plugins/skill-content-researcher",
        ],
        ["skill-content-researcher", "skill-creator"],
      ),
    ).toEqual([
      "/workspace/.claude/plugins/skill-content-researcher",
      "/workspace/.claude/plugins/skill-creator",
    ]);
  });

  it("ignores requested plugins that are not installed", () => {
    expect(
      selectPluginPaths(
        ["/workspace/.claude/plugins/vd-agent"],
        ["skill-creator", "vd-agent"],
      ),
    ).toEqual(["/workspace/.claude/plugins/vd-agent"]);
  });
});

describe("result message error subtypes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("emits run_result with error_max_turns subtype, errors, and stop_reason", async () => {
    const errorResult = {
      type: "result",
      subtype: "error_max_turns",
      is_error: true,
      errors: ["Max turns reached"],
      stop_reason: "end_turn",
      usage: { input_tokens: 500, output_tokens: 100 },
      total_cost_usd: 0.02,
    };

    async function* fakeConversation() {
      yield { type: "assistant", message: { content: [{ type: "text", text: "Working..." }] } };
      yield errorResult;
    }
    mockQuery.mockReturnValue(fakeConversation() as ReturnType<typeof query>);

    const messages: Record<string, unknown>[] = [];
    await runAgentRequest(baseConfig(), (msg) => messages.push(msg));

    const summary = findRunResult(messages);
    expect(summary).toBeDefined();
    const data = summary!.event as Record<string, unknown>;
    expect(data.resultSubtype).toBe("error_max_turns");
    expect(data.resultErrors).toEqual(["Max turns reached"]);
    expect(data.stopReason).toBe("end_turn");
    expect(data.status).toBe("error");
  });

  it("emits run_result with error_max_budget_usd subtype", async () => {
    async function* fakeConversation() {
      yield {
        type: "result",
        subtype: "error_max_budget_usd",
        is_error: true,
        errors: ["Budget exceeded"],
        stop_reason: "end_turn",
      };
    }
    mockQuery.mockReturnValue(fakeConversation() as ReturnType<typeof query>);

    const messages: Record<string, unknown>[] = [];
    await runAgentRequest(baseConfig(), (msg) => messages.push(msg));

    const summary = findRunResult(messages);
    expect(summary).toBeDefined();
    const data = summary!.event as Record<string, unknown>;
    expect(data.resultSubtype).toBe("error_max_budget_usd");
    expect(data.status).toBe("error");
  });

  it("emits run_result with refusal stop_reason on success result", async () => {
    async function* fakeConversation() {
      yield {
        type: "result",
        subtype: "success",
        is_error: false,
        stop_reason: "refusal",
        result: "I cannot help with that.",
      };
    }
    mockQuery.mockReturnValue(fakeConversation() as ReturnType<typeof query>);

    const messages: Record<string, unknown>[] = [];
    await runAgentRequest(baseConfig(), (msg) => messages.push(msg));

    const summary = findRunResult(messages);
    expect(summary).toBeDefined();
    const data = summary!.event as Record<string, unknown>;
    expect(data.stopReason).toBe("refusal");
    expect(data.resultSubtype).toBe("success");
  });

  it("emits run_result with clean success fields", async () => {
    async function* fakeConversation() {
      yield {
        type: "result",
        subtype: "success",
        is_error: false,
        stop_reason: "end_turn",
        result: "Done!",
        total_cost_usd: 0.01,
      };
    }
    mockQuery.mockReturnValue(fakeConversation() as ReturnType<typeof query>);

    const messages: Record<string, unknown>[] = [];
    await runAgentRequest(baseConfig(), (msg) => messages.push(msg));

    const summary = findRunResult(messages);
    expect(summary).toBeDefined();
    const data = summary!.event as Record<string, unknown>;
    expect(data.resultSubtype).toBe("success");
    expect(data.status).toBe("completed");
    expect(data.stopReason).toBe("end_turn");
  });

  it("emits error run_result when SDK completes without result message (VU-531)", async () => {
    // Simulate an SDK that yields an assistant message with an auth error
    // but no result message — the iterator completes normally.
    async function* noResultConversation() {
      yield {
        type: "assistant",
        error: "authentication_failed",
        message: { content: [], usage: null },
      };
      // No "result" message — iterator ends
    }
    mockQuery.mockReturnValue(noResultConversation() as ReturnType<typeof query>);

    const messages: Record<string, unknown>[] = [];
    await runAgentRequest(baseConfig(), (msg) => messages.push(msg));

    // The missing-result guard should emit an error run_result
    const summary = findRunResult(messages);
    expect(summary).toBeDefined();
    const data = summary!.event as Record<string, unknown>;
    expect(data.status).toBe("error");
  });

  it("does not double-emit run_result when auth error already emitted one (VU-531)", async () => {
    // The assistant error handler in message-processor emits a run_result.
    // The missing-result guard should NOT emit a second one.
    async function* authErrorConversation() {
      yield {
        type: "assistant",
        error: "authentication_failed",
        message: { content: [], usage: null },
      };
    }
    mockQuery.mockReturnValue(authErrorConversation() as ReturnType<typeof query>);

    const messages: Record<string, unknown>[] = [];
    await runAgentRequest(baseConfig(), (msg) => messages.push(msg));

    const runResults = messages.filter(
      (m) => m.type === "agent_event"
        && (m.event as Record<string, unknown>)?.type === "run_result",
    );
    // Exactly one run_result — from the assistant error handler
    // (the missing-result guard should see resultEmitted=true and skip)
    expect(runResults).toHaveLength(1);
    const data = runResults[0].event as Record<string, unknown>;
    expect(data.resultSubtype).toBe("error_authentication");
  });
});

describe("emitSystemEvent", () => {
  it("emits a system event with correct format", () => {
    const messages: Record<string, unknown>[] = [];
    emitSystemEvent((msg) => messages.push(msg), "init_start");

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      type: "system",
      subtype: "init_start",
    });
    expect(typeof messages[0].timestamp).toBe("number");
  });

  it("emits events with the specified subtype", () => {
    const messages: Record<string, unknown>[] = [];
    emitSystemEvent((msg) => messages.push(msg), "sdk_ready");

    expect(messages[0]).toMatchObject({
      type: "system",
      subtype: "sdk_ready",
    });
  });

  it("includes a millisecond timestamp", () => {
    const before = Date.now();
    const messages: Record<string, unknown>[] = [];
    emitSystemEvent((msg) => messages.push(msg), "init_start");
    const after = Date.now();

    const timestamp = messages[0].timestamp as number;
    expect(timestamp).toBeGreaterThanOrEqual(before);
    expect(timestamp).toBeLessThanOrEqual(after);
  });
});

describe("runAgentRequest passes prompt directly to query", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes prompt as-is to SDK query (no history formatting)", async () => {
    async function* fakeConversation() {
      yield { type: "result", content: "done" };
    }
    mockQuery.mockReturnValue(fakeConversation() as ReturnType<typeof query>);

    await runAgentRequest(baseConfig({ prompt: "plain prompt" }), vi.fn());

    const callArgs = mockQuery.mock.calls[0][0];
    expect(callArgs.prompt).toBe("plain prompt");
  });
});

// TS-02: Abort end-to-end path — external signal fires mid-stream → shutdown run_result
describe("runAgentRequest — abort via external signal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("emits run_result with status='shutdown' (not 'error') when external signal fires", async () => {
    const externalController = new AbortController();

    async function* fakeConversation() {
      yield {
        type: "assistant",
        message: {
          content: [{ type: "text", text: "working..." }],
          usage: { input_tokens: 10, output_tokens: 5 },
        },
      };
      // External signal fires after first message
      externalController.abort();
      // One more yield that should be skipped due to abort check
      yield { type: "result", subtype: "success", usage: { input_tokens: 10, output_tokens: 5 }, total_cost_usd: 0.001 };
    }
    mockQuery.mockReturnValue(fakeConversation() as ReturnType<typeof query>);

    const messages: Record<string, unknown>[] = [];
    await runAgentRequest(baseConfig(), (msg) => messages.push(msg), externalController.signal);

    const runResult = messages.find(
      (m) =>
        m.type === "agent_event" &&
        (m.event as Record<string, unknown> | undefined)?.type === "run_result",
    );
    expect(runResult).toBeDefined();
    const event = runResult!.event as Record<string, unknown>;
    expect(event.status).toBe("shutdown");
  });
});

// TS-08: discoverInstalledPlugins swallowed error
describe("discoverInstalledPlugins — error handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns [] when readdir throws a permission-denied error (does not throw)", async () => {
    const mockReaddir = vi.mocked(fsPromises.readdir);
    mockReaddir.mockRejectedValueOnce(
      Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" }),
    );

    const result = await discoverInstalledPlugins("/some/workspace");
    expect(result).toEqual([]);
  });
});
