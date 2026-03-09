import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the SDK before importing anything that uses it
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn(),
}));

import { query } from "@anthropic-ai/claude-agent-sdk";
import { runAgentRequest, emitSystemEvent } from "../run-agent.js";
import type { SidecarConfig } from "../config.js";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

const mockQuery = vi.mocked(query);

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

  it("fails fast when a required plugin is missing", async () => {
    // Create an empty temp dir (no .claude/plugins)
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "sidecar-plugin-missing-"));
    await expect(
      runAgentRequest(
        baseConfig({
          cwd: tmp,
          requiredPlugins: ["skill-content-researcher"],
        }),
        vi.fn(),
      ),
    ).rejects.toThrow("Required plugin 'skill-content-researcher' not installed");
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("allows execution when required plugin manifest exists and matches", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "sidecar-plugin-present-"));
    const manifestPath = path.join(
      tmp,
      ".claude",
      "plugins",
      "skill-content-researcher",
      ".claude-plugin",
      "plugin.json",
    );
    await fs.mkdir(path.dirname(manifestPath), { recursive: true });
    await fs.writeFile(manifestPath, JSON.stringify({ name: "skill-content-researcher" }));

    async function* fakeConversation() {
      yield { type: "result", content: "done" };
    }
    mockQuery.mockReturnValue(fakeConversation() as ReturnType<typeof query>);

    const messages: Record<string, unknown>[] = [];
    await runAgentRequest(
      baseConfig({
        cwd: tmp,
        requiredPlugins: ["skill-content-researcher"],
      }),
      (msg) => messages.push(msg),
    );

    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(messages[0]).toMatchObject({ type: "system", subtype: "sdk_plugins_debug" });
    expect(messages[1]).toMatchObject({ type: "system", subtype: "init_start" });
  });

  it("streams all messages to the onMessage callback", async () => {
    const sdkMessages = [
      { type: "agent_message", content: "step 1" },
      { type: "tool_use", name: "Read", input: {} },
      { type: "result", content: "done" },
    ];

    async function* fakeConversation() {
      for (const msg of sdkMessages) {
        yield msg;
      }
    }
    mockQuery.mockReturnValue(fakeConversation() as ReturnType<typeof query>);

    const messages: Record<string, unknown>[] = [];
    await runAgentRequest(baseConfig(), (msg) => messages.push(msg));

    // First three messages are system events (sdk_plugins_debug, init_start, sdk_ready), then SDK messages
    expect(messages).toHaveLength(6);
    expect(messages[3]).toEqual({ type: "agent_message", content: "step 1" });
    expect(messages[4]).toEqual({ type: "tool_use", name: "Read", input: {} });
    expect(messages[5]).toEqual({ type: "result", content: "done" });
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

  it("propagates SDK errors after emitting init_start", async () => {
    const messages: Record<string, unknown>[] = [];
    mockQuery.mockImplementation(() => {
      throw new Error("SDK failure");
    });

    await expect(
      runAgentRequest(baseConfig(), (msg) => messages.push(msg)),
    ).rejects.toThrow("SDK failure");

    // sdk_plugins_debug then init_start should have been emitted before the error
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ type: "system", subtype: "sdk_plugins_debug" });
    expect(messages[1]).toMatchObject({ type: "system", subtype: "init_start" });
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
});

describe("result message error subtypes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("forwards error_max_turns result with subtype, is_error, and stop_reason intact", async () => {
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

    // Find the result message (after system events)
    const result = messages.find((m) => m.type === "result");
    expect(result).toBeDefined();
    expect(result!.subtype).toBe("error_max_turns");
    expect(result!.is_error).toBe(true);
    expect(result!.errors).toEqual(["Max turns reached"]);
    expect(result!.stop_reason).toBe("end_turn");
  });

  it("forwards error_max_budget_usd result intact", async () => {
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

    const result = messages.find((m) => m.type === "result");
    expect(result!.subtype).toBe("error_max_budget_usd");
    expect(result!.is_error).toBe(true);
  });

  it("forwards refusal stop_reason on success result", async () => {
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

    const result = messages.find((m) => m.type === "result");
    expect(result!.stop_reason).toBe("refusal");
    expect(result!.subtype).toBe("success");
  });

  it("forwards clean success result with all fields", async () => {
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

    const result = messages.find((m) => m.type === "result");
    expect(result!.subtype).toBe("success");
    expect(result!.is_error).toBe(false);
    expect(result!.stop_reason).toBe("end_turn");
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
