import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter, PassThrough } from "node:stream";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

import * as childProcess from "node:child_process";
import { OpenHandsRuntime } from "../runtime/openhands-runtime.js";
import type { OneShotRunRequest, RuntimeSink } from "../runtime/types.js";

function makeRequest(
  overrides: Partial<OneShotRunRequest> = {},
): OneShotRunRequest {
  return {
    mode: "one-shot",
    allowUserQuestions: false,
    prompt: "test prompt",
    apiKey: "sk-test",
    llm: {
      model: "claude-sonnet-4-5",
      apiKey: "sk-llm-test",
      baseUrl: "https://models.example.com/v1",
      timeoutSeconds: 300,
      numRetries: 5,
      reasoningEffort: "high",
    },
    workspaceRootDir: "/tmp/test",
    workspaceSkillDir: "/tmp/test",
    context: {
      skillName: "test-skill",
      stepId: 1,
      pluginSlug: "test-plugin",
      workspaceSkillDir: "/tmp/test",
    },
    ...overrides,
  };
}

function makeSink() {
  const messages: Record<string, unknown>[] = [];
  const sink: RuntimeSink = {
    emit(message) {
      messages.push(message);
    },
    emitDisplayItem(item) {
      messages.push({ type: "display_item", item });
    },
    emitAgentEvent(event, timestamp = Date.now()) {
      messages.push({ type: "agent_event", event, timestamp });
    },
    emitRefineQuestion(question) {
      messages.push({
        type: "refine_question",
        tool_use_id: question.tool_use_id,
        questions: question.questions,
        timestamp: question.timestamp,
      });
    },
    emitRaw(message) {
      messages.push(message);
    },
  };
  return { messages, sink };
}

