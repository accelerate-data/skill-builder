import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the SDK before importing anything that uses it
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn(),
}));

// We test the extracted modules directly rather than spawning the runner process,
// simulating the main() flow to verify correct integration.
import { query } from "@anthropic-ai/claude-agent-sdk";
import { parseConfig, type SidecarConfig } from "../config.js";
import { buildQueryOptions } from "../options.js";
import { createAbortState } from "../shutdown.js";

const mockQuery = vi.mocked(query);

// =====================================================================
// Unit tests for buildQueryOptions (agent / model resolution)
// =====================================================================

/** Minimal config every test needs — prompt, apiKey, and cwd are required. */
function baseConfig(overrides: Partial<SidecarConfig> = {}): SidecarConfig {
  return {
    prompt: "test prompt",
    apiKey: "sk-test",
    cwd: "/tmp/test",
    ...overrides,
  };
}

describe("buildQueryOptions", () => {
  // -----------------------------------------------------------------
  // Agent / model resolution
  // -----------------------------------------------------------------

  it("agent-only: passes agent + settingSources, no model", () => {
    const abortController = new AbortController();
    const opts = buildQueryOptions(
      baseConfig({ agentName: "research" }),
      abortController,
    );

    expect(opts).toHaveProperty("agent", "research");
    expect(opts).toHaveProperty("settingSources", ["project"]);
    expect(opts).not.toHaveProperty("model");
  });

  it("model-only: passes model, no agent", () => {
    const abortController = new AbortController();
    const opts = buildQueryOptions(
      baseConfig({ model: "claude-sonnet-4-20250514" }),
      abortController,
    );

    expect(opts).toHaveProperty("model", "claude-sonnet-4-20250514");
    expect(opts).not.toHaveProperty("agent");
    expect(opts).toHaveProperty("settingSources", ["project"]);
  });

  it("both agent + model: passes agent + settingSources + model (model overrides front-matter)", () => {
    const abortController = new AbortController();
    const opts = buildQueryOptions(
      baseConfig({
        agentName: "research",
        model: "claude-haiku-4-20250414",
      }),
      abortController,
    );

    expect(opts).toHaveProperty("agent", "research");
    expect(opts).toHaveProperty("settingSources", ["project"]);
    expect(opts).toHaveProperty("model", "claude-haiku-4-20250414");
  });

  it("neither agent nor model: settingSources always present, no agent/model", () => {
    const abortController = new AbortController();
    const opts = buildQueryOptions(baseConfig(), abortController);

    expect(opts).not.toHaveProperty("agent");
    expect(opts).toHaveProperty("settingSources", ["project"]);
    expect(opts).not.toHaveProperty("model");
  });

  // -----------------------------------------------------------------
  // Required fields always present
  // -----------------------------------------------------------------

  it("always includes cwd, allowedTools, maxTurns, permissionMode, executable", () => {
    const abortController = new AbortController();
    const opts = buildQueryOptions(baseConfig(), abortController);

    expect(opts).toHaveProperty("cwd", "/tmp/test");
    expect(opts).toHaveProperty("maxTurns", 50);
    expect(opts).toHaveProperty("permissionMode", "bypassPermissions");
    expect(opts).toHaveProperty("executable");
  });

  it("uses provided maxTurns when set", () => {
    const abortController = new AbortController();
    const opts = buildQueryOptions(
      baseConfig({ maxTurns: 10 }),
      abortController,
    );
    expect(opts.maxTurns).toBe(10);
  });

  it("uses provided permissionMode when set", () => {
    const abortController = new AbortController();
    const opts = buildQueryOptions(
      baseConfig({ permissionMode: "default" }),
      abortController,
    );
    expect(opts.permissionMode).toBe("default");
  });

  // -----------------------------------------------------------------
  // Optional fields — only present when provided
  // -----------------------------------------------------------------

  it("spreads sessionId as resume when provided", () => {
    const abortController = new AbortController();
    const opts = buildQueryOptions(
      baseConfig({ sessionId: "sess-abc-123" }),
      abortController,
    );
    expect(opts).toHaveProperty("resume", "sess-abc-123");
  });

  it("does not include resume when sessionId is missing", () => {
    const abortController = new AbortController();
    const opts = buildQueryOptions(baseConfig(), abortController);
    expect(opts).not.toHaveProperty("resume");
  });

  it("spreads betas when provided", () => {
    const abortController = new AbortController();
    const opts = buildQueryOptions(
      baseConfig({ betas: ["interleaved-thinking-2025-05-14"] }),
      abortController,
    );
    expect(opts).toHaveProperty("betas", [
      "interleaved-thinking-2025-05-14",
    ]);
  });

  it("does not include betas when missing", () => {
    const abortController = new AbortController();
    const opts = buildQueryOptions(baseConfig(), abortController);
    expect(opts).not.toHaveProperty("betas");
  });

  it("spreads pathToClaudeCodeExecutable when provided", () => {
    const abortController = new AbortController();
    const opts = buildQueryOptions(
      baseConfig({ pathToClaudeCodeExecutable: "/usr/local/bin/claude" }),
      abortController,
    );
    expect(opts).toHaveProperty(
      "pathToClaudeCodeExecutable",
      "/usr/local/bin/claude",
    );
  });

  it("does not include pathToClaudeCodeExecutable when missing", () => {
    const abortController = new AbortController();
    const opts = buildQueryOptions(baseConfig(), abortController);
    expect(opts).not.toHaveProperty("pathToClaudeCodeExecutable");
  });
});

