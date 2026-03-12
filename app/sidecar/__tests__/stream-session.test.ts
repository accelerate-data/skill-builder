import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the SDK before importing anything that uses it
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn(),
}));

// Mock run-agent helpers to avoid plugin discovery I/O
vi.mock("../run-agent.js", () => ({
  emitSystemEvent: vi.fn(),
  discoverInstalledPlugins: vi.fn().mockResolvedValue([]),
  selectPluginPaths: vi.fn().mockReturnValue([]),
}));

// Mock options builder
vi.mock("../options.js", () => ({
  buildQueryOptions: vi.fn().mockReturnValue({}),
}));

// Mock shutdown helpers
vi.mock("../shutdown.js", () => ({
  createAbortState: vi.fn(() => ({
    abortController: new AbortController(),
  })),
  linkExternalSignal: vi.fn(),
}));

import { query } from "@anthropic-ai/claude-agent-sdk";
import { StreamSession } from "../stream-session.js";
import type { SidecarConfig } from "../config.js";

const mockQuery = vi.mocked(query);

function baseConfig(overrides: Partial<SidecarConfig> = {}): SidecarConfig {
  return {
    prompt: "test prompt",
    apiKey: "sk-test",
    cwd: "/tmp/test",
    ...overrides,
  };
}

/** Collect all messages emitted via onMessage and resolve when a predicate matches. */
function collectUntil(
  predicate: (msg: Record<string, unknown>) => boolean,
): {
  messages: Record<string, unknown>[];
  done: Promise<void>;
  onMessage: (requestId: string, msg: Record<string, unknown>) => void;
} {
  const messages: Record<string, unknown> = [];
  let resolve!: () => void;
  const done = new Promise<void>((res) => {
    resolve = res;
  });
  const onMessage = (_requestId: string, msg: Record<string, unknown>) => {
    (messages as Record<string, unknown>[]).push(msg);
    if (predicate(msg)) resolve();
  };
  return { messages: messages as unknown as Record<string, unknown>[], done, onMessage };
}

function isAgentEvent(type: string) {
  return (msg: Record<string, unknown>) =>
    msg.type === "agent_event" &&
    (msg.event as Record<string, unknown> | undefined)?.type === type;
}

function isRunResult(msg: Record<string, unknown>): boolean {
  return isAgentEvent("run_result")(msg);
}

function isSessionExhausted(msg: Record<string, unknown>): boolean {
  return isAgentEvent("session_exhausted")(msg);
}

describe("StreamSession — run_result emission ordering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.MOCK_AGENTS;
  });

  afterEach(() => {
    delete process.env.MOCK_AGENTS;
  });

  it("emits run_result before session_exhausted on natural turn exhaustion (no result SDK message)", async () => {
    // SDK generator ends without emitting a result-type message
    async function* fakeConversation() {
      yield {
        type: "assistant",
        message: {
          type: "message",
          role: "assistant",
          content: [{ type: "text", text: "thinking..." }],
          stop_reason: "end_turn",
          usage: { input_tokens: 10, output_tokens: 5 },
        },
      };
      // Generator ends here — no result message → natural turn exhaustion
    }
    mockQuery.mockReturnValue(fakeConversation() as ReturnType<typeof query>);

    const { messages, done, onMessage } = collectUntil(isSessionExhausted);
    new StreamSession("sess-1", "req-1", baseConfig(), onMessage);
    await done;

    const runResultIdx = messages.findIndex(isRunResult);
    const exhaustedIdx = messages.findIndex(isSessionExhausted);

    expect(runResultIdx).toBeGreaterThanOrEqual(0);
    expect(exhaustedIdx).toBeGreaterThanOrEqual(0);
    expect(runResultIdx).toBeLessThan(exhaustedIdx);
  });

  it("emits run_result exactly once when SDK itself emits a result message", async () => {
    async function* fakeConversation() {
      yield {
        type: "result",
        subtype: "tool_result",
        is_error: false,
        stop_reason: "end_turn",
        structured_output: null,
        usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      };
    }
    mockQuery.mockReturnValue(fakeConversation() as ReturnType<typeof query>);

    const { messages, done, onMessage } = collectUntil(isSessionExhausted);
    new StreamSession("sess-2", "req-2", baseConfig(), onMessage);
    await done;

    const runResults = messages.filter(isRunResult);
    expect(runResults).toHaveLength(1);
  });

  it("emits run_result on abort path via external abort signal", async () => {
    const externalController = new AbortController();

    async function* fakeConversation() {
      // The external signal aborts mid-stream
      externalController.abort();
      yield {
        type: "assistant",
        message: {
          type: "message",
          role: "assistant",
          content: [{ type: "text", text: "partial..." }],
          stop_reason: null,
          usage: { input_tokens: 5, output_tokens: 2 },
        },
      };
    }
    mockQuery.mockReturnValue(fakeConversation() as ReturnType<typeof query>);

    // Collect until session_exhausted (fires after the abort path)
    const { messages, done, onMessage } = collectUntil(isSessionExhausted);
    new StreamSession("sess-3", "req-3", baseConfig(), onMessage, externalController.signal);
    await done;

    // A run_result must have been emitted (shutdown status)
    const runResults = messages.filter(isRunResult);
    expect(runResults.length).toBeGreaterThanOrEqual(1);
    const event = (runResults[0]!.event as Record<string, unknown>);
    expect(event.status).toBe("shutdown");
  });

  it("does not emit duplicate run_result on error path", async () => {
    async function* fakeConversation() {
      yield { type: "assistant", message: { type: "message", role: "assistant", content: [], stop_reason: null, usage: null } };
      throw new Error("SDK connection reset");
    }
    mockQuery.mockReturnValue(fakeConversation() as ReturnType<typeof query>);

    const { messages, done, onMessage } = collectUntil(isSessionExhausted);
    new StreamSession("sess-4", "req-4", baseConfig(), onMessage);
    await done;

    expect(messages.filter(isRunResult)).toHaveLength(1);
  });
});

describe("StreamSession — mock streaming mode", () => {
  beforeEach(() => {
    process.env.MOCK_AGENTS = "true";
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.MOCK_AGENTS;
  });

  it("emits run_result when session is closed after mock turns", async () => {
    const messages: Record<string, unknown>[] = [];
    const onMessage = (_requestId: string, msg: Record<string, unknown>) => {
      messages.push(msg);
    };

    const session = new StreamSession("sess-mock", "req-m1", baseConfig(), onMessage);
    // Wait for the initial mock turn to complete
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Push a follow-up turn
    session.pushMessage("req-m2", "follow-up message");
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Close the session (simulates stream_end from Rust)
    session.close();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(messages.filter(isRunResult)).toHaveLength(1);
  });
});