function makeMockChild(
  stdoutLines: string[],
  exitCode: number | null = 0,
  stderrLines: string[] = [],
) {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const stdin = new PassThrough();
  const child = new EventEmitter() as EventEmitter & {
    stdout: typeof stdout;
    stderr: typeof stderr;
    stdin: typeof stdin;
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdout = stdout;
  child.stderr = stderr;
  child.stdin = stdin;
  child.kill = vi.fn();

  setImmediate(() => {
    for (const line of stderrLines) {
      stderr.write(`${line}\n`);
    }
    stderr.end();
    for (const line of stdoutLines) {
      stdout.write(`${line}\n`);
    }
    stdout.end();
    child.emit("close", exitCode);
  });

  return child;
}

function completedState(overrides: Record<string, unknown> = {}) {
  return {
    type: "conversation_state",
    runtime: "openhands",
    conversation_id: "scope-review-1",
    agent_id: "skill-creator",
    status: "completed",
    error_detail: null,
    timestamp: 1714550402000,
    ...overrides,
  };
}

function conversationEvent(overrides: Record<string, unknown> = {}) {
  return {
    type: "conversation_event",
    runtime: "openhands",
    conversation_id: "scope-review-1",
    agent_id: "skill-creator",
    event_class: "MessageEvent",
    event: {
      source: "agent",
      message: "I found the scope constraints.",
    },
    timestamp: 1714550400000,
    ...overrides,
  };
}

function expectNoLegacyMessages(messages: Record<string, unknown>[]): void {
  expect(messages.some((message) => message.type === "openhands_event")).toBe(false);
  expect(messages.some((message) => message.type === "openhands_result")).toBe(false);
  expect(messages.some((message) => message.type === "display_item")).toBe(false);
  expect(
    messages.some(
      (message) =>
        message.type === "agent_event" &&
        (message.event as Record<string, unknown> | undefined)?.type ===
          "run_result",
    ),
  ).toBe(false);
  expect(
    messages.some(
      (message) => message.type === "system" && message.subtype === "sdk_stderr",
    ),
  ).toBe(false);
}

const mockSpawn = vi.mocked(childProcess.spawn);

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("OpenHandsRuntime.runOnce", () => {
  it("spawns python3 with the runner path", async () => {
    const child = makeMockChild([JSON.stringify(completedState())]);
    mockSpawn.mockReturnValue(
      child as unknown as ReturnType<typeof childProcess.spawn>,
    );

    const runtime = new OpenHandsRuntime();
    const { messages, sink } = makeSink();
    await runtime.runOnce(makeRequest(), sink);

    expect(mockSpawn).toHaveBeenCalledWith(
      "python3",
      expect.arrayContaining([expect.stringContaining("runner.py")]),
      expect.objectContaining({ stdio: ["pipe", "pipe", "pipe"] }),
    );
    expect(messages).toEqual([completedState()]);
    expectNoLegacyMessages(messages);
  });

  it("spawns the packaged runner directly when pathToOpenHandsRunner is provided", async () => {
    const child = makeMockChild([JSON.stringify(completedState())]);
    mockSpawn.mockReturnValue(
      child as unknown as ReturnType<typeof childProcess.spawn>,
    );

    const runtime = new OpenHandsRuntime();
    const { sink } = makeSink();
    await runtime.runOnce(
      makeRequest({
        pathToOpenHandsRunner: "/opt/skill-builder/openhands-runner",
      }),
      sink,
    );

    expect(mockSpawn).toHaveBeenCalledWith(
      "/opt/skill-builder/openhands-runner",
      [],
      expect.objectContaining({ stdio: ["pipe", "pipe", "pipe"] }),
    );
  });

  it("writes serialized request to stdin and closes it", async () => {
    const request = makeRequest({
      agentName: "skill-creator",
      taskKind: "scope_review",
      userMessageSuffix: "Follow the current user message exactly.",
      model: "anthropic/claude-sonnet-4-6",
      apiKey: "sk-top-level",
      modelBaseUrl: "https://models.example.com/v1",
      llm: {
        model: "claude-sonnet-4-5",
        apiKey: "sk-llm-test",
        baseUrl: "https://models.example.com/v1",
        apiVersion: "2024-10-01",
        temperature: 0.2,
        maxOutputTokens: 4096,
        timeoutSeconds: 300,
        numRetries: 5,
        reasoningEffort: "high",
        extraHeaders: {
          "x-provider-routing": "secure-route",
        },
        inputCostPerToken: 0.000003,
        outputCostPerToken: 0.000015,
        usageId: "workflow",
      },
      workspaceRootDir: "/tmp/workspace-root",
      workspaceSkillDir: "/tmp/workspace-root/plugin/skill",
      allowedTools: ["file_editor", "terminal"],
      maxTurns: 8,
      outputFormat: {
        type: "json_schema",
        schema: {
          type: "object",
          required: ["status"],
          properties: {
            status: { type: "string" },
          },
        },
      },
    });
    let stdinWritten = "";
    const child = makeMockChild([JSON.stringify(completedState())]);
    child.stdin.on("data", (chunk: Buffer) => {
      stdinWritten += chunk.toString();
    });
    mockSpawn.mockReturnValue(
      child as unknown as ReturnType<typeof childProcess.spawn>,
    );

    const runtime = new OpenHandsRuntime();
    const { sink } = makeSink();
    await runtime.runOnce(request, sink);

    const serialized = JSON.parse(stdinWritten) as Record<string, unknown>;
    expect(serialized.prompt).toBe("test prompt");
    expect(serialized.mode).toBe("one-shot");
    expect(serialized.agentName).toBe("skill-creator");
    expect(serialized.taskKind).toBe("scope_review");
    expect(serialized.userMessageSuffix).toBe(
      "Follow the current user message exactly.",
    );
    expect(serialized).not.toHaveProperty("model");
    expect(serialized).not.toHaveProperty("apiKey");
    expect(serialized).not.toHaveProperty("modelBaseUrl");
    expect(serialized.llm).toEqual({
      model: "claude-sonnet-4-5",
      apiKey: "sk-llm-test",
      baseUrl: "https://models.example.com/v1",
      apiVersion: "2024-10-01",
      temperature: 0.2,
      maxOutputTokens: 4096,
      timeoutSeconds: 300,
      numRetries: 5,
      reasoningEffort: "high",
      extraHeaders: {
        "x-provider-routing": "secure-route",
      },
      inputCostPerToken: 0.000003,
      outputCostPerToken: 0.000015,
      usageId: "workflow",
    });
    expect(serialized.maxTurns).toBe(8);
    expect(serialized.allowedTools).toEqual(["file_editor", "terminal"]);
    expect(serialized.outputFormat).toEqual(request.outputFormat);
    expect(serialized.workspaceRootDir).toBe("/tmp/workspace-root");
    expect(serialized.workspaceSkillDir).toBe(
      "/tmp/workspace-root/plugin/skill",
    );
  });

  it("forwards runner conversation records as raw messages without request_id", async () => {
    const event = conversationEvent();
    const running = completedState({ status: "running", timestamp: 1714550401000 });
    const done = completedState();
    const child = makeMockChild([
      JSON.stringify(running),
      JSON.stringify(event),
      JSON.stringify(done),
    ]);
    mockSpawn.mockReturnValue(
      child as unknown as ReturnType<typeof childProcess.spawn>,
    );

    const runtime = new OpenHandsRuntime();
    const { messages, sink } = makeSink();
    await runtime.runOnce(makeRequest(), sink);

    expect(messages).toEqual([running, event, done]);
    expect(messages.every((message) => !("request_id" in message))).toBe(true);
    expectNoLegacyMessages(messages);
  });

  it("drops transitional OpenHands records instead of mapping them", async () => {
    const child = makeMockChild([
      JSON.stringify({
        type: "openhands_event",
        event_kind: "message",
        text: "legacy progress",
      }),
      JSON.stringify({
        type: "openhands_result",
        status: "success",
        result_text: "legacy result",
      }),
    ]);
    mockSpawn.mockReturnValue(
      child as unknown as ReturnType<typeof childProcess.spawn>,
    );

    const runtime = new OpenHandsRuntime();
    const { messages, sink } = makeSink();
    await runtime.runOnce(makeRequest(), sink);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      type: "conversation_state",
      runtime: "openhands",
      status: "error",
    });
    expect(JSON.stringify(messages)).toContain(
      "OpenHands runner exited without producing a terminal conversation_state",
    );
    expectNoLegacyMessages(messages);
  });

  it("emits conversation_state error when process exits non-zero without terminal state", async () => {
    const child = makeMockChild([], 1);
    mockSpawn.mockReturnValue(
      child as unknown as ReturnType<typeof childProcess.spawn>,
    );

    const runtime = new OpenHandsRuntime();
    const { messages, sink } = makeSink();
    await runtime.runOnce(makeRequest(), sink);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      type: "conversation_state",
      runtime: "openhands",
      status: "error",
    });
    expect(JSON.stringify(messages[0])).toContain("exited with code 1");
    expectNoLegacyMessages(messages);
  });

  it("emits conversation_state error when spawning the child fails", async () => {
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const stdin = new PassThrough();
    const child = new EventEmitter() as EventEmitter & {
      stdout: typeof stdout;
      stderr: typeof stderr;
      stdin: typeof stdin;
      kill: ReturnType<typeof vi.fn>;
    };
    child.stdout = stdout;
    child.stderr = stderr;
    child.stdin = stdin;
    child.kill = vi.fn();
    mockSpawn.mockReturnValue(
      child as unknown as ReturnType<typeof childProcess.spawn>,
    );

    setImmediate(() => {
      child.emit("error", new Error("spawn failed for sk-llm-test"));
      stdout.end();
      stderr.end();
    });

    const runtime = new OpenHandsRuntime();
    const { messages, sink } = makeSink();
    await runtime.runOnce(makeRequest(), sink);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      type: "conversation_state",
      runtime: "openhands",
      status: "error",
    });
    expect(JSON.stringify(messages[0])).toContain("[REDACTED]");
    expect(JSON.stringify(messages[0])).not.toContain("sk-llm-test");
    expectNoLegacyMessages(messages);
  });

  it("writes child stderr to process.stderr after redaction without sink events", async () => {
    const stderrWrite = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const child = makeMockChild(
      [JSON.stringify(completedState())],
      0,
      ["request failed for sk-llm-test using secure-route"],
    );
    mockSpawn.mockReturnValue(
      child as unknown as ReturnType<typeof childProcess.spawn>,
    );

    const runtime = new OpenHandsRuntime();
    const { messages, sink } = makeSink();
    await runtime.runOnce(
      makeRequest({
        llm: {
          model: "claude-sonnet-4-5",
          apiKey: "sk-llm-test",
          extraHeaders: {
            "x-provider-routing": "secure-route",
          },
        },
      }),
      sink,
    );

    const stderrOutput = stderrWrite.mock.calls
      .map((call) => String(call[0]))
      .join("");
    expect(stderrOutput).toContain("[REDACTED]");
    expect(stderrOutput).not.toContain("sk-llm-test");
    expect(stderrOutput).not.toContain("secure-route");
    expectNoLegacyMessages(messages);
  });

  it("emits conversation_state cancelled when abort signal fires before terminal state", async () => {
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const stdin = new PassThrough();
    const child = new EventEmitter() as EventEmitter & {
      stdout: typeof stdout;
      stderr: typeof stderr;
      stdin: typeof stdin;
      kill: ReturnType<typeof vi.fn>;
    };
    child.stdout = stdout;
    child.stderr = stderr;
    child.stdin = stdin;
    child.kill = vi.fn(() => {
      setImmediate(() => {
        stdout.end();
        stderr.end();
        child.emit("close", null);
      });
    });
    mockSpawn.mockReturnValue(
      child as unknown as ReturnType<typeof childProcess.spawn>,
    );

    const controller = new AbortController();
    setImmediate(() => {
      controller.abort();
    });

    const runtime = new OpenHandsRuntime();
    const { messages, sink } = makeSink();
    await runtime.runOnce(makeRequest(), sink, controller.signal);

    expect(child.kill).toHaveBeenCalled();
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      type: "conversation_state",
      runtime: "openhands",
      status: "cancelled",
    });
    expectNoLegacyMessages(messages);
  });

  it("rejects one-shot requests that include AskUserQuestion before spawning", async () => {
    const runtime = new OpenHandsRuntime();
    const { messages, sink } = makeSink();

    await expect(
      runtime.runOnce(makeRequest({ allowedTools: ["AskUserQuestion"] }), sink),
    ).rejects.toThrow(
      "one-shot runtime requests cannot include user-question tools",
    );

    expect(mockSpawn).not.toHaveBeenCalled();
    expect(messages).toEqual([]);
  });
});

describe("OpenHandsRuntime.startStreamingSession", () => {
  it("throws not-yet-supported error", () => {
    const runtime = new OpenHandsRuntime();
    const { sink } = makeSink();

    expect(() =>
      runtime.startStreamingSession(
        {
          mode: "streaming",
          allowUserQuestions: true,
          prompt: "hello",
          apiKey: "sk-test",
          llm: {
            model: "claude-sonnet-4-5",
            apiKey: "sk-llm-test",
          },
          workspaceRootDir: "/tmp",
          workspaceSkillDir: "/tmp",
          context: {
            pluginSlug: "test-plugin",
          },
        },
        sink,
      ),
    ).toThrow("OpenHands streaming sessions are not yet supported");
  });
});