// =====================================================================
// Integration tests for the main() flow
// =====================================================================

/**
 * Helper: simulate the main() flow with a given config and mock query behavior.
 * Returns { stdout, stderr, exitCode }.
 */
async function runMain(
  configObj: Record<string, unknown>,
  queryBehavior: "success" | "error" | "aborted",
  messages: unknown[] = [{ type: "result", content: "done" }]
) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  let exitCode = 0;

  // Parse config
  const argv = ["node", "agent-runner.js", JSON.stringify(configObj)];
  const config = parseConfig(argv);

  const state = createAbortState();

  if (queryBehavior === "aborted") {
    state.aborted = true;
  }

  // Build options
  const options = buildQueryOptions(config, state.abortController);

  if (queryBehavior === "error") {
    mockQuery.mockImplementation(() => {
      throw new Error("SDK connection failed");
    });
  } else {
    // Return an async iterable
    async function* fakeConversation() {
      for (const msg of messages) {
        yield msg;
      }
    }
    mockQuery.mockReturnValue(fakeConversation() as ReturnType<typeof query>);
  }

  try {
    if (config.apiKey) {
      // Simulating env set (don't actually set in tests)
    }

    const conversation = query({
      prompt: config.prompt,
      options,
    });

    for await (const message of conversation) {
      if (state.aborted) break;
      stdout.push(JSON.stringify(message) + "\n");
    }

    exitCode = 0;
  } catch (err) {
    if (state.aborted) {
      stderr.push("Agent cancelled via signal\n");
      exitCode = 0;
    } else {
      const message = err instanceof Error ? err.message : String(err);
      stdout.push(JSON.stringify({ type: "error", error: message }) + "\n");
      exitCode = 1;
    }
  }

  return { stdout, stderr, exitCode };
}

describe("agent-runner integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const validConfig = {
    prompt: "Hello agent",
    apiKey: "sk-test-key",
    cwd: "/tmp/project",
    model: "claude-sonnet-4-20250514",
  };

  it("outputs JSON messages on successful run and exits 0", async () => {
    const messages = [
      { type: "assistant", message: { content: "thinking..." } },
      { type: "result", result: "all done" },
    ];
    const { stdout, exitCode } = await runMain(
      validConfig,
      "success",
      messages
    );

    expect(exitCode).toBe(0);
    expect(stdout).toHaveLength(2);

    const parsed0 = JSON.parse(stdout[0]);
    expect(parsed0.type).toBe("assistant");

    const parsed1 = JSON.parse(stdout[1]);
    expect(parsed1.type).toBe("result");
  });

  it("outputs JSON error on SDK failure and exits 1", async () => {
    const { stdout, exitCode } = await runMain(validConfig, "error");

    expect(exitCode).toBe(1);
    expect(stdout).toHaveLength(1);

    const parsed = JSON.parse(stdout[0]);
    expect(parsed.type).toBe("error");
    expect(parsed.error).toBe("SDK connection failed");
  });

  it("exits 0 without error output when aborted", async () => {
    const messages = [
      { type: "assistant", message: { content: "step 1" } },
      { type: "assistant", message: { content: "step 2" } },
    ];
    const { stdout, exitCode } = await runMain(
      validConfig,
      "aborted",
      messages
    );

    // When aborted before iteration, no messages should be written
    expect(exitCode).toBe(0);
    expect(stdout).toHaveLength(0);
  });

  it("passes correct prompt to query()", async () => {
    await runMain(validConfig, "success");

    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "Hello agent",
      })
    );
  });

  it("passes correct options to query()", async () => {
    await runMain(validConfig, "success");

    const callArgs = mockQuery.mock.calls[0][0];
    expect(callArgs.options).toMatchObject({
      model: "claude-sonnet-4-20250514",
      cwd: "/tmp/project",
      maxTurns: 50,
      permissionMode: "bypassPermissions",
    });
  });

  it("parseConfig throws for missing argument", () => {
    expect(() => parseConfig(["node", "script.js"])).toThrow(
      "Missing config argument"
    );
  });

  it("parseConfig throws for invalid JSON argument", () => {
    expect(() => parseConfig(["node", "script.js", "{bad}"])).toThrow(
      "Failed to parse config:"
    );
  });

  it("each message is a valid JSON line", async () => {
    const messages = [
      { type: "assistant", content: "line 1" },
      { type: "tool_use", name: "Read" },
      { type: "result", result: "done" },
    ];
    const { stdout } = await runMain(validConfig, "success", messages);

    for (const line of stdout) {
      expect(line.endsWith("\n")).toBe(true);
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });
});
